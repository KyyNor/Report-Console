import React, { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { Modal, useToast } from '../components/ui'
import { call } from '../api'
import type { DbConnection, ConnectionHealth } from '@shared/types'

interface EditState { id?: number; name: string; host: string; port: string; user: string; password: string; database: string; comment: string }

const EMPTY: EditState = { name: '', host: '127.0.0.1', port: '3306', user: 'root', password: '', database: '', comment: '' }

export default function ConnectionsView({ onChanged }: { onChanged?: () => void }): React.ReactElement {
  const toast = useToast()
  const [rows, setRows] = useState<DbConnection[]>([])
  const [health, setHealth] = useState<Record<string, ConnectionHealth>>({})
  const [editing, setEditing] = useState<EditState | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = async () => {
    setLoading(true)
    try {
      const list = await call<DbConnection[]>('conns:list')
      setRows(list)
      const results = await Promise.all(list.map((c) => call<ConnectionHealth>('conns:test', { name: c.name }).catch(() => null)))
      const m: Record<string, ConnectionHealth> = {}
      list.forEach((c, i) => { if (results[i]) m[c.name] = results[i]! })
      setHealth(m)
    } catch (e) {
      toast((e as Error).message, 'err')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void refresh() }, [])

  const save = async () => {
    if (!editing) return
    try {
      if (editing.id) await call('conns:update', editing)
      else await call('conns:create', editing)
      toast(editing.id ? '连接已更新' : '连接已创建', 'ok')
      setEditing(null)
      await refresh()
      onChanged?.()
    } catch (e) {
      toast((e as Error).message, 'err')
    }
  }

  const remove = async (c: DbConnection) => {
    try {
      await call('conns:delete', { id: c.id })
      toast(`已删除连接 ${c.name}`, 'ok')
      await refresh()
      onChanged?.()
    } catch (e) {
      toast((e as Error).message, 'err')
    }
  }

  const test = async (name: string) => {
    setTesting(name)
    try {
      const h = await call<ConnectionHealth>('conns:test', { name })
      setHealth((m) => ({ ...m, [name]: h }))
      toast(h.reachable ? `${name} 可达（${h.version ?? ''} ${h.latencyMs}ms）` : `${name} 不可达：${(h.error ?? '').slice(0, 80)}`, h.reachable ? 'ok' : 'err')
    } catch (e) {
      toast((e as Error).message, 'err')
    } finally {
      setTesting(null)
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <b>连接</b>
        <span className="sub">与帆软数据连接一一对应（名字一致）· 一条连接 = 一个 MySQL 连接</span>
        <span className="grow" />
        <button className="btn sm" onClick={() => void refresh()} disabled={loading}><Icon n="cd" />刷新</button>
        <button className="btn pri sm" onClick={() => setEditing({ ...EMPTY })}><Icon n="plus" />注册连接</button>
      </div>
      <div className="page-body">
        <div className="pcard-row">
          <div className="pcard-h"><Icon n="db" />连接注册表（{rows.length}）</div>
          <table className="plain-table">
            <thead><tr><th>名称</th><th>主机</th><th>用户 / 库</th><th>状态</th><th>延迟</th><th>备注</th><th style={{ width: 190 }}></th></tr></thead>
            <tbody>
              {rows.map((c) => {
                const h = health[c.name]
                return (
                  <tr key={c.id}>
                    <td className="f"><span className="cbadge"><Icon n="db" />{c.name}</span></td>
                    <td className="f">{c.host}:{c.port}</td>
                    <td className="f">{c.user} / {c.database || '-'}</td>
                    <td>{h ? (h.reachable
                      ? <span className="pill-o ok"><Icon n="cck" />{h.version ?? '可达'}</span>
                      : <span className="pill-o err"><Icon n="cx" />不可达</span>)
                      : <span className="pill-o idle">未测</span>}</td>
                    <td className="f">{h?.reachable ? `${h.latencyMs}ms` : '-'}</td>
                    <td>{c.comment || '-'}</td>
                    <td>
                      <span style={{ display: 'inline-flex', gap: 6 }}>
                        <button className="btn sm" disabled={testing === c.name} onClick={() => void test(c.name)}><Icon n="play" />{testing === c.name ? '测试中' : '测试'}</button>
                        <button className="btn sm" onClick={() => setEditing({ id: c.id, name: c.name, host: c.host, port: c.port, user: c.user, password: c.password, database: c.database, comment: c.comment })}><Icon n="pen" />编辑</button>
                        <button className="btn sm dgr-o" onClick={() => { if (confirm(`删除连接 ${c.name}？（被接口/过程引用时会拒绝）`)) void remove(c) }}><Icon n="trash" /></button>
                      </span>
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr><td colSpan={7}>
                  <div className="grp-empty">
                    <div className="e1">还没有注册连接</div>
                    <div className="e2">一条连接 = 一个 MySQL 连接，名字与帆软设计器里的数据连接一致；<br />_data.cpt 的 DatabaseName 与管理面 SQL 都按这个名字路由</div>
                    <button className="btn pri sm" onClick={() => setEditing({ ...EMPTY })}><Icon n="plus" />注册第一个连接</button>
                  </div>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <Modal
          title={editing.id ? `编辑连接 — ${editing.name}` : '注册连接'}
          icon="db"
          onClose={() => setEditing(null)}
          footer={<>
            <span className="m-note">连接名与帆软设计器数据连接同名；密码仅存本机 SQLite</span>
            <button className="btn" onClick={() => setEditing(null)}>取消</button>
            <button className="btn pri" onClick={save}><Icon n="check" />保存</button>
          </>}
        >
          <div className="fld">
            <label>连接名（= 帆软数据连接名，写入 _data.cpt 的 DatabaseName）</label>
            <input type="text" value={editing.name} spellCheck={false} placeholder="如 whjcbb" onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <div className="fh">仅字母开头，字母/数字/下划线</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 10 }}>
            <div className="fld">
              <label>主机</label>
              <input type="text" value={editing.host} spellCheck={false} onChange={(e) => setEditing({ ...editing, host: e.target.value })} />
            </div>
            <div className="fld">
              <label>端口</label>
              <input type="text" value={editing.port} spellCheck={false} onChange={(e) => setEditing({ ...editing, port: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="fld">
              <label>用户</label>
              <input type="text" value={editing.user} spellCheck={false} onChange={(e) => setEditing({ ...editing, user: e.target.value })} />
            </div>
            <div className="fld">
              <label>密码</label>
              <input type="password" value={editing.password} autoComplete="new-password" onChange={(e) => setEditing({ ...editing, password: e.target.value })} />
            </div>
          </div>
          <div className="fld">
            <label>默认库</label>
            <input type="text" value={editing.database} spellCheck={false} onChange={(e) => setEditing({ ...editing, database: e.target.value })} />
            <div className="fh">存储过程/建表默认落这个库；接口 SQL 也可跨库（走连接所在实例）</div>
          </div>
          <div className="fld">
            <label>备注</label>
            <input type="text" value={editing.comment} onChange={(e) => setEditing({ ...editing, comment: e.target.value })} />
          </div>
        </Modal>
      )}
    </div>
  )
}
