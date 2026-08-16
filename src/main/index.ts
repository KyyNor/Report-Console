import { app, BrowserWindow } from 'electron'
import { registerIpc } from './ipc'
import { createMainWindow } from './windows'
import { runSelftest } from './selftest'

// 禁用同源策略引起的 localhost 拉取问题不影响本应用；保持默认安全策略
app.commandLine.appendSwitch('disable-features', 'BlockInsecurePrivateNetworkRequests')

function bootstrap(): void {
  registerIpc()
  const win = createMainWindow()

  // 冒烟模式：--smoke <截图路径> —— 等待渲染后截图并退出（供自动化验收）
  const smokeIdx = process.argv.indexOf('--smoke')
  if (smokeIdx !== -1) {
    const out = process.argv[smokeIdx + 1] || 'smoke.png'
    // 转发渲染层 console，便于冒烟排查
    win.webContents.on('console-message', (_e, _level, msg) => console.log('[renderer]', msg))
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const info = await win.webContents.executeJavaScript(`(async () => {
            const deepText = (el) => {
              let t = (el.textContent || '')
              if (el.shadowRoot) for (const c of el.shadowRoot.querySelectorAll('*')) t += deepText(c)
              for (const c of el.querySelectorAll('*')) if (c.shadowRoot) t += deepText(c)
              return t
            }
            const p = document.querySelector('pi-chat-panel')
            const text = p ? deepText(p) : ''
            const idb = await new Promise((res) => {
              const r = indexedDB.open('report-console-pi')
              r.onsuccess = () => {
                const db = r.result
                const names = Array.from(db.objectStoreNames)
                const meta = names.find((n) => n.includes('metadata'))
                if (!meta) return res('stores:' + names.join(','))
                const req = db.transaction(meta, 'readonly').objectStore(meta).getAll()
                req.onsuccess = () => res(JSON.stringify(req.result.map((m) => ({ title: m.title, count: m.messageCount }))))
                req.onerror = () => res('read-err')
              }
              r.onerror = () => res('db-err')
            })
            return JSON.stringify({ hasProbeText: text.includes('冒烟自检'), textLen: text.length, idb })
          })()`).catch((e: unknown) => `probe failed: ${(e as Error).message}`)
          console.log(`[smoke] agent persist: ${info}`)
          const img = await win.webContents.capturePage()
          require('fs').writeFileSync(out, img.toPNG())
          console.log(`[smoke] screenshot -> ${out}`)
        } catch (e) {
          console.error('[smoke] capture failed', e)
        }
        app.quit()
      }, 2500)
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
