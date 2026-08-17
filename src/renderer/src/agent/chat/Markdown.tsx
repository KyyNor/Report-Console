/**
 * 聊天 Markdown 渲染 — markdown-it（html:false 默认转义，模型输出不可信）+ 复用应用内 hl() 高亮
 *
 * 代码块沿用全应用 codeblk 的深色视觉（.rc-md pre 样式），链接经 target=_blank
 * 走主进程 openExternal 在系统浏览器打开。渲染结果按内容 memo，流式增量只在文本变化时重解析。
 */
import React, { useMemo } from 'react'
import MarkdownIt from 'markdown-it'
import { hl } from '../../components/ui'

const md = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  highlight: (code) => hl(code)
})

// 外链补 target=_blank（Electron window.open 处理器已接 shell.openExternal）
const defaultLinkOpen = md.renderer.rules.link_open
  ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('target', '_blank')
  tokens[idx].attrSet('rel', 'noreferrer')
  return defaultLinkOpen(tokens, idx, options, env, self)
}

export const Markdown = React.memo(function Markdown({ text }: { text: string }): React.ReactElement {
  const html = useMemo(() => md.render(text), [text])
  return <div className="rc-md" dangerouslySetInnerHTML={{ __html: html }} />
})
