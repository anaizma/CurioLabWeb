"use client";

// Forced TOTP enrollment, the step that was missing.
//
// A privileged account (director, admin, staff, mentor) cannot hold a session
// without a second factor. The backend has always returned
// `{ totpEnrollmentRequired, pendingToken }` for such an account before it has
// enrolled, and POST /api/auth/totp/enroll has always returned the secret and the
// otpauth:// URI — but nothing in the interface rendered either, so every newly
// created privileged account saw "Incorrect email/username or password" and was
// locked out permanently. This screen is the fix.
//
// THE QR CODE IS GENERATED IN THE BROWSER. `qrcode` runs locally and produces a
// data: URL, so the shared secret never leaves this page: not to a QR rendering
// service, not into an <img src> pointing at a third party, and not into a URL
// that could land in an access log. That constraint is the reason a library is
// installed at all rather than using one of the public chart/QR endpoints.

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** Group the base32 secret in fours so it can be read aloud and typed by hand. */
function formatSecret(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? [secret]).join(" ");
}

export default function TotpEnrollment({
  secret,
  otpauthUri,
  busy,
  error,
  onConfirm,
}: {
  secret: string;
  otpauthUri: string;
  busy: boolean;
  error: string;
  onConfirm: (code: string) => void;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);
  const [code, setCode] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(otpauthUri, { width: 220, margin: 1, errorCorrectionLevel: "M" })
      .then((url) => {
        if (!cancelled) setQr(url);
      })
      .catch(() => {
        // No fabricated placeholder image: the manual key below is a complete
        // path through this screen, so say the code did not render and move on.
        if (!cancelled) setQrFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [otpauthUri]);

  async function copySecret() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard permission denied or unavailable: the key is on screen and
      // selectable, so there is nothing to recover from.
    }
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        onConfirm(code.trim());
      }}
    >
      <div>
        <h2 className="text-lg font-bold mb-2">Set up two-step sign-in</h2>
        <p className="text-sm text-muted">
          Your role can see other people&apos;s information, including children&apos;s applications, so
          CurioLab requires a second step at sign-in. Scan the code below with any authenticator app
          (Google Authenticator, 1Password, Authy, Microsoft Authenticator, or any other), then enter
          the 6-digit code it shows.
        </p>
      </div>

      <div className="flex flex-col items-center gap-3 border border-black/10 rounded-md bg-white py-6">
        {qr !== null ? (
          // A plain <img>, not next/image, on purpose: this is a data: URL the
          // browser just produced in memory. Routing it through the image
          // optimizer would send the shared secret to the server as a query
          // parameter, which is precisely what generating the code client-side
          // exists to avoid.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt="QR code for setting up two-step sign-in" width={220} height={220} />
        ) : qrFailed ? (
          <p className="text-sm text-muted px-6 text-center">
            The QR code could not be drawn. Use the setup key below instead: it does exactly the same
            thing.
          </p>
        ) : (
          <p className="text-sm text-muted">Preparing your code…</p>
        )}
      </div>

      <div className="border border-black/10 rounded-md bg-white p-4">
        <p className="text-sm font-medium mb-1">Can&apos;t scan it?</p>
        <p className="text-xs text-muted mb-3">
          Choose &quot;enter a setup key&quot; in your authenticator app and type this in by hand.
        </p>
        {showKey ? (
          <>
            <code className="block text-sm font-mono tracking-wider break-all bg-cream rounded px-3 py-2">
              {formatSecret(secret)}
            </code>
            <button
              type="button"
              onClick={copySecret}
              className="mt-3 text-xs font-semibold text-coral hover:underline"
            >
              {copied ? "Copied" : "Copy setup key"}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setShowKey(true)}
            className="text-xs font-semibold text-coral hover:underline"
          >
            Show setup key
          </button>
        )}
      </div>

      <div>
        <label className="label block mb-2" htmlFor="totp-enroll-code">
          Enter the 6-digit code from your app
        </label>
        <input
          id="totp-enroll-code"
          className="w-full border border-black/20 rounded-md px-4 py-3 bg-white tracking-widest"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </div>

      <button
        type="submit"
        disabled={busy}
        className="w-full bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors disabled:opacity-50"
      >
        {busy ? "Verifying…" : "Turn on two-step sign-in"}
      </button>

      {error && <p className="text-sm text-coral font-medium">{error}</p>}
    </form>
  );
}
