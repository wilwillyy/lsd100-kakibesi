/**
 * Pure TypeScript InsightFace pipeline (SCRFD det_500m.onnx + ArcFace w600k_mbf.onnx) on top of onnxruntime.
 * Performs 5-landmark detection, NMS, 2D similarity-transform face alignment (112x112), and L2-normalized 512-D embeddings.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Img, Ort } from "./ppocr";

export type FaceBox = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  score: number;
  /** 5 facial landmarks: [x0, y0, x1, y1, x2, y2, x3, y3, x4, y4] */
  kps: number[];
};

export type DetectedFace = FaceBox & {
  embedding: Float32Array;
};

/** Standard InsightFace ArcFace 112x112 target landmarks. */
const ARCFACE_DST: [number, number][] = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

export class InsightFace {
  private constructor(
    private ort: Ort,
    private det: any,
    private rec: any
  ) {}

  static async create(ort: Ort, detModel: Uint8Array, recModel: Uint8Array, opts: any = { logSeverityLevel: 3 }): Promise<InsightFace> {
    const sessionOpts = { logSeverityLevel: 3, ...opts };
    const det = await ort.InferenceSession.create(detModel, sessionOpts);
    const rec = await ort.InferenceSession.create(recModel, sessionOpts);
    return new InsightFace(ort, det, rec);
  }

  /** Detects faces with 5 landmarks using SCRFD (det_500m.onnx). */
  async detect(img: Img, inputSize = 640, scoreThresh = 0.5, nmsThresh = 0.4): Promise<FaceBox[]> {
    // Letterbox resize keeping aspect ratio into inputSize x inputSize
    const ratio = Math.min(inputSize / img.width, inputSize / img.height);
    const newW = Math.round(img.width * ratio);
    const newH = Math.round(img.height * ratio);

    const input = new Float32Array(3 * inputSize * inputSize);
    // Fill padded region with -127.5 / 128.0 (i.e. pixel 0)
    const padVal = -127.5 / 128.0;
    input.fill(padVal);

    const kx = img.width / newW;
    const ky = img.height / newH;
    const plane = inputSize * inputSize;

    for (let y = 0; y < newH; y++) {
      const fy = Math.min(img.height - 1, Math.max(0, (y + 0.5) * ky - 0.5));
      const y0 = Math.floor(fy), y1 = Math.min(img.height - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < newW; x++) {
        const fx = Math.min(img.width - 1, Math.max(0, (x + 0.5) * kx - 0.5));
        const x0 = Math.floor(fx), x1 = Math.min(img.width - 1, x0 + 1), tx = fx - x0;
        const i00 = (y0 * img.width + x0) * 4, i10 = (y0 * img.width + x1) * 4;
        const i01 = (y1 * img.width + x0) * 4, i11 = (y1 * img.width + x1) * 4;
        const idx = y * inputSize + x;
        for (let c = 0; c < 3; c++) {
          const v =
            img.data[i00 + c] * (1 - tx) * (1 - ty) +
            img.data[i10 + c] * tx * (1 - ty) +
            img.data[i01 + c] * (1 - tx) * ty +
            img.data[i11 + c] * tx * ty;
          input[c * plane + idx] = (v - 127.5) / 128.0;
        }
      }
    }

    const out = await this.det.run({
      [this.det.inputNames[0]]: new this.ort.Tensor("float32", input, [1, 3, inputSize, inputSize]),
    });

    const strides = [8, 16, 32];
    const scoreKeys = ["443", "468", "493"];
    const bboxKeys = ["446", "471", "496"];
    const kpsKeys = ["449", "474", "499"];

    const proposals: FaceBox[] = [];

    for (let si = 0; si < strides.length; si++) {
      const stride = strides[si];
      const scores = out[scoreKeys[si]].data as Float32Array;
      const bboxes = out[bboxKeys[si]].data as Float32Array;
      const kps = out[kpsKeys[si]].data as Float32Array;
      const gridH = inputSize / stride;
      const gridW = inputSize / stride;

      let idx = 0;
      for (let gy = 0; gy < gridH; gy++) {
        for (let gx = 0; gx < gridW; gx++) {
          const cx = gx * stride;
          const cy = gy * stride;
          for (let a = 0; a < 2; a++, idx++) {
            const score = scores[idx];
            if (score < scoreThresh) continue;

            const bOff = idx * 4;
            const x1 = Math.max(0, (cx - bboxes[bOff] * stride) / ratio);
            const y1 = Math.max(0, (cy - bboxes[bOff + 1] * stride) / ratio);
            const x2 = Math.min(img.width, (cx + bboxes[bOff + 2] * stride) / ratio);
            const y2 = Math.min(img.height, (cy + bboxes[bOff + 3] * stride) / ratio);
            if (x2 - x1 < 14 || y2 - y1 < 14) continue;

            const kOff = idx * 10;
            const lm: number[] = new Array(10);
            for (let k = 0; k < 5; k++) {
              lm[2 * k] = (cx + kps[kOff + 2 * k] * stride) / ratio;
              lm[2 * k + 1] = (cy + kps[kOff + 2 * k + 1] * stride) / ratio;
            }
            proposals.push({ x1, y1, x2, y2, score, kps: lm });
          }
        }
      }
    }

    proposals.sort((a, b) => b.score - a.score);
    const keep: FaceBox[] = [];
    for (const p of proposals) {
      let overlap = false;
      for (const k of keep) {
        if (iou(p, k) > nmsThresh) {
          overlap = true;
          break;
        }
      }
      if (!overlap) keep.push(p);
    }
    return keep;
  }

  /** Aligns face via 5-point similarity transform to 112x112 and extracts L2-normalized 512-D ArcFace embedding. */
  async embed(img: Img, face: FaceBox): Promise<Float32Array> {
    const aligned = alignFace112(img, face.kps);
    const out = await this.rec.run({
      [this.rec.inputNames[0]]: new this.ort.Tensor("float32", aligned, [1, 3, 112, 112]),
    });
    const raw = out[this.rec.outputNames[0]].data as Float32Array;
    const vec = new Float32Array(512);
    let norm = 0;
    for (let i = 0; i < 512; i++) norm += raw[i] * raw[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < 512; i++) vec[i] = raw[i] / norm;
    return vec;
  }

  /** Detects and embeds all faces in an image. */
  async extractFaces(img: Img, inputSize = 640, scoreThresh = 0.55): Promise<DetectedFace[]> {
    const boxes = await this.detect(img, inputSize, scoreThresh);
    const results: DetectedFace[] = [];
    for (const b of boxes) {
      const embedding = await this.embed(img, b);
      results.push({ ...b, embedding });
    }
    return results;
  }
}

function iou(a: FaceBox, b: FaceBox): number {
  const ix1 = Math.max(a.x1, b.x1);
  const iy1 = Math.max(a.y1, b.y1);
  const ix2 = Math.min(a.x2, b.x2);
  const iy2 = Math.min(a.y2, b.y2);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  if (inter <= 0) return 0;
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
  return inter / (areaA + areaB - inter);
}

/**
 * Computes least-squares 2D similarity transform mapping ARCFACE_DST (u, v) -> image (x, y):
 *   x = a * u - b * v + tx
 *   y = b * u + a * v + ty
 * and samples 112x112 RGB CHW normalized by (v - 127.5) / 127.5.
 */
function alignFace112(img: Img, kps: number[]): Float32Array {
  let uMean = 0, vMean = 0, xMean = 0, yMean = 0;
  for (let i = 0; i < 5; i++) {
    uMean += ARCFACE_DST[i][0];
    vMean += ARCFACE_DST[i][1];
    xMean += kps[2 * i];
    yMean += kps[2 * i + 1];
  }
  uMean /= 5;
  vMean /= 5;
  xMean /= 5;
  yMean /= 5;

  let denom = 0, numA = 0, numB = 0;
  for (let i = 0; i < 5; i++) {
    const du = ARCFACE_DST[i][0] - uMean;
    const dv = ARCFACE_DST[i][1] - vMean;
    const dx = kps[2 * i] - xMean;
    const dy = kps[2 * i + 1] - yMean;
    denom += du * du + dv * dv;
    numA += du * dx + dv * dy;
    numB += du * dy - dv * dx;
  }
  const a = denom > 1e-6 ? numA / denom : 1;
  const b = denom > 1e-6 ? numB / denom : 0;
  const tx = xMean - (a * uMean - b * vMean);
  const ty = yMean - (b * uMean + a * vMean);

  const S = 112;
  const plane = S * S;
  const out = new Float32Array(3 * plane);

  for (let v = 0; v < S; v++) {
    for (let u = 0; u < S; u++) {
      const fx = Math.min(img.width - 1, Math.max(0, a * u - b * v + tx));
      const fy = Math.min(img.height - 1, Math.max(0, b * u + a * v + ty));
      const x0 = Math.floor(fx), x1 = Math.min(img.width - 1, x0 + 1), wx = fx - x0;
      const y0 = Math.floor(fy), y1 = Math.min(img.height - 1, y0 + 1), wy = fy - y0;
      const i00 = (y0 * img.width + x0) * 4, i10 = (y0 * img.width + x1) * 4;
      const i01 = (y1 * img.width + x0) * 4, i11 = (y1 * img.width + x1) * 4;
      const idx = v * S + u;
      for (let c = 0; c < 3; c++) {
        const val =
          img.data[i00 + c] * (1 - wx) * (1 - wy) +
          img.data[i10 + c] * wx * (1 - wy) +
          img.data[i01 + c] * (1 - wx) * wy +
          img.data[i11 + c] * wx * wy;
        out[c * plane + idx] = (val - 127.5) / 127.5;
      }
    }
  }
  return out;
}

/** Cosine similarity in [-1, 1] between two L2-normalized 512-D embeddings. */
export function cosineSim(a: Float32Array | number[], b: Float32Array | number[]): number {
  let dot = 0;
  for (let i = 0; i < 512; i++) dot += a[i] * b[i];
  return dot;
}
