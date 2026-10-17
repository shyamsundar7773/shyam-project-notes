import { useCallback, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { router, useFocusEffect, type Href } from 'expo-router'
import { useExpoAuth } from '../../src/components/ExpoAuthContext'
import { ExpoScreen } from '../../src/components/ExpoScreen'
import { TaxonomyPicker } from '../../src/components/TaxonomyPicker'
import { ThemeToggle } from '../../src/components/ThemeProvider'
import { useAppTheme } from '../../src/components/ThemeContext'
import { screenStyles } from '../../src/components/expo-screen-styles'
import {
  createFile,
  loadWorkspaceData,
  validateCreateFileInput,
  type TaxonomySelection,
  type WorkspaceData,
} from '../../src/lib/phase1'

const emptySelection: TaxonomySelection = {
  categoryId: '',
  topicId: '',
  subtopicId: '',
}

export default function CreateFileScreen() {
  const { client, configuration } = useExpoAuth()
  const { colors } = useAppTheme()
  const [data, setData] = useState<WorkspaceData | null>(null)
  const [selection, setSelection] = useState(emptySelection)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const submissionLock = useRef(false)

  const loadData = useCallback(async () => {
    if (!client) {
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError('')
    try {
      setData(await loadWorkspaceData(client))
    } catch (loadFailure) {
      setData(null)
      setLoadError(
        loadFailure instanceof Error
          ? loadFailure.message
          : 'Cloud taxonomy could not be loaded. Check your connection and try again.',
      )
    } finally {
      setLoading(false)
    }
  }, [client])

  useFocusEffect(
    useCallback(() => {
      void loadData()
    }, [loadData]),
  )

  async function submit() {
    if (submissionLock.current || !client || !data) return
    setError('')
    const path = {
      category_id: selection.categoryId,
      topic_id: selection.topicId,
      subtopic_id: selection.subtopicId,
    }
    const validationError = validateCreateFileInput(name, selection, data)
    if (validationError) {
      setError(validationError)
      return
    }

    submissionLock.current = true
    setSaving(true)
    try {
      await createFile(client, name, path)
      router.replace('/home?created=1' as Href)
    } catch (saveFailure) {
      setError(
        saveFailure instanceof Error
          ? saveFailure.message
          : 'File could not be saved. Your entries are unchanged; check your connection and try again.',
      )
    } finally {
      submissionLock.current = false
      setSaving(false)
    }
  }

  return (
    <ExpoScreen scroll>
      <View style={[styles.page, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.header}>
          <Text style={screenStyles.eyebrow}>PERSONAL WORKSPACE</Text>
          <ThemeToggle />
        </View>
        <Text accessibilityRole="header" style={[screenStyles.title, { color: colors.text }]}>
          Create File
        </Text>
        <Text style={[screenStyles.body, { color: colors.mutedText }]}>
          Add a file to an existing Category → Topic → Subtopic. Taxonomy
          records are not created from this form.
        </Text>
        {error ? (
          <Text accessibilityRole="alert" style={[screenStyles.notice, screenStyles.errorNotice, { backgroundColor: colors.errorBackground, color: colors.errorText }]}>
            {error}
          </Text>
        ) : null}
        {loadError ? (
          <>
            <Text accessibilityRole="alert" style={[screenStyles.notice, screenStyles.errorNotice, { backgroundColor: colors.errorBackground, color: colors.errorText }]}>
              {loadError}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void loadData()}
              style={screenStyles.secondaryButton}
            >
              <Text style={screenStyles.secondaryText}>Try again</Text>
            </Pressable>
          </>
        ) : loading ? (
          <View style={styles.statusRow}>
            <ActivityIndicator color={colors.accent} />
            <Text style={[screenStyles.body, { color: colors.mutedText }]}>Loading your cloud taxonomy…</Text>
          </View>
        ) : !client ? (
          <Text accessibilityRole="alert" style={[screenStyles.notice, screenStyles.errorNotice, { backgroundColor: colors.errorBackground, color: colors.errorText }]}>
            {configuration.message}
          </Text>
        ) : data ? (
          <>
            <View style={styles.field}>
              <Text nativeID="file-name-label" style={[screenStyles.fieldLabel, { color: colors.text }]}>
                File Name *
              </Text>
              <TextInput
                accessibilityLabel="File Name"
                accessibilityLabelledBy="file-name-label"
                autoCapitalize="sentences"
                autoComplete="off"
                maxLength={120}
                onChangeText={setName}
                placeholder="Enter a file name"
                returnKeyType="next"
                style={[screenStyles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]}
                value={name}
              />
            </View>
            <TaxonomyPicker
              data={data}
              onChange={setSelection}
              selection={selection}
            />
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: saving }}
                disabled={saving}
                onPress={() => router.back()}
                style={screenStyles.secondaryButton}
              >
                <Text style={screenStyles.secondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: saving }}
                disabled={saving}
                onPress={() => void submit()}
                style={({ pressed }) => [
                  screenStyles.button,
                  saving && screenStyles.buttonDisabled,
                  pressed && !saving && styles.pressed,
                ]}
              >
                <Text style={screenStyles.buttonText}>
                  {saving ? 'Saving…' : 'Create File'}
                </Text>
              </Pressable>
            </View>
          </>
        ) : (
          <Text accessibilityRole="alert" style={[screenStyles.notice, screenStyles.errorNotice, { backgroundColor: colors.errorBackground, color: colors.errorText }]}>
            {configuration.message}
          </Text>
        )}
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
    maxWidth: 760,
    padding: 24,
    width: '100%',
  },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  field: {
    gap: 6,
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 8,
  },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    justifyContent: 'flex-end',
  },
  pressed: {
    opacity: 0.8,
  },
})
