# Action contract (phase 1)

Phase 1 exposes actions as Next.js server actions (`app/actions.ts`) over the domain functions in `src/domain/`,
plus one HTTP route. The HTTP resource API in handoff §18 arrives with the WhatsApp webhook in phase 3.

## Rules shared by every action
- **Authenticated actor:** every page, server action and route starts with `requireOwner()` (Google session, or the local dev bypass). `actor_id` is recorded on every mutation.
- **Idempotency:** each action runs through `runAction` with a key. Same key + same input → the original recorded result is returned and nothing executes again (`replayed: true`). Same key + different input → `IDEMPOTENCY_KEY_REUSED`, nothing executes. A previously failed key may be retried. A key still in flight → `IN_PROGRESS`. Forms carry a fresh key per render, so a double-click is one action.
- **Atomicity:** each handler runs in one database transaction; a failure leaves no partial writes and records `failed` with a user-safe message.
- **Versioning:** records that can be edited carry a version; a stale `expectedVersion` → `VERSION_MISMATCH`.
- **Evidence:** each change cites a `source_evidence` row (manual entry or the uploaded file).

## Actions

| Action | Key | Input | Key rules / effects | Errors |
| --- | --- | --- | --- | --- |
| `organisation.create` | client | name, roles, aliases | unique active normalised name | `DUPLICATE_ORGANISATION` |
| `organisation.addAlias` | client | organisationId, alias | alias stored normalised | `NOT_FOUND` |
| `aircraftType.create` | client | manufacturer, model, aliases | model alone is auto-aliased ("G650ER" ↔ "Gulfstream G650ER") | `DUPLICATE_AIRCRAFT_TYPE` |
| `aircraftType.addAlias` | client | aircraftTypeId, alias | | `NOT_FOUND` |
| `aircraft.create` | client | typeId, registration, serial?, operatorId?, base?, info?, tailResolution? | creates aircraft + current registration (+ info v1, bases, operator). Never identifies by tail alone | `TAIL_IN_USE` (needs `tailResolution: distinct_aircraft`), `DUPLICATE_AIRCRAFT` (same type+serial) |
| `aircraft.changeRegistration` | client | aircraftId, newRegistration, effectiveDate? | closes current registration, adds new current one; same aircraft id; at most one current | `TAIL_IN_USE`, `INVALID` |
| `aircraft.addInformationVersion` | client | aircraftId, expectedVersion, info | new version; previous kept, `is_current` moves | `VERSION_MISMATCH` |
| `aircraft.setBases` | client | aircraftId, base{mode, locations} | `based` needs ≥1 location; `floating` needs none and is exclusive; earlier rows kept inactive | `INVALID` |
| `aircraftType.setCategory` | client | aircraftTypeId, category | category must be one of the known categories | `INVALID` |
| `aircraftType.loadStandard` | `auto:<list version>` (or client) | list version | adds missing standard types; existing types and categories untouched | |
| `aircraft.setOperator` | client | aircraftId, organisationId | one current operator; previous relationship ended, kept | `NOT_FOUND` |
| `aircraft.addManagementCompany` | client | aircraftId, organisationId | additive; no ownership implied | |
| `media.upload` | `sha256:<hash>` | file bytes, optional card text | validates image type/size; stores original; evidence + media (`needs_review`, unclassified, unresolved) + content v1; card → pending proposal. Same bytes again → original result | `INVALID` |
| `media.uploadPdf` | `pdf:sha256:<hash>` or `pdf:drive:<fileId>:<rev>` | PDF bytes, optional card text | keeps the complete original as evidence; extracts each embedded photo as its own `needs_review` media with page + extraction version; reports skipped images as `partially_succeeded`. Repeat returns the original result | `INVALID` (not a PDF / unreadable) |
| `media.importDrive` | `drive:<fileId>:<revision>` | Drive file (image) | references the original in Drive in place; same file + revision is a no-op; a new revision makes new media | `INVALID` |
| `media.updateMetadata` | client | mediaId, expectedVersion, classification?, displayOrder?, rightsStatus? | changing classification on approved media returns it to review | `VERSION_MISMATCH` |
| `media.setAssociation` | client | mediaId, expectedVersion, status, aircraftId / aircraftTypeId | actual needs an aircraft; representative needs a type; previous association kept inactive; approved → review | `INVALID`, `VERSION_MISMATCH` |
| `media.approve` | `<contentVersionId>:v<ver>:<actor>` | mediaId, contentVersionId, expectedVersion | needs classification ≠ unclassified and association ≠ unresolved; media active; content version must be the current one | `INVALID`, `CONTENT_CHANGED`, `MEDIA_RETIRED`, `NOT_IN_REVIEW` |
| `media.reject` / `media.reopen` | client | mediaId, expectedVersion, reason? | rejected ↔ needs_review | `NOT_IN_REVIEW`, `NOT_REJECTED` |
| `media.retire` / `media.restore` | client | mediaId | logical only; approval and content untouched | |
| `media.recrop` | per-submission key (default `<sourceVersion>:<x,y,w,h>:manual-crop-1`) | mediaId, sourceContentVersionId, rect | new derivative content version; earlier kept; crop evidence recorded; approved → review | `INVALID`, `CONTENT_CHANGED` |
| `media.useVersion` | client | mediaId, contentVersionId, expectedVersion | undo a crop / switch to an earlier content version; nothing deleted; approved → review | `VERSION_MISMATCH`, `MEDIA_RETIRED` |
| `media.extractCrop` | `<sourceVersion>:p1:<x,y,w,h>:manual-crop-1` | same | new, separately reviewable media from a collage; original untouched | `INVALID` |
| `whatsapp.addVerifiedNumber` / `deactivateNumber` | client | phone / numberId | one active record per number | `NUMBER_IN_USE` |
| `user.setLanguage` | client | language | one of 7 supported codes | `INVALID` |

## Chocks (assistant, `/chat`)
Not an action itself. Each message is one server call that stores any attached photos (`media.upload`, waiting in Review) and returns Chocks' reply; the conversation state (the draft) travels with the browser. Nothing is created or approved until the owner confirms, which then runs the normal actions with keys derived from one submission key: `organisation.create`, `organisation.addAlias`, `aircraft.create` (tail optional) or, for an existing aircraft, `aircraft.addInformationVersion` / `setBases` / `setOperator` for the provided fields only, then per photo `media.updateMetadata`, `media.setAssociation`, `media.approve`. A failed step is reported and the others still run.

## Drive import (not a single action)
`importDriveFolder` lists one folder tree inside the root (refusing others), then runs each file as its own idempotent action (`media.importDrive` / `media.uploadPdf`), skipping already-imported revisions before download. Per-file outcomes: imported, already imported, unsupported, failed. A failure does not affect other files and a retry repeats only that file. Bookkeeping lives in `drive_sync_state`.

## HTTP
- `GET /api/media/{contentVersionId}` — owner-only, streams the exact stored bytes server-side (no storage URLs exposed). `404` if not found/not in tenant, `410` if the bytes cannot be read (the version is then flagged unavailable).

- `GET /api/aircraft/{id}/export?views=cabin,floor_plan`: owner-only zip of the compact card (`aircraft-card.txt`) and the approved, active photos in lineup order, named like `CABIN 1 - B-KXX.jpg`; type-level photos are marked `(representative)`.

## Outcomes
Recorded in `action_executions.status`: `succeeded`, `failed`, and `partially_succeeded` (PDF intake with skipped images). `outcome_uncertain` is reserved for external sends (WhatsApp, deferred).
