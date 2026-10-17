# Phase 3 Consolidated Gap Tracker

This is a local audit of the current working tree on 2026-10-17. It does not
assert that any hosted schema, auth, RLS, provider, or browser behavior was
verified. Phase 1 and Phase 2 reports remain preserved; statuses below reflect
current code and evidence, not the age of those reports.

## Consolidated gaps

| ID | Phase / feature | Severity | User impact | Evidence and relevant file/API/schema | Local or external | Recommended fix | Dependencies | Test required | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P1-DB-001 | P1/P2 schema installation and compatibility | Critical | Workspace operations fail if the proposed tables conflict with or are absent from the hosted schema. | `supabase/migrations/20261016133000_phase1_taxonomy_files.sql`; `supabase/migrations/20261016140000_phase2_notes.sql`; both use non-idempotent `CREATE TABLE`, named constraints/policies and a Phase 2 dependency on Phase 1 `files`. | External/manual | Compare both proposals with the authorized target schema, then obtain explicit approval before applying. | Authorized schema access and migration approval | Disposable database migration, constraints, RLS and cross-owner tests | BLOCKED |
| P1-DATA-001 | P1 taxonomy provisioning | High | Users cannot create/open files without real Category → Topic → Subtopic rows. | Phase 1 migration contains no seed data; `src/lib/phase1.ts` loads rows but does not provision them. | External/manual | Identify and provision approved taxonomy records for the intended owner; do not invent seed rows. | Approved taxonomy source and ownership mapping | Verify the hierarchy and owner on authenticated reads | BLOCKED |
| P1-AUTH-001 | P1 Supabase authentication | Critical | Sign-in, email confirmation, refresh, and expiry behavior may differ from local expectations. | `src/App.tsx` calls `getSession`, subscribes to `onAuthStateChange`, and implements password sign-up/sign-in/sign-out; `src/lib/supabase.ts` constructs the configured client. No live test account evidence. | External/manual | Verify the hosted Auth email/redirect settings and exercise the complete account/session lifecycle. | Authorized test account and frontend configuration | Sign-up, confirm, sign-in, refresh, sign-out, expired/revoked session | BLOCKED |
| P1-CRUD-001 | P1 taxonomy/file authorization and CRUD | Critical | Data access depends on hosted RLS and schema that have not been verified. | `src/lib/phase1.ts` uses the signed-in Supabase client; Phase 1 migration has owner RLS, same-owner composite FKs and client-supplied owner IDs are omitted. | External/manual | Validate current-user CRUD and cross-user rejection only after schema review. | P1-DB-001, P1-AUTH-001 | Two-user isolation, forged IDs, file create/rename/delete | BLOCKED |
| P1-DEL-001 | P1 taxonomy delete integrity | High | A bad hosted FK could cascade or allow deleting taxonomy with files. | Phase 1 migration cascades category → topic → subtopic, while `files_subtopic_path_owner_fkey` is `ON DELETE RESTRICT`; no database integration test. | External/manual | Verify actual delete behavior against disposable rows and hosted schema. | P1-DB-001 | Delete each taxonomy level with/without referenced files | BLOCKED |
| P1-FILE-001 | P1 file deletion with notes | High | Notes must not silently disappear when their parent file is deleted. | Phase 2 migration declares `(file_id, owner_id)` → `files(id, owner_id) ON DELETE RESTRICT`; `src/lib/phase1.ts` reports failed deletes safely. | External/manual | Verify the restrictive FK is installed and blocks a file delete while notes exist. | P1-DB-001, Phase 2 migration approval | Delete empty file succeeds; delete referenced file is rejected and notes remain | BLOCKED |
| P1-NAV-001 | P1/P2 `/notes` route and taxonomy identity | Medium | A stale, malformed, or unauthorized route must not select another collection. | Vite `src/components/NotesWorkspace.tsx` and Expo `/notes` validate stable taxonomy IDs against authenticated workspace rows; Expo `/note` also verifies note owner and file path. No browser route interaction test. | Local + manual | Keep server/RLS checks authoritative; test direct entry, refresh, altered IDs and selecting between matching files. | P1-AUTH-001, taxonomy provisioning | Browser route and file-selection tests, including inaccessible paths | IMPLEMENTED LOCALLY — MANUAL ROUTE CHECK PENDING |
| P1-TEST-001 | P1 rendered UI coverage | High | Auth, dialogs, keyboard focus and responsive behaviors can regress unnoticed. | `tests/phase1.test.ts` and `tests/phase2.test.ts` cover data/logic with mocked Supabase REST; 58 frontend Node tests pass. No React Native interaction/browser test renderer is configured. | Local + manual | Add an approved browser/React Native interaction harness, or complete the manual checklist in the Phase 1 implementation report. | Test environment/device | Auth and Home flows, dependent selectors, create, rename, confirmation, keyboard and mobile overflow | OPEN — CORE DATA/SELECTION RULES TESTED; RENDERED INTERACTIONS MANUAL |
| P1-EXPO-UI-001 | P1 Expo Home and file navigation | High | Users need real authenticated taxonomy selection, file creation/navigation, and the Phase 2 notes collection/editor. | `app/(app)/home.tsx`, `app/(app)/create-file.tsx`, `app/(app)/notes.tsx`, `app/(app)/note.tsx`, `src/components/TaxonomyPicker.tsx`, `src/lib/phase1.ts`; local routes use real cloud reads and canonical IDs. | Local implementation + manual live checks | Keep canonical IDs, RLS and single-statement restricted deletion; verify hosted schema and real rows before use. | P1-DB-001, P1-AUTH-001, approved taxonomy data | Mocked CRUD/autosave/copy tests, Expo exports, manual browser and Expo Go flows | IMPLEMENTED LOCALLY — HOSTED SCHEMA/DATA AND RENDERED DEVICE CHECKS PENDING |
| P2-DB-001 | P2 notes schema and migration order | Critical | Notes persistence cannot work until schema exists and the Phase 1 composite file-owner key is present. | `20261016140000_phase2_notes.sql` first adds `files_id_owner_unique`, then creates notes; Phase 1 `files.id` is primary-key unique and lacks the composite unique until Phase 2. No remote schema inspected. | External/manual | Review both files against the real schema; confirm the composite FK targets are valid and apply only after approval. | P1-DB-001 | Apply both to disposable DB in timestamp order; inspect constraints and rollback plan | BLOCKED |
| P2-AUTH-001 | P2 note ownership/RLS | Critical | A policy/schema mismatch could expose or reject user notes. | `src/lib/notes.ts` uses the configured signed-in Supabase client and omits owner IDs on inserts; Phase 2 RLS is `owner_id = auth.uid()` and composite file-owner FK. | External/manual | Verify owner-scoped note CRUD and cross-user denial against a disposable Supabase project. | P1-AUTH-001, P2-DB-001 | Two-user read/insert/update/delete and cross-owner file attachment attempts | BLOCKED |
| P2-AI-001 | P2 Gemini provider behavior | High | Model support, latency, quotas and real outputs are not proven by mocks. | `backend/src/providers.ts` uses `@google/genai` with only `GEMINI_PRIMARY_MODEL`; `backend/src/app.ts` authenticates and safely handles provider failures; tests inject fake providers. | External/manual | Perform explicitly authorized controlled connection checks; do not add fallback models. | Valid server config and user approval | Live SQL/Markdown request, timeout, malformed output and quota response | BLOCKED |
| P2-SQL-001 | P2 SQL AI review semantics | High | AI output could be mistaken for actual query results. | `backend/src/providers.ts`, `backend/src/ai-notes.ts`, and `NotesWorkspace` label results illustrative; no SQL execution or database-write path exists. | Local tests + external model check | Preserve the inert-input prompt/UI wording and verify actual model output does not imply live execution. | P2-AI-001 | Mocked prompt/response tests plus controlled manual review | OPEN |
| P2-MD-001 | P2 Markdown rendering safety | High | Unsafe HTML/script execution would expose users to stored XSS. | `src/components/MarkdownPreview.tsx` builds React nodes for a restricted subset; `tests/phase2.test.ts` server-renders script and image HTML as escaped text. No full browser test. | Local + manual | Keep raw HTML disabled and test links/URLs if renderer scope is expanded. | None for current subset | Extend injection corpus; browser-render malicious persisted Markdown | OPEN |
| P2-SAVE-001 | P2 autosave ordering and cloud conflict | High | Network failures or competing edits can lose or overwrite a draft. | `src/lib/autosave.ts` serializes saves and retries; `src/lib/notes.ts` uses `updated_at` conditional update; `NotesWorkspace` preserves a local draft and stops retry after conflict. Unit tests cover out-of-order saves and failure/retry only. | Local + external integration | Test real update trigger/timestamps and conflict behavior; consider a non-destructive merge/export path. | P2-DB-001, P2-AUTH-001 | Delayed/offline/expired-session/concurrent-save tests against disposable DB | OPEN |
| P2-RECOVERY-001 | P2 browser-local draft recovery | High | A blocked/full browser storage or browser exit can prevent recovery of unsaved edits. | `src/lib/notes.ts` catches storage errors; `NotesWorkspace` warns on unload and retries cloud save. Local cache is best effort, not authoritative. | Local + manual | Verify blocked/quota/refresh/offline cases; clearly communicate when local storage is unavailable. | Browser test environment | Storage disabled/full, refresh after failed save, sign-out and recovery | OPEN |
| P2-CONFLICT-001 | P2 conflict resolution | Medium | Resolving a stale save via reload discards the local cached draft. | `NotesWorkspace.reloadLatestVersion()` explicitly confirms, removes the cache, then reloads; no merge/export action. | Local | Decide whether to add copy/export/merge before relying on concurrent editing. | User decision | Conflict flow with recoverable local draft and latest cloud version | OPEN |
| P2-DUP-001 | P2 duplicate/stale file selection | Medium | Switching collections could briefly show old notes under the newly selected file. | `src/components/NotesWorkspace.tsx` previously changed `selectedFileId` without clearing notes in the populated-workspace selector; `tests/phase2.test.ts` now verifies file-scope filtering. | Local | Clear old notes, active editor and stale errors on selection, and filter rendered notes to the selected file. | None | `notesForFile` regression test; browser selector test still needed | VERIFIED (unit regression test; browser behavior remains unverified) |
| P2-UI-001 | P2 workspace interaction coverage | High | Menu, delete confirmation, editing, empty/error/loading states and responsive layout are not verified in a browser. | `src/components/NotesWorkspace.tsx`, `app/(app)/notes.tsx`, `app/(app)/note.tsx`, `src/App.css`; no DOM/browser test dependency. A detailed authorized procedure is in `docs/PHASE_2_MANUAL_TEST_CHECKLIST.md`. | Local + manual | Complete the documented browser/mobile/Expo Go checklist with approved test data. | Authorized account, browser/device, non-production data | Copy/delete, autosave failure/retry, all editor states, responsive/keyboard | OPEN — MANUAL CHECKS NOT RUN |
| P2-RATE-001 | P2 authenticated AI abuse/rate limiting | Medium | One user can repeatedly consume provider quota; endpoint has no per-user rate limiter. | `backend/src/app.ts` verifies bearer tokens and size limits but has no local throttle; 429/upstream handling is generic. | External decision + local if required | Review deployment/provider quotas and abuse controls; implement a scoped limiter only if required by deployment policy. | Render/deployment requirements | Burst, identity isolation, rate-limit response and no credential logging | OPEN |
| P2-OPTIONAL-001 | P2 optional note pin/colour editing | Low | Pin/colour are displayed/stored but cannot be changed in the editor. | `src/lib/notes.ts` and Phase 2 migration contain fields; `NotesWorkspace` has no controls. | Local, optional | Decide whether to add controls; not a prerequisite for core notes functionality. | User preference | UI persistence test if implemented | OPEN |
| P2-TEST-001 | P2 CRUD/UI persistence test gap | High | Copy/delete/save paths are not exercised with a rendered component or real RLS. | 58 frontend tests cover mocked copy/create/delete/update requests, autosave ordering/retry, route taxonomy parameters, Markdown escaping and AI request formatting; persistence tests mock Supabase REST. | Local + external | Add UI tests and disposable-backend integration tests or execute the documented manual checklist; obtain authorized RLS evidence. | Approved test harness and disposable Supabase | Copy distinct ID, confirmation, failed save recovery, file scoping, RLS | OPEN — MOCK CONTRACTS PASS; RENDERED/REAL-RLS CHECKS PENDING |
| P3-MIG-001 | P3 migration naming/account-deletion compatibility | Medium | Existing same-named objects can make migrations fail; cascaded account deletion combined with restrictive note→file references needs explicit behavior verification. | Both SQL files use unconditional object creation; Phase 1 `auth.users` ownership FKs cascade; Phase 2 notes→files is restrictive. No hosted schema/account-deletion evidence. | External/manual | Review object-name collisions and account deletion on a disposable clone; do not add speculative idempotence or weaken RESTRICT. | Authorized schema snapshot | Migration execution and user deletion with files/notes in disposable DB | BLOCKED |
| P3-OPS-001 | P3 deployment and environment | High | Local checks do not establish correct Render configuration or runtime connectivity. | Expo source and template now consistently consume `EXPO_PUBLIC_API_BASE_URL`; local Expo project reference matches the CLI-linked project reference, but deployed runtime identity remains unknown. CLI reports public-prefixed names loaded from `.env.local` whether or not code uses them. No private environment contents were read; no live deployment check. | External/manual + local cleanup | Keep backend variables only in backend runtime configuration. Set `FRONTEND_ORIGIN` to the actual deployed origin after authorized confirmation. | Render deployment configuration and test account | Verify environment separation without displaying values; deployment smoke check | OPEN — MANUAL REMEDIATION / LIVE CHECKS PENDING |
| P3-AUTH-DIAG-001 | P3 password sign-in failure | High | The user cannot access the account; local source cannot establish whether a hosted account has a usable password. | `src/App.tsx` calls `signInWithPassword` with trimmed email and supplied password; `tests/auth.test.ts` verifies the SDK password-grant request and mocked `invalid_credentials` response. The local code cannot inspect account creation method or password state. | External/manual | Use Forgot password to set a password; manually verify project URL/key, email confirmation, account state, and Supabase Auth logs if reset fails. | Authorized user access; no password or token should be shared | Controlled sign-in and recovery with the user's own browser after dashboard checks | BLOCKED |
| P3-AUTH-RECOVERY-001 | P3 password reset flow | High | Without a reset route, users with no known password cannot recover through the app. | `src/App.tsx` sends an explicit `redirectTo` built from the current origin, consumes Supabase `PASSWORD_RECOVERY` callbacks only with a session, keeps recovery mode through `USER_UPDATED`, and returns to sign-in after local sign-out. `src/lib/auth.ts` gates password updates on recovery state, validates length/confirmation, and maps provider errors safely. SDK-mocked checks are in `tests/auth.test.ts`. | Local | Keep recovery session mandatory; dashboard redirect and email behavior remain external. | P3-AUTH-URL-001 | Frontend SDK mocks pass; actual recovery email remains a manual hosted test | FIXED LOCALLY |
| P3-AUTH-URL-001 | P3 Supabase recovery URL configuration | High | A recovery email may fail to return to the app or may be rejected by the redirect allowlist. | The tracked baseline had no `resetPasswordForEmail` redirect override; Supabase therefore used its configured Site URL unless the email template overrode it. The observed port 3000 is consistent with that fallback but the live Site URL/template were not inspected. Current code explicitly sends the browser origin plus `/reset-password`. | External/manual | Confirm Site URL, exact desktop/LAN Redirect URLs, Email provider confirmation policy, recovery template and project password rules in Supabase Dashboard. | Dashboard access and chosen test origins | Send one approved recovery email and test expiry/update flow | BLOCKED |
| P3-LAN-001 | P3 Android-to-backend addressing and CORS | Medium | `localhost` on a phone points to the phone, not the laptop; a single desktop CORS origin blocks a LAN page. | Added `resolveBackendBaseUrl` to use same-host LAN backend when locally served via HTTP; backend now accepts a comma-separated exact-origin `FRONTEND_ORIGIN`; frontend/backend tests cover host rewrite and allow/deny behavior. | Local | Set exact local and LAN origins and verify the firewall/device path manually. | Laptop IP, backend on port 3001, private-network firewall access | Automated resolution/CORS tests pass; phone networking remains untested | FIXED LOCALLY |
| P3-LAN-002 | P3 Android browser validation | High | Desktop unit/build checks do not prove phone rendering, keyboard, recovery, or local network behavior. | No browser automation or Android device tool was available; Vite supports the documented `--host 0.0.0.0` command and backend listens on `0.0.0.0`. | External/manual | Run the documented PowerShell and Android checklist below on the same private Wi-Fi. | Android device, laptop IP, firewall, Supabase redirect allowlist | Manual browser checks for auth, recovery, AI and responsive interaction | BLOCKED |
| P3-TEST-001 | P3 rendered web-app coverage | High | Node tests do not verify rendered forms, focus, responsive layout, and real browser navigation. | Current `npm test` runs 47 frontend unit/SDK-mock tests; backend tests exercise 12 HTTP/provider-mock cases. Expo static web export includes auth/recovery/Home/Create File/navigation placeholder routes, but no DOM/browser interaction or actual browser check was used. | Local + manual | Add an approved browser/DOM and React Native interaction harness or complete the documented manual checklist. | Browser test tooling/device | Rendered auth/recovery/workspace plus keyboard/mobile checks | OPEN |
| P3-EXPO-001 | Expo Go frontend migration | High | Vite remains the existing full product UI; Expo now has local Phase 1 Home/file flows and Phase 2 notes collection/editor, but hosted and physical-device behavior is unverified. | B1/B2 provide SDK 57, AsyncStorage, Expo Supabase config, auth/recovery, guarded Home, and cloud files. Later local work adds taxonomy selection/create/rename/delete plus real-data notes list/editor/copy/delete. | Local UI implementations; hosted/device verification and broader migration remain | Keep Vite and backend intact. Do not replace the Vite entry until parity and rollback are verified. | Authorized schema/data, live auth verification, physical Android device | Lint/typecheck/tests/builds, Expo web/Android exports, browser/Expo Go manual checks, live Supabase session/file listing, and Vite regression | PARTIAL — PHASE 1/2 UI LOCAL; HOSTED SCHEMA AND LIVE/DEVICE VERIFICATION PENDING |
| P3-EXPO-SSR-001 | Expo Web Supabase startup | High | Expo Router static server rendering previously crashed because Supabase Auth initialization invoked AsyncStorage's browser-only `window.localStorage` adapter. | `src/lib/expo-supabase.ts:getExpoSupabaseClient()` now lazily creates one cached client and guards web SSR; `src/components/ExpoAuthProvider.tsx` initializes it only after mount. Installed AsyncStorage web adapter accesses `window.localStorage`. `npm run build:expo:web` and Android export pass. | Local | Keep client creation post-mount and persistent storage; complete the documented Expo Web and Expo Go manual auth/session checks. | Browser and physical Android device; live test account for auth | Expo web static export, Android JS export, tests and Expo Go/manual session restoration | FIXED LOCALLY — MANUAL DEVICE/AUTH CHECKS NOT RUN |
| P3-EXPO-RECOVERY-001 | Expo password recovery | High | Users without a known password cannot recover from the Expo sign-in screen until Supabase accepts the runtime redirect and the email template sends the standard confirmation URL. | Expo sign-in lacked a recovery link and had no recovery routes. Added `app/forgot-password.tsx`, `app/reset-password.tsx`, callback session handling, password validation/update, safe expired/missing-link states, and runtime-generated web/Expo Go/native redirects. Mocked SDK tests cover request, redirect, callback, update, validation, and existing sign-in. Static web export includes both routes. | Local implementation + external/manual configuration | Allowlist exact actual Expo Web, Expo Go runtime, and configured native scheme redirect URLs; verify `{{ .ConfirmationURL }}` email template and run browser/device recovery checks. | Supabase URL Configuration/email template; Expo Go device and authorized test account | `npm test`, Expo Web and Android exports; manual valid/expired-link/browser/Expo Go checks | IMPLEMENTED LOCALLY — HOSTED CONFIGURATION AND LIVE/DEVICE TESTS PENDING |

## Architecture and migration review

- **Canonical identity:** The frontend uses stable category/topic/subtopic IDs.
  `isValidTaxonomyPath` checks each parent relationship; workspace data is
  fetched for the current Supabase session, and matching files require all
  three exact IDs. The database composite FKs are intended to be the final
  hierarchy guard. UUID syntax alone is not treated as authorization.
- **Ownership and RLS:** Frontend CRUD uses the Supabase client created from
  the publishable key and the current session. Inserts omit `owner_id`; the
  prepared migrations default it to `auth.uid()` and check ownership in RLS.
  These are design-level guarantees until applied and cross-user tested.
- **Relationships/deletion:** Phase 1 taxonomy descendants cascade, but the
  file FK restricts deleting a referenced subtopic. Phase 2 first adds a
  unique `(files.id, files.owner_id)` target and then references that pair
  from notes with `ON DELETE RESTRICT`, preventing cross-owner attachment and
  silent file deletion. Phase 2 depends on Phase 1 and both proposals are
  non-idempotent by design. No duplicate names or object collisions were
  checked against hosted schema. Account deletion through cascading
  `auth.users` ownership FKs needs disposable-database verification alongside
  the restrictive relationship.
- **Authentication:** `App.tsx` calls Supabase `signInWithPassword` with the
  email trimmed and password supplied by the user; `src/lib/supabase.ts` reads
  `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. The mocked SDK test
  confirms the password-grant path and safe invalid-credentials message.
  Account presence in Auth Users does not establish whether a password was
  set or whether the user was invited/OAuth-created; local evidence cannot
  distinguish those account states. The prior generic failure is compatible
  with a wrong password or no usable password, while network/configuration,
  confirmation and rate-limit failures have separate safe messages. A reset
  flow now requests origin-scoped recovery, requires a Supabase recovery
  session, validates a new password, and calls `updateUser`. Supabase settings
  and the user's account state remain unverified.
  `useSession` restores with `getSession` and listens for auth events; SDK
  tests cover storage restore and local sign-out. No live token or hosted Auth
  behavior was tested.
- **Environment safety:** Root `.env.local` exists and is ignored; it was not
  read. Vite disables the default `VITE_` prefix export and explicitly defines
  only `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and the public,
  non-secret `VITE_BACKEND_URL`. The app reads no service-role or secret key.
  This is a code-level inspection, not proof that the local values target the
  intended project or work.
- **Expo environment names:** `src/lib/expo-supabase.ts` consumes only
  `EXPO_PUBLIC_SUPABASE_URL` and
  `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. No Expo source/configuration
  reference consumes `EXPO_PUBLIC_API_BASE_URL`. Expo CLI's automatic
  `.env.local` loading/reporting includes public-prefixed names regardless
  of source references; the startup log is not proof of API URL usage.
- **Backend template cleanup:** `backend/.env.example` remains untracked.
  Non-empty assignments were blanked without printing values, and comments
  now document the six backend variable purposes. `.env.local` and
  `backend/.env` were not opened or modified in this follow-up.
- **Phone backend URL/CORS:** When configured with a loopback backend URL on a
  local HTTP LAN page, the frontend rewrites the backend hostname to that
  page's private host; without an override, it defaults to port 3001 only for
  loopback/private/local-network hosts. `FRONTEND_ORIGIN` accepts only
  comma-separated exact HTTP(S) origins. Unit/integration tests cover this
  behavior, but no device or Windows Firewall path was tested.
- **Persistence:** Note CRUD calls `notes` directly using the authenticated
  client; it is not fake local persistence. RLS is essential. Local storage is
  only a recovery draft, not the cloud database.
- **AI:** SQL is prompt input only and is never executed. The model is only the
  configured primary. The AI routes contain no Supabase mutation calls.
- **Markdown:** Preview code creates a limited set of React elements and does
  not inject raw HTML. Tests verify escaped script/image strings in rendered
  output. No browser-level script execution test was run.
- **Autosave/errors:** A serial queue coalesces drafts and retries; conditional
  `updated_at` writes reject stale updates. Failed writes leave the local
  draft when storage is available. Conflict UX intentionally does not
  overwrite the remote version but presently offers reload/discard rather
  than merge.
- **Test evidence:** Frontend tests are Node unit/data/render-to-static-markup
  checks with mocked Supabase REST and SDK fetch. Backend tests are HTTP tests
  with mocked Auth/Gemini providers. They are not browser tests and do not
  establish live service behavior.

## Current Expo URL and project-reference correction

Earlier audit text above predates SQL practice integration and incorrectly
concluded that Expo did not consume a backend URL. Current source and
`.env.example` use `EXPO_PUBLIC_API_BASE_URL`. The local Expo Supabase project
reference was privately compared with the CLI-linked reference and matches;
the Vite URL is not configured in the inspected local environment. These
local facts do not verify the deployed runtime or hosted schema.

## Verification and state

- `npm run lint`: PASS.
- `npm run build`: PASS.
- `npm test`: PASS, 35 tests (latest run).
- `backend/ npm run build`: PASS.
- `backend/ npm test`: PASS, 12 tests.
- `npm run typecheck:expo`: PASS.
- `npm run build:expo:web`: PASS; static routes rendered and exported.
- `npx expo export --platform android --output-dir expo-android-build`: PASS
  (JavaScript export only; not a physical-device test).
- `npx expo install --check`: PASS; `npx expo-doctor`: PASS (21/21).
- `git diff --check`: PASS (Git emitted only line-ending normalization warnings
  for existing `package.json` and `vite.config.ts`).
- Vite LAN-host smoke check: PASS; temporary server returned HTTP 200 via
  loopback and the laptop's default-route IPv4 interface, then was stopped.
  This did not test an Android device or an external network.
- **Phase 1 migration:** `PREPARED — NOT APPLIED`.
- **Phase 2 migration:** `PREPARED — NOT APPLIED`.
- **Git:** branch `main`; HEAD `1358bdd307c495b8af0d5a6daf48511a9565d0de`;
  pre-existing Phase 1/2 worktree remains dirty and uncommitted.
- `.env.local` and `backend/.env` were not read or modified. The backend
  example template was safely sanitized to blank assignment values without
  emitting values. No remote Supabase or GitHub state was queried, and no
  commits, pushes, deployments or migrations were performed.
- Root `.env.local` exists, is ignored, and is not tracked; its values were not
  inspected. The backend now reads ignored `backend/.env` or process
  environment variables; no backend environment values were read.

## Authentication diagnosis and manual recovery checklist

- **Likely cause, not proven:** The frontend calls the correct Supabase
  password-grant method. A password login returning `invalid_credentials`
  cannot be resolved from the user's presence in the dashboard alone; the
  account may have no known password or the supplied password may be wrong.
  Account creation method/password state and hosted confirmation settings
  cannot be inferred from this repository. The local SDK mock verifies the
  method and error translation, not the hosted account.
- **Dashboard checks:** In Authentication → URL Configuration, set the Site
  URL for the intended app and allow exact `http://localhost:5173/reset-password`
  and `http://<LAPTOP-LAN-IP>:5173/reset-password` entries. In Authentication
  → Providers → Email, confirm Email is enabled and review the project's
  email-confirmation policy. Confirm the recovery template uses the standard
  confirmation URL flow (normally `{{ .ConfirmationURL }}`), not a hard-coded
  redirect, and verify delivery/expiry/password policy. Supabase dashboard and
  email settings were not accessed; this remains manual.
- **Local variables:** Put only `VITE_SUPABASE_URL`, the publishable
  `VITE_SUPABASE_PUBLISHABLE_KEY`, and optional public `VITE_BACKEND_URL` in
  root `.env.local`. Put `GEMINI_API_KEY`, `GEMINI_PRIMARY_MODEL`,
  `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and exact-origin
  `FRONTEND_ORIGIN` in `backend/.env` or the backend process environment.
  Vite exposes only the three explicitly defined frontend values. Render
  receives the five backend variables in Service → Environment; once the real
  frontend deployment is known, use its origin without a path or trailing
  slash for `FRONTEND_ORIGIN`. Render does not affect Supabase redirects.
- **Desktop test:** Start `npm run dev` and the backend from `backend/` with
  its local variables configured. Open `http://localhost:5173`, submit Forgot
  password, and use the recovery email link in that same browser. Confirm it
  opens `/reset-password`, an expired/reused link does not show the update
  form, short/mismatched passwords are rejected, and a valid password update
  returns to sign-in.
- **Android test:** Set `FRONTEND_ORIGIN` to the exact comma-separated
  localhost and laptop LAN origins, restart the backend, and start Vite with
  `npm run dev -- --host 0.0.0.0`. Find the laptop's active private IPv4 as
  documented in `README.md`; open `http://<LAPTOP-LAN-IP>:5173` on the phone
  over the same Wi-Fi, request recovery from that origin, and open the email
  link on the phone. Verify the same valid/invalid password cases and confirm
  the return destination uses the LAN address. Permit Vite/backend through
  Windows Firewall for the private network only if needed. No Android device
  or live email was tested locally. Never share credentials or recovery links.

## Manual verification order

1. Obtain approval and compare both proposed migrations with the actual target
   schema; apply only through the approved process. Verify migration order,
   owner RLS, hierarchy constraints, restrictive file deletion and account
   deletion behavior in a disposable project first.
2. With an authorized test account, verify sign-up/email confirmation,
   sign-in, refresh/session restoration, expiry/sign-out, taxonomy reads and
   two-user RLS isolation. Verify taxonomy records are approved and correctly
   owned.
3. Verify authenticated note create/list/update/copy/delete, cross-file and
   cross-user isolation, parent-file RESTRICT, and concurrent `updated_at`
   conflict handling against the disposable schema.
4. Run controlled Gemini SQL/Markdown checks only with explicit approval and
   approved server-side configuration. Confirm SQL is never executed,
   output remains illustrative, source survives failures, and no key is
   exposed to frontend assets or logs.
5. In browser, test autosave success/failure/retry, refresh recovery,
   storage-disabled/quota behavior, conflicting edits, menu and dialog
   keyboard/focus behavior, duplicate clicks, Home/back navigation, and
   responsive layouts.
6. Only after approvals, consider deployment smoke tests for Netlify/Render;
   deployments and hosted builds are outside this audit.

## Current continuation update

The earlier tracker entries are an audit snapshot. This update reflects the
subsequent local Phase 3 work: an authenticated backend question endpoint and
isolated in-memory SQLite `SELECT` runner were added, and the Expo note editor
now has an inline SQL practice panel that separately requests Gemini
evaluation and appends the result to the same note. See
`docs/PHASE_1_PHASE_2_PHASE_3_GAP_MATRIX.md` for the current phase-by-phase
matrix.

The SQL runner is not production-verified. It uses a fixed sample dataset,
does not connect to Supabase, rejects recursive CTEs, and has automated tests
for read-only restrictions and output limits. Existing SQL Lab work in a
sibling local repository was used as isolated SQLite/separate-evaluation
prior art; no sibling files were changed.

The Supabase CLI's temporary database role could not authenticate for
read-only catalog queries. Migration-list output contained no remote version
for either local migration, but this does not prove that the tables are
absent. Hosted schema, RLS, API exposure, app-project match, and the original
Home error therefore remain unknown. Phase 1 and Phase 2 remain blocked from
full readiness claims until an authorized read-only schema review and manual
browser/Expo Go workflows are completed.

No migration, hosted configuration, deployment, staging, commit, or push was
performed. Exact current checks and outcomes are in the continuation section
of `docs/PHASE_2_VERIFICATION_REPORT.md`.
