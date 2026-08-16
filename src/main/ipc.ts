/**
 * IPC 注册 — 渲染层 ↔ 主进程的唯一通道
 */

import { ipcMain, BrowserWindow } from 'electron'
import { getSettings, saveSettings } from './db'
import * as modules from './modules'
import * as pages from './pagesService'
import * as sql from './mysqlService'
import { pingFrServer, callApiData } from './frClient'
import { openPreviewWindow } from './windows'
import * as agent from './agent/agentService'
import { piToolDefs, piToolExec } from './agent/piBridge'
import type { AppSettings, StatusPayload } from '@shared/types'
import { existsSync, accessSync, constants } from 'fs'

/** 包装：同步/异步 handler 的错误统一转成 { error } 传给渲染层 */
function handle(channel: string, fn: (args: unknown) => unknown): void {
  ipcMain.handle(channel, async (_e, args) => {
    try {
      return { ok: true, data: await fn(args) }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
}

export function registerIpc(): void {
  // ── 配置 ──────────────────────────────────────────────
  handle('config:get', () => getSettings())
  handle('config:save', (args) => saveSettings(args as Partial<AppSettings>))

  // ── 状态 ──────────────────────────────────────────────
  handle('status:get', async (): Promise<StatusPayload> => {
    const s = getSettings()
    const fr = await pingFrServer()
    const my = await sql.pingMysql()
    let writable = false
    try { accessSync(s.reportletsPath, constants.W_OK); writable = true } catch { writable = false }
    const mods = modules.listModules()
    let datasetCount = 0
    for (const m of mods) datasetCount += m.datasetCount
    let procCount = 0
    try { procCount = (await sql.listProcedures(s.mysqlDatabase)).length } catch { procCount = 0 }
    return {
      frReachable: fr.reachable,
      frLatencyMs: fr.latencyMs,
      mysqlReachable: my.reachable,
      mysqlLatencyMs: my.latencyMs,
      mysqlVersion: my.version,
      reportletsWritable: writable && existsSync(s.reportletsPath),
      reportletsPath: s.reportletsPath,
      database: s.mysqlDatabase,
      counts: { modules: mods.length, datasets: datasetCount, pages: pages.listPages().length, procedures: procCount }
    }
  })

  // ── 模块 / 接口 ───────────────────────────────────────
  handle('modules:list', () => modules.listModules())
  handle('modules:create', (a) => modules.createModule((a as { name: string }).name, (a as { datasource: string }).datasource, (a as { comment?: string }).comment))
  handle('modules:update', (a) => modules.updateModule((a as { id: number }).id, a as { datasource?: string; comment?: string }))
  handle('modules:delete', (a) => { modules.deleteModule((a as { id: number }).id); return true })
  handle('modules:scan', () => modules.scanDeployedModules())
  handle('modules:export', (a) => modules.exportModule((a as { module: string }).module))
  handle('modules:import', (a) => modules.importModule((a as { json: string }).json, (a as { overwrite: boolean }).overwrite))
  handle('datasets:list', (a) => modules.listDatasets((a as { module: string }).module))
  handle('datasets:save', (a) => modules.saveDataset((a as { module: string }).module, a as never, (a as { expectId?: number }).expectId))
  handle('datasets:delete', (a) => { modules.deleteDataset((a as { module: string }).module, (a as { name: string }).name); return true })
  handle('build:dataCpt', (a) => modules.buildDataCpt((a as { module: string }).module))
  handle('test:dataset', (a) => modules.testDataset((a as { module: string }).module, (a as { dataset: string }).dataset, (a as { overrides?: Record<string, unknown> }).overrides ?? {}))
  handle('test:all', (a) => modules.testAllDatasets((a as { module: string }).module))
  handle('history:apiTests', (a) => modules.listApiTests((a as { limit?: number }).limit ?? 50, (a as { moduleId?: number }).moduleId))
  handle('history:builds', (a) => modules.listBuilds((a as { limit?: number }).limit ?? 50))

  // 手工直调（不落契约的临时测试）
  handle('api:rawCall', async (a) => {
    const r = await callApiData(a as never)
    return { httpStatus: r.httpStatus, durationMs: r.durationMs, body: r.body }
  })

  // ── 页面 ──────────────────────────────────────────────
  handle('pages:list', () => pages.listPages())
  handle('pages:read', (a) => pages.readPage((a as { module: string }).module, (a as { page: string }).page))
  handle('pages:save', (a) => { pages.savePage((a as { module: string }).module, (a as { page: string }).page, (a as { content: string }).content); return true })
  handle('pages:create', (a) => { pages.createPage((a as { module: string }).module, (a as { page: string }).page, (a as { starter: 'blank' | 'list' | 'form' }).starter ?? 'blank'); return true })
  handle('pages:delete', (a) => { pages.deletePage((a as { module: string }).module, (a as { page: string }).page); return true })
  handle('pages:build', (a) => pages.buildPage((a as { module: string }).module, (a as { page: string }).page))
  handle('pages:previewUrl', (a) => pages.pagePreviewUrl((a as { module: string }).module, (a as { page: string }).page))
  handle('pages:open', (a) => {
    const url = pages.pagePreviewUrl((a as { module: string }).module, (a as { page: string }).page)
    openPreviewWindow(url, `${(a as { module: string }).module}/${(a as { page: string }).page}`)
    return url
  })

  // ── MySQL ─────────────────────────────────────────────
  handle('sql:query', (a) => sql.readOnlyQuery((a as { sql: string }).sql, (a as { database?: string }).database))
  handle('sql:exec', (a) => sql.guardedExec((a as { sql: string }).sql, (a as { kind: 'ddl' | 'dml' | 'call' }).kind ?? 'dml', (a as { purpose?: string }).purpose ?? '(ui)'))
  handle('sql:databases', () => sql.listDatabases())
  handle('sql:tables', (a) => sql.listTables((a as { database?: string }).database))
  handle('sql:describe', (a) => sql.describeTable((a as { table: string }).table, (a as { database?: string }).database))
  handle('sql:ddlLog', () => sql.getDdlLog())

  // ── 存储过程 ──────────────────────────────────────────
  handle('proc:list', (a) => sql.listProcedures((a as { database?: string }).database))
  handle('proc:get', (a) => sql.getProcedureDefinition((a as { name: string }).name, (a as { database?: string }).database))
  handle('proc:apply', (a) => sql.applyProcedure((a as { definition: string }).definition, (a as { name: string }).name, (a as { database?: string }).database))

  // ── Agent ─────────────────────────────────────────────
  handle('agent:sessions', () => agent.listSessions())
  handle('agent:createSession', (a) => agent.createSession((a as { title?: string }).title))
  handle('agent:deleteSession', (a) => { agent.deleteSession((a as { id: number }).id); return true })
  handle('agent:messages', (a) => agent.listMessages((a as { sessionId: number }).sessionId))
  handle('agent:stop', () => { agent.stopAgent(); return true })
  ipcMain.handle('agent:send', async (event, args: { sessionId: number; text: string }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { ok: false, error: '窗口不可用' }
    // 异步执行，事件流经 agent:event 推送；立即返回让渲染层进入"接收中"状态
    void agent.runAgentTurn(win, args.sessionId, args.text)
    return { ok: true }
  })

  // ── pi Agent 桥（渲染层 Agent 的平台工具通道）──────────
  handle('pi:toolDefs', () => piToolDefs())
  handle('pi:toolExec', (a) => piToolExec((a as { name: string }).name, (a as { args: unknown }).args))
}
