/**
 * Indexer worker (one process = one OCR engine). Receives photo jobs from scripts/index.ts,
 * prefetches/decodes images in parallel with network I/O, and runs PP-OCR sequentially per worker.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import * as ort from "onnxruntime-web";
import { PpOcr } from "../src/lib/ppocr";
import { readBibsFromImg } from "../src/lib/bibs";
import { originalUrl, upstreamUrl } from "../src/lib/index-format";

const ROOT = path.resolve(__dirname, "..");
const MODELS = path.join(ROOT, "public/models");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36";

async function download(url: string): Promise<Buffer> {
  for (let attempt = 0; ; attempt++) {
    let status = 0;
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      status = res.status;
    } catch (e) {
      if (attempt >= 6) throw e;
    }
    if (status && status !== 429 && status < 500) throw new Error(`HTTP ${status}`);
    if (attempt >= 6) throw new Error("download failed after retries");
    await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt)); // back off on 429 / 5xx
  }
}

async function fetchAndDecode(id: string) {
  let buf: Buffer;
  try {
    buf = await download(upstreamUrl(id, 1280));
  } catch {
    buf = await download(originalUrl(id));
  }
  return sharp(buf)
    .resize({ width: 1280, withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

async function main() {
  const dict = fs.readFileSync(path.join(MODELS, "keys.txt"), "utf8").split("\n").map((s) => s.replace(/\r$/, ""));
  const engine = await PpOcr.create(
    ort as never,
    new Uint8Array(fs.readFileSync(path.join(MODELS, "det.onnx"))),
    new Uint8Array(fs.readFileSync(path.join(MODELS, "rec.onnx"))),
    dict
  );
  process.send!({ type: "ready" });

  let ocrChain = Promise.resolve();

  process.on("message", (msg: { id: string }) => {
    // Start network download + sharp decode immediately so I/O overlaps with current OCR
    const decodedPromise = fetchAndDecode(msg.id);

    ocrChain = ocrChain.then(async () => {
      try {
        const { data, info } = await decodedPromise;
        const bibs = await readBibsFromImg(engine, { data, width: info.width, height: info.height });
        process.send!({ type: "done", id: msg.id, bibs, w: info.width, h: info.height });
      } catch (e) {
        process.send!({ type: "error", id: msg.id, error: String((e as Error).message ?? e) });
      }
    });
  });
}

main();
