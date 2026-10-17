import { createContext, useContext } from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import type { SupabaseConfiguration } from '../lib/supabase-config'

export type AuthContextValue = {
  client: SupabaseClient | null
  configuration: SupabaseConfiguration
  loading: boolean
  session: Session | null
  recoverySessionActive: boolean
  restorationError: string
  clearRestorationError: () => void
  setRecoverySessionActive: (active: boolean) => void
}

export const ExpoAuthContext = createContext<AuthContextValue | null>(null)

export function useExpoAuth(): AuthContextValue {
  const context = useContext(ExpoAuthContext)
  if (!context) {
    throw new Error('ExpoAuthProvider is missing from the application tree.')
  }
  return context
}
