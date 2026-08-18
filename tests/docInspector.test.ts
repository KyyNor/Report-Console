import { describe, expect, it } from 'vitest'
import { inspectDocumentContent } from '@main/docInspector'

const source = `# 订单管理\n\n简介内容。\n\n## 创建订单\n\n这里是创建流程。\n\n## 查询订单\n\n这里是查询流程。`
const meta = { name: '01-订单需求.md', type: 'markdown' as const, size: source.length, mtime: 1 }

describe('项目文档按需读取器', () => {
  it('概览只返回标题结构与短预览', () => {
    const result = inspectDocumentContent(source, meta)
    expect(result).toMatchObject({ view: 'overview', characters: source.length })
    expect(result.headings).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: 1, text: '订单管理', line: 1 }),
      expect.objectContaining({ level: 2, text: '创建订单', line: 5 })
    ]))
    expect(String(result.hint)).toContain('nextCursor')
    expect(result).not.toHaveProperty('content')
  })

  it('正文支持 cursor 分页和 query 定位', () => {
    const first = inspectDocumentContent(source, meta, { view: 'content', cursor: 0, limit: 12 })
    expect(first).toMatchObject({ view: 'content', cursor: 0, content: '# 订单管理\n\n简介内容', nextCursor: 12 })

    const found = inspectDocumentContent(source, meta, { view: 'content', query: '查询订单', limit: 20 })
    expect(found).toMatchObject({ matchFound: true, query: '查询订单', content: '查询订单\n\n这里是查询流程。' })
  })

  it('前端参考源码也按文本安全地分页读取', () => {
    const css = '.ledger { color: #123456; }\n.toolbar { display: flex; }'
    const result = inspectDocumentContent(css, { name: 'lineage.css', type: 'other', size: css.length, mtime: 1 }, { view: 'content', limit: 30 })
    expect(result).toMatchObject({ name: 'lineage.css', type: 'other', view: 'content', content: css.slice(0, 30) })
    expect(result).toHaveProperty('nextCursor', 30)
  })
})
