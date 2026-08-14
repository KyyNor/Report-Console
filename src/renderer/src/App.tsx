import React, { useState } from 'react'
import { Layout, Menu, Typography, Tag } from 'antd'
import {
  DashboardOutlined, ApiOutlined, DatabaseOutlined, CodeOutlined,
  RobotOutlined, SettingOutlined
} from '@ant-design/icons'
import DashboardView from './views/DashboardView'
import DatasetsView from './views/DatasetsView'
import ProceduresView from './views/ProceduresView'
import PagesView from './views/PagesView'
import AgentView from './views/AgentView'
import SettingsView from './views/SettingsView'

const { Sider, Header, Content } = Layout

type ViewKey = 'dashboard' | 'datasets' | 'procedures' | 'pages' | 'agent' | 'settings'

const ITEMS: Array<{ key: ViewKey; icon: React.ReactNode; label: string }> = [
  { key: 'dashboard', icon: <DashboardOutlined />, label: '总览' },
  { key: 'datasets', icon: <ApiOutlined />, label: '数据接口' },
  { key: 'procedures', icon: <DatabaseOutlined />, label: '存储过程' },
  { key: 'pages', icon: <CodeOutlined />, label: '页面' },
  { key: 'agent', icon: <RobotOutlined />, label: 'Agent' },
  { key: 'settings', icon: <SettingOutlined />, label: '设置' }
]

export default function App() {
  const [view, setView] = useState<ViewKey>('dashboard')

  return (
    <Layout style={{ height: '100vh' }}>
      <Sider width={190} theme="light" style={{ borderRight: '1px solid #f0f0f0' }}>
        <div style={{ padding: '18px 16px 10px' }}>
          <Typography.Text strong style={{ fontSize: 16 }}>FR Console</Typography.Text>
          <div style={{ marginTop: 2 }}>
            <Tag color="blue" style={{ fontSize: 11 }}>帆软加壳开发控制台</Tag>
          </div>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[view]}
          onClick={({ key }) => setView(key as ViewKey)}
          items={ITEMS}
          style={{ borderInlineEnd: 'none' }}
        />
      </Sider>
      <Layout>
        <Content style={{ overflow: 'auto', background: '#f5f6f8' }}>
          {view === 'dashboard' && <DashboardView onNavigate={(v) => setView(v as ViewKey)} />}
          {view === 'datasets' && <DatasetsView />}
          {view === 'procedures' && <ProceduresView />}
          {view === 'pages' && <PagesView />}
          {view === 'agent' && <AgentView />}
          {view === 'settings' && <SettingsView />}
        </Content>
      </Layout>
    </Layout>
  )
}
