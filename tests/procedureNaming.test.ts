import { describe, expect, it } from 'vitest'
import { assertProcedureName, checkProcedureCalls, procedureNamePattern } from '@main/procedureNaming'

describe('存储过程命名规范（sp_{项目名}_{功能模块}_{操作}）', () => {
  it('合法：模块按实际设计，操作三种', () => {
    expect(procedureNamePattern('frdemo').test('sp_frdemo_book_insert')).toBe(true)
    expect(procedureNamePattern('order').test('sp_order_item_update')).toBe(true)
    expect(procedureNamePattern('order').test('sp_order_stock_flow_delete')).toBe(true)
  })

  it('非法：缺项目名前缀 / 项目不匹配 / 操作不在三种之内 / 缺功能模块', () => {
    expect(procedureNamePattern('order').test('sp_book_insert')).toBe(false)
    expect(procedureNamePattern('order').test('sp_other_book_insert')).toBe(false)
    expect(procedureNamePattern('order').test('sp_order_book_query')).toBe(false)
    expect(procedureNamePattern('order').test('sp_order_insert')).toBe(false)
    expect(procedureNamePattern('order').test('sp_order_book_Insert')).toBe(false) // 操作区分大小写
  })

  it('assertProcedureName 报错信息带规范与示例', () => {
    expect(() => assertProcedureName('order', 'sp_book_insert')).toThrow(/sp_order_\{功能模块\}_\{操作\}/)
    expect(() => assertProcedureName('order', 'sp_order_book_insert')).not.toThrow()
  })
})

describe('构建检测：CALL 目标命名（质量门 error）', () => {
  const items = (sql: string): Array<{ dataset: string; sql: string }> => [{ dataset: 'book_insert', sql }]

  it('符合规范的 CALL 不产出 finding', () => {
    expect(checkProcedureCalls('order', items("CALL sp_order_book_insert(${p_title})"))).toEqual([])
  })

  it('未登记且不符合规范 → error，提示规范与关联途径', () => {
    const f = checkProcedureCalls('order', items('CALL sp_book_insert(${p_title})'))
    expect(f).toHaveLength(1)
    expect(f[0].severity).toBe('error')
    expect(f[0].rule).toBe('proc-name-unregistered')
    expect(f[0].message).toContain('sp_book_insert')
  })

  it('登记的自建过程按本项目前缀严格校验', () => {
    // 已登记但命名不合规（历史遗留）：即使登记了也拦下
    const f = checkProcedureCalls('order', items('CALL sp_legacy_write(${p_id})'), { sp_legacy_write: 'order' })
    expect(f).toHaveLength(1)
    expect(f[0].rule).toBe('proc-name')
  })

  it('关联过程按归属项目前缀校验：归属方合法即可通过', () => {
    expect(checkProcedureCalls('order', items('CALL sp_stock_item_delete(${p_id})'), { sp_stock_item_delete: 'stock' })).toEqual([])
    // 归属 stock 的过程拿到 order 名下按 order 校验 → 不合规
    const f = checkProcedureCalls('order', items('CALL sp_order_item_delete(${p_id})'), { sp_order_item_delete: 'stock' })
    expect(f).toHaveLength(1)
  })

  it('普通 SELECT 不误伤；一条 SQL 多个 CALL 全部检查', () => {
    expect(checkProcedureCalls('order', items('SELECT * FROM book WHERE id = ${p_id}'))).toEqual([])
    const f = checkProcedureCalls('order', items('CALL sp_order_book_insert(1); CALL sp_bad(2)'))
    expect(f).toHaveLength(1)
    expect(f[0].message).toContain('sp_bad')
  })
})
