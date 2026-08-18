/**
 * 项目工作台 — 左中右三栏容器（设计稿 3.1 / 3.2）
 * 左：项目选择器（新建/打开）；中：四组资源浏览器；右：操作面板（RightPanel）
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '../../components/Icon'
import { fmtBytes, useToast } from '../../components/ui'
import { call } from '../../api'
import type { Project, Dataset, DatasetStatus, ProcRecord, PageMeta, DocMeta, TraditionalCptMeta, StatusPayload, DbConnection, BuildResult } from '@shared/types'
import RightPanel, { type WBData, type WBActs } from './RightPanel'
import {
  ProjectWizardModal, DatasetEditModal, ApplyProcModal, CallProcModal, LinkProcModal, NewProcModal,
  DocNameModal, ProjectSettingsModal, type LinkableProc
} from './modals'

type ModalState =
  | { k: 'wizard' }
  | { k: 'dataset'; init: Partial<Dataset> & { name: string } }
  | { k: 'applyproc'; name: string; connection: string; linkedFrom?: string }
  | { k: 'callproc'; name: string; connection: string }
  | { k: 'linkproc'; linkable: LinkableProc[] }
  | { k: 'newproc' }
  | { k: 'newdoc' }
  | { k: 'docrename'; old: string }
  | { k: 'projsettings' }
  | null

import { KIND_TAG } from './kinds'

export default function WorkbenchView(): React.ReactElement {
  const toast = useToast()
  const [menuNode, openMenu] = useMenuState()
  const [projects, setProjects] = useState<Project[]>([])
  const [status, setStatus] = useState<StatusPayload | null>(null)
  const [conns, setConns] = useState<DbConnection[]>([])
  const [cur, setCur] = useState<string | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [tab, setTabState] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [modal, setModal] = useState<ModalState>(null)
  const [agentMode, setAgentMode] = useState(true)
  const [agentCtx, setAgentCtx] = useState<{ project: string; resource?: string } | null>(null)

  // 项目资源
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [statuses, setStatuses] = useState<Record<string, DatasetStatus>>({})
  const [procs, setProcs] = useState<ProcRecord[]>([])
  const [pages, setPages] = useState<PageMeta[]>([])
  const [docs, setDocs] = useState<DocMeta[]>([])
  const [traditionalCpts, setTraditionalCpts] = useState<TraditionalCptMeta[]>([])

  const curProject = useMemo(() => projects.find((p) => p.name === cur) ?? null, [projects, cur])

  const setTab = useCallback((k: string, t: string) => setTabState((m) => ({ ...m, [k]: t })), [])

  const loadProjects = useCallback(async () => {
    try {
      const [ps, st, cs] = await Promise.all([
        call<Project[]>('projects:list'),
        call<StatusPayload>('status:get').catch(() => null),
        call<DbConnection[]>('conns:list')
      ])
      setProjects(ps)
      setStatus(st)
      setConns(cs)
      setCur((c) => (c && ps.some((p) => p.name === c) ? c : (ps[0]?.name ?? null)))
    } catch (e) {
      toast((e as Error).message, 'err')
    }
  }, [toast])

  const loadResources = useCallback(async (project: string) => {
    try {
      const [ds, st, sp, pg, dc, legacy] = await Promise.all([
        call<Dataset[]>('datasets:list', { project }),
        call<Record<string, DatasetStatus>>('datasets:statuses', { project }).catch(() => ({})),
        call<ProcRecord[]>('procs:list', { project }).catch(() => []),
        call<PageMeta[]>('pages:list', { project }).catch(() => []),
        call<DocMeta[]>('docs:list', { project }).catch(() => []),
        call<TraditionalCptMeta[]>('resources:traditionalCpts', { project }).catch(() => [])
      ])
      setDatasets(ds)
      setStatuses(st)
      setProcs(sp)
      setPages(pg)
      setDocs(dc)
      setTraditionalCpts(legacy)
    } catch (e) {
      toast((e as Error).message, 'err')
    }
  }, [toast])

  useEffect(() => { void loadProjects() }, [loadProjects])
  useEffect(() => {
    if (cur) void loadResources(cur)
    // 冒烟深链：?sel=1 自动选中第一个资源（核对选中态样式）
    if (sel === null && new URLSearchParams(window.location.search).get('sel') === '1') {
      setSel('if:__pending__')
    }
  }, [cur, loadResources, sel])

  const refresh = useCallback(async () => {
    await loadProjects()
    if (cur) await loadResources(cur)
  }, [loadProjects, loadResources, cur])

  const importDoc = useCallback(async () => {
    if (!cur) return
    try {
      const source = await call<string | null>('dialog:pickDoc', { title: '选择要导入到项目 meta/ 的文档或前端源码' })
      if (!source) return
      const doc = await call<DocMeta>('docs:import', { project: cur, source })
      toast(`已导入 meta/${doc.name}`, 'ok')
      await refresh()
      setSel(`doc:${doc.name}`)
    } catch (e) {
      toast((e as Error).message, 'err')
    }
  }, [cur, refresh, toast])

  useEffect(() => {
    if (sel === 'if:__pending__' && datasets.length) setSel(`if:${datasets[0].name}`)
  }, [datasets, sel])

  // 右栏以 Agent 为默认；点资源才临时进入详情，关闭详情回到原会话。
  useEffect(() => {
    if (sel && sel !== 'if:__pending__') setAgentMode(false)
  }, [sel])

  const selectProject = (name: string) => {
    setCur(name)
    setSel(null)
    setAgentCtx({ project: name })
    setAgentMode(true)
  }

  /** 打开本地项目：选目录 → 读 project.yaml 注册进本机账本 */
  const openLocalProject = async () => {
    try {
      const dir = await call<string | null>('dialog:pickDir', { title: '打开本地项目（含 project.yaml 的目录）' })
      if (!dir) return
      const p = await call<Project>('projects:open', { dir })
      toast(`已打开项目 ${p.name}`, 'ok')
      await loadProjects()
      selectProject(p.name)
    } catch (e) {
      toast((e as Error).message, 'err')
    }
  }

  // ── 动作（右栏调用；成功后刷新） ─────────────────────────────
  const acts: WBActs = {
    verify: async () => {
      if (!cur) return
      toast('一键验收：构建 + 实测全部接口…')
      try {
        const r = await call<{ build: BuildResult; tests: Array<{ dataset: string; ok: boolean; errCode: number | null; rowCount: number }> }>('verify:project', { project: cur })
        const failed = r.tests.filter((t) => !t.ok)
        toast(r.build.ok && failed.length === 0
          ? `验收通过：${r.tests.length} 个接口帆软实测全部通过`
          : `验收未通过：构建 ${r.build.ok ? '通过' : '失败'}，${failed.length}/${r.tests.length} 接口失败`,
          r.build.ok && failed.length === 0 ? 'ok' : 'err')
        if (failed.length) failed.forEach((f) => toast(`${f.dataset} 实测失败（err_code=${f.errCode}）`, 'err'))
        await refresh()
      } catch (e) {
        toast((e as Error).message, 'err')
      }
    },
    editDataset: (ds) => setModal({ k: 'dataset', init: ds }),
    deleteDataset: async (name) => {
      try { await call('datasets:delete', { project: cur, name }); toast(`已删除接口 ${name}`, 'ok'); await refresh() } catch (e) { toast((e as Error).message, 'err') }
    },
    buildData: async () => {
      if (!cur) return null
      try {
        const r = await call<BuildResult>('build:dataCpt', { project: cur })
        toast(r.ok ? `构建通过，已落盘 ${r.target}` : `构建未通过（${r.findings.filter((f) => f.severity === 'error').length} error），未落盘`, r.ok ? 'ok' : 'err')
        await refresh()
        return r
      } catch (e) { toast((e as Error).message, 'err'); return null }
    },
    testDataset: async (name) => {
      if (!cur) return null
      try {
        const r = await call<{ ok: boolean; errCode: number | null; durationMs: number; rowCount: number; response: unknown }>('test:dataset', { project: cur, dataset: name })
        toast(r.ok ? `${name}: 帆软实测通过，${r.rowCount} 行 ${r.durationMs}ms` : `${name}: 实测失败（err_code=${r.errCode}）`, r.ok ? 'ok' : 'err')
        await refresh()
        return r
      } catch (e) { toast((e as Error).message, 'err'); return null }
    },
    savePage: async (page, content) => {
      try { await call('pages:save', { project: cur, page, content, overwrite: true }); toast(`已保存 ${page}.jsx`, 'ok'); await refresh() } catch (e) { toast((e as Error).message, 'err') }
    },
    buildPage: async (page) => {
      try {
        const r = await call<BuildResult>('pages:build', { project: cur, page })
        toast(r.ok ? `页面构建通过：${page}.mjs + ${page}.cpt` : `质量门未通过（${r.findings.filter((f) => f.severity === 'error').length} error），.cpt 未落盘`, r.ok ? 'ok' : 'err')
        await refresh()
        return r
      } catch (e) { toast((e as Error).message, 'err'); return null }
    },
    openPage: async (page) => {
      try { await call('pages:open', { project: cur, page }) } catch (e) { toast((e as Error).message, 'err') }
    },
    deletePage: async (page) => {
      try { await call('pages:delete', { project: cur, page }); toast(`已删除页面 ${page}（连带 .mjs/.cpt）`, 'ok'); setSel(null); await refresh() } catch (e) { toast((e as Error).message, 'err') }
    },
    createPage: async (page, starter) => {
      try {
        await call('pages:create', { project: cur, page, starter })
        toast(`已创建 ${page}.jsx（${starter} 脚手架）`, 'ok')
        await refresh()
        setSel(`pg:${page}`)
      } catch (e) { toast((e as Error).message, 'err') }
    },
    saveProcDef: async (rec, def) => {
      try {
        await call('procs:save', { project: cur, name: rec.name, connection: rec.connection, comment: rec.comment, definition: def })
        toast(`已保存过程定义 meta/${rec.name}.sql`, 'ok')
        await refresh()
      } catch (e) { toast((e as Error).message, 'err') }
    },
    applyProc: (rec) => setModal({ k: 'applyproc', name: rec.name, connection: rec.connection, linkedFrom: rec.own ? undefined : rec.srcProject }),
    callProc: (rec) => setModal({ k: 'callproc', name: rec.name, connection: rec.connection }),
    unlinkProc: async (rec) => {
      try { await call('procs:unlink', { project: cur, procedureId: rec.id }); toast(`已解除关联 ${rec.name}`, 'ok'); setSel(null); await refresh() } catch (e) { toast((e as Error).message, 'err') }
    },
    deleteProc: async (name) => {
      try { await call('procs:delete', { project: cur, name }); toast(`已删除过程 ${name}`, 'ok'); setSel(null); await refresh() } catch (e) { toast((e as Error).message, 'err') }
    },
    saveDoc: async (name, content) => {
      try { await call('docs:save', { project: cur, name, content, overwrite: true }); toast(`已保存 ${name}`, 'ok'); await refresh() } catch (e) { toast((e as Error).message, 'err') }
    },
    deleteDoc: async (name) => {
      try { await call('docs:delete', { project: cur, name }); toast(`已删除 ${name}`, 'ok'); setSel(null); await refresh() } catch (e) { toast((e as Error).message, 'err') }
    },
    openProjectSettings: () => setModal({ k: 'projsettings' }),
    deleteProject: () => {
      if (!cur) return
      const input = prompt(`删除项目 ${cur}？仅解除管理（契约/关联清空），reportlets 产物保留。\n输入项目名确认：`)
      if (input === cur) {
        void (async () => {
          try {
            await call('projects:delete', { id: curProject?.id })
            toast(`已删除项目 ${cur}（产物保留在 ${curProject?.dir}）`, 'ok')
            setCur(null); setSel(null)
            await loadProjects()
          } catch (e) { toast((e as Error).message, 'err') }
        })()
      } else if (input !== null) {
        toast('项目名不匹配，已取消', 'err')
      }
    },
    useAgent: (resource) => {
      if (!cur) return
      setAgentCtx({ project: cur, resource })
      setAgentMode(true)
    }
  }

  // ── 中栏数据 ────────────────────────────────────────────────
  const q = search.trim().toLowerCase()
  const match = (n: string) => !q || n.toLowerCase().includes(q)

  const connHealthMap = useMemo(() => {
    const m: Record<string, boolean> = {}
    for (const c of status?.connections ?? []) m[c.name] = c.reachable
    return m
  }, [status])

  const downConns = curProject ? curProject.connections.filter((c) => connHealthMap[c] === false) : []
  const data: WBData = { datasets, statuses, procs, pages, docs, traditionalCpts }

  return (
    <div className="stage">
      <div className="cols">
        {/* 左栏：项目选择器（设计稿 3.1） */}
        <aside className="col-left">
          <div className="colhead">
            <span className="t">项目</span>
            <span className="sub">{projects.length ? `${projects.length} 个` : ''}</span>
          </div>
          <div className="cl-list">
            {projects.length === 0 && (
              <div className="cl-empty">
                <h4>欢迎使用 Report Console</h4>
                <p>还没有项目。项目是顶层的组织单元：绑定一个 reportlets 目录与多个数据库连接。</p>
                <button className="big" onClick={() => setModal({ k: 'wizard' })}><Icon n="plus" /><span><b>新建项目</b><span>名称 · 目录 · 勾选连接 · 写入 project.yaml</span></span></button>
                <button className="big" onClick={() => void openLocalProject()}><Icon n="folderOpen" /><span><b>打开本地项目</b><span>选择含 project.yaml 的目录，注册进本机</span></span></button>
                <ScanButton onScaned={loadProjects} />
              </div>
            )}
            {projects.map((p) => (
              <div key={p.id} className={`pj${cur === p.name ? ' on' : ''}${p.missingDir ? ' missing' : ''}`} onClick={() => selectProject(p.name)} title={p.comment || p.name}>
                <div className="nm">
                  {p.name}
                  {p.missingDir && <span className="pc-warn" title="项目目录缺失：目录已被移动或删除，资源只读"><Icon n="alert" size={14} /></span>}
                </div>
                <div className="dir" title={p.dir}>{p.dir}</div>
                <div className="badges">
                  {p.connections.map((c) => <span key={c} className={`cbadge${connHealthMap[c] === false ? ' off' : ''}`}><i />{c}</span>)}
                </div>
                <div className="sum">
                  <span>接口 {p.counts.ifs}</span><span>过程 {p.counts.sps}</span><span>页面 {p.counts.pgs}</span><span>文档 {p.counts.docs}</span>
                  {p.missingDir && ' · 目录缺失'}
                </div>
              </div>
            ))}
            {projects.length > 0 && (
              <div className="pj-actions">
                <button className="newpj" onClick={() => setModal({ k: 'wizard' })}><Icon n="plus" size={14} />新建项目</button>
                <button className="newpj" onClick={() => void openLocalProject()}><Icon n="folderOpen" size={14} />打开项目</button>
              </div>
            )}
          </div>
        </aside>

        {/* 中栏：资源浏览器（设计稿 3.2） */}
        <section className="col-mid">
          <div className="colhead">
            <span className="t">资源</span>
            <label className="search">
              <Icon n="search" size={13} />
              <input value={search} placeholder="搜索资源名称" onChange={(e) => setSearch(e.target.value)} />
            </label>
            <span className="grow" />
            <span className="sub">{[datasets, procs, pages, docs].flat().filter((x) => match(x.name)).length} 项{q ? ` · 匹配「${q}」` : ''}</span>
          </div>

          {curProject?.missingDir && (
            <div className="mid-banner"><Icon n="alert" /><div><b>项目目录缺失</b>：{curProject.dir} 不存在（可能被移动或删除）。以下条目来自 SQLite 账本缓存，浏览与编辑可用，<b>构建 / 实测 / 预览已禁用</b>。可在项目设置中重新绑定。</div></div>
          )}
          {!curProject?.missingDir && curProject && downConns.length > 0 && (
            <div className="mid-banner"><Icon n="alert" /><div><b>{downConns.join('、')} 连接不可达</b>：绑定该连接的接口构建 / 实测暂不可用，浏览与编辑不受影响。</div></div>
          )}

          <div className="mid-scroll">
            {!cur ? (
              <div style={{ padding: '48px 20px', textAlign: 'center' }}>
                <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--accent-s)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', marginBottom: 16 }}>
                  <Icon n="box" />
                </div>
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>开始第一个项目</div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.7, maxWidth: 400, margin: '0 auto 18px' }}>
                  项目是 Report Console 的顶层组织单元：绑定一个 reportlets 目录与若干 MySQL 连接，收纳数据接口、存储过程、页面与文档。已有目录也可以扫描导入。
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                  <button className="btn pri" onClick={() => setModal({ k: 'wizard' })}><Icon n="plus" />新建项目</button>
                  <ScanButton onScaned={loadProjects} />
                </div>
                <div style={{ marginTop: 22, fontSize: 11.5, color: 'var(--faint)' }}>还没有 MySQL 连接？先到「连接」注册（与帆软设计器里的数据连接同名）</div>
              </div>
            ) : (
              <>
                {/* 文档（需求先行，放最前） */}
                <Group
                  gk="docs" title="文档（元数据）" one="文档" count={docs.length} collapsed={collapsed} onToggle={(g) => setCollapsed((c) => ({ ...c, [g]: !c[g] }))}
                  extra={<>
                    <span className="gact" onClick={() => void importDoc()}><Icon n="folderOpen" size={12} />导入文档</span>
                    <span className="gact" onClick={() => setModal({ k: 'newdoc' })}><Icon n="plus" size={12} />新建文档</span>
                  </>}
                  empty={{ t: '还没有文档' }}
                >
                  {docs.filter((x) => match(x.name)).map((x) => (
                    <div key={x.name} className={`row${sel === `doc:${x.name}` ? ' on' : ''}`} onClick={() => { setSel(`doc:${x.name}`); setAgentMode(false) }}>
                      <Icon n="file" />
                      <div className="main">
                        <div className="nm"><b>{x.name}</b></div>
                        <div className="sub">{x.type === 'markdown' ? 'Markdown' : x.type === 'sql' ? 'SQL' : /\.(js|jsx|mjs)$/i.test(x.name) ? 'JavaScript' : /\.css$/i.test(x.name) ? 'CSS' : '文本'} · meta/ 目录</div>
                      </div>
                      <div className="meta">{fmtShort(new Date(x.mtime).toISOString())}</div>
                      <button className="row-attach" title="附加到 Agent" onClick={(e) => { e.stopPropagation(); acts.useAgent(`doc:${x.name}`) }}><Icon n="ai" size={13} /></button>
                    </div>
                  ))}
                </Group>

                {/* 页面 */}
                <Group
                  gk="pgs" title="页面" one="页面" count={pages.length} collapsed={collapsed} onToggle={(g) => setCollapsed((c) => ({ ...c, [g]: !c[g] }))}
                  extra={<span className="gact" onClick={(e) => {
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                    pageMenuAt(r.left, r.bottom + 6)
                  }}><Icon n="plus" size={12} />新建页面</span>}
                  empty={{ t: '还没有页面' }}
                >
                  {pages.filter((x) => match(x.name)).map((x) => {
                    const stl = x.stale ? ['old', 'cpt 落后 jsx，待重建'] : x.cptExists ? ['new', '最新'] : ['none', '从未构建']
                    return (
                      <div key={x.name} className={`row${sel === `pg:${x.name}` ? ' on' : ''}`} onClick={() => { setSel(`pg:${x.name}`); setAgentMode(false) }}>
                        <span className={`st ${x.stale ? 'y' : 'g'}`} title={stl[1]} />
                        <div className="main">
                          <div className="nm"><b>{x.name}</b><span className={`stale ${stl[0]}`}>{stl[1]}</span></div>
                          <div className="sub">{fmtBytes(x.size)} · 产物 {x.cptExists ? '.mjs+.cpt' : '-'}</div>
                        </div>
                        <div className="meta">构建<br />{x.lastBuildAt ? fmtShort(x.lastBuildAt) : '-'}</div>
                        <button className="row-attach" title="附加到 Agent" onClick={(e) => { e.stopPropagation(); acts.useAgent(`pg:${x.name}`) }}><Icon n="ai" size={13} /></button>
                      </div>
                    )
                  })}
                </Group>

                {/* 数据接口 */}
                <Group
                  gk="ifs" title="数据接口" one="接口" count={datasets.length} collapsed={collapsed} onToggle={(g) => setCollapsed((c) => ({ ...c, [g]: !c[g] }))}
                  extra={<>
                    <span className="gact" onClick={() => acts.useAgent()}><Icon n="ai" size={12} />用 Agent 做</span>
                    <span className="gact" onClick={() => setModal({ k: 'dataset', init: { name: '', kind: 'list' } })}><Icon n="plus" size={12} />新建接口</span>
                  </>}
                  empty={{ t: '还没有数据接口' }}
                >
                  {datasets.filter((x) => match(x.name)).map((x) => {
                    const st = statuses[x.name]?.test
                    const kind = KIND_TAG[x.kind] ?? KIND_TAG.other
                    const connDown = connHealthMap[x.connection] === false
                    let stt = 'n', sub: React.ReactNode = '未测'
                    if (st?.st === 'ok') { stt = 'g'; sub = <><span style={{ color: 'var(--ok)' }}>帆软实测通过</span> {st.rows ?? '-'} 行 {st.ms ?? '-'}ms</> }
                    else if (st?.st === 'fail') { stt = 'r'; sub = <><span style={{ color: 'var(--bad)' }}>实测失败</span> {st.why?.slice(0, 60)}</> }
                    else if (connDown) { sub = <span style={{ color: 'var(--idle)' }}>连接不可达（{x.connection}）</span> }
                    if (curProject?.missingDir) sub = '账本缓存 · 目录缺失'
                    return (
                      <div key={x.name} className={`row${sel === `if:${x.name}` ? ' on' : ''}`} onClick={() => { setSel(`if:${x.name}`); setAgentMode(false) }}>
                        <span className={`st ${stt}`} />
                        <div className="main">
                          <div className="nm"><b>{x.name}</b><span className={`tag ${kind.cls}`} title={kind.tip}>{kind.label}</span></div>
                          <div className="sub"><span className="cbadge"><Icon n="db" />{x.connection}</span>{sub}</div>
                        </div>
                        <div className="meta">构建<br />{fmtShort(statuses[x.name]?.build)}</div>
                        <button className="row-attach" title="附加到 Agent" onClick={(e) => { e.stopPropagation(); acts.useAgent(`if:${x.name}`) }}><Icon n="ai" size={13} /></button>
                      </div>
                    )
                  })}
                </Group>

                {/* 存储过程 */}
                <Group
                  gk="sps" title="存储过程" one="过程" count={procs.length} collapsed={collapsed} onToggle={(g) => setCollapsed((c) => ({ ...c, [g]: !c[g] }))}
                  extra={<>
                    <span className="gact" onClick={async () => {
                      try {
                        const linkable = await call<LinkableProc[]>('procs:linkable', { project: cur })
                        setModal({ k: 'linkproc', linkable })
                      } catch (e) { toast((e as Error).message, 'err') }
                    }}><Icon n="link" size={12} />关联</span>
                    <span className="gact" onClick={() => setModal({ k: 'newproc' })}><Icon n="plus" size={12} />从模板新建</span>
                  </>}
                  empty={{ t: '还没有存储过程' }}
                >
                  {procs.filter((x) => match(x.name)).map((x) => (
                    <div key={`${x.own ? 'o' : 'l'}:${x.name}`} className={`row${sel === `sp:${x.name}` ? ' on' : ''}`} onClick={() => { setSel(`sp:${x.name}`); setAgentMode(false) }}>
                      <span className="st n" style={{ borderRadius: 3 }} />
                      <div className="main">
                        <div className="nm">
                          <b>{x.name}</b>
                          {x.own ? <span className="tag own">本项目创建</span> : <span className="tag lnk"><Icon n="link" />关联自「{x.srcProject}」</span>}
                        </div>
                        <div className="sub">{x.comment || '-'}</div>
                      </div>
                      <div className="meta">{fmtShort(x.updatedAt)}<br />{x.appliedCount} 次应用</div>
                      <button className="row-attach" title="附加到 Agent" onClick={(e) => { e.stopPropagation(); acts.useAgent(`sp:${x.name}`) }}><Icon n="ai" size={13} /></button>
                    </div>
                  ))}
                </Group>
              </>
            )}
          </div>
        </section>

        {/* 右栏：操作面板 / Agent */}
        <aside className="col-right">
          <RightPanel
            ctx={{ project: curProject, sel, tab, setTab }}
            data={data}
            acts={acts}
            agentMode={agentMode}
            agentCtx={agentCtx}
            onExitAgent={() => { setSel(null); setAgentCtx(cur ? { project: cur } : null); setAgentMode(true) }}
            onResourcesChanged={() => { void refresh() }}
          />
        </aside>
      </div>

      {/* 新建菜单（头部） */}
      {menuNode}

      {/* 弹层 */}
      {modal?.k === 'wizard' && (
        <ProjectWizardModal
          connections={conns}
          reportletsPath={status?.reportletsPath ?? ''}
          onClose={() => setModal(null)}
          onCreate={async (name, dir, cs, comment) => {
            await call('projects:create', { name, connections: cs, comment, dir })
            toast(`项目 ${name} 已创建（project.yaml 与默认目录就绪）`, 'ok')
            setModal(null)
            await loadProjects()
            selectProject(name)
          }}
        />
      )}
      {modal?.k === 'dataset' && (
        <DatasetEditModal
          project={cur ?? ''}
          boundConns={curProject?.connections ?? []}
          init={modal.init}
          onClose={() => setModal(null)}
          onSave={async (input) => {
            await call('datasets:save', { project: cur, ...input })
            toast(`接口 ${input.name} 已保存（幂等 upsert）`, 'ok')
            setModal(null)
            await refresh()
            setSel(`if:${input.name}`)
          }}
        />
      )}
      {modal?.k === 'applyproc' && (
        <ApplyProcModal
          name={modal.name} connection={modal.connection} linkedFrom={modal.linkedFrom}
          onClose={() => setModal(null)}
          onConfirm={async () => {
            const r = await call<{ ok: boolean; error?: string }>('procs:apply', { project: cur, name: modal.name })
            if (!r.ok) throw new Error(r.error ?? '应用失败')
            toast(`过程 ${modal.name} 已应用（DROP+CREATE），审计已落 ddl_log`, 'ok')
            setModal(null)
            await refresh()
          }}
        />
      )}
      {modal?.k === 'callproc' && (
        <CallProcModal
          connection={modal.connection}
          initSql={`CALL ${modal.name}();`}
          onClose={() => setModal(null)}
          onRun={async (sqlText) => {
            const r = await call<{ ok: boolean; error?: string; result?: unknown }>('procs:call', { sql: sqlText, connection: modal.connection })
            if (!r.ok && r.error) return { error: r.error }
            return r.result ?? r
          }}
        />
      )}
      {modal?.k === 'linkproc' && (
        <LinkProcModal
          linkable={modal.linkable}
          onClose={() => setModal(null)}
          onLink={async (procId) => {
            await call('procs:link', { project: cur, procedureId: procId })
            toast('已关联', 'ok')
            setModal(null)
            await refresh()
          }}
        />
      )}
      {modal?.k === 'newproc' && (
        <NewProcModal
          boundConns={curProject?.connections ?? []}
          onClose={() => setModal(null)}
          onSave={async (input) => {
            await call('procs:save', { project: cur, ...input })
            toast(`过程 ${input.name} 契约与定义已保存（meta/${input.name}.sql）`, 'ok')
            setModal(null)
            await refresh()
            setSel(`sp:${input.name}`)
          }}
        />
      )}
      {modal?.k === 'newdoc' && (
        <DocNameModal
          title="新建文档" initName=""
          onClose={() => setModal(null)}
          onSave={async (name) => {
            await call('docs:save', { project: cur, name, content: `# ${name.replace(/\.(md|txt|html|sql)$/i, '').replace(/^\d+-/, '')}\n\n` })
            toast(`已创建 meta/${name}`, 'ok')
            setModal(null)
            await refresh()
            setSel(`doc:${name}`)
          }}
        />
      )}
      {modal?.k === 'docrename' && (
        <DocNameModal
          title="重命名文档" initName={modal.old}
          onClose={() => setModal(null)}
          onSave={async (name) => {
            await call('docs:rename', { project: cur, name: modal.old, newName: name })
            setModal(null)
            await refresh()
            setSel(`doc:${name}`)
          }}
        />
      )}
      {modal?.k === 'projsettings' && curProject && (
        <ProjectSettingsModal
          name={curProject.name} comment={curProject.comment} dir={curProject.dir} connections={curProject.connections} allConns={conns} pages={pages}
          onClose={() => setModal(null)}
          onSave={async (comment, cs, dir, pagePaths) => {
            await call('projects:update', { id: curProject.id, comment, connections: cs, dir })
            for (const page of pagePaths) {
              await call('pages:updatePaths', { project: curProject.name, page: page.name, paths: { jsx: page.jsx, mjs: page.mjs, cpt: page.cpt } })
            }
            toast('项目设置已保存', 'ok')
            setModal(null)
            await refresh()
          }}
        />
      )}
    </div>
  )

  // ── 弹出菜单 ────────────────────────────────────────────────

  function pageMenuAt(x: number, y: number): void {
    openMenu(x, y, [
      { i: 'file', t: 'blank 脚手架', s: '空白页', onClick: () => askCreatePage('blank') },
      { i: 'file', t: 'list 脚手架', s: '列表页', onClick: () => askCreatePage('list') },
      { i: 'file', t: 'form 脚手架', s: '表单页', onClick: () => askCreatePage('form') }
    ])
  }

  function askCreatePage(starter: string): void {
    const name = prompt(`页面名（小写字母/数字/下划线，${starter} 脚手架）：`)
    if (!name) return
    if (!/^[a-z][a-z0-9_]*$/.test(name)) { toast('页面名仅允许小写字母/数字/下划线', 'err'); return }
    void acts.createPage(name, starter)
  }
}

// ── 菜单 hook 替代（简单受控弹层） ───────────────────────────────

function useMenuState(): [React.ReactNode, (x: number, y: number, items: Array<{ i?: string; t?: string; s?: string; div?: boolean; onClick?: () => void }>) => void] {
  const [menu, setMenu] = useState<{ x: number; y: number; items: Array<{ i?: string; t?: string; s?: string; div?: boolean; onClick?: () => void }> } | null>(null)
  useEffect(() => {
    if (!menu) return
    const h = () => setMenu(null)
    window.addEventListener('click', h)
    return () => window.removeEventListener('click', h)
  }, [menu])
  const node = menu ? (
    <div id="pop" style={{ display: 'block', left: Math.max(8, menu.x), top: Math.min(menu.y, window.innerHeight - menu.items.length * 34 - 20) }} onClick={(e) => e.stopPropagation()}>
      {menu.items.map((it, k) => it.div
        ? <div key={k} className="pdiv" />
        : (
          <div key={k} className="pi" onClick={() => { setMenu(null); it.onClick?.() }}>
            {it.i && <Icon n={it.i} />}{it.t}{it.s && <small>{it.s}</small>}
          </div>
        ))}
    </div>
  ) : <></>
  return [node, (x, y, items) => setMenu({ x, y, items })]
}

// ── 分组容器 ────────────────────────────────────────────────────

function Group({ gk, title, one, count, collapsed, onToggle, extra, empty, children }: {
  gk: string; title: string; one: string; count: number
  collapsed: Record<string, boolean>
  onToggle: (g: string) => void
  extra?: React.ReactNode
  empty?: { t: string; d?: string }
  children: React.ReactNode
}): React.ReactElement {
  const col = collapsed[gk]
  const hasItems = count > 0
  return (
    <div className="grp">
      <div className="grp-h">
        <span className="gt" onClick={() => onToggle(gk)}><Icon n={col ? 'chr' : 'chd'} />{title}</span>
        <span className="cnt">{count}</span>
        <span className="grow" />
        {extra}
      </div>
      {!col && (hasItems
        ? <div className="rows">{children}</div>
        : <div className="rows"><div className="grp-empty">
            <div className="e1">{empty?.t ?? `还没有${one}`}</div>
            {empty?.d && <div className="e2">{empty.d}</div>}
          </div></div>)}
    </div>
  )
}

function ScanButton({ onScaned }: { onScaned: () => void }): React.ReactElement {
  const toast = useToast()
  return (
    <button className="big" onClick={() => {
      void (async () => {
        try {
          const dirs = await call<string[]>('projects:scan')
          if (!dirs.length) { toast('没有发现可导入的已部署目录', 'err'); return }
          const pick = dirs[0]
          if (!confirm(`发现目录：${dirs.join('、')}\n导入第一个「${pick}」为项目？（绑定第一个连接）`)) return
          await call('projects:import', { json: JSON.stringify({ name: pick, comment: '从目录扫描导入' }), overwrite: false })
          toast(`已导入 ${pick}`, 'ok')
          onScaned()
        } catch (e) { toast((e as Error).message, 'err') }
      })()
    }}><Icon n="scan" /><span><b>从目录扫描导入</b><span>扫描 reportlets 已部署目录反向纳入管理</span></span></button>
  )
}

function fmtShort(s?: string): string {
  if (!s) return '-'
  return s.replace('T', ' ').slice(5, 16)
}
