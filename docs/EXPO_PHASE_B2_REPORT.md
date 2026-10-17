# Expo Phase B2 — Authentication and App Shell

**Date:** 2026-10-17
**Scope:** Add Expo email/password authentication, session restoration, guarded
routes, sign-out, and a read-only authenticated cloud-file list. The Vite app,
Express backend, and Supabase migrations remain in place.

## Implementation

- The Expo Router root now mounts one auth provider. It owns one Supabase
  `onAuthStateChange` subscription, restores the session from the SDK, and
  unsubscribes on cleanup.
- Expo uses `EXPO_PUBLIC_SUPABASE_URL` and
  `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` only. Its singleton Supabase client
  persists sessions through `@react-native-async-storage/async-storage`
  (`2.2.0`), which is compatible with the selected Expo SDK and bundled Expo
  Go runtime. The existing Vite Supabase client remains separate and
  unchanged in its environment-variable behavior.
- Added responsive native sign-in/sign-up forms, email/password validation,
  safe existing error mapping, confirmation-required messaging, loading
  states, and sign-out. Project email-confirmation behavior remains controlled
  by Supabase Auth.
- Auth and app route groups wait for restoration before redirecting. The
  authenticated home screen reads actual files and taxonomy using the existing
  `loadWorkspaceData` function and displays safe migration/network errors.
  It creates no fake records.
- The Expo app scheme is still only groundwork. Expo password recovery and
  recovery callbacks are not implemented; use the existing Vite recovery
  flow. No notes editor, file CRUD, taxonomy editing, SQL, Markdown, or Gemini
  screen was migrated.

## Configuration and manual checks

In the ignored root `.env.local`, set only the public Expo values
`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from the
Supabase project. Do not copy any service-role, secret, Gemini, or backend
credential. `EXPO_PUBLIC_API_BASE_URL` is not used and is not in the canonical
frontend template.

1. Run `npm start`, press `w`, and verify the sign-in screen appears. Check
   sign-up, the project's email-confirmation path, sign-in, session
   restoration after reload, and sign-out.
2. Run without the Expo public Supabase variables and verify the setup state
   names the missing public configuration without exposing environment
   values.
3. On a physical Android phone on the same Wi-Fi, scan the Expo Go QR code,
   then repeat sign-in, app restart/session restoration, and sign-out. Email
   confirmation may return to the configured Supabase Site URL; native
   confirmation/recovery deep links have not been implemented.
4. If Phase 1 tables are not available, verify the home screen explains that
   the reviewed migration is required. Do not apply migrations as part of
   this phase. If tables are available, verify only real file names and their
   Category → Topic → Subtopic paths are displayed.

No live Supabase, Render, hosted configuration, migration, or physical
Android/Expo Go verification was performed.

## Automated verification

- `npm run lint`: PASS.
- `npm run typecheck:expo`: PASS.
- `npm test`: PASS (32 tests).
- `npm run build` (existing Vite app): PASS.
- Backend `npm run build`: PASS; backend `npm test`: PASS (12 tests).
- `npm run build:expo:web`: PASS; static routes include `/`, `/sign-in`,
  `/sign-up`, and `/home`.
- `npm start -- --web --port 8084 --localhost`: development server started
  and `/` returned HTTP 200; it was stopped after verification.
- `npx expo export --platform android --output-dir expo-android-build`:
  PASS for JavaScript bundling only; it does not prove Expo Go execution.
- `npx expo install --check`: PASS; `npx expo-doctor`: PASS (21/21 checks).
- `git diff --check`: PASS.

Existing Vite and backend scripts remain available. No commit, push,
deployment, hosted setting change, or migration application was performed.
