import React, { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { call } from '../api'
import { fmtTime } from '../components/ui'
import type { StatusPayload, BuildResult } from '@shared/types'

export default function DashboardView({ onNavigate }: { onNavigate: (v: string) => void }): React.ReactElement {
  const [status, setStatus] = useState<StatusPayload | null>(null)
  const [builds, setBuilds] = useState<Array<Record<string, unknown>>>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const [s, b] = await Promise.all([
        call<StatusPayload>('status:get'),
        call<Array<Record<string, unknown>>>('history:builds', { limit: 10 })
      ])
      setStatus(s)
      setBuilds(b)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void refresh() }, [])

  const c = status?.counts

  return (
    <div className="page">
      <div className="page-head">
        <b>总览</b>
        <span className="sub">环境状态 · 资产规模 · 构建历史</span>
        <span className="grow" />
        <button className="btn sm" onClick={() => void refresh()} disabled={loading}><Icon n="cd" />刷新</button>
      </div>
      <div className="page-body">
        {error && (
          <div className="banner err"><Icon n="cx" /><div>状态加载失败：{error}　<button className="btn sm" style={{ marginLeft: 8 }} onClick={refresh}>重试</button></div></div>
        )}
        <div className="statgrid">
          <div className="statcard">
            <div className="st-t"><span className={`dot ${status?.frReachable ? 'g' : 'r'}`} />帆软服务</div>
            <div className={`st-v ${status ? (status.frReachable ? 'ok' : 'err') : ''}`}>{status ? (status.frReachable ? '在线' : '不可达') : '…'}</div>
            <div className="st-m">{status?.frLatencyMs !== undefined ? `${status.frLatencyMs}ms` : '-'}</div>
          </div>
          <div className="statcard">
            <div className="st-t"><Icon n="db" size={12} />数据连接</div>
            <div className="st-v">{status ? status.connections.length : '…'}</div>
            <div className="st-m">{status ? `${status.connections.filter((x) => x.reachable).length} 可达 · ${status.connections.filter((x) => !x.reachable).length} 不可达` : '-'}</div>
          </div>
          <div className="statcard">
            <div className="st-t"><Icon n="folder" size={12} />reportlets</div>
            <div className={`st-v ${status ? (status.reportletsWritable ? 'ok' : 'warn') : ''}`}>{status ? (status.reportletsWritable ? '可写' : '不可写') : '…'}</div>
            <div className="st-m" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{status?.reportletsPath || '-'}</div>
          </div>
          <div className="statcard">
            <div className="st-t"><Icon n="box" size={12} />项目 / 接口</div>
            <div className="st-v">{c ? `${c.projects} / ${c.datasets}` : '…'}</div>
            <div className="st-m">页面 {c?.pages ?? '-'} · 过程 {c?.procedures ?? '-'} · 文档 {c?.docs ?? '-'}</div>
          </div>
        </div>

        {(status?.connections.length ?? 0) > 0 && (
          <div className="pcard-row" style={{ marginBottom: 16 }}>
            <div className="pcard-h"><Icon n="db" />连接健康</div>
            <table className="plain-table">
              <thead><tr><th>连接</th><th>状态</th><th>版本</th><th>延迟</th><th>错误</th></tr></thead>
              <tbody>
                {status!.connections.map((cn) => (
                  <tr key={cn.name}>
                    <td className="f">{cn.name}</td>
                    <td>{cn.reachable ? <span className="pill-o ok"><Icon n="cck" />可达</span> : <span className="pill-o err"><Icon n="cx" />不可达</span>}</td>
                    <td className="f">{cn.version ?? '-'}</td>
                    <td className="f">{cn.reachable ? `${cn.latencyMs ?? '-'}ms` : '-'}</td>
                    <td style={{ color: 'var(--bad)', fontSize: 11 }}>{!cn.reachable ? (cn.error ?? '').slice(0, 80) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="pcard-row">
          <div className="pcard-h"><Icon n="clock" />最近构建</div>
          <table className="plain-table">
            <thead><tr><th>类型</th><th>目标</th><th>结果</th><th>时间</th></tr></thead>
            <tbody>
              {builds.map((b) => (
                <tr key={String(b.id)}>
                  <td>{b.kind === 'data' ? <span className="tag list">数据层</span> : <span className="tag stat">页面</span>}</td>
                  <td className="f">{String(b.target)}</td>
                  <td>{b.ok ? <span className="pill-o ok"><Icon n="cck" />成功</span> : <span className="pill-o err"><Icon n="cx" />失败</span>}</td>
                  <td className="f">{fmtTime(String(b.created_at))}</td>
                </tr>
              ))}
              {builds.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--faint)' }}>暂无构建记录</td></tr>}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button className="btn pri" onClick={() => onNavigate('workbench')}><Icon n="folder" />进入项目工作台</button>
          <button className="btn acc-o" onClick={() => onNavigate('connections')}><Icon n="db" />管理连接</button>
          <button className="btn acc-o" onClick={() => onNavigate('agent')}><Icon n="ai" />唤起 Agent</button>
        </div>
      </div>
    </div>
  )
}
