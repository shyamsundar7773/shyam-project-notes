import { createClient, type SupabaseClient } from '@supabase/supabase-js'

type SupabaseConfiguration = {
  state: 'missing' | 'invalid' | 'ready'
  message: string
}

function isValidSupabaseUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.hostname.length > 0 &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}

function isSafePublishableKey(value: string): boolean {
  if (value.startsWith('sb_publishable_')) {
    return value.length > 'sb_publishable_'.length
  }

  if (value.startsWith('sb_secret_')) {
    return false
  }

  const payloadPart = value.split('.')[1]
  if (!payloadPart) {
    return false
  }

  try {
    const payload: unknown = JSON.parse(
      atob(payloadPart.replace(/-/g, '+').replace(/_/g, '/')),
    )
    return (
      typeof payload === 'object' &&
      payload !== null &&
      'role' in payload &&
      payload.role === 'anon'
    )
  } catch {
    return false
  }
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ''
const publishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''

const hasMissingValues = !supabaseUrl || !publishableKey
const hasValidConfiguration =
  isValidSupabaseUrl(supabaseUrl) && isSafePublishableKey(publishableKey)

export const supabaseConfiguration: SupabaseConfiguration = hasMissingValues
  ? {
      state: 'missing',
      message:
        'Supabase setup pending. Add the URL and publishable key to .env.local; this workspace is available without a connection.',
    }
  : hasValidConfiguration
    ? {
        state: 'ready',
        message:
          'Supabase configuration is present; a connection has not been verified.',
      }
    : {
        state: 'invalid',
        message:
          'Supabase setup needs attention. Check the URL and publishable key in your local environment file.',
      }

const supabaseClient: SupabaseClient | null = hasValidConfiguration
  ? createClient(supabaseUrl, publishableKey)
  : null

export function getSupabaseClient(): SupabaseClient | null {
  return supabaseClient
}
