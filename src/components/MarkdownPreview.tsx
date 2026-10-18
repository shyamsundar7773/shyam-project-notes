import React, { type ReactNode } from 'react'
import type { Token, Tokens } from 'marked'
import {
  getStoredMarkdownBlocks,
  parseSafeHtml,
  parseMarkdown,
  safeMarkdownHref,
  splitMathSource,
  stripTaskListMarker,
  type SafeHtmlNode,
} from '../lib/markdown'

function renderSafeHtml(nodes: SafeHtmlNode[], prefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${prefix}-${index}`
    if (node.tag === '#text') return node.text ?? ''
    const children = renderSafeHtml(node.children ?? [], key)
    const style: React.CSSProperties | undefined = node.style
      ? {
          color: node.style.color,
          backgroundColor: node.style.backgroundColor,
          borderColor: node.style.borderColor,
          borderWidth: node.style.borderWidth,
          borderStyle: node.style.borderWidth ? 'solid' : undefined,
          borderRadius: node.style.borderRadius,
          padding: node.style.padding,
        }
      : undefined
    if (node.tag === 'br') return <br key={key} />
    if (node.tag === 'div') return <div key={key} className="markdown-html-panel" style={style}>{children}</div>
    if (node.tag === 'a') {
      return node.href
        ? <a key={key} href={node.href} rel="noreferrer" target="_blank" style={style}>{children}</a>
        : <span key={key} style={style}>{children}</span>
    }
    const Tag = node.tag as 'span' | 'strong' | 'em' | 'u' | 'kbd' | 'p'
    return <Tag key={key} className={node.tag === 'kbd' ? 'markdown-kbd' : undefined} style={style}>{children}</Tag>
  })
}

function renderInline(tokens: Token[], prefix: string): ReactNode[] {
  const frames: Array<{ tag: string; style?: React.CSSProperties; href?: string; children: ReactNode[] }> = []
  const roots: ReactNode[] = []
  const append = (node: ReactNode) => (frames.at(-1)?.children ?? roots).push(node)
  const wrap = (tag: string, key: string, style: React.CSSProperties | undefined, children: ReactNode[], href?: string) => {
    if (tag === 'br') return <br key={key} />
    if (tag === 'kbd') return <kbd key={key} className="markdown-kbd" style={style}>{children}</kbd>
    if (tag === 'a') {
      return href
        ? <a key={key} href={href} rel="noreferrer" target="_blank" style={style}>{children}</a>
        : <span key={key} style={style}>{children}</span>
    }
    const Tag = tag as 'span' | 'strong' | 'em' | 'u' | 'a'
    return <Tag key={key} style={style}>{children}</Tag>
  }
  tokens.forEach((token, index) => {
    const key = `${prefix}-${index}`
    switch (token.type) {
      case 'strong':
        append(<strong key={key}>{renderInline((token as Tokens.Strong).tokens, key)}</strong>)
        break
      case 'em':
        append(<em key={key}>{renderInline((token as Tokens.Em).tokens, key)}</em>)
        break
      case 'del':
        append(<del key={key}>{renderInline((token as Tokens.Del).tokens, key)}</del>)
        break
      case 'codespan':
        append(<code key={key}>{(token as Tokens.Codespan).text}</code>)
        break
      case 'link': {
        const link = token as Tokens.Link
        const href = safeMarkdownHref(link.href)
        append(href
          ? <a key={key} href={href} rel="noreferrer" target="_blank">{renderInline(link.tokens, key)}</a>
          : <span key={key}>{renderInline(link.tokens, key)} ({link.href})</span>)
        break
      }
      case 'br':
        append(<br key={key} />)
        break
      case 'html': {
        const raw = (token as Tokens.HTML).text
        const match = raw.match(/^<\s*(\/?)\s*([a-z][\w-]*)([^>]*)>$/i)
        if (!match) {
          append(renderSafeHtml(parseSafeHtml(raw), key))
          break
        }
        const [, closing, rawTag] = match
        const originalTag = rawTag.toLowerCase()
        const tag = originalTag === 'b' ? 'strong' : originalTag === 'i' ? 'em' : originalTag
        const supportedInlineTag = ['a', 'br', 'em', 'kbd', 'span', 'strong', 'u'].includes(tag)
        if (tag === 'br' && !closing) {
          append(<br key={key} />)
          break
        }
        if (closing) {
          const frameIndex = frames.map((frame) => frame.tag).lastIndexOf(tag)
          if (frameIndex >= 0) {
            const frame = frames.splice(frameIndex, 1)[0]
            if (frame) append(wrap(frame.tag, key, frame.style, frame.children, frame.href))
          }
          break
        }
        if (!supportedInlineTag) break
        const parsed = parseSafeHtml(raw)[0]
        if (parsed && ['span', 'strong', 'em', 'u', 'kbd', 'a'].includes(parsed.tag)) {
          const style: React.CSSProperties | undefined = parsed.style
            ? { color: parsed.style.color, backgroundColor: parsed.style.backgroundColor, padding: parsed.style.padding, borderRadius: parsed.style.borderRadius }
            : undefined
          frames.push({
            tag: parsed.tag,
            style,
            href: parsed.href ? safeMarkdownHref(parsed.href) ?? undefined : undefined,
            children: [],
          })
        }
        break
      }
      case 'text': {
        const text = token as Tokens.Text
        if (text.tokens) {
          append(<React.Fragment key={key}>{renderInline(text.tokens, key)}</React.Fragment>)
        } else {
          append(splitMathSource(text.text).map((segment, segmentIndex) =>
            segment.math
              ? <code key={`${key}-math-${segmentIndex}`} className="markdown-math-fallback">{segment.text}</code>
              : segment.text,
          ))
        }
        break
      }
      case 'escape':
        append((token as Tokens.Escape).text)
        break
      default:
        append('text' in token ? String(token.text) : token.raw)
    }
  })
  while (frames.length) {
    const frame = frames.pop()
    if (frame) append(wrap(frame.tag, `${prefix}-html-${frames.length}`, frame.style, frame.children, frame.href))
  }
  return roots
}

function renderTokens(tokens: Token[], prefix: string): ReactNode[] {
  return tokens.map((token, index) => {
    const key = `${prefix}-${index}`
    switch (token.type) {
      case 'heading': {
        const heading = token as Tokens.Heading
        const Tag = `h${heading.depth}` as keyof React.JSX.IntrinsicElements
        return <Tag key={key}>{renderInline(heading.tokens, key)}</Tag>
      }
      case 'paragraph': {
        const paragraph = token as Tokens.Paragraph
        const onlyText = paragraph.tokens.length === 1 && paragraph.tokens[0]?.type === 'text'
          ? (paragraph.tokens[0] as Tokens.Text).text.trim()
          : ''
        if (/^(?:\$\$[\s\S]+\$\$|\\\[[\s\S]+\\\])$/.test(onlyText)) {
          return <pre key={key} className="markdown-math-fallback"><code>{onlyText}</code></pre>
        }
        return <p key={key}>{renderInline(paragraph.tokens, key)}</p>
      }
      case 'text': {
        const text = token as Tokens.Text
        return <p key={key}>{text.tokens ? renderInline(text.tokens, key) : text.text}</p>
      }
      case 'code': {
        const code = token as Tokens.Code
        const language = code.lang?.split(/\s+/, 1)[0]
        return (
          <div key={key} className="markdown-code-block" data-language={language}>
            {language ? <span className="markdown-code-language">{language}</span> : null}
            <pre><code aria-label={code.lang ? `${code.lang} source code` : 'Source code'}>{code.text}</code></pre>
          </div>
        )
      }
      case 'list': {
        const list = token as Tokens.List
        const List = list.ordered ? 'ol' : 'ul'
        return (
          <List key={key} start={list.ordered && typeof list.start === 'number' ? list.start : undefined}>
            {list.items.map((item, itemIndex) => (
              <li key={`${key}-item-${itemIndex}`}>
                {item.task ? (
                  <div className="markdown-task-item">
                    <input aria-label={item.checked ? 'Completed task' : 'Incomplete task'} type="checkbox" checked={item.checked} readOnly />
                    <div>{renderTokens(stripTaskListMarker(item.tokens, item.checked ?? false), `${key}-item-${itemIndex}`)}</div>
                  </div>
                ) : renderTokens(item.tokens, `${key}-item-${itemIndex}`)}
              </li>
            ))}
          </List>
        )
      }
      case 'table': {
        const table = token as Tokens.Table
        return (
          <div key={key} className="markdown-table-scroll">
            <table>
              <thead><tr>{table.header.map((cell, cellIndex) => (
                <th key={`${key}-head-${cellIndex}`} style={{ textAlign: cell.align ?? 'left' }}>{renderInline(cell.tokens, `${key}-head-${cellIndex}`)}</th>
              ))}</tr></thead>
              <tbody>{table.rows.map((row, rowIndex) => (
                <tr key={`${key}-row-${rowIndex}`}>{row.map((cell, cellIndex) => (
                  <td key={`${key}-${rowIndex}-${cellIndex}`} style={{ textAlign: cell.align ?? 'left' }}>{renderInline(cell.tokens, `${key}-${rowIndex}-${cellIndex}`)}</td>
                ))}</tr>
              ))}</tbody>
            </table>
          </div>
        )
      }
      case 'blockquote':
        return <blockquote key={key}>{renderTokens((token as Tokens.Blockquote).tokens, key)}</blockquote>
      case 'hr':
        return <hr key={key} />
      case 'html':
        return <div key={key} className="markdown-html-content">{renderSafeHtml(parseSafeHtml((token as Tokens.HTML).text), key)}</div>
      case 'space':
      case 'def':
        return null
      default:
        return <p key={key}>{'text' in token ? String(token.text) : token.raw}</p>
    }
  })
}

export function MarkdownPreview({ source }: { source: string }) {
  const tokens = getStoredMarkdownBlocks(source).flatMap((block) => parseMarkdown(block.source))
  return <div className="markdown-preview">{renderTokens(tokens, 'markdown')}</div>
}
