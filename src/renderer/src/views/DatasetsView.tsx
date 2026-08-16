import React, { useEffect, useMemo, useState } from 'react'
import {
  Card, Table, Button, Space, Tag, Modal, Form, Input, Select, Popconfirm,
  Typography, App as AntApp, Tooltip, Drawer, Descriptions, Empty, Spin
} from 'antd'
import { PlusOutlined, BuildOutlined, PlayCircleOutlined, DeleteOutlined, ReloadOutlined, ExperimentOutlined } from '@ant-design/icons'
import { call } from '../api'
import type { Dataset, DatasetKind, DatasetParam, Module, BuildResult } from '@shared/types'
import { SqlEditor, JsonView } from '../components/CodeEditor'

const KIND_COLOR: Record<string, string> = {
  list: 'blue', stat: 'cyan', detail: 'geekblue', dict: 'purple',
  insert: 'green', update: 'orange', delete: 'red', other: 'default'
}

export default function DatasetsView() {
  const { message, modal } = AntApp.useApp()
  const [modules, setModules] = useState<Array<Module & { datasetCount: number }>>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [loading, setLoading] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Dataset | null>(null)
  const [form] = Form.useForm()
  const [testOpen, setTestOpen] = useState(false)
  const [testing, setTesting] = useState<Dataset | null>(null)
  const [testParams, setTestParams] = useState<Record<string, string>>({})
  const [testResult, setTestResult] = useState<{ loading: boolean; body?: unknown; durationMs?: number }>({ loading: false })
  const [moduleModalOpen, setModuleModalOpen] = useState(false)
  const [moduleForm] = Form.useForm()
  const [databases, setDatabases] = useState<string[]>([])

  const refreshModules = async () => {
    const mods = await call<Array<Module & { datasetCount: number }>>('modules:list')
    setModules(mods)
    if (!current && mods.length > 0) setCurrent(mods[0].name)
  }

  const refreshDatasets = async (mod: string) => {
    setLoading(true)
    try {
      setDatasets(await call<Dataset[]>('datasets:list', { module: mod }))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refreshModules() }, [])
  useEffect(() => { if (current) void refreshDatasets(current) }, [current])

  const openEditor = (ds?: Dataset) => {
    setEditing(ds ?? null)
    form.resetFields()
    if (ds) {
      form.setFieldsValue({ ...ds, params: ds.params })
    }
    setEditorOpen(true)
  }

  const saveDataset = async () => {
    const values = await form.validateFields()
    await call('datasets:save', {
      module: current,
      expectId: editing?.id,
      name: values.name,
      kind: values.kind,
      comment: values.comment || '',
      params: (values.params ?? []).filter((p: DatasetParam) => p.name),
      sql: values.sql
    })
    message.success('契约已保存（构建后生效）')
    setEditorOpen(false)
    void refreshDatasets(current!)
    void refreshModules()
  }

  const buildCpt = async () => {
    const hide = message.loading('构建中…', 0)
    try {
      const r = await call<BuildResult>('build:dataCpt', { module: current })
      if (r.ok) {
        message.success(`已部署 ${r.target}`)
      } else {
        modal.error({
          title: '质量门未通过，CPT 未落盘',
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
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      hide()
    }
  }

  const verifyAll = async () => {
    const key = 'verify'
    message.open({ type: 'loading', content: '逐个实测接口中…', key })
    try {
      const results = await call<Array<{ dataset: string; ok: boolean; errCode: number | null; rowCount: number; durationMs: number }>>('test:all', { module: current })
      const pass = results.filter((r) => r.ok).length
      message.open({
        type: pass === results.length ? 'success' : 'error',
        content: `实测完成：${pass}/${results.length} 通过`,
        key,
        duration: 4
      })
      modal.info({
        title: `接口实测（${pass}/${results.length} 通过）`,
        width: 560,
        content: (
          <Table size="small" pagination={false} dataSource={results} rowKey="dataset"
            columns={[
              { title: '接口', dataIndex: 'dataset' },
              { title: '结果', dataIndex: 'ok', width: 70, render: (v) => v ? <Tag color="success">通过</Tag> : <Tag color="error">失败</Tag> },
              { title: 'err_code', dataIndex: 'errCode', width: 90 },
              { title: '行数', dataIndex: 'rowCount', width: 70 },
              { title: '耗时', dataIndex: 'durationMs', width: 80, render: (v) => `${v}ms` }
            ]} />
        )
      })
    } catch (e) {
      message.open({ type: 'error', content: (e as Error).message, key })
    }
  }

  const runTest = async () => {
    setTestResult({ loading: true })
    try {
      const r = await call<{ ok: boolean; errCode: number | null; durationMs: number; response: unknown }>('test:dataset', {
        module: current, dataset: testing?.name, overrides: testParams
      })
      setTestResult({ loading: false, body: r.response, durationMs: r.durationMs })
    } catch (e) {
      setTestResult({ loading: false, body: { error: (e as Error).message } })
    }
  }

  const openTest = (ds: Dataset) => {
    setTesting(ds)
    const init: Record<string, string> = {}
    for (const p of ds.params) if (p.type !== 'formula') init[p.name] = p.default ?? ''
    setTestParams(init)
    setTestResult({ loading: false })
    setTestOpen(true)
  }

  const createModule = async () => {
    const values = await moduleForm.validateFields()
    await call('modules:create', values)
    message.success('模块已创建')
    setModuleModalOpen(false)
    moduleForm.resetFields()
    void refreshModules()
    setCurrent(values.name)
  }

  return (
    <div style={{ padding: 20 }}>
      <Space style={{ marginBottom: 12 }}>
        <Select
          style={{ width: 220 }}
          placeholder="选择模块"
          value={current}
          onChange={setCurrent}
          options={modules.map((m) => ({ value: m.name, label: `${m.name}（${m.datasetCount} 接口 / ${m.datasource || '未设数据源'}）` }))}
        />
        <Button icon={<ReloadOutlined />} onClick={() => { void refreshModules(); if (current) void refreshDatasets(current) }}>刷新</Button>
        <Button icon={<PlusOutlined />} onClick={() => { moduleForm.resetFields(); setModuleModalOpen(true) }}>新模块</Button>
        <Button icon={<BuildOutlined />} type="primary" disabled={!current} onClick={buildCpt}>构建 _data.cpt</Button>
        <Button icon={<ExperimentOutlined />} disabled={!current || datasets.length === 0} onClick={verifyAll}>全部实测</Button>
      </Space>

      <Card size="small">
        {current ? (
          <Table
            size="small" loading={loading}
            dataSource={datasets} rowKey="id"
            pagination={false}
            columns={[
              { title: '接口名', dataIndex: 'name', render: (v, r: Dataset) => <Space><Typography.Text code>{v}</Typography.Text>{r.comment ? <Typography.Text type="secondary">{r.comment}</Typography.Text> : null}</Space> },
              { title: '类型', dataIndex: 'kind', width: 80, render: (v) => <Tag color={KIND_COLOR[v]}>{v}</Tag> },
              { title: '参数', dataIndex: 'params', render: (v: DatasetParam[]) => v.length === 0 ? '-' : v.map((p) => <Tag key={p.name} style={{ fontSize: 11 }}>{p.name}:{p.type}</Tag>) },
              { title: 'SQL', dataIndex: 'sql', ellipsis: true, render: (v: string) => <Typography.Text code style={{ fontSize: 11 }}>{v.slice(0, 60)}</Typography.Text> },
              {
                title: '操作', width: 200, render: (_v, r: Dataset) => (
                  <Space size={4}>
                    <Tooltip title="实测"><Button size="small" icon={<PlayCircleOutlined />} onClick={() => openTest(r)} /></Tooltip>
                    <Tooltip title="编辑"><Button size="small" onClick={() => openEditor(r)}>编辑</Button></Tooltip>
                    <Popconfirm title={`删除接口 ${r.name}？`} onConfirm={async () => { await call('datasets:delete', { module: current, name: r.name }); void refreshDatasets(current); void refreshModules() }}>
                      <Button size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </Space>
                )
              }
            ]}
            footer={() => <Space><Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => openEditor()}>新增接口</Button><Typography.Text type="secondary" style={{ fontSize: 12 }}>命名建议：{current}_qry / _total / _by_id / dict_x / _insert / _update / _delete</Typography.Text></Space>}
          />
        ) : (
          <Empty description="暂无模块 —— 点击「新模块」或让 Agent 帮你建" />
        )}
      </Card>

      {/* 接口编辑 Drawer */}
      <Drawer
        title={editing ? `编辑接口 — ${editing.name}` : '新增接口'}
        width={720} open={editorOpen} onClose={() => setEditorOpen(false)}
        extra={<Space><Button onClick={() => setEditorOpen(false)}>取消</Button><Button type="primary" onClick={saveDataset}>保存</Button></Space>}
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={{ kind: 'list', params: [] }}>
          <Space.Compact style={{ display: 'flex', gap: 12 }}>
            <Form.Item name="name" label="接口名" rules={[{ required: true, pattern: /^[a-z][a-z0-9_]*$/i, message: '字母开头，仅字母/数字/下划线' }]} style={{ flex: 1 }}>
              <Input placeholder={`${current || 'module'}_qry`} disabled={!!editing} />
            </Form.Item>
            <Form.Item name="kind" label="类型" initialValue="list" style={{ width: 130 }}>
              <Select options={(['list', 'stat', 'detail', 'dict', 'insert', 'update', 'delete', 'other'] as DatasetKind[]).map((k) => ({ value: k, label: k }))} />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="comment" label="说明"><Input placeholder="用途一句话" /></Form.Item>
          <Form.Item label={<span>参数（formula 类型 = 帆软会话注入，如 <Typography.Text code>=$fine_username</Typography.Text>）</span>}>
            <Form.List name="params">
              {(fields, { add, remove }) => (
                <>
                  {fields.map((f) => (
                    <Space key={f.key} style={{ display: 'flex', marginBottom: 4 }} align="baseline">
                      <Form.Item name={[f.name, 'name']} rules={[{ required: true }]} noStyle><Input placeholder="参数名 p_xxx" style={{ width: 160 }} /></Form.Item>
                      <Form.Item name={[f.name, 'type']} initialValue="string" noStyle>
                        <Select style={{ width: 110 }} options={(['string', 'integer', 'double', 'formula'] as const).map((t) => ({ value: t, label: t }))} />
                      </Form.Item>
                      <Form.Item name={[f.name, 'default']} noStyle><Input placeholder="默认值" style={{ width: 140 }} /></Form.Item>
                      <Button type="link" danger size="small" onClick={() => remove(f.name)}>删除</Button>
                    </Space>
                  ))}
                  <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={() => add({ type: 'string' })}>加参数</Button>
                </>
              )}
            </Form.List>
          </Form.Item>
          <Form.Item
            name="sql" label="SQL（帆软公式语法）" rules={[{ required: true }]}
            extra={<span>可选条件：<Typography.Text code style={{ fontSize: 11 }}>{'${if(len(p_x)==0,""," AND col=\'"+p_x+"\'")}'}</Typography.Text>；分页：<Typography.Text code style={{ fontSize: 11 }}>{'LIMIT ${(p_page-1)*p_pagesize}, ${p_pagesize}'}</Typography.Text></span>}
          >
            <SqlEditorContainer />
          </Form.Item>
        </Form>
      </Drawer>

      {/* 实测 Drawer */}
      <Drawer title={`接口实测 — ${testing?.name}`} width={640} open={testOpen} onClose={() => setTestOpen(false)}>
        <Descriptions size="small" column={2} bordered style={{ marginBottom: 12 }}>
          <Descriptions.Item label="report_path" span={2}><Typography.Text code style={{ fontSize: 11 }}>{current}/data/{current}_data.cpt</Typography.Text></Descriptions.Item>
        </Descriptions>
        {(testing?.params ?? []).filter((p) => p.type !== 'formula').length === 0 ? (
          <Typography.Text type="secondary">该接口无请求参数</Typography.Text>
        ) : (
          (testing?.params ?? []).filter((p) => p.type !== 'formula').map((p) => (
            <div key={p.name} style={{ marginBottom: 8 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>{p.name}</Typography.Text>
              <Input value={testParams[p.name] ?? ''} onChange={(e) => setTestParams({ ...testParams, [p.name]: e.target.value })} placeholder={p.default || '留空'} />
            </div>
          ))
        )}
        <Button type="primary" icon={<PlayCircleOutlined />} style={{ marginTop: 8 }} loading={testResult.loading} onClick={runTest}>发送请求</Button>
        <div style={{ marginTop: 16 }}>
          {testResult.loading ? <Spin /> : testResult.body !== undefined ? (
            <>
              {testResult.durationMs !== undefined && <Typography.Text type="secondary" style={{ fontSize: 12 }}>耗时 {testResult.durationMs}ms</Typography.Text>}
              <JsonView data={testResult.body} />
            </>
          ) : null}
        </div>
      </Drawer>

      {/* 新模块 Modal */}
      <Modal title="新建模块" open={moduleModalOpen} onOk={createModule} onCancel={() => setModuleModalOpen(false)} okText="创建">
        <Form form={moduleForm} layout="vertical">
          <Form.Item name="name" label="模块名（reportlets 子目录）" rules={[{ required: true, pattern: /^[a-z][a-z0-9_]*$/, message: '小写字母开头' }]}>
            <Input placeholder="如 frdemo" />
          </Form.Item>
          <Form.Item
            name="datasource" label="帆软数据连接名（数据层 CPT 的 DatabaseName）"
            rules={[{ required: true }]}
            extra="须与帆软平台中已配置的数据连接名一致"
          >
            <Select
              showArrow
              onDropdownVisibleChange={async (open) => { if (open && databases.length === 0) { try { setDatabases(await call<string[]>('sql:databases')) } catch { /* 忽略 */ } } }}
              options={databases.map((d) => ({ value: d, label: d }))}
              placeholder="选择或输入数据连接名（下拉来自 MySQL 库名，供参考）"
            />
          </Form.Item>
          <Form.Item name="comment" label="说明"><Input /></Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

/** Form.Item 值绑定的 SQL 编辑器 */
function SqlEditorContainer({ value, onChange }: { value?: string; onChange?: (v: string) => void }) {
  return <div style={{ border: '1px solid #d9d9d9', borderRadius: 6, overflow: 'hidden' }}>
    <SqlEditor value={value ?? ''} onChange={onChange ?? (() => {})} height="220px" />
  </div>
}
