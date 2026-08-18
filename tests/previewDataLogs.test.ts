import { describe, expect, it } from 'vitest'
import { applyFormulaResults, fineReportFormulaExpressions, prepareFineReportSql, PreviewDataLogStore } from '@main/previewDataLogs'

describe('预览 Data API SQL 诊断', () => {
  it('只在帆软公式内代入当前请求参数，并保留公式供显式求值', () => {
    const sql = `SELECT * FROM books WHERE 1=1 \${if(len(p_keyword)==0,""," AND title LIKE '%"+p_keyword+"%'")} LIMIT \${(p_page-1)*p_pagesize}, \${p_pagesize}`
    const prepared = prepareFineReportSql(sql, [
      { name: 'p_keyword', type: 'string', default: '' },
      { name: 'p_page', type: 'integer', default: '1' },
      { name: 'p_pagesize', type: 'integer', default: '20' }
    ], [
      { name: 'p_keyword', type: 'String', value: 'Agent' },
      { name: 'p_page', type: 'Integer', value: 2 },
      { name: 'p_pagesize', type: 'Integer', value: 50 }
    ])

    expect(prepared).toContain('len("Agent")')
    expect(prepared).toContain('${(2-1)*50}')
    expect(prepared).toContain('${50}')
    expect(fineReportFormulaExpressions(prepared)).toEqual([
      'if(len("Agent")==0,""," AND title LIKE \'%"+"Agent"+"%\'")',
      '(2-1)*50',
      '50'
    ])
  })

  it('按公式出现顺序拼回求值结果', () => {
    const prepared = 'SELECT * FROM books ${if(true,"WHERE enabled=1","")} LIMIT ${(2-1)*20}, ${20}'
    expect(applyFormulaResults(prepared, ['WHERE enabled=1', 20, 20]))
      .toBe('SELECT * FROM books WHERE enabled=1 LIMIT 20, 20')
  })

  it('按项目和页面隔离并保留已关闭预览会话', () => {
    const store = new PreviewDataLogStore()
    store.begin({ project: 'project_a', page: 'orders' }, 'http://localhost/a', 11)
    store.begin({ project: 'project_b', page: 'orders' }, 'http://localhost/b', 22)
    const a = store.startOrReuse({ project: 'project_a', page: 'orders' }, 11, { method: 'POST', url: 'http://localhost/api/data', requestBody: '{}' })
    const b = store.startOrReuse({ project: 'project_b', page: 'orders' }, 22, { method: 'POST', url: 'http://localhost/api/data', requestBody: '{}' })
    store.complete(a, { status: 200, responseBody: '{"err_code":0}' })
    store.complete(b, { status: 500, responseBody: 'failed' })
    store.close({ project: 'project_a', page: 'orders' }, 11)

    const report = store.collect('project_a')
    expect(report.totalCalls).toBe(1)
    expect(report.sessions[0]).toMatchObject({ project: 'project_a', page: 'orders' })
    expect(report.sessions[0].closedAt).toBeTruthy()
    expect(JSON.stringify(report)).not.toContain('project_b')
  })
})
