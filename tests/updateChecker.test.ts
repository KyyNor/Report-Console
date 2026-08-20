import { describe, expect, it } from 'vitest'
import { compareVersions } from '@main/updateChecker'

describe('版本号比较（更新检查用）', () => {
  it('按 x.y.z 数值比较，兼容 v 前缀', () => {
    expect(compareVersions('0.3.1', '0.3.0')).toBe(1)
    expect(compareVersions('v0.4.0', '0.3.9')).toBe(1)
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1)
    expect(compareVersions('0.3.1', '0.3.1')).toBe(0)
    expect(compareVersions('0.3.1', 'v0.3.1')).toBe(0)
    expect(compareVersions('0.2.9', '0.3.0')).toBe(-1)
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1)
  })

  it('缺失/非数值片段按 0 处理，不抛错', () => {
    expect(compareVersions('0.3', '0.3.0')).toBe(0)
    expect(compareVersions('', '0.0.1')).toBe(-1)
    expect(compareVersions('x.y.z', '0.0.0')).toBe(0)
  })
})
