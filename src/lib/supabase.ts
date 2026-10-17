import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { describeSupabaseConfiguration } from './supabase-config'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ''
const publishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''
const configuration = describeSupabaseConfiguration(
  supabaseUrl,
  publishableKey,
  'VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local',
)
export const supabaseConfiguration = {
  ...configuration,
  message:
    configuration.state === 'missing'
      ? 'Supabase setup pending. Add the URL and publishable key to .env.local; this workspace is available without a connection.'
      : configuration.message,
}

const supabaseClient: SupabaseClient | null =
  configuration.state === 'ready'
  ? createClient(supabaseUrl, publishableKey)
  : null

export function getSupabaseClient(): SupabaseClient | null {
  return supabaseClient
}
