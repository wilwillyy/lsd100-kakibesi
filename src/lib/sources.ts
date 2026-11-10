/**
 * Where the photos come from. Add / remove entries, then run `npm run index`.
 * - photos: shared Google Photos album link ("anyone with the link")
 * - drive:  public Google Drive folder link ("anyone with the link")
 */
export type SourceConfig = { type: "photos" | "drive"; url: string };

export const EVENT_TITLE = process.env.EVENT_TITLE || "Long Slow Distance";

export const SOURCES: SourceConfig[] = [
  { type: "photos", url: "https://photos.app.goo.gl/Gi6Xkv1auavZkrZh8" },
  { type: "photos", url: "https://photos.app.goo.gl/jkwbLdBzeuWFxAMv7" },
  { type: "drive", url: "https://drive.google.com/drive/folders/1G_aiTbO2k-kYRv-u9RxjYsQx4xFGuf8M" },
];
