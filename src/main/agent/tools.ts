/**
 * Agent 工具集 — 平台动作的模型侧暴露面
 *
 * 设计原则（规范内化）：模型只能通过这些工具开发，
 * CPT 只能由 build 生成、SQL 只能走只读/审计通道、页面只能写 reportlets。
 */

import { tool } from 'ai'
import { z } from 'zod'
import * as modules from '../modules'
import * as pages from '../pagesService'
import * as sql from '../mysqlService'
import { pingFrServer } from '../frClient'
import { getSettings, getDb } from '../db'

const truncate = (v: unknown, n = 1500): unknown => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  if (s === undefined) return v
  return s.length > n ? s.slice(0, n) + `…（截断，共 ${s.length} 字符）` : JSON.parse(s) ?? s
}

export function buildTools() {
  return {
    // ── 环境 ──────────────────────────────────────────────
    fr_status: tool({
      description: '检查开发环境：帆软服务连通性、MySQL 连通性、reportlets 目录可写性',
      parameters: z.object({}),
      execute: async () => {
        const fr = await pingFrServer()
        const my = await sql.pingMysql()
        const s = getSettings()
        let writable = false
        try { sql; const fs = await import('fs'); fs.accessSync(s.reportletsPath, fs.constants.W_OK); writable = true } catch { writable = false }
        return { fr, mysql: my, reportletsPath: s.reportletsPath, reportletsWritable: writable }
      }
    }),

    // ── 模块与接口契约 ────────────────────────────────────
    list_modules: tool({
      description: '列出全部业务模块及接口数量',
      parameters: z.object({}),
      execute: async () => modules.listModules()
    }),

    create_module: tool({
      description: '创建业务模块。name 为 reportlets 子目录名（小写字母/数字/下划线）；datasource 为帆软数据连接名（与 FineReport 设计器中已建的数据连接同名）',
      parameters: z.object({
        name: z.string().regex(/^[a-z][a-z0-9_]*$/, '小写字母开头，仅字母/数字/下划线'),
        datasource: z.string().describe('帆软数据连接名（数据层 CPT 的 DatabaseName）'),
        comment: z.string().optional()
      }),
      execute: async ({ name, datasource, comment }) => modules.createModule(name, datasource, comment)
    }),

    list_datasets: tool({
      description: '列出模块内全部接口（数据集）的完整契约：参数、SQL、类型',
      parameters: z.object({ module: z.string() }),
      execute: async ({ module }) => modules.listDatasets(module)
    }),

    save_dataset: tool({
      description: `创建或更新接口（数据集契约，存 SQLite，构建后进入 _data.cpt）。
命名规范：列表 {m}_qry（含 p_page/p_pagesize/p_keyword 参数 + LIMIT 分页）、统计 {m}_total、单条 {m}_by_id、字典 dict_{x}、写入 {m}_insert/update/delete（CALL 存储过程）。
参数 type: string|integer|double|formula（当前用户类变量用 formula，如 =$fine_username）。
SQL 用帆软公式：可选条件 \${if(len(p_x)==0,""," AND col='"+p_x+"'")}，分页 LIMIT \${(p_page-1)*p_pagesize}, \${p_pagesize}。`,
      parameters: z.object({
        module: z.string(),
        name: z.string().regex(/^[a-z][a-z0-9_]*$/),
        kind: z.enum(['list', 'stat', 'detail', 'dict', 'insert', 'update', 'delete', 'other']).default('other'),
        comment: z.string().optional(),
        params: z.array(z.object({
          name: z.string(),
          type: z.enum(['string', 'integer', 'double', 'formula']).default('string'),
          default: z.string().optional()
        })).default([]),
        sql: z.string().min(1)
      }),
      execute: async ({ module, name, kind, comment, params, sql: sqlText }) =>
        modules.saveDataset(module, { name, kind, comment, params, sql: sqlText })
    }),

    delete_dataset: tool({
      description: '删除接口契约（不影响已部署 CPT，重建后生效）',
      parameters: z.object({ module: z.string(), name: z.string() }),
      execute: async ({ module, name }) => { modules.deleteDataset(module, name); return { ok: true } }
    }),

    build_data_cpt: tool({
      description: '构建模块数据层 CPT 并部署到 reportlets/{module}/data/。质量门不过会拒绝落盘并返回 findings',
      parameters: z.object({ module: z.string() }),
      execute: async ({ module }) => modules.buildDataCpt(module)
    }),

    test_dataset: tool({
      description: '通过帆软 /api/data 实测接口（参数默认取契约 default，可用 overrides 覆盖）。err_code=0 即通过',
      parameters: z.object({
        module: z.string(),
        dataset: z.string(),
        overrides: z.record(z.unknown()).optional().describe('参数名 → 测试值')
      }),
      execute: async ({ module, dataset, overrides }) => {
        const r = await modules.testDataset(module, dataset, overrides ?? {})
        return { ok: r.ok, errCode: r.errCode, durationMs: r.durationMs, rowCount: r.rowCount, response: truncate(r.response) }
      }
    }),

    verify_module: tool({
      description: '构建数据层 CPT 并实测模块内全部接口，返回逐项通过情况（数据层验收）',
      parameters: z.object({ module: z.string() }),
      execute: async ({ module }) => {
        const build = modules.buildDataCpt(module)
        const tests = await modules.testAllDatasets(module)
        return {
          buildOk: build.ok,
          buildFindings: build.findings,
          datasets: tests.map((t) => ({ dataset: t.dataset, ok: t.ok, errCode: t.errCode, rowCount: t.rowCount, durationMs: t.durationMs, err: t.ok ? undefined : JSON.stringify(t.response).slice(0, 300) }))
        }
      }
    }),

    // ── 页面 ──────────────────────────────────────────────
    list_pages: tool({
      description: '列出 reportlets 下全部页面（jsx/mjs/cpt 状态、是否需要重新构建）',
      parameters: z.object({}),
      execute: async () => pages.listPages()
    }),

    read_page: tool({
      description: '读取页面 JSX 源码',
      parameters: z.object({ module: z.string(), page: z.string() }),
      execute: async ({ module, page }) => pages.readPage(module, page)
    }),

    write_page: tool({
      description: `写入/更新页面 JSX 源码（reportlets/{module}/pages/{page}.jsx，仅此目录可写）。
页面运行约定：直接使用全局 React/ReactDOM/antd/dayjs/$/PATH（禁止 import、禁止重新声明 PATH、不要自行创建 app-root）。
调接口统一走 PATH.apiBase + '/api/data'，body: {report_path: PATH.getDataTemplate('xx_data.cpt'), datasource_name, page_number:-1, page_size:-1, parameters}。`,
      parameters: z.object({
        module: z.string(),
        page: z.string(),
        content: z.string().min(1)
      }),
      execute: async ({ module, page, content }) => {
        pages.savePage(module, page, content)
        return { ok: true, path: `${module}/pages/${page}.jsx` }
      }
    }),

    create_page: tool({
      description: '从脚手架新建页面：blank（空白）/ list（列表页）/ form（表单弹窗）',
      parameters: z.object({
        module: z.string(),
        page: z.string(),
        starter: z.enum(['blank', 'list', 'form']).default('blank')
      }),
      execute: async ({ module, page, starter }) => { pages.createPage(module, page, starter); return { ok: true } }
    }),

    build_page: tool({
      description: '编译页面：jsx → esbuild → 净化 → 注入骨架 → 同目录产出 .mjs 和 .cpt（质量门不过则 CPT 不落盘）',
      parameters: z.object({ module: z.string(), page: z.string() }),
      execute: async ({ module, page }) => pages.buildPage(module, page)
    }),

    open_page: tool({
      description: '构建（如有变更）并用帆软 URL 打开页面预览（op=write + 时间戳防缓存）',
      parameters: z.object({ module: z.string(), page: z.string() }),
      execute: async ({ module, page }) => {
        const { openPreviewWindow } = await import('../windows')
        const url = pages.pagePreviewUrl(module, page)
        openPreviewWindow(url, `${module}/${page}`)
        return { ok: true, url }
      }
    }),

    // ── 数据库 ────────────────────────────────────────────
    sql_query: tool({
      description: '只读 SQL（SELECT/SHOW/DESCRIBE/EXPLAIN，自动 LIMIT 100）。查表结构/数据用它',
      parameters: z.object({
        sql: z.string(),
        database: z.string().optional().describe('缺省用设置中的库')
      }),
      execute: async ({ sql: q, database }) => {
        const r = await sql.readOnlyQuery(q, database)
        return { columns: r.columns, rowCount: r.rows.length, truncated: r.truncated, rows: r.rows.slice(0, 50) }
      }
    }),

    sql_exec: tool({
      description: '受控执行写入类 SQL（DDL/DML/CALL），全量审计落库。仅用于建表、改表、执行存储过程等必要场景；执行前先用 sql_query 确认影响面',
      parameters: z.object({
        sql: z.string().min(1),
        purpose: z.string().describe('本次执行的业务目的（写入审计日志）'),
        confirm: z.literal(true).describe('必须显式传 true 表示已确认影响面')
      }),
      execute: async ({ sql: q, purpose, confirm }) => {
        if (!confirm) return { ok: false, error: '需要 confirm=true' }
        const kind = /^\s*call\b/i.test(q) ? 'call' : /^\s*(create|alter|drop|truncate)\b/i.test(q) ? 'ddl' : 'dml'
        const r = await sql.guardedExec(q, kind, purpose)
        return { ok: r.ok, error: r.error, result: truncate(r.result, 800) }
      }
    }),

    list_tables: tool({
      description: '列出数据库的表和注释',
      parameters: z.object({ database: z.string().optional() }),
      execute: async ({ database }) => sql.listTables(database)
    }),

    describe_table: tool({
      description: '查看表结构（字段/类型/注释）',
      parameters: z.object({ table: z.string(), database: z.string().optional() }),
      execute: async ({ table, database }) => sql.describeTable(table, database)
    }),

    // ── 存储过程 ──────────────────────────────────────────
    list_procedures: tool({
      description: '列出数据库的存储过程',
      parameters: z.object({ database: z.string().optional() }),
      execute: async ({ database }) => sql.listProcedures(database)
    }),

    read_procedure: tool({
      description: '读取存储过程完整定义（CREATE PROCEDURE）',
      parameters: z.object({ name: z.string(), database: z.string().optional() }),
      execute: async ({ name, database }) => {
        const def = await sql.getProcedureDefinition(name, database)
        return truncate(def, 4000)
      }
    }),

    apply_procedure: tool({
      description: '创建/替换存储过程（DROP IF EXISTS + CREATE，审计落库）。写入类过程必须 SELECT JSON_OBJECT(...) 返回结果',
      parameters: z.object({
        name: z.string(),
        definition: z.string().min(10).describe('完整 CREATE PROCEDURE 语句（含 DELIMITER 之外的内容）'),
        database: z.string().optional()
      }),
      execute: async ({ name, definition, database }) => sql.applyProcedure(definition, name, database)
    }),

    // ── 历史 ──────────────────────────────────────────────
    recent_history: tool({
      description: '查看最近的构建与接口测试历史',
      parameters: z.object({}),
      execute: async () => ({
        builds: modules.listBuilds(10),
        apiTests: modules.listApiTests(10)
      })
    })
  }
}

export const SYSTEM_PROMPT = `你是「Report Console」的开发 Agent，工作在帆软加壳架构上：帆软做数据连接/鉴权/数据集宿主，前端用 React(antd) 页面，产物是部署到 reportlets 的 CPT。

## 开发约定（务必遵守）
- 分层：数据接口（SQL/存储过程 → _data.cpt）先行、实测通过（err_code=0）再做页面。
- 接口命名：{m}_qry / {m}_total / {m}_by_id / dict_{x} / {m}_insert / {m}_update / {m}_delete。
- 列表接口必须带 p_page/p_pagesize 参数，SQL 用 LIMIT \${(p_page-1)*p_pagesize}, \${p_pagesize} 自行分页。
- 可选条件用帆软公式 \${if(len(p_x)==0,""," AND ...")}；字符串参数在 SQL 中单引号包裹。
- 写操作走存储过程（CALL sp_xxx(...)），过程必须 SELECT JSON_OBJECT(...) 返回结果。
- 当前用户/角色等权限变量声明为 formula 类型参数（如 =$fine_username），不要通过 API 请求传递。
- 页面 JSX：全局变量直接用（React/antd/dayjs/$/PATH），不写 import，不重建 PATH，不自建 app-root。
- 页面调接口统一 PATH.apiBase + '/api/data'，page_number/page_size 恒为 -1。

## 工作方式
- 动手前先 fr_status + list_modules/list_datasets 了解现状；改表结构前先 describe_table。
- 每次构建后用 test_dataset/verify_module 实测；失败时根据 err_msg 修复后重试，不要绕过质量门。
- CPT 只能通过 build 工具产出；报告结论要给出可验证证据（err_code、行数、构建日志）。`
