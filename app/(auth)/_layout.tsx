import { Redirect, Stack, type Href } from 'expo-router'
import { useExpoAuth } from '../../src/components/ExpoAuthContext'
import { LoadingScreen } from '../../src/components/ExpoScreen'

export default function AuthenticationLayout() {
  const { loading, session } = useExpoAuth()
  if (loading) return <LoadingScreen label="Restoring your session…" />
  if (session) return <Redirect href={'/home' as Href} />

  return <Stack screenOptions={{ title: 'Shyam Project Notes' }} />
}
