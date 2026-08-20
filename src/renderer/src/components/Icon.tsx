/**
 * 图标 — svg symbol sprite（来自工作台设计稿），<Icon n="db"/> 引用
 */
import React, { useEffect } from 'react'

const SYMBOLS: Record<string, string> = {
  dash: '<rect x="3" y="3" width="7.5" height="9" rx="1.2"/><rect x="13.5" y="3" width="7.5" height="5" rx="1.2"/><rect x="13.5" y="11" width="7.5" height="10" rx="1.2"/><rect x="3" y="15" width="7.5" height="6" rx="1.2"/>',
  folder: '<path d="M4 6.5a2 2 0 0 1 2-2h4l2.2 2.7h5.8a2 2 0 0 1 2 2v8.3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6.5z"/>',
  folderOpen: '<path d="M4 5.5h5l2 2.5h7.5a1.6 1.6 0 0 1 1.6 1.6v1.2"/><path d="M5 19h13.5a1.5 1.5 0 0 0 1.5-1.2l1.4-6.9a1 1 0 0 0-1-1.2H6a1.5 1.5 0 0 0-1.5 1.2L3.2 17.5A1.3 1.3 0 0 0 4.5 19z"/>',
  db: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v12.6c0 1.6 3.4 2.9 7.5 2.9s7.5-1.3 7.5-2.9V5.5"/><path d="M4.5 11.8c0 1.6 3.4 2.9 7.5 2.9s7.5-1.3 7.5-2.9"/>',
  ai: '<path d="M12 3.5l1.7 4.6 4.6 1.7-4.6 1.7L12 16.1l-1.7-4.6-4.6-1.7 4.6-1.7L12 3.5z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z"/>',
  set: '<path d="M6 4v3.5M6 11.5V20M12 4v8.5M12 16.5V20M18 4v2.5M18 10.5V20"/><circle cx="6" cy="9.5" r="2"/><circle cx="12" cy="14.5" r="2"/><circle cx="18" cy="8.5" r="2"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20.5 20.5L16 16"/>',
  chd: '<path d="M6.5 9.5l5.5 5.5 5.5-5.5"/>',
  chr: '<path d="M9.5 6.5l5.5 5.5-5.5 5.5"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  check: '<path d="M5.5 12.5l4.5 4.5 9-10"/>',
  dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  trash: '<path d="M4.5 7h15M10 10.5v6M14 10.5v6M5.5 7l.9 12.1a1.8 1.8 0 0 0 1.8 1.7h7.6a1.8 1.8 0 0 0 1.8-1.7L18.5 7M9.5 7V5.4A1.4 1.4 0 0 1 10.9 4h2.2a1.4 1.4 0 0 1 1.4 1.4V7"/>',
  pen: '<path d="M4.5 19.5l4.3-1.1L19.6 7.6a2 2 0 0 0 0-2.8l-.4-.4a2 2 0 0 0-2.8 0L5.6 15.2l-1.1 4.3z"/><path d="M14.5 6.5l3 3"/>',
  play: '<path d="M8 5.5l10.5 6.5L8 18.5v-13z"/>',
  box: '<path d="M12 3.2l7.5 4.3v9L12 20.8l-7.5-4.3v-9L12 3.2z"/><path d="M12 12l7.5-4.5M12 12v8.8M12 12L4.5 7.5"/>',
  pkg: '<path d="M12 3.2l7.5 4.3v9L12 20.8l-7.5-4.3v-9L12 3.2z"/><path d="M4.5 7.5L12 12l7.5-4.5M12 12v8.8"/><path d="M8.8 5.2l6.4 3.7"/>',
  ext: '<path d="M11 7.5H6.5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V13"/><path d="M14 4.5h5.5V10M19.5 4.5L11 13"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  alert: '<path d="M12 4.8L3.4 18.9a1.2 1.2 0 0 0 1.05 1.8h15.1a1.2 1.2 0 0 0 1.05-1.8L12 4.8z"/><path d="M12 10.5v4M12 17.8h.01"/>',
  cck: '<circle cx="12" cy="12" r="8.2"/><path d="M8.5 12.4l2.4 2.4 4.6-5.2"/>',
  cx: '<circle cx="12" cy="12" r="8.2"/><path d="M9.5 9.5l5 5M14.5 9.5l-5 5"/>',
  cd: '<circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="1.4"/>',
  info: '<circle cx="12" cy="12" r="8.2"/><path d="M12 11v5M12 7.8h.01"/>',
  term: '<path d="M5 8l4 4-4 4M12 16.5h7"/>',
  code: '<path d="M8.5 7.5L4.5 12l4 4.5M15.5 7.5l4 4.5-4 4.5M13.5 5l-3 14"/>',
  file: '<path d="M13.5 3.5H7a1.8 1.8 0 0 0-1.8 1.8v13.4A1.8 1.8 0 0 0 7 20.5h10a1.8 1.8 0 0 0 1.8-1.8V8.8l-5.3-5.3z"/><path d="M13.5 3.5v5.3h5.3M8.5 13h7M8.5 16.5h4.5"/>',
  send: '<path d="M20.5 3.5L3.5 10.6l6.9 3 3 6.9 7.1-17z"/><path d="M10.4 13.6L20.5 3.5"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.8"/>',
  spin: '<path d="M12 3.8a8.2 8.2 0 1 1-8.2 8.2"/>',
  back: '<path d="M19.5 12H5M11 5.5L4.5 12 11 18.5"/>',
  shield: '<path d="M12 3.5l7 2.8v5.1c0 4.3-2.9 7.9-7 9.3-4.1-1.4-7-5-7-9.3V6.3l7-2.8z"/><path d="M8.8 12l2.2 2.2 4.2-4.6"/>',
  link: '<path d="M10.2 13.8a3.6 3.6 0 0 1 0-5.1l2-2a3.6 3.6 0 0 1 5.1 5.1l-1.2 1.2"/><path d="M13.8 10.2a3.6 3.6 0 0 1 0 5.1l-2 2a3.6 3.6 0 0 1-5.1-5.1l1.2-1.2"/>',
  eye: '<path d="M3 12s3.3-5.8 9-5.8S21 12 21 12s-3.3 5.8-9 5.8S3 12 3 12z"/><circle cx="12" cy="12" r="2.6"/>',
  scan: '<path d="M4.5 8.5V6.5a2 2 0 0 1 2-2h2M15.5 4.5h2a2 2 0 0 1 2 2v2M19.5 15.5v2a2 2 0 0 1-2 2h-2M8.5 19.5h-2a2 2 0 0 1-2-2v-2"/><path d="M4.5 12h15"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>'
}

let mounted = false

/** 挂载 svg sprite（应用根渲染一次） */
export function IconSprite(): React.ReactElement {
  useEffect(() => { mounted = true }, [])
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        {Object.entries(SYMBOLS).map(([id, body]) => (
          <symbol key={id} id={`i-${id}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: body }} />
        ))}
      </defs>
    </svg>
  )
}

export function Icon({ n, size }: { n: string; size?: number }): React.ReactElement {
  return <svg className="ic" style={size ? { width: size, height: size } : undefined}><use href={`#i-${n}`} /></svg>
}
