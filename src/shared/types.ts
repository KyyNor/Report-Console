import type { LlmPresetId } from './llmProfiles'

/**
 * 共享类型定义（main / renderer / agent 工具共用）· v2 项目制
 */

// ── 数据连接（注册表，与帆软数据连接一一对应） ──────────────────

export interface DbConnection {
  id: number
  name: string          // 与帆软设计器里的数据连接同名（写入 _data.cpt 的 DatabaseName）
  host: string
  port: string
  user: string
  password: string
  database: string
  comment: string
  createdAt: string
}

export interface ConnectionHealth {
  name: string
  reachable: boolean
  latencyMs?: number
  version?: string
  error?: string
}

// ── 项目 ────────────────────────────────────────────────────────

export type ProjectPlatform = 'desktop' | 'mobile' | 'dual'
export type PagePlatform = 'desktop' | 'mobile'
export type AgentMode = 'development' | 'discussion'

export interface Project {
  id: number
  name: string          // = reportlets 子目录名 [a-z][a-z0-9_]*
  comment: string
  createdAt: string
  dir: string           // reportlets/{name} 绝对路径
  missingDir: boolean   // 目录被移动/删除
  platform: ProjectPlatform // 项目面向桌面端、移动端或双端；可迁移定义来自 project.yaml
  dataCptPath: string    // project.yaml.managed.data[0].cpt（项目内相对路径）
  connections: string[] // 绑定的连接名
  counts: { ifs: number; sps: number; pgs: number; docs: number }
}

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
  projectId: number
  name: string
  kind: DatasetKind
  comment: string
  params: DatasetParam[]
  sql: string
  connection: string    // 所属连接名（从项目绑定清单中选）
  updatedAt: string
}

export interface DatasetStatus {
  test: { st: 'ok' | 'fail' | 'unreach' | 'none'; t?: string; rows?: number; ms?: number; ec?: number | null; why?: string }
  build?: string        // 最近构建时间（项目级，同组共享）
}

// ── 构建记录 ────────────────────────────────────────────────────

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

// ── 存储过程（归属项目；可被其他项目关联） ──────────────────────

export interface ProcRecord {
  id: number
  projectId: number          // 拥有者项目
  connection: string
  name: string
  comment: string
  updatedAt: string
  own: boolean               // 视图语义：本项目创建（true）/ 关联自其他项目（false）
  srcProject?: string        // own=false 时的来源项目名
  appliedCount: number       // ddl_log 中应用次数
}

// ── 页面 ────────────────────────────────────────────────────────

export interface PageMeta {
  project: string
  name: string       // 不含扩展名
  platform: PagePlatform
  /** project.yaml 内相对路径；受管页面可以位于项目树的任何位置。 */
  jsxPath?: string
  mjsPath?: string
  cptPath?: string
  jsxExists: boolean
  mjsExists: boolean
  cptExists: boolean
  jsxMtime?: number
  cptMtime?: number  // cpt 早于 jsx 则需要重新构建
  stale: boolean
  size?: number
  lastBuildAt?: string
  lastBuildOk?: boolean
}

/** 目录内存在、但不在 project.yaml managed 清单中的传统 CPT。 */
export interface TraditionalCptMeta {
  path: string       // 项目根目录内相对路径
  name: string
  size: number
  mtime: number
}

// ── 预览窗口 Data API 调用日志（进程内、按项目/页面隔离） ────────

export interface PreviewDataParameter {
  name: string
  type?: string
  value?: unknown
}

export interface PreviewDataCall {
  id: number
  at: string
  completedAt?: string
  durationMs?: number
  method: string
  url: string
  status?: number
  requestBody?: string
  responseBody?: string
  networkError?: string
  reportPath?: string
  datasourceName?: string
  parameters?: PreviewDataParameter[]
  sqlTemplate?: string
  /** 请求参数已代入帆软公式表达式，但尚未由 FR.remoteEvaluate 求值。 */
  sqlPrepared?: string
  /** 桌面预览窗口显式执行 FR.remoteEvaluate 后得到的调试 SQL。 */
  sqlResolved?: string
  sqlResolutionError?: string
}

export interface PreviewDataSession {
  project: string
  page: string
  url: string
  windowId: number
  openedAt: string
  lastActivityAt: string
  closedAt?: string
  calls: PreviewDataCall[]
}

export interface PreviewDataReport {
  project: string
  page?: string
  totalCalls: number
  sessions: PreviewDataSession[]
}

// ── 文档（项目 meta/ 元数据） ───────────────────────────────────

export interface DocMeta {
  name: string       // 含扩展名（.md / .txt / .html / .sql / .js / .jsx / .mjs / .css）
  type: 'markdown' | 'sql' | 'other'
  size: number
  mtime: number
}

// ── 开发检查点（RC 本地历史，不替代 SVN） ────────────────────────

export type CheckpointOrigin = 'baseline' | 'agent' | 'manual' | 'restore' | 'recovery'

export interface DevelopmentCheckpoint {
  id: string
  project: string
  origin: CheckpointOrigin
  /** 对 Agent 回合为用户任务摘要；人工与恢复操作为动作描述。 */
  title: string
  sessionId?: string
  parentId?: string
  restoredFrom?: string
  fileCount: number
  additions: number
  deletions: number
  createdAt: string
}

export interface CheckpointFileMeta {
  path: string
  hash: string
  bytes: number
}

export interface CheckpointFileChange {
  path: string
  kind: 'added' | 'modified' | 'deleted'
  before?: CheckpointFileMeta
  after?: CheckpointFileMeta
}

export interface CheckpointDiff {
  from: string
  to: string
  additions: number
  deletions: number
  changes: CheckpointFileChange[]
}

export interface CheckpointFileDiff {
  path: string
  before?: string
  after?: string
}

// ── 设置 ────────────────────────────────────────────────────────

export interface AppSettings {
  frServerUrl: string
  reportletsPath: string
  llmProvider: 'openai' | 'anthropic'
  /** 预设服务商；custom 表示完全由高级模式提供协议与端点。 */
  llmPreset: LlmPresetId
  /** 显示协议 / Base URL / 自定义模型等低层字段。 */
  llmAdvancedMode: boolean
  llmBaseUrl: string
  llmApiKey: string
  llmModel: string
  /** 模型上下文窗口（token）：聊天页占用圆环分母与 80% 自动压缩阈值来源。 */
  llmContextWindow: number
  /** 是否请求模型输出可见思考；关闭时 GLM/ZAI 会显式收到 thinking: disabled。 */
  llmThinkingEnabled: boolean
  llmThinkingLevel: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  /** 打包邮件发送（独立配置，不与 looop-studio 共享）：SMTP 发件账号与分卷参数 */
  mailSmtpHost: string
  mailSmtpPort: number
  /** 隐式 TLS（465）；关闭时明文连接，服务器通告 STARTTLS 则自动升级 */
  mailSmtpTls: boolean
  mailFrom: string
  mailPassword: string
  /** 默认收件邮箱（打包弹窗中可改） */
  mailTo: string
  /** 分卷大小（MiB），超限才切分 */
  mailChunkMiB: number
  /** 更新检查：用户忽略的版本号，该版本不再提示，更新版本发布后自然失效 */
  updateIgnoredVersion: string
}

export interface StatusPayload {
  frReachable: boolean
  frLatencyMs?: number
  reportletsWritable: boolean
  reportletsPath: string
  connections: ConnectionHealth[]
  counts: { projects: number; datasets: number; pages: number; procedures: number; docs: number }
}

// ── Agent ───────────────────────────────────────────────────────
// Agent 引擎为 pi（渲染层 @earendil-works/pi-agent-core，聊天界面为自研组件），
// 会话持久化走 IndexedDB（自研存储层），平台工具经 piBridge 的
// pi:toolDefs / pi:toolExec IPC 通道回主进程执行——详见 src/main/agent/。
