# Environment Configuration Audit

**Date:** 2026-10-17
**Scope:** Configuration templates, source references, ignore/tracking status,
and Render setup. No application behavior or hosted setting was changed.

## Templates found and canonical variables

Two example templates and one actual ignored local frontend configuration file
are present:

- `C:\Users\HP\shyam-project-notes\.env.example` — root frontend template
  shared by the existing Vite app and the Expo app. The names below are
  present with empty values:

  ```dotenv
  VITE_SUPABASE_URL=
  VITE_SUPABASE_PUBLISHABLE_KEY=
  VITE_BACKEND_URL=
  EXPO_PUBLIC_SUPABASE_URL=
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
  ```

- `C:\Users\HP\shyam-project-notes\backend\.env.example` — local backend
  template. Every assignment has an empty value:

  ```dotenv
  PORT=
  SUPABASE_URL=
  SUPABASE_PUBLISHABLE_KEY=
  GEMINI_API_KEY=
  GEMINI_PRIMARY_MODEL=
  FRONTEND_ORIGIN=
  ```

- `C:\Users\HP\shyam-project-notes\.env.local` — local frontend environment
  file. Its existence, untracked status, and ignore match were checked by
  filename/Git metadata only in this follow-up. Its contents and values were
  not opened, checked, or changed here.

No other `.env.example` or `.env.*.example` files were found. Both templates
were retained because they serve distinct frontend and backend processes.
`EXPO_PUBLIC_API_BASE_URL` is absent from the root template because no current
Expo source or configuration consumes it and Expo does not currently call
the backend. Expo CLI can still report that name if it is defined in
`.env.local`, because it loads public-prefixed environment variables
independently of source usage. No duplicate template was consolidated or
deleted. `backend/.env` was absent and remains absent: the backend supports
process environment variables and `backend/.env.example` is the documented
copy-on-demand local setup. No environment file was removed.

## Source references and variable behavior

| Variable | Used by | Requirement/behavior |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | `src/lib/supabase.ts`; explicitly injected in `vite.config.ts` | Required for the Vite frontend's Supabase client. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `src/lib/supabase.ts`; explicitly injected in `vite.config.ts` | Required public Supabase key for the Vite client. The Vite configuration injects only its three explicitly named variables. |
| `VITE_BACKEND_URL` | `src/components/NotesWorkspace.tsx`, `src/lib/note-ai.ts`; explicitly injected in `vite.config.ts` | Optional public backend origin for Vite AI calls. When blank, the existing resolver uses its local host/port-3001 behavior where applicable. |
| `EXPO_PUBLIC_SUPABASE_URL` | `src/lib/expo-supabase.ts` | Required public Supabase project URL for Expo auth and cloud listing. |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `src/lib/expo-supabase.ts` | Required public publishable key for the Expo Supabase client. |
| `PORT` | `backend/src/server.ts` | Optional locally; defaults to `3001` and is validated. Render supplies its production value. |
| `SUPABASE_URL` | `backend/src/config.ts`, `backend/src/providers.ts` | Backend Supabase project URL for validating user bearer tokens. |
| `SUPABASE_PUBLISHABLE_KEY` | `backend/src/config.ts`, `backend/src/providers.ts` | Publishable key used with Supabase `auth.getUser(token)`. A service-role key is not used or required. |
| `GEMINI_API_KEY` | `backend/src/config.ts`, `backend/src/providers.ts` | Backend-only provider credential for Gemini requests. |
| `GEMINI_PRIMARY_MODEL` | `backend/src/config.ts`, `backend/src/providers.ts` | Backend-only primary Gemini model name. No fallback model is configured. |
| `FRONTEND_ORIGIN` | `backend/src/config.ts`, `backend/src/app.ts` | Comma-separated exact HTTP(S) origins allowed by CORS. Each entry must be an origin with no path or trailing slash. Needed for browser cross-origin access; it is not a frontend redirect setting. |

The root template intentionally contains both current frontend naming
conventions: the Vite app remains supported while Expo screens are migrated.
Only public Supabase project values belong in frontend variables. Gemini and
other server credentials must remain backend-only. Neither a service-role key
nor `EXPO_PUBLIC_API_BASE_URL` belongs in these templates.

## Local, production, and hosted configuration

- **Local frontend:** copy root `.env.example` to the ignored root
  `.env.local`. Set the Vite pair when running `npm run dev`; set the Expo
  pair when running `npm start`. `VITE_BACKEND_URL` is an optional public
  override for Vite. Expo currently has no backend integration, so no Expo
  API URL is required.
- **Local backend:** copy `backend/.env.example` to ignored `backend/.env`,
  or set the same variables in the backend process environment. The backend
  loads `backend/.env` from `backend/src/server.ts`; process variables are
  also supported. `PORT` can be omitted locally to use `3001`.
- **Render production backend:** in Render Dashboard → backend service →
  Environment, set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
  `GEMINI_API_KEY`, `GEMINI_PRIMARY_MODEL`, and `FRONTEND_ORIGIN`. Render
  injects `PORT`; do not hard-code a production port. The backend remains
  configured for root directory `backend`, build command
  `npm ci && npm run build`, start command `npm start`, and health check
  `/health`. `FRONTEND_ORIGIN` must be the actual deployed frontend origin
  once known. No production frontend or Render service URL was invented or
  verified.
- **Production frontend:** configure only the corresponding public Supabase
  URL and publishable key for the chosen Vite or Expo frontend. If Vite calls
  a separately hosted API, `VITE_BACKEND_URL` is its public API origin. No
  Expo API base setting is needed until Expo actually calls the backend.
- **Supabase Dashboard:** Supabase Authentication URL Configuration is
  separate from frontend `.env.local` and Render environment variables.
  Hosted values/settings were not accessed or changed in this audit.

## Current local env file and credential safety

This document includes an earlier environment-cleanup snapshot. Its claims
about current `.env.local` contents and values are not evidence for this
follow-up. In this task, `.env.local` and `backend/.env` were not opened,
read, printed, or modified. Filename and Git metadata checks found root
`.env.local` exists, is untracked, and matches an ignore rule; `backend/.env`
is absent. Expo CLI's earlier startup output reported the names
`EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and
`EXPO_PUBLIC_SUPABASE_URL`; this task did not re-read that file. Expo CLI
loads/reports `EXPO_PUBLIC_` variables from `.env.local` independently of
whether application source consumes them.

The current app source consumes only the two Expo Supabase public variables.
`EXPO_PUBLIC_API_BASE_URL` has no Expo source or configuration reference, so
the startup log does not prove that an Expo API client uses it. It remains
absent from the canonical root template until an Expo backend integration is
actually implemented.

## Git ignore and index findings

`.gitignore` ignores `.env`, `.env.*`, `backend/.env`, and
`backend/.env.*`, while retaining `.env.example` exceptions at the root and
under `backend/`. Current filename/status checks show root `.env.example` is
tracked; `backend/.env.example` is untracked; `.env.local` is untracked and
ignored; and `backend/.env` is absent. No environment-file content was used
to determine Git status, and no Git staging or history operation was
performed.

## Changes and verification

- Updated the root template to keep only currently consumed Vite/Expo public
  variables; removed unused `EXPO_PUBLIC_API_BASE_URL`.
- Sanitized every non-empty assignment in `backend/.env.example`, retaining
  its six variable names and adding comments describing their purpose. All
  assignment values are blank.
- Did not open, read, or modify `.env.local` or `backend/.env`.
- Left `backend/.env` absent because local process environment is supported
  and the documented backend template can be copied when needed.
- Tightened `.gitignore` for backend environment variants while retaining
  both approved example templates.
- Updated README and Expo/gap documentation with source-backed local and
  Render separation.
- `tests/env-templates.test.ts` checks template variable names only. It does
  not read or assert assignment values.
- `npm run lint`: PASS.
- `npm run typecheck:expo`: PASS.
- `npm test`: PASS (35 tests).
- `npm run build`: PASS (Vite frontend build).
- Backend `npm run build`: PASS; backend `npm test`: PASS (12 tests).
- `npm run build:expo:web`: PASS (static web routes and bundle exported).
- `npx expo export --platform android --output-dir expo-android-build`: PASS
  (JavaScript bundle only; not a physical-device or APK test).
- `npx expo install --check`: PASS; `npx expo-doctor`: PASS (21/21).
- `git diff --check`: PASS after the environment/documentation updates.
- Current safe checks verify that the root frontend template and backend
  template contain their expected variable names and blank assignments; no
  actual local environment-file values were checked. Current Git metadata
  confirms `.env.local` is ignored/untracked, `backend/.env` is absent, root
  `.env.example` is tracked, and `backend/.env.example` is untracked.

These checks are local/mock checks only. No live Supabase, Gemini, Render, or
deployed frontend connectivity was tested. No deployment, hosted setting
change, migration, commit, or push was performed.

## Manual action after reviewing this audit

Restore only the Vite and Expo public variables into root `.env.local`.
Place `GEMINI_API_KEY`, `GEMINI_PRIMARY_MODEL`, `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY`, `FRONTEND_ORIGIN`, and optional `PORT` in
`backend/.env` or the backend process environment if running it locally.
Set Render's five backend service variables only in its service environment
and use the actual production frontend origin for `FRONTEND_ORIGIN` when
known. No values were copied from the separate backup.

## Follow-up safety correction

During the startup-fix investigation, a tool output rendered the backend
template's previous non-empty assignments. The only variable in that template
that represents a private credential is `GEMINI_API_KEY`; if its prior
assignment held a genuine key, rotate/revoke it. This follow-up safely blanked
all non-empty assignments in the backend example without printing values.
The other backend variable names are `PORT`, `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY`, `GEMINI_PRIMARY_MODEL`, and `FRONTEND_ORIGIN`.
Do not treat any historical claim about local `.env.local` values as checked
in this task.

## Later Phase 3 environment update

The initial audit above predates the Expo inline SQL practice integration.
The Expo source now consumes the established `EXPO_PUBLIC_API_BASE_URL`
setting for an explicit backend origin, with local browser/LAN fallbacks
where possible. The root template declares this same name, and the template
test verifies it. An earlier local iteration briefly introduced
`EXPO_PUBLIC_BACKEND_URL`; that mismatch has been removed.

An Expo export listed `EXPO_PUBLIC_API_BASE_URL` by name. The configured Expo
runtime project reference was privately compared with the Supabase CLI
linked-project metadata: they match. The Vite-specific Supabase URL was not
configured in the inspected runtime environment. No URL, reference, key, or
environment value was printed. This local comparison does not establish the
project used by a deployed or separately running app.
