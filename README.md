# Tanya Koordinator BGN

Layanan tanya jawab seputar Surat Edaran (SE), Keputusan, dan Petunjuk Teknis Program Makan Bergizi Gratis. Jawaban disusun **hanya** dari dokumen yang terdaftar, setiap jawaban menyebutkan dokumen dan halamannya, dan jika jawabannya tidak ada di dokumen, chatbot akan mengatakannya, bukan menebak.

- **Aplikasi:** Next.js, siap deploy di Vercel (paket gratis cukup)
- **AI:** Google Gemini (paket gratis), untuk jawaban dan pencarian makna
- **Data:** teks dokumen dari folder Google Drive, disimpan di `data/corpus/`. Tidak perlu database.

## Cara kerja singkat

1. Teks setiap PDF diekstrak (termasuk OCR untuk PDF hasil scan) ke `data/corpus/<slug>.md`, dengan penanda halaman.
2. Saat build, teks dipotong menjadi ±1.600 bagian kecil. Embedding (agar pencarian memahami makna, bukan hanya kata kunci) dibuat dengan `npm run index` di komputer lokal dan disimpan di `data/embeddings.json`.
3. Saat pengguna bertanya, 7 bagian paling relevan dikirim ke Gemini bersama aturan ketat: hanya boleh menjawab dari kutipan dan wajib memberi nomor rujukan.

## Deploy ke Vercel (sekali saja, ±10 menit)

### 1. Buat kunci API Gemini (gratis)
1. Buka https://aistudio.google.com/apikey dan login dengan akun Google.
2. Klik **Create API key**, lalu salin kuncinya (diawali `AIza...`).

### 2. Import repo ke Vercel
1. Buka https://vercel.com/new dan login dengan akun GitHub.
2. Pilih repo **culish/Tanya-Koordinator-BGN**, lalu klik **Import**.
3. Buka bagian **Environment Variables** dan tambahkan:
   - Name: `GEMINI_API_KEY`, Value: kunci dari langkah 1
4. Klik **Deploy**. Setelah selesai, Vercel memberi alamat seperti `tanya-koordinator-bgn.vercel.app`.

Jika proyek sudah terlanjur di-deploy tanpa kunci: buka **Settings → Environments → Production**, tambahkan `GEMINI_API_KEY` di bagian **Environment Variables**, lalu **deploy ulang** (tab Deployments → ⋯ → Redeploy). Variabel baru hanya terbaca oleh deployment yang dibuat setelahnya.

Selesai. Setiap kali ada perubahan yang di-push ke GitHub, Vercel otomatis deploy ulang.

### Pengaturan opsional (Environment Variables)
| Nama | Fungsi | Default |
|---|---|---|
| `GEMINI_MODEL` | Model chat Gemini, boleh beberapa dipisah koma (dicoba berurutan jika ada yang penuh) | `gemini-flash-lite-latest,gemini-3.5-flash-lite,gemini-3.5-flash` |
| `RATE_LIMIT` | Maksimal pertanyaan per IP per 10 menit | `30` |

## Menambah atau memperbarui dokumen

1. Unduh PDF dari Google Drive, simpan ke folder `docs/` dengan nama pendek, misalnya `docs/se-20-2026.pdf`.
2. Tambahkan datanya ke `data/sources.json` (slug harus sama dengan nama file):
   ```json
   {
     "slug": "se-20-2026",
     "jenis": "Surat Edaran Kepala BGN",
     "nomor": "20 Tahun 2026",
     "judul": "Judul lengkap surat edaran",
     "singkat": "SE 20/2026 Topik",
     "driveId": "ID file Google Drive (bagian setelah /file/d/ di tautannya)"
   }
   ```
3. Ekstrak teksnya (perlu Python 3):
   ```bash
   pip install pypdf pypdfium2 rapidocr-onnxruntime numpy
   python scripts/extract.py docs/se-20-2026.pdf
   ```
4. Periksa sekilas `data/corpus/se-20-2026.md`, lalu commit dan push. Vercel akan membangun ulang indeks secara otomatis.

File PDF di `docs/` tidak ikut di-commit, hanya teksnya.

## Menjalankan di komputer sendiri

```bash
npm install
cp .env.example .env.local   # isi GEMINI_API_KEY
npm run index                # bangun indeks + embedding
npm run dev                  # buka http://localhost:3000
```

Cek kualitas pencarian tanpa memanggil model chat:
```bash
npm run test:retrieval -- "apakah MBG tetap dibagikan saat hari Sabtu?"
```

## Catatan dokumen

- Tambahan 17 November 2026: SK 63551/2026 (perubahan juknis pembiayaan SPPG aglomerasi), Peraturan BGN Nomor 4 Tahun 2026, SK 63345.1/2026, dan empat modul (Penyusunan Menu, Edukasi Gizi Seimbang, Keamanan Pangan, Food Waste).
- Tambahan 22 November 2026: PerBGN Nomor 13 Tahun 2026 (Hari Pelayanan Efektif), SE Nomor 23 Tahun 2026 (kualifikasi Chef SPPG), Buku Saku Pedoman Manajemen Krisis, dan seluruh rancangan PerBGN, naskah urgensi, notulensi rapat, hasil analisis-evaluasi, kajian hukum, serta daftar program penyusunan peraturan. Dokumen nonresmi ini diberi `"belumBerlaku": true` di `data/sources.json`: bobotnya diturunkan saat pencarian, ditandai `[BELUM BERLAKU]` untuk model, diberi label "Belum berlaku" di daftar rujukan, dan dikelompokkan terpisah di sidebar. Salinan yang isinya sama (versi .docx.pdf, berkas (1)) hanya dimasukkan sekali.
- Juknis dan pedoman dari https://www.bgn.go.id/juknis (8 dokumen, termasuk Juknis 401.1 lengkap 286 halaman) sudah dimasukkan.
- **Embedding bertahap:** kuota embedding gratis Gemini terbatas per hari. `npm run index` menyimpan progres dan melanjutkan dari posisi terakhir, jadi cukup dijalankan ulang keesokan harinya. Dengan kunci gratis, gunakan batch kecil: `EMBED_BATCH=5 EMBED_PAUSE_MS=20000 npm run index`. Chunk yang belum punya embedding tetap ditemukan lewat pencarian kata kunci. Build di Vercel tidak menghitung embedding (agar tidak menghabiskan kuota), kecuali `EMBED_ON_BUILD=1`.
- Teks dari PDF hasil scan dibaca dengan OCR, sehingga beberapa judul berhuruf tebal bisa kehilangan spasi. Isi pasal dan angka sudah diperiksa terbaca dengan baik.

## Struktur

```
app/                 halaman dan API /api/chat
components/          komponen chat dan tampilan jawaban
lib/retrieve.ts      pencarian (BM25 + embedding Gemini)
lib/prompt.ts        aturan untuk model AI
data/sources.json    daftar dokumen
data/corpus/         teks hasil ekstraksi tiap dokumen
scripts/             ekstraksi PDF, pembangunan indeks, embedding
```

> Alat bantu rujukan, bukan kanal resmi Badan Gizi Nasional. Jawaban dibuat otomatis dan dapat keliru; selalu periksa naskah aslinya.
