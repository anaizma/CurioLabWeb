// POST /api/contact — the public contact form. Unauthenticated and it sends mail
// on every accepted call, so it carries the same two guards as /api/apply:
// Turnstile in front, then a per-email/per-IP throttle.
import { Resend } from "resend";
import { NextResponse } from "next/server";
import { getSql } from "@curiolab/http";
import { clientIp, verifyTurnstile, TURNSTILE_FIELD } from "@/lib/turnstile";
import {
  checkAndRecord,
  emailAndIpBuckets,
  CONTACT_EMAIL_LIMIT,
  CONTACT_IP_LIMIT,
} from "@/lib/rate-limit";

// The verified sending domain. The previous sandbox sender (onboarding@resend.dev)
// only ever delivers to the Resend account owner's own address, so contact-form
// mail to team@ was being accepted by the API and silently not delivered.
const FROM = process.env.APPLY_FROM_EMAIL ?? "CurioLab <onboarding@resend.dev>";
const TO = process.env.CONTACT_NOTIFY_EMAIL ?? "team@acuriolab.org";

export async function POST(request: Request) {
  try {
    if (!process.env.RESEND_API_KEY) {
      console.error("RESEND_API_KEY is not set");
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }

    const { name, email, message, [TURNSTILE_FIELD]: turnstileToken } = await request.json();

    if (!name || !email || !message) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const ip = clientIp(request);

    const bot = await verifyTurnstile(turnstileToken, ip);
    if (!bot.ok) {
      console.warn("[api/contact] turnstile rejected:", bot.errorCodes?.join(",") ?? "unknown");
      return NextResponse.json({ error: "bot_check_failed" }, { status: 403 });
    }

    const limited = await checkAndRecord(
      getSql(),
      "contact",
      emailAndIpBuckets(String(email), ip, CONTACT_EMAIL_LIMIT, CONTACT_IP_LIMIT),
    );
    if (!limited.ok) {
      console.warn(`[api/contact] rate limited on ${limited.exceeded}`);
      return NextResponse.json(
        { error: "rate_limited" },
        {
          status: 429,
          headers: limited.retryAfterSeconds
            ? { "Retry-After": String(limited.retryAfterSeconds) }
            : undefined,
        },
      );
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: FROM,
      to: TO,
      replyTo: email,
      subject: `New contact form message from ${name}`,
      text: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
