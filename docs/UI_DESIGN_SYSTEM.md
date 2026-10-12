# UI 全局设计系统与强制规范

版本：1.0  
状态：强制执行  
视觉原型：[`../design-system-preview.html`](../design-system-preview.html)  

## 1. 设计目标

界面必须具备以下感受：

- 高端、精致、克制；
- 有材质和空间层次；
- 适量金色光影与玻璃拟态；
- 信息清晰、操作专业；
- 具有品牌辨识度，而不是通用后台模板；
- 动效细腻但不影响效率。

视觉原型是整体气质、比例、排版和材质的基准。新增页面不能偏离该设计语言。

## 2. 强制色彩系统

禁止擅自修改以下变量值。

```css
:root,
[data-theme="light"] {
  --bg-primary: #f7f5f2;
  --bg-secondary: #f0ebe3;
  --bg-tertiary: #e8e1d5;
  --bg-elevated: #ffffffcc;
  --text-primary: #2c2a26;
  --text-secondary: #5c574e;
  --text-tertiary: #8a8378;
  --accent: #c9a227;
  --accent-hover: #b8911f;
  --accent-soft: #c9a22722;
  --border: #ddd5c5;
  --border-strong: #c9a22755;
}

[data-theme="dark"] {
  --bg-primary: #1a1916;
  --bg-secondary: #24221e;
  --bg-tertiary: #2e2b26;
  --bg-elevated: #2a2722cc;
  --text-primary: #f0ebe3;
  --text-secondary: #c9c2b5;
  --text-tertiary: #9a9285;
  --accent: #e0b83a;
  --accent-hover: #f0c94a;
  --accent-soft: #e0b83a22;
  --border: #3d3932;
  --border-strong: #e0b83a44;
}
```

### 2.1 色彩使用规则

- 页面底色使用 `--bg-primary`。
- 区块底色使用 `--bg-secondary` 或 `--bg-tertiary`。
- 毛玻璃浮层和卡片使用 `--bg-elevated`。
- 主要文字使用 `--text-primary`。
- 正文和说明使用 `--text-secondary`。
- 占位符、时间、弱标签使用 `--text-tertiary`。
- 金色 `--accent` 仅用于品牌、主操作、焦点和重要状态。
- 边框默认使用 `--border`，强调或焦点使用 `--border-strong`。
- 派生颜色优先使用 `color-mix()`、透明度或已有变量，不得随意添加新的主色。
- 不允许使用纯黑 `#000` 或纯白 `#fff` 作为普通背景或文字。

## 3. 字体

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,600;0,700;1,600&display=swap" rel="stylesheet">
```

- 英文展示标题：`Playfair Display`。
- 正文、表单、按钮、数据和后台界面：`Inter`。
- 中文展示标题使用高质量中文衬线回退字体。
- 中文正文使用系统无衬线回退字体。
- 数字统计优先使用 `Inter`，必要时启用等宽数字。

建议字体栈：

```css
--font-display: "Playfair Display", "Songti SC", "STSong", Georgia, serif;
--font-body: "Inter", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
```

### 3.1 字号层级

- Hero：桌面 `clamp(3.25rem, 6vw, 5.7rem)`；手机不超过 `4.4rem`。
- 页面主标题：`40–56px`。
- 区块标题：`28–40px`。
- 卡片标题：`20–26px`。
- 正文：`15–17px`。
- 表单和后台正文：`14–15px`。
- 辅助信息：不得小于 `12px`。

标题字距应略微收紧，正文行高保持 `1.6–1.9`。

## 4. 布局与间距

- 内容最大宽度建议 `1160–1280px`。
- 页面左右安全间距：桌面至少 `24px`，手机至少 `12px`。
- 使用 4px 基础间距体系：`4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96`。
- 页面区块垂直间距建议 `72–120px`。
- 卡片内部间距建议 `20–32px`。
- 相关元素靠近，无关元素通过留白分组。
- 不使用拥挤的数据墙，也不使用无意义的大面积空白。

## 5. 导航规范

### 5.1 公开网站顶部导航

- 使用悬浮或粘性毛玻璃导航。
- 高度约 `58–68px`。
- Logo 在左，核心菜单居中，主题切换和主操作在右。
- 边框细而克制，阴影柔和。
- 移动端折叠菜单不得挤压 Logo 和主题按钮。

### 5.2 管理后台导航

- 不允许使用厚重纯黑侧边栏。
- 不允许使用高饱和蓝色整行作为选中状态。
- 导航应使用暖色中性背景、细边框和清晰分组。
- 可使用轻量侧边导航、双层导航或窄图标栏，但必须保持同一视觉语言。
- 选中状态使用 `--accent-soft`、`--accent` 和 `--border-strong`。
- 图标必须属于同一套线性图标系统，尺寸和描边统一。
- 一级导航按“管理 / 内容 / 系统”等语义分组。
- 高频页面切换应迅速，不使用拖沓过渡。

## 6. 玻璃拟态

玻璃拟态只用于：

- 顶部导航；
- 浮层；
- Hero 中的重点控制卡；
- 少量高价值展示卡片。

标准样式：

```css
.card {
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  backdrop-filter: blur(22px) saturate(128%);
  -webkit-backdrop-filter: blur(22px) saturate(128%);
}
```

规则：

- 不能让所有容器都变成玻璃卡片。
- 玻璃层上的文字必须保持足够对比度。
- 模糊强度建议 `14–24px`。
- 不使用厚重白色描边制造廉价玻璃效果。
- 阴影不得又黑又硬。

## 7. 圆角与边框

- 输入框和普通按钮：`10–12px`。
- 普通卡片：`14–18px`。
- 重点 Hero 卡片：可使用 `20–24px`。
- 圆形仅用于图标按钮、头像和状态点。
- 不允许所有元素都使用超大圆角或胶囊形状。
- 默认边框 `1px solid var(--border)`。
- 强调边框使用 `var(--border-strong)`。

## 8. 按钮

### 8.1 主按钮

- 使用金色渐变，只能由 `--accent-hover`、`--accent` 及其派生色组成。
- 文字颜色必须满足对比度。
- 高度建议 `42–48px`。
- 按压状态使用 `scale(0.97)`。
- Hover 可轻微上移 `1–2px` 并增加柔和金色光晕。

### 8.2 次要按钮

- 使用半透明或中性背景。
- 边框使用 `--border`。
- Hover 使用 `--accent-soft` 和 `--border-strong`。

### 8.3 危险操作

- 不得使用品牌金色表示删除或危险动作。
- 危险色应低饱和并仅在必要场景出现。
- 删除、覆盖、回滚等必须二次确认。

## 9. 表单与输入框

- 输入框背景使用 `--bg-secondary` 或 `--bg-elevated`。
- 默认边框为 `--border`。
- 聚焦时使用 `--accent` 边框和柔和金色焦点环。
- 不得只依赖颜色表达错误或成功。
- 每个输入框必须有可访问名称或可见标签。
- 错误提示靠近对应字段，文字简洁明确。
- 禁用状态仍需保持可读。

推荐焦点样式：

```css
input:focus-visible,
button:focus-visible,
a:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 5px color-mix(in srgb, var(--accent) 18%, transparent);
}
```

## 10. 数据卡片、表格和状态

- 统计卡片突出数字，不用图标和装饰抢夺注意力。
- 表格表头清晰，行高适中，操作列固定且可识别。
- 行 Hover 使用极轻的 `--accent-soft`。
- 状态使用“图标/圆点 + 文字 + 颜色”，不能只显示颜色。
- 手机端表格必须转换成卡片、分组列表或可控横向滚动。
- 空状态需说明原因和下一步操作。
- 加载状态优先使用骨架或局部进度，不整页阻塞。

## 11. 页面背景与光影

- 页面背景使用 `--bg-primary`。
- 允许使用极轻的径向金色光晕。
- 光晕必须淡，不得影响文字阅读。
- 可使用低透明度网格或纹理，但必须逐渐淡出。
- 不使用蓝紫霓虹、赛博朋克背景和大面积彩色渐变。

## 12. 动效规范

### 12.1 强制参数

```css
--ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
--duration-fast: 0.3s;
--duration-standard: 0.35s;
--duration-slow: 0.4s;
```

- 所有常规过渡必须使用 `cubic-bezier(0.4, 0, 0.2, 1)`。
- 时长必须控制在 `0.3–0.4s`。
- 按钮按压可即时缩放，不能产生延迟感。
- 主题按钮需要太阳/月亮旋转、缩放和透明度切换。
- 卡片 Hover 最多上移 `5px`。
- 弹窗、菜单和浮层使用轻微位移或缩放配合透明度。
- 高频键盘操作和高频导航不使用复杂动画。
- 禁止弹跳、橡皮筋、长时间漂浮和无意义循环动画。

### 12.2 性能

- 优先过渡 `transform`、`opacity`、颜色和阴影。
- 避免持续动画布局属性。
- 动效必须可被打断。
- 低性能设备上不得造成明显掉帧。

### 12.3 减少动态效果

必须支持：

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

## 13. 主题系统

- 使用根节点 `data-theme="light"` 和 `data-theme="dark"`。
- 所有颜色必须来自 CSS 变量。
- 禁止在业务组件中硬编码浅色或深色背景。
- 用户主动选择后写入 `localStorage`。
- 用户未选择时跟随 `prefers-color-scheme`。
- 页面初始化时必须在首屏渲染前恢复主题，避免闪烁。
- 新组件必须同时验证两套主题。

## 14. 响应式断点建议

- 手机：`< 680px`
- 平板：`680–900px`
- 小型桌面：`900–1200px`
- 宽屏：`> 1200px`

要求：

- 不只缩小桌面布局，需要重新组织信息优先级。
- 手机端按钮主要操作可占满宽度。
- 导航需要折叠。
- Hero 由双栏变单栏。
- 最小触摸区域建议 `42×42px`。
- 不允许出现不可控横向滚动。

## 15. 可访问性

- 文本和背景必须保持可读对比度。
- 键盘可以访问全部交互元素。
- 必须有清晰的 `:focus-visible`。
- 图标按钮必须提供 `aria-label`。
- 表单控件必须绑定标签。
- 图片必须提供合适的替代文本。
- 不仅依靠颜色表达状态。
- 装饰图形需要从辅助技术中隐藏。

## 16. 明确禁止的设计

- 纯黑或纯白大面积背景；
- 蓝紫渐变作为主视觉；
- 霓虹、赛博朋克和游戏 HUD 风格；
- 厚重黑色后台侧边栏；
- 高饱和蓝色整行选中导航；
- 所有元素都做成圆角卡片；
- 过多玻璃拟态；
- 过多阴影和发光；
- 超大胶囊按钮；
- 模板化后台布局和廉价图标；
- 低对比度灰字；
- 无意义的装饰动画；
- 同一页面混用多套图标风格；
- 未经确认引入新的主色或字体。

## 17. 页面级要求

### 17.1 公开首页

- 毛玻璃顶部导航；
- 高级但克制的 Hero；
- 两个层级清晰的操作按钮；
- 3–4 个核心能力卡片；
- 展示域名跳转、静态网站和软件分发的统一定位；
- 简洁页脚。

### 17.2 管理后台

- 视觉语言与公开首页一致；
- 信息密度高于营销页，但不能拥挤；
- 导航、表格、筛选器和表单优先保证效率；
- 重要指标突出数字，装饰退后；
- 危险操作明显区分并确认。

### 17.3 登录页

- 保持品牌感和金色光影；
- 不使用传统后台蓝色登录框；
- 表单简洁，错误反馈清晰；
- 不添加无关轮播或大段营销内容。

## 18. 视觉验收清单

每个页面合并前必须全部满足：

- [ ] 仅使用批准的主题变量和必要派生色；
- [ ] 不存在纯黑 `#000` 或纯白 `#fff` 普通页面色；
- [ ] 浅色模式通过视觉检查；
- [ ] 深色模式通过视觉检查；
- [ ] 桌面布局通过检查；
- [ ] 平板布局通过检查；
- [ ] 手机布局通过检查；
- [ ] 导航符合本规范；
- [ ] 主次按钮层级清晰；
- [ ] 所有输入框有聚焦状态；
- [ ] 所有交互元素有 Hover、Active、Focus 和 Disabled 状态；
- [ ] 动效曲线和时长符合规定；
- [ ] 支持减少动态效果；
- [ ] 没有模板化后台或廉价视觉元素；
- [ ] 文本可读、状态不只依赖颜色；
- [ ] 页面截图与现有视觉原型处于同一设计体系。

## 19. 实现基准

当前可运行基准文件：

- `design-system-preview.html`
- `design-system-preview.png`
- `design-system-preview-dark.png`

基准文件用于确认视觉方向。正式开发可以组件化和工程化，但不得削弱其色彩、排版、空间、材质和动效品质。

