# 更新日志 (Changelog)

## v3.1 — PNG 导出性能大幅优化

### 优化
- **`exportPNG`**：彻底废弃 `html-to-image` 库，改用 **SVG→Image→Canvas** 管线
  - **慢的根因**：`html-to-image` 对每个 `<foreignObject>`（每个节点的文字）做一次串行异步化，20 个节点 = 20 次顺序等待，节点越多越慢
  - **新方案**：复用已有的 SVG 清洗逻辑（`_buildExportSVG` + `_replaceForeignObjects`），生成干净 SVG → 加载为 `<img>` → 一次性绘入 Canvas → `toDataURL` 导出，速度提升 **5~10 倍**
- **提取 `_buildExportSVG` / `_cloneToUrl`**：`exportSVG` 和 `exportPNG` 现在共用同一套 SVG 生成逻辑，彻底消除重复代码

---

## v3.0 — 架构重构：Three-File → Two-File

### 重构
- **`shared.js` 废弃，内容全部合并到 `main.js` 顶层全局作用域**
  - `main.js` 现在同时是：通用工具库（`treeToMarkdown`、`findParent`、`openPrompt/closePrompt`、`exportSVG/exportPNG` 等全局函数）+ PC 端引擎（DOMContentLoaded 区，加了移动端守卫自动跳过）
  - `mobile.js` 保持纯移动端 UI 专属代码
- **`mobile.html`** 将 `shared.js` 改为加载 `main.js`（含全局工具）+ `mobile.js`（移动端 UI）
- **`index.html`** 移除 `shared.js` 引用，只需 `main.js`

### 工作流图
```
index.html  → main.js（全局工具 + PC 引擎）
mobile.html → main.js（全局工具，守卫使 PC 引擎自动跳过）
              ↓ + mobile.js（移动端 UI）
```

---

## v2.1 — SVG 导出兼容性增强

### 修复
- **`shared.js` `exportSVG`**：重写 SVG 导出逻辑，彻底解决 markmap 生成的 SVG 在 Inkscape、Office、iOS/Android SVG 查看器、PDF 转换工具等场景下显示异常的问题。
  - **根本原因**：markmap 使用 `<foreignObject>` 标签嵌入 HTML 来渲染文字，此标签在标准 SVG 解析器中兼容性极差。
  - **修复方案**：导出时对 SVG 进行深克隆（不再修改页面实时图），然后将克隆体中所有 `<foreignObject>` 节点替换为原生 SVG `<text>` 元素，字体/颜色从实时元素的计算样式中读取并写入属性，导出的是 100% 纯标准 SVG。

---

## v2.0 — 代码统一化重构 + Bug 修复

### 新增
- **`shared.js`**：提取两端公共逻辑，集中管理，避免未来重复修复：
  - 存储常量（`CONFIG_KEY`, `DATA_KEY`, `TIME_KEY`, `EXPIRE_MS`）
  - `treeToMarkdown(node, depth)` — 树→Markdown 转换
  - `findParent(node, targetChild)` — 树中查找父节点
  - `openPrompt(title, defaultValue?, callback)` — 通用输入弹窗（兼容 PC 2参数 / 移动端 3参数写法）
  - `closePrompt()` — 关闭弹窗
  - `exportSVG(svgEl, mm)` — SVG 矢量图导出核心逻辑
  - `exportPNG(svgEl, mm, maxRatio, baseMultiplier)` — PNG 高清图导出核心逻辑

### 修复
- **`index.html`**：删除误写的多余第二个 `</head>` 标签（HTML 结构错误）
- **`main.js` (`executeAction`)**：加入 `const targetNode = activeNodeData` 提前缓存，防止异步回调产生竞态崩溃；同时为 `add-child` 和 `add-sibling` 补充了空输入守卫 `if (!text) return`
- **`mobile.js` (`btn-add-sibling`, `btn-delete`)**：将两处内联重复的 `findP` 函数替换为全局 `findParent`

### 优化（上一版已做）
- **移动端交互 (`mobile.js`)**：4 个操作按钮均改用 `targetNode` 缓存，防止关闭抽屉时丢失目标节点
- **控制台消音 (`index.html`, `mobile.html`)**：屏蔽 Tailwind CDN 版本的 `console.warn` 噪音
