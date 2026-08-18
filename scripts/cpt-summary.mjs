#!/usr/bin/env node
/**
 * FineReport CPT 的只读摘要器。
 *
 * 用法：node scripts/cpt-summary.mjs /path/to/report.cpt
 * 仅使用 Node.js 内置模块；输出 JSON，不修改源文件。
 */
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'

const file = process.argv[2]
if (!file) {
  console.error('用法：node scripts/cpt-summary.mjs /path/to/report.cpt')
  process.exit(1)
}

const path = resolve(file)
const xml = readFileSync(path, 'utf8')
const stat = statSync(path)

function attrs(openTag) {
  return Object.fromEntries([...openTag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]))
}

function textIn(source, tag) {
  const match = source.match(new RegExp(`<${tag}(?:\\s[^>]*)?>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*</${tag}>`, 'i'))
  return (match?.[1] ?? match?.[2] ?? '').trim()
}

function compact(value, limit = 400) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized
}

function blocks(source, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'gi')
  return source.match(re) ?? []
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

const workBookTag = xml.match(/<WorkBook\b[^>]*>/i)?.[0] ?? ''
// 顶层数据集都有 name 属性；单元格内的 NameTableData 只是对数据集的引用，
// 不应算作另一份数据集。
const allTableData = blocks(xml, 'TableData')
const dataTables = allTableData.filter((block) => /<TableData\b[^>]*\bname="[^"]+"/i.test(block)).map((block) => {
  const open = block.match(/<TableData\b[^>]*>/i)?.[0] ?? ''
  const connection = textIn(block, 'DatabaseName')
  const query = textIn(block, 'Query')
  const pageQuery = textIn(block, 'PageQuery')
  const script = textIn(block, 'ScriptText') || textIn(block, 'Content')
  return {
    ...attrs(open),
    name: attrs(open).name || textIn(block, 'Name') || undefined,
    connection: connection || undefined,
    query: compact(query, 700) || undefined,
    pageQuery: compact(pageQuery, 350) || undefined,
    script: !query && script ? compact(script, 500) : undefined
  }
})

const listeners = blocks(xml, 'Listener').map((block) => {
  const open = block.match(/<Listener\b[^>]*>/i)?.[0] ?? ''
  const code = textIn(block, 'Content')
  const parameters = blocks(block, 'Parameter').map((item) => attrs(item.match(/<Parameter\b[^>]*>/i)?.[0] ?? '').name).filter(Boolean)
  return {
    ...attrs(open),
    parameters,
    code: compact(code, 700) || undefined
  }
})

const widgetTags = [...xml.matchAll(/<Widget\b[^>]*>/gi)].map((match) => match[0])
const widgets = widgetTags.map((open) => {
  return {
    ...attrs(open),
  }
})

const cells = [...xml.matchAll(/<C\b([^>]*)>/g)].map(([, raw]) => attrs(`<C ${raw}>`))
const widgetNames = unique([...xml.matchAll(/<WidgetName\b[^>]*\bname="([^"]+)"[^>]*\/?\s*>/gi)].map(([, name]) => name))
const datasetReferences = unique(allTableData
  .filter((block) => /class="com\.fr\.data\.impl\.NameTableData"/i.test(block))
  .map((block) => textIn(block, 'Name')))
const refs = unique([
  ...[...xml.matchAll(/[\w./-]+\.cpt\b/gi)].map((match) => match[0]),
  ...[...xml.matchAll(/viewlet=([^&'"\s<]+)/gi)].map(([, value]) => value)
]).filter((value) => value !== basename(path))

const summary = {
  file: basename(path),
  bytes: stat.size,
  sha256: createHash('sha256').update(xml).digest('hex').slice(0, 16),
  workbook: attrs(workBookTag),
  counts: {
    datasets: dataTables.length,
    cells: cells.length,
    widgets: widgetTags.length,
    listeners: listeners.length,
    scripts: (xml.match(/<JavaScript\b/gi) ?? []).length,
    parameters: (xml.match(/<Parameter\b/gi) ?? []).length
  },
  datasets: dataTables,
  datasetReferences,
  widgetNames: widgetNames.slice(0, 100),
  widgets: widgets.slice(0, 100),
  listeners,
  references: refs.slice(0, 100),
  cellRange: cells.length ? {
    minColumn: Math.min(...cells.map((cell) => Number(cell.c ?? 0))),
    maxColumn: Math.max(...cells.map((cell) => Number(cell.c ?? 0))),
    minRow: Math.min(...cells.map((cell) => Number(cell.r ?? 0))),
    maxRow: Math.max(...cells.map((cell) => Number(cell.r ?? 0)))
  } : undefined
}

console.log(JSON.stringify(summary, null, 2))
