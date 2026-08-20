import { app, BrowserWindow, Menu } from 'electron'
import { registerIpc } from './ipc'
import { createMainWindow } from './windows'
import { runSelftest } from './selftest'
import { existsSync, mkdirSync, renameSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// 禁用同源策略引起的 localhost 拉取问题不影响本应用；保持默认安全策略
app.commandLine.appendSwitch('disable-features', 'BlockInsecurePrivateNetworkRequests')

// 数据目录跨平台统一：macOS/Linux 用 ~/.config/report-console，Windows 走系统默认 %APPDATA%。
// 必须在创建窗口与初始化 SQLite 之前设置；macOS 一次性迁移 Electron 旧默认目录，老数据（库、检查点、会话）原样保留。
if (process.platform !== 'win32') {
  const next = join(homedir(), '.config', 'report-console')
  if (process.platform === 'darwin') {
    const legacy = join(homedir(), 'Library', 'Application Support', 'report-console')
    if (existsSync(legacy) && !existsSync(next)) {
      try {
        mkdirSync(join(homedir(), '.config'), { recursive: true })
        renameSync(legacy, next)
        console.log(`[main] 已迁移数据目录：${legacy} -> ${next}`)
      } catch (e) { console.warn('[main] 数据目录迁移失败，将继续使用新目录：', e) }
    }
  }
  app.setPath('userData', next)
}

function bootstrap(): void {
  registerIpc()
  const win = createMainWindow()

  // 无系统菜单栏的桌面壳默认不会为网页输入控件提供编辑右键菜单。
  // 只对可编辑控件弹出，避免覆盖工作台其他区域的原生交互。
  win.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable) return
    Menu.buildFromTemplate([
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { type: 'separator' },
      { role: 'selectAll' }
    ]).popup({ window: win })
  })

  // 冒烟模式：--smoke <截图路径> —— 等待渲染后截图并退出（供自动化验收）
  const smokeIdx = process.argv.indexOf('--smoke')
  if (smokeIdx !== -1) {
    const out = process.argv[smokeIdx + 1] || 'smoke.png'
    // 转发渲染层 console，便于冒烟排查
    win.webContents.on('console-message', (_e, _level, msg) => console.log('[renderer]', msg))
    win.webContents.once('did-finish-load', () => {
      // SMOKE_WAIT_MS 可覆盖等待时长（如 autosend 自检需要等模型流式完成）
      const waitMs = Number(process.env.SMOKE_WAIT_MS) || 2500
      setTimeout(async () => {
        try {
          // 仅供界面验收：打开工作台的项目设置弹层后再截图。
          if (process.env.SMOKE_OPEN_PROJECT_SETTINGS) {
            const clicked = await win.webContents.executeJavaScript(`(() => {
              const button = Array.from(document.querySelectorAll('button')).find((node) => node.getAttribute('title') === '项目设置')
              if (!button) return false
              button.click()
              return true
            })()`) as boolean
            if (!clicked) console.warn('[smoke] project settings button not found')
            await new Promise((resolve) => setTimeout(resolve, 250))
          }
          // 仅供界面验收：规范页（SMOKE_VIEW=reference）切到指定 tab 后再截图，如 SMOKE_REF_TAB=tools
          if (process.env.SMOKE_REF_TAB) {
            const tabClicked = await win.webContents.executeJavaScript(`(() => {
              const labels = { prompts: '系统提示词', skills: '内置 Skills', tools: '平台工具' }
              const want = labels[${JSON.stringify(process.env.SMOKE_REF_TAB)}]
              const button = Array.from(document.querySelectorAll('.reference-tabs button')).find((node) => node.textContent === want)
              if (!button) return false
              button.click()
              return true
            })()`) as boolean
            if (!tabClicked) console.warn('[smoke] reference tab button not found')
            await new Promise((resolve) => setTimeout(resolve, 250))
          }
          const info = await win.webContents.executeJavaScript(`(async () => {
            const p = document.querySelector('.rc-chat')
            const text = p ? (p.textContent || '') : ''
            const idb = await new Promise((res) => {
              const r = indexedDB.open('rc-pi-sessions')
              r.onsuccess = () => {
                const db = r.result
                const names = Array.from(db.objectStoreNames)
                if (!names.includes('sessions')) return res('stores:' + names.join(','))
                const req = db.transaction('sessions', 'readonly').objectStore('sessions').getAll()
                req.onsuccess = () => res(JSON.stringify(req.result.map((m) => ({ title: m.title, count: m.messageCount, roles: (m.messages || []).map((x) => x.role).join(',') }))))
                req.onerror = () => res('read-err')
              }
              r.onerror = () => res('db-err')
            })
            const q = (s) => document.querySelectorAll(s).length
            const dom = { bubble: q('.rc-bubble'), ahead: q('.rc-a-head'), md: q('.rc-md'), tool: q('.rc-tool'), toolopen: q('.rc-tool .rc-tool-b'), think: q('.rc-think'), busy: q('.rc-composer .btn:not(.pri)') }
            return JSON.stringify({ hasProbeText: text.includes('冒烟自检'), textLen: text.length, dom, idb })
          })()`).catch((e: unknown) => `probe failed: ${(e as Error).message}`)
          console.log(`[smoke] agent persist: ${info}`)
          const img = await win.webContents.capturePage()
          require('fs').writeFileSync(out, img.toPNG())
          console.log(`[smoke] screenshot -> ${out}`)
        } catch (e) {
          console.error('[smoke] capture failed', e)
        }
        app.quit()
      }, waitMs)
    })
    return
  }

  // 自检模式：--selftest —— 用平台服务对真实帆软/MySQL 跑完整链路
  if (process.argv.includes('--selftest')) {
    void (async () => {
      const r = await runSelftest(win)
      console.log('[selftest] ' + JSON.stringify(r, null, 2))
      app.exit(r.ok ? 0 : 1)
    })()
  }
}

// 单实例锁：已有实例时本次静默退出并聚焦旧窗口（服务未启动不影响启动，窗口照常打开）
if (!app.requestSingleInstanceLock()) {
  console.log('[main] 已有实例在运行，本次启动退出（已聚焦已有窗口）')
  app.quit()
} else {
  app.on('second-instance', () => {
    const wins = BrowserWindow.getAllWindows()
    if (wins.length > 0) {
      const w = wins[0]
      if (w.isMinimized()) w.restore()
      w.focus()
    }
  })
  app.whenReady().then(bootstrap)
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) bootstrap()
  })
}

process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err)
})
