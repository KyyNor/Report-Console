import { describe, expect, it } from 'vitest'
import { inspectLegacyCptXml } from '@main/cpt/legacyInspector'

const fixture = `<?xml version="1.0" encoding="UTF-8"?>
<WorkBook xmlVersion="20211223" releaseVersion="11.0.0">
  <TableDataMap>
    <TableData name="orders" class="com.fr.data.impl.DBTableData">
      <Connection><DatabaseName><![CDATA[demo_db]]></DatabaseName></Connection>
      <Query><![CDATA[SELECT id, title FROM orders]]></Query>
    </TableData>
  </TableDataMap>
  <ReportWebAttr><WebWriteContent><Listener event="afterload"><JavaScript><Parameters/><Content><![CDATA[initPage()]]></Content></JavaScript></Listener></WebWriteContent></ReportWebAttr>
  <Report class="com.fr.report.worksheet.WorkSheet"><CellElementList>
    <C c="0" r="0"><O><![CDATA[订单]]></O><Widget class="com.fr.form.ui.TextEditor"><WidgetName name="keyword"/></Widget></C>
    <C c="1" r="0"><Widget class="com.fr.form.ui.ComboBox"><Listener event="change"><Parameters><Parameter><Attributes name="operator"/><O t="XMLable"><Attributes><![CDATA[=$fine_username]]></Attributes></O></Parameter></Parameters><JavaScript><Content><![CDATA[refresh()]]></Content></JavaScript></Listener><Dictionary><TableData class="com.fr.data.impl.NameTableData"><Name><![CDATA[orders]]></Name></TableData></Dictionary><WidgetName name="status"/></Widget></C>
  </CellElementList></Report>
  <ReportParameterAttr><Parameters/></ReportParameterAttr>
</WorkBook>`

describe('传统 CPT 摘要器', () => {
  it('概览仅给出结构，不返回原始 XML 或 SQL 正文', () => {
    const result = inspectLegacyCptXml(fixture, { path: 'legacy/orders.cpt', bytes: fixture.length, mtime: 1 })
    expect(result).toMatchObject({
      path: 'legacy/orders.cpt',
      view: 'overview',
      counts: { datasets: 1, cells: 2, widgets: 2, listeners: 2, scripts: 2 },
      datasets: [{ name: 'orders', connection: 'demo_db' }],
      datasetReferences: ['orders'],
      widgetNames: ['keyword', 'status']
    })
    expect(JSON.stringify(result)).not.toContain('SELECT id, title FROM orders')
  })

  it('按分区返回 SQL 与控件细节，并支持分页', () => {
    const datasets = inspectLegacyCptXml(fixture, { path: 'legacy/orders.cpt', bytes: fixture.length, mtime: 1 }, { view: 'datasets' })
    expect(datasets).toMatchObject({ view: 'datasets', total: 1, items: [{ name: 'orders', query: 'SELECT id, title FROM orders' }] })

    const scripts = inspectLegacyCptXml(fixture, { path: 'legacy/orders.cpt', bytes: fixture.length, mtime: 1 }, { view: 'scripts', query: 'change' })
    expect(scripts).toMatchObject({ items: [{ event: 'change', parameters: [{ name: 'operator', formula: '=$fine_username' }] }] })

    const widgets = inspectLegacyCptXml(fixture, { path: 'legacy/orders.cpt', bytes: fixture.length, mtime: 1 }, { view: 'widgets', limit: 1 })
    expect(widgets).toMatchObject({ view: 'widgets', total: 2, cursor: 0, nextCursor: 1, items: [{ widgetName: 'keyword', label: '订单' }] })
  })
})
