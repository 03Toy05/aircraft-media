# ADR-001: AI independence and Drive-versus-database authority

Status: accepted · Date: 2026-11-17

## Context
The app must stay correct and fully usable with no AI, and must keep CBOS-compatible truth (identity, relationships,
versions, history) even though media bytes will live in Google Drive.

## Decisions

### 1. The deterministic backend owns truth
Every change goes through an action in `src/domain/` with explicit input, validation, an idempotency key, version
preconditions where applicable, and a recorded outcome in `action_executions`. UI code only calls these actions.

### 2. AI is optional and proposal-only
- Nothing in the domain imports an AI provider. Phase 1 has none.
- Optional assistance (Gemini, phase 4) sits behind a provider-neutral adapter and can only write rows to
  `processing_proposals` with state `pending`. Authoritative reads never consult that table.
- A proposal becomes fact only when the owner accepts it, which calls the same actions a manual edit calls
  (same validation, same permission, same idempotency).
- The deterministic aircraft-card parser already follows this pattern: parsing stores a pending proposal; creating
  or associating anything is a separate, explicit action.

### 3. The database is authoritative; Drive/local storage only holds bytes
- Aircraft/media identity is an opaque UUID, never a filename, folder path or tail number.
- Classification, association, review state, lifecycle, versions and history live in PostgreSQL.
- `media_content_versions.storage_kind/storage_ref` point at bytes (`drive` + Drive file ID in phase 2).
  A reference is not proof the bytes still exist: when a read fails, the version is flagged `unavailable_at` and stops
  counting as available. Drive folder placement (Sources/Processing/Approved/Retired) is organisational only.
- Original evidence is never overwritten. Crops, separations and corrections create new content versions/derivatives
  that point to their parent; earlier versions stay readable.

### 4. Logical retirement, not deletion
Media is retired (`lifecycle_state`) and can be restored. History, evidence and issued versions remain.

## Consequences
- Switching or removing the AI provider changes no tables or action contracts.
- Losing or moving Drive files degrades availability, never identity or history.
- `storage_ref` replaces the handoff's `drive_file_id` column name so local dev and Drive share one schema; for
  `storage_kind = 'drive'` it holds the Drive file ID.
- Single-user v1 keeps `tenant_id` on records (fixed value) so multi-tenant is an additive change.
