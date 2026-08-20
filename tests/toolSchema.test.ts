import { describe, expect, it } from 'vitest'
import { flattenToolSchema } from '../src/renderer/src/views/toolSchema'

/**
 * 规范页「平台工具」参数表拍平逻辑的锚定用例。
 * schema 样例对齐 zod-to-json-schema（$refStrategy:'none'）的真实产物，
 * 构造方式见 tools.ts：.default() 合法时不入 required（zod safeParse(undefined) 判定）。
 */

it('拍平 array<object> 为缩进子行，子行 required 取 items.required', () => {
  const rows = flattenToolSchema({
    type: 'object',
    properties: {
      project: { type: 'string' },
      name: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' },
      kind: { type: 'string', enum: ['list', 'stat', 'other'], default: 'other' },
      params: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: { type: 'string', enum: ['string', 'formula'], default: 'string' },
            default: { type: 'string' },
          },
          required: ['name'],
          additionalProperties: false,
        },
        default: [],
      },
      sql: { type: 'string', minLength: 1 },
    },
    required: ['project', 'name', 'sql'],
    additionalProperties: false,
  })
  expect(rows.map((r) => [r.depth, r.name])).toEqual([
    [0, 'project'], [0, 'name'], [0, 'kind'], [0, 'params'],
    [1, 'name'], [1, 'type'], [1, 'default'],
    [0, 'sql'],
  ])
  expect(rows[3].type).toBe('object[]')
  expect(rows[3].def).toBe('[]')
  expect(rows[3].required).toBe(false)
  expect(rows[4].required).toBe(true)
  expect(rows[5].def).toBe('"string"')
  expect(rows[5].notes).toContain('可选值: string / formula')
  expect(rows[1].notes).toContain('格式 ^[a-z][a-z0-9_]*$')
  expect(rows[7].notes).toContain('≥ 1')
  expect(rows[0].def).toBeNull()
  expect(rows[0].required).toBe(true)
})

it('object 子项、record、字面值与数值范围的类型/说明', () => {
  const rows = flattenToolSchema({
    type: 'object',
    properties: {
      connection: {
        type: 'object',
        properties: { id: { type: 'number' }, name: { type: 'string' } },
        additionalProperties: false,
        description: '连接引用（缺省用项目绑定/注册表第一个连接）',
      },
      overrides: { type: 'object', additionalProperties: {}, description: '参数名 → 测试值' },
      confirm: { type: 'boolean', const: true },
      limit: { type: 'integer', minimum: 1, maximum: 10, default: 3, description: '每个范围返回条数' },
      scopes: { type: 'array', items: { type: 'string', enum: ['product', 'ux'] }, minItems: 1 },
    },
    required: ['confirm'],
    additionalProperties: false,
  })
  const by = (n: string) => rows.find((r) => r.name === n)!
  expect(rows.filter((r) => r.depth === 1).map((r) => r.name)).toEqual(['id', 'name'])
  expect(by('connection').type).toBe('object')
  expect(by('connection').notes[0]).toBe('连接引用（缺省用项目绑定/注册表第一个连接）')
  expect(by('overrides').type).toBe('map<string, any>')
  expect(by('confirm').type).toBe('true')
  expect(by('limit').notes).toEqual(['每个范围返回条数', '1 – 10'])
  expect(by('limit').def).toBe('3')
  expect(by('scopes').type).toBe('string[]')
  expect(by('scopes').notes).toContain('可选值: product / ux')
  expect(by('scopes').notes).toContain('≥ 1')
})

it('无 properties 或非对象输入返回空行', () => {
  expect(flattenToolSchema({ type: 'object', properties: {}, additionalProperties: false })).toEqual([])
  expect(flattenToolSchema(null)).toEqual([])
  expect(flattenToolSchema('x')).toEqual([])
})

describe('约束只有单边时', () => {
  it('只给 min 显示 ≥ n，只给 max 显示 ≤ n', () => {
    const rows = flattenToolSchema({
      type: 'object',
      properties: { a: { type: 'string', minLength: 2 }, b: { type: 'number', maximum: 5 } },
      required: [],
    })
    expect(rows[0].notes).toEqual(['≥ 2'])
    expect(rows[1].notes).toEqual(['≤ 5'])
  })
})
