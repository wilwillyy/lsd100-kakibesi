/**
 * Shared index format. Produced offline by `npm run index`, served as a static file and
 * searched instantly in the browser.
 *
 * Photo ids: Google Photos ids are stored as-is; Google Drive file ids are prefixed with "d:".
 */
export const PHOTO_PREFIX = "https://lh3.googleusercontent.com/pw/";
export const DRIVE_IMG_PREFIX = "https://lh3.googleusercontent.com/d/";

export type SourceInfo = {
  type: "photos" | "drive";
  url: string;
  title: string;
  count: number;
};

export type IndexedPhoto = {
  id: string;
  w: number;
  h: number;
  /** BIB numbers detected in the photo. `undefined` = not indexed yet (or failed). */
  b?: string[];
  /** index into PhotoIndex.sources (default 0) */
  s?: number;
  /** original file name (Drive) */
  n?: string;
};

export type PhotoIndex = {
  version: 2;
  title: string;
  generatedAt: string;
  sources: SourceInfo[];
  photos: IndexedPhoto[];
};

export const INDEX_URL = "/data/index.json";

export const isDrive = (id: string) => id.startsWith("d:");

/** Upstream image URL without size suffix (what /api/img accepts as `u`). */
export const baseUrl = (id: string) => (isDrive(id) ? DRIVE_IMG_PREFIX + id.slice(2) : PHOTO_PREFIX + id);

/** Upstream URL of a resized rendition. */
export const upstreamUrl = (id: string, w: number) => `${baseUrl(id)}=w${w}`;

/** Same-origin, CDN-cached proxy URL of a resized rendition (safe for canvas + <img>). */
export const imgUrl = (id: string, w: number) => `/api/img?u=${encodeURIComponent(baseUrl(id))}&w=${w}`;

/** URL of the full-quality original (upstream). */
export const originalUrl = (id: string) =>
  isDrive(id)
    ? `https://drive.usercontent.google.com/download?id=${id.slice(2)}&export=download&confirm=t`
    : `${PHOTO_PREFIX}${id}=d`;

/** Proxy that streams the original with a friendly file name. */
export const downloadUrl = (id: string, name: string) =>
  `/api/download?id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`;
