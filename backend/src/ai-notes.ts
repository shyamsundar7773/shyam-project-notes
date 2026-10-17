export const MAX_AI_NOTE_CHARACTERS = 20_000
export const MAX_AI_RESULT_CHARACTERS = 40_000

export type SqlEvaluation = {
  output: string
  evaluation: string
}

export function validateAiText(
  body: unknown,
  field: 'sql' | 'markdown',
): string | null {
  if (typeof body !== 'object' || body === null) {
    return null
  }

  const value =
    field === 'sql'
      ? 'sql' in body
        ? body.sql
        : undefined
      : 'markdown' in body
        ? body.markdown
        : undefined
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > MAX_AI_NOTE_CHARACTERS
  ) {
    return null
  }

  return value
}

export function parseSqlEvaluation(value: string): SqlEvaluation {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('Invalid structured AI response.')
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('output' in parsed) ||
    typeof parsed.output !== 'string' ||
    !('evaluation' in parsed) ||
    typeof parsed.evaluation !== 'string' ||
    !parsed.output.trim() ||
    !parsed.evaluation.trim() ||
    parsed.output.length > MAX_AI_RESULT_CHARACTERS ||
    parsed.evaluation.length > MAX_AI_RESULT_CHARACTERS
  ) {
    throw new Error('Invalid structured AI response.')
  }

  return {
    output: parsed.output,
    evaluation: parsed.evaluation,
  }
}

export function parseMarkdownConversion(value: string): string {
  const converted = value.trim()
  if (!converted || converted.length > MAX_AI_RESULT_CHARACTERS) {
    throw new Error('Invalid Markdown conversion response.')
  }
  return converted
}
