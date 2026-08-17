/**
 * pi Agent 会话持久化 — 自研 IndexedDB 存储层（无 pi-web-ui 依赖）
 *
 * 渲染进程 IndexedDB（随 userData 走，备份应用数据目录即备份会话）。
 * 一个库一个 store：记录含元数据（标题/时间/预览）与会话数据（messages/thinkingLevel）。
 * 模型不落会话（模型唯一来源是设置页配置，恢复时由工厂回落当前配置）。
 */

import { uuidv7 } from '@earendil-works/pi-ai'
import type { ThinkingLevel } from '@earendil-works/pi-agent-core'

const DB_NAME = 'rc-pi-sessions'
const STORE = 'sessions'

/** 会话数据体（恢复时只需要消息与 thinkingLevel） */
export interface SessionData {
  messages: unknown[]
  thinkingLevel?: ThinkingLevel
}

interface SessionRecord extends SessionData {
  id: string
  title: string
  createdAt: string
  modifiedAt: string
  messageCount: number
  preview: string
}

let initPromise: Promise<IDBDatabase> | null = null

/** 幂等初始化：建库（rc-pi-sessions）→ 返回连接 */
export function initSessionStorage(): Promise<IDBDatabase> {
  if (!initPromise) {
    initPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: 'id' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'))
    })
  }
  return initPromise
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE)
}

function reqAs<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error ?? new Error('IndexedDB 请求失败'))
  })
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
    const db = await initSessionStorage()
    const all = await reqAs(tx(db, 'readonly').getAll())
    if (all.length === 0) return null
    const latest = all.reduce((a, b) => ((b as SessionRecord).modifiedAt > (a as SessionRecord).modifiedAt ? b : a)) as SessionRecord
    if (!Array.isArray(latest?.messages)) return null
    return {
      id: latest.id,
      title: latest.title || titleFromMessages(latest.messages),
      createdAt: latest.createdAt,
      data: { messages: latest.messages, thinkingLevel: latest.thinkingLevel }
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
  state: { model?: unknown; thinkingLevel?: ThinkingLevel; messages: unknown[] }
): Promise<void> {
  try {
    const db = await initSessionStorage()
    const record: SessionRecord = {
      id: snapshot.id,
      title: snapshot.title,
      createdAt: snapshot.createdAt,
      modifiedAt: new Date().toISOString(),
      messageCount: state.messages.length,
      preview: previewFromMessages(state.messages),
      messages: state.messages,
      thinkingLevel: state.thinkingLevel
    }
    await reqAs(tx(db, 'readwrite').put(record))
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
