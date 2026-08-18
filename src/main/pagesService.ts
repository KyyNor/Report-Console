/**
 * 受管页面服务 — 页面位置由 project.yaml 声明，而不是固定 pages/ 目录。
 * 构建：jsx → esbuild → 净化 → 注入骨架 → 指定的 .mjs + .cpt。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, unlinkSync } from 'fs'
import { dirname } from 'path'
import { getDb } from './db'
import { compileJsx, generateMobilePageCpt, generatePageCpt } from './cpt/displayWriter'
import { checkApiDataParameters, checkFineReportAjaxCompatibility, checkMobilePageCpt, checkPageCpt, hasError } from './cpt/checker'
import { previewMobilePageUrl, previewPageUrl } from './frClient'
import { addManagedPage, manifestForProject, pageForProject, projectRoot, removeManagedPage, reportletFile, resolveProjectFile, updateManagedPagePaths, type ManagedPage } from './projectManifest'
import { replaceUniqueText } from './textPatch'
import type { PageMeta, PagePlatform, BuildResult } from '@shared/types'
import pageTemplateRaw from './templates/base_cpt_page.cpt?raw'
import mobilePageTemplateRaw from './templates/base_cpt_page_mobile.cpt?raw'
import starterBlank from './templates/starters/blank.jsx?raw'
import starterList from './templates/starters/list.jsx?raw'
import starterForm from './templates/starters/form.jsx?raw'
import starterMobile from './templates/starters/mobile.jsx?raw'

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
    platform: page.platform,
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

export function createPage(projectName: string, pageName: string, starter: keyof typeof STARTERS = 'blank', requestedPlatform?: PagePlatform): void {
  assertName(projectName); assertName(pageName)
  const projectPlatform = manifestForProject(projectName).platform
  const platform: PagePlatform = requestedPlatform ?? (projectPlatform === 'mobile' ? 'mobile' : projectPlatform === 'desktop' ? 'desktop' : (() => { throw new Error('双端项目新建页面时必须指定 platform=desktop 或 mobile') })())
  if (projectPlatform !== 'dual' && projectPlatform !== platform) throw new Error(`${projectPlatform} 项目不能新建 ${platform} 页面`)
  // 新建时仍采用默认路径；以后可直接编辑 project.yaml 调整路径。
  const page: ManagedPage = { id: pageName, platform, jsx: `pages/${pageName}.jsx`, mjs: `pages/${pageName}.mjs`, cpt: `pages/${pageName}.cpt` }
  const paths = pagePaths(projectName, page)
  if (existsSync(paths.jsx)) throw new Error(`页面源文件已存在：${page.jsx}`)
  addManagedPage(projectName, page)
  try {
    mkdirSync(dirname(paths.jsx), { recursive: true })
    writeFileSync(paths.jsx, platform === 'mobile' ? starterMobile : (STARTERS[starter] ?? STARTERS.blank), 'utf-8')
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

  const template = page.platform === 'mobile' ? mobilePageTemplateRaw : pageTemplateRaw
  const cpt = page.platform === 'mobile' ? generateMobilePageCpt(template, clean) : generatePageCpt(template, clean)
  const findings = [
    ...(page.platform === 'mobile' ? checkMobilePageCpt(cpt, template) : checkPageCpt(cpt, template)),
    ...checkApiDataParameters(jsx),
    ...checkFineReportAjaxCompatibility(jsx)
  ]
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
  const page = pageForProject(projectName, pageName)
  const reportlet = reportletFile(projectName, page.cpt)
  return page.platform === 'mobile' ? previewMobilePageUrl(reportlet) : previewPageUrl(reportlet)
}
