/**
 * Agent 会话服务 — Vercel AI SDK（OpenAI / Anthropic 兼容接口）
 * 流式输出 + 工具调用，事件经 IPC 推送到渲染层
 */

import { streamText, type CoreMessage } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { getDb, getSettings } from '../db'
import { buildTools, SYSTEM_PROMPT } from './tools'
import type { AgentEvent, AgentMessage } from '@shared/types'
import type { BrowserWindow } from 'electron'

let activeAbort: AbortController | null = null

function resolveModel() {
  const s = getSettings()
  if (!s.llmApiKey) throw new Error('未配置 LLM API Key（设置 → Agent 模型）')
  if (!s.llmModel) throw new Error('未配置模型名称')
  if (s.llmProvider === 'anthropic') {
    const anthropic = s.llmBaseUrl
      ? createAnthropic({ baseURL: s.llmBaseUrl, apiKey: s.llmApiKey })
      : createAnthropic({ apiKey: s.llmApiKey })
    return anthropic(s.llmModel)
  }
  const openai = createOpenAI({
    baseURL: s.llmBaseUrl || undefined,
    apiKey: s.llmApiKey,
    compatibility: 'compatible'
  })
  return openai(s.llmModel)
}

// ── 会话持久化 ──────────────────────────────────────────────────

export function createSession(title?: string): { id: number } {
  const info = getDb().prepare('INSERT INTO agent_sessions(title) VALUES(?)').run(title || '新会话')
  return { id: Number(info.lastInsertRowid) }
}

export function listSessions(): Array<{ id: number; title: string; createdAt: string; messageCount: number }> {
  const rows = getDb().prepare(`
    SELECT s.id, s.title, s.created_at, COUNT(m.id) AS messageCount
    FROM agent_sessions s LEFT JOIN agent_messages m ON m.session_id = s.id
    GROUP BY s.id ORDER BY s.id DESC`).all() as Array<Record<string, unknown>>
  return rows.map((r) => ({
    id: r.id as number,
    title: r.title as string,
    createdAt: r.created_at as string,
    messageCount: r.messageCount as number
  }))
}

export function deleteSession(id: number): void {
  getDb().prepare('DELETE FROM agent_sessions WHERE id=?').run(id)
}

export function listMessages(sessionId: number): AgentMessage[] {
  const rows = getDb().prepare('SELECT * FROM agent_messages WHERE session_id=? ORDER BY id').all(sessionId) as Array<Record<string, unknown>>
  return rows.map((r) => ({
    id: r.id as number,
    sessionId: r.session_id as number,
    role: r.role as AgentMessage['role'],
    content: r.content as string,
    toolJson: (r.tool_json as string) ?? null,
    createdAt: r.created_at as string
  }))
}

export function stopAgent(): void {
  activeAbort?.abort()
  activeAbort = null
}

// ── 主流程 ──────────────────────────────────────────────────────

export async function runAgentTurn(
  win: BrowserWindow,
  sessionId: number,
  userText: string
): Promise<void> {
  const d = getDb()
  d.prepare('INSERT INTO agent_messages(session_id, role, content) VALUES(?,?,?)').run(sessionId, 'user', userText)
  if ((d.prepare('SELECT title FROM agent_sessions WHERE id=?').get(sessionId) as { title: string } | undefined)?.title === '新会话') {
    d.prepare('UPDATE agent_sessions SET title=? WHERE id=?').run(userText.slice(0, 40), sessionId)
  }

  const emit = (ev: AgentEvent) => {
    if (!win.isDestroyed()) win.webContents.send('agent:event', ev)
  }

  const history = listMessages(sessionId)
    .filter((m) => m.role !== 'system')
    .map((m): CoreMessage => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }))

  const toolCalls: Array<{ tool: string; args: unknown; result: unknown }> = []
  let assistantText = ''

  try {
    const model = resolveModel()
    activeAbort = new AbortController()
    const result = await streamText({
      model,
      system: SYSTEM_PROMPT,
      messages: history,
      tools: buildTools(),
      maxSteps: 12,
      abortSignal: activeAbort.signal
    })

    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta':
          assistantText += part.textDelta
          emit({ type: 'text-delta', text: part.textDelta })
          break
        case 'tool-call':
          emit({ type: 'tool-call', tool: part.toolName, args: part.args, callId: part.toolCallId })
          break
        case 'tool-result':
          toolCalls.push({ tool: part.toolName, args: part.args, result: part.result })
          emit({ type: 'tool-result', tool: part.toolName, result: part.result, callId: part.toolCallId })
          break
        case 'error':
          emit({ type: 'error', message: String((part as { error?: { message?: string } }).error?.message ?? part) })
          break
        default:
          break
      }
    }

    const finish = await result.finishReason.catch(() => 'unknown')
    const usage = await result.usage.catch(() => undefined)
    d.prepare('INSERT INTO agent_messages(session_id, role, content, tool_json) VALUES(?,?,?,?)')
      .run(sessionId, 'assistant', assistantText || '(无文本输出)', toolCalls.length ? JSON.stringify(toolCalls) : null)
    emit({ type: 'finish', finishReason: String(finish), usage })
  } catch (e) {
    const msg = (e as Error).message
    if (assistantText || toolCalls.length) {
      d.prepare('INSERT INTO agent_messages(session_id, role, content, tool_json) VALUES(?,?,?,?)')
        .run(sessionId, 'assistant', assistantText || '(中断)', toolCalls.length ? JSON.stringify(toolCalls) : null)
    }
    emit({ type: 'error', message: msg })
  } finally {
    activeAbort = null
  }
}
