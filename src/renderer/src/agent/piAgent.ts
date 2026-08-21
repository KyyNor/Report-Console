/**
 * pi Agent 工厂 — 在渲染层构建 @earendil-works/pi-agent-core 的 Agent
 *
 * 架构：Agent 本体跑在渲染层（自研聊天组件订阅其事件流，见 chat/PiChat），
 * 平台工具经 IPC 桥回主进程执行（质量门/审计/confirm 约束全部留在工具层）。
 * 模型接入：设置页的 OpenAI/Anthropic 兼容配置；未配置 Key 时初始化直接失败（界面明确提示）。
 */

import { Agent, DEFAULT_COMPACTION_SETTINGS, estimateContextTokens, estimateTokens, generateSummaryWithUsage, type AgentMessage, type AgentTool } from '@earendil-works/pi-agent-core'
import {
  createModels, createProvider, Type,
  type Model, type Api
} from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { buildSystemPrompt } from '@shared/agentPrompt'
import { getLlmModelProfile } from '@shared/llmProfiles'
import { call } from '../api'
import type { AgentMode, AppSettings, ProjectPlatform } from '@shared/types'
import { initSessionStorage, restoreLatestSession, saveSessionSnapshot, newSessionId, titleFromMessages, type SaveSnapshot } from './piSessions'

export interface AgentScope { project: string; platform?: ProjectPlatform; mode?: AgentMode }

const DISCUSSION_READ_ONLY_TOOLS = new Set([
  'read_skill',
  'list_datasets', 'read_dataset',
  'list_procedures', 'read_procedure',
  'list_docs', 'read_doc',
  'list_pages', 'read_page',
  'collect_page_errors', 'inspect_legacy_cpt',
  'sql_query', 'list_tables', 'describe_table'
])

const OPENAI_DEFAULT = 'https://api.openai.com/v1'
const ANTHROPIC_DEFAULT = 'https://api.anthropic.com'

/** 上下文占用超过窗口的该比例即自动压缩一次。 */
const COMPACT_THRESHOLD = 0.8

/** 主进程暴露的平台工具定义 → pi AgentTool（execute 经 IPC 桥回主进程） */
async function buildPlatformTools(scope: AgentScope): Promise<AgentTool<any>[]> {
  const defs = await call<Array<{ name: string; description: string; schema: Record<string, unknown> }>>('pi:toolDefs')
  return defs.map((d) => ({
    name: d.name,
    label: d.name,
    description: d.description,
    parameters: Type.Unsafe<any>(d.schema),
    execute: async (_toolCallId: string, params: unknown) => {
      const r = await call<{ ok: boolean; data?: unknown; error?: string }>('pi:toolExec', { name: d.name, args: params, scope })
      const text = JSON.stringify(r.ok ? r.data : { error: r.error ?? '执行失败' })
      return { content: [{ type: 'text' as const, text }], details: r }
    }
  }))
}

/** 设置 → 自定义 provider（OpenAI / Anthropic 兼容网关）+ Model */
function buildCustomModel(s: AppSettings): { models: ReturnType<typeof createModels>; model: Model<Api>; reasoning: boolean } {
  const isAnthropic = s.llmProvider === 'anthropic'
  const providerId = isAnthropic ? 'rc-anthropic' : 'rc-openai'
  const baseUrl = (isAnthropic ? (s.llmBaseUrl || ANTHROPIC_DEFAULT) : (s.llmBaseUrl || OPENAI_DEFAULT)).replace(/\/+$/, '')
  const api = isAnthropic ? 'anthropic-messages' : 'openai-completions'
  const modelId = s.llmModel || (isAnthropic ? 'claude-sonnet-4-5' : 'gpt-4o-mini')
  // 参考 Prime Agent：端点默认项与模型能力分层。未知/高级自定义模型不注入厂商专有思考字段，
  // 只有经过验证的「预设 × 模型」档案才声明 reasoning / compat，避免一个网关内各模型互相污染。
  const modelProfile = getLlmModelProfile(s.llmPreset, modelId)
  const reasoning = modelProfile ? Boolean(modelProfile.reasoning) : s.llmThinkingEnabled

  const model: Model<Api> = {
    id: modelId,
    name: modelId,
    api,
    provider: providerId,
    baseUrl,
    reasoning,
    compat: modelProfile?.compat,
    thinkingLevelMap: modelProfile?.thinkingLevelMap,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    // 窗口来自设置页（getSettings 保证为正整数）：圆环分母与 80% 压缩阈值都按它算。
    contextWindow: s.llmContextWindow,
    maxTokens: 8192
  }

  const provider = createProvider({
    id: providerId,
    name: isAnthropic ? 'Anthropic 兼容网关' : 'OpenAI 兼容网关',
    baseUrl,
    auth: {
      apiKey: {
        name: 'Report Console LLM Key',
        resolve: async () => ({ auth: { apiKey: s.llmApiKey }, source: 'report-console 设置页' })
      }
    },
    models: [model],
    api: isAnthropic ? anthropicMessagesApi() : openAICompletionsApi()
  })

  const models = createModels()
  models.setProvider(provider)
  return { models, model, reasoning }
}

export interface PiAgentHandle {
  agent: Agent
  sessionId: string
  scope: AgentScope
  /** 当前生效模型 id（设置页配置） */
  modelId: string
  /** 模型上下文窗口（token），供占用展示与压缩阈值计算 */
  contextWindow: number
  setMode: (mode: AgentMode) => void
  setPlatform: (platform: ProjectPlatform) => void
}

/** 无 Key 时明确报错（不做演示模式兜底）：提示去设置页配置后重试 */
export const NO_KEY_ERROR = '模型未配置：Agent 需要真实模型，请先在「设置」页填写 协议 / Base URL / 模型名 / API Key，再重新打开本页'

/**
 * 构建 pi Agent。
 * @param fresh true = 跳过会话恢复，从空白会话开始（用于「新建会话」）
 */
export async function createPiAgent(scope: AgentScope, fresh = false): Promise<PiAgentHandle> {
  scope.platform ??= 'desktop'
  scope.mode ??= 'development'
  const s = await call<AppSettings>('config:get')
  if (!s.llmApiKey) throw new Error(NO_KEY_ERROR)
  const tools = await buildPlatformTools(scope)
  await initSessionStorage()

  const { models, model, reasoning } = buildCustomModel(s)

  // 恢复最近会话（messages/model/thinkingLevel 一并还原；无历史走全新会话）
  const restored = fresh ? null : await restoreLatestSession(scope.project)
  const snapshot: SaveSnapshot = restored
    ? { id: restored.id, title: restored.title, createdAt: restored.createdAt, project: scope.project }
    : { id: newSessionId(), title: '新会话', createdAt: new Date().toISOString(), project: scope.project }

  // 模型唯一来源是设置页配置：会话只恢复消息与 thinkingLevel。
  // 旧会话可能存过 pi 目录模型（provider 未注册）或已失效网关，一律回落当前配置，
  // 否则发消息会报 Unknown provider；streamFn 再兜一层防止运行中被切到未注册模型。
  const agent = new Agent({
    sessionId: snapshot.id,
    streamFn: (m, ctx, opts) => models.streamSimple(m.provider === model.provider ? m : model, ctx, opts),
    getApiKey: () => s.llmApiKey || undefined,
    initialState: {
      systemPrompt: buildSystemPrompt(scope.project, scope.platform, scope.mode),
      model,
      // 已验证模型按其能力档案映射；高级自定义模型仍沿用用户选择，但不自动添加厂商私有字段。
      thinkingLevel: reasoning && s.llmThinkingEnabled ? s.llmThinkingLevel : 'off',
      tools,
      messages: (restored?.data.messages ?? []) as never[]
    }
  })

  // 事件驱动自动保存：消息落定/回合结束即快照（标题沿用首条用户消息）
  agent.subscribe((ev) => {
    if (ev.type !== 'message_end' && ev.type !== 'agent_end') return
    if (snapshot.title === '新会话' && agent.state.messages.length > 0) {
      snapshot.title = titleFromMessages(agent.state.messages)
    }
    void saveSessionSnapshot(snapshot, agent.state)
    if (ev.type === 'agent_end') void maybeAutoCompact()
  })

  // ── 上下文自动压缩：占用超过窗口 80% 时把较早历史摘成一段总结。 ─────────
  // 用 pi-agent-core 官方 compaction 原语（estimate/generateSummary），但切点与
  // 保留策略按自研会话存储适配：尾部保留 DEFAULT_COMPACTION_SETTINGS.keepRecentTokens，
  // 切点对齐到 user 回合边界（避免把 toolCall 与其 toolResult 切开）。
  let compacting = false
  async function maybeAutoCompact(): Promise<void> {
    if (compacting || agent.state.isStreaming) return
    if (estimateContextTokens(agent.state.messages).tokens < model.contextWindow * COMPACT_THRESHOLD) return
    const messages = agent.state.messages
    let kept = 0
    let cut = messages.length
    for (let i = messages.length - 1; i >= 0; i--) {
      const t = estimateTokens(messages[i])
      if (kept + t > DEFAULT_COMPACTION_SETTINGS.keepRecentTokens && i < messages.length - 1) { cut = i + 1; break }
      kept += t
    }
    while (cut < messages.length && messages[cut].role !== 'user') cut++
    if (cut >= messages.length) return // 找不到可摘的完整回合（单回合超窗），留给模型侧截断
    compacting = true
    try {
      const result = await generateSummaryWithUsage(
        messages.slice(0, cut), models, model, DEFAULT_COMPACTION_SETTINGS.reserveTokens,
        undefined, undefined, undefined, 'off'
      )
      // 摘要期间用户可能又发了新消息；只在 Agent 空闲时原子替换，避免覆盖运行中的转录。
      if (!result.ok || agent.state.isStreaming) return
      const summary: AgentMessage = {
        role: 'user',
        content: `[自动压缩 · 早前对话摘要（压缩前约 ${estimateContextTokens(messages).tokens} token）]\n${result.value.text}`,
        timestamp: Date.now()
      }
      agent.state.messages = [summary, ...messages.slice(cut)]
      void saveSessionSnapshot(snapshot, agent.state)
    } finally {
      compacting = false
    }
  }

  const applyScope = () => {
    agent.state.systemPrompt = buildSystemPrompt(scope.project, scope.platform ?? 'desktop', scope.mode ?? 'development')
    agent.state.tools = scope.mode === 'discussion' ? tools.filter((item) => DISCUSSION_READ_ONLY_TOOLS.has(item.name)) : tools
  }
  return {
    agent,
    sessionId: snapshot.id,
    scope,
    modelId: model.id,
    contextWindow: model.contextWindow,
    setMode: (mode) => {
      if (agent.state.isStreaming) throw new Error('Agent 运行中不能切换模式')
      scope.mode = mode
      applyScope()
    },
    setPlatform: (platform) => {
      if (agent.state.isStreaming) throw new Error('Agent 运行中不能切换项目端型')
      scope.platform = platform
      applyScope()
    }
  }
}

// ── 每项目共享单例：工作台右栏与 Agent 页复用同项目会话，不跨项目串话。 ─────

const shared = new Map<string, Promise<PiAgentHandle>>()

/** 取共享 Agent（恢复最近会话）；失败时清缓存，下次重试 */
export function getSharedPiAgent(scope: AgentScope): Promise<PiAgentHandle> {
  let handle = shared.get(scope.project)
  if (!handle) {
    handle = createPiAgent(scope, false).catch((e) => { shared.delete(scope.project); throw e })
    shared.set(scope.project, handle)
  }
  return handle.then((resolved) => {
    if (scope.platform && resolved.scope.platform !== scope.platform) resolved.setPlatform(scope.platform)
    if (scope.mode && resolved.scope.mode !== scope.mode) resolved.setMode(scope.mode)
    return resolved
  })
}

/** 新建会话并替换共享单例 */
export function resetSharedPiAgent(scope: AgentScope): Promise<PiAgentHandle> {
  const handle = createPiAgent(scope, true).catch((e) => { shared.delete(scope.project); throw e })
  shared.set(scope.project, handle)
  return handle
}
