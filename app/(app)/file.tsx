import { useLocalSearchParams } from 'expo-router'
import { ExpoPhase2Placeholder } from '../../src/components/ExpoPhase2Placeholder'

function one(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : ''
}

export default function FilePlaceholderScreen() {
  const params = useLocalSearchParams<{
    fileId?: string | string[]
    categoryId?: string | string[]
    topicId?: string | string[]
    subtopicId?: string | string[]
  }>()
  return (
    <ExpoPhase2Placeholder
      fileId={one(params.fileId)}
      kind="file"
      selection={{
        categoryId: one(params.categoryId),
        topicId: one(params.topicId),
        subtopicId: one(params.subtopicId),
      }}
    />
  )
}
