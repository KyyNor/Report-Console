/**
 * pi Agent 工厂 — 在渲染层构建 @earendil-works/pi-agent-core 的 Agent
 *
 * 架构：Agent 本体跑在渲染层（自研聊天组件订阅其事件流，见 chat/PiChat），
 * 平台工具经 IPC 桥回主进程执行（质量门/审计/confirm 约束全部留在工具层）。
 * 模型接入：设置页的 OpenAI/Anthropic 兼容配置；未配置 Key 时初始化直接失败（界面明确提示）。
 */

import { Agent, type AgentTool } from '@earendil-works/pi-agent-core'
import {
  createModels, createProvider, Type,
  type Model, type Api
} from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { SYSTEM_PROMPT } from '@shared/agentPrompt'
import { call } from '../api'
import type { AppSettings } from '@shared/types'
import { initSessionStorage, restoreLatestSession, saveSessionSnapshot, newSessionId, titleFromMessages, type SaveSnapshot } from './piSessions'

const OPENAI_DEFAULT = 'https://api.openai.com/v1'
const ANTHROPIC_DEFAULT = 'https://api.anthropic.com'

/** 主进程暴露的平台工具定义 → pi AgentTool（execute 经 IPC 桥回主进程） */
async function buildPlatformTools(): Promise<AgentTool<any>[]> {
  const defs = await call<Array<{ name: string; description: string; schema: Record<string, unknown> }>>('pi:toolDefs')
  return defs.map((d) => ({
    name: d.name,
    label: d.name,
    description: d.description,
    parameters: Type.Unsafe<any>(d.schema),
    execute: async (_toolCallId: string, params: unknown) => {
      const r = await call<{ ok: boolean; data?: unknown; error?: string }>('pi:toolExec', { name: d.name, args: params })
      const text = JSON.stringify(r.ok ? r.data : { error: r.error ?? '执行失败' })
      return { content: [{ type: 'text' as const, text }], details: r }
    }
  }))
}

/** 设置 → 自定义 provider（OpenAI / Anthropic 兼容网关）+ Model */
function buildCustomModel(s: AppSettings): { models: ReturnType<typeof createModels>; model: Model<Api> } {
  const isAnthropic = s.llmProvider === 'anthropic'
  const providerId = isAnthropic ? 'rc-anthropic' : 'rc-openai'
  const baseUrl = (isAnthropic ? (s.llmBaseUrl || ANTHROPIC_DEFAULT) : (s.llmBaseUrl || OPENAI_DEFAULT)).replace(/\/+$/, '')
  const api = isAnthropic ? 'anthropic-messages' : 'openai-completions'
  const modelId = s.llmModel || (isAnthropic ? 'claude-sonnet-4-5' : 'gpt-4o-mini')

  const model: Model<Api> = {
    id: modelId,
    name: modelId,
    api,
    provider: providerId,
    baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
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
  return { models, model }
}

export interface PiAgentHandle {
  agent: Agent
  sessionId: string
  /** 当前生效模型 id（设置页配置） */
  modelId: string
}

/** 无 Key 时明确报错（不做演示模式兜底）：提示去设置页配置后重试 */
export const NO_KEY_ERROR = '模型未配置：Agent 需要真实模型，请先在「设置」页填写 协议 / Base URL / 模型名 / API Key，再重新打开本页'

/**
 * 构建 pi Agent。
 * @param fresh true = 跳过会话恢复，从空白会话开始（用于「新建会话」）
 */
export async function createPiAgent(fresh = false): Promise<PiAgentHandle> {
  const s = await call<AppSettings>('config:get')
  if (!s.llmApiKey) throw new Error(NO_KEY_ERROR)
  const tools = await buildPlatformTools()
  await initSessionStorage()

  const { models, model } = buildCustomModel(s)

  // 恢复最近会话（messages/model/thinkingLevel 一并还原；无历史走全新会话）
  const restored = fresh ? null : await restoreLatestSession()
  const snapshot: SaveSnapshot = restored
    ? { id: restored.id, title: restored.title, createdAt: restored.createdAt }
    : { id: newSessionId(), title: '新会话', createdAt: new Date().toISOString() }

  // 模型唯一来源是设置页配置：会话只恢复消息与 thinkingLevel。
  // 旧会话可能存过 pi 目录模型（provider 未注册）或已失效网关，一律回落当前配置，
  // 否则发消息会报 Unknown provider；streamFn 再兜一层防止运行中被切到未注册模型。
  const agent = new Agent({
    sessionId: snapshot.id,
    streamFn: (m, ctx, opts) => models.streamSimple(m.provider === model.provider ? m : model, ctx, opts),
    getApiKey: () => s.llmApiKey || undefined,
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model,
      thinkingLevel: restored?.data.thinkingLevel,
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
  })

  return { agent, sessionId: snapshot.id, modelId: model.id }
}

// ── 共享单例：Agent 页与工作台右栏复用同一实例（同一会话流） ─────

let shared: Promise<PiAgentHandle> | null = null

/** 取共享 Agent（恢复最近会话）；失败时清缓存，下次重试 */
export function getSharedPiAgent(): Promise<PiAgentHandle> {
  if (!shared) {
    shared = createPiAgent(false).catch((e) => { shared = null; throw e })
  }
  return shared
}

/** 新建会话并替换共享单例 */
export function resetSharedPiAgent(): Promise<PiAgentHandle> {
  shared = createPiAgent(true).catch((e) => { shared = null; throw e })
  return shared
}
