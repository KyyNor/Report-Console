# Report Console — 帆软加壳开发控制台

把「数据库（建表/存储过程）→ 数据层（_data.cpt）→ 页面（jsx → mjs → cpt）」三层开发收进一个 Electron 桌面应用，统一管理、原地构建、实测验证，并内置 AI Agent（pi 引擎，OpenAI / Anthropic 兼容）代劳开发。

原 Python 工具链（data_writer / display_writer / checker）已全部移植为应用内 TypeScript 实现，**无 Python 依赖、无双栈**。

```
┌──────────────────────── Report Console（深色工作台） ────────────────────────┐
│  总览        环境状态 · 资产规模 · 构建历史                                  │
│  项目        三栏工作台：左选项目（连接徽章+资源计数），中浏览四组资源        │
│              （数据接口/存储过程/页面/文档），右操作面板（构建/实测/编辑/     │
│              破坏性确认/内嵌 Agent）                                        │
│  连接        连接注册表：一条连接 = 一个 MySQL 连接，与帆软数据连接同名       │
│  Agent       pi 引擎（@earendil-works）：会话持久化 IndexedDB，平台工具      │
│              经 IPC 桥回主进程执行，质量门/审计内建                          │
│  设置        帆软地址、reportlets 路径、LLM（协议/BaseURL/Key/模型）         │
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

**项目（Project）**：顶层组织单元，绑定一个 reportlets 子目录（自动三分 `data/` + `pages/` + `meta/`）与多个连接。**接口契约（SQLite）**：项目 → 数据集（name/kind/params/sql/connection）。命名约定 `{m}_qry / _total / _by_id / dict_{x} / _insert / _update / _delete`；SQL 用帆软公式（`${if(...)}`、`LIMIT ${(p_page-1)*p_pagesize}, ${p_pagesize}`）；当前用户类变量声明为 `formula` 类型参数（如 `=$fine_username`），由帆软会话注入，不随请求传递。

**数据层构建**：契约 → TableData XML 装配（CDATA 安全、参数类型映射、**每数据集各带连接名**）→ `reportlets/{project}/data/{project}_data.cpt`。一项目一页、页内多连接。质量门不过（结构缺失等 error）则拒绝落盘。

**存储过程**：归属项目创建，定义以 `meta/{name}.sql` 为源（版本化），「应用」= DROP IF EXISTS + CREATE（审计落库，可反复应用）。需要复用其他项目的过程走**关联**（引用不复制），接口 SQL 直接 CALL。写操作约定 `SELECT JSON_OBJECT(...)` 返回结果。

**文档（meta/）**：项目需求/设计文档（.md）与过程创建语句（.sql）放项目 meta/ 目录，Agent 可读写作为开发上下文。

**页面构建（原地）**：`reportlets/{project}/pages/x.jsx` → esbuild（iife）→ 去注释（字符串保护 + \uXXXX 解码）→ Hook 解构转两步赋值 → 语法门 → CDATA 安全 → 注入骨架「开发者代码区」→ 同目录产出 `x.mjs` + `x.cpt`。质量门：PATH 遮盖检测、Unicode 转义残留、`_MJS_` 占位符残留、标签白名单。

**页面运行约定**（骨架内置，业务代码不用管）：React/antd/dayjs 全局兜底加载、`window.PATH`（apiBase / getDataTemplate / getTemplatePath）、隐藏帆软框架、`app-root` 挂载点。业务 jsx 只写组件，不写 import、不重建 PATH。

**接口测试**：直接 POST `/webroot/decision/api/data`（本机设计器无需登录态），`page_number/page_size` 恒 `-1`，业务分页走 parameters；测试历史落 SQLite。写操作通过 CALL 存储过程闭环验证（插入→可查→删除→不可查）。

**Agent**：pi 引擎跑在渲染层（官方 pi-web-ui 组件），平台动作（连接/项目/契约/过程/文档/页面/SQL）以工具形式经 IPC 桥回主进程执行——质量门、SQL 审计、`confirm:true` 与手工操作共用同一套约束，**模型没有绕过质量门的入口**。会话持久化 IndexedDB，重启恢复；工作台右栏可带资源上下文唤起（与 Agent 页共享会话）。

## 目录

```
src/main/           主进程
  cpt/              CPT 生成与质量门（python 工具链的 TS 移植）
  templates/        数据/页面骨架 + 页面脚手架（blank/list/form）
  db.ts             SQLite（连接/项目/契约/状态账本，含 v1 存量迁移）
  connectionsService.ts  连接注册表
  projectsService.ts     项目制核心（契约/构建/实测/过程/文档）
  pagesService.ts   页面管理 + 原地构建 + 预览 URL
  mysqlService.ts   多连接池/只读守卫/受控写（审计）
  frClient.ts       /api/data 封装 + 服务探测
  agent/            pi 工具桥 + 平台工具集
  selftest.ts       --selftest 全链路自检（27 步）
src/renderer/       React 19 + CodeMirror，深色工作台（样式移植 docs/prototypes）
tests/              vitest
docs/               业务流程全景 / 设计备忘 / 工作台 UI 需求 / 原型
```

## 已验证（2026-08-17，本机真实环境）

- vitest 11/11（含 Python 工具链黄金对照 + 页内多连接用例）
- `--selftest` 27 步全绿：连接 → 建表 → 3 个 CRUD 存储过程（meta 语句落盘）→ 项目 → 7 接口契约 → CPT 构建 → /api/data 全部 `err_code=0` → 写入/删除闭环 → 页面构建 → 预览可达 → 文档
- 冒烟截图：总览/工作台三栏/连接/Agent 四视图深色主题完整渲染，v1 存量数据自动迁移（模块→项目、设置→连接）
