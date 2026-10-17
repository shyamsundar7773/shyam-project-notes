import cors from 'cors'
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
  ) => Promise<ReturnType<typeof parseSqlEvaluation>>
  convertMarkdown?: (markdown: string) => Promise<string>
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
      sendError(
        response,
        401,
        'UNAUTHENTICATED',
        'A valid bearer access token is required.',
      )
      return false
    }
  } catch {
    sendError(
      response,
      503,
      'AUTH_UNAVAILABLE',
      'Authentication could not be verified right now.',
    )
    return false
  }

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

  app.use(
    cors({
      origin: (origin, callback) => {
        callback(null, Boolean(origin && config.frontendOrigins.includes(origin)))
      },
    }),
  )
  app.use(express.json({ limit: '512kb', strict: true }))
  app.use((request, response, next) => {
    const operation =
      request.path === '/api/notes/evaluate-sql'
        ? 'sql-evaluation'
        : request.path === '/api/notes/convert-markdown'
          ? 'markdown-conversion'
          : null
    if (operation) {
      const startedAt = Date.now()
      console.info(`[notes-ai] route reached operation=${operation}`)
      response.once('finish', () => {
        console.info(
          `[notes-ai] route response operation=${operation} status=${response.statusCode} elapsed_ms=${Date.now() - startedAt}`,
        )
      })
    }
    next()
  })

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
      sendError(
        response,
        400,
        'INVALID_REQUEST',
        'Provide SQL text within the supported size limit.',
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
      sendError(
        response,
        400,
        'INVALID_REQUEST',
        'Provide Markdown text within the supported size limit.',
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
        await providers.convertMarkdown(markdown),
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
