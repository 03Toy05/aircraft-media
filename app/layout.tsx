import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = { title: "Aircraft Media", description: "Private aircraft media library", icons: { icon: "/logo.svg" } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
