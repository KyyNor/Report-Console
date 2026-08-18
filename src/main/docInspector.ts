/**
 * 项目文档的按需读取器。
 *
 * Agent 先取得轻量概览与标题结构，再按 cursor 分页读取正文；不把整篇文档直接
 * 放进模型上下文。HTML 只按文本源码解析，不执行其中任何内容。
 */

export type DocInspectView = 'overview' | 'content'

export interface DocInspectOptions {
  view?: DocInspectView
  cursor?: number
  limit?: number
  query?: string
}

export interface DocInspectMeta {
  name: string
  type: 'markdown' | 'sql' | 'other'
  size: number
  mtime: number
}

const MAX_CONTENT_CHARS = 6000
const MAX_HEADINGS = 80

function compact(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized
}

function htmlText(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
}

function headingsOf(content: string, type: DocInspectMeta['type']): Array<{ level: number; text: string; line?: number; cursor: number }> {
  const out: Array<{ level: number; text: string; line?: number; cursor: number }> = []
  if (type === 'markdown') {
    let cursor = 0
    content.split(/\r?\n/).forEach((line, index) => {
      const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
      if (match && out.length < MAX_HEADINGS) out.push({ level: match[1].length, text: compact(match[2], 160), line: index + 1, cursor })
      const afterLine = cursor + line.length
      cursor = afterLine + (content.startsWith('\r\n', afterLine) ? 2 : content.startsWith('\n', afterLine) ? 1 : 0)
    })
  }
  return out
}

function extractHeadings(content: string, meta: DocInspectMeta): Array<{ level: number; text: string; line?: number; cursor: number }> {
  const markdown = headingsOf(content, meta.type)
  if (markdown.length) return markdown
  if (/\.html?$/i.test(meta.name)) {
    const out: Array<{ level: number; text: string; cursor: number }> = []
    for (const match of content.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)) {
      const text = compact(htmlText(match[2]), 160)
      if (text) out.push({ level: Number(match[1]), text, cursor: match.index ?? 0 })
      if (out.length >= MAX_HEADINGS) break
    }
    return out
  }
  const first = content.split(/\r?\n/).find((line) => line.trim())?.trim()
  return first ? [{ level: 1, text: compact(first, 160), line: 1, cursor: content.indexOf(first) }] : []
}

/** 纯函数，便于测试；content 视图严格限制单次返回长度。 */
export function inspectDocumentContent(content: string, meta: DocInspectMeta, options: DocInspectOptions = {}): Record<string, unknown> {
  const view = options.view ?? 'overview'
  const base = {
    name: meta.name,
    type: meta.type,
    bytes: meta.size,
    mtime: meta.mtime,
    characters: content.length,
    lines: content ? content.split(/\r?\n/).length : 0
  }
  if (view === 'overview') {
    return {
      ...base,
      view,
      headings: extractHeadings(content, meta),
      preview: compact(meta.name.toLowerCase().endsWith('.html') ? htmlText(content) : content, 700),
      hint: '需要正文时调用 read_doc(view="content", cursor=0, limit=4000)；长文档按 nextCursor 继续读取。'
    }
  }

  const requestedCursor = Math.max(0, options.cursor ?? 0)
  const limit = Math.min(MAX_CONTENT_CHARS, Math.max(1, options.limit ?? 4000))
  const query = options.query?.trim()
  const start = query
    ? content.toLocaleLowerCase().indexOf(query.toLocaleLowerCase(), Math.min(requestedCursor, content.length))
    : Math.min(requestedCursor, content.length)
  if (start < 0) return { ...base, view, query, cursor: requestedCursor, content: '', matchFound: false }
  const end = Math.min(content.length, start + limit)
  return {
    ...base,
    view,
    ...(query ? { query, matchFound: true } : {}),
    cursor: start,
    content: content.slice(start, end),
    ...(end < content.length ? { nextCursor: end } : {})
  }
}
