# Expo Foundation — Phase B1 Report

**Date:** 2026-10-17
**Scope:** Add an Expo/React Native/React Native Web diagnostic foundation
alongside the existing Vite application. No business screens or backend
workflows were migrated.

## Foundation and selected versions

Expo SDK 57 was selected using Expo's SDK 57 package map and Router
documentation. The SDK map specifies React 19.2.3, React Native 0.86.3,
React Native Web 0.21.x and Expo Router 57.0.28. React and React DOM were
pinned to the same 19.2.3 version to match that SDK and avoid the
react/react-dom render-time mismatch observed during initial validation.
React type packages were aligned with Expo's SDK compatibility check.

| Package | Manifest range/version | Resolved during verification |
| --- | --- | --- |
| `expo` | `~57.0.14` | `57.0.30` |
| `expo-router` | `~57.0.28` | `57.0.28` |
| `react` / `react-dom` | `19.2.3` | `19.2.3` |
| `react-native` | `0.86.3` | `0.86.3` |
| `react-native-web` | `^0.21.2` | `0.21.4` |
| `expo-constants` | `~57.0.22` | `57.0.22` |
| `expo-linking` | `~57.0.13` | `57.0.13` |
| `expo-status-bar` | `~57.0.1` | `57.0.1` |
| `react-native-safe-area-context` | `~5.7.0` | `5.7.0` |
| `react-native-screens` | `~4.26.0` | `4.26.2` |
| `react-native-reanimated` / `react-native-worklets` | `4.5.1` / `0.10.1` | `4.5.1` / `0.10.1` |
| `@types/react` / `@types/react-dom` | `~19.2.4` / `~19.2.3` | `19.2.18` / `19.2.7` |

The Expo SDK-matched Router prerequisites were installed with `npx expo
install`. Expo Router and Expo Go are the chosen routing/runtime path.
Reanimated and Worklets resolve to the SDK 57 bundled versions and are
compatible with the corresponding Expo Go runtime; no custom native module
or development build is required for the diagnostic screens. The generated
Expo Go QR flow was not scanned on a physical device, so actual device
connectivity is not verified.

## Files and workflow

- Added `app.json`, `babel.config.cjs`, `tsconfig.expo.json`, and a small
  `scripts/start-expo.mjs` launcher. The launcher sets Expo's
  `EXPO_NO_TYPESCRIPT_SETUP` flag so Expo does not rewrite the existing Vite
  root `tsconfig.json`.
- Added Expo Router screens in `app/`: a diagnostic landing screen, a
  platform/routing screen and the root Stack layout.
- Added `npm start` for Expo and `npm run typecheck:expo` for the new routes.
  `npm run build:expo:web` exports separately to ignored `expo-web-build/`.
- Existing Vite scripts (`dev`, `build`, `preview`) and
  `src/main.tsx` remain intact. Express remains independently runnable in
  `backend/`.
- Added blank public placeholders `EXPO_PUBLIC_SUPABASE_URL`,
  `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and
  `EXPO_PUBLIC_API_BASE_URL` to `.env.example` during B1. The environment
  configuration audit later removed the unused API-base variable; the
  current template keeps only variables consumed by the Vite/Expo frontends.
  No values were copied from local env files during B1.
- Added Expo build artifacts to `.gitignore`. No Supabase migrations were
  changed or applied.

## Commands and verification

Run Expo:

```sh
npm start
```

Press `w` in the Expo terminal for the web target. Install Expo Go on an
Android phone on the same Wi-Fi and scan the QR code. This physical-device
step remains to be performed by the developer. To verify web explicitly:

```sh
npm start -- --web
```

The Vite app is still available separately:

```sh
npm run dev
```

Checks completed:

- `npx expo install --check`: PASS, dependency versions aligned.
- `npx expo-doctor`: PASS, 21/21 checks.
- `npm run lint`: PASS.
- `npm run typecheck:expo`: PASS.
- `npm test`: PASS, 26 tests; React/React DOM versions were aligned after
  the initial run exposed a version mismatch.
- `npm run build`: PASS for the existing Vite app.
- `npm run build:expo:web`: PASS; static output included `/`, `/diagnostic`,
  and Router metadata routes in `expo-web-build/`.
- `npx expo export --platform android --output-dir expo-android-build`:
  PASS; Metro produced the Android JS bundle. This verifies bundling only,
  not installation or execution in Expo Go.
- `npm start -- --web --port 8082 --localhost`: server started successfully;
  HTTP requests to `/` and `/diagnostic` returned 200 and rendered expected
  screen content. The test server was stopped afterward.
- `npm start -- --port 8083`: default Expo/Metro mode started and its
  `/status` endpoint returned `packager-status:running`. This is not a scan of
  the QR code or a physical-device test.
- Backend `npm run build`: PASS; backend `npm test`: PASS, 12 tests.
- `git diff --check`: PASS.

No Android device, live Supabase project, Render service, deployment, or
hosted setting was verified. `npm install` reported 28 dependency audit
advisories (10 moderate and 18 high); no audit fix was run. An initial npm
optional-peer version warning was resolved by aligning Reanimated and
Worklets to the Expo SDK 57 bundled versions. Final `expo install --check`
and Expo Doctor pass.

## Existing application status and remaining blockers

The full existing product remains on Vite: Supabase auth and recovery,
session restoration, file and taxonomy operations, notes, autosave/draft
recovery, Markdown rendering, SQL evaluation and Gemini API requests have not
been ported to Expo. Keep using the current Vite scripts for those features.
The Render backend and its current server environment/configuration remain
separate and unchanged by the Expo app.

Before app screens move, plan and test native storage and session lifecycle,
Expo Router route parity, native dialogs/keyboard handling, Markdown
rendering, asynchronous draft persistence, and the Android LAN/verified
production API base URL. Password recovery needs a tested Expo Go deep-link
and Supabase allowlist design; the configured app scheme is only a foundation
and is not proof that recovery callbacks work. Do not change Supabase hosted
URL settings until the redirect design is verified. Keep Vite available until
feature parity and a reversible cutover plan are reviewed.

The worktree contained pre-existing uncommitted changes before this phase.
No changes were committed, pushed, deployed, or applied to hosted services.
