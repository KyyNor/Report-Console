# 设计备忘（Design Backlog）

> 待逐项设计的需求清单。每项设计定稿后移入实现，并从本文件勾销。

---

## #1 连接清单 + 项目制重组（2026-08-16 提出 / 08-17 拍板 / **08-17 已落地**）

### ✅ 已落地（commit 见 git log `feat(v2)`）

1. **连接是一等公民，应用内注册**：`connections` 表 + 连接页 CRUD + 连通测试；`_data.cpt` TableData `DatabaseName` 与管理面 SQL（只读/受控写/过程管理）均按连接名路由（mysqlService 多连接池）。
2. **项目制**：`projects` + `project_connections`；绑定一个 reportlets 目录，自动三分 `data/` + `pages/` + `meta/`。v1 模块存量自动迁移（含 settings mysql* → 连接种子）。
3. **项目绑多个连接**；接口（数据集）单一归属 + 各绑一个连接（须在项目绑定清单内）。
4. **一项目一页 `_data.cpt`，页内多连接**（生成器每数据集 dbConnection，单测覆盖）。
5. **存储过程归属项目 + 关联共享**（`proc_links` 引用不复制）；定义以 `meta/{name}.sql` 为源，「应用」DROP+CREATE 审计落库。
6. **元数据目录 meta/**：需求/设计 .md + 过程语句 .sql，工作台第四组资源，Agent 可读写（read_doc/write_doc 工具）。
7. **三栏工作台**（左项目/中四组资源/右操作面板 + 内嵌 Agent）：按 `docs/prototypes/workbench.html` 深色 tech-utility 原型落地；无边框窗口自绘标题栏；五视图导航（总览/项目/连接/Agent/设置）。
8. **Agent**：沿用 pi 引擎；工具集换项目制 API；工作台右栏「用 Agent 做」带上下文唤起（与 Agent 页共享单例会话）。
9. selftest 27 步全绿；冒烟四视图截图核验。

### 遗留小项（不阻塞，随手改）

- [ ] 工作台头部「新建」菜单的页面子菜单目前复用 prompt 输入页面名，可换成正式弹层
- [ ] 文档重命名入口（docrename modal 已实现，中栏右键/菜单未接）
- [ ] pi-chat-panel 在 420px 右栏的进一步适配（深色变量已对齐，细节字号可再调）
