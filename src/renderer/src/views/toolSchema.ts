/**
 * 工具参数 JSON Schema → 参数表行（规范页「平台工具」用）。
 *
 * 输入是 piBridge 经 zod-to-json-schema（$refStrategy:'none'）产出的全内联
 * draft-07 schema（IPC catalog 的 tool.parameters）。纯函数、无 React/IPC 依赖，
 * tests/toolSchema.test.ts 做行为锚定。现状工具嵌套最深 2 层
 * （array<object> 的元素属性 / object 子项），仍按通用递归展开。
 */

export interface SchemaRow {
  /** 参数名；子行为其所在嵌套结构内的字段名，展示时按 depth 缩进 */
  name: string
  depth: number
  type: string
  required: boolean
  /** default 的 JSON 字面量表示（"other" / 3 / false / []）；无则 null */
  def: string | null
  /** 说明列：首项为 description（如有），其余为约束（格式 / 范围 / 可选值） */
  notes: string[]
}

type Node = Record<string, unknown>

const isObj = (v: unknown): v is Node => typeof v === 'object' && v !== null

const shown = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v))

const firstNum = (...vals: unknown[]): number | undefined => {
  for (const v of vals) if (typeof v === 'number') return v
  return undefined
}

function baseType(node: Node): string {
  if (node.const !== undefined) return JSON.stringify(node.const)
  if (typeof node.type === 'string') return node.type
  if (Array.isArray(node.type)) return node.type.map(String).join(' | ')
  if (Array.isArray(node.enum)) return node.enum.length === 1 ? shown(node.enum[0]) : 'enum'
  return 'any'
}

function rowType(node: Node): string {
  if (node.type === 'object' || isObj(node.properties)) {
    if (isObj(node.properties) && Object.keys(node.properties).length > 0) return 'object'
    if ('additionalProperties' in node) {
      // z.record：值 schema 挂在 additionalProperties（z.unknown() 产出 {}）
      const value = isObj(node.additionalProperties) ? baseType(node.additionalProperties) : 'any'
      return `map<string, ${value}>`
    }
    return 'object'
  }
  if (node.type === 'array' || isObj(node.items)) {
    const items = isObj(node.items) ? node.items : {}
    const inner = isObj(items.properties) ? 'object' : baseType(items)
    return `${inner}[]`
  }
  return baseType(node)
}

/** enum / pattern / 数值与长度范围 → 说明列的约束小字。 */
function constraintNotes(node: Node): string[] {
  const notes: string[] = []
  if (Array.isArray(node.enum) && node.enum.length > 0) notes.push(`可选值: ${node.enum.map(shown).join(' / ')}`)
  if (typeof node.pattern === 'string') notes.push(`格式 ${node.pattern}`)
  const min = firstNum(node.minimum, node.minLength, node.minItems)
  const max = firstNum(node.maximum, node.maxLength, node.maxItems)
  if (min !== undefined && max !== undefined) notes.push(`${min} – ${max}`)
  else if (min !== undefined) notes.push(`≥ ${min}`)
  else if (max !== undefined) notes.push(`≤ ${max}`)
  return notes
}

function rowOf(name: string, node: Node, required: boolean, depth: number): SchemaRow {
  const notes: string[] = []
  if (typeof node.description === 'string' && node.description) notes.push(node.description)
  notes.push(...constraintNotes(node))
  // array 的 enum/min-max 挂在 items 上（如 scopes: string[] 的值域），并入父行说明
  if (isObj(node.items)) notes.push(...constraintNotes(node.items))
  return {
    name,
    depth,
    type: rowType(node),
    required,
    def: node.default === undefined ? null : JSON.stringify(node.default),
    notes,
  }
}

/** 展开一层 object 的 properties；object / array<object> 的子属性递归为 depth+1 子行。 */
function pushRows(node: Node, required: string[], depth: number, out: SchemaRow[]): void {
  const props = isObj(node.properties) ? node.properties : {}
  for (const [name, raw] of Object.entries(props)) {
    if (!isObj(raw)) continue
    out.push(rowOf(name, raw, required.includes(name), depth))
    const child = isObj(raw.properties) ? raw : isObj(raw.items) && isObj(raw.items.properties) ? raw.items : null
    if (child) {
      const childRequired = Array.isArray(child.required) ? child.required.map(String) : []
      pushRows(child, childRequired, depth + 1, out)
    }
  }
}

export function flattenToolSchema(schema: unknown): SchemaRow[] {
  if (!isObj(schema)) return []
  const required = Array.isArray(schema.required) ? schema.required.map(String) : []
  const out: SchemaRow[] = []
  pushRows(schema, required, 0, out)
  return out
}
