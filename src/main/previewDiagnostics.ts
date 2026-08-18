/**
 * 预览窗口诊断账本。
 *
 * 只保存当前应用进程内的运行时错误；按 project/page 隔离，避免多个项目的 Agent
 * 互相读取。窗口关闭后保留最后一轮，便于用户操作完页面后再回到 Agent 追问。
 */

export interface PreviewScope {
  project: string
  page: string
}

export type PreviewErrorKind = 'js_error' | 'data_error' | 'load_error'

export interface PreviewError {
  id: number
  kind: PreviewErrorKind
  at: string
  message: string
  count: number
  source?: string
  line?: number
  status?: number
  method?: string
  url?: string
  requestBody?: string
  responseBody?: string
}

export interface PreviewDiagnosticSession {
  project: string
  page: string
  url: string
  windowId: number
  openedAt: string
  lastActivityAt: string
  closedAt?: string
  errors: PreviewError[]
}

export interface PreviewDiagnosticReport {
  project: string
  page?: string
  totalErrors: number
  windows: PreviewDiagnosticSession[]
}

const MAX_ERRORS = 80
const MAX_SESSIONS = 80
const MAX_TEXT = 2_000

function scopeKey(scope: PreviewScope): string {
  return JSON.stringify([scope.project, scope.page])
}

function clip(text: string | undefined, max = MAX_TEXT): string | undefined {
  if (text === undefined) return undefined
  return text.length > max ? `${text.slice(0, max)}…（截断）` : text
}

export function isFineReportDataUrl(url: string): boolean {
  try { return new URL(url).pathname.endsWith('/webroot/decision/api/data') } catch { return false }
}

/** HTTP 失败或帆软业务错误（即使 HTTP 200）均归为 data_error。 */
export function fineReportDataError(status: number, body: string): string | null {
  let parsed: Record<string, unknown> | null = null
  try {
    const value = JSON.parse(body) as unknown
    if (value && typeof value === 'object' && !Array.isArray(value)) parsed = value as Record<string, unknown>
  } catch { /* 非 JSON 由 HTTP 状态决定是否报错 */ }
  const code = parsed?.err_code ?? parsed?.errorCode ?? parsed?.error_code
  const message = parsed?.err_msg ?? parsed?.errorMsg ?? parsed?.message
  const hasBusinessError = code !== undefined && code !== null && String(code) !== '0'
  if (status < 400 && !hasBusinessError && parsed?.success !== false) return null
  const suffix = typeof message === 'string' && message.trim() ? `：${message.trim()}` : ''
  return `FineReport data 接口${status >= 400 ? `返回 HTTP ${status}` : `返回错误码 ${String(code)}`}${suffix}`
}

export class PreviewDiagnosticStore {
  private readonly sessions = new Map<string, PreviewDiagnosticSession>()
  private nextErrorId = 1

  begin(scope: PreviewScope, url: string, windowId: number): void {
    const now = new Date().toISOString()
    this.sessions.set(scopeKey(scope), {
      ...scope,
      url,
      windowId,
      openedAt: now,
      lastActivityAt: now,
      errors: []
    })
    this.prune()
  }

  close(scope: PreviewScope, windowId: number): void {
    const session = this.sessions.get(scopeKey(scope))
    if (!session || session.windowId !== windowId) return
    const now = new Date().toISOString()
    session.closedAt = now
    session.lastActivityAt = now
  }

  record(scope: PreviewScope, windowId: number, input: Omit<PreviewError, 'id' | 'at' | 'count'>): void {
    const session = this.sessions.get(scopeKey(scope))
    if (!session || session.windowId !== windowId || session.closedAt) return
    const now = new Date().toISOString()
    const error: PreviewError = {
      ...input,
      id: this.nextErrorId++,
      at: now,
      count: 1,
      message: clip(input.message) ?? '',
      source: clip(input.source, 500),
      url: clip(input.url, 1_000),
      requestBody: clip(input.requestBody),
      responseBody: clip(input.responseBody)
    }
    const last = session.errors[session.errors.length - 1]
    if (last && last.kind === error.kind && last.message === error.message && last.source === error.source && last.line === error.line && last.status === error.status && last.url === error.url && last.requestBody === error.requestBody) {
      last.count++
      last.at = now
    } else {
      session.errors.push(error)
      if (session.errors.length > MAX_ERRORS) session.errors.splice(0, session.errors.length - MAX_ERRORS)
    }
    session.lastActivityAt = now
  }

  collect(project: string, page?: string): PreviewDiagnosticReport {
    const windows = [...this.sessions.values()]
      .filter((session) => session.project === project && (!page || session.page === page))
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
      .map((session) => ({ ...session, errors: session.errors.map((error) => ({ ...error })) }))
    return {
      project,
      page,
      totalErrors: windows.reduce((total, session) => total + session.errors.reduce((n, error) => n + error.count, 0), 0),
      windows
    }
  }

  private prune(): void {
    if (this.sessions.size <= MAX_SESSIONS) return
    const oldest = [...this.sessions.entries()].sort((a, b) => a[1].lastActivityAt.localeCompare(b[1].lastActivityAt))
    for (const [key] of oldest.slice(0, this.sessions.size - MAX_SESSIONS)) this.sessions.delete(key)
  }
}

export const previewDiagnostics = new PreviewDiagnosticStore()
