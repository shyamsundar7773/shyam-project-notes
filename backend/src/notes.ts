export const MAX_NOTE_CHARACTERS = 80_000

export type ConvertRequest = {
  text: string
}

export type ConvertedNotes = {
  title: string
  summary: string
  sections: Array<{
    heading: string
    content: string
  }>
  keyTakeaways: string[]
}

export function validateConvertRequest(
  body: unknown,
): ConvertRequest | null {
  if (
    typeof body !== 'object' ||
    body === null ||
    !('text' in body) ||
    typeof body.text !== 'string'
  ) {
    return null
  }

  if (
    body.text.trim().length === 0 ||
    body.text.length > MAX_NOTE_CHARACTERS
  ) {
    return null
  }

  return { text: body.text }
}

export function parseConvertedNotes(value: string): ConvertedNotes {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('Provider returned invalid structured output.')
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('title' in parsed) ||
    typeof parsed.title !== 'string' ||
    !('summary' in parsed) ||
    typeof parsed.summary !== 'string' ||
    !('sections' in parsed) ||
    !Array.isArray(parsed.sections) ||
    !('keyTakeaways' in parsed) ||
    !Array.isArray(parsed.keyTakeaways) ||
    !parsed.sections.every(
      (section) =>
        typeof section === 'object' &&
        section !== null &&
        'heading' in section &&
        typeof section.heading === 'string' &&
        'content' in section &&
        typeof section.content === 'string',
    ) ||
    !parsed.keyTakeaways.every(
      (takeaway) => typeof takeaway === 'string',
    )
  ) {
    throw new Error('Provider returned invalid structured output.')
  }

  return {
    title: parsed.title,
    summary: parsed.summary,
    sections: parsed.sections.map(({ heading, content }) => ({
      heading,
      content,
    })),
    keyTakeaways: parsed.keyTakeaways,
  }
}
