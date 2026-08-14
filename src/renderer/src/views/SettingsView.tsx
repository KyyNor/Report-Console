import React, { useEffect, useState } from 'react'
import { Card, Form, Input, Button, App as AntApp, Typography, Divider, Select, Space } from 'antd'
import { call } from '../api'
import type { AppSettings, StatusPayload } from '@shared/types'

export default function SettingsView() {
  const { message } = AntApp.useApp()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<StatusPayload | null>(null)

  const load = async () => {
    const s = await call<AppSettings>('config:get')
    form.setFieldsValue(s)
  }
  useEffect(() => { void load() }, [])

  const save = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      await call('config:save', values)
      message.success('已保存')
      setStatus(await call<StatusPayload>('status:get'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ padding: 20, maxWidth: 760 }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>设置</Typography.Title>

      <Form form={form} layout="vertical">
        <Card size="small" title="帆软环境">
          <Form.Item name="frServerUrl" label="帆软服务地址" rules={[{ required: true }]}>
            <Input placeholder="http://localhost:8075" />
          </Form.Item>
          <Form.Item
            name="reportletsPath" label="reportlets 目录（jsx/mjs/cpt 原地产物位置）"
            rules={[{ required: true }]}
            extra={status ? (status.reportletsWritable
              ? <Typography.Text type="success" style={{ fontSize: 12 }}>✓ 目录可写</Typography.Text>
              : <Typography.Text type="danger" style={{ fontSize: 12 }}>⚠ 目录不可写或不存在</Typography.Text>) : undefined}
          >
            <Input placeholder="/Applications/FineReport/webapps/webroot/WEB-INF/reportlets" />
          </Form.Item>
        </Card>

        <Card size="small" title="MySQL" style={{ marginTop: 12 }}>
          <Space style={{ display: 'flex' }} size={12}>
            <Form.Item name="mysqlHost" label="主机" style={{ flex: 1 }} rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="mysqlPort" label="端口" style={{ width: 100 }} rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="mysqlDatabase" label="默认库" style={{ width: 160 }}><Input /></Form.Item>
          </Space>
          <Space style={{ display: 'flex' }} size={12}>
            <Form.Item name="mysqlUser" label="用户" style={{ width: 180 }}><Input /></Form.Item>
            <Form.Item name="mysqlPassword" label="密码" style={{ flex: 1 }}><Input.Password autoComplete="new-password" /></Form.Item>
          </Space>
        </Card>

        <Card size="small" title="Agent 模型（OpenAI / Anthropic 兼容）" style={{ marginTop: 12 }}>
          <Form.Item name="llmProvider" label="协议" initialValue="openai">
            <Select style={{ width: 200 }} options={[
              { value: 'openai', label: 'OpenAI 兼容（/v1/chat/completions）' },
              { value: 'anthropic', label: 'Anthropic 兼容（/v1/messages）' }
            ]} />
          </Form.Item>
          <Form.Item name="llmBaseUrl" label="Base URL" extra="留空使用官方默认；兼容网关填网关地址">
            <Input placeholder="https://api.openai.com/v1" />
          </Form.Item>
          <Space style={{ display: 'flex' }} size={12}>
            <Form.Item name="llmModel" label="模型" style={{ flex: 1 }}><Input placeholder="gpt-4o / claude-sonnet-4-5 / 自部署模型名" /></Form.Item>
            <Form.Item name="llmApiKey" label="API Key" style={{ flex: 1 }}><Input.Password autoComplete="new-password" /></Form.Item>
          </Space>
        </Card>

        <Button type="primary" style={{ marginTop: 16 }} loading={saving} onClick={save}>保存全部</Button>
      </Form>
    </div>
  )
}
