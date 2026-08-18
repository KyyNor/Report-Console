/**
 * 工作台右栏 — 资源操作面板（接口/过程/页面/文档四类 + 项目面板 + 内嵌 Agent）
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { CodeBlk, fmtBytes, fmtTime, mdToHtml } from '../../components/ui'
import { JsxEditor, SqlEditor, MdEditor } from '../../components/CodeEditor'
import { getSharedPiAgent, resetSharedPiAgent, type PiAgentHandle } from '../../agent/piAgent'
import { PiChat, type ChatAttachment } from '../../agent/chat/PiChat'
import { call } from '../../api'
import type { Project, Dataset, DatasetStatus, ProcRecord, PageMeta, DocMeta, TraditionalCptMeta, ConnectionHealth, BuildResult, CheckerFinding, DevelopmentCheckpoint, CheckpointDiff, CheckpointFileDiff } from '@shared/types'
import { buildUnifiedLineDiff } from '@shared/textDiff'

export interface WBData {
  datasets: Dataset[]
  statuses: Record<string, DatasetStatus>
  procs: ProcRecord[]
  pages: PageMeta[]
  docs: DocMeta[]
  traditionalCpts: TraditionalCptMeta[]
}

export interface WBActs {
  verify: () => Promise<void>
  editDataset: (ds: Dataset) => void
  deleteDataset: (name: string) => Promise<void>
  buildData: () => Promise<BuildResult | null>
  testDataset: (name: string) => Promise<{ ok: boolean; errCode: number | null; durationMs: number; rowCount: number; response: unknown } | null>
  savePage: (page: string, content: string) => Promise<void>
  buildPage: (page: string) => Promise<BuildResult | null>
  openPage: (page: string) => Promise<void>
  deletePage: (page: string) => Promise<void>
  createPage: (page: string, starter: string) => Promise<void>
  saveProcDef: (rec: ProcRecord, def: string) => Promise<void>
  applyProc: (rec: ProcRecord) => void
  callProc: (rec: ProcRecord) => void
  unlinkProc: (rec: ProcRecord) => Promise<void>
  deleteProc: (name: string) => Promise<void>
  saveDoc: (name: string, content: string) => Promise<void>
  deleteDoc: (name: string) => Promise<void>
  openProjectSettings: () => void
  deleteProject: () => void
  useAgent: (resource?: string) => void
}

export interface SelCtx { project: Project | null; sel: string | null; tab: Record<string, string>; setTab: (k: string, t: string) => void }

import { KIND_TAG } from './kinds'

function TabsBar({ tabs, cur, onSelect }: { tabs: Array<{ k: string; n: string; bdg?: string }>; cur: string; onSelect: (k: string) => void }): React.ReactElement {
  return (
    <div className="rp-tabs">
      {tabs.map((t) => (
        <button key={t.k} className={`rtab${cur === t.k ? ' on' : ''}`} onClick={() => onSelect(t.k)}>
          {t.n}{t.bdg ? <span className="bdg">{t.bdg}</span> : null}
        </button>
      ))}
    </div>
  )
}

function Findings({ findings }: { findings: CheckerFinding[] }): React.ReactElement {
  const errs = findings.filter((f) => f.severity === 'error')
  const warns = findings.filter((f) => f.severity === 'warning')
  if (!findings.length) return <div style={{ fontSize: 11.5, color: 'var(--faint)', padding: '6px 2px' }}>本次没有 findings。</div>
  return (
    <>
      {errs.map((f, i) => (
        <div key={`e${i}`} className="finding sev-e">
          <span className="fx"><Icon n="cx" /></span>
          <div><div className="fcode">{f.rule}</div><div className="fmsg">{f.message}</div>{f.line ? <div className="floc">行 {f.line}</div> : null}</div>
        </div>
      ))}
      {warns.map((f, i) => (
        <div key={`w${i}`} className="finding sev-w">
          <span className="fx"><Icon n="alert" /></span>
          <div><div className="fcode">{f.rule}</div><div className="fmsg">{f.message}</div>{f.line ? <div className="floc">行 {f.line}</div> : null}</div>
        </div>
      ))}
    </>
  )
}

function connChip(c: string): React.ReactElement {
  return <span className="cbadge"><Icon n="db" />{c}</span>
}

// ── 主入口 ──────────────────────────────────────────────────────

export default function RightPanel({ ctx, data, acts, agentMode, agentCtx, onExitAgent, onShowVersions, onResourcesChanged }: {
  ctx: SelCtx
  data: WBData
  acts: WBActs
  agentMode: boolean
  agentCtx: { project: string; resource?: string } | null
  onExitAgent: () => void
  onShowVersions: () => void
  onResourcesChanged?: () => void
}): React.ReactElement {
  // 项目切换必须卸载旧会话面板：附件、输入草稿和聊天快照都不能跨项目保留。
  if (agentMode) return <AgentPanel key={ctx.project?.name ?? '__none__'} ctx={agentCtx} project={ctx.project} data={data} onProjectSettings={acts.openProjectSettings} onShowVersions={onShowVersions} onResourcesChanged={onResourcesChanged} />
  const { sel } = ctx
  const r = sel ? sel : null
  if (!r) return <ProjectPanel ctx={ctx} data={data} acts={acts} onResourcesChanged={onResourcesChanged} />
  if (r.startsWith('if:')) {
    const ds = data.datasets.find((x) => x.name === r.slice(3))
    return ds ? <DetailShell onClose={onExitAgent}><IfPanel key={r} ctx={ctx} ds={ds} st={data.statuses[ds.name]} acts={acts} /></DetailShell> : <ProjectPanel ctx={ctx} data={data} acts={acts} onResourcesChanged={onResourcesChanged} />
  }
  if (r.startsWith('sp:')) {
    const sp = data.procs.find((x) => x.name === r.slice(3))
    return sp ? <DetailShell onClose={onExitAgent}><SpPanel key={r} ctx={ctx} sp={sp} acts={acts} /></DetailShell> : <ProjectPanel ctx={ctx} data={data} acts={acts} onResourcesChanged={onResourcesChanged} />
  }
  if (r.startsWith('pg:')) {
    const pg = data.pages.find((x) => x.name === r.slice(3))
    return pg ? <DetailShell onClose={onExitAgent}><PgPanel key={r} ctx={ctx} pg={pg} acts={acts} /></DetailShell> : <ProjectPanel ctx={ctx} data={data} acts={acts} onResourcesChanged={onResourcesChanged} />
  }
  if (r.startsWith('doc:')) {
    const doc = data.docs.find((x) => x.name === r.slice(4))
    return doc ? <DetailShell onClose={onExitAgent}><DocPanel key={r} ctx={ctx} doc={doc} acts={acts} /></DetailShell> : <ProjectPanel ctx={ctx} data={data} acts={acts} onResourcesChanged={onResourcesChanged} />
  }
  return <ProjectPanel ctx={ctx} data={data} acts={acts} onResourcesChanged={onResourcesChanged} />
}

function DetailShell({ children, onClose }: { children: React.ReactElement; onClose: () => void }): React.ReactElement {
  return <div className="rp-detail"><button className="iconbtn rp-detail-close" title="关闭详情并回到 Agent" onClick={onClose}><Icon n="x" /></button>{children}</div>
}

// ── 项目面板（未选资源 / 空项目） ───────────────────────────────

function ProjectPanel({ ctx, data, acts, onResourcesChanged }: { ctx: SelCtx; data: WBData; acts: WBActs; onResourcesChanged?: () => void }): React.ReactElement {
  const p = ctx.project
  const [dyn, setDyn] = useState<Array<{ i: string; h: React.ReactNode; m: string }>>([])
  useEffect(() => {
    if (!p) return
    void (async () => {
      try {
        const [builds, tests] = await Promise.all([
          call<Array<Record<string, unknown>>>('history:builds', { limit: 40 }),
          call<Array<Record<string, unknown>>>('history:apiTests', { limit: 40, projectId: p.id })
        ])
        const items = [
          ...builds.slice(0, 5).map((b) => ({ i: 'box', h: <><b>构建{b.ok ? '通过' : '失败'}</b>　{String(b.target)}</>, m: fmtTime(String(b.created_at)) })),
          ...tests.slice(0, 5).map((t) => ({ i: t.ok ? 'cck' : 'cx', h: <><b>实测 {String(t.dataset)}</b>　{t.ok ? '通过' : '失败'}</>, m: fmtTime(String(t.created_at)) }))
        ].sort(() => 0).slice(0, 8)
        setDyn(items)
      } catch { /* 忽略 */ }
    })()
  }, [p, data])
  if (!p) return <div className="rp"><div className="rp-body"><div className="nores">未选择项目</div></div></div>
  const c = p.counts
  const empty = c.ifs + c.sps + c.pgs + c.docs === 0
  const key = `project:${p.name}`
  const tab = ctx.tab[key] ?? 'ov'
  return (
    <div className="rp">
      <div className="rp-head">
        <div className="rp-r1"><span className="ttl reg">{p.name}</span></div>
        <div className="rp-r2">
          {p.connections.map((cn) => connChip(cn))}
          <span style={{ font: '10.5px/1 var(--mono)', color: 'var(--faint)' }}>创建于 {p.createdAt.slice(0, 10)}{p.comment ? ` · ${p.comment}` : ''}</span>
        </div>
        <div className="rp-acts">
          <button className="btn" onClick={() => void acts.verify()} disabled={empty} title="构建 + 实测项目内全部接口"><Icon n="shield" />一键验收</button>
          <button className="btn pri" onClick={() => acts.useAgent()}><Icon n="ai" />{empty ? '让 Agent 从需求开始' : '返回 Agent'}</button>
          <button className="iconbtn" title="项目设置" onClick={acts.openProjectSettings}><Icon n="set" /></button>
          <button className="iconbtn" title="删除项目（需确认）" onClick={acts.deleteProject}><Icon n="trash" /></button>
        </div>
      </div>
      <TabsBar tabs={[{ k: 'ov', n: '总览' }, { k: 'versions', n: '版本' }]} cur={tab} onSelect={(next) => ctx.setTab(key, next)} />
      <div className="rp-body">
        {tab === 'versions' && <VersionPanel project={p} onRestored={onResourcesChanged} />}
        {tab === 'ov' && <>
        <div className="blk">
          <div className="blk-t"><Icon n="folder" />项目信息</div>
          <div className="kv">
            <span className="k2">绑定目录</span><span className="v2">{p.missingDir ? <span style={{ color: 'var(--warn)' }}>{p.dir}（缺失）</span> : p.dir}</span>
            <span className="k2">受管布局</span><span className="v2">由 project.yaml 声明；data/、pages/ 仅为新建项目默认目录</span>
            <span className="k2">资源规模</span><span className="v2">接口 {c.ifs} · 过程 {c.sps} · 页面 {c.pgs} · 文档 {c.docs}</span>
          </div>
        </div>
        {empty ? (
          <>
            <div className="guide">
              <div className="gstep done"><span className="no">✓</span><div><div className="gt2">创建项目</div><div className="gd">绑定目录与连接（{p.connections.join('、') || '-'}）</div></div></div>
              <div className="gstep"><span className="no">2</span><div><div className="gt2">建表与存储过程</div><div className="gd">数据先行：过程返回 SELECT JSON_OBJECT，或关联已有过程</div></div></div>
              <div className="gstep"><span className="no">3</span><div><div className="gt2">接口契约 → 构建实测</div></div></div>
              <div className="gstep"><span className="no">4</span><div><div className="gt2">页面 jsx → 构建 → 预览</div><div className="gd">脚手架起步，过质量门，帆软 op=write 预览</div></div></div>
            </div>
            <div className="banner info"><Icon n="ai" /><div><b>把需求文档交给 Agent</b>：在「文档」组新建需求（meta/），然后点上方「让 Agent 从需求开始」。Agent 与手工共用同一工具链与质量门。</div></div>
          </>
        ) : (
          <div className="blk">
            <div className="blk-t"><Icon n="clock" />项目动态</div>
            <div className="hist">
              {dyn.length === 0 && <div className="hrow"><div className="ht" style={{ color: 'var(--faint)' }}>暂无动态</div></div>}
              {dyn.map((d, i) => (
                <div key={i} className="hrow"><span className="hi"><Icon n={d.i} /></span><div className="ht">{d.h}</div><div className="hm">{d.m}</div></div>
              ))}
            </div>
          </div>
        )}
        </>}
      </div>
    </div>
  )
}

// ── 开发检查点 ──────────────────────────────────────────────────

const CHECKPOINT_ORIGIN: Record<DevelopmentCheckpoint['origin'], string> = {
  baseline: '基线', agent: 'Agent', manual: '人工', restore: '恢复', recovery: '恢复草稿'
}

function VersionPanel({ project, onRestored }: { project: Project; onRestored?: () => void }): React.ReactElement {
  const [checkpoints, setCheckpoints] = useState<DevelopmentCheckpoint[]>([])
  const [working, setWorking] = useState<CheckpointDiff | null>(null)
  const [selected, setSelected] = useState<string>('working')
  const [compareWorking, setCompareWorking] = useState(false)
  const [diff, setDiff] = useState<CheckpointDiff | null>(null)
  const [file, setFile] = useState<string | null>(null)
  const [fileDiff, setFileDiff] = useState<CheckpointFileDiff | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const reload = async () => {
    const [next, wd] = await Promise.all([
      call<DevelopmentCheckpoint[]>('versions:list', { project: project.name }),
      call<CheckpointDiff>('versions:workingDiff', { project: project.name })
    ])
    setCheckpoints(next)
    setWorking(wd)
  }

  useEffect(() => {
    let alive = true
    void reload().catch((e) => alive && setNote((e as Error).message))
    return () => { alive = false }
    // 项目切换时重新读取；reload 故意不进入依赖，避免函数重建造成循环。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.name])

  useEffect(() => {
    let alive = true
    const current = checkpoints.find((x) => x.id === selected)
    if (selected === 'working') {
      setDiff(working)
      return () => { alive = false }
    }
    if (!current) return () => { alive = false }
    const from = compareWorking ? current.id : (current.parentId ?? current.id)
    const to = compareWorking ? undefined : current.id
    void call<CheckpointDiff>('versions:diff', { project: project.name, from, to })
      .then((value) => { if (alive) setDiff(value) })
      .catch((e) => { if (alive) setNote((e as Error).message) })
    return () => { alive = false }
  }, [project.name, checkpoints, selected, compareWorking, working])

  useEffect(() => {
    const path = file && diff?.changes.some((change) => change.path === file)
      ? file
      : diff?.changes[0]?.path
    if (!diff || !path) { setFileDiff(null); return }
    if (path !== file) setFile(path)
    let alive = true
    void call<CheckpointFileDiff>('versions:diffFile', {
      project: project.name, from: diff.from, to: diff.to === 'working' ? undefined : diff.to, path
    }).then((value) => { if (alive) setFileDiff(value) })
      .catch((e) => { if (alive) setNote((e as Error).message) })
    return () => { alive = false }
  }, [project.name, diff, file])

  const selectedCheckpoint = checkpoints.find((x) => x.id === selected)
  const lineDiff = useMemo(() => fileDiff ? buildUnifiedLineDiff(fileDiff.before, fileDiff.after) : null, [fileDiff])
  const create = async () => {
    const title = prompt('检查点说明（仅在工作区有变更时创建）：', '手工检查点')
    if (title === null) return
    setBusy(true)
    try {
      const made = await call<DevelopmentCheckpoint | null>('versions:create', { project: project.name, title })
      setNote(made ? `已创建检查点：${made.title}` : '当前受管源码与最近检查点一致，没有创建空版本。')
      await reload()
      if (made) setSelected(made.id)
    } catch (e) { setNote((e as Error).message) } finally { setBusy(false) }
  }
  const restore = async () => {
    if (!selectedCheckpoint) return
    const ok = confirm(`恢复到「${selectedCheckpoint.title}」？\n\n将覆盖受 RC 管理的源码，并自动留存“恢复前”检查点。\n不会回滚数据库，也不会覆盖传统 CPT；恢复后请重新构建受影响产物。`)
    if (!ok) return
    setBusy(true)
    try {
      const restored = await call<DevelopmentCheckpoint>('versions:restore', { project: project.name, checkpointId: selectedCheckpoint.id })
      setNote(`已恢复源码：${restored.title}。请重新构建受影响页面或数据层。`)
      await reload()
      setSelected(restored.id)
      onRestored?.()
    } catch (e) { setNote((e as Error).message) } finally { setBusy(false) }
  }

  return <div className="vp">
    <div className="banner info"><Icon n="info" /><div><b>开发检查点</b>保存在 Report Console 本地，不创建 .git、不会修改 SVN。仅追踪 project.yaml、受管 JSX、过程定义与 meta/ 源文档；CPT 构建产物、传统 CPT 与数据库不会被回滚。</div></div>
    <div className="vp-actions">
      <button className="btn" disabled={busy} onClick={() => void create()}><Icon n="plus" />创建检查点</button>
      {selectedCheckpoint && <button className="btn dgr" disabled={busy} onClick={() => void restore()}><Icon n="back" />恢复此版本</button>}
      {selectedCheckpoint && <button className="btn sm" onClick={() => setCompareWorking((x) => !x)}>{compareWorking ? '查看本次变更' : '与工作区比较'}</button>}
    </div>
    {note && <div className="vp-note">{note}</div>}
    <div className="vp-grid">
      <div className="vp-list">
        <button className={`vp-item${selected === 'working' ? ' on' : ''}`} onClick={() => { setSelected('working'); setCompareWorking(false) }}>
          <span className="dot" /> <span><b>当前工作区</b><small>{working?.changes.length ?? 0} 个未检查点变更</small></span>
        </button>
        {checkpoints.map((checkpoint) => <button key={checkpoint.id} className={`vp-item${selected === checkpoint.id ? ' on' : ''}`} onClick={() => { setSelected(checkpoint.id); setCompareWorking(false) }}>
          <span className={`vp-origin ${checkpoint.origin}`}>{CHECKPOINT_ORIGIN[checkpoint.origin]}</span>
          <span><b>{checkpoint.title}</b><small>{fmtTime(checkpoint.createdAt)} · {checkpoint.fileCount} 文件</small></span>
        </button>)}
      </div>
      <div className="vp-detail">
        <div className="vp-diff-head"><b>{selected === 'working' ? '最近检查点 → 当前工作区' : compareWorking ? '所选检查点 → 当前工作区' : '与上一个检查点相比'}</b><span className="mono">新增 {diff?.additions ?? 0} · 删除 {diff?.deletions ?? 0} · 共 {diff?.changes.length ?? 0} 处</span></div>
        {!diff?.changes.length ? <div className="nores">没有源文件变更</div> : <>
          <div className="vp-files">{diff.changes.map((change) => <button key={change.path} className={file === change.path ? 'on' : ''} onClick={() => setFile(change.path)}><i className={change.kind} />{change.path}<span>{change.kind === 'added' ? '新增' : change.kind === 'deleted' ? '删除' : '修改'}</span></button>)}</div>
          {fileDiff && lineDiff && <div className="vp-unified-diff">
            {lineDiff.truncated
              ? <div className="vp-diff-limit">文件行数或改动范围过大，未生成完整行级 Diff。请通过页面或文档编辑器查看源码。</div>
              : lineDiff.hunks.map((hunk, hi) => <React.Fragment key={hi}>
                {hi > 0 && <div className="vp-hunk-gap">···</div>}
                {hunk.lines.map((line, li) => <div key={`${hi}-${li}`} className={`vp-diff-line ${line.kind}`}>
                  <span>{line.oldLine ?? ''}</span><span>{line.newLine ?? ''}</span><i>{line.kind === 'added' ? '+' : line.kind === 'deleted' ? '-' : ' '}</i><code>{line.text || ' '}</code>
                </div>)}
              </React.Fragment>)}
          </div>}
        </>}
      </div>
    </div>
  </div>
}

// ── 接口面板 ────────────────────────────────────────────────────

function IfPanel({ ctx, ds, st, acts }: { ctx: SelCtx; ds: Dataset; st?: DatasetStatus; acts: WBActs }): React.ReactElement {
  const key = `if:${ds.name}`
  const tab = ctx.tab[key] ?? 'detail'
  const [lastBuild, setLastBuild] = useState<BuildResult | null>(null)
  const [lastTest, setLastTest] = useState<{ ok: boolean; errCode: number | null; durationMs: number; rowCount: number; response: unknown } | null>(null)
  const [busy, setBusy] = useState('')
  const t = st?.test
  const kind = KIND_TAG[ds.kind] ?? KIND_TAG.other

  return (
    <div className="rp">
      <div className="rp-head">
        <div className="rp-r1">
          <span className="ttl">{ds.name}</span>
          {t?.st === 'ok' ? <span className="pill-o ok"><Icon n="cck" />帆软实测通过</span>
            : t?.st === 'fail' ? <span className="pill-o err"><Icon n="cx" />失败</span>
            : t?.st === 'unreach' ? <span className="pill-o idle"><Icon n="cd" />连接不可达</span>
            : <span className="pill-o idle"><Icon n="cd" />未测</span>}
        </div>
        <div className="rp-r2">
          <span className={`tag ${kind.cls}`} title={kind.tip}>{kind.label}</span>
          {connChip(ds.connection)}
          <span style={{ font: '10.5px/1 var(--mono)', color: 'var(--faint)' }}>项目 {ctx.project?.name} · 单一归属</span>
        </div>
        <div className="rp-acts">
          <button className="btn pri" onClick={async () => { setBusy('build'); try { setLastBuild(await acts.buildData()) } finally { setBusy('') } }} disabled={!!busy}>
            <Icon n="box" />{busy === 'build' ? '构建中…' : '构建'}</button>
          <button className="btn" onClick={async () => { setBusy('test'); try { setLastTest(await acts.testDataset(ds.name)) } finally { setBusy('') } }} disabled={!!busy}>
            <Icon n="play" />{busy === 'test' ? '实测中…' : '实测'}</button>
          <button className="btn acc-o" onClick={() => acts.useAgent(key)}><Icon n="ai" />附加到 Agent</button>
          <button className="iconbtn" title="编辑契约" onClick={() => acts.editDataset(ds)}><Icon n="pen" /></button>
          <button className="iconbtn" title="删除契约（需确认）" onClick={() => { if (confirm(`删除接口 ${ds.name}？（不影响已部署 CPT）`)) void acts.deleteDataset(ds.name) }}><Icon n="trash" /></button>
        </div>
      </div>
      <TabsBar tabs={[{ k: 'detail', n: '详情' }, { k: 'build', n: '构建', bdg: lastBuild && !lastBuild.ok ? String(lastBuild.findings.filter((f) => f.severity === 'error').length) : undefined }, { k: 'test', n: '实测' }, { k: 'hist', n: '历史' }]} cur={tab} onSelect={(k) => ctx.setTab(key, k)} />
      <div className="rp-body">
        {tab === 'detail' && (
          <>
            <div className="blk">
              <div className="blk-t"><Icon n="set" />契约参数</div>
              <table className="ptab">
                <thead><tr><th>NAME</th><th>TYPE</th><th>DEFAULT</th></tr></thead>
                <tbody>
                  {ds.params.map((p, i) => (
                    <tr key={i}><td className="f">{p.name}</td><td className="f">{p.type}</td><td className="f">{p.default || <span style={{ color: 'var(--faint)' }}>-</span>}</td></tr>
                  ))}
                  {!ds.params.length && <tr><td colSpan={3} style={{ color: 'var(--faint)' }}>无参数</td></tr>}
                </tbody>
              </table>
              {ds.params.some((p) => p.type === 'formula') && (
                <div className="banner info" style={{ marginTop: 8 }}><Icon n="info" /><div><b>formula 参数</b>（如 =$fine_username）由帆软会话注入，<b>不随请求传递</b>；实测构造请求时自动过滤。</div></div>
              )}
            </div>
            <div className="blk">
              <div className="blk-t"><Icon n="code" />SQL（只读）<span className="lnk" onClick={() => acts.editDataset(ds)}>编辑</span></div>
              <CodeBlk title={<>sql · 只读，构建产物只能由 build 生成</>} body={ds.sql} />
            </div>
            <div className="blk">
              <div className="blk-t"><Icon n="box" />产物归属</div>
              <div className="kv">
                <span className="k2">_data.cpt</span><span className="v2" style={{ color: 'var(--c-report)' }}>{ctx.project?.name}/data/{ctx.project?.name}_data.cpt</span>
                <span className="k2">数据集连接</span><span className="v2">{ds.connection}</span>
                <span className="k2">最近构建</span><span className="v2">{fmtTime(st?.build)}</span>
              </div>
            </div>
          </>
        )}
        {tab === 'build' && (
          <>
            {lastBuild
              ? lastBuild.ok
                ? <div className="banner ok"><Icon n="cck" /><div><b>构建通过</b>　质量门 {lastBuild.findings.filter((f) => f.severity === 'error').length} error / {lastBuild.findings.filter((f) => f.severity === 'warning').length} warning，产物已落盘</div></div>
                : <div className="banner err"><Icon n="cx" /><div><b>构建未通过</b>　数据层整体未落盘，reportlets 保持上次产物</div></div>
              : <div className="banner info"><Icon n="info" /><div>本次会话还没有构建记录。构建 = 全项目契约装配为一个 _data.cpt（质量门把门）</div></div>}
            <div className="blk">
              <div className="blk-t"><Icon n="shield" />质量门 Findings</div>
              <Findings findings={lastBuild?.findings ?? []} />
            </div>
            <div className="blk">
              <div className="blk-t"><Icon n="term" />构建日志</div>
              <div className="loglines">{(lastBuild?.log ?? ['（暂无，点击上方「构建」）']).join('\n')}</div>
            </div>
            <div className="blk">
              <div className="blk-t"><Icon n="box" />项目产物（一项目一页 · 页内多连接）</div>
              <div className="kv">
                <span className="k2">_data.cpt</span><span className="v2" style={{ color: 'var(--c-report)' }}>{ctx.project?.name}/data/{ctx.project?.name}_data.cpt</span>
                <span className="k2">说明</span><span className="v2">每个 TableData 各自携带 DatabaseName（连接名）</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn pri" onClick={async () => { setBusy('build'); try { setLastBuild(await acts.buildData()) } finally { setBusy('') } }}><Icon n="box" />{lastBuild && !lastBuild.ok ? '修复后重新构建' : '重新构建'}</button>
              <button className="btn" onClick={() => void acts.verify()}><Icon n="shield" />一键验收全部接口</button>
            </div>
          </>
        )}
        {tab === 'test' && (
          <>
            {(lastTest ?? (t?.st === 'ok' ? { ok: true, errCode: 0, durationMs: t.ms ?? 0, rowCount: t.rows ?? 0, response: null } : null))
              ? (lastTest?.ok ?? t?.st === 'ok')
                ? <div className="banner ok"><Icon n="cck" /><div><b>帆软实测通过</b>　POST /webroot/decision/api/data（page_number/page_size 恒 -1，业务分页走参数）</div></div>
                : <div className="banner err"><Icon n="cx" /><div><b>实测失败</b>　{String((lastTest?.response as { err_msg?: string })?.err_msg ?? t?.why ?? '')}</div></div>
              : <div className="banner info"><Icon n="info" /><div>尚未实测。用契约默认参数请求真实帆软接口，返回无错误才算通过。</div></div>}
            {(lastTest || t?.st === 'ok') && (
              <div className="blk">
                <div className="blk-t"><Icon n="clock" />{lastTest ? '本次实测' : '最近一次实测'}</div>
                <div className="kv">
                  <span className="k2">行数</span><span className="v2">{lastTest?.rowCount ?? t?.rows ?? '-'}</span>
                  <span className="k2">耗时</span><span className="v2">{lastTest?.durationMs ?? t?.ms ?? '-'}ms</span>
                  <span className="k2">错误码</span><span className="v2" style={{ color: 'var(--ok)' }}>{lastTest?.errCode ?? 0}</span>
                </div>
                {lastTest?.response ? (
                  <details className="resp" style={{ marginTop: 8 }}>
                    <summary>响应 JSON</summary>
                    <pre>{JSON.stringify(lastTest.response, null, 2).slice(0, 4000)}</pre>
                  </details>
                ) : null}
              </div>
            )}
            <button className="btn pri" onClick={async () => { setBusy('test'); try { setLastTest(await acts.testDataset(ds.name)) } finally { setBusy('') } }} disabled={!!busy}>
              <Icon n="play" />{busy === 'test' ? '实测中…' : '再次实测'}</button>
          </>
        )}
        {tab === 'hist' && <IfHistory project={ctx.project?.name ?? ''} dataset={ds.name} />}
      </div>
    </div>
  )
}

function IfHistory({ project, dataset }: { project: string; dataset: string }): React.ReactElement | null {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  useEffect(() => {
    void (async () => {
      try {
        const all = await call<Array<Record<string, unknown>>>('history:apiTests', { limit: 200, project })
        setRows(all.filter((r) => r.dataset === dataset).slice(0, 12))
      } catch { /* 忽略 */ }
    })()
  }, [project, dataset])
  return (
    <div className="blk">
      <div className="blk-t"><Icon n="clock" />测试历史（api_tests 只增不改）</div>
      <div className="hist">
        {rows.length === 0 && <div className="hrow"><div className="ht" style={{ color: 'var(--faint)' }}>暂无历史</div></div>}
        {rows.map((r, i) => (
          <div key={i} className="hrow">
            <span className="hi"><Icon n={r.ok ? 'cck' : 'cx'} /></span>
            <div className="ht">{r.ok ? <b>通过</b> : <b>err_code={String(r.err_code)}</b>}{!r.ok ? `　${String(JSON.parse(String(r.response ?? '{}')).err_msg ?? '').slice(0, 90)}` : ''}</div>
            <div className="hm">{fmtTime(String(r.created_at))}<br />{String(r.duration_ms)}ms</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 存储过程面板 ────────────────────────────────────────────────

function SpPanel({ ctx, sp, acts }: { ctx: SelCtx; sp: ProcRecord; acts: WBActs }): React.ReactElement {
  const key = `sp:${sp.name}`
  const tab = ctx.tab[key] ?? 'def'
  const [def, setDef] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setDef(null); setDirty(false)
    void call<string>('procs:def', { project: ctx.project?.name, name: sp.name })
      .then(setDef)
      .catch((e) => setDef(`-- 读取失败：${(e as Error).message}`))
  }, [ctx.project?.name, sp.name])

  const linked = !sp.own
  return (
    <div className="rp">
      <div className="rp-head">
        <div className="rp-r1">
          <span className="ttl">{sp.name}</span>
          {linked ? <span className="pill-o warn"><Icon n="link" />关联</span> : <span className="pill-o ok"><Icon n="cck" />本项目</span>}
        </div>
        <div className="rp-r2">
          {linked ? <span className="tag lnk"><Icon n="link" />关联自「{sp.srcProject}」</span> : <span className="tag own">本项目创建</span>}
          {connChip(sp.connection)}
          <span style={{ font: '10.5px/1 var(--mono)', color: 'var(--faint)' }}>最后修改 {fmtTime(sp.updatedAt)} · {sp.appliedCount} 次应用</span>
        </div>
        <div className="rp-acts">
          <button className="btn dgr-o" onClick={() => acts.applyProc(sp)}><Icon n="box" />应用 DROP+CREATE</button>
          <button className="btn" onClick={() => acts.callProc(sp)}><Icon n="play" />试执行 CALL</button>
          <button className="btn acc-o" onClick={() => acts.useAgent(key)}><Icon n="ai" />附加到 Agent</button>
          {linked
            ? <button className="iconbtn" title="解除关联（不影响源项目）" onClick={() => { if (confirm(`解除关联 ${sp.name}？`)) void acts.unlinkProc(sp) }}><Icon n="x" /></button>
            : <button className="iconbtn" title="删除过程（需确认）" onClick={() => { if (confirm(`删除过程契约 ${sp.name}？（数据库中的过程不受影响，meta 语句一并删除）`)) void acts.deleteProc(sp.name) }}><Icon n="trash" /></button>}
        </div>
        {linked && (
          <div className="banner info" style={{ marginBottom: 0, marginTop: 10 }}>
            <Icon n="info" /><div><b>关联引用，不复制</b>：定义来自「{sp.srcProject}」，应用（DROP+CREATE）作用于连接 {sp.connection}。</div>
          </div>
        )}
      </div>
      <TabsBar tabs={[{ k: 'def', n: '定义' }, { k: 'audit', n: '审计' }]} cur={tab} onSelect={(k) => ctx.setTab(key, k)} />
      <div className="rp-body">
        {tab === 'def' && (
          <div className="blk">
            <div className="blk-t">
              <Icon n="code" />过程定义（CodeMirror SQL · meta/{sp.name}.sql 为源）
              <span className="lnk" onClick={async () => {
                if (def === null) return
                setSaving(true)
                try { await acts.saveProcDef(sp, def); setDirty(false) } finally { setSaving(false) }
              }}>{saving ? '保存中…' : dirty ? '保存定义*' : '保存定义'}</span>
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
              {def === null
                ? <div style={{ padding: 20, textAlign: 'center', color: 'var(--faint)', fontSize: 12 }}>读取定义中…</div>
                : <SqlEditor value={def} height="420px" onChange={(v) => { setDef(v); setDirty(true) }} />}
            </div>
            <div className="banner info" style={{ marginTop: 10 }}><Icon n="info" /><div>保存只写 meta/ 文件；「应用」才执行 DROP IF EXISTS + CREATE（审计落 ddl_log）。模板约定返回 <b>SELECT JSON_OBJECT(...)</b></div></div>
          </div>
        )}
        {tab === 'audit' && <SpAudit name={sp.name} />}
      </div>
    </div>
  )
}

function SpAudit({ name }: { name: string }): React.ReactElement {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  useEffect(() => {
    void call<Array<Record<string, unknown>>>('sql:ddlLog', {})
      .then((all) => setRows(all.filter((r) => String(r.target).includes(name)).slice(0, 12)))
      .catch(() => setRows([]))
  }, [name])
  return (
    <div className="blk">
      <div className="blk-t"><Icon n="term" />审计记录（ddl_log，只增不改）</div>
      <div className="hist">
        {rows.length === 0 && <div className="hrow"><div className="ht" style={{ color: 'var(--faint)' }}>暂无审计</div></div>}
        {rows.map((r, i) => (
          <div key={i} className="hrow">
            <span className="hi"><Icon n={r.ok ? 'cck' : 'cx'} /></span>
            <div className="ht"><b>{String(r.kind)}</b>　{r.ok ? '成功' : `失败：${String(r.error ?? '').slice(0, 90)}`}</div>
            <div className="hm">{fmtTime(String(r.created_at))}<br />{String(r.connection ?? '')}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 页面面板 ────────────────────────────────────────────────────

function PgPanel({ ctx, pg, acts }: { ctx: SelCtx; pg: PageMeta; acts: WBActs }): React.ReactElement {
  const key = `pg:${pg.name}`
  const tab = ctx.tab[key] ?? 'src'
  const [src, setSrc] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [lastBuild, setLastBuild] = useState<BuildResult | null>(null)
  const [busy, setBusy] = useState('')
  const [url, setUrl] = useState('')
  const stale = pg.stale

  useEffect(() => {
    setSrc(null); setDirty(false)
    void call<string>('pages:read', { project: ctx.project?.name, page: pg.name }).then(setSrc).catch((e) => setSrc(`// 读取失败：${(e as Error).message}`))
    void call<string>('pages:previewUrl', { project: ctx.project?.name, page: pg.name }).then(setUrl).catch(() => setUrl(''))
  }, [ctx.project?.name, pg.name])

  const stepState = (i: number): string => {
    if (!lastBuild) return ''
    return i <= (lastBuild.ok ? 4 : 3) ? 'done' : lastBuild.ok ? 'done' : 'fail'
  }

  return (
    <div className="rp">
      <div className="rp-head">
        <div className="rp-r1">
          <span className="ttl">{pg.name}.jsx</span>
          <span className={`stale ${stale ? 'old' : pg.cptExists ? 'new' : 'none'}`}>{stale ? 'cpt 落后 jsx · 待重建' : pg.cptExists ? '最新' : '从未构建'}</span>
        </div>
        <div className="rp-r2">
          <span className="tag src">{fmtBytes(pg.size)}</span>
          <span style={{ font: '10.5px/1 var(--mono)', color: 'var(--faint)' }}>上次构建 {pg.lastBuildAt ? `${fmtTime(pg.lastBuildAt)}${pg.lastBuildOk === false ? ' · 失败' : ''}` : '-'}</span>
        </div>
        <div className="rp-acts">
          <button className="btn pri" onClick={async () => { setBusy('build'); try { setLastBuild(await acts.buildPage(pg.name)) } finally { setBusy('') } }} disabled={!!busy}>
            <Icon n="box" />{busy === 'build' ? '构建中…' : stale ? '构建（待重建）' : '构建'}</button>
          <button className="btn" onClick={() => void acts.openPage(pg.name)}><Icon n="ext" />预览</button>
          <button className="btn acc-o" onClick={() => acts.useAgent(key)}><Icon n="ai" />附加到 Agent</button>
          <button className="iconbtn" title="删除（连带 .mjs / .cpt，需确认）" onClick={() => { if (confirm(`删除页面 ${pg.name}？连带 .mjs / .cpt`)) void acts.deletePage(pg.name) }}><Icon n="trash" /></button>
        </div>
      </div>
      <TabsBar tabs={[{ k: 'src', n: '源码' }, { k: 'build', n: '构建', bdg: lastBuild && !lastBuild.ok ? '!' : undefined }, { k: 'prev', n: '预览' }]} cur={tab} onSelect={(k) => ctx.setTab(key, k)} />
      <div className="rp-body">
        {tab === 'src' && (
          <div className="blk">
            <div className="blk-t">
              <Icon n="code" />jsx 源码
              <span className="lnk" onClick={async () => {
                if (src === null) return
                setBusy('save')
                try { await acts.savePage(pg.name, src); setDirty(false) } finally { setBusy('') }
              }}>{busy === 'save' ? '保存中…' : dirty ? '保存*' : '保存'}</span>
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
              {src === null
                ? <div style={{ padding: 20, textAlign: 'center', color: 'var(--faint)', fontSize: 12 }}>读取源码中…</div>
                : <JsxEditor value={src} height="440px" onChange={(v) => { setSrc(v); setDirty(true) }} />}
            </div>
            <div className="banner info" style={{ marginTop: 10 }}><Icon n="info" /><div><b>页面运行约定</b>：jsx 直接用全局 React / antd / $ / PATH，不写 import、不重建 PATH、不自建 app-root，骨架负责兜底加载</div></div>
          </div>
        )}
        {tab === 'build' && (
          <>
            <div className="blk">
              <div className="blk-t"><Icon n="box" />构建管线</div>
              <div className="pipe">
                <span className={`pstep ${stepState(0)}`}><span className="nd"><span className="bx">jsx</span><span className="lb">esbuild(iife)</span></span><span className="ar" /></span>
                <span className={`pstep ${stepState(1)}`}><span className="nd"><span className="bx">净化</span><span className="lb">去注释/解码</span></span><span className="ar" /></span>
                <span className={`pstep ${stepState(2)}`}><span className="nd"><span className="bx">注入</span><span className="lb">骨架代码区</span></span><span className="ar" /></span>
                <span className={`pstep ${stepState(3)}`}><span className="nd"><span className="bx">门</span><span className="lb">质量门</span></span><span className="ar" /></span>
                <span className={`pstep ${stepState(4)}`}><span className="nd"><span className="bx">cpt</span><span className="lb">.mjs + .cpt</span></span></span>
              </div>
              {lastBuild
                ? lastBuild.ok
                  ? <div className="banner ok"><Icon n="cck" /><div><b>构建通过</b>　质量门 {lastBuild.findings.filter((f) => f.severity === 'error').length} error / {lastBuild.findings.filter((f) => f.severity === 'warning').length} warning</div></div>
                  : <div className="banner warn"><Icon n="alert" /><div><b>质量门未通过</b>：.cpt 不落盘、.mjs 保留供排查</div></div>
                : stale
                  ? <div className="banner warn"><Icon n="alert" /><div><b>待重建</b>：cpt mtime 落后于 jsx</div></div>
                  : <div className="banner ok"><Icon n="cck" /><div><b>最新</b>　{pg.lastBuildAt ? `上次构建 ${fmtTime(pg.lastBuildAt)}` : ''}</div></div>}
            </div>
            <div className="blk">
              <div className="blk-t"><Icon n="shield" />Findings</div>
              <Findings findings={lastBuild?.findings ?? []} />
            </div>
            <div className="blk">
              <div className="blk-t"><Icon n="term" />{lastBuild ? '本次构建日志' : '上次构建日志'}</div>
              <div className="loglines">{(lastBuild?.log ?? ['（点击上方「构建」查看日志）']).join('\n')}</div>
            </div>
            <button className="btn pri" onClick={async () => { setBusy('build'); try { setLastBuild(await acts.buildPage(pg.name)) } finally { setBusy('') } }}><Icon n="box" />{stale ? '构建（待重建）' : '重新构建'}</button>
          </>
        )}
        {tab === 'prev' && (
          <div className="blk">
            <div className="blk-t"><Icon n="ext" />预览（帆软 op=write · 时间戳防缓存）</div>
            <CodeBlk title="url" body={url || '（生成中…）'} extra={<span className="lnk" onClick={() => void acts.openPage(pg.name)}>打开预览</span>} />
            <div style={{ height: 10 }} />
            <button className="btn pri" onClick={() => void acts.openPage(pg.name)}><Icon n="ext" />打开预览</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── 文档面板 ────────────────────────────────────────────────────

function DocPanel({ ctx, doc, acts }: { ctx: SelCtx; doc: DocMeta; acts: WBActs }): React.ReactElement {
  const key = `doc:${doc.name}`
  const isMd = doc.type === 'markdown'
  const isSql = doc.type === 'sql'
  const isText = doc.type === 'other'
  const tab = ctx.tab[key] ?? (isMd ? 'view' : 'src')
  const [content, setContent] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setContent(null); setDirty(false)
    void call<string>('docs:read', { project: ctx.project?.name, name: doc.name }).then(setContent).catch((e) => setContent(`读取失败：${(e as Error).message}`))
  }, [ctx.project?.name, doc.name])

  return (
    <div className="rp">
      <div className="rp-head">
        <div className="rp-r1"><span className="ttl reg">{doc.name}</span></div>
        <div className="rp-r2">
          <span className="tag src">{isMd ? 'Markdown' : isSql ? 'SQL 源码' : /\.(js|jsx|mjs)$/i.test(doc.name) ? 'JavaScript' : /\.css$/i.test(doc.name) ? 'CSS' : '文本'}</span>
          <span style={{ font: '10.5px/1 var(--mono)', color: 'var(--faint)' }}>meta/ · {fmtBytes(doc.size)} · {fmtTime(new Date(doc.mtime).toISOString())}</span>
        </div>
        <div className="rp-acts">
          <button className="btn" onClick={async () => {
            if (content === null) return
            setBusy(true)
            try { await acts.saveDoc(doc.name, content); setDirty(false) } finally { setBusy(false) }
          }} disabled={busy || content === null}><Icon n="pen" />{busy ? '保存中…' : dirty ? '保存*' : '保存'}</button>
          <button className="btn acc-o" onClick={() => acts.useAgent(key)}><Icon n="ai" />附加到 Agent</button>
          <button className="iconbtn" title="删除（需确认）" onClick={() => { if (confirm(`删除文档 ${doc.name}？`)) void acts.deleteDoc(doc.name) }}><Icon n="trash" /></button>
        </div>
      </div>
      {isMd && <TabsBar tabs={[{ k: 'view', n: '阅读' }, { k: 'src', n: '源码' }]} cur={tab} onSelect={(k) => ctx.setTab(key, k)} />}
      <div className="rp-body">
        {content === null ? <div className="nores">读取中…</div> : tab === 'view'
          ? <div className="md" dangerouslySetInnerHTML={{ __html: mdToHtml(content) }} />
            : (isMd || isText)
            ? <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
                <MdEditor value={content} height="460px" onChange={(v) => { setContent(v); setDirty(true) }} />
              </div>
            : <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
                <SqlEditor value={content} height="460px" onChange={(v) => { setContent(v); setDirty(true) }} />
              </div>}
        {isSql && <div className="banner info" style={{ marginTop: 10 }}><Icon n="info" /><div>过程创建语句存于项目 meta/，与库内实际定义互为备份（「存储过程」面板的保存也写这里）</div></div>}
      </div>
    </div>
  )
}

// ── Agent 面板（工作台右栏 · D7） ───────────────────────────────

function AgentPanel({ ctx, project, data, onProjectSettings, onShowVersions, onResourcesChanged }: {
  ctx: { project: string; resource?: string } | null
  project: Project | null
  data: WBData
  onProjectSettings: () => void
  onShowVersions: () => void
  onResourcesChanged?: () => void
}): React.ReactElement {
  const [state, setState] = useState<{ handle?: PiAgentHandle; error?: string }>({})
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const options = useMemo(() => resourceAttachments(data), [data.datasets, data.procs, data.pages, data.docs, data.traditionalCpts])

  useEffect(() => {
    if (!ctx?.resource) return
    const attachment = options.find((x) => x.key === ctx.resource)
    if (attachment) setAttachments((prev) => prev.some((x) => x.key === attachment.key) ? prev : [...prev, attachment])
  }, [ctx?.resource, options])

  useEffect(() => {
    let alive = true
    if (!project) {
      setState({})
      return () => { alive = false }
    }
    setState({})
    void (async () => {
      try {
        const handle = await getSharedPiAgent({ project: project.name })
        if (alive) setState({ handle })
      } catch (e) {
        if (alive) setState({ error: (e as Error).message })
      }
    })()
    return () => { alive = false }
  }, [project?.name])

  const digest = buildDigest(project, attachments)
  const newSession = () => {
    if (!project) return
    setState({})
    setAttachments([])
    void resetSharedPiAgent({ project: project.name })
      .then((handle) => setState({ handle }))
      .catch((e) => setState({ error: (e as Error).message }))
  }

  return (
    <div className="rp">
      <div className="ag-head">
        <span className="ttl">Agent 会话</span>
        {state.handle && <span className="ctx-chip" title={`当前项目：${project?.name ?? '-'}；模型在「设置」页配置`}>{state.handle.modelId} · {project?.name}</span>}
        {project && <button className="btn sm" title="查看本项目的开发检查点与源码变更" onClick={onShowVersions}><Icon n="clock" size={13} />版本</button>}
        {state.handle && <button className="btn sm" title="在当前项目中开始空白会话" onClick={newSession}><Icon n="plus" size={13} />新建会话</button>}
        {project && <button className="iconbtn" title="项目设置" onClick={onProjectSettings}><Icon n="set" /></button>}
      </div>
      <div className="ag-thread-wrap" style={{ padding: '8px 10px 10px', display: 'flex' }}>
        {state.error
          ? <div className="banner err" style={{ margin: 12 }}><Icon n="cx" /><div><b>Agent 初始化失败</b><br />{state.error}</div></div>
          : !state.handle
            ? <div className="banner info" style={{ margin: 12 }}><Icon n="info" /><div>正在初始化（加载平台工具与会话）…</div></div>
            : null}
        {state.handle && <PiChat key={state.handle.sessionId}
          handle={state.handle}
          contextPrefix={digest}
          attachments={attachments}
          mentionOptions={options}
          onAttach={(a) => setAttachments((prev) => prev.some((x) => x.key === a.key) ? prev : [...prev, a])}
          onDetach={(key) => setAttachments((prev) => prev.filter((x) => x.key !== key))}
          onToolCompleted={onResourcesChanged}
          onCheckpointCreated={() => onResourcesChanged?.()}
          placeholder="描述开发任务；输入 @ 附加当前项目资源…"
        />}
      </div>
    </div>
  )
}

function resourceAttachments(data: WBData): ChatAttachment[] {
  return [
    ...data.datasets.map((x) => ({ key: `if:${x.name}`, label: `接口 ${x.name}` })),
    ...data.procs.map((x) => ({ key: `sp:${x.name}`, label: `过程 ${x.name}` })),
    ...data.pages.map((x) => ({ key: `pg:${x.name}`, label: `页面 ${x.name}` })),
    ...data.docs.map((x) => ({ key: `doc:${x.name}`, label: `文档 ${x.name}` })),
    ...data.traditionalCpts.map((x) => ({ key: `legacy:${x.path}`, label: `传统 CPT ${x.path}` }))
  ]
}

/** 每次任务附带轻量引用；Agent 必须主动调读取工具，资源正文不会进入聊天上下文。 */
function buildDigest(project: Project | null, attachments: ChatAttachment[]): string {
  if (!project) return ''
  const lines = [`[上下文] 当前项目：${project.name}`, `绑定连接：${project.connections.join('、')}`]
  for (const attachment of attachments) {
    const [kind, name] = [attachment.key.slice(0, attachment.key.indexOf(':')), attachment.key.slice(attachment.key.indexOf(':') + 1)]
    if (kind === 'legacy') {
      lines.push(`附加资源：传统 CPT 文件 ${name}；需要了解结构时先调用 inspect_legacy_cpt(path="${name}", view="overview")。`)
      continue
    }
    const kindName = kind === 'if' ? '数据接口' : kind === 'sp' ? '存储过程' : kind === 'pg' ? '页面' : '文档'
    const tool = kind === 'if' ? 'read_dataset' : kind === 'sp' ? 'read_procedure' : kind === 'pg' ? 'read_page' : 'read_doc'
    lines.push(`附加资源：${kindName} ${name}；需要现状时先调用 ${tool}。`)
  }
  return lines.join('\n')
}
