/**
 * 常用国内模型服务的保守接入档案。
 *
 * 参考 Prime Agent 的 provider defaults + model overrides 分层：
 * https://github.com/PrimeIntellect-ai/prime-agent/blob/main/packages/coding-agent/docs/models.md
 * 端点共性放 provider，思考/上下文/协议细节放 model；未知模型不继承思考专有参数。
 */

export type LlmWireApi = 'openai' | 'anthropic'
export type LlmPresetId =
  | 'zhipu_cn'
  | 'volcengine_coding_plan'
  | 'deepseek_cn'
  | 'siliconflow_cn'
  | 'mimo_cn'
  | 'minimax_cn'
  | 'kimi_cn'
  | 'openrouter'
  | 'custom'

export type ThinkingFormat = 'qwen' | 'zai' | 'deepseek' | 'openrouter'

export interface LlmCompatProfile {
  thinkingFormat?: ThinkingFormat
  supportsDeveloperRole?: boolean
  supportsReasoningEffort?: boolean
  maxTokensField?: 'max_tokens' | 'max_completion_tokens'
  requiresReasoningContentOnAssistantMessages?: boolean
}

export interface LlmModelProfile {
  id: string
  label: string
  contextWindow: number
  reasoning?: boolean
  /** null = 不支持且不应在 UI 展示；当前 Pi 档位以此映射/裁剪。 */
  thinkingLevelMap?: Partial<Record<'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh', string | null>>
  compat?: LlmCompatProfile
}

export interface LlmProviderProfile {
  id: Exclude<LlmPresetId, 'custom'>
  label: string
  api: LlmWireApi
  baseUrl: string
  help: string
  models: readonly LlmModelProfile[]
}

/** 常用中国站预设；模型 ID 与端点以各官方文档为准，仍可在高级模式覆盖。 */
export const LLM_PROVIDER_PROFILES: readonly LlmProviderProfile[] = [
  {
    id: 'zhipu_cn', label: '智谱中国（Coding Plan）', api: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    help: '套餐 Key 与普通平台 Key 不通用；GLM 通过 OpenAI Chat Completions 接入。',
    models: [
      { id: 'glm-5.2', label: 'GLM-5.2', contextWindow: 200000, reasoning: true, compat: { thinkingFormat: 'zai', supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: 'max_tokens' } },
      { id: 'glm-4.7', label: 'GLM-4.7', contextWindow: 200000, reasoning: true, compat: { thinkingFormat: 'zai', supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: 'max_tokens' } }
    ]
  },
  {
    id: 'volcengine_coding_plan', label: '火山引擎（方舟 Coding Plan）', api: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    help: '这是 Coding Plan 套餐端点，不是按量计费的 /api/v3 端点。',
    models: [
      { id: 'ark-code-latest', label: 'Ark Code Latest', contextWindow: 200000, reasoning: false },
      { id: 'doubao-seed-2.0-code', label: '豆包 Seed 2.0 Code', contextWindow: 200000, reasoning: false },
      { id: 'doubao-seed-2.0-pro', label: '豆包 Seed 2.0 Pro', contextWindow: 200000, reasoning: false },
      { id: 'glm-4.7', label: 'GLM-4.7', contextWindow: 200000, reasoning: false },
      { id: 'deepseek-v3.2', label: 'DeepSeek V3.2', contextWindow: 200000, reasoning: false },
      { id: 'kimi-k2.5', label: 'Kimi K2.5', contextWindow: 200000, reasoning: false }
    ]
  },
  {
    id: 'deepseek_cn', label: 'DeepSeek 官方', api: 'openai', baseUrl: 'https://api.deepseek.com',
    help: 'V4 支持 thinking 开关；低/中映射为 high，xhigh 映射为 max。',
    models: [
      { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', contextWindow: 1000000, reasoning: true, thinkingLevelMap: { minimal: null, low: 'high', medium: 'high', high: 'high', xhigh: 'max' }, compat: { thinkingFormat: 'deepseek', supportsDeveloperRole: false, maxTokensField: 'max_tokens', requiresReasoningContentOnAssistantMessages: true } },
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', contextWindow: 1000000, reasoning: true, thinkingLevelMap: { minimal: null, low: 'high', medium: 'high', high: 'high', xhigh: 'max' }, compat: { thinkingFormat: 'deepseek', supportsDeveloperRole: false, maxTokensField: 'max_tokens', requiresReasoningContentOnAssistantMessages: true } }
    ]
  },
  {
    id: 'siliconflow_cn', label: '硅基流动', api: 'openai', baseUrl: 'https://api.siliconflow.cn/v1',
    help: '模型间差异很大；仅已验证的 Qwen3.5 档案会发送 enable_thinking。',
    models: [
      { id: 'Qwen/Qwen3.5-9B', label: 'Qwen3.5-9B', contextWindow: 200000, reasoning: true, thinkingLevelMap: { minimal: null, low: 'on', medium: null, high: null, xhigh: null }, compat: { thinkingFormat: 'qwen', supportsDeveloperRole: false, supportsReasoningEffort: false } }
    ]
  },
  {
    id: 'mimo_cn', label: '小米 MiMo', api: 'anthropic', baseUrl: 'https://api.xiaomimimo.com/anthropic',
    help: '使用 Anthropic Messages 兼容端点。',
    models: [{ id: 'mimo-v2.5', label: 'MiMo V2.5', contextWindow: 262144, reasoning: true }]
  },
  {
    id: 'minimax_cn', label: 'MiniMax 中国（Token Plan）', api: 'anthropic', baseUrl: 'https://api.minimaxi.com/anthropic',
    help: '使用 Token Plan 专属 Key；Anthropic 兼容端点支持缓存与思考块。',
    models: [{ id: 'MiniMax-M2.7', label: 'MiniMax M2.7', contextWindow: 200000, reasoning: true }]
  },
  {
    id: 'kimi_cn', label: 'Kimi（月之暗面）', api: 'openai', baseUrl: 'https://api.moonshot.cn/v1',
    help: '使用 Moonshot 中国站 OpenAI 兼容端点。',
    models: [{ id: 'kimi-k2.5', label: 'Kimi K2.5', contextWindow: 262144, reasoning: false }]
  },
  {
    id: 'openrouter', label: 'OpenRouter', api: 'openai', baseUrl: 'https://openrouter.ai/api/v1',
    help: '统一 OpenAI 兼容端点；下列是常用开发模型。目录变化快，未列模型请用「自定义模型 ID」。已列模型按 OpenRouter reasoning 格式发送思考请求。',
    models: [
      // Qwen：每个大版本各保留快/均衡/旗舰代表；避免把同系列所有尺寸塞进默认下拉框。
      { id: 'qwen/qwen3.5-9b', label: 'Qwen3.5-9B', contextWindow: 262144, reasoning: true, compat: { thinkingFormat: 'openrouter', supportsDeveloperRole: false } },
      { id: 'qwen/qwen3.5-35b-a3b', label: 'Qwen3.5-35B-A3B', contextWindow: 262144, reasoning: true, compat: { thinkingFormat: 'openrouter', supportsDeveloperRole: false } },
      { id: 'qwen/qwen3.5-plus-20260420', label: 'Qwen3.5 Plus', contextWindow: 1000000, reasoning: true, compat: { thinkingFormat: 'openrouter', supportsDeveloperRole: false } },
      { id: 'qwen/qwen3.6-flash', label: 'Qwen3.6 Flash', contextWindow: 1000000, reasoning: true, compat: { thinkingFormat: 'openrouter', supportsDeveloperRole: false } },
      { id: 'qwen/qwen3.6-plus', label: 'Qwen3.6 Plus', contextWindow: 1000000, reasoning: true, compat: { thinkingFormat: 'openrouter', supportsDeveloperRole: false } },
      { id: 'qwen/qwen3.7-flash', label: 'Qwen3.7 Flash', contextWindow: 1000000, reasoning: true, compat: { thinkingFormat: 'openrouter', supportsDeveloperRole: false } },
      { id: 'qwen/qwen3.7-plus', label: 'Qwen3.7 Plus', contextWindow: 1000000, reasoning: true, compat: { thinkingFormat: 'openrouter', supportsDeveloperRole: false } },
      { id: 'qwen/qwen3.8-27b', label: 'Qwen3.8-27B', contextWindow: 1000000, reasoning: true, compat: { thinkingFormat: 'openrouter', supportsDeveloperRole: false } },
      { id: 'qwen/qwen3.8-max', label: 'Qwen3.8 Max', contextWindow: 1000000, reasoning: true, compat: { thinkingFormat: 'openrouter', supportsDeveloperRole: false } },

      // 用户指定的国内主力模型。
      { id: 'moonshotai/kimi-k2.7-code', label: 'Kimi K2.7 Code', contextWindow: 262144, reasoning: true, compat: { thinkingFormat: 'openrouter', supportsDeveloperRole: false } },
      { id: 'moonshotai/kimi-k3', label: 'Kimi K3', contextWindow: 1048576, reasoning: true, compat: { thinkingFormat: 'openrouter', supportsDeveloperRole: false } },
      { id: 'z-ai/glm-4.7', label: 'GLM-4.7', contextWindow: 204800, reasoning: true, compat: { thinkingFormat: 'openrouter', supportsDeveloperRole: false } },
      { id: 'z-ai/glm-5.3', label: 'GLM-5.3', contextWindow: 1048576, reasoning: true, compat: { thinkingFormat: 'openrouter', supportsDeveloperRole: false } },
      { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash', contextWindow: 1048576, reasoning: true, thinkingLevelMap: { minimal: null, low: null, medium: null, high: 'high', xhigh: 'xhigh' }, compat: { thinkingFormat: 'openrouter', supportsDeveloperRole: false, requiresReasoningContentOnAssistantMessages: true } },
      { id: 'deepseek/deepseek-v4-pro', label: 'DeepSeek V4 Pro', contextWindow: 1048576, reasoning: true, thinkingLevelMap: { minimal: null, low: null, medium: null, high: 'high', xhigh: 'xhigh' }, compat: { thinkingFormat: 'openrouter', supportsDeveloperRole: false, requiresReasoningContentOnAssistantMessages: true } },
      { id: 'minimax/minimax-m2.7', label: 'MiniMax M2.7', contextWindow: 204800, reasoning: true, compat: { thinkingFormat: 'openrouter', supportsDeveloperRole: false } },
      { id: 'minimax/minimax-m3', label: 'MiniMax M3', contextWindow: 1048576, reasoning: true, compat: { thinkingFormat: 'openrouter', supportsDeveloperRole: false } },
      { id: 'tencent/hy3', label: '腾讯 HY3', contextWindow: 262144, reasoning: true, compat: { thinkingFormat: 'openrouter', supportsDeveloperRole: false } },
      { id: 'openai/gpt-5.6-luna', label: 'GPT-5.6 Luna', contextWindow: 1050000, reasoning: true, thinkingLevelMap: { xhigh: 'xhigh' }, compat: { thinkingFormat: 'openrouter' } },
      { id: 'google/gemini-3.7-flash', label: 'Gemini 3.7 Flash', contextWindow: 1048576, reasoning: true, compat: { thinkingFormat: 'openrouter', supportsDeveloperRole: false } },

      // 考察后保留的开发向补充：代码、速度/成本与长上下文各有一个可选项。
      { id: 'qwen/qwen3-coder-next', label: 'Qwen3 Coder Next', contextWindow: 262144, reasoning: false, compat: { thinkingFormat: 'openrouter', supportsDeveloperRole: false } },
      { id: 'bytedance-seed/seed-2.0-code', label: '豆包 Seed 2.0 Code', contextWindow: 262144, reasoning: true, compat: { thinkingFormat: 'openrouter', supportsDeveloperRole: false } },
      { id: 'xiaomi/mimo-v2.5', label: 'MiMo V2.5', contextWindow: 1048576, reasoning: true, compat: { thinkingFormat: 'openrouter', supportsDeveloperRole: false } },
      { id: 'xiaomi/mimo-v2.5-pro', label: 'MiMo V2.5 Pro', contextWindow: 1048576, reasoning: true, compat: { thinkingFormat: 'openrouter', supportsDeveloperRole: false } },
      { id: 'deepseek/deepseek-v3.2', label: 'DeepSeek V3.2', contextWindow: 163840, reasoning: true, compat: { thinkingFormat: 'openrouter', supportsDeveloperRole: false } },
      { id: 'z-ai/glm-4.7-flash', label: 'GLM-4.7 Flash', contextWindow: 202752, reasoning: true, compat: { thinkingFormat: 'openrouter', supportsDeveloperRole: false } }
    ]
  }
] as const

export function getLlmProviderProfile(id: LlmPresetId): LlmProviderProfile | undefined {
  return LLM_PROVIDER_PROFILES.find((item) => item.id === id)
}

export function getLlmModelProfile(id: LlmPresetId, modelId: string): LlmModelProfile | undefined {
  return getLlmProviderProfile(id)?.models.find((item) => item.id === modelId)
}

/** 旧版本只保存 URL / 模型；能识别的配置自动迁移到相应预设，其余保留高级自定义。 */
export function inferLlmPreset(baseUrl: string): LlmPresetId {
  const normalized = baseUrl.replace(/\/+$/, '')
  return LLM_PROVIDER_PROFILES.find((item) => item.baseUrl.replace(/\/+$/, '') === normalized)?.id ?? 'custom'
}
