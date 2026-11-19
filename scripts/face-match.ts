/**
 * Local BIB-Guided Face Recognition Trainer & Matcher:
 *   npm run face-match [-- --workers 10 --threshold 70]
 *
 * 1. Uses BIB-tagged photos as the training set to build a Consensus Face Profile per BIB.
 * 2. Tests all photos without a detected BIB (b: []) against the BIB Face Profiles.
 * 3. Any photo with face similarity >= 70% is assigned to that BIB in public/data/index.json;
 *    photos below 70% (or with no face) remain in the undetected BIB list (b: []).
 * 4. Resumable: caches extracted face embeddings locally in .face-cache/face-embeddings.json.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { cosineSim } from "../src/lib/insightface";
import type { PhotoIndex } from "../src/lib/index-format";
import type { CompactFace } from "./face-worker";

const ROOT = path.resolve(__dirname, "..");
const INDEX_PATH = path.join(ROOT, "public/data/index.json");
const BACKUP_INDEX_PATH = path.resolve(ROOT, "../backup lsd100 before Face Recognition/public/data/index.json");
const CACHE_DIR = path.join(ROOT, ".face-cache");
const EMB_CACHE_PATH = path.join(CACHE_DIR, "face-embeddings.json");
const REPORT_PATH = path.join(CACHE_DIR, "face-match-report.json");

const MAX_TRAIN_PER_BIB = 6;
const PIPELINE_DEPTH = 6;
/** ArcFace cosine similarity where 100% confident same-person match saturates (0.75 * 0.70 = 0.525 raw cosine sim for 70%). */
const SIM_100_ANCHOR = 0.75;

function arg(name: string, def?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? "true" : def;
}

function l2Normalize(vec: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
  return out;
}

/** Converts raw ArcFace cosine similarity to calibrated percentage [0..100]. */
function simToPercent(cosSim: number): number {
  if (cosSim <= 0) return 0;
  return Math.min(100, Math.round((cosSim / SIM_100_ANCHOR) * 1000) / 10);
}

async function main() {
  const workers = Math.max(1, Number(arg("workers", String(Math.max(1, Math.min(10, os.cpus().length - 1))))));
  const thresholdPct = Number(arg("threshold", "70"));
  const minRawCosSim = (thresholdPct / 100) * SIM_100_ANCHOR; // 70% -> 0.525 raw ArcFace cosine similarity

  // Always read clean OCR baseline from backup if available so re-runs don't train on previous face guesses
  const baseSourcePath = fs.existsSync(BACKUP_INDEX_PATH) ? BACKUP_INDEX_PATH : INDEX_PATH;
  const index = JSON.parse(fs.readFileSync(baseSourcePath, "utf8")) as PhotoIndex;

  // 1) Select training photos (up to MAX_TRAIN_PER_BIB per BIB, prioritizing single-BIB photos)
  const byBibSingle = new Map<string, string[]>();
  const byBibMulti = new Map<string, string[]>();
  const allBibs = new Set<string>();
  const noBibPhotos: string[] = [];

  for (const p of index.photos) {
    if (!p.b || p.b.length === 0) {
      noBibPhotos.push(p.id);
      continue;
    }
    for (const b of p.b) allBibs.add(b);
    if (p.b.length === 1) {
      const b = p.b[0];
      let arr = byBibSingle.get(b);
      if (!arr) {
        arr = [];
        byBibSingle.set(b, arr);
      }
      arr.push(p.id);
    } else {
      for (const b of p.b) {
        let arr = byBibMulti.get(b);
        if (!arr) {
          arr = [];
          byBibMulti.set(b, arr);
        }
        arr.push(p.id);
      }
    }
  }

  const trainPhotoIds = new Set<string>();
  const bibTrainPhotos = new Map<string, { id: string; single: boolean }[]>();

  for (const b of Array.from(allBibs)) {
    const singles = (byBibSingle.get(b) ?? []).map((id) => ({ id, single: true }));
    const multis = (byBibMulti.get(b) ?? []).map((id) => ({ id, single: false }));
    const selected = [...singles, ...multis].slice(0, MAX_TRAIN_PER_BIB);
    bibTrainPhotos.set(b, selected);
    for (const item of selected) trainPhotoIds.add(item.id);
  }

  console.log(`=== KONFIGURASI FACE RECOGNITION (LOCAL) ===`);
  console.log(`• Total foto di database     : ${index.photos.length}`);
  console.log(`• Total BIB unik             : ${allBibs.size} BIB`);
  console.log(`• Foto referensi training    : ${trainPhotoIds.size} foto (maks ${MAX_TRAIN_PER_BIB} foto/BIB)`);
  console.log(`• Foto tanpa BIB (uji coba)  : ${noBibPhotos.length} foto`);
  console.log(`• Ambang kemiripan (threshold): >= ${thresholdPct}% (ArcFace cosine >= ${minRawCosSim.toFixed(3)})`);

  // 2) Load or initialize local face embedding cache
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  let embCache: Record<string, CompactFace[]> = {};
  if (fs.existsSync(EMB_CACHE_PATH)) {
    try {
      embCache = JSON.parse(fs.readFileSync(EMB_CACHE_PATH, "utf8"));
    } catch {
      embCache = {};
    }
  }

  const neededIds = [...Array.from(trainPhotoIds), ...noBibPhotos].filter((id) => embCache[id] === undefined);
  console.log(`• Sudah ada di cache lokal   : ${trainPhotoIds.size + noBibPhotos.length - neededIds.length} foto`);
  console.log(`• Akan diekstrak wajahnya    : ${neededIds.length} foto dengan ${workers} worker paralel\n`);

  const saveCache = () => {
    fs.writeFileSync(EMB_CACHE_PATH + ".tmp", JSON.stringify(embCache));
    fs.renameSync(EMB_CACHE_PATH + ".tmp", EMB_CACHE_PATH);
  };

  // 3) Run parallel face detection + ArcFace embedding extraction
  if (neededIds.length > 0) {
    const t0 = Date.now();
    let finished = 0, failed = 0, facesFound = 0;
    const queue = [...neededIds];

    await new Promise<void>((resolve) => {
      let alive = workers;
      for (let w = 0; w < workers; w++) {
        let inFlight = 0;
        const child = fork(path.join(__dirname, "face-worker.ts"), [], { execArgv: ["--import", "tsx"] });
        const feed = () => {
          while (inFlight < PIPELINE_DEPTH && queue.length > 0) {
            const id = queue.shift()!;
            inFlight++;
            child.send({ id });
          }
          if (inFlight === 0 && queue.length === 0) {
            child.kill();
            if (--alive === 0) resolve();
          }
        };
        child.on("message", (m: { type: string; id?: string; faces?: CompactFace[]; error?: string }) => {
          if (m.type === "ready") return feed();
          inFlight--;
          finished++;
          if (m.type === "done") {
            embCache[m.id!] = m.faces!;
            if (m.faces!.length > 0) facesFound++;
          } else {
            failed++;
          }
          if (finished % 150 === 0 || finished === neededIds.length) {
            const elapsed = (Date.now() - t0) / 1000;
            const rate = finished / Math.max(1, elapsed);
            const eta = Math.round((neededIds.length - finished) / rate / 60);
            console.log(`  [Ekstraksi Wajah] ${finished}/${neededIds.length} (${rate.toFixed(1)} foto/dtk, sisa ±${eta} menit, wajah ditemukan di ${facesFound} foto)`);
            saveCache();
          }
          feed();
        });
      }
    });
    saveCache();
    console.log(`Ekstraksi selesai: ${finished - failed} berhasil, ${failed} gagal.\n`);
  }

  // 4) Build Consensus Face Bank for each BIB
  type BibProfile = {
    bib: string;
    centroid: Float32Array;
    templates: Float32Array[];
    photoCount: number;
  };

  const profiles: BibProfile[] = [];

  for (const [bib, items] of Array.from(bibTrainPhotos.entries())) {
    const candidates: { emb: Float32Array; weight: number; photoId: string }[] = [];

    for (const { id, single } of items) {
      const faces = embCache[id];
      if (!faces || faces.length === 0) continue;

      if (single && faces.length === 1) {
        // High-confidence single runner + single BIB
        candidates.push({ emb: new Float32Array(faces[0].e), weight: 3.0, photoId: id });
      } else {
        // Keep primary foreground faces (r >= 0.45, score >= 0.58)
        for (const f of faces) {
          if (f.r >= 0.45 && f.s >= 0.58) {
            const centerBonus = 1 - Math.min(0.5, Math.abs(f.cx - 0.5));
            const w = (single ? 1.5 : 1.0) * f.r * centerBonus;
            candidates.push({ emb: new Float32Array(f.e), weight: w, photoId: id });
          }
        }
      }
    }

    if (candidates.length === 0) continue;

    // Find consensus medoid (face that agrees best with faces from OTHER photos of this BIB)
    let bestMedoid = candidates[0];
    let bestScore = -Infinity;

    for (const c1 of candidates) {
      let score = c1.weight * 0.25;
      for (const c2 of candidates) {
        if (c1.photoId === c2.photoId) continue;
        const sim = cosineSim(c1.emb, c2.emb);
        if (sim > 0.35) score += sim * c2.weight;
      }
      if (score > bestScore) {
        bestScore = score;
        bestMedoid = c1;
      }
    }

    // Filter inliers that match the consensus medoid (eliminates bystanders in multi-person training photos)
    const inliers = candidates.filter((c) => c === bestMedoid || cosineSim(c.emb, bestMedoid.emb) >= 0.42);
    const sum = new Float32Array(512);
    for (const c of inliers) {
      for (let i = 0; i < 512; i++) sum[i] += c.emb[i] * c.weight;
    }
    const centroid = l2Normalize(sum);

    profiles.push({
      bib,
      centroid,
      templates: inliers.map((c) => c.emb),
      photoCount: new Set(inliers.map((c) => c.photoId)).size,
    });
  }

  console.log(`• Profil Wajah BIB terbentuk : ${profiles.length} dari ${allBibs.size} BIB memiliki referensi wajah valid.`);

  // 5) Test all 14,712 undetected-BIB photos against the BIB Face Bank
  const byId = new Map(index.photos.map((p) => [p.id, p]));
  let matchedPhotos = 0;
  let noFaceInProbe = 0;
  let belowThreshold = 0;
  const sampleMatches: { photoId: string; bib: string; similarityPct: number; rawCosSim: number }[] = [];

  for (const id of noBibPhotos) {
    const p = byId.get(id);
    if (!p) continue;
    const faces = embCache[id];
    if (!faces || faces.length === 0) {
      noFaceInProbe++;
      p.b = [];
      continue;
    }

    const matchedBibs = new Set<string>();

    for (const f of faces) {
      if (f.r < 0.35 || f.s < 0.58) continue;

      let top1Bib = "";
      let top1Sim = -1;
      let top2Sim = -1;

      for (const prof of profiles) {
        const cSim = cosineSim(f.e, prof.centroid);
        if (cSim < minRawCosSim - 0.12) continue; // fast prune

        let maxT = cSim;
        for (const t of prof.templates) {
          const ts = cosineSim(f.e, t);
          if (ts > maxT) maxT = ts;
        }
        // Combined similarity: 45% centroid + 55% best angle template
        const combined = 0.45 * cSim + 0.55 * maxT;

        if (combined > top1Sim) {
          top2Sim = top1Sim;
          top1Sim = combined;
          top1Bib = prof.bib;
        } else if (combined > top2Sim) {
          top2Sim = combined;
        }
      }

      const simPct = simToPercent(top1Sim);
      // Accept if similarity >= thresholdPct (70%) and unambiguous margin over 2nd best BIB
      if (simPct >= thresholdPct && top1Sim - top2Sim >= 0.03) {
        matchedBibs.add(top1Bib);
        if (sampleMatches.length < 50) {
          sampleMatches.push({
            photoId: id,
            bib: top1Bib,
            similarityPct: simPct,
            rawCosSim: Number(top1Sim.toFixed(4)),
          });
        }
      }
    }

    if (matchedBibs.size > 0) {
      p.b = Array.from(matchedBibs);
      matchedPhotos++;
    } else {
      p.b = [];
      belowThreshold++;
    }
  }

  // 6) Save updated index.json and report
  index.generatedAt = new Date().toISOString();
  fs.writeFileSync(INDEX_PATH + ".tmp", JSON.stringify(index));
  fs.renameSync(INDEX_PATH + ".tmp", INDEX_PATH);

  const finalWithBib = index.photos.filter((p) => p.b && p.b.length > 0).length;
  const finalNoBib = index.photos.length - finalWithBib;

  const report = {
    completedAt: new Date().toISOString(),
    thresholdPct,
    minRawCosSim,
    totalPhotos: index.photos.length,
    beforeFaceRecognition: {
      withBib: index.photos.length - noBibPhotos.length,
      noBib: noBibPhotos.length,
      pctWithBib: (((index.photos.length - noBibPhotos.length) / index.photos.length) * 100).toFixed(2) + "%",
    },
    trainingStats: {
      totalUniqueBibs: allBibs.size,
      bibsWithFaceProfile: profiles.length,
      trainingPhotosScanned: trainPhotoIds.size,
    },
    probeStats: {
      totalTested: noBibPhotos.length,
      matchedAtOrAboveThreshold: matchedPhotos,
      noFaceDetectedInPhoto: noFaceInProbe,
      faceDetectedButBelowThreshold: belowThreshold,
    },
    afterFaceRecognition: {
      withBib: finalWithBib,
      noBib: finalNoBib,
      pctWithBib: ((finalWithBib / index.photos.length) * 100).toFixed(2) + "%",
      pctNoBib: ((finalNoBib / index.photos.length) * 100).toFixed(2) + "%",
    },
    sampleMatches,
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log(`\n=== HASIL AKHIR FACE RECOGNITION (>= ${thresholdPct}%) ===`);
  console.log(`• Foto tanpa BIB yang diuji         : ${noBibPhotos.length} foto`);
  console.log(`• Berhasil dikenali wajahnya (>=${thresholdPct}%): ${matchedPhotos} foto -> dimasukkan ke BIB terkait`);
  console.log(`• Tetap tidak dikenali (<${thresholdPct}%/no face): ${noBibPhotos.length - matchedPhotos} foto -> tetap di list tanpa BIB`);
  console.log(`• Total foto ber-BIB sekarang       : ${finalWithBib} / ${index.photos.length} (${report.afterFaceRecognition.pctWithBib})`);
  console.log(`• Total foto tanpa BIB sekarang     : ${finalNoBib} / ${index.photos.length} (${report.afterFaceRecognition.pctNoBib})`);
  console.log(`• Laporan lengkap tersimpan di      : ${REPORT_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
