"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { canvasToBlob, renderCard, type CardStyle } from "@/lib/card";
import { downloadUrl, imgUrl, type IndexedPhoto } from "@/lib/index-format";

type Mode = "original" | CardStyle;

const MODES: { key: Mode; label: string; hint: string }[] = [
  { key: "original", label: "Foto asli", hint: "Kualitas penuh, tanpa bingkai" },
  { key: "card", label: "Kartu", hint: "Bingkai estetik + logo event" },
  { key: "story", label: "Story", hint: "9:16 untuk Instagram & WhatsApp" },
];

const slug = (s: string) => s.replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "") || "foto";

export default function DownloadSheet({ photo, title, onClose }: { photo: IndexedPhoto; title: string; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("card");
  const [preview, setPreview] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [canShare, setCanShare] = useState(false);
  const bibs = useMemo(() => photo.b ?? [], [photo.b]);
  const reqId = useRef(0);

  const base = `${slug(title)}_${bibs[0] ? `BIB${bibs[0]}_` : ""}${(photo.n ?? photo.id.slice(-6)).replace(/\.\w+$/, "")}`;

  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && "canShare" in navigator && typeof navigator.share === "function");
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // live preview
  useEffect(() => {
    const my = ++reqId.current;
    setPreview("");
    if (mode === "original") {
      setPreview(imgUrl(photo.id, 1024));
      return;
    }
    renderCard({ style: mode, title, bibs, src: imgUrl(photo.id, 1024), width: 540 })
      .then((c) => my === reqId.current && setPreview(c.toDataURL("image/jpeg", 0.85)))
      .catch(() => my === reqId.current && setPreview(imgUrl(photo.id, 1024)));
  }, [mode, photo.id, title, bibs]);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(""), 2400);
  };

  const makeBlob = async () => {
    const c = await renderCard({ style: mode as CardStyle, title, bibs, src: imgUrl(photo.id, 2048), width: 1080 });
    return canvasToBlob(c);
  };

  const save = async () => {
    setBusy(true);
    try {
      const a = document.createElement("a");
      if (mode === "original") {
        a.href = downloadUrl(photo.id, `${base}.jpg`);
      } else {
        a.href = URL.createObjectURL(await makeBlob());
        a.download = `${base}_${mode}.jpg`;
      }
      document.body.appendChild(a);
      a.click();
      a.remove();
      flash("Foto sedang diunduh ✓");
    } catch {
      flash("Gagal mengunduh, coba lagi");
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    setBusy(true);
    try {
      const blob = mode === "original" ? await (await fetch(imgUrl(photo.id, 2048))).blob() : await makeBlob();
      const file = new File([blob], `${base}${mode === "original" ? "" : `_${mode}`}.jpg`, { type: "image/jpeg" });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title });
      else flash("Perangkat ini tidak mendukung berbagi file");
    } catch {
      /* user cancelled the share sheet */
    } finally {
      setBusy(false);
    }
  };

  const current = MODES.find((m) => m.key === mode)!;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center md:p-6" role="dialog" aria-modal="true" aria-label="Unduh foto">
      <button aria-label="Tutup" onClick={onClose} className="animate-fade absolute inset-0 bg-[#04060c]/80 backdrop-blur-sm" />

      <div className="animate-sheet relative flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-[28px] border border-white/15 bg-[#0a0f1e] text-[#f4f5f7] shadow-2xl md:max-h-[88dvh] md:max-w-4xl md:flex-row md:rounded-[28px]">
        <div className="mx-auto mt-2.5 h-1.5 w-11 shrink-0 rounded-full bg-white/20 md:hidden" />

        {/* preview */}
        <div className="relative grid min-h-[260px] flex-1 place-items-center overflow-hidden bg-[#04060c] p-5 md:min-h-0 md:p-8">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={preview.slice(-24) + mode}
              src={preview}
              alt="Pratinjau"
              className="animate-pop max-h-[42dvh] max-w-full rounded-2xl object-contain shadow-2xl ring-1 ring-white/10 md:max-h-[72dvh]"
            />
          ) : (
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/10 border-t-[#1E46E6]" />
          )}
        </div>

        {/* controls */}
        <div className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-t border-white/10 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:w-[340px] md:border-l md:border-t-0 md:p-7">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-display text-xl font-black uppercase italic tracking-tight text-[#f4f5f7]">Simpan foto</h3>
              <p className="mt-0.5 text-sm text-[#8a8f9c]">Pilih gaya favoritmu</p>
            </div>
            <button onClick={onClose} aria-label="Tutup" className="hidden h-9 w-9 place-items-center rounded-full bg-white/10 text-[#8a8f9c] hover:bg-white/20 hover:text-white md:grid">
              ✕
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1.5 rounded-2xl border border-white/10 bg-[#04060c] p-1" role="tablist">
            {MODES.map((m) => (
              <button
                key={m.key}
                role="tab"
                aria-selected={mode === m.key}
                onClick={() => setMode(m.key)}
                className={`font-narrow rounded-xl px-2 py-2.5 text-sm font-bold uppercase tracking-wider transition ${
                  mode === m.key ? "bg-[#1E46E6] text-white shadow" : "text-[#8a8f9c] hover:text-white"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="-mt-1 text-sm text-[#8a8f9c]">{current.hint}</p>

          {bibs.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-narrow text-xs font-bold uppercase tracking-widest text-[#8a8f9c]">BIB</span>
              {bibs.map((b) => (
                <span key={b} className="font-display rounded bg-[#1E46E6]/20 px-2 py-0.5 text-sm font-black tracking-wider text-[#4E73FF] ring-1 ring-[#4E73FF]/30">
                  {b}
                </span>
              ))}
            </div>
          )}

          <div className="mt-auto flex flex-col gap-2.5">
            <button
              onClick={save}
              disabled={busy || (mode !== "original" && !preview)}
              className="font-narrow flex h-12 items-center justify-center gap-2 rounded-xl bg-[#1E46E6] text-base font-bold uppercase tracking-wider text-white shadow-lg shadow-[#1E46E6]/35 transition hover:bg-[#4E73FF] active:scale-[0.98] disabled:opacity-60"
            >
              {busy ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <DownloadIcon />}
              {busy ? "Menyiapkan…" : "Unduh"}
            </button>
            {canShare && (
              <button
                onClick={share}
                disabled={busy}
                className="font-narrow flex h-12 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 text-base font-bold uppercase tracking-wider text-[#f4f5f7] transition hover:bg-white/10 active:scale-[0.98] disabled:opacity-60"
              >
                <ShareIcon />
                Bagikan / Simpan ke Galeri
              </button>
            )}
          </div>
        </div>

        {toast && (
          <div className="animate-pop pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-[#1E46E6] px-4 py-2 text-sm font-semibold text-white shadow-lg">
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}

const DownloadIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v12m0 0 5-5m-5 5-5-5M4 20h16" />
  </svg>
);
const ShareIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 16V4m0 0L8 8m4-4 4 4M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6" />
  </svg>
);
