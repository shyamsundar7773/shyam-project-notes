export type SqlAiResult = {
  output: string
  evaluation: string
}

export type MarkdownAiResult = {
  convertedMarkdown: string
}

type AiRequest =
  | {
      kind: 'sql'
      content: string
      accessToken: string
      question?: string
    }
  | { kind: 'markdown'; content: string; accessToken: string }

export type PracticeSqlResult = {
  columns: string[]
  rows: Array<Record<string, string | number | boolean | null>>
  rowLimit: number
  truncated: boolean
}

export async function evaluateSqlWithAi(
  input: {
    question: string
    sql: string
    accessToken: string
  },
  options: {
    baseUrl: string
    fetcher?: typeof fetch
    timeoutMs?: number
  },
): Promise<SqlAiResult> {
  if (!input.question.trim()) {
    throw new Error('Enter a practice question before requesting an evaluation.')
  }
  if (!input.sql.trim()) {
    throw new Error('Enter a SQL query before requesting an evaluation.')
  }
  if (!input.accessToken.trim()) {
    throw new Error('Your sign-in session has expired. Sign in again and retry.')
  }
  const result = await requestNoteAi(
    {
      kind: 'sql',
      content: input.sql,
      question: input.question,
      accessToken: input.accessToken,
    },
    options,
  )
  if (!('evaluation' in result)) {
    throw new Error('The AI service returned an invalid evaluation.')
  }
  return result
}

async function withRequestDeadline<T>(
  operation: string,
  run: (signal: AbortSignal, startedAt: number) => Promise<T>,
  timeoutMs = 40_000,
): Promise<T> {
  const startedAt = Date.now()
  const controller = new AbortController()
  let timedOut = false
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  console.info(`[notes-ai] request started operation=${operation}`)
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true
      controller.abort()
      reject(new Error('The AI request timed out. Your source text is unchanged; retry when the backend is available.'))
    }, timeoutMs)
  })
  try {
    const result = await Promise.race([run(controller.signal, startedAt), timeout])
    console.info(`[notes-ai] response parsed operation=${operation} elapsed_ms=${Date.now() - startedAt}`)
    return result
  } catch (error) {
    const kind = error instanceof Error ? error.name : 'UnknownError'
    console.warn(`[notes-ai] request failed operation=${operation} elapsed_ms=${Date.now() - startedAt} error_kind=${kind}`)
    if (timedOut) {
      throw new Error('The AI request timed out. Your source text is unchanged; retry when the backend is available.', { cause: error })
    }
    throw error
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]'
  )
}

function isLocalNetworkHost(hostname: string): boolean {
  if (isLoopbackHost(hostname) || hostname.endsWith('.local')) return true
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false
  const octets = hostname.split('.').map(Number)
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false
  }
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  )
}

export function resolveBackendBaseUrl(
  configuredUrl: string,
  pageUrl: string,
): string {
  const page = new URL(pageUrl)
  const configured = configuredUrl.trim()
  if (!configured) {
    return page.protocol === 'http:' && isLocalNetworkHost(page.hostname)
      ? `http://${page.hostname}:3001`
      : ''
  }

  const backend = new URL(configured, page)
  if (
    page.protocol === 'http:' &&
    backend.protocol === 'http:' &&
    isLoopbackHost(backend.hostname) &&
    isLocalNetworkHost(page.hostname) &&
    !isLoopbackHost(page.hostname)
  ) {
    backend.hostname = page.hostname
  }
  return backend.origin
}

export function resolveExpoBackendBaseUrl(
  configuredUrl: string,
  platform: 'web' | 'ios' | 'android',
  webUrl = '',
  hostUri = '',
): string {
  if (configuredUrl.trim()) {
    return new URL(configuredUrl.trim()).origin
  }
  if (platform === 'web' && webUrl) {
    return resolveBackendBaseUrl('', webUrl)
  }
  if (platform !== 'web' && hostUri) {
    try {
      const host = new URL(`http://${hostUri}`).hostname
      if (isLocalNetworkHost(host)) return `http://${host}:3001`
    } catch {
      return ''
    }
  }
  return ''
}

export async function fetchPracticeSqlQuestion(
  baseUrl: string,
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<{ prompt: string; schema: string[] }> {
  return withRequestDeadline('sql-question', async (signal, startedAt) => {
    let response: Response
    try {
      response = await fetcher(`${baseUrl.replace(/\/+$/, '')}/api/notes/practice-question`, {
        headers: {
          authorization: String.fromCharCode(66, 101, 97, 114, 101, 114, 32) + accessToken,
        },
        signal,
      })
    } catch {
      throw new Error('The SQL practice service could not be reached. Retry when connected.')
    }
    console.info(`[notes-ai] backend response operation=sql-question status=${response.status} elapsed_ms=${Date.now() - startedAt}`)
    if (!response.ok) throw new Error('The SQL practice question could not be loaded.')
    let value: unknown
    try {
      value = await response.json()
    } catch {
      throw new Error('The SQL practice service returned an invalid question.')
    }
    if (
      typeof value !== 'object' ||
      value === null ||
      !('prompt' in value) ||
      typeof value.prompt !== 'string' ||
      !('schema' in value) ||
      !Array.isArray(value.schema) ||
      !value.schema.every((entry) => typeof entry === 'string')
    ) {
      throw new Error('The SQL practice service returned an invalid question.')
    }
    return { prompt: value.prompt, schema: value.schema }
  })
}

export async function executePracticeSql(
  baseUrl: string,
  accessToken: string,
  sql: string,
  fetcher: typeof fetch = fetch,
  question = '',
): Promise<PracticeSqlResult> {
  return withRequestDeadline('sql-execution', async (signal, startedAt) => {
    let response: Response
    try {
      response = await fetcher(`${baseUrl.replace(/\/+$/, '')}/api/notes/run-sql`, {
        method: 'POST',
        headers: {
          authorization:
            String.fromCharCode(66, 101, 97, 114, 101, 114, 32) + accessToken,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ sql, ...(question ? { question } : {}) }),
        signal,
      })
    } catch {
      throw new Error('The SQL practice service could not be reached. Retry when connected.')
    }
    console.info(`[notes-ai] backend response operation=sql-execution status=${response.status} elapsed_ms=${Date.now() - startedAt}`)
    if (!response.ok) {
      throw new Error('The SQL query could not run against the practice dataset.')
    }
    let value: unknown
    try {
      value = await response.json()
    } catch {
      throw new Error('The SQL practice service returned an invalid result.')
    }
    if (
      typeof value !== 'object' ||
      value === null ||
      !('columns' in value) ||
      !Array.isArray(value.columns) ||
      !value.columns.every((column) => typeof column === 'string') ||
      !('rows' in value) ||
      !Array.isArray(value.rows) ||
      !('rowLimit' in value) ||
      typeof value.rowLimit !== 'number' ||
      !('truncated' in value) ||
      typeof value.truncated !== 'boolean'
    ) {
      throw new Error('The SQL practice service returned an invalid result.')
    }
    return value as PracticeSqlResult
  })
}

export async function requestNoteAi(
  request: AiRequest,
  options: {
    baseUrl: string
    fetcher?: typeof fetch
    timeoutMs?: number
  },
): Promise<SqlAiResult | MarkdownAiResult> {
  const baseUrl = options.baseUrl.trim().replace(/\/+$/, '')
  if (!baseUrl) {
    throw new Error(
      'AI service is not configured. Set VITE_BACKEND_URL for Vite or EXPO_PUBLIC_API_BASE_URL for Expo to the backend origin.',
    )
  }
  if (!request.accessToken.trim()) {
    throw new Error('Your sign-in session has expired. Sign in again and retry.')
  }

  const endpoint =
    request.kind === 'sql'
      ? '/api/notes/evaluate-sql'
      : '/api/notes/convert-markdown'
  const operation =
    request.kind === 'sql' ? 'sql-evaluation' : 'markdown-conversion'
  const startedAt = Date.now()
  console.info(`[notes-ai] request started operation=${operation}`)
  const body =
    request.kind === 'sql'
      ? {
          sql: request.content,
          ...(request.question ? { question: request.question } : {}),
        }
      : { markdown: request.content }
  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs ?? 40_000)
  const requestTimeout = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener(
      'abort',
      () => reject(new Error('AI request timed out')),
      { once: true },
    )
  })
  let response: Response
  try {
    response = await Promise.race([
      (options.fetcher ?? fetch)(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${request.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      }),
      requestTimeout,
    ])
  } catch {
    clearTimeout(timeout)
    if (timedOut) {
      console.warn(`[notes-ai] request failed operation=${operation} stage=fetch elapsed_ms=${Date.now() - startedAt} error_category=timeout`)
      throw new Error(
        'The AI request timed out. Your source text is unchanged; retry when the backend is available.',
      )
    }
    console.warn(`[notes-ai] request failed operation=${operation} stage=fetch elapsed_ms=${Date.now() - startedAt} error_category=network_or_cors`)
    throw new Error(
      'The AI service did not return an HTTP response. Check your connection and backend URL; in a web browser, verify the backend allows this exact frontend origin (CORS). Your source text is unchanged.',
    )
  }
  console.info(`[notes-ai] backend response operation=${operation} status=${response.status} elapsed_ms=${Date.now() - startedAt}`)

  let result: unknown
  try {
    result = await Promise.race([response.json(), requestTimeout])
  } catch {
    clearTimeout(timeout)
    if (timedOut) {
      console.warn(`[notes-ai] request failed operation=${operation} stage=response elapsed_ms=${Date.now() - startedAt} error_category=timeout`)
      throw new Error(
        'The AI request timed out. Your source text is unchanged; retry when the backend is available.',
      )
    }
    if (!response.ok) {
      throw new Error(`The AI request failed with HTTP ${response.status}. Your source text is unchanged; retry or check the backend configuration.`)
    }
    console.warn(`[notes-ai] request failed operation=${operation} stage=response elapsed_ms=${Date.now() - startedAt} error_category=malformed_response`)
    throw new Error(
      'The AI service returned an invalid response. Your source text is unchanged.',
    )
  }
  clearTimeout(timeout)
  console.info(`[notes-ai] response parsed operation=${operation} elapsed_ms=${Date.now() - startedAt}`)

  if (!response.ok) {
    const backendMessage =
      typeof result === 'object' &&
      result !== null &&
      'error' in result &&
      typeof result.error === 'object' &&
      result.error !== null &&
      'message' in result.error &&
      typeof result.error.message === 'string'
        ? result.error.message
        : ''
    const message =
      response.status === 401
        ? 'Your sign-in session is missing or expired. Sign in again and retry.'
        : response.status === 403
          ? 'Your account is not authorized to use this AI action.'
          : response.status === 404
            ? 'The AI endpoint was not found. Check that the frontend uses the current backend URL and release.'
            : response.status === 429
              ? 'The AI service is rate limited. Wait a moment and retry.'
              : backendMessage ||
                `The AI request failed (HTTP ${response.status}). Your source text is unchanged; try again.`
    throw new Error(message)
  }

  if (
    request.kind === 'sql' &&
    typeof result === 'object' &&
    result !== null &&
    'output' in result &&
    typeof result.output === 'string' &&
    'evaluation' in result &&
    typeof result.evaluation === 'string'
  ) {
    return {
      output: result.output,
      evaluation: result.evaluation,
    }
  }

  if (
    request.kind === 'markdown' &&
    typeof result === 'object' &&
    result !== null &&
    'convertedMarkdown' in result &&
    typeof result.convertedMarkdown === 'string'
  ) {
    return { convertedMarkdown: result.convertedMarkdown }
  }

  throw new Error(
    'The AI service returned an invalid response. Your source text is unchanged.',
  )
}
