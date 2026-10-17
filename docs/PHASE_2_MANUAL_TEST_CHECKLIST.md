# Phase 2 Manual Verification Checklist

**Purpose:** Verify rendered behavior and real persistence that automated
mock-based tests and Expo exports cannot establish.

## Current run status

**NOT PERFORMED:** Every browser, mobile browser, Expo Go, live Supabase/RLS,
and Phase 3 manual check below remains unperformed. Static exports and
automated tests are not manual passes. Record each check only after an
authorized test is actually completed.

**Local configuration check:** The Expo runtime's project reference was
privately compared with the CLI-linked project reference and matched. The
Vite Supabase URL was not configured in the inspected environment. This does
not verify the browser/deployed runtime; that check remains **NOT TESTED**.

## Preconditions and safety

- Use only an authorized **non-production** Supabase project and test account.
- Use disposable, approved Category → Topic → Subtopic records and files.
  Do not create sample/fake records in production.
- Before the test, an authorized operator must confirm the intended project,
  migration versions, schema, grants, RLS, and restrictive foreign keys using
  the readiness checklist in `PHASE_2_VERIFICATION_REPORT.md`.
- Keep browser developer tools and terminal output free of access tokens,
  recovery links, secrets, and complete private note content.
- Use separate authorized test accounts for ownership checks where available.
  Never attempt to access data without authorization.
- Record each item as **PASS**, **FAIL**, **BLOCKED**, or **NOT TESTED**, with
  platform, date, app version/commit, sanitized error summary, and tester.
  Do not mark an export or unit test as a manual pass.
- Do not apply migrations, change hosted configuration, or test destructive
  actions on production data as part of this checklist.

## Desktop browser

### Authentication and collection selection

- [ ] Open the local Expo Web app in a fresh browser session. Sign in with the
  authorized non-production account. Confirm the authenticated Home appears.
- [ ] Reload the page. Confirm the session restores and the app returns to
  the authenticated Home without exposing a recovery-only screen.
- [ ] Select a known real Category, its Topic, and its Subtopic. Choose
  **Open Notes**. Confirm the collection displays exactly that hierarchy.
- [ ] Use a Subtopic with no files/notes. Confirm the empty guidance appears
  and no fabricated note or taxonomy record is displayed.
- [ ] Use a populated Subtopic. Confirm only its real notes are shown. If it
  contains more than one file, check that notes from another Subtopic do not
  appear.
- [ ] With network access available, observe the loading state. Then use
  browser network controls or an approved test proxy to interrupt a notes
  read. Confirm a safe error and **Retry**; restore access and verify retry
  loads the collection.
- [ ] In the authorized test project, exercise a permission-denied state only
  through an approved test policy/account setup. Confirm no foreign data is
  rendered and the user receives a safe error/retry path.

### Create and edit

- [ ] Choose **+ Add Notes** in a populated Subtopic. Confirm one persisted
  note is created and the full-page editor opens for that exact note.
- [ ] Reload after creation and confirm the note appears in the collection.
- [ ] Edit the title and body. Confirm the status changes through **Unsaved**
  and **Saving**, then shows **Saved** only after the request succeeds.
- [ ] Return to the collection. Confirm the title and short preview reflect
  the saved edits. Reopen the note and reload the browser; confirm both
  values persist.
- [ ] Edit rapidly while a save is in flight (use throttling or an approved
  test proxy if needed). Confirm the last value is saved and older responses
  do not replace it.
- [ ] Interrupt network access during autosave. Confirm **Save failed** is
  visible, the text stays in the editor, and **Retry** is available. Restore
  access, retry, wait for **Saved**, and reload to confirm persistence.
- [ ] While the save is failing, use the editor's back action. Confirm it
  does not silently discard the unsaved draft. If reload recovery is offered,
  verify the draft is available and explicitly recoverable.
- [ ] If possible with two sessions for the same authorized test owner, edit
  the same note concurrently. Confirm the stale editor reports a conflict
  without silently overwriting the newer cloud version.

### Copy and delete

- [ ] From the note's three-dot menu, choose **Copy Notes**. Choose a
  different valid destination Category → Topic → Subtopic and file. Confirm
  the destination path controls only offer real matching children/files.
- [ ] Confirm the copy title follows `(Copy)` and gains a numbered suffix if
  needed. Confirm title/content and supported note fields are copied, and
  the original note remains unchanged.
- [ ] Confirm success returns to the destination collection and the copy
  appears after refresh/reload. Repeat with an existing copy title and with
  a repeated click; verify no unintended duplicate request/card is produced.
- [ ] From the source note's three-dot menu, choose **Delete Notes** and
  cancel. Confirm nothing changes.
- [ ] Confirm deletion for a disposable note. Verify only that note and its
  note content disappear; other notes, files, and the entire taxonomy remain.
- [ ] In an approved failure simulation, reject the delete request. Confirm
  the note remains visible and a safe failure message is shown.
- [ ] Confirm the menu contains **Copy Notes**, **Delete Notes**, **Add SQL**,
  and **Add Markdown Text**. In Phase 2, the latter two may only identify
  them as later-phase features.

### Responsive and accessibility checks

- [ ] Repeat core collection/editor steps at desktop and narrow/mobile
  browser widths. Check horizontal overflow, card wrapping, text-input
  visibility, scrolling, and dialogs within the viewport.
- [ ] Navigate controls by keyboard; verify focus visibility, button names,
  menu/dialog dismissal, confirmation focus, and save-status announcements.

## Mobile browser

- [ ] Open the Expo Web app in a mobile browser using the same authorized
  non-production account and test project.
- [ ] Repeat Home → selected Subtopic → collection; create, edit, save,
  reload, cross-Subtopic copy, and confirmed delete.
- [ ] Check virtual keyboard behavior, multiline editing, scrolling, menu and
  confirmation dialogs, back navigation, and narrow-screen layout.
- [ ] Repeat one failed autosave/retry scenario using a safe test network
  interruption. Confirm source text remains recoverable.

## Expo Go

- [ ] Start the local Expo app and open it in Expo Go on an authorized test
  device. Sign in and confirm Home/session restoration.
- [ ] Open the selected Subtopic collection and repeat empty/populated states,
  note creation, editor title/body edits, autosave status, reload/reopen, and
  retry after a controlled network interruption.
- [ ] Copy a note to a different valid Subtopic/file. Confirm the destination
  collection refreshes and the original remains unchanged.
- [ ] Cancel and confirm deletion of disposable notes. Verify other notes,
  files, and taxonomy are unchanged.
- [ ] Check Android system-back handling while edits are unsaved or saving,
  keyboard/scroll behavior, small-screen layout, and app restart/recovery.

## Phase 3 inline SQL practice

- [ ] Use a non-production account and an existing disposable note. Open
  **Add SQL** and confirm the prompt, table definitions, and query editor
  expand inline in that same note editor.
- [ ] Run the example query. Confirm the backend's isolated practice dataset
  returns rows and the separate Gemini evaluation describes the submitted
  query/result; do not treat Gemini as the execution engine.
- [ ] Insert the practice result. Confirm the previous note text remains,
  question/SQL/output/evaluation are appended to the same note, autosave
  reaches **Saved**, and reopening/refreshing the note retains the block.
- [ ] Try a write, multiple statements, unsupported function, and recursive
  CTE; confirm the sandbox rejects them without reaching Supabase.
- [ ] Confirm a missing backend configuration or backend failure is shown
  without claiming execution/evaluation success. Do not run this check
  against production SQL or production Supabase data.

## Authorization boundaries

- [ ] If two authorized test accounts are available, create separate real
  test taxonomy/files and notes for each through approved workflows.
- [ ] Sign in as Account A and verify Account B's records are absent from
  workspace selectors, note lists, direct note links, and destination choices.
- [ ] Verify Account A cannot read, update, copy, or delete Account B's note
  using the app's normal authenticated routes. Do not forge unauthorized
  requests except in an expressly approved disposable security test.
- [ ] Record server-side RLS and foreign-key results separately from
  client-side UI filtering; both accounts and the target project must be
  authorized for this test.

## Results record

No browser, mobile browser, Expo Go, hosted Supabase, or deployment test is
marked passed by this repository report. The authorized tester should record
results in a separate approved test record and update the verification report
only after receiving evidence and permission to do so.
