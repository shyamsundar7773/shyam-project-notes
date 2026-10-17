# Expo Startup Fix Manual Tests

**Status:** All checks below are **NOT RUN**. Build/export checks are not a
substitute for interactive browser or device testing.

## Expo Web

- [ ] **NOT RUN** — From the project root, restore only approved public Expo
  configuration in `.env.local`, then run `npm start`.
- [ ] **NOT RUN** — Press `w` in the Expo terminal and confirm the page opens
  without `ReferenceError: window is not defined`.
- [ ] **NOT RUN** — Confirm the sign-in screen or expected authenticated
  route renders after the initial loading state.
- [ ] **NOT RUN** — With an authorized test account and working Supabase
  settings, sign in and verify the authenticated home route.
- [ ] **NOT RUN** — Refresh the browser and verify the persisted session is
  restored without a startup crash.
- [ ] **NOT RUN** — Sign out and verify the protected route returns to
  sign-in.

## Expo Go on Android

- [ ] **NOT RUN** — Connect the phone and laptop to the same trusted Wi-Fi;
  run `npm start` from the project root.
- [ ] **NOT RUN** — Scan the Expo QR code in Expo Go and confirm the app opens
  without a crash.
- [ ] **NOT RUN** — Confirm sign-in and the expected authenticated route with
  an authorized test account.
- [ ] **NOT RUN** — Restart/reload the app and verify session restoration.
- [ ] **NOT RUN** — Verify navigation and sign-out.

## Environment and backend

- [ ] **NOT RUN** — Confirm Expo receives the intended public
  `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  configuration from the root local environment.
- [ ] **NOT RUN** — Verify the SQL practice panel resolves the intended
  backend using `EXPO_PUBLIC_API_BASE_URL` or the documented local web/LAN
  fallback. The variable name in Expo CLI output is not proof that the
  backend is reachable.
- [ ] **NOT RUN** — Exercise SQL practice only against the isolated local or
  approved test backend. No production SQL execution or deployed Render
  endpoint has been verified.
- [ ] **NOT RUN** — If local backend connectivity is tested separately, use
  the reviewed local backend configuration and the laptop's reachable LAN
  address; do not put backend secrets in Expo public variables.
- [ ] **NOT RUN** — If a genuine `GEMINI_API_KEY` was present in the earlier
  `backend/.env.example` tool output, rotate/revoke it. The backend template
  assignments have now been blanked; the template remains untracked.

Do not paste passwords, recovery links, access tokens, refresh tokens, or
environment values into screenshots, logs, issues, or reports.
