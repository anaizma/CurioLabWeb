"use client";

// The Cloudflare Turnstile widget. Renders the challenge, hands the resulting
// one-time token up via onToken, and clears it when the token expires or errors
// so a form can never submit a stale token.
//
// siteKey is passed down from a server component (it is public by design). When
// it is null Turnstile is not configured: the widget renders nothing and reports
// a null token, and the server-side check is correspondingly disabled, so a
// keyless dev checkout still works.

import { useEffect, useRef } from "react";

interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
      theme?: "light" | "dark" | "auto";
    },
  ) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    onTurnstileLoad?: () => void;
  }
}

const SCRIPT_ID = "cf-turnstile-script";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** Load the Turnstile script once per page, resolving when the API is ready. */
function loadTurnstile(): Promise<TurnstileApi> {
  if (typeof window === "undefined") return Promise.reject(new Error("server"));
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return new Promise((resolve, reject) => {
    const done = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("turnstile failed to initialize"));
    };
    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      existing.addEventListener("load", done);
      existing.addEventListener("error", () => reject(new Error("turnstile script failed")));
      return;
    }
    const s = document.createElement("script");
    s.id = SCRIPT_ID;
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.addEventListener("load", done);
    s.addEventListener("error", () => reject(new Error("turnstile script failed")));
    document.head.appendChild(s);
  });
}

export default function TurnstileWidget({
  siteKey,
  onToken,
}: {
  siteKey: string | null;
  onToken: (token: string | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Hold the latest callback in a ref so the render effect below does not depend
  // on it — otherwise every parent render would tear down and re-render the
  // widget, losing the challenge in progress. Written in an effect, not during
  // render, because a render pass must not touch refs.
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    if (!siteKey || !hostRef.current) return;
    let widgetId: string | null = null;
    let cancelled = false;
    const host = hostRef.current;

    loadTurnstile()
      .then((api) => {
        if (cancelled) return;
        widgetId = api.render(host, {
          sitekey: siteKey,
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(null),
          "error-callback": () => onTokenRef.current(null),
        });
      })
      .catch(() => {
        // Script blocked or offline: leave the token null. The form surfaces the
        // "verification didn't load" message rather than silently allowing a submit.
        if (!cancelled) onTokenRef.current(null);
      });

    return () => {
      cancelled = true;
      if (widgetId !== null && window.turnstile) {
        try {
          window.turnstile.remove(widgetId);
        } catch {
          // The widget may already be gone with the unmounted subtree.
        }
      }
    };
  }, [siteKey]);

  if (!siteKey) return null;
  return <div ref={hostRef} className="my-2" />;
}
