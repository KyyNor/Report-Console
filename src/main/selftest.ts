/**
 * 自检/演示模式（--selftest）
 *
 * 用平台自身的服务，对真实帆软 + MySQL 走一遍完整链路（v2 项目制）：
 *   建项目（绑定连接）→ 存储过程（insert/update/delete JSON）→ 接口契约
 *   → 构建 _data.cpt → /api/data 逐项实测 → 页面 jsx（列表脚手架）→ 构建 .mjs/.cpt → 预览 URL
 *
 * 全部幂等，可反复执行。结果以 JSON 打到 stdout，exit 0/1。
 * 连接取注册表第一个（本机需先在「连接」页注册，名字与帆软数据连接一致）。
 */

import type { BrowserWindow } from 'electron'
import * as projects from './projectsService'
import * as pages from './pagesService'
import * as sql from './mysqlService'
import * as conns from './connectionsService'
import { pingFrServer } from './frClient'

const DDL = `CREATE TABLE IF NOT EXISTS frdemo_book (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL COMMENT '书名',
  author VARCHAR(100) DEFAULT '' COMMENT '作者',
  category VARCHAR(50) DEFAULT '通用' COMMENT '分类',
  status VARCHAR(20) DEFAULT '在库' COMMENT '状态',
  create_time DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '入库时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='FR控制台演示-图书表'`

const SP_INSERT = `CREATE PROCEDURE sp_frdemo_book_insert(
  IN p_title VARCHAR(200), IN p_author VARCHAR(100), IN p_category VARCHAR(50), IN p_status VARCHAR(20)
)
BEGIN
  INSERT INTO frdemo_book (title, author, category, status) VALUES (p_title, p_author, p_category, p_status);
  SELECT JSON_OBJECT('success', TRUE, 'message', '新增成功', 'id', LAST_INSERT_ID()) AS result;
END`

const SP_UPDATE = `CREATE PROCEDURE sp_frdemo_book_update(
  IN p_id INT, IN p_title VARCHAR(200), IN p_author VARCHAR(100), IN p_category VARCHAR(50), IN p_status VARCHAR(20)
)
BEGIN
  UPDATE frdemo_book SET title = p_title, author = p_author, category = p_category, status = p_status WHERE id = p_id;
  SELECT JSON_OBJECT('success', TRUE, 'message', '更新成功') AS result;
END`

const SP_DELETE = `CREATE PROCEDURE sp_frdemo_book_delete(IN p_id INT)
BEGIN
  DELETE FROM frdemo_book WHERE id = p_id;
  SELECT JSON_OBJECT('success', TRUE, 'message', '删除成功') AS result;
END`

const KW = (col: string, p: string) =>
  `\${if(len(${p}) == 0, "", " AND ${col} LIKE '%" + ${p} + "%'")}`

interface StepResult { step: string; ok: boolean; detail?: unknown }

export async function runSelftest(_win?: BrowserWindow): Promise<{ ok: boolean; results: StepResult[] }> {
  const results: StepResult[] = []
  const step = async (name: string, fn: () => Promise<unknown> | unknown) => {
    try {
      const detail = await fn()
      results.push({ step: name, ok: true, detail })
    } catch (e) {
      results.push({ step: name, ok: false, detail: (e as Error).message })
    }
  }

  await step('环境：帆软服务可达', async () => {
    const r = await pingFrServer()
    if (!r.reachable) throw new Error(`不可达（${r.latencyMs}ms）`)
    return `${r.latencyMs}ms`
  })

  const conn = conns.getConnection()
  await step('环境：连接注册表', () => {
    if (!conn) throw new Error('注册表为空——请先在「连接」页注册（名字与帆软数据连接一致）')
    return conn.name
  })
  if (!conn) {
    return { ok: false, results }
  }
  const connRef = { name: conn.name }

  await step('环境：MySQL 可达', async () => {
    const r = await sql.pingConnection(conn)
    if (!r.reachable) throw new Error(r.error ?? '不可达')
    return `${conn.name} ${r.version}`
  })

  await step('存储过程：建表演示表 frdemo_book', () => sql.guardedExec(DDL, 'ddl', 'selftest: frdemo_book', connRef))

  // 项目（幂等 upsert）
  await step('项目：frdemo（绑定 ' + conn.name + '）', () => {
    const existing = projects.listProjects().find((p) => p.name === 'frdemo')
    if (existing) return '已存在'
    return projects.createProject('frdemo', [conn.name], 'Report Console 演示项目')
  })

  await step('存储过程：sp_frdemo_book_insert', () =>
    projects.saveProcedure('frdemo', { name: 'sp_frdemo_book_insert', connection: conn.name, comment: '演示新增', definition: SP_INSERT }))
  await step('存储过程：sp_frdemo_book_update', () =>
    projects.saveProcedure('frdemo', { name: 'sp_frdemo_book_update', connection: conn.name, comment: '演示更新', definition: SP_UPDATE }))
  await step('存储过程：sp_frdemo_book_delete', () =>
    projects.saveProcedure('frdemo', { name: 'sp_frdemo_book_delete', connection: conn.name, comment: '演示删除', definition: SP_DELETE }))
  await step('存储过程：应用 insert（DROP+CREATE）', () => projects.applyProjectProcedure('frdemo', 'sp_frdemo_book_insert'))
  await step('存储过程：应用 update', () => projects.applyProjectProcedure('frdemo', 'sp_frdemo_book_update'))
  await step('存储过程：应用 delete', () => projects.applyProjectProcedure('frdemo', 'sp_frdemo_book_delete'))

  await step('数据：确保演示记录存在', async () => {
    const r = await sql.readOnlyQuery('SELECT COUNT(*) AS c FROM frdemo_book', { connection: connRef })
    const c = Number((r.rows[0] as { c: number | string }).c)
    if (c === 0) {
      await sql.guardedExec(
        `INSERT INTO frdemo_book (title, author, category, status) VALUES
         ('三体','刘慈欣','科幻','在库'),
         ('活着','余华','文学','在库'),
         ('JavaScript权威指南','David Flanagan','技术','借出'),
         ('小王子','圣埃克苏佩里','文学','在库')`,
        'dml', 'selftest: seed books', connRef
      )
      return '已插入 4 条'
    }
    return `已有 ${c} 条`
  })

  // 接口契约（幂等 upsert）
  const datasets = [
    {
      name: 'book_qry', kind: 'list' as const, comment: '图书列表（分页+搜索）',
      params: [
        { name: 'p_page', type: 'integer' as const, default: '1' },
        { name: 'p_pagesize', type: 'integer' as const, default: '10' },
        { name: 'p_keyword', type: 'string' as const, default: '' }
      ],
      sql: `SELECT id, title, author, category, status, DATE_FORMAT(create_time, '%Y-%m-%d %H:%i') AS create_time
FROM frdemo_book WHERE 1=1 ${KW('title', 'p_keyword')} ORDER BY id DESC LIMIT \${(p_page - 1) * p_pagesize}, \${p_pagesize}`
    },
    {
      name: 'book_total', kind: 'stat' as const, comment: '总数统计',
      params: [{ name: 'p_keyword', type: 'string' as const, default: '' }],
      sql: `SELECT COUNT(*) AS total FROM frdemo_book WHERE 1=1 ${KW('title', 'p_keyword')}`
    },
    {
      name: 'book_by_id', kind: 'detail' as const, comment: '单条查询',
      params: [{ name: 'p_id', type: 'integer' as const, default: '1' }],
      sql: 'SELECT id, title, author, category, status FROM frdemo_book WHERE id = ${p_id}'
    },
    {
      name: 'dict_category', kind: 'dict' as const, comment: '分类字典',
      params: [],
      sql: "SELECT DISTINCT category AS value, category AS label FROM frdemo_book ORDER BY category"
    },
    {
      name: 'book_insert', kind: 'insert' as const, comment: '新增（存储过程）',
      params: [
        { name: 'p_title', type: 'string' as const, default: '' },
        { name: 'p_author', type: 'string' as const, default: '' },
        { name: 'p_category', type: 'string' as const, default: '通用' },
        { name: 'p_status', type: 'string' as const, default: '在库' }
      ],
      sql: "CALL sp_frdemo_book_insert('${p_title}', '${p_author}', '${p_category}', '${p_status}')"
    },
    {
      name: 'book_update', kind: 'update' as const, comment: '更新（存储过程）',
      params: [
        { name: 'p_id', type: 'integer' as const, default: '0' },
        { name: 'p_title', type: 'string' as const, default: '' },
        { name: 'p_author', type: 'string' as const, default: '' },
        { name: 'p_category', type: 'string' as const, default: '通用' },
        { name: 'p_status', type: 'string' as const, default: '在库' }
      ],
      sql: "CALL sp_frdemo_book_update(${p_id}, '${p_title}', '${p_author}', '${p_category}', '${p_status}')"
    },
    {
      name: 'book_delete', kind: 'delete' as const, comment: '删除（存储过程）',
      params: [{ name: 'p_id', type: 'integer' as const, default: '0' }],
      sql: 'CALL sp_frdemo_book_delete(${p_id})'
    }
  ]

  for (const ds of datasets) {
    await step(`契约：接口 ${ds.name}`, () => projects.saveDataset('frdemo', { ...ds, connection: conn.name }))
  }

  await step('构建：frdemo/data/frdemo_data.cpt', () => projects.buildDataCpt('frdemo'))

  await step('实测：全部接口（/api/data）', async () => {
    const tests = await projects.testAllDatasets('frdemo')
    const failed = tests.filter((t) => !t.ok)
    if (failed.length > 0) throw new Error(JSON.stringify(failed))
    return tests.map((t) => `${t.dataset}: err_code=${t.errCode}, rows=${t.rowCount}, ${t.durationMs}ms`)
  })

  // 写入类接口的副作用验证：insert → 查到 → 删除 → 查不到
  let probeId: number | null = null
  await step('实测：insert 写入闭环', async () => {
    const r = await projects.testDataset('frdemo', 'book_insert', { p_title: '__selftest_probe__', p_author: 'selftest', p_category: '通用', p_status: '在库' })
    const resp = r.response as { data?: Array<{ result?: string }> }
    const inner = JSON.parse(resp.data?.[0]?.result ?? '{}')
    probeId = Number(inner.id)
    if (!inner.success || !probeId) throw new Error(JSON.stringify(r.response))
    return `id=${probeId}`
  })
  await step('实测：delete 闭环清理', async () => {
    if (!probeId) throw new Error('无探针 id')
    const r = await projects.testDataset('frdemo', 'book_delete', { p_id: probeId })
    const q2 = await sql.readOnlyQuery(`SELECT COUNT(*) AS c FROM frdemo_book WHERE title = '__selftest_probe__'`, { connection: connRef })
    if (Number((q2.rows[0] as { c: number }).c) !== 0) throw new Error('探针未删除')
    return r.ok ? 'ok' : JSON.stringify(r.response)
  })

  // 页面：从 list 脚手架生成并构建
  await step('页面：创建 book_list.jsx', async () => {
    try {
      pages.createPage('frdemo', 'book_list', 'list')
    } catch {
      // 已存在则继续
    }
    const tpl = pages.readPage('frdemo', 'book_list')
    const customized = tpl
      .replace(/CHANGE_ME_data\.cpt/g, 'frdemo_data.cpt')
      .replace(/CHANGE_ME_qry/g, 'book_qry')
      .replace(/CHANGE_ME_total/g, 'book_total')
    pages.savePage('frdemo', 'book_list', customized, { overwrite: true })
    return 'frdemo/pages/book_list.jsx'
  })
  await step('页面：构建 book_list.mjs + .cpt', () => pages.buildPage('frdemo', 'book_list'))
  await step('页面：预览 URL 可达', async () => {
    const url = pages.pagePreviewUrl('frdemo', 'book_list')
    const res = await fetch(url, { redirect: 'manual' })
    if (res.status >= 500) throw new Error(`HTTP ${res.status}`)
    return url.slice(0, 120) + '…'
  })

  // 文档（meta/）
  await step('文档：meta/需求与过程语句', () => {
    projects.saveDoc('frdemo', '01-需求-图书演示.md', '# 图书演示 · 需求\n\nselftest 自动生成的演示项目：列表 / 字典 / 增删改存储过程闭环。\n', { overwrite: true })
    return 'frdemo/meta/01-需求-图书演示.md'
  })

  const ok = results.every((r) => r.ok)
  return { ok, results }
}
