import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = { title: "Aircraft Media", description: "Private aircraft media library", icons: { icon: "/logo.svg" } };
// maximumScale 1 stops iPhones zooming into a form box when it is tapped (they do that for text under 16px), so the
// boxes can use a smaller font. Pinch-to-zoom still works on iPhones.
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, viewportFit: "cover" };
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
