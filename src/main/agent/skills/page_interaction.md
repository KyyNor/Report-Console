---
name: page_interaction
description: 帆软页面跳转、弹窗与父子页通信规范。
---

# 页面联动

## 先选择合适的形态

- 删除确认、少量字段编辑：在当前 JSX 用 antd `Modal`，成功后关闭并刷新当前数据。
- 新增/编辑表单、选择器、复杂配置：建立独立受管页面，以 antd `Modal` 内的 `iframe` 打开。
- 大型详情、全屏工作台、需要独立 URL 的功能：打开独立页面，并提供明确的返回操作。

不要为了一个简单确认框新增 CPT；也不要把复杂表单硬塞到列表页的 Modal 中。

## iframe 表单约定

父页面仅通过 URL 传递短参数（例如 `id`、`mode`），子页面自行通过数据接口读取详情。不要传完整记录、密钥或大段 JSON。

子页面向父页面发送以下消息：

- `fr_iframe_resize`：`{ type: 'fr_iframe_resize', height }`，父页面据此调整 iframe 高度。
- `fr_form_saved`：保存成功，父页面关闭弹窗并重新查询列表。
- `fr_form_cancel`：取消，父页面关闭弹窗。

`postMessage` 必须指定 `window.location.origin`；父页面监听时也必须忽略 `event.origin !== window.location.origin` 的消息。不要使用 `'*'`。

iframe 高度应使用内容高度并限制在可视区内（如最小 400px、最大 `90vh`），不要设置死板的固定页面高度。

## 受管页面路径

先用 `list_pages` 确认目标页面是否已受管及其 CPT 路径。`PATH.getTemplatePath(filename)` 只适用于与当前页面同目录的 CPT。

当前运行时尚未提供“页面 ID → 任意 CPT 路径”的统一跳转 helper。目标页面不在同目录时，不要猜测或硬编码路径；应向用户说明需要先补充页面路径映射能力，或将关联页面放到同目录。

所有帆软页面 URL 都必须带 `op=write`，开发预览可附加时间戳防缓存。

## 交付检查

- 新增、编辑、取消和删除确认分别验证。
- 保存成功后验证弹窗关闭、父列表刷新。
- 验证 URL 参数只含必要的标识参数。
- 验证 iframe 高度不会截断内容，也不会留出大面积空白。
