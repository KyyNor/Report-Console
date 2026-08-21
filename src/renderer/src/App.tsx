import React, { useState } from 'react'
import { Icon } from './components/Icon'
import DashboardView from './views/DashboardView'
import WorkbenchView from './views/workbench'
import ConnectionsView from './views/ConnectionsView'
import AgentView from './views/AgentView'
import SettingsView from './views/SettingsView'
import AgentReferenceView from './views/AgentReferenceView'

type ViewKey = 'dashboard' | 'workbench' | 'connections' | 'agent' | 'reference' | 'settings'

const ITEMS: Array<{ key: ViewKey; icon: string; label: string }> = [
  { key: 'dashboard', icon: 'dash', label: '总览' },
  { key: 'workbench', icon: 'folder', label: '项目' },
  { key: 'connections', icon: 'db', label: '连接' },
  { key: 'agent', icon: 'ai', label: 'Agent' },
  { key: 'reference', icon: 'file', label: '规范' },
  { key: 'settings', icon: 'set', label: '设置' }
]

const VALID_VIEWS: string[] = ['dashboard', 'workbench', 'connections', 'agent', 'reference', 'settings', 'datasets', 'procedures', 'pages']

/** 支持以 #view 打开指定视图（如 #agent），供深链与冒烟验收使用；旧视图名映射到工作台 */
function initialView(): ViewKey {
  const h = window.location.hash.replace(/^#/, '')
  if (!VALID_VIEWS.includes(h)) return 'dashboard'
  if (['datasets', 'procedures', 'pages'].includes(h)) return 'workbench'
  return h as ViewKey
}

export default function App(): React.ReactElement {
  const [view, setView] = useState<ViewKey>(initialView)
  const [settingsRevision, setSettingsRevision] = useState(0)

  return (
    <div className="app-frame">
      {/* 顶栏一体式导航：macOS 红绿灯区 + 品牌 + 五入口（环境状态只在总览页展示） */}
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
      </nav>

      <div className="app-body">
        {view === 'dashboard' && <DashboardView onNavigate={(v) => setView(v as ViewKey)} />}
        {/* 工作台常驻（隐藏不卸载）：切到其他视图再回来，项目选择、资源选中与 Agent 草稿都保留 */}
        <div className={`view-holder${view === 'workbench' ? ' on' : ''}`}><WorkbenchView settingsRevision={settingsRevision} /></div>
        {view === 'connections' && <ConnectionsView />}
        {view === 'agent' && <AgentView onNavigate={(v) => setView(v as ViewKey)} />}
        {view === 'reference' && <AgentReferenceView />}
        {view === 'settings' && <SettingsView onSaved={() => setSettingsRevision((revision) => revision + 1)} />}
      </div>
    </div>
  )
}
