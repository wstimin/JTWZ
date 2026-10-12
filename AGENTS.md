# 项目实施约束

开始设计、开发或审查本项目之前，必须先阅读：

1. [`docs/PROJECT_REQUIREMENTS.md`](docs/PROJECT_REQUIREMENTS.md)
2. [`docs/UI_DESIGN_SYSTEM.md`](docs/UI_DESIGN_SYSTEM.md)
3. [`design-system-preview.html`](design-system-preview.html)

## 不可违反的原则

- 本项目不是单纯下载站，而是“多域名跳转 + 静态网站发布 + 软件分发”的综合平台。
- 来源域名、目标地址、网站项目和下载地址必须由后台动态配置，禁止写死。
- 域名跳转是独立业务模块，目标可以是任意合法网页，不得与下载功能耦合。
- 安装包必须支持对象存储直传、直下；普通业务服务器不得中转大文件。
- UI 必须严格遵守 `docs/UI_DESIGN_SYSTEM.md`，不得自行更换色板、字体、动效曲线或整体风格。
- 必须同时实现浅色和深色主题，新增组件必须在两套主题中完成并验证。
- 禁止使用纯黑 `#000` 或纯白 `#fff` 作为普通页面颜色。
- 不得退化成常见后台模板、厚重黑色侧边栏、蓝紫渐变或霓虹科技风。
- 任何新增页面都必须完成桌面端、平板端和手机端适配。
- 如果实现方案与需求文档存在冲突，以需求文档和 UI 规范为准；仍无法确定时先停止扩展，不得擅自改变产品范围。

## 当前视觉基准

- 交互原型：`design-system-preview.html`
- 浅色效果图：`design-system-preview.png`
- 深色效果图：`design-system-preview-dark.png`

原型中的 `Aurelia` 仅为视觉占位品牌，正式品牌名、Logo 和文案必须可配置，不能写死为业务数据。

