/** 轻量行级 Diff：用于 UI 展示，不依赖外部包。 */

export type DiffLineKind = 'context' | 'added' | 'deleted'

export interface UnifiedDiffLine {
  kind: DiffLineKind
  text: string
  oldLine?: number
  newLine?: number
}

export interface UnifiedDiffHunk {
  lines: UnifiedDiffLine[]
}

export interface UnifiedDiffResult {
  hunks: UnifiedDiffHunk[]
  truncated: boolean
}

type Edit = { kind: 'equal' | 'added' | 'deleted'; text: string }

const MAX_DIFF_LINES = 20_000
const MAX_EDIT_DISTANCE = 4_000

function splitLines(content: string): string[] {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!normalized) return []
  // 不把末尾换行伪造成一条空的代码行。
  return normalized.endsWith('\n') ? normalized.slice(0, -1).split('\n') : normalized.split('\n')
}

/**
 * Myers O((N + M)D) 行级 Diff。源码或文档通常改动稀疏，避免 LCS 的 O(NM) 内存。
 * 超过上限时交由调用方提示，不能为了预览把渲染器卡死。
 */
function myers(before: string[], after: string[]): Edit[] | null {
  const n = before.length
  const m = after.length
  const max = n + m
  const limit = Math.min(max, MAX_EDIT_DISTANCE)
  let frontier = new Map<number, number>([[1, 0]])
  const trace: Array<Map<number, number>> = []

  for (let distance = 0; distance <= limit; distance++) {
    trace.push(new Map(frontier))
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const down = frontier.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY
      const right = frontier.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY
      let x: number
      if (diagonal === -distance || (diagonal !== distance && right < down)) x = down
      else x = right + 1
      let y = x - diagonal
      while (x < n && y < m && before[x] === after[y]) { x++; y++ }
      frontier.set(diagonal, x)
      if (x >= n && y >= m) return backtrack(trace, before, after)
    }
  }
  return null
}

function backtrack(trace: Array<Map<number, number>>, before: string[], after: string[]): Edit[] {
  let x = before.length
  let y = after.length
  const edits: Edit[] = []

  for (let distance = trace.length - 1; distance >= 0; distance--) {
    const frontier = trace[distance]
    const diagonal = x - y
    const down = frontier.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY
    const right = frontier.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY
    const previousDiagonal = diagonal === -distance || (diagonal !== distance && right < down)
      ? diagonal + 1
      : diagonal - 1
    const previousX = frontier.get(previousDiagonal) ?? 0
    const previousY = previousX - previousDiagonal

    while (x > previousX && y > previousY) {
      edits.push({ kind: 'equal', text: before[x - 1] })
      x--; y--
    }
    if (distance === 0) break
    if (x === previousX) {
      edits.push({ kind: 'added', text: after[y - 1] })
      y--
    } else {
      edits.push({ kind: 'deleted', text: before[x - 1] })
      x--
    }
  }
  return edits.reverse()
}

function numberLines(edits: Edit[]): UnifiedDiffLine[] {
  let oldLine = 1
  let newLine = 1
  return edits.map((edit) => {
    if (edit.kind === 'equal') return { kind: 'context', text: edit.text, oldLine: oldLine++, newLine: newLine++ }
    if (edit.kind === 'deleted') return { kind: 'deleted', text: edit.text, oldLine: oldLine++ }
    return { kind: 'added', text: edit.text, newLine: newLine++ }
  })
}

function toHunks(lines: UnifiedDiffLine[], context: number): UnifiedDiffHunk[] {
  const changed = lines.map((line, index) => line.kind !== 'context' ? index : -1).filter((index) => index >= 0)
  if (!changed.length) return []
  const hunks: UnifiedDiffHunk[] = []
  let cursor = 0
  while (cursor < changed.length) {
    const start = Math.max(0, changed[cursor] - context)
    let end = Math.min(lines.length - 1, changed[cursor] + context)
    cursor++
    while (cursor < changed.length && changed[cursor] <= end + context + 1) {
      end = Math.min(lines.length - 1, changed[cursor] + context)
      cursor++
    }
    hunks.push({ lines: lines.slice(start, end + 1) })
  }
  return hunks
}

export function buildUnifiedLineDiff(before: string | undefined, after: string | undefined, context = 3): UnifiedDiffResult {
  const oldLines = splitLines(before ?? '')
  const newLines = splitLines(after ?? '')
  if (oldLines.length + newLines.length > MAX_DIFF_LINES) return { hunks: [], truncated: true }
  const edits = myers(oldLines, newLines)
  if (!edits) return { hunks: [], truncated: true }
  return { hunks: toHunks(numberLines(edits), context), truncated: false }
}
