/**
 * fr-flow v3 历史目录迁移。
 *
 * 迁移不是把旧的生成物纳入管理：JSX 是可维护源，旧 CPT/MJS 仅作为只读证据；
 * RC 的数据/页面 CPT 一律仍由 build 管线重新产出。
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { basename, join, relative, resolve } from 'path'
import { XMLParser } from 'fast-xml-parser'
import type { DatasetKind, DatasetParam, LegacyMigrationPlan, LegacyMigrationResult, ProjectPlatform } from '@shared/types'

const MAX_SCAN_FILES = 5000
const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024
const SKIP_DIRS = new Set(['.git', 'node_modules', '.DS_Store'])
const NAME_RE = /^[a-z][a-z0-9_]*$/

interface SourceFiles { data?: string; jsx: string[]; cpts: string[]; mjs: string[]; sql: string[]; warnings: string[] }

function walk(root: string): SourceFiles {
  const out: SourceFiles = { jsx: [], cpts: [], mjs: [], sql: [], warnings: [] }
  const visit = (dir: string): void => {
    let entries: string[]
    try { entries = readdirSync(dir) } catch { out.warnings.push(`无法读取目录：${relative(root, dir) || '.'}`); return }
    for (const name of entries) {
      if (SKIP_DIRS.has(name) || out.jsx.length + out.cpts.length + out.mjs.length + out.sql.length >= MAX_SCAN_FILES) continue
      const path = join(dir, name)
      let info
      try { info = statSync(path) } catch { continue }
      if (info.isDirectory()) { visit(path); continue }
      if (!info.isFile()) continue
      const rel = relative(root, path).replace(/\\/g, '/')
      const lower = name.toLowerCase()
      if (lower.endsWith('.jsx')) out.jsx.push(rel)
      else if (lower.endsWith('.mjs')) out.mjs.push(rel)
      else if (lower.endsWith('.sql')) out.sql.push(rel)
      else if (lower.endsWith('.cpt')) {
        if (!out.data && /(?:^|_)data\.cpt$/i.test(name)) out.data = rel
        else out.cpts.push(rel)
      }
    }
  }
  visit(root)
  if (out.jsx.length + out.cpts.length + out.mjs.length + out.sql.length >= MAX_SCAN_FILES) out.warnings.push(`仅扫描前 ${MAX_SCAN_FILES} 个候选文件，目录过大请先精简`)
  return out
}

function asArray<T>(value: T | T[] | undefined | null): T[] { return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value] }
function str(value: unknown): string { return typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value).trim() }
function typeOf(o: Record<string, unknown>): DatasetParam['type'] {
  if (o['@_class'] === 'com.fr.base.Formula' || o['@_t'] === 'XMLable') return 'formula'
  if (o['@_t'] === 'I') return 'integer'
  if (o['@_t'] === 'D') return 'double'
  return 'string'
}
function kindOf(name: string): DatasetKind {
  if (/_qry$/i.test(name)) return 'list'
  if (/_total$/i.test(name)) return 'stat'
  if (/_by_id$/i.test(name)) return 'detail'
  if (/^dict_/i.test(name)) return 'dict'
  if (/_insert$/i.test(name)) return 'insert'
  if (/_update$/i.test(name)) return 'update'
  if (/_delete$/i.test(name)) return 'delete'
  return 'other'
}

function datasetsFromDataCpt(file: string): LegacyMigrationPlan['datasets'] {
  const xml = readFileSync(file, 'utf-8')
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, trimValues: false })
  const parsed = parser.parse(xml) as { WorkBook?: { TableDataMap?: { TableData?: Record<string, unknown> | Array<Record<string, unknown>> } } }
  const data = asArray(parsed.WorkBook?.TableDataMap?.TableData)
  return data.flatMap((item) => {
    const name = str(item['@_name'])
    const sql = str(item.Query)
    const connection = str((item.Connection as Record<string, unknown> | undefined)?.DatabaseName)
    if (!name || !sql || !NAME_RE.test(name)) return []
    const params = asArray((item.Parameters as Record<string, unknown> | undefined)?.Parameter as Record<string, unknown> | Array<Record<string, unknown>> | undefined)
      .flatMap((p) => {
        const paramName = str((p.Attributes as Record<string, unknown> | undefined)?.['@_name'])
        const o = p.O as Record<string, unknown> | undefined
        if (!paramName || !o) return []
        const defaultValue = str(o['#text'] ?? o.Attributes)
        return [{ name: paramName, type: typeOf(o), ...(defaultValue ? { default: defaultValue } : {}) }]
      })
    return [{ name, kind: kindOf(name), connection, params, sql }]
  })
}

function suggestedName(root: string): string {
  const raw = basename(resolve(root)).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '')
  return /^[a-z]/.test(raw) ? raw : `legacy_${raw || 'project'}`
}

export function inspectLegacyProject(source: string): LegacyMigrationPlan {
  const root = resolve(source)
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error('请选择一个存在的旧项目目录')
  const files = walk(root)
  const datasets = files.data ? datasetsFromDataCpt(join(root, files.data)) : []
  const sourceComplete = files.jsx.length > 0 && Boolean(files.data) && files.sql.length > 0
  const warnings = [...files.warnings]
  if (!files.data) warnings.push('未找到 *_data.cpt：无法自动导入数据接口契约')
  if (!files.jsx.length) warnings.push('未找到 JSX 源文件：页面只能由 Agent 根据传统 CPT / MJS 尽力重建，不能无损反编译')
  if (!files.sql.length) warnings.push('未找到 .sql：历史数据库初始化/过程定义不会随迁移带入')
  if (files.data && datasets.length === 0) warnings.push('已找到数据 CPT，但未解析到可用的命名数据集')
  return {
    sourceName: basename(root), suggestedName: suggestedName(root), mode: sourceComplete ? 'lossless' : 'reconstruct',
    dataCpt: files.data, jsx: files.jsx, legacyCpts: files.cpts, mjs: files.mjs, sql: files.sql, datasets, warnings
  }
}

function evidenceName(path: string): string { return path.replace(/[\\/]/g, '__').replace(/[^\w.\-]/g, '_') }
function copyEvidence(root: string, dest: string, paths: string[], prefix = ''): string[] {
  const copied: string[] = []
  for (const path of paths) {
    const source = join(root, path)
    if (statSync(source).size > MAX_EVIDENCE_BYTES) continue
    const target = join(dest, `${prefix}${evidenceName(path)}`)
    copyFileSync(source, target)
    copied.push(basename(target))
  }
  return copied
}

export async function migrateLegacyProject(input: {
  source: string; name: string; dir: string; connections: string[]; comment?: string; platform?: ProjectPlatform
}): Promise<LegacyMigrationResult> {
  const source = resolve(input.source)
  const dest = resolve(input.dir)
  if (source === dest) throw new Error('迁移目标必须是新目录，不能直接改写旧 fr-flow v3 目录')
  if (existsSync(dest) && readdirSync(dest).length > 0) throw new Error('迁移目标目录必须为空，避免覆盖现有项目或传统 CPT')
  const plan = inspectLegacyProject(source)
  if (!input.connections.length) throw new Error('至少选择一个已注册连接')
  // 只读盘点不加载 Electron/SQLite 服务，便于在迁移向导点击「扫描」时保持无副作用。
  const [projects, pages] = await Promise.all([import('./projectsService'), import('./pagesService')])
  const project = projects.createProject(input.name, input.connections, input.comment ?? `从 ${plan.sourceName} 迁移`, dest, input.platform ?? 'desktop')
  const connectionSet = new Set(input.connections)
  const fallback = input.connections[0]
  for (const dataset of plan.datasets) {
    const connection = connectionSet.has(dataset.connection) ? dataset.connection : fallback
    projects.saveDataset(project.name, { ...dataset, connection, comment: dataset.connection && connection !== dataset.connection ? `原连接：${dataset.connection}` : '' })
  }

  const pageNames = new Set<string>()
  const jsxPages: string[] = []
  for (const rel of plan.jsx) {
    const page = basename(rel, '.jsx')
    if (!NAME_RE.test(page) || pageNames.has(page)) continue
    pageNames.add(page)
    pages.createPage(project.name, page, 'blank', 'desktop')
    pages.savePage(project.name, page, readFileSync(join(source, rel), 'utf-8'), { overwrite: true })
    jsxPages.push(page)
  }

  const root = project.dir
  const legacyDir = join(root, 'legacy')
  const migrationDir = join(root, 'meta')
  mkdirSync(legacyDir, { recursive: true })
  mkdirSync(migrationDir, { recursive: true })
  // 数据 CPT 的契约会结构化导入；原件仍保留为只读证据，便于核对解析遗漏。
  const evidenceCpts = copyEvidence(source, legacyDir, [...(plan.dataCpt ? [plan.dataCpt] : []), ...plan.legacyCpts]).map((x) => `legacy/${x}`)
  const sqlDocs = copyEvidence(source, migrationDir, plan.sql, 'migration__')
  const mjsDocs = copyEvidence(source, migrationDir, plan.mjs, 'migration__')
  const summary = [
    '# 历史 fr-flow v3 迁移说明', '',
    `迁移模式：${plan.mode === 'lossless' ? '源文件齐全（JSX + 数据 CPT + SQL）' : '尽力复原（缺少部分源文件）'}。`,
    '历史生成的 MJS/CPT 仅是只读证据，未被纳入 project.yaml.managed；RC 的受管 CPT 必须重新 build。', '',
    '## 已导入',
    `- 数据集契约：${plan.datasets.length} 个（原连接未绑定时已映射到 ${fallback}）`,
    `- JSX 页面：${jsxPages.length ? jsxPages.join('、') : '无'}`,
    `- 传统 CPT 证据：${evidenceCpts.length ? evidenceCpts.join('、') : '无'}`,
    `- SQL 证据：${sqlDocs.length ? sqlDocs.join('、') : '无'}`,
    `- MJS 证据：${mjsDocs.length ? mjsDocs.join('、') : '无'}`, '',
    '## Agent 后续任务',
    '1. 先读取此文档；传统 CPT 用 inspect_legacy_cpt 分区检查，MJS/SQL 用 read_doc 读取对应 meta/migration__ 文件。',
    '2. 缺失 JSX 的页面按 CPT/MJS 行为重写为符合 RC 约定的 JSX，不要尝试把 MJS 伪装成 JSX。',
    '3. 旧 SQL 不会自动执行；确认实际影响后才以 sql_exec(confirm:true) 受控执行，审计会落 ddl_log。',
    `4. 写接口需要根据实际库结构补建符合 sp_${project.name}_{功能}_insert|update|delete 规范的存储过程，再改接口 CALL 并 build/test。`,
    '', ...(plan.warnings.length ? ['## 迁移提示', ...plan.warnings.map((x) => `- ${x}`)] : [])
  ].join('\n')
  writeFileSync(join(root, 'meta', 'migration.md'), summary, 'utf-8')

  const dataBuild = projects.buildDataCpt(project.name)
  const agentPrompt = `请接手历史 fr-flow v3 迁移。先读取文档 migration.md，并按其中列出的只读证据核对数据接口与页面。${plan.mode === 'reconstruct' ? '本项目缺少 JSX 源，请先检查传统 CPT / MJS，再逐页重写可维护的 JSX；不要把 MJS 当 JSX。' : 'JSX 源已导入；请先构建并修复质量门问题。'} 旧 SQL 只有在我确认实际影响后，才用 sql_exec(confirm:true) 执行。`
  return { project, mode: plan.mode, imported: { datasets: plan.datasets.length, jsxPages, evidenceCpts, sqlDocs, mjsDocs }, dataBuild, agentPrompt }
}
