import { NextRequest, NextResponse } from "next/server";
import { DRIVE_IMG_PREFIX, PHOTO_PREFIX, isDrive, originalUrl } from "@/lib/index-format";

export const dynamic = "force-dynamic";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36";

function isImageOrBinary(res: Response): boolean {
  if (!res.ok || !res.body) return false;
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  return ct.startsWith("image/") || ct.includes("octet-stream");
}

/** Streams the full-quality original with a friendly file name (Content-Disposition: attachment). */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const rawName = req.nextUrl.searchParams.get("name") ?? "foto.jpg";
  if (!/^(d:)?[A-Za-z0-9_-]{10,}$/.test(id)) return new NextResponse("bad id", { status: 400 });

  const name = rawName.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "foto.jpg";

  const candidates = isDrive(id)
    ? [
        `${DRIVE_IMG_PREFIX}${id.slice(2)}=d`,
        originalUrl(id),
        `https://drive.google.com/thumbnail?id=${id.slice(2)}&sz=w2400`,
      ]
    : [`${PHOTO_PREFIX}${id}=d`, `${PHOTO_PREFIX}${id}=w2400`];

  let res: Response | null = null;
  for (const url of candidates) {
    try {
      const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": UA } });
      if (isImageOrBinary(r)) {
        res = r;
        break;
      }
    } catch {
      // try next candidate
    }
  }

  if (!res || !res.body) {
    return new NextResponse("original tidak tersedia", { status: 502, headers: { "Cache-Control": "no-store" } });
  }

  const rawType = res.headers.get("content-type") ?? "";
  const type = rawType.startsWith("image/") ? rawType : "image/jpeg";
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Content-Disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    "Cache-Control": "private, max-age=3600",
  };
  const len = res.headers.get("content-length");
  if (len) headers["Content-Length"] = len;
  return new NextResponse(res.body, { headers });
}
