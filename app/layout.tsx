import type { Metadata } from "next";
import { DotGothic16, Jersey_10, VT323 } from "next/font/google";
import "./globals.css";

const display = Jersey_10({ weight: "400", subsets: ["latin"], variable: "--font-display" });
const body = DotGothic16({ weight: "400", subsets: ["latin"], variable: "--font-body" });
const mono = VT323({ weight: "400", subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Hashcats Live",
  description: "The Hashcats play in one sentence, updated as mints, burns and sales land.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
