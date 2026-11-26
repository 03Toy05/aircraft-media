import fs from "node:fs";
import path from "node:path";
import type { SiteLang } from "./welcome/copy";

/*
 * The front page's media turn up by themselves once their files are in public/ (nothing else to change):
 *   public/demo/toy-demo.mp4                    the film (H.264/AAC MP4)       required for the player
 *   public/demo/toy-demo-poster.jpg             still shown before playing    optional
 *   public/demo/captions-<lang>.vtt             en, zh-hant, zh-hans           optional caption tracks
 *   public/demo/transcript-<lang>.txt           en, zh-hant, zh-hans           optional written transcript
 *   public/brand/founder.jpg                    the founder's photo, beside "How it begins"   optional
 */
const PUBLIC = path.join(process.cwd(), "public");
const has = (f: string) => fs.existsSync(path.join(PUBLIC, f));

export const CAPTION_LANGS: { lang: SiteLang; srclang: string; label: string }[] = [
  { lang: "en", srclang: "en", label: "English" },
  { lang: "zh-hant", srclang: "zh-Hant", label: "繁體中文" },
  { lang: "zh-hans", srclang: "zh-Hans", label: "简体中文" },
];

export function demoVideo() {
  if (!has("demo/toy-demo.mp4")) return null;
  return {
    src: "/demo/toy-demo.mp4",
    poster: has("demo/toy-demo-poster.jpg") ? "/demo/toy-demo-poster.jpg" : undefined,
    captions: CAPTION_LANGS.filter((c) => has(`demo/captions-${c.lang}.vtt`)),
  };
}

export function demoTranscript(lang: SiteLang): string | null {
  const file = [`demo/transcript-${lang}.txt`, "demo/transcript-en.txt"].find(has);
  return file ? fs.readFileSync(path.join(PUBLIC, file), "utf8").trim() : null;
}

export const founderPhoto = () => (has("brand/founder.jpg") ? "/brand/founder.jpg" : null);
