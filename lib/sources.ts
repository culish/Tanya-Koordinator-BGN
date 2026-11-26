import sourcesJson from "@/data/sources.json";

export type Source = {
  slug: string;
  jenis: string;
  nomor: string;
  judul: string;
  singkat: string;
  driveId: string;
  /** Halaman resmi di bgn.go.id, jika ada. Dipakai sebagai tautan utama. */
  url?: string;
  /** true untuk rancangan, notulensi, naskah urgensi, kajian hukum: bukan aturan yang berlaku. */
  belumBerlaku?: boolean;
  /** Dokumen yang hanya berlaku untuk kasus tertentu (mis. SPPG aglomerasi). Kata kunci berupa regex. */
  khusus?: { label: string; kata: string };
};

export const SOURCES: Source[] = sourcesJson;

export const DRAFT_NOTE = "bukan aturan berlaku, hanya bahan pembahasan";
export const SOURCE_BY_SLUG: Record<string, Source> = Object.fromEntries(
  SOURCES.map((s) => [s.slug, s]),
);

/** "Keputusan Kepala BGN Nomor 63551 Tahun 2026", atau "Modul BGN Tahun 2025" bila tanpa nomor. */
export const docName = (s: { jenis: string; nomor: string }) =>
  /^\d/.test(s.nomor) ? `${s.jenis} Nomor ${s.nomor}` : `${s.jenis} ${s.nomor}`;

export const driveUrl = (s: Source) => `https://drive.google.com/file/d/${s.driveId}/view`;
export const docUrl = (s: Source) => s.url ?? driveUrl(s);

export function pageLabel(start: number | null, end: number | null) {
  if (start == null) return "";
  return start === end || end == null ? `hal. ${start}` : `hal. ${start}–${end}`;
}
