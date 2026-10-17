import { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
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
import { signOut } from '../../src/lib/expo-auth'
import {
  addTaxonomyRecordToWorkspace,
  createTaxonomyRecord,
  deleteTaxonomyRecord,
  fileRouteForFile,
  filesForSubtopic,
  isValidTaxonomyPath,
  loadWorkspaceData,
  normalizeTaxonomySelection,
  notesRouteForSelection,
  renameTaxonomyRecord,
  type TaxonomyRecord,
  type TaxonomySelection,
  type TaxonomyTable,
  type WorkspaceData,
} from '../../src/lib/phase1'
import { useExpoAuth } from '../../src/components/ExpoAuthContext'
import { ExpoScreen } from '../../src/components/ExpoScreen'
import { TaxonomyPicker } from '../../src/components/TaxonomyPicker'
import { ThemeToggle } from '../../src/components/ThemeProvider'
import { useAppTheme } from '../../src/components/ThemeContext'
import { screenStyles } from '../../src/components/expo-screen-styles'

const emptySelection: TaxonomySelection = {
  categoryId: '',
  topicId: '',
  subtopicId: '',
}

export default function HomeScreen() {
  const { client, session, configuration } = useExpoAuth()
  const { colors } = useAppTheme()
  const { created } = useLocalSearchParams<{ created?: string }>()
  const [data, setData] = useState<WorkspaceData | null>(null)
  const [selection, setSelection] = useState(emptySelection)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')

  const refresh = useCallback(async () => {
    if (!client) {
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError('')
    try {
      const nextData = await loadWorkspaceData(client)
      setData(nextData)
      setSelection((current) => normalizeTaxonomySelection(nextData, current))
    } catch (error) {
      setData(null)
      setLoadError(
        error instanceof Error
          ? error.message
          : 'Your cloud workspace could not be loaded. Check your connection and try again.',
      )
    } finally {
      setLoading(false)
    }
  }, [client])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh]),
  )

  async function handleSignOut() {
    if (!client || signingOut) return
    setSigningOut(true)
    setSignOutError('')
    setSignOutError((await signOut(client)) ?? '')
    setSigningOut(false)
  }

  async function handleRename(
    table: TaxonomyTable,
    record: TaxonomyRecord,
    name: string,
  ): Promise<boolean> {
    if (!client) return false
    setActionError('')
    setNotice('')
    try {
      await renameTaxonomyRecord(client, table, record.id, name)
      setNotice(`${taxonomyLabel(table)} renamed successfully.`)
      await refresh()
      return true
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'The name could not be saved. Try again.',
      )
      return false
    }
  }

  async function handleCreate(
    table: TaxonomyTable,
    name: string,
  ): Promise<boolean> {
    if (!client || !data) return false
    setActionError('')
    setNotice('')
    try {
      const createdRecord = await createTaxonomyRecord(
        client,
        table,
        name,
        selection,
      )
      setData((current) =>
        addTaxonomyRecordToWorkspace(current ?? data, table, createdRecord),
      )
      setSelection((current) => {
        if (table === 'categories') {
          return { categoryId: createdRecord.id, topicId: '', subtopicId: '' }
        }
        if (table === 'topics') {
          return { ...current, topicId: createdRecord.id, subtopicId: '' }
        }
        return { ...current, subtopicId: createdRecord.id }
      })
      setNotice(`${taxonomyLabel(table)} created successfully.`)
      return true
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : `The ${taxonomyLabel(table).toLowerCase()} could not be created. Try again.`,
      )
      return false
    }
  }

  async function handleDelete(
    table: TaxonomyTable,
    record: TaxonomyRecord,
  ): Promise<boolean> {
    if (!client) return false
    setActionError('')
    setNotice('')
    try {
      await deleteTaxonomyRecord(client, table, record.id)
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'The item could not be deleted. Refresh and try again.',
      )
      await refresh()
      return false
    }

    setNotice(`${taxonomyLabel(table)} deleted successfully.`)
    await refresh()
    return true
  }

  const selectedPath = {
    category_id: selection.categoryId,
    topic_id: selection.topicId,
    subtopic_id: selection.subtopicId,
  }
  const validSelection = data
    ? isValidTaxonomyPath(selectedPath, data)
    : false
  const visibleFiles =
    data && validSelection
      ? filesForSubtopic(
          data,
          selection.categoryId,
          selection.topicId,
          selection.subtopicId,
        )
      : []

  return (
    <ExpoScreen scroll>
      <View style={[styles.page, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.header}>
          <View style={styles.brand}>
            <Text style={screenStyles.eyebrow}>PERSONAL WORKSPACE</Text>
            <Text accessibilityRole="header" style={[styles.brandTitle, { color: colors.text }]}>
              Shyam Project Notes
            </Text>
          </View>
          <ThemeToggle />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: signingOut }}
            disabled={signingOut}
            onPress={() => void handleSignOut()}
            style={({ pressed }) => [
              styles.signOutButton,
              { borderColor: colors.border },
              pressed && !signingOut && styles.pressed,
              signingOut && screenStyles.buttonDisabled,
            ]}
          >
            <Text style={[styles.signOutText, { color: colors.text }]}>
              {signingOut ? 'Signing out…' : 'Sign out'}
            </Text>
          </Pressable>
        </View>
        <Text style={[styles.account, { color: colors.mutedText }]}>
          Signed in as {session?.user.email ?? 'your Supabase account'}
        </Text>
        {signOutError ? (
          <Text accessibilityRole="alert" style={[screenStyles.notice, screenStyles.errorNotice, { backgroundColor: colors.errorBackground, color: colors.errorText }]}>
            {signOutError}
          </Text>
        ) : null}

        <View style={[styles.section, { borderTopColor: colors.border }]}>
          <View style={styles.headingRow}>
            <View style={styles.headingCopy}>
              <Text accessibilityRole="header" style={[screenStyles.title, { color: colors.text }]}>
                My Practiced Notes
              </Text>
              <Text style={[screenStyles.body, { color: colors.mutedText }]}>
                Choose a Category, Topic, and Subtopic to open its files.
              </Text>
            </View>
          </View>

          {created === '1' ? (
            <Text accessibilityLiveRegion="polite" style={[screenStyles.notice, screenStyles.infoNotice, { backgroundColor: colors.infoBackground, color: colors.infoText }]}>
              File added successfully.
            </Text>
          ) : null}
          {notice ? (
            <Text accessibilityLiveRegion="polite" style={[screenStyles.notice, screenStyles.infoNotice, { backgroundColor: colors.infoBackground, color: colors.infoText }]}>
              {notice}
            </Text>
          ) : null}
          {actionError ? (
            <Text accessibilityRole="alert" style={[screenStyles.notice, screenStyles.errorNotice, { backgroundColor: colors.errorBackground, color: colors.errorText }]}>
              {actionError}
            </Text>
          ) : null}
          {loading ? (
            <View style={styles.statusRow}>
              <ActivityIndicator color={colors.accent} />
              <Text style={[screenStyles.body, { color: colors.mutedText }]}>Loading your cloud workspace…</Text>
            </View>
          ) : loadError ? (
            <>
              <Text accessibilityRole="alert" style={[screenStyles.notice, screenStyles.errorNotice, { backgroundColor: colors.errorBackground, color: colors.errorText }]}>
                {loadError}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void refresh()}
                style={screenStyles.secondaryButton}
              >
                <Text style={screenStyles.secondaryText}>Try again</Text>
              </Pressable>
            </>
          ) : !data ? (
            <Text accessibilityRole="alert" style={[screenStyles.notice, screenStyles.errorNotice, { backgroundColor: colors.errorBackground, color: colors.errorText }]}>
              {configuration.message}
            </Text>
          ) : (
            <>
              {data.categories.length === 0 ? (
                <Text style={[screenStyles.notice, screenStyles.infoNotice, { backgroundColor: colors.infoBackground, color: colors.infoText }]}>
                  No Categories are available for this account yet. No example
                  or local-only records are shown.
                </Text>
              ) : null}
              <TaxonomyPicker
                data={data}
                onCreate={handleCreate}
                onChange={setSelection}
                onDelete={handleDelete}
                onRename={handleRename}
                selection={selection}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !validSelection }}
                disabled={!validSelection}
                onPress={() => router.push(notesRouteForSelection(selection) as Href)}
                style={({ pressed }) => [
                  screenStyles.button,
                  !validSelection && screenStyles.buttonDisabled,
                  pressed && validSelection && styles.pressed,
                ]}
              >
                <Text style={screenStyles.buttonText}>Open Notes</Text>
              </Pressable>
              <View style={[styles.filesSection, { borderTopColor: colors.border }]}>
                <Text accessibilityRole="header" style={[styles.fileHeading, { color: colors.text }]}>
                  Files in this Subtopic
                </Text>
                {!validSelection ? (
                  <Text style={[styles.emptyText, { color: colors.mutedText }]}>
                    Select a complete Category → Topic → Subtopic path to view
                    its files.
                  </Text>
                ) : visibleFiles.length === 0 ? (
                  <Text style={[styles.emptyText, { color: colors.mutedText }]}>
                    No files in this Subtopic yet. Open Notes to add your first note.
                  </Text>
                ) : (
                  <View style={styles.files}>
                    {visibleFiles.map((file) => (
                      <View key={file.id} style={[styles.fileRow, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
                        <View style={styles.fileCopy}>
                          <Text style={[styles.fileName, { color: colors.text }]}>{file.name}</Text>
                          <Text style={[styles.filePath, { color: colors.mutedText }]}>Saved file</Text>
                        </View>
                        <Pressable
                          accessibilityLabel={`Open file ${file.name}`}
                          accessibilityRole="button"
                          onPress={() => router.push(fileRouteForFile(file) as Href)}
                          style={screenStyles.secondaryButton}
                        >
                          <Text style={[screenStyles.secondaryText, { color: colors.accentText }]}>Open file</Text>
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </>
          )}
        </View>
      </View>
    </ExpoScreen>
  )
}

const styles = StyleSheet.create({
  page: {
    alignSelf: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#e8e1ec',
    borderRadius: 20,
    borderWidth: 1,
    gap: 18,
    maxWidth: 900,
    padding: 24,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    justifyContent: 'space-between',
  },
  brand: {
    gap: 4,
  },
  brandTitle: {
    color: '#30283d',
    fontSize: 22,
    fontWeight: '700',
  },
  account: {
    color: '#6f6576',
    fontSize: 14,
  },
  signOutButton: {
    alignItems: 'center',
    borderColor: '#cfc5d7',
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
  },
  signOutText: {
    color: '#443b50',
    fontSize: 15,
    fontWeight: '700',
  },
  section: {
    borderTopColor: '#e8e1ec',
    borderTopWidth: 1,
    gap: 18,
    paddingTop: 22,
  },
  headingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    justifyContent: 'space-between',
  },
  headingCopy: {
    flex: 1,
    gap: 8,
    minWidth: 240,
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 8,
  },
  filesSection: {
    borderTopColor: '#e8e1ec',
    borderTopWidth: 1,
    gap: 12,
    paddingTop: 18,
  },
  fileHeading: {
    color: '#30283d',
    fontSize: 19,
    fontWeight: '700',
  },
  emptyText: {
    color: '#6f6576',
    fontSize: 15,
    lineHeight: 22,
  },
  files: {
    gap: 10,
  },
  fileRow: {
    alignItems: 'center',
    backgroundColor: '#faf9fb',
    borderColor: '#e8e1ec',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
    padding: 14,
  },
  fileCopy: {
    flex: 1,
    gap: 4,
    minWidth: 180,
  },
  fileName: {
    color: '#30283d',
    fontSize: 16,
    fontWeight: '700',
  },
  filePath: {
    color: '#6f6576',
    fontSize: 12,
  },
  pressed: {
    opacity: 0.8,
  },
})

function taxonomyLabel(table: TaxonomyTable): string {
  if (table === 'categories') return 'Category'
  if (table === 'topics') return 'Topic'
  return 'Subtopic'
}
