import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Clipboard from 'expo-clipboard'
import Constants from 'expo-constants'
import { useEffect, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  Animated,
  ActivityIndicator,
  Modal,
  Pressable,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native'
import {
  router,
  useLocalSearchParams,
  type Href,
} from 'expo-router'
import { useExpoAuth } from '../../src/components/ExpoAuthContext'
import { ExpoScreen } from '../../src/components/ExpoScreen'
import { screenStyles } from '../../src/components/expo-screen-styles'
import { ThemeToggle } from '../../src/components/ThemeProvider'
import { useAppTheme, type ThemeColors } from '../../src/components/ThemeContext'
import { ExpoMarkdownPreview } from '../../src/components/ExpoMarkdownPreview'
import {
  evaluateSqlWithAi,
  resolveExpoBackendBaseUrl,
} from '../../src/lib/note-ai'
import { AutosaveQueue, type SaveState } from '../../src/lib/autosave'
import {
  draftStorageKey,
  appendSqlPracticeToNote,
  copyNoteToFile,
  deleteNote,
  editableFields,
  getNote,
  parseCachedDraft,
  removeMarkedSqlPracticeFromNote,
  saveNote,
  serializeCachedDraft,
  NoteSaveConflictError,
  type CachedDraft,
  type EditableNote,
  type Note,
} from '../../src/lib/notes'
import {
  appendMarkdownToNote,
  getStoredMarkdownBlocks,
  getMarkdownBlockSource,
  removeDuplicateMarkdownFromRoughNotes,
  removeMarkdownBlockFromNote,
  updateMarkdownBlockInNote,
} from '../../src/lib/markdown'
import {
  isValidTaxonomyPath,
  loadWorkspaceData,
  notesRouteForSelection,
  type TaxonomySelection,
  type WorkspaceData,
} from '../../src/lib/phase1'

function one(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : ''
}

const emptyDraft: EditableNote = {
  title: '',
  source_content: '',
  sql_output: null,
  sql_evaluation: null,
  sql_evaluated_source: null,
  markdown_output: null,
  markdown_converted_source: null,
  personal_notes: '',
  note_color: 'lavender',
  is_pinned: false,
}

type NoteRouteParams = {
  noteId?: string | string[]
  categoryId?: string | string[]
  topicId?: string | string[]
  subtopicId?: string | string[]
  mode?: string | string[]
}

export default function NoteEditorScreen() {
  const params = useLocalSearchParams<NoteRouteParams>()
  const noteId = one(params.noteId)
  const routeKey = [
    noteId,
    one(params.categoryId),
    one(params.topicId),
    one(params.subtopicId),
    one(params.mode),
  ].join(':')
  return <NoteEditor key={routeKey} noteId={noteId} params={params} />
}

function NoteEditor({
  noteId,
  params,
}: {
  noteId: string
  params: NoteRouteParams
}) {
  const { client, session, configuration } = useExpoAuth()
  const { colors } = useAppTheme()
  const { height: windowHeight } = useWindowDimensions()
  const noteContentMaxHeight = Math.max(180, Math.min(windowHeight * 0.65, 680))
  const mode = one(params.mode)
  const path: TaxonomySelection = {
    categoryId: one(params.categoryId),
    topicId: one(params.topicId),
    subtopicId: one(params.subtopicId),
  }
  const routeError = !noteId
    ? 'This note link is incomplete. Return to the Notes collection.'
    : ''
  const [note, setNote] = useState<Note | null>(null)
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null)
  const [value, setValue] = useState<EditableNote>(emptyDraft)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [saveError, setSaveError] = useState('')
  const [cacheWarning, setCacheWarning] = useState('')
  const [recoveryDraft, setRecoveryDraft] = useState<CachedDraft | null>(null)
  const [conflict, setConflict] = useState(false)
  const [recoveryAction, setRecoveryAction] = useState<'restore' | 'discard' | null>(null)
  const [sqlOpen, setSqlOpen] = useState(mode === 'sql')
  const [sqlQuestion, setSqlQuestion] = useState('')
  const [sqlDraft, setSqlDraft] = useState('')
  const [sqlResult, setSqlResult] = useState<string | null>(null)
  const [sqlEvaluation, setSqlEvaluation] = useState('')
  const [sqlBusy, setSqlBusy] = useState(false)
  const [sqlError, setSqlError] = useState('')
  const [markdownOpen, setMarkdownOpen] = useState(false)
  const [markdownDraft, setMarkdownDraft] = useState('')
  const [markdownBusy, setMarkdownBusy] = useState(false)
  const [markdownError, setMarkdownError] = useState('')
  const [editingMarkdownBlockId, setEditingMarkdownBlockId] = useState('')
  const [markdownEditDraft, setMarkdownEditDraft] = useState('')
  const [markdownBlockMessage, setMarkdownBlockMessage] = useState('')
  const [collapsedMarkdownBlocks, setCollapsedMarkdownBlocks] = useState<Record<string, boolean>>({})
  const [clearSqlConfirm, setClearSqlConfirm] = useState(false)
  const [copyPickerOpen, setCopyPickerOpen] = useState(false)
  const [copyBusy, setCopyBusy] = useState(false)
  const [copyError, setCopyError] = useState('')
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const queueRef = useRef<AutosaveQueue<EditableNote> | null>(null)
  const cacheWriteRef = useRef<Promise<void>>(Promise.resolve())
  const valueRef = useRef(value)
  const noteRef = useRef<Note | null>(null)
  const saveStateRef = useRef(saveState)
  const mounted = useRef(false)
  const activeEditorNoteId = useRef(noteId)
  const sqlRequestId = useRef(0)
  const sqlBusyLock = useRef(false)
  const markdownBusyLock = useRef(false)
  const pendingMarkdownSave = useRef<{
    source: string
    blockId: string
  } | null>(null)
  const copyBusyLock = useRef(false)
  const deleteBusyLock = useRef(false)
  const restoringDraft = useRef(false)
  const loadedNoteId = note?.id ?? ''
  const ownerId = session?.user.id ?? ''
  const backendBaseUrl = resolveExpoBackendBaseUrl(
    process.env.EXPO_PUBLIC_API_BASE_URL ?? '',
    Platform.OS as 'web' | 'ios' | 'android',
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? window.location.href
      : '',
    Constants.expoConfig?.hostUri ?? '',
  )

  useEffect(() => {
    let active = true
    if (!client || !ownerId || !noteId) {
      return () => {
        active = false
      }
    }
    void Promise.all([getNote(client, noteId, ownerId), loadWorkspaceData(client)])
      .then(async ([loadedNote, data]) => {
        if (!active) return
        const validPath = isValidTaxonomyPath(
          {
            category_id: path.categoryId,
            topic_id: path.topicId,
            subtopic_id: path.subtopicId,
          },
          data,
        )
        const belongsToPath = data.files.some(
          (file) =>
            file.id === loadedNote.file_id &&
            file.category_id === path.categoryId &&
            file.topic_id === path.topicId &&
            file.subtopic_id === path.subtopicId,
        )
        if (loadedNote.owner_id !== ownerId || !validPath || !belongsToPath) {
          setLoadError('This note is unavailable in the selected Subtopic or your account.')
          return
        }
        let cached: CachedDraft | null = null
        try {
          cached = parseCachedDraft(
            await AsyncStorage.getItem(draftStorageKey(ownerId, loadedNote.id)),
          )
        } catch {
          if (active) setCacheWarning('Local recovery storage is unavailable. Cloud editing can continue, but offline draft recovery may not be available.')
        }
        if (!active) return
        const remoteValue = editableFields(loadedNote)
        remoteValue.source_content = removeDuplicateMarkdownFromRoughNotes(
          remoteValue.source_content,
          remoteValue.markdown_converted_source,
        )
        const restoreImmediately = cached?.baseUpdatedAt === loadedNote.updated_at
        const initialValue =
          restoreImmediately && cached ? cached.value : remoteValue
        initialValue.source_content = removeDuplicateMarkdownFromRoughNotes(
          initialValue.source_content,
          initialValue.markdown_converted_source,
        )
        if (activeEditorNoteId.current !== loadedNote.id) return
        noteRef.current = loadedNote
        valueRef.current = initialValue
        setNote(loadedNote)
        setWorkspace(data)
        setValue(initialValue)
        setSaveState(restoreImmediately ? 'unsaved' : 'saved')
        setRecoveryDraft(cached && !restoreImmediately ? cached : null)
        restoringDraft.current = restoreImmediately
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(
            error instanceof Error
              ? error.message
              : 'This note could not be loaded. Check your connection and retry.',
          )
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [
    client,
    configuration.message,
    noteId,
    mode,
    path.categoryId,
    path.subtopicId,
    path.topicId,
    ownerId,
    setLoadError,
    setLoading,
    setNote,
    setRecoveryDraft,
    setSaveState,
    setValue,
    setWorkspace,
  ])

  useEffect(() => {
    if (!loadedNoteId || !client || !ownerId) return
    const queueNoteId = loadedNoteId
    mounted.current = true
    const queue = new AutosaveQueue<EditableNote>(
      valueRef.current,
      async (draft) => {
        const currentNote = noteRef.current
        if (!currentNote) throw new Error('This note is no longer available.')
        let saved: Note
        try {
          saved = await saveNote(
            client,
            currentNote.id,
            currentNote.updated_at,
            draft,
            ownerId,
          )
        } catch (error) {
          if (
            error instanceof NoteSaveConflictError &&
            mounted.current &&
            activeEditorNoteId.current === queueNoteId
          ) {
            setConflict(true)
            setSaveError('This note changed elsewhere. Your local draft is preserved.')
          }
          throw error
        }
        const stillSelected = activeEditorNoteId.current === queueNoteId
        if (stillSelected) {
          noteRef.current = saved
          if (mounted.current) setNote(saved)
        }
        if (
          stillSelected &&
          JSON.stringify(valueRef.current) === JSON.stringify(draft)
        ) {
          try {
            await cacheWriteRef.current
            if (JSON.stringify(valueRef.current) !== JSON.stringify(draft)) return
            await AsyncStorage.removeItem(draftStorageKey(ownerId, saved.id))
          } catch {
            if (mounted.current && activeEditorNoteId.current === queueNoteId) {
              setCacheWarning('The cloud save succeeded, but the local recovery copy could not be cleared.')
            }
          }
        }
      },
      (state) => {
        saveStateRef.current = state
        if (mounted.current) {
          setSaveState(state)
          if (state !== 'failed') setSaveError('')
        }
      },
    )
    queueRef.current = queue
    if (restoringDraft.current) {
      restoringDraft.current = false
      void Promise.resolve().then(() => queue.edit(valueRef.current))
    }
    return () => {
      mounted.current = false
      queue.dispose()
      if (queueRef.current === queue) queueRef.current = null
    }
  }, [client, loadedNoteId, ownerId])

  function edit(patch: Partial<EditableNote>) {
    const next = { ...valueRef.current, ...patch }
    valueRef.current = next
    setValue(next)
    const currentNote = noteRef.current
    if (!currentNote || !session) return
    setSaveError('')
    setCacheWarning('')
    cacheWriteRef.current = cacheWriteRef.current.then(() =>
      AsyncStorage.setItem(
        draftStorageKey(session.user.id, currentNote.id),
        serializeCachedDraft({
          baseUpdatedAt: currentNote.updated_at,
          value: next,
        }),
      ),
    ).catch(() => {
      if (mounted.current) {
        setCacheWarning('Local recovery storage is unavailable. Keep this editor open until the cloud save completes.')
      }
    })
    queueRef.current?.edit(next)
  }

  async function leaveEditor() {
    if (markdownBusyLock.current) {
      setMarkdownError('Wait for Markdown saving to finish before leaving. Your input is preserved.')
      return
    }
    await queueRef.current?.flush()
    if (saveStateRef.current === 'saved') {
      router.back()
      return
    }
    setSaveError(
      conflict
        ? 'Resolve the version conflict or keep this draft here. Its local recovery copy is retained.'
        : 'The draft is not saved yet. Retry the cloud save before leaving; a local recovery copy is kept when storage is available.',
    )
  }

  async function retrySave() {
    if (conflict) {
      setSaveError('Reload the latest version before retrying a conflicting save.')
      return
    }
    await queueRef.current?.retry()
  }

  async function reloadLatestVersion() {
    if (!client || !session || !noteRef.current) return
    try {
      await cacheWriteRef.current
      const latest = await getNote(client, noteRef.current.id, session.user.id)
      const cached = {
        baseUpdatedAt: noteRef.current.updated_at,
        value: valueRef.current,
      }
      await AsyncStorage.setItem(
        draftStorageKey(session.user.id, latest.id),
        serializeCachedDraft(cached),
      )
      noteRef.current = latest
      valueRef.current = editableFields(latest)
      setNote(latest)
      setValue(editableFields(latest))
      setRecoveryDraft({ ...cached, baseUpdatedAt: latest.updated_at })
      setConflict(false)
      setSaveError('')
      setSaveState('saved')
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : 'The latest version could not be loaded. Your draft is still preserved.',
      )
    }
  }

  function restoreDraft() {
    if (recoveryDraft) setRecoveryAction('restore')
  }

  function discardDraft() {
    if (session && note) setRecoveryAction('discard')
  }

  async function confirmRecoveryAction() {
    if (!recoveryAction || !session || !note) return
    if (recoveryAction === 'restore' && recoveryDraft) {
      setRecoveryDraft(null)
      setRecoveryAction(null)
      edit(recoveryDraft.value)
      return
    }
    try {
      await cacheWriteRef.current
      await AsyncStorage.removeItem(draftStorageKey(session.user.id, note.id))
    } catch {
      setCacheWarning('The recovery copy could not be removed from this device.')
    }
    setRecoveryDraft(null)
    setRecoveryAction(null)
    router.back()
  }

  function openMarkdownEditor() {
    if (markdownOpen || markdownBusyLock.current) return
    if (editingMarkdownBlockId) {
      setMarkdownBlockMessage('Save or cancel the current Markdown block edit first.')
      return
    }
    setMarkdownDraft('')
    setMarkdownError('')
    setMarkdownOpen(true)
  }

  function cancelMarkdownEditor() {
    if (markdownBusyLock.current) return
    setMarkdownOpen(false)
    setMarkdownDraft('')
    setMarkdownError('')
  }

  async function acceptSavedMarkdownNote(saved: Note) {
    const savedValue = editableFields(saved)
    savedValue.source_content = removeDuplicateMarkdownFromRoughNotes(
      savedValue.source_content,
      savedValue.markdown_converted_source,
    )
    noteRef.current = saved
    valueRef.current = savedValue
    setNote(saved)
    setValue(savedValue)
    saveStateRef.current = 'saved'
    setSaveState('saved')
    setSaveError('')
    if (session) {
      try {
        await cacheWriteRef.current
        await AsyncStorage.removeItem(draftStorageKey(session.user.id, saved.id))
      } catch {
        setCacheWarning('The cloud save succeeded, but the local recovery copy could not be cleared.')
      }
    }
  }

  async function saveMarkdownValue(
    currentNote: Note,
    next: EditableNote,
  ): Promise<Note> {
    if (!client || !session) throw new Error('Your sign-in session is unavailable. Reload and retry.')
    saveStateRef.current = 'saving'
    setSaveState('saving')
    setSaveError('')
    try {
      const saved = await saveNote(
        client,
        currentNote.id,
        currentNote.updated_at,
        next,
        session.user.id,
      )
      await acceptSavedMarkdownNote(saved)
      return saved
    } catch (error) {
      if (error instanceof NoteSaveConflictError) {
        saveStateRef.current = 'failed'
        setSaveState('failed')
        setConflict(true)
        setSaveError('This note changed elsewhere. Reload the latest version before retrying.')
      } else {
        saveStateRef.current = 'saved'
        setSaveState('saved')
      }
      throw error
    }
  }

  async function convertMarkdown() {
    if (markdownBusyLock.current) return
    if (sqlBusyLock.current) {
      setMarkdownError('Wait for SQL evaluation to finish before converting Markdown.')
      return
    }
    const input = markdownDraft
    if (!input.trim()) {
      setMarkdownError('Enter Markdown content before saving.')
      return
    }
    if (!client || !session || !noteRef.current) {
      setMarkdownError('Your note or sign-in session is unavailable. Reload and retry.')
      return
    }
    const queue = queueRef.current
    if (!queue) {
      setMarkdownError('The note save service is unavailable. Reload and retry.')
      return
    }
    markdownBusyLock.current = true
    setMarkdownBusy(true)
    setMarkdownError('')
    try {
      await queue.flush()
      let currentNote = noteRef.current
      if (!currentNote) {
        throw new Error('This note is no longer available. Reload and retry.')
      }
      const pending = pendingMarkdownSave.current
      if (saveStateRef.current !== 'saved' && !pending) {
        throw new Error('The current note could not be saved. Your Markdown is preserved; retry.')
      }
      if (pending) {
        currentNote = await getNote(client, currentNote.id, session.user.id)
        await acceptSavedMarkdownNote(currentNote)
        if (getStoredMarkdownBlocks(currentNote.markdown_output).some(
          (block) => block.id === pending.blockId,
        )) {
          pendingMarkdownSave.current = null
          if (pending.source === input) {
            setMarkdownOpen(false)
            setMarkdownDraft('')
            return
          }
        } else {
          pendingMarkdownSave.current = null
        }
      }
      const current = valueRef.current
      const appended = appendMarkdownToNote(current, input)
      const { block, ...markdownFields } = appended
      const next: EditableNote = {
        ...current,
        source_content: removeDuplicateMarkdownFromRoughNotes(
          current.source_content,
          current.markdown_converted_source,
        ),
        ...markdownFields,
      }
      pendingMarkdownSave.current = { source: input, blockId: block.id }
      await saveMarkdownValue(currentNote, next)
      pendingMarkdownSave.current = null
      setMarkdownOpen(false)
      setMarkdownDraft('')
    } catch (error) {
      setMarkdownError(
        error instanceof Error
          ? error.message
          : 'Markdown could not be saved. Your input is preserved; retry.',
      )
    } finally {
      markdownBusyLock.current = false
      setMarkdownBusy(false)
    }
  }

  async function deleteMarkdownBlock(blockId: string) {
    if (markdownBusyLock.current || !client || !session || !noteRef.current) return
    if (sqlBusyLock.current) {
      setSaveError('Wait for SQL evaluation to finish before deleting a Markdown block.')
      return
    }
    markdownBusyLock.current = true
    setMarkdownBusy(true)
    setSaveError('')
    try {
      await queueRef.current?.flush()
      if (saveStateRef.current !== 'saved') {
        throw new Error('The current note could not be saved. Retry before deleting a Markdown block.')
      }
      const currentNote = await getNote(
        client,
        noteRef.current.id,
        session.user.id,
      )
      const blocks = getStoredMarkdownBlocks(currentNote.markdown_output)
      if (!blocks.some((block) => block.id === blockId)) {
        await acceptSavedMarkdownNote(currentNote)
        setCollapsedMarkdownBlocks((current) => {
          const next = { ...current }
          delete next[blockId]
          return next
        })
        return
      }
      const current = editableFields(currentNote)
      current.source_content = removeDuplicateMarkdownFromRoughNotes(
        current.source_content,
        current.markdown_converted_source,
      )
      const next: EditableNote = {
        ...current,
        ...removeMarkdownBlockFromNote(current, blockId),
      }
      await saveMarkdownValue(currentNote, next)
      setCollapsedMarkdownBlocks((current) => {
        const next = { ...current }
        delete next[blockId]
        return next
      })
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : 'The Markdown block could not be deleted. It remains available; retry.',
      )
    } finally {
      markdownBusyLock.current = false
      setMarkdownBusy(false)
    }
  }

  function editMarkdownBlock(block: { id: string; source: string }) {
    if (markdownBusyLock.current) return
    if (editingMarkdownBlockId && editingMarkdownBlockId !== block.id) {
      setMarkdownBlockMessage('Save or cancel the current Markdown block edit first.')
      return
    }
    setCollapsedMarkdownBlocks((current) => ({ ...current, [block.id]: false }))
    setMarkdownBlockMessage('')
    setEditingMarkdownBlockId(block.id)
    setMarkdownEditDraft(block.source)
  }

  async function saveMarkdownBlockEdit(blockId: string) {
    if (markdownBusyLock.current || sqlBusyLock.current || !client || !session || !noteRef.current) return
    if (!markdownEditDraft.trim()) {
      setMarkdownBlockMessage('Enter Markdown content before saving.')
      return
    }
    markdownBusyLock.current = true
    setMarkdownBusy(true)
    setMarkdownBlockMessage('')
    try {
      await queueRef.current?.flush()
      if (saveStateRef.current !== 'saved') {
        throw new Error('Save the current note before editing this Markdown block.')
      }
      const currentNote = await getNote(client, noteRef.current.id, session.user.id)
      const current = editableFields(currentNote)
      current.source_content = removeDuplicateMarkdownFromRoughNotes(
        current.source_content,
        current.markdown_converted_source,
      )
      const next = {
        ...current,
        ...updateMarkdownBlockInNote(current, blockId, markdownEditDraft),
      }
      await saveMarkdownValue(currentNote, next)
      setEditingMarkdownBlockId('')
      setMarkdownEditDraft('')
      setMarkdownBlockMessage('Markdown block updated.')
    } catch (error) {
      setMarkdownBlockMessage(
        error instanceof Error
          ? error.message
          : 'This Markdown block could not be saved. Your changes are preserved; retry.',
      )
    } finally {
      markdownBusyLock.current = false
      setMarkdownBusy(false)
    }
  }

  async function copyMarkdownBlock(blockId: string) {
    setMarkdownBlockMessage('')
    try {
      const source = getMarkdownBlockSource(
        valueRef.current.markdown_output,
        blockId,
      )
      const copied = await Clipboard.setStringAsync(source)
      if (!copied) throw new Error('Clipboard access was unavailable.')
      setMarkdownBlockMessage('Markdown source copied.')
    } catch {
      setMarkdownBlockMessage('Could not copy Markdown source to the clipboard.')
    }
  }

  function requestClearSql() {
    if (markdownBusyLock.current) return
    const hasWork = Boolean(
      sqlQuestion.trim() ||
      sqlDraft.trim() ||
      sqlResult ||
      sqlEvaluation ||
      valueRef.current.sql_output ||
      valueRef.current.sql_evaluation
    )
    if (hasWork) setClearSqlConfirm(true)
    else clearSqlContent()
  }

  function clearSqlContent() {
    if (markdownBusyLock.current) return
    sqlRequestId.current += 1
    sqlBusyLock.current = false
    setSqlQuestion('')
    setSqlDraft('')
    setSqlResult(null)
    setSqlEvaluation('')
    setSqlError('')
    setSqlBusy(false)
    setClearSqlConfirm(false)
    edit({
      source_content: removeMarkedSqlPracticeFromNote(
        valueRef.current.source_content,
        {
          sql: valueRef.current.sql_evaluated_source,
          output: valueRef.current.sql_output,
          evaluation: valueRef.current.sql_evaluation,
        },
      ),
      sql_output: null,
      sql_evaluation: null,
      sql_evaluated_source: null,
    })
  }

  async function submitSqlEvaluation() {
    if (sqlBusyLock.current) return
    if (markdownBusyLock.current) return
    if (!session) {
      setSqlError('Your sign-in session has expired. Sign in again and retry.')
      return
    }
    if (!sqlQuestion.trim()) {
      setSqlError('Enter a practice question before requesting an evaluation.')
      return
    }
    if (!sqlDraft.trim()) {
      setSqlError('Enter a SQL query before requesting an evaluation.')
      return
    }
    console.info('[notes-ai] button clicked operation=sql-evaluation')
    const query = sqlDraft
    const question = sqlQuestion
    const requestId = ++sqlRequestId.current
    const selectedNoteId = noteId
    sqlBusyLock.current = true
    setSqlBusy(true)
    setSqlError('')
    try {
      const evaluated = await evaluateSqlWithAi(
        {
          question,
          sql: query,
          accessToken: session.access_token,
        },
        { baseUrl: backendBaseUrl },
      )
      if (
        requestId !== sqlRequestId.current ||
        activeEditorNoteId.current !== selectedNoteId
      ) return
      setSqlResult(evaluated.output)
      setSqlEvaluation(evaluated.evaluation)
      console.info('[notes-ai] result displayed operation=sql-evaluation')
    } catch (error) {
      if (
        requestId === sqlRequestId.current &&
        activeEditorNoteId.current === selectedNoteId
      ) {
        setSqlError(
          error instanceof Error ? error.message : 'SQL practice could not complete. Retry.',
        )
      }
    } finally {
      if (
        requestId === sqlRequestId.current &&
        activeEditorNoteId.current === selectedNoteId
      ) {
        sqlBusyLock.current = false
        setSqlBusy(false)
      }
    }
  }

  async function copyToFile(destinationFileId: string) {
    if (!client || !session || !workspace || !noteRef.current || copyBusyLock.current) return
    if (conflict || recoveryDraft) {
      setCopyError('Resolve or discard the local recovery draft before copying.')
      return
    }
    if (sqlBusyLock.current || markdownBusyLock.current) {
      setCopyError('Wait for the current SQL or Markdown request to finish before copying.')
      return
    }
    const destination = workspace.files.find((file) => file.id === destinationFileId)
    if (!destination) {
      setSaveError('Choose a valid destination file in your account.')
      return
    }
    copyBusyLock.current = true
    setCopyBusy(true)
    setCopyError('')
    try {
      await queueRef.current?.flush()
      if (saveStateRef.current !== 'saved') {
        setCopyError('Save the current note before copying it. Your edits are preserved.')
        return
      }
      const copied = await copyNoteToFile(
        client,
        noteRef.current,
        destination.id,
        session.user.id,
      )
      const route = notesRouteForSelection({
        categoryId: destination.category_id,
        topicId: destination.topic_id,
        subtopicId: destination.subtopic_id,
      })
      setCopyPickerOpen(false)
      router.replace(`${route}&copied=${encodeURIComponent(copied.title)}` as Href)
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : 'The note could not be copied. Retry.')
    } finally {
      copyBusyLock.current = false
      setCopyBusy(false)
    }
  }

  async function confirmDeleteNote() {
    if (!client || !session || !noteRef.current || deleteBusyLock.current) return
    if (markdownBusyLock.current) {
      setMarkdownError('Wait for Markdown saving to finish before deleting this note.')
      setDeleteConfirmOpen(false)
      return
    }
    deleteBusyLock.current = true
    setDeleteBusy(true)
    try {
      sqlRequestId.current += 1
      sqlBusyLock.current = false
      setSqlBusy(false)
      await queueRef.current?.flush()
      await deleteNote(client, noteRef.current.id, session.user.id)
      router.replace(`${notesRouteForSelection(path)}&deleted=1` as Href)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'The note could not be deleted. Retry.')
      setDeleteConfirmOpen(false)
    } finally {
      deleteBusyLock.current = false
      setDeleteBusy(false)
    }
  }

  function insertSqlResult() {
    if (!sqlResult || !sqlEvaluation || markdownBusyLock.current) return
    edit({
      source_content: appendSqlPracticeToNote(valueRef.current.source_content, {
        question: sqlQuestion,
        sql: sqlDraft,
        output: sqlResult,
        evaluation: sqlEvaluation,
      }),
      sql_output: sqlResult,
      sql_evaluation: sqlEvaluation,
      sql_evaluated_source: sqlDraft,
    })
    setSqlOpen(false)
  }

  const markdownBlockMessageIsError =
    markdownBlockMessage.includes('could not') ||
    markdownBlockMessage.includes('Could not') ||
    markdownBlockMessage.includes('before saving') ||
    markdownBlockMessage.includes('Save or cancel') ||
    markdownBlockMessage.includes('Save the current note')

  return (
    <ExpoScreen scroll>
      <View style={[styles.page, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" onPress={() => void leaveEditor()} style={screenStyles.secondaryButton}>
            <Text style={[screenStyles.secondaryText, { color: colors.accentText }]}>‹ All notes</Text>
          </Pressable>
          <View style={styles.headerActions}>
            {note ? (
              <>
                <IconAction label="SQL" glyph="SQL" colors={colors} selected={sqlOpen} onPress={() => { if (markdownBusyLock.current) return; setSqlOpen((open) => !open); setMarkdownOpen(false) }} />
                <IconAction label="Markdown" glyph="M↓" colors={colors} selected={markdownOpen} onPress={openMarkdownEditor} />
                <IconAction label="Copy Note" glyph="▢" colors={colors} onPress={() => { setCopyError(''); setCopyPickerOpen(true) }} />
                <IconAction label="Delete Note" glyph="🗑" colors={colors} danger onPress={() => setDeleteConfirmOpen(true)} />
              </>
            ) : null}
            <ThemeToggle />
            <SaveIndicator state={saveState} onRetry={() => void retrySave()} disabled={conflict || Boolean(recoveryDraft)} colors={colors} />
          </View>
        </View>
        {!client || !session ? (
          <Text accessibilityRole="alert" style={[screenStyles.notice, styles.error, { backgroundColor: colors.errorBackground, color: colors.errorText }]}>{configuration.message}</Text>
        ) : routeError ? (
          <>
            <Text accessibilityRole="alert" style={[screenStyles.notice, styles.error, { backgroundColor: colors.errorBackground, color: colors.errorText }]}>{routeError}</Text>
            <Pressable accessibilityRole="link" onPress={() => router.replace('/home' as Href)}><Text style={screenStyles.secondaryText}>Return Home</Text></Pressable>
          </>
        ) : loading || (note && note.id !== noteId) ? (
          <View style={styles.status}><ActivityIndicator color={colors.accent} /><Text style={[screenStyles.body, { color: colors.mutedText }]}>Loading note…</Text></View>
        ) : loadError ? (
          <>
            <Text accessibilityRole="alert" style={[screenStyles.notice, styles.error, { backgroundColor: colors.errorBackground, color: colors.errorText }]}>{loadError}</Text>
            <Pressable accessibilityRole="link" onPress={() => router.replace('/home' as Href)}><Text style={screenStyles.secondaryText}>Return Home</Text></Pressable>
          </>
        ) : !note || !workspace ? (
          <Text accessibilityRole="alert" style={[screenStyles.notice, styles.error, { backgroundColor: colors.errorBackground, color: colors.errorText }]}>{configuration.message}</Text>
        ) : (
          <>
          <View style={styles.editorHeader}>
            <Text style={screenStyles.eyebrow}>FULL-PAGE NOTE EDITOR</Text>
            <Text style={[screenStyles.body, { color: colors.mutedText }]}>
              {workspace.categories.find((item) => item.id === path.categoryId)?.name} /{' '}
              {workspace.topics.find((item) => item.id === path.topicId)?.name} /{' '}
              {workspace.subtopics.find((item) => item.id === path.subtopicId)?.name}
            </Text>
            {saveError ? <Text accessibilityRole="alert" style={[screenStyles.notice, styles.error, { backgroundColor: colors.errorBackground, color: colors.errorText }]}>{saveError}</Text> : null}
            {markdownBlockMessage ? <Text accessibilityLiveRegion="polite" accessibilityRole={markdownBlockMessageIsError ? 'alert' : undefined} style={[screenStyles.notice, markdownBlockMessageIsError ? styles.error : screenStyles.infoNotice, { backgroundColor: markdownBlockMessageIsError ? colors.errorBackground : colors.infoBackground, color: markdownBlockMessageIsError ? colors.errorText : colors.infoText }]}>{markdownBlockMessage}</Text> : null}
            {cacheWarning ? <Text accessibilityLiveRegion="polite" style={[screenStyles.notice, screenStyles.infoNotice, { backgroundColor: colors.infoBackground, color: colors.infoText }]}>{cacheWarning}</Text> : null}
          {recoveryDraft ? (
              <View style={[screenStyles.notice, styles.recovery, { backgroundColor: colors.infoBackground }]}>
                <Text style={[styles.recoveryText, { color: colors.infoText }]}>A local draft differs from the saved version. You can restore it after refreshing the latest version check, or keep the cloud version.</Text>
                <View style={styles.recoveryActions}>
                  <Pressable accessibilityRole="button" onPress={restoreDraft}><Text style={screenStyles.secondaryText}>Restore draft</Text></Pressable>
                  <Pressable accessibilityRole="button" onPress={discardDraft}><Text style={screenStyles.secondaryText}>Discard draft</Text></Pressable>
                </View>
              </View>
            ) : null}
            {conflict ? (
              <View style={[screenStyles.notice, styles.recovery, { backgroundColor: colors.infoBackground }]}>
                <Text style={[styles.recoveryText, { color: colors.infoText }]}>Your draft is preserved locally. Reloading fetches the latest cloud version; you can then explicitly choose to restore your draft.</Text>
                <Pressable accessibilityRole="button" onPress={() => void reloadLatestVersion()}><Text style={screenStyles.secondaryText}>Reload latest version</Text></Pressable>
              </View>
            ) : null}
            <View style={styles.field}>
              <Text nativeID="note-title-label" style={[screenStyles.fieldLabel, { color: colors.text }]}>Note title</Text>
              <TextInput
                accessibilityLabel="Note title"
                accessibilityLabelledBy="note-title-label"
                editable={!markdownBusy}
                maxLength={200}
                onChangeText={(title) => edit({ title })}
                placeholder="Untitled note"
                returnKeyType="next"
                style={[styles.titleInput, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]}
                value={value.title}
              />
            </View>
            </View>
            <ScrollView
              nativeID="note-editor-content-scroll"
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              style={[styles.noteContentScroll, { maxHeight: noteContentMaxHeight }]}
              contentContainerStyle={styles.noteContentScrollContent}
            >
            {getStoredMarkdownBlocks(value.markdown_output).map((block, index) => (
              <View key={block.id} style={[styles.markdownResult, { backgroundColor: colors.blueBackground, borderColor: colors.blueBorder }]}>
                <View style={styles.markdownBlockActions}>
                  <MarkdownBlockToggle
                    blockNumber={index + 1}
                    collapsed={Boolean(collapsedMarkdownBlocks[block.id])}
                    disabled={markdownBusy}
                    onToggle={() => setCollapsedMarkdownBlocks((current) => ({
                      ...current,
                      [block.id]: !current[block.id],
                    }))}
                    colors={colors}
                  />
                  <Pressable
                    accessibilityLabel={`Copy Markdown block ${index + 1}`}
                    accessibilityRole="button"
                    disabled={markdownBusy}
                    onPress={() => void copyMarkdownBlock(block.id)}
                    style={[styles.markdownIconAction, markdownBusy && screenStyles.buttonDisabled]}
                  >
                    <Text style={[styles.markdownActionGlyph, { color: colors.accentText }]}>⧉</Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={`Delete Markdown block ${index + 1}`}
                    accessibilityRole="button"
                    disabled={markdownBusy}
                    onPress={() => void deleteMarkdownBlock(block.id)}
                    style={[styles.markdownIconAction, markdownBusy && screenStyles.buttonDisabled]}
                  >
                    <Text style={[styles.markdownActionGlyph, { color: colors.errorText }]}>×</Text>
                  </Pressable>
                </View>
                {editingMarkdownBlockId === block.id ? (
                  <>
                    <TextInput
                      accessibilityLabel={`Edit Markdown block ${index + 1}`}
                      editable={!markdownBusy}
                      multiline
                      onChangeText={(text) => {
                        setMarkdownEditDraft(text)
                        setMarkdownBlockMessage('')
                      }}
                      placeholder="Edit Markdown source"
                      style={[styles.markdownInlineEditor, { backgroundColor: colors.input, borderColor: colors.blueBorder, color: colors.text }]}
                      textAlignVertical="top"
                      value={markdownEditDraft}
                    />
                    <View style={styles.sqlActions}>
                      <Pressable accessibilityRole="button" disabled={markdownBusy} onPress={() => void saveMarkdownBlockEdit(block.id)} style={[screenStyles.button, markdownBusy && screenStyles.buttonDisabled]}>
                        <Text style={screenStyles.buttonText}>{markdownBusy ? 'Saving…' : 'Save'}</Text>
                      </Pressable>
                      <Pressable accessibilityRole="button" disabled={markdownBusy} onPress={() => { setEditingMarkdownBlockId(''); setMarkdownEditDraft(''); setMarkdownBlockMessage('') }} style={[screenStyles.secondaryButton, markdownBusy && screenStyles.buttonDisabled]}>
                        <Text style={screenStyles.secondaryText}>Cancel</Text>
                      </Pressable>
                    </View>
                  </>
                ) : (
                  <Pressable
                    accessibilityLabel={`Edit Markdown block ${index + 1}`}
                    accessibilityRole="button"
                    disabled={markdownBusy}
                    onPress={() => editMarkdownBlock(block)}
                    style={styles.markdownContentPressable}
                  >
                    <AnimatedMarkdownBody
                      source={block.source}
                      collapsed={Boolean(collapsedMarkdownBlocks[block.id])}
                    />
                  </Pressable>
                )}
              </View>
            ))}
            {markdownOpen ? (
              <View style={[styles.sqlPanel, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
                <Text accessibilityRole="header" style={[screenStyles.fieldLabel, { color: colors.text }]}>Add Markdown</Text>
                <TextInput
                  accessibilityLabel="Markdown input"
                  editable={!markdownBusy}
                  multiline
                  onChangeText={(text) => { setMarkdownDraft(text); setMarkdownError('') }}
                  placeholder="# Paste or write Markdown"
                  style={[styles.sqlInput, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]}
                  value={markdownDraft}
                />
                {markdownError ? <Text accessibilityRole="alert" style={[screenStyles.notice, styles.error, { backgroundColor: colors.errorBackground, color: colors.errorText }]}>{markdownError}</Text> : null}
                <View style={styles.sqlActions}>
                  <Pressable accessibilityRole="button" disabled={markdownBusy} onPress={() => void convertMarkdown()} style={[screenStyles.button, markdownBusy && screenStyles.buttonDisabled]}>
                    <Text style={screenStyles.buttonText}>{markdownBusy ? 'Saving…' : 'Convert Notes'}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" disabled={markdownBusy} onPress={cancelMarkdownEditor} style={[screenStyles.secondaryButton, markdownBusy && screenStyles.buttonDisabled]}>
                    <Text style={screenStyles.secondaryText}>Cancel</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
            <View style={styles.field}>
              <Text nativeID="note-content-label" style={[screenStyles.fieldLabel, { color: colors.text }]}>Note content</Text>
              <TextInput
                accessibilityLabel="Note content"
                accessibilityLabelledBy="note-content-label"
                editable={!markdownBusy}
                multiline
                onChangeText={(source_content) => edit({ source_content })}
                placeholder="Write a note…"
                scrollEnabled
                style={[styles.contentInput, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]}
                textAlignVertical="top"
                value={value.source_content}
              />
            </View>
            </ScrollView>
            {sqlOpen ? (
              <View style={[styles.sqlPanel, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
                <Text accessibilityRole="header" style={[screenStyles.fieldLabel, { color: colors.text }]}>Question</Text>
                <TextInput
                  accessibilityLabel="SQL practice question"
                  editable={!sqlBusy}
                  multiline
                  onChangeText={(question) => {
                    sqlRequestId.current += 1
                    setSqlQuestion(question)
                    setSqlResult(null)
                    setSqlEvaluation('')
                    setSqlError('')
                  }}
                  placeholder="Describe the SQL task you want reviewed."
                  style={[styles.sqlQuestion, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]}
                  value={sqlQuestion}
                />
                <Text style={[screenStyles.fieldLabel, { color: colors.text }]}>SQL editor</Text>
                <TextInput
                  accessibilityLabel="SQL practice query"
                  multiline
                  editable={!sqlBusy}
                  onChangeText={(query) => {
                    sqlRequestId.current += 1
                    setSqlDraft(query)
                    setSqlResult(null)
                    setSqlEvaluation('')
                    setSqlError('')
                  }}
                  placeholder="SELECT name, salary FROM employees WHERE salary >= 65000 ORDER BY salary DESC;"
                  style={[styles.sqlInput, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]}
                  value={sqlDraft}
                />
                {sqlError ? <Text accessibilityRole="alert" style={[screenStyles.notice, styles.error, { backgroundColor: colors.errorBackground, color: colors.errorText }]}>{sqlError}</Text> : null}
                <View style={styles.sqlActions}>
                  <Pressable accessibilityRole="button" disabled={sqlBusy || !backendBaseUrl} onPress={() => void submitSqlEvaluation()} style={[screenStyles.button, (sqlBusy || !backendBaseUrl) && screenStyles.buttonDisabled]}>
                    <Text style={screenStyles.buttonText}>{sqlBusy ? 'Evaluating with AI…' : 'Evaluate with AI'}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={() => setSqlOpen(false)} style={screenStyles.secondaryButton}>
                    <Text style={[screenStyles.secondaryText, { color: colors.accentText }]}>Close</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" disabled={!sqlResult || !sqlEvaluation || saveState === 'saving' || sqlBusy} onPress={insertSqlResult} style={[screenStyles.secondaryButton, (!sqlResult || !sqlEvaluation || saveState === 'saving' || sqlBusy) && screenStyles.buttonDisabled]}>
                    <Text style={screenStyles.secondaryText}>Insert into Note</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" disabled={sqlBusy} onPress={requestClearSql} style={[screenStyles.secondaryButton, sqlBusy && screenStyles.buttonDisabled]}>
                    <Text style={[screenStyles.secondaryText, { color: colors.errorText }]}>Delete SQL Content</Text>
                  </Pressable>
                </View>
                {!backendBaseUrl ? <Text accessibilityRole="alert" style={[styles.errorText, { color: colors.errorText }]}>Set EXPO_PUBLIC_API_BASE_URL or open Expo Go on the same LAN as the backend.</Text> : null}
                <View style={[styles.sqlResult, { backgroundColor: colors.surfaceMuted }]}>
                  <Text style={[screenStyles.fieldLabel, { color: colors.text }]}>Illustrative output</Text>
                  {sqlBusy && !sqlResult ? <Text style={[screenStyles.body, { color: colors.mutedText }]}>Waiting for AI evaluation…</Text> : null}
                  {sqlResult ? <Text selectable style={[styles.resultCode, { color: colors.text }]}>{sqlResult}</Text> : null}
                  {!sqlBusy && !sqlResult && !sqlError ? <Text style={[screenStyles.body, { color: colors.mutedText }]}>AI-generated illustrative output appears here. Your SQL is never executed.</Text> : null}
                </View>
                <View style={[styles.sqlResult, { backgroundColor: colors.surfaceMuted }]}>
                  <Text style={[screenStyles.fieldLabel, { color: colors.text }]}>Gemini AI evaluation</Text>
                  {sqlBusy && !sqlEvaluation ? <Text style={[screenStyles.body, { color: colors.mutedText }]}>Reviewing your SQL…</Text> : null}
                  {sqlEvaluation ? <Text style={[screenStyles.body, { color: colors.text }]}>{sqlEvaluation}</Text> : null}
                  {!sqlBusy && !sqlEvaluation && !sqlError ? <Text style={[screenStyles.body, { color: colors.mutedText }]}>Evaluation appears after a successful AI response.</Text> : null}
                </View>
              </View>
            ) : null}
            <Pressable accessibilityRole="button" onPress={() => void leaveEditor()} style={screenStyles.button}>
              <Text style={screenStyles.buttonText}>Back to Notes</Text>
            </Pressable>
          </>
        )}
      </View>
      <Modal
        transparent
        visible={Boolean(recoveryAction)}
        animationType="fade"
        onRequestClose={() => setRecoveryAction(null)}
      >
        <View style={styles.overlay}>
          <View style={[styles.confirmCard, { backgroundColor: colors.surface }]}>
            <Text accessibilityRole="header" style={[styles.confirmTitle, { color: colors.text }]}>
              {recoveryAction === 'restore' ? 'Restore local draft?' : 'Discard local draft?'}
            </Text>
            <Text style={[screenStyles.body, { color: colors.mutedText }]}>
              {recoveryAction === 'restore'
                ? 'This saves the recovered draft over the loaded version only if it has not changed again.'
                : 'Keep the saved cloud version and remove this recovery draft from the device?'}
            </Text>
            <View style={styles.confirmActions}>
              <Pressable accessibilityRole="button" onPress={() => setRecoveryAction(null)} style={screenStyles.secondaryButton}>
                <Text style={[screenStyles.secondaryText, { color: colors.accentText }]}>Cancel</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => void confirmRecoveryAction()} style={screenStyles.button}>
                <Text style={screenStyles.buttonText}>{recoveryAction === 'restore' ? 'Restore draft' : 'Discard draft'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        transparent
        visible={clearSqlConfirm}
        animationType="fade"
        onRequestClose={() => setClearSqlConfirm(false)}
      >
        <View style={styles.overlay}>
          <View style={[styles.confirmCard, { backgroundColor: colors.surface }]}>
            <Text accessibilityRole="header" style={[styles.confirmTitle, { color: colors.text }]}>Delete SQL practice content?</Text>
            <Text style={[screenStyles.body, { color: colors.mutedText }]}>
              This clears the SQL question, query, results, evaluation, and marked SQL practice blocks only. Your note title and other content remain.
            </Text>
            <View style={styles.confirmActions}>
              <Pressable accessibilityRole="button" onPress={() => setClearSqlConfirm(false)} style={screenStyles.secondaryButton}>
                <Text style={[screenStyles.secondaryText, { color: colors.accentText }]}>Cancel</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={clearSqlContent} style={screenStyles.button}>
                <Text style={screenStyles.buttonText}>Delete SQL Content</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        transparent
        visible={copyPickerOpen}
        animationType="fade"
        onRequestClose={() => !copyBusy && setCopyPickerOpen(false)}
      >
        <View style={styles.overlay}>
          <View style={[styles.confirmCard, { backgroundColor: colors.surface }]}>
            <Text accessibilityRole="header" style={[styles.confirmTitle, { color: colors.text }]}>Copy note to file</Text>
            <Text style={[screenStyles.body, { color: colors.mutedText }]}>Choose one of your files. The original note stays unchanged.</Text>
            {copyError ? <Text accessibilityRole="alert" style={[screenStyles.notice, { backgroundColor: colors.errorBackground, color: colors.errorText }]}>{copyError}</Text> : null}
            <ScrollView style={styles.destinationList} keyboardShouldPersistTaps="handled">
              {(workspace?.files ?? []).map((file) => {
                const category = workspace?.categories.find((item) => item.id === file.category_id)?.name ?? 'Category'
                const topic = workspace?.topics.find((item) => item.id === file.topic_id)?.name ?? 'Topic'
                const subtopic = workspace?.subtopics.find((item) => item.id === file.subtopic_id)?.name ?? 'Subtopic'
                return (
                  <Pressable
                    key={file.id}
                    accessibilityRole="button"
                    disabled={copyBusy}
                    onPress={() => void copyToFile(file.id)}
                    style={({ pressed }) => [
                      styles.destinationOption,
                      { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={{ color: colors.text, fontWeight: '700' }}>{file.name}</Text>
                    <Text style={{ color: colors.mutedText, fontSize: 12 }}>{category} / {topic} / {subtopic}</Text>
                  </Pressable>
                )
              })}
              {!workspace?.files.length ? <Text style={[screenStyles.body, { color: colors.mutedText }]}>No valid destination files are available.</Text> : null}
            </ScrollView>
            {copyBusy ? <Text accessibilityLiveRegion="polite" style={[screenStyles.body, { color: colors.mutedText }]}>Copying note…</Text> : null}
            <Pressable accessibilityRole="button" disabled={copyBusy} onPress={() => setCopyPickerOpen(false)} style={screenStyles.secondaryButton}>
              <Text style={[screenStyles.secondaryText, { color: colors.accentText }]}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        transparent
        visible={deleteConfirmOpen}
        animationType="fade"
        onRequestClose={() => !deleteBusy && setDeleteConfirmOpen(false)}
      >
        <View style={styles.overlay}>
          <View style={[styles.confirmCard, { backgroundColor: colors.surface }]}>
            <Text accessibilityRole="header" style={[styles.confirmTitle, { color: colors.text }]}>Delete this note?</Text>
            <Text style={[screenStyles.body, { color: colors.mutedText }]}>
              “{note?.title}” will be deleted. Its file and taxonomy remain untouched. Any unsaved edits to this note will also be discarded.
            </Text>
            <View style={styles.confirmActions}>
              <Pressable accessibilityRole="button" disabled={deleteBusy} onPress={() => setDeleteConfirmOpen(false)} style={screenStyles.secondaryButton}>
                <Text style={[screenStyles.secondaryText, { color: colors.accentText }]}>Cancel</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={deleteBusy} onPress={() => void confirmDeleteNote()} style={[screenStyles.button, deleteBusy && screenStyles.buttonDisabled]}>
                <Text style={screenStyles.buttonText}>{deleteBusy ? 'Deleting…' : 'Delete Note'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ExpoScreen>
  )
}

function AnimatedMarkdownBody({
  source,
  collapsed,
}: {
  source: string
  collapsed: boolean
}) {
  const [progress] = useState(() => new Animated.Value(collapsed ? 0 : 1))
  const [bodyHeight, setBodyHeight] = useState(0)
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    let active = true
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled)
    }).catch(() => {
      if (active) setReduceMotion(true)
    })
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    )
    return () => {
      active = false
      subscription.remove()
    }
  }, [])

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: collapsed ? 0 : 1,
      duration: reduceMotion ? 0 : 180,
      useNativeDriver: false,
    })
    animation.start()
    return () => animation.stop()
  }, [collapsed, progress, reduceMotion])

  const height = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, Math.max(bodyHeight, 1)],
  })

  return (
    <Animated.View
      accessibilityElementsHidden={collapsed}
      importantForAccessibility={collapsed ? 'no-hide-descendants' : 'auto'}
      style={[styles.markdownAnimatedBody, { height, opacity: progress }]}
    >
      <View
        collapsable={false}
        onLayout={(event) => {
          const nextHeight = event.nativeEvent.layout.height
          setBodyHeight((current) => Math.abs(current - nextHeight) < 1 ? current : nextHeight)
        }}
      >
        <ExpoMarkdownPreview source={source} />
      </View>
    </Animated.View>
  )
}

function MarkdownBlockToggle({
  blockNumber,
  collapsed,
  disabled,
  onToggle,
  colors,
}: {
  blockNumber: number
  collapsed: boolean
  disabled: boolean
  onToggle: () => void
  colors: ThemeColors
}) {
  const [showTooltip, setShowTooltip] = useState(false)
  const label = `${collapsed ? 'Expand' : 'Collapse'} Markdown block ${blockNumber}`
  return (
    <View style={styles.iconAnchor}>
      <Pressable
        accessibilityLabel={label}
        accessibilityHint={collapsed ? 'Show the Markdown content' : 'Hide the Markdown content'}
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed, disabled }}
        disabled={disabled}
        onFocus={() => setShowTooltip(true)}
        onBlur={() => setShowTooltip(false)}
        onHoverIn={() => setShowTooltip(true)}
        onHoverOut={() => setShowTooltip(false)}
        onPress={onToggle}
        style={({ pressed }) => [
          styles.markdownIconAction,
          showTooltip && styles.markdownIconFocus,
          pressed && styles.markdownIconPressed,
          disabled && screenStyles.buttonDisabled,
        ]}
      >
        <Text style={[styles.markdownActionGlyph, { color: colors.accentText }]}>
          {collapsed ? '⌄' : '⌃'}
        </Text>
      </Pressable>
      {showTooltip ? (
        <Text style={[styles.iconTooltip, { backgroundColor: colors.text, color: colors.surface }]}>
          {label}
        </Text>
      ) : null}
    </View>
  )
}

function IconAction({
  label,
  glyph,
  colors,
  onPress,
  selected = false,
  danger = false,
}: {
  label: string
  glyph: string
  colors: ThemeColors
  onPress: () => void
  selected?: boolean
  danger?: boolean
}) {
  const [showTooltip, setShowTooltip] = useState(false)
  return (
    <View style={styles.iconAnchor}>
      <Pressable
        accessibilityLabel={label}
        accessibilityHint={`Open ${label} action`}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onFocus={() => setShowTooltip(true)}
        onBlur={() => setShowTooltip(false)}
        onHoverIn={() => setShowTooltip(true)}
        onHoverOut={() => setShowTooltip(false)}
        onPress={onPress}
        style={({ pressed }) => [
          styles.iconButton,
          {
            backgroundColor: selected ? colors.infoBackground : colors.surface,
            borderColor: danger ? colors.errorText : colors.border,
            opacity: pressed ? 0.75 : 1,
          },
        ]}
      >
        <Text style={[styles.iconGlyph, { color: danger ? colors.errorText : colors.text }]}>{glyph}</Text>
      </Pressable>
      {showTooltip ? (
        <Text style={[styles.iconTooltip, { backgroundColor: colors.text, color: colors.surface }]}>
          {label}
        </Text>
      ) : null}
    </View>
  )
}

function SaveIndicator({
  state,
  onRetry,
  disabled,
  colors,
}: {
  state: SaveState
  onRetry: () => void
  disabled: boolean
  colors: ThemeColors
}) {
  const label =
    state === 'saving' ? 'Saving…' :
      state === 'failed' ? 'Save failed' :
        state === 'unsaved' ? 'Unsaved changes' : 'Saved'
  return (
    <View accessibilityLiveRegion="polite" style={styles.saveIndicator}>
      <Text style={[styles.saveLabel, { color: state === 'failed' ? colors.errorText : colors.successText }]}>{label}</Text>
      {state === 'failed' ? (
        <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onRetry}>
          <Text style={[screenStyles.secondaryText, { color: colors.accentText }]}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  page: { alignSelf: 'center', backgroundColor: '#ffffff', borderColor: '#e8e1ec', borderRadius: 20, borderWidth: 1, gap: 14, maxWidth: 920, padding: 24, width: '100%' },
  header: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' },
  editorHeader: { gap: 8 },
  noteContentScroll: { flexGrow: 0, flexShrink: 1, width: '100%' },
  noteContentScrollContent: { gap: 18, paddingBottom: 4 },
  headerActions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  iconButton: { alignItems: 'center', borderRadius: 24, borderWidth: 1, height: 48, justifyContent: 'center', minWidth: 48, paddingHorizontal: 6 },
  iconGlyph: { fontSize: 17, fontWeight: '700' },
  iconAnchor: { alignItems: 'center', position: 'relative' },
  iconTooltip: { borderRadius: 5, fontSize: 12, left: '50%', overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 5, position: 'absolute', top: 52, transform: [{ translateX: -32 }], zIndex: 10 },
  status: { alignItems: 'center', flexDirection: 'row', gap: 12, paddingVertical: 8 },
  saveIndicator: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 10, minHeight: 44 },
  saveLabel: { color: '#53705b', fontSize: 14, fontWeight: '600' },
  saveFailed: { color: '#9b2f2b' },
  overlay: { alignItems: 'center', backgroundColor: '#0008', flex: 1, justifyContent: 'center', padding: 18 },
  confirmCard: { backgroundColor: '#ffffff', borderRadius: 16, gap: 14, maxWidth: 520, padding: 22, width: '100%' },
  confirmTitle: { color: '#30283d', fontSize: 21, fontWeight: '700' },
  confirmActions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'flex-end' },
  error: { backgroundColor: '#fff0ef' },
  recovery: { backgroundColor: '#fff9df', gap: 10 },
  recoveryText: { color: '#514514', fontSize: 14, lineHeight: 21 },
  recoveryActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  field: { gap: 6 },
  destinationList: { maxHeight: 360 },
  destinationOption: { borderRadius: 10, borderWidth: 1, gap: 4, marginBottom: 8, minHeight: 52, padding: 10 },
  pressed: { opacity: 0.8 },
  sqlPanel: { backgroundColor: '#f7f4fa', borderColor: '#ded4e7', borderRadius: 14, borderWidth: 1, gap: 12, padding: 16 },
  sqlQuestion: { borderRadius: 10, borderWidth: 1, fontSize: 15, lineHeight: 22, minHeight: 84, padding: 12, textAlignVertical: 'top' },
  sqlInput: { backgroundColor: '#ffffff', borderColor: '#cfc5d7', borderRadius: 10, borderWidth: 1, color: '#30283d', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 14, lineHeight: 21, minHeight: 150, padding: 12, textAlignVertical: 'top' },
  sqlActions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  sqlResult: { backgroundColor: '#ffffff', borderRadius: 10, gap: 8, padding: 12 },
  markdownResult: { borderRadius: 10, borderWidth: 1, gap: 10, padding: 12 },
  markdownAnimatedBody: { overflow: 'hidden', width: '100%' },
  markdownBlockActions: { alignItems: 'center', flexDirection: 'row', gap: 6, justifyContent: 'flex-end', width: '100%' },
  markdownIconAction: { alignItems: 'center', borderRadius: 18, height: 36, justifyContent: 'center', width: 36 },
  markdownActionGlyph: { fontSize: 20, fontWeight: '700' },
  markdownIconFocus: { borderColor: '#69448a', borderWidth: 2 },
  markdownIconPressed: { opacity: 0.65 },
  markdownInlineEditor: { borderRadius: 10, borderWidth: 1, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 14, lineHeight: 21, minHeight: 220, padding: 12, textAlignVertical: 'top', width: '100%' },
  markdownContentPressable: { minHeight: 56, width: '100%' },
  resultCode: { color: '#30283d', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12, lineHeight: 18 },
  errorText: { color: '#8b2424', fontSize: 14 },
  titleInput: { backgroundColor: '#ffffff', borderColor: '#cfc5d7', borderRadius: 10, borderWidth: 1, color: '#30283d', fontSize: 22, fontWeight: '700', minHeight: 54, paddingHorizontal: 14 },
  contentInput: { backgroundColor: '#ffffff', borderColor: '#cfc5d7', borderRadius: 10, borderWidth: 1, color: '#30283d', fontSize: 16, lineHeight: 24, minHeight: 320, padding: 14, width: '100%' },
})
