import ApplicationFormEditor from "@/components/portal/director/ApplicationFormEditor";

export default function ApplicationFormPage() {
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
