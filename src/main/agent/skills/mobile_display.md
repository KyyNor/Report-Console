# 移动端展示开发

用于 `platform: mobile` 的受管页面。页面由 Report Console 的移动骨架加载 React、ReactDOM、dayjs、jQuery 与 `antdMobile`，业务 JSX 不负责加载依赖。

## 不可混用

- 只使用全局 `antdMobile`，不要使用 PC 全局 `antd`，也不要写 `import`。
- 不创建 `app-root`，不重新声明 `PATH`，不向 `window.__*` 写业务状态。
- antd-mobile 没有 PC 的 `Table` 和 `Modal`。列表/卡片用 `List`、`Grid`、`IndexBar`；容器用 `Popup`；确认用 `Dialog`；动作菜单用 `ActionSheet`。
- 不使用 iframe。轻交互在同页 Popup 完成，复杂页面走移动 SPA 路由。
- 页面使用 `NavBar` 建立移动导航，不把 PC 顶栏缩窄后直接复用。

## 布局与输入

- 以窄屏单列为默认，不把桌面表格简单压缩。
- 主体字号 14–16px，辅助信息不小于 12px；禁止固定 `100vh`，优先内容自然撑开、`100dvh` 或弹性布局。
- 主要触控目标至少 44px；底部操作区考虑 `env(safe-area-inset-bottom)`。
- 输入框由 React 受控，提交前做 trim 与类型归一；避免依赖桌面键盘事件。
- Portal 组件由骨架处理层级，不自行覆盖全局 z-index 或隐藏帆软节点；业务 z-index 不得超过 1000。

## 数据与路由

- `/api/data` 请求协议与桌面端相同：`parameters` 是 `{name,type,value}[]`，`page_number/page_size` 为 `-1`。
- `$.ajax` 使用 `.done/.fail` 包成原生 Promise，并设置 `dataType:'json'`。
- 移动预览入口由 `open_page` 生成，不手拼桌面 `/view/report` URL。

## 完成门槛

先确认数据接口实测通过，再写移动 JSX；随后 `build_page`、`open_page`，并按需读取 `mobile_qa`。
