# Phase 2 Implementation and Recovery Report

**Date:** 2026-10-17
**Branch:** `main`
**Initial HEAD:** `1358bdd307c495b8af0d5a6daf48511a9565d0de`
**Final HEAD:** `1358bdd307c495b8af0d5a6daf48511a9565d0de`

## Recovery assessment

Phase 2 was already substantially implemented in the dirty repository; it was
not a blank or untouched phase. The repository alone cannot establish whether
the quota interruption occurred before coding, during implementation, during
testing, or after some work had completed. No `PHASE_2_IMPLEMENTATION_REPORT.md`
existed at recovery start. The Phase 2 gap report described broad existing
work, while the Phase 1 and Phase 3 reports still described Expo notes routes
as placeholders. The current source is the basis for this report; historical
checkpoint documentation has been clarified rather than treated as current
implementation evidence.

At start, no files were staged. The worktree already contained modifications
to `.env.example`, `.gitignore`, `README.md`, backend source/tests,
`package.json`, `package-lock.json`, `src/App.css`, `src/App.tsx`,
`src/lib/supabase.ts`, and `vite.config.ts`, plus untracked Expo routes,
components, data/auth utilities, migrations, tests, scripts, and reports.
Those changes were preserved. This recovery did not stage or commit files.
Final status and HEAD remain unchanged apart from the current uncommitted
worktree; this report and the recovery follow-up documents are new local
documentation.

At the end of recovery, Git still reported the same 14 modified tracked paths
and the same top-level untracked paths listed above (the implementation and
reports were created inside the already-untracked `app/`, `tests/`, and
`docs/` directories). There are no staged changes. Final HEAD is unchanged.

## Requirement status

Statuses below describe local implementation unless noted. COMPLETE does not
mean hosted Supabase or rendered UI behavior was verified.

| Requirement | Status | Evidence and qualification |
| --- | --- | --- |
| Open Notes from Home with the selected Category → Topic → Subtopic | COMPLETE | `app/(app)/home.tsx` routes canonical IDs to the Expo collection; Vite and Expo preserve the taxonomy hierarchy. |
| Show the selected taxonomy context | COMPLETE | Collection and editor display the resolved hierarchy from authenticated workspace rows. |
| Load only authenticated owner's notes belonging to the selected Subtopic | COMPLETE | Expo resolves files in the exact Subtopic and filters note reads by owner and file IDs. RLS remains the required server-side authority; live RLS is NOT TESTED. |
| Pastel note cards, title, safe short preview and appropriate save state | COMPLETE | Expo uses soft-coloured cards and plain text previews; loaded rows are persisted and labelled Saved. Vite uses React text rendering for previews. Rendered appearance is NOT TESTED in a browser/device. |
| Open the exact selected note | COMPLETE | Note ID is routed to `/note`; the editor checks owner, selected path, and associated file before displaying it. |
| `+ Add Notes` persists a note and opens its editor | COMPLETE | `createNote` inserts through the authenticated Supabase client, verifies the returned owner/file, then opens that note. A focused mocked-REST test covers the insert contract. Live persistence is NOT TESTED. |
| Collection loading, empty, error, permission-denied and retry states | COMPLETE | Loading, empty, inaccessible-path/permission-safe errors, and retry actions are implemented. Actual hosted permission-denial behavior is NOT TESTED. |
| Editable title and note content; correct persisted note and authorization | COMPLETE | Expo full-page editor uses owner-filtered note lookup and validates that the note's file belongs to the selected path. |
| Reliable autosave with Saving, Saved, Save failed and retry | COMPLETE | Serialized `AutosaveQueue`, visible status, retry, and local recovery drafts are implemented and unit-tested. Real Supabase latency/failure behavior is NOT TESTED. |
| Do not claim save before persistence; prevent stale/overlapping overwrite | COMPLETE | Saved state follows successful requests; saves serialize and condition on `updated_at`, with an explicit conflict state when the row no longer matches. |
| Preserve unsaved text and refresh collection title/preview | COMPLETE | Local recovery storage and guarded leave actions preserve drafts when available; returning to the Expo collection reloads cloud notes. Browser/device navigation behavior and storage failure cases are NOT TESTED. |
| Responsive web and Expo Go layouts | NOT TESTED | Expo web/Android exports pass, but neither export verifies actual interaction, responsive layout, keyboard, or device behavior. |
| Four three-dot menu actions | COMPLETE | Expo offers Copy Notes, Delete Notes, Add SQL, and Add Markdown Text. SQL/Markdown are labelled as later-phase actions in Expo. The existing Vite typed-note/AI UI predates this recovery and was not expanded or removed. |
| Copy to valid destination, preserve original, title convention, ownership and failures | COMPLETE | Copy selects a real destination file in the authenticated workspace, preserves note fields without copying system IDs/owner, chooses `(Copy)`/numbered titles, prevents repeated local submission, and reports failures. Different concurrent clients can still race on the same title because the existing schema has no uniqueness constraint; this is a known limitation, not a claim of database-enforced uniqueness. |
| Refresh destination collection after successful copy | COMPLETE | After persistence succeeds, Expo replaces the route with the destination Subtopic collection, which reloads real notes. Vite updates its current collection after a successful same-file copy. |
| Confirm and delete only selected note; preserve collection on failure | COMPLETE | Both UIs confirm first; mutation predicates select one note ID and owner, and success removes only that card. Failures keep it visible and display a safe error. The database row stores its note content; unrelated taxonomy/files/notes are not targeted. Live delete/RLS behavior is NOT TESTED. |
| Hosted schema, owner RLS, real cloud CRUD, browser and Expo Go interactions | NOT TESTED | No live Supabase access or rendered browser/physical-device test was performed. |

**Overall:** Local automated checks pass and the confirmed destination-route
refresh defect was fixed. The implementation is **not ready for an
unqualified Phase 2 completion claim** because hosted schema/RLS and required
manual browser, mobile-browser, and Expo Go workflows remain unverified. See
`docs/PHASE_2_VERIFICATION_REPORT.md` for PASS/BLOCKED/NOT TESTED evidence
and `docs/PHASE_2_MANUAL_TEST_CHECKLIST.md` for the authorized test steps. No
hosted or release action was taken.

## Implementation and persistence details

- `app/(app)/notes.tsx` loads actual owner-visible taxonomy/files, scopes
  notes to files in the selected Subtopic, creates a persisted note, shows
  cards and status states, and provides copy/delete dialogs. Successful copy
  now opens the destination collection so its persisted contents refresh.
- `app/(app)/note.tsx` loads the exact note and associated taxonomy path,
  edits title/content, and exposes save/conflict/recovery states.
- `src/lib/notes.ts` contains authenticated note CRUD, owner/path checks,
  safe error mapping, duplicate-copy title selection, and per-user recovery
  draft serialization. Ownership fields are omitted on inserts and are
  verified in returned rows.
- `src/lib/autosave.ts` serializes saves and retries; conditional updates use
  the current `updated_at`. A stale update is surfaced as a conflict rather
  than overwriting another version. There is no automatic merge.
- `src/components/NotesWorkspace.tsx` retains the pre-existing Vite notes
  workspace and updates note cards as saves complete. It was not replaced by
  the Expo implementation.
- `tests/phase2.test.ts` gained a focused test that verifies a new text note
  is persisted against the selected file without client-supplied ownership.

## Database and security review

The local Phase 1 migration defines Category → Topic → Subtopic → File with
same-owner composite foreign keys and RLS. The local Phase 2 migration adds
`public.notes`, the `(id, owner_id)` file uniqueness needed for its composite
reference, owner-based authenticated CRUD policies, owner/file indexes, and
`(file_id, owner_id) REFERENCES files(id, owner_id) ON DELETE RESTRICT`.
Deleting a file referenced by notes is therefore meant to fail; notes do not
copy taxonomy IDs, and no taxonomy or unrelated note delete is part of the
note-delete operation.

The application uses the authenticated Supabase client, not service-role
credentials. Client-side owner predicates are defense-in-depth; deployed RLS
and the composite foreign key must enforce actual authorization. Both
migrations are **PREPARED LOCALLY — NOT APPLIED**. The hosted schema, policies,
migration history, provisioned real data, and live authorization are unknown.
No migration, dashboard, database, or hosted service was changed or queried.
No complete private note content, auth token, or environment secret was
logged or included here.

## Files changed during this recovery

- `app/(app)/notes.tsx` — refresh the destination collection after a
  confirmed cross-Subtopic copy, respond to query-parameter changes while
  focused, and clarify numbered copy-title behavior.
- `tests/phase2.test.ts` — cover persisted note creation without
  client-supplied ownership and destination route taxonomy IDs.
- `docs/PHASE_2_RECOVERY_ASSESSMENT.md` — record the starting state and
  recovery conclusion.
- `docs/PHASE_2_IMPLEMENTATION_REPORT.md` — current checklist, implementation,
  security, test and manual verification record.
- `docs/PHASE_2_VERIFICATION_REPORT.md` — source review, fixed defect,
  migration readiness checklist, automated results and final repository state.
- `docs/PHASE_2_MANUAL_TEST_CHECKLIST.md` — authorized browser/mobile/Expo Go
  test procedures.
- `docs/PHASE_3_GAP_TRACKER.md` — replace stale Expo placeholder descriptions
  with current local implementation status.
- `docs/EXPO_MIGRATION_AUDIT.md`,
  `docs/PHASE_1_DATABASE_READINESS.md`, and
  `docs/PHASE_1_IMPLEMENTATION_REPORT.md` — identify historical Phase 1
  placeholder descriptions and add current Phase 2 follow-ups.
- `docs/PHASE_2_GAP_REPORT.md` — identify it as the earlier snapshot.

No migration was created or modified during recovery. The existing Phase 1
and Phase 2 SQL files remain prepared and unapplied.

## Automated checks

| Command | Result |
| --- | --- |
| `npm run lint` | PASS |
| `npm run typecheck:expo` | PASS |
| `npm test` | PASS — 57 tests, 0 failures |
| `npm run build` | PASS — TypeScript and Vite production build |
| `npm --prefix backend run build` | PASS |
| `npm --prefix backend test` | PASS — 12 tests, 0 failures |
| `npm run build:expo:web` | PASS — 20 static routes exported |
| `npx expo export --platform android --output-dir expo-android-build` | PASS — Android JavaScript bundle only |
| `npx expo install --check` | PASS — dependencies aligned |
| `npx --yes expo-doctor` | PASS — 21/21 checks |
| `git diff --check` | PASS — existing line-ending normalization warnings only; no whitespace errors in recovery-touched files |

The tests use mocked Supabase REST/auth/provider responses and unit-level
autosave checks. Exports establish bundling only. None of these checks proves
live Supabase RLS, real note persistence, browser interaction, or Expo Go
behavior.

## Manual verification still required

**Browser:** With an authorized test account and approved real workspace
records, verify Home → selected Subtopic → Notes; file selection and
owner-isolated collection; create/open/edit/autosave; Saving/Saved/Save
failed/retry; reload/recovery/conflict; title/preview refresh; copy to the
same and a different Subtopic; duplicate-title and repeated-click behavior;
delete cancel/confirm/failure; loading/empty/permission-denied/retry states;
keyboard/focus/dialog behavior; and narrow/wide responsive layouts. Test only
on approved non-production data for destructive actions.

**Expo Go:** Repeat the authenticated Home/Notes/editor flows on a physical
device, including keyboard/back navigation, offline or failed saves,
recovery, cross-Subtopic copy, confirmed deletion, and narrow-screen layout.
The Android export is not a device test.

The detailed step-by-step browser, mobile browser, Expo Go, and account
boundary checklist is `docs/PHASE_2_MANUAL_TEST_CHECKLIST.md`. No items in
that checklist have been marked as manually passed during this run.

**External blockers:** An authorized operator must compare both local
migrations with the actual target schema and RLS, provision approved real
taxonomy if needed, and separately authorize any migration or live-service
test. No migration, Supabase dashboard/database change, browser session,
physical-device session, Render/Netlify deployment, commit, or push occurred.

## Safest next step

Complete the documented browser and Expo Go interaction checklists with an
authorized test account and disposable/non-production data, and obtain an
authorized schema/RLS comparison before any live persistence claim. Keep all
migrations unapplied until explicitly approved. Do not start additional
Phase 3 SQL execution or Phase 4 AI Markdown conversion work as part of this
recovery.

## Later continuation: Phase 3 local start

The prior statement above that Phase 3 SQL execution had not started is a
checkpoint from the earlier recovery and is superseded by this dated update.
Phase 1/2 remain unverified against the hosted schema and rendered browser or
device behavior. The SQL practice flow was started locally because its
execution can remain isolated from Supabase:

- `backend/src/practice-sql.ts` runs read-only SQL against fixed in-memory
  practice tables. SQLite authorization denies writes and unsupported
  functions; statement, query-size, row-count, and SQLite limits are applied.
  Recursive CTEs are denied to avoid unbounded synchronous execution.
- Authenticated backend routes return the question/schema and execute the
  sandbox query. Gemini evaluation is a separate provider call and receives
  the result; it is not an execution engine.
- The Expo editor opens Add SQL inline, displays result/evaluation, and
  appends the practice block to the current note's existing text and existing
  SQL fields, using the existing autosave.
- The initial implementation used a different Expo backend URL variable; the
  current source/template use `EXPO_PUBLIC_API_BASE_URL`. Backend engine
  metadata now requires Node `>=24.10.0` for SQLite authorizer support.

## Follow-up correction

The earlier environment mismatch was corrected locally. The runtime Expo
project reference was privately compared with the Supabase CLI-linked
project reference and matches; this does not establish a deployed runtime
target or hosted schema. The Vite Supabase URL was not configured in the
inspected local environment. See the current verification report for exact
checks and remaining hosted/manual blockers.

This is not a claim of Phase 3 production readiness. Backend tests exercise
read-only execution, unsafe-operation rejection, row limiting, authentication,
and endpoint response. Frontend helper tests cover the Expo backend URL,
authenticated practice request shapes, and preservation of existing note
content. Final test/build/export outcomes are recorded in the follow-up
verification report. No hosted service, Gemini provider, browser, physical
device, or deployment was tested.
