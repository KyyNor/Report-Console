/**
 * 存储过程命名规范（强制）：sp_{项目名}_{功能模块}_{操作}
 * - 操作仅 insert / update / delete（读查询走接口 SQL，不建过程）
 * - 功能模块按实际设计（小写字母/数字/下划线）
 * - 双端校验：saveProcedure 契约保存强校验；buildDataCpt 质量门检查接口 SQL 的 CALL 目标
 */
import type { CheckerFinding } from '@shared/types'

/** 接口 SQL 中的 CALL 目标提取（容忍反引号包裹的过程名） */
const PROC_CALL_RE = /\bCALL\s+`?([a-zA-Z0-9_]+)`?/gi

/** 归属 project 的合法过程名模式 */
export function procedureNamePattern(project: string): RegExp {
  return new RegExp(`^sp_${project}_[a-z0-9_]+_(insert|update|delete)$`)
}

/** 契约保存的强校验：命名不符合规范直接拒绝。 */
export function assertProcedureName(project: string, name: string): void {
  if (!procedureNamePattern(project).test(name)) {
    throw new Error(
      `过程名 ${name} 不符合命名规范 sp_${project}_{功能模块}_{操作}（操作仅 insert/update/delete），例如 sp_${project}_order_insert`
    )
  }
}

/**
 * 构建检测：接口 SQL 中的 CALL 目标必须符合命名规范，违规产出 error 级 finding（质量门一票否决）。
 * knownOwners：本项目契约内登记的过程名 → 归属项目（自建为本项目、关联为源项目）。
 * 登记的过程按各自归属项目的严格前缀校验；未登记的目标按本项目规范校验形态（顺带提示补登记）。
 */
export function checkProcedureCalls(
  project: string,
  items: Array<{ dataset: string; sql: string }>,
  knownOwners: Record<string, string> = {}
): CheckerFinding[] {
  const findings: CheckerFinding[] = []
  for (const { dataset, sql } of items) {
    PROC_CALL_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = PROC_CALL_RE.exec(sql)) !== null) {
      const target = m[1]
      const owner = knownOwners[target]
      if (procedureNamePattern(owner ?? project).test(target)) continue
      findings.push({
        rule: owner ? 'proc-name' : 'proc-name-unregistered',
        severity: 'error',
        message: owner
          ? `接口 ${dataset} CALL 的过程 ${target} 不符合归属项目 ${owner} 的命名规范（sp_${owner}_{功能模块}_{操作}，操作仅 insert/update/delete）`
          : `接口 ${dataset} CALL 的过程 ${target} 不符合命名规范 sp_{项目名}_{功能模块}_{操作}（操作仅 insert/update/delete）；若为其他项目的关联过程，请先在工作台完成关联`
      })
    }
  }
  return findings
}
