import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { call } from '../api'
import type { AgentMode, ProjectPlatform } from '@shared/types'
import type { AgentPromptScenario } from '@shared/agentPrompt'

interface SkillReference { name: string; description: string; content: string }
interface Catalog { prompts: AgentPromptScenario[]; skills: SkillReference[] }

export default function AgentReferenceView(): React.ReactElement {
  const [catalog, setCatalog] = useState<Catalog>({ prompts: [], skills: [] })
  const [kind, setKind] = useState<'prompts' | 'skills'>('prompts')
  const [platform, setPlatform] = useState<ProjectPlatform>('desktop')
  const [mode, setMode] = useState<AgentMode>('development')
  const [skill, setSkill] = useState('page_interaction')
  const [error, setError] = useState('')

  useEffect(() => {
    void call<Catalog>('agent:referenceCatalog')
      .then((next) => { setCatalog(next); if (!next.skills.some((x) => x.name === skill) && next.skills[0]) setSkill(next.skills[0].name) })
      .catch((e) => setError((e as Error).message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const prompt = useMemo(() => catalog.prompts.find((item) => item.platform === platform && item.mode === mode), [catalog.prompts, platform, mode])
  const currentSkill = useMemo(() => catalog.skills.find((item) => item.name === skill), [catalog.skills, skill])

  return (
    <div className="page reference-page">
      <div className="page-head">
        <Icon n="file" /><b>Agent 规范</b>
        <span className="sub">只读查看各端型、工作模式的系统提示词与应用内置 Skill</span>
      </div>
      <div className="reference-tabs">
        <button className={kind === 'prompts' ? 'on' : ''} onClick={() => setKind('prompts')}>系统提示词</button>
        <button className={kind === 'skills' ? 'on' : ''} onClick={() => setKind('skills')}>内置 Skills</button>
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
    </div>
  )
}
