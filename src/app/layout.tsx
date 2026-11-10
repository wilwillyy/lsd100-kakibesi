import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Long Slow Distance — Temukan fotomu lewat nomor BIB",
  description: "Album foto event olahraga Long Slow Distance (LSD100 KAKIBESI). Ketik nomor BIB dan temukan fotomu dalam sekejap.",
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.png",
    apple: "/favicon.png",
  },
};

export const viewport: Viewport = { themeColor: "#04060c" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:ital,wght@0,700;0,800;0,900;1,700;1,800;1,900&family=Archivo+Narrow:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-[family-name:var(--font-sans)] antialiased">{children}</body>
    </html>
  );
}
