/**
 * pi Agent 桥 — 平台工具的模型侧暴露面（渲染层 pi Agent 经 IPC 调用）
 *
 * 职责：把 agent/tools.ts 的 ai-sdk 工具集转换为
 *   ① JSON Schema 工具定义（pi:toolDefs，渲染层组装 AgentTool）
 *   ② 受控执行通道（pi:toolExec，全部在主进程内执行）
 * 质量门/SQL 审计/confirm 等约束都在工具实现层，与本桥无关地持续生效。
 */

import { zodToJsonSchema } from 'zod-to-json-schema'
import { buildTools, type PlatformTools } from './tools'
import * as projects from '../projectsService'

export interface PiToolDef {
  name: string
  description: string
  schema: Record<string, unknown>
}

/** Agent 会话由项目启动；模型不能自行扩大此范围。 */
export interface PiToolScope {
  project: string
}

type AnyTool = { description?: string; parameters?: unknown; execute?: (args: unknown, options: unknown) => PromiseLike<unknown> }

let cached: { defs: PiToolDef[]; tools: PlatformTools } | null = null

function registry(): { defs: PiToolDef[]; tools: PlatformTools } {
  if (cached) return cached
  const tools = buildTools()
  const defs = Object.entries(tools as unknown as Record<string, AnyTool>).map(([name, t]) => {
    const schema = zodToJsonSchema(t.parameters as never, { $refStrategy: 'none' }) as Record<string, unknown>
    delete schema.$schema
    return { name, description: t.description ?? '', schema }
  })
  cached = { defs, tools }
  return cached
}

export function piToolDefs(): PiToolDef[] {
  return registry().defs
}

const PROJECT_TOOLS = new Set([
  'list_datasets', 'read_dataset', 'save_dataset', 'delete_dataset', 'build_data_cpt', 'test_dataset',
  'list_procedures', 'read_procedure', 'save_procedure', 'apply_procedure',
  'list_docs', 'read_doc', 'write_doc', 'patch_doc',
  'list_pages', 'read_page', 'write_page', 'patch_page', 'create_page', 'update_page_paths', 'build_page', 'open_page', 'collect_page_errors',
  'inspect_legacy_cpt'
])
const SQL_TOOLS = new Set(['sql_query', 'sql_exec', 'list_tables', 'describe_table'])

function scopedArgs(name: string, raw: unknown, scope: PiToolScope): Record<string, unknown> {
  const args = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {}
  const project = projects.listProjects().find((p) => p.name === scope.project)
  if (!project) throw new Error(`Agent 当前项目不存在：${scope.project}`)

  // 所有项目资源工具由服务端覆盖 project；即便模型猜到其他项目名也无法越界。
  if (PROJECT_TOOLS.has(name)) args.project = project.name

  if (SQL_TOOLS.has(name)) {
    const ref = args.connection as { name?: unknown; id?: unknown } | undefined
    if (ref?.id !== undefined) throw new Error('Agent SQL 连接只能按当前项目的连接名引用')
    const connection = typeof ref?.name === 'string' ? ref.name : project.connections[0]
    if (!connection || !project.connections.includes(connection)) {
      throw new Error(`连接不属于当前项目 ${project.name}`)
    }
    args.connection = { name: connection }
    // 项目绑定的是连接（含默认库），Agent 不可借 database 参数跨库读取。
    delete args.database
  }
  return args
}

export async function piToolExec(name: string, args: unknown, scope: PiToolScope): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const { tools } = registry()
  const t = (tools as unknown as Record<string, AnyTool>)[name]
  if (!t || typeof t.execute !== 'function') return { ok: false, error: `未知工具：${name}` }
  try {
    const data = await t.execute(scopedArgs(name, args, scope), { toolCallId: `pi-${Date.now()}`, messages: [] })
    return { ok: true, data }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
