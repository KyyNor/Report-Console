export interface DomainConfig {
  file: string
  /** 条目名列；数组表示复合键（用 “ / ” 连接） */
  key: string | string[]
  /** 显式条目名白名单，或 '*' 全量收录 */
  entries: string[] | '*'
  /** 可选列白名单（key 列强制保留） */
  columns?: string[]
}

export interface EntryDiff {
  added: string[]
  modified: string[]
  removed: string[]
}

export function applyDomain(rows: Record<string, string>[], cfg: DomainConfig): { rows: Record<string, string>[]; missing: string[] }
export function diffByKeys(oldRows: Record<string, string>[], newRows: Record<string, string>[], key: string | string[]): EntryDiff
