/*
  表单弹窗页脚手架（作为 iframe 子页面打开）
  - 父页面通过 URL 传参：?id=xxx&mode=edit
  - 保存成功后 postMessage 通知父页面刷新
*/

var DATA_CPT = 'CHANGE_ME_data.cpt';
var BY_ID_NAME = 'CHANGE_ME_by_id';
var SAVE_NAME = 'CHANGE_ME_insert';

function getUrlParam(name) {
    return new URLSearchParams(window.location.search).get(name) || '';
}

function notifyParent(type, payload) {
    try {
        if (window.parent !== window) {
            window.parent.postMessage(Object.assign({ type: type }, payload || {}), '*');
        }
    } catch (e) {}
}

function notifyHeight() {
    notifyParent('fr_iframe_resize', { height: document.body.scrollHeight });
}

function Root() {
    var Form = antd.Form, Input = antd.Input, Button = antd.Button, Select = antd.Select;
    var [form] = Form.useForm();
    var [saving, setSaving] = React.useState(false);
    var editId = getUrlParam('id');

    React.useEffect(function() {
        notifyHeight();
        if (editId) {
            $.ajax({
                url: PATH.apiBase + '/api/data',
                type: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({
                    report_path: PATH.getDataTemplate(DATA_CPT),
                    datasource_name: BY_ID_NAME,
                    page_number: -1,
                    page_size: -1,
                    parameters: [{ name: 'p_id', type: 'Integer', value: Number(editId) }]
                }),
                success: function(res) {
                    if (typeof res === 'string') res = JSON.parse(res);
                    if (res.err_code === 0 && res.data.length > 0) form.setFieldsValue(res.data[0]);
                }
            });
        }
    }, []);

    function handleSave(values) {
        setSaving(true);
        var parameters = Object.keys(values).map(function(k) {
            return { name: 'p_' + k, type: 'String', value: values[k] == null ? '' : String(values[k]) };
        });
        if (editId) parameters.push({ name: 'p_id', type: 'Integer', value: Number(editId) });
        $.ajax({
            url: PATH.apiBase + '/api/data',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
                report_path: PATH.getDataTemplate(DATA_CPT),
                datasource_name: editId ? SAVE_NAME.replace('insert', 'update') : SAVE_NAME,
                page_number: -1,
                page_size: -1,
                parameters: parameters
            }),
            success: function(res) {
                if (typeof res === 'string') res = JSON.parse(res);
                setSaving(false);
                if (res.err_code !== 0) { antd.message.error(res.err_msg || '保存失败'); return; }
                antd.message.success('保存成功');
                notifyParent('fr_form_saved');
            },
            error: function() {
                setSaving(false);
                antd.message.error('网络错误');
            }
        });
    }

    return React.createElement('div', { style: { padding: 16, background: '#fff' } },
        React.createElement(Form, { form: form, layout: 'vertical', onFinish: handleSave },
            // TODO: 按业务增减表单项
            React.createElement(Form.Item, { name: 'title', label: '名称', rules: [{ required: true, message: '请输入名称' }] },
                React.createElement(Input, { placeholder: '请输入名称' })),
            React.createElement(Form.Item, { name: 'status', label: '状态' },
                React.createElement(Select, { options: [
                    { value: '在库', label: '在库' },
                    { value: '借出', label: '借出' }
                ] })),
            React.createElement(Form.Item, { style: { marginBottom: 0, textAlign: 'right' } },
                React.createElement(Button, { onClick: function() { notifyParent('fr_form_cancel'); } }, '取消'), ' ',
                React.createElement(Button, { type: 'primary', htmlType: 'submit', loading: saving }, '保存'))
        )
    );
}

window.addEventListener('resize', notifyHeight);
ReactDOM.createRoot(document.getElementById('app-root')).render(React.createElement(Root));
