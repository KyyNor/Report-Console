import React, { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { useToast } from '../components/ui'
import { call } from '../api'
import type { AppSettings } from '@shared/types'
import { getLlmModelProfile, getLlmProviderProfile, LLM_PROVIDER_PROFILES, type LlmPresetId } from '@shared/llmProfiles'

export default function SettingsView({ onSaved }: { onSaved?: () => void }): React.ReactElement {
  const toast = useToast()
  const [form, setForm] = useState<AppSettings | null>(null)
  const [version, setVersion] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void (async () => {
      try { setForm(await call<AppSettings>('config:get')) } catch (e) { toast((e as Error).message, 'err') }
      try { setVersion(await call<string>('app:version')) } catch { /* 版本展示可缺省 */ }
    })()
  }, [])

  const set = (k: Exclude<keyof AppSettings, 'llmThinkingEnabled' | 'llmAdvancedMode' | 'llmContextWindow' | 'mailSmtpTls' | 'mailSmtpPort' | 'mailChunkMiB'>, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f))
  const setCtx = (v: string) => setForm((f) => (f ? { ...f, llmContextWindow: Number(v.replace(/\D/g, '')) || 0 } : f))
  const setThinkingEnabled = (v: boolean) => setForm((f) => (f ? { ...f, llmThinkingEnabled: v } : f))
  const setAdvancedMode = (v: boolean) => setForm((f) => (f ? { ...f, llmAdvancedMode: v } : f))
  const setMailTls = (v: boolean) => setForm((f) => (f ? { ...f, mailSmtpTls: v } : f))
  const setMailPort = (v: string) => setForm((f) => (f ? { ...f, mailSmtpPort: Number(v.replace(/\D/g, '')) || 0 } : f))
  const setMailChunk = (v: string) => setForm((f) => (f ? { ...f, mailChunkMiB: Number(v.replace(/\D/g, '')) || 0 } : f))
  const [testing, setTesting] = useState(false)
  const [checking, setChecking] = useState(false)
  const checkUpdate = async () => {
    setChecking(true)
    try {
      const r = await call<{ hasUpdate: boolean; current: string; latest: string }>('update:check')
      // 有更新时主进程已弹原生对话框（更新内容/去下载/忽略此版本），这里只提示无更新的情况
      if (!r.hasUpdate) toast(`已是最新版本（v${r.current}）`, 'ok')
    } catch (e) {
      toast(`检查更新失败：${(e as Error).message}`, 'err')
    } finally {
      setChecking(false)
    }
  }
  const testMail = async () => {
    if (!form) return
    setTesting(true)
    try {
      await call('mail:test', { host: form.mailSmtpHost, port: form.mailSmtpPort, tls: form.mailSmtpTls, from: form.mailFrom, password: form.mailPassword })
      toast('SMTP 连接与认证通过', 'ok')
    } catch (e) {
      toast((e as Error).message, 'err')
    } finally {
      setTesting(false)
    }
  }

  const save = async () => {
    if (!form) return
    if (!form.frServerUrl.trim()) { toast('帆软服务地址不能为空', 'err'); return }
    if (!form.reportletsPath.trim()) { toast('reportlets 目录不能为空', 'err'); return }
    if (!Number.isInteger(form.llmContextWindow) || form.llmContextWindow < 4096) { toast('上下文窗口需为不小于 4096 的整数（token）', 'err'); return }
    setSaving(true)
    try {
      await call('config:save', form)
      toast('已保存', 'ok')
      onSaved?.()
    } catch (e) {
      toast((e as Error).message, 'err')
    } finally {
      setSaving(false)
    }
  }

  if (!form) return <div className="page"><div className="page-body"><div className="nores">加载中…</div></div></div>

  const preset = getLlmProviderProfile(form.llmPreset)
  const modelProfile = getLlmModelProfile(form.llmPreset, form.llmModel)
  const modelIsCustom = Boolean(preset && !modelProfile)
  const selectPreset = (id: LlmPresetId) => {
    if (id === 'custom') {
      setForm((f) => (f ? { ...f, llmPreset: id, llmAdvancedMode: true } : f))
      return
    }
    const next = getLlmProviderProfile(id)
    if (!next) return
    const initial = next.models[0]
    setForm((f) => (f ? {
      ...f,
      llmPreset: id,
      llmProvider: next.api,
      llmBaseUrl: next.baseUrl,
      llmModel: initial.id,
      llmContextWindow: initial.contextWindow,
      llmThinkingEnabled: Boolean(initial.reasoning),
      llmThinkingLevel: 'low'
    } : f))
  }
  const selectModel = (id: string) => {
    if (id === '__custom__') {
      setForm((f) => (f ? { ...f, llmModel: '' } : f))
      return
    }
    const next = getLlmModelProfile(form.llmPreset, id)
    setForm((f) => (f ? {
      ...f,
      llmModel: id,
      llmContextWindow: next?.contextWindow ?? f.llmContextWindow,
      llmThinkingEnabled: Boolean(next?.reasoning)
    } : f))
  }

  return (
    <div className="page">
      <div className="page-head">
        <b>设置</b>
        <span className="sub">帆软环境 · Agent 模型 · 打包邮件发送（MySQL 连接在「连接」页管理）</span>
        <span className="grow" />
        {version && <span className="fh">当前版本 v{version}</span>}
        <button className="btn" onClick={() => void checkUpdate()} disabled={checking}><Icon n="refresh" />{checking ? '检查中…' : '检查更新'}</button>
        <button className="btn pri" onClick={save} disabled={saving}><Icon n="check" />{saving ? '保存中…' : '保存全部'}</button>
      </div>
      <div className="page-body">
        <div className="settings-grid">
        <div className="pcard-row sg-fr">
          <div className="pcard-h"><Icon n="ext" />帆软环境</div>
          <div style={{ padding: '14px 16px' }}>
            <div className="fld">
              <label>帆软服务地址</label>
              <input type="text" value={form.frServerUrl} spellCheck={false} onChange={(e) => set('frServerUrl', e.target.value)} />
              <div className="fh">本机设计器默认 http://localhost:8075；数据连接在 FineReport 设计器中配置（名字与「连接」注册表一致）</div>
            </div>
            <div className="fld">
              <label>reportlets 目录（jsx/mjs/cpt 原地产物位置）</label>
              <input type="text" value={form.reportletsPath} spellCheck={false} onChange={(e) => set('reportletsPath', e.target.value)} />
              <div className="fh">如 /Applications/FineReport/webapps/webroot/WEB-INF/reportlets；项目 = 该目录下的子目录</div>
            </div>
          </div>
        </div>

        <div className="pcard-row sg-agent">
          <div className="pcard-h"><Icon n="ai" />Agent 模型（国内服务预设 / 高级自定义）</div>
          <div style={{ padding: '14px 16px' }}>
            <div className="fld">
              <label>服务商</label>
              <select value={form.llmPreset} onChange={(e) => selectPreset(e.target.value as LlmPresetId)}>
                {LLM_PROVIDER_PROFILES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                <option value="custom">自定义兼容端点</option>
              </select>
              <div className="fh">选择预设后自动带入正确端点和已验证模型能力；模型专有参数不会扩散到同一服务商的其他模型。</div>
            </div>
            <div className="fld">
              <label>模型</label>
              {preset ? <select value={modelIsCustom ? '__custom__' : form.llmModel} onChange={(e) => selectModel(e.target.value)}>
                {preset.models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                <option value="__custom__">自定义模型 ID…</option>
              </select> : <input type="text" value={form.llmModel} spellCheck={false} placeholder="模型 ID" onChange={(e) => set('llmModel', e.target.value)} />}
              {modelIsCustom && <input style={{ marginTop: 8 }} type="text" value={form.llmModel} spellCheck={false} placeholder="输入服务商实际模型 ID" onChange={(e) => set('llmModel', e.target.value)} />}
              <div className="fh">自定义模型使用保守兼容策略；验证过的模型才会启用厂商专有思考参数。</div>
            </div>
            <div className="fld">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.llmAdvancedMode} onChange={(e) => setAdvancedMode(e.target.checked)} style={{ width: 'auto' }} />
                高级模式（编辑协议、端点与上下文）
              </label>
              <div className="fh">用于私有网关、套餐端点变更或未收录模型；仍不会开放绕过 Agent 工具安全约束的配置。</div>
            </div>
            {form.llmAdvancedMode && <>
              <div className="fld">
                <label>协议</label>
                <select value={form.llmProvider} onChange={(e) => set('llmProvider', e.target.value)}>
                  <option value="openai">OpenAI 兼容（/v1/chat/completions）</option>
                  <option value="anthropic">Anthropic 兼容（/v1/messages）</option>
                </select>
              </div>
              <div className="fld">
                <label>Base URL</label>
                <input type="text" value={form.llmBaseUrl} spellCheck={false} placeholder="https://api.example.com/v1" onChange={(e) => set('llmBaseUrl', e.target.value)} />
                <div className="fh">预设端点可因企业网关/套餐不同而调整；修改后请一并确认模型 ID。</div>
              </div>
              <div className="fld">
                <label>上下文窗口（token）</label>
                <input type="text" inputMode="numeric" value={form.llmContextWindow || ''} spellCheck={false} placeholder="128000" onChange={(e) => setCtx(e.target.value)} />
                <div className="fh">聊天页的占用圆环与「超过 80% 自动压缩」阈值都以它为分母。</div>
              </div>
            </>}
            {modelProfile?.reasoning || (!modelProfile && form.llmAdvancedMode) ? <>
              <div className="fld">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.llmThinkingEnabled} onChange={(e) => setThinkingEnabled(e.target.checked)} style={{ width: 'auto' }} />
                  启用模型思考
                </label>
                <div className="fh">预设模型会按档案发送正确的开关字段；高级自定义模型不会猜测厂商私有参数。</div>
              </div>
              <div className="fld">
                <label>思考级别</label>
                <select value={form.llmThinkingLevel} disabled={!form.llmThinkingEnabled} onChange={(e) => set('llmThinkingLevel', e.target.value)}>
                  <option value="minimal" disabled={modelProfile?.thinkingLevelMap?.minimal === null}>最少</option>
                  <option value="low" disabled={modelProfile?.thinkingLevelMap?.low === null}>低</option>
                  <option value="medium" disabled={modelProfile?.thinkingLevelMap?.medium === null}>中</option>
                  <option value="high" disabled={modelProfile?.thinkingLevelMap?.high === null}>高</option>
                  <option value="xhigh" disabled={modelProfile?.thinkingLevelMap?.xhigh === null}>很高</option>
                </select>
                <div className="fh">只显示/允许模型档案支持的档位；保存后新建 Agent 会话即可应用。</div>
              </div>
            </> : <div className="fh" style={{ marginBottom: 14 }}>当前预设模型未声明可控思考能力，因此不会发送思考专有字段。</div>}
            {preset?.help && <div className="fh" style={{ marginBottom: 14 }}>{preset.help}</div>}
            <div className="fld">
              <label>API Key</label>
              <input type="password" value={form.llmApiKey} autoComplete="new-password" onChange={(e) => set('llmApiKey', e.target.value)} />
              <div className="fh">必填；留空时 Agent 初始化失败（协议 / 地址 / 模型 / 密钥都在本页配置）</div>
            </div>
          </div>
        </div>

        <div className="pcard-row sg-mail">
          <div className="pcard-h"><Icon n="send" />打包邮件发送（独立配置）</div>
          <div style={{ padding: '14px 16px' }}>
            <div className="fld">
              <label>发件邮箱</label>
              <input type="text" value={form.mailFrom} spellCheck={false} placeholder="you@company.com" onChange={(e) => set('mailFrom', e.target.value)} />
            </div>
            <div className="fld">
              <label>密码 / 授权码</label>
              <input type="password" value={form.mailPassword} autoComplete="new-password" onChange={(e) => set('mailPassword', e.target.value)} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px', gap: 10 }}>
              <div className="fld">
                <label>SMTP 服务器</label>
                <input type="text" value={form.mailSmtpHost} spellCheck={false} placeholder="smtp.company.com" onChange={(e) => set('mailSmtpHost', e.target.value)} />
              </div>
              <div className="fld">
                <label>端口</label>
                <input type="text" inputMode="numeric" value={form.mailSmtpPort || ''} spellCheck={false} placeholder="465" onChange={(e) => setMailPort(e.target.value)} />
              </div>
            </div>
            <div className="fld">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.mailSmtpTls} onChange={(e) => setMailTls(e.target.checked)} style={{ width: 'auto' }} />
                隐式 TLS（465 常用）
              </label>
              <div className="fh">关闭时明文连接（25/587），服务器通告 STARTTLS 时自动升级加密</div>
            </div>
            <div className="fld">
              <label>默认收件邮箱</label>
              <input type="text" value={form.mailTo} spellCheck={false} placeholder="内网/公司邮箱" onChange={(e) => set('mailTo', e.target.value)} />
              <div className="fh">工作台「打包」弹窗的预填值，发送时可临时修改</div>
            </div>
            <div className="fld">
              <label>分卷大小（MiB）</label>
              <input type="text" inputMode="numeric" value={form.mailChunkMiB || ''} spellCheck={false} placeholder="30" onChange={(e) => setMailChunk(e.target.value)} />
              <div className="fh">超限才切分</div>
            </div>
            <div className="fld">
              <button className="btn" onClick={() => void testMail()} disabled={testing}><Icon n="play" />{testing ? '测试中…' : '测试连接'}</button>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  )
}
