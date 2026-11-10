import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ALLOWED_START = /^https:\/\/(photos\.app\.goo\.gl|photos\.google\.com|goo\.gl\/photos)\//;

/**
 * Reads a PUBLIC shared Google Photos album link (no login) and returns its photos.
 * Note: this parses the public share page (unofficial; Google may change its format).
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url")?.trim() ?? "";
  if (!ALLOWED_START.test(url)) {
    return NextResponse.json({ error: "Link harus berupa link album Google Photos (photos.app.goo.gl/...)" }, { status: 400 });
  }

  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" },
  });
  // After redirects the album must live on photos.google.com (SSRF guard).
  if (!res.ok || new URL(res.url).hostname !== "photos.google.com") {
    return NextResponse.json({ error: "Album tidak bisa dibuka. Pastikan album dibagikan ke 'siapa saja yang punya link'." }, { status: 404 });
  }
  const html = await res.text();

  const title = html.match(/<title>([^<]*)<\/title>/)?.[1]?.replace(/\s*-\s*Google Photos\s*$/, "").trim() ?? "Album";
  const re = /\["(https:\/\/lh3\.googleusercontent\.com\/pw\/[A-Za-z0-9_-]+)",(\d+),(\d+)/g;
  const seen = new Set<string>();
  const items: { id: string; w: number; h: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    items.push({ id: m[1], w: +m[2], h: +m[3] });
  }

  if (!items.length) {
    return NextResponse.json({ error: "Tidak ada foto ditemukan di album ini." }, { status: 404 });
  }
  return NextResponse.json({ title, items });
}
