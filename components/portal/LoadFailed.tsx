import Link from "next/link";

/**
 * What a director sees when a portal read fails.
 *
 * This replaces the old behavior of quietly serving sample fixtures on failure,
 * which put invented applicants in front of a director as though they were real.
 * An honest empty state with a retry is strictly better than plausible fiction:
 * nothing here is fabricated, and the retry is a plain link so it works without
 * client JavaScript.
 */
export default function LoadFailed({
  what = "this page",
  retryHref,
}: {
  what?: string;
  retryHref: string;
}) {
  return (
    <div className="rounded-sm border border-ink/15 bg-white px-5 py-8 text-center">
      <p className="font-semibold">We couldn&apos;t load {what}.</p>
      <p className="text-sm text-ink/60 mt-1">
        This is a problem on our end, not with your data. Nothing has been lost.
      </p>
      <Link
        href={retryHref}
        className="inline-block mt-4 rounded-lg px-4 py-2 text-sm font-semibold border border-ink/15 hover:bg-ink/5 transition-colors"
      >
        Try again
      </Link>
    </div>
  );
}
