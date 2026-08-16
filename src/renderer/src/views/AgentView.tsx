import React, { useEffect, useRef, useState } from 'react'
import { Alert, Tag, Typography } from 'antd'
import { RobotOutlined } from '@ant-design/icons'
import '@earendil-works/pi-web-ui'
import '@earendil-works/pi-web-ui/app.css'
import type { Agent } from '@earendil-works/pi-agent-core'
import { createPiAgent } from '../agent/piAgent'
import type { ChatPanelElement } from '../pi-elements'

/**
 * pi Agent 工作台 — 官方 @earendil-works/pi-web-ui 组件（Lit，light DOM）。
 * Agent 实例在渲染层构建（工具经 IPC 桥回主进程执行），
 * ChatPanel.setAgent 注入后组件自行订阅事件流（含 streaming/tool 渲染）。
 */
export default function AgentView() {
  const panelRef = useRef<ChatPanelElement | null>(null)
  const [status, setStatus] = useState<{ ready: boolean; mode?: 'real' | 'faux'; error?: string }>({ ready: false })

  useEffect(() => {
    let disposed = false
    void (async () => {
      try {
        const { agent, mode } = await createPiAgent()
        if (disposed) return
        await panelRef.current?.setAgent?.(agent, {
          onApiKeyRequired: async () => true
        })
        if (disposed) { agent.abort(); return }
        setStatus({ ready: true, mode })
        console.log(`[pi] agent ready mode=${mode}`)
        // 冒烟自检：URL 带 autosend=1 时自动发一条消息，验证 Agent 循环 → 组件渲染全链路
        if (new URLSearchParams(window.location.search).get('autosend') === '1') {
          console.log('[pi] autosend detected, prompting…')
          setTimeout(() => { void agent.prompt('（冒烟自检）你好，请确认平台工具已加载。') }, 500)
        }
      } catch (e) {
        if (!disposed) setStatus({ ready: false, error: (e as Error).message })
      }
    })()
    return () => { disposed = true }
  }, [])

  return (
    <div className="rc-pi-agent" style={{ padding: 20, height: 'calc(100vh - 40px)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <RobotOutlined />
        <Typography.Text strong>Agent 开发助手（pi 引擎）</Typography.Text>
        {status.mode === 'faux' && <Tag color="amber">Faux 演示模式（未配置 Key）</Tag>}
        {status.mode === 'real' && <Tag color="green">真实模型</Tag>}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          平台动作=工具（主进程执行，质量门/审计内建）；流式输出、工具调用、steering 由 pi harness 驱动
        </Typography.Text>
      </div>

      {status.error && <Alert type="error" showIcon style={{ marginBottom: 10 }} message="pi Agent 初始化失败" description={status.error} />}
      {!status.ready && !status.error && <Alert type="info" showIcon style={{ marginBottom: 10 }} message="正在初始化 pi Agent（加载平台工具定义）…" />}

      <pi-chat-panel ref={panelRef} style={{ flex: 1, minHeight: 0 }} />
    </div>
  )
}
