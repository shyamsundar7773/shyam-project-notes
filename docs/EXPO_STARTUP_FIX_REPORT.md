# Expo Web Startup Fix Report

## Outcome

The `window is not defined` crash during Expo Router web static rendering is
fixed locally. Supabase Auth no longer initializes at module evaluation:
client creation is deferred until the Expo auth provider mounts in a runtime
where persistent storage is available. Session persistence remains enabled
for web and native Expo.

## Root cause

`src/lib/expo-supabase.ts` used to create the Expo Supabase client at module
scope. Supabase Auth begins initialization when `createClient()` is called
and requests its configured storage. This app supplies
`@react-native-async-storage/async-storage` as storage. The installed web
adapter (`node_modules/@react-native-async-storage/async-storage/lib/module/AsyncStorage.js`,
including its `getItem` and `setItem` methods) accesses
`window.localStorage`. Expo Router static rendering runs without `window`,
so the eager client initialization triggered the reported exception.

This was confirmed against the installed adapter implementation and the
reported Supabase initialization stack; it was not inferred from the stack
trace alone. The successful static export after the fix verifies that the
current server-rendered bundle completes without the reported exception.

## Fix

- `src/lib/expo-supabase.ts` now exposes `getExpoSupabaseClient()`, which
  creates and caches one client lazily. A web runtime without `window` returns
  no client and does not cache a failed initialization. Native runtimes do
  not require a browser global.
- The client still configures `persistSession: true`,
  `autoRefreshToken: true`, and the SDK-supported AsyncStorage adapter.
  Auth persistence was not disabled.
- `src/components/ExpoAuthProvider.tsx` initializes the client in a
  post-mount effect, keeps the UI loading while session restoration runs,
  installs one auth-state subscription, and unsubscribes on cleanup.
  Initialization and restore failures produce a generic user-facing message;
  provider details and credentials are not included.
- `src/lib/expo-runtime.ts` contains the web/window guard predicate.
  `tests/expo-auth.test.ts` covers deferral for web SSR and allowed native
  initialization.
- `tests/env-templates.test.ts` reads only variable names from templates and
  does not inspect or assert assignment values.

## Environment observations

The earlier Expo startup log reported these `.env.local` variable names:
`EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and
`EXPO_PUBLIC_SUPABASE_URL`. This task did not open, read, or modify
`.env.local` or `backend/.env`. Expo CLI automatically loads environment
files and reports `EXPO_PUBLIC_` variable names; the report is not evidence
that each name is consumed by application source. Source/configuration
search confirms Expo consumes only the two Supabase variables;
`EXPO_PUBLIC_API_BASE_URL` has no consumer and is intentionally absent from
the root template until Expo backend integration exists.

The prior startup investigation rendered the untracked `backend/.env.example`
with non-empty assignments in tool output. This follow-up replaced every
non-empty assignment with an empty value, retained the six variable names,
and added comments describing their purpose; no values are reproduced here.
If a genuine `GEMINI_API_KEY` was present in that earlier output, rotate or
revoke it. Other listed backend settings are not private credentials.
The local environment audit has been corrected to distinguish its earlier
snapshot from this follow-up; no claim is made about `.env.local` values.

## Verification

| Check | Result |
| --- | --- |
| `npm run lint` | PASS |
| `npm run typecheck:expo` | PASS |
| `npm test` | PASS — 35 tests |
| `npm run build` | PASS — Vite production build |
| Backend `npm run build` | PASS |
| Backend `npm test` | PASS — 12 tests |
| `npm run build:expo:web` | PASS — Expo Router static rendering and web bundles exported |
| `npx expo export --platform android --output-dir expo-android-build` | PASS — Android JavaScript bundle exported; not an APK/device test |
| `npx expo install --check` | PASS |
| `npx expo-doctor` | PASS — 21/21 checks |
| `git diff --check` | PASS after the final documentation and environment-template changes |

The template test checks variable names only and never reads or asserts
assignment values. A separate safe check verified that all six assignments
in `backend/.env.example` are empty. The root `.env.example` assignments are
also blank. `.env.local` and `backend/.env` were not inspected or verified.
Automated tests use mocked Supabase/provider responses. No real recovery
email, Supabase or Render connection, browser interaction, or physical
Android device was tested.

One Vite build attempt overlapped with another build and failed with a Windows
`EBUSY` file-copy error while writing `dist/`; the standalone rerun passed.
The reported Vite result is the successful standalone build.

A value-suppressing scan of changed tracked/untracked files found only
synthetic test-fixture pattern matches; it emitted no matched values. Ignored
local environment files were excluded and were not read.

## Manual checks and remaining risks

Browser interaction, Expo Go, live Supabase, and Render checks are all
**NOT RUN**. Follow
`docs/EXPO_STARTUP_FIX_MANUAL_TESTS.md` for Expo Web, Expo Go Android,
environment and backend checks. Session restoration and sign-in need valid
local public Supabase configuration and an authorized test account.

Expo Web and Android export success verifies bundling/static rendering, not
live storage behavior or platform UX. Expo password recovery/deep linking,
notes migration, and other Phase B3 functionality remain out of scope and
unstarted. `EXPO_PUBLIC_API_BASE_URL` is currently unused; no Render URL was
invented or tested.

No `.env.local`, `backend/.env`, or external backup values were read or
changed. The backend example's non-empty values were blanked. Because the
prior tool output rendered that template, rotate/revoke `GEMINI_API_KEY` if
its prior value was genuine. No commit, push, deployment, migration, or
hosted setting change was performed.
