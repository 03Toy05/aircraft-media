import "./globals.css";
import type { Metadata, Viewport } from "next";
import { getUiLang } from "@/lib/uiLang";
import { UiLangProvider } from "./_components/uiLang";

// The tab icon is Toy. "?v=toy": the file once held the old blue airplane logo, and browsers keep a tab icon by its
// address, so a new address makes them fetch Toy. favicon.ico and the iPhone home-screen icon are Toy too.
export const metadata: Metadata = {
  title: "Aircraft Media",
  description: "Private aircraft media library",
  icons: {
    icon: [{ url: "/logo.svg?v=toy", type: "image/svg+xml" }, { url: "/favicon.ico?v=toy", sizes: "48x48" }],
    apple: "/apple-touch-icon.png?v=toy",
  },
};
// maximumScale 1 stops iPhones zooming into a form box when it is tapped (they do that for text under 16px), so the
// boxes can use a smaller font. Pinch-to-zoom still works on iPhones.
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, viewportFit: "cover" };
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getUiLang(); // EN / 繁 / 简, picked in the top bar or on the sign-in page
  return (
    <html lang={lang}>
      <body><UiLangProvider lang={lang}>{children}</UiLangProvider></body>
    </html>
  );
}
