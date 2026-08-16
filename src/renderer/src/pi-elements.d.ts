/**
 * pi-web-ui 自定义元素的 React JSX 声明（React 19 原生 custom elements 支持）。
 * 只声明最小 HTML 属性集；组件实例方法（setAgent 等）经 ref 断言为具体类型调用。
 */
import type * as React from 'react'
import type { ChatPanel } from '@earendil-works/pi-web-ui'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'pi-chat-panel': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>
    }
  }
}

export type ChatPanelElement = HTMLElement & Partial<ChatPanel>
