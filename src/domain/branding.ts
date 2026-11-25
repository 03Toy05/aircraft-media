import sharp from "sharp";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { brands } from "../db/schema";

/**
 * Each workspace's look on its quotes: a logo and a colour, used by the PDF and the client's page. Aircraft Media's
 * own look is never shown to clients; without a brand, quotes use a neutral navy.
 */

export const DEFAULT_COLOR = "#1f3a5f";
export const MAX_LOGO_BYTES = 3 * 1024 * 1024;
const LOGO_BOX = { width: 800, height: 400 };

export interface Brand { color: string; logo: { png: Uint8Array; width: number; height: number } | null; versionFormat: string }

export const validColor = (c: string) => /^#[0-9a-fA-F]{6}$/.test(c);

/** Dark text on a light brand colour, white on a dark one (for buttons and bands in that colour). */
export function textOn(hex: string): "#ffffff" | "#111111" {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.4 ? "#111111" : "#ffffff";
}

export async function getBrand(db: Db, tenantId: string): Promise<Brand> {
  const [b] = await db.select().from(brands).where(eq(brands.tenantId, tenantId));
  return {
    color: b?.color && validColor(b.color) ? b.color : DEFAULT_COLOR,
    logo: b?.logoPng && b.logoWidth && b.logoHeight ? { png: new Uint8Array(Buffer.from(b.logoPng, "base64")), width: b.logoWidth, height: b.logoHeight } : null,
    versionFormat: b?.versionFormat && validVersionFormat(b.versionFormat) ? b.versionFormat : DEFAULT_VERSION_FORMAT,
  };
}

async function upsert(db: Db, tenantId: string, set: Partial<typeof brands.$inferInsert>) {
  await db.insert(brands).values({ tenantId, ...set, updatedAt: new Date() })
    .onConflictDoUpdate({ target: brands.tenantId, set: { ...set, updatedAt: new Date() } });
}

export async function setBrandColor(db: Db, tenantId: string, color: string) {
  if (!validColor(color)) throw new Error("Choose a colour like #1f3a5f.");
  await upsert(db, tenantId, { color: color.toLowerCase() });
}

/** A logo from PNG, JPG, WebP or SVG, kept as a PNG of at most 800 x 400 (transparency kept). */
export async function setBrandLogo(db: Db, tenantId: string, bytes: Uint8Array) {
  if (!bytes.length) throw new Error("Choose a logo file.");
  if (bytes.length > MAX_LOGO_BYTES) throw new Error("The logo is larger than 3 MB. Use a smaller file.");
  let out: { data: Buffer; info: { width: number; height: number } };
  try {
    out = await sharp(Buffer.from(bytes), { density: 300 }).rotate().trim({ threshold: 1 }).resize({ ...LOGO_BOX, fit: "inside", withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
  } catch {
    throw new Error("That file isn't an image we can read. Use a PNG, JPG, WebP or SVG.");
  }
  await upsert(db, tenantId, { logoPng: out.data.toString("base64"), logoWidth: out.info.width, logoHeight: out.info.height });
}

export async function removeBrandLogo(db: Db, tenantId: string) {
  await upsert(db, tenantId, { logoPng: null, logoWidth: null, logoHeight: null });
}

/** The logo as a data address for pages (it is small). */
export const logoDataUrl = (b: Brand) => (b.logo ? `data:image/png;base64,${Buffer.from(b.logo.png).toString("base64")}` : null);

// ---------------------------------------------------------------- how the reference and version read on quotes

export const DEFAULT_VERSION_FORMAT = "{ref} | v{n}";
/** Ready-made formats; the broker can also write their own with {ref} and {n} (or {nn} for 01, 02…). */
export const VERSION_FORMATS = ["{ref} | v{n}", "{ref} Rev.{n}", "{ref}-{nn}", "{ref} Version {n}", "{ref}/V{nn}"];

export const validVersionFormat = (f: string) => f.length <= 60 && f.includes("{ref}") && /\{nn?\}/.test(f) && !/[\r\n<>]/.test(f);

/** "AM-2611-003 | v2", "AM-2611-003 Rev.2", "AM-2611-003-02"… */
export const formatVersion = (format: string, reference: string, version: number) =>
  (validVersionFormat(format) ? format : DEFAULT_VERSION_FORMAT).replaceAll("{ref}", reference).replaceAll("{nn}", String(version).padStart(2, "0")).replaceAll("{n}", String(version));

/** The same, safe as a file name: "AM-2611-003-v2.pdf". */
export const versionFileName = (format: string, reference: string, version: number) =>
  `${formatVersion(format, reference, version).replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || reference}.pdf`;

export async function setVersionFormat(db: Db, tenantId: string, format: string) {
  const f = format.trim();
  if (!validVersionFormat(f)) throw new Error("The format needs {ref} and {n} (or {nn}), e.g. “{ref} Rev.{n}”.");
  await upsert(db, tenantId, { versionFormat: f });
}
