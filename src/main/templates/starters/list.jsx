/*
  列表页脚手架 — 搜索 + 表格 + 分页（通过 /api/data 调数据层）
  使用前改三处：DATA_CPT / QRY_NAME / TOTAL_NAME，以及 columns 列定义
*/

var DATA_CPT = 'CHANGE_ME_data.cpt';
var QRY_NAME = 'CHANGE_ME_qry';
var TOTAL_NAME = 'CHANGE_ME_total';

function Root() {
    var Table = antd.Table, Button = antd.Button, Input = antd.Input, Space = antd.Space,
        Card = antd.Card, Tag = antd.Tag;

    var [data, setData] = React.useState([]);
    var [loading, setLoading] = React.useState(false);
    var [total, setTotal] = React.useState(0);
    var [page, setPage] = React.useState(1);
    var [pageSize, setPageSize] = React.useState(10);
    var [keyword, setKeyword] = React.useState('');

    function fetchList(p, ps, kw) {
        setLoading(true);
        $.ajax({
            url: PATH.apiBase + '/api/data',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
                report_path: PATH.getDataTemplate(DATA_CPT),
                datasource_name: QRY_NAME,
                page_number: -1,
                page_size: -1,
                parameters: [
                    { name: 'p_page', type: 'Integer', value: p },
                    { name: 'p_pagesize', type: 'Integer', value: ps },
                    { name: 'p_keyword', type: 'String', value: kw || '' }
                ]
            }),
            success: function(res) {
                if (typeof res === 'string') res = JSON.parse(res);
                if (res.err_code !== 0) { antd.message.error(res.err_msg || '查询失败'); return; }
                setData(res.data);
                setLoading(false);
            },
            error: function() { setLoading(false); antd.message.error('网络错误'); }
        });
        $.ajax({
            url: PATH.apiBase + '/api/data',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
                report_path: PATH.getDataTemplate(DATA_CPT),
                datasource_name: TOTAL_NAME,
                page_number: -1,
                page_size: -1,
                parameters: [{ name: 'p_keyword', type: 'String', value: kw || '' }]
            }),
            success: function(res) {
                if (typeof res === 'string') res = JSON.parse(res);
                if (res.err_code === 0 && res.data.length > 0) setTotal(Number(res.data[0].total));
            }
        });
    }

    React.useEffect(function() {
        fetchList(page, pageSize, keyword);
    }, []);

    // TODO: 按业务修改列定义
    var columns = [
        { title: 'ID', dataIndex: 'id', width: 80 },
        { title: '名称', dataIndex: 'title' },
        { title: '状态', dataIndex: 'status', width: 120,
            render: function(v) { return React.createElement(Tag, { color: v === '在库' ? 'green' : 'orange' }, v); } },
        { title: '创建时间', dataIndex: 'create_time', width: 170 }
    ];

    return React.createElement(Card, { style: { margin: 16 } },
        React.createElement('div', { style: { marginBottom: 16, display: 'flex', justifyContent: 'space-between' } },
            React.createElement(Input.Search, {
                placeholder: '搜索名称',
                style: { width: 240 },
                onSearch: function(v) {
                    setKeyword(v); setPage(1);
                    fetchList(1, pageSize, v);
                }
            }),
            React.createElement(Button, { type: 'primary' }, '新增')
        ),
        React.createElement(Table, {
            rowKey: 'id',
            size: 'middle',
            loading: loading,
            columns: columns,
            dataSource: data,
            pagination: {
                current: page,
                pageSize: pageSize,
                total: total,
                showSizeChanger: true,
                showTotal: function(t) { return '共 ' + t + ' 条'; },
                onChange: function(p, ps) {
                    setPage(p); setPageSize(ps);
                    fetchList(p, ps, keyword);
                }
            }
        })
    );
}

ReactDOM.createRoot(document.getElementById('app-root')).render(React.createElement(Root));
