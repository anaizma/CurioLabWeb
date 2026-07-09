import type { Metadata } from "next";
import { Nunito_Sans, JetBrains_Mono, Work_Sans } from "next/font/google";
import "./globals.css";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

const sans = Nunito_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "600", "700", "800"],
});
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-code" });
const editorial = Work_Sans({
  subsets: ["latin"],
  variable: "--font-story",
  weight: ["300", "400", "600", "700"],
});

export const metadata: Metadata = {
  title: "CurioLab — The infrastructure layer for student-led impact",
  description:
    "CurioLab takes students in grades 5 through 12 from curiosity to a deployed project — with structured curriculum, near-peer mentors, co-founders, and access to a university lab.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${editorial.variable}`}>
      <body className="font-sans antialiased">
        <Nav />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}