/**
 * Shown when a portal read could not return live data.
 *
 * This used to sit above FABRICATED records — invented applicants, members and
 * messages that a fallback served whenever the ops call failed or no session was
 * present. Presenting invented people to an operator as though they were real is
 * not an acceptable failure mode, so the fixtures are gone and every fallback now
 * returns nothing. This banner is what remains: it says plainly that the view is
 * empty because the data could not be loaded, not because there is no data.
 *
 * The name is kept so the many pages that render it need no churn; there is no
 * sample data anywhere behind it.
 */
export default function SampleBanner() {
  return (
    <div
      className="text-xs rounded-lg px-3 py-2 border"
      style={{
        background: "var(--pt-accent-soft)",
        borderColor: "var(--pt-accent-border)",
        color: "var(--pt-accent-fg)",
      }}
    >
      We couldn&apos;t load live data here, so this view is empty. It is not a sign that your
      data is missing. Reload to try again, or sign in if your session has expired.
    </div>
  );
}
