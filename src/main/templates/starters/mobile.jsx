/*
  移动端通用脚手架 starter.jsx
  --------------------------------------------------------------
  - 基于 antd-mobile 5.x + React 18
  - 真正的 JSX 语法（esbuild --jsx=transform 编译）
  - 注入到 base_cpt_page_mobile.cpt 的 DEVELOPER ZONE
  - PATH / hideStyle / #app-root / 动态加载库 全部由骨架的 PREAMBLE 处理，
    本文件只负责 App 组件 + 渲染
  - 资源加载策略（CDN 优先 + FineReport 本地兜底）也在骨架 PREAMBLE 中，
    业务 JSX 不要手写 script/link 标签，也不要关心 CDN URL

  可用全局变量：React, ReactDOM, antdMobile, dayjs, $, FR, PATH

  开发约定：
    - 顶部解构出本页要用到的 antd-mobile 组件
    - useState 三段式写法（var s=React.useState(...); var x=s[0]; var setX=s[1];）
      避免数组解构在某些工具链下被错改
    - API 调用统一走 PATH.apiBase + '/api/data'（与 fr-data-dev 数据层契约一致）
    - 禁止 antd.xxx（PC 全局变量，移动端不加载）
    - 禁止 Modal / Table，用 Popup / Dialog / List 代替
    - 禁止 iframe，跨页用 Popup 同页弹出或 location 跳转
*/

var { NavBar, Card, List, Button, Input, Form, Popup, Picker,
      DatePicker, Toast, Dialog, Space, Tag, SearchBar,
      PullToRefresh, InfiniteScroll, Empty } = antdMobile;

var App = function() {
    // ============================================
    //  示例 state（按需保留/删除）
    // ============================================
    var s1 = React.useState([]);    var data = s1[0];        var setData = s1[1];
    var s2 = React.useState(false); var loading = s2[0];     var setLoading = s2[1];
    var s3 = React.useState(false); var formVisible = s3[0]; var setFormVisible = s3[1];

    // ============================================
    //  示例：调用 /api/data 拉列表
    //  生产时改 datasource_name / parameters / report_path 文件名
    //  默认未启用，在 useEffect 里取消注释即可
    // ============================================
    function fetchList() {
        setLoading(true);
        $.ajax({
            url: PATH.apiBase + '/api/data',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
                report_path: PATH.getDataTemplate('{module}_data.cpt'),
                datasource_name: '{module}_qry',
                page_number: -1,
                page_size: -1,
                parameters: []
            }),
            success: function(res) {
                if (typeof res === 'string') res = JSON.parse(res);
                if (res.err_code !== 0) {
                    Toast.show({ icon: 'fail', content: res.err_msg || '查询失败' });
                    return;
                }
                setData(res.data || []);
            },
            error: function() { Toast.show({ icon: 'fail', content: '网络错误' }); },
            complete: function() { setLoading(false); }
        });
    }

    React.useEffect(function() {
        // fetchList();  // 启用时取消注释
    }, []);

    // ============================================
    //  示例：提交表单
    // ============================================
    function handleSubmit(values) {
        // 实际项目调 /api/data 写库或调专用接口
        Toast.show({ icon: 'success', content: '提交成功（示例）' });
        setFormVisible(false);
        // fetchList();  // 提交后刷新列表
    }

    // ============================================
    //  渲染：NavBar + 操作区 + 列表 + 弹出表单
    // ============================================
    return (
        <div style={{ paddingBottom: '60px' }}>
            <NavBar backArrow={false}>页面标题</NavBar>

            {/* 操作区 */}
            <Card style={{ margin: '8px' }}>
                <Space wrap>
                    <Button color="primary" onClick={function() { setFormVisible(true); }}>
                        新增
                    </Button>
                    <Button loading={loading} onClick={fetchList}>刷新</Button>
                </Space>
            </Card>

            {/* 列表展示 —— 移动端用 List 代替 Table */}
            <List header="数据列表">
                {/* 假数据占位，开发时替换为 data.map(...) */}
                {[
                    { id: 1, name: '示例 1', extra: '¥ 99',  desc: '描述一' },
                    { id: 2, name: '示例 2', extra: '¥ 199', desc: '描述二' }
                ].map(function(item) {
                    return (
                        <List.Item
                            key={item.id}
                            extra={item.extra}
                            description={item.desc}
                            arrow
                            onClick={function() {
                                Toast.show({ content: '点击了 ' + item.name });
                            }}
                        >
                            {item.name}
                        </List.Item>
                    );
                })}
            </List>

            {/* 弹出表单 —— 移动端用 Popup 代替 Modal */}
            <Popup
                visible={formVisible}
                onMaskClick={function() { setFormVisible(false); }}
                bodyStyle={{
                    padding: '24px 16px',
                    minHeight: '50vh',
                    borderTopLeftRadius: '12px',
                    borderTopRightRadius: '12px'
                }}
            >
                <h3 style={{ margin: '0 0 16px 0', fontSize: '16px' }}>新增</h3>
                <Form
                    layout="horizontal"
                    onFinish={handleSubmit}
                    footer={
                        <Space block direction="vertical">
                            <Button block color="primary" type="submit">提交</Button>
                            <Button block onClick={function() { setFormVisible(false); }}>
                                取消
                            </Button>
                        </Space>
                    }
                >
                    <Form.Item
                        name="name"
                        label="名称"
                        rules={[{ required: true, message: '请输入名称' }]}
                    >
                        <Input placeholder="请输入" clearable />
                    </Form.Item>
                    <Form.Item name="remark" label="备注">
                        <Input placeholder="选填" clearable />
                    </Form.Item>
                </Form>
            </Popup>
        </div>
    );
};

ReactDOM.createRoot(document.getElementById('app-root')).render(<App />);
