import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Engagement Console",
  description: "Semi-automated social media engagement — review and approve comments",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
