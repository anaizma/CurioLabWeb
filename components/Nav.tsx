"use client";
import Image from "next/image";


import Link from "next/link";
import { useEffect, useState } from "react";

// Always shown inline in the header bar (on desktop).
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
        <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between gap-4">
          <Link
            href="/"
            onClick={close}
            className="flex shrink-0 items-center gap-2 font-bold text-lg whitespace-nowrap"
          >
            <Image src="/images/projects/logoo.png" alt="CurioLab logo" width={28} height={28} />

            CurioLab
          </Link>

          <div className="flex shrink-0 items-center gap-4 lg:gap-6 xl:gap-8">
            {/* Primary links reveal in tiers as the viewport widens, and peel
                off from the least-essential end as it narrows — so they never
                crowd the logo. Everything remains reachable via the drawer. */}
            <nav className="hidden lg:flex items-center gap-6 xl:gap-8 text-sm">
              {primaryLinks.map((l, i) => (
                <Link
                  key={l.href}
                  href={l.href}
                  // First two show at lg; the last two only at xl.
                  className={`${i >= 2 ? "hidden xl:inline" : ""} whitespace-nowrap hover:text-coral transition-colors`}
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
