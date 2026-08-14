import React, { useEffect, useState } from 'react'
import { Card, Table, Button, Space, Tag, Drawer, Typography, App as AntApp, Select, Popconfirm, Descriptions, Modal } from 'antd'
import { ReloadOutlined, SaveOutlined, ExperimentOutlined } from '@ant-design/icons'
import { call } from '../api'
import type { ProcedureMeta } from '@shared/types'
import { SqlEditor, JsonView } from '../components/CodeEditor'

export default function ProceduresView() {
  const { message, modal } = AntApp.useApp()
  const [databases, setDatabases] = useState<string[]>([])
  const [database, setDatabase] = useState<string | undefined>(undefined)
  const [rows, setRows] = useState<ProcedureMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<{ name: string; def: string } | null>(null)
  const [defText, setDefText] = useState('')
  const [testOpen, setTestOpen] = useState(false)
  const [testCall, setTestCall] = useState('')
  const [testResult, setTestResult] = useState<{ loading: boolean; body?: unknown }>({ loading: false })

  const refresh = async (db?: string) => {
    setLoading(true)
    try {
      setRows(await call<ProcedureMeta[]>('proc:list', { database: db }))
    } catch (e) {
      message.error((e as Error).message)
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const dbs = await call<string[]>('sql:databases')
        setDatabases(dbs)
        setDatabase(undefined)
        await refresh()
      } catch (e) {
        message.error((e as Error).message)
      }
    })()
  }, [])

  const openEdit = async (p: ProcedureMeta) => {
    try {
      const def = await call<string>('proc:get', { name: p.name, database: p.database })
      setEditing({ name: p.name, def })
      setDefText(def)
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const apply = async () => {
    const r = await call<{ ok: boolean; error?: string }>('proc:apply', { name: editing?.name, definition: defText, database })
    if (r.ok) {
      message.success(`过程 ${editing?.name} 已应用（DROP+CREATE）`)
      setEditing(null)
      void refresh(database)
    } else {
      modal.error({ title: '应用失败', content: r.error })
    }
  }

  const runCall = async () => {
    setTestResult({ loading: true })
    try {
      const r = await call<{ ok: boolean; error?: string; result?: unknown }>('sql:exec', { sql: testCall, kind: 'call', purpose: `UI 手动执行 ${editing?.name}` })
      setTestResult({ loading: false, body: r.ok ? r.result : { error: r.error } })
    } catch (e) {
      setTestResult({ loading: false, body: { error: (e as Error).message } })
    }
  }

  const newProcedure = () => {
    const tpl = `CREATE PROCEDURE sp_xxx(
  IN p_id INT
)
BEGIN
  -- 写入类过程必须返回 JSON
  SELECT JSON_OBJECT('success', TRUE, 'message', 'ok', 'id', p_id) AS result;
END`
    setEditing({ name: 'sp_new', def: tpl })
    setDefText(tpl)
  }

  return (
    <div style={{ padding: 20 }}>
      <Space style={{ marginBottom: 12 }}>
        <Select
          style={{ width: 220 }} placeholder="数据库（默认设置库）" allowClear
          value={database}
          onChange={(v) => { setDatabase(v); void refresh(v) }}
          options={databases.map((d) => ({ value: d, label: d }))}
        />
        <Button icon={<ReloadOutlined />} onClick={() => refresh(database)}>刷新</Button>
        <Button type="primary" onClick={newProcedure}>新建过程</Button>
      </Space>

      <Card size="small">
        <Table
          size="small" loading={loading} rowKey="name" pagination={false}
          dataSource={rows}
          columns={[
            { title: '过程名', dataIndex: 'name', render: (v) => <Typography.Text code>{v}</Typography.Text> },
            { title: '注释', dataIndex: 'comment', ellipsis: true, render: (v) => v || '-' },
            { title: '最后修改', dataIndex: 'altered', width: 170, render: (v: string) => v?.replace('T', ' ').slice(0, 19) },
            {
              title: '操作', width: 150, render: (_v, r: ProcedureMeta) => (
                <Space size={4}>
                  <Button size="small" onClick={() => openEdit(r)}>查看/编辑</Button>
                  <Popconfirm title="DROP 并重建该过程？" onConfirm={async () => {
                    const def = await call<string>('proc:get', { name: r.name, database: r.database })
                    const rr = await call<{ ok: boolean; error?: string }>('proc:apply', { name: r.name, definition: def, database: r.database })
                    rr.ok ? message.success('已重新应用') : message.error(rr.error || '失败')
                  }}>
                    <Button size="small">重应用</Button>
                  </Popconfirm>
                </Space>
              )
            }
          ]}
        />
      </Card>

      <Drawer
        title={editing ? `存储过程 — ${editing.name}` : ''}
        width={760} open={!!editing} onClose={() => setEditing(null)}
        extra={
          <Space>
            <Button onClick={() => setEditing(null)}>取消</Button>
            <Button icon={<SaveOutlined />} type="primary" onClick={apply}>应用（DROP+CREATE）</Button>
          </Space>
        }
      >
        <div style={{ border: '1px solid #d9d9d9', borderRadius: 6, overflow: 'hidden' }}>
          <SqlEditor value={defText} onChange={setDefText} height="440px" />
        </div>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
          「应用」= DROP PROCEDURE IF EXISTS + CREATE，操作已审计落库。写入类过程约定返回 <Typography.Text code>SELECT JSON_OBJECT(...)</Typography.Text>。
        </Typography.Paragraph>
        <Button icon={<ExperimentOutlined />} onClick={() => { setTestCall(`CALL ${editing?.name}();`); setTestResult({ loading: false }); setTestOpen(true) }}>试执行 CALL</Button>
      </Drawer>

      <Modal title={`CALL ${editing?.name}`} open={testOpen} onCancel={() => setTestOpen(false)} footer={null} width={620}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>调用语句（CALL，会真实执行写操作）</Typography.Text>
        <div style={{ border: '1px solid #d9d9d9', borderRadius: 6, overflow: 'hidden', margin: '6px 0' }}>
          <SqlEditor value={testCall} onChange={setTestCall} height="100px" />
        </div>
        <Button type="primary" danger loading={testResult.loading} onClick={runCall}>执行</Button>
        {testResult.body !== undefined && <div style={{ marginTop: 12 }}><JsonView data={testResult.body} /></div>}
      </Modal>
    </div>
  )
}
