# Phase 3 Inline SQL Practice — Local Design

This is the contract for the initial local implementation. It does not
authorize a hosted change or claim the service is deployed or manually
verified.

## Flow and boundaries

1. The Expo note editor opens SQL practice inline for the current note. Its
   route retains the note ID and canonical Category → Topic → Subtopic
   context; no SQL-only note or parallel taxonomy is created.
2. The app requests a fixed practice prompt and schema from the authenticated
   backend.
3. The app submits SQL to the backend's isolated in-memory SQLite runner.
   Each request creates a fresh database with fixed educational fixtures.
   The runner has no Supabase client or production data connection.
4. Only after execution succeeds, the app sends the submitted SQL, question,
   and returned sandbox result to the existing authenticated Gemini
   evaluation endpoint. Gemini evaluates; it never executes SQL.
5. **Insert into Note** appends the question, SQL, output, and evaluation to
   the current note's existing `source_content`, and updates the existing
   SQL result fields through the same owner-scoped, `updated_at`-checked
   autosave as normal editing.

## HTTP contracts

| Operation | Request | Success response | Safe failure behavior |
| --- | --- | --- | --- |
| `GET /api/notes/practice-question` | Authenticated request; no body | `{ prompt: string, schema: string[] }` | Missing/invalid auth is rejected; no prompt is returned if auth is unavailable. |
| `POST /api/notes/run-sql` | Authenticated JSON `{ sql: string }` | `{ columns: string[], rows: Record<string, primitive \| null>[], rowLimit: number, truncated: boolean }` | Invalid SQL/input returns a generic execution error; provider and database internals are not exposed. |
| `POST /api/notes/evaluate-sql` | Authenticated JSON `{ sql: string, question?: string, executionResult?: string }` | `{ output: string, evaluation: string }` | Provider errors use safe API errors; the note source remains unchanged until explicit insertion. |

All three endpoints verify the Supabase access token on the server. The
practice execution does not access Supabase tables, and the evaluator has no
execution capability. The client never receives a Gemini credential or
service-role key.

## SQL sandbox limits

The backend uses Node `node:sqlite` (minimum Node `24.10.0`, which provides the
Node SQLite authorizer API used here) with an in-memory
database, fixed `employees` and `departments` tables, a read-only SQLite
authorizer that permits reads only from those tables, a SQL length limit,
SQLite-parser-derived one-statement boundary checks, an allowed-function
list, SQLite limits, a query-plan cap of four table scans, and at most 200
response rows.
Recursive CTEs are rejected to avoid unbounded synchronous execution.
Statements outside the supported read-only practice scope fail closed.

The sample records are isolated SQL-learning fixtures. They are not user's
notes or workspace data and are never inserted into Supabase.

## Tests and remaining work

Automated coverage includes expected sample output, malformed SQL,
write/multiple-statement/unsafe-function/recursive-query rejection, result
truncation, query-plan scan limits, endpoint authentication, evaluation
failure while preserving execution output, frontend URL resolution, request
format, autosave persistence of the appended block, and appending without
replacing existing note text. The Expo screen clears results when the query
changes and allows retrying Gemini evaluation without re-running SQL.

The Expo client and `.env.example` consistently use
`EXPO_PUBLIC_API_BASE_URL`. The backend package and lockfile require Node
`>=24.10.0`, the runtime version needed for the SQLite authorizer used by
this sandbox.

**Locally implemented and automated:** isolated SQLite execution and its
limits, authenticated backend request handlers, separate Gemini evaluation,
inline editor interaction, retry/result retention, note append/autosave
contracts, and Expo URL consistency. Backend tests use mocked auth/provider
implementations; frontend tests use mocked persistence. Vite production
builds and Expo web/Android exports passed locally, but do not establish
rendered UI or runtime service behavior.

Still required before relying on the feature: rendered browser and Expo Go
checks, configured backend reachability, approved live Gemini behavior, and
persistence through a non-production Supabase note. Resource limits and Node
version must also be confirmed in the eventual hosted runtime. No production
execution, live provider test, or deployment check has been performed.
Phase 4 Markdown conversion is not implemented by this design.
