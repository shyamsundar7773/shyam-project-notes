# Phase 1 Database Readiness

**Audit date:** 2026-10-17
**Scope:** Repository evidence for Expo Home, taxonomy navigation, and file
creation. No live Supabase project was queried, and no migration was applied.

## Repository state before this phase's edits

- Branch: `main`
- HEAD: `1358bdd307c495b8af0d5a6daf48511a9565d0de`
- No staged changes were present in the initial worktree status.
- The worktree was already dirty. Modified tracked files:
  `.env.example`, `.gitignore`, `README.md`, `backend/src/app.ts`,
  `backend/src/config.ts`, `backend/src/providers.ts`,
  `backend/src/server.ts`, `backend/test/app.test.ts`, `package-lock.json`,
  `package.json`, `src/App.css`, `src/App.tsx`, `src/lib/supabase.ts`, and
  `vite.config.ts`.
- Pre-existing untracked files/directories:
  `app.json`, `app/`, `babel.config.cjs`, `backend/.env.example`,
  `backend/src/ai-notes.ts`, `docs/`, `scripts/`, `src/components/`,
  `src/lib/auth.ts`, `src/lib/autosave.ts`, `src/lib/expo-auth.ts`,
  `src/lib/expo-password-recovery.ts`, `src/lib/expo-runtime.ts`,
  `src/lib/expo-supabase.ts`, `src/lib/note-ai.ts`, `src/lib/notes.ts`,
  `src/lib/phase1.ts`, `src/lib/supabase-config.ts`, `supabase/`,
  `tests/`, and `tsconfig.expo.json`.
- Private environment files were not opened or changed. No variable values or
  tokens were printed.

## Existing Expo and data-access behavior

- Expo Router uses `app/`; `app/(app)/_layout.tsx` guards authenticated routes
  using the existing `ExpoAuthProvider` session.
- `src/lib/expo-supabase.ts` owns the single Expo Supabase client and
  AsyncStorage session persistence. Its lazy initialization and web SSR guard
  remain in place.
- `src/lib/phase1.ts` already defines `Category`, `Topic`, `Subtopic`,
  `NoteFile`, `WorkspaceData`, `loadWorkspaceData`, `createFile`, and
  `isValidTaxonomyPath`. Queries use the canonical table and column names and
  do not submit `owner_id`; authenticated RLS is intended to enforce owner
  scope.
- Before this UI phase, `app/(app)/home.tsx` loaded actual categories, topics,
  subtopics, and files and displayed the records, but had no hierarchy
  selector, file navigation, or create-file screen. No Expo notes or file
  destination route was present.
- Vite already uses the shared Phase 1 data layer for file operations. Its
  auth/notes behavior remains a separate implementation and is not replaced
  by these Expo changes.

## Repository-supported schema and relationships

The local migration
`supabase/migrations/20261016133000_phase1_taxonomy_files.sql` defines:

- `public.categories`: UUID `id`, `owner_id` defaulted to `auth.uid()`,
  `name`, `created_at`.
- `public.topics`: UUID `id`, `category_id`, owner, name, and created time;
  composite FK to its category and owner cascades when the category is
  deleted.
- `public.subtopics`: UUID `id`, `category_id`, `topic_id`, owner, name, and
  created time; composite FK to the matching topic/category/owner cascades
  when the topic is deleted.
- `public.files`: UUID `id`, `category_id`, `topic_id`, `subtopic_id`, owner,
  name, and timestamps; composite FK requires the exact matching
  Subtopic → Topic → Category → owner path and uses `ON DELETE RESTRICT`.
- `files_id_owner_unique` provides the `(id, owner_id)` key needed by the
  Phase 2 notes foreign key.
- Names are constrained to trimmed length 1–120. Stable UUID identifiers,
  not names, bind all relationships.
- Each table grants authenticated CRUD, revokes public/anonymous privileges,
  enables RLS, and provides owner-scoped policies using `auth.uid()`.

`supabase/migrations/20261016140000_phase2_notes.sql` depends on Phase 1's
files table and `files_id_owner_unique` key. It defines `public.notes` with a
restrictive FK to files. It has owner RLS. This is schema evidence only; it
does not mean the Expo note editor is implemented.

### Local migration boundary validation

The two migrations are separate files, and their timestamps order Phase 1
before Phase 2. Phase 1 creates `files_id_owner_unique` on
`(files.id, files.owner_id)` before Phase 2 creates the notes foreign key.
Phase 2 no longer attempts to add a prerequisite to the Phase 1 `files`
table. The Phase 1 file-path composite foreign keys enforce matching owner
and hierarchy IDs; the Phase 2 note/file composite foreign key enforces the
same owner and restricts deleting a file with notes. Taxonomy descendants
cascade only within Category → Topic → Subtopic; the restrictive file FK
blocks deletion where files exist. Both migrations contain ordinary
non-idempotent DDL and must run in order; do not retry against a partially
created schema without first inspecting it.

Automated static migration checks are in `tests/phase2.test.ts`. They verify
the files key is created in Phase 1, the notes FK references it, the
hierarchy owner FK remains intact, the migration order is correct, and no
stray `and;` statement boundary is present. These checks do not replace
running migrations against a disposable PostgreSQL/Supabase instance.

## Migration state and live facts

**Verified from repository:** Both SQL files exist locally and describe the
contracts above. The migration file is ordinary, non-idempotent DDL. There
are no checked-in migration-status records, live schema snapshots, or
database integration results proving these definitions are installed.

**User-reported live catalog evidence (not independently queried here):**
In the Supabase SQL Editor, `to_regclass` returned NULL for all four expected
Phase 1 tables; the non-system base-table listing showed only `auth`,
`realtime`, `storage`, and `vault`; and the `information_schema.tables`
query restricted to `public` returned no rows. Assuming the intended project
was selected, this is strong evidence that the Phase 1 application tables
are absent from that project's `public` schema, and therefore the expected
Phase 2 `public.notes` table is also not present there. It does not prove
what exists in another schema, another project, or a separately deployed
runtime.

The CLI migration list previously showed no remote versions for
`20261016133000` and `20261016140000`. This reports migration-history state
only; the optional `supabase_migrations.schema_migrations` query failed with
`42P01`, which is not evidence about application tables and is deliberately
not included in the revised diagnostic. The CLI's temporary database role
could not authenticate and requested a database password; no password was
read or supplied.

**Still unknown:** Whether the dashboard project was the one targeted by the
deployed app; whether any similarly named application objects exist in other
schemas; and whether hosted grants, RLS, policies, and API exposure match
the local migrations. Expo's configured project reference was privately
compared with the CLI-linked reference and matched in the local runtime.
Vite's Supabase URL was not configured in the inspected local environment.
No dashboard project reference was available for an independent private
comparison in this session.

The earlier safe error for PostgREST missing-relation codes (`42P01` and
`PGRST205`) specifically said workspace tables were unavailable and referred
to the Phase 1 migration. That is evidence of how a missing-table response is
handled, not proof that the live cause was absent tables. A stale PostgREST
schema cache, a different project, permission/policy mismatch, or missing
user-owned taxonomy data cannot be ruled out from the local repository.
`42501` is mapped separately to a safe permission message. No live request
was made to distinguish these causes.

## Deletion safety and schema changes

With the local Phase 1 constraints, deleting one category row cascades only
through its descendant topic and subtopic rows. Deleting one topic cascades
only to its subtopics; deleting a subtopic affects only that row. The
database performs each requested parent delete and FK cascade atomically.
Any file referencing an affected subtopic blocks the statement through
`ON DELETE RESTRICT`; the whole statement fails and preserves the taxonomy.
The Phase 2 notes FK restricts deleting a file while notes reference it.
There is no local cascade from taxonomy to files or notes.

Therefore, Phase 1 taxonomy deletion can use one authenticated Supabase
delete against the selected parent row, preceded by an explicit UI
confirmation that descendant taxonomy rows may be removed and that files
(and their notes) are preserved and will block the operation. Do not issue
separate client-side deletes for children. The database's actual deployed
constraints must still be verified manually before relying on this behavior.

## Current diagnostic follow-up

The local Expo runtime project reference was privately compared with the
Supabase CLI-linked project reference and matches. This check does not prove
the deployed app uses that project, and the Vite Supabase URL was not
configured in the inspected environment. The read-only SQL diagnostic was
reviewed and no longer queries the optional migration-history relation that
was absent from the connected project. It now checks the Phase 1 and Phase 2
tables, columns, constraints/delete rules, indexes, grants, RLS policies,
and the optional PostgREST exposed-schema setting. The script has not been
executed against the hosted project; live schema and the Home error cause
remain unknown.

No schema change is required for the Home selectors, path validation, file
creation, or safe taxonomy rename under the repository-supported schema. No
taxonomy provisioning, file/note cascade, RPC, or migration is introduced
in this phase. If the deployed database differs from the reviewed local
contract, stop and reconcile the schema with explicit operator approval
rather than weakening FKs or RLS.

## Required manual database actions

No action is required to implement the UI against the existing local
contract. Before live use, an authorized project operator should:

1. Inspect the target project's existing tables, keys, indexes, grants, and
   RLS policies; do not infer installation from the local SQL filename.
2. Compare the hosted schema with
   `20261016133000_phase1_taxonomy_files.sql` and
   `20261016140000_phase2_notes.sql`, including the restrictive file/notes
   relationships. Resolve any existing objects/conflicts before considering
   an approved migration plan.
3. If the Phase 1 schema is absent, obtain explicit approval and apply the
   reviewed migration through the authorized Supabase migration workflow.
   Do not apply it as part of this code task. Apply Phase 2 only if separately
   approved and needed by its own scope.
4. Provision only approved, real Category → Topic → Subtopic records for the
   intended authenticated owner. The app intentionally does not invent or
   seed taxonomy data.
5. Test owner isolation, taxonomy cascade behavior, and restrictive file
   deletion on a disposable project before production use.

**Readiness conclusion:** Phase 1 can safely proceed as a local-code/UI
implementation against the existing documented schema. Whether the current
live project is ready for real reads/writes remains **unverified**.

## Authorized read-only verification of the Home workspace error

The reviewed `docs/verify_phase1_workspace_readonly.sql` is read-only and
does not inspect row data, secrets, or migration-history relations. In the
intended project's Supabase Dashboard, privately confirm the project before
opening **SQL Editor**, paste the complete script, and run it. Return the
sanitized outputs for (1) expected table existence, (2) expected/actual
columns and types, (3) constraints and delete rules, (4) indexes, (5) RLS
flags and grants, (6) policy definitions, and (7) the PostgREST exposed
schema setting if available. Also report SQL errors by code/message only.
Do not return credentials, row contents, or personal note content. A
zero-row result in one catalog listing is meaningful only together with the
separate expected-table checklist and the privately confirmed target.

## Safe migration plan — not executed

The repository's supported workflow is the Supabase CLI and ordered files in
`supabase/migrations/`; no custom migration runner or `supabase/config.toml`
is checked in. The installed CLI documents `db push --dry-run`, which prints
the proposed migrations without applying them. In this pass,
`npx supabase db push --linked --dry-run` completed successfully and listed
exactly `20261016133000_phase1_taxonomy_files.sql` followed by
`20261016140000_phase2_notes.sql`; no migration was applied. A dry run is a
plan, not proof of schema absence or SQL execution success. Out-of-band
migration-history drift must still be considered alongside the user-reported
catalog results.

The repeated `npx supabase migration list --linked` command failed because
the CLI could not authenticate its temporary database role; raw output was
withheld. Earlier CLI output, as reported in the recovery history, showed
blank remote-version entries for both versions. Neither result replaces
catalog inspection or a proper migration-history reconciliation.

After privately confirming that the CLI link and Dashboard are the intended
same project, an authorized operator can run:

```powershell
npx supabase migration list --linked
npx supabase db push --linked --dry-run --skip-vault
```

Do not include command output containing a project reference in shared
logs. If the dry run is blocked by database authentication, stop; do not
provide or print `SUPABASE_DB_PASSWORD`, and do not bypass authentication.
Use the read-only SQL Editor diagnostic above to finish catalog comparison.
Before applying anything, inspect the dry-run list and existing schema for
conflicting/partially created objects. A missing migration-history table is
not grounds to mark migrations applied or to push blindly.

If and only if the authorized operator approves applying **both** reviewed
migrations to that exact project after a clean preview and schema comparison,
the CLI command is:

```powershell
npx supabase db push --linked --skip-vault
```

That command applies all locally pending migrations in timestamp order:
Phase 1 (`20261016133000`) first, then Phase 2 (`20261016140000`). It is not
a Phase 1-only command. `--skip-vault` prevents this migration operation
from updating Vault secrets from CLI configuration. These migrations are
non-idempotent; do not rerun
after a partial failure until inspecting the resulting schema/history. Take
an approved recoverable backup first. The DDL does not provide an automatic
rollback: restore/reconcile from the backup or prepare a separately reviewed
compensating migration after inspecting actual effects. Phase 1 owner FKs
cascade taxonomy descendants and auth-user deletion; file deletion is
restricted by notes. No hosted migration, dry run, or SQL Editor script was
executed during this pass.

The exact local Phase 1 migration is
`supabase/migrations/20261016133000_phase1_taxonomy_files.sql`; its version is
`20261016133000`. `app/(app)/home.tsx` invokes `loadWorkspaceData` in
`src/lib/phase1.ts`, which selects:

| Table | Home query columns |
| --- | --- |
| `categories` | `id`, `name` |
| `topics` | `id`, `category_id`, `name` |
| `subtopics` | `id`, `category_id`, `topic_id`, `name` |
| `files` | `id`, `category_id`, `topic_id`, `subtopic_id`, `name`, `created_at`, `updated_at` |

The migration gives each table a UUID primary key and owner ID defaulted to
`auth.uid()`. It grants authenticated CRUD and revokes public/anonymous
privileges; RLS is enabled with owner policies based on `auth.uid()` for
select, insert, update, and delete. Composite keys/FKs require the canonical,
same-owner Category → Topic → Subtopic → File path. Category deletion
cascades to Topics, Topic deletion cascades to Subtopics, and a referenced
Subtopic deletion is restricted by Files. This describes the checked-in
contract; it is not proof that any hosted project has it.

An authorized operator should use a non-production target and perform these
checks without sharing project URLs, keys, tokens, passwords, or environment
values:

1. In the Supabase Dashboard, confirm the intended project using its
   project reference. Privately compare that reference with the URL configured
   for the running app. Record only whether they match. Do not copy/publish
   the URL or any key. This code uses the default `public` schema unless
   changed elsewhere in client configuration.
2. In that same project, inspect migration history for
   `20261016133000`. Record `applied`, `not applied`, or `history unavailable`.
   A migration file in the repository is not evidence of hosted application.
3. Run the read-only SQL in
   `docs/verify_phase1_workspace_readonly.sql` with an authorized read-only
   SQL role where available. It inspects current context, migration history,
   expected columns, keys/FKs and delete rules, grants, RLS enablement, and
   policies. Its optional migration-history query is last so the other
   diagnostics can still be run if the history relation is unavailable.
   Check migration history in the Dashboard in that case; do not infer status
   from the query failure.
4. Compare the SQL results with the local migration. Also confirm that
   `public` is exposed through the Data API. If the migration is recorded as
   applied but expected tables or constraints are missing, stop and reconcile
   the target/project/schema/history discrepancy; do not rerun the
   non-idempotent migration blindly.
5. Reproduce the failure once in the intended app using an authorized
   non-production account. Record the failed operation (for example,
   `GET public.categories?select=id,name`), table, timestamp, HTTP status,
   Postgres/PostgREST error code, and the app's safe classification. Capture
   only the code/status and a sanitized summary; remove request/response
   headers, authorization data, cookies, query tokens, keys, and private row
   contents.
6. If reads return HTTP success but no rows, inspect approved owner-visible
   records and RLS policy behavior using authorized database-side inspection.
   RLS can filter rows to an empty result without returning a permission
   error. Do not insert sample records into the hosted project.

Interpret evidence in combination:

- **Unapplied migration:** intended project is confirmed; history explicitly
  lacks version `20261016133000`; expected objects are absent. This supports
  an unapplied migration only when project, schema, and migration-history
  source are verified.
- **Wrong project/schema:** the app's configured URL project reference does
  not match the intended project, or the request/schema context differs.
  Verify this before interpreting missing relations or history.
- **Stale PostgREST cache:** project and schema match, migration and tables /
  columns are present in database inspection, but Data API reports
  `PGRST205` (or a related schema-cache error). An authorized operator may
  use the documented Dashboard/API cache-refresh procedure after verifying
  the database state; do not alter schema merely to dismiss the error.
- **Permission/RLS:** HTTP 401 or invalid-JWT/auth errors point to session
  authentication; HTTP 403 or `42501` points to an explicit grant/policy
  denial. A successful empty response alone is not proof of permission
  failure or absent data; RLS may silently filter rows.
- **Network/service:** fetch/timeout failures without a Postgres/PostgREST
  response point to transport/connectivity; server errors should be recorded
  separately and not misreported as missing tables.

Current local evidence does not identify the live cause. No hosted project,
migration history, response code, RLS result, or data was examined.

### Follow-up investigation status (2026-10-17)

The available MCP tool inventory in this session includes GitHub, IDE, and
Maestro tools, but no Supabase MCP server, SQL execution tool, or Supabase
project-inspection integration. Thus there is no usable authorized hosted
database access here. No hosted request was made, and no environment file or
credential was inspected. The read-only diagnostic script above is prepared
for an authorized operator; it has not been run.

| Check | Result | Evidence source | Confidence / uncertainty |
| --- | --- | --- | --- |
| Supabase integration available to this session | No | Session tool inventory exposed GitHub, IDE, and Maestro MCP tools; no Supabase/database tool | High for this session's available tools; does not establish what integrations an operator has elsewhere |
| Intended project identity matches running app | Not verified | Requires private comparison by an authorized operator | Unknown |
| Migration `20261016133000` applied | Not verified | No hosted migration history access | Unknown |
| Expected tables, columns, FKs, grants, and RLS match | Not verified | Local SQL reviewed only; hosted SQL not accessible | Unknown |
| `public` exposed through Data API | Not verified | No hosted project settings access | Unknown |
| Current Home request failure code/status | Not captured | No live request or authorized runtime trace | Unknown |

The read-only SQL diagnostic was not executed. Project identity, hosted
migration history, live table/policy state, Data API exposure, and the
current request's HTTP status/error code remain **not verified**.

The exact quoted legacy Home message is not present in the current
application source. Current `toSafeDataError` messages distinguish a missing
relation (`42P01`) from a PostgREST schema-cache miss (`PGRST205`). This
source difference may mean the displayed app is running an older or
different bundle/path, but it is not proof of that: the actual response and
runtime build were not captured. When reproducing, record the app build/
source version and the sanitized error code alongside the request operation.

No code, migration, project configuration, schema, or hosted setting was
changed as part of this follow-up. No cause is confirmed and no hosted fix is
proposed until project identity and read-only evidence are available.

### Supabase CLI investigation (2026-10-17)

The installed Supabase CLI is `2.121.0`. `supabase projects list` showed a
linked project named `shyam-project-notes`, matching this repository's
project name. The linked project label is consistent with the intended
project, but the app's runtime URL was not inspected, so a match between the
CLI link and app configuration is **not verified**.

`supabase migration list` connected to the remote and displayed no remote
version for either local migration `20261016133000` or `20261016140000`.
This is migration-history evidence only and does not prove whether equivalent
tables were created outside the migration workflow.

The installed `supabase db query --help` supports `--linked` and `--file`.
The reviewed `docs/verify_phase1_workspace_readonly.sql` was run with
`--linked --file`; the query failed at its final migration-history select
with Postgres `42P01` because `supabase_migrations.schema_migrations` was not
found. Subsequent read-only catalog queries could not authenticate: the CLI
reported failure to connect as its temporary login role due to password
authentication failure and requested `SUPABASE_DB_PASSWORD`. No password or
environment value was requested or inspected. Therefore hosted columns,
foreign keys, grants, RLS policies, table existence, and Data API exposure
could not be verified. The diagnostics did not return table/catalog results.

No migration was applied and no hosted schema, policy, data, or setting was
changed. The cause of the Home error remains unconfirmed. Safest next
diagnostic: an authorized operator should use Supabase Dashboard's read-only
SQL editor or configure the CLI database password through an approved local
secret manager, then rerun only the SELECT diagnostics and compare the
running app's project reference privately. Never paste the password, keys,
or environment values into chat or command output.

## Phase 1 Expo implementation follow-up

The authenticated Expo Home now uses the shared `loadWorkspaceData` layer,
selects only real records by canonical IDs, filters files to the exact
selected Subtopic, and at that checkpoint routed to Phase 2 placeholders
carrying taxonomy/file IDs. Create File validated the saved hierarchy before
calling `createFile`. Taxonomy rename updated only `name` by stable ID.
Taxonomy deletion sent one authenticated delete for the selected row; local
SQL cascades only taxonomy descendants and restricts files. The later Phase 2
recovery implemented the Notes collection and editor; see
`docs/PHASE_2_IMPLEMENTATION_REPORT.md`.

No SQL was changed or run, and no live schema, policy, migration history,
account, or workspace data was queried. The installed-vs-prepared state and
whether any real data is provisioned remain unknown. A real owner-scoped
Category → Topic → Subtopic dataset and an authorized schema comparison are
still required before live use.

## Phase 2 data-access follow-up

The local Phase 2 migration defines `public.notes` with `owner_id` defaulting
to `auth.uid()`, owner-scoped authenticated RLS for each CRUD operation, an
index on `(owner_id, file_id)`, and a composite `(file_id, owner_id)` foreign
key to `files(id, owner_id)` using `ON DELETE RESTRICT`. `src/lib/notes.ts`
uses the signed-in client, omits client-supplied ownership on inserts, scopes
reads and mutations by owner where appropriate, and uses a conditional
`updated_at` predicate for saves. These are repository contracts only:
neither migration installation, hosted policy behavior, nor live data was
verified. No migration was applied during recovery.
