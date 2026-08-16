# AGENTS.md — Report Console 开发指引

面向 AI 编码代理与人类协作者的项目约定。**本文件是代理指引的唯一事实来源**（CLAUDE.md 等仅指向此处，勿在别处复制内容）。

## 项目是什么

帆软（FineReport）加壳开发控制台：Electron 桌面应用，把「数据库（建表/存储过程）→ 数据层（`_data.cpt`）→ 页面（jsx → mjs → cpt）」三层开发统一管理、原地构建、实测验证，内置 AI Agent（OpenAI / Anthropic 兼容）代劳开发。原 Python 工具链已全部移植为应用内 TypeScript，**无 Python 依赖**。

## 常用命令

```bash
npm install          # postinstall 自动 rebuild better-sqlite3（换 Node 版本后需重跑）
npm run dev          # 开发模式（electron-vite，热更新）
npm test             # vitest 单元测试（CPT 生成/变换/质量门，含 Python 黄金对照）
npm run typecheck    # tsc --noEmit
npm run selftest     # 集成自检：构建后对真实帆软+MySQL 跑 22 步全链路（幂等，exit 0/1）
npm run smoke        # 冒烟：构建后启动并截图 smoke.png
npm run pack         # electron-builder 打包（dist/，不装 dmg）
```

`selftest` / `smoke` / `dev` 依赖真实环境：本机 FineReport（默认 `http://localhost:8075`）、MySQL、可写的 reportlets 目录。没有该环境时只跑 `npm test` + `npm run typecheck`。

## 环境配置（重要）

代码与文档中**禁止出现任何本机值**：绝对路径、数据库账号/密码、业务库名。机器相关配置只有两个合法去处：

1. 应用「设置」页（UI 填写）；
2. SQLite 持久层 `~/Library/Application Support/report-console/data.sqlite3` 的 `settings` 表（首次使用前可直接 INSERT，列名见 `src/main/db.ts`）。

`db.ts` 的 `DEFAULT_SETTINGS` 保持中性（空密码/空路径/空库名）。新机器接入流程 = clone → install → 设置页填三项（帆软地址、reportlets 路径、MySQL）→ selftest 验证。

## 架构地图

```
src/main/               Electron 主进程
  index.ts              入口：单实例锁、--selftest / --smoke 模式
  db.ts                 SQLite（契约/测试/构建/审计/会话的唯一持久层，WAL）
  modules.ts            模块与接口契约 CRUD + 数据层 CPT 构建 + /api/data 实测
  pagesService.ts       页面读写 + 原地构建（jsx → mjs + cpt）+ 预览 URL
  mysqlService.ts       mysql2 连接池 + 只读守卫 + 存储过程管理（审计落 ddl_log）
  frClient.ts           帆软 /api/data 封装 + 连通探测 + 预览 URL
  cpt/                  核心资产：dataWriter / displayWriter / jsTransform / checker
  agent/tools.ts        平台动作的模型侧暴露面（20+ 工具；SYSTEM_PROMPT 在 @shared/agentPrompt）
  agent/piBridge.ts     工具 JSON Schema 导出 + 受控执行（渲染层 pi Agent 经 pi:toolDefs/pi:toolExec 调用）
  agent/agentService.ts 旧版 Vercel AI SDK 会话（保留待退役）
  selftest.ts           22 步全链路自检（建表→过程→契约→构建→实测→页面→预览）
  templates/            数据/页面 CPT 骨架（?raw 导入）+ 页面脚手架 blank/list/form
src/renderer/           React 19 + antd 5 + CodeMirror，六个视图
  （总览 / 数据接口 / 存储过程 / 页面 / Agent / 设置）
  agent/piAgent.ts      pi Agent 工厂：@earendil-works/pi-agent-core 跑在渲染层，
                        工具经 IPC 桥回主进程；无 Key 时回落 faux 演示模式
  agent/piSessions.ts   会话持久化：官方 SessionsStore + IndexedDB（随 userData 走），
                        启动恢复最近会话、message_end/agent_end 自动快照
  views/AgentView.tsx   官方 @earendil-works/pi-web-ui 组件（<pi-chat-panel>，light DOM），
                        主题经 CSS 设计变量对齐 antd（见 global.css .rc-pi-agent）
src/shared/types.ts     主进程/渲染层/Agent 工具共用的类型
src/shared/agentPrompt.ts Agent 系统提示词（新旧引擎共用）
tests/cpt.test.ts       vitest，与 Python 工具链产物做黄金结构对照
```

路径别名 `@shared/*` → `src/shared/*`（tsconfig + electron.vite.config.ts 都配了）。

## 不可破坏的约束

这些是项目的安全底线，任何改动不得绕过：

1. **CPT 只能由 build 产出**。`_data.cpt`/页面 `.cpt` 只能经 `buildDataCpt`/`buildPage` 生成，禁止手写文件、禁止给模型（人或 Agent）提供绕过构建管线的写入口。
2. **质量门一票否决**。`cpt/checker.ts` 产出 error 级 finding 时拒绝落盘（数据层整体不落，页面层 .cpt 不落但保留 .mjs 供排查）。不得为了"先跑通"降级 error 或跳过检查。
3. **SQL 双通道**。读走 `readOnlyQuery`（前缀白名单 SELECT/SHOW/DESCRIBE/EXPLAIN/WITH + 自动 LIMIT + 禁多语句）；写走 `guardedExec`，Agent 侧 `sql_exec` 必须显式 `confirm:true` 且全量审计到 `ddl_log`。
4. **formula 参数不随请求传递**。当前用户类变量（如 `=$fine_username`）声明为 `formula` 类型，由帆软会话注入；`testDataset` 构造请求时会过滤掉它们，别改这个行为。
5. **页面运行约定**。业务 jsx 直接用全局 React/antd/dayjs/$/PATH，不写 import、不重建 PATH、不自建 `app-root`——骨架（base_cpt_page.cpt）负责兜底加载与挂载点。

## 开发约定

- 接口命名：`{m}_qry`（列表，含 `p_page`/`p_pagesize`/`p_keyword`）、`{m}_total`、`{m}_by_id`、`dict_{x}`、`{m}_insert/_update/_delete`（CALL 存储过程）。
- 列表 SQL 自行分页：`LIMIT ${(p_page-1)*p_pagesize}, ${p_pagesize}`；可选条件用帆软公式 `${if(len(p_x)==0,""," AND ...")}`。
- 写操作必须走存储过程且 `SELECT JSON_OBJECT(...)` 返回结果（selftest 的 insert/delete 闭环依赖此约定）。
- 接口测试 POST `/webroot/decision/api/data`，`page_number/page_size` 恒 `-1`，业务分页走 parameters；`err_code=0` 才算通过。
- 模块名/接口名/页面名仅允许 `[a-z][a-z0-9_]*`（会成为 reportlets 目录/文件名），`assertModuleName`/正则校验别放松。

## 测试与验证要求

- 改 `src/main/cpt/**` 或骨架模板：必须跑 `npm test`（黄金对照保证与既有 Python 产物结构等价），并视改动补用例。
- 不允许删改黄金对照断言来"让测试通过"；生成逻辑与断言要同步演进并说明理由。
- 改主进程服务（modules/pagesService/mysqlService/agent）：至少 `npm run typecheck`；能起真实环境时跑 `npm run selftest` 确认 22 步全绿。
- 提交信息风格沿用历史：`feat(scope):` / `fix(scope):` / `chore:` + 中文摘要。

## 已知坑

- better-sqlite3 是原生模块，Electron 版本变化后 `npm install`（postinstall 会 `electron-builder install-app-deps`）；报 ABI 不匹配先重装依赖。
- 骨架模板用 Vite `?raw` 导入，改模板文件后 dev 模式会热更新，但 selftest/smoke 走的是构建产物，需要重新 build。
- SQLite 时间列用 `datetime('now','localtime')`（本地时区），别混用 ISO UTC。
- 帆软 `/api/data` 的参数 `type` 用 `String/Integer/Double`（首字母大写），与契约内小写类型是两套表示（`modules.ts` 的 typeMap 负责映射）。
