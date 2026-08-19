import React, { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { useToast } from '../components/ui'
import { call } from '../api'
import type { AppSettings } from '@shared/types'

export default function SettingsView({ onSaved }: { onSaved?: () => void }): React.ReactElement {
  const toast = useToast()
  const [form, setForm] = useState<AppSettings | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void (async () => {
      try { setForm(await call<AppSettings>('config:get')) } catch (e) { toast((e as Error).message, 'err') }
    })()
  }, [])

  const set = (k: Exclude<keyof AppSettings, 'llmThinkingEnabled' | 'llmContextWindow'>, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f))
  const setCtx = (v: string) => setForm((f) => (f ? { ...f, llmContextWindow: Number(v.replace(/\D/g, '')) || 0 } : f))
  const setThinkingEnabled = (v: boolean) => setForm((f) => (f ? { ...f, llmThinkingEnabled: v } : f))

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

  return (
    <div className="page">
      <div className="page-head">
        <b>设置</b>
        <span className="sub">帆软环境 · Agent 模型（MySQL 连接在「连接」页管理）</span>
      </div>
      <div className="page-body" style={{ maxWidth: 640 }}>
        <div className="pcard-row" style={{ marginBottom: 16 }}>
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

        <div className="pcard-row">
          <div className="pcard-h"><Icon n="ai" />Agent 模型（OpenAI / Anthropic 兼容）</div>
          <div style={{ padding: '14px 16px' }}>
            <div className="fld">
              <label>协议</label>
              <select value={form.llmProvider} onChange={(e) => set('llmProvider', e.target.value)}>
                <option value="openai">OpenAI 兼容（/v1/chat/completions）</option>
                <option value="anthropic">Anthropic 兼容（/v1/messages）</option>
              </select>
            </div>
            <div className="fld">
              <label>Base URL</label>
              <input type="text" value={form.llmBaseUrl} spellCheck={false} placeholder="https://api.openai.com/v1" onChange={(e) => set('llmBaseUrl', e.target.value)} />
              <div className="fh">留空使用官方默认；兼容网关填网关地址</div>
            </div>
            <div className="fld">
              <label>模型</label>
              <input type="text" value={form.llmModel} spellCheck={false} placeholder="gpt-4o-mini / claude-sonnet-4-5 / 自部署模型名" onChange={(e) => set('llmModel', e.target.value)} />
            </div>
            <div className="fld">
              <label>上下文窗口（token）</label>
              <input type="text" inputMode="numeric" value={form.llmContextWindow || ''} spellCheck={false} placeholder="128000" onChange={(e) => setCtx(e.target.value)} />
              <div className="fh">按所用模型实际窗口填写（查模型文档）；聊天页的占用圆环与「超过 80% 自动压缩」阈值都以它为分母。</div>
            </div>
            <div className="fld">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.llmThinkingEnabled} onChange={(e) => setThinkingEnabled(e.target.checked)} style={{ width: 'auto' }} />
                启用模型思考
              </label>
              <div className="fh">关闭时会请求兼容模型返回正常文本；GLM/ZAI 会显式收到关闭思考参数。</div>
            </div>
            <div className="fld">
              <label>思考级别</label>
              <select value={form.llmThinkingLevel} disabled={!form.llmThinkingEnabled} onChange={(e) => set('llmThinkingLevel', e.target.value)}>
                <option value="minimal">最少</option>
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
                <option value="xhigh">很高</option>
              </select>
              <div className="fh">仅在模型/兼容网关支持时生效；保存后新建 Agent 会话即可应用。</div>
            </div>
            <div className="fld">
              <label>API Key</label>
              <input type="password" value={form.llmApiKey} autoComplete="new-password" onChange={(e) => set('llmApiKey', e.target.value)} />
              <div className="fh">必填；留空时 Agent 初始化失败（协议 / 地址 / 模型 / 密钥都在本页配置）</div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn pri" onClick={save} disabled={saving}><Icon n="check" />{saving ? '保存中…' : '保存全部'}</button>
        </div>
      </div>
    </div>
  )
}
