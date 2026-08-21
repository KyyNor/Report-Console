import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { generateDataCpt, buildTableDataXml } from '@main/cpt/dataWriter'
import { removeComments, transformHooksDestructuring } from '@main/cpt/jsTransform'
import { compileJsx, generateMobilePageCpt, generatePageCpt } from '@main/cpt/displayWriter'
import { checkApiDataParameters, checkDataCpt, checkFineReportAjaxCompatibility, checkMobilePageCpt, checkPageCpt, extractJsFromCpt } from '@main/cpt/checker'
import { XMLParser } from 'fast-xml-parser'

const TPL_DIR = resolve(__dirname, '../src/main/templates')
const dataTemplate = readFileSync(resolve(TPL_DIR, 'base_cpt_data.cpt'), 'utf-8')
const pageTemplate = readFileSync(resolve(TPL_DIR, 'base_cpt_page.cpt'), 'utf-8')
const mobilePageTemplate = readFileSync(resolve(TPL_DIR, 'base_cpt_page_mobile.cpt'), 'utf-8')
const dataCptPath = 'demo/data/demo_data.cpt'

// python 工具链对同一契约的真实产物（侦察阶段生成）
const GOLDEN_PY = '/tmp/frtoolchain-test/frdemo_data.cpt'

const fxParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false })
const asArray = (v: unknown): Array<Record<string, unknown>> => {
  if (v === undefined || v === null) return []
  if (Array.isArray(v)) return v as Array<Record<string, unknown>>
  return [v as Record<string, unknown>]
}

describe('dataWriter', () => {
  const input = {
    defaultDbName: 'frdemo_db',
    datasets: [
      {
        name: 'book_qry',
        sql: "SELECT id, title FROM frdemo_book WHERE 1=1 ${if(len(p_keyword) == 0, \"\", \" AND title LIKE '%\" + p_keyword + \"%'\")} ORDER BY id DESC LIMIT ${(p_page - 1) * p_pagesize}, ${p_pagesize}",
        params: [
          { name: 'p_page', type: 'integer' as const, default: '1' },
          { name: 'p_pagesize', type: 'integer' as const, default: '10' },
          { name: 'p_keyword', type: 'string' as const, default: '' }
        ]
      },
      {
        name: 'user_scope',
        sql: "SELECT * FROM t WHERE created_by = '${fine_username}'",
        params: [{ name: 'fine_username', type: 'formula' as const, default: '=$fine_username' }]
      }
    ]
  }

  it('生成 XML 可解析且结构正确', () => {
    const xml = generateDataCpt(dataTemplate, input)
    const parsed = fxParser.parse(xml)
    const arr = asArray(parsed.WorkBook.TableDataMap.TableData)
    expect(arr).toHaveLength(2)
    expect(arr[0]['@_name']).toBe('book_qry')
    expect(arr[0].Query).toContain('frdemo_book')
    expect(arr[0].Query).toContain('${if(len(p_keyword)')
    // 参数形态：integer 带 t="I"
    const ps = asArray((arr[0].Parameters as Record<string, unknown>).Parameter)
    expect((ps[0].Attributes as Record<string, unknown>)['@_name']).toBe('p_page')
    expect((ps[0].O as Record<string, unknown>)['@_t']).toBe('I')
    // formula 参数形态
    const p2 = asArray((arr[1].Parameters as Record<string, unknown>).Parameter)
    expect((p2[0].O as Record<string, unknown>)['@_class']).toBe('com.fr.base.Formula')
  })

  it('与 python 版产物结构等价（黄金对照）', () => {
    const taskPath = '/tmp/frtoolchain-test/dev_task.json'
    const goldenPath = GOLDEN_PY
    if (!existsSync(taskPath) || !existsSync(goldenPath)) return // 无黄金文件时跳过
    const task = JSON.parse(readFileSync(taskPath, 'utf-8'))
    const golden = fxParser.parse(readFileSync(goldenPath, 'utf-8'))
    const mine = fxParser.parse(
      generateDataCpt(dataTemplate, {
        defaultDbName: task.database.db_name,
        datasets: task.database.datasets
      })
    )
    const ga = asArray(golden.WorkBook.TableDataMap.TableData)
    const ma = asArray(mine.WorkBook.TableDataMap.TableData)
    expect(ga.length).toBe(ma.length)
    for (let i = 0; i < ga.length; i++) {
      expect(ma[i]['@_name']).toBe(ga[i]['@_name'])
      expect(String(ma[i].Query).trim()).toBe(String(ga[i].Query).trim())
      expect(
        String((ma[i].Connection as Record<string, unknown>).DatabaseName).trim()
      ).toBe(String((ga[i].Connection as Record<string, unknown>).DatabaseName).trim())
    }
  })

  it('TableData XML：SQL 特殊字符安全（CDATA）', () => {
    const xml = buildTableDataXml('t1', "SELECT a < b AND c > d -- 'quote'", [], 'db1')
    expect(xml).toContain('<![CDATA[SELECT a < b AND c > d -- \'quote\']]>')
    expect(() => fxParser.parse(`<r>${xml}</r>`)).not.toThrow()
  })

  it('页内多连接：每数据集各自携带 DatabaseName（一项目一页·页内多连接）', () => {
    const xml = generateDataCpt(dataTemplate, {
      defaultDbName: 'frdemo_db',
      datasets: [
        { name: 'a_qry', sql: 'SELECT 1', params: [], dbConnection: 'conn_a' },
        { name: 'dict_x', sql: 'SELECT 2', params: [], dbConnection: 'conn_b' },
        { name: 'b_qry', sql: 'SELECT 3', params: [] } // 未指定 → 默认连接
      ]
    })
    const arr = asArray(fxParser.parse(xml).WorkBook.TableDataMap.TableData)
    expect(arr).toHaveLength(3)
    const dbName = (i: number) => String((arr[i].Connection as Record<string, unknown>).DatabaseName).replace(/<!\[CDATA\[|\]\]>/g, '')
    expect(dbName(0)).toBe('conn_a')
    expect(dbName(1)).toBe('conn_b')
    expect(dbName(2)).toBe('frdemo_db')
  })
})

describe('jsTransform', () => {
  it('去注释保留字符串与代码', () => {
    const js = `var a = 1; // 行注释\n/* 块\n注释 */ var b = 'http://x//y';\nvar c = "/* not comment */";`
    const out = removeComments(js)
    expect(out).toContain("var b = 'http://x//y'")
    expect(out).toContain('var c = "/* not comment */"')
    expect(out).not.toContain('行注释')
    expect(out).not.toContain('块\n注释')
  })

  it('字符串内 \\uXXXX 解码为原生字符', () => {
    const out = removeComments('var s = "\\u4e2d\\u6587";')
    expect(out).toBe('var s = "中文";')
  })

  it('Hook 解构转两步赋值', () => {
    const { code, count } = transformHooksDestructuring(
      'var [a, setA] = React.useState(0);\nconst [b, setB] = antd.useState({x:1});'
    )
    expect(count).toBeGreaterThanOrEqual(1)
    expect(code).toContain('var _hook_')
    expect(code).not.toContain('const [b, setB]')
  })

  it('antdMobile Hook 解构同样转换', () => {
    const { code, count } = transformHooksDestructuring('var [value, setValue] = antdMobile.useState(0);')
    expect(count).toBe(1)
    expect(code).toContain('var _hook_')
  })
})

describe('displayWriter + checker', () => {
  it('完整页面构建流程并过质量门', async () => {
    const jsx = readFileSync(resolve(TPL_DIR, 'starters/list.jsx'), 'utf-8')
      .replace(/CHANGE_ME_qry/, 'book_qry')
      .replace(/CHANGE_ME_total/, 'book_total')
    const { clean, hooksTransformed } = await compileJsx(jsx)
    expect(hooksTransformed).toBeGreaterThan(0)
    expect(clean).not.toContain('//')
    const cpt = generatePageCpt(pageTemplate, clean, dataCptPath)
    // CDATA 完整
    expect(cpt).toContain('<Content><![CDATA[')
    expect(cpt.indexOf('开发者代码区 START')).toBeGreaterThan(0)
    // 质量门：无 error
    const findings = checkPageCpt(cpt, pageTemplate)
    const errors = findings.filter((f) => f.severity === 'error')
    expect(errors).toEqual([])
    // JS 可提取
    const js = extractJsFromCpt(cpt)
    expect(js).toContain('book_qry')
    expect(js).toContain('var PATH')
    expect(js).toContain(`dataCptPath: "${dataCptPath}"`)
    expect(js).toContain('getDataTemplate()')
  })

  it('占位符残留 / Unicode 转义 / 自创标签被拦截', async () => {
    const { clean } = await compileJsx('var x = 1;')
    // 模拟占位符残留
    const bad1 = generatePageCpt(pageTemplate, clean + '\nvar leak = "_MJS_S000001_";', dataCptPath)
    expect(checkPageCpt(bad1, pageTemplate).some((f) => f.rule === 'mjs_placeholder_remnant')).toBe(true)
    // 模拟自创标签
    const bad2 = cptInject(pageTemplate, clean) + '\n<CustomWidget/>'
    const parsed = checkPageCpt(bad2, pageTemplate)
    expect(parsed.some((f) => f.rule === 'cpt_xml_wellformed' || f.rule === 'xml_wellformed')).toBe(true)
  })

  it('PATH 遮盖检测', async () => {
    const { clean } = await compileJsx('var PATH = { foo: 1 };\nvar x = 2;')
    const cpt = generatePageCpt(pageTemplate, clean, dataCptPath)
    const findings = checkPageCpt(cpt, pageTemplate)
    expect(findings.some((f) => f.rule === 'js_path_resolution' && f.message.includes('遮盖'))).toBe(true)
  })

  it('移动端骨架注入并执行移动专属质量门', async () => {
    const jsx = readFileSync(resolve(TPL_DIR, 'starters/mobile.jsx'), 'utf-8')
    const { clean } = await compileJsx(jsx)
    const cpt = generateMobilePageCpt(mobilePageTemplate, clean, dataCptPath)
    expect(cpt).not.toContain('/* @FRM_DEVELOPER_ZONE@ */')
    expect(checkMobilePageCpt(cpt, mobilePageTemplate).filter((f) => f.severity === 'error')).toEqual([])

    const desktop = await compileJsx('var Button = antd.Button; function Root(){ return <Button>bad</Button>; } ReactDOM.createRoot(document.getElementById("app-root")).render(<Root/>);')
    const bad = generateMobilePageCpt(mobilePageTemplate, desktop.clean, dataCptPath)
    expect(checkMobilePageCpt(bad, mobilePageTemplate).some((f) => f.rule === 'js_uses_antd_mobile' && f.severity === 'error')).toBe(true)

    const unsafeLayout = await compileJsx('function Root(){ return <div style={{height:"100vh",zIndex:1200}}>bad</div>; } ReactDOM.createRoot(document.getElementById("app-root")).render(<Root/>);')
    const unsafeCpt = generateMobilePageCpt(mobilePageTemplate, unsafeLayout.clean, dataCptPath)
    const layoutFindings = checkMobilePageCpt(unsafeCpt, mobilePageTemplate)
    expect(layoutFindings.some((f) => f.rule === 'js_mobile_no_100vh' && f.severity === 'error')).toBe(true)
    expect(layoutFindings.some((f) => f.rule === 'js_mobile_z_index' && f.severity === 'error')).toBe(true)
  })

  it('/api/data parameters 必须是数组，识别对象字面量和对象工厂透传', () => {
    const valid = `$.ajax({ url: PATH.apiBase + '/api/data', data: JSON.stringify({
      parameters: [{ name: 'p_page', type: 'Integer', value: 1 }]
    }) });`
    expect(checkApiDataParameters(valid)).toEqual([])

    const directObject = `$.ajax({ url: PATH.apiBase + '/api/data', data: JSON.stringify({ parameters: {} }) });`
    expect(checkApiDataParameters(directObject).some((f) => f.rule === 'api_data_parameters_shape')).toBe(true)

    const forwardedObject = `
      function callApi(dsName, parameters) {
        return $.ajax({ url: PATH.apiBase + '/api/data', data: JSON.stringify({ datasource_name: dsName, parameters: parameters }) });
      }
      const mkParams = React.useCallback((page) => ({ p_page: String(page) }), []);
      callApi('book_qry', mkParams(1));
    `
    expect(checkApiDataParameters(forwardedObject).some((f) => f.rule === 'api_data_parameters_shape')).toBe(true)
  })

  it('帆软 /api/data 的 jQuery 调用必须显式兼容 Deferred 和 JSON 响应头', () => {
    const broken = `
      function callApi(parameters) {
        return $.ajax({ url: PATH.apiBase + '/api/data', contentType: 'application/json', data: JSON.stringify({ parameters }) })
          .then((r) => r);
      }
    `
    const rules = checkFineReportAjaxCompatibility(broken).map((f) => f.rule)
    expect(rules).toContain('finereport_ajax_deferred')
    expect(rules).toContain('finereport_ajax_json_type')

    const valid = `
      function callApi(parameters) {
        return new Promise((resolve, reject) => {
          $.ajax({ url: PATH.apiBase + '/api/data', contentType: 'application/json', dataType: 'json', data: JSON.stringify({ parameters }) })
            .done(resolve).fail(reject);
        });
      }
    `
    expect(checkFineReportAjaxCompatibility(valid)).toEqual([])
  })
})

function cptInject(tpl: string, code: string): string {
  return generatePageCpt(tpl, code, dataCptPath)
}

describe('checkDataCpt', () => {
  it('缺 Query 节点报 error；危险 SQL 报 warning', () => {
    const xml = generateDataCpt(dataTemplate, {
      defaultDbName: 'frdemo_db',
      datasets: [{ name: 'bad', sql: 'DELETE FROM t', params: [] }]
    })
    // 手工摘掉 Query 节点模拟结构缺失
    const broken = xml.replace(/<Query>[\s\S]*?<\/Query>/, '')
    const findings = checkDataCpt(broken)
    expect(findings.some((f) => f.rule === 'table_data_structure' && f.severity === 'error')).toBe(true)

    const okFindings = checkDataCpt(xml)
    expect(okFindings.some((f) => f.rule === 'sql_safety' && f.severity === 'warning')).toBe(true)
    expect(okFindings.some((f) => f.severity === 'error')).toBe(false)
  })
})
