import React, { useEffect, useState } from 'react'
import { Card, Col, Row, Statistic, Typography, Button, Space, Tag, Table, Descriptions, Alert } from 'antd'
import {
  ApiOutlined, DatabaseOutlined, CodeOutlined, CheckCircleFilled,
  CloseCircleFilled, RobotOutlined, ReloadOutlined
} from '@ant-design/icons'
import { call } from '../api'
import type { StatusPayload } from '@shared/types'

export default function DashboardView({ onNavigate }: { onNavigate: (v: string) => void }) {
  const [status, setStatus] = useState<StatusPayload | null>(null)
  const [builds, setBuilds] = useState<Array<Record<string, unknown>>>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const refresh = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [s, b] = await Promise.all([
        call<StatusPayload>('status:get'),
        call<Array<Record<string, unknown>>>('history:builds', { limit: 8 })
      ])
      setStatus(s)
      setBuilds(b)
    } catch (e) {
      setLoadError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  return (
    <div style={{ padding: 20 }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>总览</Typography.Title>

      {loadError && (
        <Alert
          type="error" showIcon closable style={{ marginBottom: 12 }}
          message="状态加载失败"
          description={loadError}
          action={<Button size="small" onClick={refresh}>重试</Button>}
        />
      )}

      <Row gutter={[12, 12]}>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="帆软服务"
              value={status ? (status.frReachable ? '在线' : '不可达') : '…'}
              prefix={status?.frReachable ? <CheckCircleFilled style={{ color: '#52c41a' }} /> : <CloseCircleFilled style={{ color: '#ff4d4f' }} />}
              suffix={status?.frReachable && status.frLatencyMs !== undefined ? ` (${status.frLatencyMs}ms)` : ''}
              valueStyle={{ fontSize: 18 }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title={`MySQL ${status?.mysqlVersion ? status.mysqlVersion.split('-')[0] : ''}`}
              value={status ? (status.mysqlReachable ? '在线' : '不可达') : '…'}
              prefix={status?.mysqlReachable ? <CheckCircleFilled style={{ color: '#52c41a' }} /> : <CloseCircleFilled style={{ color: '#ff4d4f' }} />}
              valueStyle={{ fontSize: 18 }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="reportlets 可写"
              value={status ? (status.reportletsWritable ? '正常' : '不可写') : '…'}
              prefix={status?.reportletsWritable ? <CheckCircleFilled style={{ color: '#52c41a' }} /> : <CloseCircleFilled style={{ color: '#faad14' }} />}
              valueStyle={{ fontSize: 18 }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ height: '100%' }}>
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>资产规模</Typography.Text>
              <Space size={6} wrap>
                <Tag icon={<ApiOutlined />} color="blue">{status?.counts.modules ?? 0} 模块</Tag>
                <Tag icon={<ApiOutlined />} color="geekblue">{status?.counts.datasets ?? 0} 接口</Tag>
                <Tag icon={<CodeOutlined />} color="purple">{status?.counts.pages ?? 0} 页面</Tag>
                <Tag icon={<DatabaseOutlined />} color="cyan">{status?.counts.procedures ?? 0} 过程</Tag>
              </Space>
            </Space>
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col span={14}>
          <Card size="small" title="最近构建" extra={<Button size="small" icon={<ReloadOutlined />} onClick={refresh} loading={loading}>刷新</Button>}>
            <Table
              size="small" pagination={false}
              dataSource={builds} rowKey="id"
              columns={[
                { title: '类型', dataIndex: 'kind', width: 60, render: (v) => <Tag color={v === 'data' ? 'blue' : 'purple'}>{v}</Tag> },
                { title: '目标', dataIndex: 'target' },
                { title: '结果', dataIndex: 'ok', width: 70, render: (v) => v ? <Tag color="success">成功</Tag> : <Tag color="error">失败</Tag> },
                { title: '时间', dataIndex: 'created_at', width: 150 }
              ]}
            />
          </Card>
        </Col>
        <Col span={10}>
          <Card size="small" title="环境">
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="业务库">{status?.database ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="reportlets"><Typography.Text copyable style={{ fontSize: 12 }}>{status?.reportletsPath ?? '-'}</Typography.Text></Descriptions.Item>
            </Descriptions>
            <Space style={{ marginTop: 12 }} wrap>
              <Button type="primary" icon={<ApiOutlined />} onClick={() => onNavigate('datasets')}>管理接口</Button>
              <Button icon={<CodeOutlined />} onClick={() => onNavigate('pages')}>管理页面</Button>
              <Button icon={<RobotOutlined />} onClick={() => onNavigate('agent')}>唤起 Agent</Button>
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  )
}
