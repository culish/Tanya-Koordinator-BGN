import type { Metadata, Viewport } from "next";
import "@fontsource-variable/plus-jakarta-sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tanya Koordinator BGN",
  description:
    "Layanan tanya jawab seputar Surat Edaran dan Petunjuk Teknis Program Makan Bergizi Gratis, lengkap dengan dasar dokumennya.",
};

export const viewport: Viewport = {
  themeColor: "#0b2a55",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
