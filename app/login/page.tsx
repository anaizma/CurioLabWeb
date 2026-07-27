import LoginClient from "./login-client";

// `next` is where the director gate sends someone it turned away, so they land
// back where they asked for after signing in. `reset=1` is set by the
// reset-password flow so this page can confirm the change took effect. Both are
// sanitised before use (safeNextPath in lib/portal/director/gate.ts).
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string }>;
}) {
  const { next, reset } = await searchParams;
  return <LoginClient next={next ?? null} reset={reset === "1"} />;
}
