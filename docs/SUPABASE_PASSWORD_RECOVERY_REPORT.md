# Expo Supabase Password Recovery Report

**Date:** 2026-10-17
**Scope:** Add password recovery to the existing Expo Router authentication
shell. The Vite authentication flow and Expo Supabase client architecture
remain in place.

## Root cause and behavior

The Expo sign-in screen is `app/(auth)/sign-in.tsx`, which renders
`src/components/ExpoAuthForm.tsx`. The shared form provided sign-in and
sign-up but had no Forgot Password action. Expo also had no recovery-request
or reset-password routes. The Vite app has a separate browser recovery
implementation; it was not wired to the Expo routes.

The Expo sign-in form now links to `/forgot-password`. That route validates
the email and calls `resetPasswordForEmail` with a redirect for the active
runtime. `/reset-password` handles the recovery callback using the existing
Supabase client, requires an active recovery session, validates a new
password (minimum eight characters and matching confirmation), calls
`updateUser`, reports success/errors safely, and signs out locally before
returning to sign-in. The recovery marker is persisted with AsyncStorage so a
valid recovery session can be resumed after app restart. Missing, invalid,
expired, and already-used links offer a fresh-link path.

The previous Expo Web SSR fix remains intact: Supabase client initialization
is lazy and guarded by `canInitializeExpoSupabase`; URL/session handling is
performed by the mounted route. Recovery tokens are not rendered or logged,
and the URL is replaced after a recovery session is established.

## Files changed

- `src/components/ExpoAuthForm.tsx` — accessible Forgot Password link on the
  existing sign-in screen only.
- `app/forgot-password.tsx` — email request screen and runtime redirect.
- `app/reset-password.tsx` — callback handling, gated password form,
  success/failure states, and local sign-out.
- `app/_layout.tsx` — registers the recovery routes.
- `src/components/ExpoAuthContext.ts`,
  `src/components/ExpoAuthProvider.tsx` — recovery-session state and
  persistence alongside the existing auth session lifecycle.
- `src/lib/expo-password-recovery.ts` — runtime redirect, request and
  callback helpers.
- `src/lib/auth.ts` — maps thrown password-update errors through the
  existing safe error mapper.
- `tests/expo-auth.test.ts` — mocked Supabase request/callback/update
  coverage, validation, redirect generation, and normal sign-in regression.
- `docs/EXPO_MIGRATION_AUDIT.md`,
  `docs/PHASE_3_GAP_TRACKER.md` — current status, configuration, and gaps.

## Redirect and Supabase configuration

The request redirect matches an implemented Expo Router route and is
generated at runtime; no production URL or port is hardcoded:

| Runtime | Redirect URL to allow in Supabase Authentication → URL Configuration |
| --- | --- |
| Expo Web, current local origin | `http://localhost:8081/reset-password` when the web app is actually served from `http://localhost:8081`; use the actual current origin if it differs. |
| Expo Web over LAN | `http://<current-host>:<actual-port>/reset-password`; add the exact origin used on the phone. |
| Expo Go | `exp://<runtime-host>:<runtime-port>/--/reset-password`; add the exact URI generated from the current Expo Go runtime. The host/port can change when the dev server changes. |
| Standalone/development build | `shyam-project-notes://reset-password`, using the existing `scheme` in `app.json`. |
| Deployed web app | `https://<actual-deployed-origin>/reset-password` only after that origin is known. No production URL was assumed. |

The Expo Web redirect comes from `Linking.createURL('/reset-password')`, so
it follows the current web origin. Expo Go uses the host and protocol from
`Constants.linkingUri` and adds Expo Go's `/--/reset-password` route. Built
native apps use the configured `shyam-project-notes` scheme.

The recovery email template should retain Supabase's standard confirmation
URL, `{{ .ConfirmationURL }}`, so Supabase verifies the one-time recovery
link and redirects to the supplied app URL. A hard-coded destination or a
template that sends only a token hash is incompatible with this callback
handler. The hosted URL allowlist and email template were **not** inspected
or changed. Add only actual origins/URIs; do not add a guessed production
URL. The Supabase Site URL, provider/email settings, password policy, and
email delivery remain to be confirmed by the project owner.

## Automated verification

Latest locally completed checks:

| Check | Result |
| --- | --- |
| `npm run lint` | PASS |
| `npm run typecheck:expo` | PASS |
| `npm test` | PASS — 39 frontend tests, including mocked recovery request/session/update and normal sign-in |
| `npm run build` | PASS — Vite TypeScript and production build |
| `npm --prefix backend run build` | PASS |
| `npm --prefix backend test` | PASS — 12 tests |
| `npm run build:expo:web` | PASS — static Expo Web export includes `/forgot-password` and `/reset-password` |
| `npx expo export --platform android --output-dir expo-android-build` | PASS — Android JavaScript bundle export only |
| `npx expo install --check` | PASS — dependencies are up to date |
| `npx --yes expo-doctor` | PASS — 21/21 checks |
| `git diff --check` | PASS — only pre-existing line-ending normalization warnings were reported |

The current Node test harness has no React Native component-interaction
renderer. Recovery API and route helpers are unit-tested with mocked Supabase;
Expo Web static export verifies that the routes bundle. Actual screen
interaction, real email delivery, and link opening remain manual checks
below.

## Manual Expo Web test

1. In Supabase URL Configuration, add the exact callback URL for the browser
   origin you will use. For the current local setup, use
   `http://localhost:8081/reset-password` if Expo Web actually opens at
   `http://localhost:8081`; if the origin/port differs, allow the actual
   origin plus `/reset-password`.
2. Ensure the recovery email template uses `{{ .ConfirmationURL }}`. Do not
   replace it with a hard-coded origin or token-hash-only link.
3. Start Expo with `npm start`, press `w`, and open the reported web origin.
   On the existing sign-in screen, activate **Forgot password?**.
4. Submit an authorized test account email. The screen should show a generic
   sent confirmation without revealing whether that address has an account.
5. Open the recovery email in the same browser/origin. It should land on
   `/reset-password`. Confirm a short password and a mismatched confirmation
   are rejected; submit a matching password of at least eight characters.
6. Confirm the success state, return to sign-in, and sign in with the new
   password. A missing/expired/reused link and a direct visit without a
   recovery session must offer a fresh recovery link and must not show the
   password update form.

## Manual Expo Go test

1. Start Metro using `npm start` and open the project in Expo Go on an
   authorized Android test device. Confirm the phone can reach the dev server.
2. The recovery redirect is based on the current Expo Go runtime:
   `exp://<runtime-host>:<runtime-port>/--/reset-password`. Add that exact
   URI under Supabase Authentication → URL Configuration before requesting a
   reset. If the runtime host or port changes, update the allowlist.
3. In Expo Go, open the sign-in screen, activate **Forgot password?**, and
   request recovery for the authorized test account.
4. Open the message on the same phone and follow the link into Expo Go. Verify
   expired/missing-link handling, password/confirmation validation, successful
   update, local sign-out, and sign-in using the new password.
5. For a standalone or development build, use the configured stable callback
   `shyam-project-notes://reset-password` instead; Expo Go itself uses its
   runtime `exp://` URL.

No live Supabase request/email, browser interaction, Expo Go session, Android
device, or hosted dashboard was accessed for this work.

## Remaining gaps and limitations

- Supabase redirect allowlisting, the hosted email template, and recovery
  email delivery need owner-side verification.
- The callback currently handles the existing Expo client's implicit
  recovery callback (`type=recovery` with access/refresh tokens in the URL
  fragment). If the hosted template/project is changed to a PKCE/code-only or
  token-hash-only callback, the SDK flow and route handler must be adapted
  together.
- Expo Go runtime callback URLs are not stable; the current host/port must be
  allowlisted for each runtime, or use a development/standalone build with
  the configured scheme.
- Automated tests do not render and tap the React Native controls. Complete
  the manual interaction checks above.
- Most product screens remain outside the Expo migration. No Phase B3 or
  unrelated functionality was started.
- No hosted settings, migrations, environment files, deployment, commit, or
  push were changed.
