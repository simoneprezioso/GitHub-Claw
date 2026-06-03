import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GitHub Claw — verified open-source discovery, no hallucinations",
  description:
    "Describe a tool in plain English and get real, currently-live GitHub repositories — pulled from the API, never invented — with a transparent match score and an honest Adopt / Risky / Abandoned maintenance verdict.",
  openGraph: {
    title: "GitHub Claw",
    description:
      "Real repos for your idea — verified, scored, and triaged (Adopt / Risky / Abandoned). No hallucinated repos, no dead links.",
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
