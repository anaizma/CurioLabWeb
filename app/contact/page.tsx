// Server shell: reads the public Turnstile site key and hands it to the form.
import { turnstileSiteKey } from "@/lib/turnstile";
import ContactClient from "./contact-client";

export default function ContactPage() {
  return <ContactClient siteKey={turnstileSiteKey()} />;
}
