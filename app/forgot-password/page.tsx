// Server shell: reads the public Turnstile site key and hands it to the form,
// the same pattern as /contact and /apply.
import { turnstileSiteKey } from "@/lib/turnstile";
import ForgotPasswordClient from "./forgot-password-client";

export const metadata = {
  title: "Forgot password",
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordClient siteKey={turnstileSiteKey()} />;
}
