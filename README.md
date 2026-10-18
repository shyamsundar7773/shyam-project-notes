# Shyam Project Notes

A React Native/Expo application and existing Vite product frontend, backed by
Supabase and an Express/TypeScript API. Expo Router is the canonical app for
local browser development and Netlify; it includes authenticated Category →
Topic → Subtopic and file workflows plus persisted notes, editor, autosave,
copy/delete, and an isolated SQL-practice panel. The Vite frontend remains
available as an alternative with its existing file and notes workflows.

## Local development

```sh
npm install
npm run dev
```

`npm run dev` starts the canonical Expo Router app in a browser at
`http://localhost:5173`. Use `npm run dev:vite` to run the separate Vite
frontend. `npm start` starts Expo for native development; press `w` to open
its web app.

### Expo application

```sh
npm start
```

Expo starts the React Native application. Install Expo Go on an Android phone
connected to the same Wi-Fi and scan the displayed QR code. Allow the
development server through the laptop's private-network firewall if needed.

The Expo app includes Supabase email/password auth and recovery, persisted
sessions, Category → Topic → Subtopic creation/selection, file creation,
notes collection/editor, autosave, copy/delete, and an initial inline SQL
practice flow. The SQL practice service uses an isolated in-memory sample
dataset; it never executes submitted SQL against Supabase. Gemini evaluates
the submitted SQL and sandbox result separately. Local tests and exports do
not prove live Supabase/RLS behavior, rendered browser behavior, Expo Go
interaction, a live Gemini request, or deployment configuration. Keep the
existing Vite workflow (`npm run dev:vite`, `npm run build`, `npm run preview`)
intact. `npm run build:expo:web` exports the Expo site to the ignored
`expo-web-build/` directory. `npm run build:netlify` typechecks Expo and
exports its static routes for Netlify, mapping existing Vite public Supabase
and backend settings to the matching Expo variable names when needed. The
build fails if required public frontend configuration is missing.

The root `.env.example` is the frontend template for both current frontends.
Copy it to the ignored root `.env.local` and use:

- Vite: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and optional
  `VITE_BACKEND_URL`.
- Expo: `EXPO_PUBLIC_SUPABASE_URL` and
  `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; optionally set
  `EXPO_PUBLIC_API_BASE_URL` for SQL practice/backend requests.

Vite-specific `VITE_` Supabase values take precedence; if they are absent or
blank, Vite can reuse the matching `EXPO_PUBLIC_` Supabase URL and publishable
key. Expo consumes its `EXPO_PUBLIC_` names. Netlify's Expo build prefers
explicit Expo values and otherwise maps the corresponding existing Vite
public values. Set the public Supabase project URL and publishable key for
the frontend you run. Vite reads
`VITE_BACKEND_URL` at build time. Set it to the
backend origin in Netlify's production environment before building; a change
to this value requires a new frontend build. When blank, Vite derives
`http://<current-browser-host>:3001` only for local HTTP development. A deployed
HTTPS site does not fall back to localhost and reports that the backend is
unconfigured. Expo uses `EXPO_PUBLIC_API_BASE_URL` when set; local web and
same-LAN native development can derive a backend address when possible. The earlier
unused-variable assumption is superseded: Expo now consumes this established
name. Expo CLI can list public-prefixed environment variable names without
using them. Vite explicitly injects only its three resolved public variables.
Never put Gemini credentials, a Supabase service-role/secret key, or other
server-only credentials in frontend variables. Configuration being present
does not verify a live connection. Supabase Auth email-confirmation behavior
is controlled by the project's hosted Auth settings.

For local backend development, copy `backend/.env.example` to the ignored
`backend/.env` or set its variables in the backend process environment.
Backend `.env` loading is done by `backend/src/server.ts`; the file is
optional if values are supplied in the process environment. `PORT` is
optional locally and defaults to `3001`. `SUPABASE_URL` and
`SUPABASE_PUBLISHABLE_KEY` are used by the backend to verify bearer tokens;
no service-role key is required. `GEMINI_API_KEY` and
`GEMINI_PRIMARY_MODEL` are needed for the Gemini-backed endpoints.
`FRONTEND_ORIGIN` adds exact comma-separated browser origins (scheme, host,
and optional port only; no path or trailing slash). The production Netlify
origin `https://shyam-project-notes.netlify.app` is allowed by default; set
`FRONTEND_ORIGIN` for additional local or preview origins. Keep all Gemini
credentials on the backend.

Expo auth persistence uses AsyncStorage through the Supabase SDK. The Expo
app uses actual cloud workspace and note records; it does not fabricate
taxonomy or notes data. Its SQL practice fixtures are isolated educational
data on the backend and are not application notes or Supabase data. The
workspace requires the reviewed migrations and owner RLS to be present in the
target project; hosted state remains unverified. Expo Router web server
rendering is guarded so browser storage is initialized only after mount.
The Expo Supabase client is initialized after the app mounts, so Expo Router's
web server rendering does not access browser storage. Persistent session
restoration remains enabled on web and native. See
`docs/EXPO_STARTUP_FIX_REPORT.md` for the local verification results and
`docs/EXPO_STARTUP_FIX_MANUAL_TESTS.md` for checks still requiring a browser
and Android device.

### Password recovery and Android browser testing

An account shown in Supabase Auth Users is not proof that a password was set.
Use **Forgot password?** on the sign-in screen to request a reset email; the
app does not reveal whether the email belongs to an account. The link returns
to `/reset-password`, where a valid Supabase recovery session is required
before a new password can be submitted.

The recovery request explicitly directs Supabase to the current browser
origin's `/reset-password` path. This produces `http://localhost:5173/`
for desktop Vite and `http://<LAPTOP-LAN-IP>:5173/` for a phone using the
same Vite server; it does not use a default port such as 3000. In Supabase
Dashboard → Authentication → URL Configuration, set the Site URL to the
intended application origin and allow the exact recovery redirect URLs:

- `http://localhost:5173/reset-password`
- `http://<LAPTOP-LAN-IP>:5173/reset-password`

The email provider must be enabled and the password recovery email template
must use Supabase's confirmation URL flow (normally `{{ .ConfirmationURL }}`),
not a hard-coded Site URL. These hosted settings were not accessed or verified;
a template override or dashboard configuration can still change the observed
destination.
Review the Email provider's confirmation policy, account confirmation state,
recovery-email delivery, expiry, and project password rules in the dashboard;
no settings are changed by this application.

For Android testing on the same Wi-Fi, find the laptop's private IPv4 address
in PowerShell (choose the active Wi-Fi/Ethernet adapter, not a VPN or
`169.254.*` address):

```powershell
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '169.254*' -and $_.InterfaceAlias -notmatch 'Loopback' } |
  Select-Object InterfaceAlias, IPAddress
```

Set `FRONTEND_ORIGIN` in `backend/.env` to the exact origins used by desktop
and phone, comma-separated, for example
`http://localhost:5173,http://<LAPTOP-LAN-IP>:5173`. Each value must be an
HTTP(S) origin with no path or trailing slash; CORS uses exact string matching,
not wildcards. On Render, set `FRONTEND_ORIGIN` to the deployed frontend's
origin only after that real URL is known, for example `https://<deployed-host>`
(no path or trailing slash). Render hosts the API; it does not configure or
fix Supabase's recovery redirect. Keep `GEMINI_API_KEY`, `GEMINI_PRIMARY_MODEL`,
`SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY` only in `backend/.env`, the
backend process environment, or Render's Service → Environment. Never use a
Supabase service-role/secret key.

`VITE_BACKEND_URL` may be left blank to use the existing local default, or set
to a backend origin when needed. When using the same Vite app from an Android
phone over LAN, configure the URL to use the laptop's reachable LAN address
if the automatic host mapping is insufficient. The local backend defaults to
port `3001` and listens on `0.0.0.0`.

Start Vite from the project root:

```powershell
npm run dev -- --host 0.0.0.0
```

In another PowerShell window, start the backend:

```powershell
Push-Location backend
npm run build
if ($LASTEXITCODE -eq 0) { npm start }
Pop-Location
```

For desktop recovery, open `http://localhost:5173`, request a recovery email,
and open its link in that same browser/origin. For Android, open
`http://<LAPTOP-LAN-IP>:5173` on the phone, request the recovery email from
that page, and open its link on the phone so the link returns to the LAN
origin. Allow Node/Vite and the backend port through Windows Firewall on the
private network only if prompted. Confirm that a short/mismatched password is
rejected, then set a valid matching password and sign in with it. Do not put
Gemini or any Supabase secret/service-role key in a `VITE_` setting.

Phase 1's database schema is prepared at
`supabase/migrations/20261016133000_phase1_taxonomy_files.sql` and has **not
been applied**. Review it and compare its table names with the hosted schema
before applying through an authorized process. It creates owner-scoped
taxonomy and file tables, restrictive file references, and authenticated
Row Level Security policies. Phase 2's
`supabase/migrations/20261016140000_phase2_notes.sql` is also **PREPARED — NOT
APPLIED**. It adds the file-owner composite key required by the notes foreign
key, then creates owner-scoped notes with a restrictive parent-file
relationship. Review both migrations together against the hosted schema
before an authorized operator applies either. No taxonomy records are seeded;
approved real Category, Topic, and Subtopic records must be provisioned before
the selectors can offer a path.

Run the isolated backend from its directory:

```sh
cd backend
npm install
npm run build
npm test
npm start
```

The backend loads `backend/.env` for local development; process environment
values also work and take precedence. Its health endpoint is `GET /health`;
note conversion is `POST
/api/notes/convert`. Conversion requires a verified Supabase bearer access
token and returns a reviewable result without saving it.
The existing Vite notes workspace calls `POST /api/notes/evaluate-sql` and
`POST /api/notes/convert-markdown`; its SQL review remains illustrative. The
Expo inline SQL-practice flow separately calls authenticated
`GET /api/notes/practice-question` and `POST /api/notes/run-sql`. The latter
executes only against a fresh in-memory SQLite sample dataset with read-only
authorization and bounded results. Gemini receives that result for
evaluation but does not execute SQL. Notes themselves persist directly
through the authenticated Supabase client and depend on both unapplied local
migrations and their owner RLS policies. Hosted schema/RLS, real cloud
persistence, rendered browser/Expo Go behavior, and live Gemini/Auth behavior
have not been verified.

Markdown blocks use the shared Marked GFM tokenizer and keep their original
source for editing and copying. The renderer supports headings, nested/task
lists, tables, links, quotes, and fenced code. Its limited HTML allowlist is
`a`, `b`, `br`, `div`, `em`, `i`, `kbd`, `p`, `span`, `strong`, and `u`;
inline styles are restricted to validated colors, pixel padding/border radius,
and simple solid borders. Scripts, event handlers, unsafe URLs, and unsupported
elements are never rendered; unsupported tags are omitted while their safe text
content is retained. LaTeX and Mermaid are shown as readable source, not
typeset or executed diagrams.

Run frontend checks with `npm run lint`, `npm run build`, and `npm test`.
From `backend/`, run `npm run build` and `npm test`.

## Build and deployment

- `npm run build` runs the Vite TypeScript/project build and compiles the
  backend for the root Render service.
- `npm run build:netlify` typechecks Expo, exports static Expo Router routes,
  verifies its entry HTML/bundle, and publishes the canonical app from
  `expo-web-build/`.
- `npm run preview` serves the production build locally.
- `npm start` starts Expo for local development when `PORT` is unset; when
  `PORT` is supplied by Render, it starts the compiled Express backend.
  `npm run build` compiles both the Vite frontend and `backend/dist/server.js`.
- For the existing Render service rooted at the repository root, keep the
  build command `npm install && npm run build`, start command `npm start`, and
  health-check path `/health`. Render's `PORT` selects the Express server;
  without `PORT`, `npm start` preserves the local Expo workflow. The root
  package requires Node `>=24.10.0`, matching the backend runtime.
- `netlify.toml` builds the canonical Expo Router app and maps extensionless
  static routes to their generated HTML files. The separate Vite app is not
  the Netlify production entry point.
- In Netlify's production environment, set `VITE_BACKEND_URL` to the Render
  backend origin and rebuild the frontend after changing it. This public
  frontend setting contains no secret; Vite embeds it in the build.
- Alternatively, for a separately rooted Render backend service, set the
  root directory to `backend`, build command to `npm ci && npm run build`,
  start command to `npm start`, and health-check path to `/health`. In Render
  Dashboard → Service → Environment, configure `GEMINI_API_KEY`,
  `GEMINI_PRIMARY_MODEL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and
  `FRONTEND_ORIGIN`. Render provides `PORT`; do not hard-code or copy a local
  port into the production service. The production Netlify origin is already
  included by the backend allowlist; set `FRONTEND_ORIGIN` for any additional
  origins.
