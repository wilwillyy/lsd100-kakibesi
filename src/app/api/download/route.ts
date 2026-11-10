import { NextRequest, NextResponse } from "next/server";
import { originalUrl } from "@/lib/index-format";

export const dynamic = "force-dynamic";

/** Streams the full-quality original with a friendly file name (Content-Disposition: attachment). */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const rawName = req.nextUrl.searchParams.get("name") ?? "foto.jpg";
  if (!/^(d:)?[A-Za-z0-9_-]{10,}$/.test(id)) return new NextResponse("bad id", { status: 400 });

  const name = rawName.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "foto.jpg";
  const res = await fetch(originalUrl(id), {
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" },
  });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !res.body || !type.startsWith("image/")) {
    return new NextResponse("original tidak tersedia", { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Content-Disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    "Cache-Control": "private, max-age=3600",
  };
  const len = res.headers.get("content-length");
  if (len) headers["Content-Length"] = len;
  return new NextResponse(res.body, { headers });
}
