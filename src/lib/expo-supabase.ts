import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Platform } from 'react-native'
import { canInitializeExpoSupabase } from './expo-runtime'
import { describeSupabaseConfiguration } from './supabase-config'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? ''
const publishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''

export const expoSupabaseConfiguration = describeSupabaseConfiguration(
  supabaseUrl,
  publishableKey,
  'EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local',
)

let expoSupabaseClient: SupabaseClient | null | undefined

export function getExpoSupabaseClient(): SupabaseClient | null {
  if (expoSupabaseClient !== undefined) return expoSupabaseClient

  if (!canInitializeExpoSupabase(Platform.OS, typeof window !== 'undefined')) {
    return null
  }

  expoSupabaseClient =
    expoSupabaseConfiguration.state === 'ready'
      ? createClient(supabaseUrl, publishableKey, {
          auth: {
            autoRefreshToken: true,
            detectSessionInUrl: false,
            persistSession: true,
            storage: AsyncStorage,
          },
        })
      : null

  return expoSupabaseClient
}
