/**
 * pi Agent 会话持久化 — 官方 pi-web-ui 存储层（IndexedDB）
 *
 * 初始化 AppStorage（settings/providerKeys/sessions/customProviders 四个 store
 * + sessions-metadata），会话数据落在渲染进程 IndexedDB（随 userData 走，
 * 备份应用数据目录即备份会话）。启动时恢复最近会话，事件驱动自动保存。
 */

import {
  AppStorage, IndexedDBStorageBackend, SessionsStore, SettingsStore,
  ProviderKeysStore, CustomProvidersStore, setAppStorage,
  type SessionData
} from '@earendil-works/pi-web-ui'
import { uuidv7 } from '@earendil-works/pi-ai'

let initPromise: Promise<SessionsStore> | null = null

/** 幂等初始化：建库（report-console-pi）→ 注册全局 AppStorage → 返回会话 store */
export function initSessionStorage(): Promise<SessionsStore> {
  if (!initPromise) {
    initPromise = (async () => {
      const settings = new SettingsStore()
      const providerKeys = new ProviderKeysStore()
      const sessions = new SessionsStore()
      const customProviders = new CustomProvidersStore()
      const stores = [settings, providerKeys, sessions, customProviders]

      const backend = new IndexedDBStorageBackend({
        dbName: 'report-console-pi',
        version: 1,
        stores: [...stores.map((s) => s.getConfig()), SessionsStore.getMetadataConfig()]
      })
      for (const s of stores) s.setBackend(backend)
      setAppStorage(new AppStorage(settings, providerKeys, sessions, customProviders, backend))
      return sessions
    })()
  }
  return initPromise
}

export interface RestoredSession {
  id: string
  title: string
  createdAt: string
  data: SessionData
}

/** 恢复最近一次会话；无历史时返回 null（调用方走全新会话） */
export async function restoreLatestSession(): Promise<RestoredSession | null> {
  try {
    const sessions = await initSessionStorage()
    const id = await sessions.getLatestSessionId()
    if (!id) return null
    const data = await sessions.loadSession(id)
    if (!data || !Array.isArray(data.messages)) return null
    const meta = await sessions.getMetadata(id)
    return {
      id,
      title: meta?.title ?? titleFromMessages(data.messages),
      createdAt: meta?.createdAt ?? new Date().toISOString(),
      data
    }
  } catch (e) {
    console.warn('[pi] 会话恢复失败（按新会话处理）：', (e as Error).message)
    return null
  }
}

export interface SaveSnapshot {
  id: string
  title: string
  createdAt: string
}

/** 保存当前 AgentState（message_end / agent_end 时调用；元数据保留首次创建时间与标题） */
export async function saveSessionSnapshot(
  snapshot: SaveSnapshot,
  state: { model: unknown; thinkingLevel?: unknown; messages: unknown[] }
): Promise<void> {
  try {
    const sessions = await initSessionStorage()
    await sessions.saveSession(snapshot.id, state as never, {
      id: snapshot.id,
      title: snapshot.title,
      createdAt: snapshot.createdAt,
      lastModified: new Date().toISOString(),
      messageCount: state.messages.length,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      thinkingLevel: (state.thinkingLevel ?? 'off') as never,
      preview: previewFromMessages(state.messages)
    })
  } catch (e) {
    console.warn('[pi] 会话保存失败：', (e as Error).message)
  }
}

/** 会话预览文本：用户/助手文本块串联的前 2KB（工具调用与结果不计入） */
function previewFromMessages(messages: unknown[], limit = 2048): string {
  const parts: string[] = []
  for (const m of messages) {
    const role = (m as { role?: string }).role
    if (role !== 'user' && role !== 'assistant') continue
    const content = (m as { content?: unknown }).content
    const text = typeof content === 'string' ? content : Array.isArray(content)
      ? content.filter((b) => (b as { type?: string }).type === 'text').map((b) => (b as { text?: string }).text ?? '').join('\n')
      : ''
    if (text) parts.push(text)
    if (parts.join('\n').length >= limit) break
  }
  return parts.join('\n').slice(0, limit)
}

export function newSessionId(): string {
  return uuidv7()
}

/** 标题取自首条用户消息 */
export function titleFromMessages(messages: unknown[], fallback = '新会话'): string {
  const firstUser = messages.find((m) => (m as { role?: string }).role === 'user')
  const content = (firstUser as { content?: unknown })?.content
  const text = typeof content === 'string' ? content : Array.isArray(content)
    ? (content.find((b) => (b as { type?: string }).type === 'text') as { text?: string })?.text ?? ''
    : ''
  return (text.trim().slice(0, 40)) || fallback
}
