import type { Metadata, Viewport } from "next";
import { Archivo, Archivo_Narrow, Inter } from "next/font/google";
import "./globals.css";

const sans = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const display = Archivo({
  subsets: ["latin"],
  weight: ["700", "800", "900"],
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

const narrow = Archivo_Narrow({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-narrow",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Long Slow Distance — Temukan fotomu lewat nomor BIB",
  description: "Album foto event olahraga Long Slow Distance (LSD100 KAKIBESI). Ketik nomor BIB dan temukan fotomu dalam sekejap.",
};

export const viewport: Viewport = { themeColor: "#04060c" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${sans.variable} ${display.variable} ${narrow.variable}`}>
      <body className="font-[family-name:var(--font-sans)] antialiased">{children}</body>
    </html>
  );
}
