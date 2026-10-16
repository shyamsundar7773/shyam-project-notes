export type ProviderFailureKind =
  | 'retryable'
  | 'model-unavailable'
  | 'permanent'

function readStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return undefined
  }

  const { status } = error
  return typeof status === 'number' ? status : undefined
}

function readCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined
  }

  const { code } = error
  return typeof code === 'string' ? code : undefined
}

export function classifyProviderFailure(
  error: unknown,
): ProviderFailureKind {
  const status = readStatus(error)

  if (status === 404) {
    return 'model-unavailable'
  }

  if (
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  ) {
    return 'retryable'
  }

  if (status !== undefined) {
    return 'permanent'
  }

  if (
    error instanceof TypeError ||
    ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED'].includes(
      readCode(error) ?? '',
    )
  ) {
    return 'retryable'
  }

  return 'permanent'
}

export class ConversionError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ConversionError'
  }
}
