import ApplicationFormEditor from "@/components/portal/director/ApplicationFormEditor";
import { requireDirector } from "@/lib/portal/director/guard";

export default async function ApplicationFormPage() {
  // Gate first: nothing below this line runs for a non-director (see guard.ts).
  await requireDirector();
  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Application form</h1>
        <p className="text-ink/60 text-sm mt-1">
          Design the questions applicants answer. Add, reword, reorder or remove questions across the parent and student sections.
        </p>
      </div>
      <ApplicationFormEditor />
    </div>
  );
}
