/**
 * 质量门 — data_checker.py + display rules（js_path_resolution /
 * js_no_unicode_escape / cpt_xml_wellformed / _MJS_ 残留）的 TypeScript 移植
 */

import { XMLParser } from 'fast-xml-parser'
import type { CheckerFinding } from '@shared/types'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  processEntities: false,
  allowBooleanAttributes: true
})

function parseXml(xml: string): Record<string, unknown> | null {
  try {
    return parser.parse(xml) as Record<string, unknown>
  } catch {
    return null
  }
}

/** fast-xml-parser 单子节点返回对象而非数组 —— 统一归一化 */
function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return []
  return Array.isArray(v) ? v : [v]
}

/** 标签名集合（去命名空间） */
function collectTags(node: unknown, acc = new Set<string>()): Set<string> {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    for (const key of Object.keys(node as Record<string, unknown>)) {
      if (key.startsWith('#text') || key.startsWith('@_')) continue
      const tag = key.includes('}') ? key.split('}')[1] : key
      acc.add(tag)
      collectTags((node as Record<string, unknown>)[key], acc)
    }
  } else if (Array.isArray(node)) {
    for (const item of node) collectTags(item, acc)
  }
  return acc
}

// ══════════════════════════════════════════════════════════════
// 数据层 CPT 检查（port of data_checker.py）
// ══════════════════════════════════════════════════════════════

const DANGEROUS_SQL = [
  /\bDROP\b/i,
  /\bDELETE\b/i,
  /\bTRUNCATE\b/i,
  /\bALTER\b/i,
  /\bCREATE\b/i
]

export function checkDataCpt(cptXml: string): CheckerFinding[] {
  const errors: CheckerFinding[] = []
  const warnings: CheckerFinding[] = []

  const root = parseXml(cptXml)
  if (!root) {
    return [{ rule: 'xml_wellformed', severity: 'error', message: 'XML 格式错误：无法解析' }]
  }
  const workbook = root.WorkBook as Record<string, unknown> | undefined
  const tdm = workbook?.TableDataMap as Record<string, unknown> | undefined
  if (!tdm) {
    errors.push({ rule: 'table_data_map', severity: 'error', message: '缺少 TableDataMap 节点' })
    return errors
  }

  const tables = asArray<Record<string, unknown>>(tdm.TableData as Record<string, unknown>)
  for (const t of tables) {
    const name = (t?.['@_name'] as string) || '(无名称)'
    for (const child of ['Parameters', 'Connection', 'Query']) {
      if (!t || t[child] === undefined) {
        errors.push({ rule: 'table_data_structure', severity: 'error', message: `数据集 '${name}' 缺少 ${child} 节点` })
      }
    }
    const params = asArray<Record<string, unknown>>(
      (t?.Parameters as Record<string, unknown> | undefined)?.Parameter as Record<string, unknown>
    )
    for (const p of params) {
      const attr = p?.Attributes as Record<string, unknown> | undefined
      if (!attr || !attr['@_name']) {
        errors.push({ rule: 'parameter_naming', severity: 'error', message: `数据集 '${name}' 存在无名称参数` })
      }
    }
    const query = t?.Query
    if (typeof query === 'string' && query.trim()) {
      for (const re of DANGEROUS_SQL) {
        if (re.test(query)) {
          warnings.push({
            rule: 'sql_safety',
            severity: 'warning',
            message: `数据集 '${name}' SQL 包含潜在危险关键词：${re.source}`
          })
          break
        }
      }
    }
  }

  return [...errors, ...warnings]
}

// ══════════════════════════════════════════════════════════════
// 展示层检查（port of display rules）
// ══════════════════════════════════════════════════════════════

/** 从 CPT 提取 afterload JS（解析 CDATA 文本） */
export function extractJsFromCpt(cptXml: string): string {
  const m = cptXml.match(/<Listener event="afterload">[\s\S]*?<Content><!\[CDATA\[([\s\S]*?)\]\]><\/Content>/)
  return m ? m[1] : ''
}

/** js_no_unicode_escape：代码区（非字符串）残留 \uXXXX → ERROR */
export function checkNoUnicodeEscape(js: string): CheckerFinding[] {
  const findings: CheckerFinding[] = []
  // 去掉全部字符串字面量后扫描
  const codeOnly = js
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
  const re = /\\u[0-9a-fA-F]{4}/g
  let m: RegExpExecArray | null
  const seen = new Set<string>()
  while ((m = re.exec(codeOnly)) !== null) {
    const key = m[0]
    if (!seen.has(key)) {
      seen.add(key)
      findings.push({
        rule: 'js_no_unicode_escape',
        severity: 'error',
        line: codeOnly.slice(0, m.index).split('\n').length,
        message: `代码区发现未解码的 Unicode Escape '${key}'，可能导致帆软页面乱码`
      })
    }
  }
  return findings
}

/** _MJS_ 占位符残留（字符串还原失败的漏网之鱼）→ ERROR */
export function checkNoMjsPlaceholder(js: string): CheckerFinding[] {
  if (js.includes('_MJS_S')) {
    return [{
      rule: 'mjs_placeholder_remnant',
      severity: 'error',
      message: '代码中残留 _MJS_S 占位符（字符串还原失败），页面将无法运行'
    }]
  }
  return []
}

/** js_path_resolution：PATH 基础设施完整 + 未被业务区遮盖 */
export function checkPathResolution(cptXml: string, baseTemplateXml: string): CheckerFinding[] {
  const findings: CheckerFinding[] = []
  const js = extractJsFromCpt(cptXml)
  if (!js) {
    findings.push({ rule: 'js_path_resolution', severity: 'warning', message: '未找到 afterload JS 内容' })
    return findings
  }

  const hasPathDef = /var\s+PATH\s*=\s*\{/.test(js)
  if (!hasPathDef) {
    findings.push({
      rule: 'js_path_resolution',
      severity: 'warning',
      message: 'PATH 基础设施缺失：外层框架区未找到 var PATH = {...}，getDataTemplate 等路径工具不可用'
    })
    return findings
  }
  for (const member of ['currentDir', 'apiBase', 'getDataTemplate', 'getTemplatePath']) {
    if (!js.includes(member)) {
      findings.push({
        rule: 'js_path_resolution',
        severity: 'warning',
        message: `PATH 定义不完整，缺少成员：${member}`
      })
    }
  }

  // 业务区遮盖检测：骨架注入标记之后不得重新声明 PATH
  const devIdx = js.indexOf('开发者代码区 START')
  if (devIdx !== -1) {
    const devZone = js.slice(devIdx)
    if (/\b(var|let|const)\s+PATH\s*=/.test(devZone) || /\bPATH\s*=\s*\{/.test(devZone)) {
      findings.push({
        rule: 'js_path_resolution',
        severity: 'warning',
        message: 'PATH 被业务代码遮盖（重新声明/赋值），getDataTemplate 等将静默失效，请删除业务区的 PATH 声明'
      })
    }
  }
  return findings
}

/** cpt_xml_wellformed：输出标签 ⊆ 骨架标签白名单 */
export function checkTagsWhitelist(cptXml: string, baseTemplateXml: string): CheckerFinding[] {
  const out = parseXml(cptXml)
  const base = parseXml(baseTemplateXml)
  if (!out) return [{ rule: 'cpt_xml_wellformed', severity: 'error', message: '输出 CPT 无法解析为 XML' }]
  if (!base) return []
  const baseTags = collectTags(base)
  const outTags = collectTags(out)
  const strange = [...outTags].filter((t) => !baseTags.has(t))
  if (strange.length > 0) {
    return [{
      rule: 'cpt_xml_wellformed',
      severity: 'error',
      message: `CPT 含骨架中不存在的标签 [${strange.join(', ')}]，疑似自创标签，帆软无法加载`
    }]
  }
  return []
}

/** 展示层 CPT 全套质量门 */
export function checkPageCpt(cptXml: string, baseTemplateXml: string): CheckerFinding[] {
  const js = extractJsFromCpt(cptXml)
  return [
    ...checkNoUnicodeEscape(js),
    ...checkNoMjsPlaceholder(js),
    ...checkPathResolution(cptXml, baseTemplateXml),
    ...checkTagsWhitelist(cptXml, baseTemplateXml)
  ]
}

/** 判定构建是否通过（存在 error 即失败） */
export function hasError(findings: CheckerFinding[]): boolean {
  return findings.some((f) => f.severity === 'error')
}
