/**
 * Agent 工具集 — 平台动作的模型侧暴露面（v2 项目制）
 *
 * 设计原则（规范内化）：模型只能通过这些工具开发，
 * CPT 只能由 build 生成、SQL 只能走只读/审计通道、页面只能写 reportlets。
 */

import { tool } from 'ai'
import { z } from 'zod'
import * as projects from '../projectsService'
import * as pages from '../pagesService'
import * as sql from '../mysqlService'
import * as conns from '../connectionsService'
import { pingFrServer } from '../frClient'
import { getSettings } from '../db'

export { SYSTEM_PROMPT } from '@shared/agentPrompt'

/** 平台工具集（ai-sdk 形态）；渲染层 pi Agent（经 piBridge）使用 */
export type PlatformTools = ReturnType<typeof buildTools>

const truncate = (v: unknown, n = 1500): unknown => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  if (s === undefined) return v
  return s.length > n ? s.slice(0, n) + `…（截断，共 ${s.length} 字符）` : JSON.parse(s) ?? s
}

const connRef = z.object({ id: z.number().optional(), name: z.string().optional() }).optional()
  .describe('连接引用（缺省用项目绑定/注册表第一个连接）')

export function buildTools() {
  return {
    // ── 环境 ──────────────────────────────────────────────
    fr_status: tool({
      description: '检查开发环境：帆软服务连通性、各数据连接连通性、reportlets 目录可写性',
      parameters: z.object({}),
      execute: async () => {
        const fr = await pingFrServer()
        const health = await projects.connectionsHealth()
        const s = getSettings()
        let writable = false
        try { const fs = await import('fs'); fs.accessSync(s.reportletsPath, fs.constants.W_OK); writable = true } catch { writable = false }
        return { fr, connections: health, reportletsPath: s.reportletsPath, reportletsWritable: writable }
      }
    }),

    // ── 连接注册表 ────────────────────────────────────────
    list_connections: tool({
      description: '列出连接注册表（名字与帆软数据连接一致，接口/过程绑定用名字引用）',
      parameters: z.object({}),
      execute: async () => conns.listConnections().map((c) => ({ name: c.name, host: c.host, port: c.port, user: c.user, database: c.database, comment: c.comment }))
    }),

    // ── 项目 ──────────────────────────────────────────────
    list_projects: tool({
      description: '列出全部项目：绑定连接、资源规模、目录是否缺失',
      parameters: z.object({}),
      execute: async () => projects.listProjects().map((p) => ({ name: p.name, connections: p.connections, counts: p.counts, missingDir: p.missingDir, comment: p.comment }))
    }),

    create_project: tool({
      description: '创建项目（= reportlets 子目录，自动建 data/ pages/ meta/ 三目录）。需绑定至少一个已注册连接',
      parameters: z.object({
        name: z.string().regex(/^[a-z][a-z0-9_]*$/, '小写字母开头，仅字母/数字/下划线'),
        connections: z.array(z.string()).min(1).describe('绑定的连接名（来自连接注册表）'),
        comment: z.string().optional()
      }),
      execute: async ({ name, connections, comment }) => projects.createProject(name, connections, comment)
    }),

    // ── 接口契约 ──────────────────────────────────────────
    list_datasets: tool({
      description: '列出项目内全部接口（数据集）的完整契约：参数、SQL、类型、所属连接',
      parameters: z.object({ project: z.string() }),
      execute: async ({ project }) => projects.listDatasets(project)
    }),

    save_dataset: tool({
      description: `创建或更新接口（数据集契约，存 SQLite，构建后进入项目 _data.cpt）。
命名规范：列表 {m}_qry（含 p_page/p_pagesize/p_keyword 参数 + LIMIT 分页）、统计 {m}_total、单条 {m}_by_id、字典 dict_{x}、写入 {m}_insert/update/delete（CALL 存储过程）。
参数 type: string|integer|double|formula（当前用户类变量用 formula，如 =$fine_username）。
SQL 用帆软公式：可选条件 \${if(len(p_x)==0,""," AND col='"+p_x+"')}，分页 LIMIT \${(p_page-1)*p_pagesize}, \${p_pagesize}。
connection 必须是项目已绑定的连接名（跨库字典选对应连接）。`,
      parameters: z.object({
        project: z.string(),
        name: z.string().regex(/^[a-z][a-z0-9_]*$/),
        kind: z.enum(['list', 'stat', 'detail', 'dict', 'insert', 'update', 'delete', 'other']).default('other'),
        comment: z.string().optional(),
        connection: z.string().optional().describe('所属连接名（缺省用项目第一个绑定连接）'),
        params: z.array(z.object({
          name: z.string(),
          type: z.enum(['string', 'integer', 'double', 'formula']).default('string'),
          default: z.string().optional()
        })).default([]),
        sql: z.string().min(1)
      }),
      execute: async ({ project, name, kind, comment, connection, params, sql: sqlText }) =>
        projects.saveDataset(project, { name, kind, comment, connection, params, sql: sqlText })
    }),

    delete_dataset: tool({
      description: '删除接口契约（不影响已部署 CPT，重建后生效）',
      parameters: z.object({ project: z.string(), name: z.string() }),
      execute: async ({ project, name }) => { projects.deleteDataset(project, name); return { ok: true } }
    }),

    build_data_cpt: tool({
      description: '构建项目数据层 CPT 并部署到 reportlets/{project}/data/（一项目一页，页内每数据集各带连接名）。质量门不过会拒绝落盘并返回 findings',
      parameters: z.object({ project: z.string() }),
      execute: async ({ project }) => projects.buildDataCpt(project)
    }),

    test_dataset: tool({
      description: '通过帆软 /api/data 实测接口（参数默认取契约 default，可用 overrides 覆盖）。err_code=0 即通过',
      parameters: z.object({
        project: z.string(),
        dataset: z.string(),
        overrides: z.record(z.unknown()).optional().describe('参数名 → 测试值')
      }),
      execute: async ({ project, dataset, overrides }) => {
        const r = await projects.testDataset(project, dataset, overrides ?? {})
        return { ok: r.ok, errCode: r.errCode, durationMs: r.durationMs, rowCount: r.rowCount, response: truncate(r.response) }
      }
    }),

    verify_project: tool({
      description: '构建数据层 CPT 并实测项目内全部接口，返回逐项通过情况（数据层验收）',
      parameters: z.object({ project: z.string() }),
      execute: async ({ project }) => {
        const { build, tests } = await projects.verifyProject(project)
        return {
          buildOk: build.ok,
          buildFindings: build.findings,
          datasets: tests.map((t) => ({ dataset: t.dataset, ok: t.ok, errCode: t.errCode, rowCount: t.rowCount, durationMs: t.durationMs, err: t.ok ? undefined : JSON.stringify(t.response).slice(0, 300) }))
        }
      }
    }),

    // ── 存储过程（归属项目 + 关联共享） ────────────────────
    list_procedures: tool({
      description: '列出项目的存储过程（本项目创建 + 关联自其他项目）',
      parameters: z.object({ project: z.string() }),
      execute: async ({ project }) => projects.listProcedures(project)
    }),

    read_procedure: tool({
      description: '读取项目内存储过程的完整定义（meta/{name}.sql 为源，缺省回退库内 SHOW CREATE）',
      parameters: z.object({ project: z.string(), name: z.string() }),
      execute: async ({ project, name }) => truncate(await projects.procedureDefinition(project, name), 4000)
    }),

    save_procedure: tool({
      description: '创建/更新项目的存储过程契约与定义（定义存 meta/{name}.sql）。写入类过程必须 SELECT JSON_OBJECT(...) 返回结果。要真正落到数据库需再调 apply_procedure',
      parameters: z.object({
        project: z.string(),
        name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
        connection: z.string().optional().describe('所属连接名（缺省用项目第一个绑定连接）'),
        comment: z.string().optional(),
        definition: z.string().min(10).describe('完整 CREATE PROCEDURE 语句（不含 DELIMITER）')
      }),
      execute: async ({ project, name, connection, comment, definition }) =>
        projects.saveProcedure(project, { name, connection, comment, definition })
    }),

    apply_procedure: tool({
      description: '把过程定义应用到数据库（DROP IF EXISTS + CREATE，审计落库，定义取 meta/ 文件）',
      parameters: z.object({ project: z.string(), name: z.string() }),
      execute: async ({ project, name }) => projects.applyProjectProcedure(project, name)
    }),

    link_procedure: tool({
      description: '关联其他项目的过程到本项目（引用不复制；本项目接口 SQL 可直接 CALL）',
      parameters: z.object({
        project: z.string(),
        srcProject: z.string().describe('过程归属的源项目名'),
        name: z.string()
      }),
      execute: async ({ project, srcProject, name }) => {
        const target = projects.listProcedures(srcProject).find((x) => x.name === name && x.own)
        if (!target) throw new Error(`源项目 ${srcProject} 没有自有过程 ${name}`)
        projects.linkProcedure(project, target.id)
        return { ok: true }
      }
    }),

    // ── 项目文档（meta/） ────────────────────────────────
    list_docs: tool({
      description: '列出项目 meta/ 下的需求/设计文档与过程语句',
      parameters: z.object({ project: z.string() }),
      execute: async ({ project }) => projects.listDocs(project)
    }),

    read_doc: tool({
      description: '读取项目文档内容（.md 需求/设计 或 .sql 过程语句）——动手前先读需求',
      parameters: z.object({ project: z.string(), name: z.string() }),
      execute: async ({ project, name }) => truncate(await Promise.resolve(projects.readDoc(project, name)), 6000)
    }),

    write_doc: tool({
      description: '写入/更新项目文档（meta/ 目录，.md 或 .sql）。需求确认、设计沉淀、过程语句备份都放这里',
      parameters: z.object({ project: z.string(), name: z.string(), content: z.string().min(1) }),
      execute: async ({ project, name, content }) => { projects.saveDoc(project, name, content); return { ok: true } }
    }),

    // ── 页面 ──────────────────────────────────────────────
    list_pages: tool({
      description: '列出项目页面（jsx/mjs/cpt 状态、是否待重建）',
      parameters: z.object({ project: z.string().optional() }),
      execute: async ({ project }) => pages.listPages(project)
    }),

    read_page: tool({
      description: '读取页面 JSX 源码',
      parameters: z.object({ project: z.string(), page: z.string() }),
      execute: async ({ project, page }) => pages.readPage(project, page)
    }),

    write_page: tool({
      description: `写入/更新页面 JSX 源码（reportlets/{project}/pages/{page}.jsx，仅此目录可写）。
页面运行约定：直接使用全局 React/ReactDOM/antd/dayjs/$/PATH（禁止 import、禁止重新声明 PATH、不要自行创建 app-root）。
调接口统一走 PATH.apiBase + '/api/data'，body: {report_path: PATH.getDataTemplate('xx_data.cpt'), datasource_name, page_number:-1, page_size:-1, parameters}。`,
      parameters: z.object({
        project: z.string(),
        page: z.string(),
        content: z.string().min(1)
      }),
      execute: async ({ project, page, content }) => {
        pages.savePage(project, page, content)
        return { ok: true, path: `${project}/pages/${page}.jsx` }
      }
    }),

    create_page: tool({
      description: '从脚手架新建页面：blank（空白）/ list（列表页）/ form（表单弹窗）',
      parameters: z.object({
        project: z.string(),
        page: z.string(),
        starter: z.enum(['blank', 'list', 'form']).default('blank')
      }),
      execute: async ({ project, page, starter }) => { pages.createPage(project, page, starter); return { ok: true } }
    }),

    build_page: tool({
      description: '编译页面：jsx → esbuild → 净化 → 注入骨架 → 同目录产出 .mjs 和 .cpt（质量门不过则 CPT 不落盘）',
      parameters: z.object({ project: z.string(), page: z.string() }),
      execute: async ({ project, page }) => pages.buildPage(project, page)
    }),

    open_page: tool({
      description: '构建（如有变更）并用帆软 URL 打开页面预览（op=write + 时间戳防缓存）',
      parameters: z.object({ project: z.string(), page: z.string() }),
      execute: async ({ project, page }) => {
        const { openPreviewWindow } = await import('../windows')
        const url = pages.pagePreviewUrl(project, page)
        openPreviewWindow(url, `${project}/${page}`)
        return { ok: true, url }
      }
    }),

    // ── 数据库（按连接路由） ──────────────────────────────
    sql_query: tool({
      description: '只读 SQL（SELECT/SHOW/DESCRIBE/EXPLAIN，自动 LIMIT 100）。查表结构/数据用它；connection 指定连接名',
      parameters: z.object({
        sql: z.string(),
        connection: connRef,
        database: z.string().optional().describe('缺省用连接配置的库')
      }),
      execute: async ({ sql: q, connection, database }) => {
        const r = await sql.readOnlyQuery(q, { connection, database })
        return { connection: r.connection, columns: r.columns, rowCount: r.rows.length, truncated: r.truncated, rows: r.rows.slice(0, 50) }
      }
    }),

    sql_exec: tool({
      description: '受控执行写入类 SQL（DDL/DML/CALL），按连接路由，全量审计落库。仅用于建表、改表等必要场景；执行前先用 sql_query 确认影响面',
      parameters: z.object({
        sql: z.string().min(1),
        purpose: z.string().describe('本次执行的业务目的（写入审计日志）'),
        confirm: z.literal(true).describe('必须显式传 true 表示已确认影响面'),
        connection: connRef
      }),
      execute: async ({ sql: q, purpose, confirm, connection }) => {
        if (!confirm) return { ok: false, error: '需要 confirm=true' }
        const kind = /^\s*call\b/i.test(q) ? 'call' : /^\s*(create|alter|drop|truncate)\b/i.test(q) ? 'ddl' : 'dml'
        const r = await sql.guardedExec(q, kind, purpose, connection)
        return { ok: r.ok, error: r.error, result: truncate(r.result, 800) }
      }
    }),

    list_tables: tool({
      description: '列出连接数据库的表和注释',
      parameters: z.object({ connection: connRef, database: z.string().optional() }),
      execute: async ({ connection, database }) => sql.listTables(database, connection)
    }),

    describe_table: tool({
      description: '查看表结构（字段/类型/注释）',
      parameters: z.object({ table: z.string(), connection: connRef, database: z.string().optional() }),
      execute: async ({ table, connection, database }) => sql.describeTable(table, database, connection)
    }),

    // ── 历史 ──────────────────────────────────────────────
    recent_history: tool({
      description: '查看最近的构建与接口测试历史',
      parameters: z.object({}),
      execute: async () => ({
        builds: projects.listBuilds(10),
        apiTests: projects.listApiTests(10)
      })
    })
  }
}
