import type { Metadata } from "next";
import { Nunito_Sans, Archivo, Work_Sans } from "next/font/google";
import "./globals.css";
import SiteChrome from "@/components/SiteChrome";

const sans = Nunito_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "600", "700", "800"],
});
// Archivo replaces JetBrains Mono as the label/stat face across every portal
// + the homepage. It is proportional (not monospace); tabular figures are
// enabled in globals.css so numeric columns still align.
const mono = Archivo({ subsets: ["latin"], variable: "--font-code" });
const editorial = Work_Sans({
  subsets: ["latin"],
  variable: "--font-story",
  weight: ["300", "400", "600", "700"],
});

export const metadata: Metadata = {
  title: "CurioLab — The infrastructure layer for student-led impact",
  description:
    "CurioLab takes students in grades 6 through 12 from curiosity to a deployed project — with structured curriculum, near-peer mentors, co-founders, and access to a university lab.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${editorial.variable}`}>
      <body className="font-sans antialiased">
        <SiteChrome>{children}</SiteChrome>
      </body>
    </html>
  );
}