/**
 * 自研 pi Agent 聊天组件 — 订阅 Agent 事件流渲染消息（替代 pi-web-ui <pi-chat-panel>）
 *
 * 视图状态全部派生自 agent.state（事件驱动 + rAF 合并刷新）：
 * 已落定消息 + 流式中的 assistant 部分（thinking/text/toolCall 实时呈现）。
 * 工具调用与结果配对渲染为单个可折叠块（运行中自动展开，结束自动收起，可手动展开）。
 * Agent 页与工作台右栏各挂一个实例，共享同一 Agent 单例（各自订阅，互不干扰）。
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { estimateContextTokens, type Agent, type AgentMessage } from '@earendil-works/pi-agent-core'
import type { AssistantMessage, TextContent, ToolCall, ToolResultMessage, Usage } from '@earendil-works/pi-ai'
import { Icon } from '../../components/Icon'
import { Markdown } from './Markdown'
import type { PiAgentHandle } from '../piAgent'
import { call } from '../../api'
import type { DevelopmentCheckpoint } from '@shared/types'

/** 这些工具成功后会改变工作台资源或其构建、实测状态。 */
const RESOURCE_MUTATING_TOOLS = new Set([
  'save_dataset', 'delete_dataset', 'build_data_cpt', 'test_dataset',
  'save_procedure', 'apply_procedure',
  'write_doc', 'patch_doc',
  'write_page', 'patch_page', 'create_page', 'update_page_paths', 'build_page'
])

// ── 视图状态：事件 → 快照（rAF 合并，流式增量不逐 token 重渲染） ──

interface ChatView {
  messages: AgentMessage[]
  streaming?: AgentMessage
  pending: ReadonlySet<string>
  busy: boolean
  /** 当前上下文 token 占用（最近一次请求的实际 usage + 之后新增消息的估算）。 */
  ctxTokens: number
}

function snapshot(agent: Agent): ChatView {
  return {
    messages: agent.state.messages,
    streaming: agent.state.streamingMessage,
    pending: agent.state.pendingToolCalls,
    busy: agent.state.isStreaming,
    ctxTokens: estimateContextTokens(agent.state.messages).tokens
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

// ── 上下文占用圆环（发送按钮旁；阈值色与自动压缩一致） ─────────────

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

function ContextGauge({ tokens, windowTokens }: { tokens: number; windowTokens: number }): React.ReactElement {
  const pct = Math.max(0, Math.min(1, windowTokens > 0 ? tokens / windowTokens : 0))
  const cls = pct >= 0.8 ? 'bad' : pct >= 0.6 ? 'warn' : ''
  const r = 7
  const c = 2 * Math.PI * r
  return (
    <span className={`rc-ctx-gauge${cls ? ` ${cls}` : ''}`} title={`上下文占用 ${fmtTokens(tokens)} / ${fmtTokens(windowTokens)}（约 ${Math.round(pct * 100)}%）；超过 80% 回合结束后自动压缩`}>
      <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden>
        <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeOpacity=".18" strokeWidth="2.5" />
        <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 9 9)" />
      </svg>
      <span className="rc-ctx-num">{fmtTokens(tokens)}</span>
    </span>
  )
}

// ── 主组件 ──────────────────────────────────────────────────────

export interface ChatAttachment {
  key: string
  label: string
}

export function PiChat({ handle, placeholder = '描述要做的开发任务，例如：给 demo 项目加一个分页查询接口并实测…', contextPrefix, initialDraft, autoSendInitialDraft = false, attachments = [], mentionOptions = [], onAttach, onDetach, onPromptSent, onToolCompleted, onCheckpointCreated }: {
  handle: PiAgentHandle
  placeholder?: string
  /** 每次任务发送时附带的轻量资源引用，不含资源正文。 */
  contextPrefix?: string
  /** 宿主发起的任务建议（如迁移向导完成后）；默认只预填，可由显式确认的工作流自动发送。 */
  initialDraft?: string
  /** 仅用于已由用户在宿主明确确认的工作流（例如「导入并进入 Agent」）。 */
  autoSendInitialDraft?: boolean
  attachments?: ChatAttachment[]
  mentionOptions?: ChatAttachment[]
  onAttach?: (attachment: ChatAttachment) => void
  onDetach?: (key: string) => void
  /** 消息已固化当前 contextPrefix 后触发；宿主可据此清空一次性 @ 引用。 */
  onPromptSent?: () => void
  /** 资源写入类工具成功完成后通知宿主刷新自己的资源视图。 */
  onToolCompleted?: (toolName: string) => void
  /** Agent 回合结束且源码变更时，RC 已自动创建开发检查点。 */
  onCheckpointCreated?: (checkpoint: DevelopmentCheckpoint) => void
}): React.ReactElement {
  const agent = handle.agent
  const view = useChatView(agent)

  // agent.state.messages 在回合内是原地 push（数组引用不变），useMemo 只依赖
  // 引用不会重建；补 length 作为内容变更信号，流式期间配对数据才能跟上。
  const messageCount = view.messages.length
  // 结果配对：toolCallId → ToolResultMessage（工具块的状态与内容来源）
  const results = useMemo(() => {
    const m = new Map<string, ToolResultMessage>()
    for (const msg of view.messages) if (msg.role === 'toolResult') m.set(msg.toolCallId, msg)
    return m
  }, [view.messages, messageCount])
  // toolResult 已由其 assistant toolCall 内的 ToolBlock 渲染；只有确实找不到
  // 对应调用时才走下方的孤儿兜底，避免同一次工具执行出现一个正确块和一个 {} 块。
  const calledToolIds = useMemo(() => {
    const ids = new Set<string>()
    for (const msg of view.messages) {
      if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue
      for (const block of msg.content) if (block.type === 'toolCall') ids.add(block.id)
    }
    return ids
  }, [view.messages, messageCount])
  // 工具显示名：AgentTool 的 label 优先（与工具注册名一致时无差别）
  const toolLabels = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of agent.state.tools) m.set(t.name, t.label ?? t.name)
    return m
  }, [agent])

  useEffect(() => {
    if (!onToolCompleted) return
    return agent.subscribe((event) => {
      if (event.type === 'tool_execution_end' && !event.isError && RESOURCE_MUTATING_TOOLS.has(event.toolName)) {
        onToolCompleted(event.toolName)
      }
    })
  }, [agent, onToolCompleted])

  // 贴底滚动：用户上翻阅历史时不打扰，新内容到达时若原本贴底则继续贴底
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const threadRef = useRef<HTMLDivElement | null>(null)
  const stick = useRef(true)
  const onScroll = () => {
    const el = scrollRef.current
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }
  useLayoutEffect(() => {
    const el = scrollRef.current
    const thread = threadRef.current
    if (!el || !thread || !stick.current) return

    const scrollToBottom = () => {
      if (stick.current) el.scrollTop = el.scrollHeight
    }
    // 同步处理本次 React 渲染；再观察消息内容高度，覆盖流式增量、换行和图片
    // 等发生在首次滚动之后的布局变化。
    scrollToBottom()
    const observer = new ResizeObserver(scrollToBottom)
    observer.observe(thread)
    return () => observer.disconnect()
  }, [view])

  // 输入区：Enter 发送 / Shift+Enter 换行；运行中可停止
  const [draft, setDraft] = useState('')
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const receivedInitialDraft = useRef<string | undefined>(undefined)
  const autoSentInitialDraft = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!initialDraft || initialDraft === receivedInitialDraft.current) return
    receivedInitialDraft.current = initialDraft
    setDraft((current) => current.trim() ? current : initialDraft)
  }, [initialDraft])
  const autoSize = () => {
    const ta = taRef.current
    if (ta) { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 130)}px` }
  }
  const send = (provided?: string) => {
    const text = (provided ?? draft).trim()
    if (!text || view.busy) return
    setDraft('')
    requestAnimationFrame(autoSize)
    stick.current = true
    const message = contextPrefix ? `${contextPrefix}\n\n[任务]\n${text}` : text
    onPromptSent?.()
    void (async () => {
      // 先固化本回合基线；工具写入后才能准确得到“这轮改了什么”。
      let turnId: string | null = null
      try {
        turnId = await call<string>('versions:startAgentTurn', { project: handle.scope.project, sessionId: handle.sessionId, prompt: text })
      } catch (e) {
        // 版本历史失败不能阻断开发；控制台会在下次操作时继续尝试建立基线。
        console.warn('[checkpoint] 无法开始 Agent 回合：', (e as Error).message)
      }
      try {
        await agent.prompt(message)
      } finally {
        if (!turnId) return
        try {
          const checkpoint = await call<DevelopmentCheckpoint | null>('versions:finishAgentTurn', { turnId })
          if (checkpoint) onCheckpointCreated?.(checkpoint)
        } catch (e) {
          console.warn('[checkpoint] 无法完成 Agent 回合：', (e as Error).message)
        }
      }
    })()
  }
  useEffect(() => {
    if (!autoSendInitialDraft || !initialDraft || autoSentInitialDraft.current === initialDraft) return
    autoSentInitialDraft.current = initialDraft
    send(initialDraft)
    // `initialDraft` 只在迁移确认后由宿主写入一次；ref 防止渲染刷新重复提交。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSendInitialDraft, initialDraft])

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
        <div className="rc-thread" ref={threadRef}>
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
            if (m.role === 'toolResult' && !calledToolIds.has(m.toolCallId)) {
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
          <ContextGauge tokens={view.ctxTokens} windowTokens={handle.contextWindow} />
          {view.busy && <button className="btn sm" onClick={() => agent.abort()}><Icon n="stop" />停止</button>}
          <button className="btn sm pri" disabled={!draft.trim() || view.busy} onClick={() => send()}><Icon n="send" />发送</button>
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
  const tok = msg.usage.totalTokens ? `${fmtTokens(msg.usage.totalTokens)} tok` : ''
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
