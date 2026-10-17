# Phase 1–3 Current Gap Matrix

This matrix reflects the current local worktree. It separates source and
automated evidence from hosted or rendered behavior that was not verified.
Starting HEAD: `1358bdd307c495b8af0d5a6daf48511a9565d0de`; branch: `main`.
The worktree was already dirty, and no changes were staged.

| Requirement | Existing implementation | Evidence | Gap | Proposed fix | Verification |
| --- | --- | --- | --- | --- | --- |
| Phase 1 taxonomy Home and selection | Authenticated Home loads real Category → Topic → Subtopic rows and filters dependent selectors. A confirmed create now updates local workspace state from the inserted record rather than failing on a second read after persistence. | `app/(app)/home.tsx`, `src/components/TaxonomyPicker.tsx`, `src/lib/phase1.ts`, `tests/phase1.test.ts` | Hosted schema/RLS/data and rendered workflows remain unknown; local tests are not live verification. | Preserve owner assignment and parent validation; verify non-production RLS after authorized access. | Typecheck and tests, then authorized browser/Expo Go checks. |
| Phase 1 file create, rename, delete and navigation | File creation, inline taxonomy rename, restrictive hierarchy deletion, and route builders use stable canonical IDs. | `app/(app)/create-file.tsx`, `src/lib/phase1.ts`, `tests/phase1.test.ts` | Real persistence, permission responses, and destructive FK behavior are unverified. | Compare deployed schema with both local migrations; test approved disposable rows. | Mocked contract tests plus authorized non-production checks. |
| Phase 1 workspace error | Safe classification covers missing relation, API cache/schema mismatch, auth, permission, network, and FK errors. The local Expo runtime project reference was privately confirmed to match the linked CLI project; the Vite URL is not configured locally. | `src/lib/phase1.ts`, Phase 1 database readiness report, reviewed local SQL diagnostic | Hosted table/policy state and deployed runtime project remain unknown; prior read-only database login failed. | Run reviewed SELECT-only diagnostics in an authorized Dashboard SQL Editor for the privately confirmed target. | Record sanitized operation/status/error code only. |
| Phase 2 collection and create | Collection validates taxonomy, filters owner-visible notes by selected Subtopic files, creates a persisted note, and handles loading/empty/error/retry states. | `app/(app)/notes.tsx`, `src/lib/notes.ts`, `tests/phase2.test.ts` | Live RLS, persistence, and rendered UX are not tested. | Verify local migration contracts against authorized hosted schema and exercise only disposable records. | Automated mocked contracts and manual checklist. |
| Phase 2 editor/autosave | Full-page editor validates note/path, serializes conditional saves, reports status, supports retry/conflict, and best-effort local recovery. Notes collection workspace loads now ignore stale responses after a path change or blur. | `app/(app)/note.tsx`, `app/(app)/notes.tsx`, `src/lib/autosave.ts`, `src/lib/request-sequence.ts`, tests | Browser/device navigation, storage limits, real timestamps, and concurrent hosted edits are unverified. | Retain recovery and conflict handling; do not claim save until confirmed response. | Unit regression tests, then controlled network/browser and two-session checks. |
| Phase 2 Copy/Delete | Copy validates a real destination and preserves original; delete confirms and targets one note. Destination route refresh is implemented. | `app/(app)/notes.tsx`, `src/lib/notes.ts`, tests | UI and database behavior under RLS are not exercised; duplicate-title selection is not concurrency-unique. | Keep schema unchanged; verify on disposable data and document concurrent duplicate-title limitation. | Mock tests plus manual copy/delete/refresh checks. |
| Phase 2 menu | Copy Notes, Delete Notes, Add SQL, and Add Markdown Text entry points exist; future actions are not separate-page workflows. | `app/(app)/notes.tsx`, `app/(app)/note.tsx` | Add Markdown Text is not implemented; SQL editor rendering is untested. | Implement Markdown inline in its future phase; preserve current inline SQL panel. | Inspect menu and manual responsive interaction. |
| Phase 1/2 hosted readiness | Local migrations now place `files_id_owner_unique` in Phase 1 and Phase 2 notes FK depends on it. A CLI dry-run lists both migrations in order without applying them. | `supabase/migrations/*.sql`, `tests/phase2.test.ts`, CLI dry-run output; user-reported Dashboard catalog checks | User reports `public.categories/topics/subtopics/files` all resolve NULL and no public base tables; strongly indicates missing app schema if the intended project was selected. Remote policies/grants/API exposure and deployed app identity remain unverified. | Finish read-only catalog review; review dry-run and any out-of-band drift; require explicit approval before any migration write. | Static tests + CLI dry-run; still need authorized live schema/RLS and authenticated app workflow. |
| Phase 3 isolated SQL execution | Authenticated backend endpoints run SELECT/WITH queries in a fixed in-memory SQLite database. SQLite authorizer restricts reads to `employees` and `departments`, denies writes/other actions, and query-plan scan count, output, input, function, and SQLite limits are enforced. | `backend/src/practice-sql.ts`, `/api/notes/run-sql`, backend tests | Local implementation only; hosted/runtime Node compatibility and resource limits remain unverified. | Preserve isolation and keep Gemini evaluation separate; never run SQL against production Supabase. | Backend tests/build and controlled backend runtime checks. |
| Phase 3 inline editor and evaluation | Expo note editor opens SQL practice inline, invalidates stale results when query text changes, retries Gemini evaluation without losing the executed result, and appends a practice block to existing note content. Backend URL setting is consistent with `EXPO_PUBLIC_API_BASE_URL`. | `app/(app)/note.tsx`, `src/lib/note-ai.ts`, `backend/src/providers.ts`, frontend/backend regression tests | No rendered UI, live backend/Gemini, deployed configuration, or live note persistence has been verified. | Complete local tests/builds and retain manual/live checks as blocked. | Focused tests, lint/typecheck/build/exports; manual check after approved access. |
| Phase 3 existing SQL Lab reuse | A sibling local SQL Lab project was inspected as prior art for isolated SQLite and separate AI evaluation. | `C:\\Users\\HP\\shyam-sql-lab-topic-chat-release\\backend\\render-api\\src\\practice-service.ts` (read-only reference) | Reuse is architectural only; this repository's new route remains a distinct local module. | Avoid copying an unsafe production-database execution path; consolidate only if an explicit architecture decision supports it. | Review sandbox boundaries and service contract before expansion. |

## Hosted access and decision

Supabase CLI project listing and migration listing work, but a read-only
catalog query failed because the CLI's temporary database role could not
authenticate and requested a database password. No password was read,
requested in chat, or supplied. The local Expo runtime project reference was
privately compared to the linked CLI project and they match. The Vite runtime
Supabase URL was not configured in the inspected local runtime. Do not infer
hosted schema, migration application, deployed-runtime identity, or root cause
from these facts.

The diagnostics file is now a reviewed, SELECT-only catalog script and no
longer queries the optional migration-history relation that was absent from
the connected project. User-reported SQL Editor results say the four Phase 1
tables return NULL from `to_regclass`, and the `public` table listing is
empty; assuming the intended project was selected, this strongly indicates
the application schema is absent there. The script itself has not been
executed against Supabase by this session. The exact
remaining hosted action is for an authorized operator to privately confirm
the intended project in Dashboard and run
`docs/verify_phase1_workspace_readonly.sql` in its SQL Editor, then share only
sanitized catalog/error results (no row data or credentials).

**Current conclusion:** Phase 1 and Phase 2 are locally implemented in
substantial part but are not fully verified or hosted-ready. Phase 3 has
started locally with isolated SQL execution and inline editor integration;
this does not clear any hosted Phase 1/2 blocker. No migration, hosted
configuration, commit, push, or deployment was performed.
