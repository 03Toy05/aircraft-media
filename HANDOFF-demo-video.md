# Hand-off: making a demo video of Aircraft Media

Aircraft Media helps private-jet brokers keep aircraft photos and details in one place and send quotes to clients.
Brokers upload photos, check them in Review, and send a quote with photos. Toy is the chat helper that does the
same jobs from typed or spoken messages.

## Where things are

| What | Where |
|---|---|
| Project folder | `C:\Users\wallace.fok\Downloads\Aircraft Media_CBOS` (git, branch `main`) |
| Live site | https://aircraft-media.onrender.com (needs a Google sign-in; the owner signs in themself) |
| Pages (one folder per screen) | `app/(app)/…`: see the screen list below |
| Shared screen parts | `app/_components/` (e.g. `ChatClient.tsx` = Toy, `UploadForm.tsx`, `ReviewSheet.tsx`, `CropTool.tsx`, `QuoteBuilder.tsx`) |
| Look and feel (colours, spacing, phone layout) | `app/globals.css`, logo in `public/logo.svg` |
| What the app does behind the screens | `src/domain/` (e.g. `chocks*.ts` = Toy's replies, `quote.ts`, `library.ts`, `media.ts`) |
| Sample photo sets (real operators, 1 EXT, 2 CABIN, 1 FLOOR PLAN each) | `library-packs/` (e.g. `library-packs/luxaviation/`, 300 photos) |
| Local test data (database and photos for the local copy only) | `.data/` (ignored by git) |
| Notes on settings and design decisions | `docs/` and `README.md` |

## Screens worth showing (path, then file)

- **Dashboard with Toy:** `/` (`app/(app)/page.tsx`, Toy is `app/_components/ChatClient.tsx`)
- **Upload photos:** `/intake` (`app/(app)/intake/page.tsx`, `app/_components/UploadForm.tsx`)
- **Review (check and approve photos):** `/review` and `/review/<id>`, the photo page with Crop
- **Operators and aircraft:** `/fleet`, plus one aircraft at `/aircraft/<id>` with its photos, "Send to a client", details and history
- **Quote for a client:** `/quote` (template at `/quote/template`)
- **Library (shared aircraft and photos):** `/library` (admin extras: `/library/review`, `/library/import`)
- **Photos:** `/photos`
- **Contacts:** `/contacts`
- **Settings:** `/settings`
- **Admin only:** Users at `/admin`, Speed at `/admin/speed`
- **Phone layout:** the same pages at phone width. There's a bottom menu (`app/_components/MobileNav.tsx`) and a floating voice button (`VoiceCommand.tsx`).

## Running a local copy (good for recording without touching real data)

- In the Claude desktop app, start the preview server named **`aircraft-media-dev`** from `.claude/launch.json`. It runs on http://localhost:3100.
- That server skips the Google sign-in (`DEV_AUTH_BYPASS=1`) and keeps photos on disk (`STORAGE_KIND=local`).
- The local copy already has test data in `.data/`: one library operator (Luxaviation, 83 aircraft) and some photos waiting in Review.
- Command-line alternative: `npm run dev`. Tests: `npm test`. Type check: `npm run typecheck`.

## Things to know

- **Toy features:** it understands English and Chinese only (traditional and simplified), using fixed patterns, not AI. Its voice input uses the browser's speech recognition. The voice language is picked under Toy's buttons, and "廣東話 + English" copes best with mixed speech.
- **Recent additions to show off:**
  - Upload progress bar, with photos approved three at a time
  - Spinners on any button while it works, and a shimmer on photos still loading
  - Toy's "Working…" state and its Clear button
  - The Library now shows only aircraft still to add plus anything changed in the last 7 days
- **Rules the owner has set:**
  - Don't put secrets, passwords or `.env` values in chat.
  - Don't change firewall or system settings.
  - Don't touch the `cbos` Render service (it is suspended).
  - Commit and push only when asked.
  - Don't read `CBOS\Keys` or `CBOS\sprint1\secrets`.
  - Never type passwords; the owner signs in themself.
- **Hosting:** Render web service `aircraft-media` (Starter plan, Singapore). A git push does NOT deploy by itself; a deploy has to be triggered after each push.
- **Personal details:** the live site has real operators and contacts. For a public video, the local copy (or blurring) avoids showing them.

## Suggested demo story

1. Upload a set of photos from `library-packs/<operator>/`, and watch the progress bar.
2. Check and approve them in Review. Show a crop.
3. Open the aircraft, show its photos, then use "Send to a client".
4. Ask Toy for a quote by typing or speaking (e.g. "Give me Capital's G550 quote and photos").
5. Show the Library, and the phone layout.
