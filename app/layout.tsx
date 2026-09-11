import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hashcats Live",
  description: "The Hashcats play in one sentence, updated as mints, burns and sales land.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
