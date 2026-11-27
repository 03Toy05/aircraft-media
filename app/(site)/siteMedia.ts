import fs from "node:fs";
import path from "node:path";
import type { SiteLang } from "./welcome/copy";

/*
 * The front page's media turn up by themselves once their files are in public/ (nothing else to change):
 *   public/demo/toy-demo.mp4                    the film (H.264/AAC MP4)       required for the player
 *   public/demo/toy-demo-<lang>.mp4             zh-hant, zh-hans               the same film with that language's captions burned in (optional)
 *   public/demo/toy-demo-poster.jpg             still shown before playing    optional
 *   public/demo/captions-<lang>.vtt             en, zh-hant, zh-hans           optional caption tracks
 *   public/demo/transcript-<lang>.txt           en, zh-hant, zh-hans           optional written transcript
 *   public/brand/founder.jpg                    the founder's photo, beside "How it begins"   optional
 *   public/brand/founder.mp4                    the founder's video, in "How it begins" (founder.jpg is its cover)   optional
 *   public/brand/founder-captions-<lang>.vtt    en, zh-hant, zh-hans           optional caption tracks for it
 */
const PUBLIC = path.join(process.cwd(), "public");
const has = (f: string) => fs.existsSync(path.join(PUBLIC, f));

export const CAPTION_LANGS: { lang: SiteLang; srclang: string; label: string }[] = [
  { lang: "en", srclang: "en", label: "English" },
  { lang: "zh-hant", srclang: "zh-Hant", label: "繁體中文" },
  { lang: "zh-hans", srclang: "zh-Hans", label: "简体中文" },
];

/** The demo film in the page's language: toy-demo-<lang>.mp4 when it exists (captions burned in), else the English one. */
export function demoVideo(lang: SiteLang = "en") {
  if (!has("demo/toy-demo.mp4")) return null;
  const own = lang !== "en" && has(`demo/toy-demo-${lang}.mp4`);
  return {
    src: own ? `/demo/toy-demo-${lang}.mp4` : "/demo/toy-demo.mp4",
    poster: has("demo/toy-demo-poster.jpg") ? "/demo/toy-demo-poster.jpg" : undefined,
    captions: CAPTION_LANGS.filter((c) => has(`demo/captions-${c.lang}.vtt`)),
  };
}

export function demoTranscript(lang: SiteLang): string | null {
  const file = [`demo/transcript-${lang}.txt`, "demo/transcript-en.txt"].find(has);
  return file ? fs.readFileSync(path.join(PUBLIC, file), "utf8").trim() : null;
}

export const founderPhoto = () => (has("brand/founder.jpg") ? "/brand/founder.jpg" : null);

/** The founder's own video for "How it begins"; with it, the photo becomes its cover instead of a portrait. */
export function founderVideo() {
  if (!has("brand/founder.mp4")) return null;
  return {
    src: "/brand/founder.mp4",
    poster: founderPhoto() ?? undefined,
    captions: CAPTION_LANGS.filter((c) => has(`brand/founder-captions-${c.lang}.vtt`)),
  };
}

/**
 * "Let me try" with a real aircraft. It is shown only where SHOW_LET_ME_TRY=1 (the local preview); the live site says
 * "coming soon" until the owner releases it. Its files sit in public/try-sample/, which git ignores, so the photos
 * (rights not yet cleared for public use) never reach the live server:
 *   public/try-sample/sample.json   { "photos": ["exterior.jpg", ...],
 *                                     "en" | "zh-hant" | "zh-hans": { "ask", "found", "interior", "labels": [one per photo], "quote" } }
 *   public/try-sample/<photo files>
 */
export type TrySample = { ask: string; found: string; interior: string; photos: { src: string; label: string }[]; quote: string };
export const letMeTryLive = () => process.env.SHOW_LET_ME_TRY === "1";
export function trySample(lang: SiteLang): TrySample | null {
  if (!letMeTryLive() || !has("try-sample/sample.json")) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(PUBLIC, "try-sample/sample.json"), "utf8"));
    const t = raw[lang] ?? raw.en;
    const photos = (raw.photos as string[])
      .map((f, i) => ({ f, label: t.labels?.[i] ?? "" }))
      .filter(({ f }) => has(`try-sample/${f}`))
      .map(({ f, label }) => ({ src: `/try-sample/${encodeURIComponent(f)}`, label }));
    return { ask: t.ask, found: t.found, interior: t.interior, photos, quote: t.quote };
  } catch {
    return null; // a broken file falls back to the placeholder sample rather than breaking the page
  }
}
