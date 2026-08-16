# Report Console — 帆软加壳开发控制台

把「数据库（建表/存储过程）→ 数据层（_data.cpt）→ 页面（jsx → mjs → cpt）」三层开发收进一个 Electron 桌面应用，统一管理、原地构建、实测验证，并内置 AI Agent（OpenAI / Anthropic 兼容接口）代劳开发。

原 Python 工具链（data_writer / display_writer / checker）已全部移植为应用内 TypeScript 实现，**无 Python 依赖、无双栈**。

```
┌────────────────────────── Report Console (Electron) ──────────────────────────┐
│  总览        帆软/MySQL/reportlets 状态 + 资产规模 + 构建历史               │
│  数据接口    模块/数据集契约（SQLite）→ 构建 _data.cpt → /api/data 实测     │
│  存储过程    MySQL 过程清单/定义编辑 → DROP+CREATE（审计落库）→ CALL 试执行 │
│  页面        reportlets/{module}/pages/ 的 jsx 高亮编辑 → esbuild → mjs+cpt │
│              → 一键经帆软 URL（op=write&防缓存）打开预览                    │
│  Agent       平台动作即模型工具：接口/表/过程/页面全可代劳，质量门内建       │
│  设置        帆软地址、reportlets 路径、MySQL、LLM（协议/BaseURL/Key/模型）  │
└────────────────────────────────────────────────────────────────────────────┘
        │                                    │
        ▼                                    ▼
  FineReport :8075                    MySQL（whjcbb 等）
  /webroot/decision/api/data          表 + 存储过程（JSON 返回）
```

## 快速开始

```bash
npm install          # postinstall 自动 rebuild better-sqlite3
npm run dev          # 开发模式
npm test             # 核心库单元测试（CPT 生成/变换/质量门，含 python 黄金对照）
npx electron . --selftest   # 集成自检：对真实帆软+MySQL 跑完整链路（幂等）
npx electron . --smoke out.png  # 冒烟截图
npm run pack         # electron-builder 打包（dist/）
```

首次使用在「设置」里确认三项环境值（已预填本机发现值）：帆软地址、reportlets 路径、MySQL 连接；在「Agent」页配置模型（OpenAI 兼容 `/v1/chat/completions` 或 Anthropic 兼容 `/v1/messages`）。

## 核心概念

**接口契约（SQLite）**：模块 → 数据集（name/kind/params/sql）。命名约定 `{m}_qry / _total / _by_id / dict_{x} / _insert / _update / _delete`；SQL 用帆软公式（`${if(...)}`、`LIMIT ${(p_page-1)*p_pagesize}, ${p_pagesize}`）；当前用户类变量声明为 `formula` 类型参数（如 `=$fine_username`），由帆软会话注入，不随请求传递。

**数据层构建**：契约 → TableData XML 装配（CDATA 安全、参数类型映射）→ `reportlets/{module}/data/{module}_data.cpt`。质量门不过（结构缺失等 error）则拒绝落盘。

**页面构建（原地）**：`reportlets/{module}/pages/x.jsx` → esbuild（iife，treeShaking=false）→ 去注释（字符串保护 + \uXXXX 解码）→ Hook 解构转两步赋值 → 语法门 → CDATA 安全 → 注入骨架「开发者代码区」→ 同目录产出 `x.mjs` + `x.cpt`。质量门：PATH 遮盖检测、Unicode 转义残留、`_MJS_` 占位符残留、标签白名单。

**页面运行约定**（骨架内置，业务代码不用管）：React/antd/dayjs 全局兜底加载、`window.PATH`（apiBase / getDataTemplate / getTemplatePath）、隐藏帆软框架、`app-root` 挂载点。业务 jsx 只写组件，不写 import、不重建 PATH。

**接口测试**：直接 POST `/webroot/decision/api/data`（本机设计器无需登录态），`page_number/page_size` 恒 `-1`，业务分页走 parameters；测试历史落 SQLite。写操作通过 CALL 存储过程闭环验证（插入→可查→删除→不可查）。

**Agent**：Vercel AI SDK，20+ 平台工具（模块/接口 CRUD、构建、实测、页面读写/构建/打开、只读 SQL、受控 SQL 执行、存储过程管理、历史查询）。`sql_exec` 需显式 `confirm:true` 且全量审计；CPT 只能经 build 工具产出——模型想绕过质量门没有入口。

## 目录

```
src/main/           主进程
  cpt/              CPT 生成与质量门（python 工具链的 TS 移植）
  templates/        数据/页面骨架 + 页面脚手架（blank/list/form）
  db.ts             SQLite（契约/测试/构建/审计/会话）
  modules.ts        模块与接口管理 + 数据层构建 + 实测
  pagesService.ts   页面管理 + 原地构建 + 预览 URL
  mysqlService.ts   连接池/只读守卫/存储过程管理（审计）
  frClient.ts       /api/data 封装 + 服务探测
  agent/            AI SDK 工具集 + 流式会话
  selftest.ts       --selftest 全链路自检
src/renderer/       React + antd 六视图
tests/              vitest
```

## 已验证（2026-08-14，本机真实环境）

- vitest 10/10（含与 Python 工具链产物的黄金结构对照）
- `--selftest` 22 步全绿：建表 → 3 个 CRUD 存储过程 → 7 接口契约 → CPT 构建 → /api/data 全部 `err_code=0` → 存储过程写入/删除闭环 → 页面构建 → 预览可达
- 浏览器实测：生成页面在帆软 `op=write` 下完整渲染（antd 表格/分页/状态 Tag），帆软框架隐藏，仅余帆软自身良性 Console 噪音
