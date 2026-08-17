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
  { key: 'workbench', icon: 'folder', label: '项目（工作台）' },
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
      <header className="titlebar">
        {/* macOS 红绿灯由 trafficLightPosition 停在此区；Windows/Linux 用系统 overlay */}
        <div className="lights" />
        <span className="tb-title">Report Console</span>
        <span className="tb-sub">{ITEMS.find((i) => i.key === view)?.label ?? ''}</span>
        <div className="tb-right">
          <span className="tb-chip"><span className={`dot ${status?.frReachable ? 'g' : 'r'}`} />帆软 {status?.frLatencyMs !== undefined ? `${status.frLatencyMs}ms` : '…'}</span>
          {(status?.connections ?? []).slice(0, 3).map((c) => (
            <span key={c.name} className="tb-chip"><span className={`dot ${c.reachable ? 'g' : 'r'}`} />{c.name}{c.reachable && c.latencyMs !== undefined ? ` ${c.latencyMs}ms` : !c.reachable ? ' 不可达' : ''}</span>
          ))}
        </div>
      </header>

      <div className="app-body">
        <nav className="rail">
          <div className="logo"><Icon n="box" /></div>
          {ITEMS.map((it) => (
            <button key={it.key} className={`rail-it${view === it.key ? ' on' : ''}`} onClick={() => setView(it.key)}>
              <Icon n={it.icon} />
              <span className="tip">{it.label}<small>⌘{ITEMS.findIndex((x) => x.key === it.key) + 1}</small></span>
            </button>
          ))}
          <span className="spring" />
        </nav>

        {view === 'dashboard' && <DashboardView onNavigate={(v) => setView(v as ViewKey)} />}
        {view === 'workbench' && <WorkbenchView />}
        {view === 'connections' && <ConnectionsView onChanged={refreshStatus} />}
        {view === 'agent' && <AgentView />}
        {view === 'settings' && <SettingsView onSaved={refreshStatus} />}
      </div>
    </div>
  )
}
