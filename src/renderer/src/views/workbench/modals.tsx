/**
 * 工作台弹层 — 新建项目向导（名/目录分离）/ 接口契约编辑 / 过程确认 / CALL 试执行 / 关联过程 / 新建过程 / 文档
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from '../../components/Icon'
import { fmtBytes, Modal } from '../../components/ui'
import { SqlEditor } from '../../components/CodeEditor'
import { call } from '../../api'
import type { AppSettings, Dataset, DatasetKind, DatasetParam, DbConnection, LegacyMigrationPlan, LegacyMigrationResult, ProjectPlatform } from '@shared/types'

// ── 新建项目向导（3.1 / D1 / D4） ───────────────────────────────

export function ProjectWizardModal({ connections, reportletsPath, onClose, onCreate }: {
  connections: DbConnection[]
  reportletsPath: string
  onClose: () => void
  onCreate: (name: string, dir: string, conns: string[], comment: string, platform: ProjectPlatform) => Promise<void>
}): React.ReactElement {
  const [name, setName] = useState('')
  const [comment, setComment] = useState('')
  const [platform, setPlatform] = useState<ProjectPlatform>('desktop')
  const [dir, setDir] = useState('')
  const [dirTouched, setDirTouched] = useState(false) // 未手改时目录自动跟随 reportlets/{name}
  const [picked, setPicked] = useState<string[]>(connections.length === 1 ? [connections[0].name] : [])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const effDir = dirTouched ? dir : (reportletsPath && name ? `${reportletsPath.replace(/\/+$/, '')}/${name}` : dir)

  const browse = async () => {
    try {
      const d = await call<string | null>('dialog:pickDir', { title: '选择项目目录（可新建）' })
      if (d) { setDir(d); setDirTouched(true) }
    } catch { /* 取消或失败不处理 */ }
  }

  const create = async () => {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) { setErr('项目名仅允许小写字母/数字/下划线'); return }
    if (!effDir.trim()) { setErr('项目目录不能为空：填写路径或点「选择目录」'); return }
    if (!picked.length) { setErr('至少勾选一个连接'); return }
    setBusy(true)
    setErr(null)
    try { await onCreate(name, effDir.trim(), picked, comment, platform) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const leaf = effDir ? effDir.split(/[\\/]/).filter(Boolean).pop() ?? '' : '{project}'

  return (
    <Modal
      title="新建项目" icon="folder" onClose={onClose}
      footer={<>
        <span className="m-note">项目 = 可迁移目录（project.yaml 自描述）+ 本机连接绑定</span>
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn pri" onClick={create} disabled={busy}><Icon n="plus" />{busy ? '创建中…' : '创建项目'}</button>
      </>}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 10 }}>
        <div className="fld">
          <label>项目名（仅 [a-z][a-z0-9_]*）</label>
          <input type="text" value={name} spellCheck={false} placeholder="如 order" onChange={(e) => setName(e.target.value)} />
          <div className="fh">用于目录 / 接口前缀；中文名不可用</div>
        </div>
        <div className="fld">
          <label>项目目录（默认 reportlets/项目名，可另选）</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="text" style={{ flex: 1 }} value={effDir} spellCheck={false}
              placeholder={reportletsPath ? `${reportletsPath}/${name || '{project}'}` : '选择或输入项目目录'}
              onChange={(e) => { setDir(e.target.value); setDirTouched(true) }} />
            <button className="btn" onClick={() => void browse()}><Icon n="folderOpen" />选择目录</button>
          </div>
          <div className="fh">目录可任意位置；创建时写入 project.yaml（可被「打开项目」再次识别）</div>
        </div>
      </div>
      <div className="fld">
        <label>说明</label>
        <input type="text" value={comment} placeholder="项目用途（可选）" onChange={(e) => setComment(e.target.value)} />
      </div>
      <div className="fld">
        <label>目标端</label>
        <select value={platform} onChange={(e) => setPlatform(e.target.value as ProjectPlatform)}>
          <option value="desktop">桌面端</option>
          <option value="mobile">移动端</option>
          <option value="dual">双端（页面分别标记端型）</option>
        </select>
        <div className="fh">数据接口可共用；页面会按端型选择不同骨架、质量门和预览入口。旧项目保持桌面端。</div>
      </div>
      <div className="fld">
        <label>勾选连接（可多选，来自「连接」注册表）</label>
        {connections.length === 0
          ? <div className="banner warn"><Icon n="alert" /><div>注册表为空——先到「连接」页注册（名字与帆软数据连接一致）</div></div>
          : (
            <div className="cklist">
              {connections.map((c) => (
                <div key={c.name} className={`ck${picked.includes(c.name) ? ' on' : ''}`} onClick={() => setPicked((p) => p.includes(c.name) ? p.filter((x) => x !== c.name) : [...p, c.name])}>
                  <span className="cbx" /><b>{c.name}</b>　{c.host}:{c.port} / {c.database || '-'}
                  <span className="ck-m">{c.comment}</span>
                </div>
              ))}
            </div>
          )}
        <div className="fh">接口/过程创建时从绑定清单中选所属连接</div>
      </div>
      <div className="fld">
        <label>目录结构（自动创建）</label>
        <div className="tree">{leaf}/<br />├─ <span className="d">project.yaml</span>　<span className="c">项目清单：受管 jsx / mjs / cpt 的相对路径</span><br />├─ <span className="d">data/</span>　<span className="c">默认数据产物目录（可在清单中调整）</span><br />├─ <span className="d">pages/</span>　<span className="c">默认页面目录（可在清单中调整）</span><br />└─ <span className="d">任意子目录</span>　<span className="c">未声明的 CPT 保持为传统 CPT，不会被 Console 改写</span></div>
      </div>
      {err && <div className="banner err"><Icon n="cx" /><div>{err}</div></div>}
    </Modal>
  )
}

// ── fr-flow v3 历史项目迁移 ─────────────────────────────────────

export function LegacyMigrationModal({ connections, reportletsPath, onClose, onMigrated }: {
  connections: DbConnection[]
  reportletsPath: string
  onClose: () => void
  onMigrated: (result: LegacyMigrationResult) => Promise<void>
}): React.ReactElement {
  const [source, setSource] = useState('')
  const [plan, setPlan] = useState<LegacyMigrationPlan | null>(null)
  const [name, setName] = useState('')
  const [comment, setComment] = useState('从 fr-flow v3 历史目录迁移')
  const [dir, setDir] = useState('')
  const [picked, setPicked] = useState<string[]>(connections.length === 1 ? [connections[0].name] : [])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const effDir = dir || (reportletsPath && name ? `${reportletsPath.replace(/\/+$/, '')}/${name}` : '')

  const inspect = async (path: string) => {
    setBusy(true); setErr(null)
    try {
      const result = await call<LegacyMigrationPlan>('projects:inspectLegacy', { source: path })
      setSource(path); setPlan(result); setName(result.suggestedName)
    } catch (e) { setPlan(null); setErr((e as Error).message) } finally { setBusy(false) }
  }
  const browse = async () => {
    try {
      const path = await call<string | null>('dialog:pickDir', { title: '选择 fr-flow v3 历史项目目录（只读扫描）' })
      if (path) await inspect(path)
    } catch (e) { setErr((e as Error).message) }
  }
  const migrate = async () => {
    if (!plan || !source) { setErr('请先选择并扫描历史项目目录'); return }
    if (!/^[a-z][a-z0-9_]*$/.test(name)) { setErr('项目名仅允许小写字母/数字/下划线'); return }
    if (!effDir) { setErr('请填写新的 RC 项目目录'); return }
    if (!picked.length) { setErr('至少选择一个连接，用于导入数据集契约'); return }
    setBusy(true); setErr(null)
    try {
      const result = await call<LegacyMigrationResult>('projects:migrateLegacy', { source, name, dir: effDir, connections: picked, comment })
      await onMigrated(result)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const count = (items: string[]) => items.length ? `${items.length} 个` : '无'

  return <Modal wide title="迁移 fr-flow v3 历史项目" icon="scan" onClose={onClose}
    footer={<>
      <span className="m-note">旧目录只读；导入到新的 RC 目录，生成物由 RC 重新 build</span>
      <button className="btn" onClick={onClose}>取消</button>
      <button className="btn pri" disabled={!plan || busy} onClick={() => void migrate()}><Icon n="ai" />{busy ? '处理中…' : '导入并进入 Agent'}</button>
    </>}>
    <div className="fld">
      <label>1. 历史项目目录</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={source} readOnly placeholder="选择包含 JSX / _data.cpt / .cpt 的旧目录" style={{ flex: 1 }} />
        <button className="btn" disabled={busy} onClick={() => void browse()}><Icon n="folderOpen" />选择并扫描</button>
      </div>
      <div className="fh">扫描不会修改旧 fr-flow v3 目录，也不会把旧 MJS/CPT 标成 RC 受管产物。</div>
    </div>
    {plan && <>
      <div className={`banner ${plan.mode === 'lossless' ? 'info' : 'warn'}`}>
        <Icon n={plan.mode === 'lossless' ? 'cck' : 'alert'} /><div>
          <b>{plan.mode === 'lossless' ? '源文件齐全：可无损迁入 JSX、数据契约与 SQL 证据' : '需要尽力复原：将由 Agent 从传统 CPT / MJS 重写 JSX'}</b><br />
          JSX {count(plan.jsx)} · 数据 CPT {plan.dataCpt || '无'} · 传统 CPT {count(plan.legacyCpts)} · MJS {count(plan.mjs)} · SQL {count(plan.sql)} · 可导入接口 {plan.datasets.length}
        </div>
      </div>
      {plan.warnings.length > 0 && <div className="effects" style={{ marginTop: 10 }}>{plan.warnings.map((warning) => <div key={warning}>• {warning}</div>)}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '190px 1fr', gap: 10, marginTop: 12 }}>
        <div className="fld"><label>2. 新 RC 项目名</label><input value={name} spellCheck={false} onChange={(e) => setName(e.target.value)} /></div>
        <div className="fld"><label>新的 RC 项目目录</label><input value={effDir} spellCheck={false} onChange={(e) => setDir(e.target.value)} placeholder="必须是新目录，旧目录不会被改写" /></div>
      </div>
      <div className="fld"><label>迁移说明</label><input value={comment} onChange={(e) => setComment(e.target.value)} /></div>
      <div className="fld">
        <label>绑定连接（数据 CPT 内的同名连接自动保留；其余映射至第一个勾选项）</label>
        <div className="cklist">{connections.map((connection) => <div key={connection.name} className={`ck${picked.includes(connection.name) ? ' on' : ''}`} onClick={() => setPicked((items) => items.includes(connection.name) ? items.filter((item) => item !== connection.name) : [...items, connection.name])}>
          <span className="cbx" /><b>{connection.name}</b><span className="ck-m">{connection.comment || '已注册连接'}</span>
        </div>)}</div>
      </div>
      <div className="tree">迁移后：<br />├─ <span className="d">project.yaml</span>　新的可迁移事实来源<br />├─ <span className="d">pages/*.jsx</span>　仅导入已有 JSX；随后由 RC build 产生 MJS/CPT<br />├─ <span className="d">legacy/*.cpt</span>　只读复原证据，供 Agent inspect<br />└─ <span className="d">meta/migration__*.sql / .mjs</span>　可审查证据；SQL 不会自动执行</div>
    </>}
    {err && <div className="banner err"><Icon n="cx" /><div>{err}</div></div>}
  </Modal>
}

// ── 接口契约编辑（新建 / 编辑） ─────────────────────────────────

const KIND_OPTIONS: Array<{ v: DatasetKind; label: string }> = [
  { v: 'list', label: '列表（分页）' }, { v: 'stat', label: '统计' }, { v: 'detail', label: '单条' },
  { v: 'dict', label: '字典' }, { v: 'insert', label: '新增（CALL）' }, { v: 'update', label: '更新（CALL）' },
  { v: 'delete', label: '删除（CALL）' }, { v: 'other', label: '其他' }
]

export function DatasetEditModal({ project, boundConns, init, onClose, onSave }: {
  project: string
  boundConns: string[]
  init: Partial<Dataset> & { name: string }
  onClose: () => void
  onSave: (input: { name: string; kind: DatasetKind; comment: string; connection: string; params: DatasetParam[]; sql: string }) => Promise<void>
}): React.ReactElement {
  const [name, setName] = useState(init.name)
  const [kind, setKind] = useState<DatasetKind>(init.kind ?? 'list')
  const [comment, setComment] = useState(init.comment ?? '')
  const [connection, setConnection] = useState(init.connection ?? boundConns[0] ?? '')
  const [params, setParams] = useState<DatasetParam[]>(init.params ?? [])
  const [sql, setSql] = useState(init.sql ?? '-- 列表：自行分页 + 可选条件（帆软公式）\nSELECT ... WHERE 1=1 ${if(len(p_keyword)==0,""," AND x LIKE \'%"+p_keyword+"%\'")}\nORDER BY id DESC LIMIT ${(p_page-1)*p_pagesize}, ${p_pagesize}')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const save = async () => {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) { setErr('接口名仅允许小写字母/数字/下划线'); return }
    if (!sql.trim()) { setErr('SQL 不能为空'); return }
    setBusy(true)
    setErr(null)
    try { await onSave({ name, kind, comment, connection, params, sql }) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const updParam = (i: number, patch: Partial<DatasetParam>) => setParams((ps) => ps.map((p, k) => (k === i ? { ...p, ...patch } : p)))

  return (
    <Modal
      wide title={`${init.id ? '编辑接口' : '新建接口'} — ${project}`} icon="code" onClose={onClose}
      footer={<>
        <span className="m-note">保存为幂等 upsert；构建后进入 {project}_data.cpt（该数据集 DatabaseName={connection || '-'}）</span>
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn pri" onClick={save} disabled={busy}><Icon n="check" />{busy ? '保存中…' : '保存契约'}</button>
      </>}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px 1fr', gap: 10 }}>
        <div className="fld">
          <label>接口名</label>
          <input type="text" value={name} spellCheck={false} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="fld">
          <label>类型</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as DatasetKind)}>
            {KIND_OPTIONS.map((k) => <option key={k.v} value={k.v}>{k.label}</option>)}
          </select>
        </div>
        <div className="fld">
          <label>所属连接</label>
          <select value={connection} onChange={(e) => setConnection(e.target.value)}>
            {boundConns.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div className="fld">
        <label>说明</label>
        <input type="text" value={comment} placeholder="接口用途（可选）" onChange={(e) => setComment(e.target.value)} />
      </div>
      <div className="fld">
        <label>参数（formula 类型由帆软会话注入，不随请求传递）</label>
        <table className="ptab">
          <thead><tr><th style={{ width: '34%' }}>NAME</th><th style={{ width: '30%' }}>TYPE</th><th>DEFAULT</th><th style={{ width: 50 }}></th></tr></thead>
          <tbody>
            {params.map((p, i) => (
              <tr key={i}>
                <td><input value={p.name} onChange={(e) => updParam(i, { name: e.target.value })} /></td>
                <td>
                  <select value={p.type} onChange={(e) => updParam(i, { type: e.target.value as DatasetParam['type'] })}>
                    <option value="string">string</option><option value="integer">integer</option>
                    <option value="double">double</option><option value="formula">formula</option>
                  </select>
                </td>
                <td><input value={p.default ?? ''} onChange={(e) => updParam(i, { default: e.target.value })} /></td>
                <td><button className="iconbtn" onClick={() => setParams((ps) => ps.filter((_, k) => k !== i))}><Icon n="trash" /></button></td>
              </tr>
            ))}
            <tr><td colSpan={4}>
              <button className="btn sm" onClick={() => setParams((ps) => [...ps, { name: `p_${ps.length + 1}`, type: 'string', default: '' }])}><Icon n="plus" />加参数</button>
            </td></tr>
          </tbody>
        </table>
      </div>
      <div className="fld">
        <label>SQL（写操作 = CALL 存储过程，约定返回 JSON_OBJECT）</label>
        <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
          <SqlEditor value={sql} onChange={setSql} height="220px" />
        </div>
      </div>
      {err && <div className="banner err"><Icon n="cx" /><div>{err}</div></div>}
    </Modal>
  )
}

// ── 破坏性确认：应用过程（输入过程名确认） ──────────────────────

export function ApplyProcModal({ name, connection, linkedFrom, usedBy, onClose, onConfirm }: {
  name: string
  connection: string
  linkedFrom?: string
  usedBy?: string[]
  onClose: () => void
  onConfirm: () => Promise<void>
}): React.ReactElement {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <Modal
      title="应用存储过程（破坏性操作）" icon="alert" tone="danger" onClose={onClose}
      footer={<>
        <span className="m-note">DROP+CREATE 需二次确认（第 7 章）</span>
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn dgr" disabled={input !== name || busy} onClick={async () => { setBusy(true); setErr(null); try { await onConfirm() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }}>
          <Icon n="box" />{busy ? '应用中…' : '确认应用'}
        </button>
      </>}
    >
      <div className="effects">
        将在连接 <b>{connection}</b> 上执行：<br />
        <code>DROP PROCEDURE IF EXISTS `{name}`;</code><br />
        <code>CREATE PROCEDURE `{name}`(...) ...</code><br />
        {linkedFrom ? <>定义来自项目 <b>{linkedFrom}</b>（关联引用，不复制）；</> : null}
        {usedBy?.length ? <>被 <b>{usedBy.join(' / ')}</b> 引用；执行瞬间若有并发 CALL 会失败。<br /></> : null}
        审计：语句与结果全量落 <b>ddl_log</b>（只增不改）。
      </div>
      <div className="fld" style={{ marginTop: 13 }}>
        <label>输入过程名以确认</label>
        <input type="text" value={input} placeholder={name} spellCheck={false} onChange={(e) => setInput(e.target.value)} />
      </div>
      {err && <div className="banner err"><Icon n="cx" /><div>{err}</div></div>}
    </Modal>
  )
}

// ── CALL 试执行确认 ─────────────────────────────────────────────

export function CallProcModal({ connection, initSql, onClose, onRun }: {
  connection: string
  initSql: string
  onClose: () => void
  onRun: (sql: string) => Promise<unknown>
}): React.ReactElement {
  const [sqlText, setSqlText] = useState(initSql)
  const [result, setResult] = useState<unknown>(undefined)
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      title="试执行 CALL（真实执行）" icon="play" tone="warn" onClose={onClose}
      footer={<>
        <span className="m-note">真实写入业务库（{connection}），审计落 ddl_log</span>
        <button className="btn" onClick={onClose}>关闭</button>
        <button className="btn dgr" disabled={busy} onClick={async () => { setBusy(true); try { setResult(await onRun(sqlText)) } catch (e) { setResult({ error: (e as Error).message }) } finally { setBusy(false) } }}>
          <Icon n="play" />{busy ? '执行中…' : '执行 CALL'}
        </button>
      </>}
    >
      <div className="fld">
        <label>CALL 语句（可编辑，建议用可清理的测试数据）</label>
        <textarea rows={3} value={sqlText} spellCheck={false} style={{ fontFamily: 'var(--mono)' }} onChange={(e) => setSqlText(e.target.value)} />
      </div>
      {result !== undefined && (
        <div className="codeblk">
          <div className="cb-h">结果 JSON</div>
          <pre>{typeof result === 'string' ? result : JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </Modal>
  )
}

// ── 关联其他项目的过程 ──────────────────────────────────────────

export interface LinkableProc { id: number; name: string; srcProject: string; connection: string; comment: string; appliedCount: number }

export function LinkProcModal({ linkable, onClose, onLink }: {
  linkable: LinkableProc[]
  onClose: () => void
  onLink: (procId: number) => Promise<void>
}): React.ReactElement {
  const groups = useMemo(() => {
    const m = new Map<string, LinkableProc[]>()
    for (const p of linkable) {
      if (!m.has(p.srcProject)) m.set(p.srcProject, [])
      m.get(p.srcProject)!.push(p)
    }
    return [...m.entries()]
  }, [linkable])
  const [picked, setPicked] = useState<LinkableProc | null>(linkable[0] ?? null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  return (
    <Modal
      title="关联其他项目的过程" icon="link" onClose={onClose}
      footer={<>
        <span className="m-note">关联 = 引用不复制；本项目接口 SQL 可直接 CALL</span>
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn pri" disabled={!picked || busy} onClick={async () => { if (!picked) return; setBusy(true); setErr(null); try { await onLink(picked.id) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }}>
          <Icon n="link" />{busy ? '关联中…' : '关联'}
        </button>
      </>}
    >
      {linkable.length === 0
        ? <div className="banner info"><Icon n="info" /><div>没有可关联的过程——其他项目还没有创建过程</div></div>
        : groups.map(([proj, items]) => (
          <div className="fld" key={proj}>
            <label>{proj}（{items.length} 个过程）</label>
            <div className="cklist">
              {items.map((p) => (
                <div key={p.id} className={`ck${picked?.id === p.id ? ' on' : ''}`} onClick={() => setPicked(p)}>
                  <span className="cbx" /><b>{p.name}</b>　{p.comment || '-'}<span className="ck-m">{p.connection} · {p.appliedCount} 次应用</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      {err && <div className="banner err"><Icon n="cx" /><div>{err}</div></div>}
    </Modal>
  )
}

// ── 新建过程（模板起步） ────────────────────────────────────────

export function NewProcModal({ boundConns, onClose, onSave }: {
  boundConns: string[]
  onClose: () => void
  onSave: (input: { name: string; connection: string; comment: string; definition: string }) => Promise<void>
}): React.ReactElement {
  const [name, setName] = useState('sp_')
  const [connection, setConnection] = useState(boundConns[0] ?? '')
  const [comment, setComment] = useState('')
  const [def, setDef] = useState(`CREATE PROCEDURE sp_xxx(
  IN p_id INT
)
BEGIN
  -- 写入类过程必须返回 JSON
  SELECT JSON_OBJECT('success', TRUE, 'message', 'ok', 'id', p_id) AS result;
END`)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <Modal
      wide title="新建存储过程（从模板起步）" icon="term" onClose={onClose}
      footer={<>
        <span className="m-note">定义存 meta/{name || 'xx'}.sql；保存后可在右栏「应用」落到数据库</span>
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn pri" disabled={busy} onClick={async () => {
          setBusy(true); setErr(null)
          try { await onSave({ name, connection, comment, definition: def }) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
        }}><Icon n="check" />{busy ? '保存中…' : '保存契约与定义'}</button>
      </>}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.4fr', gap: 10 }}>
        <div className="fld">
          <label>过程名</label>
          <input type="text" value={name} spellCheck={false} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="fld">
          <label>所属连接</label>
          <select value={connection} onChange={(e) => setConnection(e.target.value)}>
            {boundConns.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="fld">
          <label>说明</label>
          <input type="text" value={comment} placeholder="过程用途（可选）" onChange={(e) => setComment(e.target.value)} />
        </div>
      </div>
      <div className="fld">
        <label>定义（CREATE PROCEDURE，约定 SELECT JSON_OBJECT 返回结果）</label>
        <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
          <SqlEditor value={def} onChange={setDef} height="240px" />
        </div>
      </div>
      {err && <div className="banner err"><Icon n="cx" /><div>{err}</div></div>}
    </Modal>
  )
}

// ── 新建/重命名文档 ─────────────────────────────────────────────

export function DocNameModal({ title, initName, onClose, onSave }: {
  title: string
  initName?: string
  onClose: () => void
  onSave: (name: string) => Promise<void>
}): React.ReactElement {
  const [name, setName] = useState(initName ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <Modal
      title={title} icon="file" onClose={onClose}
      footer={<>
        <span className="m-note">存于项目 meta/ 目录；Agent 可读取作为开发上下文</span>
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn pri" disabled={busy || !name.trim()} onClick={async () => { setBusy(true); setErr(null); try { await onSave(name.trim()) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }}>
          <Icon n="check" />确定
        </button>
      </>}
    >
      <div className="fld">
        <label>文档名（.md / .txt / .html 需求设计、.sql 过程语句，或 .js / .jsx / .mjs / .css 前端参考）</label>
        <input type="text" value={name} spellCheck={false} placeholder="01-需求-订单管理.md" onChange={(e) => setName(e.target.value)} />
      </div>
      {err && <div className="banner err"><Icon n="cx" /><div>{err}</div></div>}
    </Modal>
  )
}

// ── 项目设置（改绑定连接 / 说明） ────────────────────────────────

export function ProjectSettingsModal({ name, comment, dir, platform, connections, allConns, onClose, onSave }: {
  name: string
  comment: string
  dir: string
  platform: ProjectPlatform
  connections: string[]
  allConns: DbConnection[]
  onClose: () => void
  onSave: (comment: string, conns: string[], dir: string, platform: ProjectPlatform) => Promise<void>
}): React.ReactElement {
  const [cm, setCm] = useState(comment)
  const [dv, setDv] = useState(dir)
  const [platformValue, setPlatformValue] = useState<ProjectPlatform>(platform)
  const [picked, setPicked] = useState<string[]>(connections)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const browse = async () => {
    try {
      const d = await call<string | null>('dialog:pickDir', { title: '重新绑定项目目录（含 project.yaml）' })
      if (d) setDv(d)
    } catch { /* 取消不处理 */ }
  }
  return (
    <Modal
      title={`项目设置 — ${name}`} icon="set" onClose={onClose}
      footer={<>
        <span className="m-note">解绑连接不影响已有契约，但新建接口只能从绑定清单选</span>
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn pri" disabled={busy || picked.length === 0 || !dv.trim()} onClick={async () => { setBusy(true); setErr(null); try { await onSave(cm, picked, dv.trim(), platformValue) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }}>
          <Icon n="check" />保存
        </button>
      </>}
    >
      <div className="fld">
        <label>项目目录（目录被移动后在此重绑）</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="text" style={{ flex: 1 }} value={dv} spellCheck={false} onChange={(e) => setDv(e.target.value)} />
          <button className="btn" onClick={() => void browse()}><Icon n="folderOpen" />选择目录</button>
        </div>
        <div className="fh">保存时会同步重写目录内的 project.yaml（资源路径以清单为准）</div>
      </div>
      <div className="fld">
        <label>说明</label>
        <input type="text" value={cm} onChange={(e) => setCm(e.target.value)} />
      </div>
      <div className="fld">
        <label>目标端</label>
        <select value={platformValue} onChange={(e) => setPlatformValue(e.target.value as ProjectPlatform)}>
          <option value="desktop">桌面端</option>
          <option value="mobile">移动端</option>
          <option value="dual">双端</option>
        </select>
        <div className="fh">单端项目只能包含同端页面；要在桌面端/移动端之间切换，先在此改为双端，再到各页面的「路径」页签调整页面端型。</div>
      </div>
      <div className="fld">
        <label>受管页面路径</label>
        <div className="fh">页面的 jsx / mjs / cpt 路径与端型在各页面面板的「路径」页签中编辑；保存时会移动受管文件并更新 project.yaml。</div>
      </div>
      <div className="fld">
        <label>绑定连接（多选）</label>
        <div className="cklist">
          {allConns.map((c) => (
            <div key={c.name} className={`ck${picked.includes(c.name) ? ' on' : ''}`} onClick={() => setPicked((p) => p.includes(c.name) ? p.filter((x) => x !== c.name) : [...p, c.name])}>
              <span className="cbx" /><b>{c.name}</b>　{c.host}:{c.port}<span className="ck-m">{c.database}</span>
            </div>
          ))}
          {allConns.length === 0 && <div className="ck">注册表为空（「连接」页注册）</div>}
        </div>
      </div>
      {err && <div className="banner err"><Icon n="cx" /><div>{err}</div></div>}
    </Modal>
  )
}

// ── 打包项目（三选一：打包并发送邮箱 / 仅打包 / 取消） ────────────

export function PackProjectModal({ project, onPackOnly, onSent, onClose }: {
  project: string
  /** 仅打包：父层走原「选目录 → 导出 zip」流程 */
  onPackOnly: () => void
  /** 发送成功：弹窗自行关闭，toast 由父层统一弹出 */
  onSent: (r: { total: number; bytes: number; fileNames: string[] }, to: string) => void
  onClose: () => void
}): React.ReactElement {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [to, setTo] = useState('')
  const [chunkKB, setChunkKB] = useState('')
  const [info, setInfo] = useState<{ entries: number; rawBytes: number; zipBytes: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ number: number; total: number; fileName: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const [s, i] = await Promise.all([
          call<AppSettings>('config:get'),
          call<{ entries: number; rawBytes: number; zipBytes: number }>('projects:zipInfo', { project }).catch(() => null)
        ])
        setSettings(s)
        setTo(s.mailTo)
        setChunkKB(String(s.mailChunkMiB * 1024))
        setInfo(i)
      } catch { /* 配置读取失败由发送动作兜底报错 */ }
    })()
  }, [project])

  // 预计分卷数随分卷 KB 输入实时变化
  const estParts = useMemo(() => {
    if (!info) return null
    const kb = Number(chunkKB.replace(/\D/g, '')) || 0
    const bytes = kb > 0 ? kb * 1024 : (settings?.mailChunkMiB ?? 30) * 1024 * 1024
    return Math.max(1, Math.ceil(info.zipBytes / bytes))
  }, [info, chunkKB, settings])

  const cfgReady = !!settings && !!settings.mailSmtpHost.trim() && !!settings.mailFrom.trim() && !!settings.mailPassword

  const send = async () => {
    if (!to.trim()) { setErr('收件邮箱不能为空'); return }
    setBusy(true)
    setErr(null)
    setProgress(null)
    const kb = Number(chunkKB.replace(/\D/g, '')) || 0
    const off = window.api.onMailProgress(setProgress)
    try {
      const r = await call<{ total: number; bytes: number; fileNames: string[] }>('projects:sendZip', {
        project, to: to.trim(), ...(kb > 0 ? { chunkKB: kb } : {})
      })
      onSent(r, to.trim())
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      off()
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <Modal
      title={`打包项目 — ${project}`} icon="pkg" onClose={busy ? () => { /* 发送中不允许关闭 */ } : onClose}
      footer={<>
        <button className="btn" onClick={onClose} disabled={busy}>取消</button>
        <button className="btn" onClick={onPackOnly} disabled={busy}><Icon n="folderOpen" />仅打包</button>
        <button className="btn pri" onClick={() => void send()} disabled={busy || !cfgReady}>
          <Icon n={busy ? 'spin' : 'send'} />{busy ? (progress ? `发送中 ${progress.number}/${progress.total}…` : '打包发送中…') : '打包并发送邮箱'}
        </button>
      </>}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px', gap: 10 }}>
        <div className="fld">
          <label>收件邮箱</label>
          <input type="text" value={to} spellCheck={false} placeholder="内网/公司邮箱（默认值在设置页配置）" onChange={(e) => setTo(e.target.value)} disabled={busy} />
        </div>
        <div className="fld">
          <label>分卷大小（KB）</label>
          <input type="text" inputMode="numeric" value={chunkKB} spellCheck={false} placeholder="30720" onChange={(e) => setChunkKB(e.target.value)} disabled={busy} />
        </div>
      </div>
      {info && (
        <div className="fh">
          原目录 {fmtBytes(info.rawBytes)} · 预计 zip {fmtBytes(info.zipBytes)}（{info.entries} 个条目）· 按当前分卷约 {estParts} 卷
        </div>
      )}
      {progress && (
        <div className="banner info"><Icon n="spin" /><div>正在发送第 {progress.number}/{progress.total} 卷：{progress.fileName}</div></div>
      )}
      {settings && !cfgReady && (
        <div className="banner warn"><Icon n="alert" /><div>发件邮箱未配置：请到「设置 → 打包邮件发送」填写 SMTP 发件账号后再使用邮件发送</div></div>
      )}
      {err && <div className="banner err"><Icon n="cx" /><div>{err}</div></div>}
    </Modal>
  )
}
