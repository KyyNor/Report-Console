import React, { useEffect, useRef, useState } from 'react'
import {
  Card, Button, Input, Space, Typography, Tag, App as AntApp, List, Empty, Spin,
  Collapse, Badge, Tooltip, Popconfirm
} from 'antd'
import { SendOutlined, StopOutlined, PlusOutlined, DeleteOutlined, RobotOutlined } from '@ant-design/icons'
import { call } from '../api'
import type { AgentEvent, AgentMessage } from '@shared/types'
import { JsonView } from '../components/CodeEditor'

interface StreamItem {
  kind: 'text' | 'tool'
  text?: string
  tool?: string
  args?: unknown
  result?: unknown
  done?: boolean
}

interface LiveTurn {
  items: StreamItem[]
  finished: boolean
  error?: string
}

export default function AgentView() {
  const { message } = AntApp.useApp()
  const [sessions, setSessions] = useState<Array<{ id: number; title: string; createdAt: string; messageCount: number }>>([])
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [history, setHistory] = useState<AgentMessage[]>([])
  const [input, setInput] = useState('')
  const [live, setLive] = useState<LiveTurn | null>(null)
  const streamRef = useRef<HTMLDivElement>(null)
  const unlistenRef = useRef<(() => void) | null>(null)

  const refreshSessions = async () => {
    const s = await call<typeof sessions>('agent:sessions')
    setSessions(s)
    if (!sessionId && s.length > 0) setSessionId(s[0].id)
  }

  const loadMessages = async (id: number) => {
    setHistory(await call<AgentMessage[]>('agent:messages', { sessionId: id }))
  }

  useEffect(() => { void refreshSessions() }, [])
  useEffect(() => { if (sessionId) void loadMessages(sessionId) }, [sessionId])

  // 订阅事件流
  useEffect(() => {
    unlistenRef.current = window.api.onAgentEvent((evRaw) => {
      const ev = evRaw as AgentEvent
      setLive((prev): LiveTurn => {
        const cur: LiveTurn = prev ?? { items: [], finished: false }
        switch (ev.type) {
          case 'text-delta': {
            const items = [...cur.items]
            const last = items[items.length - 1]
            if (last && last.kind === 'text') {
              items[items.length - 1] = { ...last, text: (last.text ?? '') + ev.text }
            } else {
              items.push({ kind: 'text', text: ev.text })
            }
            return { ...cur, items }
          }
          case 'tool-call': {
            const items = [...cur.items, { kind: 'tool' as const, tool: ev.tool, args: ev.args }]
            return { ...cur, items }
          }
          case 'tool-result': {
            const items = [...cur.items]
            for (let i = items.length - 1; i >= 0; i--) {
              if (items[i].kind === 'tool' && items[i].tool === ev.tool && items[i].result === undefined) {
                items[i] = { ...items[i], result: ev.result, done: true }
                break
              }
            }
            return { ...cur, items }
          }
          case 'finish':
            return { ...cur, finished: true }
          case 'error':
            return { ...cur, finished: true, error: ev.message }
          default:
            return cur
        }
      })
      // 工具结果到达时轻提示
      if (ev.type === 'error') message.error(ev.message)
    })
    return () => { unlistenRef.current?.() }
  }, [])

  // 滚动跟随
  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight })
  }, [live, history])

  const send = async () => {
    if (!input.trim()) return
    if (!sessionId) {
      const s = await call<{ id: number }>('agent:createSession', { title: input.slice(0, 40) })
      setSessionId(s.id)
      await refreshSessions()
      await call('agent:send', { sessionId: s.id, text: input })
    } else {
      await call('agent:send', { sessionId, text: input })
    }
    setInput('')
    setLive({ items: [], finished: false })
  }

  const onFinished = () => {
    // finish/error 事件后延迟刷新历史
    setTimeout(() => {
      if (sessionId) void loadMessages(sessionId)
      void refreshSessions()
    }, 300)
  }

  // live 结束时刷新
  useEffect(() => { if (live?.finished) onFinished() }, [live?.finished])

  const stop = async () => {
    await call('agent:stop')
    message.info('已请求中断')
  }

  const busy = !!live && !live.finished

  return (
    <div style={{ padding: 20, height: 'calc(100vh - 40px)', display: 'flex', gap: 12 }}>
      {/* 会话列表 */}
      <Card size="small" style={{ width: 250, overflow: 'auto' }} title="会话"
        extra={<Button size="small" icon={<PlusOutlined />} onClick={async () => { const s = await call<{ id: number }>('agent:createSession'); await refreshSessions(); setSessionId(s.id); setHistory([]); setLive(null) }} />}>
        <List
          size="small" dataSource={sessions} rowKey="id"
          renderItem={(s) => (
            <List.Item
              style={{ cursor: 'pointer', padding: '6px 8px', background: s.id === sessionId ? '#e6f4ff' : undefined, borderRadius: 6 }}
              onClick={() => { setSessionId(s.id); setLive(null) }}
              actions={[
                <Popconfirm key="del" title="删除会话？" onConfirm={async (e) => { e?.stopPropagation(); await call('agent:deleteSession', { id: s.id }); if (sessionId === s.id) setSessionId(null); void refreshSessions() }}>
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} />
                </Popconfirm>
              ]}
            >
              <Typography.Text ellipsis style={{ maxWidth: 120 }} title={s.title}>{s.title}</Typography.Text>
            </List.Item>
          )}
          locale={{ emptyText: <Empty description="无会话" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        />
      </Card>

      {/* 消息区 */}
      <Card size="small" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        title={<Space><RobotOutlined />Agent 开发助手<Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>接口/表/页面均可让它代劳，动作=平台工具，质量门内建</Typography.Text></Space>}>
        <div ref={streamRef} className="agent-stream" style={{ flex: 1, paddingRight: 8 }}>
          {history.length === 0 && !live && <Empty description="向 Agent 描述需求，例如：给 frdemo 模块加一个按状态过滤的接口并实测" style={{ marginTop: 80 }} />}
          {history.map((m) => (
            <MessageBubble key={m.id} role={m.role} content={m.content} toolJson={m.toolJson} />
          ))}
          {live && (
            <div>
              {live.items.map((it, i) =>
                it.kind === 'text'
                  ? <AssistantText key={i} text={it.text ?? ''} />
                  : <ToolCard key={i} tool={it.tool ?? ''} args={it.args} result={it.result} done={it.done} />
              )}
              {live.error && <Typography.Paragraph type="danger" style={{ fontSize: 12 }}>⚠ {live.error}</Typography.Paragraph>}
              {!live.finished && <div style={{ padding: '4px 0' }}><Spin size="small" /> <Typography.Text type="secondary" style={{ fontSize: 12 }}>思考/执行中…</Typography.Text></div>}
            </div>
          )}
        </div>
        <div style={{ paddingTop: 10, borderTop: '1px solid #f0f0f0' }}>
          <Space.Compact style={{ width: '100%' }}>
            <Input.TextArea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); void send() } }}
              placeholder="描述任务（Enter 发送 / Shift+Enter 换行）"
              autoSize={{ minRows: 1, maxRows: 4 }}
              disabled={busy}
            />
            {busy
              ? <Button danger icon={<StopOutlined />} onClick={stop} style={{ height: 'auto' }}>停止</Button>
              : <Button type="primary" icon={<SendOutlined />} onClick={send} style={{ height: 'auto' }}>发送</Button>}
          </Space.Compact>
        </div>
      </Card>
    </div>
  )
}

function MessageBubble({ role, content, toolJson }: { role: string; content: string; toolJson?: string | null }) {
  if (role === 'user') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '8px 0' }}>
        <div style={{ background: '#1677ff', color: '#fff', padding: '6px 12px', borderRadius: 10, maxWidth: '78%', whiteSpace: 'pre-wrap' }}>
          {content}
        </div>
      </div>
    )
  }
  return (
    <div style={{ margin: '8px 0' }}>
      {content !== '(无文本输出)' && <AssistantText text={content} />}
      {toolJson && (
        <Collapse size="small" ghost items={[{
          key: 't',
          label: <Typography.Text type="secondary" style={{ fontSize: 12 }}>🔧 本轮工具调用（点击展开）</Typography.Text>,
          children: <ToolHistory json={toolJson} />
        }]} />
      )}
    </div>
  )
}

function ToolHistory({ json }: { json: string }) {
  try {
    const calls = JSON.parse(json) as Array<{ tool: string; args: unknown; result: unknown }>
    return <>{calls.map((c, i) => <ToolCard key={i} tool={c.tool} args={c.args} result={c.result} done />)}</>
  } catch {
    return null
  }
}

function AssistantText({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', margin: '8px 0' }}>
      <div style={{ background: '#fff', border: '1px solid #f0f0f0', padding: '6px 12px', borderRadius: 10, maxWidth: '86%', whiteSpace: 'pre-wrap', fontSize: 13 }}>
        {text}
      </div>
    </div>
  )
}

function ToolCard({ tool, args, result, done }: { tool: string; args: unknown; result?: unknown; done?: boolean }) {
  return (
    <Collapse
      size="small" className="tool-card" style={{ background: '#fff' }}
      items={[{
        key: 'x',
        label: (
          <Space>
            <Badge status={done ? 'success' : 'processing'} />
            <Typography.Text code style={{ fontSize: 12 }}>{tool}</Typography.Text>
            {!done && <Typography.Text type="secondary" style={{ fontSize: 11 }}>执行中</Typography.Text>}
          </Space>
        ),
        children: (
          <>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>入参</Typography.Text>
            <JsonView data={args} />
            {result !== undefined && (
              <>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>结果</Typography.Text>
                <JsonView data={result} />
              </>
            )}
          </>
        )
      }]}
    />
  )
}
