import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { call } from '../api'
import type { AgentMode, Project, ProjectPlatform } from '@shared/types'
import type { AgentPromptScenario } from '@shared/agentPrompt'

interface SkillReference { name: string; description: string; content: string }
interface Catalog { prompts: AgentPromptScenario[]; skills: SkillReference[] }

export default function AgentReferenceView(): React.ReactElement {
  const [catalog, setCatalog] = useState<Catalog>({ prompts: [], skills: [] })
  const [projects, setProjects] = useState<Project[]>([])
  const [project, setProject] = useState('')
  const [kind, setKind] = useState<'prompts' | 'skills'>('prompts')
  const [platform, setPlatform] = useState<ProjectPlatform>('desktop')
  const [mode, setMode] = useState<AgentMode>('development')
  const [skill, setSkill] = useState('page_interaction')
  const [error, setError] = useState('')

  useEffect(() => {
    void call<Project[]>('projects:list').then((items) => {
      setProjects(items)
      if (items[0]) { setProject(items[0].name); setPlatform(items[0].platform) }
    }).catch((e) => setError((e as Error).message))
  }, [])
  useEffect(() => {
    void call<Catalog>('agent:referenceCatalog', { project: project || '<当前项目>' })
      .then((next) => { setCatalog(next); if (!next.skills.some((x) => x.name === skill) && next.skills[0]) setSkill(next.skills[0].name) })
      .catch((e) => setError((e as Error).message))
  }, [project])

  const prompt = useMemo(() => catalog.prompts.find((item) => item.platform === platform && item.mode === mode), [catalog.prompts, platform, mode])
  const currentSkill = useMemo(() => catalog.skills.find((item) => item.name === skill), [catalog.skills, skill])

  return (
    <div className="page reference-page">
      <div className="page-head">
        <Icon n="file" /><b>Agent 规范</b>
        <span className="sub">只读查看各端型、工作模式的系统提示词与应用内置 Skill</span>
        <span className="grow" />
        <select value={project} onChange={(e) => {
          const value = e.target.value
          setProject(value)
          const selected = projects.find((item) => item.name === value)
          if (selected) setPlatform(selected.platform)
        }} aria-label="提示词示例项目">
          {!projects.length && <option value="">&lt;当前项目&gt;</option>}
          {projects.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
        </select>
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
          <div className="reference-title"><b>{prompt?.title ?? '系统提示词'}</b><span>运行时只替换当前项目与端型，不允许在此修改</span></div>
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
