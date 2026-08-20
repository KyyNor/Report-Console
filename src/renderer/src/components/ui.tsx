/**
 * UI 基件 — toast / modal / popover 菜单 / 轻量代码高亮（设计稿组件的 React 化）
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

// ── Toast ───────────────────────────────────────────────────────

interface ToastItem { id: number; msg: string; kind?: 'ok' | 'err' | 'info' }

const ToastCtx = createContext<(msg: string, kind?: 'ok' | 'err' | 'info') => void>(() => {})

export function useToast() {
  return useContext(ToastCtx)
}

export function ToastProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)
  const push = useCallback((msg: string, kind?: 'ok' | 'err' | 'info') => {
    const id = ++seq.current
    setItems((xs) => [...xs, { id, msg, kind }])
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 3200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div id="toasts">
        {items.map((t) => <div key={t.id} className={`toast ${t.kind ?? ''}`}>{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  )
}

// ── Modal ───────────────────────────────────────────────────────

export function Modal({ title, icon, onClose, children, footer, wide, tone }: {
  title: React.ReactNode
  icon?: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  wide?: boolean
  tone?: 'danger' | 'warn'
}): React.ReactElement {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`modal${wide ? ' wide' : ''}`} data-stop>
        <div className="m-h" style={tone === 'danger' ? { color: '#f5a29c' } : tone === 'warn' ? { color: 'var(--warn)' } : undefined}>
          {icon && <Icon n={icon} />}
          <span className="mt">{title}</span>
          <button className="iconbtn" onClick={onClose}><Icon n="x" /></button>
        </div>
        <div className="m-b">{children}</div>
        {footer && <div className="m-f">{footer}</div>}
      </div>
    </div>
  )
}

// ── Popover 菜单 ────────────────────────────────────────────────

export interface MenuItem { i?: string; t: string; s?: string; dgr?: boolean; div?: boolean; onClick?: () => void }

export function usePopover(): {
  open: (x: number, y: number, items: MenuItem[]) => void
  node: React.ReactElement
} {
  const [state, setState] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const close = useCallback(() => setState(null), [])
  useEffect(() => {
    if (!state) return
    const h = () => close()
    window.addEventListener('click', h)
    window.addEventListener('resize', h)
    return () => { window.removeEventListener('click', h); window.removeEventListener('resize', h) }
  }, [state, close])
  const open = useCallback((x: number, y: number, items: MenuItem[]) => setState({ x, y, items }), [])
  const node = state ? (
    <div id="pop" style={{ display: 'block', left: Math.min(x0(state.x, state.items), window.innerWidth - 190), top: Math.min(state.y, window.innerHeight - state.items.length * 34 - 20) }} onClick={(e) => e.stopPropagation()}>
      {state.items.map((it, k) => it.div
        ? <div key={k} className="pdiv" />
        : (
          <div key={k} className={`pi${it.dgr ? ' dgr' : ''}`} onClick={() => { close(); it.onClick?.() }}>
            {it.i && <Icon n={it.i} />}
            {it.t}
            {it.s && <small>{it.s}</small>}
          </div>
        ))}
    </div>
  ) : <></>
  return { open, node }
}

function x0(x: number, _items: MenuItem[]): number {
  return Math.max(8, x - 140)
}

// ── 轻量语法高亮（SQL / JS / JSON / MD inline code） ────────────

const KW = 'SELECT|FROM|WHERE|ORDER|GROUP|BY|LIMIT|CALL|CREATE|DROP|PROCEDURE|IF|EXISTS|BEGIN|END|DECLARE|INSERT|INTO|VALUES|SET|COUNT|SUM|JSON_OBJECT|INT|VARCHAR|DECIMAL|DATETIME|AND|OR|NOT|NULL|AS|LAST_INSERT_ID|NOW|USE|SHOW|DATABASE|TABLE|const|let|var|function|return|await|async|new|true|false|if|else|for|map'

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function hl(code: string): string {
  const s = escHtml(code)
  const re = new RegExp(`(--[^\\n]*|\\/\\/[^\\n]*)|('(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*")|(\\$\\{[^}]*\\})|\\b(${KW})\\b|\\b(\\d+(?:\\.\\d+)?)\\b`, 'g')
  return s.replace(re, (m, c, st, fm, kw, nm) => {
    if (c) return `<i class="c">${m}</i>`
    if (st) return `<i class="s">${m}</i>`
    if (fm) return `<i class="fm">${m}</i>`
    if (kw) return `<i class="k">${m}</i>`
    if (nm) return `<i class="n">${m}</i>`
    return m
  })
}

export function CodeBlk({ title, body, extra }: { title: React.ReactNode; body: string; extra?: React.ReactNode }): React.ReactElement {
  return (
    <div className="codeblk">
      <div className="cb-h">{title}<span className="grow" />{extra}</div>
      <pre dangerouslySetInnerHTML={{ __html: hl(body) }} />
    </div>
  )
}

// ── 时间格式（SQLite 本地时间 → 友好显示） ─────────────────────

export function fmtTime(s?: string): string {
  if (!s) return '-'
  const d = new Date(s.replace(' ', 'T'))
  if (isNaN(d.getTime())) return s
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (sameDay) return `今天 ${hm}`
  const yest = new Date(now.getTime() - 86400000)
  if (d.toDateString() === yest.toDateString()) return `昨天 ${hm}`
  const md = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return `${md} ${hm}`
}

export function fmtBytes(n?: number): string {
  if (n === undefined) return '-'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
