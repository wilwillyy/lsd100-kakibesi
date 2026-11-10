import { NextRequest, NextResponse } from "next/server";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36";

/** Public image proxy. Responses are cached by Vercel CDN for a year (one upstream hit per photo/size). */
export async function GET(req: NextRequest) {
  const base = req.nextUrl.searchParams.get("u") ?? "";
  const w = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("w") ?? "640", 10) || 640, 100), 2400);
  if (!/^https:\/\/lh3\.googleusercontent\.com\/(pw|d)\/[A-Za-z0-9_-]+$/.test(base)) {
    return new NextResponse("bad url", { status: 400 });
  }

  let res = await fetch(`${base}=w${w}`, { headers: { "User-Agent": UA } });

  // Fallback for Google Drive files if lh3 returns 403/404/429
  if (!res.ok && base.includes("/d/")) {
    const driveId = base.split("/d/")[1];
    res = await fetch(`https://drive.google.com/thumbnail?id=${driveId}&sz=w${w}`, {
      headers: { "User-Agent": UA },
      redirect: "follow",
    });
    if (!res.ok) {
      res = await fetch(`https://drive.usercontent.google.com/download?id=${driveId}&export=download&confirm=t`, {
        headers: { "User-Agent": UA },
        redirect: "follow",
      });
    }
  }

  if (!res.ok || !res.body) {
    return new NextResponse("upstream error", {
      status: res.status === 429 ? 503 : res.status,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return new NextResponse(res.body, {
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "image/jpeg",
      "Cache-Control": "public, max-age=31536000, s-maxage=31536000, stale-while-revalidate=86400, immutable",
    },
  });
}
