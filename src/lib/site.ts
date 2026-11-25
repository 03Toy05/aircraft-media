import { headers } from "next/headers";

/**
 * The site's own address (APP_URL, or Render's RENDER_EXTERNAL_URL), never one taken from the request: a faked request
 * must not get a working link that points at another site. In local development, the address being used.
 */
export async function siteAddress(): Promise<string | null> {
  const site = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "";
  if (site) return site.replace(/\/+$/, "");
  if (process.env.NODE_ENV !== "production") return `http://${(await headers()).get("host")}`;
  return null;
}
