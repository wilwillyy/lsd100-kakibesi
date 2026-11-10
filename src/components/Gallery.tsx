"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import DownloadSheet from "@/components/DownloadSheet";
import { INDEX_URL, imgUrl, type PhotoIndex } from "@/lib/index-format";

const PAGE = 150;

const SearchIcon = ({ className = "h-5 w-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export default function Gallery() {
  const [index, setIndex] = useState<PhotoIndex | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [noBib, setNoBib] = useState(false);
  const [source, setSource] = useState<number | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [stuck, setStuck] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const heroEnd = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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
    setLimit(PAGE);
  }, [query, noBib, source]);

  useEffect(() => {
    const el = heroEnd.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [index]);

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

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && setLimit((l) => l + PAGE), { rootMargin: "900px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visible.length]);

  const go = (d: number) => setOpen((i) => (i === null ? i : Math.max(0, Math.min(i + d, visible.length - 1))));

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
  const shown = visible.slice(0, limit);
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
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-3 py-2 sm:px-6 sm:py-2.5">
          <div className="flex shrink-0 items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logos/lsd-logo.png" alt="LSD100" className="h-6 w-auto object-contain sm:h-7" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logos/kabes-logo.png" alt="Kakibesi Club" className="h-7 w-auto object-contain sm:h-8" />
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
      </div>

      {/* ---------- Hero ---------- */}
      <section className="hero safe-top px-4 pb-10 pt-6 text-[#f4f5f7] sm:px-8 sm:pb-14 sm:pt-9 lg:pb-16">
        <div className="hero-num" aria-hidden="true">
          <span>100</span>
        </div>
        <div className="hero-scrim" aria-hidden="true" />

        <div className="relative mx-auto max-w-5xl">
          <div className="flex items-center gap-3.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logos/lsd-logo.png" alt="LSD100" className="h-8 w-auto object-contain sm:h-9" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logos/kabes-logo.png" alt="Kakibesi Club" className="h-9 w-auto object-contain sm:h-10" />
          </div>

          <div className="mt-9 text-center sm:mt-14 lg:mt-16">
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

          <div className="animate-rise mt-6 flex flex-wrap items-center justify-center gap-2 text-[13px] sm:mt-8 sm:text-sm" style={{ animationDelay: "280ms" }}>
            <Stat label="foto" value={index.photos.length} />
          </div>
        </div>
      </section>
      <div ref={heroEnd} className="h-px" />

      {/* ---------- Results ---------- */}
      <main className="mx-auto mt-5 max-w-[1600px] px-1.5 pb-16 sm:mt-8 sm:px-4">
        {multi && (
          <div className="no-scrollbar -mx-1.5 mb-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-2" role="tablist" aria-label="Sumber foto">
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

        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-2.5 sm:px-2">
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
            {filtering ? `${visible.length} dari ${total}` : total} foto
          </span>
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
          {shown.map((p, i) => {
            const ratio = p.w && p.h ? p.w / p.h : 1.5;
            return (
              <button
                key={p.id}
                onClick={() => setOpen(i)}
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
                  src={imgUrl(p.id, 640)}
                  alt={p.b?.length ? `Foto BIB ${p.b.join(", ")}` : "Foto event"}
                  loading="lazy"
                  decoding="async"
                  onLoad={(e) => (e.currentTarget.style.opacity = "1")}
                  style={{ opacity: 0 }}
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
          })}
          <span className="grow-[100]" />
        </div>
        <div ref={sentinel} className="h-8" />

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
          <img src={imgUrl(current.id, 640)} alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-30 blur-3xl" />

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
            className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-3 sm:px-20 md:pb-5"
            onClick={() => setOpen(null)}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={current.id}
              src={imgUrl(current.id, 2048)}
              alt=""
              onClick={(e) => e.stopPropagation()}
              className="animate-pop max-h-full max-w-full select-none rounded-lg object-contain shadow-2xl sm:rounded-xl"
              draggable={false}
            />
            {open! > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  go(-1);
                }}
                aria-label="Sebelumnya"
                className="absolute left-1.5 hidden h-12 w-12 place-items-center rounded-full bg-white/10 text-3xl text-white backdrop-blur transition hover:bg-white/25 sm:left-4 sm:grid"
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
                className="absolute right-1.5 hidden h-12 w-12 place-items-center rounded-full bg-white/10 text-3xl text-white backdrop-blur transition hover:bg-white/25 sm:right-4 sm:grid"
              >
                ›
              </button>
            )}
            <span className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs tabular-nums text-white/80 backdrop-blur md:hidden">
              {open! + 1} / {visible.length}
            </span>
          </div>
        </div>
      )}

      {current && saving && <DownloadSheet photo={current} title={dashboardTitle} onClose={() => setSaving(false)} />}
    </div>
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
