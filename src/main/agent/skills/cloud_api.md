---
name: cloud_api
description: 帆软云平台接口（myFR.callCloud）调用规范。写操作走云端调度 ID，不走 /api/data。
---

# 云平台接口

## 何时用这条通道

`myFR.callCloud(code, body)` 用于经帆软云平台 `flowservice/json` 调度后端业务接口（任务重跑、暂停、运行、批量操作等）。这些是**写操作**，靠**云接口 ID**（如 `226618`）路由到后端方法。

**不要混用三条写通道**：

- 云平台接口（本 Skill）：`myFR.callCloud("226xxx", {...})`，走 `flowservice/json`；
- 数据集只读：`/api/data` + `_data.cpt`，**仅查询**，禁止用来写；
- 存储过程写：`sql_exec`（confirm + 审计到 ddl_log）。

查询走数据集，存储过程写走 `sql_exec`，只有走云端调度的业务动作才用 `callCloud`。

## 前置与唯一必填项

框架已保证：`myFR.js` 已加载、`myFR.init()` 能从帆软服务器参数读到 `cloudUrl`、`fine_username`、`servletURL`。

**唯一需要用户提供的是 `prjId`（云平台项目 ID）。** 它原配在每个模板的模板参数里，套壳页面取不到，必须显式给出准确值。值错会导致 URL 拼成 `flow_错误ID_226xxx`，云平台返回 404 或无权限。**不要猜测 prjId，接入前向用户确认。**

## 调用顺序

```js
myFR.init();                 // 幂等；读服务器参数 cloudUrl/fine_username/servletURL
myFR.prjId = PRJ_ID;         // 用户提供的项目 ID；init 读到的为空，必须赋值
myFR.callCloud(CODE, body, succCb, failCb);
```

`myFR.inited` 为 true 后再调 `init()` 是 no-op；但只要在 `callCloud` 之前赋值 `myFR.prjId`，运行时就用新值，顺序不受影响。

## callCloud 行为约定

- `body.operator` **不要传**：第 500 行 `body.operator = myFR.fine_username` 自动注入当前登录用户。
- URL 路由：传 code `"123456"` → 请求 `flow_{prjId}_123456`；传 `"flow_xxx"` 则原样使用。
- 成功判定：`resp.iibs.resp.head.respCode == "00000"`，回调收到 `resp.iibs.resp.body`（已解包）。
- 遮罩：调用前 `maskShow()`，响应或异常后 `maskHide()`，业务代码无需另加 loading。

## prjId 取值

二选一，按项目情况定：

- 页面常量（最简）：jsx 顶部 `const PRJ_ID = '...'`，同项目所有页面共用一个值；
- `project.yaml` 元数据注入（可迁移）：顶层加自定义字段，构建时注入到页面常量。

## jsx 接入模式

页面顶部收敛一个 Promise 包装，按钮回调只管业务：

```js
const PRJ_ID = '<用户提供的项目ID>';

const callCloud = (code, body) => new Promise((resolve, reject) => {
  if (typeof myFR === 'undefined' || !myFR) { message.error('myFR 未加载'); return reject(new Error('myFR 未加载')); }
  if (!myFR.inited) myFR.init();
  if (!myFR.prjId) myFR.prjId = PRJ_ID;
  if (!myFR.cloudUrl) { message.error('cloudUrl 未配置'); return reject(new Error('cloudUrl 未配置')); }
  myFR.callCloud(code, body,
    (b) => { message.success('操作成功'); resolve(b); },
    (m) => { message.error(m || '操作失败'); reject(new Error(m)); });
});
```

写动作按钮加到 antd `Table` 操作列，用 `Modal.confirm` 做二次确认（替代原 `FR.Msg.confirm`），成功后调本页 `refresh()`（替代原 `_g().refreshAllSheets()`）。批量操作配合 `Table` 的 `rowSelection` 收集选中行。

## 交付检查

- `myFR.init()` 后 `console.log(myFR.cloudUrl, myFR.prjId, myFR.fine_username)` 三者非空。
- 点击按钮 Network 看到 `POST {cloudUrl}/{prjId}/flowservice/json/flow_{prjId}_{code}`，状态 200。
- 响应 `respCode == "00000"`；失败时 `message.error` 展示 `respMsg`。
- 成功后列表刷新、遮罩消失。
