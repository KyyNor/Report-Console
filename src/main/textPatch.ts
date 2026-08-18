/**
 * 对 Agent 的文本修改采用精确、唯一的片段替换，而非默默覆盖整份文件。
 * 找不到或命中多处都拒绝写入，要求模型先重新读取更大的上下文。
 */
export function replaceUniqueText(content: string, oldText: string, newText: string, target: string): string {
  if (!oldText) throw new Error('待替换的原片段不能为空')
  const start = content.indexOf(oldText)
  if (start < 0) throw new Error(`${target} 中未找到指定原片段；请重新读取当前内容后再 patch`)
  if (content.indexOf(oldText, start + oldText.length) >= 0) {
    throw new Error(`${target} 中原片段命中多处；请提供更长、可唯一定位的原片段后再 patch`)
  }
  return content.slice(0, start) + newText + content.slice(start + oldText.length)
}
