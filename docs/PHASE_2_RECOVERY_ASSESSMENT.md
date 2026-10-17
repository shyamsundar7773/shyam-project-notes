# Phase 2 Recovery Assessment

**Assessment date:** 2026-10-17
**Starting branch and HEAD:** `main` at `1358bdd307c495b8af0d5a6daf48511a9565d0de`

## Starting repository state

The worktree was already dirty and no changes were staged. Modified tracked
files were `.env.example`, `.gitignore`, `README.md`, `backend/src/app.ts`,
`backend/src/config.ts`, `backend/src/providers.ts`, `backend/src/server.ts`,
`backend/test/app.test.ts`, `package-lock.json`, `package.json`, `src/App.css`,
`src/App.tsx`, `src/lib/supabase.ts`, and `vite.config.ts`.

Untracked paths were `app.json`, `app/`, `babel.config.cjs`,
`backend/.env.example`, `backend/src/ai-notes.ts`, `docs/`, `scripts/`,
`src/components/`, `src/lib/auth.ts`, `src/lib/autosave.ts`,
`src/lib/expo-auth.ts`, `src/lib/expo-password-recovery.ts`,
`src/lib/expo-runtime.ts`, `src/lib/expo-supabase.ts`, `src/lib/note-ai.ts`,
`src/lib/notes.ts`, `src/lib/phase1.ts`, `src/lib/supabase-config.ts`,
`supabase/`, `tests/`, and `tsconfig.expo.json`. All were preserved.
`.env.local`, `backend/.env.local`, and other environment values were not
opened or printed.

## Recovery finding

Phase 2 was not untouched: the current tree contains working local
implementations of the real-data Notes collection, note creation, note
editor/autosave, copy, and confirmed deletion on the Expo routes. The
existing Vite `NotesWorkspace` also contains notes CRUD, editing, autosave,
copy, and delete workflows. The Phase 2 schema migration is present locally
and declares owner RLS plus a restrictive file-owner foreign key.

The evidence does **not** establish whether the quota interruption happened
before coding, during implementation, during testing, or after features were
completed. There is no `docs/PHASE_2_IMPLEMENTATION_REPORT.md`. Existing
documentation is inconsistent with the current tree: the Phase 1 report and
Phase 3 gap tracker describe Expo notes routes as placeholders, but the
current routes implement the collection and editor. The Phase 2 gap report
claims broader implementation and prior checks, but those checks need to be
rerun against the current tree.

## Feature state at recovery

- **Locally implemented:** authenticated workspace reads, canonical
  Category → Topic → Subtopic context, Subtopic-scoped file selection,
  owner/file-filtered note listing, persisted note creation, note cards,
  note editor, autosave status/retry, conditional `updated_at` saves,
  serialized save queue, local draft recovery, copy to a selected file,
  duplicate-title naming, confirmed single-note deletion, and safe failure
  messages.
- **Not established:** hosted migration/RLS installation, live Supabase
  persistence or cross-owner isolation, actual browser interactions, Expo Go
  interactions, and real concurrent-save behavior.
- **Known review items:** rendered UI and service integration lack automated
  coverage; duplicate title selection is a read-then-insert operation and
  therefore not a database-enforced uniqueness guarantee; documentation
  status is stale or contradictory.
- **Database:** local migrations describe owner-scoped taxonomy/files/notes;
  notes reference `(file_id, owner_id)` with `ON DELETE RESTRICT`. Migration
  status and deployed schema are unknown. No migration was applied.

## Recovery work and verification

This run corrected the Expo copy-success route so it reloads the destination
collection, added a focused test for persisted note creation without a
client-supplied owner, and updated the current Phase 2 report plus stale
Phase 1/Expo/gap documentation. No migrations or environment files were
changed. No files were staged.

All requested automated checks pass: lint, Expo TypeScript check, 57 frontend
tests, Vite build, backend build, 12 backend tests, Expo Web export (20 static
routes), Android JavaScript export, Expo install check, Expo Doctor (21/21),
and whitespace checks for touched tracked and new files. Exports are not
browser or physical-device tests. See
`docs/PHASE_2_IMPLEMENTATION_REPORT.md` for exact commands, outcomes, feature
statuses, and manual checklists.

**Exact next step:** Complete the browser and Expo Go interaction checklists
with an authorized test account and non-production data, and have an
authorized operator compare the two prepared migrations with the target
schema/RLS. Keep migrations unapplied and live-service status unclaimed until
that review and explicit authorization occur.

## Continuation update

The follow-up audit confirmed that the linked Supabase CLI can list the
project and migration history, but cannot authenticate its temporary database
role for catalog queries. The CLI project label matches the repository name;
the link was not privately compared against the app's runtime project
configuration. Migration-list output showed no remote version for either
local migration. Neither observation proves whether the hosted tables exist
or whether the runtime targets that project. The reviewed read-only SQL's
optional migration-history relation also returned `42P01`. No hosted write
was made.

This continuation added local Category/Topic/Subtopic create actions and
started Phase 3 SQL practice. SQL execution uses a fixed, in-memory SQLite
practice dataset on authenticated backend endpoints; Gemini receives the
question, submitted SQL, and sandbox result separately and does not execute
SQL. The Expo editor opens the workflow inline and appends the completed
practice block to the current note through its existing autosave.

The intermediate lint and Expo typecheck syntax failure in
`src/lib/note-ai.ts` was corrected. A TypeScript inference failure in the
taxonomy insert helper was corrected by making each table's insert and select
contract explicit. Final local checks pass: lint, Expo typecheck, 65 frontend
tests, Vite build, 16 backend tests/build, Expo Web and Android exports,
Expo dependency check, Expo Doctor (21/21), and `git diff --check`. The
Android export is a JavaScript bundle only. Browser, Expo Go, live Gemini,
and hosted database/RLS checks remain unperformed.

An earlier recovery pass found a mismatch between the Expo export's
`EXPO_PUBLIC_API_BASE_URL` name and a newly added
`EXPO_PUBLIC_BACKEND_URL` source reference. A follow-up corrected source and
the public template to use `EXPO_PUBLIC_API_BASE_URL`; no environment values
were inspected.

## Recovery verification follow-up

The current working tree privately confirms the local Expo runtime project
reference matches the CLI-linked Supabase project reference. The Vite
Supabase URL was not configured in the inspected environment. This is not
evidence about a deployed or separately running app. Hosted table structure,
RLS, grants, and API exposure remain unresolved because read-only database
authentication was unavailable. The reviewed SELECT-only catalog query is
`docs/verify_phase1_workspace_readonly.sql`; it has not been run remotely.
The required next action is an authorized operator's private project
confirmation followed by running that query in the intended Dashboard SQL
Editor and sharing only sanitized catalog/error results. The expected variable must be configured via an approved runtime
configuration when an explicit backend origin is required.

`docs/PHASE_1_PHASE_2_PHASE_3_GAP_MATRIX.md` records the current local gaps
and safest follow-up. Phase 1/2 are not declared fully verified. Phase 3 is
only locally started; preserve hosted authorization blockers and do not
apply migrations, stage, commit, push, or deploy.
