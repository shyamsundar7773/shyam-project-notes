# Phase 1 Expo Home and File Flow

**Date:** 2026-10-17
**Scope:** Database readiness audit and Expo Home, Category → Topic →
Subtopic selection, Create File, real file listing/navigation, taxonomy
rename, and safe hierarchy deletion. The Vite app and existing auth
architecture remain in place.

This report is a Phase 1 checkpoint. Its statements that the Expo Notes
routes were placeholders were accurate at that checkpoint and are superseded
by the Phase 2 implementation described in
`docs/PHASE_2_IMPLEMENTATION_REPORT.md`.

## Implementation

- **Home:** `app/(app)/home.tsx` retains the authenticated route guard,
  displays the signed-in account and sign-out action, and adds the
  `My Practiced Notes` heading, responsive spacing, loading/error/empty/
  success states, hierarchy controls, `Open Notes`, `Create File`, and
  real files for the selected Subtopic.
- **Selection:** `src/components/TaxonomyPicker.tsx` displays real
  Categories, only the selected Category's Topics, and only the selected
  Topic's Subtopics. Changing a parent clears dependents. Stable IDs are
  preserved in validation and navigation. No taxonomy records are invented.
- **Create File:** `app/(app)/create-file.tsx` loads actual workspace records,
  requires a valid file name and complete Category/Topic/Subtopic path,
  prevents duplicate submissions, preserves form values on failures, and
  calls the existing `createFile` utility. After successful persistence it
  returns Home, which refreshes cloud data and displays `File added
  successfully`.
- **Files and destinations:** Home filters real files by the exact selected
  taxonomy path. `Open Notes` passes the selected three IDs; each file open
  passes the file ID and all three taxonomy IDs. `app/(app)/notes.tsx` and
  `app/(app)/file.tsx` are verified Phase 2 placeholders: they reload actual
  workspace rows, reject stale/invalid IDs, display no fake notes, and say
  note viewing/editing/saving is not implemented.
- **Rename:** Category, Topic, and Subtopic rows support double-tap and an
  accessible `Edit` control. Inline text selects on focus; Enter and blur
  save via `renameTaxonomyRecord`, Escape cancels, names are validated, and
  UI data changes only after server success. Failures leave the saved name
  unchanged and surface a safe error.
- **Deletion:** Each taxonomy level has its own Delete action and a
  confirmation that describes the affected descendants. The confirmed
  action sends one delete for the chosen row; database cascades can remove
  only descendant taxonomy rows, and the restrictive file FK blocks the
  atomic operation when those rows are referenced. Files and notes are never
  explicitly deleted by taxonomy actions.
- **Data helpers/tests:** `src/lib/phase1.ts` adds dependent-record filters,
  selection normalization, create validation, canonical route builders,
  rename validation, and confirmation text. Existing client, session guard,
  AsyncStorage behavior, password recovery, Vite app, and backend were
  retained.

No theme control existed on the Expo Home baseline. The UI continues its
existing light palette; no theme system or separate taxonomy model was
introduced.

## Files changed for this phase

- `app/(app)/home.tsx`
- `app/(app)/create-file.tsx`
- `app/(app)/notes.tsx`
- `app/(app)/file.tsx`
- `src/components/TaxonomyPicker.tsx`
- `src/components/ExpoPhase2Placeholder.tsx`
- `src/lib/phase1.ts`
- `tests/phase1.test.ts`
- `docs/PHASE_1_DATABASE_READINESS.md`
- `docs/PHASE_1_IMPLEMENTATION_REPORT.md`
- `docs/EXPO_MIGRATION_AUDIT.md`
- `docs/PHASE_3_GAP_TRACKER.md`

## Existing work preserved and database readiness

At the start of this phase, branch `main` was at
`1358bdd307c495b8af0d5a6daf48511a9565d0de` with a dirty worktree. The
initial status had no staged changes. Modified tracked files were
`.env.example`, `.gitignore`, `README.md`,
`backend/src/app.ts`, `backend/src/config.ts`, `backend/src/providers.ts`,
`backend/src/server.ts`, `backend/test/app.test.ts`, `package-lock.json`,
`package.json`, `src/App.css`, `src/App.tsx`, `src/lib/supabase.ts`, and
`vite.config.ts`. The untracked files/directories included existing Expo
routes/config, backend work, `docs/`, `scripts/`, `src/components/`,
authentication/data utilities, Supabase migrations, tests, and
`tsconfig.expo.json`. They were preserved; the new Phase 1 files are added
within this already-untracked project work.

The local Phase 1 migration defines owner-scoped RLS and composite
Category → Topic → Subtopic → File foreign keys. Category deletion cascades
through taxonomy descendants; Topic deletion cascades only to Subtopics;
files are restricted from deleting referenced Subtopics. Phase 2 notes
reference files restrictively. This supports single-statement taxonomy
deletes without a new migration, but only if the deployed schema matches.
Whether either migration is installed, whether real taxonomy rows exist,
whether RLS allows the current user, and whether local configuration targets
the intended project are unknown. The missing-relation error mapping is not
proof of the live cause. The full source-based audit and exact operator
actions are recorded in `docs/PHASE_1_DATABASE_READINESS.md`.

**No schema change is required by the local migration contract.** Before
live use, an authorized operator must compare the target schema/policies with
the two local migrations and provision approved real taxonomy rows if needed.
If the Phase 1 migration is absent, apply it only through a separately
reviewed and explicitly approved migration process. No dashboard action or
migration was performed here.

## Automated verification

| Check | Result |
| --- | --- |
| `npm run lint` | PASS |
| `npm run typecheck:expo` | PASS |
| `npm test` | PASS — 47 frontend unit/SDK-mock tests |
| `npm run build` | PASS — Vite TypeScript and production build |
| `npm --prefix backend run build` | PASS |
| `npm --prefix backend test` | PASS — 12 tests |
| `npm run build:expo:web` | PASS — static route export |
| `npx expo export --platform android --output-dir expo-android-build` | PASS — Android JavaScript bundle only |
| `npx expo install --check` | PASS |
| `npx --yes expo-doctor` | PASS — 21/21 checks |

## Subsequent local continuation

The later Phase 1/2/3 audit added Category, Topic, and Subtopic creation
actions to the Expo Home picker. Inserts omit client-supplied `owner_id`,
carry only the canonical parent IDs, validate the returned record, and are
covered by mocked contract tests. This does not establish hosted RLS or
live persistence; see `docs/PHASE_1_PHASE_2_PHASE_3_GAP_MATRIX.md`.
| `git diff --check` | PASS — Git emitted existing line-ending normalization warnings only |

Mocked tests cover selection filtering and invalidation, valid/invalid file
creation, stable route parameters, taxonomy name rules, Enter/Escape/double
activation helper behavior, delete-confirmation text and table targeting,
safe mocked create/update/delete failures, and preserved auth/recovery
regressions.

The repository does not have a React Native component-interaction renderer.
The unit tests do not prove that taps, focus, blur, keyboard keys, confirmation
modals, or screen layout work in a real browser/device. Expo exports prove
bundling/static route generation only.

## Manual browser checklist

1. Confirm the target Supabase project's Phase 1 tables, composite
   constraints, grants, and RLS policies using the authorized process. Verify
   real Category → Topic → Subtopic rows are provisioned for the test user.
2. Start Expo with `npm start`, press `w`, and open the actual browser origin.
   Sign in with an authorized test account. Confirm the Home page loads real
   data; no example rows should appear.
3. Select Category A, one of its Topics, and one of its Subtopics. Confirm
   only matching child options and exact files appear. Change each parent
   selection and verify invalid child selections clear.
4. Confirm `Open Notes` is disabled until the full path is valid. Open it and
   verify the route carries the selected IDs and displays the Phase 2
   placeholder, not fake notes or an editor. Open a real file and verify its
   file ID and taxonomy path are preserved and validated.
5. Create a file with empty name, missing selections, and a valid path. Verify
   validation, then confirm successful creation, return to Home, success
   indication, and refreshed real file list. If the save fails, verify the
   name/path remain and no success is claimed.
6. Double-click/double-tap a taxonomy name and test the accessible Edit
   button. Verify focus/select, Enter save, click-outside save, Escape cancel,
   empty/too-long validation, success indication, and safe rename failure.
7. Open each level's Delete action. Cancel and ensure no request/change occurs.
   Confirm each level and verify only intended taxonomy descendants are
   affected. For a taxonomy path with files, ensure the database rejects
   deletion and that files/notes remain. Do not test destructive behavior on
   production data without explicit approval.
8. Check wide and narrow layouts, keyboard focus order, labels, loading,
   empty, network/error states, and sign-out/session restoration.

## Manual Expo Go checklist

1. Confirm target schema and real owner-scoped taxonomy as above. Start
   `npm start` and open the project in Expo Go on an Android phone.
2. Sign in and verify actual taxonomy/file records load. Check the three
   dependent selectors and parent-change resets.
3. Create a file and verify return-to-Home refresh. Open Notes and a file;
   confirm placeholders and canonical route IDs. Test rename via Edit and
   device keyboard, and cancel/confirm taxonomy deletion with safe restricted
   references.
4. Verify loading/empty/error states, keyboard scrolling/accessibility,
   sign-out, and session restoration. Do not infer device behavior from the
   Android JavaScript export.

## Remaining limitations and approvals

- Live Supabase migration status, target project, RLS, taxonomy data, and
  actual create/rename/delete behavior are unverified.
- React Native UI interactions and responsive behavior have not been tested
  in an actual browser or Expo Go device.
- Full Notes collection and editor remain Phase 2; no SQL editor or AI
  converter was added.
- No migrations were applied, no hosted settings changed, and no environment
  files were opened or changed. No commit, push, or deployment was performed.
