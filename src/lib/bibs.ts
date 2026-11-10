import type { PpOcr, Img } from "./ppocr";

/** BIB numbers have exactly this many digits in this event. */
export const BIB_DIGITS = 4;

/**
 * Accepts a recognition only if it really looks like a bib number:
 *  - the unrestricted reading is purely 4 digits (so "LSD100" on the shirt is rejected), or
 *  - the digits-only reading agrees with the unrestricted one in ≥3 of 4 positions (O↔0, I↔1, …).
 */
export function acceptBib(all: string, digits: string): string | null {
  const a = all.replace(/\s/g, "");
  const d = digits.replace(/\s/g, "");
  if (d.length !== BIB_DIGITS) return null;
  if (a === d) return d;
  if (a.length === BIB_DIGITS) {
    let same = 0;
    for (let i = 0; i < BIB_DIGITS; i++) if (a[i] === d[i]) same++;
    if (same >= 3) return d;
  }
  return null;
}

/** Reads all 4-digit BIB numbers in one decoded photo (several runners per photo are supported). */
export async function readBibsFromImg(engine: PpOcr, img: Img, maxSide = 1280): Promise<string[]> {
  const boxes = await engine.detect(img, maxSide);
  const bibs = new Set<string>();
  for (const b of boxes) {
    if (b.w < 12 || b.h < 8) continue; // skip slivers
    const r = await engine.recognize(img, b);
    const bib = acceptBib(r.all, r.digits);
    if (bib) bibs.add(bib);
  }
  return Array.from(bibs);
}
