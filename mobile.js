document.addEventListener("DOMContentLoaded", () => {
    const { Transformer, Markmap } = window.markmap;
    const transformer = new Transformer();
    const svgEl = document.querySelector('#markmap');
    const editor = document.getElementById('editor');
    
    // UI 面板
    const overlay = document.getElementById('mobile-overlay');
    const actionSheet = document.getElementById('mobile-action-sheet');
    const settingsSheet = document.getElementById('mobile-settings-sheet');
    const exportSheet = document.getElementById('mobile-export-sheet');
    const editorDrawer = document.getElementById('mobile-editor-drawer');
    const nodeTitle = document.getElementById('node-title');

    // ==========================================
    // 全局配置与存储
    // ==========================================
    // CONFIG_KEY, DATA_KEY, TIME_KEY, EXPIRE_MS 由 main.js 全局提供

    let userConfig = JSON.parse(localStorage.getItem(CONFIG_KEY)) || { fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif', fontSize: 15 };
    const fontSelect = document.getElementById('config-font-family');
    const sizeRange = document.getElementById('config-font-size');
    const sizeVal = document.getElementById('config-font-size-val');

    // 载入本地字体：@font-face CSS 始终生成，阿选项仅在原生应用模式下展示
    let localFontCSS = '';
    const _fontFaceMap = new Map(); // fontValue → FontFace 对象
    const _fontFileMap = new Map(); // fontValue → 字体文件路径
    (window.customLocalFonts || []).forEach(font => {
        const fontValue = `'${font.family}', sans-serif`;
        localFontCSS += `@font-face { font-family: '${font.family}'; src: url('./fonts/${font.file}'); }\n`;
        // 仅在原生应用模式下展示自定义字体选项
        // Web 端导出受浏览器安全限制无法加载本地字体，展示出来会让用户困惑
        if (fontSelect && _isNativeApp) {
            const option = document.createElement('option');
            option.value = fontValue;
            option.textContent = `📁 ${font.name}`;
            fontSelect.appendChild(option);
        }
        // FontFace 对象注册到 document.fonts，不立即下载
        try {
            const ff = new FontFace(font.family, `url('./fonts/${font.file}')`);
            document.fonts.add(ff);
            _fontFaceMap.set(fontValue, ff);
            _fontFileMap.set(fontValue, font.file); // 存储文件路径以供导出预热用
        } catch (_) {}
    });

    /** 确保指定字体已下载（如果尚未下载则触发下载） */
    function _ensureFont(fontValue) {
        const ff = _fontFaceMap.get(fontValue);
        if (!ff || ff.status === 'loaded') return Promise.resolve();
        return ff.load().catch(() => null);
    }

    function applyConfig(isInit = false) {
        if(fontSelect) fontSelect.value = userConfig.fontFamily;
        if(sizeRange) sizeRange.value = userConfig.fontSize;
        if(sizeVal) sizeVal.innerText = userConfig.fontSize + 'px';

        let styleDef = svgEl.querySelector('#dynamic-map-style');
        if (!styleDef) {
            styleDef = document.createElementNS('http://www.w3.org/2000/svg', 'style');
            styleDef.id = 'dynamic-map-style';
            svgEl.prepend(styleDef);
        }
        
        // 核心：强制注入详尽的基础 CSS，解决移动端 SVG 体积偏小且丢样式的问题
        styleDef.textContent = `
            ${localFontCSS}
            text, foreignObject { 
                font-family: ${userConfig.fontFamily} !important; 
                color: #1e293b !important;
            }
            svg { font-size: ${userConfig.fontSize}px !important; }
            path.markmap-link { fill: none !important; stroke: #cbd5e1 !important; stroke-width: 1.5px !important; }
            .markmap-node > circle { stroke: #3b82f6 !important; stroke-width: 1.5px !important; cursor: pointer; }
        `;
        
        localStorage.setItem(CONFIG_KEY, JSON.stringify(userConfig));
        if (!isInit && currentDataTree) { mm.setData(currentDataTree); mm.fit(); }
    }

    if(fontSelect) fontSelect.addEventListener('change', (e) => {
        userConfig.fontFamily = e.target.value;
        applyConfig(); // 先用备用字体立即显示
        saveToHistory();
        // 检查字体是否需要下载
        const ff = _fontFaceMap.get(e.target.value);
        if (ff && ff.status !== 'loaded') {
            // 显示加载进度：在当前选项文字前加 ⏳
            const selIdx = fontSelect.selectedIndex;
            const origText = fontSelect.options[selIdx].textContent;
            fontSelect.options[selIdx].textContent = '⏳ ' + origText.replace(/^[⏳✅]\s*/, '');
            fontSelect.disabled = true;
            _ensureFont(e.target.value).then(() => {
                fontSelect.options[selIdx].textContent = origText;
                fontSelect.disabled = false;
                if (currentDataTree) { mm.setData(currentDataTree); mm.fit(); }
            });
        } else {
            _ensureFont(e.target.value).then(() => {
                if (currentDataTree) { mm.setData(currentDataTree); mm.fit(); }
            });
        }
    });
    if(sizeRange) sizeRange.addEventListener('input', (e) => { userConfig.fontSize = e.target.value; applyConfig(); });
    if(sizeRange) sizeRange.addEventListener('change', () => { saveToHistory(); });

    let savedData = localStorage.getItem(DATA_KEY);
    let savedTime = localStorage.getItem(TIME_KEY);
    if (savedData && savedTime && (Date.now() - parseInt(savedTime) > EXPIRE_MS)) {
        savedData = null; localStorage.removeItem(DATA_KEY); localStorage.removeItem(TIME_KEY);
    }

    const defaultTemplate = `# 思维导图生成器
## 1. 输入 Markdown 格式文本
## 2. 适当调整与编辑节点
## 3. 完美展示与无损导出
- 点击右下角 [?] 查看全部操作提示与说明
    `;

    const helpTemplate = `# 📖 Mindmap Pro 操作指引
## ✍️ 基础工作流
- 在左侧输入 **Markdown** 格式的文本
- 右侧画布将自动、实时渲染为思维导图
- 适当调整结构后，点击右上角进行无损导出
## ⌨️ 快捷操作与编辑
- **双击文本**：快速全选并复制节点内容
- **F2** 或 **✎**：进入沉浸式原位编辑状态
- **Tab / Enter**：快速新增 次级 / 同级 节点
- **Del / Backspace**：删除当前节点及其分支
- **Ctrl + Z**：全局撤销上一步操作
## 🖱️ 视图与外观控制
- 拖拽空白处可平移，滚轮可缩放画布
- 点击节点前的圆圈 \`○\` 可折叠/展开分支
- 点击右下角 \`Aa\` 可永久更改全局字体与字号
## ⚠️ 隐私与免责声明
- **纯本地运行**：100% 离线单机运行，没有任何数据上传至服务器。
- **阅后即焚**：闲置超 2 小时自动彻底销毁画布数据（外观配置除外）。
- **技术鸣谢**：底层渲染技术基于开源项目 Markmap 与 D3.js。
    `;

    editor.value = savedData || defaultTemplate;
    const mm = Markmap.create(svgEl);
    applyConfig(true); 

    let currentDataTree = null;
    let activeNodeData = null;  
    let activeGElement = null;  
    let historyStack = [];
    let historyIndex = -1;

    function saveToHistory() {
        const currentText = editor.value;
        const currentState = { text: currentText, config: JSON.parse(JSON.stringify(userConfig)) };
        if (historyIndex >= 0 && historyStack[historyIndex].text === currentText) return;
        historyStack = historyStack.slice(0, historyIndex + 1); 
        historyStack.push(currentState);
        historyIndex++;
        localStorage.setItem(DATA_KEY, currentText); 
        localStorage.setItem(TIME_KEY, Date.now().toString()); 
    }

    function undo() {
        if (historyIndex > 0) {
            historyIndex--;
            editor.value = historyStack[historyIndex].text;
            userConfig = JSON.parse(JSON.stringify(historyStack[historyIndex].config));
            applyConfig(true); renderMap(false); closeAllSheets();
        }
    }

    function renderMap(recordHistory = true) {
        const { root } = transformer.transform(editor.value);
        currentDataTree = root; mm.setData(root); mm.fit();
        if (recordHistory) saveToHistory();
    }

    let renderTimeout;
    editor.addEventListener('input', () => { clearTimeout(renderTimeout); renderTimeout = setTimeout(() => renderMap(true), 400); });

    // 仅预加载当前选中的字体，完成后再首次渲染
    _ensureFont(userConfig.fontFamily).finally(() => renderMap(true));

    // treeToMarkdown() 由 main.js 全局提供

    // ==========================================
    // UI 面板逻辑
    // ==========================================
    function closeAllSheets(fitToCenter = false) {
        if (activeGElement) activeGElement.classList.remove('selected-node');
        activeGElement = null; activeNodeData = null;
        actionSheet.classList.remove('open');
        exportSheet.classList.remove('open');
        settingsSheet.classList.remove('open');
        overlay.classList.remove('open');
        if (fitToCenter) setTimeout(() => mm.fit(), 200);
    }

    function openSheet(sheetEl) {
        actionSheet.classList.remove('open'); exportSheet.classList.remove('open'); settingsSheet.classList.remove('open');
        overlay.classList.add('open'); sheetEl.classList.add('open');
    }

    overlay.addEventListener('click', () => closeAllSheets(true));

    let lastClickTime = 0;
    svgEl.addEventListener('click', (e) => {
        if (e.target.tagName.toLowerCase() === 'circle') { closeAllSheets(false); return; }
        
        // 放行双击全选
        const currentTime = new Date().getTime();
        if (currentTime - lastClickTime < 300) { window.getSelection().removeAllRanges(); lastClickTime = 0; return; }
        lastClickTime = currentTime;

        let target = e.target.closest('g');
        while (target && !target.__data__) { target = target.parentElement ? target.parentElement.closest('g') : null; }
        if (!target) { closeAllSheets(true); return; }
        
        activeGElement = target; activeGElement.classList.add('selected-node'); 
        activeNodeData = target.__data__.data || target.__data__; 
        
        const contentEl = target.querySelector('text, foreignObject');
        if (contentEl) {
            const rect = contentEl.getBoundingClientRect();
            const containerRect = svgEl.parentElement.getBoundingClientRect();
            const transform = d3.zoomTransform(svgEl);
            const dx = (containerRect.left + containerRect.width / 2) - (rect.left + rect.width / 2);
            const dy = (containerRect.top + containerRect.height / 2) - 120 - (rect.top + rect.height / 2);
            d3.select(svgEl).transition().duration(300).call(mm.zoom.translateBy, dx / transform.k, dy / transform.k);
        }
        nodeTitle.innerText = activeNodeData.content || "节点";
        openSheet(actionSheet);
    });

    // ==========================================
    // 🚀 核心优化：按需计算的极速导出引擎
    // ==========================================
    
    // 导出函数：关闭面板后交由 shared.js 的通用导出函数处理
    function downloadSVG() {
        closeAllSheets(false);
        exportSVG(svgEl, mm);
    }

    function downloadPNG() {
        closeAllSheets(false);
        exportPNG(svgEl, mm, 5.5, 2); // 移动端: maxRatio=5.5, baseMultiplier=2
    }

    // ==========================================
    // 弹窗与事件绑定
    // ==========================================
    // openPrompt(), closePrompt() 由 main.js 全局提供

    // ==========================================
    // 🚀 修复：缓存状态，避免关闭抽屉时丢失目标节点
    // ==========================================
    document.getElementById('btn-edit').addEventListener('click', () => {
        const targetNode = activeNodeData; // 先把目标节点死死抓住！
        if (!targetNode) return;
        closeAllSheets(false); // 然后再放心收起抽屉
        
        const old = targetNode.content || targetNode.payload?.content;
        openPrompt("修改文本", old, (text) => {
            if (text && text !== old) {
                targetNode.content = text; if(targetNode.payload) targetNode.payload.content = text;
                editor.value = treeToMarkdown(currentDataTree).trim(); renderMap(true); closeAllSheets(true);
            } else { closeAllSheets(true); }
        });
    });

    document.getElementById('btn-add-child').addEventListener('click', () => {
        const targetNode = activeNodeData;
        if (!targetNode) return;
        closeAllSheets(false);
        
        openPrompt("次级节点", "", (text) => {
            if (text) {
                if (!targetNode.children) targetNode.children = [];
                targetNode.children.push({ content: text, payload: { content: text }, children: [] });
                editor.value = treeToMarkdown(currentDataTree).trim(); renderMap(true); closeAllSheets(true);
            }
        });
    });

    document.getElementById('btn-add-sibling').addEventListener('click', () => {
        const targetNode = activeNodeData;
        if (!targetNode) return;
        if (targetNode === currentDataTree) return alert("根节点无法创建同级");
        closeAllSheets(false);
        
        const parent = findParent(currentDataTree, targetNode);
        
        if (parent) {
            openPrompt("同级节点", "", (text) => {
                if (text) {
                    const idx = parent.children.indexOf(targetNode);
                    parent.children.splice(idx + 1, 0, { content: text, payload: { content: text }, children: [] });
                    editor.value = treeToMarkdown(currentDataTree).trim(); renderMap(true); closeAllSheets(true);
                }
            });
        }
    });

    document.getElementById('btn-delete').addEventListener('click', () => {
        const targetNode = activeNodeData;
        if (!targetNode) return;
        if (targetNode === currentDataTree) return alert("根节点不可删除");
        closeAllSheets(false);
        
        const parent = findParent(currentDataTree, targetNode);
        
        if (parent) {
            parent.children = parent.children.filter(n => n !== targetNode);
            editor.value = treeToMarkdown(currentDataTree).trim(); renderMap(true); closeAllSheets(true);
        }
    });

    document.getElementById('btn-toggle-editor').addEventListener('click', () => { closeAllSheets(false); editorDrawer.classList.add('open'); });
    document.getElementById('btn-close-editor').addEventListener('click', () => { editorDrawer.classList.remove('open'); renderMap(true); });
    document.getElementById('btn-undo').addEventListener('click', undo);
    document.getElementById('btn-zoom-in').addEventListener('click', () => mm.svg.transition().duration(300).call(mm.zoom.scaleBy, 1.2));
    document.getElementById('btn-zoom-out').addEventListener('click', () => mm.svg.transition().duration(300).call(mm.zoom.scaleBy, 0.8));
    document.getElementById('btn-fit').addEventListener('click', () => mm.fit());
    document.getElementById('btn-settings').addEventListener('click', () => openSheet(settingsSheet));
    document.getElementById('btn-export-menu').addEventListener('click', () => openSheet(exportSheet));
    document.getElementById('btn-help').addEventListener('click', () => { if(confirm("重置以查看帮助？")){ editor.value = helpTemplate; renderMap(true); closeAllSheets(true); } });

    document.getElementById('btn-export-svg').addEventListener('click', downloadSVG);
    document.getElementById('btn-export-png').addEventListener('click', downloadPNG);
});