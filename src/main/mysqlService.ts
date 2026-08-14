/**
 * MySQL 服务 — mysql2 连接池 + 只读守卫 + 存储过程管理
 */

import mysql from 'mysql2/promise'
import { getSettings } from './db'
import type { ProcedureMeta } from '@shared/types'
import { getDb } from './db'

let pool: mysql.Pool | null = null
let poolKey = ''

function poolConfigKey(): string {
  const s = getSettings()
  return `${s.mysqlHost}:${s.mysqlPort}/${s.mysqlUser}/${s.mysqlDatabase}`
}

export function getPool(): mysql.Pool {
  const key = poolConfigKey()
  if (pool && poolKey === key) return pool
  if (pool) void pool.end().catch(() => {})
  const s = getSettings()
  pool = mysql.createPool({
    host: s.mysqlHost,
    port: Number(s.mysqlPort) || 3306,
    user: s.mysqlUser,
    password: s.mysqlPassword,
    database: s.mysqlDatabase,
    waitForConnections: true,
    connectionLimit: 5,
    charset: 'utf8mb4',
    dateStrings: true,
    multipleStatements: false
  })
  poolKey = key
  return pool
}

export async function pingMysql(): Promise<{ reachable: boolean; latencyMs: number; version?: string }> {
  const started = Date.now()
  try {
    const [rows] = await getPool().query('SELECT VERSION() AS v')
    const r = (rows as Array<{ v: string }>)[0]
    return { reachable: true, latencyMs: Date.now() - started, version: r?.v }
  } catch {
    return { reachable: false, latencyMs: Date.now() - started }
  }
}

// ── 只读查询（agent 与 UI 共用的安全通道） ───────────────────────

const READONLY_PREFIX = /^\s*(select|show|describe|desc|explain|with)\b/i

/** 只读 SQL 执行：拒绝非查询语句；自动补 LIMIT；行数/时长受限 */
export async function readOnlyQuery(sql: string, database?: string, maxRows = 100, values: unknown[] = []): Promise<{ columns: string[]; rows: Array<Record<string, unknown>>; durationMs: number; truncated: boolean }> {
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
  const started = Date.now()
  const conn = getPool()
  const [result] = await conn.query(finalSql, values)
  const durationMs = Date.now() - started
  if (Array.isArray(result)) {
    const rows = result as Array<Record<string, unknown>>
    const truncated = rows.length > maxRows
    const sliced = truncated ? rows.slice(0, maxRows) : rows
    const columns = sliced.length > 0 ? Object.keys(sliced[0]) : []
    return { columns, rows: sliced, durationMs, truncated }
  }
  return { columns: [], rows: [], durationMs, truncated: false }
}

// ── 库表元数据 ──────────────────────────────────────────────────

export async function listDatabases(): Promise<string[]> {
  const [rows] = await getPool().query(
    "SELECT schema_name AS db FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema','mysql','performance_schema','sys') ORDER BY schema_name"
  )
  return (rows as Array<{ db: string }>).map((r) => r.db)
}

export async function listTables(database?: string): Promise<Array<{ name: string; comment: string; rows?: number }>> {
  const db = database || getSettings().mysqlDatabase
  const [rows] = await getPool().query(
    `SELECT table_name AS name, IFNULL(table_comment,'') AS comment
     FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name`,
    [db]
  )
  return rows as Array<{ name: string; comment: string }>
}

export async function describeTable(table: string, database?: string): Promise<Array<Record<string, unknown>>> {
  const db = database || getSettings().mysqlDatabase
  const [rows] = await getPool().query(
    `SELECT column_name AS field, column_type AS type, is_nullable, column_default, column_comment
     FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position`,
    [db, table]
  )
  return rows as Array<Record<string, unknown>>
}

// ── 存储过程管理 ────────────────────────────────────────────────

export async function listProcedures(database?: string): Promise<ProcedureMeta[]> {
  const db = database || getSettings().mysqlDatabase
  const [rows] = await getPool().query(
    `SELECT routine_name AS name, routine_schema AS database, definer,
            created, last_altered AS altered, IFNULL(routine_comment,'') AS comment
     FROM information_schema.routines
     WHERE routine_schema = ? AND routine_type = 'PROCEDURE' ORDER BY routine_name`,
    [db]
  )
  return rows as ProcedureMeta[]
}

export async function getProcedureDefinition(name: string, database?: string): Promise<string> {
  const db = database || getSettings().mysqlDatabase
  const conn = await getPool().getConnection()
  try {
    const [rows] = await conn.query(`SHOW CREATE PROCEDURE \`${db}\`.\`${name}\``)
    const r = (rows as Array<Record<string, unknown>>)[0]
    const def = (r?.['Create Procedure'] ?? r?.['CREATE PROCEDURE']) as string | undefined
    if (!def) throw new Error(`无法读取过程定义：${db}.${name}`)
    return def
  } finally {
    conn.release()
  }
}

function logDdl(kind: string, target: string, statement: string, ok: boolean, error?: string): void {
  getDb().prepare(
    'INSERT INTO ddl_log(kind, target, statement, ok, error) VALUES(?,?,?,?,?)'
  ).run(kind, target, statement, ok ? 1 : 0, error ?? null)
}

/** 应用存储过程定义（DROP IF EXISTS + CREATE，单连接多语句） */
export async function applyProcedure(definition: string, name: string, database?: string): Promise<{ ok: boolean; error?: string }> {
  const db = database || getSettings().mysqlDatabase
  const conn = await getPool().getConnection()
  try {
    await conn.query(`DROP PROCEDURE IF EXISTS \`${db}\`.\`${name}\``)
    await conn.query(definition)
    logDdl('procedure', `${db}.${name}`, definition, true)
    return { ok: true }
  } catch (e) {
    const msg = (e as Error).message
    logDdl('procedure', `${db}.${name}`, definition, false, msg)
    return { ok: false, error: msg }
  } finally {
    conn.release()
  }
}

/** 受控执行（DDL/DML/CALL），全部审计落库 */
export async function guardedExec(sql: string, kind: 'ddl' | 'dml' | 'call', target = '(inline)'): Promise<{ ok: boolean; error?: string; result?: unknown }> {
  const conn = await getPool().getConnection()
  try {
    const [result] = await conn.query(sql)
    logDdl(kind, target, sql, true)
    return { ok: true, result }
  } catch (e) {
    const msg = (e as Error).message
    logDdl(kind, target, sql, false, msg)
    return { ok: false, error: msg }
  } finally {
    conn.release()
  }
}

export function getDdlLog(limit = 100): Array<Record<string, unknown>> {
  return getDb().prepare('SELECT * FROM ddl_log ORDER BY id DESC LIMIT ?').all(limit) as Array<Record<string, unknown>>
}
