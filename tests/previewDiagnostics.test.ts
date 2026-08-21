import { describe, expect, it } from 'vitest'
import { fineReportDataError, isFineReportDataUrl, isFineReportFrameworkNoise, PreviewDiagnosticStore } from '@main/previewDiagnostics'

describe('预览诊断隔离', () => {
  it('只返回当前项目的窗口错误，关闭窗口后仍可读取', () => {
    const store = new PreviewDiagnosticStore()
    store.begin({ project: 'project_a', page: 'list' }, 'http://localhost/a', 11)
    store.begin({ project: 'project_b', page: 'list' }, 'http://localhost/b', 22)
    store.record({ project: 'project_a', page: 'list' }, 11, { kind: 'js_error', message: 'a failed' })
    store.record({ project: 'project_b', page: 'list' }, 22, { kind: 'js_error', message: 'b failed' })
    store.close({ project: 'project_a', page: 'list' }, 11)

    const report = store.collect('project_a')
    expect(report.totalErrors).toBe(1)
    expect(report.windows).toHaveLength(1)
    expect(report.windows[0]).toMatchObject({ project: 'project_a', page: 'list' })
    expect(report.windows[0].closedAt).toBeTruthy()
    expect(JSON.stringify(report)).not.toContain('project_b')
  })

  it('重新打开同一项目页面会开启干净的新一轮记录', () => {
    const store = new PreviewDiagnosticStore()
    const scope = { project: 'project_a', page: 'list' }
    store.begin(scope, 'http://localhost/first', 11)
    store.record(scope, 11, { kind: 'data_error', message: 'HTTP 500', status: 500 })
    store.begin(scope, 'http://localhost/second', 11)

    expect(store.collect('project_a', 'list')).toMatchObject({ totalErrors: 0 })
  })

  it('只识别 FineReport data API，不把其他请求当作接口错误', () => {
    expect(isFineReportDataUrl('http://localhost:8075/webroot/decision/api/data')).toBe(true)
    expect(isFineReportDataUrl('http://localhost:8075/webroot/decision/view/report')).toBe(false)
  })

  it('识别 HTTP 200 中的帆软业务错误，并忽略正常响应', () => {
    expect(fineReportDataError(200, JSON.stringify({ errorCode: '400', errorMsg: '参数格式错误' }))).toContain('参数格式错误')
    expect(fineReportDataError(200, JSON.stringify({ err_code: 0, data: [] }))).toBeNull()
    expect(fineReportDataError(500, 'server error')).toContain('HTTP 500')
  })

  it('忽略帆软框架缺失全局依赖的已知噪声', () => {
    expect(isFineReportFrameworkNoise('Uncaught ReferenceError: BI is not defined')).toBe(true)
    expect(isFineReportFrameworkNoise('Uncaught ReferenceError: CryptoJS is not defined')).toBe(true)
    expect(isFineReportFrameworkNoise('Uncaught ReferenceError: orderList is not defined')).toBe(false)
  })

  it('采集结果不会返回升级前已记录的帆软框架噪声', () => {
    const store = new PreviewDiagnosticStore()
    const scope = { project: 'project_a', page: 'list' }
    store.begin(scope, 'http://localhost/a', 11)
    store.record(scope, 11, { kind: 'js_error', message: 'Uncaught ReferenceError: BI is not defined' })
    store.record(scope, 11, { kind: 'js_error', message: 'Uncaught ReferenceError: orderList is not defined' })

    expect(store.collect('project_a')).toMatchObject({ totalErrors: 1 })
    expect(store.collect('project_a').windows[0].errors).toHaveLength(1)
  })
})
