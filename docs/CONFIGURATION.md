# Configuration guide

Never commit real values and never paste secrets in chat. Set them in `.env.local` (local) or the Render dashboard.
`.env.example` lists names only.

## Google sign-in (phase 1)
1. Google Cloud Console → create/choose a project → APIs & Services → OAuth consent screen (Internal if you use Workspace, otherwise External/testing with yourself as test user).
2. Credentials → Create OAuth client ID → Web application.
3. Authorised redirect URIs: `http://localhost:3000/api/auth/callback/google` and `https://<your-render-host>/api/auth/callback/google`.
4. Set `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_SECRET` (random, e.g. `openssl rand -base64 32`), `OWNER_EMAIL` (the one Google account allowed in).
Only a verified Google email equal to `OWNER_EMAIL` can sign in.

## Render (after phase 2, or with a persistent disk)
`render.yaml` defines a web service and a PostgreSQL database. Create a Blueprint from the repo, then fill the `sync: false` secrets. Migrations are applied automatically on first database use. Do not set `DEV_AUTH_BYPASS`.

## Google Drive (phase 2 — not built yet)
Planned: the same Google Cloud project with the Drive API enabled; an OAuth consent granting access for the `Aircraft Media` root folder (`1KaOTmLDTrSg5lanEPuw3jppU0ZsOK6sn`) and its descendants; incremental import via Drive change tokens filtered to that folder. Originals are never moved or overwritten; derivatives are written under `Processing/` and `Approved/`. Scope choice (`drive.file` + Picker versus a broader read scope) will be decided at that stage.

## WhatsApp Business Platform (phase 3 — not built yet)
You will need: a Meta Business account (business verification can take days), a WhatsApp Business Account with a dedicated number not already registered in the WhatsApp app, a system-user access token, the phone-number ID, the app secret (for webhook signature checks) and a webhook verify token. Replies to your requests fall inside the 24-hour customer-service window; the app sends nothing proactively.

## Gemini (phase 4 — optional)
`GEMINI_API_KEY` and `GEMINI_MODEL` stay server-side. Leaving them empty disables AI; nothing else changes.
