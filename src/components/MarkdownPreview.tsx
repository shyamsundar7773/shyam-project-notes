import React, { type ReactNode } from 'react'

function inlineContent(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g)
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={key}>{part.slice(1, -1)}</code>
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={key}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={key}>{part.slice(1, -1)}</em>
    }
    return part
  })
}

export function MarkdownPreview({ source }: { source: string }) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let index = 0
  let keyIndex = 0

  while (index < lines.length) {
    const line = lines[index]
    const key = `markdown-${keyIndex++}`

    if (!line.trim()) {
      index += 1
      continue
    }
    if (line.startsWith('```')) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !lines[index].startsWith('```')) {
        code.push(lines[index])
        index += 1
      }
      if (index < lines.length) {
        index += 1
      }
      blocks.push(
        <pre key={key}>
          <code>{code.join('\n')}</code>
        </pre>,
      )
      continue
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      const depth = heading[1].length
      const content = inlineContent(heading[2], key)
      if (depth === 1) blocks.push(<h1 key={key}>{content}</h1>)
      else if (depth === 2) blocks.push(<h2 key={key}>{content}</h2>)
      else if (depth === 3) blocks.push(<h3 key={key}>{content}</h3>)
      else blocks.push(<h4 key={key}>{content}</h4>)
      index += 1
      continue
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*+]\s+/, ''))
        index += 1
      }
      blocks.push(
        <ul key={key}>
          {items.map((item, itemIndex) => (
            <li key={`${key}-item-${itemIndex}`}>
              {inlineContent(item, `${key}-item-${itemIndex}`)}
            </li>
          ))}
        </ul>,
      )
      continue
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, ''))
        index += 1
      }
      blocks.push(
        <ol key={key}>
          {items.map((item, itemIndex) => (
            <li key={`${key}-item-${itemIndex}`}>
              {inlineContent(item, `${key}-item-${itemIndex}`)}
            </li>
          ))}
        </ol>,
      )
      continue
    }

    if (line.startsWith('> ')) {
      blocks.push(
        <blockquote key={key}>
          {inlineContent(line.slice(2), key)}
        </blockquote>,
      )
      index += 1
      continue
    }

    blocks.push(<p key={key}>{inlineContent(line, key)}</p>)
    index += 1
  }

  return React.createElement('div', { className: 'markdown-preview' }, blocks)
}
