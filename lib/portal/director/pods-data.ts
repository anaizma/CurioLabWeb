import { getDirectorContext } from "./session";

export interface TermRow {
  termId: string;
  name: string;
  startsLabel: string;
  endsLabel: string;
}

export interface PodRow {
  podId: string;
  name: string;
  termName: string;
  mentorName: string;
  memberCount: number;
}

export interface PodsView {
  terms: TermRow[];
  pods: PodRow[];
  isSample: boolean;
}

const SAMPLE_TERMS: TermRow[] = [
  { termId: "term_sample_1", name: "Fall 2026", startsLabel: "Sep 2", endsLabel: "Dec 12" },
  { termId: "term_sample_2", name: "Summer 2026", startsLabel: "Jun 9", endsLabel: "Aug 15" },
];
const SAMPLE_PODS: PodRow[] = [
  { podId: "pod_sample_1", name: "Robotics A", termName: "Fall 2026", mentorName: "T. Alvarez", memberCount: 6 },
  { podId: "pod_sample_2", name: "Games B", termName: "Fall 2026", mentorName: "K. Feng", memberCount: 5 },
];

export async function getPodsView(): Promise<PodsView> {
  await getDirectorContext();
  return { terms: SAMPLE_TERMS, pods: SAMPLE_PODS, isSample: true };
}
