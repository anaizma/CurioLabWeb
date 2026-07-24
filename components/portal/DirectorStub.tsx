export default function DirectorStub({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="text-ink/60 text-sm max-w-prose">{note}</p>
    </div>
  );
}
