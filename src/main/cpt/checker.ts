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

/** 返回索引所在的 1-based 行号。 */
function lineAt(source: string, index: number): number {
  return source.slice(0, index).split('\n').length
}

/**
 * 找到配对括号/花括号。这里只用于已定位到的普通函数调用，遇到字符串时跳过，
 * 以免 JSON、选择器或正则里的括号影响范围判断。
 */
function matchingIndex(source: string, open: number, left: string, right: string): number {
  let depth = 0
  let quote = ''
  let escaped = false
  for (let i = open; i < source.length; i++) {
    const ch = source[i]
    if (quote) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === quote) quote = ''
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue }
    if (ch === left) depth++
    else if (ch === right && --depth === 0) return i
  }
  return -1
}

/** 在函数调用参数层级按逗号切分，不误切函数调用或对象字面量。 */
function splitTopLevelArgs(source: string): string[] {
  const out: string[] = []
  let start = 0
  let quote = ''
  let escaped = false
  let parens = 0
  let braces = 0
  let brackets = 0
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (quote) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === quote) quote = ''
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue }
    if (ch === '(') parens++
    else if (ch === ')') parens--
    else if (ch === '{') braces++
    else if (ch === '}') braces--
    else if (ch === '[') brackets++
    else if (ch === ']') brackets--
    else if (ch === ',' && parens === 0 && braces === 0 && brackets === 0) {
      out.push(source.slice(start, i).trim())
      start = i + 1
    }
  }
  out.push(source.slice(start).trim())
  return out
}

/**
 * 找出明确返回对象的参数工厂；保守识别，不尝试猜测复杂动态表达式。
 * 例如：const makeParams = useCallback(() => ({ p_page: '1' }), [])。
 */
function objectParameterFactories(source: string): Set<string> {
  const names = new Set<string>()
  const arrow = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:(?:React\.)?useCallback\s*\(\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\(\s*\{/g
  let match: RegExpExecArray | null
  while ((match = arrow.exec(source)) !== null) names.add(match[1])

  const fn = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g
  while ((match = fn.exec(source)) !== null) {
    const close = matchingIndex(source, fn.lastIndex - 1, '{', '}')
    if (close < 0) continue
    if (/\breturn\s*\{/.test(source.slice(fn.lastIndex, close))) names.add(match[1])
  }
  return names
}

/**
 * 检查确定无疑的 /api/data parameters 对象用法。
 * 动态构造无法可靠静态归因时不报错，交由真实页面网络验收；但对象字面量和
 * 对象工厂透传会在构建阶段直接阻断，避免把已知错误部署进 CPT。
 */
export function checkApiDataParameters(js: string): CheckerFinding[] {
  const findings: CheckerFinding[] = []
  const reported = new Set<number>()
  const report = (index: number, detail: string) => {
    if (reported.has(index)) return
    reported.add(index)
    findings.push({
      rule: 'api_data_parameters_shape',
      severity: 'error',
      line: lineAt(js, index),
      message: `/api/data 的 parameters 必须是 [{ name, type, value }] 数组；${detail}`
    })
  }
  const factories = objectParameterFactories(js)

  // 直接在请求体里传对象，最常见也最确定。
  const directObject = /\bparameters\s*:\s*\{/g
  let match: RegExpExecArray | null
  while ((match = directObject.exec(js)) !== null) {
    const near = js.slice(Math.max(0, match.index - 800), match.index + 80)
    if (near.includes('/api/data')) report(match.index, '检测到对象字面量。')
  }

  // API 包装函数（function callApi(name, parameters) {... /api/data ... parameters: parameters }）
  // 被对象工厂或对象字面量调用时同样可以确定为错误。
  const fn = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g
  while ((match = fn.exec(js)) !== null) {
    const bodyOpen = fn.lastIndex - 1
    const bodyClose = matchingIndex(js, bodyOpen, '{', '}')
    if (bodyClose < 0) continue
    const body = js.slice(bodyOpen + 1, bodyClose)
    if (!body.includes('/api/data')) continue
    const parameterMatch = /\bparameters\s*:\s*([A-Za-z_$][\w$]*)\b/.exec(body)
    if (!parameterMatch) continue
    const parameterIndex = match[2].split(',').map((item) => item.trim()).indexOf(parameterMatch[1])
    if (parameterIndex < 0) continue

    const call = new RegExp(`\\b${match[1]}\\s*\\(`, 'g')
    let called: RegExpExecArray | null
    while ((called = call.exec(js)) !== null) {
      // 跳过函数声明自身。
      if (/\bfunction\s+$/.test(js.slice(Math.max(0, called.index - 16), called.index))) continue
      const open = call.lastIndex - 1
      const close = matchingIndex(js, open, '(', ')')
      if (close < 0) continue
      const arg = splitTopLevelArgs(js.slice(open + 1, close))[parameterIndex] ?? ''
      const objectCall = /^([A-Za-z_$][\w$]*)\s*\(/.exec(arg)?.[1]
      if (arg.startsWith('{')) report(called.index, `调用 ${match[1]} 时传入了对象字面量。`)
      else if (objectCall && factories.has(objectCall)) report(called.index, `参数工厂 ${objectCall}() 明确返回对象。`)
    }
  }
  return findings
}

/** 帆软内置 jQuery 的 Deferred 与原生 Promise 不完全兼容，页面调用 /api/data 时必须显式规避。 */
export function checkFineReportAjaxCompatibility(js: string): CheckerFinding[] {
  const findings: CheckerFinding[] = []
  const ajax = /\$\.ajax\s*\(/g
  let match: RegExpExecArray | null
  while ((match = ajax.exec(js)) !== null) {
    const open = ajax.lastIndex - 1
    const close = matchingIndex(js, open, '(', ')')
    if (close < 0) continue
    const request = js.slice(open + 1, close)
    if (!request.includes('/api/data')) continue
    const after = js.slice(close + 1, close + 80)
    if (/^\s*\.then\s*\(/.test(after)) {
      findings.push({
        rule: 'finereport_ajax_deferred',
        severity: 'error',
        line: lineAt(js, match.index),
        message: '帆软内置 jQuery Deferred 不兼容 $.ajax(...).then(...).catch(...)；请用 .done/.fail 封装为原生 Promise。'
      })
    }
    if (/contentType\s*:\s*['"]application\/json['"]/.test(request) && !/dataType\s*:\s*['"]json['"]/.test(request)) {
      findings.push({
        rule: 'finereport_ajax_json_type',
        severity: 'error',
        line: lineAt(js, match.index),
        message: '帆软 /api/data 虽返回 JSON 正文但可能声明 text/html；$.ajax 请求必须设置 dataType: \'json\'。'
      })
    }
  }
  return findings
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
