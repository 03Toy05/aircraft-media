# Configuration guide

Never commit real values and never paste secrets in chat. Set them in `.env.local` (local) or the Render dashboard.
`.env.example` lists names only.

## Google sign-in (phase 1)
1. Google Cloud Console → create/choose a project → APIs & Services → OAuth consent screen (Internal if you use Workspace, otherwise External/testing with yourself as test user).
2. Credentials → Create OAuth client ID → Web application.
3. Authorised redirect URIs: `http://localhost:3000/api/auth/callback/google` and `https://<your-render-host>/api/auth/callback/google`.
4. Set `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_SECRET` (random, e.g. `openssl rand -base64 32`), `OWNER_EMAIL` (the one Google account allowed in).
Only a verified Google email equal to `OWNER_EMAIL` can sign in.

## Render (after the live Drive check, or with a persistent disk)
`render.yaml` defines a web service and a PostgreSQL database. Create a Blueprint from the repo, then fill the `sync: false` secrets. Migrations are applied automatically on first database use. Do not set `DEV_AUTH_BYPASS`.

## Google Drive (phase 2)
Built and mock-tested; not yet verified against live Google.

1. In the same Google Cloud project, enable the **Google Drive API**.
2. On the OAuth client used for sign-in, add this authorised redirect URI as well: `http://127.0.0.1:53682/callback` (used once by the helper below).
3. OAuth consent screen: the app needs the `https://www.googleapis.com/auth/drive` scope (it must read your existing `Aircraft Media` folder and write derivatives). If the consent screen is *External* and left in **Testing**, Google expires refresh tokens after 7 days. Either use an *Internal* (Workspace) app, or publish the app to *In production* (it stays private to you; Google may show an "unverified app" warning you can click through).
4. Run `npm run drive:authorize`, open the printed link as the Google account that owns the folder, and copy the printed `GOOGLE_DRIVE_REFRESH_TOKEN=...` line into `.env.local` (and the Render dashboard). Do not paste it into chat or commit it.
5. Set `GOOGLE_DRIVE_ROOT_FOLDER_ID` (already `1KaOTmLDTrSg5lanEPuw3jppU0ZsOK6sn` in `.env.example`). Set `STORAGE_KIND=drive` to store new files in Drive.

Behaviour: everything is confined to the root folder tree (imports of folders outside it are refused). Originals imported from Drive stay where they are and are referenced in place. Manual uploads are filed under `Sources/`; crops and PDF-extracted photos under `Processing/`. Intake > Google Drive lets you import a folder and refresh it later; unchanged files are skipped before download.

## WhatsApp Business Platform (deferred, not built)
You will need: a Meta Business account (business verification can take days), a WhatsApp Business Account with a dedicated number not already registered in the WhatsApp app, a system-user access token, the phone-number ID, the app secret (for webhook signature checks) and a webhook verify token. Replies to your requests fall inside the 24-hour customer-service window; the app sends nothing proactively.

## Gemini (phase 4 — optional)
`GEMINI_API_KEY` and `GEMINI_MODEL` stay server-side. Leaving them empty disables AI; nothing else changes.
