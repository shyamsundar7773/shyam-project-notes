export type SupabaseConfiguration = {
  state: 'missing' | 'invalid' | 'ready'
  message: string
}

export function isValidSupabaseUrl(value: string): boolean {
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

export function isSafePublishableKey(value: string): boolean {
  if (value.startsWith('sb_publishable_')) {
    return value.length > 'sb_publishable_'.length
  }
  if (value.startsWith('sb_secret_')) {
    return false
  }

  const payloadPart = value.split('.')[1]
  if (!payloadPart) return false

  try {
    const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/')
    const payload: unknown = JSON.parse(atob(normalized))
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

export function describeSupabaseConfiguration(
  url: string,
  publishableKey: string,
  environmentFile: string,
): SupabaseConfiguration {
  if (!url || !publishableKey) {
    return {
      state: 'missing',
      message: `Supabase setup is required. Add ${environmentFile} and the public Supabase URL and publishable key.`,
    }
  }
  if (!isValidSupabaseUrl(url) || !isSafePublishableKey(publishableKey)) {
    return {
      state: 'invalid',
      message: 'Supabase setup needs attention. Check the public URL and publishable key configuration.',
    }
  }
  return {
    state: 'ready',
    message: 'Supabase configuration is present; a connection has not been verified.',
  }
}
