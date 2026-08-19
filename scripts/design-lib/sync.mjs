#!/usr/bin/env node
/**
 * 设计库同步脚本 —— 克隆 ui-ux-pro-max-skill 上游最新代码，按 config.mjs 的
 * 剔除/精简清单转换成 jsonl 落入 src/main/agent/designlib/data/，并输出差异报告：
 * 文件级（新增/修改/删除）与条目级（按 key 对比），未入清单的上游条目会显式列出，
 * 其中自上次同步新增的会单独标注，便于决定是否收录进 config.mjs。
 *
 * 用法：
 *   node scripts/design-lib/sync.mjs              # 同步 + 差异报告（写入目标目录）
 *   node scripts/design-lib/sync.mjs --inspect    # 只打印上游各 CSV 列名/行数/条目名，不写文件
 *   node scripts/design-lib/sync.mjs --dry-run    # 只产出报告，不写入
 *   node scripts/design-lib/sync.mjs --json       # 报告以 JSON 输出（可与 --dry-run 组合）
 *
 * 退出码：0 正常完成（允许有警告）；1 克隆失败或上游结构与配置不符（缺文件/缺 key 列/缺配置列）。
 * data/ 与 references/ 只能由本脚本产出；设计库内容调整一律改 config.mjs，不要手改产物。
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv } from './lib/csv.mjs'
import { applyDomain, diffByKeys } from './lib/transform.mjs'
import config from './config.mjs'

const args = new Set(process.argv.slice(2))
const INSPECT = args.has('--inspect')
const DRY_RUN = args.has('--dry-run')
const JSON_OUT = args.has('--json')

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const targetDir = resolve(repoRoot, config.targetDir)
const dataDir = join(targetDir, 'data')
const refsDir = join(targetDir, 'references')
const cacheRoot = join(repoRoot, config.cacheDir)
const cacheRepo = join(cacheRoot, 'repo')
const upstreamData = join(cacheRepo, config.source.dataDir)
const upstreamRefs = join(cacheRepo, config.source.referencesDir)

const sha256 = (s) => createHash('sha256').update(s).digest('hex')
const fail = (msg) => { console.error(msg); process.exit(1) }

function clone() {
  rmSync(cacheRoot, { recursive: true, force: true })
  mkdirSync(cacheRoot, { recursive: true })
  try {
    execFileSync('git', ['clone', '--quiet', '--depth', '1', '--branch', config.source.ref, config.source.repo, cacheRepo])
  } catch (e) {
    fail(`克隆上游失败（${config.source.repo}@${config.source.ref}）：${e.message}`)
  }
  const commit = execFileSync('git', ['-C', cacheRepo, 'rev-parse', 'HEAD']).toString().trim()
  const commitDate = execFileSync('git', ['-C', cacheRepo, 'log', '-1', '--format=%cI']).toString().trim()
  return { commit, commitDate }
}

const keyColsOf = (key) => (Array.isArray(key) ? key : [key])
const keyOfRow = (row, key) => keyColsOf(key).map((c) => String(row[c] ?? '').trim()).join(' / ')

function inspectReport(commit) {
  const lines = [`上游 ${config.source.repo}@${commit.slice(0, 8)} · ${config.source.dataDir}`]
  const domainFiles = new Map(Object.entries(config.domains).map(([scope, d]) => [d.file, scope]))
  const entries = readdirSync(upstreamData, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
  for (const ent of entries) {
    if (ent.isDirectory()) {
      lines.push(`\n## ${ent.name}/ [目录] ${config.exclude.includes(ent.name) ? '已整目录剔除' : '未分类——请加入 exclude 或按文件收编'}`)
      continue
    }
    const scope = domainFiles.get(ent.name)
    const tag = scope ? `scope=${scope}` : config.exclude.includes(ent.name) ? '已剔除' : '未分类——请加入 exclude 或 domains'
    if (!ent.name.endsWith('.csv')) {
      lines.push(`\n## ${ent.name} [${tag}]（非 CSV，跳过解析）`)
      continue
    }
    const { columns, rows } = parseCsv(readFileSync(join(upstreamData, ent.name), 'utf8'))
    const keyCols = scope ? keyColsOf(config.domains[scope].key) : [columns[0]]
    const keys = rows.map((r) => keyCols.map((c) => String(r[c] ?? '')).join(' / ')).filter(Boolean)
    lines.push(`\n## ${ent.name}（${rows.length} 行）[${tag}]`)
    lines.push(`列（${columns.length}）：${columns.join(' | ')}`)
    for (let i = 0; i < keys.length; i += 4) lines.push(`条目（key=${keyCols.join('+')}）：${keys.slice(i, i + 4).join('、')}`)
  }
  return lines.join('\n')
}

const source = clone()
if (INSPECT) { console.log(inspectReport(source.commit)); process.exit(0) }

const warnings = []
const outputs = [] // { path, content }
const domainStats = []
const prevManifestPath = join(targetDir, 'manifest.json')
const prev = existsSync(prevManifestPath) ? JSON.parse(readFileSync(prevManifestPath, 'utf8')) : null

// ── 按域转换 ─────────────────────────────────────────────
for (const [scope, cfg] of Object.entries(config.domains)) {
  const file = join(upstreamData, cfg.file)
  if (!existsSync(file)) fail(`上游缺少配置声明的文件：${cfg.file}（scope=${scope}）。上游结构已变化，请先 --inspect 校准 config.mjs。`)
  const { columns, rows } = parseCsv(readFileSync(file, 'utf8'))
  const lostKeys = keyColsOf(cfg.key).filter((c) => !columns.includes(c))
  if (lostKeys.length) fail(`上游 ${cfg.file} 缺少 key 列「${lostKeys.join('、')}」；现有列：${columns.join('、')}`)
  const lostCols = (cfg.columns ?? []).filter((c) => !columns.includes(c))
  if (lostCols.length) fail(`上游 ${cfg.file} 缺少配置的列：${lostCols.join('、')}；现有列：${columns.join('、')}`)

  const { rows: picked, missing } = applyDomain(rows, cfg)
  if (missing.length) warnings.push(`配置条目在上游不存在（已跳过，请更新 config.mjs）：${scope} → ${missing.join('、')}`)

  const upstreamKeys = [...new Set(rows.map((r) => keyOfRow(r, cfg.key)).filter(Boolean))]
  const entrySet = cfg.entries === '*' ? null : new Set(cfg.entries.map((s) => String(s).trim()))
  const unlisted = entrySet ? upstreamKeys.filter((k) => !entrySet.has(k)) : []
  const prevKeys = new Set(prev?.upstream?.[scope]?.keys ?? [])
  const newUpstream = prev ? upstreamKeys.filter((k) => !prevKeys.has(k)) : []

  const content = picked.map((r) => JSON.stringify(r)).join('\n') + (picked.length ? '\n' : '')
  outputs.push({ path: `data/${scope}.jsonl`, content })
  domainStats.push({ scope, file: cfg.file, key: cfg.key, picked, upstreamKeys, upstreamTotal: rows.length, unlisted, newUpstream, sha: sha256(content) })
}

// ── 参考文档 ─────────────────────────────────────────────
for (const name of config.references ?? []) {
  const p = join(upstreamRefs, name)
  if (!existsSync(p)) { warnings.push(`上游 references 缺少 ${name}（已跳过）`); continue }
  outputs.push({ path: `references/${name}`, content: readFileSync(p, 'utf8') })
}

// ── 未分类兜底：上游新面孔不静默入库 ─────────────────────
const classified = new Set([...Object.values(config.domains).map((d) => d.file), ...config.exclude])
for (const ent of readdirSync(upstreamData, { withFileTypes: true })) {
  if (!classified.has(ent.name)) {
    warnings.push(`上游出现未分类${ent.isDirectory() ? '目录' : '文件'}：${config.source.dataDir}/${ent.name}${ent.isDirectory() ? '/' : ''}（已跳过；请加入 exclude 或 domains）`)
  }
}
for (const name of config.exclude) {
  if (!existsSync(join(upstreamData, name))) warnings.push(`exclude 项在上游已不存在（可从配置移除）：${name}`)
}

// ── 文件级 diff ─────────────────────────────────────────
const fileDiff = { added: [], modified: [], unchanged: [], removed: [] }
const newPaths = new Map(outputs.map((o) => [o.path, o.content]))
for (const [sub, dir] of [['data', dataDir], ['references', refsDir]]) {
  if (!existsSync(dir)) continue
  for (const name of readdirSync(dir)) {
    if (!newPaths.has(`${sub}/${name}`)) fileDiff.removed.push(`${sub}/${name}`)
  }
}
for (const [p, content] of newPaths) {
  const disk = join(targetDir, p)
  if (!existsSync(disk)) fileDiff.added.push(p)
  else if (readFileSync(disk, 'utf8') !== content) fileDiff.modified.push(p)
  else fileDiff.unchanged.push(p)
}

// ── 条目级 diff（对比当前磁盘上的上次产出）────────────────
const entryDiffs = domainStats.map((d) => {
  const oldPath = join(dataDir, `${d.scope}.jsonl`)
  const oldRows = existsSync(oldPath)
    ? readFileSync(oldPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : []
  const diff = diffByKeys(oldRows, d.picked, d.key)
  return { scope: d.scope, upstreamTotal: d.upstreamTotal, kept: d.picked.length, ...diff }
})

// ── 报告 ────────────────────────────────────────────────
const report = {
  source: { repo: config.source.repo, ref: config.source.ref, commit: source.commit, commitDate: source.commitDate },
  previous: prev ? { commit: prev.source?.commit, syncedAt: prev.syncedAt } : null,
  dryRun: DRY_RUN,
  files: fileDiff,
  entries: entryDiffs,
  unlisted: domainStats.filter((d) => d.unlisted.length).map((d) => ({ scope: d.scope, count: d.unlisted.length, names: d.unlisted, newSinceLast: d.newUpstream })),
  warnings
}

if (!DRY_RUN) {
  rmSync(dataDir, { recursive: true, force: true })
  rmSync(refsDir, { recursive: true, force: true })
  for (const o of outputs) {
    const dest = join(targetDir, o.path)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, o.content)
  }
  const manifest = {
    source: { repo: config.source.repo, ref: config.source.ref, commit: source.commit, commitDate: source.commitDate },
    syncedAt: new Date().toISOString(),
    domains: Object.fromEntries(domainStats.map((d) => [`data/${d.scope}.jsonl`, { file: d.file, key: d.key, entries: d.picked.length, sha256: d.sha }])),
    upstream: Object.fromEntries(domainStats.map((d) => [d.scope, { total: d.upstreamTotal, keys: d.upstreamKeys }]))
  }
  writeFileSync(join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
}

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2))
  process.exit(0)
}

const lines = []
lines.push('# 设计库同步报告')
lines.push(`- 来源：${config.source.repo}@${source.commit.slice(0, 8)}（${config.source.ref}，${source.commitDate}）`)
lines.push(`- 上次同步：${prev ? `${String(prev.source?.commit ?? '').slice(0, 8)}（${prev.syncedAt}）` : '首次同步'}`)
lines.push(`- 目标：${relative(repoRoot, targetDir)}${DRY_RUN ? '（--dry-run，未写入）' : ''}`)

lines.push(`\n## 文件（新增 ${fileDiff.added.length} · 修改 ${fileDiff.modified.length} · 删除 ${fileDiff.removed.length} · 未变 ${fileDiff.unchanged.length}）`)
for (const p of fileDiff.added) lines.push(`+ ${p}`)
for (const p of fileDiff.modified) lines.push(`~ ${p}`)
for (const p of fileDiff.removed) lines.push(`- ${p}`)

lines.push('\n## 条目')
lines.push('| scope | 上游 | 入库 | +新增 | ~修改 | -移除 |')
lines.push('|---|---|---|---|---|---|')
for (const e of entryDiffs) {
  lines.push(`| ${e.scope} | ${e.upstreamTotal} | ${e.kept} | ${e.added.length} | ${e.modified.length} | ${e.removed.length} |`)
}

const unlistedTotal = report.unlisted.reduce((n, u) => n + u.count, 0)
if (unlistedTotal > 0) {
  lines.push(`\n## 上游未入清单条目（共 ${unlistedTotal}）`)
  for (const u of report.unlisted) {
    const head = u.names.slice(0, 30).join('、')
    const more = u.count > 30 ? ` …等 ${u.count} 个` : ''
    lines.push(`- ${u.scope}：${head}${more}`)
    if (u.newSinceLast.length) lines.push(`  - 其中自上次同步新增 ${u.newSinceLast.length} 个：${u.newSinceLast.join('、')}`)
  }
} else {
  lines.push('\n## 上游未入清单条目：无')
}

lines.push('\n## 警告')
lines.push(warnings.length ? warnings.map((w) => `- ⚠ ${w}`).join('\n') : '无')
console.log(lines.join('\n'))
