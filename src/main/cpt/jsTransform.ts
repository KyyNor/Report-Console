/**
 * JS 变换 — fr-flow-v3 scripts/display/display_writer.py 中三个核心变换的移植：
 *   1. removeComments      去注释（字符串保护 + \uXXXX 解码还原）
 *   2. transformHooksDestructuring  React/antd.useState 解构 → 两步赋值
 *   3. nodeCheck           语法检查（由调用方触发外部进程）
 */

// ── 字符串字面量正则（与 python 版一致：允许转义、跨行） ──────────

const SINGLE_STRING_RE = /'(?:[^'\\]|\\.)*'/g
const DOUBLE_STRING_RE = /"(?:[^"\\]|\\.)*"/g
const TICK_STRING_RE = /`(?:[^`\\]|\\.)*`/g
const MULTILINE_COMMENT_RE = /\/\*[\s\S]*?\*\//g
const SINGLELINE_COMMENT_RE = /\/\/[^\n]*/g
const UNICODE_ESCAPE_RE = /(?<!\\)\\u([0-9a-fA-F]{4})/g

/**
 * 去掉全文件所有注释；同轮将字符串字面量内的 \uXXXX 解码为原生字符。
 * 实现：先挖字符串 → 删注释 → 回填（回填时解码）。
 */
export function removeComments(js: string): string {
  const strings = new Map<string, string>()

  const stash = (m: string): string => {
    const key = `_MJS_S${String(strings.size).padStart(6, '0')}_`
    strings.set(key, m)
    return key
  }

  let s = js.replace(SINGLE_STRING_RE, stash)
  s = s.replace(DOUBLE_STRING_RE, stash)
  s = s.replace(TICK_STRING_RE, stash)

  s = s.replace(MULTILINE_COMMENT_RE, '')
  s = s.replace(SINGLELINE_COMMENT_RE, '')

  const decode = (m: string, hex: string): string => {
    try {
      return String.fromCharCode(parseInt(hex, 16))
    } catch {
      return m
    }
  }

  for (const [key, val] of strings) {
    const decoded = val.replace(UNICODE_ESCAPE_RE, decode)
    s = s.replace(key, () => decoded)
  }
  return s
}

// ── Hook 解构转换（帆软预览环境兼容） ────────────────────────────

const HOOKS_DESTRUCT_RE =
  /\b(const|var|let)\s*\[\s*(\w+)\s*,\s*(\w+)\s*\]\s*=\s*(React|antd|antdMobile)\.useState\(([\s\S]*?)\);/g

/**
 * const [v, setV] = React.useState(init);
 *   → var _hook_001_ = React.useState(init); var v = _hook_001_[0]; var setV = _hook_001_[1];
 */
export function transformHooksDestructuring(js: string): { code: string; count: number } {
  let counter = 0
  const code = js.replace(HOOKS_DESTRUCT_RE, (_m, _kw: string, varA: string, varB: string, prefix: string, initExpr: string) => {
    counter += 1
    const tmp = `_hook_${String(counter).padStart(3, '0')}_`
    const init = initExpr.trim()
    return `var ${tmp} = ${prefix}.useState(${init});var ${varA} = ${tmp}[0];var ${varB} = ${tmp}[1];`
  })
  return { code, count: counter }
}

// ── 语法检查（node --check 语义） ────────────────────────────────
// 输出为 iife 无 import/export，可用 new Function 做等价语法门。
// 失败抛出 SyntaxError（含位置信息）。

export function syntaxCheck(js: string): void {
  try {
    // eslint-disable-next-line no-new-func
    new Function(js)
  } catch (e) {
    const err = e as SyntaxError
    throw new SyntaxError(`JS 语法错误：${err.message}`)
  }
}

/** CDATA 内容保护：`]]>` 无法在 CDATA 内表达 */
export function assertCdataSafe(js: string): void {
  if (js.includes(']]>')) {
    throw new Error('代码中包含 "]]>"（无法写入 CDATA），请调整写法')
  }
}
