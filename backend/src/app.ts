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
  classifyProviderFailure,
  ConversionError,
} from './errors.js'
import {
  parseConvertedNotes,
  validateConvertRequest,
} from './notes.js'

export type ApiProviders = {
  verifyAccessToken: (token: string) => Promise<boolean>
  convertNotes: (text: string) => Promise<ReturnType<typeof parseConvertedNotes>>
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
        callback(null, Boolean(origin && origin === config.frontendOrigin))
      },
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

    if (!hasSupabaseAuthConfiguration(config)) {
      sendError(
        response,
        503,
        'AUTH_NOT_CONFIGURED',
        'Authentication is not configured on this server.',
      )
      return
    }

    const token = bearerToken(request)
    if (!token) {
      sendError(
        response,
        401,
        'UNAUTHENTICATED',
        'A valid bearer access token is required.',
      )
      return
    }

    try {
      if (!(await providers.verifyAccessToken(token))) {
        sendError(
          response,
          401,
          'UNAUTHENTICATED',
          'A valid bearer access token is required.',
        )
        return
      }
    } catch {
      sendError(
        response,
        503,
        'AUTH_UNAVAILABLE',
        'Authentication could not be verified right now.',
      )
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
      if (error instanceof ConversionError) {
        sendError(response, error.statusCode, error.code, error.message)
        return
      }

      if (isTimeout(error)) {
        sendError(
          response,
          504,
          'UPSTREAM_TIMEOUT',
          'Note conversion timed out. Please try again.',
        )
        return
      }

      if (classifyProviderFailure(error) === 'retryable') {
        sendError(
          response,
          503,
          'UPSTREAM_UNAVAILABLE',
          'Note conversion is temporarily unavailable.',
        )
        return
      }

      sendError(
        response,
        502,
        'UPSTREAM_FAILURE',
        'Note conversion could not be completed.',
      )
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
