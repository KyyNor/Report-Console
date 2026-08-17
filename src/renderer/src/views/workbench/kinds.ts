/** 接口类型（DatasetKind）的展示标签与悬浮解释 */
export const KIND_TAG: Record<string, { cls: string; label: string; tip: string }> = {
  list: { cls: 'list', label: '列表', tip: '列表查询：SELECT + 自行分页（p_page/p_pagesize），可带 p_keyword 搜索' },
  stat: { cls: 'stat', label: '统计', tip: '统计汇总：COUNT/SUM 等聚合查询' },
  detail: { cls: 'one', label: '明细', tip: '单条明细：按 id 查单行（{m}_by_id）' },
  dict: { cls: 'dict', label: '字典', tip: '字典下拉：为表单/筛选提供选项（dict_{x}）' },
  insert: { cls: 'ins', label: '新增', tip: '写入类：SQL 为 CALL 存储过程，过程须返回 JSON_OBJECT 结果' },
  update: { cls: 'upd', label: '更新', tip: '写入类：SQL 为 CALL 存储过程，过程须返回 JSON_OBJECT 结果' },
  delete: { cls: 'del', label: '删除', tip: '写入类：SQL 为 CALL 存储过程，过程须返回 JSON_OBJECT 结果' },
  other: { cls: 'other', label: '其他', tip: '未分类接口' }
}
