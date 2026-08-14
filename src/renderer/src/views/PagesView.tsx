import React, { useEffect, useState } from 'react'
import {
  Card, Table, Button, Space, Tag, Typography, App as AntApp, Modal, Form, Input, Select, Popconfirm
} from 'antd'
import { PlusOutlined, BuildOutlined, ReloadOutlined, ExportOutlined, DeleteOutlined } from '@ant-design/icons'
import { call } from '../api'
import type { PageMeta, BuildResult } from '@shared/types'
import { JsxEditor } from '../components/CodeEditor'

export default function PagesView() {
  const { message, modal } = AntApp.useApp()
  const [pages, setPages] = useState<PageMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<PageMeta | null>(null)
  const [code, setCode] = useState('')
  const [dirty, setDirty] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form] = Form.useForm()

  const refresh = async () => {
    setLoading(true)
    try {
      setPages(await call<PageMeta[]>('pages:list'))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void refresh() }, [])

  const openPage = async (p: PageMeta) => {
    if (dirty) {
      modal.confirm({
        title: '有未保存的修改',
        content: '切换页面将丢弃当前编辑内容，继续？',
        onOk: () => doOpen(p)
      })
      return
    }
    await doOpen(p)
  }

  const doOpen = async (p: PageMeta) => {
    try {
      setCode(await call<string>('pages:read', { module: p.module, page: p.name }))
      setEditing(p)
      setDirty(false)
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const save = async () => {
    if (!editing) return
    await call('pages:save', { module: editing.module, page: editing.name, content: code })
    setDirty(false)
    message.success('jsx 已保存')
    void refresh()
  }

  const build = async (p?: PageMeta) => {
    const target = p ?? editing
    if (!target) return
    if (!p && dirty) await save()
    const hide = message.loading('编译中…', 0)
    try {
      const r = await call<BuildResult>('pages:build', { module: target.module, page: target.name })
      if (r.ok) message.success(`已产出 ${target.name}.mjs + .cpt`)
      else {
        modal.error({
          title: '构建未通过，CPT 未落盘',
          width: 620,
          content: (
            <div>
              {(r.findings || []).map((f, i) => (
                <div key={i} style={{ marginBottom: 4 }}>
                  <Tag color={f.severity === 'error' ? 'red' : 'orange'}>{f.rule}</Tag>
                  <Typography.Text style={{ fontSize: 12 }}>{f.message}</Typography.Text>
                </div>
              ))}
              <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>{r.log.join(' → ')}</Typography.Paragraph>
            </div>
          )
        })
      }
      void refresh()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      hide()
    }
  }

  const openPreview = async (p?: PageMeta) => {
    const target = p ?? editing
    if (!target) return
    if (!p && dirty) await save()
    await call('pages:open', { module: target.module, page: target.name })
    message.success('已在预览窗口打开（帆软 op=write）')
    void refresh()
  }

  const create = async () => {
    const values = await form.validateFields()
    await call('pages:create', values)
    message.success('页面已创建')
    setCreating(false)
    form.resetFields()
    await refresh()
    await doOpen({ module: values.module, name: values.page } as PageMeta)
  }

  return (
    <div style={{ padding: 20 }}>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<ReloadOutlined />} onClick={refresh}>刷新</Button>
        <Button icon={<PlusOutlined />} type="primary" onClick={() => { form.resetFields(); setCreating(true) }}>新页面</Button>
        {editing && (
          <>
            <Button icon={<BuildOutlined />} onClick={() => build()} disabled={!dirty ? false : false}>构建（mjs+cpt）</Button>
            <Button type="primary" icon={<ExportOutlined />} onClick={() => openPreview()}>一键打开</Button>
          </>
        )}
      </Space>

      <div style={{ display: 'flex', gap: 12, height: 'calc(100vh - 130px)' }}>
        <Card size="small" style={{ width: 460, overflow: 'auto' }} title={`页面（${pages.length}）`}>
          <Table
            size="small" loading={loading} pagination={false} rowKey={(r) => `${r.module}/${r.name}`}
            dataSource={pages}
            onRow={(r) => ({ onClick: () => void openPage(r), style: { cursor: 'pointer', background: editing && r.module === editing.module && r.name === editing.name ? '#e6f4ff' : undefined } })}
            columns={[
              {
                title: '模块/页面', render: (_v, r: PageMeta) => (
                  <Space direction="vertical" size={0}>
                    <Typography.Text strong style={{ fontSize: 13 }}>{r.name}</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>{r.module}/pages/</Typography.Text>
                  </Space>
                )
              },
              {
                title: '产物', width: 120, render: (_v, r: PageMeta) => (
                  <Space size={4} wrap>
                    <Tag style={{ fontSize: 10 }}>jsx</Tag>
                    <Tag style={{ fontSize: 10 }} color={r.mjsExists ? 'default' : 'warning'}>mjs{r.mjsExists ? '' : '?'}</Tag>
                    {r.stale
                      ? <Tag style={{ fontSize: 10 }} color="warning">待构建</Tag>
                      : <Tag style={{ fontSize: 10 }} color="success">cpt✓</Tag>}
                  </Space>
                )
              },
              {
                title: '', width: 110, render: (_v, r: PageMeta) => (
                  <Space size={2} onClick={(e) => e.stopPropagation()}>
                    <Button size="small" icon={<BuildOutlined />} title="构建" onClick={() => build(r)} />
                    <Button size="small" type="primary" ghost icon={<ExportOutlined />} title="打开" onClick={() => openPreview(r)} />
                    <Popconfirm title={`删除页面 ${r.name}（jsx/mjs/cpt）？`} onConfirm={async () => { await call('pages:delete', { module: r.module, page: r.name }); void refresh(); if (editing?.name === r.name) setEditing(null) }}>
                      <Button size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </Space>
                )
              }
            ]}
          />
        </Card>

        <Card size="small" style={{ flex: 1, overflow: 'hidden' }} title={editing ? `${editing.module}/pages/${editing.name}.jsx${dirty ? ' •' : ''}` : '选择左侧页面'} extra={editing && <Button size="small" type={dirty ? 'primary' : 'default'} onClick={save} disabled={!dirty}>保存</Button>}>
          {editing ? (
            <div style={{ height: '100%', border: '1px solid #f0f0f0', borderRadius: 6, overflow: 'hidden' }}>
              <JsxEditor value={code} onChange={(v) => { setCode(v); setDirty(true) }} />
            </div>
          ) : (
            <Typography.Text type="secondary">jsx / mjs / cpt 均在 reportlets 对应模块 pages/ 目录原地生成</Typography.Text>
          )}
        </Card>
      </div>

      <Modal title="新建页面" open={creating} onOk={create} onCancel={() => setCreating(false)} okText="创建">
        <Form form={form} layout="vertical">
          <Form.Item name="module" label="模块" rules={[{ required: true, pattern: /^[a-z][a-z0-9_]*$/i, message: '字母开头' }]}>
            <Input placeholder="模块名（reportlets 子目录）" />
          </Form.Item>
          <Form.Item name="page" label="页面名" rules={[{ required: true, pattern: /^[a-z][a-z0-9_]*$/i, message: '字母开头' }]}>
            <Input placeholder="如 book_list" />
          </Form.Item>
          <Form.Item name="starter" label="脚手架" initialValue="list">
            <Select options={[
              { value: 'list', label: 'list — 列表页（搜索+表格+分页）' },
              { value: 'form', label: 'form — 表单弹窗（iframe 子页面）' },
              { value: 'blank', label: 'blank — 空白' }
            ]} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
