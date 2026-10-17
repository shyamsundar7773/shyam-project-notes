import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
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
import {
  executePracticeSql,
  fetchPracticeSqlQuestion,
  requestNoteAi,
  resolveExpoBackendBaseUrl,
  type PracticeSqlResult,
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
  const [sqlOpen, setSqlOpen] = useState(one(params.mode) === 'sql')
  const [sqlQuestion, setSqlQuestion] = useState('')
  const [sqlSchema, setSqlSchema] = useState<string[]>([])
  const [sqlDraft, setSqlDraft] = useState('')
  const [sqlResult, setSqlResult] = useState<PracticeSqlResult | null>(null)
  const [sqlEvaluation, setSqlEvaluation] = useState('')
  const [sqlBusy, setSqlBusy] = useState(false)
  const [sqlError, setSqlError] = useState('')
  const [markdownOpen, setMarkdownOpen] = useState(false)
  const [markdownDraft, setMarkdownDraft] = useState('')
  const [markdownResult, setMarkdownResult] = useState('')
  const [markdownBusy, setMarkdownBusy] = useState(false)
  const [markdownError, setMarkdownError] = useState('')
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
  const markdownRequestId = useRef(0)
  const sqlQuestionTouched = useRef(false)
  const sqlBusyLock = useRef(false)
  const markdownBusyLock = useRef(false)
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
    if (!sqlOpen || !session || !backendBaseUrl) return
    let active = true
    const requestedNoteId = noteId
    void fetchPracticeSqlQuestion(backendBaseUrl, session.access_token)
      .then((question) => {
        if (!active || activeEditorNoteId.current !== requestedNoteId) return
        if (!sqlQuestionTouched.current) setSqlQuestion(question.prompt)
        setSqlSchema(question.schema)
        setSqlError('')
      })
      .catch((error: unknown) => {
        if (active) {
          setSqlError(
            error instanceof Error
              ? error.message
              : 'The SQL practice question could not be loaded.',
          )
        }
      })
    return () => {
      active = false
    }
  }, [backendBaseUrl, noteId, session, sqlOpen])

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
        const restoreImmediately = cached?.baseUpdatedAt === loadedNote.updated_at
        const initialValue =
          restoreImmediately && cached ? cached.value : remoteValue
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

  async function evaluateSqlResult(
    query: string,
    result: PracticeSqlResult,
    requestId = sqlRequestId.current,
    selectedNoteId = noteId,
    question = sqlQuestion,
  ) {
    if (!session) throw new Error('Sign in again to evaluate this query.')
    const evaluated = await requestNoteAi(
      {
        kind: 'sql',
        content: query,
        accessToken: session.access_token,
        question,
        executionResult: JSON.stringify(result),
      },
      { baseUrl: backendBaseUrl },
    )
    if (!('evaluation' in evaluated)) {
      throw new Error('The evaluation service returned an invalid response.')
    }
    if (
      requestId === sqlRequestId.current &&
      activeEditorNoteId.current === selectedNoteId
    ) {
      setSqlEvaluation(evaluated.evaluation)
      console.info('[notes-ai] result displayed operation=sql-evaluation')
    }
  }

  async function retrySqlEvaluation() {
    if (!sqlResult || !sqlDraft.trim() || sqlBusyLock.current) return
    console.info('[notes-ai] button clicked operation=sql-evaluation')
    const requestId = sqlRequestId.current
    const selectedNoteId = noteId
    setSqlBusy(true)
    sqlBusyLock.current = true
    setSqlError('')
    try {
      await evaluateSqlResult(sqlDraft, sqlResult, requestId, selectedNoteId, sqlQuestion)
    } catch (error) {
      setSqlError(
        error instanceof Error
          ? error.message
          : 'Gemini evaluation failed. Your query and SQL result are preserved; retry.',
      )
    } finally {
      if (requestId === sqlRequestId.current && activeEditorNoteId.current === selectedNoteId) {
        sqlBusyLock.current = false
        setSqlBusy(false)
      }
    }
  }

  function toggleMarkdownPanel() {
    if (!markdownOpen) {
      setMarkdownBusy(false)
      setMarkdownDraft(valueRef.current.markdown_converted_source ?? '')
      setMarkdownResult(valueRef.current.markdown_output ?? '')
      setMarkdownError('')
    }
    setMarkdownOpen((open) => !open)
  }

  async function convertMarkdown() {
    if (!session || markdownBusyLock.current || !markdownDraft.trim()) return
    console.info('[notes-ai] button clicked operation=markdown-conversion')
    const selectedNoteId = noteId
    const requestId = ++markdownRequestId.current
    const input = markdownDraft
    markdownBusyLock.current = true
    setMarkdownBusy(true)
    setMarkdownError('')
    try {
      const result = await requestNoteAi(
        { kind: 'markdown', content: input, accessToken: session.access_token },
        { baseUrl: backendBaseUrl },
      )
      if (
        requestId !== markdownRequestId.current ||
        activeEditorNoteId.current !== selectedNoteId ||
        !('convertedMarkdown' in result)
      ) return
      setMarkdownResult(result.convertedMarkdown)
      edit({
        markdown_output: result.convertedMarkdown,
        markdown_converted_source: input,
      })
      console.info('[notes-ai] result displayed operation=markdown-conversion')
    } catch (error) {
      if (
        requestId === markdownRequestId.current &&
        activeEditorNoteId.current === selectedNoteId
      ) {
        setMarkdownError(
          error instanceof Error
            ? error.message
            : 'Markdown conversion failed. Your input is preserved; retry.',
        )
      }
    } finally {
      if (requestId === markdownRequestId.current) {
        markdownBusyLock.current = false
        if (activeEditorNoteId.current === selectedNoteId) setMarkdownBusy(false)
      }
    }
  }

  function clearConvertedMarkdown() {
    setMarkdownResult('')
    setMarkdownDraft('')
    setMarkdownError('')
    edit({ markdown_output: null, markdown_converted_source: null })
  }

  function requestClearSql() {
    const hasWork = Boolean(
      (sqlQuestionTouched.current && sqlQuestion.trim()) ||
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
    sqlRequestId.current += 1
    sqlBusyLock.current = false
    setSqlQuestion('')
    sqlQuestionTouched.current = false
    setSqlDraft('')
    setSqlResult(null)
    setSqlEvaluation('')
    setSqlError('')
    setSqlSchema([])
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

  async function runSqlPractice() {
    if (!session || sqlBusyLock.current || !sqlDraft.trim()) return
    console.info('[notes-ai] button clicked operation=sql-execution')
    const query = sqlDraft
    const question = sqlQuestion
    const requestId = ++sqlRequestId.current
    const selectedNoteId = noteId
    sqlBusyLock.current = true
    setSqlBusy(true)
    setSqlError('')
    setSqlResult(null)
    setSqlEvaluation('')
    try {
      const result = await executePracticeSql(
        backendBaseUrl,
        session.access_token,
        query,
        fetch,
        question,
      )
      if (
        requestId !== sqlRequestId.current ||
        activeEditorNoteId.current !== selectedNoteId
      ) return
      setSqlResult(result)
      console.info('[notes-ai] result displayed operation=sql-execution')
      await evaluateSqlResult(query, result, requestId, selectedNoteId, question)
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
    deleteBusyLock.current = true
    setDeleteBusy(true)
    try {
      sqlRequestId.current += 1
      markdownRequestId.current += 1
      sqlBusyLock.current = false
      markdownBusyLock.current = false
      setSqlBusy(false)
      setMarkdownBusy(false)
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
    if (!sqlResult || !sqlEvaluation) return
    edit({
      source_content: appendSqlPracticeToNote(valueRef.current.source_content, {
        question: sqlQuestion,
        sql: sqlDraft,
        output: JSON.stringify(sqlResult, null, 2),
        evaluation: sqlEvaluation,
      }),
      sql_output: JSON.stringify(sqlResult),
      sql_evaluation: sqlEvaluation,
      sql_evaluated_source: sqlDraft,
    })
    setSqlOpen(false)
  }

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
                <IconAction label="SQL" glyph="SQL" colors={colors} selected={sqlOpen} onPress={() => { setSqlOpen((open) => !open); setMarkdownOpen(false) }} />
                <IconAction label="Markdown" glyph="M↓" colors={colors} selected={markdownOpen} onPress={toggleMarkdownPanel} />
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
            <Text style={screenStyles.eyebrow}>FULL-PAGE NOTE EDITOR</Text>
            <Text style={[screenStyles.body, { color: colors.mutedText }]}>
              {workspace.categories.find((item) => item.id === path.categoryId)?.name} /{' '}
              {workspace.topics.find((item) => item.id === path.topicId)?.name} /{' '}
              {workspace.subtopics.find((item) => item.id === path.subtopicId)?.name}
            </Text>
            {saveError ? <Text accessibilityRole="alert" style={[screenStyles.notice, styles.error, { backgroundColor: colors.errorBackground, color: colors.errorText }]}>{saveError}</Text> : null}
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
                maxLength={200}
                onChangeText={(title) => edit({ title })}
                placeholder="Untitled note"
                returnKeyType="next"
                style={[styles.titleInput, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]}
                value={value.title}
              />
            </View>
            <View style={styles.field}>
              <Text nativeID="note-content-label" style={[screenStyles.fieldLabel, { color: colors.text }]}>Note content</Text>
              <TextInput
                accessibilityLabel="Note content"
                accessibilityLabelledBy="note-content-label"
                multiline
                onChangeText={(source_content) => edit({ source_content })}
                placeholder="Write a note…"
                scrollEnabled
                style={[styles.contentInput, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]}
                textAlignVertical="top"
                value={value.source_content}
              />
            </View>
            {sqlOpen ? (
              <View style={[styles.sqlPanel, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
                <Text accessibilityRole="header" style={[screenStyles.fieldLabel, { color: colors.text }]}>Question</Text>
                <TextInput
                  accessibilityLabel="SQL practice question"
                  editable={!sqlBusy}
                  multiline
                  onChangeText={(question) => {
                    sqlQuestionTouched.current = true
                    sqlRequestId.current += 1
                    setSqlQuestion(question)
                    setSqlResult(null)
                    setSqlEvaluation('')
                    setSqlError('')
                  }}
                  placeholder="Enter a SQL practice question or use the generated prompt."
                  style={[styles.sqlQuestion, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]}
                  value={sqlQuestion}
                />
                {sqlSchema.map((definition) => <Text key={definition} style={[styles.schemaText, { color: colors.mutedText }]}>{definition}</Text>)}
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
                  <Pressable accessibilityRole="button" disabled={sqlBusy || !backendBaseUrl} onPress={() => void runSqlPractice()} style={[screenStyles.button, (sqlBusy || !backendBaseUrl) && screenStyles.buttonDisabled]}>
                    <Text style={screenStyles.buttonText}>{sqlBusy ? 'Running and evaluating…' : 'Run SQL'}</Text>
                  </Pressable>
                  {sqlResult && !sqlEvaluation && sqlError ? (
                    <Pressable accessibilityRole="button" disabled={sqlBusy} onPress={() => void retrySqlEvaluation()} style={[screenStyles.secondaryButton, sqlBusy && screenStyles.buttonDisabled]}>
                      <Text style={screenStyles.secondaryText}>Retry Gemini evaluation</Text>
                    </Pressable>
                  ) : null}
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
                  <Text style={[screenStyles.fieldLabel, { color: colors.text }]}>SQL output</Text>
                  {sqlBusy && !sqlResult ? <Text style={[screenStyles.body, { color: colors.mutedText }]}>Running the query…</Text> : null}
                  {sqlResult ? <Text selectable style={[styles.resultCode, { color: colors.text }]}>{JSON.stringify(sqlResult, null, 2)}{sqlResult.truncated ? `\nOnly the first ${sqlResult.rowLimit} rows are shown.` : ''}</Text> : null}
                  {!sqlBusy && !sqlResult && !sqlError ? <Text style={[screenStyles.body, { color: colors.mutedText }]}>Run a query to see its execution output.</Text> : null}
                </View>
                <View style={[styles.sqlResult, { backgroundColor: colors.surfaceMuted }]}>
                  <Text style={[screenStyles.fieldLabel, { color: colors.text }]}>Gemini AI evaluation</Text>
                  {sqlBusy && sqlResult && !sqlEvaluation ? <Text style={[screenStyles.body, { color: colors.mutedText }]}>Evaluating the executed query…</Text> : null}
                  {sqlEvaluation ? <Text style={[screenStyles.body, { color: colors.text }]}>{sqlEvaluation}</Text> : null}
                  {!sqlBusy && !sqlEvaluation && !sqlError ? <Text style={[screenStyles.body, { color: colors.mutedText }]}>Evaluation appears after successful execution.</Text> : null}
                </View>
              </View>
            ) : null}
            {markdownOpen ? (
              <View style={[styles.sqlPanel, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
                <Text accessibilityRole="header" style={[screenStyles.fieldLabel, { color: colors.text }]}>Markdown conversion</Text>
                {!markdownResult ? (
                  <>
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
                    <Pressable accessibilityRole="button" disabled={markdownBusy || !markdownDraft.trim() || !backendBaseUrl} onPress={() => void convertMarkdown()} style={[screenStyles.button, (markdownBusy || !markdownDraft.trim() || !backendBaseUrl) && screenStyles.buttonDisabled]}>
                      <Text style={screenStyles.buttonText}>{markdownBusy ? 'Converting…' : 'Convert with AI'}</Text>
                    </Pressable>
                  </>
                ) : (
                  <View style={[styles.markdownResult, { backgroundColor: colors.blueBackground, borderColor: colors.blueBorder }]}>
                    <View style={styles.sqlActions}>
                      <Text style={[screenStyles.fieldLabel, { color: colors.text, flex: 1 }]}>Converted Markdown</Text>
                      <Pressable accessibilityRole="button" accessibilityLabel="Delete converted content" onPress={clearConvertedMarkdown} style={styles.deleteConverted}>
                        <Text style={{ color: colors.errorText }}>Delete converted content</Text>
                      </Pressable>
                    </View>
                    <Text selectable style={[styles.resultCode, { color: colors.text }]}>{markdownResult}</Text>
                  </View>
                )}
                {!backendBaseUrl ? <Text accessibilityRole="alert" style={[styles.errorText, { color: colors.errorText }]}>Set EXPO_PUBLIC_API_BASE_URL to use the server-side conversion service.</Text> : null}
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
  page: { alignSelf: 'center', backgroundColor: '#ffffff', borderColor: '#e8e1ec', borderRadius: 20, borderWidth: 1, gap: 18, maxWidth: 920, minHeight: 500, padding: 24, width: '100%' },
  header: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' },
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
  schemaText: { color: '#554767', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13 },
  sqlInput: { backgroundColor: '#ffffff', borderColor: '#cfc5d7', borderRadius: 10, borderWidth: 1, color: '#30283d', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 14, lineHeight: 21, minHeight: 150, padding: 12, textAlignVertical: 'top' },
  sqlActions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  sqlResult: { backgroundColor: '#ffffff', borderRadius: 10, gap: 8, padding: 12 },
  markdownResult: { borderRadius: 10, borderWidth: 1, gap: 10, padding: 12 },
  deleteConverted: { alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingHorizontal: 8 },
  resultCode: { color: '#30283d', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12, lineHeight: 18 },
  errorText: { color: '#8b2424', fontSize: 14 },
  titleInput: { backgroundColor: '#ffffff', borderColor: '#cfc5d7', borderRadius: 10, borderWidth: 1, color: '#30283d', fontSize: 22, fontWeight: '700', minHeight: 54, paddingHorizontal: 14 },
  contentInput: { backgroundColor: '#ffffff', borderColor: '#cfc5d7', borderRadius: 10, borderWidth: 1, color: '#30283d', fontSize: 16, lineHeight: 24, minHeight: 320, padding: 14, width: '100%' },
})
