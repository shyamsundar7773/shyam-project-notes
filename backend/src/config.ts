export type Environment = Record<string, string | undefined>

export type ServerConfig = {
  geminiApiKey: string
  geminiPrimaryModel: string
  supabaseUrl: string
  supabasePublishableKey: string
  frontendOrigins: string[]
}

const defaultFrontendOrigins = ['https://shyam-project-notes.netlify.app']

function parseFrontendOrigins(value: string | undefined): string[] {
  return [
    ...new Set(
      [
        ...defaultFrontendOrigins,
        ...(value ?? '')
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => {
            if (!origin) return false
            try {
              const parsed = new URL(origin)
              return (
                (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
                parsed.origin === origin
              )
            } catch {
              return false
            }
          }),
      ],
    ),
  ]
}

export function parseConfig(env: Environment): ServerConfig {
  return {
    geminiApiKey: env.GEMINI_API_KEY?.trim() ?? '',
    geminiPrimaryModel: env.GEMINI_PRIMARY_MODEL?.trim() ?? '',
    supabaseUrl: env.SUPABASE_URL?.trim() ?? '',
    supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY?.trim() ?? '',
    frontendOrigins: parseFrontendOrigins(env.FRONTEND_ORIGIN),
  }
}

function isPublishableKey(value: string): boolean {
  if (value.startsWith('sb_publishable_')) {
    return value.length > 'sb_publishable_'.length
  }

  if (value.startsWith('sb_secret_')) {
    return false
  }

  const payload = value.split('.')[1]
  if (!payload) {
    return false
  }

  try {
    const claims: unknown = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    )
    return (
      typeof claims === 'object' &&
      claims !== null &&
      'role' in claims &&
      claims.role === 'anon'
    )
  } catch {
    return false
  }
}

export function hasSupabaseAuthConfiguration(config: ServerConfig): boolean {
  if (
    !config.supabaseUrl ||
    !isPublishableKey(config.supabasePublishableKey)
  ) {
    return false
  }

  try {
    const url = new URL(config.supabaseUrl)
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.hostname.length > 0
    )
  } catch {
    return false
  }
}
