import { getDirectorContext } from "./session";

export interface DeletionRequestRow {
  deletionRequestId: string;
  subjectName: string;
  status: string;
  requestedLabel: string;
}

export interface ExportRequestRow {
  exportRequestId: string;
  subjectName: string;
  status: string;
  requestedLabel: string;
}

export interface RequestsView {
  deletions: DeletionRequestRow[];
  exportRequests: ExportRequestRow[];
  isSample: boolean;
}

const SAMPLE_DELETIONS: DeletionRequestRow[] = [
  { deletionRequestId: "del_sample_1", subjectName: "Former student (Grade 12)", status: "submitted", requestedLabel: "Jul 19" },
];
const SAMPLE_EXPORTS: ExportRequestRow[] = [
  { exportRequestId: "exp_sample_1", subjectName: "Priya S.", status: "submitted", requestedLabel: "Jul 20" },
];

export async function getRequestsView(): Promise<RequestsView> {
  await getDirectorContext();
  return { deletions: SAMPLE_DELETIONS, exportRequests: SAMPLE_EXPORTS, isSample: true };
}
