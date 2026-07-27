// The "this wasn't me" page from the new-sign-in email.
//
// The link in the email opens THIS page; the page's button posts the token. It is
// deliberately not a GET that revokes on sight, because mail scanners and link
// previewers fetch every URL in a message and would sign a director out several
// times a day.
//
// No server-side pre-check runs here: unlike a password reset there is nothing to
// tell someone in advance, and probing whether a revoke token is still live is
// exactly the thing not to answer. The action reports success either way.
import RevokeSessionClient from "./revoke-session-client";

export const metadata = {
  title: "End that session",
};

export default async function RevokeSessionPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <RevokeSessionClient token={token} />;
}
