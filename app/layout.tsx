import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Aircraft Media", description: "Private aircraft media library" };
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
