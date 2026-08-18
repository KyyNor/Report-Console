/**
 * 项目清单 — project.yaml 是可迁移项目的事实来源。
 * SQLite 只保存“本机是否已添加这个目录”及本机连接/设置；绝不保存资源布局。
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { basename, extname, join, relative, resolve, sep } from 'path'
import { parse, stringify } from 'yaml'
import { getDb, getSettings } from './db'
import type { DatasetKind, DatasetParam, TraditionalCptMeta } from '@shared/types'

export const PROJECT_MANIFEST = 'project.yaml'
const LEGACY_CONFIG = 'project.json'
const NAME_RE = /^[a-z][a-z0-9_]*$/

export interface ManagedPage {
  id: string
  jsx: string
  mjs: string
  cpt: string
}

export interface ManagedDataCpt {
  id: string
  cpt: string
}

export interface PortableDataset {
  name: string
  kind: DatasetKind
  comment: string
  connection: string
  params: DatasetParam[]
  sql: string
}

export interface PortableProcedure {
  name: string
  connection: string
  comment: string
  definition: string
}

export interface ProjectManifest {
  version: 1
  name: string
  comment: string
  connections: string[]
  managed: {
    pages: ManagedPage[]
    data: ManagedDataCpt[]
  }
  contracts: {
    datasets: PortableDataset[]
    procedures: PortableProcedure[]
  }
}

function slash(path: string): string {
  return path.split(sep).join('/')
}

function assertRelativePath(path: unknown, label: string, ext?: string): string {
  if (typeof path !== 'string' || !path.trim()) throw new Error(`${label} 缺失`)
  const value = path.replace(/\\/g, '/').replace(/^\.\//, '')
  if (value.startsWith('/') || value.split('/').includes('..')) throw new Error(`${label} 必须是项目内相对路径`)
  if (ext && !value.toLowerCase().endsWith(ext)) throw new Error(`${label} 必须以 ${ext} 结尾`)
  return value
}

function normalize(raw: unknown): ProjectManifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('project.yaml 根节点必须是对象')
  const x = raw as Record<string, unknown>
  if (x.version !== 1) throw new Error('project.yaml 仅支持 version: 1')
  if (typeof x.name !== 'string' || !NAME_RE.test(x.name)) throw new Error('project.yaml 的 name 不合法（需 [a-z][a-z0-9_]*）')
  const managed = (x.managed && typeof x.managed === 'object' && !Array.isArray(x.managed) ? x.managed : {}) as Record<string, unknown>
  const pagesRaw = Array.isArray(managed.pages) ? managed.pages : []
  const dataRaw = Array.isArray(managed.data) ? managed.data : []
  const ids = new Set<string>()
  const pages = pagesRaw.map((v, i) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`managed.pages[${i}] 必须是对象`)
    const item = v as Record<string, unknown>
    const id = item.id
    if (typeof id !== 'string' || !NAME_RE.test(id) || ids.has(id)) throw new Error(`managed.pages[${i}].id 不合法或重复`)
    ids.add(id)
    const jsx = assertRelativePath(item.jsx, `managed.pages[${i}].jsx`, '.jsx')
    const mjs = assertRelativePath(item.mjs, `managed.pages[${i}].mjs`, '.mjs')
    const cpt = assertRelativePath(item.cpt, `managed.pages[${i}].cpt`, '.cpt')
    if (new Set([jsx, mjs, cpt]).size !== 3) throw new Error(`managed.pages[${i}] 的 jsx/mjs/cpt 路径不能重复`)
    return { id, jsx, mjs, cpt }
  })
  const dataIds = new Set<string>()
  const data = dataRaw.map((v, i) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`managed.data[${i}] 必须是对象`)
    const item = v as Record<string, unknown>
    const id = item.id
    if (typeof id !== 'string' || !NAME_RE.test(id) || dataIds.has(id)) throw new Error(`managed.data[${i}].id 不合法或重复`)
    dataIds.add(id)
    return { id, cpt: assertRelativePath(item.cpt, `managed.data[${i}].cpt`, '.cpt') }
  })
  const contracts = (x.contracts && typeof x.contracts === 'object' && !Array.isArray(x.contracts) ? x.contracts : {}) as Record<string, unknown>
  const kinds = new Set<DatasetKind>(['list', 'stat', 'detail', 'dict', 'insert', 'update', 'delete', 'other'])
  const names = new Set<string>()
  const datasets = (Array.isArray(contracts.datasets) ? contracts.datasets : []).map((v, i) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`contracts.datasets[${i}] 必须是对象`)
    const item = v as Record<string, unknown>
    if (typeof item.name !== 'string' || !NAME_RE.test(item.name) || names.has(item.name)) throw new Error(`contracts.datasets[${i}].name 不合法或重复`)
    names.add(item.name)
    if (typeof item.kind !== 'string' || !kinds.has(item.kind as DatasetKind)) throw new Error(`contracts.datasets[${i}].kind 不合法`)
    if (typeof item.connection !== 'string' || !item.connection.trim()) throw new Error(`contracts.datasets[${i}].connection 缺失`)
    if (typeof item.sql !== 'string') throw new Error(`contracts.datasets[${i}].sql 缺失`)
    const params = Array.isArray(item.params) ? item.params.map((p, pi) => {
      if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error(`contracts.datasets[${i}].params[${pi}] 必须是对象`)
      const param = p as Record<string, unknown>
      if (typeof param.name !== 'string' || !param.name) throw new Error(`contracts.datasets[${i}].params[${pi}].name 缺失`)
      if (!['string', 'integer', 'double', 'formula'].includes(String(param.type))) throw new Error(`contracts.datasets[${i}].params[${pi}].type 不合法`)
      return { name: param.name, type: param.type as DatasetParam['type'], ...(typeof param.default === 'string' ? { default: param.default } : {}) }
    }) : []
    return { name: item.name, kind: item.kind as DatasetKind, comment: typeof item.comment === 'string' ? item.comment : '', connection: item.connection, params, sql: item.sql }
  })
  const procNames = new Set<string>()
  const procedures = (Array.isArray(contracts.procedures) ? contracts.procedures : []).map((v, i) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`contracts.procedures[${i}] 必须是对象`)
    const item = v as Record<string, unknown>
    if (typeof item.name !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(item.name) || procNames.has(item.name)) throw new Error(`contracts.procedures[${i}].name 不合法或重复`)
    procNames.add(item.name)
    if (typeof item.connection !== 'string' || !item.connection.trim()) throw new Error(`contracts.procedures[${i}].connection 缺失`)
    return { name: item.name, connection: item.connection, comment: typeof item.comment === 'string' ? item.comment : '', definition: assertRelativePath(item.definition ?? `meta/${item.name}.sql`, `contracts.procedures[${i}].definition`, '.sql') }
  })
  const connections = Array.isArray(x.connections) ? x.connections.filter((v): v is string => typeof v === 'string' && !!v.trim()) : []
  return {
    version: 1,
    name: x.name,
    comment: typeof x.comment === 'string' ? x.comment : '',
    connections: [...new Set(connections)],
    managed: { pages, data },
    contracts: { datasets, procedures }
  }
}

export function createManifest(name: string, comment: string, connections: string[]): ProjectManifest {
  return {
    version: 1,
    name,
    comment,
    connections: [...new Set(connections)],
    managed: {
      pages: [],
      data: [{ id: 'data', cpt: `data/${name}_data.cpt` }]
    },
    contracts: { datasets: [], procedures: [] }
  }
}

export function manifestPath(root: string): string {
  return join(root, PROJECT_MANIFEST)
}

/** 兼容旧 project.json：读取后在下次写入时升级为 project.yaml。 */
export function readManifest(root: string): ProjectManifest {
  const yamlPath = manifestPath(root)
  if (existsSync(yamlPath)) {
    try { return normalize(parse(readFileSync(yamlPath, 'utf-8'))) } catch (e) {
      throw new Error(`${PROJECT_MANIFEST} 解析失败：${(e as Error).message}`)
    }
  }
  const legacy = join(root, LEGACY_CONFIG)
  if (existsSync(legacy)) {
    try {
      const old = JSON.parse(readFileSync(legacy, 'utf-8')) as { name?: string; comment?: string; connections?: string[] }
      if (!old.name || !NAME_RE.test(old.name)) throw new Error('name 缺失或不合法')
      const manifest = createManifest(old.name, old.comment ?? '', old.connections ?? [])
      // v2 固定布局项目的无损兼容：把旧 pages/ 下已有 JSX 识别为受管页面，
      // 但不扫描或收录任意传统 CPT。
      const pagesDir = join(root, 'pages')
      if (existsSync(pagesDir)) {
        for (const file of readdirSync(pagesDir)) {
          if (extname(file) !== '.jsx') continue
          const id = basename(file, '.jsx')
          if (NAME_RE.test(id)) manifest.managed.pages.push({ id, jsx: `pages/${id}.jsx`, mjs: `pages/${id}.mjs`, cpt: `pages/${id}.cpt` })
        }
      }
      return manifest
    } catch (e) {
      throw new Error(`${LEGACY_CONFIG} 解析失败：${(e as Error).message}`)
    }
  }
  throw new Error(`目录里没有 ${PROJECT_MANIFEST}`)
}

export function writeManifest(root: string, manifest: ProjectManifest): void {
  const normalized = normalize(manifest)
  writeFileSync(manifestPath(root), stringify(normalized, { lineWidth: 0 }), 'utf-8')
}

export function projectRoot(name: string): string {
  const r = getDb().prepare('SELECT dir FROM projects WHERE name=?').get(name) as { dir: string | null } | undefined
  return r?.dir || join(getSettings().reportletsPath, name)
}

/** FineReport 使用 reportlets 根目录下的相对路径；项目名不是部署路径。 */
export function reportletProjectRoot(name: string): string {
  const configuredRoot = resolve(getSettings().reportletsPath)
  const project = resolve(projectRoot(name))
  const path = slash(relative(configuredRoot, project))
  if (!getSettings().reportletsPath || !path || path === '..' || path.startsWith('../')) {
    throw new Error(`项目目录不在本机 reportlets 目录内，无法由 FineReport 访问：${project}`)
  }
  return path
}

export function reportletFile(project: string, projectRelativePath: string): string {
  return `${reportletProjectRoot(project)}/${assertRelativePath(projectRelativePath, '资源路径')}`
}

export function manifestForProject(name: string): ProjectManifest {
  return readManifest(projectRoot(name))
}

export function resolveProjectFile(root: string, path: string): string {
  const absolute = resolve(root, path)
  const base = resolve(root)
  if (absolute !== base && !absolute.startsWith(`${base}${sep}`)) throw new Error('资源路径越出项目目录')
  return absolute
}

export function pageForProject(project: string, id: string): ManagedPage {
  const page = manifestForProject(project).managed.pages.find((x) => x.id === id)
  if (!page) throw new Error(`受管页面不存在：${project}/${id}`)
  return page
}

export function dataCptForProject(project: string): string {
  const manifest = manifestForProject(project)
  return manifest.managed.data[0]?.cpt ?? `data/${project}_data.cpt`
}

export function addManagedPage(project: string, page: ManagedPage): void {
  const root = projectRoot(project)
  const manifest = manifestForProject(project)
  if (manifest.managed.pages.some((x) => x.id === page.id)) throw new Error(`页面已存在：${page.id}`)
  manifest.managed.pages.push(page)
  writeManifest(root, manifest)
}

export function removeManagedPage(project: string, id: string): void {
  const root = projectRoot(project)
  const manifest = manifestForProject(project)
  const before = manifest.managed.pages.length
  manifest.managed.pages = manifest.managed.pages.filter((x) => x.id !== id)
  if (before === manifest.managed.pages.length) throw new Error(`页面不存在：${id}`)
  writeManifest(root, manifest)
}

/** 未在 project.yaml 的 managed 产物中声明的 CPT，全部视为传统 CPT。 */
export function listTraditionalCpts(project: string): TraditionalCptMeta[] {
  const root = projectRoot(project)
  if (!existsSync(root)) return []
  const managed = new Set([
    ...manifestForProject(project).managed.pages.map((x) => x.cpt),
    ...manifestForProject(project).managed.data.map((x) => x.cpt)
  ])
  const out: TraditionalCptMeta[] = []
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      const file = join(dir, entry.name)
      if (entry.isDirectory()) { visit(file); continue }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.cpt')) continue
      const path = slash(relative(root, file))
      if (managed.has(path)) continue
      const stat = statSync(file)
      out.push({ path, name: entry.name, size: stat.size, mtime: stat.mtimeMs })
    }
  }
  visit(root)
  return out.sort((a, b) => a.path.localeCompare(b.path))
}
