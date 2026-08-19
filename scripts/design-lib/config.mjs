/**
 * 设计库同步配置 —— 剔除与精简清单的唯一事实来源。
 *
 * 模型（按用户约定）：
 * - exclude：按文件/目录名整份剔除（字体、落地页、图标、stack、GSAP 动效等）。
 * - domains：文件名 + 条目名白名单精简。entries 两类取值：
 *     · 字符串数组：显式白名单，按配置顺序入库；上游新增条目不会自动入库，
 *       同步报告会列出「未入清单条目」并标注其中自上次同步新增的，便于决定是否收录。
 *     · '*'：全量收录（小而稳定的文件），上游新增自动入库并体现在 diff 中。
 * - key：条目名列，支持数组复合键（用 “ / ” 连接，如 “Navigation / Breadcrumbs”）。
 * - columns：可选列白名单（key 列强制保留），省略则保留全部列。
 *
 * 条目清单基于 2026-08 上游快照人工挑选，面向本平台业务（企业报表/数据看板/管理后台）。
 */

/** 企业业务相关的产品类型；products / colors / ui-reasoning 三文件按 Product Type 一一对应，共享此清单。 */
const businessProducts = [
  'SaaS (General)',
  'B2B Service',
  'E-commerce',
  'Financial Dashboard',
  'Analytics Dashboard',
  'Banking/Traditional Finance',
  'Insurance Platform',
  'Healthcare App',
  'Medical Clinic',
  'Educational App',
  'Government/Public Service',
  'Logistics/Delivery',
  'Construction/Architecture',
  'Real Estate/Property',
  'Smart Home/IoT Dashboard',
  'Productivity Tool',
  'Remote Work/Collaboration Tool',
  'Knowledge Base/Documentation',
  'CRM & Client Management',
  'Inventory & Stock Management',
  'Invoice & Billing Tool',
  'AI/Chatbot Platform',
  'RPA / Automation Dashboard',
  'No-code / Low-code Builder'
]

/** 视觉风格：基础风格 + 企业设计系统 + 数据看板一族 + 移动端。 */
const styleEntries = [
  'Minimalism & Swiss Style',
  'Flat Design',
  'Glassmorphism',
  'Dark Mode (OLED)',
  'Accessible & Ethical',
  'Bento Box Grid',
  'Micro-interactions',
  'AI-Native UI',
  'Fluent 2',
  'Shopify Polaris',
  'Adobe Spectrum',
  'Data-Dense Dashboard',
  'Heat Map & Heatmap Style',
  'Executive Dashboard',
  'Real-Time Monitoring',
  'Drill-Down Analytics',
  'Comparative Analysis Dashboard',
  'Financial Dashboard',
  'Sales Intelligence Dashboard',
  'Predictive Analytics',
  'Material 3 Expressive (Mobile)',
  'Enterprise SaaS (Mobile)'
]

/** UX 准则：剔除 C 端/营销/构建侧条目（onboarding、spatial、sustainability、code splitting 等）。 */
const uxEntries = [
  'Navigation / Smooth Scroll',
  'Navigation / Sticky Navigation',
  'Navigation / Active State',
  'Navigation / Back Button',
  'Navigation / Deep Linking',
  'Navigation / Breadcrumbs',
  'Animation / Excessive Motion',
  'Animation / Duration Timing',
  'Animation / Reduced Motion',
  'Animation / Loading States',
  'Animation / Hover vs Tap',
  'Animation / Continuous Animation',
  'Animation / Transform Performance',
  'Animation / Easing Functions',
  'Animation / Cancellable State Transitions',
  'Layout / Z-Index Management',
  'Layout / Overflow Hidden',
  'Layout / Fixed Positioning',
  'Layout / Stacking Context',
  'Layout / Content Jumping',
  'Layout / Viewport Units',
  'Layout / Container Width',
  'Layout / Long Token Wrapping',
  'Touch / Touch Target Size',
  'Touch / Touch Spacing',
  'Touch / Gesture Conflicts',
  'Touch / Tap Delay',
  'Touch / Pull to Refresh',
  'Touch / Haptic Feedback',
  'Interaction / Focus States',
  'Interaction / Hover States',
  'Interaction / Active States',
  'Interaction / Disabled States',
  'Interaction / Loading Buttons',
  'Interaction / Error Feedback',
  'Interaction / Success Feedback',
  'Interaction / Confirmation Dialogs',
  'Accessibility / Color Contrast',
  'Accessibility / Color Only',
  'Accessibility / Alt Text',
  'Accessibility / Heading Hierarchy',
  'Accessibility / ARIA Labels',
  'Accessibility / Keyboard Navigation',
  'Accessibility / Screen Reader',
  'Accessibility / Form Labels',
  'Accessibility / Error Messages',
  'Accessibility / Skip Links',
  'Accessibility / Motion Sensitivity',
  'Accessibility / Focus Not Obscured (Minimum)',
  'Accessibility / Focus Appearance',
  'Accessibility / Dragging Movements',
  'Accessibility / Target Size (Minimum)',
  'Accessibility / Text Reflow and Spacing',
  'Accessibility / Compact Control Semantics',
  'Accessibility / Contextual Live Badge Updates',
  'Performance / Image Optimization',
  'Performance / Lazy Loading',
  'Performance / Caching',
  'Performance / Font Loading',
  'Performance / Third Party Scripts',
  'Performance / Render Blocking',
  'Forms / Input Labels',
  'Forms / Error Placement',
  'Forms / Inline Validation',
  'Forms / Input Types',
  'Forms / Autofill Support',
  'Forms / Required Indicators',
  'Forms / Password Visibility',
  'Forms / Submit Feedback',
  'Forms / Input Affordance',
  'Forms / Mobile Keyboards',
  'Forms / Redundant Entry',
  'Responsive / Mobile First',
  'Responsive / Breakpoint Testing',
  'Responsive / Touch Friendly',
  'Responsive / Readable Font Size',
  'Responsive / Viewport Meta',
  'Responsive / Horizontal Scroll',
  'Responsive / Image Scaling',
  'Responsive / Table Handling',
  'Typography / Line Height',
  'Typography / Line Length',
  'Typography / Font Size Scale',
  'Typography / Font Loading',
  'Typography / Contrast Readability',
  'Typography / Heading Clarity',
  'Typography / Heading Line Balance',
  'Feedback / Loading Indicators',
  'Feedback / Empty States',
  'Feedback / Error Recovery',
  'Feedback / Progress Indicators',
  'Feedback / Toast Notifications',
  'Feedback / Confirmation Messages',
  'Content / Truncation',
  'Content / Date Formatting',
  'Content / Number Formatting',
  'Content / Placeholder Content',
  'Content / Essential Text Truncation',
  'Content / Compact Label Semantics',
  'Content / Compact Label Overflow',
  'Search / Autocomplete',
  'Search / No Results',
  'Data Entry / Bulk Actions',
  'AI Interaction / Disclaimer',
  'AI Interaction / Streaming',
  'AI Interaction / Feedback Loop',
  'Forms / Accessibility / Focusable Error Summary'
]

export default {
  source: {
    repo: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill',
    ref: 'main',
    dataDir: '.claude/skills/ui-ux-pro-max/data',
    referencesDir: '.claude/skills/ui-ux-pro-max/references'
  },
  targetDir: 'src/main/agent/designlib',
  cacheDir: '.design-lib-cache',

  // 整份剔除：字体 / 落地页 / 图标 / stack / GSAP 动效 / 上游自维护元数据
  exclude: [
    'google-fonts.csv',
    'google-font-licenses.json',
    'typography.csv',
    'landing.csv',
    'icons.csv',
    'phosphor-icons-upstream.json',
    'motion.csv',
    'stacks',
    'catalog-summary.json',
    'data-provenance.json'
  ],

  domains: {
    product: {
      file: 'products.csv',
      key: 'Product Type',
      entries: businessProducts,
      columns: ['Product Type', 'Keywords', 'Primary Style Recommendation', 'Secondary Styles', 'Dashboard Style (if applicable)', 'Color Palette Focus', 'Key Considerations']
    },
    style: {
      file: 'styles.csv',
      key: 'Style Category',
      entries: styleEntries,
      columns: ['Style Category', 'Type', 'Keywords', 'Primary Colors', 'Secondary Colors', 'Effects & Animation', 'Best For', 'Do Not Use For', 'Light Mode ✓', 'Dark Mode ✓', 'Performance', 'Accessibility', 'Mobile-Friendly', 'Framework Compatibility', 'AI Prompt Keywords', 'CSS/Technical Keywords', 'Implementation Checklist', 'Design System Variables', 'Style ID', 'Aliases', 'Status']
    },
    color: {
      file: 'colors.csv',
      key: 'Product Type',
      entries: businessProducts,
      columns: ['Product Type', 'Primary', 'On Primary', 'Secondary', 'On Secondary', 'Accent', 'On Accent', 'Background', 'Foreground', 'Card', 'Card Foreground', 'Muted', 'Muted Foreground', 'Border', 'Destructive', 'On Destructive', 'Ring', 'Notes']
    },
    reasoning: {
      file: 'ui-reasoning.csv',
      key: 'UI_Category',
      entries: businessProducts,
      columns: ['UI_Category', 'Recommended_Pattern', 'Style_Priority', 'Color_Mood', 'Typography_Mood', 'Key_Effects', 'Decision_Rules', 'Anti_Patterns', 'Severity', 'Reasoning', 'Confidence']
    },
    ux: {
      file: 'ux-guidelines.csv',
      key: ['Category', 'Issue'],
      entries: uxEntries,
      columns: ['Category', 'Issue', 'Platform', 'Description', 'Do', "Don't", 'Code Example Good', 'Code Example Bad', 'Severity']
    },
    chart: {
      file: 'charts.csv',
      key: 'Data Type',
      entries: '*',
      columns: ['Data Type', 'Keywords', 'Best Chart Type', 'Secondary Options', 'When to Use', 'When NOT to Use', 'Data Volume Threshold', 'Color Guidance', 'Accessibility Grade', 'Accessibility Risk', 'Accessibility Notes', 'A11y Fallback', 'Library Recommendation', 'Interactive Level']
    },
    web: {
      file: 'app-interface.csv',
      key: ['Category', 'Issue'],
      entries: '*',
      columns: ['Category', 'Issue', 'Keywords', 'Platform', 'Description', 'Do', "Don't", 'Code Example Good', 'Code Example Bad', 'Severity']
    },
    react: {
      file: 'react-performance.csv',
      key: ['Category', 'Issue'],
      entries: '*',
      columns: ['Category', 'Issue', 'Keywords', 'Platform', 'Description', 'Do', "Don't", 'Code Example Good', 'Code Example Bad', 'Severity']
    }
  },

  // 参考文档整份复制（人工查阅用，暂不接入 Agent 工具）
  references: ['pro-rules.md', 'quick-reference.md']
}
