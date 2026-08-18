import { describe, expect, it } from 'vitest'
import { readBuiltinSkill } from '@main/agent/skills'

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
})
