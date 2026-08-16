/**
 * SQLite 存储（better-sqlite3）
 * - 契约（模块/数据集）与状态（构建/测试/审计/会话）的唯一持久层
 * - 库文件：~/Library/Application Support/report-console/data.sqlite3
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
  d.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS modules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT UNIQUE NOT NULL,
  datasource TEXT NOT NULL DEFAULT '',
  comment    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS datasets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id  INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'other',
  comment    TEXT NOT NULL DEFAULT '',
  params     TEXT NOT NULL DEFAULT '[]',
  sql        TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(module_id, name)
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
}

// ── 设置 ────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: AppSettings = {
  frServerUrl: 'http://localhost:8075',
  reportletsPath: '/Applications/FineReport/webapps/webroot/WEB-INF/reportlets',
  mysqlHost: '127.0.0.1',
  mysqlPort: '3306',
  mysqlUser: 'root',
  mysqlPassword: 'taosha123',
  mysqlDatabase: 'whjcbb',
  llmProvider: 'openai',
  llmBaseUrl: 'https://api.openai.com/v1',
  llmApiKey: '',
  llmModel: 'gpt-4o-mini'
}

export function getSettings(): AppSettings {
  const d = getDb()
  const rows = d.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  return { ...DEFAULT_SETTINGS, ...map } as AppSettings
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
