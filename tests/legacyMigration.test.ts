import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { inspectLegacyProject } from '@main/legacyMigrationService'

const dirs: string[] = []
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rc-legacy-migration-'))
  dirs.push(dir)
  return dir
}
function dataCpt(): string {
  return `<?xml version="1.0"?><WorkBook><TableDataMap>
    <TableData name="book_qry" class="com.fr.data.impl.DBTableData">
      <Parameters><Parameter><Attributes name="p_page"/><O t="I"><![CDATA[1]]></O></Parameter></Parameters>
      <Connection><DatabaseName><![CDATA[legacy_connection]]></DatabaseName></Connection>
      <Query><![CDATA[SELECT id FROM book LIMIT ${(1)}]]></Query>
    </TableData>
  </TableDataMap></WorkBook>`
}

afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }) })

describe('legacy migration inspection', () => {
  it('JSX + data CPT + SQL is source-complete and extracts the contract', () => {
    const dir = fixture()
    mkdirSync(join(dir, 'pages'))
    writeFileSync(join(dir, 'legacy_data.cpt'), dataCpt())
    writeFileSync(join(dir, 'pages', 'book.jsx'), 'function App(){ return <div /> }')
    writeFileSync(join(dir, 'schema.sql'), 'CREATE TABLE book (id int);')

    const plan = inspectLegacyProject(dir)
    expect(plan.mode).toBe('lossless')
    expect(plan.dataCpt).toBe('legacy_data.cpt')
    expect(plan.jsx).toEqual(['pages/book.jsx'])
    expect(plan.datasets).toEqual([expect.objectContaining({
      name: 'book_qry', kind: 'list', connection: 'legacy_connection', sql: 'SELECT id FROM book LIMIT 1',
      params: [{ name: 'p_page', type: 'integer', default: '1' }]
    })])
  })

  it('CPT-only pages stay in reconstruct mode and warn instead of claiming decompilation', () => {
    const dir = fixture()
    writeFileSync(join(dir, 'legacy_data.cpt'), dataCpt())
    writeFileSync(join(dir, 'book.cpt'), '<WorkBook/>')

    const plan = inspectLegacyProject(dir)
    expect(plan.mode).toBe('reconstruct')
    expect(plan.legacyCpts).toEqual(['book.cpt'])
    expect(plan.warnings.join('\n')).toContain('页面只能由 Agent')
  })
})
