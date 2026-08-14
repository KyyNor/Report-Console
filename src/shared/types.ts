/**
 * 共享类型定义（main / renderer / agent 工具共用）
 */

// ── 接口（数据集）契约 ──────────────────────────────────────────

export type ParamType = 'string' | 'integer' | 'double' | 'formula'

export interface DatasetParam {
  name: string
  type: ParamType
  default?: string
}

export type DatasetKind =
  | 'list'    // 分页列表 SELECT ... LIMIT
  | 'stat'    // 统计 SELECT COUNT(*)
  | 'detail'  // 单条查询 WHERE id
  | 'dict'    // 字典下拉
  | 'insert'  // 新增（CALL 存储过程）
  | 'update'  // 更新（CALL 存储过程）
  | 'delete'  // 删除（CALL 存储过程）
  | 'other'

export interface Dataset {
  id: number
  moduleId: number
  name: string
  kind: DatasetKind
  comment: string
  params: DatasetParam[]
  sql: string
  updatedAt: string
}

export interface Module {
  id: number
  name: string
  datasource: string
  comment: string
  createdAt: string
}

// ── 构建 / 测试记录 ─────────────────────────────────────────────

export interface CheckerFinding {
  rule: string
  severity: 'error' | 'warning'
  line?: number | null
  message: string
}

export interface BuildResult {
  ok: boolean
  kind: 'data' | 'page'
  target: string
  outputPath?: string
  findings: CheckerFinding[]
  log: string[]
}

export interface ApiTestResult {
  id: number
  moduleId: number | null
  datasetId: number | null
  datasetName: string
  request: unknown
  response: unknown
  ok: boolean
  errCode?: number | null
  durationMs: number
  createdAt: string
}

// ── 页面 ────────────────────────────────────────────────────────

export interface PageMeta {
  module: string
  name: string       // 不含扩展名
  jsxExists: boolean
  mjsExists: boolean
  cptExists: boolean
  jsxMtime?: number
  cptMtime?: number  // cpt 早于 jsx 则需要重新构建
  stale: boolean
  size?: number
}

// ── 设置 ────────────────────────────────────────────────────────

export interface AppSettings {
  frServerUrl: string
  reportletsPath: string
  mysqlHost: string
  mysqlPort: string
  mysqlUser: string
  mysqlPassword: string
  mysqlDatabase: string
  llmProvider: 'openai' | 'anthropic'
  llmBaseUrl: string
  llmApiKey: string
  llmModel: string
}

export interface StatusPayload {
  frReachable: boolean
  frLatencyMs?: number
  mysqlReachable: boolean
  mysqlLatencyMs?: number
  mysqlVersion?: string
  reportletsWritable: boolean
  reportletsPath: string
  database: string
  counts: { modules: number; datasets: number; pages: number; procedures: number }
}

// ── 存储过程 ────────────────────────────────────────────────────

export interface ProcedureMeta {
  name: string
  database: string
  definer: string
  created: string
  altered: string
  comment: string
}

// ── Agent ───────────────────────────────────────────────────────

export type AgentEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; tool: string; args: unknown; callId: string }
  | { type: 'tool-result'; tool: string; result: unknown; callId: string }
  | { type: 'finish'; finishReason: string; usage?: unknown }
  | { type: 'error'; message: string }

export interface AgentMessage {
  id: number
  sessionId: number
  role: 'user' | 'assistant' | 'system'
  content: string
  toolJson?: string | null
  createdAt: string
}
