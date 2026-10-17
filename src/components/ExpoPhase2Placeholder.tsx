import { useEffect, useState } from 'react'
import { Link, type Href } from 'expo-router'
import { Pressable, Text, View } from 'react-native'
import { useExpoAuth } from './ExpoAuthContext'
import { ExpoScreen } from './ExpoScreen'
import { screenStyles } from './expo-screen-styles'
import {
  filesForSubtopic,
  isValidTaxonomyPath,
  loadWorkspaceData,
  type TaxonomySelection,
  type WorkspaceData,
} from '../lib/phase1'

type Props =
  | { kind: 'notes'; selection: TaxonomySelection }
  | {
      kind: 'file'
      fileId: string
      selection: TaxonomySelection
    }

export function ExpoPhase2Placeholder(props: Props) {
  const { client } = useExpoAuth()
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!client) return
    let active = true
    void loadWorkspaceData(client)
      .then((data) => {
        if (active) setWorkspace(data)
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'The cloud workspace could not be checked.',
          )
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [client])

  const validPath =
    workspace !== null && isValidTaxonomyPath(
      {
        category_id: props.selection.categoryId,
        topic_id: props.selection.topicId,
        subtopic_id: props.selection.subtopicId,
      },
      workspace,
    )
  const matchingFiles =
    workspace && validPath
      ? filesForSubtopic(
          workspace,
          props.selection.categoryId,
          props.selection.topicId,
          props.selection.subtopicId,
        )
      : []
  const file = props.kind === 'file'
    ? matchingFiles.find((candidate) => candidate.id === props.fileId)
    : null
  const validDestination = props.kind === 'notes' ? validPath : file !== null

  return (
    <ExpoScreen scroll>
      <View style={screenStyles.card}>
        <Text style={screenStyles.eyebrow}>PHASE 2</Text>
        <Text accessibilityRole="header" style={screenStyles.title}>
          {props.kind === 'notes'
            ? 'Notes collection'
            : file?.name ?? 'File'}
        </Text>
        {!client ? (
          <Text accessibilityRole="alert" style={[screenStyles.notice, screenStyles.errorNotice]}>
            Authentication is unavailable. Return to sign in and try again.
          </Text>
        ) : loading ? (
          <Text accessibilityLiveRegion="polite" style={screenStyles.body}>
            Verifying the selected cloud record…
          </Text>
        ) : error ? (
          <Text accessibilityRole="alert" style={[screenStyles.notice, screenStyles.errorNotice]}>
            {error}
          </Text>
        ) : !validDestination ? (
          <Text accessibilityRole="alert" style={[screenStyles.notice, screenStyles.errorNotice]}>
            This Category, Topic, Subtopic, or file is no longer available in
            your workspace. Return Home and select a current record.
          </Text>
        ) : (
          <Text style={screenStyles.body}>
            The full notes collection and note editor are awaiting Phase 2.
            No sample notes are displayed, and editing or saving notes is not
            available on this screen.
          </Text>
        )}
        <Link href={'/home' as Href} asChild>
          <Pressable accessibilityRole="link" style={screenStyles.secondaryButton}>
            <Text style={screenStyles.secondaryText}>Return Home</Text>
          </Pressable>
        </Link>
      </View>
    </ExpoScreen>
  )
}
