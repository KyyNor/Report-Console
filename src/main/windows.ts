/**
 * 窗口管理 — 主窗口 + 帆软页面预览窗口
 */

import { app, BrowserWindow, shell, type Session } from 'electron'
import { join } from 'path'
import {
  fineReportDataError, isFineReportDataUrl, isFineReportFrameworkNoise, previewDiagnostics,
  type PreviewDiagnosticReport, type PreviewScope
} from './previewDiagnostics'
import { applyFormulaResults, fineReportFormulaExpressions, previewDataLogs } from './previewDataLogs'
import { pageForProject } from './projectManifest'
import type { PreviewDataReport } from '@shared/types'

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1024,
    minHeight: 700,
    title: 'Report Console — 帆软加壳开发控制台',
    icon: app.isPackaged
      ? join(process.resourcesPath, 'icon.png')
      : join(app.getAppPath(), 'build', 'icon.png'),
    // 深色自绘标题栏（设计稿）：macOS 藏原生栏保红绿灯，Windows/Linux 用 overlay
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 14, y: 13 },
    ...(process.platform !== 'darwin' ? { titleBarOverlay: { color: '#00000000', symbolColor: '#4b5563', height: 42 } } : {}),
    backgroundColor: '#f5f6f8',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  // 开发模式走 electron-vite 的 dev server；生产加载打包产物
  // SMOKE_VIEW=xxx 以 hash 深链打开指定视图；SMOKE_AUTOSEND=1 让 Agent 页自动发一条自检消息；
  // SMOKE_SEL=1 让工作台自动选中第一个资源（冒烟核对选中态样式）
  const hash = process.env.SMOKE_VIEW || ''
  const query: Record<string, string> = {}
  if (process.env.SMOKE_AUTOSEND) query.autosend = '1'
  if (process.env.SMOKE_SEL) query.sel = process.env.SMOKE_SEL
  if (process.env.ELECTRON_RENDERER_URL) {
    const u = new URL(process.env.ELECTRON_RENDERER_URL)
    if (hash) u.hash = hash
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v)
    void win.loadURL(u.toString())
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: hash || undefined, query: Object.keys(query).length ? query : undefined })
  }
  // 外链走系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  return win
}

interface PreviewEntry {
  win: BrowserWindow
  scope: PreviewScope
  load: Promise<void>
  debuggerAttached: boolean
  debuggerReady: boolean
  cdpRequests: Map<string, { logId: number; method: string; url: string; requestBody?: string; status?: number }>
}

interface PendingDataRequest {
  scope: PreviewScope
  windowId: number
  method: string
  url: string
  requestBody?: string
  logId: number
}

const previewWindows = new Map<string, PreviewEntry>()
const previewByWebContents = new Map<number, PreviewEntry>()
const installedSessions = new Set<Session>()
const pendingDataRequests = new Map<string, PendingDataRequest>()

function previewKey(scope: PreviewScope): string {
  return JSON.stringify([scope.project, scope.page])
}

function requestKey(id: number | string): string {
  return String(id)
}

function uploadBody(uploadData: Array<{ bytes?: Buffer }> | undefined): string | undefined {
  if (!uploadData?.length) return undefined
  const text = uploadData.flatMap((part) => part.bytes ? [Buffer.from(part.bytes).toString('utf8')] : []).join('')
  if (!text) return undefined
  return text
}

/** 通过 Electron 网络层持续采集 data 接口的 HTTP 4xx/5xx 与网络失败。 */
function installDataCapture(session: Session): void {
  if (installedSessions.has(session)) return
  installedSessions.add(session)
  const filter = { urls: ['*://*/webroot/decision/api/data*'] }
  session.webRequest.onBeforeRequest(filter, (details, callback) => {
    const entry = previewByWebContents.get(details.webContentsId ?? -1)
    if (entry && isFineReportDataUrl(details.url)) {
      const requestBody = uploadBody(details.uploadData)
      const logId = previewDataLogs.startOrReuse(entry.scope, entry.win.webContents.id, { method: details.method, url: details.url, requestBody })
      pendingDataRequests.set(requestKey(details.id), {
        scope: entry.scope,
        windowId: entry.win.webContents.id,
        method: details.method,
        url: details.url,
        requestBody,
        logId
      })
    }
    callback({})
  })
  session.webRequest.onCompleted(filter, (details) => {
    const request = pendingDataRequests.get(requestKey(details.id))
    pendingDataRequests.delete(requestKey(details.id))
    if (!request) return
    previewDataLogs.complete(request.logId, { status: details.statusCode })
    if (details.statusCode < 400) return
    const entry = previewByWebContents.get(request.windowId)
    // CDP 可读取响应正文时由它记录；DevTools 打开或 CDP 不可用时退回 HTTP 层。
    if (entry?.debuggerReady) return
    previewDiagnostics.record(request.scope, request.windowId, {
      kind: 'data_error',
      message: `FineReport data 接口返回 HTTP ${details.statusCode}`,
      status: details.statusCode,
      method: request.method,
      url: request.url,
      requestBody: request.requestBody
    })
  })
  session.webRequest.onErrorOccurred(filter, (details) => {
    const request = pendingDataRequests.get(requestKey(details.id))
    pendingDataRequests.delete(requestKey(details.id))
    if (!request) return
    previewDataLogs.complete(request.logId, { networkError: details.error })
    previewDiagnostics.record(request.scope, request.windowId, {
      kind: 'data_error',
      message: `FineReport data 接口请求失败：${details.error}`,
      method: request.method,
      url: request.url,
      requestBody: request.requestBody
    })
  })
}

function detachDiagnosticsDebugger(entry: PreviewEntry): void {
  if (!entry.debuggerAttached) return
  try { entry.win.webContents.debugger.detach() } catch { /* 已被 DevTools 或导航终止 */ }
  entry.debuggerAttached = false
  entry.debuggerReady = false
  entry.cdpRequests.clear()
}

function attachDiagnosticsDebugger(entry: PreviewEntry): void {
  const { win } = entry
  if (win.isDestroyed() || win.webContents.isDevToolsOpened() || entry.debuggerAttached) return
  try {
    win.webContents.debugger.attach('1.3')
    entry.debuggerAttached = true
    entry.debuggerReady = false
    void win.webContents.debugger.sendCommand('Network.enable')
      .then(() => { entry.debuggerReady = true })
      .catch(() => { detachDiagnosticsDebugger(entry) })
  } catch {
    entry.debuggerAttached = false
    entry.debuggerReady = false
  }
}

function openPreviewDevTools(entry: PreviewEntry): void {
  // Electron 的 debugger 与 DevTools 会争用调试会话；人工 DevTools 优先，网络层仍继续兜底采集状态码。
  detachDiagnosticsDebugger(entry)
  entry.win.webContents.openDevTools({ mode: 'detach', activate: true })
}

/** 在业务页面上方注入隔离样式的轻量入口；不暴露 Node/Electron API 给页面。 */
function injectDevToolsButton(win: BrowserWindow): void {
  const script = `(() => {
    if (document.getElementById('__rc_preview_tools')) return true;
    const host = document.createElement('div');
    host.id = '__rc_preview_tools';
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = '.wrap{position:fixed;top:14px;right:16px;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.btn{height:34px;border:1px solid rgba(37,99,235,.24);border-radius:10px;padding:0 13px;display:flex;align-items:center;gap:7px;color:#1d4ed8;background:rgba(248,250,252,.94);box-shadow:0 8px 28px rgba(15,23,42,.16);backdrop-filter:blur(12px);cursor:pointer;font-size:13px;font-weight:650;letter-spacing:.01em;transition:.18s ease}.btn:hover{transform:translateY(-1px);background:#fff;border-color:rgba(37,99,235,.42);box-shadow:0 10px 34px rgba(15,23,42,.22)}.dot{width:7px;height:7px;border-radius:50%;background:#2563eb;box-shadow:0 0 0 4px rgba(37,99,235,.11)}';
    const wrap = document.createElement('div'); wrap.className = 'wrap';
    const button = document.createElement('button'); button.className = 'btn'; button.type = 'button'; button.title = '打开此预览窗口的 Chrome DevTools';
    button.innerHTML = '<span class="dot"></span><span>DevTools</span>';
    button.addEventListener('click', () => window.open('rc-preview://devtools'));
    wrap.appendChild(button); root.append(style, wrap); document.documentElement.appendChild(host); return true;
  })()`
  void win.webContents.executeJavaScript(script).catch(() => undefined)
}

function attachPreviewListeners(entry: PreviewEntry): void {
  const { win } = entry
  installDataCapture(win.webContents.session)
  previewByWebContents.set(win.webContents.id, entry)
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level < 3) return
    if (isFineReportFrameworkNoise(message)) return
    previewDiagnostics.record(entry.scope, win.webContents.id, {
      kind: 'js_error', message, line, source: sourceId
    })
  })
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return
    previewDiagnostics.record(entry.scope, win.webContents.id, {
      kind: 'load_error', message: `页面加载失败：${errorDescription} (${errorCode})`, url: validatedURL
    })
  })
  win.webContents.on('did-finish-load', () => injectDevToolsButton(win))
  win.webContents.debugger.on('message', (_event, method, params) => {
    const data = params as Record<string, unknown>
    if (method === 'Network.requestWillBeSent') {
      const request = data.request as { url?: string; method?: string; postData?: string } | undefined
      if (typeof data.requestId === 'string' && request?.url && isFineReportDataUrl(request.url)) {
        const logId = previewDataLogs.startOrReuse(entry.scope, win.webContents.id, {
          method: request.method ?? 'POST', url: request.url, requestBody: request.postData
        })
        entry.cdpRequests.set(data.requestId, {
          logId, method: request.method ?? 'POST', url: request.url, requestBody: request.postData
        })
      }
      return
    }
    if (method === 'Network.responseReceived') {
      const requestId = typeof data.requestId === 'string' ? data.requestId : ''
      const request = entry.cdpRequests.get(requestId)
      const response = data.response as { status?: number } | undefined
      if (request && typeof response?.status === 'number') request.status = response.status
      return
    }
    if (method !== 'Network.loadingFinished') return
    const requestId = typeof data.requestId === 'string' ? data.requestId : ''
    const request = entry.cdpRequests.get(requestId)
    if (!request) return
    entry.cdpRequests.delete(requestId)
    void win.webContents.debugger.sendCommand('Network.getResponseBody', { requestId })
      .then((result) => {
        if (win.isDestroyed()) return
        const response = result as { body?: unknown; base64Encoded?: unknown }
        const rawBody = typeof response.body === 'string' ? response.body : ''
        const body = response.base64Encoded === true ? Buffer.from(rawBody, 'base64').toString('utf8') : rawBody
        previewDataLogs.complete(request.logId, { status: request.status, responseBody: body })
        const message = fineReportDataError(request.status ?? 0, body)
        if (!message) return
        previewDiagnostics.record(entry.scope, win.webContents.id, {
          kind: 'data_error', message, status: request.status, method: request.method,
          url: request.url, requestBody: request.requestBody, responseBody: body
        })
      })
      .catch(() => {
        if (win.isDestroyed()) return
        previewDataLogs.complete(request.logId, { status: request.status })
        if ((request.status ?? 0) < 400) return
        previewDiagnostics.record(entry.scope, win.webContents.id, {
          kind: 'data_error', message: `FineReport data 接口返回 HTTP ${request.status}`,
          status: request.status, method: request.method, url: request.url, requestBody: request.requestBody
        })
      })
  })
  win.webContents.debugger.on('detach', () => {
    entry.debuggerAttached = false
    entry.debuggerReady = false
    entry.cdpRequests.clear()
  })
  win.webContents.on('devtools-closed', () => setTimeout(() => attachDiagnosticsDebugger(entry), 100))
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('rc-preview://devtools')) {
      openPreviewDevTools(entry)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })
  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.meta && input.alt && input.key.toLowerCase() === 'i')) {
      event.preventDefault()
      openPreviewDevTools(entry)
    }
  })
}

function navigatePreview(entry: PreviewEntry, url: string): void {
  previewDiagnostics.begin(entry.scope, url, entry.win.webContents.id)
  previewDataLogs.begin(entry.scope, url, entry.win.webContents.id)
  entry.cdpRequests.clear()
  attachDiagnosticsDebugger(entry)
  entry.load = entry.win.loadURL(url).catch(() => undefined)
}

/** 打开帆软页面预览窗口（独立 BrowserWindow，可多开，按 module/page 复用） */
export function openPreviewWindow(url: string, scope: PreviewScope): BrowserWindow {
  const key = previewKey(scope)
  const existing = previewWindows.get(key)
  if (existing && !existing.win.isDestroyed()) {
    existing.scope = scope
    navigatePreview(existing, url)
    existing.win.focus()
    return existing.win
  }
  const win = new BrowserWindow({
    width: 1180,
    height: 800,
    title: `预览 — ${scope.project}/${scope.page}`,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  const entry: PreviewEntry = { win, scope, load: Promise.resolve(), debuggerAttached: false, debuggerReady: false, cdpRequests: new Map() }
  attachPreviewListeners(entry)
  navigatePreview(entry, url)
  const windowId = win.webContents.id
  win.on('closed', () => {
    previewDiagnostics.close(entry.scope, windowId)
    previewDataLogs.close(entry.scope, windowId)
    previewByWebContents.delete(windowId)
    for (const [id, request] of pendingDataRequests) if (request.windowId === windowId) pendingDataRequests.delete(id)
    previewWindows.delete(key)
  })
  previewWindows.set(key, entry)
  return win
}

export function collectPreviewErrors(project: string, page?: string): PreviewDiagnosticReport {
  return previewDiagnostics.collect(project, page)
}

export function collectPreviewDataLogs(project: string, page?: string): PreviewDataReport {
  return previewDataLogs.collect(project, page)
}

/**
 * 在对应桌面预览窗口中显式计算一条日志的帆软公式片段。
 * 这是调试 SQL，不是数据库 general log；移动 SPA 禁止二次 remoteEvaluate，避免挂起。
 */
export async function evaluatePreviewSql(project: string, page: string, callId: number): Promise<{ sql: string; source: 'template' | 'FR.remoteEvaluate' }> {
  const call = previewDataLogs.call(project, page, callId)
  if (!call?.sqlPrepared) throw new Error('该调用无法匹配当前项目的接口契约 SQL')
  if (pageForProject(project, page).platform === 'mobile') {
    const message = '移动 SPA 中重复调用 FR.remoteEvaluate 可能挂起；已保留 SQL 模板与参数代入表达式，不执行公式求值。'
    previewDataLogs.resolve(callId, undefined, message)
    throw new Error(message)
  }
  const expressions = fineReportFormulaExpressions(call.sqlPrepared)
  if (expressions.length === 0) {
    previewDataLogs.resolve(callId, call.sqlPrepared)
    return { sql: call.sqlPrepared, source: 'template' }
  }
  const entry = previewWindows.get(previewKey({ project, page }))
  if (!entry || entry.win.isDestroyed()) throw new Error('对应预览窗口已关闭，无法执行 FR.remoteEvaluate；请重新打开页面后重试')
  const script = `(() => {
    if (typeof FR === 'undefined' || typeof FR.remoteEvaluate !== 'function') throw new Error('当前页面没有 FR.remoteEvaluate');
    const expressions = ${JSON.stringify(expressions)};
    return Promise.all(expressions.map((expression) => Promise.resolve(FR.remoteEvaluate('=' + expression))));
  })()`
  try {
    const values = await entry.win.webContents.executeJavaScript(script) as unknown[]
    const sql = applyFormulaResults(call.sqlPrepared, values)
    previewDataLogs.resolve(callId, sql)
    return { sql, source: 'FR.remoteEvaluate' }
  } catch (error) {
    previewDataLogs.resolve(callId, undefined, (error as Error).message)
    throw error
  }
}

/** open_page 使用：等待主页面完成及一小段异步初始化，再返回本轮初始错误。 */
export async function openPreviewAndCollect(url: string, scope: PreviewScope, settleMs = 1_200): Promise<PreviewDiagnosticReport> {
  openPreviewWindow(url, scope)
  const entry = previewWindows.get(previewKey(scope))
  if (entry) {
    await Promise.race([entry.load, new Promise<void>((resolve) => setTimeout(resolve, 6_000))])
    await new Promise<void>((resolve) => setTimeout(resolve, Math.max(300, Math.min(settleMs, 5_000))))
  }
  return collectPreviewErrors(scope.project, scope.page)
}
