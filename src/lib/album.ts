export type Photo = { id: string; w: number; h: number };
export type Album = { title: string; items: Photo[] };

/** Fixed album shown by the site. Can be overridden with the ALBUM_URL env var. */
export const ALBUM_URL = process.env.ALBUM_URL || "https://photos.app.goo.gl/gyFmdprLbJWH1M4B6";

/**
 * Reads a PUBLIC shared Google Photos album (no login) by parsing its share page.
 * Unofficial: Google may change the page format.
 */
export async function fetchAlbum(url: string = ALBUM_URL): Promise<Album> {
  const res = await fetch(url, {
    redirect: "follow",
    next: { revalidate: 300 },
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" },
  });
  if (!res.ok || new URL(res.url).hostname !== "photos.google.com") {
    throw new Error("Album tidak bisa dibuka. Pastikan album dibagikan ke 'siapa saja yang punya link'.");
  }
  // Large HTML (>2MB) can't be cached by Next's fetch cache; that's fine, page is ISR-cached instead.
  const html = await res.text();
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1]?.replace(/\s*-\s*Google Photos\s*$/, "").trim() || "Album";

  const re = /\["(https:\/\/lh3\.googleusercontent\.com\/pw\/[A-Za-z0-9_-]+)",(\d+),(\d+)/g;
  const seen = new Set<string>();
  const items: Photo[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    items.push({ id: m[1], w: +m[2], h: +m[3] });
  }
  if (!items.length) throw new Error("Tidak ada foto ditemukan di album ini.");
  return { title, items };
}
