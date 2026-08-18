# Report Console — 帆软加壳开发控制台

把「数据库（建表/存储过程）→ 数据层（_data.cpt）→ 页面（jsx → mjs → cpt）」三层开发收进一个 Electron 桌面应用，统一管理、原地构建、实测验证，并内置 AI Agent（pi 引擎，OpenAI / Anthropic 兼容）代劳开发。

原 Python 工具链（data_writer / display_writer / checker）已全部移植为应用内 TypeScript 实现，**无 Python 依赖、无双栈**。

```
┌──────────────────────── Report Console（浅色工作台） ────────────────────────┐
│  总览        环境状态 · 资产规模 · 构建历史                                  │
│  项目        三栏工作台：左选项目，中浏览受管资源与传统 CPT，右栏默认 Agent  │
│              （点击资源临时查看详情，关闭后回到同一会话）                    │
│  连接        连接注册表：一条连接 = 一个 MySQL 连接，与帆软数据连接同名       │
│  Agent       pi 引擎（@earendil-works）：自研聊天、会话持久化 IndexedDB，    │
│              平台工具经 IPC 桥回主进程执行，质量门/审计内建                  │
│  设置        帆软地址、reportlets 路径、LLM（协议/Base URL/Key/模型/思考）    │
└────────────────────────────────────────────────────────────────────────────┘
        │                                    │
        ▼                                    ▼
  FineReport :8075                    连接注册表路由的 MySQL（多连接）
  /webroot/decision/api/data          表 + 存储过程（JSON 返回）
```

## 快速开始

```bash
npm install          # postinstall 自动 rebuild better-sqlite3
npm run dev          # 开发模式
npm test             # 核心库单元测试（CPT 生成/变换/质量门，含 python 黄金对照）
npm run typecheck    # tsc --noEmit
npm run selftest     # 集成自检：构建后对真实帆软+MySQL 跑完整链路（幂等，exit 0/1）
npm run smoke        # 冒烟：构建后启动并截图 smoke.png（SMOKE_VIEW=workbench 深链）
npm run pack         # electron-builder 打包（dist/）
```

代码内置默认值全部中性（无本机路径/账号/库名）。首次使用：**设置**页确认帆软地址与 reportlets 目录，**连接**页注册 MySQL 连接（名字与帆软设计器数据连接一致），**项目**页新建或扫描导入项目。所有配置持久化在本机 `~/Library/Application Support/report-console/data.sqlite3`，不进入代码仓库。配置完成后跑一次 `npm run selftest` 验证环境。

## 核心概念（v2 项目制）

**连接（Connection）**：应用内注册表，一条连接 = 一个 MySQL 连接（host/port/user/password/database），名字与帆软设计器里的数据连接**一一对应**。`_data.cpt` 的 TableData `DatabaseName` 与管理面 SQL（只读/受控写/过程管理）都按连接名路由，多连接并存。

**项目（Project）**：顶层组织单元，绑定一个任意位置的项目目录与多个连接。目录内的 **`project.yaml` 是可迁移的事实来源**：记录项目身份、连接名、受管数据 CPT、受管页面（jsx/mjs/cpt）和接口/过程契约；SQLite 仅保存“本机是否已添加该目录”、环境、连接与运行历史。新建项目默认创建 `data/`、`pages/`、`meta/`，但它们不是硬约束，所有受管产物均可放在项目内任意相对路径。旧 `project.json` 只读兼容，并会在后续保存时升级为 YAML。命名约定 `{m}_qry / _total / _by_id / dict_{x} / _insert / _update / _delete`；SQL 用帆软公式（`${if(...)}`、`LIMIT ${(p_page-1)*p_pagesize}, ${p_pagesize}`）；当前用户类变量声明为 `formula` 类型参数（如 `=$fine_username`），由帆软会话注入，不随请求传递。

**数据层构建**：`project.yaml` 中的契约 → TableData XML 装配（CDATA 安全、参数类型映射、**每数据集各带连接名**）→ 清单声明的受管数据 CPT。一项目一页、页内多连接。质量门不过（结构缺失等 error）则拒绝落盘。

**存储过程**：归属项目创建，定义文件路径由 `project.yaml` 声明（默认 `meta/{name}.sql`），「应用」= DROP IF EXISTS + CREATE（审计落库，可反复应用）。跨项目过程关联是人工治理动作，不暴露给 Agent；接口 SQL 直接 CALL。写操作约定 `SELECT JSON_OBJECT(...)` 返回结果。

**文档（meta/）**：项目需求/设计文档（.md）与过程创建语句（.sql）默认放项目 `meta/`，也可由过程契约声明其他项目内相对路径；Agent 可读写作为开发上下文。

**页面构建（原地）**：清单声明的 `x.jsx` → esbuild（iife）→ 去注释（字符串保护 + \uXXXX 解码）→ Hook 解构转两步赋值 → 语法门 → CDATA 安全 → 注入骨架「开发者代码区」→ 清单声明的 `x.mjs` 与 `x.cpt`。可在项目设置安全调整三者路径；目标位置存在传统 CPT 时拒绝覆盖。质量门：PATH 遮盖检测、Unicode 转义残留、`_MJS_` 占位符残留、标签白名单。

**页面运行约定**（骨架内置，业务代码不用管）：React/antd/dayjs 全局兜底加载、`window.PATH`（apiBase / getDataTemplate / getTemplatePath）、隐藏帆软框架、`app-root` 挂载点。业务 jsx 只写组件，不写 import、不重建 PATH。

**接口测试**：直接 POST `/webroot/decision/api/data`（本机设计器无需登录态），`page_number/page_size` 恒 `-1`，业务分页走 parameters；测试历史落 SQLite。写操作通过 CALL 存储过程闭环验证（插入→可查→删除→不可查）。

**传统 CPT**：不在 `project.yaml` 受管清单中的 `.cpt` 都视为传统 CPT，平台不会把它们误当生成产物或覆盖。Agent 可通过 `@` 附加传统 CPT，并用 `inspect_legacy_cpt` 分页读取结构摘要（概览、数据集、参数、组件、脚本、引用），不传整份 XML 进入上下文。

**Agent**：pi 引擎跑在渲染层，自研 `PiChat` 负责消息、流式、思考与工具块渲染；平台动作（契约/过程/文档/页面/SQL/传统 CPT 检查）以工具形式经 IPC 桥回主进程执行——质量门、SQL 审计、`confirm:true` 与手工操作共用同一套约束，**模型没有绕过质量门的入口**。系统提示词与桥接层都强制当前项目及其绑定连接，模型不能访问其他项目。会话持久化 IndexedDB；工作台右栏默认显示该项目的共享会话，资源可用 `@` 轻量附加，再按需调用查询工具。模型配置支持是否启用思考及思考级别。

## 目录

```
src/main/           主进程
  cpt/              CPT 生成与质量门（python 工具链的 TS 移植）
  templates/        数据/页面骨架 + 页面脚手架（blank/list/form）
  db.ts             SQLite（本机项目注册、连接、设置、构建/测试/审计账本，含 v1 存量迁移）
  connectionsService.ts  连接注册表
  projectManifest.ts     project.yaml 读取、校验、旧项目迁移、受管/传统 CPT 识别
  projectsService.ts     项目制核心（契约/构建/实测/过程/文档）
  pagesService.ts   受管页面管理 + 原地构建 + 预览 URL + 安全移动路径
  legacyCptService.ts    传统 CPT 的受限结构检查入口
  mysqlService.ts   多连接池/只读守卫/受控写（审计）
  frClient.ts       /api/data 封装 + 服务探测
  agent/            pi 工具桥 + 平台工具集（固定项目作用域）
  selftest.ts       --selftest 全链路自检（27 步）
src/renderer/       React 19 + CodeMirror，浅色 tech-utility 工作台与深色代码区
tests/              vitest
docs/               业务流程全景 / 设计备忘 / 工作台 UI 需求 / 原型
```

## 最近演进

- `project.yaml` 让项目目录自描述、可迁移；仅受管资源进入清单，传统 CPT 保持原样。
- 页面、数据 CPT 可放在项目内任意相对路径；页面路径可在界面或受控 Agent 工具中调整。
- 工作台右栏以 Agent 为默认入口，`@` 统一附加当前项目资源；工具调用严格限制在当前项目范围。
- 传统 CPT 提供受限、结构化、可分页的检查能力，避免大 XML 直接占用模型上下文。

## 已验证（2026-08-18，本机真实环境）

- vitest 16/16（含 Python 工具链黄金对照、页内多连接与传统 CPT 摘要用例）
- `--selftest` 27 步全绿：连接 → 建表 → 3 个 CRUD 存储过程（meta 语句落盘）→ 项目 → 7 接口契约 → CPT 构建 → /api/data 全部 `err_code=0` → 写入/删除闭环 → 页面构建 → 预览可达 → 文档
- 冒烟截图：工作台、连接、Agent 等视图完整渲染；旧版项目会无损迁移到 `project.yaml`
