/**
 * 版本更新检查（半自动）：拉 GitHub Releases latest 比对版本，有新版弹原生对话框展示更新内容。
 * 不下载安装包（三平台通吃、无签名要求），「去下载」跳转 Release 页。
 * 「忽略此版本」落 settings：该版本不再提示，直到更新的版本发布。
 */
import { app, dialog, shell } from 'electron'
import { getSettings, saveSettings } from './db'

const RELEASES_LATEST_URL = 'https://api.github.com/repos/KyyNor/Report-Console/releases/latest'
const RELEASES_PAGE = 'https://github.com/KyyNor/Report-Console/releases/latest'
/** 原生对话框里更新说明过长会撑爆窗口，截断保底 */
const NOTES_LIMIT = 1200

export interface UpdateCheckResult {
  hasUpdate: boolean
  current: string
  latest: string
  notes: string
  url: string
}

/** 语义化版本比较（x.y.z）：a>b 返回 1、相等 0、a<b 返回 -1；非法片段按 0 处理 */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0)
  const pb = b.replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1
  }
  return 0
}

async function fetchLatestRelease(): Promise<{ tag: string; notes: string; url: string } | null> {
  const r = await fetch(RELEASES_LATEST_URL, {
    headers: { 'User-Agent': 'report-console-updater', Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(10000)
  })
  if (!r.ok) throw new Error(`GitHub API 响应 ${r.status}`)
  const j = await r.json() as { tag_name?: string; body?: string; html_url?: string }
  if (!j.tag_name) return null
  return {
    tag: j.tag_name.replace(/^v/, ''),
    notes: (j.body ?? '').trim(),
    url: j.html_url || RELEASES_PAGE
  }
}

/**
 * 检查更新。manual=true（设置页手动触发）不受「忽略此版本」影响；
 * 自动检查时，已忽略的版本不再提示，更新的版本出来自然恢复提示。
 */
export async function checkForUpdate(manual: boolean): Promise<UpdateCheckResult> {
  const current = app.getVersion()
  const rel = await fetchLatestRelease()
  if (!rel) return { hasUpdate: false, current, latest: current, notes: '', url: '' }
  const hasUpdate = compareVersions(rel.tag, current) > 0 && (manual || getSettings().updateIgnoredVersion !== rel.tag)
  return { hasUpdate, current, latest: rel.tag, notes: rel.notes, url: rel.url }
}

/** 弹原生更新对话框：去下载（打开 Release 页）/ 忽略此版本（落 settings）/ 稍后提醒（下次启动再看） */
export async function notifyUpdate(info: UpdateCheckResult): Promise<void> {
  const notes = info.notes.length > NOTES_LIMIT ? `${info.notes.slice(0, NOTES_LIMIT)}\n…` : info.notes
  const r = await dialog.showMessageBox({
    type: 'info',
    title: '发现新版本',
    message: `Report Console v${info.latest} 可用（当前 v${info.current}）`,
    detail: notes || '（本版本未填写更新说明）',
    buttons: ['去下载', '忽略此版本', '稍后提醒'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  })
  if (r.response === 0) await shell.openExternal(info.url)
  else if (r.response === 1) saveSettings({ updateIgnoredVersion: info.latest })
}

/** 启动自动检查：仅打包后生效；网络失败静默，无更新不打扰 */
export async function autoCheckOnStartup(): Promise<void> {
  if (!app.isPackaged) return
  try {
    const info = await checkForUpdate(false)
    if (info.hasUpdate) await notifyUpdate(info)
  } catch { /* 网络不可达静默跳过 */ }
}
