import { getDirectorContext } from "./session";

export interface MediaRow {
  mediaId: string;
  projectTitle: string;
  reviewStatus: string;
  depictionsCount: number;
  flaggedReason: string | null;
}

export interface MediaView {
  media: MediaRow[];
  isSample: boolean;
}

const SAMPLE: MediaRow[] = [
  { mediaId: "med_sample_1", projectTitle: "Weather station dashboard", reviewStatus: "pending_review", depictionsCount: 1, flaggedReason: "Face visible — confirm depiction consent" },
  { mediaId: "med_sample_2", projectTitle: "Recycling robot demo", reviewStatus: "pending_review", depictionsCount: 0, flaggedReason: null },
];

export async function getMediaView(): Promise<MediaView> {
  await getDirectorContext();
  return { media: SAMPLE, isSample: true };
}
