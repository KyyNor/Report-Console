import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { call } from '../api'
import type { AgentMode, ProjectPlatform } from '@shared/types'
import type { AgentPromptScenario } from '@shared/agentPrompt'

interface SkillReference { name: string; description: string; content: string }
interface ToolReference { name: string; description: string; group: string; modes: string[]; parameters: Record<string, unknown> }
interface Catalog { prompts: AgentPromptScenario[]; skills: SkillReference[]; tools: ToolReference[] }

/** 模式可用性徽标：讨论模式白名单内 = 开发+讨论，否则仅开发。 */
function ModeChip({ modes }: { modes: string[] }): React.ReactElement {
  const both = modes.includes('discussion')
  return <span className={`ref-mode${both ? ' both' : ''}`}>{both ? '开发 + 讨论' : '仅开发'}</span>
}

export default function AgentReferenceView(): React.ReactElement {
  const [catalog, setCatalog] = useState<Catalog>({ prompts: [], skills: [], tools: [] })
  const [kind, setKind] = useState<'prompts' | 'skills' | 'tools'>('prompts')
  const [platform, setPlatform] = useState<ProjectPlatform>('desktop')
  const [mode, setMode] = useState<AgentMode>('development')
  const [skill, setSkill] = useState('page_interaction')
  const [tool, setTool] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    void call<Catalog>('agent:referenceCatalog')
      .then((next) => {
        setCatalog(next)
        if (!next.skills.some((x) => x.name === skill) && next.skills[0]) setSkill(next.skills[0].name)
        if (!next.tools.some((x) => x.name === tool) && next.tools[0]) setTool(next.tools[0].name)
      })
      .catch((e) => setError((e as Error).message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const prompt = useMemo(() => catalog.prompts.find((item) => item.platform === platform && item.mode === mode), [catalog.prompts, platform, mode])
  const currentSkill = useMemo(() => catalog.skills.find((item) => item.name === skill), [catalog.skills, skill])
  const currentTool = useMemo(() => catalog.tools.find((item) => item.name === tool), [catalog.tools, tool])
  /** 分组保持主进程 TOOL_GROUPS 的先现次序；同组内保持注册顺序。 */
  const toolGroups = useMemo(() => {
    const order: string[] = []
    const map = new Map<string, ToolReference[]>()
    for (const item of catalog.tools) {
      if (!map.has(item.group)) { map.set(item.group, []); order.push(item.group) }
      map.get(item.group)!.push(item)
    }
    return order.map((label) => ({ label, tools: map.get(label)! }))
  }, [catalog.tools])

  return (
    <div className="page reference-page">
      <div className="page-head">
        <Icon n="file" /><b>Agent 规范</b>
        <span className="sub">只读查看各端型、工作模式的系统提示词与应用内置 Skill</span>
      </div>
      <div className="reference-tabs">
        <button className={kind === 'prompts' ? 'on' : ''} onClick={() => setKind('prompts')}>系统提示词</button>
        <button className={kind === 'skills' ? 'on' : ''} onClick={() => setKind('skills')}>内置 Skills</button>
        <button className={kind === 'tools' ? 'on' : ''} onClick={() => setKind('tools')}>平台工具</button>
      </div>
      {error && <div className="banner err" style={{ margin: 16 }}><Icon n="cx" /><div>{error}</div></div>}
      {!error && kind === 'prompts' && <div className="reference-layout">
        <aside className="reference-side">
          <label>目标端</label>
          {(['desktop', 'mobile', 'dual'] as ProjectPlatform[]).map((value) => <button key={value} className={platform === value ? 'on' : ''} onClick={() => setPlatform(value)}>{value === 'desktop' ? '桌面端' : value === 'mobile' ? '移动端' : '双端'}</button>)}
          <label>工作模式</label>
          {(['development', 'discussion'] as AgentMode[]).map((value) => <button key={value} className={mode === value ? 'on' : ''} onClick={() => setMode(value)}>{value === 'development' ? '开发模式' : '讨论需求模式'}</button>)}
        </aside>
        <main className="reference-content">
          <div className="reference-title"><b>{prompt?.title ?? '系统提示词'}</b><span>{'{{project}}'} 占位符在会话启动时替换为实际项目名；本页只读</span></div>
          <pre>{prompt?.content ?? '加载中…'}</pre>
        </main>
      </div>}
      {!error && kind === 'skills' && <div className="reference-layout">
        <aside className="reference-side skill-list">
          {catalog.skills.map((item) => <button key={item.name} className={skill === item.name ? 'on' : ''} onClick={() => setSkill(item.name)}><b>{item.name}</b><span>{item.description}</span></button>)}
        </aside>
        <main className="reference-content">
          <div className="reference-title"><b>{currentSkill?.name ?? 'Skill'}</b><span>{currentSkill?.description}</span></div>
          <pre>{currentSkill?.content ?? '加载中…'}</pre>
        </main>
      </div>}
      {!error && kind === 'tools' && <div className="reference-layout">
        <aside className="reference-side skill-list tool-list">
          {toolGroups.map((group) => <React.Fragment key={group.label}>
            <label>{group.label}</label>
            {group.tools.map((item) => <button key={item.name} className={tool === item.name ? 'on' : ''} onClick={() => setTool(item.name)}>
              <b>{item.name}</b>
              <span className="ref-mode-row"><ModeChip modes={item.modes} /></span>
            </button>)}
          </React.Fragment>)}
        </aside>
        <main className="reference-content">
          <div className="reference-title"><b>{currentTool?.name ?? '工具'}</b><ModeChip modes={currentTool?.modes ?? []} /></div>
          <div className="ref-tool-desc">{currentTool?.description ?? ''}</div>
          <pre>{currentTool ? JSON.stringify(currentTool.parameters, null, 2) : '加载中…'}</pre>
        </main>
      </div>}
    </div>
  )
}
