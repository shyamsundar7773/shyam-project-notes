# Phase 2 Gap Report

Phase 2 implementation is local and uncommitted. This report does not imply
that migrations were applied or that hosted services or browser workflows were
verified.

This is the earlier Phase 2 gap snapshot. Current implementation details,
rerun checks, and recovery findings are maintained in
`docs/PHASE_2_IMPLEMENTATION_REPORT.md`.

## A. Implemented

- `src/components/NotesWorkspace.tsx` mounts at `/notes`, parses the three
  stable taxonomy IDs, validates them against rows returned for the signed-in
  Supabase client, and only loads notes for an authorized matching file.
  Multiple matching files require an explicit selection.
- The workspace provides note search, responsive pastel cards, text/SQL/
  Markdown note editors, the ordered three-dot menu, confirmed note deletion,
  and copy creation that preserves content while omitting system ownership
  fields.
- `src/lib/notes.ts` implements file-scoped Supabase note reads and mutations,
  optimistic update checks, typed note fields, and per-user/per-note local
  recovery drafts. Cloud persistence is through the authenticated client and
  depends on the prepared RLS/schema contract.
- `src/lib/autosave.ts` serializes and debounces edits. `NotesWorkspace`
  reports unsaved/saving/saved/failed states, keeps drafts available for
  retry/recovery, warns before leaving with unsaved work, and detects stale
  cloud updates instead of overwriting them. Conflicts offer an explicit
  reload-and-discard action; automatic merge is not implemented.
- SQL evaluation and Markdown conversion are inline working notes. Generated
  output is saved separately from source; failed AI requests leave the source
  and previous successful output unchanged.
- `src/components/MarkdownPreview.tsx` renders a limited Markdown subset as
  React elements. Raw HTML is text and is not injected or executed.
- Backend endpoints added:
  - `POST /api/notes/evaluate-sql`
  - `POST /api/notes/convert-markdown`
- `src/lib/phase1.ts` adds query parsing for the required taxonomy IDs while
  retaining Phase 1's canonical Category → Topic → Subtopic and file identities.
- `tests/phase2.test.ts` covers malformed route IDs, the restrictive migration
  relationship, autosave ordering/retry, local draft validation, safe Markdown
  rendering, and authenticated AI request formatting.

## B. Data model and migration

`supabase/migrations/20261016140000_phase2_notes.sql` is **PREPARED — NOT
APPLIED**. It creates `public.notes` with a stable UUID, owner, required
`file_id`, `note_type`, title, source content, SQL output/evaluation and
evaluated-source snapshot, Markdown output and converted-source snapshot,
personal notes, colour/pin fields, and timestamps. It adds the composite
`files(id, owner_id)` uniqueness required by the notes relationship.

The `(file_id, owner_id)` foreign key references `(id, owner_id)` on
`public.files` with **`ON DELETE RESTRICT`**. Notes cannot be attached to
another user's file, and deleting a file with notes must fail instead of
cascading. Notes have owner-based authenticated RLS for select/insert/update/
delete; `owner_id` defaults to `auth.uid()`. No service-role key or RLS bypass
is used. Taxonomy IDs are not duplicated on notes.

The proposal depends on the unapplied
`supabase/migrations/20261016133000_phase1_taxonomy_files.sql`. Review both
migrations and the actual hosted schema together before any authorized
application. No remote schema was queried and no migration was applied.

## C. AI integration

Both new endpoints require a bearer access token verified through Supabase
Auth, validate non-empty source and size limits, and return structured output.
The backend sends SQL/Markdown to the existing `@google/genai` integration
using only `GEMINI_API_KEY` and `GEMINI_PRIMARY_MODEL`; there is no alternate
model retry. SQL is explicitly treated as inert text and is never executed.
Markdown output is rendered without enabling raw HTML. Provider failures,
timeouts, malformed output, and quota/transient errors return generic safe
responses; source remains on the client.

Backend tests use mocked providers. No real Gemini or Supabase connection was
attempted. There are no database-write operations in either AI endpoint.
Upstream 429/transient errors are handled as temporary service errors; local
per-user rate limiting has not been implemented.

## D. Automated checks

| Check | Result | Coverage / note |
| --- | --- | --- |
| `npm run lint` | PASS | ESLint across the workspace |
| `npm run build` | PASS | TypeScript project build and Vite production bundle |
| `npm test` | PASS | 14 frontend/data/queue/render tests |
| `backend/ npm run build` | PASS | Backend TypeScript build |
| `backend/ npm test` | PASS | 11 mocked backend tests, including SQL/Markdown auth, validation, success and safe upstream errors |
| `git diff --check` | PASS | No whitespace errors; Git reported only line-ending normalization warnings for existing edited files |

These checks do not verify hosted RLS, live auth, Gemini connectivity, or
browser interaction.

## E. Browser and manual verification

Not tested: real sign-in/sign-out or session expiry; applying either
migration; cloud note reads/writes, RLS isolation, restrictive file deletion,
or conflict behavior against Supabase; live Gemini SQL/Markdown behavior;
SQL/Markdown editing and AI workflows in a browser; autosave across refresh,
offline recovery, or storage quota failures; keyboard/dialog focus behavior;
responsive interactions on actual devices; Netlify or Render deployment.
No Android/ADB tests were performed.

## F. Open Phase 1 and Phase 2 gaps

The Phase 1 report remains unchanged at `docs/PHASE_1_GAP_REPORT.md`. Its
recorded statuses are carried forward below; a locally prepared Phase 2
migration or untested UI does not prove the corresponding hosted behavior.

| Gap ID | Priority | User impact | Relevant files/schema/API | Recommended fix | Dependencies | Tests needed | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1-DB-001 | Blocker | Workspace tables and RLS may not exist in the hosted project. | Phase 1 migration; Phase 2 migration | Compare both proposals against the hosted schema and obtain explicit operator approval before applying. | Authorized schema review | Disposable-project schema, RLS, FK and delete tests | BLOCKED |
| P1-DATA-001 | High | Empty real taxonomy prevents users opening a valid file path. | Phase 1 taxonomy schema and Home | Provision approved, owner-assigned taxonomy data; do not invent seed records. | Real taxonomy source | Verify ownership and all parent-child links | BLOCKED |
| P1-AUTH-001 | Blocker | Sign-in, confirmation, refresh and expiry behavior are not verified live. | `src/App.tsx`, `src/lib/supabase.ts` | Exercise the configured hosted email/password flow and URL settings. | Authorized test account and frontend config | Manual sign-up/confirmation/sign-in/refresh/sign-out/expiry | BLOCKED |
| P1-CRUD-001 | Blocker | File/taxonomy persistence relies on unapplied schema and RLS. | `src/lib/phase1.ts`; Phase 1 migration | Verify authenticated CRUD and cross-user isolation after approved migration. | P1-DB-001, P1-AUTH-001 | Disposable-project CRUD, forged owner and cross-user tests | BLOCKED |
| P1-DEL-001 | High | Taxonomy deletion constraints have not been tested against a database. | Phase 1 migration; `src/lib/phase1.ts` | Verify only taxonomy descendants cascade and file/notes references restrict deletion. | P1-DB-001 | Delete category/topic/subtopic with files and notes | BLOCKED |
| P1-FILE-001 | Medium | File delete protection for notes exists only in the Phase 2 proposal. | `src/lib/phase1.ts`; Phase 2 migration | Verify empty-file delete succeeds and a file with notes is rejected. | P1-DB-001; Phase 2 migration | Hosted/disposable restrictive-FK test | OPEN |
| P1-NAV-001 | Medium | New route/path behavior has not been verified in a browser. | `src/App.tsx`, `src/components/NotesWorkspace.tsx` | Manually test direct route, refresh, invalid IDs, back navigation and file selection. | P1-AUTH-001, real taxonomy | Browser route and ownership checks | OPEN |
| P1-TEST-001 | High | Rendered UI, keyboard, dialog and responsive behavior lack browser tests. | `tests/`, `src/App.tsx` | Add an approved DOM/browser test setup or document manual checks. | Test environment | Auth, forms, dialogs, keyboard, focus and mobile overflow | OPEN |
| P2-DB-001 | Blocker | Notes cannot persist until both schema proposals are reviewed and applied; current hosted schema is unknown. | `supabase/migrations/20261016133000_phase1_taxonomy_files.sql`, `supabase/migrations/20261016140000_phase2_notes.sql` | Review migration compatibility and apply only through an authorized process. | P1-DB-001 | Verify note CRUD, owner RLS, composite FK and restrictive file deletion | BLOCKED |
| P2-AUTH-001 | Blocker | No proof that the authenticated session can access the prepared notes schema. | `src/lib/notes.ts`, Phase 2 RLS | Verify current-user note CRUD and cross-user denial after migrations. | P1-AUTH-001, P2-DB-001 | Disposable Supabase two-user RLS tests | BLOCKED |
| P2-AI-001 | High | Real model availability, quota, latency and production output remain unknown. | `backend/src/providers.ts`, `backend/src/app.ts` | Perform authorized controlled provider tests and inspect safe operational behavior. | Valid server environment and user approval | Live SQL/Markdown requests, timeout and quota handling | BLOCKED |
| P2-BROWSER-001 | High | Notes grid, editors, menus, dialogs, route changes and responsive layout are not browser-tested. | `src/components/NotesWorkspace.tsx`, `src/App.css` | Add browser/DOM interaction coverage or perform documented manual testing. | Browser test environment | Copy/delete, keyboard menus, SQL/Markdown flows, responsive states | OPEN |
| P2-SAVE-001 | High | Autosave/retry is unit-tested, but real network timing and server timestamps are not verified. | `src/lib/autosave.ts`, `src/lib/notes.ts` | Test delayed, offline, expired-session and out-of-order responses against a disposable backend/schema. | P2-DB-001, P2-AUTH-001 | Save ordering, retry, conflict and no-loss integration tests | OPEN |
| P2-RECOVERY-001 | High | Local recovery uses best-effort browser storage; quota/privacy settings and full refresh recovery are unverified. | `src/lib/notes.ts`, `src/components/NotesWorkspace.tsx` | Verify local draft recovery manually; consider a reviewed conflict-merge flow if needed. | Browser testing | Refresh/offline/quota/clear-storage recovery scenarios | OPEN |
| P2-CONFLICT-001 | Medium | A concurrent cloud edit requires reload-and-discard; there is no merge or explicit save-as-copy resolution. | `src/lib/notes.ts`, `src/components/NotesWorkspace.tsx` | Review whether users need a draft export/merge path before live use. | P2-DB-001 | Concurrent edit and recovery tests | OPEN |
| P2-RATE-001 | Medium | Upstream quota errors are generic, but authenticated users are not locally throttled. | `backend/src/app.ts`, `backend/src/providers.ts` | Review provider quotas and operational abuse controls; add a scoped limiter only if deployment requirements justify it. | Render deployment policy | Rate-limit and abuse tests | OPEN |
| P2-OPTIONAL-001 | Low | Colour and pin fields are supported by the schema but have no editor controls. | `src/components/NotesWorkspace.tsx`, Phase 2 migration | Add controls only if desired; these are optional and not needed for core notes. | Core review | UI/persistence tests if implemented | OPEN |
| P2-TEST-001 | High | Copy/delete/persistence UI behavior and full taxonomy access denial are not covered by rendered integration tests. | `tests/phase2.test.ts`, `src/components/NotesWorkspace.tsx` | Add browser tests for operations and authorization-dependent states. | Browser and disposable backend setup | Copy distinct ID/metadata, delete confirmation, file scoping | OPEN |

## G. Security and data-loss risks

- Authorization currently depends on authenticated Supabase client behavior
  and the proposed RLS/FK policies. Since migrations are unapplied, this is a
  code/schema contract, not verified enforcement.
- The restrictive composite foreign key is the only server-side guarantee
  that a file cannot be deleted while notes reference it; confirm it exists
  before live use.
- AI source is sent to the configured Gemini provider after explicit user
  action. Do not submit sensitive content unless the provider/data handling
  is acceptable. SQL is not run; generated output remains illustrative.
- Markdown is rendered with a deliberately limited React-element renderer,
  not raw HTML. Keep this property if the renderer is extended.
- AI failures preserve source and the prior successful result. A local draft
  is best effort and can be unavailable if browser storage is blocked or full.
  The app prompts on unsaved navigation and page unload, but browser behavior
  was not manually tested.
- Optimistic `updated_at` checks prevent stale writes. Conflict recovery
  currently requires an explicit reload that discards the local draft; copy
  the draft elsewhere before choosing it if its contents must be retained.
- AI endpoints do not write to Supabase. Notes CRUD is direct through the
  signed-in client; no service-role or secret key is used in frontend code.

## H. Phase 3 handoff

Before further feature work or production claims, review the migrations and
compatibility with the actual schema; obtain authorization before applying
them; verify hosted Auth, RLS, CRUD and restrictive delete behavior; test AI
requests with controlled credentials; exercise copy/delete, SQL/Markdown,
autosave, recovery, conflict and responsive/keyboard workflows in a browser;
review provider privacy, quota and operational limits; and decide whether a
conflict merge/export and optional pin/colour controls are needed. Keep all
unverified items above visible until evidence supports closing them.

## I. Git and deployment status

- Branch: `main`.
- Initial and final HEAD: `1358bdd307c495b8af0d5a6daf48511a9565d0de`.
- Working tree: dirty with uncommitted Phase 1 work and Phase 2 implementation
  and report. No commit, push, merge, deployment, hosted build, migration, or
  remote Supabase access occurred.
- Render settings based on the existing backend package/server: root
  directory `backend`; build command `npm ci && npm run build`; start command
  `npm start`; health-check path `/health`. Deployment was not performed.
- A local remote named `origin` is configured. Its URL and remote branch
  status were not fetched or verified during this phase.
