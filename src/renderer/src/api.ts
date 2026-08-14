/**
 * 渲染层 IPC 封装 —— window.api.invoke 的类型化包装
 */

export interface R<T> { ok: boolean; data?: T; error?: string }

export async function call<T>(channel: string, args?: unknown): Promise<T> {
  const r = (await window.api.invoke(channel, args)) as R<T>
  if (!r.ok) throw new Error(r.error || `IPC ${channel} 失败`)
  return r.data as T
}

// 共享类型从主进程类型定义复用（构建期同源）
export * from '@shared/types'
