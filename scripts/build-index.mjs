// Memecah teks dokumen di data/corpus/*.md menjadi potongan (chunk) kecil
// beserta nomor halamannya, lalu menyimpannya ke data/chunks.json.
// Dijalankan otomatis sebelum `next dev` dan `next build`.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sources = JSON.parse(readFileSync(join(ROOT, "data/sources.json"), "utf8"));

const TARGET = 1100; // karakter per chunk
const OVERLAP = 220;

function clean(text) {
  return text
    .replace(/\\([.\-*_#])/g, "$1") // escape markdown dari ekspor Drive
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Gabungkan baris yang terpotong di tengah kalimat agar lebih mudah dibaca model.
function unwrap(text) {
  return text
    .split(/\n{2,}/)
    .map((p) => p.replace(/([^.:;!?\n])\n(?=[a-z0-9(])/g, "$1 "))
    .join("\n\n");
}

function splitPages(md) {
  const parts = md.split(/\[\[HALAMAN (\d+)\]\]/);
  const pages = [];
  if (parts[0].trim()) pages.push({ page: null, text: parts[0] });
  for (let i = 1; i < parts.length; i += 2) {
    pages.push({ page: Number(parts[i]), text: parts[i + 1] ?? "" });
  }
  return pages;
}

function chunkDoc(slug, md) {
  // Susun daftar paragraf yang masing-masing tahu halamannya.
  const paras = [];
  for (const { page, text } of splitPages(md)) {
    for (const p of unwrap(clean(text)).split(/\n{2,}|\n(?=(?:[A-Z]\.|\d+\.|[a-z]\)|\d+\)|KE[A-Z]+\s*:) )/)) {
      const t = p.replace(/\s*\n\s*/g, " ").trim();
      if (t.length > 1) paras.push({ page, text: t });
    }
  }

  const chunks = [];
  let buf = [];
  let len = 0;
  const flush = () => {
    if (!buf.length) return;
    const pagesIn = buf.map((b) => b.page).filter((p) => p != null);
    chunks.push({
      slug,
      pageStart: pagesIn.length ? Math.min(...pagesIn) : null,
      pageEnd: pagesIn.length ? Math.max(...pagesIn) : null,
      text: buf.map((b) => b.text).join("\n"),
    });
    // Sisakan ekor sebagai overlap untuk chunk berikutnya.
    const tail = [];
    let tl = 0;
    for (let i = buf.length - 1; i >= 0 && tl < OVERLAP; i--) {
      tail.unshift(buf[i]);
      tl += buf[i].text.length;
    }
    buf = tl < len ? tail : [];
    len = buf.reduce((s, b) => s + b.text.length, 0);
  };

  for (const para of paras) {
    // Paragraf yang sangat panjang dipotong per kalimat.
    const pieces =
      para.text.length > TARGET * 1.5
        ? para.text.match(new RegExp(`.{1,${TARGET}}(?:[.;:](?=\\s)|$|\\s)`, "gs")) ?? [para.text]
        : [para.text];
    for (const piece of pieces) {
      if (len + piece.length > TARGET && len > 0) flush();
      buf.push({ page: para.page, text: piece.trim() });
      len += piece.length;
    }
  }
  if (len > OVERLAP || chunks.length === 0) flush();
  return chunks;
}

const all = [];
for (const src of sources) {
  const file = join(ROOT, "data/corpus", `${src.slug}.md`);
  if (!existsSync(file)) {
    console.warn(`! Teks untuk ${src.slug} belum ada (data/corpus/${src.slug}.md), dilewati.`);
    continue;
  }
  const chunks = chunkDoc(src.slug, readFileSync(file, "utf8"));
  chunks.forEach((c, i) =>
    all.push({
      id: `${src.slug}#${i}`,
      // Sidik jari isi chunk: embedding disimpan per sidik jari agar bisa dipakai ulang.
      h: createHash("sha1").update(c.text).digest("hex").slice(0, 16),
      ...c,
    }),
  );
  console.log(`  ${src.slug}: ${chunks.length} chunk`);
}

writeFileSync(join(ROOT, "data/chunks.json"), JSON.stringify(all));
console.log(`Indeks teks: ${all.length} chunk dari ${sources.length} dokumen.`);
