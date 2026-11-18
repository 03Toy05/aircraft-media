# Spec amendments (v1.2) and acceptance-test status

Amends `Aircraft_Media_App_Claude_Build_Handoff.md` v1.0. Where this file and the handoff differ, this file governs.

## Amendments agreed with the owner (2026-11-17)

| # | Change |
| --- | --- |
| A1 | **Single-user, private app.** Only the owner signs in (Google, allowlisted by `OWNER_EMAIL`). Broker role, invitations, tenant approvers and multi-tenant onboarding are out of v1. `tenant_id` stays on records with one fixed value so multi-tenant is additive later. |
| A2 | **Rejected review state** added: `received → processing → needs_review → approved \| rejected`, plus `failed`, `partially_processed`. Rejected media can be reopened. |
| A3 | **Alias tables** for operators and aircraft types, deterministic (no AI). Requests matching several records return all matches. Classification aliases from the CBOS Rulebook (Interior/INT → Cabin; Layout/floorplan → Floor plan) are built in. |
| A4 | **No scheduled availability checks.** Availability is computed from approved + active + permitted media. A stored file that fails to read when opened is flagged unavailable and stops counting as available. |
| A5 | Collage separation is **manual cropping**; PDF extraction is deterministic embedded-image extraction (phase 2). |
| A6 | The card shows the **current active operator**. |
| A7 | Tech stack: TypeScript, Next.js, PostgreSQL + Drizzle, Auth.js (Google), in-process jobs on a Postgres table, Render. |
| A8 | WhatsApp number is recorded by the owner in Settings as verified (no OTP message), preserving "no proactive outbound". |
| A10 | **WhatsApp deferred** (owner decision, 2026-11-17): the Share button (native share sheet with photos), Copy card and Download zip replace the need to download repeatedly. Phase 3 remains available later. |
| A11 | Drive import detects changes per folder tree using file ID + revision (skips before download) instead of the account-wide changes feed; confined to descendants of the Aircraft Media root. |
| A12 | **Tail number is optional** when adding an aircraft; it can be added later ("Change tail" keeps history). An operator can also be added with no aircraft. |
| A13 | **Aircraft types carry a category** (very light, light, midsize, super midsize, heavy, ultra long range, executive airliner, turboprop, helicopter, other). About 190 standard types load automatically once per list version; owner types and categories are never overwritten. |
| A14 | **Chocks**, a deterministic (no AI) assistant at `/chat`: reads labelled or dictated text, checks operators, types and tails against the directory (exact matches only; near matches are offered, never assumed), asks one question at a time, and applies nothing until the owner confirms. For an existing aircraft it saves only the details the owner gave, as new versions. Voice input/read-aloud use the browser's speech features. |
| A15 | **Crop can be undone** by switching to an earlier content version (nothing is deleted); approve/reject return to the review queue; rejected photos are listed there. |
| A16 | **Operator region** (optional text; sort and filter on the Operators & aircraft page). **Contacts**: saved people with a preferred messenger; Chocks understands "send the G280 photos to Mr Chan" and opens that person's chat with the card (WhatsApp and SMS/iMessage by number; Telegram and Viber open the chat with the card copied; LINE, WeChat, KakaoTalk and Signal open the app with the card copied). Photos always go through the phone's Share sheet because no messenger link can attach photos. The Catalogue page is removed. |
| A17 | **Quote page** (/quote): choose aircraft, pick one of 12 languages, build the client message from the owner's saved wording, edit each aircraft's block by hand, then copy it or share it with the photos (share sheet, messenger shortcuts, email, saved contacts). Operator, tail, base and notes are hidden unless ticked. The **wording is the owner's own** (/quote/template): a text template per language with fields such as {aircraft}, {yom}, {capacity}, {wifi}, {price}; an empty field drops its line. Hand edits belong to the one message and are kept per aircraft when other aircraft are added; saved wording is never changed by selecting aircraft. Aircraft can store a WIFI detail ("at USD 10/MB"). Translations are the built-in defaults and should be read once by a native speaker. |
| A18 | **Chocks speaks English, Traditional Chinese and Simplified Chinese** (language picker on the chat, remembered on the device). Every sentence is written once in English and looked up in `src/domain/chocksText.ts`; Simplified is made from the Traditional wording by a character table, and a test fails if a sentence has no translation. Chocks also **understands** Chinese: card labels (營運商 / 機型 / 機尾號 / 基地 / 出廠年份 / 翻新年份 / 載客量 / WIFI / 備註 / 地區) in either script whatever the picker says, dictated sentences, answers (是 / 新增 / 確認 / 取消 / 略過), questions, filters and sorting, quote requests and "send to" requests. Voice recognition offers 廣東話, 國語 and 普通话. Names (operators, types, tails) are never translated. Free-form Chinese that these rules do not recognise would need the AI step (phase 4). Wording should be read once by a native speaker. |
| A9 | `media_content_versions.drive_file_id` is generalised to `storage_kind` + `storage_ref` (Drive file ID when kind is `drive`). |

## Phases

1. Core (built) · 2. Share/export, PDF, Drive (built; Drive mock-tested) · 3. WhatsApp (deferred) · 4. Languages + Gemini adapter.

## Acceptance test status

Legend: ✅ passing local test · ⏳ later phase · ➖ replaced by A1/A4

| # | Handoff test | Status | Where |
| --- | --- | --- | --- |
| 1 | Create operator, type, aircraft with full card | ✅ | `tests/directory.test.ts` |
| 2 | Tail change keeps history and identity | ✅ | `tests/directory.test.ts` |
| 3 | One base / several / Floating | ✅ | `tests/directory.test.ts` |
| 4 | Import same file/event twice → one record | ✅ manual upload (same bytes, even renamed) · ✅ Drive folder import twice (mocked Drive; no re-download) | `tests/media.test.ts`, `tests/drive.test.ts` |
| 5 | Same WhatsApp webhook twice | ⏳ deferred (WhatsApp) | |
| 6 | PDF with several images | ✅ original kept; each embedded photo separately reviewable with page + extraction evidence; skipped items reported; repeat is a no-op | `tests/pdf-export.test.ts` |
| 7 | Classify, order, correct, approve | ✅ (also reject/reopen) | `tests/media.test.ts` |
| 8 | Whole flow with Gemini off | ✅ the flow has no AI path at all. Search is covered; WhatsApp retrieval is phase 3 | `tests/media.test.ts` |
| 9 | Swap/mocks the AI adapter | ⏳ phase 4 | |
| 10 | Catalogue states | ✅ actual, representative, partial, needs_review, missing, unavailable. `processing` is implemented but not covered by a test | `tests/media.test.ts` |
| 11 | Stale/inaccessible reference not shown as available | ✅ reduced per A4 (detected on read), local and mocked-Drive | `tests/media.test.ts`, `tests/drive.test.ts` |
| 12 | Exact WhatsApp request → card + exact media | ⏳ deferred (WhatsApp) | |
| 13 | Clarify when several aircraft match | ⏳ deferred (WhatsApp) (resolution returning all matches is ✅ now) | `tests/directory.test.ts` |
| 14 | Cross-tenant isolation | ➖ replaced: owner-only access, tenant-scoped reads | `tests/access.test.ts` |
| 15 | Retry partially failed send | ⏳ deferred (WhatsApp) | |
| 16 | Retire/restore without changing history | ✅ (no deliveries exist yet; content versions verified unchanged) | `tests/media.test.ts` |
| 17 | Card across all languages | ⏳ phase 4 (English parse/format ✅) | `tests/directory.test.ts` |
| 18 | Reject reused idempotency key | ✅ | `tests/directory.test.ts` |

Test environment: PGlite (a real PostgreSQL engine, in-process) with the generated SQL migrations. Not yet run against a hosted PostgreSQL. **Drive tests use a simulated Drive API, not live Google.**
