/**
 * 项目服务 — 项目制核心：项目与连接绑定、接口契约（各绑连接）、数据层构建、实测、
 * 存储过程归属/关联（定义存 meta/）、项目文档（meta/）
 */

import { existsSync, readdirSync, statSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, renameSync, copyFileSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import { getDb, getSettings } from './db'
import { generateDataCpt } from './cpt/dataWriter'
import { checkDataCpt, hasError } from './cpt/checker'
import { callApiData, type ApiDataRequest } from './frClient'
import { getConnection, requireConnection } from './connectionsService'
import { applyProcedureMysql, guardedExec, pingConnection } from './mysqlService'
import { buildZip, collectZipEntries } from './zipWriter'
import { PROJECT_MANIFEST, createManifest, dataCptForProject, listTraditionalCpts as scanTraditionalCpts, manifestForProject, readManifest, reportletFile, resolveProjectFile, writeManifest, type ProjectManifest } from './projectManifest'
import { inspectDocumentContent, type DocInspectOptions } from './docInspector'
import { replaceUniqueText } from './textPatch'
import { assertProcedureName, checkProcedureCalls } from './procedureNaming'
import type {
  Project, ProjectPlatform, Dataset, DatasetKind, DatasetParam, DatasetStatus, ProcRecord, DocMeta,
  BuildResult, CheckerFinding, ConnectionHealth
} from '@shared/types'
import dataTemplateRaw from './templates/base_cpt_data.cpt?raw'

const NAME_RE = /^[a-z][a-z0-9_]*$/
/** 可作为项目 meta/ 上下文维护的文本文件；二进制附件不纳入 Agent 读取范围。 */
const DOC_NAME_RE = /^[\w.\-\u4e00-\u9fa5 ]+\.(md|markdown|txt|html|htm|sql|js|jsx|mjs|css)$/i
const MAX_IMPORTED_DOC_BYTES = 2 * 1024 * 1024

function docMetaType(name: string): DocMeta['type'] {
  return /\.(?:md|markdown)$/i.test(name) ? 'markdown' : /\.sql$/i.test(name) ? 'sql' : 'other'
}

export function assertProjectName(name: string): void {
  if (!NAME_RE.test(name)) throw new Error('名称仅允许小写字母/数字/下划线（= reportlets 子目录名）')
}

/** 项目根目录：显式指定 > projects.dir（打开本地项目/自选目录）> reportlets/{name}（存量回退） */
function projectDir(name: string, explicit?: string): string {
  if (explicit) return explicit
  const r = getDb().prepare('SELECT dir FROM projects WHERE name=?').get(name) as { dir: string | null } | undefined
  return r?.dir || join(getSettings().reportletsPath, name)
}

function getProjectByName(name: string): { id: number; name: string; comment: string; createdAt: string } | undefined {
  const r = getDb().prepare('SELECT * FROM projects WHERE name=?').get(name) as Record<string, unknown> | undefined
  if (!r) return undefined
  return { id: r.id as number, name: r.name as string, comment: r.comment as string, createdAt: r.created_at as string }
}

function projectConnections(pid: number): string[] {
  const rows = getDb().prepare(`
    SELECT c.name FROM project_connections pc JOIN connections c ON c.id = pc.connection_id
    WHERE pc.project_id = ? ORDER BY c.name`).all(pid) as Array<{ name: string }>
  return rows.map((r) => r.name)
}

// ── 项目 CRUD ───────────────────────────────────────────────────

export function listProjects(): Project[] {
  const d = getDb()
  const rows = d.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM datasets ds WHERE ds.project_id = p.id) AS cIfs,
      (SELECT COUNT(*) FROM procedures sp WHERE sp.project_id = p.id) AS cSps,
      (SELECT COUNT(*) FROM proc_links pl WHERE pl.project_id = p.id) AS cLnk
    FROM projects p ORDER BY p.name`).all() as Array<Record<string, unknown>>
  return rows.map((r) => {
    const name = r.name as string
    const dir = (r.dir as string | null) || join(getSettings().reportletsPath, name)
    return {
      id: r.id as number,
      name,
      comment: r.comment as string,
      createdAt: r.created_at as string,
      dir,
      missingDir: getSettings().reportletsPath ? !existsSync(dir) : true,
      platform: projectPlatform(name),
      connections: projectConnections(r.id as number),
      counts: {
        ifs: r.cIfs as number,
        sps: (r.cSps as number) + (r.cLnk as number),
        pgs: countPages(name),
        docs: countDocs(name)
      }
    }
  })
}

function projectPlatform(project: string): ProjectPlatform {
  try { return manifestForProject(project).platform } catch { return 'desktop' }
}

function countPages(project: string): number {
  try { return manifestForProject(project).managed.pages.length } catch { return 0 }
}

function countDocs(project: string): number {
  const dir = join(projectDir(project), 'meta')
  if (!existsSync(dir)) return 0
  try { return readdirSync(dir).filter((f) => /\.(md|txt|html|sql)$/i.test(f)).length } catch { return 0 }
}

/** 把项目身份与受管资源写回 {root}/project.yaml；SQLite 不保存资源布局。 */
function syncProjectManifest(name: string): void {
  try {
    const p = getProjectByName(name)
    if (!p) return
    const root = projectDir(name)
    if (!existsSync(root)) return
    let manifest
    try { manifest = readManifest(root) } catch { manifest = createManifest(p.name, p.comment, projectConnections(p.id)) }
    manifest.name = p.name
    manifest.comment = p.comment
    manifest.connections = projectConnections(p.id)
    manifest.contracts.datasets = listDatasets(name).map((x) => ({
      name: x.name, kind: x.kind, comment: x.comment, connection: x.connection, params: x.params, sql: x.sql
    }))
    // 跨项目关联是本机人工行为，不属于可移植项目定义。
    const definitions = new Map(manifest.contracts.procedures.map((x) => [x.name, x.definition]))
    manifest.contracts.procedures = listProcedures(name).filter((x) => x.own).map((x) => ({
      name: x.name, connection: x.connection, comment: x.comment, definition: definitions.get(x.name) ?? `meta/${x.name}.sql`
    }))
    writeManifest(root, manifest)
  } catch { /* 目录缺失/只读时不阻断主流程 */ }
}

export function createProject(name: string, connections: string[], comment = '', dir?: string, platform: ProjectPlatform = 'desktop'): Project {
  assertProjectName(name)
  if (!['desktop', 'mobile', 'dual'].includes(platform)) throw new Error('项目平台必须是 desktop / mobile / dual')
  if (!connections.length) throw new Error('至少绑定一个连接（来自「连接」注册表）')
  for (const cn of connections) {
    if (!getConnection({ name: cn })) throw new Error(`连接不存在：${cn}（先在「连接」页注册）`)
  }
  const root = dir || join(getSettings().reportletsPath, name)
  if (!dir && !getSettings().reportletsPath) throw new Error('先在「设置」页填写 reportlets 路径，或在向导中指定项目目录')
  const d = getDb()
  const info = d.prepare('INSERT INTO projects(name, comment, dir) VALUES(?,?,?)').run(name, comment, dir ?? null)
  const pid = Number(info.lastInsertRowid)
  const bind = d.prepare('INSERT OR IGNORE INTO project_connections(project_id, connection_id) VALUES(?,?)')
  for (const cn of connections) {
    bind.run(pid, (getConnection({ name: cn }) as { id: number }).id)
  }
  // 这是新建项目的默认布局，不是平台的路径约束。
  for (const sub of ['data', 'pages', 'meta']) mkdirSync(join(root, sub), { recursive: true })
  writeManifest(root, createManifest(name, comment, connections, platform))
  return listProjects().find((p) => p.id === pid)!
}

/** 打开本地项目：读取可迁移的 project.yaml，按其中连接声明注册本机账本。 */
export function openProject(dir: string): Project {
  if (!existsSync(dir)) throw new Error(`目录不存在：${dir}`)
  const cfg = readManifest(dir)
  const existing = getProjectByName(cfg.name)
  if (existing) {
    if (projectDir(cfg.name) === dir) {
      // 已注册的旧项目也借此机会把本机缓存回写为可移植项目定义。
      syncProjectManifest(cfg.name)
      return listProjects().find((p) => p.id === existing.id)!
    }
    throw new Error(`同名项目已注册（当前指向 ${projectDir(cfg.name)}）；如需改指向本目录，请在项目设置中重绑目录`)
  }
  const conns = cfg.connections ?? []
  if (!conns.length) throw new Error(`${PROJECT_MANIFEST} 未声明 connections`)
  const missing = conns.filter((cn) => !getConnection({ name: cn }))
  if (missing.length) throw new Error(`连接未注册：${missing.join('、')}（先在「连接」页注册同名连接再打开）`)
  const d = getDb()
  const info = d.prepare('INSERT INTO projects(name, comment, dir) VALUES(?,?,?)').run(cfg.name, cfg.comment ?? '', dir)
  const pid = Number(info.lastInsertRowid)
  const bind = d.prepare('INSERT OR IGNORE INTO project_connections(project_id, connection_id) VALUES(?,?)')
  for (const cn of conns) {
    bind.run(pid, (getConnection({ name: cn }) as { id: number }).id)
  }
  hydrateManifestContracts(cfg, pid)
  // 兼容旧 project.json 时，首次打开即写出 project.yaml；不创建/调整任何业务目录。
  writeManifest(dir, cfg)
  return listProjects().find((p) => p.id === pid)!
}

export function updateProject(id: number, patch: { comment?: string; connections?: string[]; dir?: string; platform?: ProjectPlatform }): void {
  const d = getDb()
  if (patch.dir !== undefined) {
    if (!patch.dir.trim()) throw new Error('项目目录不能为空')
    d.prepare('UPDATE projects SET dir=? WHERE id=?').run(patch.dir.trim(), id)
  }
  if (patch.comment !== undefined) d.prepare('UPDATE projects SET comment=? WHERE id=?').run(patch.comment, id)
  if (patch.platform !== undefined) {
    if (!['desktop', 'mobile', 'dual'].includes(patch.platform)) throw new Error('项目平台必须是 desktop / mobile / dual')
    const row = d.prepare('SELECT name FROM projects WHERE id=?').get(id) as { name: string } | undefined
    if (!row) throw new Error('项目不存在')
    const root = projectDir(row.name)
    const manifest = readManifest(root)
    const incompatible = manifest.managed.pages.filter((page) => patch.platform !== 'dual' && page.platform !== patch.platform)
    if (incompatible.length > 0) {
      throw new Error(`项目仍有不兼容的${incompatible[0].platform === 'desktop' ? '桌面端' : '移动端'}页面：${incompatible.map((x) => x.id).join('、')}；请先切换为双端并调整页面端类型`)
    }
    manifest.platform = patch.platform
    writeManifest(root, manifest)
  }
  if (patch.connections) {
    for (const cn of patch.connections) {
      if (!getConnection({ name: cn })) throw new Error(`连接不存在：${cn}`)
    }
    const tx = d.transaction(() => {
      d.prepare('DELETE FROM project_connections WHERE project_id=?').run(id)
      const bind = d.prepare('INSERT OR IGNORE INTO project_connections(project_id, connection_id) VALUES(?,?)')
      for (const cn of patch.connections!) {
        bind.run(id, (getConnection({ name: cn }) as { id: number }).id)
      }
    })
    tx()
    // 数据集引用了被解绑的连接时给出提示（不强制阻止，构建时连接名仍会写入）
  }
  const r = d.prepare('SELECT name FROM projects WHERE id=?').get(id) as { name: string } | undefined
  if (r) syncProjectManifest(r.name)
}

export function deleteProject(id: number): void {
  getDb().prepare('DELETE FROM projects WHERE id=?').run(id)
}

/** reportlets 下已部署但未建项目的目录（供扫描导入） */
export function scanDeployedProjects(): string[] {
  const s = getSettings()
  if (!s.reportletsPath || !existsSync(s.reportletsPath)) return []
  const known = new Set(listProjects().map((p) => p.name))
  return readdirSync(s.reportletsPath)
    .filter((f) => {
      const p = join(s.reportletsPath, f)
      try { return statSync(p).isDirectory() && (existsSync(join(p, PROJECT_MANIFEST)) || existsSync(join(p, 'project.json'))) } catch { return false }
    })
    .filter((f) => NAME_RE.test(f) && !known.has(f))
}

/** 传统 CPT 不进入 project.yaml；仅用于工作台浏览/Agent 的轻量引用。 */
export function listTraditionalCpts(project: string) {
  return scanTraditionalCpts(project)
}

/** 新机器添加项目时，用 project.yaml 的可移植定义重建本机 SQLite 缓存。 */
function hydrateManifestContracts(manifest: ProjectManifest, projectId: number): void {
  const d = getDb()
  const connectionId = (name: string): number => {
    const c = getConnection({ name })
    if (!c) throw new Error(`项目定义引用的连接未注册：${name}`)
    return c.id
  }
  const tx = d.transaction(() => {
    const insertDataset = d.prepare(`INSERT OR IGNORE INTO datasets(project_id, connection_id, name, kind, comment, params, sql)
      VALUES(?,?,?,?,?,?,?)`)
    for (const ds of manifest.contracts.datasets) {
      insertDataset.run(projectId, connectionId(ds.connection), ds.name, ds.kind, ds.comment, JSON.stringify(ds.params), ds.sql)
    }
    const insertProcedure = d.prepare('INSERT OR IGNORE INTO procedures(project_id, connection_id, name, comment) VALUES(?,?,?,?)')
    for (const procedure of manifest.contracts.procedures) {
      insertProcedure.run(projectId, connectionId(procedure.connection), procedure.name, procedure.comment)
    }
  })
  tx()
}

// ── 接口契约 ────────────────────────────────────────────────────

function rowToDataset(r: Record<string, unknown>): Dataset {
  const d = getDb()
  const conn = d.prepare('SELECT name FROM connections WHERE id=?').get(r.connection_id as number) as { name: string } | undefined
  return {
    id: r.id as number,
    projectId: r.project_id as number,
    name: r.name as string,
    kind: r.kind as DatasetKind,
    comment: r.comment as string,
    params: JSON.parse((r.params as string) || '[]') as DatasetParam[],
    sql: r.sql as string,
    connection: conn?.name ?? '?',
    updatedAt: r.updated_at as string
  }
}

export function listDatasets(project: string): Dataset[] {
  const p = getProjectByName(project)
  if (!p) throw new Error(`项目不存在：${project}`)
  const rows = getDb().prepare('SELECT * FROM datasets WHERE project_id=? ORDER BY id').all(p.id) as Array<Record<string, unknown>>
  return rows.map(rowToDataset)
}

/** 读取单个接口契约，供 Agent 按资源引用精确加载，避免把整个项目接口塞入上下文。 */
export function readDataset(project: string, name: string): Dataset {
  const p = getProjectByName(project)
  if (!p) throw new Error(`项目不存在：${project}`)
  const row = getDb().prepare('SELECT * FROM datasets WHERE project_id=? AND name=?').get(p.id, name) as Record<string, unknown> | undefined
  if (!row) throw new Error(`接口不存在：${project}/${name}`)
  return rowToDataset(row)
}

/** 每个接口的最近实测状态（api_tests 只增不改，取每 dataset 最新一条） */
export function datasetStatuses(project: string): Record<string, DatasetStatus> {
  const p = getProjectByName(project)
  if (!p) return {}
  const d = getDb()
  const rows = d.prepare(`
    SELECT t.dataset, t.ok, t.err_code, t.duration_ms, t.created_at,
           json_extract(t.response, '$.data') AS data
    FROM api_tests t
    WHERE t.dataset_id IN (SELECT id FROM datasets WHERE project_id=?)
    ORDER BY t.id`).all(p.id) as Array<Record<string, unknown>>
  const latest = new Map<string, Record<string, unknown>>()
  for (const r of rows) latest.set(r.dataset as string, r) // 顺序遍历，后者覆盖 → 最新
  const build = lastDataBuild(project)
  const out: Record<string, DatasetStatus> = {}
  for (const [name, r] of latest) {
    const ok = r.ok === 1
    let why: string | undefined
    if (!ok) {
      try { why = (JSON.parse(String(r.response ?? '{}')) as { err_msg?: string }).err_msg } catch { /* ignore */ }
    }
    let rowCount = 0
    try { const dd = JSON.parse(String(r.data ?? 'null')); if (Array.isArray(dd)) rowCount = dd.length } catch { /* ignore */ }
    out[name] = {
      test: {
        st: ok ? 'ok' : 'fail',
        t: r.created_at as string,
        rows: rowCount,
        ms: r.duration_ms as number,
        ec: r.err_code as number | null,
        why
      },
      build
    }
  }
  return out
}

function lastDataBuild(project: string): string | undefined {
  const r = getDb().prepare(
    "SELECT created_at FROM builds WHERE kind='data' AND target=? ORDER BY id DESC LIMIT 1"
  ).get(`${project}/${dataCptForProject(project)}`) as { created_at: string } | undefined
  return r?.created_at
}

export function saveDataset(project: string, input: {
  name: string
  kind?: DatasetKind
  comment?: string
  params?: DatasetParam[]
  sql?: string
  connection?: string
}, expectId?: number): Dataset {
  const p = getProjectByName(project)
  if (!p) throw new Error(`项目不存在：${project}`)
  assertProjectName(input.name)
  const d = getDb()
  const bound = projectConnections(p.id)
  let connId: number
  if (input.connection) {
    const c = getConnection({ name: input.connection })
    if (!c) throw new Error(`连接不存在：${input.connection}`)
    if (!bound.includes(input.connection)) throw new Error(`连接 ${input.connection} 未绑定到项目 ${project}（先在项目设置中绑定）`)
    connId = c.id
  } else {
    if (!bound.length) throw new Error(`项目 ${project} 未绑定任何连接`)
    connId = (getConnection({ name: bound[0] }) as { id: number }).id
  }
  const params = JSON.stringify(input.params ?? [])
  const existing = d.prepare('SELECT id FROM datasets WHERE project_id=? AND name=?').get(p.id, input.name) as { id: number } | undefined
  const targetId = expectId ?? existing?.id
  if (targetId) {
    d.prepare(`UPDATE datasets SET name=?, kind=?, comment=?, params=?, sql=?, connection_id=?, updated_at=datetime('now','localtime') WHERE id=? AND project_id=?`)
      .run(input.name, input.kind ?? 'other', input.comment ?? '', params, input.sql ?? '', connId, targetId, p.id)
  } else {
    d.prepare('INSERT INTO datasets(project_id, connection_id, name, kind, comment, params, sql) VALUES(?,?,?,?,?,?,?)')
      .run(p.id, connId, input.name, input.kind ?? 'other', input.comment ?? '', params, input.sql ?? '')
  }
  const saved = d.prepare('SELECT * FROM datasets WHERE project_id=? AND name=?').get(p.id, input.name) as Record<string, unknown>
  syncProjectManifest(project)
  return rowToDataset(saved)
}

export function deleteDataset(project: string, name: string): void {
  const p = getProjectByName(project)
  if (!p) throw new Error(`项目不存在：${project}`)
  getDb().prepare('DELETE FROM datasets WHERE project_id=? AND name=?').run(p.id, name)
  syncProjectManifest(project)
}

// ── 数据层构建（一项目一页 _data.cpt，页内每数据集各带连接名） ──

export function buildDataCpt(project: string): BuildResult {
  const p = getProjectByName(project)
  if (!p) throw new Error(`项目不存在：${project}`)
  const log: string[] = []
  const datasets = listDatasets(project)
  log.push(`读取契约：${datasets.length} 个接口`)

  const bound = projectConnections(p.id)
  const defaultDb = bound[0] ?? datasets[0]?.connection ?? requireConnection().name

  const xml = generateDataCpt(dataTemplateRaw, {
    defaultDbName: defaultDb,
    datasets: datasets.map((ds) => ({ name: ds.name, sql: ds.sql, params: ds.params, dbConnection: ds.connection }))
  })
  log.push(`XML 装配完成（${xml.length} 字符）`)

  // 连接分布（日志可读性）
  const dist = new Map<string, number>()
  for (const ds of datasets) dist.set(ds.connection, (dist.get(ds.connection) ?? 0) + 1)
  log.push(`连接分布：${[...dist.entries()].map(([c, n]) => `${c} ×${n}`).join(' · ') || '（无数据集）'}`)

  const findings: CheckerFinding[] = checkDataCpt(xml)
  // 过程命名规范检测：接口 SQL 的 CALL 目标必须 sp_{项目名}_{功能模块}_{操作}（登记的过程按归属项目前缀校验）
  const procOwners = Object.fromEntries(listProcedures(project).map((r) => [r.name, r.srcProject ?? project]))
  findings.push(...checkProcedureCalls(project, datasets.map((d) => ({ dataset: d.name, sql: d.sql })), procOwners))
  const errCount = findings.filter((f) => f.severity === 'error').length
  const warnCount = findings.filter((f) => f.severity === 'warning').length
  log.push(`质量门：${errCount} error / ${warnCount} warning`)

  const cptPath = dataCptForProject(project)
  const outputPath = join(projectDir(project), cptPath)
  const outDir = join(outputPath, '..')

  const ok = !hasError(findings)
  if (ok) {
    mkdirSync(outDir, { recursive: true })
    writeFileSync(outputPath, xml, 'utf-8')
    log.push(`已部署：${outputPath}`)
  } else {
    log.push('存在 error，未落盘')
  }

  getDb().prepare('INSERT INTO builds(kind, target, ok, log) VALUES(?,?,?,?)')
    .run('data', `${project}/${cptPath}`, ok ? 1 : 0, JSON.stringify(log))

  return { ok, kind: 'data', target: `${project}/${cptPath}`, outputPath: ok ? outputPath : undefined, findings, log }
}

// ── 接口实测 ────────────────────────────────────────────────────

export interface TestOutcome {
  ok: boolean
  errCode: number | null
  durationMs: number
  response: unknown
  rowCount: number
}

/** 用契约参数默认值 + 调用方覆盖值实测一个接口 */
export async function testDataset(project: string, datasetName: string, overrides: Record<string, unknown> = {}): Promise<TestOutcome> {
  const p = getProjectByName(project)
  if (!p) throw new Error(`项目不存在：${project}`)
  const row = getDb().prepare('SELECT * FROM datasets WHERE project_id=? AND name=?').get(p.id, datasetName) as Record<string, unknown> | undefined
  if (!row) throw new Error(`接口不存在：${project}.${datasetName}`)
  const ds = rowToDataset(row)

  const typeMap: Record<string, string> = { string: 'String', integer: 'Integer', double: 'Double', formula: 'String' }
  const parameters = ds.params
    .filter((x) => x.type !== 'formula') // formula 参数由帆软服务端注入当前会话值，不随请求传递
    .map((x) => ({
      name: x.name,
      type: typeMap[x.type] || 'String',
      value: overrides[x.name] !== undefined ? overrides[x.name] : (x.default ?? '')
    }))

  const req: ApiDataRequest = {
    report_path: reportletFile(project, dataCptForProject(project)),
    datasource_name: datasetName,
    page_number: -1,
    page_size: -1,
    parameters
  }
  return invokeAndStore(req, p.id, ds.id, datasetName)
}

export async function testAllDatasets(project: string): Promise<Array<{ dataset: string } & TestOutcome>> {
  const names = listDatasets(project).map((x) => x.name)
  const results: Array<{ dataset: string } & TestOutcome> = []
  for (const n of names) {
    try {
      results.push({ dataset: n, ...(await testDataset(project, n)) })
    } catch (e) {
      results.push({ dataset: n, ok: false, errCode: null, durationMs: 0, response: { error: (e as Error).message }, rowCount: 0 })
    }
  }
  return results
}

/** 一键验收：构建 + 全量实测 */
export async function verifyProject(project: string): Promise<{ build: BuildResult; tests: Array<{ dataset: string } & TestOutcome> }> {
  const build = buildDataCpt(project)
  const tests = await testAllDatasets(project)
  return { build, tests }
}

async function invokeAndStore(req: ApiDataRequest, projectId: number, datasetId: number, datasetName: string): Promise<TestOutcome> {
  const { body, durationMs } = await callApiData(req)
  const ok = body.err_code === 0
  const rowCount = Array.isArray(body.data) ? body.data.length : 0
  getDb().prepare(`INSERT INTO api_tests(module_id, dataset_id, dataset, request, response, ok, err_code, duration_ms)
                   VALUES(?,?,?,?,?,?,?,?)`)
    .run(projectId, datasetId, datasetName, JSON.stringify(req), JSON.stringify(body), ok ? 1 : 0, body.err_code ?? null, durationMs)
  return { ok, errCode: body.err_code ?? null, durationMs, response: body, rowCount }
}

export function listApiTests(limit = 50, projectId?: number): Array<Record<string, unknown>> {
  const d = getDb()
  return (projectId
    ? d.prepare('SELECT * FROM api_tests WHERE module_id=? ORDER BY id DESC LIMIT ?').all(projectId, limit)
    : d.prepare('SELECT * FROM api_tests ORDER BY id DESC LIMIT ?').all(limit)) as Array<Record<string, unknown>>
}

export function listBuilds(limit = 50): Array<Record<string, unknown>> {
  return getDb().prepare('SELECT * FROM builds ORDER BY id DESC LIMIT ?').all(limit) as Array<Record<string, unknown>>
}

// ── 存储过程（归属项目 + 关联共享） ─────────────────────────────

function metaRoot(project: string): string {
  return join(projectDir(project), 'meta')
}

function procMetaPath(project: string, procName: string): string {
  try {
    const path = manifestForProject(project).contracts.procedures.find((x) => x.name === procName)?.definition
    if (path) return resolveProjectFile(projectDir(project), path)
  } catch { /* 项目清单尚未创建时，使用新建项目默认位置 */ }
  return join(metaRoot(project), `${procName}.sql`)
}

export function listProcedures(project: string): ProcRecord[] {
  const d = getDb()
  const p = getProjectByName(project)
  if (!p) throw new Error(`项目不存在：${project}`)
  const out: ProcRecord[] = []

  const own = d.prepare(`
    SELECT sp.*, c.name AS conn_name,
      (SELECT COUNT(*) FROM ddl_log l WHERE l.kind='procedure' AND l.ok=1 AND l.target LIKE '%.' || sp.name) AS applied
    FROM procedures sp JOIN connections c ON c.id = sp.connection_id
    WHERE sp.project_id=? ORDER BY sp.name`).all(p.id) as Array<Record<string, unknown>>
  for (const r of own) {
    out.push({
      id: r.id as number,
      projectId: p.id,
      connection: r.conn_name as string,
      name: r.name as string,
      comment: r.comment as string,
      updatedAt: r.updated_at as string,
      own: true,
      appliedCount: r.applied as number
    })
  }

  const linked = d.prepare(`
    SELECT sp.*, c.name AS conn_name, pr.name AS src_project,
      (SELECT COUNT(*) FROM ddl_log l WHERE l.kind='procedure' AND l.ok=1 AND l.target LIKE '%.' || sp.name) AS applied
    FROM proc_links pl
    JOIN procedures sp ON sp.id = pl.procedure_id
    JOIN connections c ON c.id = sp.connection_id
    JOIN projects pr ON pr.id = sp.project_id
    WHERE pl.project_id=? ORDER BY sp.name`).all(p.id) as Array<Record<string, unknown>>
  for (const r of linked) {
    out.push({
      id: r.id as number,
      projectId: r.project_id as number,
      connection: r.conn_name as string,
      name: r.name as string,
      comment: r.comment as string,
      updatedAt: r.updated_at as string,
      own: false,
      srcProject: r.src_project as string,
      appliedCount: r.applied as number
    })
  }
  return out
}

/** 过程定义：meta/{name}.sql 为源（版本化），缺省回退 SHOW CREATE */
export async function procedureDefinition(project: string, name: string): Promise<string> {
  const meta = procMetaPath(project, name)
  if (existsSync(meta)) return readFileSync(meta, 'utf-8')
  const rec = listProcedures(project).find((x) => x.name === name)
  if (!rec) throw new Error(`过程不存在：${project}.${name}`)
  const { getProcedureDefinition } = await import('./mysqlService')
  return getProcedureDefinition(name, undefined, { name: rec.connection })
}

/** 创建/更新过程契约（归属本项目）+ 定义存 meta/；命名必须 sp_{项目名}_{功能模块}_{操作} */
export function saveProcedure(project: string, input: { name: string; connection?: string; comment?: string; definition?: string }): ProcRecord {
  const p = getProjectByName(project)
  if (!p) throw new Error(`项目不存在：${project}`)
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(input.name)) throw new Error('过程名仅允许字母开头，字母/数字/下划线')
  assertProcedureName(project, input.name)
  const d = getDb()
  const bound = projectConnections(p.id)
  let connName = input.connection ?? bound[0]
  if (!connName) throw new Error(`项目 ${project} 未绑定任何连接`)
  const c = getConnection({ name: connName })
  if (!c) throw new Error(`连接不存在：${connName}`)
  if (!bound.includes(connName)) throw new Error(`连接 ${connName} 未绑定到项目 ${project}`)

  const existing = d.prepare('SELECT id FROM procedures WHERE project_id=? AND name=?').get(p.id, input.name) as { id: number } | undefined
  if (existing) {
    d.prepare(`UPDATE procedures SET connection_id=?, comment=?, updated_at=datetime('now','localtime') WHERE id=?`)
      .run(c.id, input.comment ?? '', existing.id)
  } else {
    d.prepare('INSERT INTO procedures(project_id, connection_id, name, comment) VALUES(?,?,?,?)')
      .run(p.id, c.id, input.name, input.comment ?? '')
  }
  if (input.definition?.trim()) {
    mkdirSync(dirname(procMetaPath(project, input.name)), { recursive: true })
    writeFileSync(procMetaPath(project, input.name), input.definition, 'utf-8')
  }
  const saved = listProcedures(project).find((x) => x.name === input.name && x.own)!
  syncProjectManifest(project)
  return saved
}

/** 应用过程（DROP IF EXISTS + CREATE）：定义取 meta 文件，应用后审计；own 与关联项目均可应用 */
export async function applyProjectProcedure(project: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const rec = listProcedures(project).find((x) => x.name === name)
  if (!rec) throw new Error(`过程不存在：${project}.${name}`)
  const ownerProject = rec.own ? project : rec.srcProject!
  const defPath = procMetaPath(ownerProject, name)
  if (!existsSync(defPath)) throw new Error(`缺少定义文件：${defPath}（先在「定义」中保存 CREATE PROCEDURE 语句）`)
  const definition = readFileSync(defPath, 'utf-8')
  const r = await applyProcedureMysql(definition, name, { name: rec.connection })
  if (r.ok) {
    getDb().prepare(`UPDATE procedures SET updated_at=datetime('now','localtime') WHERE id=?`).run(rec.id)
  }
  return r
}

export function linkProcedure(project: string, procedureId: number): void {
  const d = getDb()
  const p = getProjectByName(project)
  if (!p) throw new Error(`项目不存在：${project}`)
  const target = d.prepare('SELECT project_id FROM procedures WHERE id=?').get(procedureId) as { project_id: number } | undefined
  if (!target) throw new Error('目标过程不存在')
  if (target.project_id === p.id) throw new Error('本项目创建的过程无需关联')
  d.prepare('INSERT OR IGNORE INTO proc_links(project_id, procedure_id) VALUES(?,?)').run(p.id, procedureId)
}

export function unlinkProcedure(project: string, procedureId: number): void {
  const p = getProjectByName(project)
  if (!p) throw new Error(`项目不存在：${project}`)
  getDb().prepare('DELETE FROM proc_links WHERE project_id=? AND procedure_id=?').run(p.id, procedureId)
}

export function deleteProcedure(project: string, name: string): void {
  const d = getDb()
  const p = getProjectByName(project)
  if (!p) throw new Error(`项目不存在：${project}`)
  const rec = d.prepare('SELECT id FROM procedures WHERE project_id=? AND name=?').get(p.id, name) as { id: number } | undefined
  if (!rec) throw new Error(`过程不存在：${project}.${name}`)
  const linked = d.prepare('SELECT COUNT(*) AS c FROM proc_links WHERE procedure_id=?').get(rec.id) as { c: number }
  if (linked.c > 0) throw new Error(`该过程被 ${linked.c} 个项目关联，先解除关联再删除`)
  d.prepare('DELETE FROM procedures WHERE id=?').run(rec.id)
  const meta = procMetaPath(project, name)
  if (existsSync(meta)) unlinkSync(meta)
  syncProjectManifest(project)
}

/** 可供本项目关联的其他项目过程清单 */
export function linkableProcedures(project: string): Array<{ id: number; name: string; srcProject: string; connection: string; comment: string; appliedCount: number }> {
  const d = getDb()
  const p = getProjectByName(project)
  if (!p) return []
  const rows = d.prepare(`
    SELECT sp.id, sp.name, sp.comment, pr.name AS src_project, c.name AS conn_name,
      (SELECT COUNT(*) FROM ddl_log l WHERE l.kind='procedure' AND l.ok=1 AND l.target LIKE '%.' || sp.name) AS applied
    FROM procedures sp
    JOIN projects pr ON pr.id = sp.project_id
    JOIN connections c ON c.id = sp.connection_id
    WHERE sp.project_id != ?
      AND sp.id NOT IN (SELECT procedure_id FROM proc_links WHERE project_id = ?)
    ORDER BY pr.name, sp.name`).all(p.id, p.id) as Array<Record<string, unknown>>
  return rows.map((r) => ({
    id: r.id as number,
    name: r.name as string,
    srcProject: r.src_project as string,
    connection: r.conn_name as string,
    comment: r.comment as string,
    appliedCount: r.applied as number
  }))
}

/** 试执行 CALL（真实执行，审计） */
export async function callProcedureSql(sql: string, connection: string): Promise<{ ok: boolean; error?: string; result?: unknown }> {
  return guardedExec(sql, 'call', '试执行 CALL', { name: connection })
}

// ── 项目文档（meta/ 元数据） ────────────────────────────────────

export function listDocs(project: string): DocMeta[] {
  const dir = metaRoot(project)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => DOC_NAME_RE.test(f))
    .map((f) => {
      const st = statSync(join(dir, f))
      return {
        name: f,
        type: docMetaType(f),
        size: st.size,
        mtime: st.mtimeMs
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function readDoc(project: string, name: string): string {
  if (!DOC_NAME_RE.test(name)) throw new Error('文档名不合法')
  const p = join(metaRoot(project), name)
  if (!existsSync(p)) throw new Error(`文档不存在：${name}`)
  return readFileSync(p, 'utf-8')
}

/** Agent 专用：概览或分页正文；UI 编辑器仍通过 readDoc 读取完整文件。 */
export function inspectDoc(project: string, name: string, options: DocInspectOptions = {}): Record<string, unknown> {
  const content = readDoc(project, name)
  const stat = statSync(join(metaRoot(project), name))
  const type = docMetaType(name)
  return inspectDocumentContent(content, { name, type, size: stat.size, mtime: stat.mtimeMs }, options)
}

export function saveDoc(project: string, name: string, content: string, options: { overwrite?: boolean } = {}): void {
  if (!DOC_NAME_RE.test(name)) throw new Error('文档名仅支持 .md / .txt / .html / .sql / .js / .jsx / .mjs / .css 结尾')
  const dir = metaRoot(project)
  const path = join(dir, name)
  if (existsSync(path) && !options.overwrite) {
    throw new Error(`文档已存在：${name}。请先用 patch_doc 修改片段；只有明确需要整份覆盖时才传 overwrite=true`)
  }
  mkdirSync(dir, { recursive: true })
  writeFileSync(path, content, 'utf-8')
}

/** 对项目 meta/ 文档的精确唯一片段替换。 */
export function patchDoc(project: string, name: string, oldText: string, newText: string): void {
  if (!DOC_NAME_RE.test(name)) throw new Error('文档名不合法')
  const path = join(metaRoot(project), name)
  if (!existsSync(path)) throw new Error(`文档不存在：${name}`)
  const content = readFileSync(path, 'utf-8')
  writeFileSync(path, replaceUniqueText(content, oldText, newText, `文档 ${name}`), 'utf-8')
}

/** 从用户明确选择的文本文件复制到项目 meta/；不允许路径或格式绕过。 */
export function importDoc(project: string, source: string): DocMeta {
  if (!existsSync(source)) throw new Error('待导入文件不存在')
  const stat = statSync(source)
  if (!stat.isFile()) throw new Error('只能导入文件')
  if (stat.size > MAX_IMPORTED_DOC_BYTES) throw new Error('文档超过 2MB，暂不支持导入')
  const original = basename(source)
  if (!DOC_NAME_RE.test(original)) throw new Error('仅支持导入 Markdown、文本、HTML、SQL、JavaScript 或 CSS 文件')

  const dir = metaRoot(project)
  mkdirSync(dir, { recursive: true })
  const ext = extname(original)
  const stem = original.slice(0, -ext.length)
  let name = original
  let index = 1
  while (existsSync(join(dir, name))) name = `${stem}-${index++}${ext}`
  copyFileSync(source, join(dir, name))
  return { name, type: docMetaType(name), size: stat.size, mtime: statSync(join(dir, name)).mtimeMs }
}

export function deleteDoc(project: string, name: string): void {
  const p = join(metaRoot(project), name)
  if (existsSync(p)) unlinkSync(p)
}

export function renameDoc(project: string, name: string, newName: string): void {
  if (!DOC_NAME_RE.test(newName)) throw new Error('文档名仅支持 .md / .txt / .html / .sql / .js / .jsx / .mjs / .css 结尾')
  const dir = metaRoot(project)
  renameSync(join(dir, name), join(dir, newName))
}

// ── 连接健康（供状态/工作台） ───────────────────────────────────

export async function connectionsHealth(): Promise<ConnectionHealth[]> {
  const { listConnections } = await import('./connectionsService')
  const conns = listConnections()
  return Promise.all(conns.map((c) => pingConnection(c)))
}

// ── 契约导入/导出（项目级 JSON 备份/共享） ──────────────────────

export function exportProject(project: string): string {
  const p = getProjectByName(project)
  if (!p) throw new Error(`项目不存在：${project}`)
  return JSON.stringify({
    name: p.name,
    comment: p.comment,
    connections: projectConnections(p.id),
    datasets: listDatasets(project).map((x) => ({ name: x.name, kind: x.kind, comment: x.comment, params: x.params, sql: x.sql, connection: x.connection })),
    procedures: listProcedures(project).filter((x) => x.own).map((x) => ({ name: x.name, connection: x.connection, comment: x.comment }))
  }, null, 2)
}

export function importProject(json: string, overwrite = false): Project {
  const parsed = JSON.parse(json) as {
    name: string; comment?: string; connections?: string[]
    datasets?: Array<{ name: string; kind?: DatasetKind; comment?: string; params?: DatasetParam[]; sql?: string; connection?: string }>
    procedures?: Array<{ name: string; connection?: string; comment?: string }>
  }
  if (!parsed.name) throw new Error('导入 JSON 缺少 name')
  const existing = getProjectByName(parsed.name)
  if (existing && !overwrite) throw new Error(`项目已存在：${parsed.name}（如需覆盖请开启 overwrite）`)
  const conns = parsed.connections?.length ? parsed.connections : [getConnection()?.name].filter(Boolean) as string[]
  const proj = existing ?? createProject(parsed.name, conns, parsed.comment || '')
  for (const ds of parsed.datasets ?? []) saveDataset(proj.name, ds)
  for (const sp of parsed.procedures ?? []) saveProcedure(proj.name, { name: sp.name, connection: sp.connection, comment: sp.comment })
  return listProjects().find((x) => x.id === proj.id)!
}

// ── 项目打包（整目录 zip 交付） ─────────────────────────────────

/**
 * 构建项目 zip 字节流（exportProjectZip 落盘与邮件分卷发送共用）：
 * project.yaml、受管 jsx/mjs/cpt、传统 CPT、meta 文档全部收入，
 * 跳过 .git/node_modules/系统杂项；zip 顶层带项目名目录，解压后可直接「打开项目」。
 * rawBytes 为条目未压缩字节合计（打包弹窗展示「原目录大小」用）。
 */
export function buildProjectZip(project: string): { zip: Buffer; entries: number; rawBytes: number } {
  assertProjectName(project)
  const root = projectDir(project)
  if (!existsSync(root)) throw new Error(`项目目录不存在：${root}`)
  // 顶层目录条目显式写入，即使项目为空结构，解压后也有以项目名命名的文件夹
  const entries = [
    { name: `${project}/`, data: Buffer.alloc(0), mtime: new Date() },
    ...collectZipEntries(root).map((e) => ({ ...e, name: `${project}/${e.name}` }))
  ]
  const rawBytes = entries.reduce((sum, e) => sum + e.data.length, 0)
  return { zip: buildZip(entries), entries: entries.length, rawBytes }
}

/**
 * 项目整体打包落盘。目标已存在同名 zip 时自动加 -1/-2 后缀，不覆盖任何已有文件。
 */
export function exportProjectZip(project: string, destDir: string): { path: string; entries: number; bytes: number } {
  const { zip, entries } = buildProjectZip(project)
  mkdirSync(destDir, { recursive: true })
  let out = join(destDir, `${project}.zip`)
  let i = 1
  while (existsSync(out)) out = join(destDir, `${project}-${i++}.zip`)
  writeFileSync(out, zip)
  return { path: out, entries, bytes: zip.length }
}
