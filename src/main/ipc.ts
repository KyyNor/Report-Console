/**
 * IPC 注册 — 渲染层 ↔ 主进程的唯一通道（v2 项目制）
 */

import { ipcMain, dialog, BrowserWindow } from 'electron'
import { getSettings, saveSettings } from './db'
import * as conns from './connectionsService'
import * as mysql from './mysqlService'
import * as projects from './projectsService'
import * as pages from './pagesService'
import { DISCUSSION_READ_ONLY_TOOLS, piToolDefs, piToolExec } from './agent/piBridge'
import { listBuiltinSkills } from './agent/skills'
import { promptScenarios } from '@shared/agentPrompt'
import { pingFrServer, callApiData } from './frClient'
import { collectPreviewDataLogs, evaluatePreviewSql, openPreviewWindow } from './windows'
import * as checkpoints from './checkpointService'
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

/** 受 UI 触发的源码操作：先固定基线，成功后才收集人工检查点。 */
function checkpointed<T>(project: string, title: string, fn: () => T): T {
  checkpoints.ensureBaseline(project)
  const result = fn()
  checkpoints.captureManualCheckpoint(project, title)
  return result
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
  handle('dialog:pickDoc', async (a) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const r = await dialog.showOpenDialog(win, {
      title: (a as { title?: string }).title ?? '选择要导入的文档',
      properties: ['openFile'],
      filters: [{ name: '元数据文本与前端源码', extensions: ['md', 'markdown', 'txt', 'html', 'htm', 'sql', 'js', 'jsx', 'mjs', 'css'] }]
    })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })
  handle('projects:list', () => projects.listProjects())
  handle('projects:create', (a) => {
    const project = projects.createProject(
      (a as { name: string }).name,
      (a as { connections: string[] }).connections,
      (a as { comment?: string }).comment,
      (a as { dir?: string }).dir,
      (a as { platform?: import('@shared/types').ProjectPlatform }).platform
    )
    checkpoints.ensureBaseline(project.name)
    return project
  })
  handle('projects:open', (a) => projects.openProject((a as { dir: string }).dir))
  handle('projects:update', (a) => {
    const id = (a as { id: number }).id
    const project = projects.listProjects().find((item) => item.id === id)
    if (!project) throw new Error('项目不存在')
    return checkpointed(project.name, '人工更新项目配置', () => { projects.updateProject(id, a as never); return true })
  })
  handle('projects:delete', (a) => { projects.deleteProject((a as { id: number }).id); return true })
  handle('projects:scan', () => projects.scanDeployedProjects())
  handle('projects:export', (a) => projects.exportProject((a as { project: string }).project))
  handle('projects:import', (a) => projects.importProject((a as { json: string }).json, (a as { overwrite: boolean }).overwrite))
  handle('resources:traditionalCpts', (a) => projects.listTraditionalCpts((a as { project: string }).project))

  // ── 接口契约 + 构建 + 实测 ────────────────────────────
  handle('datasets:list', (a) => projects.listDatasets((a as { project: string }).project))
  handle('datasets:read', (a) => projects.readDataset((a as { project: string }).project, (a as { name: string }).name))
  handle('datasets:statuses', (a) => projects.datasetStatuses((a as { project: string }).project))
  handle('datasets:save', (a) => {
    const project = (a as { project: string }).project
    return checkpointed(project, `人工保存接口 ${(a as { name: string }).name}`, () => projects.saveDataset(project, a as never, (a as { expectId?: number }).expectId))
  })
  handle('datasets:delete', (a) => {
    const project = (a as { project: string }).project
    return checkpointed(project, `人工删除接口 ${(a as { name: string }).name}`, () => { projects.deleteDataset(project, (a as { name: string }).name); return true })
  })
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
  handle('procs:save', (a) => {
    const project = (a as { project: string }).project
    return checkpointed(project, `人工保存过程 ${(a as { name: string }).name}`, () => projects.saveProcedure(project, a as never))
  })
  handle('procs:def', (a) => projects.procedureDefinition((a as { project: string }).project, (a as { name: string }).name))
  handle('procs:apply', (a) => projects.applyProjectProcedure((a as { project: string }).project, (a as { name: string }).name))
  handle('procs:call', (a) => projects.callProcedureSql((a as { sql: string }).sql, (a as { connection: string }).connection))
  handle('procs:link', (a) => { projects.linkProcedure((a as { project: string }).project, (a as { procedureId: number }).procedureId); return true })
  handle('procs:unlink', (a) => { projects.unlinkProcedure((a as { project: string }).project, (a as { procedureId: number }).procedureId); return true })
  handle('procs:delete', (a) => {
    const project = (a as { project: string }).project
    return checkpointed(project, `人工删除过程 ${(a as { name: string }).name}`, () => { projects.deleteProcedure(project, (a as { name: string }).name); return true })
  })
  handle('procs:linkable', (a) => projects.linkableProcedures((a as { project: string }).project))

  // ── 项目文档（meta/） ─────────────────────────────────
  handle('docs:list', (a) => projects.listDocs((a as { project: string }).project))
  handle('docs:read', (a) => projects.readDoc((a as { project: string }).project, (a as { name: string }).name))
  handle('docs:save', (a) => {
    const project = (a as { project: string }).project
    return checkpointed(project, `人工保存文档 ${(a as { name: string }).name}`, () => { projects.saveDoc(project, (a as { name: string }).name, (a as { content: string }).content, { overwrite: (a as { overwrite?: boolean }).overwrite }); return true })
  })
  handle('docs:import', (a) => {
    const project = (a as { project: string }).project
    return checkpointed(project, '人工导入文档', () => projects.importDoc(project, (a as { source: string }).source))
  })
  handle('docs:delete', (a) => {
    const project = (a as { project: string }).project
    return checkpointed(project, `人工删除文档 ${(a as { name: string }).name}`, () => { projects.deleteDoc(project, (a as { name: string }).name); return true })
  })
  handle('docs:rename', (a) => {
    const project = (a as { project: string }).project
    return checkpointed(project, `人工重命名文档 ${(a as { name: string }).name}`, () => { projects.renameDoc(project, (a as { name: string }).name, (a as { newName: string }).newName); return true })
  })

  // ── 页面 ──────────────────────────────────────────────
  handle('pages:list', (a) => pages.listPages((a as { project?: string }).project))
  handle('pages:read', (a) => pages.readPage((a as { project: string }).project, (a as { page: string }).page))
  handle('pages:save', (a) => {
    const project = (a as { project: string }).project
    return checkpointed(project, `人工保存页面 ${(a as { page: string }).page}`, () => { pages.savePage(project, (a as { page: string }).page, (a as { content: string }).content, { overwrite: (a as { overwrite?: boolean }).overwrite }); return true })
  })
  handle('pages:create', (a) => {
    const project = (a as { project: string }).project
    return checkpointed(project, `人工新建页面 ${(a as { page: string }).page}`, () => { pages.createPage(project, (a as { page: string }).page, (a as { starter: 'blank' | 'list' | 'form' }).starter ?? 'blank', (a as { platform?: import('@shared/types').PagePlatform }).platform); return true })
  })
  handle('pages:delete', (a) => {
    const project = (a as { project: string }).project
    return checkpointed(project, `人工删除页面 ${(a as { page: string }).page}`, () => { pages.deletePage(project, (a as { page: string }).page); return true })
  })
  handle('pages:updatePaths', (a) => {
    const project = (a as { project: string }).project
    const page = (a as { page: string }).page
    const newName = (a as { newName?: string }).newName
    return checkpointed(project, `人工调整页面 ${page}${newName && newName !== page ? ` → ${newName}` : ''}`, () => {
      pages.updatePagePaths(project, page, (a as { paths: { platform: import('@shared/types').PagePlatform; jsx: string; mjs: string; cpt: string } }).paths, newName)
      return true
    })
  })
  handle('pages:build', (a) => pages.buildPage((a as { project: string }).project, (a as { page: string }).page))
  handle('pages:previewUrl', (a) => pages.pagePreviewUrl((a as { project: string }).project, (a as { page: string }).page))
  handle('pages:open', (a) => {
    const project = (a as { project: string }).project
    const page = (a as { page: string }).page
    const url = pages.pagePreviewUrl(project, page)
    openPreviewWindow(url, { project, page })
    return url
  })
  handle('preview:dataLogs', (a) => collectPreviewDataLogs((a as { project: string }).project, (a as { page?: string }).page))
  handle('preview:evaluateSql', (a) => evaluatePreviewSql((a as { project: string }).project, (a as { page: string }).page, (a as { callId: number }).callId))

  // ── 开发检查点（RC 本地版本历史）──────────────────────
  handle('versions:list', (a) => checkpoints.listCheckpoints((a as { project: string }).project))
  handle('versions:workingDiff', (a) => checkpoints.workingDiff((a as { project: string }).project))
  handle('versions:diff', (a) => checkpoints.diffCheckpoints((a as { project: string }).project, (a as { from: string }).from, (a as { to?: string }).to))
  handle('versions:diffFile', (a) => checkpoints.diffFile((a as { project: string }).project, (a as { from: string }).from, (a as { path: string }).path, (a as { to?: string }).to))
  handle('versions:create', (a) => checkpoints.createNamedCheckpoint((a as { project: string }).project, (a as { title: string }).title))
  handle('versions:restore', (a) => checkpoints.restoreCheckpoint((a as { project: string }).project, (a as { checkpointId: string }).checkpointId))
  handle('versions:startAgentTurn', (a) => checkpoints.startAgentTurn((a as { project: string }).project, (a as { sessionId: string }).sessionId, (a as { prompt: string }).prompt))
  handle('versions:finishAgentTurn', (a) => checkpoints.finishAgentTurn((a as { turnId: string }).turnId))

  // ── pi Agent 桥（渲染层 Agent 的平台工具通道）──────────
  handle('pi:toolDefs', () => piToolDefs())
/** 规范页工具分组：与工作台资源类型对齐；未列出的工具落入「其他」。 */
const TOOL_GROUPS: Array<{ label: string; names: string[] }> = [
  { label: '通用', names: ['read_skill', 'search_design_lib'] },
  { label: '数据接口', names: ['list_datasets', 'read_dataset', 'save_dataset', 'delete_dataset', 'build_data_cpt', 'test_dataset'] },
  { label: '存储过程', names: ['list_procedures', 'read_procedure', 'save_procedure', 'apply_procedure'] },
  { label: '文档', names: ['list_docs', 'read_doc', 'write_doc', 'patch_doc'] },
  { label: '页面', names: ['list_pages', 'read_page', 'write_page', 'patch_page', 'create_page', 'update_page_paths', 'build_page', 'open_page', 'collect_page_errors'] },
  { label: '传统 CPT', names: ['inspect_legacy_cpt'] },
  { label: 'SQL', names: ['sql_query', 'sql_exec', 'list_tables', 'describe_table'] }
]

  handle('agent:referenceCatalog', () => {
    const groupOf = new Map(TOOL_GROUPS.flatMap((g) => g.names.map((n) => [n, g.label] as const)))
    return {
      prompts: promptScenarios(),
      skills: listBuiltinSkills(),
      tools: piToolDefs().map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.schema,
        group: groupOf.get(t.name) ?? '其他',
        // 模式可用性以 piBridge 的执行白名单为准（讨论模式只放行只读工具）。
        modes: DISCUSSION_READ_ONLY_TOOLS.has(t.name) ? ['development', 'discussion'] : ['development']
      }))
    }
  })
  handle('pi:toolExec', (a) => piToolExec(
    (a as { name: string }).name,
    (a as { args: unknown }).args,
    (a as { scope: import('./agent/piBridge').PiToolScope }).scope
  ))
}

/** 连接引用（id 或 name） */
type ConnRef = { id?: number; name?: string }
