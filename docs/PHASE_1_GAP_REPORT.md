# Phase 1 Gap Report

## Prepared migration

`supabase/migrations/20261016133000_phase1_taxonomy_files.sql` is **PREPARED —
NOT APPLIED**. The repository had no tracked Supabase migration/schema files or
taxonomy/file data contracts to reuse. Remote Supabase was not queried.

The migration defines only `categories`, `topics`, `subtopics`, and `files`.
Each row has a stable UUID and `owner_id` defaulted from `auth.uid()`;
taxonomy records have `created_at`, and files have `created_at` and
`updated_at`. Composite foreign keys bind each child and file to the same
owner and exact Category → Topic → Subtopic path. File names are required,
trimmed for validation, and limited to 120 characters; duplicate names are
not made globally unique.

RLS is enabled on every table. Authenticated owners can select, insert,
update, and delete only rows with their own `owner_id`; `anon` and `PUBLIC`
table privileges are revoked. The client never submits an owner ID. File
inserts rely on the database default and RLS check. No service-role key or
backend bypass is used.

Parent taxonomy foreign keys cascade only to descendant taxonomy records.
Files reference the full subtopic path with `ON DELETE RESTRICT`, so removing
a Category, Topic, or Subtopic that has files fails atomically instead of
deleting files. Any later notes table must reference `files` restrictively as
well. There is no notes table in this migration.

Before any future application, an authorized operator must compare these
table names and relationships with the hosted schema; it was intentionally
not inspected here. The migration uses ordinary `CREATE TABLE` statements
and will fail rather than silently merge with same-named existing tables.
No migration was applied and no production data was changed.

## Authentication findings and implementation

The existing frontend used the installed Supabase Auth client but had no
sign-in/session UI. `src/lib/supabase.ts` remains the client/configuration
entry point, using the existing `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY` names. `src/App.tsx` now provides email and
password sign-up, sign-in, sign-out, and session restoration through
`getSession()` and `onAuthStateChange()`. Supabase handles password storage
and session persistence; this project adds no custom auth system.

Sign-up handles the no-session confirmation case with instructions to check
email. Hosted email-confirmation settings and actual sign-in/session behavior
were not checked. Verify the Supabase Auth URL/email settings and confirmation
template through an authorized dashboard process before live use. The app
does not claim a successful live login.

File and taxonomy CRUD uses the authenticated Supabase client in
`src/lib/phase1.ts`, with authorization enforced by the prepared database
RLS/FK contract. The Express service has no file/taxonomy endpoints; its
existing token verification for note conversion is unchanged. No CRUD path
accepts an owner ID from the browser. Until the migration is reviewed and
applied, workspace queries and mutations cannot be considered operational.

## Implemented Phase 1 surfaces

- `src/App.tsx`: auth gate; responsive Home; file list and active selection;
  dependent Category/Topic/Subtopic selectors; confirmation dialogs for
  taxonomy and file deletion; file rename/delete; dedicated `/create-file`
  form; and a Phase 2-only `/notes` handoff carrying stable taxonomy IDs.
- `src/lib/phase1.ts`: typed workspace data access, name validation,
  hierarchy-path validation, safe error mapping, file create/rename/delete,
  and taxonomy deletion. The database composite keys remain the final
  hierarchy and ownership enforcement.
- `src/App.css`: Phase 1 layout, responsive states, visible focus, dialog,
  reduced-motion, and interaction styles.
- `tests/phase1.test.ts`: name/path validation, safe auth-error mapping,
  mocked Supabase REST file insert/rename, owner ID omission, and restrictive
  delete error handling.
- `README.md`: Phase 1 auth and unapplied migration setup notes.

The app does not create or seed taxonomy records. A real data provisioning
process is needed before users can select a path; no sample/fake taxonomy was
added.

## Gap tracking

| Gap ID | Description | Priority | User impact | Relevant files/API/schema | Recommended fix | Dependencies | Test needed | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P1-DB-001 | The new schema exists only as a reviewable migration and is not deployed. Existing hosted tables, if any, were not checked. | Blocker | Queries for the new tables will fail until an authorized operator verifies no conflicts and applies the reviewed migration. | `supabase/migrations/20261016133000_phase1_taxonomy_files.sql` | Compare table names/FKs with the hosted schema in the approved dashboard workflow, review RLS and deletion behavior, then apply only with explicit authorization. | Dashboard schema review and explicit migration approval | SQL/FK/RLS tests against a disposable Supabase project; cross-owner access and restrict-delete tests | BLOCKED |
| P1-DATA-001 | No real Category/Topic/Subtopic records or taxonomy creation UI are provided. | High | Empty selectors prevent file creation and opening a notes path. | Migration has no seed data; `src/App.tsx` empty states | Define an approved process to provision the actual user-owned taxonomy records. Do not seed invented data. | Real taxonomy source and owner assignment | Verify returned records and all parent-child relationships | BLOCKED |
| P1-AUTH-001 | Auth UI and session code are implemented but not exercised against the hosted Supabase Auth configuration. Email-confirmation behavior is unknown. | Blocker for live use | Sign-up may require email confirmation; live access and session expiry behavior remain unverified. | `src/App.tsx`, `src/lib/supabase.ts`; Supabase Auth dashboard | Verify email/password sign-in, confirmation email, redirect URLs, sign-out, refresh restoration, and expired-session behavior in the authorized project. | Valid frontend environment values; dashboard access and test account | Manual sign-up/sign-in/confirmation/refresh/sign-out flow; automated auth-client tests with mocked Auth API | BLOCKED |
| P1-CRUD-001 | Workspace persistence and RLS rely on the unapplied migration. No dedicated backend CRUD API is used. | Blocker | File/taxonomy reads and writes cannot work until the schema is present and policies match the authenticated client. | `src/lib/phase1.ts`; migration policies | After approved migration, verify requests use only the signed-in Supabase session and test ownership isolation. Keep direct browser access constrained by RLS. | P1-DB-001, P1-AUTH-001 | Disposable-project tests for read/create/update/delete, forged owner IDs, and cross-user access | BLOCKED |
| P1-DEL-001 | Taxonomy deletes are atomic single-row database deletes with descendant cascade and restrictive file references, but the constraints are not live-tested. | High | The UI can explain/reject blocked deletes only after the database enforces the prepared FK contract. | `src/App.tsx`, `src/lib/phase1.ts`, migration composite FKs | Verify category/topic/subtopic delete behavior against real test rows after review; never add a cascade from taxonomy to files or notes. | P1-DB-001 | Verify category/topic/subtopic deletes preserve files, parent records, and siblings; verify FK rejection and owner isolation | BLOCKED |
| P1-FILE-001 | File deletion is implemented, but there is no notes table yet to protect future note associations. | Medium | Current files contain no modeled notes; future notes must not be lost if a file is removed. | `src/App.tsx`, `src/lib/phase1.ts`; future Phase 2 notes schema | In the later notes schema, use a restrictive FK from notes to files and test that non-empty files cannot be deleted. Do not change Phase 1 to delete notes. | Future reviewed notes schema | Delete empty file succeeds; delete file with linked notes is rejected | OPEN |
| P1-NAV-001 | `/notes` is only a Phase 2 handoff placeholder; the actual notes workspace is intentionally absent. | Medium | Users can pass selected IDs but cannot view or edit notes yet. | `src/App.tsx` route `/notes` | Phase 2 must reuse the category/topic/subtopic IDs in the URL and verify them against authenticated records before workspace access. | Phase 2 scope | Direct route, refresh, invalid ID, and ownership tests | OPEN |
| P1-TEST-001 | Current automated frontend coverage is unit/data-layer based; rendered UI interaction tests and live authorization tests are not present. | High | Keyboard/dialog/form/navigation behaviors have not been exercised in a browser or DOM test runner. | `tests/phase1.test.ts`; `backend/test/app.test.ts` | Add UI interaction tests when an approved browser/DOM testing stack is available, or perform documented manual keyboard/responsive checks. | Browser/DOM test environment | Home navigation, selector resets, save failure/success/double-submit, dialog Escape/focus, mobile overflow, auth lifecycle | OPEN |

## Decisions and security notes

- Authentication mode is the user-selected Supabase email/password flow.
- Duplicate file names are allowed; no global uniqueness constraint is added.
- Category deletion cascades only to its taxonomy descendants; restrictive
  file FKs prevent accidental file deletion. Topic deletion preserves its
  Category and sibling Topics. Subtopic deletion preserves parent records and
  siblings.
- The browser client never supplies or trusts `owner_id`. RLS, defaults,
  same-owner composite FKs, and the authenticated Supabase session enforce
  ownership. No service-role key is used.
- No notes, SQL editor, Markdown converter, or AI note features were added.
- No remote Supabase query, migration application, commit, push, or deployment
  occurred. Environment values were not inspected or logged.
