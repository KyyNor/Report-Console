/**
 * 传统 CPT 只读检查器。
 *
 * 目标不是复原全部 FineReport XML，而是将旧页面压缩成可按需读取的开发线索：
 * 数据集、表单控件、事件脚本与报表引用。任何视图都不会返回原始 XML。
 */
import { createHash } from 'crypto'
import { XMLValidator } from 'fast-xml-parser'

export type LegacyCptView = 'overview' | 'datasets' | 'parameters' | 'widgets' | 'scripts' | 'references'

export interface LegacyCptInspectOptions {
  view?: LegacyCptView
  query?: string
  cursor?: number
  limit?: number
}

interface XmlRecord { [key: string]: string | undefined }

const MAX_PREVIEW = 1200

function attributes(openTag: string): XmlRecord {
  return Object.fromEntries([...openTag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]))
}

function blocks(source: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'gi')
  return source.match(re) ?? []
}

function textIn(source: string, tag: string): string {
  const match = source.match(new RegExp(`<${tag}(?:\\s[^>]*)?>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*</${tag}>`, 'i'))
  return (match?.[1] ?? match?.[2] ?? '').trim()
}

function compact(value: string, max = MAX_PREVIEW): string | undefined {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return undefined
  return normalized.length > max ? `${normalized.slice(0, max)}…（已截断）` : normalized
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function page<T>(items: T[], options: LegacyCptInspectOptions, maxLimit: number): { items: T[]; cursor: number; nextCursor?: number; total: number } {
  const query = options.query?.trim().toLowerCase()
  const filtered = query ? items.filter((item) => JSON.stringify(item).toLowerCase().includes(query)) : items
  const cursor = Math.max(0, options.cursor ?? 0)
  const limit = Math.min(maxLimit, Math.max(1, options.limit ?? maxLimit))
  const slice = filtered.slice(cursor, cursor + limit)
  return { items: slice, cursor, ...(cursor + slice.length < filtered.length ? { nextCursor: cursor + slice.length } : {}), total: filtered.length }
}

function firstWidgetClass(cell: string): string | undefined {
  // 表单控件可能包在 WAbsoluteLayout 的 InnerWidget 中；优先取真正内层控件。
  const inner = cell.match(/<InnerWidget\b[^>]*\bclass="([^"]+)"/i)?.[1]
  return inner ?? cell.match(/<Widget\b[^>]*\bclass="([^"]+)"/i)?.[1]
}

function widgetNameIn(source: string): string | undefined {
  return source.match(/<WidgetName\b[^>]*\bname="([^"]+)"[^>]*\/?\s*>/i)?.[1] || textIn(source, 'WidgetName') || undefined
}

function parameterFormula(parameter: string): string | undefined {
  const formulaNode = blocks(parameter, 'O')[0]
  return compact(formulaNode ? textIn(formulaNode, 'Attributes') || textIn(parameter, 'O') : textIn(parameter, 'O'), 300)
}

function cellValueFormula(cell: string): string | undefined {
  const valueNode = blocks(cell, 'O')[0]
  return valueNode ? compact(textIn(valueNode, 'Attributes'), 240) : undefined
}

export function inspectLegacyCptXml(
  xml: string,
  meta: { path: string; bytes: number; mtime: number },
  options: LegacyCptInspectOptions = {}
): Record<string, unknown> {
  const valid = XMLValidator.validate(xml)
  if (valid !== true) throw new Error(`CPT XML 不合法：${valid.err.msg}（第 ${valid.err.line} 行）`)

  const view = options.view ?? 'overview'
  const workBook = xml.match(/<WorkBook\b[^>]*>/i)?.[0] ?? ''
  const allTableData = blocks(xml, 'TableData')
  const datasets = allTableData
    .filter((block) => /<TableData\b[^>]*\bname="[^"]+"/i.test(block))
    .map((block) => {
      const open = block.match(/<TableData\b[^>]*>/i)?.[0] ?? ''
      const attr = attributes(open)
      return {
        name: attr.name,
        class: attr.class,
        pluginID: attr.pluginID,
        pluginVersion: attr['plugin-version'],
        connection: textIn(block, 'DatabaseName') || undefined,
        query: compact(textIn(block, 'Query')),
        pageQuery: compact(textIn(block, 'PageQuery'), 800),
        script: compact(textIn(block, 'ScriptText') || textIn(block, 'Content')),
        parameters: blocks(block, 'Parameter').map((parameter) => {
          const attrs = [...parameter.matchAll(/<Attributes\b[^>]*\bname="([^"]+)"[^>]*>/gi)]
          return { name: attrs[0]?.[1], formula: parameterFormula(parameter) }
        })
      }
    })
  const datasetReferences = unique(allTableData
    .filter((block) => /class="com\.fr\.data\.impl\.NameTableData"/i.test(block))
    .map((block) => textIn(block, 'Name')))

  const cellBlocks = blocks(xml, 'C')
  const cells = cellBlocks.map((cell) => {
    const open = cell.match(/<C\b[^>]*>/i)?.[0] ?? ''
    const attr = attributes(open)
    const widgetClass = firstWidgetClass(cell)
    const valueFormula = cellValueFormula(cell)
    return {
      cell: `${Number(attr.c ?? 0) + 1}:${Number(attr.r ?? 0) + 1}`,
      column: Number(attr.c ?? 0),
      row: Number(attr.r ?? 0),
      colSpan: Number(attr.cs ?? 1),
      rowSpan: Number(attr.rs ?? 1),
      widgetClass,
      widgetName: widgetNameIn(cell),
      label: valueFormula ? undefined : compact(textIn(cell, 'Text') || textIn(cell, 'O'), 240),
      valueFormula
    }
  }).filter((cell) => cell.widgetClass || cell.widgetName || cell.label || cell.valueFormula)

  const widgetNames = unique([...xml.matchAll(/<WidgetName\b[^>]*\bname="([^"]+)"[^>]*\/?\s*>/gi)].map(([, name]) => name))
  const listeners = blocks(xml, 'Listener').map((listener) => {
    const open = listener.match(/<Listener\b[^>]*>/i)?.[0] ?? ''
    const attrs = attributes(open)
    return {
      event: attrs.event,
      name: attrs.name,
      parameters: blocks(listener, 'Parameter').map((parameter) => ({
        name: [...parameter.matchAll(/<Attributes\b[^>]*\bname="([^"]+)"[^>]*>/gi)][0]?.[1],
        formula: parameterFormula(parameter)
      })),
      code: compact(textIn(listener, 'Content'))
    }
  })
  const references = unique([
    ...[...xml.matchAll(/[\w./-]+\.cpt\b/gi)].map((match) => match[0]),
    ...[...xml.matchAll(/viewlet=([^&'"\s<]+)/gi)].map(([, value]) => value)
  ]).filter((ref) => ref !== meta.path.split('/').at(-1))
  const widgetTags = [...xml.matchAll(/<Widget\b[^>]*>/gi)].length
  const cellCoords = cellBlocks.map((cell) => attributes(cell.match(/<C\b[^>]*>/i)?.[0] ?? ''))
  const columns = cellCoords.map((cell) => Number(cell.c ?? 0))
  const rows = cellCoords.map((cell) => Number(cell.r ?? 0))
  const basic = {
    path: meta.path,
    bytes: meta.bytes,
    mtime: meta.mtime,
    sha256: createHash('sha256').update(xml).digest('hex').slice(0, 16),
    workbook: attributes(workBook),
    counts: {
      datasets: datasets.length,
      cells: cellBlocks.length,
      widgets: widgetTags,
      listeners: listeners.length,
      scripts: (xml.match(/<JavaScript\b/gi) ?? []).length,
      parameters: (xml.match(/<Parameter\b/gi) ?? []).length
    },
    cellRange: cellCoords.length ? {
      minColumn: Math.min(...columns), maxColumn: Math.max(...columns),
      minRow: Math.min(...rows), maxRow: Math.max(...rows)
    } : undefined
  }

  if (view === 'overview') {
    return {
      ...basic,
      view,
      datasets: datasets.map(({ name, class: className, connection, pluginID }) => ({ name, class: className, connection, pluginID })),
      widgetNames: widgetNames.slice(0, 80),
      listeners: listeners.map(({ event, name, parameters }) => ({ event, name, parameters })),
      references,
      datasetReferences
    }
  }
  if (view === 'datasets') return { ...basic, view, datasetReferences, ...page(datasets, options, 5) }
  if (view === 'parameters') return {
    ...basic,
    view,
    ...page(widgetNames.map((name) => ({ name })), options, 20),
    listenerParameters: listeners.flatMap((listener) => listener.parameters).filter((item) => item.name)
  }
  if (view === 'widgets') return { ...basic, view, itemKind: 'layout_items', ...page(cells, options, 12) }
  if (view === 'scripts') return { ...basic, view, ...page(listeners, options, 3) }
  return { ...basic, view, references, datasetReferences }
}
