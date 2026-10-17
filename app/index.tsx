import { Redirect, type Href } from 'expo-router'
import { routeForAuthState } from '../src/lib/expo-auth'
import { useExpoAuth } from '../src/components/ExpoAuthContext'
import { LoadingScreen } from '../src/components/ExpoScreen'

export default function ExpoFoundationHome() {
  const { loading, session } = useExpoAuth()
  const route = routeForAuthState(loading, session !== null)
  if (!route) return <LoadingScreen label="Restoring your session…" />
  return <Redirect href={route as Href} />
}
