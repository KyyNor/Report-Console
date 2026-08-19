import { describe, expect, it } from 'vitest'
import { DESIGN_SCOPES, designLibStats, searchDesignLib, searchScope, tokenize } from '@main/agent/designlib'
import { applyDomain, diffByKeys } from '../scripts/design-lib/lib/transform.mjs'
import { parseCsv } from '../scripts/design-lib/lib/csv.mjs'

describe('设计库分词', () => {
  it('英文小写化、同义词归一、去停用词', () => {
    expect(tokenize('A11y Colour Schemes')).toEqual(['accessibility', 'color', 'schemes'])
  })

  it('连字符词汇拆分为独立 token', () => {
    expect(tokenize('data-dense-dashboard')).toEqual(['data', 'dense', 'dashboard'])
  })

  it('中文按二元组入索引并扩展英文召回', () => {
    const tokens = tokenize('金融看板')
    expect(tokens).toContain('金融')
    expect(tokens).toContain('看板')
    expect(tokens).toContain('financial')
    expect(tokens).toContain('dashboard')
  })

  it('单字中文查询不误扩展（密码 ≠ dense）', () => {
    expect(tokenize('密码输入')).not.toContain('dense')
  })
})

describe('设计库检索（真实同步产物）', () => {
  it('八个范围产物均非空', () => {
    const stats = designLibStats()
    for (const scope of DESIGN_SCOPES) {
      expect(stats[scope], `scope=${scope}`).toBeGreaterThan(0)
    }
  })

  it('BM25 将强匹配条目排在首位', () => {
    expect(searchScope('style', 'data dense dashboard', 1)[0]?.name).toBe('Data-Dense Dashboard')
    expect(searchScope('chart', 'trend over time', 1)[0]?.name).toBe('Trend Over Time')
  })

  it('中文关键词经扩展命中英文条目', () => {
    const names = searchScope('product', '金融 看板', 5).map((i) => i.name)
    expect(names).toContain('Financial Dashboard')
  })

  it('limit 限制单范围返回条数', () => {
    expect(searchScope('ux', 'loading', 2)).toHaveLength(2)
    expect(searchScope('ux', 'loading', 1)).toHaveLength(1)
  })

  it('合并检索按请求顺序分组返回', () => {
    const r = searchDesignLib({ query: 'table', scopes: ['ux', 'chart'], limit: 2 })
    expect(r.results.map((x) => x.scope)).toEqual(['ux', 'chart'])
    expect(r.results[0].label).toBe('UX 准则')
    expect(r.total).toBe(r.results.reduce((n, x) => n + x.count, 0))
    expect(r.hint).toBeUndefined()
  })

  it('零结果返回提示而非报错', () => {
    const r = searchDesignLib({ query: 'zzqqxyw', scopes: ['ux'] })
    expect(r.total).toBe(0)
    expect(r.hint).toContain('英文')
  })
})

describe('同步脚本纯函数', () => {
  it('parseCsv 支持引号内逗号/换行/转义引号、CRLF 与 BOM', () => {
    const csv = '\uFEFFName,Keywords\r\n"Swiss, Minimal","clean ""functional"""\r\nBento,"grid\r\nlayout"\r\n'
    const { columns, rows } = parseCsv(csv)
    expect(columns).toEqual(['Name', 'Keywords'])
    expect(rows[0]).toEqual({ Name: 'Swiss, Minimal', Keywords: 'clean "functional"' })
    // 引号内的换行按原样保留（RFC 4180）
    expect(rows[1]).toEqual({ Name: 'Bento', Keywords: 'grid\r\nlayout' })
  })

  it('applyDomain 按配置顺序挑选条目并报告缺失', () => {
    const rows = [
      { Name: 'A', Keywords: 'alpha' },
      { Name: 'B', Keywords: 'beta' },
      { Name: 'C', Keywords: 'gamma' }
    ]
    const { rows: picked, missing } = applyDomain(rows, { file: 'x.csv', key: 'Name', entries: ['C', 'A', 'Ghost'] })
    expect(picked.map((r) => r.Name)).toEqual(['C', 'A'])
    expect(missing).toEqual(['Ghost'])
  })

  it('applyDomain 通配全收、列白名单裁剪且复合 key 强制保留', () => {
    const rows = [
      { Category: 'Nav', Issue: 'Breadcrumbs', Platform: 'Web', Severity: 'Low' },
      { Category: 'Nav', Issue: 'Active State', Platform: 'All', Severity: 'High' }
    ]
    const { rows: picked, missing } = applyDomain(rows, {
      file: 'x.csv', key: ['Category', 'Issue'], entries: '*', columns: ['Severity']
    })
    expect(missing).toEqual([])
    expect(picked[0]).toEqual({ Category: 'Nav', Issue: 'Breadcrumbs', Severity: 'Low' })
  })

  it('diffByKeys 区分新增/修改/移除，键序不同不算修改', () => {
    const oldRows: Record<string, string>[] = [
      { Name: 'A', Keywords: 'alpha', Extra: 'x' },
      { Name: 'B', Keywords: 'beta' },
      { Name: 'D', Keywords: 'delta' }
    ]
    const newRows: Record<string, string>[] = [
      { Extra: 'x', Keywords: 'alpha', Name: 'A' },
      { Name: 'B', Keywords: 'beta2' },
      { Name: 'C', Keywords: 'gamma' }
    ]
    expect(diffByKeys(oldRows, newRows, 'Name')).toEqual({
      added: ['C'],
      modified: ['B'],
      removed: ['D']
    })
  })
})
