import React, { useEffect, useState } from 'react'
import { Icon } from './components/Icon'
import { call } from './api'
import type { StatusPayload } from '@shared/types'
import DashboardView from './views/DashboardView'
import WorkbenchView from './views/workbench'
import ConnectionsView from './views/ConnectionsView'
import AgentView from './views/AgentView'
import SettingsView from './views/SettingsView'

type ViewKey = 'dashboard' | 'workbench' | 'connections' | 'agent' | 'settings'

const ITEMS: Array<{ key: ViewKey; icon: string; label: string }> = [
  { key: 'dashboard', icon: 'dash', label: '总览' },
  { key: 'workbench', icon: 'folder', label: '项目' },
  { key: 'connections', icon: 'db', label: '连接' },
  { key: 'agent', icon: 'ai', label: 'Agent' },
  { key: 'settings', icon: 'set', label: '设置' }
]

const VALID_VIEWS: string[] = ['dashboard', 'workbench', 'connections', 'agent', 'settings', 'datasets', 'procedures', 'pages']

/** 支持以 #view 打开指定视图（如 #agent），供深链与冒烟验收使用；旧视图名映射到工作台 */
function initialView(): ViewKey {
  const h = window.location.hash.replace(/^#/, '')
  if (!VALID_VIEWS.includes(h)) return 'dashboard'
  if (['datasets', 'procedures', 'pages'].includes(h)) return 'workbench'
  return h as ViewKey
}

export default function App(): React.ReactElement {
  const [view, setView] = useState<ViewKey>(initialView)
  const [status, setStatus] = useState<StatusPayload | null>(null)

  const refreshStatus = async () => {
    try { setStatus(await call<StatusPayload>('status:get')) } catch { /* 总览页会展示错误 */ }
  }
  useEffect(() => {
    void refreshStatus()
    const t = setInterval(() => void refreshStatus(), 30000)
    return () => clearInterval(t)
  }, [view])

  return (
    <div className="app-frame">
      {/* 顶栏一体式导航（设计稿方向 A）：macOS 红绿灯区 + 品牌 + 五入口 + 环境迷你点 */}
      <nav className="navtop">
        <div className="lights" />
        <div className="brand"><b>Report&nbsp;Console</b><span>项目制工作台</span></div>
        <div className="entries">
          {ITEMS.map((it) => (
            <button key={it.key} className={`nentry${view === it.key ? ' on' : ''}`} onClick={() => setView(it.key)}>
              <Icon n={it.icon} /><span>{it.label}</span>
            </button>
          ))}
        </div>
        <div className="grow" />
        <div className="envmini" title="帆软 / 各连接 / reportlets 环境状态">
          <span>帆软 <i className={`dot ${status?.frReachable ? 'g' : 'r'}`} /></span>
          {(status?.connections ?? []).map((c) => (
            <span key={c.name} title={c.error ?? c.version ?? c.name}>{c.name} <i className={`dot ${c.reachable ? 'g' : 'r'}`} /></span>
          ))}
          <span>reportlets <i className={`dot ${status?.reportletsWritable ? 'g' : 'y'}`} /></span>
        </div>
      </nav>

      <div className="app-body">
        {view === 'dashboard' && <DashboardView onNavigate={(v) => setView(v as ViewKey)} />}
        {view === 'workbench' && <WorkbenchView />}
        {view === 'connections' && <ConnectionsView onChanged={refreshStatus} />}
        {view === 'agent' && <AgentView />}
        {view === 'settings' && <SettingsView onSaved={refreshStatus} />}
      </div>
    </div>
  )
}
