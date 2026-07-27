"use client";

// The one-time backup codes, shown ONCE.
//
// These are stored as argon2id hashes, exactly like a password, so they are
// genuinely unrecoverable: there is no "show them again" and no support path that
// can read them back. Someone who clicks past this screen without saving them has
// no fallback if they lose their phone, and the only remaining route back into a
// privileged account is an operator resetting it by hand.
//
// So the screen is built to be hard to skip: the warning is the first thing on it
// and is styled as a warning, copy and download are both one click, and the
// continue button stays disabled until the person has actually done one of them
// or explicitly ticked that they wrote the codes down.

import { useState } from "react";

export default function BackupCodes({
  codes,
  onDone,
}: {
  codes: string[];
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const saved = copied || downloaded || acknowledged;

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
    } catch {
      // Clipboard blocked. The codes are on screen and the download still works,
      // so there is nothing to report beyond the button not latching.
    }
  }

  function download() {
    const body = [
      "CurioLab backup codes",
      "",
      "Each code works once, in place of the code from your authenticator app.",
      "Keep this file somewhere only you can reach. It cannot be reissued.",
      "",
      ...codes,
      "",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([body], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "curiolab-backup-codes.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setDownloaded(true);
  }

  return (
    <div className="space-y-6">
      <div className="border-2 border-coral rounded-md bg-white p-4">
        <p className="text-sm font-bold text-coral mb-1">Save these now. You will not see them again.</p>
        <p className="text-sm text-black">
          These backup codes are the only way into your account if you lose your phone. We store them
          the same way we store passwords, so nobody at CurioLab can look them up or send them to you
          again. If you close this page without saving them, they are gone.
        </p>
      </div>

      <div className="border border-black/10 rounded-md bg-white p-4">
        <ul className="grid grid-cols-2 gap-x-6 gap-y-2">
          {codes.map((c) => (
            <li key={c} className="font-mono text-sm tracking-wider">
              {c}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex gap-3 flex-wrap">
        <button
          type="button"
          onClick={copy}
          className="border border-black/20 rounded-md px-4 py-2 text-sm font-medium hover:bg-cream transition-colors"
        >
          {copied ? "Copied" : "Copy codes"}
        </button>
        <button
          type="button"
          onClick={download}
          className="border border-black/20 rounded-md px-4 py-2 text-sm font-medium hover:bg-cream transition-colors"
        >
          {downloaded ? "Downloaded" : "Download .txt"}
        </button>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
        />
        <span>I have saved these codes somewhere safe.</span>
      </label>

      <button
        type="button"
        onClick={onDone}
        disabled={!saved}
        className="w-full bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors disabled:opacity-50"
      >
        Continue to CurioLab
      </button>
      {!saved && (
        <p className="text-xs text-muted">
          Copy, download, or tick the box above to continue. Each code works once.
        </p>
      )}
    </div>
  );
}
