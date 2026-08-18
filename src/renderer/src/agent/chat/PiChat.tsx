/**
 * 自研 pi Agent 聊天组件 — 订阅 Agent 事件流渲染消息（替代 pi-web-ui <pi-chat-panel>）
 *
 * 视图状态全部派生自 agent.state（事件驱动 + rAF 合并刷新）：
 * 已落定消息 + 流式中的 assistant 部分（thinking/text/toolCall 实时呈现）。
 * 工具调用与结果配对渲染为单个可折叠块（运行中自动展开，结束自动收起，可手动展开）。
 * Agent 页与工作台右栏各挂一个实例，共享同一 Agent 单例（各自订阅，互不干扰）。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { Agent, AgentMessage } from '@earendil-works/pi-agent-core'
import type { AssistantMessage, TextContent, ToolCall, ToolResultMessage, Usage } from '@earendil-works/pi-ai'
import { Icon } from '../../components/Icon'
import { Markdown } from './Markdown'
import type { PiAgentHandle } from '../piAgent'

// ── 视图状态：事件 → 快照（rAF 合并，流式增量不逐 token 重渲染） ──

interface ChatView {
  messages: AgentMessage[]
  streaming?: AgentMessage
  pending: ReadonlySet<string>
  busy: boolean
}

function snapshot(agent: Agent): ChatView {
  return {
    messages: agent.state.messages,
    streaming: agent.state.streamingMessage,
    pending: agent.state.pendingToolCalls,
    busy: agent.state.isStreaming
  }
}

function useChatView(agent: Agent): ChatView {
  const [view, setView] = useState<ChatView>(() => snapshot(agent))
  useEffect(() => {
    let raf = 0
    const flush = () => { raf = 0; setView(snapshot(agent)) }
    const unsub = agent.subscribe(() => {
      if (!raf) raf = requestAnimationFrame(flush)
    })
    // 订阅建立前若有事件遗漏（另一视图驱动了共享单例），补一次快照
    flush()
    return () => { unsub(); if (raf) cancelAnimationFrame(raf) }
  }, [agent])
  return view
}

// ── 主组件 ──────────────────────────────────────────────────────

export interface ChatAttachment {
  key: string
  label: string
}

export function PiChat({ handle, placeholder = '描述要做的开发任务，例如：给 demo 项目加一个分页查询接口并实测…', contextPrefix, attachments = [], mentionOptions = [], onAttach, onDetach }: {
  handle: PiAgentHandle
  placeholder?: string
  /** 每次任务发送时附带的轻量资源引用，不含资源正文。 */
  contextPrefix?: string
  attachments?: ChatAttachment[]
  mentionOptions?: ChatAttachment[]
  onAttach?: (attachment: ChatAttachment) => void
  onDetach?: (key: string) => void
}): React.ReactElement {
  const agent = handle.agent
  const view = useChatView(agent)

  // 结果配对：toolCallId → ToolResultMessage（工具块的状态与内容来源）
  const results = useMemo(() => {
    const m = new Map<string, ToolResultMessage>()
    for (const msg of view.messages) if (msg.role === 'toolResult') m.set(msg.toolCallId, msg)
    return m
  }, [view.messages])
  // 工具显示名：AgentTool 的 label 优先（与工具注册名一致时无差别）
  const toolLabels = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of agent.state.tools) m.set(t.name, t.label ?? t.name)
    return m
  }, [agent])

  // 贴底滚动：用户上翻阅历史时不打扰，新内容到达时若原本贴底则继续贴底
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const stick = useRef(true)
  const onScroll = () => {
    const el = scrollRef.current
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }
  useEffect(() => {
    const el = scrollRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [view])

  // 输入区：Enter 发送 / Shift+Enter 换行；运行中可停止
  const [draft, setDraft] = useState('')
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const autoSize = () => {
    const ta = taRef.current
    if (ta) { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 130)}px` }
  }
  const send = () => {
    const text = draft.trim()
    if (!text || view.busy) return
    setDraft('')
    requestAnimationFrame(autoSize)
    stick.current = true
    void agent.prompt(contextPrefix ? `${contextPrefix}\n\n[任务]\n${text}` : text)
  }

  const mention = /(?:^|\s)@([^\s@]*)$/.exec(draft)
  const mentionQuery = mention?.[1].toLowerCase() ?? ''
  const mentionMatches = mention
    ? mentionOptions.filter((o) => !attachments.some((a) => a.key === o.key) && o.label.toLowerCase().includes(mentionQuery)).slice(0, 7)
    : []
  const pickMention = (attachment: ChatAttachment) => {
    onAttach?.(attachment)
    setDraft((v) => v.replace(/(?:^|\s)@([^\s@]*)$/, (m) => m.startsWith(' ') ? ' ' : ''))
    requestAnimationFrame(() => taRef.current?.focus())
  }

  const streamingAssistant = view.streaming?.role === 'assistant' ? view.streaming : undefined
  const empty = view.messages.length === 0 && !streamingAssistant

  return (
    <div className="rc-chat">
      <div className="rc-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="rc-thread">
          {empty && (
            <div className="rc-empty">
              <Icon n="ai" />
              <b>与 Agent 对话驱动平台开发</b>
              <span>项目管理、接口契约、存储过程、页面构建、SQL 查询与帆软实测均封装为工具，Agent 会在需要时自行调用。</span>
            </div>
          )}
          {view.messages.map((m, i) => {
            if (m.role === 'user') return <UserCard key={`u${i}`} msg={m} />
            if (m.role === 'assistant') {
              return <AssistantCard key={`a${i}`} msg={m} results={results} pending={view.pending} toolLabels={toolLabels} />
            }
            // 孤儿 toolResult（无对应 assistant 工具调用，如手工注入）兜底渲染
            if (m.role === 'toolResult') {
              const orphan: ToolCall = { type: 'toolCall', id: m.toolCallId, name: m.toolName, arguments: {} }
              return <ToolBlock key={`t${i}`} call={orphan} result={m} running={false} label={toolLabels.get(m.toolName) ?? m.toolName} />
            }
            return null
          })}
          {streamingAssistant && (
            <AssistantCard key="live" msg={streamingAssistant} live results={results} pending={view.pending} toolLabels={toolLabels} />
          )}
        </div>
      </div>
      <div className="rc-composer">
        {attachments.length > 0 && <div className="rc-attachments" aria-label="已附加资源">
          {attachments.map((a) => <span key={a.key} className="rc-attachment">@{a.label}<button title={`移除 ${a.label}`} onClick={() => onDetach?.(a.key)}>×</button></span>)}
        </div>}
        {mention && mentionMatches.length > 0 && <div className="rc-mentions" role="listbox" aria-label="资源建议">
          {mentionMatches.map((a) => <button key={a.key} type="button" onClick={() => pickMention(a)}><Icon n="link" size={12} />@{a.label}</button>)}
        </div>}
        <textarea
          ref={taRef}
          value={draft}
          rows={1}
          placeholder={placeholder}
          onChange={(e) => { setDraft(e.target.value); autoSize() }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
          }}
        />
        <div className="rc-composer-bar">
          <span className="rc-hint">{view.busy ? 'Agent 运行中…' : 'Enter 发送 · Shift+Enter 换行'}</span>
          <span className="grow" />
          {view.busy && <button className="btn sm" onClick={() => agent.abort()}><Icon n="stop" />停止</button>}
          <button className="btn sm pri" disabled={!draft.trim() || view.busy} onClick={send}><Icon n="send" />发送</button>
        </div>
      </div>
    </div>
  )
}

// ── 用户消息 ────────────────────────────────────────────────────

function UserCard({ msg }: { msg: Extract<AgentMessage, { role: 'user' }> }): React.ReactElement | null {
  const text = typeof msg.content === 'string'
    ? msg.content
    : msg.content.filter((b): b is TextContent => b.type === 'text').map((b) => b.text).join('\n')
  // 资源引用是运行时上下文，不重复占用用户消息的视觉空间。
  const shown = text.includes('\n[任务]\n') ? text.slice(text.lastIndexOf('\n[任务]\n') + 6) : text
  if (!shown.trim()) return null
  return <div className="rc-msg user"><div className="rc-bubble">{shown}</div></div>
}

// ── 助手消息：thinking / text / toolCall 块序 + 元信息脚注 ───────

function AssistantCard({ msg, live, results, pending, toolLabels }: {
  msg: AssistantMessage
  /** true = 流式中的部分消息（思考实时展开、文本带光标、工具块随执行状态联动） */
  live?: boolean
  results: Map<string, ToolResultMessage>
  pending: ReadonlySet<string>
  toolLabels: Map<string, string>
}): React.ReactElement {
  const blocks = Array.isArray(msg.content) ? msg.content : []
  return (
    <div className="rc-msg assistant">
      <div className="rc-a-head"><Icon n="ai" size={13} /><span>Agent</span>
        {msg.stopReason === 'aborted' && <span className="rc-note dim">已中断</span>}
        {msg.stopReason === 'error' && <span className="rc-note err">出错</span>}
      </div>
      {blocks.map((b, i) => {
        if (b.type === 'thinking') return <ThinkingBlock key={i} text={b.redacted ? '（内容被安全过滤，不可见）' : b.thinking} live={live} />
        if (b.type === 'text') {
          if (!b.text.trim()) return null
          return <React.Fragment key={i}><Markdown text={b.text} />{live && <span className="rc-caret" />}</React.Fragment>
        }
        if (b.type === 'toolCall') {
          return (
            <ToolBlock
              key={i}
              call={b}
              result={results.get(b.id)}
              running={live ? pending.has(b.id) || !results.get(b.id) : pending.has(b.id)}
              label={toolLabels.get(b.name) ?? b.name}
            />
          )
        }
        return null
      })}
      {!live && (msg.stopReason === 'error' || msg.stopReason === 'aborted') && msg.errorMessage && (
        <div className="rc-note err detail">{msg.errorMessage}</div>
      )}
      {!live && <AssistantMeta msg={msg} />}
    </div>
  )
}

function AssistantMeta({ msg }: { msg: AssistantMessage }): React.ReactElement | null {
  const tok = fmtTokens(msg.usage)
  if (!tok) return null
  return <div className="rc-meta">{msg.model}{tok ? ` · ${tok}` : ''}</div>
}

// ── thinking 块：流式实时展示，落定后折叠可展开 ────────────────

function ThinkingBlock({ text, live }: { text: string; live?: boolean }): React.ReactElement {
  const [open, setOpen] = useState(!!live)
  if (live) {
    return (
      <div className="rc-think live">
        <div className="rc-think-t"><span className="rc-rot"><Icon n="spin" size={12} /></span>思考中…</div>
        <div className="rc-think-b">{text}</div>
      </div>
    )
  }
  return (
    <div className="rc-think">
      <button className="rc-think-t" onClick={() => setOpen((o) => !o)}>
        <Icon n="eye" size={12} />思考过程<span className="dim mono">{text.length} 字</span>
        <span className="grow" /><span className="chv">{open ? '收起' : '展开'}</span>
      </button>
      {open && <div className="rc-think-b">{text}</div>}
    </div>
  )
}

// ── 工具块：调用与结果配对，运行中自动展开/结束自动收起 ─────────

function ToolBlock({ call, result, running, label }: {
  call: ToolCall
  result?: ToolResultMessage
  running: boolean
  label: string
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const touched = useRef(false)
  useEffect(() => { if (!touched.current) setOpen(running) }, [running])
  const toggle = () => { touched.current = true; setOpen((o) => !o) }

  const resultText = result
    ? result.content.filter((b): b is TextContent => b.type === 'text').map((b) => b.text).join('\n')
    : ''
  return (
    <div className={`rc-tool${result?.isError ? ' err' : ''}${running ? ' run' : ''}`}>
      <button className="rc-tool-h" onClick={toggle}>
        {running
          ? <span className="rc-rot ok"><Icon n="spin" size={12} /></span>
          : result
            ? (result.isError ? <Icon n="cx" size={12} /> : <Icon n="cck" size={12} />)
            : <Icon n="cd" size={12} />}
        <span className="rc-tool-name">{label}</span>
        <span className="rc-tool-args">{argSummary(call.arguments)}</span>
        <span className="grow" />
        <span className="chv">{open ? '收起' : '详情'}</span>
      </button>
      {open && (
        <div className="rc-tool-b">
          <div className="rc-tool-sec">参数</div>
          <pre>{prettyJson(call.arguments)}</pre>
          {result && (<>
            <div className="rc-tool-sec">{result.isError ? '结果（错误）' : '结果'}</div>
            <pre>{prettyJson(resultText)}</pre>
          </>)}
        </div>
      )}
    </div>
  )
}

// ── 小工具 ──────────────────────────────────────────────────────

/** 参数摘要：紧凑 JSON 单行截断 */
function argSummary(args: unknown): string {
  let s: string
  try { s = typeof args === 'string' ? args : JSON.stringify(args) } catch { s = String(args) }
  return s.length > 76 ? `${s.slice(0, 76)}…` : s
}

/** JSON 字符串美化；非 JSON 原样返回 */
function prettyJson(v: unknown): string {
  if (typeof v === 'string') {
    try { return JSON.stringify(JSON.parse(v), null, 2) } catch { return v }
  }
  try { return JSON.stringify(v, null, 2) ?? String(v) } catch { return String(v) }
}

function fmtTokens(u?: Usage): string {
  if (!u || !u.totalTokens) return ''
  return u.totalTokens >= 1000 ? `${(u.totalTokens / 1000).toFixed(1)}k tok` : `${u.totalTokens} tok`
}
