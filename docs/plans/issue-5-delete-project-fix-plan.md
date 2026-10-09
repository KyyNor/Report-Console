# 删除项目按钮失效 —— 根因分析与修复方案

- 关联 issue：#5（删除项目按钮无效）
- 环境前提：用户使用 **Linux**
- 代码基线：`d8bd31b chore: 版本号升至 0.4.0`

---

## 一、问题原因

### 1. 直接原因：Electron 没有实现 `window.prompt`

`src/renderer/src/views/workbench/index.tsx:263-278`

```tsx
deleteProject: () => {
  if (!cur) return
  const input = prompt(`删除项目 ${cur}？仅解除管理（契约/关联清空），reportlets 产物保留。\n输入项目名确认：`)
  if (input === cur) {
    void (async () => { /* ... */ })()
  } else if (input !== null) {
    toast('项目名不匹配，已取消', 'err')
  }
}
```

Electron 出于架构设计**主动禁用了 `window.prompt`**（`alert` / `confirm` 保留），调用时直接抛出：

```
Uncaught Error: prompt() is and will not be supported.
```

参考：[electron/electron#7282](https://github.com/electron/electron/issues/7282)、StackOverflow《[Replace 'Prompt' in on Electron](https://stackoverflow.com/questions/38858879/replace-prompt-in-on-electron)》

### 2. 为什么用户完全看不到任何反馈

异常被**静默吞掉**，一共两道防线全部失效：

| 位置 | 问题 |
| --- | --- |
| `index.tsx:268` | `try/catch` 写在 `if (input === cur)` 块**内部**，异常在进入之前就抛出了 |
| `deleteProject: () => {...}` | 整个函数没有外层 `catch`，异常一路冒泡到 React 事件处理器 |
| 全局 | 渲染层未挂载 `window.onerror` / `unhandledrejection` 兜底 |

结果：**不弹窗、不提示、不删除、没报错**。用户只能开 DevTools 看 Console 才知道发生了什么。

### 3. 为什么「只坏了一个删除按钮」

同文件及其他文件里的删除操作分两类：

- 用 `confirm()` —— Electron **支持**，正常工作 ✅
  删除接口 / 过程 / 页面 / 文档 / 连接（`RightPanel.tsx:537,694,695,841,980`、`ConnectionsView.tsx:106`）
- 用 `prompt()` —— Electron **不支持**，必然失败 ❌
  删除项目（`index.tsx:265`）、新建页面（`index.tsx:687`）、检查点标题（`RightPanel.tsx:442`）

### 4. 同源缺陷：后端删除会「假成功」

`src/main/projectsService.ts:223`

```ts
export function deleteProject(id: number): void {
  getDb().prepare('DELETE FROM projects WHERE id=?').run(id)
}
```

`src/main/ipc.ts:171`

```ts
handle('projects:delete', (a) => { projects.deleteProject((a as { id: number }).id); return true })
```

调用方传的是 `curProject?.id`（`index.tsx:269`）。一旦为 `undefined`，SQL 会变成 `WHERE id=NULL` —— **删 0 行，但仍然 `return true`**，渲染层照样弹「已删除项目」的绿色 toast。

即使修好了前端确认框，只要 `curProject` 因任何原因取不到（比如列表刷新竞态），用户就会看到「删了但没删掉」，而且比现在更难排查。**这条独立于前端 bug，必须一并修。**

### 5. Linux 相关性

根因（`prompt()` 不可用）与操作系统无关，Linux / macOS / Windows 上表现一致，不存在「Linux 特有问题」。

但方案选型时 Linux 有两点实际约束：

- **不要引入原生 prompt 库**：`native-prompt`、`electron-osx-prompt` 这类依赖系统原生对话框的方案，在 Linux 上依赖 GTK/Qt 主题，行为与外观不可控，且 electron-builder 已配置 `linux:` target 需保持零新增原生依赖
- **沿用应用内自绘 Modal**：走项目已有的 React 组件体系，跨平台渲染完全一致，无新增依赖

---

## 二、修复方案

### 总体策略

用项目**已有的 Modal 体系**新增一个「输入项目名确认」的破坏性确认框，把三处 `prompt()` 一次性收敛掉，同时补齐后端校验与全局兜底。

**不引入任何第三方库，不新增 IPC 通道，不改数据库结构。**

### 复用资产（已核实）

| 资产 | 位置 | 用途 |
| --- | --- | --- |
| `Modal` 基件 | `components/ui.tsx:37` | 已支持 `tone="danger"`、`footer`、Esc 关闭、遮罩点击关闭 |
| `ApplyProcModal` | `workbench/modals.tsx:296` | **最佳模板**：已有 `input !== name` 时禁用按钮的成熟逻辑 |
| `DocNameModal` | `workbench/modals.tsx:482` | 单输入框 + 错误横幅的写法参考 |

### 实施步骤

#### 步骤 1：新增 `ConfirmDeleteProjectModal`

文件：`src/renderer/src/views/workbench/modals.tsx`

参照 `ApplyProcModal` 复制结构：

```
state: input（受控输入）、busy、err
标题：删除项目（破坏性操作）  icon="trash"  tone="danger"
正文：说明「仅解除管理，reportlets 产物保留」+ 项目目录路径
      + 输入框，placeholder 显示项目名
footer：说明文案 +「取消」+「确认删除」
按钮 disabled 条件：input !== projectName || busy
```

#### 步骤 2：接入工作台状态机

文件：`src/renderer/src/views/workbench/index.tsx`

1. `ModalState` 联合类型新增分支：`{ k: 'confirmdelete' }`
2. `deleteProject` 改为 `setModal({ k: 'confirmdelete' })`，**删掉 `prompt()` 与旧的内联 IIFE**
3. 在现有 `{modal?.k === ...}` 渲染块中新增一支：

```tsx
{modal?.k === 'confirmdelete' && curProject && (
  <ConfirmDeleteProjectModal
    projectName={curProject.name}
    dir={curProject.dir}
    onClose={() => setModal(null)}
    onConfirm={async () => {
      await call('projects:delete', { id: curProject.id })   // ← 传确定的 id
      toast(`已删除项目 ${cur}（产物保留在 ${curProject.dir}）`, 'ok')
      setModal(null); setCur(null); setSel(null)
      await loadProjects()
    }}
  />
)}
```

> 注意：这里传 `curProject.id` 而非 `curProject?.id`，从调用侧消除 `undefined` 的可能。

#### 步骤 3：后端加校验（关键，消除假成功）

文件：`src/main/projectsService.ts:223`

```ts
export function deleteProject(id: number): void {
  if (!Number.isInteger(id) || id <= 0) throw new Error('缺少项目 id，无法删除')
  const db = getDb()
  const r = db.prepare('SELECT name FROM projects WHERE id=?').get(id)
  if (!r) throw new Error('项目不存在或已被删除')
  db.prepare('DELETE FROM projects WHERE id=?').run(id)
}
```

文件：`src/main/ipc.ts:171` 保持不变 —— 现有 `handle` 包装已把 throw 转成 `{ error }` 传给渲染层，渲染层的 `catch` 会正确弹出错误 toast。

#### 步骤 4：收敛剩余两处 `prompt()`（同源缺陷，建议同 PR）

- `index.tsx:687` `askCreatePage` → 复用已有的 `DocNameModal`（先校验 `^[a-z][a-z0-9_]*$` 再提交）
- `RightPanel.tsx:442` 检查点标题 → 用 `DocNameModal`，保留取消语义

#### 步骤 5：加一道全局兜底（可选但推荐）

避免未来任何未捕获异常再次「静默失败」：

```ts
// 渲染层入口
window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason)
  toast(`未处理的错误：${e.reason?.message ?? e.reason}`, 'err')
})
```

---

## 三、验收标准

| # | 验收项 | 预期 |
| --- | --- | --- |
| 1 | 点击「删除项目」 | **弹出确认框**，不再是静默无反应 |
| 2 | 项目名输入不全 | 「确认删除」按钮保持禁用 |
| 3 | 输入正确项目名并确认 | 项目从列表消失，绿色 toast 提示，产物目录保留 |
| 4 | 取消 | 关闭弹窗，无任何副作用 |
| 5 | **Linux 下复测 1-4** | 与开发机行为完全一致（自绘 Modal 跨平台无差异） |
| 6 | 构造非法 id 调用 | 主进程抛错，界面显示错误 toast，**不再假成功** |
| 7 | 新建页面（`askCreatePage`） | 正常弹出输入框，流程可走通 |
| 8 | 控制台无 `prompt() is and will not be supported` | ✅ |

**重点：第 5 条必须在 Linux 实机验证**（开发环境为 macOS）。

---

## 四、工作量与风险

| 项 | 评估 |
| --- | --- |
| 步骤 1-3（主修复） | 小，参照现成组件，改动集中，无架构变动 |
| 步骤 4（同源缺陷） | 小，各处均有可复用的现成 Modal |
| 步骤 5（全局兜底） | 小，可选 |
| 回归风险 | **低**。新增 Modal 分支不影响既有逻辑；`projects:delete` 增加校验只会在原本就失败的情况下抛错 |
| 兼容性 | **无破坏性变更**，不涉及数据库迁移，不新增依赖 |

### 建议执行顺序

1. **步骤 1 + 2 + 3** 构成最小可发布修复，先合，解决用户当前被阻塞的问题
2. **步骤 4** 紧随其后，避免「新建页面」「创建检查点」两个功能继续静默失效
3. **步骤 5** 作为加固，视排期安排

建议三个步骤在同一分支完成并开一个 PR，标题形如 `fix(workbench): 删除项目改用自绘确认框，修复 prompt() 在 Electron 不可用导致的静默失败`。