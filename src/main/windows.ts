/**
 * 窗口管理 — 主窗口 + 帆软页面预览窗口
 */

import { BrowserWindow, shell } from 'electron'
import { join } from 'path'

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1024,
    minHeight: 700,
    title: 'Report Console — 帆软加壳开发控制台',
    // 深色自绘标题栏（设计稿）：macOS 藏原生栏保红绿灯，Windows/Linux 用 overlay
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 14, y: 13 },
    ...(process.platform !== 'darwin' ? { titleBarOverlay: { color: '#10121700', symbolColor: '#9fa8b8', height: 38 } } : {}),
    backgroundColor: '#08090c',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  // 开发模式走 electron-vite 的 dev server；生产加载打包产物
  // SMOKE_VIEW=xxx 以 hash 深链打开指定视图；SMOKE_AUTOSEND=1 让 Agent 页自动发一条自检消息
  const hash = process.env.SMOKE_VIEW || ''
  const query = process.env.SMOKE_AUTOSEND ? { autosend: '1' } : undefined
  if (process.env.ELECTRON_RENDERER_URL) {
    const u = new URL(process.env.ELECTRON_RENDERER_URL)
    if (hash) u.hash = hash
    if (query) for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v)
    void win.loadURL(u.toString())
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: hash || undefined, query })
  }
  // 外链走系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  return win
}

const previewWindows = new Map<string, BrowserWindow>()

/** 打开帆软页面预览窗口（独立 BrowserWindow，可多开，按 module/page 复用） */
export function openPreviewWindow(url: string, key: string): BrowserWindow {
  const existing = previewWindows.get(key)
  if (existing && !existing.isDestroyed()) {
    existing.loadURL(url)
    existing.focus()
    return existing
  }
  const win = new BrowserWindow({
    width: 1180,
    height: 800,
    title: `预览 — ${key}`,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  void win.loadURL(url)
  win.on('closed', () => previewWindows.delete(key))
  previewWindows.set(key, win)
  return win
}
