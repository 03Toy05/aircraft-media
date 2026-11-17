// Canonical vocabularies. Mirrors the CBOS Rulebook aircraft-media classifications.
// Canonical keys are stored once; labels/aliases are display/search concerns only.

export const FIXED_TENANT_ID = "00000000-0000-0000-0000-000000000001"; // single-tenant v1

export const CLASSIFICATIONS = [
  "exterior",
  "cabin",
  "seating",
  "sleeping",
  "galley",
  "lavatory",
  "flight_deck",
  "baggage",
  "floor_plan",
  "other",
  "unclassified",
] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export const CLASSIFICATION_LABEL: Record<Classification, string> = {
  exterior: "EXT",
  cabin: "CABIN",
  seating: "SEAT",
  sleeping: "SLEEP",
  galley: "GALLEY",
  lavatory: "LAV",
  flight_deck: "FLIGHT DECK",
  baggage: "BAGGAGE",
  floor_plan: "FLOOR PLAN",
  other: "OTHER",
  unclassified: "UNCLASSIFIED",
};

// Import/search aliases (Rulebook: Interior/INT -> Cabin; Layout/floorplan -> Floor plan).
export const CLASSIFICATION_ALIASES: Record<string, Classification> = {
  ext: "exterior",
  exterior: "exterior",
  cabin: "cabin",
  interior: "cabin",
  int: "cabin",
  seat: "seating",
  seats: "seating",
  seating: "seating",
  sleep: "sleeping",
  sleeping: "sleeping",
  bed: "sleeping",
  galley: "galley",
  lav: "lavatory",
  lavatory: "lavatory",
  flightdeck: "flight_deck",
  cockpit: "flight_deck",
  baggage: "baggage",
  floorplan: "floor_plan",
  layout: "floor_plan",
  other: "other",
  unclassified: "unclassified",
};

/** Parse a user-typed view name ("Floor Plan", "FLOOR PLAN", "interior") into a canonical classification. */
export function parseClassification(text: string): Classification | null {
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

/**
 * Catalogue coverage columns. "Required" classes decide actual/representative/partial.
 * Deliberately small: exterior, cabin, floor plan are the three the handoff calls out.
 */
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
