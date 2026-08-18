/**
 * 展示层 CPT 发版器 — fr-flow-v3 scripts/display/display_writer.py 的 TypeScript 移植
 *
 * 流程：.jsx → esbuild(iife) → 去注释 → Hook 解构转换 → 语法门 → CDATA 安全检查
 *       → 注入 base_cpt_page 骨架「开发者代码区」→ 输出 CPT 文本
 *
 * esbuild 走 JS API（不再依赖全局 CLI），.mjs 中间产物由调用方按需落盘。
 */

import * as esbuild from 'esbuild'
import { removeComments, transformHooksDestructuring, syntaxCheck, assertCdataSafe } from './jsTransform'

export interface CompileResult {
  mjs: string        // esbuild 直接输出（未去注释）
  clean: string      // 去注释 + Hook 转换后的最终代码
  hooksTransformed: number
}

/** JSX → IIFE JS（等价 esbuild CLI: --bundle --format=iife --jsx=transform --charset=utf8） */
export async function compileJsx(jsxSource: string): Promise<CompileResult> {
  const result = await esbuild.build({
    stdin: { contents: jsxSource, resolveDir: '.', loader: 'jsx' },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'transform',
    charset: 'utf8',
    platform: 'browser',
    target: 'es2018',
    treeShaking: false,
    logLevel: 'silent'
  })
  if (result.errors.length > 0) {
    const msg = result.errors.map((e) => e.text).join('\n')
    throw new Error(`JSX 编译失败：${msg}`)
  }
  const mjs = result.outputFiles[0]?.text ?? ''
  if (!mjs.trim()) throw new Error('JSX 编译输出为空')

  const noComment = removeComments(mjs)
  const { code, count } = transformHooksDestructuring(noComment)
  syntaxCheck(code)
  assertCdataSafe(code)
  return { mjs, clean: code, hooksTransformed: count }
}

export const DEV_ZONE_START = '/* ===== 开发者代码区 START ===== */'
export const DEV_ZONE_END = '/* ===== 开发者代码区 END ===== */'
export const MOBILE_DEV_ZONE = '/* @FRM_DEVELOPER_ZONE@ */'

/**
 * 把干净代码注入页面骨架的「开发者代码区」，整体包 CDATA 后返回完整 CPT 文本。
 */
export function generatePageCpt(templateXml: string, cleanCode: string): string {
  const openIdx = templateXml.indexOf(DEV_ZONE_START)
  const endIdx = templateXml.indexOf(DEV_ZONE_END)
  if (openIdx === -1 || endIdx === -1 || endIdx < openIdx) {
    throw new Error('骨架模板中找不到「开发者代码区」标记')
  }

  const injected =
    templateXml.slice(0, openIdx) +
    DEV_ZONE_START + '\n' +
    cleanCode + '\n' +
    DEV_ZONE_END +
    templateXml.slice(endIdx + DEV_ZONE_END.length)

  // CDATA 安全：cleanCode 已 assertCdataSafe；模板自身无风险内容
  return injected
}

/** 移动骨架在 bootBusiness() 内保留单一注入标记，避免破坏异步加载 antd-mobile 的固定结构。 */
export function generateMobilePageCpt(templateXml: string, cleanCode: string): string {
  const first = templateXml.indexOf(MOBILE_DEV_ZONE)
  if (first === -1 || first !== templateXml.lastIndexOf(MOBILE_DEV_ZONE)) {
    throw new Error(`移动端骨架必须且只能包含一个注入标记 ${MOBILE_DEV_ZONE}`)
  }
  return templateXml.replace(MOBILE_DEV_ZONE, cleanCode)
}
