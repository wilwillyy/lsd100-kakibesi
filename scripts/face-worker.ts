/**
 * Face recognition worker (one process = one InsightFace SCRFD + ArcFace engine).
 * Downloads 640px thumbnails in parallel with CPU inference and returns detected face embeddings.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import * as ort from "onnxruntime-web";
import { InsightFace } from "../src/lib/insightface";
import { isDrive, originalUrl, upstreamUrl } from "../src/lib/index-format";

const ROOT = path.resolve(__dirname, "..");
const CACHE_DIR = path.join(ROOT, ".face-cache");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36";

export type CompactFace = {
  /** Detection confidence [0..1] */
  s: number;
  /** Face area relative to the largest face in the image [0..1] */
  r: number;
  /** Horizontal center relative to image width [0..1] */
  cx: number;
  /** Vertical center relative to image height [0..1] */
  cy: number;
  /** L2-normalized 512-D ArcFace embedding */
  e: number[];
};

async function download(url: string): Promise<Buffer> {
  for (let attempt = 0; ; attempt++) {
    let status = 0;
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      status = res.status;
    } catch (e) {
      if (attempt >= 4) throw e;
    }
    if (status && status !== 429 && status < 500) throw new Error(`HTTP ${status}`);
    if (attempt >= 4) throw new Error("download failed after retries");
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
}

async function fetchAndDecode(id: string) {
  let buf: Buffer;
  try {
    buf = await download(upstreamUrl(id, 640));
  } catch {
    if (isDrive(id)) {
      try {
        buf = await download(`https://drive.google.com/thumbnail?id=${id.slice(2)}&sz=w640`);
      } catch {
        buf = await download(originalUrl(id));
      }
    } else {
      buf = await download(originalUrl(id));
    }
  }
  return sharp(buf)
    .resize({ width: 640, withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

async function main() {
  const engine = await InsightFace.create(
    ort as never,
    new Uint8Array(fs.readFileSync(path.join(CACHE_DIR, "det_500m.onnx"))),
    new Uint8Array(fs.readFileSync(path.join(CACHE_DIR, "w600k_mbf.onnx")))
  );
  process.send!({ type: "ready" });

  let chain = Promise.resolve();

  process.on("message", (msg: { id: string }) => {
    const decodedPromise = fetchAndDecode(msg.id).then(
      (res) => ({ ok: true as const, res }),
      (err) => ({ ok: false as const, err })
    );

    chain = chain.then(async () => {
      try {
        const outcome = await decodedPromise;
        if (!outcome.ok) throw outcome.err;
        const { data, info } = outcome.res;
        const rawFaces = await engine.extractFaces({ data, width: info.width, height: info.height }, 480, 0.55);

        let maxArea = 0;
        for (const f of rawFaces) {
          const area = (f.x2 - f.x1) * (f.y2 - f.y1);
          if (area > maxArea) maxArea = area;
        }

        // Keep up to 4 most prominent faces per photo
        const sorted = rawFaces
          .map((f) => {
            const area = (f.x2 - f.x1) * (f.y2 - f.y1);
            return { f, area, r: maxArea > 0 ? area / maxArea : 1 };
          })
          .filter((x) => x.r >= 0.25)
          .sort((a, b) => b.area - a.area)
          .slice(0, 4);

        const faces: CompactFace[] = sorted.map(({ f, r }) => ({
          s: Number(f.score.toFixed(3)),
          r: Number(r.toFixed(3)),
          cx: Number((((f.x1 + f.x2) * 0.5) / info.width).toFixed(3)),
          cy: Number((((f.y1 + f.y2) * 0.5) / info.height).toFixed(3)),
          e: Array.from(f.embedding, (v) => Number(v.toFixed(4))),
        }));

        process.send!({ type: "done", id: msg.id, faces });
      } catch (e) {
        process.send!({ type: "error", id: msg.id, error: String((e as Error).message ?? e) });
      }
    });
  });
}

main();
