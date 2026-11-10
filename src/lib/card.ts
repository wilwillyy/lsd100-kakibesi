/**
 * Builds shareable "photo cards" in a <canvas>:
 *  - card:  white polaroid-style frame with event title + KAKIBESI.CLUB on the left, LSD & Kabes logos on the right (1080 wide)
 *  - story: 9:16 (1080×1920) with a blurred copy of the photo as background, Long Slow Distance header, and LSD & Kabes logos at the bottom
 */
export type CardStyle = "card" | "story";

export type CardOptions = {
  style: CardStyle;
  title: string;
  bibs: string[];
  /** same-origin image URL (so the canvas is never tainted) */
  src: string;
  /** output width in px (preview uses a smaller value) */
  width?: number;
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Gagal memuat foto"));
    img.src = src;
  });
}

let lightLogosPromise: Promise<[HTMLImageElement, HTMLImageElement]> | null = null;
let darkLogosPromise: Promise<[HTMLImageElement, HTMLImageElement]> | null = null;

function getLogos(forDarkBg: boolean): Promise<[HTMLImageElement, HTMLImageElement]> {
  if (forDarkBg) {
    if (!darkLogosPromise) {
      darkLogosPromise = Promise.all([loadImage("/logos/lsd-logo.png"), loadImage("/logos/kabes-logo.png")]).catch((e) => {
        darkLogosPromise = null;
        throw e;
      });
    }
    return darkLogosPromise;
  }
  if (!lightLogosPromise) {
    lightLogosPromise = Promise.all([loadImage("/logos/lsd-logo-dark.png"), loadImage("/logos/kabes-logo-dark.png")]).catch((e) => {
      lightLogosPromise = null;
      throw e;
    });
  }
  return lightLogosPromise;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fontFamilies(): { sans: string; display: string } {
  const rootStyle = getComputedStyle(document.documentElement);
  const sans = rootStyle.getPropertyValue("--font-sans").trim() || getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
  const display = rootStyle.getPropertyValue("--font-display").trim() || sans;
  return { sans, display };
}

async function ensureFonts(sans: string, display: string) {
  try {
    await Promise.all([
      document.fonts.load(`900 60px ${display}`),
      document.fonts.load(`italic 900 60px ${display}`),
      document.fonts.load(`800 40px ${display}`),
      document.fonts.load(`700 24px ${sans}`),
    ]);
  } catch {
    /* fall back to default fonts */
  }
}

/** draws `img` covering the rect (like object-fit: cover) */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.width, h / img.height);
  const sw = w / s, sh = h / s;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

export async function renderCard(o: CardOptions): Promise<HTMLCanvasElement> {
  const { sans, display } = fontFamilies();
  const [img, [lsdLogo, kabesLogo]] = await Promise.all([
    loadImage(o.src),
    getLogos(o.style === "story"),
    ensureFonts(sans, display),
  ]);
  const W = o.width ?? 1080;
  const k = W / 1080; // scale factor so every style works at any output size
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";

  if (o.style === "card") {
    const pad = 48 * k;
    const innerW = W - pad * 2;
    // keep portrait photos from making an absurdly tall card
    const photoH = Math.min(innerW * (img.height / img.width), innerW * 1.42);
    const footH = 168 * k;
    const H = Math.round(pad + photoH + footH);
    canvas.width = W;
    canvas.height = H;

    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#04060c");
    bg.addColorStop(0.55, "#0a0f1e");
    bg.addColorStop(1, "#1E46E6");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // white card
    const m = 26 * k;
    ctx.save();
    ctx.shadowColor = "rgba(4,6,12,0.7)";
    ctx.shadowBlur = 50 * k;
    ctx.shadowOffsetY = 20 * k;
    ctx.fillStyle = "#fff";
    roundRect(ctx, m, m, W - m * 2, H - m * 2, 36 * k);
    ctx.fill();
    ctx.restore();

    // photo
    ctx.save();
    roundRect(ctx, pad, pad, innerW, photoH, 22 * k);
    ctx.clip();
    drawCover(ctx, img, pad, pad, innerW, photoH);
    ctx.restore();

    // footer: [title + KAKIBESI.CLUB] on left ... [LSD logo] [Kabes logo] on right
    const fy = pad + photoH;
    const centerY = fy + (footH - m) / 2;
    const headerTitle = (o.title || "Long Slow Distance").toUpperCase();
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillStyle = "#04060c";
    ctx.font = `900 ${36 * k}px ${display}`;
    ctx.fillText(headerTitle, pad, centerY - 2 * k);

    ctx.fillStyle = "#1E46E6";
    ctx.font = `700 ${22 * k}px ${sans}`;
    ctx.fillText("KAKIBESI.CLUB", pad, centerY + 32 * k);

    // Draw proportional LSD logo and Kabes logo side-by-side on the right side
    const lsdH = 68 * k;
    const lsdW = lsdH * (lsdLogo.width / lsdLogo.height);
    const kabesH = 76 * k;
    const kabesW = kabesH * (kabesLogo.width / kabesLogo.height);
    const gap = 22 * k;
    const rightEdge = pad + innerW;
    const kabesX = rightEdge - kabesW;
    const lsdX = kabesX - gap - lsdW;

    ctx.drawImage(lsdLogo, lsdX, centerY - lsdH / 2, lsdW, lsdH);
    ctx.drawImage(kabesLogo, kabesX, centerY - kabesH / 2, kabesW, kabesH);
    return canvas;
  }

  // ---- story 9:16 ----
  const H = Math.round((W * 16) / 9);
  canvas.width = W;
  canvas.height = H;
  // (downscale + upscale = blur that also works in Safari, which has no ctx.filter)
  const tiny = document.createElement("canvas");
  tiny.width = 36;
  tiny.height = Math.round((36 * 16) / 9);
  const tctx = tiny.getContext("2d")!;
  tctx.imageSmoothingQuality = "high";
  drawCover(tctx, img, 0, 0, tiny.width, tiny.height);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tiny, 0, 0, W, H);
  ctx.fillStyle = "rgba(4,6,12,0.45)";
  ctx.fillRect(0, 0, W, H);
  const shade = ctx.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0, "rgba(4,6,12,0.82)");
  shade.addColorStop(0.5, "rgba(10,15,30,0.18)");
  shade.addColorStop(1, "rgba(4,6,12,0.9)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);

  // event title at top: "LONG SLOW DISTANCE"
  const storyTitle = (o.title || "Long Slow Distance").toUpperCase();
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 24 * k;
  ctx.shadowOffsetY = 6 * k;
  ctx.fillStyle = "#f4f5f7";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `900 ${58 * k}px ${display}`;
  ctx.fillText(storyTitle, W / 2, 185 * k);
  ctx.restore();

  // photo, framed
  const maxW = W - 150 * k, maxH = H - 490 * k;
  const s = Math.min(maxW / img.width, maxH / img.height);
  const pw = img.width * s, ph = img.height * s;
  const px = (W - pw) / 2, py = 245 * k + (maxH - ph) / 2;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 60 * k;
  ctx.shadowOffsetY = 24 * k;
  ctx.fillStyle = "#fff";
  roundRect(ctx, px - 14 * k, py - 14 * k, pw + 28 * k, ph + 28 * k, 34 * k);
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, px, py, pw, ph, 22 * k);
  ctx.clip();
  ctx.drawImage(img, px, py, pw, ph);
  ctx.restore();

  // Bottom logos only (BIB number removed; LSD LOGO + Kabes Logo side-by-side, proportional)
  const lsdH = 104 * k;
  const lsdW = lsdH * (lsdLogo.width / lsdLogo.height);
  const kabesH = 116 * k;
  const kabesW = kabesH * (kabesLogo.width / kabesLogo.height);
  const gap = 42 * k;
  const groupW = lsdW + gap + kabesW;
  const startX = (W - groupW) / 2;
  const logoCenterY = H - 150 * k;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 18 * k;
  ctx.drawImage(lsdLogo, startX, logoCenterY - lsdH / 2, lsdW, lsdH);
  ctx.drawImage(kabesLogo, startX + lsdW + gap, logoCenterY - kabesH / 2, kabesW, kabesH);
  ctx.restore();

  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob gagal"))), "image/jpeg", quality));
}
