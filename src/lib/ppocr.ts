/**
 * Minimal PP-OCRv4 (PaddleOCR) pipeline on top of onnxruntime (node or web):
 *   DBNet text detection → crop each text box → CRNN recognition (CTC), digits only.
 * Pure TS, no OpenCV. `ort` is injected so the same code runs in Node and in the browser.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Img = { data: Uint8ClampedArray | Uint8Array; width: number; height: number };
export type Ort = { InferenceSession: any; Tensor: any };
export type TextBox = { x: number; y: number; w: number; h: number; score: number };
export type Reading = { text: string; prob: number; box: TextBox };

export class PpOcr {
  private constructor(
    private ort: Ort,
    private det: any,
    private rec: any,
    private digitIdx: number[],
    private chars: string[]
  ) {}

  /** `dict` = lines of ppocr_keys_v1.txt. Class index 0 = CTC blank, i → dict[i-1]. */
  static async create(ort: Ort, detModel: any, recModel: any, dict: string[], opts: any = {}): Promise<PpOcr> {
    const det = await ort.InferenceSession.create(detModel, opts);
    const rec = await ort.InferenceSession.create(recModel, opts);
    const chars = ["", ...dict, " "];
    const digitIdx: number[] = [0];
    chars.forEach((c, i) => {
      if (/^[0-9]$/.test(c)) digitIdx.push(i);
    });
    return new PpOcr(ort, det, rec, digitIdx, chars);
  }

  /** Detects text regions. `maxSide` = longest side fed to the detector. */
  async detect(img: Img, maxSide = 1280, thresh = 0.3): Promise<TextBox[]> {
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.max(32, Math.round((img.width * scale) / 32) * 32);
    const h = Math.max(32, Math.round((img.height * scale) / 32) * 32);
    const input = resizeToCHW(img, 0, 0, img.width, img.height, w, h, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225], true);
    const out = await this.det.run({ [this.det.inputNames[0]]: new this.ort.Tensor("float32", input, [1, 3, h, w]) });
    const prob = out[this.det.outputNames[0]].data as Float32Array;

    // Connected components on thresholded prob map
    const label = new Int32Array(w * h);
    const stack: number[] = [];
    const boxes: TextBox[] = [];
    const sx = img.width / w, sy = img.height / h;
    let id = 0;
    for (let s = 0; s < w * h; s++) {
      if (prob[s] <= thresh || label[s]) continue;
      id++;
      let x0 = w, y0 = h, x1 = 0, y1 = 0, n = 0, sum = 0;
      stack.push(s);
      label[s] = id;
      while (stack.length) {
        const p = stack.pop()!;
        const px = p % w, py = (p / w) | 0;
        n++;
        sum += prob[p];
        if (px < x0) x0 = px;
        if (px > x1) x1 = px;
        if (py < y0) y0 = py;
        if (py > y1) y1 = py;
        if (px > 0 && prob[p - 1] > thresh && !label[p - 1]) { label[p - 1] = id; stack.push(p - 1); };
        if (px < w - 1 && prob[p + 1] > thresh && !label[p + 1]) { label[p + 1] = id; stack.push(p + 1); };
        if (py > 0 && prob[p - w] > thresh && !label[p - w]) { label[p - w] = id; stack.push(p - w); };
        if (py < h - 1 && prob[p + w] > thresh && !label[p + w]) { label[p + w] = id; stack.push(p + w); };
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      if (n < 12 || Math.min(bw, bh) < 3) continue;
      const score = sum / n;
      if (score < 0.5) continue;
      // DB "unclip": the probability map is shrunk, grow the box back (ratio 1.5)
      const d = (n * 1.5) / (2 * (bw + bh)) ;
      const ex0 = Math.max(0, x0 - d), ey0 = Math.max(0, y0 - d);
      const ex1 = Math.min(w, x1 + 1 + d), ey1 = Math.min(h, y1 + 1 + d);
      boxes.push({ x: ex0 * sx, y: ey0 * sy, w: (ex1 - ex0) * sx, h: (ey1 - ey0) * sy, score });
    }
    return boxes;
  }

  /** Recognizes one text box. Returns raw (all chars) and digits-only decodings. */
  async recognize(img: Img, box: TextBox): Promise<{ all: string; digits: string; probDigits: number }> {
    const H = 48;
    const ratio = box.w / Math.max(1, box.h);
    const W = Math.min(640, Math.max(16, Math.ceil(H * ratio)));
    const input = resizeToCHW(img, box.x, box.y, box.w, box.h, W, H, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5], true);
    const out = await this.rec.run({ [this.rec.inputNames[0]]: new this.ort.Tensor("float32", input, [1, 3, H, W]) });
    const t = out[this.rec.outputNames[0]];
    const [, T, C] = t.dims as number[];
    const data = t.data as Float32Array;

    const decode = (allowed: number[] | null) => {
      let text = "", last = -1, psum = 0, pn = 0;
      for (let ti = 0; ti < T; ti++) {
        const row = ti * C;
        let best = 0, bv = -Infinity;
        if (allowed) for (const i of allowed) { if (data[row + i] > bv) { bv = data[row + i]; best = i; }; }
        else for (let i = 0; i < C; i++) { if (data[row + i] > bv) { bv = data[row + i]; best = i; }; }
        if (best !== 0 && best !== last) {
          text += this.chars[best] ?? "";
          // softmax prob over the allowed set
          let z = 0;
          if (allowed) for (const i of allowed) z += Math.exp(data[row + i] - bv);
          else for (let i = 0; i < C; i++) z += Math.exp(data[row + i] - bv);
          psum += 1 / z;
          pn++;
        }
        last = best;
      }
      return { text, prob: pn ? psum / pn : 0 };
    };
    const all = decode(null);
    const dg = decode(this.digitIdx);
    return { all: all.text, digits: dg.text, probDigits: dg.prob };
  }
}

/** Crop + bilinear resize to CHW float, per-channel normalize. `bgr` follows PaddleOCR (OpenCV) channel order. */
function resizeToCHW(
  img: Img, cx: number, cy: number, cw: number, ch: number, W: number, H: number,
  mean: number[], std: number[], bgr: boolean
): Float32Array {
  const out = new Float32Array(3 * W * H);
  const kx = cw / W, ky = ch / H;
  const order = bgr ? [2, 1, 0] : [0, 1, 2];
  for (let y = 0; y < H; y++) {
    const fy = Math.min(img.height - 1, Math.max(0, cy + (y + 0.5) * ky - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(img.height - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(img.width - 1, Math.max(0, cx + (x + 0.5) * kx - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(img.width - 1, x0 + 1), tx = fx - x0;
      const i00 = (y0 * img.width + x0) * 4, i10 = (y0 * img.width + x1) * 4;
      const i01 = (y1 * img.width + x0) * 4, i11 = (y1 * img.width + x1) * 4;
      for (let c = 0; c < 3; c++) {
        const k = order[c];
        const v =
          img.data[i00 + k] * (1 - tx) * (1 - ty) + img.data[i10 + k] * tx * (1 - ty) +
          img.data[i01 + k] * (1 - tx) * ty + img.data[i11 + k] * tx * ty;
        out[c * W * H + y * W + x] = (v / 255 - mean[c]) / std[c];
      }
    }
  }
  return out;
}
