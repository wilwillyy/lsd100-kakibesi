/**
 * Offline indexer:  npm run index [-- --workers 4 --limit 100 --force]
 *
 * Reads every source in src/lib/sources.ts (Google Photos album / Google Drive folder), runs OCR ONCE
 * per photo (in parallel processes) and writes public/data/index.json. The website then only does an
 * instant lookup, so it scales to tens of thousands of photos. Resumable: re-running only processes
 * new / failed photos.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { fetchAlbum } from "../src/lib/album";
import { fetchDriveFolder } from "../src/lib/drive";
import { EVENT_TITLE, SOURCES } from "../src/lib/sources";
import { PHOTO_PREFIX, type IndexedPhoto, type PhotoIndex, type SourceInfo } from "../src/lib/index-format";

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "public/data/index.json");

function arg(name: string, def?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? "true" : def;
}

async function main() {
  const workers = Math.max(1, Number(arg("workers", String(Math.max(1, Math.min(4, os.cpus().length - 1))))));
  const limit = Number(arg("limit", "0"));
  const force = process.argv.includes("--force");

  // 1) Collect photo lists from all sources
  const sources: SourceInfo[] = [];
  const listed: IndexedPhoto[] = [];
  const seen = new Set<string>();
  for (let si = 0; si < SOURCES.length; si++) {
    const src = SOURCES[si];
    console.log(`Membaca ${src.type === "drive" ? "folder Drive" : "album Photos"}: ${src.url}`);
    let title: string;
    let items: IndexedPhoto[];
    if (src.type === "photos") {
      const album = await fetchAlbum(src.url);
      title = album.title;
      items = album.items.map((p) => ({ id: p.id.replace(PHOTO_PREFIX, ""), w: p.w, h: p.h, s: si }));
    } else {
      const folder = await fetchDriveFolder(src.url);
      title = folder.title;
      // Drive listing has no dimensions; the worker fills w/h while indexing.
      items = folder.files.map((f) => ({ id: `d:${f.id}`, w: 0, h: 0, n: f.name, s: si }));
    }
    items = items.filter((p) => !seen.has(p.id) && seen.add(p.id));
    sources.push({ type: src.type, url: src.url, title, count: items.length });
    listed.push(...items);
    console.log(`  ↳ "${title}": ${items.length} foto. (Bandingkan dengan jumlah di sumbernya; kalau kurang lihat README.)`);
  }

  // 2) Resume from the previous index
  const prev = new Map<string, IndexedPhoto>();
  if (!force && fs.existsSync(OUT)) {
    const old = JSON.parse(fs.readFileSync(OUT, "utf8")) as { photos: IndexedPhoto[] };
    for (const p of old.photos) if (p.b !== undefined) prev.set(p.id, p);
  }
  const all: IndexedPhoto[] = listed.map((p) => {
    const old = prev.get(p.id);
    return old ? { ...p, w: old.w || p.w, h: old.h || p.h, b: old.b } : p;
  });
  let todo = all.filter((p) => p.b === undefined).map((p) => p.id);
  if (limit) todo = todo.slice(0, limit);
  console.log(`Total ${all.length} foto, sudah terindeks ${all.length - all.filter((p) => p.b === undefined).length}. Akan diproses: ${todo.length} dengan ${workers} worker.`);

  const byId = new Map(all.map((p) => [p.id, p]));
  const save = () => {
    const index: PhotoIndex = { version: 2, title: EVENT_TITLE, generatedAt: new Date().toISOString(), sources, photos: all };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT + ".tmp", JSON.stringify(index));
    fs.renameSync(OUT + ".tmp", OUT);
  };

  if (!todo.length) {
    save();
    console.log("Tidak ada foto baru. Index sudah terbaru.");
    return;
  }

  // 3) OCR in parallel worker processes
  const t0 = Date.now();
  let finished = 0, failed = 0, withBib = 0;
  const queue = [...todo];

  await new Promise<void>((resolve) => {
    let alive = workers;
    for (let w = 0; w < workers; w++) {
      const child = fork(path.join(__dirname, "index-worker.ts"), [], { execArgv: ["--import", "tsx"] });
      const next = () => {
        const id = queue.shift();
        if (id) child.send({ id });
        else {
          child.kill();
          if (--alive === 0) resolve();
        }
      };
      child.on("message", (m: { type: string; id?: string; bibs?: string[]; w?: number; h?: number; error?: string }) => {
        if (m.type === "ready") return next();
        finished++;
        if (m.type === "done") {
          const p = byId.get(m.id!)!;
          p.b = m.bibs!;
          if (!p.w || !p.h) {
            p.w = m.w!;
            p.h = m.h!;
          }
          if (m.bibs!.length) withBib++;
        } else {
          failed++;
          console.error(`  gagal ${m.id!.slice(-10)}: ${m.error}`);
        }
        if (finished % 25 === 0 || finished === todo.length) {
          const rate = finished / ((Date.now() - t0) / 1000);
          const eta = Math.round((todo.length - finished) / rate / 60);
          console.log(`  ${finished}/${todo.length}  (${rate.toFixed(1)} foto/dtk, sisa ±${eta} menit, BIB terdeteksi di ${withBib})`);
          save();
        }
        next();
      });
    }
  });

  save();
  console.log(`Selesai: ${finished - failed} berhasil, ${failed} gagal. Index: ${OUT}`);
  if (failed) console.log("Jalankan `npm run index` lagi untuk mencoba ulang yang gagal.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
