/**
 * 应用内置的 Agent Skill 注册表。
 *
 * Skill 随应用打包，不从项目目录或任意本机路径读取；模型只能经 read_skill
 * 按需取得内容，避免扩大本地文件访问范围，也避免将低频规范常驻于系统提示词。
 */

import pageInteraction from './skills/page_interaction.md?raw'
import fileTransfer from './skills/file_transfer.md?raw'
import tablePatterns from './skills/table_patterns.md?raw'
import mobileDisplay from './skills/mobile_display.md?raw'
import mobileQa from './skills/mobile_qa.md?raw'
import requirementsPlanning from './skills/requirements_planning.md?raw'
import cloudApi from './skills/cloud_api.md?raw'

export type BuiltinSkillName = 'page_interaction' | 'file_transfer' | 'table_patterns' | 'mobile_display' | 'mobile_qa' | 'requirements_planning' | 'cloud_api'

export interface BuiltinSkill {
  name: BuiltinSkillName
  description: string
  content: string
}

const skills: Record<BuiltinSkillName, BuiltinSkill> = {
  page_interaction: {
    name: 'page_interaction',
    description: '页面跳转、同页 Modal、iframe 弹窗、URL 参数与父子页面 postMessage 通信。',
    content: pageInteraction
  },
  file_transfer: {
    name: 'file_transfer',
    description: '业务附件上传、下载与导出边界；当前可用能力与禁止自行猜测的协议。',
    content: fileTransfer
  },
  table_patterns: {
    name: 'table_patterns',
    description: '列表筛选、分页、行操作以及与数据接口契约协作的页面模式。',
    content: tablePatterns
  },
  mobile_display: {
    name: 'mobile_display',
    description: '移动端 React + antd-mobile 页面组件、布局、路由和运行边界。',
    content: mobileDisplay
  },
  mobile_qa: {
    name: 'mobile_qa',
    description: '移动 SPA 生命周期、窄屏触控与移动页面验收检查。',
    content: mobileQa
  },
  requirements_planning: {
    name: 'requirements_planning',
    description: '讨论需求模式下的澄清维度、分层计划结构与验收清单。',
    content: requirementsPlanning
  },
  cloud_api: {
    name: 'cloud_api',
    description: '帆软云平台接口（myFR.callCloud）调用规范；写操作走云端调度 ID，需用户提供 prjId。',
    content: cloudApi
  }
}

export function readBuiltinSkill(name: BuiltinSkillName): BuiltinSkill {
  return skills[name]
}

export function listBuiltinSkills(): BuiltinSkill[] {
  return Object.values(skills)
}
