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
};

export const SOURCES: Source[] = sourcesJson;
export const SOURCE_BY_SLUG: Record<string, Source> = Object.fromEntries(
  SOURCES.map((s) => [s.slug, s]),
);

export const driveUrl = (s: Source) => `https://drive.google.com/file/d/${s.driveId}/view`;
export const docUrl = (s: Source) => s.url ?? driveUrl(s);

export function pageLabel(start: number | null, end: number | null) {
  if (start == null) return "";
  return start === end || end == null ? `hal. ${start}` : `hal. ${start}–${end}`;
}
