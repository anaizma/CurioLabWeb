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
      Sample data — representative content shown until this chapter&apos;s live data is connected.
    </div>
  );
}
