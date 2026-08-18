import { describe, expect, it } from 'vitest'
import { replaceUniqueText } from '@main/textPatch'

describe('精确文本 patch', () => {
  it('仅替换唯一命中的片段', () => {
    expect(replaceUniqueText('before\nold\nafter', 'old', 'new', '页面 demo')).toBe('before\nnew\nafter')
  })

  it('拒绝未命中或多处命中的片段', () => {
    expect(() => replaceUniqueText('a\nb', 'missing', 'new', '页面 demo')).toThrow('未找到指定原片段')
    expect(() => replaceUniqueText('same\nsame', 'same', 'new', '页面 demo')).toThrow('命中多处')
  })
})
