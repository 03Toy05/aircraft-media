import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { UI_HANT, UI_HANS_WORDS, toHansUi, ui } from "@/domain/uiText";
import { HANS_SAME, hansMapped } from "@/domain/toyText";

/** The screens that are translated so far. A label added there without its Chinese fails here. */
export const TRANSLATED = [
  "app/(app)/layout.tsx",
  "app/(app)/page.tsx",
  "app/(app)/quote/page.tsx",
  "app/_components/MobileNav.tsx",
  "app/_components/QuoteBuilder.tsx",
  "app/_components/RoutingPanel.tsx",
  "app/_components/ClientLinkButtons.tsx",
  "app/_components/TextBox.tsx",
  "app/_components/uiLang.tsx",
  "app/login/page.tsx",
  "app/login/password/page.tsx",
  "app/login/reset/page.tsx",
  "app/requestActions.ts",
  "app/actions.ts",
];
/** Labels passed through a variable (t(label)), so the scan below can't see them. */
const INDIRECT = [
  "Fleet", "Quote", "Routing", "Operator", "Tail", "Base", "Notes", "Email", "Other apps",
  "A–Z", "Most aircraft", "Newest", "Mine + library", "Mine", "Library",
  "at least 1 exterior, 2 cabin and 1 floor plan photo",
  "That account hasn't been invited yet. Ask the admin to add your email.",
  "Access for this account has been turned off. Contact the admin.",
  "That email and password don't match. Check them, or set a new password below.",
  "Too many wrong tries. Wait 15 minutes, or set a new password below.",
  "That link has expired or was already used. Ask for a new one.",
];

const root = path.resolve(__dirname, "..");
/** Every t("…") / tt.current("…") / serverT())("…") label in a file. */
function labels(file: string): string[] {
  const src = readFileSync(path.join(root, file), "utf8");
  const out: string[] = [];
  for (const m of src.matchAll(/(?:\bt|tt\.current|serverT\(\)\))\(\s*"((?:[^"\\]|\\.)*)"/g)) out.push(JSON.parse(`"${m[1]}"`));
  return out;
}
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("screen wording in Chinese", () => {
  const used = [...new Set([...TRANSLATED.flatMap(labels), ...INDIRECT])];

  it("finds the labels on the translated screens", () => {
    expect(used.length).toBeGreaterThan(200);
  });

  it("has Traditional Chinese for every label on a translated screen", () => {
    expect(used.filter((k) => UI_HANT[k] === undefined)).toEqual([]);
  });

  it("keeps the same {placeholders} in Chinese", () => {
    const wrong = Object.entries(UI_HANT).filter(([en, zh]) => placeholders(en).join() !== placeholders(zh).join()).map(([en]) => en);
    const wrongHans = Object.entries(UI_HANS_WORDS).filter(([en, zh]) => placeholders(en).join() !== placeholders(zh).join()).map(([en]) => en);
    expect([...wrong, ...wrongHans]).toEqual([]);
  });

  it("knows every Chinese character used, so Simplified never keeps a Traditional one", () => {
    // Each character must either convert (the table in toyText.ts) or be written the same in both (HANS_SAME).
    const unknown = new Set<string>();
    for (const zh of Object.values(UI_HANT)) for (const ch of zh) if (/\p{Script=Han}/u.test(ch) && !hansMapped(ch) && !HANS_SAME.has(ch)) unknown.add(ch);
    expect([...unknown].join("")).toBe("");
  });

  it("fills placeholders and falls back to English", () => {
    expect(ui("zh-Hant", "Leg {n}", { n: 2 })).toBe("航段 2");
    expect(ui("zh-Hans", "Leg {n}", { n: 2 })).toBe("航段 2");
    expect(ui("en", "Leg {n}", { n: 2 })).toBe("Leg 2");
    expect(ui("zh-Hant", "A label nobody wrote")).toBe("A label nobody wrote");
    expect(ui("zh-Hans", "Requests")).toBe(toHansUi(UI_HANT.Requests));
  });
});
