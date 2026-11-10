export type Photo = { id: string; w: number; h: number };
export type Album = { title: string; items: Photo[] };

/** Fixed album shown by the site. Can be overridden with the ALBUM_URL env var. */
export const ALBUM_URL = process.env.ALBUM_URL || "https://photos.app.goo.gl/Gi6Xkv1auavZkrZh8";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36";

function extractItemsFromBatch(rawItems: unknown, seen: Set<string>, items: Photo[]) {
  if (!Array.isArray(rawItems)) return;
  for (const entry of rawItems) {
    const info = Array.isArray(entry) ? entry[1] : null;
    if (!Array.isArray(info)) continue;
    const url = info[0];
    const w = Number(info[1]);
    const h = Number(info[2]);
    if (typeof url === "string" && url.startsWith("https://lh3.googleusercontent.com/pw/") && w > 0 && h > 0) {
      if (!seen.has(url)) {
        seen.add(url);
        items.push({ id: url, w, h });
      }
    }
  }
}

/**
 * Reads a PUBLIC shared Google Photos album (no login) by parsing its share page
 * and following `batchexecute` (`snAcKc`) pagination tokens until all photos are fetched.
 */
export async function fetchAlbum(url: string = ALBUM_URL): Promise<Album> {
  const res = await fetch(url, {
    redirect: "follow",
    next: { revalidate: 300 },
    headers: { "User-Agent": UA },
  });
  if (!res.ok || new URL(res.url).hostname !== "photos.google.com") {
    throw new Error("Album tidak bisa dibuka. Pastikan album dibagikan ke 'siapa saja yang punya link'.");
  }

  const finalUrl = new URL(res.url);
  const authKey = finalUrl.searchParams.get("key") || "";
  const html = await res.text();
  let title = html.match(/<title>([^<]*)<\/title>/)?.[1]?.replace(/\s*-\s*Google Photos\s*$/, "").trim() || "Album";

  const seen = new Set<string>();
  const items: Photo[] = [];

  // Parse AF_initDataCallback ds:1 block for initial items + pagination token
  const ds1Match = html.match(/AF_initDataCallback\(\{key:\s*'ds:1',\s*hash:\s*'[^']+',\s*data:([\s\S]*?),\s*sideChannel:\s*\{\}\}\);/);
  if (ds1Match) {
    try {
      const ds1 = JSON.parse(ds1Match[1]);
      if (Array.isArray(ds1?.[3]) && typeof ds1[3][1] === "string" && ds1[3][1].trim()) {
        title = ds1[3][1].trim();
      }
      extractItemsFromBatch(ds1?.[1], seen, items);

      const albumMediaKey: string | undefined = ds1?.[3]?.[0];
      let nextPageToken: string | undefined = typeof ds1?.[2] === "string" && ds1[2] ? ds1[2] : undefined;

      // Paginate through remaining batches via batchexecute RPC `snAcKc`
      while (albumMediaKey && nextPageToken) {
        const rpcArgs = JSON.stringify([albumMediaKey, nextPageToken, null, authKey]);
        const fReq = JSON.stringify([[["snAcKc", rpcArgs, null, "generic"]]]);
        const body = new URLSearchParams({ "f.req": fReq }).toString();

        let batchText = "";
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            const batchRes = await fetch("https://photos.google.com/_/PhotosUi/data/batchexecute?rpcids=snAcKc", {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                "User-Agent": UA,
              },
              body,
            });
            if (batchRes.ok) {
              batchText = await batchRes.text();
              break;
            }
          } catch {
            // retry
          }
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }

        if (!batchText) break;

        let foundPage = false;
        for (const line of batchText.split("\n")) {
          if (!line.startsWith('[["wrb.fr"')) continue;
          const outer = JSON.parse(line);
          const innerRaw = outer?.[0]?.[2];
          if (typeof innerRaw !== "string") continue;
          const pageData = JSON.parse(innerRaw);
          extractItemsFromBatch(pageData?.[1], seen, items);
          nextPageToken = typeof pageData?.[2] === "string" && pageData[2] ? pageData[2] : undefined;
          foundPage = true;
          break;
        }
        if (!foundPage) break;
      }
    } catch {
      // Fallback to regex below if JSON structure changes
    }
  }

  // Fallback if AF_initDataCallback parsing returned nothing
  if (!items.length) {
    const re = /\["(https:\/\/lh3\.googleusercontent\.com\/pw\/[A-Za-z0-9_-]+)",(\d+),(\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      items.push({ id: m[1], w: +m[2], h: +m[3] });
    }
  }

  if (!items.length) throw new Error("Tidak ada foto ditemukan di album ini.");
  return { title, items };
}
