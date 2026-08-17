/**
 * 工作台右栏 — 资源操作面板（接口/过程/页面/文档四类 + 项目面板 + 内嵌 Agent）
 */
import React, { useEffect, useRef, useState } from 'react'
import '@earendil-works/pi-web-ui'
import '@earendil-works/pi-web-ui/app.css'
import { Icon } from '../../components/Icon'
import { CodeBlk, fmtBytes, fmtTime, mdToHtml } from '../../components/ui'
import { JsxEditor, SqlEditor, MdEditor } from '../../components/CodeEditor'
import { getSharedPiAgent } from '../../agent/piAgent'
import { call } from '../../api'
import type { ChatPanelElement } from '../../pi-elements'
import type { Project, Dataset, DatasetStatus, ProcRecord, PageMeta, DocMeta, ConnectionHealth, BuildResult, CheckerFinding } from '@shared/types'

export interface WBData {
  datasets: Dataset[]
  statuses: Record<string, DatasetStatus>
  procs: ProcRecord[]
  pages: PageMeta[]
  docs: DocMeta[]
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

const KIND_TAG: Record<string, { cls: string; label: string }> = {
  list: { cls: 'list', label: '列表' }, stat: { cls: 'stat', label: '统计' }, detail: { cls: 'one', label: '单条' },
  dict: { cls: 'dict', label: '字典' }, insert: { cls: 'ins', label: '增' }, update: { cls: 'upd', label: '改' },
  delete: { cls: 'del', label: '删' }, other: { cls: 'other', label: '其他' }
}

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
  if (!findings.length) return <div style={{ fontSize: 11.5, color: 'var(--tx3)', padding: '6px 2px' }}>本次没有 findings。</div>
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

export default function RightPanel({ ctx, data, acts, agentMode, agentCtx, onExitAgent }: {
  ctx: SelCtx
  data: WBData
  acts: WBActs
  agentMode: boolean
  agentCtx: { project: string; resource?: string } | null
  onExitAgent: () => void
}): React.ReactElement {
  if (agentMode) return <AgentPanel ctx={agentCtx} project={ctx.project} onBack={onExitAgent} />
  const { sel } = ctx
  const r = sel ? sel : null
  if (!r) return <ProjectPanel ctx={ctx} data={data} acts={acts} />
  if (r.startsWith('if:')) {
    const ds = data.datasets.find((x) => x.name === r.slice(3))
    return ds ? <IfPanel key={r} ctx={ctx} ds={ds} st={data.statuses[ds.name]} acts={acts} /> : <ProjectPanel ctx={ctx} data={data} acts={acts} />
  }
  if (r.startsWith('sp:')) {
    const sp = data.procs.find((x) => x.name === r.slice(3))
    return sp ? <SpPanel key={r} ctx={ctx} sp={sp} acts={acts} /> : <ProjectPanel ctx={ctx} data={data} acts={acts} />
  }
  if (r.startsWith('pg:')) {
    const pg = data.pages.find((x) => x.name === r.slice(3))
    return pg ? <PgPanel key={r} ctx={ctx} pg={pg} acts={acts} /> : <ProjectPanel ctx={ctx} data={data} acts={acts} />
  }
  if (r.startsWith('doc:')) {
    const doc = data.docs.find((x) => x.name === r.slice(4))
    return doc ? <DocPanel key={r} ctx={ctx} doc={doc} acts={acts} /> : <ProjectPanel ctx={ctx} data={data} acts={acts} />
  }
  return <ProjectPanel ctx={ctx} data={data} acts={acts} />
}

// ── 项目面板（未选资源 / 空项目） ───────────────────────────────

function ProjectPanel({ ctx, data, acts }: { ctx: SelCtx; data: WBData; acts: WBActs }): React.ReactElement {
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
          ...tests.slice(0, 5).map((t) => ({ i: t.ok ? 'cck' : 'cx', h: <><b>实测 {String(t.dataset)}</b>　{t.ok ? 'err_code=0' : '失败'}</>, m: fmtTime(String(t.created_at)) }))
        ].sort(() => 0).slice(0, 8)
        setDyn(items)
      } catch { /* 忽略 */ }
    })()
  }, [p, data])
  if (!p) return <div className="rp"><div className="rp-body"><div className="nores">未选择项目</div></div></div>
  const c = p.counts
  const empty = c.ifs + c.sps + c.pgs + c.docs === 0
  return (
    <div className="rp">
      <div className="rp-head">
        <div className="rp-r1"><span className="ttl reg">{p.name}</span></div>
        <div className="rp-r2">
          {p.connections.map((cn) => connChip(cn))}
          <span style={{ font: '10.5px/1 var(--mono)', color: 'var(--tx3)' }}>创建于 {p.createdAt.slice(0, 10)}{p.comment ? ` · ${p.comment}` : ''}</span>
        </div>
        <div className="rp-acts">
          <button className="btn" onClick={() => void acts.verify()} disabled={empty} title="构建 + 实测项目内全部接口"><Icon n="shield" />一键验收</button>
          <button className="btn pri" onClick={() => acts.useAgent()}><Icon n="ai" />{empty ? '让 Agent 从需求开始' : '用 Agent 做'}</button>
          <button className="iconbtn" title="项目设置" onClick={acts.openProjectSettings}><Icon n="set" /></button>
          <button className="iconbtn" title="删除项目（需确认）" onClick={acts.deleteProject}><Icon n="trash" /></button>
        </div>
      </div>
      <TabsBar tabs={[{ k: 'ov', n: '总览' }]} cur="ov" onSelect={() => {}} />
      <div className="rp-body">
        <div className="blk">
          <div className="blk-t"><Icon n="folder" />项目信息</div>
          <div className="kv">
            <span className="k2">绑定目录</span><span className="v2">{p.missingDir ? <span style={{ color: '#e8c377' }}>{p.dir}（缺失）</span> : p.dir}</span>
            <span className="k2">目录三分</span><span className="v2">data/（数据层产物）+ pages/（页面）+ meta/（文档与过程语句）</span>
            <span className="k2">资源规模</span><span className="v2">接口 {c.ifs} · 过程 {c.sps} · 页面 {c.pgs} · 文档 {c.docs}</span>
          </div>
        </div>
        {empty ? (
          <>
            <div className="guide">
              <div className="gstep done"><span className="no">✓</span><div><div className="gt2">创建项目</div><div className="gd">绑定目录与连接（{p.connections.join('、') || '-'}）</div></div></div>
              <div className="gstep"><span className="no">2</span><div><div className="gt2">建表与存储过程</div><div className="gd">数据先行：过程返回 SELECT JSON_OBJECT，或关联已有过程</div></div></div>
              <div className="gstep"><span className="no">3</span><div><div className="gt2">接口契约 → 构建实测</div><div className="gd">err_code=0 之后才进入页面开发（顺序强约定）</div></div></div>
              <div className="gstep"><span className="no">4</span><div><div className="gt2">页面 jsx → 构建 → 预览</div><div className="gd">脚手架起步，过质量门，帆软 op=write 预览</div></div></div>
            </div>
            <div className="banner info"><Icon n="ai" /><div><b>把需求文档交给 Agent</b>：在「文档」组新建需求（meta/），然后点上方「让 Agent 从需求开始」。Agent 与手工共用同一工具链与质量门。</div></div>
          </>
        ) : (
          <div className="blk">
            <div className="blk-t"><Icon n="clock" />项目动态</div>
            <div className="hist">
              {dyn.length === 0 && <div className="hrow"><div className="ht" style={{ color: 'var(--tx3)' }}>暂无动态</div></div>}
              {dyn.map((d, i) => (
                <div key={i} className="hrow"><span className="hi"><Icon n={d.i} /></span><div className="ht">{d.h}</div><div className="hm">{d.m}</div></div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
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
          {t?.st === 'ok' ? <span className="pill-o ok"><Icon n="cck" />err_code=0</span>
            : t?.st === 'fail' ? <span className="pill-o err"><Icon n="cx" />失败</span>
            : t?.st === 'unreach' ? <span className="pill-o idle"><Icon n="cd" />连接不可达</span>
            : <span className="pill-o idle"><Icon n="cd" />未测</span>}
        </div>
        <div className="rp-r2">
          <span className={`tag ${kind.cls}`}>{kind.label}</span>
          {connChip(ds.connection)}
          <span style={{ font: '10.5px/1 var(--mono)', color: 'var(--tx3)' }}>项目 {ctx.project?.name} · 单一归属（D2）</span>
        </div>
        <div className="rp-acts">
          <button className="btn pri" onClick={async () => { setBusy('build'); try { setLastBuild(await acts.buildData()) } finally { setBusy('') } }} disabled={!!busy}>
            <Icon n="box" />{busy === 'build' ? '构建中…' : '构建'}</button>
          <button className="btn" onClick={async () => { setBusy('test'); try { setLastTest(await acts.testDataset(ds.name)) } finally { setBusy('') } }} disabled={!!busy}>
            <Icon n="play" />{busy === 'test' ? '实测中…' : '实测'}</button>
          <button className="btn acc-o" onClick={() => acts.useAgent(key)}><Icon n="ai" />用 Agent 做</button>
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
                    <tr key={i}><td className="f">{p.name}</td><td className="f">{p.type}</td><td className="f">{p.default || <span style={{ color: '#5d6675' }}>-</span>}</td></tr>
                  ))}
                  {!ds.params.length && <tr><td colSpan={3} style={{ color: '#5d6675' }}>无参数</td></tr>}
                </tbody>
              </table>
              {ds.params.some((p) => p.type === 'formula') && (
                <div className="banner info" style={{ marginTop: 8 }}><Icon n="info" /><div><b>formula 参数</b>（如 =$fine_username）由帆软会话注入，<b>不随请求传递</b>；实测构造请求时自动过滤。</div></div>
              )}
            </div>
            <div className="blk">
              <div className="blk-t"><Icon n="code" />SQL（只读）<span className="lnk" onClick={() => acts.editDataset(ds)}>编辑</span></div>
              <CodeBlk title={<>sql · 只读，构建产物只能由 build 生成（D6）</>} body={ds.sql} />
            </div>
            <div className="blk">
              <div className="blk-t"><Icon n="box" />产物归属</div>
              <div className="kv">
                <span className="k2">_data.cpt</span><span className="v2" style={{ color: 'var(--c-cpt)' }}>{ctx.project?.name}/data/{ctx.project?.name}_data.cpt</span>
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
              <div className="blk-t"><Icon n="box" />项目产物（D2 · 一项目一页·页内多连接）</div>
              <div className="kv">
                <span className="k2">_data.cpt</span><span className="v2" style={{ color: 'var(--c-cpt)' }}>{ctx.project?.name}/data/{ctx.project?.name}_data.cpt</span>
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
                ? <div className="banner ok"><Icon n="cck" /><div><b>err_code=0</b>　POST /webroot/decision/api/data（page_number/page_size 恒 -1，业务分页走参数）</div></div>
                : <div className="banner err"><Icon n="cx" /><div><b>实测失败</b>　{String((lastTest?.response as { err_msg?: string })?.err_msg ?? t?.why ?? '')}</div></div>
              : <div className="banner info"><Icon n="info" /><div>尚未实测。用契约默认参数打真实帆软接口，err_code=0 才算通过。</div></div>}
            {(lastTest || t?.st === 'ok') && (
              <div className="blk">
                <div className="blk-t"><Icon n="clock" />{lastTest ? '本次实测' : '最近一次实测'}</div>
                <div className="kv">
                  <span className="k2">行数</span><span className="v2">{lastTest?.rowCount ?? t?.rows ?? '-'}</span>
                  <span className="k2">耗时</span><span className="v2">{lastTest?.durationMs ?? t?.ms ?? '-'}ms</span>
                  <span className="k2">err_code</span><span className="v2" style={{ color: '#7ee0a8' }}>{lastTest?.errCode ?? 0}</span>
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
        {rows.length === 0 && <div className="hrow"><div className="ht" style={{ color: 'var(--tx3)' }}>暂无历史</div></div>}
        {rows.map((r, i) => (
          <div key={i} className="hrow">
            <span className="hi"><Icon n={r.ok ? 'cck' : 'cx'} /></span>
            <div className="ht"><b>err_code={String(r.err_code)}</b>{!r.ok ? `　${String(JSON.parse(String(r.response ?? '{}')).err_msg ?? '').slice(0, 90)}` : ''}</div>
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
          <span style={{ font: '10.5px/1 var(--mono)', color: 'var(--tx3)' }}>最后修改 {fmtTime(sp.updatedAt)} · {sp.appliedCount} 次应用</span>
        </div>
        <div className="rp-acts">
          <button className="btn dgr-o" onClick={() => acts.applyProc(sp)}><Icon n="box" />应用 DROP+CREATE</button>
          <button className="btn" onClick={() => acts.callProc(sp)}><Icon n="play" />试执行 CALL</button>
          <button className="btn acc-o" onClick={() => acts.useAgent(key)}><Icon n="ai" />用 Agent 做</button>
          {linked
            ? <button className="iconbtn" title="解除关联（不影响源项目）" onClick={() => { if (confirm(`解除关联 ${sp.name}？`)) void acts.unlinkProc(sp) }}><Icon n="x" /></button>
            : <button className="iconbtn" title="删除过程（需确认）" onClick={() => { if (confirm(`删除过程契约 ${sp.name}？（数据库中的过程不受影响，meta 语句一并删除）`)) void acts.deleteProc(sp.name) }}><Icon n="trash" /></button>}
        </div>
        {linked && (
          <div className="banner info" style={{ marginBottom: 0, marginTop: 10 }}>
            <Icon n="info" /><div><b>D3 关联引用，不复制</b>：定义来自「{sp.srcProject}」，应用（DROP+CREATE）作用于连接 {sp.connection}。</div>
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
            <div style={{ border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden' }}>
              {def === null
                ? <div style={{ padding: 20, textAlign: 'center', color: 'var(--tx3)', fontSize: 12 }}>读取定义中…</div>
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
        {rows.length === 0 && <div className="hrow"><div className="ht" style={{ color: 'var(--tx3)' }}>暂无审计</div></div>}
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
          <span style={{ font: '10.5px/1 var(--mono)', color: 'var(--tx3)' }}>上次构建 {pg.lastBuildAt ? `${fmtTime(pg.lastBuildAt)}${pg.lastBuildOk === false ? ' · 失败' : ''}` : '-'}</span>
        </div>
        <div className="rp-acts">
          <button className="btn pri" onClick={async () => { setBusy('build'); try { setLastBuild(await acts.buildPage(pg.name)) } finally { setBusy('') } }} disabled={!!busy}>
            <Icon n="box" />{busy === 'build' ? '构建中…' : stale ? '构建（待重建）' : '构建'}</button>
          <button className="btn" onClick={() => void acts.openPage(pg.name)}><Icon n="ext" />预览</button>
          <button className="btn acc-o" onClick={() => acts.useAgent(key)}><Icon n="ai" />用 Agent 做</button>
          <button className="iconbtn" title="删除（连带 .mjs / .cpt，需确认）" onClick={() => { if (confirm(`删除页面 ${pg.name}？连带 .mjs / .cpt`)) void acts.deletePage(pg.name) }}><Icon n="trash" /></button>
        </div>
      </div>
      <TabsBar tabs={[{ k: 'src', n: '源码' }, { k: 'build', n: '构建', bdg: lastBuild && !lastBuild.ok ? '!' : undefined }, { k: 'prev', n: '预览' }]} cur={tab} onSelect={(k) => ctx.setTab(key, k)} />
      <div className="rp-body">
        {tab === 'src' && (
          <div className="blk">
            <div className="blk-t">
              <Icon n="code" />jsx 源码（全流程唯一手写产物）
              <span className="lnk" onClick={async () => {
                if (src === null) return
                setBusy('save')
                try { await acts.savePage(pg.name, src); setDirty(false) } finally { setBusy('') }
              }}>{busy === 'save' ? '保存中…' : dirty ? '保存*' : '保存'}</span>
            </div>
            <div style={{ border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden' }}>
              {src === null
                ? <div style={{ padding: 20, textAlign: 'center', color: 'var(--tx3)', fontSize: 12 }}>读取源码中…</div>
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
          <span className="tag src">{isMd ? 'Markdown' : 'SQL 源码'}</span>
          <span style={{ font: '10.5px/1 var(--mono)', color: 'var(--tx3)' }}>meta/ · {fmtBytes(doc.size)} · {fmtTime(new Date(doc.mtime).toISOString())}</span>
        </div>
        <div className="rp-acts">
          <button className="btn" onClick={async () => {
            if (content === null) return
            setBusy(true)
            try { await acts.saveDoc(doc.name, content); setDirty(false) } finally { setBusy(false) }
          }} disabled={busy || content === null}><Icon n="pen" />{busy ? '保存中…' : dirty ? '保存*' : '保存'}</button>
          <button className="btn acc-o" onClick={() => acts.useAgent(key)}><Icon n="ai" />用 Agent 做</button>
          <button className="iconbtn" title="删除（需确认）" onClick={() => { if (confirm(`删除文档 ${doc.name}？`)) void acts.deleteDoc(doc.name) }}><Icon n="trash" /></button>
        </div>
      </div>
      {isMd && <TabsBar tabs={[{ k: 'view', n: '阅读' }, { k: 'src', n: '源码' }]} cur={tab} onSelect={(k) => ctx.setTab(key, k)} />}
      <div className="rp-body">
        {content === null ? <div className="nores">读取中…</div> : tab === 'view'
          ? <div className="md" dangerouslySetInnerHTML={{ __html: mdToHtml(content) }} />
          : isMd
            ? <div style={{ border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden' }}>
                <MdEditor value={content} height="460px" onChange={(v) => { setContent(v); setDirty(true) }} />
              </div>
            : <div style={{ border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden' }}>
                <SqlEditor value={content} height="460px" onChange={(v) => { setContent(v); setDirty(true) }} />
              </div>}
        {!isMd && <div className="banner info" style={{ marginTop: 10 }}><Icon n="info" /><div><b>D4</b>：过程创建语句存于项目 meta/，与库内实际定义互为备份（「存储过程」面板的保存也写这里）</div></div>}
      </div>
    </div>
  )
}

// ── Agent 面板（工作台右栏 · D7） ───────────────────────────────

function AgentPanel({ ctx, project, onBack }: { ctx: { project: string; resource?: string } | null; project: Project | null; onBack: () => void }): React.ReactElement {
  const panelRef = useRef<ChatPanelElement | null>(null)
  const [state, setState] = useState<{ ready: boolean; mode?: string; error?: string; ctxSent?: string }>({ ready: false })
  const digest = buildDigest(ctx, project)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const handle = await getSharedPiAgent()
        if (!alive) return
        await panelRef.current?.setAgent?.(handle.agent, { onApiKeyRequired: async () => true })
        if (alive) setState({ ready: true, mode: handle.mode })
      } catch (e) {
        if (alive) setState({ ready: false, error: (e as Error).message })
      }
    })()
    return () => { alive = false }
  }, [])

  const sendCtx = async () => {
    if (!digest || !state.ready) return
    const { getSharedPiAgent } = await import('../../agent/piAgent')
    const handle = await getSharedPiAgent()
    await handle.agent.prompt(digest)
    setState((s) => ({ ...s, ctxSent: ctx?.resource }))
  }

  return (
    <div className="rp">
      <div className="ag-head">
        <button className="iconbtn" title="返回详情" onClick={onBack}><Icon n="back" /></button>
        <span className="ttl">Agent 会话</span>
        {state.mode === 'faux' && <span className="tag upd">Faux 演示</span>}
        {state.mode === 'real' && <span className="tag dict">真实模型</span>}
        <button className="iconbtn" title="在「Agent」页查看完整会话与历史" onClick={onBack}><Icon n="clock" /></button>
      </div>
      <div className="ag-ctx">
        {ctx?.project && <span className="ctx-chip">项目 <b>{ctx.project}</b></span>}
        {ctx?.resource && <span className="ctx-chip">资源 <b>{ctx.resource}</b></span>}
        {project?.connections.map((c) => <span key={c} className="ctx-chip">连接 <b>{c}</b></span>)}
        {digest && state.ctxSent !== ctx?.resource && (
          <button className="btn sm acc-o" onClick={() => void sendCtx()} disabled={!state.ready}><Icon n="send" />把上下文发给 Agent</button>
        )}
      </div>
      <div className="ag-thread-wrap rc-pi-agent" style={{ padding: '8px 10px 10px', display: 'flex' }}>
        {state.error
          ? <div className="banner err" style={{ margin: 12 }}><Icon n="cx" /><div><b>Agent 初始化失败</b><br />{state.error}</div></div>
          : !state.ready
            ? <div className="banner info" style={{ margin: 12 }}><Icon n="info" /><div>正在初始化（加载平台工具与会话）…</div></div>
            : null}
        <pi-chat-panel ref={panelRef} style={{ flex: 1, minHeight: 0 }} />
      </div>
    </div>
  )
}

/** 组装上下文摘要（发送给 Agent 的第一条消息） */
function buildDigest(ctx: { project: string; resource?: string } | null, project: Project | null): string {
  if (!ctx) return ''
  const lines = [`[上下文] 当前项目：${ctx.project}`]
  if (project) lines.push(`绑定连接：${project.connections.join('、')}`)
  if (ctx.resource) {
    const [kind, name] = [ctx.resource.slice(0, ctx.resource.indexOf(':')), ctx.resource.slice(ctx.resource.indexOf(':') + 1)]
    const kindName = kind === 'if' ? '数据接口' : kind === 'sp' ? '存储过程' : kind === 'pg' ? '页面' : '文档'
    lines.push(`当前选中资源：${kindName} ${name}`)
    lines.push(`请先用相应工具（${kind === 'if' ? 'list_datasets' : kind === 'sp' ? 'read_procedure' : kind === 'pg' ? 'read_page' : 'read_doc'}）了解它的现状，再等我下一步指示。`)
  }
  return lines.join('\n')
}
