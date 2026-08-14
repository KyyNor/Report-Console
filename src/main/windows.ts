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
    title: 'FR Console — 帆软加壳开发控制台',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  // 开发模式走 electron-vite 的 dev server；生产加载打包产物
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
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
