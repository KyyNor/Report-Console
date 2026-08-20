import { contextBridge, ipcRenderer } from 'electron'

/**
 * 渲染层 API —— 全部走 invoke（返回 { ok, data | error }），
 * Agent 事件流走 agent:event 订阅。
 */
const api = {
  invoke: (channel: string, args?: unknown) => ipcRenderer.invoke(channel, args),
  onAgentEvent: (cb: (ev: unknown) => void) => {
    const listener = (_e: unknown, ev: unknown) => cb(ev)
    ipcRenderer.on('agent:event', listener)
    return () => ipcRenderer.removeListener('agent:event', listener)
  },
  /** 打包邮件发送的分卷进度（主进程 mail:progress 推送） */
  onMailProgress: (cb: (p: { number: number; total: number; fileName: string }) => void) => {
    const listener = (_e: unknown, p: { number: number; total: number; fileName: string }) => cb(p)
    ipcRenderer.on('mail:progress', listener)
    return () => ipcRenderer.removeListener('mail:progress', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
export type Api = typeof api
