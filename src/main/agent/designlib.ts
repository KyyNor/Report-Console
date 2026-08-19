/**
 * 应用内置设计库 — 精简自 ui-ux-pro-max-skill（scripts/design-lib/sync.mjs 同步产出）。
 *
 * 数据经 ?raw 随包内联（同 agent/skills 范式），运行时不读磁盘、不解析 CSV；
 * data/ 与 references/ 只能由同步脚本产出，禁止手改，调整内容一律改 scripts/design-lib/config.mjs。
 *
 * 检索为 Okapi BM25（k1=1.5, b=0.75，与上游参数一致）：英文小写分词 + 同义词归一，
 * 中文按二元组入索引并附少量中英查询扩展；每个检索范围独立打分后合并分组返回，
 * 各范围分数不可横向比较，因此不做全局排序。
 */

import productData from './designlib/data/product.jsonl?raw'
import styleData from './designlib/data/style.jsonl?raw'
import colorData from './designlib/data/color.jsonl?raw'
import reasoningData from './designlib/data/reasoning.jsonl?raw'
import uxData from './designlib/data/ux.jsonl?raw'
import chartData from './designlib/data/chart.jsonl?raw'
import webData from './designlib/data/web.jsonl?raw'
import reactData from './designlib/data/react.jsonl?raw'

export type DesignScope = 'product' | 'style' | 'color' | 'reasoning' | 'ux' | 'chart' | 'web' | 'react'

export const DESIGN_SCOPES: DesignScope[] = ['product', 'style', 'color', 'reasoning', 'ux', 'chart', 'web', 'react']

const SCOPE_META: Record<DesignScope, { label: string; data: string; nameFields: string[]; boostFields: string[] }> = {
  product: { label: '产品类型', data: productData, nameFields: ['Product Type'], boostFields: ['Product Type', 'Keywords'] },
  style: { label: '视觉风格', data: styleData, nameFields: ['Style Category'], boostFields: ['Style Category', 'Keywords', 'Aliases', 'Style ID'] },
  color: { label: '配色', data: colorData, nameFields: ['Product Type'], boostFields: ['Product Type'] },
  reasoning: { label: 'UI 推理规则', data: reasoningData, nameFields: ['UI_Category'], boostFields: ['UI_Category', 'Recommended_Pattern', 'Style_Priority'] },
  ux: { label: 'UX 准则', data: uxData, nameFields: ['Category', 'Issue'], boostFields: ['Category', 'Issue'] },
  chart: { label: '图表选型', data: chartData, nameFields: ['Data Type'], boostFields: ['Data Type', 'Keywords', 'Best Chart Type'] },
  web: { label: 'Web 界面规则', data: webData, nameFields: ['Category', 'Issue'], boostFields: ['Category', 'Issue', 'Keywords'] },
  react: { label: 'React 性能规则', data: reactData, nameFields: ['Category', 'Issue'], boostFields: ['Category', 'Issue', 'Keywords'] }
}

/** 常用设计词汇的中文→英文扩展：条目正文是英文，中文查询借此获得召回。 */
const ZH_QUERY_TERMS: Record<string, string> = {
  '数据': 'data', '看板': 'dashboard', '仪表盘': 'dashboard', '报表': 'report reporting',
  '图表': 'chart', '金融': 'financial finance', '财务': 'financial finance', '销售': 'sales',
  '库存': 'inventory', '教育': 'education', '医疗': 'healthcare', '政府': 'government',
  '物流': 'logistics', '电商': 'commerce', '企业': 'enterprise', '后台': 'admin',
  '表格': 'table', '表单': 'form', '颜色': 'color', '配色': 'color palette', '布局': 'layout',
  '导航': 'navigation', '移动端': 'mobile', '手机': 'mobile', '深色': 'dark', '浅色': 'light',
  '无障碍': 'accessibility', '性能': 'performance', '加载': 'loading', '搜索': 'search',
  '分析': 'analytics', '趋势': 'trend', '对比': 'compare', '占比': 'proportion part whole',
  '地图': 'geographic map', '层级': 'hierarchical nested', '实时': 'real time', '监控': 'monitoring',
  '简约': 'minimal', '现代': 'modern', '密集': 'dense', '空状态': 'empty states',
  '分页': 'pagination', '筛选': 'filter', '错误': 'error', '反馈': 'feedback',
  '动画': 'animation', '动效': 'motion animation', '交互': 'interaction', '响应式': 'responsive',
  '字体': 'typography font', '间距': 'spacing', '圆角': 'radius', '阴影': 'shadow'
}

const SYNONYMS: Record<string, string> = {
  a11y: 'accessibility',
  colour: 'color',
  colours: 'color',
  optimise: 'optimize',
  organisation: 'organization'
}

const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'with', 'is', 'are', 'be', 'as', 'at', 'by', 'if', 'it', 'this', 'that', 'from'])

function tokenizeEnglish(text: string): string[] {
  const tokens: string[] = []
  for (const w of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    const norm = SYNONYMS[w] ?? w
    if (norm.length < 2 || STOPWORDS.has(norm)) continue
    tokens.push(norm)
  }
  return tokens
}

export function tokenize(text: string): string[] {
  const tokens: string[] = []
  // 中文按二元组（单字整段保留），保留原词以命中含中文的条目（如 “Bauhaus (包豪斯)”）
  for (const seg of text.match(/[\u4e00-\u9fff]+/g) ?? []) {
    if (seg.length === 1) tokens.push(seg)
    for (let i = 0; i + 1 < seg.length; i++) tokens.push(seg.slice(i, i + 2))
  }
  // 中文→英文扩展，让中文查询能召回英文条目；扩展值复用英文分词，保证与索引 token 一致
  for (const [zh, en] of Object.entries(ZH_QUERY_TERMS)) {
    if (text.includes(zh)) tokens.push(...tokenizeEnglish(en))
  }
  tokens.push(...tokenizeEnglish(text))
  return tokens
}

// ── BM25 索引（模块级缓存，首次检索时惰性构建）──────────────

const K1 = 1.5
const B = 0.75
const FIELD_BOOST = 3

interface DocIndex { tf: Map<string, number>; len: number }
interface ScopeIndex { rows: Record<string, string>[]; docs: DocIndex[]; avgdl: number; df: Map<string, number> }

const indexes = new Map<DesignScope, ScopeIndex>()

function index(scope: DesignScope): ScopeIndex {
  const cached = indexes.get(scope)
  if (cached) return cached
  const meta = SCOPE_META[scope]
  const rows = meta.data.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, string>)
  const docs = rows.map((row) => {
    const tf = new Map<string, number>()
    let len = 0
    for (const [field, value] of Object.entries(row)) {
      if (typeof value !== 'string' || !value) continue
      const weight = meta.boostFields.includes(field) ? FIELD_BOOST : 1
      for (const t of tokenize(value)) {
        tf.set(t, (tf.get(t) ?? 0) + weight)
        len += weight
      }
    }
    return { tf, len }
  })
  const df = new Map<string, number>()
  for (const doc of docs) for (const t of doc.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1)
  const built: ScopeIndex = { rows, docs, avgdl: docs.reduce((n, d) => n + d.len, 0) / (docs.length || 1), df }
  indexes.set(scope, built)
  return built
}

// ── 检索 ─────────────────────────────────────────────────

export interface DesignLibItem {
  score: number
  name: string
  fields: Record<string, string>
}

export interface DesignLibScopeResult {
  scope: DesignScope
  label: string
  count: number
  items: DesignLibItem[]
}

export interface DesignLibSearchResult {
  query: string
  scopes: DesignScope[]
  total: number
  results: DesignLibScopeResult[]
  hint?: string
}

const TRUNCATE_AT = 300

function truncateField(v: string, full: boolean): string {
  if (full || v.length <= TRUNCATE_AT) return v
  return v.slice(0, TRUNCATE_AT) + `…（截断，共 ${v.length} 字符，可传 full=true 查看）`
}

export function searchScope(scope: DesignScope, query: string, limit: number, full = false): DesignLibItem[] {
  const idx = index(scope)
  const terms = [...new Set(tokenize(query))]
  if (!terms.length || !idx.rows.length) return []
  return idx.docs
    .map((doc, i) => {
      let score = 0
      for (const t of terms) {
        const f = doc.tf.get(t)
        if (!f) continue
        const n = idx.df.get(t) ?? 0
        const idf = Math.log((idx.rows.length - n + 0.5) / (n + 0.5) + 1)
        score += (idf * (f * (K1 + 1))) / (f + K1 * (1 - B + (B * doc.len) / idx.avgdl))
      }
      return { i, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ i, score }) => {
      const row = idx.rows[i]
      const meta = SCOPE_META[scope]
      const fields: Record<string, string> = {}
      for (const [k, v] of Object.entries(row)) {
        if (typeof v === 'string' && v) fields[k] = truncateField(v, full)
      }
      return { score: Math.round(score * 100) / 100, name: meta.nameFields.map((f) => row[f] ?? '').join(' / '), fields }
    })
}

/** 各范围入库条目数（诊断/测试用，确认同步产物非空）。 */
export function designLibStats(): Record<DesignScope, number> {
  return Object.fromEntries(DESIGN_SCOPES.map((s) => [s, index(s).rows.length])) as Record<DesignScope, number>
}

/** 合并检索：对每个范围独立检索各取前 limit 条，按请求顺序分组返回；0 结果时附提示。 */
export function searchDesignLib(opts: { query: string; scopes: DesignScope[]; limit?: number; full?: boolean }): DesignLibSearchResult {
  const limit = Math.min(Math.max(Math.floor(opts.limit ?? 3), 1), 10)
  const results = opts.scopes.map((scope) => {
    const items = searchScope(scope, opts.query, limit, opts.full ?? false)
    return { scope, label: SCOPE_META[scope].label, count: items.length, items }
  })
  const total = results.reduce((n, r) => n + r.count, 0)
  return {
    query: opts.query,
    scopes: [...opts.scopes],
    total,
    results,
    ...(total === 0 ? { hint: `设计库中没有匹配条目；可调整关键词（条目正文为英文，建议用英文关键词如 dashboard / table / empty states），或换用范围：${DESIGN_SCOPES.join(' / ')}` } : {})
  }
}
