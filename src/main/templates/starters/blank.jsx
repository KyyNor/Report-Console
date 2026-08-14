/*
  空白页面脚手架
  - 全局变量直接使用：React / ReactDOM / antd / dayjs / $ / PATH
  - 不要写 import；不要自行创建 app-root（骨架已建）
*/

function App() {
    var message = antd.message;

    return React.createElement('div', { style: { padding: 24 } },
        React.createElement(antd.Card, null,
            React.createElement(antd.Typography.Title, { level: 4 }, '新页面'),
            React.createElement(antd.Button, {
                type: 'primary',
                onClick: function() { message.info('你好，fr-console！'); }
            }, '点我')
        )
    );
}

ReactDOM.createRoot(document.getElementById('app-root')).render(React.createElement(App));
