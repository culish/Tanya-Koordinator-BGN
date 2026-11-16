#!/usr/bin/env python3
"""
Ekstrak teks dari PDF di folder docs/ ke data/corpus/<slug>.md

- Halaman yang punya lapisan teks dibaca dengan pypdf.
- Halaman hasil scan (tanpa teks) dibaca dengan OCR (rapidocr-onnxruntime).
- Setiap halaman diberi penanda [[HALAMAN n]] supaya chatbot bisa menyebut
  nomor halaman saat mengutip sumber.

Pemakaian:
    pip install pypdf pypdfium2 rapidocr-onnxruntime numpy
    python scripts/extract.py                 # semua PDF di docs/
    python scripts/extract.py docs/se-20.pdf  # satu file saja

Nama file PDF (tanpa .pdf) dipakai sebagai slug, dan harus sama dengan
"slug" di data/sources.json.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
OUT = ROOT / "data" / "corpus"

_ocr = None


def ocr_page(page) -> str:
    global _ocr
    import numpy as np
    from rapidocr_onnxruntime import RapidOCR

    if _ocr is None:
        _ocr = RapidOCR()
    img = page.render(scale=2.5).to_pil().convert("RGB")
    res, _ = _ocr(np.array(img))
    if not res:
        return ""
    # Kelompokkan kotak teks menjadi baris berdasarkan posisi vertikal.
    res.sort(key=lambda r: r[0][0][1])
    lines, cur, cy = [], [], None
    for box, txt, _score in res:
        y = (box[0][1] + box[2][1]) / 2
        h = abs(box[2][1] - box[0][1]) or 1
        if cy is None or abs(y - cy) < h * 0.6:
            cur.append((box[0][0], txt))
            cy = y if cy is None else cy
        else:
            lines.append(cur)
            cur, cy = [(box[0][0], txt)], y
    if cur:
        lines.append(cur)
    return "\n".join(" ".join(t for _, t in sorted(line)) for line in lines)


def extract(pdf_path: Path) -> str:
    import pypdfium2 as pdfium
    from pypdf import PdfReader

    reader = PdfReader(str(pdf_path))
    pdf = pdfium.PdfDocument(str(pdf_path))
    parts = []
    for i, page in enumerate(reader.pages):
        text = (page.extract_text() or "").strip()
        if len(text) < 40:  # kemungkinan hasil scan
            text = ocr_page(pdf[i]).strip()
            mode = "ocr"
        else:
            mode = "teks"
        print(f"  hal {i + 1}: {mode}, {len(text)} karakter")
        parts.append(f"[[HALAMAN {i + 1}]]\n{text}")
    return "\n\n".join(parts) + "\n"


def main():
    files = [Path(p) for p in sys.argv[1:]] or sorted(DOCS.glob("*.pdf"))
    if not files:
        print("Tidak ada PDF. Taruh file di folder docs/ dulu.")
        return
    OUT.mkdir(parents=True, exist_ok=True)
    for f in files:
        print(f"> {f.name}")
        (OUT / f"{f.stem}.md").write_text(extract(f), encoding="utf-8")
    print("Selesai. Jalankan `npm run index` untuk membangun ulang indeks.")


if __name__ == "__main__":
    main()
