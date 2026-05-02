// ==========================================
// 全局常量与工具函数（PC 端与移动端均可访问）
// main.js 同时作为两端的工具库 + PC 端引擎
// ==========================================

const CONFIG_KEY = 'markmap_global_config';
const DATA_KEY   = 'markmap_data';
const TIME_KEY   = 'markmap_data_time';
const EXPIRE_MS  = 2 * 60 * 60 * 1000;

// 原生应用环境检测（Electron / Tauri / 其他封装）
// 原生环境下可通过 IPC / 自定义协议加载本地字体文件，自定义字体导出正常
// Web 端（file:// / http://）受浏览器安全限制，自定义字体无法在导出文件中使用
// 要启用原生模式：在 preload.js 中设置 window.electronAPI = {...} 或 window.__TAURI__
const _isNativeApp = !!(window.electronAPI || window.__TAURI__ || window._nativeApp);

/** 树结构 → Markdown */
function treeToMarkdown(node, depth = 1) {
    let md = "";
    const content = node.content || node.payload?.content || "新节点";
    if (depth === 1) md += `# ${content}\n`;
    else if (depth === 2) md += `## ${content}\n`;
    else if (depth === 3) md += `### ${content}\n`;
    else md += `${"  ".repeat(Math.max(0, depth - 4))}- ${content}\n`;
    if (node.children) node.children.forEach(child => md += treeToMarkdown(child, depth + 1));
    return md;
}

/** 在树中查找目标节点的父节点 */
function findParent(node, targetChild) {
    if (!node.children) return null;
    for (let child of node.children) {
        if (child === targetChild) return node;
        const found = findParent(child, targetChild);
        if (found) return found;
    }
    return null;
}

/**
 * 通用输入弹窗（兼容 PC 两参数 / 移动端三参数写法）
 * @param {string}          title
 * @param {string|Function} defaultValueOrCallback
 * @param {Function}        [callback]
 */
function openPrompt(title, defaultValueOrCallback, callback) {
    const modal          = document.getElementById('prompt-modal');
    const modalTitle     = document.getElementById('prompt-title');
    const modalInput     = document.getElementById('prompt-input');
    const modalConfirmBtn= document.getElementById('prompt-confirm');

    let defaultValue = '';
    if (typeof defaultValueOrCallback === 'function') {
        callback = defaultValueOrCallback;
    } else {
        defaultValue = defaultValueOrCallback || '';
    }

    modalTitle.innerText = title;
    modalInput.value     = defaultValue;
    modal.classList.remove('hidden');
    setTimeout(() => modalInput.focus(), 100);

    const doConfirm = () => { callback(modalInput.value.trim()); closePrompt(); };
    modalConfirmBtn.onclick  = doConfirm;
    modalInput.onkeydown     = (e) => {
        if (e.key === 'Enter')  doConfirm();
        if (e.key === 'Escape') closePrompt();
    };
}

function closePrompt() {
    document.getElementById('prompt-modal').classList.add('hidden');
}

// ==========================================
// 导出工具
// ==========================================

/**
 * 内部工具：构建用于导出的干净 SVG 克隆体
 * - 几何校正（padding + viewBox 归一化）
 * - foreignObject → 原生 SVG text 替换
 * （不内嵌字体文件，由调用方决定如何处理字体路径）
 */
function _buildExportSVG(svgEl) {
    const gLive   = svgEl.querySelector('g');
    const bbox    = gLive.getBBox();
    // 适当加大 padding 防止溢出裁剪
    const padding = 100;
    const width   = bbox.width  + padding * 2;
    const height  = bbox.height + padding * 2;

    const clone  = svgEl.cloneNode(true);
    const gClone = clone.querySelector('g');

    clone.setAttribute('width',   width);
    clone.setAttribute('height',  height);
    clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
    gClone.setAttribute('transform',
        `translate(${padding - bbox.x}, ${padding - bbox.y}) scale(1)`);

    // 注意：我们不再调用 _replaceForeignObjects 把 HTML 转为 <text>！
    // 强制保留 <foreignObject> 才能 100% 保持 Markdown 加粗、斜体和原生表情符号（Emoji）系统 fallback 获取。
    return { clone, width, height };
}

/**
 * 内部工具：SVG 克隆体 → data URL（用于 SVG 文件下载）
 * 保留相对字体路径，SVG 与 fonts 目录在同位置时字体可正常加载。
 */
function _cloneToUrl(clone, xmlDecl = false) {
    let src = new XMLSerializer().serializeToString(clone);
    if (!src.includes('xmlns="http://www.w3.org/2000/svg"'))
        src = src.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    if (xmlDecl) src = '<?xml version="1.0" standalone="no"?>\r\n' + src;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src);
}

/**
 * 内部工具：缓存已获取的字体以防重复请求
 */
const _fontCache = {};

/**
 * 内部工具：Base64 TTC-Patch 内嵌字体加载器
 * 不使用 opentype.js 转曲，而是直接读取二进制字节流 -> 内存修复包含 ttcf 的格式 -> FileReader 转 base64内嵌。
 * 这保证了导出 SVG 不丢失任何 Markdown 富文本特性结构！
 */
async function _inlineFonts(cloneSvg, currentFontFamily) {
    const localFonts = window.customLocalFonts || [];
    const activeFont = localFonts.find(f => currentFontFamily && currentFontFamily.includes(f.family));
    if (!activeFont) return; 

    const fontPath = `./fonts/${activeFont.file}`;
    
    if (!_fontCache[fontPath]) {
        try {
            const fontUrl = new URL(fontPath, window.location.href).href;
            const resp = await fetch(fontUrl);
            let buffer = await resp.arrayBuffer();

            // 转化为 Base64
            let mime = 'application/x-font-ttf';
            if (activeFont.file.toLowerCase().endsWith('.woff2')) mime = 'font/woff2';
            
            let base64 = await new Promise(resolve => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.readAsDataURL(new Blob([buffer], { type: mime }));
            });
            
            _fontCache[fontPath] = `url('${base64}') format('truetype')`;
        } catch (e) {
            console.error('动态打包 TTF Base64 字体失败:', fontPath, e);
        }
    }

    if (_fontCache[fontPath]) {
        // 利用标准 <defs><style> 将提取出的精准 TTF 注入 SVG 内部
        let defs = cloneSvg.querySelector('defs');
        if (!defs) {
            defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            cloneSvg.insertBefore(defs, cloneSvg.firstChild);
        }
        const overrideStyle = document.createElementNS('http://www.w3.org/2000/svg', 'style');
        overrideStyle.textContent = `@font-face { font-family: '${activeFont.family}'; src: ${_fontCache[fontPath]}; }`;
        defs.appendChild(overrideStyle);
    }
}

/**
 * 内部工具：SVG 克隆体 → Blob URL（用于 PNG 渲染）
 * 因为前面已调用 _inlineFonts 转成了 base64，这里的备用绝对路径转换也安全
 */
function _cloneToBlobUrl(clone) {
    const fontBase = new URL('./fonts/', window.location.href).href;
    const styleEl  = clone.querySelector('#dynamic-map-style');
    if (styleEl) {
        styleEl.textContent = styleEl.textContent.replace(
            /url\(['"\s]?(\.\/fonts\/[^'"\s)]+)['"\s]?\)/g,
            (_, rel) => `url('${fontBase}${rel.replace('./fonts/', '')}')`
        );
    }
    let src = new XMLSerializer().serializeToString(clone);
    if (!src.includes('xmlns="http://www.w3.org/2000/svg"'))
        src = src.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    const blob = new Blob([src], { type: 'image/svg+xml' });
    return URL.createObjectURL(blob);
}

// 【弃用】_replaceForeignObjects 已经移除：保留 <foreignObject> 是支持 Markdown 等级富文本的关键！

/**
 * 导出 SVG 矢量图
 * - foreignObject → 原生 text（跨平台兼容）
 * - 字体保留相对路径，SVG 与 fonts 目录同位置时可正常渲染
 */
async function exportSVG(svgEl, mm, currentFontFamily) {
    const { clone } = _buildExportSVG(svgEl);
    
    // 注入 Base64 TTC 解析修补后的安全实体字体结构
    await _inlineFonts(clone, currentFontFamily);
    
    const link = document.createElement('a');
    link.href     = _cloneToUrl(clone, true);
    link.download = 'mindmap_vector.svg';
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    mm.fit();
}

/**
 * 导出 PNG 高清图
 *
 * 方案：SVG 克隆（foreignObject→text）→ Blob URL → <img> → Canvas → PNG
 * - Blob URL 从属于当前页面源，浏览器可加载绝对路径字体，无需 base64 内嵌
 * - 不存在 data: URL 的孤立安全上下文问题 → 字体正常 → 文件体积小
 *
 * @param {SVGElement} svgEl
 * @param {object}     mm
 * @param {number}     maxRatio       最大像素密度（PC: 3，移动: 5.5）
 * @param {number}     baseMultiplier 基础放大系数（PC: 1.5，移动: 2）
 */
function exportPNG(svgEl, mm, maxRatio, baseMultiplier, currentFontFamily) {
    mm.fit();
    setTimeout(async () => {
        try {
            // ① 分辨率计算（以 devicePixelRatio 为下限，保证高 DPI 屏清晰）
            const deviceRatio = window.devicePixelRatio || 1;
            const transform   = d3.zoomTransform(svgEl);
            const targetRatio = Math.min(maxRatio, Math.max(deviceRatio, baseMultiplier / transform.k));

            // 生成干净 SVG (不再调用 convertPaths 去破坏保留有 Markdown 解析引擎特性的外联对象标签)
            const { clone, width, height } = _buildExportSVG(svgEl);

            const canvasW = Math.round(width  * targetRatio);
            const canvasH = Math.round(height * targetRatio);
            clone.setAttribute('width',  canvasW);
            clone.setAttribute('height', canvasH);

            // 让带有 TTC 解析修剪后的 Base64 完美植入 Canvas 的胃口中！
            await _inlineFonts(clone, currentFontFamily);

            // 创建 Blob URL
            const svgUrl = _cloneToBlobUrl(clone);

            // ③ SVG Blob URL → Image
            const img = await new Promise((resolve, reject) => {
                const imgEl   = new Image();
                imgEl.onload  = () => resolve(imgEl);
                imgEl.onerror = () => reject(new Error('SVG→Image 失败'));
                imgEl.src     = svgUrl;
            });
            URL.revokeObjectURL(svgUrl); // 立即释放 Blob URL 内存

            // ④ Image → Canvas → PNG
            const canvas  = document.createElement('canvas');
            canvas.width  = canvasW;
            canvas.height = canvasH;
            const ctx     = canvas.getContext('2d');
            ctx.fillStyle = '#f8fafc';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            // ⑤ 下载
            const link    = document.createElement('a');
            link.download = 'mindmap_hd.png';
            link.href     = canvas.toDataURL('image/png');
            link.click();
        } catch (err) {
            console.error('Export PNG failed:', err);
            alert('导出失败，请重试。');
        }
    }, 350);
}





// ==========================================
// PC 端引擎 + 移动端守卫
// mobile.html 加载此文件时，检测到 #mobile-overlay 即退出，
// 剩余所有初始化由 mobile.js 接管
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    // 两端共用：绑定弹窗取消按钮
    const cancelBtn = document.getElementById('prompt-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', closePrompt);

    // 移动端守卫：检测到移动端特有元素即退出，由 mobile.js 独立接管
    if (document.getElementById('mobile-overlay')) return;

    const { Transformer, Markmap } = window.markmap;
    const transformer = new Transformer();
    const svgEl = document.querySelector('#markmap');
    const editor = document.getElementById('editor');
    const floatingInput = document.getElementById('floating-input');
    const nodeToolbar = document.getElementById('node-toolbar');
    
    // ==========================================
    // 动态加载自定义字体配置
    // ==========================================
    const localFonts = window.customLocalFonts || [];
    const fontSelect = document.getElementById('config-font-family');
    let localFontCSS = '';

    if (localFonts.length > 0) {
        localFonts.forEach(font => {
            // @font-face CSS 始终生成，保证页面渲染正确
            localFontCSS += `@font-face { font-family: '${font.family}'; src: url('./fonts/${font.file}'); }\n`;
            // 仅在原生应用模式下才把自定义字体加入下拉框
            // Web 端导出受浏览器安全限制无法加载本地字体，展示出来会让用户困惑
            if (_isNativeApp) {
                const option = document.createElement('option');
                option.value = `'${font.family}', sans-serif`;
                option.textContent = `📁 ${font.name}`;
                fontSelect.appendChild(option);
            }
        });
    }

    // ==========================================
    // 永久配置与过期销毁保护机制
    // ==========================================

    let userConfig = JSON.parse(localStorage.getItem(CONFIG_KEY)) || {
        fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
        fontSize: 15
    };
    
    const sizeRange = document.getElementById('config-font-size');
    const sizeVal = document.getElementById('config-font-size-val');

    function applyConfig(isInit = false) {
        fontSelect.value = userConfig.fontFamily;
        sizeRange.value = userConfig.fontSize;
        sizeVal.innerText = userConfig.fontSize + 'px';

        let styleDef = svgEl.querySelector('#dynamic-map-style');
        if (!styleDef) {
            styleDef = document.createElementNS('http://www.w3.org/2000/svg', 'style');
            styleDef.id = 'dynamic-map-style';
            svgEl.prepend(styleDef);
        }
        
        styleDef.textContent = `
            ${localFontCSS}
            text, foreignObject { font-family: ${userConfig.fontFamily} !important; }
            svg { font-size: ${userConfig.fontSize}px !important; }
            path.markmap-link { fill: none !important; } 
        `;
        
        floatingInput.style.fontFamily = userConfig.fontFamily;
        localStorage.setItem(CONFIG_KEY, JSON.stringify(userConfig));
        
        if (!isInit && currentDataTree) {
            mm.setData(currentDataTree);
            mm.fit();
            syncUI();
        }
    }

    fontSelect.addEventListener('change', (e) => { 
        userConfig.fontFamily = e.target.value; 
        applyConfig(); 
        saveToHistory(); 
    });
    sizeRange.addEventListener('input', (e) => { 
        userConfig.fontSize = e.target.value; 
        applyConfig(); 
    });
    sizeRange.addEventListener('change', () => { 
        saveToHistory(); 
    });

    let savedData = localStorage.getItem(DATA_KEY);
    let savedTime = localStorage.getItem(TIME_KEY);
    if (savedData && savedTime) {
        if (Date.now() - parseInt(savedTime) > EXPIRE_MS) {
            savedData = null; 
            localStorage.removeItem(DATA_KEY);
            localStorage.removeItem(TIME_KEY);
        }
    }

    // ==========================================
    // 文本模板统一定名
    // ==========================================
    const defaultTemplate = `# 思维导图生成器
## 1. 输入 Markdown 格式文本
## 2. 适当调整与编辑节点
## 3. 完美展示与无损导出
- 点击右下角 [?] 查看全部操作提示与说明`;

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
## ⚠️ 已知问题与隐私声明
- **[Bug] 字体兼容说明**：当前版本导出带 Markdown 样式 (粗体/斜体/表情) 的 SVG/PNG 时，自定义 TTF/TTC 字体可能无法完美呈现格式。此为底层 WebView2 画图引擎天然兼容性限制。
- **纯本地运行**：100% 离线单机运行，没有任何数据上传至服务器。
- **阅后即焚**：闲置超 2 小时自动彻底销毁画布数据。
- **技术鸣谢**：底层渲染技术基于 Markmap 与 D3.js。`;
    
    editor.value = savedData || defaultTemplate;
    const mm = Markmap.create(svgEl);
    applyConfig(true); 

    let currentDataTree = null;
    let activeNodeData = null;  
    let activeGElement = null;  
    let isEditMode = true; 
    let isAnimating = false; 

    let historyStack = [];
    let historyIndex = -1;

    function saveToHistory() {
        const currentText = editor.value;
        const currentState = {
            text: currentText,
            config: JSON.parse(JSON.stringify(userConfig)) 
        };

        if (historyIndex >= 0) {
            const lastState = historyStack[historyIndex];
            if (lastState.text === currentState.text &&
                lastState.config.fontFamily === currentState.config.fontFamily &&
                lastState.config.fontSize == currentState.config.fontSize) {
                return; 
            }
        }

        historyStack = historyStack.slice(0, historyIndex + 1); 
        historyStack.push(currentState);
        historyIndex++;
        
        localStorage.setItem(DATA_KEY, currentText); 
        localStorage.setItem(TIME_KEY, Date.now().toString()); 
    }

    function undo() {
        if (historyIndex > 0) {
            historyIndex--;
            const prevState = historyStack[historyIndex];
            editor.value = prevState.text;
            userConfig = JSON.parse(JSON.stringify(prevState.config));
            applyConfig(true); 
            renderMap(false); 
            clearSelection();
        }
    }

    function renderMap(recordHistory = true) {
        const { root } = transformer.transform(editor.value);
        currentDataTree = root; 
        mm.setData(root);
        mm.fit();
        if (recordHistory) saveToHistory();
    }

    let renderTimeout;
    editor.addEventListener('input', () => {
        clearTimeout(renderTimeout);
        renderTimeout = setTimeout(() => renderMap(true), 400); 
    });
    
    renderMap(true); 


    function syncUI() {
        if (!activeGElement) return;
        const contentEl = activeGElement.querySelector('text, foreignObject');
        if (!contentEl) return;
        
        const rect = contentEl.getBoundingClientRect();
        
        if (nodeToolbar.style.display !== 'none') {
            const isOverflowRight = (rect.right + 100) > window.innerWidth;
            if (isOverflowRight) {
                nodeToolbar.classList.add('menu-left');
                nodeToolbar.style.left = `${rect.left - 12}px`;
            } else {
                nodeToolbar.classList.remove('menu-left');
                nodeToolbar.style.left = `${rect.right + 12}px`;
            }
            nodeToolbar.style.top = `${rect.top + rect.height / 2}px`;
        }

        if (floatingInput.style.display !== 'none') {
            floatingInput.style.left = `${rect.left}px`;
            floatingInput.style.top = `${rect.top - 2}px`;
        }

        if (isAnimating) requestAnimationFrame(syncUI);
    }

    function clearSelection(fitToCenter = true) {
        const wasSelected = !!activeGElement;
        if (activeGElement) activeGElement.classList.remove('selected-node', 'editing-node');
        activeGElement = null;
        activeNodeData = null;
        nodeToolbar.style.display = 'none';
        floatingInput.style.display = 'none';
        isAnimating = false;
        if (wasSelected && fitToCenter) mm.fit();
    }

    function selectNode(targetElement) {
        if (!isEditMode) return false; 
        
        let target = targetElement.closest('g');
        while (target && !target.__data__) {
            target = target.parentElement ? target.parentElement.closest('g') : null;
        }
        if (!target || !target.__data__) return false;
        
        const isSameNode = (activeGElement === target);
        if (isSameNode) return true; 
        
        clearSelection(false); 
        
        activeGElement = target;
        activeGElement.classList.add('selected-node'); 
        const d3Node = target.__data__;
        activeNodeData = d3Node.data || d3Node; 
        
        nodeToolbar.style.display = 'block';

        const contentEl = target.querySelector('text, foreignObject');
        if (contentEl) {
            const rect = contentEl.getBoundingClientRect();
            
            const containerRect = svgEl.parentElement.getBoundingClientRect();
            const cx = containerRect.left + containerRect.width / 2;
            const cy = containerRect.top + containerRect.height / 2;
            const nx = rect.left + rect.width / 2;
            const ny = rect.top + rect.height / 2;
            const dx = cx - nx;
            const dy = cy - ny;

            const transform = d3.zoomTransform(svgEl);
            d3.select(svgEl).transition().duration(300).call(mm.zoom.translateBy, dx / transform.k, dy / transform.k);
            
            isAnimating = true;
            syncUI();
            setTimeout(() => { isAnimating = false; syncUI(); }, 320); 
        }
        return true;
    }

    function toggleEditMode() {
        isEditMode = !isEditMode;
        const btn = document.getElementById('toggle-mode-btn');
        if (isEditMode) {
            btn.innerHTML = '🔓 编辑模式';
            btn.classList.replace('text-slate-500', 'text-blue-600');
        } else {
            btn.innerHTML = '🔒 阅览模式';
            btn.classList.replace('text-blue-600', 'text-slate-500');
            clearSelection(); 
        }
    }

    function zoomMap(scaleFactor) { mm.svg.transition().duration(300).call(mm.zoom.scaleBy, scaleFactor); }


    function triggerEdit() {
        if (!activeNodeData || !activeGElement) return;
        nodeToolbar.style.display = 'none'; 
        
        const contentEl = activeGElement.querySelector('text, foreignObject');
        if (!contentEl) return;
        
        activeGElement.classList.add('editing-node');
        
        const content = activeNodeData.content || activeNodeData.payload?.content;
        floatingInput.value = content;
        floatingInput.style.display = 'block';
        
        const computedStyle = window.getComputedStyle(contentEl);
        floatingInput.style.fontSize = computedStyle.fontSize || '15px';
        
        syncUI(); 
        setTimeout(() => { floatingInput.focus(); floatingInput.select(); }, 10);
    }

    svgEl.addEventListener('click', (e) => {
        if (e.target.tagName.toLowerCase() === 'circle') {
            clearSelection(false); 
            return; 
        }
        if (!selectNode(e.target)) clearSelection(true);
    });


    function syncDataAndRender() {
        editor.value = treeToMarkdown(currentDataTree).trim();
        renderMap(true); 
        clearSelection(true); 
    }

    function executeAction(action) {
        const targetNode = activeNodeData; // 🚀 提前缓存，防止异步回调竞态
        if (!targetNode) return;
        if (action === 'edit') triggerEdit();
        else if (action === 'add-child') {
            openPrompt("输入次级节点内容：", (text) => {
                if (!text) return;
                if (!targetNode.children) targetNode.children = [];
                targetNode.children.push({ content: text, payload: { content: text }, children: [] });
                syncDataAndRender();
            });
        }
        else if (action === 'add-sibling') {
            if (targetNode === currentDataTree) { alert("中心主题无法创建同级节点！"); return; }
            const parent = findParent(currentDataTree, targetNode);
            if (parent && parent.children) {
                openPrompt("输入同级节点内容：", (text) => {
                    if (!text) return;
                    const index = parent.children.indexOf(targetNode);
                    parent.children.splice(index + 1, 0, { content: text, payload: { content: text }, children: [] });
                    syncDataAndRender();
                });
            }
        }
        else if (action === 'delete') {
            if (targetNode === currentDataTree) { alert("中心主题不可删除！"); return; }
            const parent = findParent(currentDataTree, targetNode);
            if (parent && parent.children) {
                parent.children = parent.children.filter(n => n !== targetNode);
                syncDataAndRender();
            }
        }
    }

    document.getElementById('btn-edit').addEventListener('click', () => executeAction('edit'));
    document.getElementById('btn-add-sibling').addEventListener('click', () => executeAction('add-sibling'));
    document.getElementById('btn-add-child').addEventListener('click', () => executeAction('add-child'));
    document.getElementById('btn-delete').addEventListener('click', () => executeAction('delete'));

    function commitEdit() {
        if (!activeNodeData) return;
        
        if (activeGElement) activeGElement.classList.remove('editing-node');
        floatingInput.style.display = 'none';

        const newText = floatingInput.value.trim();
        const oldText = activeNodeData.content || activeNodeData.payload?.content;

        if (newText && newText !== oldText) {
            if (activeNodeData.content !== undefined) activeNodeData.content = newText;
            if (activeNodeData.payload) activeNodeData.payload.content = newText;
            syncDataAndRender(); 
        } else {
            clearSelection(true); 
        }
    }
    
    floatingInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') commitEdit(); });
    floatingInput.addEventListener('blur', commitEdit);

    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
        if (document.activeElement === floatingInput || document.activeElement === editor || document.activeElement === modalInput) return;
        if (activeNodeData && nodeToolbar.style.display !== 'none' && isEditMode) {
            if (e.key === 'Tab') { e.preventDefault(); executeAction('add-child'); }
            if (e.key === 'Enter') { e.preventDefault(); executeAction('add-sibling'); }
            if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); executeAction('delete'); }
            if (e.key === 'F2') { e.preventDefault(); executeAction('edit'); }
            if (e.key === 'Escape') { clearSelection(true); }
        }
    });

    // ==========================================
    // 🚀 响应式折叠逻辑与动态文案
    // ==========================================
    const editorContainer = document.getElementById('editor-container');
    const desktopToggleBtn = document.getElementById('desktop-toggle-btn');
    const isMobile = () => window.innerWidth < 768;

    function updateToggleButton() {
        const isCollapsed = editorContainer.classList.contains('collapsed');
        if (isMobile()) {
            desktopToggleBtn.innerHTML = isCollapsed ? '<span>▼</span> 展开编辑器' : '<span>▲</span> 收起编辑器';
        } else {
            desktopToggleBtn.innerHTML = isCollapsed ? '<span>▶</span> 展开数据面板' : '<span>◀</span> 收起数据面板';
        }
    }

    desktopToggleBtn.addEventListener('click', () => {
        clearSelection(false); 
        editorContainer.classList.toggle('collapsed');
        updateToggleButton();
        setTimeout(() => mm.fit(), 300);
    });

    window.addEventListener('resize', () => {
        updateToggleButton();
        mm.fit();
    });
    
    // 初始化按钮状态
    updateToggleButton();

    document.getElementById('btn-undo').addEventListener('click', undo);
    document.getElementById('btn-zoom-in').addEventListener('click', () => zoomMap(1.2));
    document.getElementById('btn-zoom-out').addEventListener('click', () => zoomMap(0.8));
    document.getElementById('btn-fit').addEventListener('click', () => mm.fit());
    document.getElementById('toggle-mode-btn').addEventListener('click', toggleEditMode);

    document.getElementById('btn-help').addEventListener('click', () => {
        if (confirm("是否要重置画布以查看《操作指引与说明》？\n（注：您可以稍后按 Ctrl+Z 撤回此操作）")) {
            editor.value = helpTemplate;
            renderMap(true);       
            clearSelection(true);  
        }
    });

    // 导出函数：清理选区后交由 shared.js 的通用导出函数处理
    function downloadSVG() {
        if (activeGElement) clearSelection(false);
        exportSVG(svgEl, mm, userConfig.fontFamily);
    }

    function downloadPNG() {
        if (activeGElement) clearSelection(false);
        exportPNG(svgEl, mm, 3, 1.5, userConfig.fontFamily); // PC: maxRatio=3, baseMultiplier=1.5
    }

    document.getElementById('btn-export-svg').addEventListener('click', downloadSVG);
    document.getElementById('btn-export-png').addEventListener('click', downloadPNG);
});