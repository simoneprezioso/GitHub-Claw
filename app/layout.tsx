import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GitHub Claw — find open-source projects from an idea",
  description:
    "Describe a tool, app, or library in plain English. GitHub Claw expands your idea into search queries and ranks real GitHub repositories by relevance, popularity, freshness, and health.",
  openGraph: {
    title: "GitHub Claw",
    description: "Find open-source projects from an idea, not keywords.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
