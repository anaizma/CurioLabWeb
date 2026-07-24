"use client";

import { usePathname } from "next/navigation";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

/**
 * Renders the marketing chrome (Nav + Footer) around the page — except on
 * /portal and /invite routes, which supply their own shell. Keeps the root
 * layout simple without relocating every marketing page into a route group.
 */
export default function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAppRoute =
    (pathname?.startsWith("/portal") ?? false) || (pathname?.startsWith("/invite") ?? false);
  return (
    <>
      {!isAppRoute && <Nav />}
      <main>{children}</main>
      {!isAppRoute && <Footer />}
    </>
  );
}
