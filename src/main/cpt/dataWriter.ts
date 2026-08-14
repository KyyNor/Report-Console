/**
 * 数据层 CPT 生成器 — fr-flow-v3 scripts/data/data_writer.py 的 TypeScript 移植
 *
 * 流程：datasets 契约 → 逐个生成 TableData XML → 替换骨架 TableDataMap → 落盘
 * 输出格式与 python 版结构等价（CDATA 包裹、参数类型映射一致）。
 */

import type { DatasetParam } from '@shared/types'

/** 参数类型 → XML 属性与回退默认值（对齐 param_type_to_xml） */
function paramTypeToXml(paramType: string): { attrs: Record<string, string>; fallback: string } {
  switch (paramType.toLowerCase()) {
    case 'formula':
      return { attrs: { t: 'XMLable', class: 'com.fr.base.Formula' }, fallback: '=$fine_username' }
    case 'integer':
      return { attrs: { t: 'I' }, fallback: '0' }
    case 'double':
      return { attrs: { t: 'D' }, fallback: '0.0' }
    default:
      return { attrs: {}, fallback: '' }
  }
}

/** 生成一个 TableData 的完整 XML（紧凑形式，CDATA 安全） */
export function buildTableDataXml(
  name: string,
  sql: string,
  params: DatasetParam[],
  dbName: string
): string {
  const parts: string[] = []
  parts.push(`<TableData name="${escapeAttr(name)}" class="com.fr.data.impl.DBTableData">`)
  parts.push('<Desensitizations desensitizeOpen="false"/>')

  // Parameters
  parts.push('<Parameters>')
  for (const p of params) {
    const { attrs, fallback } = paramTypeToXml(p.type || 'string')
    let def = p.default ?? ''
    if (!def && fallback) def = fallback

    parts.push('<Parameter>')
    parts.push(`<Attributes name="${escapeAttr(p.name)}"/>`)
    const attrStr = Object.entries(attrs)
      .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
      .join('')
    // formula 类型在 python 版为 <O t="XMLable" ...><![CDATA[默认值]]></O>（无内层 Attributes）
    parts.push(`<O${attrStr}>`)
    parts.push(`<![CDATA[${def}]]></O>`)
    parts.push('</Parameter>')
  }
  parts.push('</Parameters>')

  parts.push('<Attributes maxMemRowCount="-1"/>')

  parts.push('<Connection class="com.fr.data.impl.NameDatabaseConnection">')
  parts.push('<DatabaseName>')
  parts.push(`<![CDATA[${dbName}]]></DatabaseName>`)
  parts.push('</Connection>')

  parts.push('<Query>')
  parts.push(`<![CDATA[${sql.trim()}]]></Query>`)
  parts.push('<PageQuery>')
  parts.push('<![CDATA[]]></PageQuery>')

  parts.push('</TableData>')
  return parts.join('')
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
}

export interface DataCptInput {
  datasets: Array<{ name: string; sql: string; params: DatasetParam[]; dbConnection?: string }>
  defaultDbName: string
}

/**
 * 基于骨架模板生成完整数据层 CPT 文本。
 * 骨架中 <TableDataMap>…</TableDataMap> 之间的内容整体替换。
 */
export function generateDataCpt(templateXml: string, input: DataCptInput): string {
  const open = '<TableDataMap>'
  const close = '</TableDataMap>'
  const a = templateXml.indexOf(open)
  const z = templateXml.indexOf(close)
  if (a === -1 || z === -1 || z < a) {
    throw new Error('骨架模板中找不到 TableDataMap 节点')
  }

  const body = input.datasets
    .filter((d) => d.name)
    .map((d) =>
      buildTableDataXml(d.name, d.sql, d.params, d.dbConnection || input.defaultDbName)
    )
    .join('\n')

  return (
    templateXml.slice(0, a + open.length) +
    '\n' +
    body +
    '\n' +
    templateXml.slice(z)
  )
}
