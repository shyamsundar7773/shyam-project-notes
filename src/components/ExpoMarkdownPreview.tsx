import { Alert, Linking, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { Token, Tokens } from 'marked'
import { useAppTheme } from './ThemeContext'
import {
  getStoredMarkdownBlocks,
  parseSafeHtml,
  parseMarkdown,
  safeMarkdownHref,
  splitMathSource,
  stripTaskListMarker,
  type SafeHtmlNode,
  type SafeHtmlStyle,
} from '../lib/markdown'

type Colors = ReturnType<typeof useAppTheme>['colors']

function nativeSafeStyle(style: SafeHtmlStyle | undefined): object | undefined {
  if (!style) return undefined
  return {
    color: style.color,
    backgroundColor: style.backgroundColor,
    borderColor: style.borderColor,
    borderWidth: style.borderWidth,
    borderRadius: style.borderRadius,
    padding: style.padding,
  }
}

function renderSafeHtml(nodes: SafeHtmlNode[], colors: Colors, prefix: string): React.ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${prefix}-${index}`
    if (node.tag === '#text') return <Text key={key} style={{ color: colors.text }}>{node.text}</Text>
    if (node.tag === 'br') return <Text key={key}>{'\n'}</Text>
    const children = renderSafeHtml(node.children ?? [], colors, key)
    if (node.tag === 'div') {
      return <View key={key} style={[styles.htmlPanel, nativeSafeStyle(node.style)]}>{children}</View>
    }
    if (node.tag === 'p') return <Text key={key} style={[styles.body, { color: colors.text }, nativeSafeStyle(node.style)]}>{children}</Text>
    if (node.tag === 'a') {
      return (
        <Text
          key={key}
          accessibilityRole={node.href ? 'link' : undefined}
          onPress={node.href ? () => {
            void Linking.openURL(node.href!).catch(() =>
              Alert.alert('Link unavailable', 'This link could not be opened on this device.'),
            )
          } : undefined}
          style={[node.href && styles.link, nativeSafeStyle(node.style)]}
        >
          {children}
        </Text>
      )
    }
    const textStyle = [
      node.tag === 'strong' && styles.strong,
      node.tag === 'em' && styles.emphasis,
      node.tag === 'u' && styles.underline,
      node.tag === 'kbd' && styles.kbd,
      nativeSafeStyle(node.style),
    ]
    return <Text key={key} style={textStyle}>{children}</Text>
  })
}

function inlineTokens(tokens: Token[], colors: Colors, prefix: string): React.ReactNode[] {
  const frames: Array<{ tag: string; style?: SafeHtmlStyle; href?: string; children: React.ReactNode[] }> = []
  const roots: React.ReactNode[] = []
  const append = (node: React.ReactNode) => (frames.at(-1)?.children ?? roots).push(node)
  const wrap = (frame: (typeof frames)[number], key: string) => {
    if (frame.tag === 'br') return <Text key={key}>{'\n'}</Text>
    const textStyles = [
      frame.tag === 'strong' && styles.strong,
      frame.tag === 'em' && styles.emphasis,
      frame.tag === 'u' && styles.underline,
      frame.tag === 'kbd' && styles.kbd,
      nativeSafeStyle(frame.style),
      frame.href && styles.link,
    ]
    return (
      <Text
        key={key}
        accessibilityRole={frame.href ? 'link' : undefined}
        onPress={frame.href ? () => {
          void Linking.openURL(frame.href!).catch(() =>
            Alert.alert('Link unavailable', 'This link could not be opened on this device.'),
          )
        } : undefined}
        style={textStyles}
      >
        {frame.children}
      </Text>
    )
  }
  tokens.forEach((token, index) => {
    const key = `${prefix}-${index}`
    switch (token.type) {
      case 'strong':
        append(<Text key={key} style={styles.strong}>{inlineTokens((token as Tokens.Strong).tokens, colors, key)}</Text>)
        break
      case 'em':
        append(<Text key={key} style={styles.emphasis}>{inlineTokens((token as Tokens.Em).tokens, colors, key)}</Text>)
        break
      case 'del':
        append(<Text key={key} style={styles.strike}>{inlineTokens((token as Tokens.Del).tokens, colors, key)}</Text>)
        break
      case 'codespan':
        append(<Text key={key} style={[styles.inlineCode, { backgroundColor: colors.surfaceMuted }]}>{(token as Tokens.Codespan).text}</Text>)
        break
      case 'link': {
        const link = token as Tokens.Link
        const href = safeMarkdownHref(link.href)
        append(
          <Text
            key={key}
            accessibilityRole={href ? 'link' : undefined}
            onPress={href ? () => {
              void Linking.openURL(href).catch(() =>
                Alert.alert('Link unavailable', 'This link could not be opened on this device.'),
              )
            } : undefined}
            style={href ? [styles.link, { color: colors.accentText }] : undefined}
          >
            {inlineTokens(link.tokens, colors, key)}
          </Text>,
        )
        break
      }
      case 'br':
        append(<Text key={key}>{'\n'}</Text>)
        break
      case 'html': {
        const raw = (token as Tokens.HTML).text
        const match = raw.match(/^<\s*(\/?)\s*([a-z][\w-]*)([^>]*)>$/i)
        if (!match) {
          append(renderSafeHtml(parseSafeHtml(raw), colors, key))
          break
        }
        const [, closing, rawTag] = match
        const originalTag = rawTag.toLowerCase()
        const tag = originalTag === 'b' ? 'strong' : originalTag === 'i' ? 'em' : originalTag
        const supportedInlineTag = ['a', 'br', 'em', 'kbd', 'span', 'strong', 'u'].includes(tag)
        if (tag === 'br' && !closing) {
          append(<Text key={key}>{'\n'}</Text>)
          break
        }
        if (closing) {
          const frameIndex = frames.map((frame) => frame.tag).lastIndexOf(tag)
          if (frameIndex >= 0) {
            const frame = frames.splice(frameIndex, 1)[0]
            if (frame) append(wrap(frame, key))
          }
          break
        }
        if (!supportedInlineTag) break
        const parsed = parseSafeHtml(raw)[0]
        if (parsed && ['span', 'strong', 'em', 'u', 'kbd', 'a'].includes(parsed.tag)) {
          frames.push({
            tag: parsed.tag,
            style: parsed.style,
            href: parsed.href ? safeMarkdownHref(parsed.href) ?? undefined : undefined,
            children: [],
          })
        }
        break
      }
      case 'text': {
        const text = token as Tokens.Text
        append(text.tokens
          ? <Text key={key}>{inlineTokens(text.tokens, colors, key)}</Text>
          : <Text key={key} style={{ color: colors.text }}>
              {splitMathSource(text.text).map((segment, segmentIndex) =>
                segment.math
                  ? <Text key={`${key}-math-${segmentIndex}`} selectable style={styles.mathFallback}>{segment.text}</Text>
                  : segment.text,
              )}
            </Text>)
        break
      }
      case 'escape':
        append(<Text key={key}>{(token as Tokens.Escape).text}</Text>)
        break
      default:
        append(<Text key={key}>{'text' in token ? String(token.text) : token.raw}</Text>)
    }
  })
  while (frames.length) {
    const frame = frames.pop()
    if (frame) append(wrap(frame, `${prefix}-html-${frames.length}`))
  }
  return roots
}

function renderTokens(tokens: Token[], colors: Colors, prefix: string, listDepth = 0): React.ReactNode[] {
  return tokens.map((token, index) => {
    const key = `${prefix}-${index}`
    switch (token.type) {
      case 'heading': {
        const heading = token as Tokens.Heading
        return (
          <Text key={key} accessibilityRole="header" style={[
            styles.heading,
            styles[`heading${heading.depth}` as keyof typeof styles],
            { color: colors.text },
          ]}>
            {inlineTokens(heading.tokens, colors, key)}
          </Text>
        )
      }
      case 'paragraph': {
        const paragraph = token as Tokens.Paragraph
        const onlyText = paragraph.tokens.length === 1 && paragraph.tokens[0]?.type === 'text'
          ? (paragraph.tokens[0] as Tokens.Text).text.trim()
          : ''
        if (/^(?:\$\$[\s\S]+\$\$|\\\[[\s\S]+\\\])$/.test(onlyText)) {
          return (
            <ScrollView key={key} horizontal nestedScrollEnabled style={[styles.mathBlock, { backgroundColor: colors.surfaceMuted }]}>
              <Text selectable style={[styles.codeText, { color: colors.text }]}>{onlyText}</Text>
            </ScrollView>
          )
        }
        return <Text key={key} style={[styles.body, { color: colors.text }]}>{inlineTokens(paragraph.tokens, colors, key)}</Text>
      }
      case 'text': {
        const text = token as Tokens.Text
        return <Text key={key} style={[styles.body, { color: colors.text }]}>{text.tokens ? inlineTokens(text.tokens, colors, key) : text.text}</Text>
      }
      case 'code': {
        const code = token as Tokens.Code
        const language = code.lang?.split(/\s+/, 1)[0]
        return (
          <View key={key} accessibilityLabel={code.lang ? `${code.lang} source code` : 'Source code'} style={styles.codeContainer}>
            {language ? <Text style={[styles.codeLanguageBadge, { color: colors.mutedText, backgroundColor: colors.surfaceMuted }]}>{language}</Text> : null}
            <ScrollView horizontal nestedScrollEnabled style={[styles.codeBlock, language && styles.codeBlockWithLabel, { backgroundColor: colors.surfaceMuted }]}>
              <Text selectable style={[styles.codeText, { color: colors.text }]}>{code.text}</Text>
            </ScrollView>
          </View>
        )
      }
      case 'list': {
        const list = token as Tokens.List
        return (
          <View key={key} style={[styles.list, listDepth > 0 && { marginLeft: listDepth * 20 }]}>
            {list.items.map((item, itemIndex) => (
              <View key={`${key}-item-${itemIndex}`} style={styles.listItem}>
                {item.task ? (
                  <Text style={[styles.body, styles.marker, styles.taskMarker, { color: colors.text }]}>{item.checked ? '☑' : '☐'}</Text>
                ) : (
                  <Text style={[styles.body, styles.marker, { color: colors.text }]}>
                    {list.ordered ? `${Number(list.start || 1) + itemIndex}. ` : '• '}
                  </Text>
                )}
                <View style={styles.listItemContent}>
                  {renderTokens(
                    item.task && item.checked !== undefined
                      ? stripTaskListMarker(item.tokens, item.checked)
                      : item.tokens,
                    colors,
                    `${key}-item-${itemIndex}`,
                    listDepth + 1,
                  )}
                </View>
              </View>
            ))}
          </View>
        )
      }
      case 'table': {
        const table = token as Tokens.Table
        const rows = [table.header, ...table.rows]
        return (
          <ScrollView key={key} horizontal nestedScrollEnabled style={styles.tableScroll}>
            <View style={styles.table}>
              {rows.map((row, rowIndex) => (
                <View key={`${key}-row-${rowIndex}`} style={styles.tableRow}>
                  {row.map((cell, cellIndex) => (
                    <View
                      key={`${key}-cell-${rowIndex}-${cellIndex}`}
                      style={[
                        styles.tableCell,
                        { borderColor: colors.border, alignItems: cell.align === 'right' ? 'flex-end' : cell.align === 'center' ? 'center' : 'flex-start' },
                        rowIndex === 0 && styles.tableHeader,
                      ]}
                    >
                      <Text style={[styles.body, { color: colors.text, textAlign: cell.align ?? 'left' }]}>
                        {inlineTokens(cell.tokens, colors, `${key}-${rowIndex}-${cellIndex}`)}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        )
      }
      case 'blockquote':
        return <View key={key} style={[styles.quote, { borderColor: colors.blueBorder }]}>{renderTokens((token as Tokens.Blockquote).tokens, colors, key)}</View>
      case 'hr':
        return <View key={key} style={[styles.rule, { backgroundColor: colors.border }]} />
      case 'html':
        return <View key={key} style={styles.htmlBlock}>{renderSafeHtml(parseSafeHtml((token as Tokens.HTML).text), colors, key)}</View>
      case 'space':
      case 'def':
        return null
      default:
        return <Text key={key} style={[styles.body, { color: colors.text }]}>{'text' in token ? String(token.text) : token.raw}</Text>
    }
  })
}

export function ExpoMarkdownPreview({ source }: { source: string }) {
  const { colors } = useAppTheme()
  const tokens = getStoredMarkdownBlocks(source).flatMap((block) => parseMarkdown(block.source))
  return <View style={styles.content}>{renderTokens(tokens, colors, 'md')}</View>
}

const styles = StyleSheet.create({
  content: { gap: 10, width: '100%' },
  body: { fontSize: 15, lineHeight: 23, flexShrink: 1 },
  strong: { fontWeight: '700' },
  emphasis: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  inlineCode: { fontFamily: 'monospace', paddingHorizontal: 3 },
  link: { textDecorationLine: 'underline' },
  underline: { textDecorationLine: 'underline' },
  kbd: { backgroundColor: '#f1f5f9', borderColor: '#94a3b8', borderRadius: 4, borderWidth: 1, fontFamily: 'monospace', paddingHorizontal: 4 },
  mathFallback: { backgroundColor: '#f4f1f8', fontFamily: 'monospace', fontSize: 13 },
  heading: { fontWeight: '700' },
  heading1: { fontSize: 25, lineHeight: 32 },
  heading2: { fontSize: 22, lineHeight: 29 },
  heading3: { fontSize: 19, lineHeight: 26 },
  heading4: { fontSize: 17, lineHeight: 24 },
  heading5: { fontSize: 16, lineHeight: 23 },
  heading6: { fontSize: 15, lineHeight: 22 },
  list: { gap: 4, width: '100%' },
  listItem: { alignItems: 'flex-start', flexDirection: 'row', width: '100%' },
  marker: { minWidth: 24 },
  taskMarker: { textAlign: 'center' },
  listItemContent: { flex: 1, gap: 6 },
  codeContainer: { borderRadius: 8, overflow: 'hidden', width: '100%' },
  codeBlock: { maxWidth: '100%', padding: 10, width: '100%' },
  codeBlockWithLabel: { paddingTop: 28 },
  codeLanguageBadge: { borderRadius: 4, fontSize: 10, paddingHorizontal: 5, paddingVertical: 2, position: 'absolute', right: 8, top: 6, zIndex: 1 },
  codeText: { fontFamily: 'monospace', fontSize: 13, lineHeight: 20 },
  quote: { borderLeftWidth: 3, gap: 8, paddingLeft: 10, width: '100%' },
  rule: { height: 1, marginVertical: 6, width: '100%' },
  tableScroll: { maxWidth: '100%', width: '100%' },
  table: { minWidth: '100%' },
  tableRow: { flexDirection: 'row' },
  tableCell: { borderBottomWidth: 1, minWidth: 140, padding: 8 },
  tableHeader: { backgroundColor: '#f4f2f7' },
  htmlFallback: { fontFamily: 'monospace', fontSize: 12, lineHeight: 18 },
  htmlBlock: { gap: 6, width: '100%' },
  htmlPanel: { borderRadius: 8, gap: 6, width: '100%' },
  mathBlock: { borderRadius: 8, maxWidth: '100%', padding: 10, width: '100%' },
})
