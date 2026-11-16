// Membuat embedding (vektor makna) untuk setiap chunk memakai Gemini, lalu
// menyimpannya ke data/embeddings.json. Dipakai untuk pencarian semantik.
//
// Jika GEMINI_API_KEY tidak ada atau panggilan gagal, file tetap dibuat
// (kosong) dan aplikasi otomatis memakai pencarian kata kunci saja,
// jadi build tidak pernah gagal karena langkah ini.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data/embeddings.json");
const MODEL = "gemini-embedding-001";
const DIM = 768;

// Muat .env.local / .env untuk pemakaian lokal.
for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const chunks = JSON.parse(readFileSync(join(ROOT, "data/chunks.json"), "utf8"));
const sources = Object.fromEntries(
  JSON.parse(readFileSync(join(ROOT, "data/sources.json"), "utf8")).map((s) => [s.slug, s]),
);
const hash = createHash("sha256")
  .update(MODEL + DIM + chunks.map((c) => c.id + c.text).join("\n"))
  .digest("hex")
  .slice(0, 16);

const empty = () => writeFileSync(OUT, JSON.stringify({ model: MODEL, dim: DIM, hash: null, vectors: [] }));

if (existsSync(OUT)) {
  try {
    const prev = JSON.parse(readFileSync(OUT, "utf8"));
    if (prev.hash === hash && prev.vectors?.length === chunks.length) {
      console.log("Embedding sudah terbaru, dilewati.");
      process.exit(0);
    }
  } catch {}
}

const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.warn("! GEMINI_API_KEY belum diisi: embedding dilewati, aplikasi memakai pencarian kata kunci.");
  empty();
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  if (res.status === 429 && attempt < 5) {
    const wait = 15000 * (attempt + 1);
    console.log(`  kena batas kuota, menunggu ${wait / 1000} detik...`);
    await sleep(wait);
    return embedBatch(batch, attempt + 1);
  }
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.embeddings.map((e) => normalize(e.values));
}

function normalize(v) {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => Math.round((x / n) * 1e4) / 1e4);
}

try {
  const vectors = [];
  for (let i = 0; i < chunks.length; i += 50) {
    vectors.push(...(await embedBatch(chunks.slice(i, i + 50))));
    console.log(`  embedding ${Math.min(i + 50, chunks.length)}/${chunks.length}`);
  }
  writeFileSync(OUT, JSON.stringify({ model: MODEL, dim: DIM, hash, vectors }));
  console.log(`Embedding selesai: ${vectors.length} vektor.`);
} catch (err) {
  console.warn(`! Embedding gagal (${err.message.slice(0, 200)}). Aplikasi memakai pencarian kata kunci.`);
  empty();
}
