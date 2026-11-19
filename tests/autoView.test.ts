import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { looksLikeFloorPlan, pictureStats, scanView } from "../src/domain/autoView";
import { guessClassificationFromFilename, parseClassification } from "../src/domain/constants";

/** A floor-plan-like drawing: white page, grey outline, a few coloured seats. */
async function drawing(width = 1200, height = 300) {
  const seats = Array.from({ length: 8 }, (_, i) => `<rect x="${150 + i * 110}" y="110" width="60" height="80" fill="#c9b18a"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#fff"/>
    <path d="M40 150 Q80 40 200 60 L1100 60 Q1180 150 1100 240 L200 240 Q80 260 40 150 Z" fill="none" stroke="#555" stroke-width="4"/>${seats}</svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}

/** A photo-like picture: smooth gradients plus noise, like a real camera image. */
async function photo(seed = 1) {
  const w = 320, h = 240, buf = Buffer.alloc(w * h * 3);
  let x = seed * 9973;
  const rnd = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < w * h; i++) {
    const px = i % w, py = Math.floor(i / w);
    buf[i * 3] = Math.min(255, 60 + (px / w) * 120 + rnd() * 40);
    buf[i * 3 + 1] = Math.min(255, 50 + (py / h) * 110 + rnd() * 40);
    buf[i * 3 + 2] = Math.min(255, 40 + ((px + py) / (w + h)) * 90 + rnd() * 40);
  }
  return new Uint8Array(await sharp(buf, { raw: { width: w, height: h, channels: 3 } }).jpeg().toBuffer());
}

describe("Scanning a new photo's view (no AI)", () => {
  it("finds a floor plan drawing by how it is drawn", async () => {
    const s = await pictureStats(await drawing());
    expect(looksLikeFloorPlan(s)).toBe(true);
    expect((await scanView(await drawing(), "IMG_2041.png")).classification).toBe("floor_plan");
  });

  it("does not call a photo a floor plan, and leaves exterior/interior to the broker", async () => {
    for (const seed of [1, 2, 3]) {
      const r = await scanView(await photo(seed), "IMG_1234.jpg");
      expect(r).toEqual({ classification: "unclassified", reason: null });
    }
  });

  it("reads the view from the file name, and folds every room into interior", async () => {
    expect((await scanView(await photo(), "G280 ext 1.jpg")).classification).toBe("exterior");
    expect(guessClassificationFromFilename("galley.jpg")).toBe("interior");
    expect(guessClassificationFromFilename("Cabin_02.jpeg")).toBe("interior");
    expect(guessClassificationFromFilename("floor plan.png")).toBe("floor_plan");
    expect(parseClassification("客艙")).toBe("interior");
    expect(parseClassification("平面圖")).toBe("floor_plan");
  });
});
