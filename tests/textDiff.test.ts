import { describe, expect, it } from 'vitest'
import { buildUnifiedLineDiff } from '@shared/textDiff'

describe('行级 Diff', () => {
  it('仅保留改动附近的上下文，并标出新增、删除及行号', () => {
    const diff = buildUnifiedLineDiff('first\nkeep\nold\nlast\n', 'first\nkeep\nnew\nlast\n', 1)
    const lines = diff.hunks.flatMap((hunk) => hunk.lines)
    expect(diff.truncated).toBe(false)
    expect(lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'deleted', text: 'old', oldLine: 3 }),
      expect.objectContaining({ kind: 'added', text: 'new', newLine: 3 })
    ]))
  })

  it('新增文件不会产生伪造的空删除行', () => {
    const diff = buildUnifiedLineDiff(undefined, 'created\n')
    const lines = diff.hunks.flatMap((hunk) => hunk.lines)
    expect(lines).toEqual([expect.objectContaining({ kind: 'added', text: 'created', newLine: 1 })])
  })
})
