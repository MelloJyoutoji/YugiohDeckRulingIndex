// judge-tool.js

function initJudgeTool() {
    // 获取配置数据
    const configElement = document.getElementById('judge-items-data');
    if (!configElement) {
        console.error('找不到执裁工具配置数据');
        return;
    }
    
    // 获取容器
    const container = document.getElementById('judge-tool-container');
    if (!container) {
        console.error('找不到执裁工具容器');
        return;
    }
    
    try {
        const judgeItems = JSON.parse(configElement.textContent);
        
        // 创建界面
        createJudgeTool(judgeItems, container);
    } catch (e) {
        console.error('解析数据失败:', e);
    }
}

function createJudgeTool(items, container) {
    // 清空容器
    container.innerHTML = '';
    
    // 创建主容器
    const mainDiv = document.createElement('div');
    mainDiv.className = 'judge-tool';
    
    const content = document.createElement('div');
    
    // 为每个项目创建UI
    items.forEach((item, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'judge-item';
        itemDiv.id = item.id;
        itemDiv.style.marginBottom = (index === items.length - 1) ? '0' : '15px';
        
        // 标题
        const itemTitle = document.createElement('div');
        itemTitle.className = 'judge-item-title';
        itemTitle.textContent = `${item.name}:`;
        
        // 开关区域
        const switchesDiv = document.createElement('div');
        switchesDiv.className = 'judge-switches';
        
        // 创建开关
        item.switches.forEach((label, switchIndex) => {
            const switchContainer = document.createElement('div');
            switchContainer.className = 'switch-container';
            
            // 开关
            const switchLabel = document.createElement('label');
            switchLabel.className = 'judge-toggle-switch';
            
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.className = 'judge-switch-input';
            input.dataset.item = item.id;
            input.dataset.label = label;
            
            const slider = document.createElement('span');
            slider.className = 'judge-toggle-slider';
            
            const sliderInner = document.createElement('span');
            sliderInner.className = 'toggle-slider-inner';
            
            slider.appendChild(sliderInner);
            
            // 添加开关变化事件
            input.addEventListener('change', function() {
                updateSwitchStyle(input, slider);
            });
            
            switchLabel.appendChild(input);
            switchLabel.appendChild(slider);
            
            // 标签
            const labelSpan = document.createElement('span');
            labelSpan.className = 'judge-switch-label';
            labelSpan.textContent = label;
            
            switchContainer.appendChild(switchLabel);
            switchContainer.appendChild(labelSpan);
            switchesDiv.appendChild(switchContainer);
        });
        
        // 组装
        itemDiv.appendChild(itemTitle);
        itemDiv.appendChild(switchesDiv);
        content.appendChild(itemDiv);
    });
    
    mainDiv.appendChild(content);
    container.appendChild(mainDiv);
}

// 更新开关样式
function updateSwitchStyle(input, slider) {
    if (input.checked) {
        slider.style.backgroundColor = '#2196F3'; // 蓝色
    } else {
        slider.style.backgroundColor = '#ccc'; // 灰色
    }
}

// 初始化执裁工具（当文档加载完成时）
document.addEventListener('DOMContentLoaded', function() {
    initJudgeTool();
});