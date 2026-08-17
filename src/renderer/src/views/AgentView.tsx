/**
 * pi Agent 工作台 — 自研聊天组件（订阅 Agent 事件流，见 agent/chat/PiChat）。
 * Agent 实例在渲染层构建（工具经 IPC 桥回主进程执行）。
 * 会话持久化：IndexedDB（自研存储层），启动恢复最近会话、事件驱动自动保存。
 * 实例为全局共享单例：工作台右栏的「用 Agent 做」与本页复用同一会话流。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { getSharedPiAgent, resetSharedPiAgent, type PiAgentHandle } from '../agent/piAgent'
import { PiChat } from '../agent/chat/PiChat'

export default function AgentView(): React.ReactElement {
  const handleRef = useRef<PiAgentHandle | null>(null)
  const [handle, setHandle] = useState<PiAgentHandle | null>(null)
  const [status, setStatus] = useState<{ mode?: 'real' | 'faux'; error?: string; modelId?: string }>({})

  const start = useCallback(async (fresh: boolean) => {
    setHandle(null)
    setStatus({})
    try {
      const prev = handleRef.current
      if (prev) {
        prev.agent.abort()
        await prev.agent.waitForIdle().catch(() => undefined)
      }
      const h = fresh ? await resetSharedPiAgent() : await getSharedPiAgent()
      handleRef.current = h
      setHandle(h)
      setStatus({ mode: h.mode, modelId: h.modelId })
      // 冒烟自检：URL 带 autosend=1 时自动发一条消息，验证 Agent 循环 → 聊天渲染全链路
      if (!fresh && new URLSearchParams(window.location.search).get('autosend') === '1') {
        setTimeout(() => { void h.agent.prompt('（冒烟自检）你好，请确认平台工具已加载。') }, 500)
      }
    } catch (e) {
      setStatus({ error: (e as Error).message })
    }
  }, [])

  useEffect(() => { void start(false) }, [start])

  return (
    <div className="page">
      <div className="page-head">
        <Icon n="ai" />
        <b>Agent 开发助手</b>
        {status.mode === 'faux' && <span className="tag upd">Faux 演示模式（未配置 Key）</span>}
        {status.mode === 'real' && <span className="tag dict">真实模型</span>}
        {handle && status.modelId && (
          <span className="pill-o idle" title="模型在「设置」页配置（协议 / Base URL / 模型 / API Key）">
            <Icon n="ai" />{status.modelId}
          </span>
        )}
        <span className="sub">平台动作=工具（主进程执行，质量门/审计内建）· 会话自动保存（IndexedDB），重启恢复 · 与工作台共享会话</span>
        <span className="grow" />
        <button className="btn sm" disabled={!handle} onClick={() => { void start(true) }}><Icon n="plus" />新建会话</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: '10px 12px 12px', display: 'flex' }}>
        {status.error
          ? <div className="banner err" style={{ margin: '12px 8px' }}><Icon n="cx" /><div><b>pi Agent 初始化失败</b><br />{status.error}</div></div>
          : !handle
            ? <div className="banner info" style={{ margin: '12px 8px' }}><Icon n="info" /><div>正在初始化 pi Agent（加载平台工具与会话）…</div></div>
            : null}
        {handle && <PiChat handle={handle} />}
      </div>
    </div>
  )
}
