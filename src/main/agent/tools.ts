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
import * as legacyCpt from '../legacyCptService'
import { readBuiltinSkill } from './skills'
import { API_DATA_REQUEST_CONTRACT } from '@shared/agentPrompt'

export { SYSTEM_PROMPT } from '@shared/agentPrompt'

/** 平台工具集（ai-sdk 形态）；渲染层 pi Agent（经 piBridge）使用 */
export type PlatformTools = ReturnType<typeof buildTools>

const truncate = (v: unknown, n = 1500): unknown => {
  if (typeof v === 'string') return v.length > n ? v.slice(0, n) + `…（截断，共 ${v.length} 字符）` : v
  const s = JSON.stringify(v)
  if (s === undefined) return v
  return s.length > n ? s.slice(0, n) + `…（截断，共 ${s.length} 字符）` : JSON.parse(s) ?? s
}

const connRef = z.object({ id: z.number().optional(), name: z.string().optional() }).optional()
  .describe('连接引用（缺省用项目绑定/注册表第一个连接）')

export function buildTools() {
  return {
    // ── 内置开发 Skill（只读、按需注入）────────────────────
    read_skill: tool({
      description: '按需读取内置开发 Skill，不会访问本机任意文件。可用：page_interaction（跳转/Modal/iframe 通信）、file_transfer（上传/下载/导出边界）、table_patterns（列表/筛选/分页）。任务命中对应场景时先读 Skill，再实现。',
      parameters: z.object({
        name: z.enum(['page_interaction', 'file_transfer', 'table_patterns'])
      }),
      execute: async ({ name }) => readBuiltinSkill(name)
    }),

    // ── 接口契约 ──────────────────────────────────────────
    list_datasets: tool({
      description: '列出项目内全部接口（数据集）的完整契约：参数、SQL、类型、所属连接',
      parameters: z.object({ project: z.string() }),
      execute: async ({ project }) => projects.listDatasets(project)
    }),

    read_dataset: tool({
      description: '读取项目内单个接口的完整契约（参数、SQL、类型、所属连接）。资源以 @ 附加时优先使用，避免读取全部接口。',
      parameters: z.object({ project: z.string(), name: z.string() }),
      execute: async ({ project, name }) => projects.readDataset(project, name)
    }),

    save_dataset: tool({
      description: `创建或更新接口（数据集契约写入项目 project.yaml，本机 SQLite 仅作运行缓存；构建后进入项目数据 CPT）。
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
      description: '构建项目数据层 CPT 并自动实测所有只读接口（list/stat/detail/dict/other）。一项目一页，质量门不过会拒绝落盘；写接口不自动调用，仍须显式 test_dataset。',
      parameters: z.object({ project: z.string() }),
      execute: async ({ project }) => {
        const build = projects.buildDataCpt(project)
        if (!build.ok) return { build, validation: [] }
        const datasets = projects.listDatasets(project)
        const validation = await Promise.all(datasets
          .filter((d) => !['insert', 'update', 'delete'].includes(d.kind))
          .map(async (d) => {
            const t = await projects.testDataset(project, d.name)
            return { dataset: d.name, ok: t.ok, errCode: t.errCode, rowCount: t.rowCount, durationMs: t.durationMs }
          }))
        return { build, validation }
      }
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

    // ── 项目文档（meta/） ────────────────────────────────
    list_docs: tool({
      description: '列出项目 meta/ 下的需求/设计文档（.md/.txt/.html）、过程语句（.sql）及导入的前端参考源码（.js/.jsx/.mjs/.css）',
      parameters: z.object({ project: z.string() }),
      execute: async ({ project }) => projects.listDocs(project)
    }),

    read_doc: tool({
      description: `按需读取项目 meta/ 文档（.md/.txt/.html/.sql/.js/.jsx/.mjs/.css）。默认 overview 只返回标题结构和短预览；
需要正文时用 view="content"，单次最多 6000 字符，并按 nextCursor 继续。query 会从 cursor 之后定位匹配文本再返回片段。HTML 只作为文本源码读取，绝不执行。`,
      parameters: z.object({
        project: z.string(),
        name: z.string(),
        view: z.enum(['overview', 'content']).default('overview'),
        cursor: z.number().int().min(0).optional().describe('正文的字符偏移；使用上次 nextCursor 继续'),
        limit: z.number().int().min(1).max(6000).optional().describe('content 单次最多返回字符数，缺省 4000'),
        query: z.string().max(200).optional().describe('可选：从 cursor 后定位此文本，再返回该处正文片段')
      }),
      execute: async ({ project, name, view, cursor, limit, query }) => projects.inspectDoc(project, name, { view, cursor, limit, query })
    }),

    write_doc: tool({
      description: '新建项目元数据文件（meta/ 目录，.md / .txt / .html / .sql / .js / .jsx / .mjs / .css）。同名文件已存在时默认拒绝，先 read_doc 后用 patch_doc 修改；仅用户明确要求整份替换时才传 overwrite=true。',
      parameters: z.object({ project: z.string(), name: z.string(), content: z.string().min(1), overwrite: z.boolean().default(false).describe('仅在用户明确要求整份覆盖时设为 true') }),
      execute: async ({ project, name, content, overwrite }) => { projects.saveDoc(project, name, content, { overwrite }); return { ok: true } }
    }),

    patch_doc: tool({
      description: '精确修改已有项目 meta/ 文件的一个片段。old_text 必须与当前文件内容完全一致且只出现一次；找不到或命中多处会拒绝写入，需先 read_doc 获取更准确上下文。new_text 可为空以删除该片段。',
      parameters: z.object({ project: z.string(), name: z.string(), old_text: z.string().min(1), new_text: z.string() }),
      execute: async ({ project, name, old_text, new_text }) => { projects.patchDoc(project, name, old_text, new_text); return { ok: true } }
    }),

    // ── 页面 ──────────────────────────────────────────────
    list_pages: tool({
      description: '列出项目页面（jsx/mjs/cpt 状态、是否待重建）',
      parameters: z.object({ project: z.string().optional() }),
      execute: async ({ project }) => pages.listPages(project)
    }),

    read_page: tool({
      description: '读取当前项目内受管页面的 JSX 源码；页面端型由 project.yaml 决定。',
      parameters: z.object({ project: z.string(), page: z.string() }),
      execute: async ({ project, page }) => {
        const meta = pages.listPages(project).find((item) => item.name === page)
        return { page, platform: meta?.platform ?? 'desktop', content: pages.readPage(project, page) }
      }
    }),

    write_page: tool({
      description: `写入 project.yaml 已声明的新页面 JSX 源码（具体项目内路径由清单决定）。同名页面源码已存在时默认拒绝，先 read_page 后用 patch_page 修改；仅用户明确要求整份替换时才传 overwrite=true。
页面运行约定：直接使用全局 React/ReactDOM/antd/dayjs/$/PATH（禁止 import、禁止重新声明 PATH、不要自行创建 app-root）。
调接口统一走 PATH.apiBase + '/api/data'，report_path 用 PATH.getDataTemplate('xx_data.cpt')。${API_DATA_REQUEST_CONTRACT}`,
      parameters: z.object({
        project: z.string(),
        page: z.string(),
        content: z.string().min(1),
        overwrite: z.boolean().default(false).describe('仅在用户明确要求整份覆盖时设为 true')
      }),
      execute: async ({ project, page, content, overwrite }) => {
        pages.savePage(project, page, content, { overwrite })
        return { ok: true }
      }
    }),

    patch_page: tool({
      description: `精确修改已有受管页面 JSX 的一个片段。old_text 必须与当前页面内容完全一致且只出现一次；找不到或命中多处会拒绝写入，需先 read_page 获取更准确上下文。new_text 可为空以删除该片段。
页面运行约定：直接使用全局 React/ReactDOM/antd/dayjs/$/PATH（禁止 import、禁止重新声明 PATH、不要自行创建 app-root）。${API_DATA_REQUEST_CONTRACT}`,
      parameters: z.object({ project: z.string(), page: z.string(), old_text: z.string().min(1), new_text: z.string() }),
      execute: async ({ project, page, old_text, new_text }) => {
        pages.patchPage(project, page, old_text, new_text)
        return { ok: true }
      }
    }),

    create_page: tool({
      description: '从脚手架新建页面。桌面端支持 blank/list/form；移动端使用 mobile（React + antdMobile）。双端项目必须明确 platform。',
      parameters: z.object({
        project: z.string(),
        page: z.string(),
        starter: z.enum(['blank', 'list', 'form', 'mobile']).default('blank'),
        platform: z.enum(['desktop', 'mobile']).optional()
      }),
      execute: async ({ project, page, starter, platform }) => { pages.createPage(project, page, starter === 'mobile' ? 'blank' : starter, platform ?? (starter === 'mobile' ? 'mobile' : undefined)); return { ok: true } }
    }),

    update_page_paths: tool({
      description: `修改已受管页面的 JSX / MJS / CPT 项目内相对路径，并移动已有受管文件。
仅在用户明确要求调整目录或产物位置时调用；不会覆盖传统 CPT 或其他未受管文件。必须 confirm=true。`,
      parameters: z.object({
        project: z.string(),
        page: z.string(),
        platform: z.enum(['desktop', 'mobile']).optional().describe('可选；切换页面端型时必须明确指定'),
        jsx: z.string().min(5).describe('项目根目录内的 .jsx 相对路径'),
        mjs: z.string().min(5).describe('项目根目录内的 .mjs 相对路径'),
        cpt: z.string().min(5).describe('项目根目录内的 .cpt 相对路径'),
        confirm: z.literal(true).describe('确认移动现有受管文件并修改 project.yaml')
      }),
      execute: async ({ project, page, platform, jsx, mjs, cpt, confirm }) => {
        if (!confirm) return { ok: false, error: '需要 confirm=true' }
        const current = pages.listPages(project).find((item) => item.name === page)
        if (!current) throw new Error(`页面不存在：${page}`)
        pages.updatePagePaths(project, page, { platform: platform ?? current.platform, jsx, mjs, cpt })
        return { ok: true, page, platform: platform ?? current.platform, paths: { jsx, mjs, cpt } }
      }
    }),

    build_page: tool({
      description: '编译页面：jsx → esbuild → 净化 → 注入骨架 → 同目录产出 .mjs 和 .cpt（质量门不过则 CPT 不落盘）',
      parameters: z.object({ project: z.string(), page: z.string() }),
      execute: async ({ project, page }) => pages.buildPage(project, page)
    }),

    open_page: tool({
      description: '用帆软 URL 打开页面预览，并等待初始加载后返回本轮捕获的 data 接口 HTTP 4xx/5xx、网络失败、JS error 与页面加载错误。用户可在窗口中手工操作；此工具不代替 build_page。',
      parameters: z.object({
        project: z.string(),
        page: z.string(),
        settleMs: z.number().int().min(300).max(5000).optional().describe('页面加载完成后继续采集的毫秒数，缺省 1200')
      }),
      execute: async ({ project, page, settleMs }) => {
        const { openPreviewAndCollect } = await import('../windows')
        const url = pages.pagePreviewUrl(project, page)
        const diagnostics = await openPreviewAndCollect(url, { project, page }, settleMs)
        return { ok: true, url, diagnostics }
      }
    }),

    collect_page_errors: tool({
      description: `读取当前项目预览窗口持续采集的运行错误，不会操作页面。
用户在预览窗口手工点击、筛选或提交后反馈“刚才操作报错”时调用。只返回当前 Agent 项目的窗口；page 缺省时列出该项目全部已打开/最近关闭的预览，指定 page 可缩小范围。
采集范围：/webroot/decision/api/data 的 HTTP 4xx/5xx 或网络失败、error 级 JS 控制台消息、页面主框架加载失败。`,
      parameters: z.object({
        project: z.string(),
        page: z.string().optional().describe('可选页面名；不确定时省略以查看当前项目全部预览')
      }),
      execute: async ({ project, page }) => {
        const { collectPreviewErrors } = await import('../windows')
        return collectPreviewErrors(project, page)
      }
    }),

    inspect_legacy_cpt: tool({
      description: `按需检查当前项目内的传统 CPT（未被 project.yaml 管理），不会返回或修改整份 XML。
先用 overview 了解数据集、表单控件、事件和引用；需要细节时再按 datasets / parameters / widgets / scripts / references 分区读取。
path 必须来自用户通过 @ 附加的传统 CPT，或当前项目的传统 CPT 列表；可用 query 过滤、cursor 翻页。脚本、数据集和布局项均有严格的单次返回上限，继续读取请使用 nextCursor。`,
      parameters: z.object({
        project: z.string(),
        path: z.string().min(1).describe('当前项目内传统 CPT 的相对路径'),
        view: z.enum(['overview', 'datasets', 'parameters', 'widgets', 'scripts', 'references']).default('overview'),
        query: z.string().max(200).optional().describe('仅返回匹配文本的记录'),
        cursor: z.number().int().min(0).optional().describe('从第几条记录开始分页'),
        limit: z.number().int().min(1).max(20).optional().describe('本次最多返回的记录数')
      }),
      execute: async ({ project, path, view, query, cursor, limit }) =>
        legacyCpt.inspectLegacyCpt(project, path, { view, query, cursor, limit })
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

  }
}
