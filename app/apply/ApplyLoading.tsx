// Centered loading state for the apply-funnel token pages: a buffering spinner
// with a message, centered on both axes so the "checking your link" step reads
// as a deliberate loading screen rather than left-aligned text.
export default function ApplyLoading({ message }: { message: string }) {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 px-6 text-center">
      <span
        role="status"
        aria-label="Loading"
        className="h-8 w-8 rounded-full border-2 border-black/10 border-t-black/50 animate-spin"
      />
      <p className="text-muted">{message}</p>
    </div>
  );
}
