import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Tag, Typography } from 'antd'
import { RobotOutlined, PlusOutlined } from '@ant-design/icons'
import '@earendil-works/pi-web-ui'
import '@earendil-works/pi-web-ui/app.css'
import { createPiAgent, type PiAgentHandle } from '../agent/piAgent'
import type { ChatPanelElement } from '../pi-elements'

/**
 * pi Agent 工作台 — 官方 @earendil-works/pi-web-ui 组件（Lit，light DOM）。
 * Agent 实例在渲染层构建（工具经 IPC 桥回主进程执行），
 * ChatPanel.setAgent 注入后组件自行订阅事件流（含 streaming/tool 渲染）。
 * 会话持久化：IndexedDB（官方 SessionsStore），启动恢复最近会话、事件驱动自动保存。
 */
export default function AgentView() {
  const panelRef = useRef<ChatPanelElement | null>(null)
  const handleRef = useRef<PiAgentHandle | null>(null)
  const [status, setStatus] = useState<{ ready: boolean; mode?: 'real' | 'faux'; error?: string }>({ ready: false })

  const start = useCallback(async (fresh: boolean) => {
    setStatus({ ready: false })
    try {
      // 切换会话前终止旧 Agent 的运行
      const prev = handleRef.current
      if (prev) {
        prev.agent.abort()
        await prev.agent.waitForIdle().catch(() => undefined)
      }
      const handle = await createPiAgent(fresh)
      handleRef.current = handle
      await panelRef.current?.setAgent?.(handle.agent, {
        // Key 由 getApiKey（设置页配置）提供，不让组件弹 Key 输入框
        onApiKeyRequired: async () => true
      })
      setStatus({ ready: true, mode: handle.mode })
      console.log(`[pi] agent ready mode=${handle.mode} fresh=${fresh}`)
      // 冒烟自检：URL 带 autosend=1 时自动发一条消息，验证 Agent 循环 → 组件渲染全链路
      if (!fresh && new URLSearchParams(window.location.search).get('autosend') === '1') {
        console.log('[pi] autosend detected, prompting…')
        setTimeout(() => { void handle.agent.prompt('（冒烟自检）你好，请确认平台工具已加载。') }, 500)
      }
    } catch (e) {
      setStatus({ ready: false, error: (e as Error).message })
    }
  }, [])

  useEffect(() => { void start(false) }, [start])

  return (
    <div className="rc-pi-agent" style={{ padding: 20, height: 'calc(100vh - 40px)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <RobotOutlined />
        <Typography.Text strong>Agent 开发助手（pi 引擎）</Typography.Text>
        {status.mode === 'faux' && <Tag color="amber">Faux 演示模式（未配置 Key）</Tag>}
        {status.mode === 'real' && <Tag color="green">真实模型</Tag>}
        <Button size="small" icon={<PlusOutlined />} disabled={!status.ready} onClick={() => { void start(true) }}>
          新建会话
        </Button>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          平台动作=工具（主进程执行，质量门/审计内建）；会话自动保存（IndexedDB），重启恢复
        </Typography.Text>
      </div>

      {status.error && <Alert type="error" showIcon style={{ marginBottom: 10 }} message="pi Agent 初始化失败" description={status.error} />}
      {!status.ready && !status.error && <Alert type="info" showIcon style={{ marginBottom: 10 }} message="正在初始化 pi Agent（加载平台工具与会话）…" />}

      <pi-chat-panel ref={panelRef} style={{ flex: 1, minHeight: 0 }} />
    </div>
  )
}
