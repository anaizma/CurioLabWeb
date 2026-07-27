// Set a new password from a reset link.
//
// The token is validated SERVER-SIDE, here, before the form is rendered, so
// someone who follows an expired or already-used link is told so immediately
// rather than after composing a password they are about to lose. That check calls
// the controller directly instead of going through an app/api route: the token
// travels in the path, and an extra HTTP hop would put it in a second access log
// for no benefit.
//
// The token IS in the URL, so proxy.ts sets `Referrer-Policy: no-referrer` on
// /reset-password/* (the same protection /invite/* already had), which stops it
// leaking through the Referer header to anything this page links out to.
import Link from "next/link";
import { checkPasswordResetToken, getSql } from "@curiolab/http";
import ResetPasswordClient from "./reset-password-client";

export const metadata = {
  title: "Set a new password",
};

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { body } = await checkPasswordResetToken({ sql: getSql(), body: { token } });

  if (!body.usable) {
    return (
      <div className="mx-auto max-w-md px-6 py-20">
        <p className="label-blue mb-3">Account help</p>
        <h1 className="text-3xl md:text-4xl font-bold mb-6">This link has expired</h1>
        <p className="text-black mb-6">
          Password reset links work once and expire about an hour after they are sent. This one has
          already been used, or it is too old.
        </p>
        <p className="text-sm text-muted mb-8">
          Your password has not changed. Request a fresh link and it will arrive in a moment.
        </p>
        <Link
          href="/forgot-password"
          className="inline-block bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors"
        >
          Send a new link
        </Link>
      </div>
    );
  }

  return <ResetPasswordClient token={token} />;
}
