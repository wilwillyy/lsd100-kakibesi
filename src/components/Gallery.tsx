"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import DownloadSheet from "@/components/DownloadSheet";
import { INDEX_URL, directImgUrl, driveThumbFallbackUrl, imgUrl, type IndexedPhoto, type PhotoIndex } from "@/lib/index-format";

const PER_PAGE = 100;

const SearchIcon = ({ className = "h-5 w-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

/** Resilient image URL resolver with 3-tier fallback (lh3 CDN -> drive thumbnail -> Vercel proxy). */
function getPhotoSrc(id: string, w: number, stage: number): string {
  if (stage === 0) return directImgUrl(id, w);
  if (stage === 1) return driveThumbFallbackUrl(id, w);
  if (stage === 2) return imgUrl(id, w);
  return `${imgUrl(id, w)}&retry=${stage}`;
}

export default function Gallery() {
  const [index, setIndex] = useState<PhotoIndex | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [noBib, setNoBib] = useState(false);
  const [source, setSource] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [scrollPct, setScrollPct] = useState(0);
  const [draggingRail, setDraggingRail] = useState(false);
  const [hdLoaded, setHdLoaded] = useState(false);
  const [hdStage, setHdStage] = useState(0);
  const [thumbStage, setThumbStage] = useState(0);
  const heroEnd = useRef<HTMLDivElement>(null);
  const photosTopRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    fetch(INDEX_URL, { cache: "no-cache" })
      .then((r) => {
        if (!r.ok) throw new Error("Index belum dibuat. Jalankan `npm run index` lalu deploy ulang.");
        return r.json();
      })
      .then(setIndex)
      .catch((e) => setError(e.message));
    const bib = new URLSearchParams(window.location.search).get("bib");
    if (bib) setQuery(bib.replace(/\D/g, ""));
  }, []);

  useEffect(() => {
    const u = new URL(window.location.href);
    if (query) u.searchParams.set("bib", query);
    else u.searchParams.delete("bib");
    window.history.replaceState(null, "", u);
    setPage(1);
  }, [query, noBib, source]);

  useEffect(() => {
    const el = heroEnd.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [index]);

  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      const max = Math.max(1, doc.scrollHeight - window.innerHeight);
      setScrollPct(Math.min(1, Math.max(0, window.scrollY / max)));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [index, page, query, noBib, source]);

  const scrollToClientY = (clientY: number) => {
    const rail = railRef.current;
    if (!rail) return;
    const rect = rail.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientY - rect.top) / Math.max(1, rect.height)));
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo({ top: ratio * max, behavior: "auto" });
  };

  const q = query.trim();
  const { visible, undetected, total } = useMemo(() => {
    const all = (index?.photos ?? []).filter((p) => source === null || (p.s ?? 0) === source);
    const undetected = all.filter((p) => p.b && p.b.length === 0).length;
    let visible = all;
    if (noBib) visible = all.filter((p) => p.b && p.b.length === 0);
    else if (q) {
      const exact = all.filter((p) => p.b?.includes(q));
      visible = exact.length || q.length >= 4 ? exact : all.filter((p) => p.b?.some((b) => b.startsWith(q)));
    }
    return { visible, undetected, total: all.length };
  }, [index, q, noBib, source]);

  const totalPages = Math.max(1, Math.ceil(visible.length / PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const startIdx = (currentPage - 1) * PER_PAGE;
  const shown = visible.slice(startIdx, startIdx + PER_PAGE);

  const goToPage = (nextPage: number) => {
    const target = Math.max(1, Math.min(nextPage, totalPages));
    setPage(target);
    requestAnimationFrame(() => {
      photosTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const go = (d: number) =>
    setOpen((i) => {
      if (i === null) return i;
      const next = Math.max(0, Math.min(i + d, visible.length - 1));
      setPage(Math.floor(next / PER_PAGE) + 1);
      return next;
    });

  // Reset progressive lightbox state & preload neighbor photos when `open` changes
  useEffect(() => {
    setHdLoaded(false);
    setHdStage(0);
    setThumbStage(0);
    if (open === null) return;
    const neighbors = [visible[open + 1], visible[open - 1], visible[open + 2]].filter(Boolean);
    for (const p of neighbors) {
      const pre = new Image();
      pre.referrerPolicy = "no-referrer";
      pre.src = directImgUrl(p.id, 1600);
    }
  }, [open, visible]);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (saving) return;
      if (e.key === "Escape") setOpen(null);
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, visible.length, saving]);

  const setBib = (v: string) => {
    setNoBib(false);
    setQuery(v.replace(/\D/g, "").slice(0, 6));
  };

  if (error)
    return (
      <main className="grid min-h-dvh place-items-center p-6 text-center text-[#8a8f9c]">
        <p className="max-w-sm rounded-2xl border border-white/10 bg-[#0a0f1e] p-6 text-[#f4f5f7] shadow-xl">{error}</p>
      </main>
    );
  if (!index)
    return (
      <main className="grid min-h-dvh place-items-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/10 border-t-[#1E46E6]" />
      </main>
    );

  const current = open !== null ? visible[open] : null;
  const filtering = Boolean(q) || noBib;
  const multi = index.sources.length > 1;
  const dashboardTitle = index.title || "Long Slow Distance";

  const onTouchStart = (e: React.TouchEvent) => {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const t = touch.current;
    touch.current = null;
    if (!t) return;
    const dx = e.changedTouches[0].clientX - t.x;
    const dy = e.changedTouches[0].clientY - t.y;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) go(dx < 0 ? 1 : -1);
    else if (dy > 110 && Math.abs(dy) > Math.abs(dx) * 1.4) setOpen(null);
  };

  return (
    <div className="min-h-dvh">
      {/* ---------- Compact sticky bar ---------- */}
      <div
        className={`safe-top fixed inset-x-0 top-0 z-30 border-b border-white/10 bg-[#04060c]/85 backdrop-blur-xl transition duration-300 ${
          stuck ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-full opacity-0"
        }`}
      >
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-2.5 sm:px-8 sm:py-3 lg:px-10">
          <div className="flex shrink-0 items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logos/02-logo-lsd.png" alt="LSD100" className="h-6 w-auto object-contain sm:h-7" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logos/01-logo-kakibesi.png" alt="Kakibesi Club" className="h-7 w-auto object-contain sm:h-8" />
          </div>
          <p className="font-display hidden min-w-0 truncate text-sm font-extrabold uppercase italic tracking-tight text-[#f4f5f7] md:block">
            {dashboardTitle}
          </p>
          <label className="ml-auto flex h-10 w-full max-w-xs items-center gap-2 rounded-full border border-white/15 bg-[#0a0f1e] px-4 text-[#8a8f9c] ring-[#4E73FF] focus-within:border-[#4E73FF] focus-within:ring-2">
            <SearchIcon className="h-4 w-4 text-[#4E73FF]" />
            <input
              inputMode="numeric"
              enterKeyHint="search"
              value={query}
              onChange={(e) => setBib(e.target.value)}
              placeholder="Nomor BIB"
              className="min-w-0 flex-1 bg-transparent text-base font-semibold text-[#f4f5f7] outline-none placeholder:font-normal placeholder:text-[#8a8f9c]"
            />
            {query && (
              <button onClick={() => setBib("")} aria-label="Hapus" className="grid h-6 w-6 place-items-center text-[#8a8f9c] hover:text-white">
                ✕
              </button>
            )}
          </label>
        </div>
        {/* Top horizontal scroll progress bar */}
        <div className="h-[2.5px] w-full bg-white/5">
          <div
            className="h-full bg-gradient-to-r from-[#1E46E6] via-[#4E73FF] to-[#7aa2ff] shadow-[0_0_10px_#4E73FF] transition-[width] duration-75"
            style={{ width: `${Math.round(scrollPct * 100)}%` }}
          />
        </div>
      </div>

      {/* ---------- Aesthetic Interactive Vertical Scroll Slider Rail ---------- */}
      {shown.length > 6 && (
        <div
          className={`fixed bottom-24 right-1.5 top-24 z-30 flex flex-col items-center gap-2 transition-opacity duration-300 ease-out sm:right-3 ${
            (stuck || draggingRail) && open === null ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <div
            ref={railRef}
            role="slider"
            aria-label="Scroll galeri"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(scrollPct * 100)}
            tabIndex={0}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              setDraggingRail(true);
              scrollToClientY(e.clientY);
            }}
            onPointerMove={(e) => {
              if (draggingRail) scrollToClientY(e.clientY);
            }}
            onPointerUp={() => setDraggingRail(false)}
            onPointerCancel={() => setDraggingRail(false)}
            className="group relative h-full w-3 cursor-pointer touch-none select-none py-1 sm:w-3.5"
          >
            {/* Track */}
            <div className="mx-auto h-full w-1.5 rounded-full bg-[#0a0f1e]/90 ring-1 ring-white/15 backdrop-blur transition-all group-hover:w-2 group-hover:ring-[#4E73FF]/50 sm:w-2" />
            {/* Filled track */}
            <div
              className="pointer-events-none absolute left-1/2 top-1 w-1.5 -translate-x-1/2 rounded-full bg-gradient-to-b from-[#1E46E6]/50 to-[#4E73FF] sm:w-2"
              style={{ height: `calc(${scrollPct * 100}% - 4px)` }}
            />
            {/* Glowing Thumb */}
            <div
              className={`pointer-events-none absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-b from-[#7aa2ff] via-[#4E73FF] to-[#1E46E6] shadow-[0_0_14px_rgba(78,115,255,0.95)] ring-2 ring-white/80 transition-transform ${
                draggingRail ? "h-9 w-3.5 scale-110" : "h-7 w-2.5 group-hover:h-8 group-hover:w-3 sm:h-8 sm:w-3"
              }`}
              style={{ top: `calc(14px + ${scrollPct * 100}% * 0.92)` }}
            />
            {/* Percentage badge when dragging or hovering */}
            <span
              className={`font-narrow pointer-events-none absolute right-5 -translate-y-1/2 whitespace-nowrap rounded-md border border-[#4E73FF]/40 bg-[#0a0f1e]/95 px-2 py-0.5 text-[11px] font-bold tracking-wider text-[#f4f5f7] shadow-lg transition-opacity ${
                draggingRail ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              }`}
              style={{ top: `calc(14px + ${scrollPct * 100}% * 0.92)` }}
            >
              {Math.round(scrollPct * 100)}%
            </span>
          </div>
        </div>
      )}

      {/* ---------- Floating Scroll-To-Top Button ---------- */}
      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        aria-label="Kembali ke atas"
        className={`fixed bottom-5 right-3 z-30 flex h-10 items-center gap-1.5 rounded-full border border-[#4E73FF]/40 bg-[#0a0f1e]/90 px-3.5 text-xs font-bold uppercase tracking-wider text-[#f4f5f7] shadow-[0_8px_25px_rgba(30,70,230,0.45)] backdrop-blur transition-all duration-300 hover:bg-[#1E46E6] active:scale-95 sm:bottom-6 sm:right-5 ${
          stuck && open === null ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0"
        }`}
      >
        <span className="text-sm leading-none text-[#4E73FF]">↑</span>
        <span className="font-narrow">Atas</span>
      </button>

      {/* ---------- Hero ---------- */}
      <section className="hero px-5 pb-9 pt-[max(1.75rem,calc(env(safe-area-inset-top)+1.25rem))] text-[#f4f5f7] sm:px-8 sm:pb-12 sm:pt-10 lg:px-10 lg:pb-14 lg:pt-8">
        <div className="hero-num" aria-hidden="true">
          <span>100</span>
        </div>
        <div className="hero-scrim" aria-hidden="true" />

        <div className="relative mx-auto flex max-w-[1600px] items-center gap-3.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logos/02-logo-lsd.png" alt="LSD100" className="h-8 w-auto object-contain sm:h-9" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logos/01-logo-kakibesi.png" alt="Kakibesi Club" className="h-9 w-auto object-contain sm:h-10" />
        </div>

        <div className="relative mx-auto max-w-5xl">
          <div className="mt-8 text-center sm:mt-12 lg:mt-14">
            <p className="font-narrow animate-rise text-xs font-bold uppercase tracking-[0.22em] text-[#4E73FF] sm:text-sm">
              Event Photo Album · LSD100 KAKIBESI
            </p>
            <h1
              className="font-display animate-rise mt-2.5 text-balance text-[2.35rem] font-black uppercase italic leading-[0.98] tracking-[-0.03em] text-[#f4f5f7] sm:mt-3 sm:text-6xl lg:text-7xl"
              style={{ animationDelay: "60ms" }}
            >
              {dashboardTitle}
            </h1>
            <p className="animate-rise mx-auto mt-3.5 max-w-md text-pretty text-[15px] text-[#8a8f9c] sm:mt-4 sm:max-w-xl sm:text-lg" style={{ animationDelay: "120ms" }}>
              Ketik nomor BIB di dadamu, <span className="font-medium text-[#f4f5f7]">fotomu langsung muncul.</span>
            </p>
            <p className="animate-rise mx-auto mt-2 max-w-md text-pretty text-xs leading-relaxed text-[#8a8f9c]/85 sm:mt-2.5 sm:max-w-lg sm:text-[13px]" style={{ animationDelay: "160ms" }}>
              System mungkin tidak bisa mendeteksi akurat nomor BIB kamu, kamu bisa scroll manual. Dilarang mengunduh foto peserta lain tanpa izin.
            </p>
          </div>

          <div className="animate-rise mx-auto mt-8 max-w-sm sm:mt-10 sm:max-w-md lg:max-w-lg" style={{ animationDelay: "200ms" }}>
            <label className="bib-card block cursor-text px-5 pb-4 pt-3.5 sm:px-7 sm:pb-5 sm:pt-4" onClick={() => inputRef.current?.focus()}>
              <span className="bib-pin left-2.5 top-2.5 sm:left-3 sm:top-3" />
              <span className="bib-pin right-2.5 top-2.5 sm:right-3 sm:top-3" />
              <span className="bib-pin bottom-2.5 left-2.5 sm:bottom-3 sm:left-3" />
              <span className="bib-pin bottom-2.5 right-2.5 sm:bottom-3 sm:right-3" />
              <span className="font-narrow flex items-center justify-between px-1 text-[11px] font-bold uppercase tracking-[0.2em] text-[#1E46E6]">
                <span>Nomor BIB</span>
                <span className="text-slate-400">Cari fotomu</span>
              </span>
              <span className="mt-1 flex items-center gap-2 sm:gap-3">
                <input
                  ref={inputRef}
                  autoFocus
                  inputMode="numeric"
                  enterKeyHint="search"
                  autoComplete="off"
                  value={query}
                  onChange={(e) => setBib(e.target.value)}
                  placeholder="0000"
                  aria-label="Nomor BIB"
                  className="bib-digits w-full min-w-0 bg-transparent text-center text-[3.4rem] font-black leading-tight text-[#04060c] outline-none placeholder:text-slate-200 sm:text-7xl"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setBib("");
                    }}
                    aria-label="Hapus"
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500 active:bg-slate-200"
                  >
                    ✕
                  </button>
                ) : (
                  <SearchIcon className="h-8 w-8 shrink-0 text-slate-300" />
                )}
              </span>
            </label>
          </div>

          <div className="animate-rise mt-6 flex flex-col items-center justify-center gap-3 text-[13px] sm:mt-8 sm:text-sm" style={{ animationDelay: "280ms" }}>
            <Stat label="foto" value={index.photos.length} />
            <button
              type="button"
              onClick={() => photosTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="font-narrow group mt-1 inline-flex items-center gap-2 rounded-full border border-[#4E73FF]/30 bg-[#1E46E6]/15 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-[#7aa2ff] transition hover:border-[#4E73FF] hover:bg-[#1E46E6]/30 hover:text-white active:scale-95"
            >
              <span>Scroll galeri foto</span>
              <span className="inline-block animate-bounce text-sm leading-none text-[#4E73FF]">↓</span>
            </button>
          </div>
        </div>
      </section>
      <div ref={heroEnd} className="h-px" />

      {/* ---------- Results ---------- */}
      <main className="mx-auto mt-5 max-w-[1600px] px-1.5 pb-16 pr-5 sm:mt-8 sm:px-4 sm:pr-7">
        {multi && (
          <div className="-mx-1.5 mb-3 flex gap-2 overflow-x-auto px-3 pb-2 sm:mx-0 sm:px-2" role="tablist" aria-label="Sumber foto">
            <Chip active={source === null} onClick={() => setSource(null)}>
              Semua <small className="opacity-70">{index.photos.length}</small>
            </Chip>
            {index.sources.map((s, i) => (
              <Chip key={i} active={source === i} onClick={() => setSource(i)}>
                <span aria-hidden>{s.type === "drive" ? "▲" : "◐"}</span> {s.title} <small className="opacity-70">{s.count}</small>
              </Chip>
            ))}
          </div>
        )}

        <div ref={photosTopRef} className="mb-3 flex scroll-mt-20 flex-wrap items-center gap-x-3 gap-y-1.5 px-2.5 sm:px-2">
          <h2 className="font-display text-base font-extrabold uppercase italic tracking-tight text-[#f4f5f7] sm:text-lg">
            {noBib ? (
              "Foto tanpa BIB terdeteksi"
            ) : q ? (
              <>
                Hasil untuk <span className="rounded bg-[#1E46E6] px-2 py-0.5 not-italic text-white">#{q}</span>
              </>
            ) : (
              "Semua foto"
            )}
          </h2>
          <span className="font-narrow rounded-full border border-white/10 bg-[#0a0f1e] px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[#8a8f9c]">
            {visible.length > 0 ? `${startIdx + 1}–${Math.min(startIdx + PER_PAGE, visible.length)} dari ${visible.length}` : "0"} foto
          </span>
          {totalPages > 1 && (
            <span className="font-narrow rounded-full border border-[#4E73FF]/30 bg-[#1E46E6]/15 px-3 py-1 text-xs font-bold uppercase tracking-wider text-[#7aa2ff]">
              Hal {currentPage} / {totalPages}
            </span>
          )}
          {filtering && (
            <button
              onClick={() => {
                setNoBib(false);
                setQuery("");
              }}
              className="font-narrow py-1 text-xs font-bold uppercase tracking-wider text-[#4E73FF] hover:underline"
            >
              Tampilkan semua
            </button>
          )}
        </div>

        {filtering && visible.length === 0 && (
          <div className="animate-rise mx-auto my-8 max-w-md rounded-2xl border border-white/10 bg-[#0a0f1e] p-8 text-center shadow-2xl sm:p-10">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#1E46E6]/20 text-[#4E73FF] ring-1 ring-[#4E73FF]/30">
              <SearchIcon className="h-7 w-7" />
            </div>
            <p className="font-display mt-4 text-lg font-extrabold uppercase italic text-[#f4f5f7]">Foto tidak ditemukan</p>
            <p className="mt-1 text-sm text-[#8a8f9c]">
              Belum ada foto dengan BIB <b className="text-[#f4f5f7]">{q}</b>. Pastikan nomornya benar
              {undetected > 0 ? ", atau cek foto yang BIB-nya tidak terbaca." : "."}
            </p>
            {undetected > 0 && !noBib && (
              <button
                onClick={() => {
                  setQuery("");
                  setNoBib(true);
                }}
                className="font-narrow mt-5 h-11 rounded-lg bg-[#1E46E6] px-5 text-sm font-bold uppercase tracking-wider text-white transition hover:bg-[#4E73FF] active:scale-95"
              >
                Lihat {undetected} foto tanpa BIB terbaca
              </button>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-1 sm:gap-2">
          {shown.map((p, i) => (
            <PhotoTile key={p.id} photo={p} query={q} onClick={() => setOpen(startIdx + i)} />
          ))}
          <span className="grow-[100]" />
        </div>

        {/* ---------- Pagination Bar (100 photos per page, no page reload) ---------- */}
        {totalPages > 1 && (
          <nav
            aria-label="Navigasi halaman foto"
            className="mt-8 flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-[#0a0f1e]/90 p-4 shadow-xl backdrop-blur sm:mt-10 sm:flex-row sm:justify-between sm:px-6"
          >
            <div className="font-narrow text-xs font-semibold uppercase tracking-wider text-[#8a8f9c] sm:text-sm">
              Halaman <b className="text-[#f4f5f7]">{currentPage}</b> dari <b className="text-[#f4f5f7]">{totalPages}</b>{" "}
              <span className="opacity-75">
                ({startIdx + 1}–{Math.min(startIdx + PER_PAGE, visible.length)} dari {visible.length} foto)
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => goToPage(currentPage - 1)}
                className="font-narrow flex h-10 items-center gap-1.5 rounded-xl border border-white/15 bg-[#04060c] px-3.5 text-xs font-bold uppercase tracking-wider text-[#f4f5f7] transition hover:border-[#4E73FF] hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-35 sm:text-sm"
              >
                <span>←</span>
                <span>Sebelumnya</span>
              </button>

              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, idx) => idx + 1).map((pNum) => {
                  const active = pNum === currentPage;
                  return (
                    <button
                      key={pNum}
                      type="button"
                      onClick={() => goToPage(pNum)}
                      aria-current={active ? "page" : undefined}
                      className={`font-display h-10 min-w-[2.5rem] rounded-xl px-2.5 text-sm font-black transition active:scale-95 ${
                        active
                          ? "bg-[#1E46E6] text-white shadow-lg shadow-[#1E46E6]/40 ring-1 ring-[#4E73FF]"
                          : "border border-white/10 bg-[#04060c] text-[#8a8f9c] hover:border-white/30 hover:text-[#f4f5f7]"
                      }`}
                    >
                      {pNum}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => goToPage(currentPage + 1)}
                className="font-narrow flex h-10 items-center gap-1.5 rounded-xl bg-[#1E46E6] px-4 text-xs font-bold uppercase tracking-wider text-white shadow-lg shadow-[#1E46E6]/35 ring-1 ring-[#4E73FF] transition hover:bg-[#4E73FF] active:scale-95 disabled:pointer-events-none disabled:opacity-35 sm:text-sm"
              >
                <span>Selanjutnya</span>
                <span>→</span>
              </button>
            </div>
          </nav>
        )}

        {!filtering && undetected > 0 && (
          <div className="mt-6 text-center">
            <button onClick={() => setNoBib(true)} className="font-narrow p-2 text-xs font-semibold uppercase tracking-wider text-[#8a8f9c] hover:text-[#f4f5f7]">
              Lihat {undetected} foto tanpa BIB terdeteksi
            </button>
          </div>
        )}
      </main>

      <footer className="safe-bottom border-t border-white/10 py-8 text-center text-xs text-[#8a8f9c]">
        LONG SLOW DISTANCE · LSD100 KAKIBESI · KAKIBESI.CLUB
      </footer>

      {/* ---------- Lightbox ---------- */}
      {current && (
        <div className="animate-pop fixed inset-0 z-50 flex h-dvh flex-col bg-[#04060c]" role="dialog" aria-modal="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={getPhotoSrc(current.id, 640, thumbStage)}
            referrerPolicy="no-referrer"
            alt=""
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-30 blur-3xl"
          />

          <div className="safe-top relative">
            <div className="flex items-center gap-2 px-2.5 py-2.5 text-white sm:gap-3 sm:px-5 sm:py-3">
              <button onClick={() => setOpen(null)} aria-label="Tutup" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10 text-lg backdrop-blur active:bg-white/25 sm:hover:bg-white/20">
                ✕
              </button>
              <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
                {current.b?.length ? (
                  current.b.map((b) => (
                    <button
                      key={b}
                      onClick={() => {
                        setBib(b);
                        setOpen(null);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                      title="Cari semua foto BIB ini"
                      className="font-display shrink-0 rounded-lg bg-[#0a0f1e] px-3 py-1.5 text-sm font-black tracking-widest text-[#f4f5f7] ring-1 ring-white/20 transition active:scale-95 sm:hover:-translate-y-0.5 sm:hover:bg-[#1E46E6]"
                    >
                      {b}
                    </button>
                  ))
                ) : (
                  <span className="shrink-0 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white/70">{current.b ? "BIB tidak terdeteksi" : "Belum terindeks"}</span>
                )}
              </div>
              <span className="hidden shrink-0 text-sm tabular-nums text-white/60 md:block">
                {open! + 1} / {visible.length}
              </span>
              <button
                onClick={() => setSaving(true)}
                aria-label="Unduh"
                className="font-narrow flex h-11 shrink-0 items-center gap-2 rounded-full bg-[#1E46E6] px-4 text-sm font-bold uppercase tracking-wider text-white shadow-lg shadow-[#1E46E6]/40 active:scale-95 sm:hover:bg-[#4E73FF]"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v12m0 0 5-5m-5 5-5-5M4 20h16" />
                </svg>
                <span>Unduh</span>
              </button>
            </div>
          </div>

          <div
            className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-14 sm:px-20 md:pb-12"
            onClick={() => setOpen(null)}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            {/* Progressive Image Container: Instant 640px cached thumbnail + seamless 1600px HD overlay */}
            <div
              onClick={(e) => e.stopPropagation()}
              className="animate-pop relative flex max-h-full max-w-full items-center justify-center"
            >
              {/* Layer 1: Already-cached 640px thumbnail shows immediately in 0ms */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={`thumb-${current.id}`}
                src={getPhotoSrc(current.id, 640, thumbStage)}
                referrerPolicy="no-referrer"
                alt=""
                onError={() => setThumbStage((s) => (s < 3 ? s + 1 : s))}
                className="max-h-[calc(100dvh-130px)] max-w-full select-none rounded-lg object-contain shadow-2xl sm:rounded-xl"
                draggable={false}
              />
              {/* Layer 2: High-resolution 1600px image fades in smoothly on top */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={`hd-${current.id}-${hdStage}`}
                src={getPhotoSrc(current.id, 1600, hdStage)}
                referrerPolicy="no-referrer"
                alt=""
                onLoad={() => setHdLoaded(true)}
                onError={() => setHdStage((s) => (s < 3 ? s + 1 : s))}
                className={`absolute inset-0 h-full w-full select-none rounded-lg object-contain transition-opacity duration-300 sm:rounded-xl ${
                  hdLoaded ? "opacity-100" : "opacity-0"
                }`}
                draggable={false}
              />
            </div>

            {open! > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  go(-1);
                }}
                aria-label="Sebelumnya"
                className="absolute left-2 grid h-11 w-11 place-items-center rounded-full border border-white/20 bg-[#0a0f1e]/80 text-2xl text-white shadow-lg backdrop-blur transition hover:border-[#4E73FF] hover:bg-[#1E46E6] active:scale-95 sm:left-4 sm:h-12 sm:w-12 sm:text-3xl"
              >
                ‹
              </button>
            )}
            {open! < visible.length - 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  go(1);
                }}
                aria-label="Berikutnya"
                className="absolute right-2 grid h-11 w-11 place-items-center rounded-full border border-white/20 bg-[#0a0f1e]/80 text-2xl text-white shadow-lg backdrop-blur transition hover:border-[#4E73FF] hover:bg-[#1E46E6] active:scale-95 sm:right-4 sm:h-12 sm:w-12 sm:text-3xl"
              >
                ›
              </button>
            )}

            {/* Aesthetic bottom slide bar & counter */}
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full border border-white/15 bg-[#0a0f1e]/90 px-4 py-1.5 text-xs tabular-nums text-[#f4f5f7] shadow-xl backdrop-blur"
            >
              <span className="font-narrow font-bold tracking-wider">
                {open! + 1} <span className="text-[#8a8f9c]">/ {visible.length}</span>
              </span>
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/10 sm:w-32">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#1E46E6] to-[#4E73FF] transition-all duration-200"
                  style={{ width: `${((open! + 1) / Math.max(1, visible.length)) * 100}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {current && saving && <DownloadSheet photo={current} title={dashboardTitle} onClose={() => setSaving(false)} />}
    </div>
  );
}

function PhotoTile({ photo: p, query: q, onClick }: { photo: IndexedPhoto; query: string; onClick: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [stage, setStage] = useState(0);
  const ratio = p.w && p.h ? p.w / p.h : 1.5;

  return (
    <button
      onClick={onClick}
      className="tile group relative overflow-hidden rounded-xl shadow-sm ring-1 ring-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4E73FF] sm:rounded-2xl"
      style={{
        width: `calc(var(--row-h) * ${ratio})`,
        flexGrow: ratio * 100,
        maxWidth: `min(calc(var(--row-h) * ${ratio * 1.8}), 100%)`,
      }}
    >
      <i className="block" style={{ paddingBottom: `${(1 / ratio) * 100}%` }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={(el) => {
          if (el?.complete && el.naturalWidth > 0 && !loaded) setLoaded(true);
        }}
        src={getPhotoSrc(p.id, 640, stage)}
        referrerPolicy="no-referrer"
        alt={p.b?.length ? `Foto BIB ${p.b.join(", ")}` : "Foto event"}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => {
          if (stage < 3) setStage((s) => s + 1);
        }}
        style={{ opacity: loaded ? 1 : 0 }}
        className="absolute inset-0 h-full w-full object-cover"
      />
      <span className="absolute inset-0 bg-gradient-to-t from-[#04060c]/75 via-transparent to-transparent opacity-0 transition duration-300 group-hover:opacity-100" />
      {p.b && p.b.length > 0 && (
        <span
          className={`bibs absolute bottom-1.5 left-1.5 flex max-w-[94%] flex-wrap gap-1 transition duration-300 sm:bottom-2 sm:left-2 ${
            q ? "opacity-100" : "translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100"
          }`}
        >
          {p.b.slice(0, 3).map((b) => (
            <span
              key={b}
              className={`font-display rounded px-1.5 py-0.5 text-[10px] font-black tracking-wider shadow sm:text-[11px] ${
                b === q ? "bg-[#1E46E6] text-white ring-1 ring-[#4E73FF]" : "bg-[#04060c]/90 text-[#f4f5f7] ring-1 ring-white/15"
              }`}
            >
              {b}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`font-narrow h-10 shrink-0 whitespace-nowrap rounded-full px-4 text-sm font-bold uppercase tracking-wider transition ${
        active
          ? "bg-[#1E46E6] text-white shadow-lg shadow-[#1E46E6]/30 ring-1 ring-[#4E73FF]"
          : "bg-[#0a0f1e] text-[#8a8f9c] ring-1 ring-white/10 active:bg-white/10 sm:hover:text-[#f4f5f7] sm:hover:ring-white/25"
      }`}
    >
      {children}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="font-narrow rounded-full border border-white/15 bg-[#0a0f1e]/85 px-3.5 py-1.5 uppercase tracking-wider text-[#8a8f9c] backdrop-blur sm:px-4">
      <b className="font-display font-black text-[#f4f5f7]">{value.toLocaleString("id-ID")}</b> {label}
    </span>
  );
}
