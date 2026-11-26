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
  "app/_components/TopNav.tsx",
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
  "app/(app)/requests/page.tsx",
  "app/(app)/requests/[id]/page.tsx",
  "app/(app)/fleet/page.tsx",
  "app/(app)/aircraft/[id]/page.tsx",
  "app/(app)/organisations/[id]/page.tsx",
  "app/_components/FleetSearch.tsx",
  "app/_components/AircraftPicker.tsx",
  "app/_components/PlacePicker.tsx",
  "app/_components/SearchSelect.tsx",
  "app/_components/Choice.tsx",
  "app/_components/ViewChoice.tsx",
  "app/_components/MessengerButtons.tsx",
  "app/_components/OperatorContacts.tsx",
  "app/_components/LocalTime.tsx",
  "app/_components/Tr.tsx",
  "app/(app)/review/page.tsx",
  "app/(app)/review/[id]/page.tsx",
  "app/(app)/photos/page.tsx",
  "app/(app)/intake/page.tsx",
  "app/(app)/contacts/page.tsx",
  "app/_components/ReviewSheet.tsx",
  "app/_components/CropTool.tsx",
  "app/_components/UploadForm.tsx",
  "app/_components/PhotoPicker.tsx",
  "app/_components/ShareBox.tsx",
  "app/_components/VoiceCommand.tsx",
  "app/_components/copyText.ts",
  "app/(app)/settings/page.tsx",
  "app/(app)/quote/template/page.tsx",
  "app/(app)/library/page.tsx",
  "app/_components/BrandForm.tsx",
  "app/_components/QuoteTemplateEditor.tsx",
  "app/chatActions.ts",
  "app/supportActions.ts",
  "app/layoutActions.ts",
  "app/start/page.tsx",
  "app/(app)/guide/page.tsx",
  "app/unsubscribe/page.tsx",
  "app/adminMailActions.ts",
  "app/_components/QuoteLayoutCard.tsx",
  "app/(app)/support/page.tsx",
  "app/api/quote/preview-pdf/route.ts",
  "app/(app)/admin/page.tsx",
  "app/(app)/admin/speed/page.tsx",
  "app/(app)/library/import/page.tsx",
  "app/(app)/library/review/page.tsx",
  "app/_components/InviteCopy.tsx",
  "app/api/aircraft/[id]/export/route.ts",
  "app/privacy/page.tsx",
  "app/terms/page.tsx",
];
/** Core logic whose error messages are shown translated (DomainError templates). */
const DOMAIN = [
  "src/domain/accounts.ts",
  "src/domain/contacts.ts",
  "src/domain/directory.ts",
  "src/domain/intake.ts",
  "src/domain/media.ts",
  "src/domain/messengers.ts",
  "src/domain/quoteTemplates.ts",
  "src/lib/session.ts",
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
  "Very light jet",
  "Light jet",
  "Midsize jet",
  "Super midsize jet",
  "Heavy (large) jet",
  "Ultra long range jet",
  "Executive airliner",
  "Turboprop",
  "Helicopter",
  "Other",
  "Default",
  "Newest (YOM)",
  "Oldest (YOM)",
  "Most recently refurbished (YOR)",
  "Oldest refurbishment (YOR)",
  "Most seats",
  "Fewest seats",
  "WIFI (yes first)",
  "Type A–Z",
  "Yes",
  "No",
  "Unknown",
  "Exterior",
  "Cabin",
  "Floor plan",
  "Combined",
  "All",
  "Aircraft",
  "Operator",
  "Tail number",
  "Base",
  "Capacity",
  "Smoking",
  "Pets",
  "Cleaning fee",
  "Notes",
  "at least 1 exterior, 2 cabin and 1 floor plan photo",
  "EXT",
  "CABIN",
  "FLOOR PLAN",
  "COMBINED",
  "UNCLASSIFIED",
  "Permitted",
  "Restricted",
  "This exact aircraft",
  "The aircraft type",
  "Unresolved",
  "Replace (can be undone)",
  "Separate as a new photo",
  "TBC",
  "No WIFI",
  "WIFI TBC",
  "the aircraft number, only when quoting several (\" 1\", \" 2\")",
  "manufacturer and model",
  "tail number (only if “Show the tail number” is ticked)",
  "operator (only if “Show the operator” is ticked)",
  "base (only if “Show the base” is ticked)",
  "year of manufacture",
  "year of refurbishment",
  "seats, for example “13 seats”",
  "just the number of seats",
  "Yes / No / TBC, plus the WIFI details you saved",
  "smoking allowed or not",
  "pets allowed or not",
  "the cleaning fee you saved",
  "notes (only if “Show notes” is ticked)",
  "the price, left empty for you to fill in",
  "The aircraft block must contain {aircraft}, otherwise the message would not say which aircraft it is about",
  "The seats pattern must contain {n}, for example “{n} seats”",
  "Only the admin can import from the Google Drive folder. Upload your photos instead.",
  "Google Drive is not connected yet (see the configuration guide).",
  "Tick at least one photo to accept.",
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

  it("has Traditional Chinese for every error message the core logic shows", () => {
    const templates = DOMAIN.flatMap((file) => {
      const src = readFileSync(path.join(root, file), "utf8");
      return [...src.matchAll(/(?:\binvalid\(\s*|\bconflict\(\s*"\w+",\s*|new DomainError\(\s*"\w+",\s*|\bnotFound\(\s*)"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`));
    });
    expect(templates.length).toBeGreaterThan(40);
    expect([...new Set(templates)].filter((k) => UI_HANT[k] === undefined)).toEqual([]);
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
