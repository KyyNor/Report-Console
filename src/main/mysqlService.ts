/**
 * MySQL 服务 — 按连接注册表路由的多连接池 + 只读守卫 + 存储过程管理
 *
 * 所有访问都必须显式（或默认取第一个）走 connections 注册表中的连接；
 * 每个连接（+ 可选跨库 database）一个独立池，配置变更自动重建。
 */

import mysql from 'mysql2/promise'
import { getDb } from './db'
import { requireConnection, getConnection } from './connectionsService'
import type { DbConnection, ConnectionHealth } from '@shared/types'

export type ConnRef = { id?: number; name?: string } | undefined

const pools = new Map<string, mysql.Pool>()

function poolKey(conn: DbConnection, database?: string): string {
  return `${conn.id}|${database || conn.database}`
}

export function getPoolFor(conn: DbConnection, database?: string): mysql.Pool {
  const key = poolKey(conn, database)
  let p = pools.get(key)
  if (p) return p
  p = mysql.createPool({
    host: conn.host,
    port: Number(conn.port) || 3306,
    user: conn.user,
    password: conn.password,
    database: database || conn.database || undefined,
    waitForConnections: true,
    connectionLimit: 5,
    connectTimeout: 4000,
    charset: 'utf8mb4',
    dateStrings: true,
    multipleStatements: false
  })
  pools.set(key, p)
  return p
}

function poolFor(ref: ConnRef, database?: string): mysql.Pool {
  return getPoolFor(requireConnection(ref), database)
}

/** 连接配置变更后废弃对应池（下次访问按新配置重建） */
export function invalidatePools(connId: number): void {
  for (const [key, p] of pools) {
    if (key.startsWith(`${connId}|`)) {
      pools.delete(key)
      void p.end().catch(() => {})
    }
  }
}

export async function pingConnection(conn: DbConnection, database?: string): Promise<ConnectionHealth & { database?: string }> {
  const started = Date.now()
  try {
    const [rows] = await getPoolFor(conn, database).query('SELECT VERSION() AS v')
    const r = (rows as Array<{ v: string }>)[0]
    return { name: conn.name, reachable: true, latencyMs: Date.now() - started, version: r?.v }
  } catch (e) {
    return { name: conn.name, reachable: false, latencyMs: Date.now() - started, error: (e as Error).message }
  }
}

// ── 只读查询（agent 与 UI 共用的安全通道） ───────────────────────

const READONLY_PREFIX = /^\s*(select|show|describe|desc|explain|with)\b/i

/** 只读 SQL 执行：拒绝非查询语句；自动补 LIMIT；行数/时长受限 */
export async function readOnlyQuery(
  sql: string,
  opts: { connection?: ConnRef; database?: string; maxRows?: number } = {}
): Promise<{ columns: string[]; rows: Array<Record<string, unknown>>; durationMs: number; truncated: boolean; connection: string }> {
  const maxRows = opts.maxRows ?? 100
  if (!READONLY_PREFIX.test(sql)) {
    throw new Error(`只读通道拒绝该语句（仅 SELECT/SHOW/DESCRIBE/EXPLAIN/WITH）：${sql.slice(0, 80)}`)
  }
  if (/;\s*\S/.test(sql)) {
    throw new Error('只读通道不允许一次执行多条语句')
  }
  // 无 LIMIT 的 SELECT 补一个安全上限
  let finalSql = sql.trim().replace(/;+\s*$/, '')
  if (/^\s*select\b/i.test(finalSql) && !/\blimit\b/i.test(finalSql)) {
    finalSql += ` LIMIT ${maxRows + 1}`
  }
  const conn = requireConnection(opts.connection)
  const started = Date.now()
  const [result] = await getPoolFor(conn, opts.database).query(finalSql)
  const durationMs = Date.now() - started
  if (Array.isArray(result)) {
    const rows = result as Array<Record<string, unknown>>
    const truncated = rows.length > maxRows
    const sliced = truncated ? rows.slice(0, maxRows) : rows
    const columns = sliced.length > 0 ? Object.keys(sliced[0]) : []
    return { columns, rows: sliced, durationMs, truncated, connection: conn.name }
  }
  return { columns: [], rows: [], durationMs, truncated: false, connection: conn.name }
}

// ── 库表元数据 ──────────────────────────────────────────────────

export async function listDatabases(ref?: ConnRef): Promise<string[]> {
  const [rows] = await poolFor(ref).query(
    "SELECT schema_name AS db FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema','mysql','performance_schema','sys') ORDER BY schema_name"
  )
  return (rows as Array<{ db: string }>).map((r) => r.db)
}

export async function listTables(database: string | undefined, ref?: ConnRef): Promise<Array<{ name: string; comment: string }>> {
  const conn = requireConnection(ref)
  const db = database || conn.database
  const [rows] = await getPoolFor(conn).query(
    `SELECT table_name AS name, IFNULL(table_comment,'') AS comment
     FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name`,
    [db]
  )
  return rows as Array<{ name: string; comment: string }>
}

export async function describeTable(table: string, database: string | undefined, ref?: ConnRef): Promise<Array<Record<string, unknown>>> {
  const conn = requireConnection(ref)
  const db = database || conn.database
  const [rows] = await getPoolFor(conn).query(
    `SELECT column_name AS field, column_type AS type, is_nullable, column_default, column_comment
     FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position`,
    [db, table]
  )
  return rows as Array<Record<string, unknown>>
}

// ── 存储过程（MySQL 侧） ────────────────────────────────────────

export interface MysqlProcedure {
  name: string
  database: string
  definer: string
  created: string
  altered: string
  comment: string
}

export async function listProceduresMysql(database: string | undefined, ref?: ConnRef): Promise<MysqlProcedure[]> {
  const conn = requireConnection(ref)
  const db = database || conn.database
  const [rows] = await getPoolFor(conn).query(
    `SELECT routine_name AS name, routine_schema AS \`database\`, definer,
            created, last_altered AS altered, IFNULL(routine_comment,'') AS comment
     FROM information_schema.routines
     WHERE routine_schema = ? AND routine_type = 'PROCEDURE' ORDER BY routine_name`,
    [db]
  )
  return rows as MysqlProcedure[]
}

export async function getProcedureDefinition(name: string, database: string | undefined, ref?: ConnRef): Promise<string> {
  const conn = requireConnection(ref)
  const db = database || conn.database
  const p = await getPoolFor(conn).getConnection()
  try {
    const [rows] = await p.query(`SHOW CREATE PROCEDURE \`${db}\`.\`${name}\``)
    const r = (rows as Array<Record<string, unknown>>)[0]
    const def = (r?.['Create Procedure'] ?? r?.['CREATE PROCEDURE']) as string | undefined
    if (!def) throw new Error(`无法读取过程定义：${db}.${name}`)
    return def
  } finally {
    p.release()
  }
}

function logDdl(kind: string, target: string, statement: string, ok: boolean, connection: string, error?: string): void {
  getDb().prepare(
    'INSERT INTO ddl_log(kind, target, statement, ok, error, connection) VALUES(?,?,?,?,?,?)'
  ).run(kind, target, statement, ok ? 1 : 0, error ?? null, connection)
}

/** 应用存储过程定义（DROP IF EXISTS + CREATE，单连接，审计落库） */
export async function applyProcedureMysql(definition: string, name: string, ref?: ConnRef, database?: string): Promise<{ ok: boolean; error?: string }> {
  const conn = requireConnection(ref)
  const db = database || conn.database
  const p = await getPoolFor(conn).getConnection()
  try {
    await p.query(`DROP PROCEDURE IF EXISTS \`${db}\`.\`${name}\``)
    await p.query(definition)
    logDdl('procedure', `${db}.${name}`, definition, true, conn.name)
    return { ok: true }
  } catch (e) {
    const msg = (e as Error).message
    logDdl('procedure', `${db}.${name}`, definition, false, conn.name, msg)
    return { ok: false, error: msg }
  } finally {
    p.release()
  }
}

/** 受控执行（DDL/DML/CALL），全部审计落库 */
export async function guardedExec(
  sql: string,
  kind: 'ddl' | 'dml' | 'call',
  purpose = '(ui)',
  ref?: ConnRef
): Promise<{ ok: boolean; error?: string; result?: unknown; connection: string }> {
  const conn = requireConnection(ref)
  const p = await getPoolFor(conn).getConnection()
  try {
    const [result] = await p.query(sql)
    logDdl(kind, `${conn.database}:${purpose}`, sql, true, conn.name)
    return { ok: true, result, connection: conn.name }
  } catch (e) {
    const msg = (e as Error).message
    logDdl(kind, `${conn.database}:${purpose}`, sql, false, conn.name, msg)
    return { ok: false, error: msg, connection: conn.name }
  } finally {
    p.release()
  }
}

export function getDdlLog(limit = 100, connection?: string): Array<Record<string, unknown>> {
  const d = getDb()
  const rows = (connection
    ? d.prepare('SELECT * FROM ddl_log WHERE connection=? ORDER BY id DESC LIMIT ?').all(connection, limit)
    : d.prepare('SELECT * FROM ddl_log ORDER BY id DESC LIMIT ?').all(limit)) as Array<Record<string, unknown>>
  return rows
}

export function firstConnectionName(): string | undefined {
  return getConnection()?.name
}
