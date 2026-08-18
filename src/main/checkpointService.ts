/**
 * 开发检查点服务。
 *
 * RC 的检查点是应用本地历史：元数据进 SQLite，内容以 SHA-256 去重后压缩存到
 * userData/checkpoints/。它不会创建 .git、不会读取/修改 .svn，也不会快照传统 CPT
 * 或数据库内容。
 */

import { app } from 'electron'
import { createHash, randomUUID } from 'crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { gzipSync, gunzipSync } from 'zlib'
import { basename, dirname, join } from 'path'
import { getDb } from './db'
import { manifestForProject, projectRoot, resolveProjectFile } from './projectManifest'
import type {
  CheckpointDiff, CheckpointFileDiff, CheckpointFileMeta, CheckpointOrigin,
  DevelopmentCheckpoint
} from '@shared/types'

type FileMap = Map<string, CheckpointFileMeta>

interface ProjectRow { id: number; name: string }
interface CheckpointRow {
  id: string
  project_id: number
  origin: CheckpointOrigin
  title: string
  session_id: string | null
  parent_id: string | null
  restored_from: string | null
  file_count: number
  additions: number
  deletions: number
  created_at: string
}

const META_SOURCE_RE = /\.(?:md|markdown|txt|html?|sql|js|jsx|mjs|css)$/i
const MAX_FILE_BYTES = 8 * 1024 * 1024

function requireProject(project: string): ProjectRow {
  const row = getDb().prepare('SELECT id, name FROM projects WHERE name=?').get(project) as ProjectRow | undefined
  if (!row) throw new Error(`项目不存在：${project}`)
  return row
}

function objectRoot(): string {
  const root = join(app.getPath('userData'), 'checkpoints', 'objects')
  mkdirSync(root, { recursive: true })
  return root
}

function objectPath(hash: string): string {
  return join(objectRoot(), `${hash}.gz`)
}

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

function putObject(content: Buffer): CheckpointFileMeta {
  const hash = sha256(content)
  const target = objectPath(hash)
  if (!existsSync(target)) {
    const temp = `${target}.${process.pid}.${randomUUID()}.tmp`
    writeFileSync(temp, gzipSync(content))
    try { renameSync(temp, target) } catch (e) {
      if (existsSync(temp)) unlinkSync(temp)
      if (!existsSync(target)) throw e
    }
  }
  return { path: '', hash, bytes: content.length }
}

function readObject(hash: string): Buffer {
  const path = objectPath(hash)
  if (!existsSync(path)) throw new Error(`检查点内容对象缺失：${hash.slice(0, 12)}`)
  return gunzipSync(readFileSync(path))
}

function relativeMetaFiles(root: string): string[] {
  const meta = resolveProjectFile(root, 'meta')
  if (!existsSync(meta)) return []
  return readdirSync(meta)
    .filter((name) => META_SOURCE_RE.test(name))
    .filter((name) => {
      const p = join(meta, name)
      try { return lstatSync(p).isFile() } catch { return false }
    })
    .map((name) => `meta/${name}`)
}

/**
 * 受控快照边界：project.yaml、受管 JSX、过程定义、meta/ 文档。
 * MJS/CPT 是构建产物；传统 CPT 绝不可出现在这里。
 */
export function managedSourcePaths(project: string): string[] {
  const root = projectRoot(project)
  const manifest = manifestForProject(project)
  const paths = new Set<string>(['project.yaml', ...relativeMetaFiles(root)])
  for (const page of manifest.managed.pages) paths.add(page.jsx)
  for (const procedure of manifest.contracts.procedures) paths.add(procedure.definition)
  return [...paths].sort()
}

function captureInventory(project: string): FileMap {
  const root = projectRoot(project)
  const out: FileMap = new Map()
  for (const relativePath of managedSourcePaths(project)) {
    const absolute = resolveProjectFile(root, relativePath)
    if (!existsSync(absolute)) continue
    const stat = lstatSync(absolute)
    if (!stat.isFile()) continue
    if (stat.size > MAX_FILE_BYTES) throw new Error(`受管源文件超过 8MB，无法建立可靠检查点：${relativePath}`)
    const item = putObject(readFileSync(absolute))
    out.set(relativePath, { ...item, path: relativePath })
  }
  return out
}

function rowToCheckpoint(project: string, row: CheckpointRow): DevelopmentCheckpoint {
  return {
    id: row.id,
    project,
    origin: row.origin,
    title: row.title,
    sessionId: row.session_id ?? undefined,
    parentId: row.parent_id ?? undefined,
    restoredFrom: row.restored_from ?? undefined,
    fileCount: row.file_count,
    additions: row.additions,
    deletions: row.deletions,
    createdAt: row.created_at
  }
}

function latestRow(projectId: number): CheckpointRow | undefined {
  return getDb().prepare('SELECT * FROM dev_checkpoints WHERE project_id=? ORDER BY rowid DESC LIMIT 1').get(projectId) as CheckpointRow | undefined
}

function checkpointRow(projectId: number, id: string): CheckpointRow {
  const row = getDb().prepare('SELECT * FROM dev_checkpoints WHERE id=? AND project_id=?').get(id, projectId) as CheckpointRow | undefined
  if (!row) throw new Error('开发检查点不存在或不属于当前项目')
  return row
}

function inventoryOfCheckpoint(projectId: number, checkpointId: string): FileMap {
  checkpointRow(projectId, checkpointId)
  const rows = getDb().prepare('SELECT path, content_hash, bytes FROM dev_checkpoint_files WHERE checkpoint_id=? ORDER BY path').all(checkpointId) as Array<{ path: string; content_hash: string; bytes: number }>
  return new Map(rows.map((row) => [row.path, { path: row.path, hash: row.content_hash, bytes: row.bytes }]))
}

function sameInventory(a: FileMap, b: FileMap): boolean {
  if (a.size !== b.size) return false
  for (const [path, file] of a) if (b.get(path)?.hash !== file.hash) return false
  return true
}

function diffMaps(before: FileMap, after: FileMap): CheckpointDiff['changes'] {
  const paths = new Set([...before.keys(), ...after.keys()])
  const changes: CheckpointDiff['changes'] = []
  for (const path of [...paths].sort()) {
    const oldFile = before.get(path)
    const newFile = after.get(path)
    if (!oldFile && newFile) changes.push({ path, kind: 'added', after: newFile })
    else if (oldFile && !newFile) changes.push({ path, kind: 'deleted', before: oldFile })
    else if (oldFile && newFile && oldFile.hash !== newFile.hash) changes.push({ path, kind: 'modified', before: oldFile, after: newFile })
  }
  return changes
}

function stats(changes: CheckpointDiff['changes']): { additions: number; deletions: number } {
  return {
    additions: changes.filter((x) => x.kind === 'added').length,
    deletions: changes.filter((x) => x.kind === 'deleted').length
  }
}

function saveCheckpoint(project: string, origin: CheckpointOrigin, title: string, inventory: FileMap, options: {
  sessionId?: string
  restoredFrom?: string
  force?: boolean
} = {}): DevelopmentCheckpoint | null {
  const p = requireProject(project)
  const parent = latestRow(p.id)
  const before = parent ? inventoryOfCheckpoint(p.id, parent.id) : new Map<string, CheckpointFileMeta>()
  const changes = diffMaps(before, inventory)
  if (!options.force && parent && changes.length === 0) return null
  const count = stats(changes)
  const id = randomUUID()
  const d = getDb()
  d.transaction(() => {
    d.prepare(`INSERT INTO dev_checkpoints(id, project_id, origin, title, session_id, parent_id, restored_from, file_count, additions, deletions)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      id, p.id, origin, title, options.sessionId ?? null, parent?.id ?? null,
      options.restoredFrom ?? null, inventory.size, count.additions, count.deletions
    )
    const insert = d.prepare('INSERT INTO dev_checkpoint_files(checkpoint_id, path, content_hash, bytes) VALUES(?,?,?,?)')
    for (const file of inventory.values()) insert.run(id, file.path, file.hash, file.bytes)
  })()
  return rowToCheckpoint(project, checkpointRow(p.id, id))
}

/** 首次使用或主动读历史时，为当前源码记录不可变基线。 */
export function ensureBaseline(project: string): DevelopmentCheckpoint {
  const p = requireProject(project)
  const latest = latestRow(p.id)
  if (latest) return rowToCheckpoint(project, latest)
  const checkpoint = saveCheckpoint(project, 'baseline', '开始版本记录', captureInventory(project), { force: true })
  if (!checkpoint) throw new Error('无法创建开发检查点基线')
  return checkpoint
}

export function listCheckpoints(project: string): DevelopmentCheckpoint[] {
  ensureBaseline(project)
  const p = requireProject(project)
  const rows = getDb().prepare('SELECT * FROM dev_checkpoints WHERE project_id=? ORDER BY rowid DESC').all(p.id) as CheckpointRow[]
  return rows.map((row) => rowToCheckpoint(project, row))
}

/** 人工资源保存完成后调用；仅源文件确有变化才产生版本。 */
export function captureManualCheckpoint(project: string, title: string): DevelopmentCheckpoint | null {
  ensureBaseline(project)
  return saveCheckpoint(project, 'manual', title, captureInventory(project))
}

/** 显式命名检查点，不产生空版本。 */
export function createNamedCheckpoint(project: string, title: string): DevelopmentCheckpoint | null {
  const cleaned = title.trim().slice(0, 160) || '手工检查点'
  ensureBaseline(project)
  return saveCheckpoint(project, 'manual', cleaned, captureInventory(project))
}

/** 在 Agent 运行前固定回合基线，避免工具写入后才丢失“修改前”的内容。 */
export function startAgentTurn(project: string, sessionId: string, prompt: string): string {
  const p = requireProject(project)
  const baseline = ensureBaseline(project)
  const id = randomUUID()
  const title = prompt.trim().replace(/\s+/g, ' ').slice(0, 160) || 'Agent 开发回合'
  getDb().prepare('INSERT INTO dev_checkpoint_turns(id, project_id, session_id, title, baseline_id) VALUES(?,?,?,?,?)')
    .run(id, p.id, sessionId, title, baseline.id)
  return id
}

/** Agent 回合收口；只有快照相对回合开始时改变才创建检查点。 */
export function finishAgentTurn(turnId: string): DevelopmentCheckpoint | null {
  const row = getDb().prepare('SELECT * FROM dev_checkpoint_turns WHERE id=?').get(turnId) as {
    id: string; project_id: number; session_id: string; title: string; baseline_id: string
  } | undefined
  if (!row) return null
  const p = getDb().prepare('SELECT name FROM projects WHERE id=?').get(row.project_id) as { name: string } | undefined
  getDb().prepare('DELETE FROM dev_checkpoint_turns WHERE id=?').run(turnId)
  if (!p) return null
  const baseline = inventoryOfCheckpoint(row.project_id, row.baseline_id)
  const inventory = captureInventory(p.name)
  if (sameInventory(baseline, inventory)) return null
  return saveCheckpoint(p.name, 'agent', row.title, inventory, { sessionId: row.session_id })
}

/** 最近检查点与当前工作区的变更；读取时会确保存在基线。 */
export function workingDiff(project: string): CheckpointDiff {
  const baseline = ensureBaseline(project)
  const p = requireProject(project)
  const before = inventoryOfCheckpoint(p.id, baseline.id)
  const after = captureInventory(project)
  const changes = diffMaps(before, after)
  const count = stats(changes)
  return { from: baseline.id, to: 'working', additions: count.additions, deletions: count.deletions, changes }
}

/** 比较两次检查点；to 缺省代表当前工作区。 */
export function diffCheckpoints(project: string, from: string, to?: string): CheckpointDiff {
  const p = requireProject(project)
  const before = inventoryOfCheckpoint(p.id, from)
  const after = to ? inventoryOfCheckpoint(p.id, to) : captureInventory(project)
  const changes = diffMaps(before, after)
  const count = stats(changes)
  return { from, to: to ?? 'working', additions: count.additions, deletions: count.deletions, changes }
}

function contentFrom(file: CheckpointFileMeta | undefined): string | undefined {
  if (!file) return undefined
  return readObject(file.hash).toString('utf-8')
}

/** 为右栏按文件读取双栏 Diff 内容；内容始终来自不可变内容对象。 */
export function diffFile(project: string, from: string, path: string, to?: string): CheckpointFileDiff {
  const p = requireProject(project)
  const before = inventoryOfCheckpoint(p.id, from).get(path)
  const after = (to ? inventoryOfCheckpoint(p.id, to) : captureInventory(project)).get(path)
  if (!before && !after) throw new Error('此文件不属于比较范围')
  return { path, before: contentFrom(before), after: contentFrom(after) }
}

/**
 * 仅恢复受控源文件。恢复前总会留一份可回退的检查点；生成的 MJS/CPT 与数据库
 * 绝不回滚，调用方应提示用户重新构建。
 */
export function restoreCheckpoint(project: string, targetId: string): DevelopmentCheckpoint {
  const p = requireProject(project)
  const target = checkpointRow(p.id, targetId)
  const targetFiles = inventoryOfCheckpoint(p.id, targetId)
  const current = captureInventory(project)
  const known = new Set<string>([
    ...current.keys(),
    ...targetFiles.keys(),
    ...listKnownPaths(p.id)
  ])

  // 即使工作区恰好与最近检查点一致，也保留恢复前节点，保证恢复动作可撤销。
  saveCheckpoint(project, 'restore', `恢复前：${target.title}`, current, { force: true })

  const root = projectRoot(project)
  for (const relativePath of known) {
    const absolute = resolveProjectFile(root, relativePath)
    const file = targetFiles.get(relativePath)
    if (file) {
      mkdirSync(dirname(absolute), { recursive: true })
      writeFileSync(absolute, readObject(file.hash))
    } else if (existsSync(absolute) && lstatSync(absolute).isFile()) {
      unlinkSync(absolute)
    }
  }

  const restored = saveCheckpoint(project, 'restore', `已恢复至：${target.title}`, captureInventory(project), { force: true, restoredFrom: target.id })
  if (!restored) throw new Error('恢复后无法创建检查点')
  return restored
}

function listKnownPaths(projectId: number): string[] {
  const rows = getDb().prepare(`SELECT DISTINCT f.path FROM dev_checkpoint_files f
    JOIN dev_checkpoints c ON c.id=f.checkpoint_id WHERE c.project_id=?`).all(projectId) as Array<{ path: string }>
  return rows.map((row) => row.path)
}

/** 供单元测试与调用方使用：只比较内容哈希，不依赖 Electron。 */
export function diffInventoriesForTest(before: CheckpointFileMeta[], after: CheckpointFileMeta[]): CheckpointDiff['changes'] {
  return diffMaps(new Map(before.map((x) => [x.path, x])), new Map(after.map((x) => [x.path, x])))
}
