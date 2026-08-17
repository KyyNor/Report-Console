/**
 * 连接注册表 — 与帆软数据连接一一对应（名字一致）的 MySQL 连接管理
 */

import { getDb } from './db'
import type { DbConnection } from '@shared/types'

function rowToConn(r: Record<string, unknown>): DbConnection {
  return {
    id: r.id as number,
    name: r.name as string,
    host: r.host as string,
    port: String(r.port ?? '3306'),
    user: r.user as string,
    password: r.password as string,
    database: r.database as string,
    comment: r.comment as string,
    createdAt: r.created_at as string
  }
}

export function listConnections(): DbConnection[] {
  return (getDb().prepare('SELECT * FROM connections ORDER BY name').all() as Array<Record<string, unknown>>).map(rowToConn)
}

export function getConnection(ref?: { id?: number; name?: string }): DbConnection | undefined {
  const d = getDb()
  let r: Record<string, unknown> | undefined
  if (ref?.id !== undefined) {
    r = d.prepare('SELECT * FROM connections WHERE id=?').get(ref.id) as Record<string, unknown> | undefined
  } else if (ref?.name) {
    r = d.prepare('SELECT * FROM connections WHERE name=?').get(ref.name) as Record<string, unknown> | undefined
  } else {
    r = d.prepare('SELECT * FROM connections ORDER BY id LIMIT 1').get() as Record<string, unknown> | undefined
  }
  return r ? rowToConn(r) : undefined
}

export function requireConnection(ref?: { id?: number; name?: string }): DbConnection {
  const c = getConnection(ref)
  if (!c) throw new Error('未找到数据连接（请先在「连接」页注册，名字与帆软数据连接一致）')
  return c
}

const NAME_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/

export function createConnection(input: Omit<DbConnection, 'id' | 'createdAt'>): DbConnection {
  if (!NAME_RE.test(input.name)) throw new Error('连接名仅允许字母开头，字母/数字/下划线（与帆软数据连接同名）')
  if (!input.host?.trim()) throw new Error('连接主机不能为空')
  const d = getDb()
  const info = d.prepare('INSERT INTO connections(name, host, port, user, password, database, comment) VALUES(?,?,?,?,?,?,?)')
    .run(input.name, input.host, input.port || '3306', input.user || 'root', input.password || '', input.database || '', input.comment || '')
  return getConnection({ id: Number(info.lastInsertRowid) })!
}

export function updateConnection(id: number, patch: Partial<Omit<DbConnection, 'id' | 'createdAt'>>): DbConnection {
  const d = getDb()
  const cur = getConnection({ id })
  if (!cur) throw new Error(`连接不存在：#${id}`)
  const next = { ...cur, ...patch }
  if (!NAME_RE.test(next.name)) throw new Error('连接名仅允许字母开头，字母/数字/下划线')
  d.prepare('UPDATE connections SET name=?, host=?, port=?, user=?, password=?, database=?, comment=? WHERE id=?')
    .run(next.name, next.host, next.port, next.user, next.password, next.database, next.comment, id)
  return getConnection({ id })!
}

export function deleteConnection(id: number): void {
  const d = getDb()
  const used = d.prepare(`
    SELECT (SELECT COUNT(*) FROM datasets WHERE connection_id=?) AS ds,
           (SELECT COUNT(*) FROM procedures WHERE connection_id=?) AS sp`).get(id, id) as { ds: number; sp: number }
  if (used.ds > 0 || used.sp > 0) {
    throw new Error(`该连接仍被 ${used.ds} 个接口 / ${used.sp} 个存储过程引用，先解除引用再删除`)
  }
  d.prepare('DELETE FROM connections WHERE id=?').run(id)
}
