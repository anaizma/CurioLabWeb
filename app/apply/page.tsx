// Server shell for the Apply form. It exists to read the Turnstile SITE key on
// the server and hand it to the client form: the site key is public (it ends up
// in the markup either way), so passing it down avoids a NEXT_PUBLIC_ duplicate
// of a value that is already in the environment.
import { turnstileSiteKey } from "@/lib/turnstile";
import ApplyClient from "./apply-client";

export default function ApplyPage() {
  return <ApplyClient siteKey={turnstileSiteKey()} />;
}
