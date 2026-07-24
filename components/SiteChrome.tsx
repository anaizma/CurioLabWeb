"use client";

import { usePathname } from "next/navigation";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

/**
 * Renders the marketing chrome (Nav + Footer) around the page — except on
 * /portal routes, which supply their own shell. Keeps the root layout simple
 * without relocating every marketing page into a route group.
 */
export default function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPortal = pathname?.startsWith("/portal") ?? false;
  return (
    <>
      {!isPortal && <Nav />}
      <main>{children}</main>
      {!isPortal && <Footer />}
    </>
  );
}
