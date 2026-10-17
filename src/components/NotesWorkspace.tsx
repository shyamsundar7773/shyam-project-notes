import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { AutosaveQueue, type SaveState } from '../lib/autosave'
import {
  copyNote,
  createNote,
  createNoteForSubtopic,
  deleteNote,
  editableFields,
  getDraftStorage,
  listNotes,
  NoteSaveConflictError,
  notesForFile,
  noteColorForId,
  readCachedDraft,
  removeCachedDraft,
  saveNote,
  writeCachedDraft,
  type EditableNote,
  type Note,
  type NoteType,
} from '../lib/notes'
import {
  isValidTaxonomyPath,
  loadWorkspaceData,
  parseTaxonomyQuery,
} from '../lib/phase1'
import {
  requestNoteAi,
  resolveBackendBaseUrl,
} from '../lib/note-ai'
import { MarkdownPreview } from './MarkdownPreview'

type Props = {
  client: SupabaseClient
  session: Session
  search: string
  navigate: (url: string) => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'The request could not be completed. Try again.'
}

function SaveStateLabel({
  state,
  onRetry,
  retryDisabled = false,
}: {
  state: SaveState
  onRetry: () => void
  retryDisabled?: boolean
}) {
  if (state === 'failed') {
    return (
      <span className="save-state save-state--failed" role="status" aria-live="polite">
        Couldn’t save —{' '}
        <button
          className="text-button"
          type="button"
          onClick={onRetry}
          disabled={retryDisabled}
        >
          Retry
        </button>
      </span>
    )
  }
  const label =
    state === 'saving'
      ? 'Saving…'
      : state === 'unsaved'
        ? 'Unsaved changes'
        : 'All changes saved'
  return (
    <span className="save-state" role="status" aria-live="polite">
      {label}
    </span>
  )
}

function DeleteNoteDialog({
  note,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  note: Note | null
  busy: boolean
  error: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (note && dialog && !dialog.open) dialog.showModal()
    if (!note && dialog?.open) dialog.close()
  }, [note])

  return (
    <dialog
      ref={ref}
      className="action-dialog"
      aria-labelledby="delete-note-title"
      aria-describedby="delete-note-description"
      onClose={onCancel}
      onCancel={(event) => {
        if (busy) event.preventDefault()
      }}
    >
      {note ? (
        <div className="dialog-content">
          <h2 id="delete-note-title">Delete note?</h2>
          <p id="delete-note-description">
            Delete <strong>{note.title}</strong> from this file? Its parent file
            and taxonomy will not be changed.
          </p>
          {error ? (
            <div className="notice notice--error" role="alert">
              {error}
            </div>
          ) : null}
          <div className="dialog-actions">
            <button
              className="button button--quiet"
              type="button"
              onClick={onCancel}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              className="button button--danger"
              type="button"
              onClick={onConfirm}
              disabled={busy}
            >
              {busy ? 'Deleting…' : 'Delete Note'}
            </button>
          </div>
        </div>
      ) : null}
    </dialog>
  )
}

function previewText(note: Note): string {
  if (note.note_type === 'sql') {
    return note.source_content || 'SQL working note'
  }
  if (note.note_type === 'markdown') {
    return note.markdown_output || note.source_content || 'Markdown note'
  }
  return note.source_content || 'Empty note'
}

function NotesGrid({
  notes,
  search,
  setSearch,
  onOpen,
  onCopy,
  onDelete,
  onCreate,
  busy,
  hasSelectedFile,
}: {
  notes: Note[]
  search: string
  setSearch: (value: string) => void
  onOpen: (note: Note) => void
  onCopy: (note: Note) => void
  onDelete: (note: Note) => void
  onCreate: (type: NoteType) => void
  busy: boolean
  hasSelectedFile: boolean
}) {
  const gridRef = useRef<HTMLDivElement>(null)
  const filteredNotes = notes.filter((note) =>
    `${note.title}\n${note.source_content}\n${note.personal_notes}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase()),
  )

  useEffect(() => {
    function closeMenusOutsideGrid(event: PointerEvent) {
      if (gridRef.current?.contains(event.target as Node)) return
      gridRef.current
        ?.querySelectorAll<HTMLDetailsElement>('details[open]')
        .forEach((menu) => {
          menu.open = false
        })
    }
    document.addEventListener('pointerdown', closeMenusOutsideGrid)
    return () =>
      document.removeEventListener('pointerdown', closeMenusOutsideGrid)
  }, [])

  return (
    <>
      <div className="notes-toolbar">
        <label className="note-search">
          <span className="visually-hidden">Search notes in this file</span>
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search notes in this file"
          />
        </label>
        <div className="note-create-actions">
          <button
            className="button button--quiet"
            type="button"
            onClick={() => onCreate('text')}
            disabled={busy}
          >
            + Add Note
          </button>
          <button
            className="button button--quiet"
            type="button"
            onClick={() => onCreate('sql')}
            disabled={busy || !hasSelectedFile}
          >
            Add SQL
          </button>
          <button
            className="button button--primary"
            type="button"
            onClick={() => onCreate('markdown')}
            disabled={busy || !hasSelectedFile}
          >
            Add Markdown File
          </button>
        </div>
      </div>
      {filteredNotes.length === 0 ? (
        <div className="notes-empty" role="status">
          <span className="notes-empty-icon" aria-hidden="true">
            ✦
          </span>
          <h2>{notes.length ? 'No notes match your search' : 'A fresh page'}</h2>
          <p>
            {notes.length
              ? 'Try a different search.'
              : 'Create a note, SQL working note, or Markdown note in this file.'}
          </p>
        </div>
      ) : (
        <div className="notes-grid" ref={gridRef}>
          {filteredNotes.map((note) => (
            <article
              className={`note-card note-card--${noteColorForId(note.id)}`}
              key={note.id}
            >
              <button
                className="note-card-open"
                type="button"
                onClick={() => onOpen(note)}
                aria-label={`Open ${note.title}`}
              >
                <span className="note-card-topline">
                  <span className="note-type">{note.note_type}</span>
                  {note.is_pinned ? (
                    <span className="note-pin" aria-label="Pinned">
                      Pinned
                    </span>
                  ) : null}
                </span>
                <strong className="note-card-title">{note.title}</strong>
                <span className="note-card-preview">{previewText(note)}</span>
                {note.note_type === 'sql' &&
                (note.sql_output || note.sql_evaluation) ? (
                  <span className="note-result-badge">AI evaluation saved</span>
                ) : note.note_type === 'markdown' && note.markdown_output ? (
                  <span className="note-result-badge">Converted Markdown</span>
                ) : null}
              </button>
              <details
                className="note-actions"
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.currentTarget.open = false
                    event.currentTarget.querySelector('summary')?.focus()
                  }
                }}
              >
                <summary aria-label={`Actions for ${note.title}`}>
                  <span aria-hidden="true">•••</span>
                </summary>
                <div className="note-actions-menu">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.currentTarget.closest('details')?.removeAttribute('open')
                      onCopy(note)
                    }}
                  >
                    Copy Notes
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.currentTarget.closest('details')?.removeAttribute('open')
                      onCreate('sql')
                    }}
                  >
                    Add SQL
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.currentTarget.closest('details')?.removeAttribute('open')
                      onCreate('markdown')
                    }}
                  >
                    Add Markdown File
                  </button>
                  <button
                    className="menu-danger"
                    type="button"
                    onClick={(event) => {
                      event.currentTarget.closest('details')?.removeAttribute('open')
                      onDelete(note)
                    }}
                  >
                    Delete Note
                  </button>
                </div>
              </details>
            </article>
          ))}
        </div>
      )}
    </>
  )
}

function NoteEditor({
  client,
  session,
  note,
  onSavedNote,
  onClose,
}: {
  client: SupabaseClient
  session: Session
  note: Note
  onSavedNote: (note: Note) => void
  onClose: (goHome: boolean) => void
}) {
  const [draftStorage] = useState(getDraftStorage)
  const [cachedAtOpen] = useState(() =>
    readCachedDraft(draftStorage, session.user.id, note.id),
  )
  const [originalUpdatedAt] = useState(note.updated_at)
  const [value, setValue] = useState<EditableNote>(() => {
    return cachedAtOpen?.baseUpdatedAt === originalUpdatedAt
      ? cachedAtOpen.value
      : editableFields(note)
  })
  const valueRef = useRef(value)
  const remoteUpdatedAt = useRef(note.updated_at)
  const [saveState, setSaveState] = useState<SaveState>(
    cachedAtOpen?.baseUpdatedAt === originalUpdatedAt
      ? 'unsaved'
      : 'saved',
  )
  const [recoveryDraft, setRecoveryDraft] = useState(
    cachedAtOpen?.baseUpdatedAt !== originalUpdatedAt
      ? cachedAtOpen
      : null,
  )
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const [markdownSourceVisible, setMarkdownSourceVisible] = useState(
    !note.markdown_output,
  )
  const [closeWarning, setCloseWarning] = useState('')
  const [hasSaveConflict, setHasSaveConflict] = useState(false)
  const queueRef = useRef<AutosaveQueue<EditableNote> | null>(null)
  const saveStateRef = useRef(saveState)
  const aiLock = useRef(false)
  const mounted = useRef(true)
  const currentSourceMatchesResult =
    note.note_type === 'sql'
      ? value.source_content === value.sql_evaluated_source
      : note.note_type === 'markdown'
        ? value.source_content === value.markdown_converted_source
        : true

  useEffect(() => {
    mounted.current = true
    const queue = new AutosaveQueue<EditableNote>(
      valueRef.current,
      async (draft) => {
        let saved: Note
        try {
          saved = await saveNote(
            client,
            note.id,
            remoteUpdatedAt.current,
            draft,
          )
        } catch (error) {
          if (error instanceof NoteSaveConflictError && mounted.current) {
            setHasSaveConflict(true)
          }
          throw error
        }
        remoteUpdatedAt.current = saved.updated_at
        onSavedNote(saved)
        if (
          JSON.stringify(valueRef.current) === JSON.stringify(draft)
        ) {
          removeCachedDraft(draftStorage, session.user.id, note.id)
        }
      },
      (state) => {
        saveStateRef.current = state
        if (mounted.current) setSaveState(state)
      },
    )
    queueRef.current = queue

    if (cachedAtOpen?.baseUpdatedAt === originalUpdatedAt) {
      void Promise.resolve().then(() => queue.edit(valueRef.current))
    }

    return () => {
      mounted.current = false
      queue.dispose()
    }
  }, [
    client,
    cachedAtOpen,
    draftStorage,
    note.id,
    onSavedNote,
    originalUpdatedAt,
    session.user.id,
  ])

  useEffect(() => {
    if (saveState === 'saved') return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [saveState])

  const edit = useCallback(
    (patch: Partial<EditableNote>) => {
      const next = { ...valueRef.current, ...patch }
      valueRef.current = next
      setValue(next)
      writeCachedDraft(draftStorage, session.user.id, note.id, {
        baseUpdatedAt: remoteUpdatedAt.current,
        value: next,
      })
      queueRef.current?.edit(next)
    },
    [draftStorage, note.id, session.user.id],
  )

  function restoreLocalDraft() {
    if (!recoveryDraft) return
    remoteUpdatedAt.current = note.updated_at
    edit(recoveryDraft.value)
    setRecoveryDraft(null)
  }

  function discardLocalDraft() {
    removeCachedDraft(draftStorage, session.user.id, note.id)
    setRecoveryDraft(null)
  }

  async function evaluateSql() {
    if (aiLock.current || !value.source_content.trim()) {
      setAiError('Enter SQL source before requesting an evaluation.')
      return
    }
    console.info('[notes-ai] button clicked operation=sql-evaluation')
    aiLock.current = true
    setAiBusy(true)
    setAiError('')
    try {
      const result = await requestNoteAi(
        {
          kind: 'sql',
          content: value.source_content,
          accessToken: session.access_token,
        },
        {
          baseUrl: resolveBackendBaseUrl(
            import.meta.env.VITE_BACKEND_URL ?? '',
            window.location.href,
          ),
        },
      )
      if (!('output' in result)) {
        throw new Error('The AI service returned an invalid evaluation.')
      }
      if (!mounted.current) return
      edit({
        sql_output: result.output,
        sql_evaluation: result.evaluation,
        sql_evaluated_source: value.source_content,
      })
      console.info('[notes-ai] result displayed operation=sql-evaluation')
    } catch (error) {
      setAiError(errorMessage(error))
    } finally {
      aiLock.current = false
      setAiBusy(false)
    }
  }

  async function convertMarkdown() {
    if (aiLock.current || !value.source_content.trim()) {
      setAiError('Paste Markdown source before requesting conversion.')
      return
    }
    console.info('[notes-ai] button clicked operation=markdown-conversion')
    aiLock.current = true
    setAiBusy(true)
    setAiError('')
    try {
      const result = await requestNoteAi(
        {
          kind: 'markdown',
          content: value.source_content,
          accessToken: session.access_token,
        },
        {
          baseUrl: resolveBackendBaseUrl(
            import.meta.env.VITE_BACKEND_URL ?? '',
            window.location.href,
          ),
        },
      )
      if (!('convertedMarkdown' in result)) {
        throw new Error('The AI service returned an invalid conversion.')
      }
      if (!mounted.current) return
      edit({
        markdown_output: result.convertedMarkdown,
        markdown_converted_source: value.source_content,
      })
      setMarkdownSourceVisible(false)
      console.info('[notes-ai] result displayed operation=markdown-conversion')
    } catch (error) {
      setAiError(errorMessage(error))
    } finally {
      aiLock.current = false
      setAiBusy(false)
    }
  }

  async function requestClose(goHome = false) {
    setCloseWarning('')
    await queueRef.current?.flush()
    if (saveStateRef.current === 'failed') {
      const locallyRecoverable = Boolean(
        readCachedDraft(draftStorage, session.user.id, note.id),
      )
      const warningMessage = locallyRecoverable
        ? 'Cloud save failed. Leave while keeping the local recovery draft on this device?'
        : 'Cloud save failed, and no local recovery draft is available. Leave and risk losing these changes?'
      setCloseWarning(
        locallyRecoverable
          ? 'Cloud save failed. A recovery draft is stored in this browser.'
          : 'Cloud save failed, and a local recovery draft could not be confirmed. Leaving may lose these changes.',
      )
      if (!window.confirm(warningMessage)) {
        return
      }
    }
    onClose(goHome)
  }

  function reloadLatestVersion() {
    if (
      !window.confirm(
        'Reload the latest cloud version and discard this local draft? This cannot be undone.',
      )
    ) {
      return
    }
    removeCachedDraft(draftStorage, session.user.id, note.id)
    window.location.reload()
  }

  const resultIsStale = !currentSourceMatchesResult

  return (
    <section className={`note-editor note-editor--${value.note_color}`}>
      <div className="note-editor-header">
        <button className="back-link back-link--inline" type="button" onClick={() => void requestClose()}>
          <span aria-hidden="true">←</span> All notes
        </button>
        <SaveStateLabel
          state={saveState}
          onRetry={() => void queueRef.current?.retry()}
          retryDisabled={hasSaveConflict}
        />
        <button
          className="button button--quiet button--small"
          type="button"
          onClick={() => void requestClose(true)}
        >
          Home
        </button>
        <button
          className="button button--quiet button--small"
          type="button"
          onClick={() => void requestClose()}
        >
          Done
        </button>
      </div>

      {hasSaveConflict ? (
        <div className="notice notice--warning" role="alert">
          This note changed in another session. Your local draft is preserved.
          Reload the latest cloud version to resolve the conflict, or keep this
          editor open and copy your draft elsewhere before reloading.
          <div className="recovery-actions">
            <button
              className="text-button"
              type="button"
              onClick={reloadLatestVersion}
            >
              Reload latest cloud version
            </button>
          </div>
        </div>
      ) : null}

      {recoveryDraft ? (
        <div className="notice notice--warning" role="alert">
          A local draft differs from the latest cloud version. Choose whether to
          restore your local changes or discard them.
          <div className="recovery-actions">
            <button className="text-button" type="button" onClick={restoreLocalDraft}>
              Restore local draft
            </button>
            <button className="text-button" type="button" onClick={discardLocalDraft}>
              Discard local draft
            </button>
          </div>
        </div>
      ) : null}
      {closeWarning ? (
        <div className="notice notice--warning" role="status">
          {closeWarning}
        </div>
      ) : null}

      <label className="field note-title-field">
        <span className="visually-hidden">Note title</span>
        <input
          value={value.title}
          maxLength={200}
          onChange={(event) => edit({ title: event.target.value })}
          aria-label="Note title"
        />
      </label>

      {note.note_type === 'text' ? (
        <label className="field note-content-field">
          <span className="visually-hidden">Note content</span>
          <textarea
            value={value.source_content}
            onChange={(event) => edit({ source_content: event.target.value })}
            placeholder="Write a note…"
            aria-label="Note content"
            rows={12}
          />
        </label>
      ) : null}

      {note.note_type === 'sql' ? (
        <div className="sql-workspace">
          <label className="field">
            <span>SQL source</span>
            <textarea
              className="code-editor"
              value={value.source_content}
              onChange={(event) => edit({ source_content: event.target.value })}
              placeholder="SELECT column_name FROM table_name;"
              aria-label="SQL source"
              spellCheck={false}
              rows={9}
            />
          </label>
          <div className="ai-actions">
            <button
              className="button button--primary"
              type="button"
              onClick={() => void evaluateSql()}
              disabled={aiBusy}
            >
              {aiBusy ? 'Evaluating…' : 'Run SQL with AI'}
            </button>
            <span className="field-hint">
              Illustrative AI review only. SQL is not executed against a database.
            </span>
          </div>
          {aiError ? (
            <div className="notice notice--error" role="alert">
              {aiError}
            </div>
          ) : null}
          {value.sql_output ? (
            <section className="ai-result" aria-labelledby="sql-output-heading">
              <h3 id="sql-output-heading">Output</h3>
              <p className="result-label">AI-generated illustrative output</p>
              {resultIsStale ? (
                <p className="notice notice--warning">
                  This output reflects an earlier SQL source. Run the AI review
                  again to refresh it.
                </p>
              ) : null}
              <pre>{value.sql_output}</pre>
            </section>
          ) : null}
          {value.sql_evaluation ? (
            <section
              className="ai-result ai-result--evaluation"
              aria-labelledby="sql-evaluation-heading"
            >
              <h3 id="sql-evaluation-heading">AI Evaluation</h3>
              <p className="result-label">
                AI-generated review; verify against your actual schema.
              </p>
              <p>{value.sql_evaluation}</p>
            </section>
          ) : null}
          <label className="field personal-notes-field">
            <span>Notes</span>
            <textarea
              value={value.personal_notes}
              onChange={(event) => edit({ personal_notes: event.target.value })}
              placeholder="Add your own observations…"
              rows={5}
            />
          </label>
        </div>
      ) : null}

      {note.note_type === 'markdown' ? (
        <div className="markdown-workspace">
          {value.markdown_output && !markdownSourceVisible ? (
            <>
              <section className="markdown-result" aria-label="Converted Markdown">
                <div className="result-label">AI-converted Markdown</div>
                {resultIsStale ? (
                  <p className="notice notice--warning">
                    This result reflects an earlier source. Convert again to
                    refresh it.
                  </p>
                ) : null}
                <MarkdownPreview source={value.markdown_output} />
              </section>
              <button
                className="text-button"
                type="button"
                onClick={() => setMarkdownSourceVisible(true)}
              >
                Edit raw Markdown source
              </button>
            </>
          ) : (
            <>
              <label className="field">
                <span>Raw Markdown</span>
                <textarea
                  className="code-editor markdown-source"
                  value={value.source_content}
                  onChange={(event) =>
                    edit({ source_content: event.target.value })
                  }
                  placeholder="Paste Markdown here…"
                  aria-label="Raw Markdown source"
                  spellCheck={false}
                  rows={12}
                />
              </label>
              <div className="ai-actions">
                <button
                  className="button button--primary"
                  type="button"
                  onClick={() => void convertMarkdown()}
                  disabled={aiBusy}
                >
                  {aiBusy ? 'Converting…' : 'Convert with AI'}
                </button>
                <span className="field-hint">
                  Conversion runs only when requested. Unsafe HTML is displayed
                  as text, not executed.
                </span>
              </div>
              {value.markdown_output ? (
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setMarkdownSourceVisible(false)}
                >
                  View last successful conversion
                </button>
              ) : null}
            </>
          )}
          {aiError ? (
            <div className="notice notice--error" role="alert">
              {aiError}
            </div>
          ) : null}
          <label className="field personal-notes-field">
            <span>Notes</span>
            <textarea
              value={value.personal_notes}
              onChange={(event) => edit({ personal_notes: event.target.value })}
              placeholder="Add your own observations…"
              rows={5}
            />
          </label>
        </div>
      ) : null}

      <div className="note-editor-footer">
        <span className="result-label">
          {note.note_type === 'sql'
            ? 'SQL is reviewed by AI only; no database query is run.'
            : note.note_type === 'markdown'
              ? 'Raw source and last successful conversion are saved separately.'
              : 'This note belongs to its selected file.'}
        </span>
        <button
          className="button button--quiet"
          type="button"
          onClick={() => void requestClose()}
        >
          Back to notes
        </button>
      </div>
    </section>
  )
}

export function NotesWorkspace({ client, session, search, navigate }: Props) {
  const taxonomyPath = parseTaxonomyQuery(search)
  const categoryId = taxonomyPath?.categoryId ?? ''
  const topicId = taxonomyPath?.topicId ?? ''
  const subtopicId = taxonomyPath?.subtopicId ?? ''
  const idsValid = taxonomyPath !== null

  const [workspace, setWorkspace] = useState<Awaited<
    ReturnType<typeof loadWorkspaceData>
  > | null>(null)
  const [loadedSearch, setLoadedSearch] = useState('')
  const [workspaceError, setWorkspaceError] = useState(
    '',
  )
  const workspaceLoading = idsValid && loadedSearch !== search
  const visibleWorkspaceError = idsValid
    ? loadedSearch === search
      ? workspaceError
      : ''
    : 'This notes link is incomplete or malformed. Return to Home and choose a valid taxonomy path.'
  const [selectedFileId, setSelectedFileId] = useState('')
  const [notes, setNotes] = useState<Note[]>([])
  const [notesLoading, setNotesLoading] = useState(false)
  const [notesError, setNotesError] = useState('')
  const [searchText, setSearchText] = useState('')
  const [editingNote, setEditingNote] = useState<Note | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionMessage, setActionMessage] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Note | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const actionLock = useRef(false)
  const deleteLock = useRef(false)
  const mounted = useRef(true)
  const notesRequest = useRef(0)

  const validTaxonomy = Boolean(
    idsValid &&
      workspace &&
      isValidTaxonomyPath(
        { category_id: categoryId, topic_id: topicId, subtopic_id: subtopicId },
        workspace,
      ),
  )
  const matchingFiles = useMemo(
    () =>
      validTaxonomy && workspace
        ? workspace.files.filter(
            (file) =>
              file.category_id === categoryId &&
              file.topic_id === topicId &&
              file.subtopic_id === subtopicId,
          )
        : [],
    [categoryId, subtopicId, topicId, validTaxonomy, workspace],
  )
  const selectedFile = matchingFiles.find(
    (file) => file.id === selectedFileId,
  )
  const selectedCategory = workspace?.categories.find(
    (item) => item.id === categoryId,
  )
  const selectedTopic = workspace?.topics.find((item) => item.id === topicId)
  const selectedSubtopic = workspace?.subtopics.find(
    (item) => item.id === subtopicId,
  )

  useEffect(() => {
    let active = true
    mounted.current = true
    if (!idsValid) {
      return () => {
        active = false
        mounted.current = false
      }
    }

    void loadWorkspaceData(client)
      .then((data) => {
        if (!active) return
        setWorkspace(data)
        const pathIsValid = isValidTaxonomyPath(
          {
            category_id: categoryId,
            topic_id: topicId,
            subtopic_id: subtopicId,
          },
          data,
        )
        if (!pathIsValid) {
          setWorkspaceError(
            'This taxonomy path is unavailable for your account. Return to Home and choose an accessible path.',
          )
          setSelectedFileId('')
          return
        }
        const files = data.files.filter(
          (file) =>
            file.category_id === categoryId &&
            file.topic_id === topicId &&
            file.subtopic_id === subtopicId,
        )
        setSelectedFileId((current) =>
          files.some((file) => file.id === current)
            ? current
            : files.length === 1
              ? files[0].id
              : '',
        )
      })
      .catch((error) => {
        if (active) {
          setWorkspaceError(errorMessage(error))
          setWorkspace(null)
        }
      })
      .finally(() => {
        if (active) setLoadedSearch(search)
      })

    return () => {
      active = false
      mounted.current = false
    }
  }, [categoryId, client, idsValid, search, subtopicId, topicId])

  const refreshNotes = useCallback(async () => {
    const requestId = ++notesRequest.current
    if (!selectedFile) {
      setNotes([])
      setNotesLoading(false)
      setNotesError('')
      return
    }
    setNotesLoading(true)
    setNotesError('')
    try {
      const nextNotes = await listNotes(client, selectedFile.id)
      if (mounted.current && requestId === notesRequest.current) {
        setNotes(nextNotes)
      }
    } catch (error) {
      if (mounted.current && requestId === notesRequest.current) {
        setNotes([])
        setNotesError(errorMessage(error))
      }
    } finally {
      if (mounted.current && requestId === notesRequest.current) {
        setNotesLoading(false)
      }
    }
  }, [
    client,
    selectedFile,
    setNotes,
    setNotesError,
    setNotesLoading,
  ])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => {
      if (active) void refreshNotes()
    })
    return () => {
      active = false
      notesRequest.current += 1
    }
  }, [refreshNotes, selectedFile])

  async function createWorkingNote(noteType: NoteType) {
    if (actionLock.current) return
    if (!validTaxonomy || (matchingFiles.length > 1 && !selectedFile)) return
    actionLock.current = true
    setBusy(true)
    setActionMessage('')
    try {
      let note: Note
      if (!selectedFile && matchingFiles.length === 0 && noteType === 'text') {
        const created = await createNoteForSubtopic(
          client,
          session.user.id,
          {
            category_id: categoryId,
            topic_id: topicId,
            subtopic_id: subtopicId,
          },
        )
        note = created.note
        setWorkspace((current) =>
          current && !current.files.some((file) => file.id === created.file.id)
            ? { ...current, files: [...current.files, created.file] }
            : current,
        )
        setSelectedFileId(created.file.id)
      } else if (selectedFile) {
        note = await createNote(client, selectedFile.id, session.user.id, noteType)
      } else {
        return
      }
      setNotes((current) => [note, ...current])
      setEditingNote(note)
    } catch (error) {
      setActionMessage(errorMessage(error))
    } finally {
      actionLock.current = false
      setBusy(false)
    }
  }

  async function copyExistingNote(source: Note) {
    if (actionLock.current) return
    actionLock.current = true
    setBusy(true)
    setActionMessage('')
    try {
      const note = await copyNote(client, source, session.user.id)
      setNotes((current) => [note, ...current])
      setEditingNote(note)
    } catch (error) {
      setActionMessage(errorMessage(error))
    } finally {
      actionLock.current = false
      setBusy(false)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || deleteLock.current) return
    deleteLock.current = true
    setDeleteBusy(true)
    setDeleteError('')
    try {
      await deleteNote(client, deleteTarget.id)
      removeCachedDraft(
        getDraftStorage(),
        session.user.id,
        deleteTarget.id,
      )
      setNotes((current) =>
        current.filter((note) => note.id !== deleteTarget.id),
      )
      if (editingNote?.id === deleteTarget.id) setEditingNote(null)
      setDeleteTarget(null)
    } catch (error) {
      setDeleteError(errorMessage(error))
    } finally {
      deleteLock.current = false
      setDeleteBusy(false)
    }
  }

  const updateNoteInListCallback = useCallback((updated: Note) => {
    setNotes((current) =>
      current.map((note) => (note.id === updated.id ? updated : note)),
    )
    setEditingNote((current) =>
      current?.id === updated.id ? updated : current,
    )
  }, [setEditingNote, setNotes])

  function leaveWorkspace() {
    const storage = getDraftStorage()
    const hasRecoveryDraft = notes.some((note) =>
      readCachedDraft(storage, session.user.id, note.id),
    )
    if (hasRecoveryDraft) {
      const leave = window.confirm(
        'Some notes have local recovery drafts that may not be saved to the cloud. Leave the notes workspace?',
      )
      if (!leave) return
    }
    navigate('/')
  }

  function chooseFile(fileId: string) {
    setNotes([])
    setEditingNote(null)
    setNotesError('')
    setActionMessage('')
    setDeleteTarget(null)
    setDeleteError('')
    setSelectedFileId(fileId)
    setNotesLoading(Boolean(fileId))
  }

  return (
    <main className="main-content notes-page">
      <div className="notes-page-header">
        {!editingNote ? (
          <button
            className="back-link back-link--inline"
            type="button"
            onClick={leaveWorkspace}
          >
            <span aria-hidden="true">←</span> Home
          </button>
        ) : null}
        <p className="eyebrow">YOUR NOTES WORKSPACE</p>
        <h1>{selectedFile?.name ?? 'Notes'}</h1>
        <p className="page-description">
          {selectedCategory?.name} <span aria-hidden="true">/</span>{' '}
          {selectedTopic?.name} <span aria-hidden="true">/</span>{' '}
          {selectedSubtopic?.name}
        </p>
      </div>

      {workspaceLoading ? (
        <p className="state-message" role="status">
          Validating your taxonomy path…
        </p>
      ) : visibleWorkspaceError ? (
        <div className="notice notice--error" role="alert">
          {visibleWorkspaceError}
        </div>
      ) : matchingFiles.length > 1 && !selectedFile ? (
        <section className="panel file-picker-panel">
          <label className="field">
            <span>Select a file collection</span>
            <select
              value={selectedFileId}
              onChange={(event) => chooseFile(event.target.value)}
            >
              <option value="">Choose a file</option>
              {matchingFiles.map((file) => (
                <option key={file.id} value={file.id}>
                  {file.name}
                </option>
              ))}
            </select>
          </label>
        </section>
      ) : selectedFile || matchingFiles.length === 0 ? (
        <>
          {matchingFiles.length > 1 ? (
            <label className="field file-context-select">
              <span>File collection</span>
              <select
                value={selectedFileId}
                onChange={(event) => chooseFile(event.target.value)}
              >
                {matchingFiles.map((file) => (
                  <option key={file.id} value={file.id}>
                    {file.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {notesError ? (
            <div className="notice notice--error" role="alert">
              {notesError}{' '}
              <button
                className="text-button"
                type="button"
                onClick={() => void refreshNotes()}
              >
                Retry
              </button>
            </div>
          ) : null}
          {actionMessage ? (
            <div className="notice notice--error" role="alert">
              {actionMessage}
            </div>
          ) : null}
          {editingNote ? (
            <NoteEditor
              key={editingNote.id}
              client={client}
              session={session}
              note={editingNote}
              onSavedNote={updateNoteInListCallback}
              onClose={(goHome) => {
                if (goHome) navigate('/')
                else setEditingNote(null)
              }}
            />
          ) : (
            <section className="notes-collection" aria-label="Notes in selected Subtopic">
              <div className="notes-collection-heading">
                <div>
                  <p className="eyebrow">{selectedFile ? 'FILE CONTENTS' : 'SUBTOPIC NOTES'}</p>
                  <h2>Notes</h2>
                </div>
                {notesLoading ? (
                  <span className="save-state" role="status">
                    Loading notes…
                  </span>
                ) : null}
              </div>
              {!notesLoading ? (
                <NotesGrid
                  notes={notesForFile(notes, selectedFile?.id ?? null)}
                  search={searchText}
                  setSearch={setSearchText}
                  onOpen={setEditingNote}
                  onCopy={(note) => void copyExistingNote(note)}
                  onDelete={(note) => {
                    setDeleteError('')
                    setDeleteTarget(note)
                  }}
                  onCreate={(type) => {
                    void createWorkingNote(type)
                  }}
                  busy={busy}
                  hasSelectedFile={Boolean(selectedFile)}
                />
              ) : null}
            </section>
          )}</>
      ) : null}

      <DeleteNoteDialog
        note={deleteTarget}
        busy={deleteBusy}
        error={deleteError}
        onCancel={() => {
          if (!deleteBusy) {
            setDeleteTarget(null)
            setDeleteError('')
          }
        }}
        onConfirm={() => void confirmDelete()}
      />
    </main>
  )
}
