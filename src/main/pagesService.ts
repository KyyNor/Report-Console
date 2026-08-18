/**
 * 受管页面服务 — 页面位置由 project.yaml 声明，而不是固定 pages/ 目录。
 * 构建：jsx → esbuild → 净化 → 注入骨架 → 指定的 .mjs + .cpt。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, unlinkSync } from 'fs'
import { dirname } from 'path'
import { getDb } from './db'
import { compileJsx, generatePageCpt } from './cpt/displayWriter'
import { checkApiDataParameters, checkFineReportAjaxCompatibility, checkPageCpt, hasError } from './cpt/checker'
import { previewPageUrl } from './frClient'
import { addManagedPage, manifestForProject, pageForProject, projectRoot, removeManagedPage, reportletFile, resolveProjectFile, updateManagedPagePaths, type ManagedPage } from './projectManifest'
import { replaceUniqueText } from './textPatch'
import type { PageMeta, BuildResult } from '@shared/types'
import pageTemplateRaw from './templates/base_cpt_page.cpt?raw'
import starterBlank from './templates/starters/blank.jsx?raw'
import starterList from './templates/starters/list.jsx?raw'
import starterForm from './templates/starters/form.jsx?raw'

const STARTERS: Record<string, string> = {
  blank: starterBlank,
  list: starterList,
  form: starterForm
}

const NAME_RE = /^[a-z][a-z0-9_]*$/

function pagePaths(project: string, page: ManagedPage): { jsx: string; mjs: string; cpt: string } {
  const root = projectRoot(project)
  return { jsx: resolveProjectFile(root, page.jsx), mjs: resolveProjectFile(root, page.mjs), cpt: resolveProjectFile(root, page.cpt) }
}

// ── 扫描 ────────────────────────────────────────────────────────

export function listPages(projectFilter?: string): PageMeta[] {
  const projects = projectFilter
    ? [projectFilter]
    : (getDb().prepare('SELECT name FROM projects ORDER BY name').all() as Array<{ name: string }>).map((x) => x.name)
  const out: PageMeta[] = []
  for (const project of projects) {
    try { out.push(...manifestForProject(project).managed.pages.map((page) => scanPage(project, page))) } catch { /* 未迁移或目录缺失 */ }
  }
  return out.sort((a, b) => (a.project + a.name).localeCompare(b.project + b.name))
}

function scanPage(project: string, page: ManagedPage): PageMeta {
  const paths = pagePaths(project, page)
  const jsxExists = existsSync(paths.jsx)
  const cptExists = existsSync(paths.cpt)
  const jsxMtime = jsxExists ? statSync(paths.jsx).mtimeMs : 0
  const cptMtime = cptExists ? statSync(paths.cpt).mtimeMs : 0
  const last = getDb().prepare(
    "SELECT ok, created_at FROM builds WHERE kind='page' AND target=? ORDER BY id DESC LIMIT 1"
  ).get(`${project}/${page.cpt}`) as { ok: number; created_at: string } | undefined
  return {
    project,
    name: page.id,
    jsxPath: page.jsx,
    mjsPath: page.mjs,
    cptPath: page.cpt,
    jsxExists,
    mjsExists: existsSync(paths.mjs),
    cptExists,
    jsxMtime: jsxExists ? jsxMtime : undefined,
    cptMtime: cptExists ? cptMtime : undefined,
    stale: !jsxExists || !cptExists || cptMtime < jsxMtime,
    size: jsxExists ? statSync(paths.jsx).size : 0,
    lastBuildAt: last?.created_at,
    lastBuildOk: last ? last.ok === 1 : undefined
  }
}

// ── 读写 ────────────────────────────────────────────────────────

function assertName(name: string): void {
  if (!NAME_RE.test(name)) throw new Error('名称仅允许小写字母/数字/下划线')
}

export function readPage(projectName: string, pageName: string): string {
  assertName(projectName); assertName(pageName)
  const paths = pagePaths(projectName, pageForProject(projectName, pageName))
  if (!existsSync(paths.jsx)) throw new Error(`受管页面源文件不存在：${projectName}/${pageName}`)
  return readFileSync(paths.jsx, 'utf-8')
}

export function savePage(projectName: string, pageName: string, content: string, options: { overwrite?: boolean } = {}): void {
  assertName(projectName); assertName(pageName)
  if (!content.trim()) throw new Error('页面内容为空')
  const paths = pagePaths(projectName, pageForProject(projectName, pageName))
  if (existsSync(paths.jsx) && !options.overwrite) {
    throw new Error(`页面源文件已存在：${pageName}。请先用 patch_page 修改片段；只有明确需要整份覆盖时才传 overwrite=true`)
  }
  mkdirSync(dirname(paths.jsx), { recursive: true })
  writeFileSync(paths.jsx, content, 'utf-8')
}

/** 对已受管页面 JSX 的精确唯一片段替换。 */
export function patchPage(projectName: string, pageName: string, oldText: string, newText: string): void {
  assertName(projectName); assertName(pageName)
  const paths = pagePaths(projectName, pageForProject(projectName, pageName))
  if (!existsSync(paths.jsx)) throw new Error(`受管页面源文件不存在：${projectName}/${pageName}`)
  const content = readFileSync(paths.jsx, 'utf-8')
  writeFileSync(paths.jsx, replaceUniqueText(content, oldText, newText, `页面 ${pageName}`), 'utf-8')
}

export function createPage(projectName: string, pageName: string, starter: keyof typeof STARTERS = 'blank'): void {
  assertName(projectName); assertName(pageName)
  // 新建时仍采用默认路径；以后可直接编辑 project.yaml 调整路径。
  const page: ManagedPage = { id: pageName, jsx: `pages/${pageName}.jsx`, mjs: `pages/${pageName}.mjs`, cpt: `pages/${pageName}.cpt` }
  const paths = pagePaths(projectName, page)
  if (existsSync(paths.jsx)) throw new Error(`页面源文件已存在：${page.jsx}`)
  addManagedPage(projectName, page)
  try {
    mkdirSync(dirname(paths.jsx), { recursive: true })
    writeFileSync(paths.jsx, STARTERS[starter] ?? STARTERS.blank, 'utf-8')
  } catch (e) {
    removeManagedPage(projectName, pageName)
    throw e
  }
}

export function deletePage(projectName: string, pageName: string): void {
  assertName(projectName); assertName(pageName)
  const paths = pagePaths(projectName, pageForProject(projectName, pageName))
  for (const path of [paths.jsx, paths.mjs, paths.cpt]) if (existsSync(path)) unlinkSync(path)
  removeManagedPage(projectName, pageName)
}

export function updatePagePaths(projectName: string, pageName: string, paths: Omit<ManagedPage, 'id'>): void {
  assertName(projectName); assertName(pageName)
  updateManagedPagePaths(projectName, pageName, paths)
}

// ── 构建 ────────────────────────────────────────────────────────

export async function buildPage(projectName: string, pageName: string): Promise<BuildResult> {
  assertName(projectName); assertName(pageName)
  const page = pageForProject(projectName, pageName)
  const paths = pagePaths(projectName, page)
  if (!existsSync(paths.jsx)) throw new Error(`受管页面源文件不存在：${projectName}/${page.jsx}`)

  const log: string[] = []
  const jsx = readFileSync(paths.jsx, 'utf-8')
  log.push(`读取 JSX（${jsx.length} 字符）：${page.jsx}`)

  const { mjs, clean, hooksTransformed } = await compileJsx(jsx)
  log.push(`esbuild 编译完成；Hook 解构转换 ${hooksTransformed} 处`)

  mkdirSync(dirname(paths.mjs), { recursive: true })
  writeFileSync(paths.mjs, mjs, 'utf-8')
  log.push(`.mjs 已落盘：${page.mjs}`)

  const cpt = generatePageCpt(pageTemplateRaw, clean)
  const findings = [...checkPageCpt(cpt, pageTemplateRaw), ...checkApiDataParameters(jsx), ...checkFineReportAjaxCompatibility(jsx)]
  const errCount = findings.filter((f) => f.severity === 'error').length
  const warnCount = findings.filter((f) => f.severity === 'warning').length
  log.push(`质量门：${errCount} error / ${warnCount} warning`)

  const ok = !hasError(findings)
  if (ok) {
    mkdirSync(dirname(paths.cpt), { recursive: true })
    writeFileSync(paths.cpt, cpt, 'utf-8')
    log.push(`已部署：${page.cpt}`)
  } else {
    log.push('存在 error，CPT 未落盘（.mjs 保留供排查）')
  }

  getDb().prepare('INSERT INTO builds(kind, target, ok, log) VALUES(?,?,?,?)')
    .run('page', `${projectName}/${page.cpt}`, ok ? 1 : 0, JSON.stringify(log))

  return { ok, kind: 'page', target: `${projectName}/${page.cpt}`, outputPath: ok ? paths.cpt : undefined, findings, log }
}

export function pagePreviewUrl(projectName: string, pageName: string): string {
  return previewPageUrl(reportletFile(projectName, pageForProject(projectName, pageName).cpt))
}
