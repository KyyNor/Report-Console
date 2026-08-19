/**
 * 设计库同步的纯转换函数（可单测，不碰网络与磁盘）。
 *
 * 精简模型：文件名 + 条目名白名单。entries 支持：
 *   - 字符串数组：显式白名单，按配置顺序入库；上游新增条目不自动入库，由同步报告列出。
 *   - '*'：全量收录（适合小而稳定的文件），上游新增条目自动入库并在 diff 中体现。
 * key 支持复合列（数组），条目名用 “ / ” 连接（如 “Navigation / Breadcrumbs”）。
 */

function keyOf(row, key) {
  const cols = Array.isArray(key) ? key : [key]
  return cols.map((c) => String(row[c] ?? '').trim()).join(' / ')
}

function pickColumns(row, cfg) {
  if (!cfg.columns) return row
  const keyCols = Array.isArray(cfg.key) ? cfg.key : [cfg.key]
  const keep = [...new Set([...keyCols, ...cfg.columns])]
  return Object.fromEntries(keep.map((c) => [c, row[c] ?? '']))
}

/** 按域配置裁剪行：条目白名单 + 可选列白名单（key 列强制保留）。返回 missing = 配置里有但上游没有的条目。 */
export function applyDomain(rows, cfg) {
  if (cfg.entries === '*') {
    return { rows: rows.map((r) => pickColumns(r, cfg)), missing: [] }
  }
  const byKey = new Map(rows.map((r) => [keyOf(r, cfg.key), r]))
  const picked = []
  const missing = []
  for (const name of cfg.entries) {
    const row = byKey.get(String(name).trim())
    if (!row) { missing.push(name); continue }
    picked.push(pickColumns(row, cfg))
  }
  return { rows: picked, missing }
}

function stableLine(row) {
  return JSON.stringify(Object.keys(row).sort().reduce((acc, k) => { acc[k] = row[k]; return acc }, {}))
}

/** 条目级 diff：按 key 对比新旧两组行；同 key 且内容（键序无关）不同记为修改。 */
export function diffByKeys(oldRows, newRows, key) {
  const oldMap = new Map(oldRows.map((r) => [keyOf(r, key), stableLine(r)]))
  const nextMap = new Map(newRows.map((r) => [keyOf(r, key), stableLine(r)]))
  const added = []
  const modified = []
  const removed = []
  for (const [k, line] of nextMap) {
    if (!oldMap.has(k)) added.push(k)
    else if (oldMap.get(k) !== line) modified.push(k)
  }
  for (const k of oldMap.keys()) if (!nextMap.has(k)) removed.push(k)
  return { added, modified, removed }
}
