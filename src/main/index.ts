import { app, BrowserWindow } from 'electron'
import { registerIpc } from './ipc'
import { createMainWindow } from './windows'

// 禁用同源策略引起的 localhost 拉取问题不影响本应用；保持默认安全策略
app.commandLine.appendSwitch('disable-features', 'BlockInsecurePrivateNetworkRequests')

function bootstrap(): void {
  registerIpc()
  const win = createMainWindow()

  // 冒烟模式：--smoke <截图路径> —— 等待渲染后截图并退出（供自动化验收）
  const smokeIdx = process.argv.indexOf('--smoke')
  if (smokeIdx !== -1) {
    const out = process.argv[smokeIdx + 1] || 'smoke.png'
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const img = await win.webContents.capturePage()
          require('fs').writeFileSync(out, img.toPNG())
          console.log(`[smoke] screenshot -> ${out}`)
        } catch (e) {
          console.error('[smoke] capture failed', e)
        }
        app.quit()
      }, 2500)
    })
  }
}

// 单实例锁
if (!app.requestSingleInstanceLock()) {
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
