/**
 * 模块与数据接口（dataset）管理 + 数据层 CPT 构建 + /api/data 测试
 */

import { existsSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getDb, getSettings } from './db'
import { generateDataCpt } from './cpt/dataWriter'
import { checkDataCpt, hasError } from './cpt/checker'
import { callApiData, type ApiDataRequest } from './frClient'
import type { Dataset, DatasetKind, DatasetParam, Module, BuildResult, CheckerFinding } from '@shared/types'
import dataTemplateRaw from './templates/base_cpt_data.cpt?raw'

// ── 模块 ────────────────────────────────────────────────────────

export function listModules(): Array<Module & { datasetCount: number }> {
  const d = getDb()
  const rows = d.prepare(`
    SELECT m.*, (SELECT COUNT(*) FROM datasets ds WHERE ds.module_id = m.id) AS datasetCount
    FROM modules m ORDER BY m.name`).all() as Array<Record<string, unknown>>
  return rows.map((r) => ({
    id: r.id as number,
    name: r.name as string,
    datasource: r.datasource as string,
    comment: r.comment as string,
    createdAt: r.created_at as string,
    datasetCount: r.datasetCount as number
  }))
}

export function createModule(name: string, datasource: string, comment = ''): Module {
  if (!/^[a-z][a-z0-9_]*$/i.test(name)) {
    throw new Error('模块名仅允许字母/数字/下划线（将作为 reportlets 子目录名）')
  }
  const info = getDb().prepare('INSERT INTO modules(name, datasource, comment) VALUES(?,?,?)').run(name, datasource, comment)
  return { id: Number(info.lastInsertRowid), name, datasource, comment, createdAt: new Date().toISOString() }
}

export function updateModule(id: number, patch: { datasource?: string; comment?: string }): void {
  const d = getDb()
  if (patch.datasource !== undefined) d.prepare('UPDATE modules SET datasource=? WHERE id=?').run(patch.datasource, id)
  if (patch.comment !== undefined) d.prepare('UPDATE modules SET comment=? WHERE id=?').run(patch.comment, id)
}

export function deleteModule(id: number): void {
  getDb().prepare('DELETE FROM modules WHERE id=?').run(id)
}

function getModuleByName(name: string): Module | undefined {
  const r = getDb().prepare('SELECT * FROM modules WHERE name=?').get(name) as Record<string, unknown> | undefined
  if (!r) return undefined
  return { id: r.id as number, name: r.name as string, datasource: r.datasource as string, comment: r.comment as string, createdAt: r.created_at as string }
}

// ── 数据集（接口） ──────────────────────────────────────────────

function rowToDataset(r: Record<string, unknown>): Dataset {
  return {
    id: r.id as number,
    moduleId: r.module_id as number,
    name: r.name as string,
    kind: r.kind as DatasetKind,
    comment: r.comment as string,
    params: JSON.parse((r.params as string) || '[]') as DatasetParam[],
    sql: r.sql as string,
    updatedAt: r.updated_at as string
  }
}

export function listDatasets(moduleName: string): Dataset[] {
  const mod = getModuleByName(moduleName)
  if (!mod) throw new Error(`模块不存在：${moduleName}`)
  const rows = getDb().prepare('SELECT * FROM datasets WHERE module_id=? ORDER BY id').all(mod.id) as Array<Record<string, unknown>>
  return rows.map(rowToDataset)
}

export function saveDataset(moduleName: string, input: {
  name: string
  kind?: DatasetKind
  comment?: string
  params?: DatasetParam[]
  sql?: string
}, expectId?: number): Dataset {
  const mod = getModuleByName(moduleName)
  if (!mod) throw new Error(`模块不存在：${moduleName}`)
  if (!/^[a-z][a-z0-9_]*$/i.test(input.name)) {
    throw new Error('接口名仅允许字母/数字/下划线')
  }
  const d = getDb()
  const params = JSON.stringify(input.params ?? [])
  if (expectId) {
    d.prepare(`UPDATE datasets SET name=?, kind=?, comment=?, params=?, sql=?, updated_at=datetime('now','localtime') WHERE id=? AND module_id=?`)
      .run(input.name, input.kind ?? 'other', input.comment ?? '', params, input.sql ?? '', expectId, mod.id)
  } else {
    d.prepare('INSERT INTO datasets(module_id, name, kind, comment, params, sql) VALUES(?,?,?,?,?,?)')
      .run(mod.id, input.name, input.kind ?? 'other', input.comment ?? '', params, input.sql ?? '')
  }
  const saved = getDb().prepare('SELECT * FROM datasets WHERE module_id=? AND name=?').get(mod.id, input.name) as Record<string, unknown>
  return rowToDataset(saved)
}

export function deleteDataset(moduleName: string, name: string): void {
  const mod = getModuleByName(moduleName)
  if (!mod) throw new Error(`模块不存在：${moduleName}`)
  getDb().prepare('DELETE FROM datasets WHERE module_id=? AND name=?').run(mod.id, name)
}

// ── 数据层 CPT 构建 ─────────────────────────────────────────────

export function buildDataCpt(moduleName: string): BuildResult {
  const mod = getModuleByName(moduleName)
  if (!mod) throw new Error(`模块不存在：${moduleName}`)
  const s = getSettings()
  const log: string[] = []
  const datasets = listDatasets(moduleName)
  log.push(`读取契约：${datasets.length} 个接口`)

  const xml = generateDataCpt(dataTemplateRaw, {
    defaultDbName: mod.datasource || s.mysqlDatabase,
    datasets: datasets.map((ds) => ({ name: ds.name, sql: ds.sql, params: ds.params }))
  })
  log.push(`XML 装配完成（${xml.length} 字符）`)

  const findings: CheckerFinding[] = checkDataCpt(xml)
  const errCount = findings.filter((f) => f.severity === 'error').length
  const warnCount = findings.filter((f) => f.severity === 'warning').length
  log.push(`质量门：${errCount} error / ${warnCount} warning`)

  const outDir = join(s.reportletsPath, moduleName, 'data')
  const outputPath = join(outDir, `${moduleName}_data.cpt`)

  const ok = !hasError(findings)
  if (ok) {
    mkdirSync(outDir, { recursive: true })
    writeFileSync(outputPath, xml, 'utf-8')
    log.push(`已部署：${outputPath}`)
  } else {
    log.push('存在 error，未落盘')
  }

  getDb().prepare('INSERT INTO builds(kind, target, ok, log) VALUES(?,?,?,?)')
    .run('data', `${moduleName}/data/${moduleName}_data.cpt`, ok ? 1 : 0, JSON.stringify(log))

  return { ok, kind: 'data', target: `${moduleName}/data/${moduleName}_data.cpt`, outputPath: ok ? outputPath : undefined, findings, log }
}

// ── 接口测试 ────────────────────────────────────────────────────

export interface TestOutcome {
  ok: boolean
  errCode: number | null
  durationMs: number
  response: unknown
  rowCount: number
}

/** 用契约参数默认值 + 调用方覆盖值实测一个接口 */
export async function testDataset(moduleName: string, datasetName: string, overrides: Record<string, unknown> = {}): Promise<TestOutcome> {
  const mod = getModuleByName(moduleName)
  if (!mod) throw new Error(`模块不存在：${moduleName}`)
  const row = getDb().prepare('SELECT * FROM datasets WHERE module_id=? AND name=?').get(mod.id, datasetName) as Record<string, unknown> | undefined
  if (!row) throw new Error(`接口不存在：${moduleName}.${datasetName}`)
  const ds = rowToDataset(row)

  const typeMap: Record<string, string> = { string: 'String', integer: 'Integer', double: 'Double', formula: 'String' }
  const parameters = ds.params
    .filter((p) => p.type !== 'formula') // formula 参数由帆软服务端注入当前会话值，不随请求传递
    .map((p) => ({
      name: p.name,
      type: typeMap[p.type] || 'String',
      value: overrides[p.name] !== undefined ? overrides[p.name] : (p.default ?? '')
    }))

  const req: ApiDataRequest = {
    report_path: `${moduleName}/data/${moduleName}_data.cpt`,
    datasource_name: datasetName,
    page_number: -1,
    page_size: -1,
    parameters
  }

  const outcome = await invokeAndStore(req, mod.id, ds.id, datasetName)
  return outcome
}

/** 对模块内全部接口逐一测试（verify 语义） */
export async function testAllDatasets(moduleName: string): Promise<Array<{ dataset: string } & TestOutcome>> {
  const names = listDatasets(moduleName).map((d) => d.name)
  const results: Array<{ dataset: string } & TestOutcome> = []
  for (const n of names) {
    try {
      results.push({ dataset: n, ...(await testDataset(moduleName, n)) })
    } catch (e) {
      results.push({ dataset: n, ok: false, errCode: null, durationMs: 0, response: { error: (e as Error).message }, rowCount: 0 })
    }
  }
  return results
}

async function invokeAndStore(req: ApiDataRequest, moduleId: number, datasetId: number, datasetName: string): Promise<TestOutcome> {
  const { body, durationMs } = await callApiData(req)
  const ok = body.err_code === 0
  const rowCount = Array.isArray(body.data) ? body.data.length : 0
  getDb().prepare(`INSERT INTO api_tests(module_id, dataset_id, dataset, request, response, ok, err_code, duration_ms)
                   VALUES(?,?,?,?,?,?,?,?)`)
    .run(moduleId, datasetId, datasetName, JSON.stringify(req), JSON.stringify(body), ok ? 1 : 0, body.err_code ?? null, durationMs)
  return { ok, errCode: body.err_code ?? null, durationMs, response: body, rowCount }
}

export function listApiTests(limit = 50, moduleId?: number): Array<Record<string, unknown>> {
  const d = getDb()
  const rows = (moduleId
    ? d.prepare('SELECT * FROM api_tests WHERE module_id=? ORDER BY id DESC LIMIT ?').all(moduleId, limit)
    : d.prepare('SELECT * FROM api_tests ORDER BY id DESC LIMIT ?').all(limit)) as Array<Record<string, unknown>>
  return rows
}

export function listBuilds(limit = 50): Array<Record<string, unknown>> {
  return getDb().prepare('SELECT * FROM builds ORDER BY id DESC LIMIT ?').all(limit) as Array<Record<string, unknown>>
}

/** 契约导入/导出（模块级 JSON 备份/共享） */
export function exportModule(moduleName: string): string {
  const mod = getModuleByName(moduleName)
  if (!mod) throw new Error(`模块不存在：${moduleName}`)
  return JSON.stringify({
    name: mod.name,
    datasource: mod.datasource,
    comment: mod.comment,
    datasets: listDatasets(moduleName).map((d) => ({ name: d.name, kind: d.kind, comment: d.comment, params: d.params, sql: d.sql }))
  }, null, 2)
}

export function importModule(json: string, overwrite = false): Module {
  const parsed = JSON.parse(json) as { name: string; datasource?: string; comment?: string; datasets?: Array<{ name: string; kind?: DatasetKind; comment?: string; params?: DatasetParam[]; sql?: string }> }
  if (!parsed.name) throw new Error('导入 JSON 缺少 name')
  const existing = getModuleByName(parsed.name)
  if (existing && !overwrite) throw new Error(`模块已存在：${parsed.name}（如需覆盖请开启 overwrite）`)
  const mod = existing ?? createModule(parsed.name, parsed.datasource || getSettings().mysqlDatabase, parsed.comment || '')
  for (const ds of parsed.datasets ?? []) {
    saveDataset(mod.name, ds, undefined)
  }
  return mod
}

/** reportlets 下已部署但未入库的模块目录（供扫描导入） */
export function scanDeployedModules(): string[] {
  const s = getSettings()
  if (!existsSync(s.reportletsPath)) return []
  return readdirSync(s.reportletsPath)
    .filter((f) => {
      const p = join(s.reportletsPath, f)
      try { return statSync(p).isDirectory() && existsSync(join(p, 'data')) } catch { return false }
    })
    .filter((f) => !/^(api|demo|doc)$/i.test(f))
}
