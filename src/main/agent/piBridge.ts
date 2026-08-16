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

export interface PiToolDef {
  name: string
  description: string
  schema: Record<string, unknown>
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

export async function piToolExec(name: string, args: unknown): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const { tools } = registry()
  const t = (tools as unknown as Record<string, AnyTool>)[name]
  if (!t || typeof t.execute !== 'function') return { ok: false, error: `未知工具：${name}` }
  try {
    const data = await t.execute(args, { toolCallId: `pi-${Date.now()}`, messages: [] })
    return { ok: true, data }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
