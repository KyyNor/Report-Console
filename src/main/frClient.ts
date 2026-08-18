/**
 * 帆软 HTTP 客户端 — /api/data 协议封装 + 服务探测
 */

import { getSettings } from './db'

export interface ApiDataRequest {
  report_path: string
  datasource_name: string
  page_number: number
  page_size: number
  parameters: Array<{ name: string; type: string; value: unknown }>
}

export interface ApiDataResponse {
  report_path?: string
  datasource_name?: string
  err_code: number
  err_msg: string
  total_page_number?: number
  data?: Array<Record<string, unknown>>
  [k: string]: unknown
}

export function apiDataUrl(): string {
  const s = getSettings()
  return `${s.frServerUrl.replace(/\/+$/, '')}/webroot/decision/api/data`
}

/** reportlet 为 FineReport reportlets 根目录内的完整相对路径。 */
export function previewPageUrl(reportlet: string): string {
  const s = getSettings()
  return `${s.frServerUrl.replace(/\/+$/, '')}/webroot/decision/view/report?op=write&reportlet=${encodeURIComponent(reportlet)}&t=${Date.now()}`
}

/** 移动端走 FineReport 移动 SPA；骨架自行加载 antd-mobile，不依赖 PC viewer 的 jsImportList。 */
export function previewMobilePageUrl(reportlet: string): string {
  const s = getSettings()
  return `${s.frServerUrl.replace(/\/+$/, '')}/webroot/decision/url/mobile#/report?nodePath=${encodeURIComponent(reportlet)}&t=${Date.now()}`
}

/** 调用 /api/data。网络/HTTP 层异常直接抛出；帆软层错误体现在 err_code */
export async function callApiData(req: ApiDataRequest, timeoutMs = 15000): Promise<{ body: ApiDataResponse; durationMs: number; httpStatus: number }> {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(apiDataUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: controller.signal
    })
    const text = await res.text()
    let body: ApiDataResponse
    try {
      body = JSON.parse(text) as ApiDataResponse
    } catch {
      throw new Error(`帆软返回非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`)
    }
    return { body, durationMs: Date.now() - started, httpStatus: res.status }
  } finally {
    clearTimeout(timer)
  }
}

/** 服务连通探测：GET 登录页，2xx/3xx 均视为可达 */
export async function pingFrServer(): Promise<{ reachable: boolean; latencyMs: number }> {
  const s = getSettings()
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4000)
  try {
    const res = await fetch(`${s.frServerUrl.replace(/\/+$/, '')}/webroot/decision/login`, {
      redirect: 'manual',
      signal: controller.signal
    })
    return { reachable: res.status < 500, latencyMs: Date.now() - started }
  } catch {
    return { reachable: false, latencyMs: Date.now() - started }
  } finally {
    clearTimeout(timer)
  }
}
