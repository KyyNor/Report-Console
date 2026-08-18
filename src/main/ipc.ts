/**
 * IPC 注册 — 渲染层 ↔ 主进程的唯一通道（v2 项目制）
 */

import { ipcMain, dialog, BrowserWindow } from 'electron'
import { getSettings, saveSettings } from './db'
import * as conns from './connectionsService'
import * as mysql from './mysqlService'
import * as projects from './projectsService'
import * as pages from './pagesService'
import { piToolDefs, piToolExec } from './agent/piBridge'
import { pingFrServer, callApiData } from './frClient'
import { openPreviewWindow } from './windows'
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
  handle('config:save', (a) => saveSettings(a as Partial<AppSettings>))

  // ── 状态（总览 + 工作台左栏） ──────────────────────────
  handle('status:get', async (): Promise<StatusPayload> => {
    const s = getSettings()
    const fr = await pingFrServer()
    let writable = false
    try { accessSync(s.reportletsPath, constants.W_OK); writable = true } catch { writable = false }
    const health = await projects.connectionsHealth()
    const projs = projects.listProjects()
    let datasetCount = 0, procCount = 0, docCount = 0
    for (const p of projs) {
      datasetCount += p.counts.ifs
      procCount += p.counts.sps
      docCount += p.counts.docs
    }
    return {
      frReachable: fr.reachable,
      frLatencyMs: fr.latencyMs,
      reportletsWritable: writable && existsSync(s.reportletsPath),
      reportletsPath: s.reportletsPath,
      connections: health,
      counts: { projects: projs.length, datasets: datasetCount, pages: pages.listPages().length, procedures: procCount, docs: docCount }
    }
  })

  // ── 连接注册表 ────────────────────────────────────────
  handle('conns:list', () => conns.listConnections())
  handle('conns:create', (a) => conns.createConnection(a as never))
  handle('conns:update', (a) => {
    const r = conns.updateConnection((a as { id: number }).id, a as never)
    mysql.invalidatePools(r.id)
    return r
  })
  handle('conns:delete', (a) => { conns.deleteConnection((a as { id: number }).id); return true })
  handle('conns:test', async (a) => mysql.pingConnection(conns.requireConnection(a as { id?: number; name?: string })))
  handle('sql:databases', (a) => mysql.listDatabases((a as { connection?: ConnRef }).connection))
  handle('sql:ddlLog', (a) => mysql.getDdlLog(100, (a as { connection?: string }).connection))

  // ── SQL 通道（按连接路由） ─────────────────────────────
  handle('sql:query', (a) => mysql.readOnlyQuery((a as { sql: string }).sql, {
    connection: (a as { connection?: ConnRef }).connection,
    database: (a as { database?: string }).database
  }))
  handle('sql:exec', (a) => mysql.guardedExec(
    (a as { sql: string }).sql,
    (a as { kind: 'ddl' | 'dml' | 'call' }).kind ?? 'dml',
    (a as { purpose?: string }).purpose ?? '(ui)',
    (a as { connection?: ConnRef }).connection
  ))
  handle('sql:tables', (a) => mysql.listTables((a as { database?: string }).database, (a as { connection?: ConnRef }).connection))
  handle('sql:describe', (a) => mysql.describeTable((a as { table: string }).table, (a as { database?: string }).database, (a as { connection?: ConnRef }).connection))

  // ── 项目 ──────────────────────────────────────────────
  handle('dialog:pickDir', async (a) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const r = await dialog.showOpenDialog(win, {
      title: (a as { title?: string }).title ?? '选择项目目录',
      properties: ['openDirectory', 'createDirectory']
    })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })
  handle('projects:list', () => projects.listProjects())
  handle('projects:create', (a) => projects.createProject(
    (a as { name: string }).name,
    (a as { connections: string[] }).connections,
    (a as { comment?: string }).comment,
    (a as { dir?: string }).dir
  ))
  handle('projects:open', (a) => projects.openProject((a as { dir: string }).dir))
  handle('projects:update', (a) => { projects.updateProject((a as { id: number }).id, a as never); return true })
  handle('projects:delete', (a) => { projects.deleteProject((a as { id: number }).id); return true })
  handle('projects:scan', () => projects.scanDeployedProjects())
  handle('projects:export', (a) => projects.exportProject((a as { project: string }).project))
  handle('projects:import', (a) => projects.importProject((a as { json: string }).json, (a as { overwrite: boolean }).overwrite))
  handle('resources:traditionalCpts', (a) => projects.listTraditionalCpts((a as { project: string }).project))

  // ── 接口契约 + 构建 + 实测 ────────────────────────────
  handle('datasets:list', (a) => projects.listDatasets((a as { project: string }).project))
  handle('datasets:read', (a) => projects.readDataset((a as { project: string }).project, (a as { name: string }).name))
  handle('datasets:statuses', (a) => projects.datasetStatuses((a as { project: string }).project))
  handle('datasets:save', (a) => projects.saveDataset((a as { project: string }).project, a as never, (a as { expectId?: number }).expectId))
  handle('datasets:delete', (a) => { projects.deleteDataset((a as { project: string }).project, (a as { name: string }).name); return true })
  handle('build:dataCpt', (a) => projects.buildDataCpt((a as { project: string }).project))
  handle('test:dataset', (a) => projects.testDataset((a as { project: string }).project, (a as { dataset: string }).dataset, (a as { overrides?: Record<string, unknown> }).overrides ?? {}))
  handle('test:all', (a) => projects.testAllDatasets((a as { project: string }).project))
  handle('verify:project', (a) => projects.verifyProject((a as { project: string }).project))
  handle('history:apiTests', (a) => projects.listApiTests((a as { limit?: number }).limit ?? 50, (a as { projectId?: number }).projectId))
  handle('history:builds', (a) => projects.listBuilds((a as { limit?: number }).limit ?? 50))

  // 手工直调（不落契约的临时测试）
  handle('api:rawCall', async (a) => {
    const r = await callApiData(a as never)
    return { httpStatus: r.httpStatus, durationMs: r.durationMs, body: r.body }
  })

  // ── 存储过程（归属/关联） ──────────────────────────────
  handle('procs:list', (a) => projects.listProcedures((a as { project: string }).project))
  handle('procs:save', (a) => projects.saveProcedure((a as { project: string }).project, a as never))
  handle('procs:def', (a) => projects.procedureDefinition((a as { project: string }).project, (a as { name: string }).name))
  handle('procs:apply', (a) => projects.applyProjectProcedure((a as { project: string }).project, (a as { name: string }).name))
  handle('procs:call', (a) => projects.callProcedureSql((a as { sql: string }).sql, (a as { connection: string }).connection))
  handle('procs:link', (a) => { projects.linkProcedure((a as { project: string }).project, (a as { procedureId: number }).procedureId); return true })
  handle('procs:unlink', (a) => { projects.unlinkProcedure((a as { project: string }).project, (a as { procedureId: number }).procedureId); return true })
  handle('procs:delete', (a) => { projects.deleteProcedure((a as { project: string }).project, (a as { name: string }).name); return true })
  handle('procs:linkable', (a) => projects.linkableProcedures((a as { project: string }).project))

  // ── 项目文档（meta/） ─────────────────────────────────
  handle('docs:list', (a) => projects.listDocs((a as { project: string }).project))
  handle('docs:read', (a) => projects.readDoc((a as { project: string }).project, (a as { name: string }).name))
  handle('docs:save', (a) => { projects.saveDoc((a as { project: string }).project, (a as { name: string }).name, (a as { content: string }).content); return true })
  handle('docs:delete', (a) => { projects.deleteDoc((a as { project: string }).project, (a as { name: string }).name); return true })
  handle('docs:rename', (a) => { projects.renameDoc((a as { project: string }).project, (a as { name: string }).name, (a as { newName: string }).newName); return true })

  // ── 页面 ──────────────────────────────────────────────
  handle('pages:list', (a) => pages.listPages((a as { project?: string }).project))
  handle('pages:read', (a) => pages.readPage((a as { project: string }).project, (a as { page: string }).page))
  handle('pages:save', (a) => { pages.savePage((a as { project: string }).project, (a as { page: string }).page, (a as { content: string }).content); return true })
  handle('pages:create', (a) => { pages.createPage((a as { project: string }).project, (a as { page: string }).page, (a as { starter: 'blank' | 'list' | 'form' }).starter ?? 'blank'); return true })
  handle('pages:delete', (a) => { pages.deletePage((a as { project: string }).project, (a as { page: string }).page); return true })
  handle('pages:build', (a) => pages.buildPage((a as { project: string }).project, (a as { page: string }).page))
  handle('pages:previewUrl', (a) => pages.pagePreviewUrl((a as { project: string }).project, (a as { page: string }).page))
  handle('pages:open', (a) => {
    const url = pages.pagePreviewUrl((a as { project: string }).project, (a as { page: string }).page)
    openPreviewWindow(url, `${(a as { project: string }).project}/${(a as { page: string }).page}`)
    return url
  })

  // ── pi Agent 桥（渲染层 Agent 的平台工具通道）──────────
  handle('pi:toolDefs', () => piToolDefs())
  handle('pi:toolExec', (a) => piToolExec(
    (a as { name: string }).name,
    (a as { args: unknown }).args,
    (a as { scope: { project: string } }).scope
  ))
}

/** 连接引用（id 或 name） */
type ConnRef = { id?: number; name?: string }
