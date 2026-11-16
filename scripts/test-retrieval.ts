// Cek cepat kualitas pencarian tanpa memanggil model chat.
// Pemakaian: npm run test:retrieval -- "pertanyaan anda"
import { retrieve } from "../lib/retrieve";
import { SOURCE_BY_SLUG, pageLabel } from "../lib/sources";

const DEFAULT = [
  "Bagaimana pelayanan MBG pada saat hari libur sekolah?",
  "Berapa kali susu harus diberikan kepada peserta didik dalam seminggu?",
  "Berapa besaran insentif ketersediaan dan mutu layanan SPPG?",
  "Apa tugas penanggung jawab pelaksanaan MBG di satuan pendidikan?",
  "Bagaimana aturan jadwal distribusi dan penyajian makanan MBG?",
  "Apa saja pemenuhan minimal pelayanan untuk kelompok 3B?",
  "kapan pemda harus kirim laporan pemantauan?",
  "apakah ayam harus dibeli dari peternak lokal?",
];

async function main() {
const qs = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;
for (const q of qs) {
  const { chunks, semantic } = await retrieve(q, { apiKey: process.env.GEMINI_API_KEY });
  console.log(`\n? ${q}${semantic ? "  (hybrid)" : "  (kata kunci)"}`);
  for (const c of chunks.slice(0, 4)) {
    console.log(`  - ${SOURCE_BY_SLUG[c.slug].singkat} ${pageLabel(c.pageStart, c.pageEnd)} :: ${c.text.slice(0, 90).replace(/\n/g, " ")}`);
  }
}
}
main();
