/**
 * 页面管理 — jsx/mjs/cpt 全部原地放在 reportlets/{module}/pages/
 * 构建：jsx → esbuild → 净化 → 注入骨架 → .mjs + .cpt 同目录落盘
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import { join, basename, extname } from 'path'
import { getDb, getSettings } from './db'
import { compileJsx, generatePageCpt } from './cpt/displayWriter'
import { checkPageCpt, hasError } from './cpt/checker'
import { previewPageUrl } from './frClient'
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

function pagesRoot(moduleName?: string): string {
  const s = getSettings()
  return moduleName ? join(s.reportletsPath, moduleName, 'pages') : join(s.reportletsPath)
}

// ── 扫描 ────────────────────────────────────────────────────────

export function listPages(): PageMeta[] {
  const root = getSettings().reportletsPath
  if (!existsSync(root)) return []
  const out: PageMeta[] = []
  for (const mod of readdirSync(root)) {
    const modDir = join(root, mod)
    const pagesDir = join(modDir, 'pages')
    if (!existsSync(pagesDir)) continue
    for (const f of readdirSync(pagesDir)) {
      if (extname(f) !== '.jsx') continue
      const name = basename(f, '.jsx')
      const jsxPath = join(pagesDir, f)
      const mjsPath = join(pagesDir, `${name}.mjs`)
      const cptPath = join(pagesDir, `${name}.cpt`)
      const jsxMtime = statSync(jsxPath).mtimeMs
      const cptMtime = existsSync(cptPath) ? statSync(cptPath).mtimeMs : 0
      out.push({
        module: mod,
        name,
        jsxExists: true,
        mjsExists: existsSync(mjsPath),
        cptExists: existsSync(cptPath),
        jsxMtime,
        cptMtime,
        stale: !existsSync(cptPath) || cptMtime < jsxMtime,
        size: statSync(jsxPath).size
      })
    }
  }
  return out.sort((a, b) => (a.module + a.name).localeCompare(b.module + b.name))
}

// ── 读写 ────────────────────────────────────────────────────────

function assertModuleName(name: string): void {
  if (!/^[a-z][a-z0-9_]*$/i.test(name)) throw new Error('模块名仅允许字母/数字/下划线')
}

function assertPageName(name: string): void {
  if (!/^[a-z][a-z0-9_]*$/i.test(name)) throw new Error('页面名仅允许字母/数字/下划线')
}

export function readPage(moduleName: string, pageName: string): string {
  assertModuleName(moduleName); assertPageName(pageName)
  const p = join(pagesRoot(moduleName), `${pageName}.jsx`)
  if (!existsSync(p)) throw new Error(`页面不存在：${moduleName}/pages/${pageName}.jsx`)
  return readFileSync(p, 'utf-8')
}

export function savePage(moduleName: string, pageName: string, content: string): void {
  assertModuleName(moduleName); assertPageName(pageName)
  if (!content.trim()) throw new Error('页面内容为空')
  const dir = pagesRoot(moduleName)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${pageName}.jsx`), content, 'utf-8')
}

export function createPage(moduleName: string, pageName: string, starter: keyof typeof STARTERS = 'blank'): void {
  assertModuleName(moduleName); assertPageName(pageName)
  const dir = pagesRoot(moduleName)
  const p = join(dir, `${pageName}.jsx`)
  if (existsSync(p)) throw new Error(`页面已存在：${moduleName}/pages/${pageName}.jsx`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(p, STARTERS[starter] ?? STARTERS.blank, 'utf-8')
}

export function deletePage(moduleName: string, pageName: string): void {
  assertModuleName(moduleName); assertPageName(pageName)
  const dir = pagesRoot(moduleName)
  for (const ext of ['.jsx', '.mjs', '.cpt']) {
    const p = join(dir, `${pageName}${ext}`)
    if (existsSync(p)) unlinkSync(p)
  }
}

// ── 构建 ────────────────────────────────────────────────────────

export async function buildPage(moduleName: string, pageName: string): Promise<BuildResult> {
  assertModuleName(moduleName); assertPageName(pageName)
  const dir = pagesRoot(moduleName)
  const jsxPath = join(dir, `${pageName}.jsx`)
  const mjsPath = join(dir, `${pageName}.mjs`)
  const cptPath = join(dir, `${pageName}.cpt`)
  if (!existsSync(jsxPath)) throw new Error(`页面不存在：${moduleName}/pages/${pageName}.jsx`)

  const log: string[] = []
  const jsx = readFileSync(jsxPath, 'utf-8')
  log.push(`读取 JSX（${jsx.length} 字符）`)

  const { mjs, clean, hooksTransformed } = await compileJsx(jsx)
  log.push(`esbuild 编译完成；Hook 解构转换 ${hooksTransformed} 处`)

  writeFileSync(mjsPath, mjs, 'utf-8')
  log.push(`.mjs 已落盘：${basename(mjsPath)}`)

  const cpt = generatePageCpt(pageTemplateRaw, clean)
  const findings = checkPageCpt(cpt, pageTemplateRaw)
  const errCount = findings.filter((f) => f.severity === 'error').length
  const warnCount = findings.filter((f) => f.severity === 'warning').length
  log.push(`质量门：${errCount} error / ${warnCount} warning`)

  const ok = !hasError(findings)
  if (ok) {
    writeFileSync(cptPath, cpt, 'utf-8')
    log.push(`已部署：${basename(cptPath)}`)
  } else {
    log.push('存在 error，CPT 未落盘（.mjs 保留供排查）')
  }

  getDb().prepare('INSERT INTO builds(kind, target, ok, log) VALUES(?,?,?,?)')
    .run('page', `${moduleName}/pages/${pageName}.cpt`, ok ? 1 : 0, JSON.stringify(log))

  return { ok, kind: 'page', target: `${moduleName}/pages/${pageName}.cpt`, outputPath: ok ? cptPath : undefined, findings, log }
}

export function pagePreviewUrl(moduleName: string, pageName: string): string {
  return previewPageUrl(moduleName, pageName)
}
