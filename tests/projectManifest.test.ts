import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { createManifest, readManifest, writeManifest } from '@main/projectManifest'

describe('project.yaml', () => {
  it('以相对路径保存受管页面，且不登记目录中的传统 CPT', () => {
    const root = mkdtempSync(join(tmpdir(), 'rc-manifest-'))
    try {
      const manifest = createManifest('demo', '可迁移项目', ['warehouse'])
      manifest.managed.pages.push({
        id: 'orders',
        platform: 'desktop',
        jsx: '01-business/orders/orders.jsx',
        mjs: '01-business/orders/orders.mjs',
        cpt: '01-business/orders/orders.cpt'
      })
      writeManifest(root, manifest)
      // 不在 managed 清单中的文件不会被 YAML 自动收录。
      writeFileSync(join(root, 'legacy.cpt'), '<WorkBook />')
      const restored = readManifest(root)
      expect(restored.managed.pages).toEqual([manifest.managed.pages[0]])
      expect(restored.managed.data[0].cpt).toBe('data/demo_data.cpt')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('旧清单缺少端型时保持桌面端；移动项目的页面端型随项目恢复', () => {
    const root = mkdtempSync(join(tmpdir(), 'rc-manifest-'))
    try {
      writeFileSync(join(root, 'project.yaml'), `version: 1\nname: demo\nconnections: []\nmanaged:\n  pages:\n    - id: old_page\n      jsx: pages/old_page.jsx\n      mjs: pages/old_page.mjs\n      cpt: pages/old_page.cpt\n  data: []\ncontracts:\n  datasets: []\n  procedures: []\n`)
      expect(readManifest(root).platform).toBe('desktop')
      expect(readManifest(root).managed.pages[0].platform).toBe('desktop')

      writeFileSync(join(root, 'project.yaml'), `version: 1\nname: demo\nplatform: mobile\nconnections: []\nmanaged:\n  pages:\n    - id: mobile_page\n      jsx: pages/mobile_page.jsx\n      mjs: pages/mobile_page.mjs\n      cpt: pages/mobile_page.cpt\n  data: []\ncontracts:\n  datasets: []\n  procedures: []\n`)
      expect(readManifest(root).managed.pages[0].platform).toBe('mobile')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('拒绝越出项目根目录的受管路径', () => {
    const root = mkdtempSync(join(tmpdir(), 'rc-manifest-'))
    try {
      writeFileSync(join(root, 'project.yaml'), `version: 1\nname: demo\nmanaged:\n  pages:\n    - id: bad\n      jsx: ../bad.jsx\n      mjs: pages/bad.mjs\n      cpt: pages/bad.cpt\n  data: []\n`)
      expect(() => readManifest(root)).toThrow('项目内相对路径')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('随项目携带接口契约和过程定义路径', () => {
    const root = mkdtempSync(join(tmpdir(), 'rc-manifest-'))
    try {
      const manifest = createManifest('demo', '', ['warehouse'])
      manifest.contracts.datasets.push({
        name: 'orders_qry', kind: 'list', comment: '订单列表', connection: 'warehouse',
        params: [{ name: 'p_page', type: 'integer', default: '1' }], sql: 'SELECT * FROM orders'
      })
      manifest.contracts.procedures.push({
        name: 'sp_orders_insert', connection: 'warehouse', comment: '新增订单', definition: 'sql/procedures/sp_orders_insert.sql'
      })
      writeManifest(root, manifest)
      const restored = readManifest(root)
      expect(restored.contracts.datasets[0].sql).toBe('SELECT * FROM orders')
      expect(restored.contracts.procedures[0].definition).toBe('sql/procedures/sp_orders_insert.sql')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
