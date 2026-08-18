/**
 * pi Agent 工作台 — 自研聊天组件（订阅 Agent 事件流，见 agent/chat/PiChat）。
 * Agent 实例在渲染层构建（工具经 IPC 桥回主进程执行）。
 * 会话持久化：IndexedDB（自研存储层），启动恢复最近会话、事件驱动自动保存。
 * 实例按项目共享：工作台右栏与本页在同一项目内复用同一会话流，不跨项目串话。
 * 模型未配置时初始化直接失败，横幅提示并引导去「设置」页。
 */
import React, { useCallback, useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { getSharedPiAgent, resetSharedPiAgent, type PiAgentHandle } from '../agent/piAgent'
import { PiChat } from '../agent/chat/PiChat'
import { call } from '../api'
import type { Project } from '@shared/types'

export default function AgentView({ onNavigate }: { onNavigate?: (v: string) => void }): React.ReactElement {
  const [handle, setHandle] = useState<PiAgentHandle | null>(null)
  const [status, setStatus] = useState<{ error?: string; modelId?: string }>({})
  const [projects, setProjects] = useState<Project[]>([])
  const [project, setProject] = useState('')

  const start = useCallback(async (fresh: boolean) => {
    if (!project) return
    setHandle(null)
    setStatus({})
    try {
      const scope = { project }
      const h = fresh ? await resetSharedPiAgent(scope) : await getSharedPiAgent(scope)
      setHandle(h)
      setStatus({ modelId: h.modelId })
      // 冒烟自检：URL 带 autosend=1 时自动发一条消息，验证 Agent 循环 → 聊天渲染全链路
      if (!fresh && new URLSearchParams(window.location.search).get('autosend') === '1') {
        setTimeout(() => { void h.agent.prompt('（冒烟自检）你好，请确认平台工具已加载。') }, 500)
      }
    } catch (e) {
      setStatus({ error: (e as Error).message })
    }
  }, [project])

  useEffect(() => {
    void call<Project[]>('projects:list').then((ps) => {
      setProjects(ps)
      setProject((cur) => cur || ps[0]?.name || '')
    }).catch((e) => setStatus({ error: (e as Error).message }))
  }, [])
  useEffect(() => { if (project) void start(false) }, [project, start])

  return (
    <div className="page">
      <div className="page-head">
        <Icon n="ai" />
        <b>Agent 开发助手</b>
        <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Agent 当前项目">
          {!projects.length && <option value="">暂无项目</option>}
          {projects.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
        </select>
        {handle && status.modelId && (
          <span className="pill-o idle" title="模型在「设置」页配置（协议 / Base URL / 模型 / API Key）">
            <Icon n="ai" />{status.modelId}
          </span>
        )}
        <span className="sub">当前会话仅访问所选项目与其绑定连接 · 质量门/审计内建 · 会话按项目自动保存</span>
        <span className="grow" />
        <button className="btn sm" disabled={!handle} onClick={() => { void start(true) }}><Icon n="plus" />新建会话</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: '10px 12px 12px', display: 'flex' }}>
        {status.error && (
          <div className="banner err" style={{ margin: '12px 8px' }}>
            <Icon n="cx" />
            <div>
              <b>Agent 初始化失败</b><br />{status.error}
              {onNavigate && <div style={{ marginTop: 8 }}><button className="btn sm" onClick={() => onNavigate('settings')}><Icon n="set" />打开设置</button></div>}
            </div>
          </div>
        )}
        {!status.error && !handle && (
          <div className="banner info" style={{ margin: '12px 8px' }}><Icon n="info" /><div>正在初始化 pi Agent（加载平台工具与会话）…</div></div>
        )}
        {handle && <PiChat key={handle.sessionId} handle={handle} />}
      </div>
    </div>
  )
}
