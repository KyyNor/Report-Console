/**
 * 零依赖 CSV 解析（RFC 4180 子集）：支持引号字段、字段内逗号/换行/转义引号（"" → "）、CRLF 与 BOM。
 * 仅供设计库同步脚本使用；应用运行时读取的是同步产物 jsonl，不解析 CSV。
 */
export function parseCsv(text) {
  const src = text.replace(/^\uFEFF/, '')
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += ch; i++; continue
    }
    if (ch === '"') { inQuotes = true; i++; continue }
    if (ch === ',') { row.push(field); field = ''; i++; continue }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''; i++; continue
    }
    field += ch; i++
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }

  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''))
  if (nonEmpty.length === 0) return { columns: [], rows: [] }
  const columns = nonEmpty[0].map((c) => c.trim())
  return {
    columns,
    rows: nonEmpty.slice(1).map((r) => Object.fromEntries(columns.map((c, idx) => [c, r[idx] ?? ''])))
  }
}
