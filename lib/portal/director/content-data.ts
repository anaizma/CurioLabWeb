import { getDirectorContext } from "./session";

export interface NewsletterRow {
  id: string;
  title: string;
  status: string;
}

export interface ReviewItem {
  id: string;
  type: "narrative" | "project";
  title: string;
  author: string;
}

export interface ContentView {
  newsletters: NewsletterRow[];
  reviews: ReviewItem[];
  isSample: boolean;
}

const SAMPLE_NEWSLETTERS: NewsletterRow[] = [];
const SAMPLE_REVIEWS: ReviewItem[] = [];

export async function getContentView(): Promise<ContentView> {
  await getDirectorContext();
  return { newsletters: SAMPLE_NEWSLETTERS, reviews: SAMPLE_REVIEWS, isSample: true };
}
