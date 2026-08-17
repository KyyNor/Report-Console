/**
 * SQLite 存储（better-sqlite3）· v2 项目制
 * - 连接注册表 / 项目 / 接口契约（含连接绑定）/ 过程归属与关联 / 状态账本
 * - 库文件：~/Library/Application Support/report-console/data.sqlite3
 * - migrate() 负责 v2 建表与旧 modules 存量迁移（连接取自旧 settings 的 mysql* 值）
 */

import Database from 'better-sqlite3'
import { app } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
import type { AppSettings } from '@shared/types'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  db = new Database(join(dir, 'data.sqlite3'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(d: Database.Database): void {
  // 旧模块制表（modules/datasets）改名让路：新 schema 用干净表名（幂等：目标名已存在则跳过）
  const tableExists = (name: string) =>
    (d.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name=?").get(name) as { c: number }).c > 0
  if (tableExists('modules') && !tableExists('legacy_modules')) {
    d.exec('ALTER TABLE modules RENAME TO legacy_modules')
  }
  if (tableExists('datasets') && tableExists('legacy_modules') && !tableExists('legacy_datasets')) {
    d.exec('ALTER TABLE datasets RENAME TO legacy_datasets')
  }

  d.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ── 连接注册表（与帆软数据连接一一对应） ───────────────────
CREATE TABLE IF NOT EXISTS connections (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT UNIQUE NOT NULL,
  host       TEXT NOT NULL DEFAULT '127.0.0.1',
  port       TEXT NOT NULL DEFAULT '3306',
  user       TEXT NOT NULL DEFAULT 'root',
  password   TEXT NOT NULL DEFAULT '',
  database   TEXT NOT NULL DEFAULT '',
  comment    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── 项目与连接绑定 ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT UNIQUE NOT NULL,
  comment    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS project_connections (
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  PRIMARY KEY(project_id, connection_id)
);

-- ── 接口契约（数据集，各绑一个连接） ───────────────────────
CREATE TABLE IF NOT EXISTS datasets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  connection_id INTEGER NOT NULL REFERENCES connections(id),
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'other',
  comment       TEXT NOT NULL DEFAULT '',
  params        TEXT NOT NULL DEFAULT '[]',
  sql           TEXT NOT NULL DEFAULT '',
  updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(project_id, name)
);

-- ── 存储过程（归属项目）与跨项目关联 ───────────────────────
CREATE TABLE IF NOT EXISTS procedures (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  connection_id INTEGER NOT NULL REFERENCES connections(id),
  name          TEXT NOT NULL,
  comment       TEXT NOT NULL DEFAULT '',
  updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(project_id, name)
);

CREATE TABLE IF NOT EXISTS proc_links (
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  procedure_id INTEGER NOT NULL REFERENCES procedures(id) ON DELETE CASCADE,
  PRIMARY KEY(project_id, procedure_id)
);

CREATE TABLE IF NOT EXISTS api_tests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id   INTEGER,
  dataset_id  INTEGER,
  dataset     TEXT NOT NULL DEFAULT '',
  request     TEXT NOT NULL DEFAULT '{}',
  response    TEXT NOT NULL DEFAULT '{}',
  ok          INTEGER NOT NULL DEFAULT 0,
  err_code    INTEGER,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS builds (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,
  target     TEXT NOT NULL,
  ok         INTEGER NOT NULL DEFAULT 0,
  log        TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS ddl_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,
  target     TEXT NOT NULL,
  statement  TEXT NOT NULL,
  ok         INTEGER NOT NULL DEFAULT 0,
  error      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS agent_sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL DEFAULT '新会话',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS agent_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  tool_json  TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`)

  // ddl_log 增加连接列（存量库补列）
  try {
    d.prepare("ALTER TABLE ddl_log ADD COLUMN connection TEXT NOT NULL DEFAULT ''").run()
  } catch { /* 已存在 */ }

  // projects 增加 dir 列：项目目录与名称解耦（新建可选任意目录、可打开本地项目）；
  // 存量行为空，读取时回退 reportlets/{name}
  try {
    d.prepare('ALTER TABLE projects ADD COLUMN dir TEXT').run()
  } catch { /* 已存在 */ }

  migrateLegacy(d)
}

/** 旧 legacy_modules/legacy_datasets（v1 模块制）迁移为项目制；连接取自旧 settings 的 mysql* 值 */
function migrateLegacy(d: Database.Database): void {
  // 1) 连接种子：旧 settings mysql* → connections（若空）
  const connCount = (d.prepare('SELECT COUNT(*) AS c FROM connections').get() as { c: number }).c
  if (connCount === 0) {
    const rows = d.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    const name = (map.mysqlDatabase || '').trim()
    if (name) {
      d.prepare('INSERT OR IGNORE INTO connections(name, host, port, user, password, database, comment) VALUES(?,?,?,?,?,?,?)')
        .run(name, map.mysqlHost || '127.0.0.1', map.mysqlPort || '3306', map.mysqlUser || 'root', map.mysqlPassword || '', name, '由旧设置迁移')
    }
  }

  // 2) 模块 → 项目（一次性：legacy 表存在、且 projects 为空）
  const hasLegacy = () =>
    (d.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='legacy_modules'").get() as { c: number }).c > 0
  if (!hasLegacy()) return
  const projCount = (d.prepare('SELECT COUNT(*) AS c FROM projects').get() as { c: number }).c
  if (projCount > 0) return

  const firstConn = d.prepare('SELECT id, name FROM connections ORDER BY id LIMIT 1').get() as { id: number; name: string } | undefined
  if (!firstConn) return
  const mods = d.prepare('SELECT * FROM legacy_modules ORDER BY id').all() as Array<Record<string, unknown>>
  for (const m of mods) {
    const info = d.prepare('INSERT INTO projects(name, comment) VALUES(?,?)')
      .run(String(m.name), String(m.comment || ''))
    const pid = Number(info.lastInsertRowid)
    d.prepare('INSERT INTO project_connections(project_id, connection_id) VALUES(?,?)').run(pid, firstConn.id)
    const dss = d.prepare('SELECT * FROM legacy_datasets WHERE module_id=?').all(m.id as number) as Array<Record<string, unknown>>
    for (const ds of dss) {
      d.prepare(`INSERT OR IGNORE INTO datasets(project_id, connection_id, name, kind, comment, params, sql, updated_at)
                 VALUES(?,?,?,?,?,?,?,?)`)
        .run(pid, firstConn.id, String(ds.name), String(ds.kind || 'other'), String(ds.comment || ''), String(ds.params || '[]'), String(ds.sql || ''), String(ds.updated_at || ''))
    }
  }
}

// ── 设置 ────────────────────────────────────────────────────────

// 默认值保持中性：机器相关配置（reportlets 路径、MySQL 连接、模型 Key）
// 首次使用在「设置」页填写；MySQL 连接已移入「连接」注册表，不再放设置。
const DEFAULT_SETTINGS: AppSettings = {
  frServerUrl: 'http://localhost:8075',
  reportletsPath: '',
  llmProvider: 'openai',
  llmBaseUrl: 'https://api.openai.com/v1',
  llmApiKey: '',
  llmModel: 'gpt-4o-mini'
}

export function getSettings(): AppSettings {
  const d = getDb()
  const rows = d.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  // 旧库可能残留 mysql* 键，读时过滤掉（迁移已转入 connections）
  const { mysqlHost: _h, mysqlPort: _p, mysqlUser: _u, mysqlPassword: _w, mysqlDatabase: _d, ...rest } = map as Record<string, string>
  return { ...DEFAULT_SETTINGS, ...rest } as AppSettings
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const d = getDb()
  const stmt = d.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
  )
  const tx = d.transaction((entries: Array<[string, string]>) => {
    for (const [k, v] of entries) stmt.run(k, v)
  })
  tx(Object.entries(patch).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))
  return getSettings()
}
