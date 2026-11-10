# RaceBib Gallery

Album foto event olahraga dengan **pencarian nomor BIB** instan, dukungan multi-sumber (**Google Photos** & **Google Drive**), tampilan proporsional untuk HP/tablet/desktop, serta fitur unduh kartu foto & Story estetik. Tanpa login.

## Cara Kerja
1. **Multi-Sumber (`src/lib/sources.ts`):** Menggabungkan foto dari link album publik Google Photos dan folder publik Google Drive.
2. **Index Offline (`npm run index`):** Memindai foto secara paralel menggunakan **PaddleOCR PP-OCRv4 (ONNX)** dan menyimpan hasilnya ke `public/data/index.json`. Bisa dihentikan dan dilanjutkan kapan saja (hanya memproses foto baru/belum terindeks).
3. **Pencarian Instan di Website:** Pengunjung langsung mencari dari `index.json` tanpa menjalankan OCR di browser. Hanya angka **4 digit** yang diterima (`BIB_DIGITS` di `src/lib/bibs.ts`), sehingga teks seperti "LSD100" di jersey diabaikan.
4. **Unduh Estetik (`DownloadSheet`):** Pengunjung dapat memilih 3 mode saat mengunduh foto:
   - **Foto Asli:** Resolusi penuh tanpa bingkai (melalui `/api/download`).
   - **Kartu:** Bingkai bergaya polaroid modern dengan judul event & badge nomor BIB.
   - **Story (9:16):** Format vertikal dengan latar belakang blur artistik, siap dibagikan ke Instagram / WhatsApp Story (mendukung Web Share API di HP).

## Penggunaan
```bash
npm install
npm run index          # scan semua sumber foto (resumable)
npm run dev            # jalankan server lokal di http://localhost:3000
```
Opsi indexer: `npm run index -- --workers 4 --limit 100 --force`.
Daftar sumber foto dan judul event dapat diatur di `src/lib/sources.ts`.

## Deploy ke Vercel
Push repositori (termasuk `public/data/index.json`) ke GitHub lalu import ke Vercel. Tidak memerlukan environment variable wajib (opsional: `EVENT_TITLE`).
