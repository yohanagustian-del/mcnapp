import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MCN MEA Platform",
  description: "Platform internal MCN MEA — creator agency TikTok/Shopee",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="antialiased">{children}</body>
    </html>
  );
}
