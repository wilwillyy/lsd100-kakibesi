/**
 * Where the photos come from. Add / remove entries, then run `npm run index`.
 * - photos: shared Google Photos album link ("anyone with the link")
 * - drive:  public Google Drive folder link ("anyone with the link")
 *
 * A single entry may list multiple `urls` combined under one `title` tab.
 */
export type SourceConfig = {
  type: "photos" | "drive";
  url?: string;
  urls?: string[];
  title?: string;
};

export const EVENT_TITLE = process.env.EVENT_TITLE || "Long Slow Distance";

export const SOURCES: SourceConfig[] = [
  { type: "photos", url: "https://photos.app.goo.gl/Gi6Xkv1auavZkrZh8" },
  { type: "photos", url: "https://photos.app.goo.gl/jkwbLdBzeuWFxAMv7" },
  { type: "drive", url: "https://drive.google.com/drive/folders/1G_aiTbO2k-kYRv-u9RxjYsQx4xFGuf8M" },
  {
    type: "drive",
    title: "LSD 100 CAM C",
    urls: [
      "https://drive.google.com/drive/folders/1it569eoSRn704gJQaXBiLcHFlLoWuJaI?usp=drive_link",
      "https://drive.google.com/drive/folders/1VSuffbMv6m4GfTSDzSNN-uDK6CbhzuKH?usp=drive_link",
      "https://drive.google.com/drive/folders/1zpsbDDiI9N8gMTs0a5enY4vmD4_JFYZY?usp=drive_link",
      "https://drive.google.com/drive/folders/1O_IqK3Dd8gx8OsU7bjgNAe7ap1qaFCU_?usp=drive_link",
      "https://drive.google.com/drive/folders/1Y-DLgFaMpnmAZTr65K1f_q9bPqNfToSP?usp=drive_link",
      "https://drive.google.com/drive/folders/1iYX2IIpWIQOI8UmY9l2UORuN0uMdm-C6?usp=drive_link",
      "https://drive.google.com/drive/folders/1ySL4rnZebstsKpydi0w6GcxCR-iOdVIj?usp=drive_link",
    ],
  },
];
