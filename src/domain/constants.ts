// Canonical vocabularies. Mirrors the CBOS Rulebook aircraft-media classifications.
// Canonical keys are stored once; labels/aliases are display/search concerns only.

export const FIXED_TENANT_ID = "00000000-0000-0000-0000-000000000001"; // single-tenant v1

/**
 * The views a photo can be: three of the CBOS Rulebook's confirmed canonical classifications (Exterior, Cabin,
 * Floor plan) plus Unclassified. Brokers only need these three. "Interior"/"INT" is the Rulebook's import/search alias
 * for Cabin, not a separate classification. (Migration 0009 folded the older detailed views into one; 0010 names it cabin.)
 */
export const CLASSIFICATIONS = ["exterior", "cabin", "floor_plan", "combined", "unclassified"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

/**
 * "Combined": one picture that already shows several views (exterior, cabin and floor plan together), as operators often
 * send. Not a Rulebook view, so the CBOS export leaves it out; the Quote page can also build one from single photos.
 */
export const CLASSIFICATION_LABEL: Record<Classification, string> = {
  exterior: "EXT",
  cabin: "CABIN",
  floor_plan: "FLOOR PLAN",
  combined: "COMBINED",
  unclassified: "UNCLASSIFIED",
};

/** What a combined photo is made from; it is made only when all of these are approved. */
export const COMBINED_NEEDS = "at least 1 exterior, 2 cabin and 1 floor plan photo";

/** Words for each view, in file names and typed replies (Rulebook aliases included). Every room inside the aircraft counts as cabin. */
export const CLASSIFICATION_ALIASES: Record<string, Classification> = {
  ext: "exterior",
  exterior: "exterior",
  outside: "exterior",
  outer: "exterior",
  ramp: "exterior",
  int: "cabin",
  interior: "cabin",
  inside: "cabin",
  cabin: "cabin",
  seat: "cabin",
  seats: "cabin",
  seating: "cabin",
  sleep: "cabin",
  sleeping: "cabin",
  bed: "cabin",
  galley: "cabin",
  lav: "cabin",
  lavatory: "cabin",
  toilet: "cabin",
  flightdeck: "cabin",
  cockpit: "cabin",
  baggage: "cabin",
  floorplan: "floor_plan",
  layout: "floor_plan",
  fp: "floor_plan",
  plan: "floor_plan",
  seatmap: "floor_plan",
  combined: "combined",
  combo: "combined",
  collage: "combined",
  composite: "combined",
  overview: "combined",
  unclassified: "unclassified",
};

/** Aircraft size/class ladder commonly used in business aviation. Sources differ at the edges, so it is editable per type. */
export const AIRCRAFT_CATEGORIES = [
  "very_light_jet",
  "light_jet",
  "midsize_jet",
  "super_midsize_jet",
  "heavy_jet",
  "ultra_long_range_jet",
  "executive_airliner",
  "turboprop",
  "helicopter",
  "other",
] as const;
export type AircraftCategory = (typeof AIRCRAFT_CATEGORIES)[number];

export const AIRCRAFT_CATEGORY_LABEL: Record<AircraftCategory, string> = {
  very_light_jet: "Very light jet",
  light_jet: "Light jet",
  midsize_jet: "Midsize jet",
  super_midsize_jet: "Super midsize jet",
  heavy_jet: "Heavy (large) jet",
  ultra_long_range_jet: "Ultra long range jet",
  executive_airliner: "Executive airliner",
  turboprop: "Turboprop",
  helicopter: "Helicopter",
  other: "Other",
};

/** Suggest a classification from a file name ("G280 Int 1.jpeg" -> cabin). A hint only; null when nothing matches. */
export function guessClassificationFromFilename(filename: string): Classification | null {
  const stem = filename.replace(/\.[a-z0-9]{2,5}$/i, "");
  const words = stem.split(/[^A-Za-z]+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const pair = i + 1 < words.length ? CLASSIFICATION_ALIASES[(words[i] + words[i + 1]).toLowerCase()] : undefined;
    const hit = pair ?? CLASSIFICATION_ALIASES[words[i].toLowerCase()];
    if (hit && hit !== "unclassified") return hit;
  }
  return null;
}

/** Chinese names for the views, Traditional and Simplified. */
const CLASSIFICATION_ZH_ALIASES: [RegExp, Classification][] = [
  [/合併|合并|組合圖|组合图|拼圖|拼图/, "combined"],
  [/平面圖|平面图|佈局|布局/, "floor_plan"],
  [/外觀|外观|機身|机身|外部/, "exterior"],
  [/內部|内部|客艙|客舱|機艙|机舱|室內|室内|座椅|座位|臥室|卧室|睡房|床|廚房|厨房|洗手間|洗手间|廁所|厕所|駕駛艙|驾驶舱|行李艙|行李舱/, "cabin"],
];

/** Parse a user-typed view name ("Floor Plan", "FLOOR PLAN", "interior") into a canonical classification. */
export function parseClassification(text: string): Classification | null {
  for (const [re, c] of CLASSIFICATION_ZH_ALIASES) if (re.test(text)) return c;
  const key = text.toLowerCase().replace(/[^a-z]/g, "");
  return CLASSIFICATION_ALIASES[key] ?? null;
}

export const REVIEW_STATES = [
  "received",
  "processing",
  "needs_review",
  "approved",
  "rejected",
  "failed",
  "partially_processed",
] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

export const LIFECYCLE_STATES = ["active", "retired"] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export const ASSOCIATION_STATUSES = ["actual_aircraft", "representative_type", "unresolved"] as const;
export type AssociationStatus = (typeof ASSOCIATION_STATUSES)[number];

export const RIGHTS_STATUSES = ["permitted", "restricted", "unknown"] as const;
export type RightsStatus = (typeof RIGHTS_STATUSES)[number];

export const WIFI_STATUSES = ["yes", "no", "tbc", "unknown"] as const;
export type WifiStatus = (typeof WIFI_STATUSES)[number];

/** Smoking and pets allowed on board. */
export const YES_NO_STATUSES = ["yes", "no", "unknown"] as const;
export type YesNoStatus = (typeof YES_NO_STATUSES)[number];

export const BASE_MODES = ["based", "floating"] as const;
export type BaseMode = (typeof BASE_MODES)[number];

export const ORG_ROLES = ["operator", "management_company"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const SOURCE_KINDS = ["drive", "whatsapp", "manual", "pdf", "extracted_image"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const ACTION_STATUSES = [
  "pending",
  "succeeded",
  "partially_succeeded",
  "failed",
  "outcome_uncertain",
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const PROPOSAL_STATES = ["pending", "accepted", "rejected", "superseded"] as const;

export const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Catalogue coverage columns. "Required" classes decide actual/representative/partial. */
export const REQUIRED_CLASSES: Classification[] = ["exterior", "cabin", "floor_plan"];

/** Normalise free text for matching: NFKC, lowercase, keep letters/digits (any script). */
export function normalizeKey(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Normalise a tail number/registration: "b-kxx" -> "BKXX". */
export function normalizeRegistration(text: string): string {
  return text.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

/** Display label for a classification at contextual position n (1-based), e.g. "EXT 1". */
export function displayLabel(c: Classification, n: number): string {
  return `${CLASSIFICATION_LABEL[c]} ${n}`;
}
