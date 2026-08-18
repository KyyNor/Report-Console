/**
 * FineReport /api/data 预览调用账本。
 *
 * 仅驻留当前应用进程，跟随预览会话而不是写入项目目录；按 project/page/window
 * 强隔离。SQL 来自当前项目 project.yaml 的接口契约，不读取其他项目。
 */
import * as projects from './projectsService'
import type { DatasetParam, PreviewDataCall, PreviewDataParameter, PreviewDataReport, PreviewDataSession } from '@shared/types'
import type { PreviewScope } from './previewDiagnostics'

const MAX_CALLS = 100
const MAX_SESSIONS = 80
const MAX_BODY = 20_000

function scopeKey(scope: PreviewScope): string {
  return JSON.stringify([scope.project, scope.page])
}

function clip(text: string | undefined, max = MAX_BODY): string | undefined {
  if (text === undefined) return undefined
  return text.length > max ? `${text.slice(0, max)}…（截断）` : text
}

function requestInfo(body: string | undefined): { reportPath?: string; datasourceName?: string; parameters?: PreviewDataParameter[] } {
  if (!body) return {}
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>
    const parameters = Array.isArray(parsed.parameters)
      ? parsed.parameters.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item)).map((item) => ({
          name: typeof item.name === 'string' ? item.name : '',
          ...(typeof item.type === 'string' ? { type: item.type } : {}),
          ...('value' in item ? { value: item.value } : {})
        })).filter((item) => !!item.name)
      : undefined
    return {
      reportPath: typeof parsed.report_path === 'string' ? parsed.report_path : undefined,
      datasourceName: typeof parsed.datasource_name === 'string' ? parsed.datasource_name : undefined,
      parameters
    }
  } catch {
    return {}
  }
}

function formulaLiteral(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return JSON.stringify(value == null ? '' : String(value))
}

function replaceIdentifier(expression: string, name: string, value: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return expression.replace(new RegExp(`\\b${escaped}\\b`, 'g'), value)
}

/** 把请求参数代入每段 ${...} 帆软公式，保留公式边界，供人工核对和后续显式求值。 */
export function prepareFineReportSql(sql: string, contractParams: DatasetParam[], requestParams: PreviewDataParameter[]): string {
  const request = new Map(requestParams.map((item) => [item.name, item.value]))
  return sql.replace(/\$\{([\s\S]*?)\}/g, (_whole, source: string) => {
    let expression = source
    for (const param of contractParams) {
      const replacement = param.type === 'formula'
        ? (param.default?.replace(/^=/, '') || `$${param.name}`)
        : formulaLiteral(request.get(param.name) ?? param.default ?? '')
      expression = replaceIdentifier(expression, param.name, replacement)
    }
    return `\${${expression}}`
  })
}

export function fineReportFormulaExpressions(preparedSql: string): string[] {
  return [...preparedSql.matchAll(/\$\{([\s\S]*?)\}/g)].map((match) => match[1])
}

export function applyFormulaResults(preparedSql: string, results: unknown[]): string {
  let index = 0
  return preparedSql.replace(/\$\{([\s\S]*?)\}/g, () => String(results[index++] ?? ''))
}

export class PreviewDataLogStore {
  private readonly sessions = new Map<string, PreviewDataSession>()
  private nextCallId = 1

  begin(scope: PreviewScope, url: string, windowId: number): void {
    const now = new Date().toISOString()
    this.sessions.set(scopeKey(scope), { ...scope, url, windowId, openedAt: now, lastActivityAt: now, calls: [] })
    this.prune()
  }

  close(scope: PreviewScope, windowId: number): void {
    const session = this.sessions.get(scopeKey(scope))
    if (!session || session.windowId !== windowId) return
    const now = new Date().toISOString()
    session.closedAt = now
    session.lastActivityAt = now
  }

  startOrReuse(scope: PreviewScope, windowId: number, input: { method: string; url: string; requestBody?: string }): number {
    const session = this.sessions.get(scopeKey(scope))
    if (!session || session.windowId !== windowId || session.closedAt) return -1
    const now = new Date().toISOString()
    const body = clip(input.requestBody)
    const recent = [...session.calls].reverse().find((call) => !call.completedAt && call.method === input.method && call.url === input.url && call.requestBody === body && Date.now() - Date.parse(call.at) < 3_000)
    if (recent) return recent.id

    const info = requestInfo(body)
    let sqlTemplate: string | undefined
    let sqlPrepared: string | undefined
    if (info.datasourceName) {
      try {
        const dataset = projects.readDataset(scope.project, info.datasourceName)
        sqlTemplate = dataset.sql
        sqlPrepared = prepareFineReportSql(dataset.sql, dataset.params, info.parameters ?? [])
      } catch { /* 页面可能调用未纳入当前项目契约的外部接口，只记录传输信息 */ }
    }
    const call: PreviewDataCall = {
      id: this.nextCallId++, at: now, method: input.method, url: input.url, requestBody: body,
      ...info, ...(sqlTemplate ? { sqlTemplate, sqlPrepared } : {})
    }
    session.calls.push(call)
    if (session.calls.length > MAX_CALLS) session.calls.splice(0, session.calls.length - MAX_CALLS)
    session.lastActivityAt = now
    return call.id
  }

  complete(callId: number, input: { status?: number; responseBody?: string; networkError?: string }): void {
    const found = this.findMutable(callId)
    if (!found) return
    const now = new Date().toISOString()
    found.call.completedAt ??= now
    found.call.durationMs ??= Math.max(0, Date.parse(now) - Date.parse(found.call.at))
    if (input.status !== undefined) found.call.status = input.status
    if (input.responseBody !== undefined) found.call.responseBody = clip(input.responseBody)
    if (input.networkError) found.call.networkError = clip(input.networkError, 1_000)
    found.session.lastActivityAt = now
  }

  resolve(callId: number, sql?: string, error?: string): void {
    const found = this.findMutable(callId)
    if (!found) return
    if (sql !== undefined) { found.call.sqlResolved = sql; delete found.call.sqlResolutionError }
    if (error !== undefined) found.call.sqlResolutionError = clip(error, 2_000)
    found.session.lastActivityAt = new Date().toISOString()
  }

  call(project: string, page: string, callId: number): PreviewDataCall | undefined {
    return this.sessions.get(scopeKey({ project, page }))?.calls.find((item) => item.id === callId)
  }

  collect(project: string, page?: string): PreviewDataReport {
    const sessions = [...this.sessions.values()]
      .filter((session) => session.project === project && (!page || session.page === page))
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
      .map((session) => ({ ...session, calls: session.calls.map((call) => ({ ...call, parameters: call.parameters?.map((item) => ({ ...item })) })) }))
    return { project, page, totalCalls: sessions.reduce((total, session) => total + session.calls.length, 0), sessions }
  }

  private findMutable(callId: number): { session: PreviewDataSession; call: PreviewDataCall } | undefined {
    for (const session of this.sessions.values()) {
      const call = session.calls.find((item) => item.id === callId)
      if (call) return { session, call }
    }
    return undefined
  }

  private prune(): void {
    if (this.sessions.size <= MAX_SESSIONS) return
    const oldest = [...this.sessions.entries()].sort((a, b) => a[1].lastActivityAt.localeCompare(b[1].lastActivityAt))
    for (const [key] of oldest.slice(0, this.sessions.size - MAX_SESSIONS)) this.sessions.delete(key)
  }
}

export const previewDataLogs = new PreviewDataLogStore()
