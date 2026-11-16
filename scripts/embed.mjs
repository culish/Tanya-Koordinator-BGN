// Membuat embedding (vektor makna) untuk setiap chunk memakai Gemini, lalu
// menyimpannya ke data/embeddings.json, dikelompokkan per sidik jari isi chunk.
//
// - Bertahap: chunk yang sudah punya embedding tidak dihitung ulang, dan hasil
//   disimpan setelah setiap batch. Jika kuota harian Gemini habis, jalankan
//   lagi besok dan proses akan melanjutkan dari posisi terakhir.
// - Chunk yang belum punya embedding tetap bisa ditemukan lewat pencarian
//   kata kunci, jadi aplikasi selalu berfungsi.
// - Di Vercel langkah ini dilewati (agar build tidak menghabiskan kuota),
//   kecuali EMBED_ON_BUILD=1.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data/embeddings.json");
const MODEL = "gemini-embedding-001";
const DIM = 768;
const BATCH = 50;

for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

let store = { model: MODEL, dim: DIM, byHash: {} };
if (existsSync(OUT)) {
  try {
    const prev = JSON.parse(readFileSync(OUT, "utf8"));
    if (prev.model === MODEL && prev.dim === DIM && prev.byHash) store = prev;
  } catch {}
}
const save = () => writeFileSync(OUT, JSON.stringify(store));

const chunks = JSON.parse(readFileSync(join(ROOT, "data/chunks.json"), "utf8"));
const sources = Object.fromEntries(
  JSON.parse(readFileSync(join(ROOT, "data/sources.json"), "utf8")).map((s) => [s.slug, s]),
);

// Buang embedding milik chunk yang sudah tidak ada.
const live = new Set(chunks.map((c) => c.h));
for (const h of Object.keys(store.byHash)) if (!live.has(h)) delete store.byHash[h];

const todo = [];
const seen = new Set();
for (const c of chunks) {
  if (store.byHash[c.h] || seen.has(c.h)) continue;
  seen.add(c.h);
  todo.push(c);
}
const total = live.size;
const report = () =>
  console.log(`Embedding: ${Object.keys(store.byHash).length}/${total} chunk sudah punya vektor.`);

if (!todo.length) {
  save();
  report();
  process.exit(0);
}
if (process.env.VERCEL && process.env.EMBED_ON_BUILD !== "1") {
  save();
  console.log(`Build Vercel: ${todo.length} chunk belum ber-embedding, dilewati (pakai pencarian kata kunci).`);
  process.exit(0);
}
const key = process.env.GEMINI_API_KEY;
if (!key) {
  save();
  console.warn("! GEMINI_API_KEY belum diisi: embedding dilewati.");
  report();
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class QuotaError extends Error {}

async function embedBatch(batch, attempt = 0) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        requests: batch.map((c) => ({
          model: `models/${MODEL}`,
          taskType: "RETRIEVAL_DOCUMENT",
          title: `${sources[c.slug]?.jenis ?? ""} ${sources[c.slug]?.nomor ?? ""} ${sources[c.slug]?.judul ?? ""}`.trim(),
          outputDimensionality: DIM,
          content: { parts: [{ text: c.text }] },
        })),
      }),
    },
  );
  if (res.status === 429) {
    const body = await res.text();
    // Kuota harian habis: berhenti, lanjutkan besok.
    if (/PerDay|per day|daily/i.test(body) || attempt >= 6) throw new QuotaError(body.slice(0, 160));
    const wait = 15000 * (attempt + 1);
    console.log(`  batas per menit, menunggu ${wait / 1000} detik...`);
    await sleep(wait);
    return embedBatch(batch, attempt + 1);
  }
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return json.embeddings.map((e) => normalize(e.values));
}

function normalize(v) {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => Math.round((x / n) * 1e3) / 1e3);
}

try {
  for (let i = 0; i < todo.length; i += BATCH) {
    if (i) await sleep(4000);
    const batch = todo.slice(i, i + BATCH);
    const vecs = await embedBatch(batch);
    batch.forEach((c, j) => (store.byHash[c.h] = vecs[j]));
    save();
    console.log(`  ${Math.min(i + BATCH, todo.length)}/${todo.length} chunk baru`);
  }
} catch (err) {
  save();
  console.warn(
    err instanceof QuotaError
      ? "! Kuota embedding Gemini habis untuk hari ini. Jalankan `npm run index` lagi besok untuk melanjutkan."
      : `! Embedding berhenti: ${err.message}`,
  );
}
report();
