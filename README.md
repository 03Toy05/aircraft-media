# Aircraft Media

Private, single-owner web app for aircraft photos and aircraft information. It is a standalone app that uses
CBOS meanings (organisation, aircraft type, aircraft, aircraft media, evidence, versions) so its records can be
exported to CBOS later. It never writes to CBOS.

Build specification: `Aircraft_Media_App_Claude_Build_Handoff.md` (v1.0) as amended by
[docs/SPEC-AMENDMENTS.md](docs/SPEC-AMENDMENTS.md) (v1.2: single owner, rejected state, aliases, optional tail, categories, Toy).

## Status: Phases 1-2 built and live-verified with Google; Toy added; WhatsApp deferred

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Schema, directory, manual upload, review/approve/reject, crop & separate, catalogue, Google sign-in | Built, tested locally |
| 2 | Share/export (Share button, Copy card, zip), PDF embedded-photo extraction, Google Drive storage + folder import | Built; Google sign-in and Drive verified live (import, read-back, upload, crop to `Processing/`) |
| 2b | **Toy** assistant (`/chat`): conversational add with voice, optional tail number, aircraft categories + ~190 standard types, visual crop with undo | Built, tested; screen not yet exercised in a browser |
| 3 | WhatsApp intake and delivery | **Deferred by the owner** (Share replaces most of the need); tables exist |
| 4 | Seven-language card parsing/display, optional Gemini adapter | Not started (English card parsing done) |

## Run locally

Requires Node 24+. No Docker or Postgres needed: without `DATABASE_URL` the app uses an embedded PGlite database in `.data/`.

```bash
npm install
cp .env.example .env.local       # then edit: set DEV_AUTH_BYPASS=1, OWNER_EMAIL, AUTH_SECRET
npm run db:seed                  # optional DEMO data (refuses to run in production)
npm run dev                      # http://localhost:3000
```

`DEV_AUTH_BYPASS=1` skips Google sign-in for local work only; it is ignored when `NODE_ENV=production`.
Without it, set `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_SECRET` and `OWNER_EMAIL` (see [docs/CONFIGURATION.md](docs/CONFIGURATION.md)).

Other commands: `npm test`, `npm run typecheck`, `npm run build`, `npm run db:generate` (after schema changes), `npm run db:migrate`.

## Tests

`npm test` runs 66 tests against a real PostgreSQL engine (PGlite, in-memory) with all migrations applied.
Coverage against the handoff's acceptance tests is listed in [docs/SPEC-AMENDMENTS.md](docs/SPEC-AMENDMENTS.md#acceptance-test-status).

## Layout

```
src/domain/    business rules: actions (idempotent), directory, media, catalogue, card parser, Toy (toy.ts, chat.ts), standard aircraft types
src/db/        Drizzle schema + client (drizzle/ holds generated SQL migrations)
src/storage/   byte storage: local disk and Google Drive (REST client + import in src/domain/driveImport.ts)
app/           Next.js UI and server actions (thin wrappers over src/domain)
tests/         vitest suites
docs/          ADR, action contract, configuration guide, spec amendments
```

## Known limitations

- **Google Drive and sign-in were verified live** (`npm run drive:check`, sign-in, import, crop). Automated tests still use an in-memory fake Drive (`tests/fakeDrive.ts`). While the Google project is in *Testing* status the Drive refresh token expires after 7 days; re-run `npm run drive:authorize`. PDF extraction on a real PDF via Drive and the Share sheet on a phone are not yet exercised.
- **Toy** is rule-based, not AI: it reads labelled or dictated lines, not free sentences. Voice uses the browser's speech features (Chrome/Edge; audio is processed by the browser vendor).
- **Do not deploy to Render with `STORAGE_KIND=local`**: Render discards local files on redeploy. Set `STORAGE_KIND=drive` (after the live Drive check) or attach a persistent disk.
- **PDF extraction reads embedded photos only** (JPEG, and 8-bit gray/RGB Flate). It does not render pages, so vector/text-only pages, CMYK/indexed/JPEG2000/CCITT images and images inside nested form XObjects are reported as skipped or "no photos found". Tiny images under 100px are reported as skipped. Skips are always shown, never silent.
- Drive "incremental" refresh lists the chosen folder tree's metadata and skips already-imported file revisions before downloading (not Drive's account-wide change feed). Up to 100 new files per run; run again to continue.
- The Share button uses the browser's native share sheet; it works on phones (HTTPS) and some desktops. WhatsApp may drop the caption on shared files, hence **Copy card**. It does not record a delivery history.
- Drive folders `Approved/` and `Retired/` are not populated yet (folder placement is organisational only); new files go to `Sources/` and `Processing/`.
- Only English card labels are parsed/displayed so far.
- The catalogue is computed in application code per request; fine for hundreds of aircraft.
- The crop UI uses numeric pixel fields, not a drag-to-crop overlay.
