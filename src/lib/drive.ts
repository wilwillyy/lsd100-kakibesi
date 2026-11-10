/** Reads a PUBLIC Google Drive folder ("anyone with the link") without login or API key. */
export type DriveFile = { id: string; name: string };
export type DriveFolder = { title: string; files: DriveFile[] };

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36";
const IMG_EXT = /\.(jpe?g|png|webp)$/i;

export function driveFolderId(url: string): string {
  const m = url.match(/folders\/([A-Za-z0-9_-]{10,})/) ?? url.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (!m) throw new Error(`Link folder Google Drive tidak valid: ${url}`);
  return m[1];
}

export async function fetchDriveFolder(url: string): Promise<DriveFolder> {
  const id = driveFolderId(url);
  const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${id}`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error("Folder Drive tidak bisa dibuka. Pastikan dibagikan ke 'siapa saja yang punya link'.");
  const html = await res.text();
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1]?.trim() || "Google Drive";

  const files: DriveFile[] = [];
  const seen = new Set<string>();
  const re = /<div class="flip-entry" id="entry-([A-Za-z0-9_-]+)"[\s\S]*?<div class="flip-entry-title">([^<]*)<\/div>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const name = m[2].replace(/&amp;/g, "&").trim();
    if (seen.has(m[1]) || !IMG_EXT.test(name)) continue; // skips sub-folders & non-images
    seen.add(m[1]);
    files.push({ id: m[1], name });
  }
  if (!files.length) throw new Error("Tidak ada foto ditemukan di folder Drive ini.");
  return { title, files };
}
