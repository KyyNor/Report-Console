/// <reference types="vite/client" />

declare module '*?raw' {
  const content: string
  export default content
}

declare module '*.cpt?raw' {
  const content: string
  export default content
}

declare module '*.jsx?raw' {
  const content: string
  export default content
}

interface Window {
  api: {
    invoke: (channel: string, args?: unknown) => Promise<{ ok: boolean; data?: unknown; error?: string }>
    onAgentEvent: (cb: (ev: unknown) => void) => () => void
  }
}
