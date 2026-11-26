// Pencarian potongan dokumen yang paling relevan dengan pertanyaan.
// Gabungan dua cara:
//   1. BM25 (kata kunci) — selalu tersedia, tanpa API.
//   2. Embedding Gemini (makna) — dipakai jika data/embeddings.json terisi.
// Hasil keduanya digabung dengan Reciprocal Rank Fusion.
import chunksJson from "@/data/chunks.json";
import embeddingsJson from "@/data/embeddings.json";
import { SOURCES as SOURCES_LIST, SOURCE_BY_SLUG } from "./sources";

export type Chunk = {
  id: string;
  slug: string;
  pageStart: number | null;
  pageEnd: number | null;
  text: string;
  h: string;
};

const CHUNKS = chunksJson as Chunk[];
const EMB = embeddingsJson as { model: string; dim: number; byHash?: Record<string, number[]> };
// Vektor per chunk (null jika chunk itu belum punya embedding).
const VECTORS: (number[] | null)[] = CHUNKS.map((c) => EMB.byHash?.[c.h] ?? null);
// Pencarian makna baru dipakai jika hampir semua chunk sudah ber-embedding,
// supaya chunk yang sudah punya vektor tidak lebih diunggulkan dari yang belum.
const HAS_VECTORS = VECTORS.filter(Boolean).length >= CHUNKS.length * 0.9;

// Kata umum Bahasa Indonesia yang tidak membantu pencarian.
const STOP = new Set(
  (
    "yang dan di ke dari untuk pada dalam dengan atau ini itu adalah sebagai oleh juga akan " +
    "tidak bisa dapat ada apa apakah bagaimana berapa kapan siapa mana dimana mengapa kenapa " +
    "saya kami kita anda kamu mereka nya lah kah pun para tersebut secara serta agar bagi " +
    "sudah belum harus wajib boleh perlu hal tentang terhadap maka jika bila apabila karena " +
    "sesuai setiap seluruh antara lain telah masih hanya lebih sangat tolong mohon jelaskan " +
    "gimana gmn sih dong ya kalau kalo tsb dgn utk yg"
  ).split(" "),
);

// Singkatan yang sering dipakai koordinator, diperluas agar cocok dengan isi dokumen.
const SYNONYMS: Record<string, string[]> = {
  mbg: ["makan", "bergizi", "gratis"],
  sppg: ["satuan", "pelayanan", "pemenuhan", "gizi"],
  kppg: ["kantor", "pelayanan", "pemenuhan", "gizi"],
  bgn: ["badan", "gizi", "nasional"],
  juknis: ["petunjuk", "teknis"],
  se: ["surat", "edaran"],
  "3b": ["ibu", "hamil", "menyusui", "balita"],
  bumil: ["ibu", "hamil"],
  busui: ["ibu", "menyusui"],
  libur: ["hari", "libur"],
  pj: ["penanggung", "jawab"],
  banper: ["bantuan", "pemerintah"],
  sipgn: ["sistem", "informasi", "pemenuhan", "gizi", "nasional"],
  insentif: ["insentif"],
};

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map(stem);
}

// Stemmer ringan: buang akhiran umum agar "pendistribusian" ≈ "distribusi".
function stem(t: string): string {
  if (t.length <= 4 || /\d/.test(t)) return t;
  let w = t.replace(/(nya|lah|kah)$/, "");
  w = w.replace(/(kan|an)$/, (m) => (w.length - m.length >= 4 ? "" : m));
  w = w.replace(/^(meng|meny|mem|men|me|peng|peny|pem|pen|pe|ber|be|ter|di|ke|se)/, (m) =>
    w.length - m.length >= 4 ? "" : m,
  );
  return w;
}

// --- BM25 ---------------------------------------------------------------
const K1 = 1.4;
const B = 0.72;
const docTokens = CHUNKS.map((c) => {
  const s = SOURCE_BY_SLUG[c.slug];
  // Judul dokumen ikut diindeks supaya pertanyaan "SE 12" atau "susu" cepat ketemu.
  return tokenize(`${s?.singkat ?? ""} ${s?.judul ?? ""} ${c.text}`);
});
const avgLen = docTokens.reduce((a, d) => a + d.length, 0) / Math.max(1, docTokens.length);
const tf = docTokens.map((toks) => {
  const m = new Map<string, number>();
  for (const t of toks) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
});
const df = new Map<string, number>();
for (const m of tf) for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1);
const N = CHUNKS.length;
const idf = (t: string) => {
  const n = df.get(t) ?? 0;
  return Math.log(1 + (N - n + 0.5) / (n + 0.5));
};

function bm25(query: string): number[] {
  const raw = tokenize(query);
  const q = [...new Set(raw.flatMap((t) => [t, ...(SYNONYMS[t] ?? []).map(stem)]))];
  return tf.map((m, i) => {
    let score = 0;
    const len = docTokens[i].length;
    for (const t of q) {
      const f = m.get(t);
      if (!f) continue;
      score += idf(t) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * len) / avgLen)));
    }
    return score;
  });
}

// Pertanyaan yang menyebut nomor dokumen ("SE 12", "surat edaran nomor 8") diarahkan ke dokumen itu.
function docHint(query: string): string | null {
  const q = query.toLowerCase();
  const m = q.match(/\b(?:se|surat edaran)(?:\s+(?:kepala\s+bgn|nomor|no\.?))*\s*(\d{1,2})\b/);
  if (m) {
    const slug = `se-${m[1].padStart(2, "0")}-2026`;
    if (SOURCE_BY_SLUG[slug]) return slug;
  }
  if (/mendagri|menteri dalam negeri|pemda|pemerintah daerah/.test(q)) return "se-mendagri-500-1-5844";
  if (/deputi|tauwas/.test(q)) return "se-deputi-tauwas-05-2026";
  if (/manajemen krisis|buku saku krisis/.test(q)) return "pedoman-manajemen-krisis-2026";
  if (/perbgn\s*(?:no\.?\s*)?13\b|peraturan (?:badan gizi nasional|bgn) (?:nomor )?13\b|hari pelayanan efektif/.test(q)) return "perbgn-13-2026";
  if (/63539/.test(q)) return "sk-63539-2026";
  {
    const m = q.match(/\bsop\s*(?:no\.?|nomor)?\s*(\d{1,2})\b/);
    const hit = m && SOURCES_LIST.find((s) => s.slug.startsWith(`sop-${m[1].padStart(2, "0")}-`));
    if (hit) return hit.slug;
  }
  if (/63527/.test(q)) return "sk-63527-2026";
  if (/63551|aglomerasi/.test(q)) return "sk-63551-2026";
  if (/perbgn\s*(?:no\.?\s*)?4\b|peraturan (?:badan gizi nasional|bgn) (?:nomor )?4\b/.test(q)) return "perbgn-4-2026";
  if (/401\.?1|juknis tata kelola/.test(q)) return "juknis-401-1-2025";
  return null;
}

// --- Embedding ------------------------------------------------------------
async function embedQuery(query: string, key: string): Promise<number[] | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMB.model}:embedContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          model: `models/${EMB.model}`,
          taskType: "RETRIEVAL_QUERY",
          outputDimensionality: EMB.dim,
          content: { parts: [{ text: query }] },
        }),
        signal: AbortSignal.timeout(6000),
      },
    );
    if (!res.ok) return null;
    const v: number[] = (await res.json()).embedding.values;
    const n = Math.hypot(...v) || 1;
    return v.map((x) => x / n);
  } catch {
    return null;
  }
}

function rank(scores: number[]): number[] {
  return scores
    .map((s, i) => [s, i] as const)
    .filter(([s]) => s > 0)
    .sort((a, b) => b[0] - a[0])
    .map(([, i]) => i);
}

export type Retrieved = Chunk & { score: number };

export async function retrieve(query: string, opts: { k?: number; apiKey?: string } = {}) {
  const k = opts.k ?? 7;
  const lex = bm25(query);
  const hint = docHint(query);
  if (hint) CHUNKS.forEach((c, i) => c.slug === hint && (lex[i] = lex[i] * 1.6 + 2));

  const rankings: number[][] = [rank(lex).slice(0, 30)];

  if (HAS_VECTORS && opts.apiKey) {
    const qv = await embedQuery(query, opts.apiKey);
    if (qv) {
      const sims = VECTORS.map((v) => (v ? v.reduce((s, x, j) => s + x * qv[j], 0) : 0));
      if (hint) CHUNKS.forEach((c, i) => c.slug === hint && (sims[i] += 0.05));
      rankings.push(rank(sims.map((s) => (s > 0.45 ? s : 0))).slice(0, 30));
    }
  }

  // Reciprocal Rank Fusion
  const fused = new Map<number, number>();
  for (const r of rankings) r.forEach((idx, pos) => fused.set(idx, (fused.get(idx) ?? 0) + 1 / (60 + pos)));
  // Rancangan/notulensi/kajian diberi bobot lebih rendah supaya aturan yang berlaku didahulukan,
  // kecuali dokumen itu disebut langsung dalam pertanyaan.
  for (const [idx, sc] of fused) {
    const c = CHUNKS[idx];
    if (c.slug !== hint && SOURCE_BY_SLUG[c.slug]?.belumBerlaku) fused.set(idx, sc * 0.8);
  }

  const picked: Retrieved[] = [];
  const perDoc = new Map<string, number>();
  for (const [idx, score] of [...fused.entries()].sort((a, b) => b[1] - a[1])) {
    const c = CHUNKS[idx];
    // Batasi agar satu dokumen panjang (juknis) tidak memonopoli konteks.
    // Dokumen yang disebut langsung dalam pertanyaan boleh mengisi lebih banyak.
    if ((perDoc.get(c.slug) ?? 0) >= (c.slug === hint ? 6 : 4)) continue;
    perDoc.set(c.slug, (perDoc.get(c.slug) ?? 0) + 1);
    picked.push({ ...c, score });
    if (picked.length >= k) break;
  }
  return { chunks: picked, semantic: rankings.length > 1 };
}

export const INDEX_INFO = {
  chunks: CHUNKS.length,
  withVectors: VECTORS.filter(Boolean).length,
};
