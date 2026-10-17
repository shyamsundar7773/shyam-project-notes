import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { ExpoAuthContext, type AuthContextValue } from './ExpoAuthContext'
import {
  expoSupabaseConfiguration,
  getExpoSupabaseClient,
} from '../lib/expo-supabase'

const recoverySessionStorageKey = 'shyam-project-notes:recovery-session-active'

export function ExpoAuthProvider({ children }: PropsWithChildren) {
  const [client, setClient] = useState<SupabaseClient | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [recoverySessionActive, setRecoverySessionActiveState] = useState(false)
  const [loading, setLoading] = useState(true)
  const [restorationError, setRestorationError] = useState('')
  const clearRestorationError = useCallback(() => setRestorationError(''), [])
  const setRecoverySessionActive = useCallback((active: boolean) => {
    setRecoverySessionActiveState(active)
    const update = active
      ? AsyncStorage.setItem(recoverySessionStorageKey, 'true')
      : AsyncStorage.removeItem(recoverySessionStorageKey)
    void update.catch(() => {
      setRestorationError(
        'The recovery session could not be saved on this device. Keep this screen open until you update your password.',
      )
    })
  }, [])

  useEffect(() => {
    let active = true
    let receivedAuthEvent = false
    let unsubscribe: (() => void) | undefined

    void Promise.resolve()
      .then(() => getExpoSupabaseClient())
      .then((restoredClient) => {
        if (!active) return
        setClient(restoredClient)
        if (!restoredClient) {
          setLoading(false)
          return
        }

        const {
          data: { subscription },
        } = restoredClient.auth.onAuthStateChange((event, nextSession) => {
          receivedAuthEvent = true
          if (!active) return
          setSession(nextSession)
          if (event === 'INITIAL_SESSION') {
            void AsyncStorage.getItem(recoverySessionStorageKey)
              .then((storedRecoverySession) => {
                if (!active) return
                setRecoverySessionActive(
                  nextSession !== null && storedRecoverySession === 'true',
                )
                setLoading(false)
              })
              .catch(() => {
                if (!active) return
                setRecoverySessionActive(false)
                setRestorationError(
                  'The saved recovery session could not be restored. Request a fresh recovery email.',
                )
                setLoading(false)
              })
            return
          }
          if (event === 'PASSWORD_RECOVERY') {
            setRecoverySessionActive(nextSession !== null)
          } else if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') {
            setRecoverySessionActive(false)
          }
          setLoading(false)
          setRestorationError('')
        })
        unsubscribe = () => subscription.unsubscribe()

        return restoredClient.auth.getSession().then(async ({ data, error }) => {
          if (!active || receivedAuthEvent) return
          setSession(data.session)
          try {
            setRecoverySessionActive(
              data.session !== null &&
                (await AsyncStorage.getItem(recoverySessionStorageKey)) === 'true',
            )
          } catch {
            setRecoverySessionActive(false)
            setRestorationError(
              'The saved recovery session could not be restored. Request a fresh recovery email.',
            )
          }
          setLoading(false)
          if (error) {
            setRestorationError(
              'Your saved session could not be restored. Sign in again to continue.',
            )
          }
        })
      })
      .catch(() => {
        if (active) {
          setClient(null)
          setRestorationError(
            'Authentication could not be initialized. Check the app configuration and restart.',
          )
          setLoading(false)
        }
      })

    return () => {
      active = false
      unsubscribe?.()
    }
  }, [setRecoverySessionActive])

  const value = useMemo<AuthContextValue>(
    () => ({
      client,
      configuration: expoSupabaseConfiguration,
      loading,
      session,
      recoverySessionActive,
      restorationError,
      clearRestorationError,
      setRecoverySessionActive,
    }),
    [
      client,
      loading,
      session,
      recoverySessionActive,
      restorationError,
      clearRestorationError,
      setRecoverySessionActive,
    ],
  )

  return <ExpoAuthContext.Provider value={value}>{children}</ExpoAuthContext.Provider>
}
