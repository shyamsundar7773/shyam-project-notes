import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import {
  router,
  useFocusEffect,
  useLocalSearchParams,
  type Href,
} from 'expo-router'
import { useExpoAuth } from '../../src/components/ExpoAuthContext'
import { ExpoScreen } from '../../src/components/ExpoScreen'
import { screenStyles } from '../../src/components/expo-screen-styles'
import { ThemeToggle } from '../../src/components/ThemeProvider'
import { useAppTheme } from '../../src/components/ThemeContext'
import {
  copyNoteToFile,
  createNoteForSubtopic,
  deleteNote,
  listNotesForFiles,
  noteColorForId,
  type Note,
} from '../../src/lib/notes'
import { RequestSequence } from '../../src/lib/request-sequence'
import {
  filesForSubtopic,
  isValidTaxonomyPath,
  loadWorkspaceData,
  noteRouteForSelection,
  notesRouteForSelection,
  type TaxonomySelection,
  type WorkspaceData,
} from '../../src/lib/phase1'

function one(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : ''
}

function preview(note: Note): string {
  const content =
    note.note_type === 'markdown'
      ? note.markdown_output || note.source_content
      : note.source_content
  const safeText = content.replace(/\s+/g, ' ').trim()
  return safeText.length > 180 ? `${safeText.slice(0, 180)}…` : safeText || 'No content yet.'
}

export default function NotesCollectionScreen() {
  const { client, session, configuration } = useExpoAuth()
  const { colors, theme } = useAppTheme()
  const params = useLocalSearchParams<{
    categoryId?: string | string[]
    topicId?: string | string[]
    subtopicId?: string | string[]
    copied?: string | string[]
    deleted?: string | string[]
  }>()
  const categoryId = one(params.categoryId)
  const topicId = one(params.topicId)
  const subtopicId = one(params.subtopicId)
  const copied = one(params.copied)
  const deleted = one(params.deleted)
  const path = useMemo<TaxonomySelection>(
    () => ({ categoryId, topicId, subtopicId }),
    [categoryId, topicId, subtopicId],
  )
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [selectedFileId, setSelectedFileId] = useState('')
  const [loading, setLoading] = useState(true)
  const [notesLoading, setNotesLoading] = useState(false)
  const [error, setError] = useState('')
  const [notesError, setNotesError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [actionError, setActionError] = useState('')
  const [creating, setCreating] = useState(false)
  const [copyTarget, setCopyTarget] = useState<Note | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Note | null>(null)
  const [menuTarget, setMenuTarget] = useState<Note | null>(null)
  const [destinationCategoryId, setDestinationCategoryId] = useState('')
  const [destinationTopicId, setDestinationTopicId] = useState('')
  const [destinationSubtopicId, setDestinationSubtopicId] = useState('')
  const [destinationFileId, setDestinationFileId] = useState('')
  const [working, setWorking] = useState(false)
  const lock = useRef(false)
  const requestId = useRef(0)
  const workspaceRequests = useRef(new RequestSequence())
  const focused = useRef(false)
  const loadRef = useRef<(selection: TaxonomySelection) => Promise<void>>(
    async () => {},
  )

  const visibleActionMessage = actionMessage ||
    (copied ? `Copied as “${copied}”.` : deleted === '1' ? 'Note deleted successfully.' : '')

  const validPath = Boolean(
    workspace &&
      isValidTaxonomyPath(
        {
          category_id: path.categoryId,
          topic_id: path.topicId,
          subtopic_id: path.subtopicId,
        },
        workspace,
      ),
  )
  const matchingFiles = useMemo(
    () =>
      validPath && workspace
        ? filesForSubtopic(
            workspace,
            path.categoryId,
            path.topicId,
            path.subtopicId,
          )
        : [],
    [path.categoryId, path.subtopicId, path.topicId, validPath, workspace],
  )
  const selectedCategory = workspace?.categories.find((item) => item.id === path.categoryId)
  const selectedTopic = workspace?.topics.find((item) => item.id === path.topicId)
  const selectedSubtopic = workspace?.subtopics.find((item) => item.id === path.subtopicId)
  const destinationTopics =
    workspace?.topics.filter((item) => item.category_id === destinationCategoryId) ?? []
  const destinationSubtopics =
    workspace?.subtopics.filter(
      (item) =>
        item.category_id === destinationCategoryId &&
        item.topic_id === destinationTopicId,
    ) ?? []
  const destinationFiles =
    workspace?.files.filter(
      (item) =>
        item.category_id === destinationCategoryId &&
        item.topic_id === destinationTopicId &&
        item.subtopic_id === destinationSubtopicId,
    ) ?? []

  const refreshNotes = useCallback(
    async (files: WorkspaceData['files']) => {
      const id = ++requestId.current
      if (!client || !session || files.length === 0) {
        setNotes([])
        setNotesLoading(false)
        setNotesError('')
        return
      }
      setNotesLoading(true)
      setNotesError('')
      try {
        const result = await listNotesForFiles(
          client,
          files.map((file) => file.id),
          session.user.id,
        )
        if (id === requestId.current) setNotes(result)
      } catch (loadError) {
        if (id === requestId.current) {
          setNotes([])
          setNotesError(
            loadError instanceof Error
              ? loadError.message
              : 'Notes could not be loaded. Check your connection and retry.',
          )
        }
      } finally {
        if (id === requestId.current) setNotesLoading(false)
      }
    },
    [client, session, setNotes, setNotesError, setNotesLoading],
  )

  async function load(selection: TaxonomySelection) {
    const request = workspaceRequests.current.begin()
    if (!client || !session) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const data = await loadWorkspaceData(client)
      if (!focused.current || !workspaceRequests.current.isCurrent(request)) return
      if (
        !isValidTaxonomyPath(
          {
            category_id: selection.categoryId,
            topic_id: selection.topicId,
            subtopic_id: selection.subtopicId,
          },
          data,
        )
      ) {
        setWorkspace(data)
        setError('This Category → Topic → Subtopic path is unavailable. Return Home and choose a current path.')
        setNotes([])
        return
      }
      const files = filesForSubtopic(
        data,
        selection.categoryId,
        selection.topicId,
        selection.subtopicId,
      )
      setWorkspace(data)
      setSelectedFileId((current) =>
        files.some((file) => file.id === current)
          ? current
          : files.length === 1
            ? files[0].id
            : '',
      )
      await refreshNotes(files)
    } catch (loadError) {
      if (!focused.current || !workspaceRequests.current.isCurrent(request)) return
      setWorkspace(null)
      setNotes([])
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'The cloud workspace could not be loaded. Check your connection and retry.',
      )
    } finally {
      if (focused.current && workspaceRequests.current.isCurrent(request)) {
        setLoading(false)
      }
    }
  }
  useEffect(() => {
    loadRef.current = load
  })

  useFocusEffect(
    useCallback(() => {
      focused.current = true
      void loadRef.current(path)
      return () => {
        focused.current = false
        workspaceRequests.current.invalidate()
        requestId.current += 1
      }
    }, [path]),
  )

  async function addNote() {
    if (!client || !session || !validPath || lock.current) return
    if (matchingFiles.length > 1 && !selectedFileId) {
      setActionError('Select a file collection before adding a note.')
      return
    }
    lock.current = true
    setCreating(true)
    setActionError('')
    setActionMessage('')
    try {
      const { note, file } = await createNoteForSubtopic(
        client,
        session.user.id,
        {
          category_id: path.categoryId,
          topic_id: path.topicId,
          subtopic_id: path.subtopicId,
        },
        selectedFileId,
      )
      setWorkspace((current) =>
        current && !current.files.some((item) => item.id === file.id)
          ? { ...current, files: [...current.files, file] }
          : current,
      )
      setSelectedFileId(file.id)
      setNotes((current) => [note, ...current])
      router.push(noteRouteForSelection(note.id, path) as Href)
    } catch (createError) {
      setActionError(
        createError instanceof Error
          ? createError.message
          : 'The note could not be created. Check your connection and retry.',
      )
    } finally {
      lock.current = false
      setCreating(false)
    }
  }

  function beginCopy(note: Note) {
    setMenuTarget(null)
    setDestinationCategoryId(path.categoryId)
    setDestinationTopicId(path.topicId)
    setDestinationSubtopicId(path.subtopicId)
    setDestinationFileId(note.file_id)
    setCopyTarget(note)
  }

  async function copySelectedNote() {
    if (!client || !session || !workspace || !copyTarget || lock.current) return
    const destination = workspace.files.find((file) => file.id === destinationFileId)
    if (
      !destination ||
      destination.category_id !== destinationCategoryId ||
      destination.topic_id !== destinationTopicId ||
      destination.subtopic_id !== destinationSubtopicId ||
      !workspace.subtopics.some(
        (item) =>
          item.id === destinationSubtopicId &&
          item.topic_id === destinationTopicId &&
          item.category_id === destinationCategoryId,
      ) ||
      copyTarget.owner_id !== session.user.id
    ) {
      setActionError('Choose a valid destination file in your account.')
      return
    }
    lock.current = true
    setWorking(true)
    setActionError('')
    try {
      await copyNoteToFile(
        client,
        copyTarget,
        destination.id,
        session.user.id,
      )
      setCopyTarget(null)
      router.replace(
        notesRouteForSelection({
          categoryId: destination.category_id,
          topicId: destination.topic_id,
          subtopicId: destination.subtopic_id,
        }) as Href,
      )
    } catch (copyError) {
      setActionError(
        copyError instanceof Error
          ? copyError.message
          : 'The note could not be copied. Check your connection and retry.',
      )
    } finally {
      lock.current = false
      setWorking(false)
    }
  }

  async function confirmDelete() {
    if (!client || !session || !deleteTarget || lock.current) return
    lock.current = true
    setWorking(true)
    setActionError('')
    try {
      await deleteNote(client, deleteTarget.id, session.user.id)
      setNotes((current) => current.filter((note) => note.id !== deleteTarget.id))
      setDeleteTarget(null)
      setActionMessage('Note deleted successfully.')
    } catch (deleteError) {
      setActionError(
        deleteError instanceof Error
          ? deleteError.message
          : 'The note could not be deleted. Refresh and retry.',
      )
    } finally {
      lock.current = false
      setWorking(false)
    }
  }

  function showLaterPhase(action: 'SQL' | 'Markdown Text') {
    setMenuTarget(null)
    if (action === 'SQL' && menuTarget) {
      router.push(
        `${noteRouteForSelection(menuTarget.id, path)}&mode=sql` as Href,
      )
      return
    }
    setActionMessage(`Add ${action} is planned for a later phase and is not available yet.`)
  }

  return (
    <ExpoScreen scroll>
      <View style={[styles.page, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.headerRow}>
          <Pressable accessibilityRole="link" onPress={() => router.replace('/home' as Href)}>
            <Text style={[styles.back, { color: colors.accentText }]}>‹ Home</Text>
          </Pressable>
          <ThemeToggle />
        </View>
        <Text style={screenStyles.eyebrow}>YOUR NOTES WORKSPACE</Text>
        <Text accessibilityRole="header" style={[screenStyles.title, { color: colors.text }]}>
          {selectedSubtopic?.name ?? 'Notes collection'}
        </Text>
        <Text style={[screenStyles.body, { color: colors.mutedText }]}>
          {selectedCategory?.name ?? 'Category'} / {selectedTopic?.name ?? 'Topic'} / {selectedSubtopic?.name ?? 'Subtopic'}
        </Text>
        {loading ? (
          <View style={styles.status}>
            <ActivityIndicator color="#69448a" />
            <Text style={screenStyles.body}>Loading your notes…</Text>
          </View>
        ) : error ? (
          <>
            <Text accessibilityRole="alert" style={[screenStyles.notice, styles.error, { backgroundColor: colors.errorBackground, color: colors.errorText }]}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={() => void loadRef.current(path)} style={screenStyles.secondaryButton}>
              <Text style={screenStyles.secondaryText}>Retry</Text>
            </Pressable>
          </>
        ) : !client || !session ? (
          <Text accessibilityRole="alert" style={[screenStyles.notice, styles.error]}>{configuration.message}</Text>
        ) : (
          <>
            {matchingFiles.length ? (
              <View style={styles.fileSection}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>File collections in this Subtopic</Text>
                <View style={styles.chips}>
                  {matchingFiles.map((file) => (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected: selectedFileId === file.id }}
                      key={file.id}
                      onPress={() => setSelectedFileId(file.id)}
                      style={[styles.chip, { borderColor: colors.border }, selectedFileId === file.id && styles.chipSelected]}
                    >
                      <Text style={[styles.chipText, { color: selectedFileId === file.id ? '#ffffff' : colors.text }, selectedFileId === file.id && styles.chipTextSelected]}>{file.name}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : (
              <Text style={[screenStyles.notice, screenStyles.infoNotice, { backgroundColor: colors.infoBackground, color: colors.infoText }]}>
                No file exists in this Subtopic yet. Adding a note will create its file collection.
              </Text>
            )}
            {visibleActionMessage ? <Text accessibilityLiveRegion="polite" style={[screenStyles.notice, screenStyles.infoNotice, { backgroundColor: colors.infoBackground, color: colors.infoText }]}>{visibleActionMessage}</Text> : null}
            {actionError ? <Text accessibilityRole="alert" style={[screenStyles.notice, styles.error, { backgroundColor: colors.errorBackground, color: colors.errorText }]}>{actionError}</Text> : null}
            <View style={styles.headingRow}>
              <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.text }]}>Notes</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !validPath || (matchingFiles.length > 1 && !selectedFileId) || creating }}
                disabled={!validPath || (matchingFiles.length > 1 && !selectedFileId) || creating}
                onPress={() => void addNote()}
                style={[screenStyles.button, (!selectedFileId || creating) && screenStyles.buttonDisabled]}
              >
                <Text style={screenStyles.buttonText}>{creating ? 'Creating…' : '+ Add Note'}</Text>
              </Pressable>
            </View>
            {notesError ? (
              <View style={[screenStyles.notice, styles.error, { backgroundColor: colors.errorBackground }]}>
              <Text accessibilityRole="alert" style={[styles.errorText, { color: colors.errorText }]}>{notesError}</Text>
              <Pressable accessibilityRole="button" onPress={() => void refreshNotes(matchingFiles)}><Text style={[styles.retry, { color: colors.accentText }]}>Retry</Text></Pressable>
              </View>
            ) : notesLoading ? (
              <View style={styles.status}><ActivityIndicator color={colors.accent} /><Text style={[screenStyles.body, { color: colors.mutedText }]}>Loading notes…</Text></View>
            ) : notes.length === 0 ? (
              <Text style={[screenStyles.notice, screenStyles.infoNotice, { backgroundColor: colors.infoBackground, color: colors.infoText }]}>No notes saved in this Subtopic yet. Add Notes to create the first one.</Text>
            ) : (
              <View style={styles.grid}>
                {notes.map((note) => (
                  <View key={note.id} style={[styles.noteCard, theme === 'dark' ? { backgroundColor: colors.surfaceMuted, borderColor: colors.border } : cardColors[noteColorForId(note.id)]]}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Open note ${note.title}`}
                      onPress={() => router.push(noteRouteForSelection(note.id, path) as Href)}
                      style={styles.cardOpen}
                    >
                      <Text numberOfLines={1} style={[styles.noteTitle, { color: colors.text }]}>{note.title}</Text>
                      <Text numberOfLines={4} style={[styles.preview, { color: colors.mutedText }]}>{preview(note)}</Text>
                      <Text style={[styles.saved, { color: colors.successText }]}>Saved</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Actions for ${note.title}`}
                      onPress={() => setMenuTarget(note)}
                      style={styles.moreButton}
                    >
                      <Text style={[styles.moreText, { color: colors.text }]}>•••</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </View>
      <Modal transparent visible={Boolean(menuTarget)} animationType="fade" onRequestClose={() => setMenuTarget(null)}>
        <View style={styles.overlay}><View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
          <Text accessibilityRole="header" style={[styles.modalTitle, { color: colors.text }]}>Note actions</Text>
          <MenuButton label="Copy Notes" onPress={() => menuTarget && beginCopy(menuTarget)} />
          <MenuButton label="Add SQL" onPress={() => showLaterPhase('SQL')} />
          <MenuButton label="Add Markdown Text" onPress={() => showLaterPhase('Markdown Text')} />
          <MenuButton danger label="Delete Notes" onPress={() => { setDeleteTarget(menuTarget); setMenuTarget(null) }} />
          <MenuButton label="Cancel" onPress={() => setMenuTarget(null)} />
        </View></View>
      </Modal>
      <Modal transparent visible={Boolean(copyTarget)} animationType="slide" onRequestClose={() => setCopyTarget(null)}>
        <View style={styles.overlay}><ScrollView contentContainerStyle={styles.modalScroll}><View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
          <Text accessibilityRole="header" style={[styles.modalTitle, { color: colors.text }]}>Copy Notes</Text>
          <Text style={[screenStyles.body, { color: colors.mutedText }]}>The original stays unchanged. The copy is saved in the selected destination file with “(Copy)” added to its title. A number is added when needed to avoid an existing copy title.</Text>
          {workspace ? <>
            <ChoiceGroup title="Category" values={workspace.categories.map((item) => [item.id, item.name])} selected={destinationCategoryId} onSelect={(id) => { setDestinationCategoryId(id); setDestinationTopicId(''); setDestinationSubtopicId(''); setDestinationFileId('') }} />
            <ChoiceGroup title="Topic" values={destinationTopics.map((item) => [item.id, item.name])} selected={destinationTopicId} onSelect={(id) => { setDestinationTopicId(id); setDestinationSubtopicId(''); setDestinationFileId('') }} />
            <ChoiceGroup title="Subtopic" values={destinationSubtopics.map((item) => [item.id, item.name])} selected={destinationSubtopicId} onSelect={(id) => { setDestinationSubtopicId(id); setDestinationFileId('') }} />
            <ChoiceGroup title="File" values={destinationFiles.map((item) => [item.id, item.name])} selected={destinationFileId} onSelect={setDestinationFileId} />
          </> : null}
          {actionError ? <Text accessibilityRole="alert" style={[screenStyles.notice, styles.error, { backgroundColor: colors.errorBackground, color: colors.errorText }]}>{actionError}</Text> : null}
          <View style={styles.modalActions}>
            <MenuButton label="Cancel" onPress={() => setCopyTarget(null)} />
            <MenuButton label={working ? 'Copying…' : 'Copy note'} disabled={!destinationFileId || working} onPress={() => void copySelectedNote()} />
          </View>
        </View></ScrollView></View>
      </Modal>
      <Modal transparent visible={Boolean(deleteTarget)} animationType="fade" onRequestClose={() => !working && setDeleteTarget(null)}>
        <View style={styles.overlay}><View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
          <Text accessibilityRole="header" style={[styles.modalTitle, { color: colors.text }]}>Delete note?</Text>
          <Text style={[screenStyles.body, { color: colors.mutedText }]}>Delete “{deleteTarget?.title}” and its saved note content? The file, Category, Topic, Subtopic, and other notes will not be changed.</Text>
          {actionError ? <Text accessibilityRole="alert" style={[screenStyles.notice, styles.error, { backgroundColor: colors.errorBackground, color: colors.errorText }]}>{actionError}</Text> : null}
          <View style={styles.modalActions}>
            <MenuButton label="Cancel" disabled={working} onPress={() => setDeleteTarget(null)} />
            <MenuButton danger label={working ? 'Deleting…' : 'Delete Notes'} disabled={working} onPress={() => void confirmDelete()} />
          </View>
        </View></View>
      </Modal>
    </ExpoScreen>
  )
}

function MenuButton({
  label,
  onPress,
  danger = false,
  disabled = false,
}: {
  label: string
  onPress: () => void
  danger?: boolean
  disabled?: boolean
}) {
  const { colors } = useAppTheme()
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[
      styles.menuButton,
      { borderColor: danger ? colors.errorText : colors.border },
      danger && styles.menuDanger,
      disabled && screenStyles.buttonDisabled,
    ]}>
      <Text style={[styles.menuLabel, { color: danger ? colors.errorText : colors.text }]}>{label}</Text>
    </Pressable>
  )
}

function ChoiceGroup({
  title,
  values,
  selected,
  onSelect,
}: {
  title: string
  values: string[][]
  selected: string
  onSelect: (id: string) => void
}) {
  const { colors } = useAppTheme()
  return (
    <View style={styles.choiceGroup}>
      <Text style={[styles.choiceTitle, { color: colors.text }]}>{title}</Text>
      {values.length ? <View style={styles.chips}>{values.map(([id, label]) => (
        <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected: id === selected }} onPress={() => onSelect(id)} style={[styles.chip, { borderColor: colors.border }, id === selected && styles.chipSelected]}>
          <Text style={[styles.chipText, { color: id === selected ? '#fff' : colors.text }, id === selected && styles.chipTextSelected]}>{label}</Text>
        </Pressable>
      ))}</View> : <Text style={styles.muted}>Select the parent item first.</Text>}
    </View>
  )
}

const cardColors: Record<ReturnType<typeof noteColorForId>, { backgroundColor: string }> = {
  lavender: { backgroundColor: '#f5effb' },
  mint: { backgroundColor: '#edf8f1' },
  peach: { backgroundColor: '#fff2e9' },
  blue: { backgroundColor: '#edf5fc' },
  yellow: { backgroundColor: '#fff9df' },
}

const styles = StyleSheet.create({
  page: { alignSelf: 'center', backgroundColor: '#ffffff', borderColor: '#e8e1ec', borderRadius: 20, borderWidth: 1, gap: 18, maxWidth: 980, padding: 24, width: '100%' },
  headerRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  back: { color: '#69448a', fontSize: 16, fontWeight: '700', paddingVertical: 4 },
  status: { alignItems: 'center', flexDirection: 'row', gap: 12, paddingVertical: 8 },
  error: { backgroundColor: '#fff0ef' },
  errorText: { color: '#8b2424', fontSize: 14, lineHeight: 20 },
  retry: { color: '#69448a', fontSize: 15, fontWeight: '700', marginTop: 8 },
  fileSection: { borderTopColor: '#e8e1ec', borderTopWidth: 1, gap: 10, paddingTop: 16 },
  sectionTitle: { color: '#30283d', fontSize: 20, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderColor: '#cfc5d7', borderRadius: 18, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
  chipSelected: { backgroundColor: '#69448a', borderColor: '#69448a' },
  chipText: { color: '#443b50', fontSize: 14 },
  chipTextSelected: { color: '#ffffff', fontWeight: '700' },
  headingRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  noteCard: { aspectRatio: 1, borderColor: '#e8e1ec', borderRadius: 14, borderWidth: 1, flexBasis: 180, flexGrow: 1, maxWidth: 300, minHeight: 190, overflow: 'hidden', padding: 16 },
  cardOpen: { flex: 1, gap: 10, paddingRight: 28 },
  noteTitle: { color: '#30283d', fontSize: 18, fontWeight: '700' },
  preview: { color: '#51495a', fontSize: 14, lineHeight: 21 },
  saved: { color: '#53705b', fontSize: 12, marginTop: 'auto' },
  moreButton: { alignItems: 'center', borderRadius: 20, minHeight: 44, minWidth: 44, position: 'absolute', right: 7, top: 7, justifyContent: 'center' },
  moreText: { color: '#443b50', fontSize: 17, fontWeight: '700', letterSpacing: 1 },
  overlay: { alignItems: 'center', backgroundColor: '#0008', flex: 1, justifyContent: 'center', padding: 18 },
  modalScroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: 20 },
  modalCard: { backgroundColor: '#ffffff', borderRadius: 16, gap: 12, maxWidth: 560, padding: 22, width: '100%' },
  modalTitle: { color: '#30283d', fontSize: 22, fontWeight: '700' },
  menuButton: { borderColor: '#e8e1ec', borderRadius: 9, borderWidth: 1, minHeight: 46, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 10 },
  menuDanger: { borderColor: '#f0c7c4' },
  menuLabel: { color: '#443b50', fontSize: 15, fontWeight: '600' },
  dangerLabel: { color: '#9b2f2b' },
  modalActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end', marginTop: 8 },
  choiceGroup: { gap: 8, paddingVertical: 4 },
  choiceTitle: { color: '#30283d', fontSize: 15, fontWeight: '700' },
  muted: { color: '#6f6576', fontSize: 13 },
})
