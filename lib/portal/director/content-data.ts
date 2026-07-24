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

const SAMPLE_NEWSLETTERS: NewsletterRow[] = [
  { id: "nl_sample_1", title: "July build highlights", status: "draft" },
  { id: "nl_sample_2", title: "Spring showcase recap", status: "published" },
];
const SAMPLE_REVIEWS: ReviewItem[] = [
  { id: "rev_sample_1", type: "narrative", title: "Maya's intro narrative", author: "Maya R." },
  { id: "rev_sample_2", type: "project", title: "Recycling robot", author: "Diego" },
];

export async function getContentView(): Promise<ContentView> {
  await getDirectorContext();
  return { newsletters: SAMPLE_NEWSLETTERS, reviews: SAMPLE_REVIEWS, isSample: true };
}
