import cors from 'cors'
import { randomUUID } from 'node:crypto'
import express, {
  type ErrorRequestHandler,
  type Request,
  type Response,
} from 'express'
import {
  hasSupabaseAuthConfiguration,
  type ServerConfig,
} from './config.js'
import {
  parseMarkdownConversion,
  parseSqlEvaluation,
  validateAiText,
} from './ai-notes.js'
import {
  classifyProviderFailure,
  ConversionError,
} from './errors.js'
import { practiceSqlQuestion, runPracticeSql } from './practice-sql.js'
import {
  parseConvertedNotes,
  validateConvertRequest,
} from './notes.js'

export type ApiProviders = {
  verifyAccessToken: (token: string) => Promise<boolean>
  convertNotes: (text: string) => Promise<ReturnType<typeof parseConvertedNotes>>
  evaluateSql?: (
    sql: string,
    context?: { question: string; result: string },
    requestId?: string,
  ) => Promise<ReturnType<typeof parseSqlEvaluation>>
  convertMarkdown?: (markdown: string, requestId?: string) => Promise<string>
}

function requestId(response: Response): string {
  return response.locals.requestId as string
}

function requestOrigin(request: Request): string {
  const origin = request.header('origin')
  if (!origin) return 'none'
  try {
    const url = new URL(origin)
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === origin
      ? url.origin
      : 'invalid'
  } catch {
    return 'invalid'
  }
}

function logAuthStage(
  response: Response,
  result: 'passed' | 'rejected' | 'unavailable',
  errorCategory?: string,
): void {
  const id = response.locals.requestId
  if (typeof id !== 'string') return
  const category = errorCategory ? ` error_category=${errorCategory}` : ''
  const write = result === 'passed' ? console.info : console.warn
  write(
    `[notes-ai] timestamp_ms=${Date.now()} stage=backend-auth request_id=${id} operation=${response.locals.operation} result=${result}${category}`,
  )
}

function sendError(
  response: Response,
  status: number,
  code: string,
  message: string,
): void {
  response.status(status).json({ error: { code, message } })
}

function bearerToken(request: Request): string | null {
  const authorization = request.header('authorization')
  const match = authorization?.match(/^Bearer ([^\s]+)$/i)
  return match?.[1] ?? null
}

async function authorizeRequest(
  request: Request,
  response: Response,
  providers: ApiProviders,
  config: ServerConfig,
): Promise<boolean> {
  if (!hasSupabaseAuthConfiguration(config)) {
    logAuthStage(response, 'rejected', 'auth_not_configured')
    sendError(
      response,
      503,
      'AUTH_NOT_CONFIGURED',
      'Authentication is not configured on this server.',
    )
    return false
  }

  const token = bearerToken(request)
  if (!token) {
    logAuthStage(response, 'rejected', 'missing_bearer_token')
    sendError(
      response,
      401,
      'UNAUTHENTICATED',
      'A valid bearer access token is required.',
    )
    return false
  }

  try {
    if (!(await providers.verifyAccessToken(token))) {
      logAuthStage(response, 'rejected', 'invalid_bearer_token')
      sendError(
        response,
        401,
        'UNAUTHENTICATED',
        'A valid bearer access token is required.',
      )
      return false
    }
  } catch {
    logAuthStage(response, 'unavailable', 'auth_provider')
    sendError(
      response,
      503,
      'AUTH_UNAVAILABLE',
      'Authentication could not be verified right now.',
    )
    return false
  }

  logAuthStage(response, 'passed')
  return true
}

function sendProviderFailure(response: Response, error: unknown): void {
  if (error instanceof ConversionError) {
    sendError(response, error.statusCode, error.code, error.message)
    return
  }

  if (isTimeout(error)) {
    sendError(
      response,
      504,
      'UPSTREAM_TIMEOUT',
      'The AI request timed out. Your note has not been changed.',
    )
    return
  }

  if (classifyProviderFailure(error) === 'retryable') {
    sendError(
      response,
      503,
      'UPSTREAM_UNAVAILABLE',
      'The AI service is temporarily unavailable. Your note has not been changed.',
    )
    return
  }

  sendError(
    response,
    502,
    'UPSTREAM_FAILURE',
    'The AI request could not be completed. Your note has not been changed.',
  )
}

function isTimeout(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }

  const name = 'name' in error ? error.name : undefined
  const code = 'code' in error ? error.code : undefined
  const status = 'status' in error ? error.status : undefined
  return (
    name === 'TimeoutError' ||
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    status === 408
  )
}

export function createApp(
  config: ServerConfig,
  providers: ApiProviders,
): express.Express {
  const app = express()

  app.use((request, response, next) => {
    const operation =
      request.path === '/api/notes/evaluate-sql'
        ? 'sql-evaluation'
        : request.path === '/api/notes/convert-markdown'
          ? 'markdown-conversion'
          : null
    if (operation) {
      const startedAt = Date.now()
      const suppliedId = request.header('x-request-id')
      const id =
        suppliedId && /^[\w-]{1,64}$/.test(suppliedId)
          ? suppliedId
          : randomUUID()
      response.locals.requestId = id
      response.locals.operation = operation
      response.setHeader('X-Request-Id', id)
      const requestStage =
        request.method === 'OPTIONS' ? 'preflight_received' : 'request_received'
      const responseStage =
        request.method === 'OPTIONS' ? 'preflight_response' : 'response'
      console.info(
        `[notes-ai] timestamp_ms=${Date.now()} request_id=${id} operation=${operation} stage=${requestStage} origin=${requestOrigin(request)} path=${request.path}`,
      )
      response.once('finish', () => {
        console.info(
          `[notes-ai] timestamp_ms=${Date.now()} request_id=${id} operation=${operation} stage=${responseStage} status=${response.statusCode} elapsed_ms=${Date.now() - startedAt}`,
        )
      })
    }
    next()
  })
  app.use(
    cors({
      origin: (origin, callback) => {
        callback(null, Boolean(origin && config.frontendOrigins.includes(origin)))
      },
      exposedHeaders: ['X-Request-Id'],
    }),
  )
  app.use(express.json({ limit: '512kb', strict: true }))

  app.get('/health', (_request, response) => {
    response.json({ status: 'ok' })
  })

  app.post('/api/notes/convert', async (request, response) => {
    const input = validateConvertRequest(request.body)
    if (!input) {
      sendError(
        response,
        400,
        'INVALID_REQUEST',
        'Provide non-empty note text within the supported size limit.',
      )
      return
    }

    if (!(await authorizeRequest(request, response, providers, config))) {
      return
    }

    if (!config.geminiApiKey || !config.geminiPrimaryModel) {
      sendError(
        response,
        503,
        'CONVERSION_NOT_CONFIGURED',
        'Note conversion is not configured on this server.',
      )
      return
    }

    try {
      const conversion = await providers.convertNotes(input.text)
      response.json({ conversion })
    } catch (error) {
      sendProviderFailure(response, error)
    }
  })

  app.post('/api/notes/evaluate-sql', async (request, response) => {
    const sql = validateAiText(request.body, 'sql')
    if (sql === null) {
      console.warn(
        `[notes-ai] timestamp_ms=${Date.now()} request_id=${requestId(response)} operation=sql-evaluation stage=validation result=rejected`,
      )
      sendError(
        response,
        400,
        'INVALID_REQUEST',
        'Provide SQL text within the supported size limit.',
      )
      return
    }
    console.info(
      `[notes-ai] timestamp_ms=${Date.now()} request_id=${requestId(response)} operation=sql-evaluation stage=validation result=passed`,
    )

    if (!(await authorizeRequest(request, response, providers, config))) {
      return
    }
    console.info(
      `[notes-ai] timestamp_ms=${Date.now()} request_id=${requestId(response)} operation=sql-evaluation stage=gemini_configuration configured=${Boolean(config.geminiApiKey && config.geminiPrimaryModel)}`,
    )
    if (!config.geminiApiKey || !config.geminiPrimaryModel) {
      sendError(
        response,
        503,
        'CONVERSION_NOT_CONFIGURED',
        'AI evaluation is not configured on this server.',
      )
      return
    }
    if (!providers.evaluateSql) {
      sendError(
        response,
        503,
        'AI_EVALUATION_UNAVAILABLE',
        'AI evaluation is unavailable on this server.',
      )
      return
    }

    const question =
      typeof request.body.question === 'string'
        ? request.body.question.slice(0, 2_000)
        : ''
    const executionResult =
      typeof request.body.executionResult === 'string'
        ? request.body.executionResult.slice(0, 20_000)
        : ''

    try {
      const result = await providers.evaluateSql(
        sql,
        question && executionResult
          ? { question, result: executionResult }
          : undefined,
        requestId(response),
      )
      response.json({ output: result.output, evaluation: result.evaluation })
    } catch (error) {
      sendProviderFailure(response, error)
    }
  })

  app.get('/api/notes/practice-question', async (request, response) => {
    if (!(await authorizeRequest(request, response, providers, config))) return
    response.json(practiceSqlQuestion)
  })

  app.post('/api/notes/run-sql', async (request, response) => {
    if (!(await authorizeRequest(request, response, providers, config))) return
    const sql = validateAiText(request.body, 'sql')
    if (sql === null) {
      sendError(
        response,
        400,
        'INVALID_REQUEST',
        'Provide SQL text within the supported size limit.',
      )
      return
    }

    try {
      response.json(runPracticeSql(sql))
    } catch {
      sendError(
        response,
        400,
        'SQL_EXECUTION_FAILED',
        'The query could not run against the practice tables. Check table and column names, then retry.',
      )
    }
  })

  app.post('/api/notes/convert-markdown', async (request, response) => {
    const markdown = validateAiText(request.body, 'markdown')
    if (markdown === null) {
      console.warn(
        `[notes-ai] timestamp_ms=${Date.now()} request_id=${requestId(response)} operation=markdown-conversion stage=validation result=rejected`,
      )
      sendError(
        response,
        400,
        'INVALID_REQUEST',
        'Provide Markdown text within the supported size limit.',
      )
      return
    }
    console.info(
      `[notes-ai] timestamp_ms=${Date.now()} request_id=${requestId(response)} operation=markdown-conversion stage=validation result=passed`,
    )

    if (!(await authorizeRequest(request, response, providers, config))) {
      return
    }
    console.info(
      `[notes-ai] timestamp_ms=${Date.now()} request_id=${requestId(response)} operation=markdown-conversion stage=gemini_configuration configured=${Boolean(config.geminiApiKey && config.geminiPrimaryModel)}`,
    )
    if (!config.geminiApiKey || !config.geminiPrimaryModel) {
      sendError(
        response,
        503,
        'CONVERSION_NOT_CONFIGURED',
        'Markdown conversion is not configured on this server.',
      )
      return
    }
    if (!providers.convertMarkdown) {
      sendError(
        response,
        503,
        'MARKDOWN_CONVERSION_UNAVAILABLE',
        'Markdown conversion is unavailable on this server.',
      )
      return
    }

    try {
      const convertedMarkdown = parseMarkdownConversion(
        await providers.convertMarkdown(markdown, requestId(response)),
      )
      response.json({ convertedMarkdown })
    } catch (error) {
      sendProviderFailure(response, error)
    }
  })

  const errorHandler: ErrorRequestHandler = (
    error,
    _request,
    response,
    next,
  ) => {
    void next
    if (typeof error === 'object' && error !== null && 'type' in error) {
      if (error.type === 'entity.too.large') {
        sendError(
          response,
          413,
          'REQUEST_TOO_LARGE',
          'Request body is too large.',
        )
        return
      }
      if (error.type === 'entity.parse.failed') {
        sendError(response, 400, 'INVALID_JSON', 'Request body must be valid JSON.')
        return
      }
    }

    sendError(response, 500, 'INTERNAL_ERROR', 'The request could not be completed.')
  }
  app.use(errorHandler)

  return app
}
