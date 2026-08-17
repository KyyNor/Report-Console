import React, { useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { sql } from '@codemirror/lang-sql'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'

export function JsxEditor({ value, onChange, height = '100%' }: { value: string; onChange: (v: string) => void; height?: string }) {
  const extensions = useMemo(() => [javascript({ jsx: true })], [])
  return <CodeMirror value={value} height={height} extensions={extensions} theme={oneDark} onChange={onChange} basicSetup={{ tabSize: 2 }} />
}

export function SqlEditor({ value, onChange, height = '180px', readOnly = false }: { value: string; onChange?: (v: string) => void; height?: string; readOnly?: boolean }) {
  const extensions = useMemo(() => [sql()], [])
  return <CodeMirror value={value} height={height} extensions={extensions} theme={oneDark} editable={!readOnly} onChange={onChange ?? (() => {})} basicSetup={{ tabSize: 2 }} />
}

export function MdEditor({ value, onChange, height = '320px' }: { value: string; onChange: (v: string) => void; height?: string }) {
  const extensions = useMemo(() => [markdown()], [])
  return <CodeMirror value={value} height={height} extensions={extensions} theme={oneDark} onChange={onChange} basicSetup={{ tabSize: 2 }} />
}

export function JsonView({ data }: { data: unknown }) {
  const text = useMemo(() => {
    try {
      return typeof data === 'string' ? data : JSON.stringify(data, null, 2)
    } catch {
      return String(data)
    }
  }, [data])
  return <div className="json-view">{text}</div>
}
