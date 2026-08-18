import { describe, expect, it } from 'vitest'
import { diffInventoriesForTest } from '@main/checkpointService'

describe('开发检查点文件差异', () => {
  it('按内容哈希识别新增、修改与删除，不把未变文件算入差异', () => {
    const changes = diffInventoriesForTest(
      [
        { path: 'project.yaml', hash: 'a', bytes: 10 },
        { path: 'pages/a.jsx', hash: 'b', bytes: 20 },
        { path: 'meta/old.md', hash: 'c', bytes: 30 }
      ],
      [
        { path: 'project.yaml', hash: 'a', bytes: 10 },
        { path: 'pages/a.jsx', hash: 'next', bytes: 22 },
        { path: 'meta/new.md', hash: 'd', bytes: 40 }
      ]
    )

    expect(changes).toEqual([
      expect.objectContaining({ path: 'meta/new.md', kind: 'added' }),
      expect.objectContaining({ path: 'meta/old.md', kind: 'deleted' }),
      expect.objectContaining({ path: 'pages/a.jsx', kind: 'modified' })
    ])
  })
})
