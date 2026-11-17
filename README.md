# Aircraft Media

Private, single-owner web app for aircraft photos and aircraft information. It is a standalone app that uses
CBOS meanings (organisation, aircraft type, aircraft, aircraft media, evidence, versions) so its records can be
exported to CBOS later. It never writes to CBOS.

Build specification: `Aircraft_Media_App_Claude_Build_Handoff.md` (v1.0) as amended by
[docs/SPEC-AMENDMENTS.md](docs/SPEC-AMENDMENTS.md) (v1.1: single owner, rejected state, aliases, phasing).

## Status: Phase 1 of 4

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Schema, directory, manual upload, review/approve/reject, crop & separate, catalogue, Google sign-in | **Built, tested locally** |
| 2 | Google Drive storage + incremental import, PDF embedded-image extraction | Not started |
| 3 | WhatsApp intake and delivery (`PHOTO ...` commands first) | Not started |
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

`npm test` runs 35 tests against a real PostgreSQL engine (PGlite, in-memory) with all migrations applied.
Coverage against the handoff's acceptance tests is listed in [docs/SPEC-AMENDMENTS.md](docs/SPEC-AMENDMENTS.md#acceptance-test-status).

## Layout

```
src/domain/    business rules: actions (idempotent), directory, media, catalogue, card parser
src/db/        Drizzle schema + client (drizzle/ holds generated SQL migrations)
src/storage/   byte storage interface (local now; Google Drive in phase 2)
app/           Next.js UI and server actions (thin wrappers over src/domain)
tests/         vitest suites
docs/          ADR, action contract, configuration guide, spec amendments
```

## Known limitations (phase 1)

- **Not deployable to Render yet.** Photo bytes are stored on local disk, which Render discards on redeploy. Deploy after phase 2 (Drive storage), or attach a Render persistent disk and set `LOCAL_STORAGE_DIR` to it. `render.yaml` is ready for that.
- Drive, WhatsApp and Gemini are not connected; Settings shows them as not configured. PDFs are rejected with a message (phase 2).
- No live provider verification has happened. Everything verified so far is local: unit/integration tests, a production build, and a manual browser pass over the catalogue and review/approve flow with demo data.
- Google sign-in code is written but has **not** been exercised against real Google credentials.
- Only English card labels are parsed/displayed so far.
- Catalogue is computed in application code per request; fine for hundreds of aircraft, would need SQL aggregation for thousands.
- Crop UI uses numeric pixel fields, not a drag-to-crop overlay.
- Next.js build prints file-tracing warnings about `process.cwd()` in the storage module; they are harmless today.
