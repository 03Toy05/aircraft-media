import sharp from "sharp";
import { guessClassificationFromFilename, type Classification } from "./constants";

/**
 * First-pass view for a new photo, without AI. Only two things are trusted:
 *  1. the file name ("G280 ext 1.jpg", "cabin.png", "floor plan.png"), and
 *  2. how the picture is drawn: a floor plan is a drawing — mostly white, very few colours — which no photo is.
 * Exterior vs interior can't be told reliably from pixels alone, so those stay "unclassified" unless the name says.
 * The broker always confirms before anything is approved.
 */
export interface ViewScan {
  classification: Classification;
  /** Why, in words the broker can read; null when nothing was recognised. */
  reason: string | null;
}

export interface PictureStats {
  /** share of near-white pixels */
  white: number;
  /** how many of 4,096 colour buckets it takes to cover 90% of the picture (drawings: a handful; photos: dozens or more) */
  colours90: number;
  /** average colourfulness 0–255 */
  saturation: number;
  aspect: number;
}

export async function pictureStats(bytes: Uint8Array): Promise<PictureStats> {
  const img = sharp(bytes, { failOn: "none" }).rotate();
  const meta = await img.metadata();
  const { data, info } = await img
    .flatten({ background: "#ffffff" }) // transparent drawings sit on white
    .resize(160, 160, { fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const bins = new Map<number, number>();
  let white = 0;
  let sat = 0;
  for (let i = 0; i < n; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mn > 225 && mx - mn < 25) white++;
    sat += mx - mn;
    const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    bins.set(k, (bins.get(k) ?? 0) + 1);
  }
  const counts = [...bins.values()].sort((a, b) => b - a);
  let covered = 0, colours90 = 0;
  for (const c of counts) {
    covered += c;
    colours90++;
    if (covered >= 0.9 * n) break;
  }
  const w = meta.autoOrient?.width ?? meta.width ?? info.width;
  const h = meta.autoOrient?.height ?? meta.height ?? info.height;
  return { white: white / n, colours90, saturation: sat / n, aspect: w / Math.max(1, h) };
}

/** Pure rule, kept apart so it can be tested on numbers. */
export function looksLikeFloorPlan(s: PictureStats): boolean {
  if (s.colours90 <= 20 && s.white >= 0.35) return true;
  // Long thin side-view layouts with some colour (seats, carpets) on a white page.
  return s.aspect >= 2.2 && s.white >= 0.3 && s.colours90 <= 28 && s.saturation <= 40;
}

export async function scanView(bytes: Uint8Array, filename: string): Promise<ViewScan> {
  const byName = guessClassificationFromFilename(filename);
  if (byName) return { classification: byName, reason: "from the file name" };
  try {
    if (looksLikeFloorPlan(await pictureStats(bytes))) return { classification: "floor_plan", reason: "looks like a floor plan drawing" };
  } catch {
    // An image sharp can't read is reported elsewhere; the scan simply finds nothing.
  }
  return { classification: "unclassified", reason: null };
}
