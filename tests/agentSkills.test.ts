import { describe, expect, it } from 'vitest'
import { listBuiltinSkills, readBuiltinSkill } from '@main/agent/skills'
import { buildSystemPrompt, promptScenarios } from '@shared/agentPrompt'

describe('内置 Agent Skill', () => {
  it('按名字返回页面联动规范', () => {
    const skill = readBuiltinSkill('page_interaction')
    expect(skill).toMatchObject({ name: 'page_interaction' })
    expect(skill.content).toContain('fr_form_saved')
    expect(skill.content).toContain('window.location.origin')
  })

  it('文件传输 Skill 不会把 meta 导入误说成业务上传', () => {
    const skill = readBuiltinSkill('file_transfer')
    expect(skill.content).toContain('不是业务页面的上传能力')
    expect(skill.content).toContain('不要猜测')
  })

  it('移动端 Skill 与需求规划 Skill 可按需查看', () => {
    expect(readBuiltinSkill('mobile_display').content).toContain('antdMobile')
    expect(readBuiltinSkill('mobile_qa').content).toContain('移动 SPA')
    expect(readBuiltinSkill('requirements_planning').content).toContain('不得调用写入')
    expect(listBuiltinSkills().map((item) => item.name)).toContain('mobile_display')
  })

  it('系统提示按端型与模式隔离，讨论模式明确只读', () => {
    const mobile = buildSystemPrompt('demo', 'mobile', 'development')
    expect(mobile).toContain('当前项目固定为：demo')
    expect(mobile).toContain('antdMobile')
    expect(mobile).not.toContain('当前模式：讨论需求（只读）')

    const discussion = buildSystemPrompt('demo', 'desktop', 'discussion')
    expect(discussion).toContain('当前模式：讨论需求（只读）')
    expect(discussion).toContain('最终答复只能给出开发计划')
    expect(promptScenarios()).toHaveLength(6)
  })

  it('云平台接口 Skill 强调 prjId 由用户提供且不与只读通道混用', () => {
    const skill = readBuiltinSkill('cloud_api')
    expect(skill.content).toContain('myFR.callCloud')
    expect(skill.content).toContain('prjId')
    expect(skill.content).toContain('不要猜测')
    expect(skill.content).toContain('/api/data')
    expect(listBuiltinSkills().map((item) => item.name)).toContain('cloud_api')
  })
})
