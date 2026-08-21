import { describe, expect, it } from 'vitest'
import { getLlmModelProfile, getLlmProviderProfile, inferLlmPreset } from '@shared/llmProfiles'

describe('国内模型 Provider 档案', () => {
  it('旧版硅基流动地址能迁移到预设', () => {
    expect(inferLlmPreset('https://api.siliconflow.cn/v1/')).toBe('siliconflow_cn')
    expect(inferLlmPreset('https://gateway.example.test/v1')).toBe('custom')
  })

  it('Qwen3.5 仅在硅基流动预设中启用 Qwen 思考格式，并固定 system role', () => {
    const model = getLlmModelProfile('siliconflow_cn', 'Qwen/Qwen3.5-9B')
    expect(model?.reasoning).toBe(true)
    expect(model?.compat).toMatchObject({
      thinkingFormat: 'qwen',
      supportsDeveloperRole: false,
      supportsReasoningEffort: false
    })
  })

  it('未知模型不取得预设模型的私有兼容参数', () => {
    expect(getLlmModelProfile('siliconflow_cn', 'another-model')).toBeUndefined()
    expect(getLlmProviderProfile('custom')).toBeUndefined()
  })

  it('预设明确携带端点协议，避免从模型 ID 推断 provider', () => {
    expect(getLlmProviderProfile('mimo_cn')).toMatchObject({
      api: 'anthropic',
      baseUrl: 'https://api.xiaomimimo.com/anthropic'
    })
    expect(getLlmProviderProfile('deepseek_cn')?.api).toBe('openai')
    expect(getLlmProviderProfile('openrouter')).toMatchObject({
      api: 'openai',
      baseUrl: 'https://openrouter.ai/api/v1'
    })
  })

  it('OpenRouter 模型逐条使用其 reasoning 兼容格式，不误用硅基流动的 Qwen 参数', () => {
    expect(getLlmModelProfile('openrouter', 'qwen/qwen3.5-9b')).toMatchObject({
      reasoning: true,
      compat: { thinkingFormat: 'openrouter', supportsDeveloperRole: false }
    })
    expect(getLlmModelProfile('openrouter', 'deepseek/deepseek-v4-pro')?.thinkingLevelMap).toMatchObject({
      high: 'high',
      xhigh: 'xhigh',
      low: null
    })
    expect(getLlmModelProfile('openrouter', 'google/gemini-3.7-flash')).toMatchObject({
      contextWindow: 1048576,
      reasoning: true,
      compat: { thinkingFormat: 'openrouter' }
    })
  })
})
