"use client";
import Image from "next/image";


import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

// Measure before paint on the client; fall back to useEffect during SSR so
// React doesn't warn about useLayoutEffect on the server.
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

// Shown inline in the header bar, widest-first. As the window narrows the whole
// cluster shifts toward the logo first (see the fit logic below); only once that
// shift is exhausted do links peel off from the right end into the drawer.
const primaryLinks = [
  { href: "/about", label: "About CurioLab" },
  { href: "/chapter-model", label: "Chapter Model" },
  { href: "/team", label: "Our Team" },
  { href: "/contact", label: "Contact" },
];

// Surfaced in the drawer on mobile only — these live in the bar on desktop.
const generalLinks = [
  { href: "/about", label: "About CurioLab" },
  { href: "/contact", label: "Contact" },
  { href: "/login", label: "Log in" },
];

// Drawer group: pages for the team.
const teamLinks = [
  { href: "/careers", label: "Careers" },
  { href: "/chapter-model", label: "Chapter Model" },
  { href: "/team", label: "Our Team" },
  { href: "/support", label: "Get Involved" },
];

// Drawer group: pages for students.
const studentLinks = [
  { href: "/projects", label: "Projects" },
  { href: "/community", label: "Community" },
  { href: "/newsletter", label: "Newsletter" },
  { href: "/mentors", label: "Mentorship" },
  { href: "/students", label: "Apply" },
];

export default function Nav() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  // Two-phase responsive header: the control cluster shifts toward the logo
  // (via justify-between shrinking the middle gap) until it is snug against it —
  // the max shift. Only then, as the window keeps narrowing, do primary links
  // drop from the right end one at a time. This is measured, not guessed: on
  // every resize we reveal all links, then hide from the end while the row
  // overflows, so a link disappears exactly when one more pixel wouldn't fit.
  const rowRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);

  useIsoLayoutEffect(() => {
    const row = rowRef.current;
    const nav = navRef.current;
    if (!row || !nav) return;
    const links = Array.from(nav.children) as HTMLElement[];

    const fit = () => {
      links.forEach((el) => {
        el.style.display = "";
      });
      // Hide from the right while the cluster overflows the available width.
      for (let i = links.length - 1; i >= 0; i--) {
        if (row.scrollWidth <= row.clientWidth) break;
        links[i].style.display = "none";
      }
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(row);
    // Label widths change once the brand font swaps in — remeasure then.
    document.fonts?.ready.then(fit).catch(() => {});
    return () => ro.disconnect();
  }, []);

  // Lock background scroll and allow Escape to close while the drawer is open.
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const DrawerLink = ({
    href,
    label,
    cta,
  }: {
    href: string;
    label: string;
    cta?: boolean;
  }) => (
    <Link
      href={href}
      onClick={close}
      className={`rounded-md px-3 py-2.5 transition-colors hover:bg-black/5 ${
        cta ? "font-medium text-coral" : "hover:text-coral"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <>
      <header className="border-b border-black/10 bg-cream sticky top-0 z-50">
        {/* justify-between lets the controls glide toward the logo as the window
            narrows; the min gap-8 is the shift cap — the cluster can never slide
            closer to the logo than this, so nothing ever overlaps it. */}
        <div
          ref={rowRef}
          className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between gap-8"
        >
          <Link
            href="/"
            onClick={close}
            className="flex shrink-0 items-center gap-2 font-bold text-lg whitespace-nowrap"
          >
            <Image src="/images/projects/logoo.png" alt="CurioLab logo" width={28} height={28} />

            CurioLab
          </Link>

          <div className="flex shrink-0 items-center gap-6 xl:gap-8">
            <nav ref={navRef} className="flex items-center gap-6 xl:gap-8 text-sm">
              {primaryLinks.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="whitespace-nowrap hover:text-coral transition-colors"
                >
                  {l.label}
                </Link>
              ))}
            </nav>

            <Link
              href="/login"
              className="inline-block whitespace-nowrap border border-ink/20 px-5 py-2 rounded-md text-sm font-medium hover:bg-black/5 transition-colors"
            >
              Log in
            </Link>

            <Link
              href="/students"
              className="inline-block whitespace-nowrap bg-coral text-white px-5 py-2 rounded-md text-sm font-medium hover:bg-coral-dark transition-colors"
            >
              Apply →
            </Link>

            <button
              aria-label="Open menu"
              aria-expanded={open}
              onClick={() => setOpen(true)}
              className="flex shrink-0 flex-col items-center justify-center gap-[5px] w-10 h-10 rounded hover:bg-black/5 transition-colors"
            >
              <span className="block h-0.5 w-6 bg-ink" />
              <span className="block h-0.5 w-6 bg-ink" />
              <span className="block h-0.5 w-6 bg-ink" />
            </button>
          </div>
        </div>
      </header>

      {/* Backdrop — grayscales and dims the page behind it, fades in/out.
          `backdrop-*` filters sample whatever is painted behind this element,
          so the whole page desaturates without touching any page markup. */}
      <div
        onClick={close}
        aria-hidden={!open}
        className={`fixed inset-0 z-[100] bg-ink/20 backdrop-grayscale-[60%] backdrop-brightness-95 transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      />

      {/* Right drawer — slides in from the right edge. */}
      <aside
        aria-hidden={!open}
        className={`fixed top-0 right-0 z-[110] h-dvh w-72 max-w-[80vw] bg-cream border-l border-black/10 shadow-2xl transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-end px-6 py-4 border-b border-black/10">
          <button
            aria-label="Close menu"
            onClick={close}
            className="flex items-center justify-center w-9 h-9 -mr-2 rounded hover:bg-black/5 transition-colors"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <nav className="flex flex-col p-3 text-sm">
          {/* General links — only surfaced here on mobile, where the bar hides them. */}
          <div className="flex flex-col md:hidden">
            {generalLinks.map((l) => (
              <DrawerLink key={l.href} href={l.href} label={l.label} />
            ))}
          </div>
          <hr className="md:hidden my-2 border-black/10" />

          {/* For students */}
          {studentLinks.map((l) => (
            <DrawerLink
              key={l.href}
              href={l.href}
              label={l.label}
              cta={l.href === "/students"}
            />
          ))}

          {/* Divider between student pages and team pages */}
          <hr className="my-2 border-black/10" />

          {/* For the team */}
          {teamLinks.map((l) => (
            <DrawerLink key={l.href} href={l.href} label={l.label} />
          ))}
        </nav>
      </aside>
    </>
  );
}
