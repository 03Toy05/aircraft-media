import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  ACTION_STATUSES,
  ASSOCIATION_STATUSES,
  BASE_MODES,
  CLASSIFICATIONS,
  LIFECYCLE_STATES,
  ORG_ROLES,
  PROPOSAL_STATES,
  REVIEW_STATES,
  RIGHTS_STATUSES,
  SOURCE_KINDS,
  WIFI_STATUSES,
  YES_NO_STATUSES,
} from "../domain/constants";

// ---- enums (canonical keys stored once; translation is display only) ----
export const orgRoleEnum = pgEnum("org_role", ORG_ROLES);
export const wifiEnum = pgEnum("wifi_status", WIFI_STATUSES);
export const yesNoEnum = pgEnum("yes_no_status", YES_NO_STATUSES);
export const baseModeEnum = pgEnum("base_mode", BASE_MODES);
export const sourceKindEnum = pgEnum("source_kind", SOURCE_KINDS);
export const classificationEnum = pgEnum("media_classification", CLASSIFICATIONS);
export const reviewStateEnum = pgEnum("review_state", REVIEW_STATES);
export const lifecycleEnum = pgEnum("lifecycle_state", LIFECYCLE_STATES);
export const associationEnum = pgEnum("association_status", ASSOCIATION_STATUSES);
export const rightsEnum = pgEnum("rights_status", RIGHTS_STATUSES);
export const proposalStateEnum = pgEnum("proposal_state", PROPOSAL_STATES);
export const actionStatusEnum = pgEnum("action_status", ACTION_STATUSES);

const pk = () => uuid("id").primaryKey().defaultRandom();
const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ---- access ----
export const users = pgTable(
  "users",
  {
    id: pk(),
    tenantId: uuid("tenant_id").notNull(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role").notNull().default("owner"), // each user owns their own workspace (tenant)
    preferredLanguage: text("preferred_language").notNull().default("en"),
    /** invited (not signed in yet) | active | blocked */
    status: text("status").notNull().default("active"),
    /** trial: may add and change things until trialEndsAt, read-only after | full: no time limit */
    plan: text("plan").notNull().default("full"),
    /** Set at the first sign-in for trial users (first sign-in + the trial length). */
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    firstSignInAt: timestamp("first_sign_in_at", { withTimezone: true }),
    lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
    invitedBy: uuid("invited_by"),
    /** Shares this workspace's approved photos with the platform library (off until the user turns it on). */
    libraryOptIn: boolean("library_opt_in").notNull().default(false),
    /** May use the platform library (browse, quote from it, add to their workspace). The admin turns it on per person. */
    libraryAccess: boolean("library_access").notNull().default(false),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex("users_tenant_email_uq").on(t.tenantId, t.email), uniqueIndex("users_email_uq").on(t.email)],
);

export const verifiedWhatsappNumbers = pgTable(
  "verified_whatsapp_numbers",
  {
    id: pk(),
    tenantId: uuid("tenant_id").notNull(),
    userId: uuid("user_id").notNull().references(() => users.id),
    phone: text("phone").notNull(), // normalised digits, E.164 without "+"
    verificationStatus: text("verification_status").notNull().default("pending"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex("wa_active_phone_uq").on(t.tenantId, t.phone).where(sql`${t.active}`),
  ],
);

// ---- evidence ----
export const sourceEvidence = pgTable(
  "source_evidence",
  {
    id: pk(),
    tenantId: uuid("tenant_id").notNull(),
    sourceKind: sourceKindEnum("source_kind").notNull(),
    providerSourceId: text("provider_source_id"), // Drive file ID / WhatsApp message ID
    originalFilename: text("original_filename"),
    originalDriveFileId: text("original_drive_file_id"),
    originalDriveVersion: text("original_drive_version"),
    parentEvidenceId: uuid("parent_evidence_id"),
    pageNumber: integer("page_number"),
    cropRef: jsonb("crop_ref").$type<{ x: number; y: number; width: number; height: number; extractionVersion: string } | null>(),
    senderId: text("sender_id"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    originalText: text("original_text"),
    contentHash: text("content_hash"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    lifecycleStatus: text("lifecycle_status").notNull().default("retained"),
    createdAt: created(),
  },
  (t) => [index("evidence_hash_idx").on(t.tenantId, t.contentHash)],
);

// ---- organisations ----
export const organisations = pgTable(
  "organisations",
  {
    id: pk(),
    tenantId: uuid("tenant_id").notNull(),
    canonicalName: text("canonical_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    region: text("region"),
    /** The operator's usual base, free text ("Hong Kong, Singapore"). New aircraft for this operator start with it. */
    base: text("base"),
    /** 1–5 when the owner pinned this operator as a preferred one (shown first on the Quote page); null otherwise. */
    preferredRank: integer("preferred_rank"),
    active: boolean("active").notNull().default(true),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex("org_tenant_norm_uq").on(t.tenantId, t.normalizedName).where(sql`${t.active}`)],
);

/** The owner's own wording for the quotation message, one row per language (see src/domain/quote.ts). */
export const quoteTemplates = pgTable(
  "quote_templates",
  {
    id: pk(),
    tenantId: uuid("tenant_id").notNull(),
    language: text("language").notNull(),
    /** JSON: only the parts the owner changed; everything else follows the built-in default. */
    template: text("template").notNull(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex("quote_template_uq").on(t.tenantId, t.language)],
);

/** People the owner sends aircraft cards to, with the messenger each one prefers. */
export const contacts = pgTable("contacts", {
  id: pk(),
  tenantId: uuid("tenant_id").notNull(),
  /** CBOS Rulebook B1.2 Person reference, PER-{initials}-{number}: allocated once, never changed or reused. */
  reference: text("reference"),
  name: text("name").notNull(),
  /** The English name the reference's initials came from (kept as allocated, per the Rulebook). */
  englishName: text("english_name"),
  normalizedName: text("normalized_name").notNull(),
  app: text("app").notNull(),
  handle: text("handle"),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [uniqueIndex("contact_reference_uq").on(t.tenantId, t.reference)]);

export const organisationAliases = pgTable(
  "organisation_aliases",
  {
    id: pk(),
    organisationId: uuid("organisation_id").notNull().references(() => organisations.id),
    alias: text("alias").notNull(),
    normalizedAlias: text("normalized_alias").notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex("org_alias_uq").on(t.organisationId, t.normalizedAlias)],
);

export const organisationRoles = pgTable("organisation_roles", {
  id: pk(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id),
  role: orgRoleEnum("role").notNull(),
  validFrom: date("valid_from"),
  validTo: date("valid_to"),
  sourceEvidenceId: uuid("source_evidence_id").references(() => sourceEvidence.id),
  active: boolean("active").notNull().default(true),
});

// ---- aircraft types and aircraft ----
export const aircraftTypes = pgTable(
  "aircraft_types",
  {
    id: pk(),
    tenantId: uuid("tenant_id").notNull(),
    manufacturer: text("manufacturer").notNull(),
    model: text("model").notNull(),
    normalizedName: text("normalized_name").notNull(),
    category: text("category"),
    active: boolean("active").notNull().default(true),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex("type_tenant_norm_uq").on(t.tenantId, t.normalizedName).where(sql`${t.active}`)],
);

export const aircraftTypeAliases = pgTable(
  "aircraft_type_aliases",
  {
    id: pk(),
    aircraftTypeId: uuid("aircraft_type_id").notNull().references(() => aircraftTypes.id),
    alias: text("alias").notNull(),
    normalizedAlias: text("normalized_alias").notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex("type_alias_uq").on(t.aircraftTypeId, t.normalizedAlias)],
);

export const aircraft = pgTable(
  "aircraft",
  {
    id: pk(),
    tenantId: uuid("tenant_id").notNull(),
    aircraftTypeId: uuid("aircraft_type_id").notNull().references(() => aircraftTypes.id),
    serialNumber: text("serial_number"),
    active: boolean("active").notNull().default(true),
    createdSourceEvidenceId: uuid("created_source_evidence_id").references(() => sourceEvidence.id),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex("aircraft_type_serial_uq")
      .on(t.tenantId, t.aircraftTypeId, t.serialNumber)
      .where(sql`${t.serialNumber} is not null and ${t.active}`),
  ],
);

export const aircraftRegistrations = pgTable(
  "aircraft_registrations",
  {
    id: pk(),
    aircraftId: uuid("aircraft_id").notNull().references(() => aircraft.id),
    registration: text("registration").notNull(),
    normalizedRegistration: text("normalized_registration").notNull(),
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
    isCurrent: boolean("is_current").notNull().default(true),
    sourceEvidenceId: uuid("source_evidence_id").references(() => sourceEvidence.id),
    version: integer("version").notNull().default(1),
    recordedBy: uuid("recorded_by").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // At most one current registration per aircraft.
    uniqueIndex("reg_one_current_uq").on(t.aircraftId).where(sql`${t.isCurrent}`),
    index("reg_norm_idx").on(t.normalizedRegistration),
  ],
);

export const aircraftInformationVersions = pgTable(
  "aircraft_information_versions",
  {
    id: pk(),
    aircraftId: uuid("aircraft_id").notNull().references(() => aircraft.id),
    versionNumber: integer("version_number").notNull(),
    yom: integer("yom"), // null = unknown
    yor: integer("yor"),
    capacity: integer("capacity"),
    wifiStatus: wifiEnum("wifi_status").notNull().default("unknown"),
    /** Free text about the WIFI, e.g. "at USD 10/MB". Shown after Yes/No in the quote. */
    wifiDetail: text("wifi_detail"),
    /** Smoking and pets allowed on board, and the cleaning fee that goes with them (free text, e.g. "USD 500"). */
    smoking: yesNoEnum("smoking").notNull().default("unknown"),
    pets: yesNoEnum("pets").notNull().default("unknown"),
    cleaningFee: text("cleaning_fee"),
    notes: text("notes"),
    sourceEvidenceId: uuid("source_evidence_id").references(() => sourceEvidence.id),
    effectiveDate: date("effective_date"),
    createdBy: uuid("created_by").notNull(),
    createdAt: created(),
    isCurrent: boolean("is_current").notNull().default(true),
  },
  (t) => [
    uniqueIndex("info_version_uq").on(t.aircraftId, t.versionNumber),
    uniqueIndex("info_one_current_uq").on(t.aircraftId).where(sql`${t.isCurrent}`),
  ],
);

export const aircraftBases = pgTable(
  "aircraft_bases",
  {
    id: pk(),
    aircraftId: uuid("aircraft_id").notNull().references(() => aircraft.id),
    mode: baseModeEnum("mode").notNull(),
    location: text("location"), // null when floating
    displayOrder: integer("display_order").notNull().default(0),
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
    sourceEvidenceId: uuid("source_evidence_id").references(() => sourceEvidence.id),
    active: boolean("active").notNull().default(true),
    recordedBy: uuid("recorded_by").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("base_aircraft_idx").on(t.aircraftId)],
);

export const organisationAircraftRelationships = pgTable(
  "organisation_aircraft_relationships",
  {
    id: pk(),
    organisationId: uuid("organisation_id").notNull().references(() => organisations.id),
    aircraftId: uuid("aircraft_id").notNull().references(() => aircraft.id),
    role: orgRoleEnum("role").notNull(),
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
    sourceEvidenceId: uuid("source_evidence_id").references(() => sourceEvidence.id),
    active: boolean("active").notNull().default(true),
    version: integer("version").notNull().default(1),
    recordedBy: uuid("recorded_by").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One current operator per aircraft ("current active operator" on the card).
    uniqueIndex("rel_one_active_operator_uq")
      .on(t.aircraftId)
      .where(sql`${t.active} and ${t.role} = 'operator'`),
    index("rel_org_idx").on(t.organisationId),
  ],
);

// ---- media ----
export const aircraftMedia = pgTable(
  "aircraft_media",
  {
    id: pk(),
    tenantId: uuid("tenant_id").notNull(),
    currentContentVersionId: uuid("current_content_version_id"), // set after first content version insert
    primaryClassification: classificationEnum("primary_classification").notNull().default("unclassified"),
    displayOrder: integer("display_order").notNull().default(0),
    reviewState: reviewStateEnum("review_state").notNull().default("received"),
    lifecycleState: lifecycleEnum("lifecycle_state").notNull().default("active"),
    associationStatus: associationEnum("association_status").notNull().default("unresolved"),
    rightsStatus: rightsEnum("rights_status").notNull().default("unknown"),
    rejectionReason: text("rejection_reason"),
    createdSourceEvidenceId: uuid("created_source_evidence_id").references(() => sourceEvidence.id),
    version: integer("version").notNull().default(1), // optimistic concurrency for metadata changes
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("media_state_idx").on(t.tenantId, t.reviewState, t.lifecycleState)],
);

export const mediaContentVersions = pgTable(
  "media_content_versions",
  {
    id: pk(),
    aircraftMediaId: uuid("aircraft_media_id").notNull().references(() => aircraftMedia.id),
    versionNumber: integer("version_number").notNull(),
    // storage_kind 'drive' => storage_ref is the Google Drive file ID (phase 2). 'local' is dev/test storage.
    storageKind: text("storage_kind").notNull().default("local"),
    storageRef: text("storage_ref").notNull(),
    driveRevision: text("drive_revision"),
    contentHash: text("content_hash").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    isDerivative: boolean("is_derivative").notNull().default(false),
    parentContentVersionId: uuid("parent_content_version_id"),
    sourceEvidenceId: uuid("source_evidence_id").references(() => sourceEvidence.id),
    unavailableAt: timestamp("unavailable_at", { withTimezone: true }), // set when bytes failed to load
    createdBy: uuid("created_by").notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex("content_version_uq").on(t.aircraftMediaId, t.versionNumber)],
);

export const mediaAssociations = pgTable(
  "media_associations",
  {
    id: pk(),
    aircraftMediaId: uuid("aircraft_media_id").notNull().references(() => aircraftMedia.id),
    aircraftId: uuid("aircraft_id").references(() => aircraft.id),
    aircraftTypeId: uuid("aircraft_type_id").references(() => aircraftTypes.id),
    organisationId: uuid("organisation_id").references(() => organisations.id),
    associationStatus: associationEnum("association_status").notNull(),
    sourceEvidenceId: uuid("source_evidence_id").references(() => sourceEvidence.id),
    reviewedBy: uuid("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("assoc_one_active_uq").on(t.aircraftMediaId).where(sql`${t.active}`),
    index("assoc_aircraft_idx").on(t.aircraftId),
    index("assoc_type_idx").on(t.aircraftTypeId),
  ],
);

// ---- optional AI assistance (never authoritative) ----
export const processingProposals = pgTable("processing_proposals", {
  id: pk(),
  tenantId: uuid("tenant_id").notNull(),
  sourceEvidenceId: uuid("source_evidence_id").references(() => sourceEvidence.id),
  aircraftMediaId: uuid("aircraft_media_id").references(() => aircraftMedia.id),
  proposalType: text("proposal_type").notNull(), // details | crop | classification | association | request_interpretation
  provider: text("provider").notNull(),
  model: text("model"),
  proposal: jsonb("proposal").$type<Record<string, unknown>>().notNull(),
  confidence: text("confidence"),
  evidence: jsonb("evidence").$type<unknown>(),
  state: proposalStateEnum("state").notNull().default("pending"),
  reviewedBy: uuid("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: created(),
});

// ---- action history / idempotency ----
export const actionExecutions = pgTable(
  "action_executions",
  {
    id: pk(),
    tenantId: uuid("tenant_id").notNull(),
    userId: uuid("user_id"),
    actionName: text("action_name").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    inputFingerprint: text("input_fingerprint").notNull(),
    status: actionStatusEnum("status").notNull().default("pending"),
    result: jsonb("result").$type<unknown>(),
    safeError: text("safe_error"),
    createdAt: created(),
    updatedAt: updated(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("action_idem_uq").on(t.tenantId, t.actionName, t.idempotencyKey)],
);

// ---- WhatsApp delivery ledger (used from phase 3) ----
export const whatsappDeliveries = pgTable("whatsapp_deliveries", {
  id: pk(),
  tenantId: uuid("tenant_id").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id),
  verifiedNumberId: uuid("verified_number_id").references(() => verifiedWhatsappNumbers.id),
  requestMessageId: text("request_message_id").notNull(),
  aircraftId: uuid("aircraft_id").references(() => aircraft.id),
  organisationId: uuid("organisation_id").references(() => organisations.id),
  informationVersionId: uuid("information_version_id").references(() => aircraftInformationVersions.id),
  items: jsonb("items")
    .$type<
      Array<{
        contentVersionId: string;
        order: number;
        providerMessageId?: string;
        status: "pending" | "accepted" | "delivered" | "read" | "failed" | "uncertain";
      }>
    >()
    .notNull()
    .default([]),
  actionExecutionId: uuid("action_execution_id").references(() => actionExecutions.id),
  createdAt: created(),
  updatedAt: updated(),
});

// ---- Google Drive import bookkeeping (phase 2) ----
export const driveSyncState = pgTable(
  "drive_sync_state",
  {
    id: pk(),
    tenantId: uuid("tenant_id").notNull(),
    folderId: text("folder_id").notNull(), // a folder inside the Aircraft Media root
    folderName: text("folder_name"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastSummary: jsonb("last_summary").$type<Record<string, unknown>>(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex("drive_sync_folder_uq").on(t.tenantId, t.folderId)],
);

// ---- quotes handed to another app (the share sheet completed, or the message copied) ----
// The phone cannot say whether the message was then sent, so this counts quotes shared out, not quotes delivered.
export const quoteShares = pgTable(
  "quote_shares",
  {
    id: pk(),
    tenantId: uuid("tenant_id").notNull(),
    userId: uuid("user_id").notNull(),
    /** One quote: shares of the same quote (option by option, or again later) count once. */
    quoteKey: text("quote_key").notNull(),
    /** share | copy */
    how: text("how").notNull(),
    /** How many aircraft options the quote had. */
    options: integer("options").notNull().default(1),
    createdAt: created(),
  },
  (t) => [index("quote_shares_tenant_idx").on(t.tenantId, t.createdAt)],
);

// ---- the platform library: photos offered from users' workspaces, and what the admin decided ----
export const libraryContributions = pgTable(
  "library_contributions",
  {
    id: pk(),
    sourceTenantId: uuid("source_tenant_id").notNull(),
    contributorUserId: uuid("contributor_user_id").notNull(),
    /** Each workspace photo is offered at most once. */
    sourceMediaId: uuid("source_media_id").notNull(),
    sourceContentVersionId: uuid("source_content_version_id").notNull(),
    sourceAircraftId: uuid("source_aircraft_id").notNull(),
    classification: text("classification").notNull(),
    /** Which library aircraft it is for: "tail:BKXX", or "op:tagaviation|type:gulfstreamg650er" when there is no tail. */
    matchKey: text("match_key").notNull(),
    operatorName: text("operator_name"),
    aircraftType: text("aircraft_type").notNull(),
    tail: text("tail"),
    /** pending | accepted | rejected | superseded (the library set filled up first) */
    status: text("status").notNull().default("pending"),
    /** new: fills an empty place in the library set | update: newer photos offered to replace library ones */
    kind: text("kind").notNull().default("new"),
    /** For an accepted update: the library photo it replaced. */
    replacesMediaId: uuid("replaces_media_id"),
    libraryAircraftId: uuid("library_aircraft_id"),
    libraryMediaId: uuid("library_media_id"),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    note: text("note"),
    createdAt: created(),
  },
  (t) => [uniqueIndex("library_contrib_media_uq").on(t.sourceMediaId), index("library_contrib_status_idx").on(t.status, t.matchKey)],
);

// ---- aircraft a user added to their workspace from the library, and which library photos they copied ----
export const libraryCopies = pgTable(
  "library_copies",
  {
    id: pk(),
    tenantId: uuid("tenant_id").notNull(),
    aircraftId: uuid("aircraft_id").notNull(),
    libraryAircraftId: uuid("library_aircraft_id").notNull(),
    /** Each copied photo: the library photo and the copy in the user's workspace. */
    copied: jsonb("copied").$type<{ libraryMediaId: string; mediaId: string }[]>().notNull().default([]),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex("library_copy_aircraft_uq").on(t.tenantId, t.aircraftId)],
);

// ---- CBOS export: the CBOS-named copy of each approved photo (import assistance only, never identity) ----
export const cbosExports = pgTable(
  "cbos_exports",
  {
    id: pk(),
    tenantId: uuid("tenant_id").notNull(),
    aircraftMediaId: uuid("aircraft_media_id").notNull().references(() => aircraftMedia.id),
    /** The content version the copy holds; a re-crop makes a new copy. */
    contentVersionId: uuid("content_version_id").notNull(),
    driveFileId: text("drive_file_id").notNull(),
    driveFolderId: text("drive_folder_id").notNull(),
    /** Folder path and file name, e.g. "CBOS Export/Operator Aircraft/Metrojet/B-KXX/Exterior_01.jpg". */
    path: text("path").notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex("cbos_export_media_uq").on(t.aircraftMediaId)],
);
