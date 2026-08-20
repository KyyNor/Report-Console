import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { inflateRawSync } from 'zlib'
import { describe, expect, it } from 'vitest'
import { buildZip, collectZipEntries } from '@main/zipWriter'

/** 测试侧迷你读取器：解析 EOCD + 中央目录，逐条还原名称与方法，并解压回原文。 */
function readZipEntries(zip: Buffer): Array<{ name: string; method: number; data: Buffer }> {
  const eocd = zip.subarray(zip.length - 22)
  expect(eocd.readUInt32LE(0)).toBe(0x06054b50)
  const count = eocd.readUInt16LE(10)
  let p = eocd.readUInt32LE(16)
  const out: Array<{ name: string; method: number; data: Buffer }> = []
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(p)).toBe(0x02014b50)
    const method = zip.readUInt16LE(p + 10)
    const compSize = zip.readUInt32LE(p + 20)
    const nameLen = zip.readUInt16LE(p + 28)
    const localOffset = zip.readUInt32LE(p + 42)
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString('utf-8')
    const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26)
    const raw = zip.subarray(dataStart, dataStart + compSize)
    out.push({ name, method, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) })
    p += 46 + nameLen
  }
  return out
}

describe('zip 打包器', () => {
  it('目录收集：嵌套文件与中文文件名入库，跳过 .git/node_modules/系统杂项', () => {
    const root = mkdtempSync(join(tmpdir(), 'rc-zip-'))
    try {
      mkdirSync(join(root, 'pages'), { recursive: true })
      mkdirSync(join(root, 'meta'), { recursive: true })
      mkdirSync(join(root, '.git', 'objects'), { recursive: true })
      writeFileSync(join(root, 'project.yaml'), 'version: 1\n')
      writeFileSync(join(root, 'pages', 'orders.jsx'), 'export default () => <div />')
      writeFileSync(join(root, 'meta', '01-需求-订单管理.md'), '# 订单管理')
      writeFileSync(join(root, '.DS_Store'), 'junk')
      writeFileSync(join(root, '.git', 'objects', 'x'), 'junk')

      const names = collectZipEntries(root).map((e) => e.name)
      expect(names).toContain('project.yaml')
      expect(names).toContain('pages/')
      expect(names).toContain('pages/orders.jsx')
      expect(names).toContain('meta/01-需求-订单管理.md')
      expect(names.some((n) => n.includes('.git') || n.includes('.DS_Store'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('字节流可完整解回：目录条目、deflate 内容与原文一致', () => {
    const root = mkdtempSync(join(tmpdir(), 'rc-zip-'))
    try {
      mkdirSync(join(root, 'meta'), { recursive: true })
      const yaml = 'version: 1\nname: demo\n'
      const doc = '# 需求'.repeat(200) // 高重复内容确保 deflate 明显小于原文
      writeFileSync(join(root, 'project.yaml'), yaml)
      writeFileSync(join(root, 'meta', '01-需求.md'), doc)

      const entries = collectZipEntries(root).map((e) => ({ ...e, name: `demo/${e.name}` }))
      const restored = readZipEntries(buildZip(entries))
      const byName = new Map(restored.map((e) => [e.name, e]))

      expect(byName.get('demo/meta/')).toEqual({ name: 'demo/meta/', method: 0, data: Buffer.alloc(0) })
      expect(byName.get('demo/project.yaml')!.data.toString()).toBe(yaml)
      expect(byName.get('demo/meta/01-需求.md')!.data.toString()).toBe(doc)
      expect(byName.get('demo/meta/01-需求.md')!.method).toBe(8)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('压不小的内容回退 store 存储', () => {
    const random = randomBytes(64 * 1024) // 随机数据 deflate 压不小
    const zip = buildZip([{ name: 'blob.bin', data: random, mtime: new Date() }])
    const [entry] = readZipEntries(zip)
    expect(entry.method).toBe(0)
    expect(entry.data.equals(random)).toBe(true)
  })
})
