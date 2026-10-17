# Expo Migration Audit

**Date:** 2026-10-17
**Scope:** Original read-only architecture and dependency audit before Expo
application-code migration. Current staged status is recorded in the
Phase B1/B2 sections below; this remains an audit, not proof of physical
Expo Go behavior.

## Decision

The product functionality is reusable, but the existing frontend is not
portable to Expo Go by changing the entry point or adding a start script. It
is a browser-rendered Vite application: its UI is built from HTML elements and
CSS, its router manipulates the browser History API, and several workflows use
DOM dialogs, browser storage and browser event APIs. Expo Go requires a
React-Native component tree and native-compatible navigation, persistence and
link handling.

Preserving the current deployed/desktop web UI while adding an Expo Android
app would require either maintaining two independently rendered frontends or
rebuilding the UI in React Native and React Native Web. The latter is a
substantial frontend rewrite affecting authentication screens, the file and
taxonomy workflows, dialogs, the notes list and editor, Markdown preview,
autosave warnings and responsive presentation. Replacing these surfaces in
this migration without a staged implementation and platform verification
would risk losing working behavior.

At the time of this audit, the recommendation was to pause before dependency
changes or UI replacement. The approved B1 foundation and B2 authentication
shell have since been added as staged work without replacing Vite. This
partial shell is not feature parity and does not establish that all screens
or live services work in Expo Go. Keep the Vite app and backend intact while
continuing the incremental migration.

## Repository and dependency findings

- The root package uses React `^19.2.8`, React DOM `^19.2.8`, Vite `^8.3.0`,
  `@vitejs/plugin-react`, and TypeScript. Its scripts are `dev`, `build`,
  `lint`, `preview` and `test`; there is no Expo entry point or `npm start`.
- The lockfile is npm lockfile v3 and agrees with the current root manifest.
  `expo`, `react-native`, `react-native-web` and `expo-router` are not root
  dependencies. No Expo SDK version is selected or verified.
- `react-dom`, Vite, the Vite React plugin, `index.html`, and `src/main.tsx`
  are web-renderer/build infrastructure. They cannot render the native
  application in Expo Go; a migration would replace the frontend entry/build
  stack, not move the Express backend.
- `@supabase/supabase-js` is the shared Auth/data client candidate, but the
  current initialization assumes browser defaults. Native persistence and
  deep-link callback handling must be configured and tested explicitly.
- `@google/genai`, Express and CORS belong to `backend/`, not the Expo bundle.
  They remain Node/server dependencies. The backend currently requires Node
  `>=22` and independently exposes `/health`, note conversion, SQL evaluation
  and Markdown conversion endpoints.
- React Native and React Native Web dependencies are absent. A target Expo SDK
  must be chosen from its compatibility matrix and installed with Expo's
  version-aware tooling; the existing React version must not be retained or
  replaced by guesswork.

## Frontend and feature compatibility

| Area | Current implementation | Expo Go implications |
| --- | --- | --- |
| Entry and routing | `src/main.tsx` calls `createRoot(document...)`; `App.tsx` reads `window.location`, listens to `popstate`, calls `history.pushState`, and scrolls the window. | Replace with a React Native root and an Expo Router route tree or another RN navigation layer. Preserve routes and query data (`/`, `/create-file`, `/notes`, `/reset-password`) and test deep links. |
| UI and styling | `App.tsx` and `src/components/NotesWorkspace.tsx` use HTML tags (`main`, `section`, `form`, `input`, `textarea`, `dialog`, `details`, etc.); `src/App.css` provides the existing web layout and interaction styling. | These are not native primitives. Rebuild using `View`, `Text`, `TextInput`, `Pressable`, scroll containers and native styles; React Native Web must also be verified. Existing CSS cannot be applied wholesale to native components. |
| Authentication UI | Email/password sign-in, sign-up, error states, sign-out and session restoration use the Supabase client and React state. | Product rules can be reused, but UI needs native controls. Native persistent storage and auth-event behavior require explicit setup and platform tests. |
| Password recovery | `src/lib/auth.ts` constructs `/reset-password`; `App.tsx` passes the current `window.location.origin` to `resetPasswordForEmail`. Supabase's web SDK callback is handled by the existing browser client and `onAuthStateChange`. | The redirect calculation has no `window` in native. Web can keep an origin-based redirect. Native needs an Expo deep-link URL, a listener for the returned URL, and a verified SDK callback/session exchange. The Expo Go redirect URI depends on its runtime URL and is not established here. Do not accept arbitrary URL parameters as a recovery session. |
| Files and taxonomy | “Files” are Supabase `files` records (named note collections), not device file uploads. Category → Topic → Subtopic and file CRUD are implemented through `src/lib/phase1.ts`. | Data functions are mostly renderer-independent. Rebuild the selector/forms and route state with native controls while retaining exact hierarchy validation and Supabase ownership checks. No upload picker or native file-storage requirement was found. |
| Notes, SQL and Markdown | `src/lib/notes.ts` and `src/lib/autosave.ts` implement notes, optimistic autosave queueing, conflict handling and draft serialization. `NotesWorkspace.tsx` supplies text/SQL/Markdown editing, SQL evaluation, Markdown conversion, note copying and deletion. | Core data and queue logic are candidates for reuse. Replace web form controls and confirm native keyboard/scroll behavior. “Copy Notes” duplicates a database note; no OS clipboard integration was found. SQL is text evaluated by the existing backend; it is not executed against a database. |
| Markdown preview | `MarkdownPreview.tsx` parses a restricted Markdown subset into HTML/React DOM elements and relies on CSS selectors. | The parser's safe text/structure rules can be reused, but the renderer must emit `Text`/`View` or use a tested Expo Go-compatible Markdown renderer. Raw HTML must remain disabled. |
| Dialogs and menus | Uses `<dialog>`, `<details>`, `showModal`, document pointer listeners, DOM selectors/focus and browser `confirm`. | Replace with native modal/menu components and explicit state. Verify Android back handling, focus/accessibility, dismissal and duplicate-submit protection. |
| Browser events and storage | `window`/`document` APIs include `beforeunload`, `PointerEvent`, `querySelector`, `window.confirm`, `window.location.reload`, `scrollTo`, `matchMedia`, History API and `setTimeout`. Drafts use `window.localStorage`. | `beforeunload`/DOM selectors have no native equivalent. Expo-compatible AsyncStorage is installed and used for Expo Supabase sessions; note-draft caching still needs an async platform storage abstraction and lifecycle work. |
| Keyboard and clipboard | Escape handling, DOM focus, and `<textarea>` keyboard interactions occur in the notes workspace. No `navigator.clipboard` or system clipboard use was found. | Use `TextInput` submit/keyboard props, Keyboard APIs and native focus management. Mobile keyboard layout and multiline editing need device checks. |
| File upload | No browser file input, picker, upload API or upload dependency was found. | No current upload feature to port. If “files” is intended to mean physical-device documents, that would be a new requirement and Expo-compatible picker/storage design. |
| Backend API URL | The Vite app's `resolveBackendBaseUrl` uses the browser page URL and local-host rewriting; callers pass `window.location.href` and `VITE_BACKEND_URL`. No Expo source/configuration reference to `EXPO_PUBLIC_API_BASE_URL` or another Expo backend URL exists. | Expo currently makes no backend requests, so no Expo API URL is required or consumed. If backend integration is added later, choose and test a public config name for web/native LAN and verified production origins; do not infer use from Expo CLI's environment-loading log. |

## Supabase and password recovery

The current web implementation has an explicit recovery `redirectTo` based
on the active web origin plus `/reset-password`, checks for a Supabase
`PASSWORD_RECOVERY` event with a session, validates password length and
confirmation, calls `updateUser({ password })`, and signs out locally after a
successful change. It does not use port 3000 in its redirect logic. The
existing tests mock the installed Supabase SDK and check the redirect, session
gating, password update and safe error mapping; they do not prove hosted
configuration or email delivery.

This supports the web flow, not native Expo Go. A native flow still needs:

1. A configured app deep-link route for `/reset-password` and an explicit
   Supabase Auth URL redirect suitable for the actual Expo Go runtime.
2. A native URL listener and the selected Supabase SDK flow for safely
   establishing a recovery session from its callback. The existing fragment
   checks are not proof of a valid session.
3. A tested scheme/redirect allowlist and successful/expired-link tests on a
   physical Android phone running Expo Go.

The app scheme `shyam-project-notes` is configured, but no Expo Go runtime URL,
hosted URL allowlist, email-template configuration or physical-device
evidence exists in the repository. Consequently, an exact Android allowlist
URL cannot be responsibly specified yet. Do not change Supabase URL
Configuration until the target deep-link design and test origin are selected.
Continue to keep the Vite web redirect allowlist separate from any native
development or production redirects.

## Environment, API, CORS and Render

- Current public frontend template (`.env.example`): `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_PUBLISHABLE_KEY`, optional `VITE_BACKEND_URL`,
  `EXPO_PUBLIC_SUPABASE_URL`, and
  `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Vite explicitly exposes only its
  three public values; Expo source consumes only its two Supabase values. Expo
  CLI loads `.env.local` and reports public-prefixed variable names
  independently of whether the app references them. The reported
  `EXPO_PUBLIC_API_BASE_URL` has no Expo source/configuration consumer and is
  intentionally not included in the canonical template.
- Current backend template (`backend/.env.example`): `GEMINI_API_KEY`,
  `GEMINI_PRIMARY_MODEL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
  `FRONTEND_ORIGIN`, and optional `PORT`. The backend does not require a
  service-role key; it verifies access tokens with the publishable key and
  uses the Gemini API key server-side.
- Local backend loads `backend/.env` or process environment. Render's
  documented configuration is root directory `backend`, build
  `npm ci && npm run build`, start `npm start`, health check `/health`, plus
  the five backend service variables above; Render supplies `PORT`.
  These settings are independent of Expo frontend variables and Supabase Auth
  URL Configuration.
- `FRONTEND_ORIGIN` is a comma-separated exact-origin allowlist (for example,
  `http://localhost:<actual-dev-port>,https://<actual-deployed-web-origin>`),
  with no paths or trailing slash. Do not use wildcard origins. Check the
  actual Expo web origin/port before adding it. Native app HTTP requests
  generally do not send a browser Origin header and do not replace the need
  for backend authorization.
- No production frontend URL or Render service URL was verified. Keep them as
  placeholders until the developer provides or confirms them. Do not set the
  production API to a developer laptop.

## Existing tests and migration test needs

The current Node `tsx --test` frontend suite can be retained for pure
validation, data operations, authentication SDK mocks, autosave queueing,
Markdown safety, API request formatting, and file-selection regressions.
The backend suite can remain as HTTP tests with mocked providers. Current
coverage includes login/session restoration/sign-out, recovery redirect and
session gating, password update validation, CORS origins, notes/file
selection, draft caching and safe Markdown rendering.

After a staged Expo implementation, add platform-aware tests for:

- Native Supabase storage initialization, session restore and sign-out.
- Recovery URL generation/handling, invalid or expired callbacks, and gated
  password updates using mocked SDK callbacks.
- Expo Router route restoration, file/taxonomy selection and Android back
  navigation.
- Native text editing, keyboard avoidance, autosave lifecycle interruption,
  async draft recovery and conflict UX.
- React Native Markdown output and unsafe HTML treatment.
- API base URL selection for Expo web, physical Android LAN, and verified
  production web; retain backend auth/CORS tests.
- Expo web startup/build and, separately, a real Expo Go physical-device
  recovery smoke test. Mocks are not proof of live Supabase/Render behavior.

## Preserved assets and current stop point

- Both migration files under `supabase/migrations/` remain unchanged and
  unapplied.
- The existing Vite web app, Express backend and their manifests remain in
  place. B1/B2 add Expo SDK 57 routes in `app/` without changing
  `src/main.tsx` or replacing Vite scripts. B2 implements Supabase
  email/password auth, session restoration/sign-out, protected routing, and a
  read-only cloud file listing. Notes, taxonomy editing, and password
  recovery are not migrated.
- Existing `.env` values were not read. No hosted Supabase/Render settings
  were accessed. No commit, push, migration or deployment was performed.
- The worktree was already dirty before this audit (including untracked
  application, test, documentation and migration files). This audit does not
  classify those unrelated edits as migration work or revert them.
- The B1 foundation and its verification results are recorded in
  `docs/EXPO_PHASE_B1_REPORT.md`. Phase B2 adds a single Expo-runtime
  Supabase client using SDK-compatible AsyncStorage, auth/session routes, and
  a read-only cloud file shell; it does not replace the Vite client or UI.
  Password recovery was web-only at the B2 checkpoint; the follow-up section
  below records the additional Expo implementation. Hosted database
  migrations remain unapplied, and Expo Go has not been tested on a phone.

## Phase B2 status

- `app/` now routes through sign-in/sign-up screens until Supabase session
  restoration completes, then guards the authenticated home shell. The root
  Expo provider owns one auth listener and unsubscribes on unmount.
- Expo reads only `EXPO_PUBLIC_SUPABASE_URL` and
  `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; AsyncStorage backs session
  persistence in web/native Expo. The Vite client retains its independent
  Vite configuration and behavior. No secrets are copied to frontend
  variables.
- The shell calls the existing `loadWorkspaceData` and shows real files with
  the canonical Category → Topic → Subtopic labels. Missing migration/schema
  errors are rendered as setup guidance by the shared data layer. The app
  does not create fake records or modify the database.
- Auth flows use safe existing validation/error mappings and preserve
  Supabase's project-controlled email-confirmation behavior. Native/Expo
  password recovery, notes, taxonomy editing, and other business screens
  were unimplemented at the B2 checkpoint. The password recovery follow-up
  below adds Expo recovery routes without changing the Vite auth flow. No live
  authentication, database, or physical-device behavior was verified.

## Current environment-file safety status

The backend template's assignment values were sanitized locally without
printing them; its six variable names are retained and all assignments are
blank. The template remains untracked. Git metadata shows `.env.example` is
tracked, `.env.local` exists but is untracked, and `backend/.env` is absent.
The local `.env.local` contents were not inspected or changed in this task.
Expo startup's report of `EXPO_PUBLIC_API_BASE_URL` is explained by Expo CLI's
automatic loading/reporting of public-prefixed environment names; it does not
show that the app consumes that variable. See the environment audit and
startup report for the credential-exposure warning and current automated
results.

## Expo Web startup crash follow-up

The earlier Expo Web SSR risk is now fixed locally. The Expo Supabase client
is created lazily by `src/lib/expo-supabase.ts:getExpoSupabaseClient()` rather
than during module evaluation. The getter refuses to initialize the client
for web when no browser `window` exists; once mounted in a browser, it uses
the same persistent AsyncStorage-backed Supabase Auth configuration as
before. Native initialization remains allowed and continues to use the
installed native AsyncStorage implementation.

`src/components/ExpoAuthProvider.tsx` initializes the client in its
post-mount effect, keeps the app in its loading state while restoring a
session, subscribes to auth state once, and unsubscribes on cleanup. This
prevents Expo Router's static server render from invoking the installed
AsyncStorage web adapter, whose `module/AsyncStorage.js` methods access
`window.localStorage`. `src/lib/expo-runtime.ts` holds the small
platform/window guard; `tests/expo-auth.test.ts` covers its web-SSR and
native decisions.

The web static export and Android JavaScript export both pass locally. These
are bundling/render checks, not proof of interactive browser behavior,
physical Expo Go behavior, or live Supabase session restoration. See
`docs/EXPO_STARTUP_FIX_REPORT.md` and
`docs/EXPO_STARTUP_FIX_MANUAL_TESTS.md` for results and outstanding manual
checks. This does not begin Phase B3.

## Expo password recovery follow-up

The missing Forgot Password action was specific to the Expo sign-in form:
`src/components/ExpoAuthForm.tsx` rendered sign-in/sign-up fields but no
recovery link. The Vite app already has an independent browser recovery flow.
Expo now has separate `app/forgot-password.tsx` and `app/reset-password.tsx`
routes, and the existing Expo sign-in screen links to the request route.

The request calls `resetPasswordForEmail` with the redirect produced for the
current runtime. Expo Web uses the page origin plus `/reset-password` (no
assumed production origin or fixed dev port); Expo Go builds the callback from
the current Expo Go `linkingUri`; native builds use the configured
`shyam-project-notes` scheme. The reset route handles the Supabase recovery
callback using `auth.setSession`, requires a recovery session before
`updateUser`, and signs out locally after the password is changed. The
recovery marker is persisted alongside the existing AsyncStorage-backed
session so an app restart can resume a valid recovery session. The accepted
callback URL is replaced after the session is established to remove callback
tokens from the visible URL.

`src/lib/expo-supabase.ts` retains its post-mount web guard and
`detectSessionInUrl: false`; recovery callback handling occurs in the mounted
route through Expo Linking. The static exports include `/forgot-password`
and `/reset-password`, confirming those routes render in Expo's web export.
Unit/SDK tests use mocked fetch responses. No hosted settings, account,
recovery email, live browser session, or Expo Go device was accessed.

For Supabase Authentication → URL Configuration, add the exact web redirect
`http://localhost:8081/reset-password` when that is the actual Expo Web
origin, plus the matching current-origin path for LAN or any real deployed
web origin. Expo Go must be allowlisted with the exact runtime URL used by
the current session, `exp://<runtime-host>:<runtime-port>/--/reset-password`;
its host and port can change with the dev server. A standalone/development
build uses the stable app-scheme redirect
`shyam-project-notes://reset-password`. Do not add a guessed production URL.

Keep the recovery email template on Supabase's confirmation-URL flow
(`{{ .ConfirmationURL }}`) so Supabase verifies the one-time link and
redirects to the requested app URL. A template that hardcodes another
destination or passes only a token hash will not complete this callback
handling. Hosted email settings were not inspected or changed.

See `docs/SUPABASE_PASSWORD_RECOVERY_REPORT.md` for check results and the
manual Expo Web/Expo Go procedures. Live redirect allowlisting, email
delivery/template confirmation, and physical Expo Go link handling remain
manual checks; no release build was created.

## Expo Phase 1 Home and file navigation follow-up

`app/(app)/home.tsx` now uses the existing authenticated guard, Expo Supabase
client, and `loadWorkspaceData` rather than sample content. The shared
`TaxonomyPicker` filters Topic by Category and Subtopic by the selected
Category/Topic, preserves IDs, and clears dependent selections on parent
change. Home opens Notes only for a validated full path, lists actual files
for that Subtopic, and opens a selected file by its actual ID and taxonomy
path. Create File lives at `app/(app)/create-file.tsx` and calls the existing
`createFile` utility after name/path validation; returning to Home refetches
the cloud data.

Taxonomy rows provide an accessible Edit action and double-tap rename. Enter
and blur save through `renameTaxonomyRecord`; Escape cancels. Delete actions
are level-specific and require confirmation. They make one authenticated
delete request for the chosen row. The prepared Phase 1 migration cascades
only taxonomy descendants and has a restrictive file FK, so referenced
files/notes are preserved and block the atomic delete. Actual hosted cascade,
RLS, and restrict behavior is not verified; see
`docs/PHASE_1_DATABASE_READINESS.md`.

At the time of the Phase 1 implementation, `/notes` and `/file` were
placeholders. The Phase 2 recovery follow-up below supersedes that route
status: `/notes` now loads owner-scoped notes for the selected Subtopic, and
`/note` loads and edits one authorized note. `/file` remains a validated
Phase 1 destination. No fake notes or taxonomy are used.

The Expo Web and Android JavaScript exports include Home, Create File, Notes,
Note Editor, and File routes. Unit tests cover selection filtering/clearing,
path validation, note persistence contracts, route parameters, autosave
ordering/retry, copy/delete data operations, rename rules/actions, delete
warnings/targeting, and safe mocked Supabase errors. The repository has no
React Native component interaction test renderer configured; taps, visual
responsiveness, keyboard focus, live Supabase operations, and Android device
behavior remain manual checks. Vite routes and notes/auth behavior were not
replaced.

## Phase 2 recovery follow-up

The current local implementation includes the real-data Notes collection
(`app/(app)/notes.tsx`) and full-page editor (`app/(app)/note.tsx`), using the
authenticated Expo Supabase client and the prepared owner-scoped notes
schema. A copied note now redirects to the destination Subtopic collection
so that its notes are reloaded there. These local paths do not prove deployed
schema/RLS behavior or browser/Expo Go interaction. The exact check results
and remaining manual steps are recorded in
`docs/PHASE_2_IMPLEMENTATION_REPORT.md`.

## Subsequent Phase 3 SQL-practice follow-up

The earlier sections describe checkpoints and are superseded where they
state Expo has no backend URL consumer or no SQL workflow. The Expo editor
now supports an inline SQL practice panel. It resolves an explicit
`EXPO_PUBLIC_API_BASE_URL` when configured, or derives a local web/LAN
backend origin where supported. The root template and source now use this
established name consistently.

The authenticated backend uses an isolated in-memory SQLite sample dataset
for read-only SQL execution, with authorizer and result limits. A separate
Gemini provider call evaluates the SQL and execution result. The Expo editor
can append the question, SQL, output, and evaluation to the existing note
through its current autosave. This is an initial local implementation, not
live backend, Gemini, browser, Expo Go, or deployment verification. The
existing Vite application and backend remain in place. See
`docs/PHASE_1_PHASE_2_PHASE_3_GAP_MATRIX.md` and the continuation section of
`docs/PHASE_2_VERIFICATION_REPORT.md`.
