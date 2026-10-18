import { Lexer, type Token, type Tokens } from 'marked'
import { parseDocument } from 'htmlparser2'

export type MarkdownInline =
  | { type: 'text' | 'strong' | 'emphasis' | 'code'; text: string }
  | { type: 'link'; text: string; href: string }

export type StoredMarkdownBlock = {
  id: string
  source: string
}

export type SafeHtmlStyle = {
  color?: string
  backgroundColor?: string
  borderColor?: string
  borderWidth?: number
  borderRadius?: number
  padding?: number
}

export type SafeHtmlNode = {
  tag: string
  text?: string
  href?: string
  style?: SafeHtmlStyle
  children?: SafeHtmlNode[]
}

const SAFE_HTML_TAGS = new Set([
  'a', 'b', 'br', 'div', 'em', 'i', 'kbd', 'p', 'span', 'strong', 'u',
])
const SAFE_COLOR_NAMES: Record<string, string> = {
  black: '#000000',
  blue: '#2563eb',
  green: '#16a34a',
  orange: '#f97316',
  purple: '#9333ea',
  white: '#ffffff',
}

function safeHtmlColor(value: string): string | undefined {
  const color = value.trim().toLowerCase()
  if (SAFE_COLOR_NAMES[color]) return SAFE_COLOR_NAMES[color]
  if (/^#[\da-f]{3}(?:[\da-f]{3})?(?:[\da-f]{2})?$/i.test(color)) return color
  const rgb = color.match(/^rgba?\(([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*(0|1|0?\.\d+))?\)$/)
  if (rgb && rgb.slice(1, 4).every((part) => Number(part) >= 0 && Number(part) <= 255)) {
    return color
  }
  return undefined
}

function safeHtmlStyles(styleText: string | undefined): SafeHtmlStyle | undefined {
  if (!styleText) return undefined
  const style: SafeHtmlStyle = {}
  for (const declaration of styleText.split(';')) {
    const separator = declaration.indexOf(':')
    if (separator < 0) continue
    const property = declaration.slice(0, separator).trim().toLowerCase()
    const value = declaration.slice(separator + 1).trim()
    if (property === 'color') style.color = safeHtmlColor(value)
    if (property === 'background' || property === 'background-color') {
      style.backgroundColor = safeHtmlColor(value)
    }
    if (property === 'padding' || property === 'border-radius') {
      const pixels = value.match(/^(\d{1,2})(?:px)?$/i)
      const amount = pixels ? Number(pixels[1]) : undefined
      if (amount !== undefined && amount <= 48) {
        if (property === 'padding') style.padding = amount
        else style.borderRadius = Math.min(amount, 24)
      }
    }
    if (property === 'border') {
      const border = value.match(/^(\d{1,2})(?:px)?\s+solid\s+(.+)$/i)
      const width = border ? Number(border[1]) : undefined
      const color = border?.[2] ? safeHtmlColor(border[2]) : undefined
      if (width !== undefined && width <= 8 && color) {
        style.borderWidth = width
        style.borderColor = color
      }
    }
  }
  return Object.values(style).some((value) => value !== undefined)
    ? style
    : undefined
}

export function parseSafeHtml(source: string): SafeHtmlNode[] {
  const document = parseDocument(source)
  const convert = (node: (typeof document.children)[number]): SafeHtmlNode[] => {
    if (node.type === 'text') {
      const text = node.data
      return text ? [{ tag: '#text', text }] : []
    }
    if (node.type !== 'tag' && node.type !== 'script' && node.type !== 'style') return []
    if (node.type === 'script' || node.type === 'style') return []
    const element = node as typeof node & {
      name: string
      attribs: Record<string, string>
      children: Array<(typeof document.children)[number]>
    }
    const children = element.children.flatMap(convert)
    const tag = element.name.toLowerCase()
    if (!SAFE_HTML_TAGS.has(tag)) return children
    if (tag === 'br') return [{ tag }]
    const href = tag === 'a' ? element.attribs.href : undefined
    const safeHref = href ? safeMarkdownHref(href) : undefined
    const style = safeHtmlStyles(element.attribs.style)
    return [{
      tag: tag === 'b' ? 'strong' : tag === 'i' ? 'em' : tag,
      ...(style ? { style } : {}),
      ...(safeHref ? { href: safeHref } : {}),
      children,
    }]
  }
  return document.children.flatMap(convert)
}

const MARKDOWN_BLOCKS_PREFIX = '<!-- SHYAM-MARKDOWN-BLOCKS:1 -->\n'
let markdownBlockSequence = 0

export function convertMarkdownSource(source: string): string {
  const normalized = source.replace(/\r\n?/g, '\n')
  if (!normalized.trim()) {
    throw new Error('Paste Markdown source before requesting conversion.')
  }
  return normalized
}

export function appendMarkdownBlock(existing: string, source: string): string {
  const block = convertMarkdownSource(source)
  return existing.trim()
    ? `${existing.trimEnd()}\n\n${block}`
    : block
}

export function getStoredMarkdownBlocks(source: string | null): StoredMarkdownBlock[] {
  if (!source?.trim()) return []
  if (source.startsWith(MARKDOWN_BLOCKS_PREFIX)) {
    try {
      const parsed: unknown = JSON.parse(source.slice(MARKDOWN_BLOCKS_PREFIX.length))
      if (
        Array.isArray(parsed) &&
        parsed.every(
          (block): block is StoredMarkdownBlock =>
            typeof block === 'object' &&
            block !== null &&
            'id' in block &&
            typeof block.id === 'string' &&
            'source' in block &&
            typeof block.source === 'string' &&
            Boolean(block.source.trim()),
        )
      ) {
        return parsed
      }
    } catch {
      return [{ id: 'legacy-markdown-0', source }]
    }
  }
  return [{ id: 'legacy-markdown-0', source }]
}

function serializeMarkdownBlocks(blocks: StoredMarkdownBlock[]): string | null {
  return blocks.length
    ? `${MARKDOWN_BLOCKS_PREFIX}${JSON.stringify(blocks)}`
    : null
}

function nextMarkdownBlockId(existing: StoredMarkdownBlock[]): string {
  const existingIds = new Set(existing.map((block) => block.id))
  let id: string
  do {
    markdownBlockSequence += 1
    id = `markdown-${Date.now().toString(36)}-${markdownBlockSequence.toString(36)}`
  } while (existingIds.has(id))
  return id
}

export function appendMarkdownToNote(
  existing: {
    markdown_output: string | null
    markdown_converted_source: string | null
  },
  source: string,
): {
  markdown_output: string
  markdown_converted_source: string
  block: StoredMarkdownBlock
} {
  const normalizedSource = convertMarkdownSource(source)
  const blocks = getStoredMarkdownBlocks(existing.markdown_output)
  const block = { id: nextMarkdownBlockId(blocks), source: normalizedSource }
  const nextBlocks = [...blocks, block]
  const previousSource =
    existing.markdown_converted_source ??
    blocks.map((storedBlock) => storedBlock.source).join('\n\n')
  return {
    markdown_output: serializeMarkdownBlocks(nextBlocks) ?? '',
    markdown_converted_source: appendMarkdownBlock(
      previousSource,
      normalizedSource,
    ),
    block,
  }
}

export function removeMarkdownBlockFromNote(
  existing: {
    markdown_output: string | null
    markdown_converted_source: string | null
  },
  blockId: string,
): {
  markdown_output: string | null
  markdown_converted_source: string | null
} {
  const blocks = getStoredMarkdownBlocks(existing.markdown_output)
  if (!blocks.some((block) => block.id === blockId)) {
    throw new Error('This Markdown block is no longer available. Refresh and retry.')
  }
  const remaining = blocks.filter((block) => block.id !== blockId)
  return {
    markdown_output: serializeMarkdownBlocks(remaining),
    markdown_converted_source: remaining.length
      ? remaining.map((block) => block.source).join('\n\n')
      : null,
  }
}

export function updateMarkdownBlockInNote(
  existing: {
    markdown_output: string | null
    markdown_converted_source: string | null
  },
  blockId: string,
  source: string,
): {
  markdown_output: string
  markdown_converted_source: string
} {
  const normalizedSource = convertMarkdownSource(source)
  const blocks = getStoredMarkdownBlocks(existing.markdown_output)
  let found = false
  const updated = blocks.map((block) => {
    if (block.id !== blockId) return block
    found = true
    return { ...block, source: normalizedSource }
  })
  if (!found) {
    throw new Error('This Markdown block is no longer available. Refresh and retry.')
  }
  return {
    markdown_output: serializeMarkdownBlocks(updated) ?? '',
    markdown_converted_source: updated.map((block) => block.source).join('\n\n'),
  }
}

export function getMarkdownBlockSource(
  existing: string | null,
  blockId: string,
): string {
  const block = getStoredMarkdownBlocks(existing).find(
    (storedBlock) => storedBlock.id === blockId,
  )
  if (!block) {
    throw new Error('This Markdown block is no longer available. Refresh and retry.')
  }
  return block.source
}

export function removeDuplicateMarkdownFromRoughNotes(
  sourceContent: string,
  convertedSource: string | null,
): string {
  if (!convertedSource?.trim()) return sourceContent
  if (sourceContent.trim() === convertedSource.trim()) return ''
  const suffix = `\n\n${convertedSource}`
  return sourceContent.endsWith(suffix)
    ? sourceContent.slice(0, -suffix.length).trimEnd()
    : sourceContent
}

export function parseMarkdown(source: string): Token[] {
  return Lexer.lex(source, { gfm: true })
}

export function splitMathSource(source: string): Array<{ text: string; math: boolean }> {
  const expression = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\]|(?<!\$)\$(?!\$)[^$\n]+\$/g
  const segments: Array<{ text: string; math: boolean }> = []
  let offset = 0
  for (const match of source.matchAll(expression)) {
    const start = match.index ?? 0
    if (start > offset) segments.push({ text: source.slice(offset, start), math: false })
    segments.push({ text: match[0], math: true })
    offset = start + match[0].length
  }
  if (offset < source.length) segments.push({ text: source.slice(offset), math: false })
  return segments.length ? segments : [{ text: source, math: false }]
}

export function stripTaskListMarker(tokens: Token[], checked: boolean): Token[] {
  let removed = false
  const marker = checked ? /^\s*\[x\]\s*/i : /^\s*\[ \]\s*/
  const visit = (items: Token[]): Token[] => items.flatMap((token) => {
    if (token.type === 'checkbox' && (token as Tokens.Checkbox).checked === checked) {
      removed = true
      return []
    }
    if (!removed && token.type === 'text') {
      const textToken = token as Tokens.Text
      if (marker.test(textToken.text)) {
        removed = true
        return [{ ...textToken, text: textToken.text.replace(marker, '') }]
      }
    }
    if ('tokens' in token && Array.isArray(token.tokens)) {
      return [{ ...token, tokens: visit(token.tokens) }]
    }
    return [token]
  })
  return visit(tokens)
}

export function safeMarkdownHref(href: string): string | null {
  if (/^(https?:|mailto:)/i.test(href)) return href
  if (/^[a-z][a-z\d+.-]*:/i.test(href)) return null
  return href
}
