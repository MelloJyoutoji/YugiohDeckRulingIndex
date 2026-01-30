// js/judge-tool.js
// 执裁工具核心功能

// 初始化执裁工具

document.addEventListener('DOMContentLoaded', function() {
    // 所有代码都在这里
    console.log('初始化执裁工具...');
    
    // 获取配置数据
    const configElement = document.getElementById('judge-items-data');
    if (!configElement) {
        console.error('找不到执裁工具配置数据');
        return;
    }
    
    // ... 其余代码保持原样 ...
    
    // 最后调用初始化
    initJudgeTool();
});

function initJudgeTool() {
    console.log('初始化执裁工具...');
    
    // 获取配置数据
    const configElement = document.getElementById('judge-items-data');
    if (!configElement) {
        console.error('找不到执裁工具配置数据');
        return;
    }
    
    const judgeItems = JSON.parse(configElement.textContent);
    
    // 获取模板
    const templateElement = document.getElementById('judge-item-template');
    if (!templateElement) {
        console.error('找不到执裁工具模板');
        return;
    }
    
    // 获取容器
    const container = document.getElementById('judge-tool-container');
    if (!container) {
        console.error('找不到执裁工具容器');
        return;
    }
    
    // 创建执裁工具界面
    createJudgeToolUI(judgeItems, templateElement.textContent, container);
    
    // 添加样式
    addJudgeToolStyles();
    
    // 初始化交互
    initializeJudgeToolInteractions();
}

// 创建执裁工具界面
function createJudgeToolUI(items, templateHtml, container) {
    // 创建details元素
    const details = document.createElement('details');
    details.open = true;
    
    // 创建summary
    const summary = document.createElement('summary');
    summary.textContent = '展开';
    
    // 创建内容区域
    const contentDiv = document.createElement('div');
    contentDiv.className = 'judge-tool-content';
    
    // 渲染每个项目
    items.forEach(item => {
        // 简单的模板替换
        let itemHtml = templateHtml;
        itemHtml = itemHtml.replace(/{{id}}/g, item.id);
        itemHtml = itemHtml.replace(/{{name}}/g, item.name);
        
        // 处理开关列表
        const switchesHtml = item.switches.map((switchLabel, index) => {
            return `
            <div class="judge-switch-row">
                <span class="judge-switch-label">${switchLabel}</span>
                <label class="judge-toggle-switch">
                    <input type="checkbox" class="judge-switch-input" data-item="${item.id}" data-number="${index === 0 ? '1' : '3'}">
                    <span class="judge-toggle-slider"></span>
                </label>
            </div>`;
        }).join('');
        
        // 处理状态文本
        const statusText = item.switches.map(s => `${s}关`).join(' ');
        
        itemHtml = itemHtml.replace('{{#each switches}}{{this}}关{{#unless @last}} {{/unless}}{{/each}}', statusText);
        itemHtml = itemHtml.replace('{{#each switches}}<div class="judge-switch-row">', switchesHtml);
        itemHtml = itemHtml.replace(/{{#each switches}}.*?{{this}}.*?{{#unless @last}}.*?{{\/unless}}{{\/each}}/s, switchesHtml);
        
        // 添加到内容区域
        contentDiv.insertAdjacentHTML('beforeend', itemHtml);
    });
    
    // 组装
    details.appendChild(summary);
    details.appendChild(contentDiv);
    
    // 清空容器并添加新内容
    container.innerHTML = '';
    container.appendChild(details);
    container.className = 'judge-tool-container';
}

// 添加CSS样式
function addJudgeToolStyles() {
    // 检查是否已添加样式
    if (document.getElementById('judge-tool-styles')) {
        return;
    }
    
    const style = document.createElement('style');
    style.id = 'judge-tool-styles';
    style.textContent = `
        .judge-tool-container {
            margin: 20px 0;
            background-color: #f8f9fa;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
        }
        
        .judge-tool-container details {
            border: none;
        }
        
        .judge-tool-container summary {
            padding: 15px 20px;
            font-size: 18px;
            font-weight: 600;
            color: #2c3e50;
            cursor: pointer;
            background-color: #e9ecef;
            border-bottom: 1px solid #dee2e6;
            list-style: none;
            position: relative;
            transition: background-color 0.3s ease;
        }
        
        .judge-tool-container summary:hover {
            background-color: #dde1e6;
        }
        
        .judge-tool-container summary::-webkit-details-marker {
            display: none;
        }
        
        .judge-tool-container summary:after {
            content: '▼';
            position: absolute;
            right: 20px;
            transition: transform 0.3s ease;
            color: #667eea;
            font-size: 14px;
        }
        
        .judge-tool-container details[open] summary:after {
            transform: rotate(180deg);
        }
        
        .judge-tool-content {
            padding: 20px;
        }
        
        .judge-item {
            margin-bottom: 25px;
            padding: 15px;
            background-color: white;
            border-radius: 6px;
            border-left: 3px solid #667eea;
        }
        
        .judge-item:last-child {
            margin-bottom: 0;
        }
        
        .judge-item-title {
            font-weight: 700;
            font-size: 16px;
            color: #2c3e50;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 1px solid #eee;
        }
        
        .judge-switches {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        
        .judge-switch-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        
        .judge-switch-label {
            font-size: 16px;
            font-weight: 600;
            color: #495057;
            min-width: 30px;
        }
        
        .judge-toggle-switch {
            position: relative;
            width: 50px;
            height: 26px;
            flex-shrink: 0;
        }
        
        .judge-toggle-switch input {
            opacity: 0;
            width: 0;
            height: 0;
            position: absolute;
        }
        
        .judge-toggle-slider {
            position: absolute;
            cursor: pointer;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: white;
            border: 2px solid #adb5bd;
            border-radius: 34px;
            transition: .3s;
        }
        
        .judge-toggle-slider:before {
            position: absolute;
            content: "";
            height: 18px;
            width: 18px;
            left: 2px;
            bottom: 2px;
            background-color: #adb5bd;
            border-radius: 50%;
            transition: .3s;
        }
        
        .judge-toggle-switch input:checked + .judge-toggle-slider {
            background-color: #2196F3;
            border-color: #2196F3;
        }
        
        .judge-toggle-switch input:checked + .judge-toggle-slider:before {
            transform: translateX(22px);
            background-color: white;
        }
        
        .judge-status {
            font-size: 14px;
            color: #6c757d;
            margin-top: 15px;
            padding: 8px 12px;
            background-color: #f8f9fa;
            border-radius: 4px;
            display: inline-block;
            border: 1px solid #dee2e6;
        }
        
        .judge-status.active {
            background-color: #e7f5ff;
            color: #0d6efd;
            border-color: #b3d7ff;
        }
        
        @media (max-width: 768px) {
            .judge-tool-container {
                margin: 15px 0;
            }
            
            .judge-tool-content {
                padding: 15px;
            }
            
            .judge-item {
                padding: 12px;
            }
        }
    `;
    document.head.appendChild(style);
}

// 初始化交互功能
function initializeJudgeToolInteractions() {
    // 等待DOM更新
    setTimeout(() => {
        const switches = document.querySelectorAll('.judge-switch-input');
        
        if (switches.length === 0) {
            console.warn('没有找到执裁工具开关');
            return;
        }
        
        // 添加事件监听器
        switches.forEach(switchElement => {
            switchElement.addEventListener('change', function() {
                const itemId = this.getAttribute('data-item');
                const switchNumber = this.getAttribute('data-number');
                const isChecked = this.checked;
                
                // 更新状态显示
                updateJudgeStatus(itemId, switchNumber, isChecked);
                
                // 控制台输出
                const itemName = getItemNameById(itemId);
                console.log(`[执裁工具] ${itemName} 开关${switchNumber} ${isChecked ? '开启' : '关闭'}`);
            });
        });
        
        // 随机初始化一些开关状态
        switches.forEach(switchElement => {
            if (Math.random() > 0.7) {
                switchElement.checked = true;
                const event = new Event('change');
                switchElement.dispatchEvent(event);
            }
        });
        
        console.log('执裁工具交互初始化完成');
    }, 100);
}

// 根据ID获取项目名称
function getItemNameById(itemId) {
    const configElement = document.getElementById('judge-items-data');
    if (!configElement) return itemId;
    
    try {
        const items = JSON.parse(configElement.textContent);
        const item = items.find(i => i.id === itemId);
        return item ? item.name : itemId;
    } catch (e) {
        return itemId;
    }
}

// 更新状态显示
function updateJudgeStatus(itemId, switchNumber, isChecked) {
    const statusElement = document.getElementById(`${itemId}Status`);
    if (!statusElement) return;
    
    let statusText = statusElement.textContent;
    const switchChar = switchNumber === '1' ? '①' : '③';
    
    // 更新对应开关的状态
    const regex = new RegExp(`${switchChar}[开关]`);
    statusText = statusText.replace(regex, `${switchChar}${isChecked ? '开' : '关'}`);
    
    statusElement.textContent = statusText;
    
    // 如果有任何一个开关开启，添加active类
    const itemSwitches = document.querySelectorAll(`.judge-switch-input[data-item="${itemId}"]`);
    let anyOn = false;
    itemSwitches.forEach(s => {
        if (s.checked) anyOn = true;
    });
    
    if (anyOn) {
        statusElement.classList.add('active');
    } else {
        statusElement.classList.remove('active');
    }
}