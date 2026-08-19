# AGENTS.md — Report Console 开发指引

面向 AI 编码代理与人类协作者的项目约定。**本文件是代理指引的唯一事实来源**（CLAUDE.md 等仅指向此处，勿在别处复制内容）。

## 项目是什么

帆软（FineReport）加壳开发控制台：Electron 桌面应用，把「数据库（建表/存储过程）→ 数据层（`_data.cpt`）→ 页面（jsx → mjs → cpt）」三层开发统一管理、原地构建、实测验证，内置 AI Agent（pi 引擎，OpenAI / Anthropic 兼容）代劳开发。原 Python 工具链已全部移植为应用内 TypeScript，**无 Python 依赖**。

## 组织模型（v2 项目制，务必先读）

- **连接（Connection）是一等公民**：应用内注册表（SQLite `connections` 表），一条连接 = 一个 MySQL 连接，名字与帆软设计器里的数据连接**一一对应**。`_data.cpt` 的 TableData `DatabaseName` 与管理面 SQL 都按连接名路由。
- **项目（Project）是顶层组织单元**：绑定一个项目目录（任意位置均可，缺省 `reportlets/{name}` 自动三分 `data/` + `pages/` + `meta/`）与**多个连接**；目录内 **`project.yaml` 是可迁移的项目事实来源**，记录身份、连接、受管数据/页面产物和接口/过程契约。SQLite 只记录“本机是否添加该目录”、环境、连接及运行历史，绝不决定资源布局；「打开项目」凭 YAML 将本地目录注册进本机账本。旧 `project.json` 仅兼容读取，后续写入升级为 YAML。项目名/接口名/页面名仅允许 `[a-z][a-z0-9_]*`。
- **受管产物与传统 CPT 必须区分**：`project.yaml.managed` 只记录由 Report Console 管理的 jsx/mjs/cpt；项目内其他 `.cpt` 一律为传统 CPT，平台不得把它们误纳入清单、覆盖或删除。默认目录仅是新项目约定，受管路径可为任何项目内相对路径。
- **接口（数据集）单一归属项目**，各绑一个连接（从项目绑定清单中选）；契约保存在 `project.yaml`，构建为清单指定的一个数据 CPT，**一项目一页、页内多连接**。
- **存储过程归属项目创建**；过程定义路径由 `project.yaml` 声明（默认 `meta/{name}.sql`）。跨项目过程关联是人工界面治理动作，Agent 无权发现、关联或读取其他项目过程。
- **文档（meta/）**：需求/设计 `.md` / `.txt` / `.html` 与过程创建语句 `.sql` 默认在项目 meta/ 目录；可通过工作台导入文本型文档并自动复制到这里，Agent 可读写作为上下文。HTML 只作为文本，不执行或嵌入。过程定义可按清单使用其他项目内相对路径。

## 常用命令

```bash
npm install          # postinstall 自动 rebuild better-sqlite3（换 Node 版本后需重跑）
npm run dev          # 开发模式（electron-vite，热更新）
npm test             # vitest 单元测试（CPT 生成/变换/质量门，含 Python 黄金对照）
npm run typecheck    # tsc --noEmit
npm run design-lib:sync  # 设计库同步：克隆 ui-ux-pro-max-skill 上游 → 按剔除/精简清单转 jsonl 入库 + 差异报告
                          #  （--inspect 看上游列名/条目名；--dry-run 只出报告；--json 机器可读）
npm run selftest     # 集成自检：构建后对真实帆软+MySQL 跑 27 步全链路（幂等，exit 0/1）
npm run smoke        # 冒烟：构建后启动并截图 smoke.png（SMOKE_VIEW=agent|workbench|connections 深链；
                      #  SMOKE_AUTOSEND=1 自动发消息、SMOKE_WAIT_MS 控制截图前等待，探针输出聊天 DOM 统计与会话落库校验）
npm run pack         # electron-builder 打包（dist/，仅目录产物）
npm run dist         # electron-builder 按当前平台出安装包（mac: dmg arm64/x64 · win: 单 exe portable · linux: AppImage）
                      #  CI：推 v* 标签触发 .github/workflows/release.yml，三平台云端编译并自动挂到 GitHub Release
```

`selftest` / `smoke` / `dev` 依赖真实环境：本机 FineReport（默认 `http://localhost:8075`）、注册表里至少一条可达连接、可写的 reportlets 目录。没有该环境时只跑 `npm test` + `npm run typecheck`。

## 环境配置（重要）

代码与文档中**禁止出现任何本机值**：绝对路径、数据库账号/密码、业务库名。机器相关配置只有两个合法去处：

1. 应用 UI（「设置」页填帆软地址/reportlets/模型；「连接」页注册 MySQL 连接）；
2. SQLite 持久层 `~/.config/report-console/data.sqlite3`（macOS/Linux，路径统一在 `src/main/index.ts` 启动早期设置；Windows 走系统默认 `%APPDATA%/report-console`；macOS 首次启动自动迁移旧 `~/Library/Application Support/report-console`）（`settings` 与 `connections` 表，列名见 `src/main/db.ts`）。

`db.ts` 的 `DEFAULT_SETTINGS` 保持中性（空密码/空路径）。新机器接入流程 = clone → install → 设置页填两项（帆软地址、reportlets 路径）→ 「连接」页注册连接（名字与帆软数据连接一致）→ selftest 验证。

## 架构地图

```
src/main/               Electron 主进程
  index.ts              入口：单实例锁、--selftest / --smoke 模式（含 pi 会话持久探测）
  db.ts                 SQLite（本机项目注册、连接、设置、测试/构建/审计账本，WAL；含 v1 模块制存量迁移）
  connectionsService.ts 连接注册表 CRUD（名字唯一、删除前查引用）
  projectManifest.ts    project.yaml 读取/校验/写入、旧项目迁移、受管路径与传统 CPT 识别
  projectsService.ts    项目制核心：项目与连接绑定（目录任意位置 + project.yaml 自描述，支持打开本地项目）、
                        接口契约（各绑连接）、数据层构建、实测、过程归属/关联（定义存 meta/）、项目文档（meta/）、导入导出
  pagesService.ts       页面读写 + 原地构建（jsx → mjs + cpt）+ 安全调整受管路径 + 预览 URL（按项目过滤）
  mysqlService.ts       按连接路由的多连接池 + 只读守卫 + 受控写（审计落 ddl_log，带连接名）
  frClient.ts           帆软 /api/data 封装 + 连通探测 + 预览 URL
  cpt/                  核心资产：dataWriter（支持每数据集 dbConnection）/ displayWriter / jsTransform / checker / legacyInspector
  legacyCptService.ts   传统 CPT 的当前项目、只读、结构摘要入口（5MB 上限）
  agent/tools.ts        平台动作的模型侧暴露面（契约/过程/文档/页面/SQL/传统 CPT/设计库；SYSTEM_PROMPT 在 @shared/agentPrompt）
  agent/piBridge.ts     工具 JSON Schema 导出 + 受控执行；强制注入当前项目和允许连接范围
  agent/designlib.ts    内置设计库合并检索（BM25 + 中文二元组/中英扩展；数据在 agent/designlib/data/*.jsonl，?raw 内联打包）
  selftest.ts           27 步全链路自检（连接→建表→过程→项目→契约→构建→实测→页面→预览→文档）
  templates/            数据/页面 CPT 骨架（?raw 导入）+ 页面脚手架 blank/list/form
src/renderer/           React 19 + CodeMirror，浅色 tech-utility 主题、深色代码块（样式移植 docs/prototypes/workbench.html）
  App.tsx               自绘标题栏（无边框窗口）+ 图标侧栏五入口：总览/项目(工作台)/连接/Agent/设置
  views/workbench/      三栏工作台：左=项目选择器+环境状态，中=四组资源（接口/过程/页面/文档），
                        右=操作面板（构建/实测/编辑/弹层确认）+ 内嵌 Agent（与 Agent 页共享单例会话）
  views/ConnectionsView.tsx  连接注册表管理（CRUD + 连通测试）
  agent/piAgent.ts      pi Agent 工厂：@earendil-works/pi-agent-core 跑在渲染层，
                        工具经 IPC 桥回主进程；未配置 Key 时初始化直接失败（界面横幅提示并引导去设置页）；getSharedPiAgent 共享单例。
                        模型唯一入口是设置页（自研聊天界面没有模型选择器），
                        会话恢复与 streamFn 对未注册 provider 一律回落当前配置（否则报 Unknown provider）
  agent/piSessions.ts   会话持久化：自研 IndexedDB 存储（库 rc-pi-sessions，随 userData 走），
                        启动恢复最近会话、message_end/agent_end 自动快照
  agent/chat/           自研聊天 UI（替代 pi-web-ui）：PiChat 订阅 Agent 事件流渲染
                        消息/流式/思考/工具块（调用与结果配对、运行中自动展开），
                        Markdown 为 markdown-it（html:false 默认转义）+ 复用 ui.tsx hl() 高亮
  views/AgentView.tsx   Agent 页壳（初始化/新建会话/状态），聊天主体是 agent/chat/PiChat
src/shared/types.ts     主进程/渲染层/Agent 工具共用的类型（v2：Connection/Project/Dataset+connection/ProcRecord/DocMeta）
src/shared/agentPrompt.ts Agent 系统提示词（项目制约定内化）
tests/cpt.test.ts       vitest，与 Python 工具链产物做黄金结构对照（含页内多连接用例）
```

路径别名 `@shared/*` → `src/shared/*`（tsconfig + electron.vite.config.ts 都配了）。

## 不可破坏的约束

这些是项目的安全底线，任何改动不得绕过：

1. **CPT 只能由 build 产出**。`_data.cpt`/页面 `.cpt` 只能经 `buildDataCpt`/`buildPage` 生成，禁止手写文件、禁止给模型（人或 Agent）提供绕过构建管线的写入口。
2. **质量门一票否决**。`cpt/checker.ts` 产出 error 级 finding 时拒绝落盘（数据层整体不落，页面层 .cpt 不落但保留 .mjs 供排查）。不得为了"先跑通"降级 error 或跳过检查。
3. **SQL 双通道**。读走 `readOnlyQuery`（前缀白名单 SELECT/SHOW/DESCRIBE/EXPLAIN/WITH + 自动 LIMIT + 禁多语句）；写走 `guardedExec`（按连接路由），Agent 侧 `sql_exec` 必须显式 `confirm:true` 且全量审计到 `ddl_log`。
4. **formula 参数不随请求传递**。当前用户类变量（如 `=$fine_username`）声明为 `formula` 类型，由帆软会话注入；`testDataset` 构造请求时会过滤掉它们，别改这个行为。
5. **页面运行约定**。业务 jsx 直接用全局 React/antd/dayjs/$/PATH，不写 import、不重建 PATH、不自建 `app-root`——骨架（base_cpt_page.cpt）负责兜底加载与挂载点。
6. **连接引用完整性**。删除连接前必须确认无接口/过程引用（`deleteConnection` 已拦截）；接口/过程的 `connection` 必须来自项目绑定清单（`saveDataset`/`saveProcedure` 已拦截）。
7. **传统 CPT 只读隔离**。Agent 只能用 `inspect_legacy_cpt` 查看当前项目、未列入 `project.yaml.managed` 的 CPT 摘要；不可读取整份 XML、不可写入，且不得利用模型参数越过项目或路径范围。

## 开发约定

- 接口命名：`{m}_qry`（列表，含 `p_page`/`p_pagesize`/`p_keyword`）、`{m}_total`、`{m}_by_id`、`dict_{x}`、`{m}_insert/_update/_delete`（CALL 存储过程）。
- 列表 SQL 自行分页：`LIMIT ${(p_page-1)*p_pagesize}, ${p_pagesize}`；可选条件用帆软公式 `${if(len(p_x)==0,""," AND ...")}`。
- 写操作必须走存储过程且 `SELECT JSON_OBJECT(...)` 返回结果（selftest 的 insert/delete 闭环依赖此约定）。
- 接口测试 POST `/webroot/decision/api/data`，`page_number/page_size` 恒 `-1`，业务分页走 parameters；`err_code=0` 才算通过。
- 顺序强约定：数据接口先行、实测通过再做页面（Agent 系统提示词同样要求）。

## 设计库（精简自 ui-ux-pro-max-skill）

给应用内 Agent 用的设计知识库：产品类型/视觉风格/配色/UI 推理/UX 准则/图表选型/Web 与 React 规则，八个检索范围。**`agent/designlib/`（data/ 与 references/）只能由同步脚本产出，禁止手改**——调整内容一律改 `scripts/design-lib/config.mjs` 后重跑 `npm run design-lib:sync`（对齐「CPT 只能由 build 产出」的精神）。

- **同步模型**：脚本克隆上游最新代码到 `.design-lib-cache/`（已 gitignore）→ 按配置剔除/精简 → 转成 jsonl 落库 + manifest（记录来源 commit、条目数、sha256）。
- **配置两级**：`exclude` 按文件名整份剔除（字体/落地页/图标/stacks/GSAP 动效等）；`domains` 按 **文件名 + 条目名白名单** 精简（`entries: '*'` 表示小文件全收）。上游对精简文件**新增条目不会自动入库**，同步报告的「未入清单条目」会列出并标注自上次新增的，决定收录就把它加进 config 再同步一次。
- **上游结构变更防护**：缺文件/缺 key 列/缺配置列直接报错退出（提示先 `--inspect` 校准）；上游出现配置未覆盖的新文件会 WARNING 跳过，不静默入库。
- **运行时检索**：`agent/designlib.ts` 是合并检索工具（Okapi BM25，英文分词 + 中文二元组 + 少量中英扩展；长字段默认 300 字符截断），Agent 侧入口是 `search_design_lib` 工具（只读、全局，讨论模式亦可用）。改检索核心或同步纯函数：跑 `npm test`（tests/designLib.test.ts）。

## 测试与验证要求

- 改 `src/main/cpt/**` 或骨架模板：必须跑 `npm test`（黄金对照保证与既有 Python 产物结构等价），并视改动补用例。
- 不允许删改黄金对照断言来"让测试通过"；生成逻辑与断言要同步演进并说明理由。
- 改主进程服务（projects/pagesService/mysqlService/connectionsService/agent）：至少 `npm run typecheck`；能起真实环境时跑 `npm run selftest` 确认 27 步全绿。
- 改渲染层：`npm run smoke` 截图核对（`SMOKE_VIEW=workbench|connections|agent` 深链各视图）。
- 提交信息风格沿用历史：`feat(scope):` / `fix(scope):` / `chore:` + 中文摘要。

## 已知坑

- better-sqlite3 是原生模块，Electron 版本变化后 `npm install`（postinstall 会 `electron-builder install-app-deps`）；报 ABI 不匹配先重装依赖。
- 本机 `npm run dist` 打 mac x64 包时 electron-builder 会把 better-sqlite3 **就地重编译成 x86_64**，之后 arm64 的 dev 会报 dlopen「incompatible architecture」；跑一次 `npx electron-builder install-app-deps` 即可恢复 arm64。跨架构产物交给 CI 出，本地只打本机架构（`npx electron-builder --mac --arm64`）可避免。
- 骨架模板用 Vite `?raw` 导入，改模板文件后 dev 模式会热更新，但 selftest/smoke 走的是构建产物，需要重新 build。
- SQLite 时间列用 `datetime('now','localtime')`（本地时区），别混用 ISO UTC。
- 帆软 `/api/data` 的参数 `type` 用 `String/Integer/Double`（首字母大写），与契约内小写类型是两套表示（`projectsService.ts` 的 typeMap 负责映射）。
- v1 存量库首启会自动迁移（modules→legacy_modules、datasets→legacy_datasets、settings mysql* → connections 种子）；迁移逻辑幂等，别手改 legacy_* 表。
- 聊天 UI 是自研 React 组件（agent/chat/PiChat），视图状态由 Agent 事件驱动（rAF 合并刷新）；渲染必须走 Markdown 组件（markdown-it html:false），不要往 dangerouslySetInnerHTML 塞未转义的模型输出。
