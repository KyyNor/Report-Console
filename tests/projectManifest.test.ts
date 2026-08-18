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

  it('拒绝越出项目根目录的受管路径', () => {
    const root = mkdtempSync(join(tmpdir(), 'rc-manifest-'))
    try {
      writeFileSync(join(root, 'project.yaml'), `version: 1\nname: demo\nmanaged:\n  pages:\n    - id: bad\n      jsx: ../bad.jsx\n      mjs: pages/bad.mjs\n      cpt: pages/bad.cpt\n  data: []\n`)
      expect(() => readManifest(root)).toThrow('项目内相对路径')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
