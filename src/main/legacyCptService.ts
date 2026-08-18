/** 传统 CPT 的受限只读入口：仅允许检查当前项目内、未被 project.yaml 管理的 CPT。 */
import { readFileSync } from 'fs'
import { listTraditionalCpts, projectRoot, resolveProjectFile } from './projectManifest'
import { inspectLegacyCptXml, type LegacyCptInspectOptions } from './cpt/legacyInspector'

const MAX_CPT_BYTES = 5 * 1024 * 1024

export function inspectLegacyCpt(project: string, path: string, options: LegacyCptInspectOptions = {}): Record<string, unknown> {
  const traditional = listTraditionalCpts(project).find((item) => item.path === path)
  if (!traditional) throw new Error('只能读取当前项目中未受 project.yaml 管理的传统 CPT')
  if (traditional.size > MAX_CPT_BYTES) throw new Error(`传统 CPT 超过 ${MAX_CPT_BYTES / 1024 / 1024}MB，暂不支持检查`)
  const file = resolveProjectFile(projectRoot(project), traditional.path)
  return inspectLegacyCptXml(readFileSync(file, 'utf-8'), {
    path: traditional.path,
    bytes: traditional.size,
    mtime: traditional.mtime
  }, options)
}
