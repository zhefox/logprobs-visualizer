// API 基础URL
const API_BASE = '';

// 全局状态
let currentEventSource = null;
let presets = {};
let currentTokenIndex = 0;
// 调试信息滚动防抖定时器（只有调试信息需要防抖，其他使用requestAnimationFrame）
let debugScrollTimeout = null;
// 渲染优化：使用一个计数器来批量强制渲染，避免每次都强制重排
let renderCounter = 0;
const RENDER_BATCH_SIZE = 3; // 每3个token强制渲染一次

// DOM 元素
const elements = {
    baseUrl: document.getElementById('base-url'),
    apiKey: document.getElementById('api-key'),
    model: document.getElementById('model'),
    systemPrompt: document.getElementById('system-prompt'),
    userPrompt: document.getElementById('user-prompt'),
    presetAssistant: document.getElementById('preset-assistant'),
    temperature: document.getElementById('temperature'),
    maxTokens: document.getElementById('max-tokens'),
    topLogprobs: document.getElementById('top-logprobs'),
    sendBtn: document.getElementById('send-btn'),
    clearBtn: document.getElementById('clear-btn'),
    stopBtn: document.getElementById('stop-btn'),
    outputContent: document.getElementById('output-content'),
    presetName: document.getElementById('preset-name'),
    savePresetBtn: document.getElementById('save-preset-btn'),
    presetList: document.getElementById('preset-list'),
    copyOutputBtn: document.getElementById('copy-output-btn'),
    clearOutputBtn: document.getElementById('clear-output-btn'),
    toggleDisplayModeBtn: document.getElementById('toggle-display-mode-btn'),
    toggleDisplayModeText: document.getElementById('toggle-display-mode-text'),
    tooltip: document.getElementById('logprobs-tooltip'),
    tooltipContent: document.getElementById('tooltip-content'),
    saveSystemPrompt: document.getElementById('save-system-prompt'),
    saveUserPrompt: document.getElementById('save-user-prompt'),
    saveAssistantContent: document.getElementById('save-assistant-content'),
    debugOutput: document.getElementById('debug-output'),
    clearDebugBtn: document.getElementById('clear-debug-btn'),
    copyDebugBtn: document.getElementById('copy-debug-btn'),
    reasoningOutput: document.getElementById('reasoning-output'),
    clearReasoningBtn: document.getElementById('clear-reasoning-btn'),
    copyReasoningBtn: document.getElementById('copy-reasoning-btn')
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    loadConfig(); // 加载保存的配置
    loadDisplayMode(); // 加载显示模式
    loadPresets();
    setupEventListeners();
    
    // 保存配置到localStorage（使用input事件实现实时保存）
    elements.baseUrl.addEventListener('input', saveConfig);
    elements.apiKey.addEventListener('input', saveConfig);
    elements.model.addEventListener('input', saveConfig);
});

// 设置事件监听器
function setupEventListeners() {
    elements.sendBtn.addEventListener('click', sendMessage);
    elements.clearBtn.addEventListener('click', clearInputs);
    elements.stopBtn.addEventListener('click', stopGeneration);
    elements.savePresetBtn.addEventListener('click', savePreset);
    elements.copyOutputBtn.addEventListener('click', copyOutput);
    elements.clearOutputBtn.addEventListener('click', clearOutput);
    elements.clearDebugBtn.addEventListener('click', clearDebugOutput);
    elements.copyDebugBtn.addEventListener('click', copyDebugOutput);
    elements.toggleDisplayModeBtn.addEventListener('click', toggleTokenDisplay);
    elements.clearReasoningBtn.addEventListener('click', clearReasoningOutput);
    elements.copyReasoningBtn.addEventListener('click', copyReasoningOutput);
    
    // 密码显示/隐藏切换
    const passwordToggleBtn = document.getElementById('password-toggle-btn');
    const passwordToggleIcon = document.getElementById('password-toggle-icon');
    if (passwordToggleBtn) {
        passwordToggleBtn.addEventListener('click', () => {
            const apiKeyInput = elements.apiKey;
            if (apiKeyInput.type === 'password') {
                apiKeyInput.type = 'text';
                passwordToggleIcon.textContent = '🙈';
            } else {
                apiKeyInput.type = 'password';
                passwordToggleIcon.textContent = '👁️';
            }
        });
    }
    
    // Enter快捷键发送
    elements.userPrompt.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter') {
            sendMessage();
        }
    });
}

// 发送消息
async function sendMessage() {
    const userPrompt = elements.userPrompt.value.trim();
    if (!userPrompt) {
        alert('请输入用户提示词');
        return;
    }

    // 清空输出
    elements.outputContent.innerHTML = '';
    currentTokenIndex = 0;
    renderCounter = 0; // 重置渲染计数器
    // 重置token引用
    startBlockRef = null;
    previousTokenDiv = null;
    previousTokenLogprobs = null;
    // 清除调试信息滚动定时器
    if (debugScrollTimeout) clearTimeout(debugScrollTimeout);
    debugScrollTimeout = null;
    
    // 清空思考过程
    clearReasoningOutput();
    
    // 创建一个永远存在的开头空块，用来存储第一个token的预测信息
    const startBlock = document.createElement('div');
    startBlock.className = 'token-wrapper start-block';
    startBlock.dataset.tokenIndex = -1; // 使用-1表示这是开始块
    startBlock.textContent = ' '; // 显示一个空格
    startBlock.style.opacity = '0.3'; // 稍微透明，表示这是一个占位符
    startBlock.dataset.logprobs = JSON.stringify({
        actualToken: null,
        candidates: []
    });
    startBlock.dataset.hasLogprobs = 'true';
    startBlock.addEventListener('mouseenter', showLogprobs);
    startBlock.addEventListener('mouseleave', hideLogprobs);
    startBlock.addEventListener('mousemove', updateTooltipPosition);
    startBlock.setAttribute('data-events-attached', 'true');
    elements.outputContent.appendChild(startBlock);
    
    // 保存开始块的引用到全局变量，供第一个token使用
    startBlockRef = startBlock;
    
    // 清空调试信息
    clearDebugOutput();

    // 禁用发送按钮，启用停止按钮
    elements.sendBtn.disabled = true;
    elements.stopBtn.disabled = false;

    // 验证API配置
    const baseUrl = elements.baseUrl.value.trim();
    const apiKey = elements.apiKey.value.trim();
    const model = elements.model.value.trim();
    
    if (!baseUrl || !apiKey || !model) {
        alert('请填写完整的API配置：Base URL、API Key 和模型名称');
        return;
    }

    // 构建请求数据
    const requestData = {
        system_prompt: elements.systemPrompt.value.trim() || null,
        user_prompt: userPrompt,
        preset_assistant: elements.presetAssistant.value.trim() || null,
        model: model,
        temperature: parseFloat(elements.temperature.value) || 1.0,
        logprobs: true,
        top_logprobs: parseInt(elements.topLogprobs.value) || 5,
        base_url: baseUrl,
        api_key: apiKey
    };
    
    // max_tokens为可选参数，只有设置了才添加
    const maxTokens = elements.maxTokens.value.trim();
    if (maxTokens) {
        requestData.max_tokens = parseInt(maxTokens);
    }

    try {
        // 使用EventSource进行流式接收
        const response = await fetch(`${API_BASE}/api/chat/stream`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestData)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        // 使用递归函数处理流式数据，确保每个token立即处理
        const processStream = async () => {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                // 立即解码并处理数据
                buffer += decoder.decode(value, { stream: true });
                
                // 按行分割，处理完整的行
                let newlineIndex;
                while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                    const line = buffer.slice(0, newlineIndex);
                    buffer = buffer.slice(newlineIndex + 1);
                    
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            // 立即处理数据，同步执行，确保DOM立即更新
                            handleStreamData(data);
                            // 记录SSE数据包到调试区域（异步，不阻塞主线程）
                            setTimeout(() => logSSEData(line, data), 0);
                        } catch (e) {
                            console.error('Error parsing SSE data:', e, line);
                        }
                    }
                }
            }

            // 处理剩余的buffer
            if (buffer.trim()) {
                const lines = buffer.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            // 记录SSE数据包到调试区域
                            logSSEData(line, data);
                            handleStreamData(data);
                        } catch (e) {
                            console.error('Error parsing SSE data:', e, line);
                        }
                    }
                }
            }
        };

        // 启动流式处理
        await processStream();

    } catch (error) {
        console.error('Error:', error);
        elements.outputContent.innerHTML += `<div style="color: red;">错误: ${error.message}</div>`;
    } finally {
        elements.sendBtn.disabled = false;
        elements.stopBtn.disabled = true;
    }
}

// 处理流式数据
// 逻辑：开头有一个开始块，用来存储第一个token的预测信息
// 收到第一个token时立即显示，将其logprobs保存到开始块中
// 收到第二个token时，更新第一个token的悬浮框显示第二个token的实际内容和候选预测
let startBlockRef = null; // 保存开始块的DOM元素引用
let previousTokenDiv = null; // 保存上一个token的DOM元素引用
let previousTokenLogprobs = null; // 保存上一个token的logprobs

function handleStreamData(data) {
    if (data.type === 'error') {
        elements.outputContent.innerHTML += `<div style="color: red;">错误: ${data.message}</div>`;
        return;
    }
    
    if (data.type === 'warning') {
        elements.outputContent.innerHTML += `<div style="color: orange; background: #fff3cd; padding: 10px; border-radius: 4px; margin: 10px 0;">⚠️ ${data.message}</div>`;
        return;
    }

    // 处理思考过程（reasoning）数据
    if (data.type === 'token' && data.reasoning) {
        handleReasoningData(data.reasoning);
    }

    if (data.type === 'token' && data.content) {
        // 创建当前token的div
        const tokenDiv = document.createElement('div');
        tokenDiv.className = 'token-wrapper';
        tokenDiv.dataset.tokenIndex = currentTokenIndex;
        tokenDiv.textContent = data.content;
        
        // 辅助函数：将bytes数组转换为字符串
        const bytesToString = (bytes) => {
            if (!bytes || bytes.length === 0) return '';
            try {
                const uint8Array = new Uint8Array(bytes);
                const decoder = new TextDecoder('utf-8');
                return decoder.decode(uint8Array);
            } catch (e) {
                try {
                    return String.fromCharCode(...bytes);
                } catch (e2) {
                    return '';
                }
            }
        };
        
        // 如果有上一个token，现在更新它的悬浮框显示
        // 注意：应该使用当前token（token N）的logprobs来更新上一个token（token N-1）的悬浮框
        // 因为当前token的logprobs包含对下一个token的预测
        if (previousTokenDiv && data.logprobs && data.logprobs.length > 0) {
            // 构建悬浮框数据：包含实际生成的下一个token（当前token）和所有候选预测值
            const tooltipData = {
                actualToken: data.content, // 实际生成的下一个token（当前token）
                candidates: data.logprobs.map(item => ({
                    token: item.token || '',
                    bytes: item.bytes || null,
                    logprob: item.logprob || 0
                })) // 保存所有候选预测值，包括实际生成的token
            };
            
            // 保存工具提示数据到上一个token的DOM元素
            // 这样上一个token的悬浮框会显示当前token的实际内容和所有候选预测值
            previousTokenDiv.dataset.logprobs = JSON.stringify(tooltipData);
            previousTokenDiv.dataset.hasLogprobs = 'true';
            
            // 确保事件监听器已添加（应该在创建时已经添加，这里确保一下）
            if (!previousTokenDiv.hasAttribute('data-events-attached')) {
                previousTokenDiv.addEventListener('mouseenter', showLogprobs);
                previousTokenDiv.addEventListener('mouseleave', hideLogprobs);
                previousTokenDiv.addEventListener('mousemove', updateTooltipPosition);
                previousTokenDiv.setAttribute('data-events-attached', 'true');
            }
        }
        
        // 如果是第一个token到达，更新开始块（显示第一个token的实际内容和所有候选预测值）
        if (!previousTokenDiv && startBlockRef && data.logprobs && data.logprobs.length > 0) {
            // 此时第一个token已经到达，更新开始块显示第一个token的实际内容和所有候选预测值
            // 注意：开始块应该显示所有候选值，包括实际生成的token（如果它在logprobs中的话）
            const startBlockData = {
                actualToken: data.content, // 第一个token的实际内容
                candidates: data.logprobs.map(item => ({
                    token: item.token || '',
                    bytes: item.bytes || null,
                    logprob: item.logprob || 0
                })) // 保存所有候选预测值，不过滤实际生成的token
            };
            startBlockRef.dataset.logprobs = JSON.stringify(startBlockData);
        }
        
        // 为当前token创建空的预测信息占位符（如果有logprobs的话）
        // 这样即使还没有下一个token，也能在悬浮框中显示预测结构
        if (data.logprobs && data.logprobs.length > 0) {
            // 创建空的预测信息占位符（候选值暂时保存完整的logprobs，等待下一个token到达时再过滤）
            const emptyTooltipData = {
                actualToken: null, // 还没有下一个token的实际内容
                candidates: data.logprobs.map(item => ({
                    token: item.token || '',
                    bytes: item.bytes || null,
                    logprob: item.logprob || 0
                })) // 保存完整的候选预测值列表
            };
            
            tokenDiv.dataset.logprobs = JSON.stringify(emptyTooltipData);
            tokenDiv.dataset.hasLogprobs = 'true';
            
            // 添加鼠标悬浮事件
            tokenDiv.addEventListener('mouseenter', showLogprobs);
            tokenDiv.addEventListener('mouseleave', hideLogprobs);
            tokenDiv.addEventListener('mousemove', updateTooltipPosition);
            tokenDiv.setAttribute('data-events-attached', 'true');
        }
        
        // 保存当前token的DOM引用和logprobs，供下一个token使用
        elements.outputContent.appendChild(tokenDiv);
        
        previousTokenDiv = tokenDiv;
        previousTokenLogprobs = data.logprobs || null;
        
        currentTokenIndex++;
        renderCounter++;
        
        // 立即强制渲染，确保每个token都实时显示（打字机效果的关键）
        // 使用offsetHeight强制浏览器立即计算布局并渲染
        void tokenDiv.offsetHeight;
        
        // 立即滚动到底部，提供打字机效果
        // 直接同步更新滚动位置，确保立即显示
        elements.outputContent.scrollTop = elements.outputContent.scrollHeight;
    }

    if (data.type === 'done' || data.finish_reason) {
        // 最后一个token没有下一个token的预测，所以不需要更新
        // 清除引用
        startBlockRef = null;
        previousTokenDiv = null;
        previousTokenLogprobs = null;
        
        // 移除当前token的高亮
        const currentTokens = document.querySelectorAll('.token-wrapper.current');
        currentTokens.forEach(token => token.classList.remove('current'));
    }
}

// 全局变量：token显示模式（默认使用渲染模式）
let tokenDisplayMode = 'rendered'; // 'raw' 或 'rendered'

// 将bytes数组转换为实际字符
function bytesToChar(bytes) {
    try {
        const uint8Array = new Uint8Array(bytes);
        const decoder = new TextDecoder('utf-8');
        return decoder.decode(uint8Array);
    } catch (e) {
        return '';
    }
}

// 格式化token显示（原始模式）
function formatTokenRaw(token, bytes) {
    // 如果有bytes，使用bytes；否则使用token
    if (bytes && bytes.length > 0) {
        // 将bytes转换为十六进制表示
        return bytes.map(b => `\\x${b.toString(16).padStart(2, '0')}`).join('');
    }
    // 转义特殊字符
    return token.replace(/\\/g, '\\\\')
                .replace(/\n/g, '\\n')
                .replace(/\t/g, '\\t')
                .replace(/\r/g, '\\r');
}

// 格式化token显示（渲染模式）
function formatTokenRendered(token, bytes) {
    let actualChar = token;
    
    // 如果有bytes，尝试转换为实际字符
    if (bytes && bytes.length > 0) {
        try {
            actualChar = bytesToChar(bytes);
        } catch (e) {
            // 如果转换失败，使用原始token
            actualChar = token;
        }
    }
    
    // 使用占位符替换特殊字符，这样在转义HTML时不会影响它们
    const placeholders = {
        '\n': '__NEWLINE__',
        '\t': '__TAB__',
        '\r': '__RETURN__',
        ' ': '__SPACE__'
    };
    
    let display = actualChar;
    
    // 先替换特殊字符为占位符
    Object.keys(placeholders).forEach(char => {
        display = display.replace(new RegExp(char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), placeholders[char]);
    });
    
    // 转义HTML特殊字符（防止HTML标签被解析）
    display = escapeHtml(display);
    
    // 将占位符替换为可见的HTML标签
    display = display.replace(/__NEWLINE__/g, '<span class="special-char" title="换行符">↵</span>')
                    .replace(/__TAB__/g, '<span class="special-char" title="制表符">→</span>')
                    .replace(/__RETURN__/g, '<span class="special-char" title="回车符">←</span>')
                    .replace(/__SPACE__/g, '<span class="special-char" title="空格">·</span>');
    
    return display;
}

// 显示logprobs工具提示
function showLogprobs(event) {
    const tokenDiv = event.target;
    const logprobsData = tokenDiv.dataset.logprobs;
    const currentToken = tokenDiv.textContent;
    
    if (!logprobsData) {
        console.log('No logprobs data for token:', currentToken);
        return;
    }
    
    try {
        const data = JSON.parse(logprobsData);
        
        // 检查是否是新的数据结构（包含actualToken和candidates）
        let actualToken = null;
        let candidates = [];
        
        if (data && typeof data === 'object' && 'actualToken' in data) {
            // 新数据结构
            actualToken = data.actualToken || null;
            candidates = data.candidates || [];
        } else if (Array.isArray(data)) {
            // 旧数据结构（向后兼容）
            candidates = data;
        } else {
            console.log('Invalid logprobs data structure:', data);
            return;
        }
        
        if (!actualToken && candidates.length === 0) {
            console.log('No logprobs data for token:', currentToken);
            return;
        }
        
        // 构建工具提示内容
        let tooltipHTML = '';
        
        // 显示实际生成的下一个token
        if (actualToken) {
            let actualTokenDisplay;
            if (tokenDisplayMode === 'raw') {
                actualTokenDisplay = escapeHtml(actualToken);
            } else {
                actualTokenDisplay = formatTokenRendered(actualToken, null);
            }
            
            tooltipHTML += `
                <div style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #ddd;">
                    <div style="font-size: 12px; color: #666; margin-bottom: 4px;">实际生成的下一个 Token:</div>
                    <div class="logprob-item" style="background: #e8f5e9; border-left: 3px solid #4caf50;">
                        <span class="logprob-token" style="font-weight: bold; color: #2e7d32;">${actualTokenDisplay}</span>
                    </div>
                </div>
            `;
        }
        
        // 显示候选预测值
        if (candidates.length > 0) {
            // 按概率排序（从高到低）
            const sortedCandidates = [...candidates].sort((a, b) => b.logprob - a.logprob);
            
            tooltipHTML += `<div style="margin-bottom: 8px; font-size: 12px; color: #666;">共 ${sortedCandidates.length} 个候选预测:</div>`;
            
            sortedCandidates.forEach((item, index) => {
                const prob = Math.exp(item.logprob) * 100;
                const isTop = index === 0;
                
                // 根据显示模式格式化token
                let tokenDisplay;
                if (tokenDisplayMode === 'raw') {
                    tokenDisplay = formatTokenRaw(item.token, item.bytes);
                    tokenDisplay = escapeHtml(tokenDisplay);
                } else {
                    tokenDisplay = formatTokenRendered(item.token, item.bytes);
                }
                
                tooltipHTML += `
                    <div class="logprob-item ${isTop ? 'top' : ''}">
                        <span class="logprob-token">${tokenDisplay}</span>
                        <div>
                            <span class="logprob-value">${prob.toFixed(2)}%</span>
                            <span class="logprob-prob">(logprob: ${item.logprob.toFixed(4)})</span>
                        </div>
                    </div>
                `;
            });
        }
        
        elements.tooltipContent.innerHTML = tooltipHTML;
        elements.tooltip.classList.add('show');
        // 保存当前激活的token索引，用于切换模式时重新显示
        elements.tooltip.dataset.activeToken = tokenDiv.dataset.tokenIndex;
        updateTooltipPosition(event);
    } catch (error) {
        console.error('Error parsing logprobs:', error);
    }
}

// 切换token显示模式
function toggleTokenDisplay(event) {
    // 阻止事件冒泡
    if (event) {
        event.stopPropagation();
    }
    
    tokenDisplayMode = tokenDisplayMode === 'raw' ? 'rendered' : 'raw';
    
    // 更新按钮文本
    if (elements.toggleDisplayModeText) {
        elements.toggleDisplayModeText.textContent = tokenDisplayMode === 'raw' ? '原始' : '渲染';
    }
    
    // 保存到localStorage
    localStorage.setItem('tokenDisplayMode', tokenDisplayMode);
    
    // 重新显示当前tooltip（如果正在显示）
    const tooltip = elements.tooltip;
    if (tooltip.classList.contains('show')) {
        // 使用保存的activeToken索引来找到token元素
        const activeTokenIndex = tooltip.dataset.activeToken;
        if (activeTokenIndex !== undefined && activeTokenIndex !== '') {
            const tokenElement = document.querySelector(`[data-token-index="${activeTokenIndex}"]`);
            if (tokenElement && tokenElement.dataset.logprobs) {
                // 创建模拟事件对象
                const mockEvent = {
                    target: tokenElement,
                    clientX: parseInt(tooltip.style.left) || 0,
                    clientY: parseInt(tooltip.style.top) || 0
                };
                showLogprobs(mockEvent);
            }
        }
    }
}

// 隐藏logprobs工具提示
function hideLogprobs() {
    elements.tooltip.classList.remove('show');
    elements.tooltip.dataset.activeToken = '';
}

// 更新工具提示位置
function updateTooltipPosition(event) {
    const tooltip = elements.tooltip;
    const x = event.clientX + 15;
    const y = event.clientY + 15;
    
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
    
    // 确保工具提示不会超出视窗
    const rect = tooltip.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        tooltip.style.left = `${event.clientX - rect.width - 15}px`;
    }
    if (rect.bottom > window.innerHeight) {
        tooltip.style.top = `${event.clientY - rect.height - 15}px`;
    }
}

// 停止生成
function stopGeneration() {
    if (currentEventSource) {
        currentEventSource.close();
        currentEventSource = null;
    }
    elements.sendBtn.disabled = false;
    elements.stopBtn.disabled = true;
}

// 清空输入
function clearInputs() {
    elements.systemPrompt.value = '';
    elements.userPrompt.value = '';
    elements.presetAssistant.value = '';
}

// 清空输出
function clearOutput() {
    elements.outputContent.innerHTML = '<div class="placeholder">等待输入...</div>';
    currentTokenIndex = 0;
    // 重置token引用
    startBlockRef = null;
    previousTokenDiv = null;
    previousTokenLogprobs = null;
}

// 复制输出
function copyOutput() {
    const text = elements.outputContent.innerText;
    navigator.clipboard.writeText(text).then(() => {
        alert('已复制到剪贴板');
    }).catch(err => {
        console.error('复制失败:', err);
    });
}

// 保存预设
async function savePreset() {
    const name = elements.presetName.value.trim();
    if (!name) {
        alert('请输入预设名称');
        return;
    }

    // 检查是否至少选择了一个保存选项
    const saveSystem = elements.saveSystemPrompt.checked;
    const saveUser = elements.saveUserPrompt.checked;
    const saveAssistant = elements.saveAssistantContent.checked;

    if (!saveSystem && !saveUser && !saveAssistant) {
        alert('请至少选择一个要保存的字段');
        return;
    }

    // 根据复选框决定保存哪些字段
    const presetData = {
        name: name
    };

    // 保存对话内容（如果复选框选中，保存原始值）
    if (saveSystem) {
        const systemValue = elements.systemPrompt.value;
        // 保存原始值（包括空字符串和前后空格）
        presetData.system_prompt = systemValue !== null && systemValue !== undefined ? systemValue : '';
        console.log('保存System Prompt:', systemValue, '长度:', systemValue ? systemValue.length : 0);
    }
    if (saveUser) {
        const userValue = elements.userPrompt.value;
        // 保存原始值（包括空字符串和前后空格），不要trim，保留用户的完整输入
        presetData.user_prompt = userValue !== null && userValue !== undefined ? userValue : '';
        console.log('保存User Prompt:', userValue, '复选框状态:', saveUser, '长度:', userValue ? userValue.length : 0);
    }
    if (saveAssistant) {
        const assistantValue = elements.presetAssistant.value;
        // 保存原始值（包括空字符串和前后空格）
        presetData.assistant_content = assistantValue !== null && assistantValue !== undefined ? assistantValue : '';
        console.log('保存Assistant Content:', assistantValue, '长度:', assistantValue ? assistantValue.length : 0);
    }
    
    // 保存参数配置（总是保存，即使为空也要保存以便后续更新）
    const temperature = elements.temperature.value.trim();
    const maxTokens = elements.maxTokens.value.trim();
    const topLogprobs = elements.topLogprobs.value.trim();
    const model = elements.model.value.trim();
    
    // 参数配置总是保存，即使没有值也保存（用于部分更新）
    if (temperature) {
        presetData.temperature = parseFloat(temperature);
    }
    if (maxTokens) {
        presetData.max_tokens = parseInt(maxTokens);
    } else {
        // 如果max_tokens为空，保存null表示不设置
        presetData.max_tokens = null;
    }
    if (topLogprobs) {
        presetData.top_logprobs = parseInt(topLogprobs);
    }
    if (model) {
        presetData.model = model;
    }
    
    // 调试：打印保存的数据
    console.log('保存预设数据:', presetData);

    try {
        const response = await fetch(`${API_BASE}/api/presets`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(presetData)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('保存失败响应:', errorText);
            throw new Error('保存预设失败');
        }

        const result = await response.json();
        console.log('保存成功，返回数据:', result);
        console.log('保存的字段检查:', {
            system: saveSystem ? '已保存' : '未保存',
            user: saveUser ? '已保存' : '未保存',
            assistant: saveAssistant ? '已保存' : '未保存',
            systemValue: saveSystem ? (presetData.system_prompt || '(空)') : 'N/A',
            userValue: saveUser ? (presetData.user_prompt || '(空)') : 'N/A',
            assistantValue: saveAssistant ? (presetData.assistant_content || '(空)') : 'N/A'
        });

        elements.presetName.value = '';
        loadPresets();
        alert('预设保存成功');
    } catch (error) {
        console.error('Error saving preset:', error);
        alert('保存预设失败: ' + error.message);
    }
}

// 加载预设
async function loadPresets() {
    try {
        const response = await fetch(`${API_BASE}/api/presets`);
        const data = await response.json();
        presets = data.presets || {};
        renderPresets();
    } catch (error) {
        console.error('Error loading presets:', error);
    }
}

// 渲染预设列表
function renderPresets() {
    elements.presetList.innerHTML = '';
    
    Object.entries(presets).forEach(([name, preset]) => {
        const presetItem = document.createElement('div');
        presetItem.className = 'preset-item';
        
        // 构建字段标签
        const fields = [];
        // 检查字段是否存在（包括空字符串的情况，因为空字符串也是保存的内容）
        if (preset.system_prompt !== undefined) fields.push('System');
        if (preset.user_prompt !== undefined) fields.push('User');
        if (preset.assistant_content !== undefined) fields.push('Assistant');
        if (preset.temperature !== undefined && preset.temperature !== null) fields.push('Temp');
        if (preset.max_tokens !== undefined && preset.max_tokens !== null) fields.push('MaxT');
        if (preset.top_logprobs !== undefined && preset.top_logprobs !== null) fields.push('LogP');
        if (preset.model !== undefined && preset.model !== null && preset.model !== '') fields.push('Model');
        
        // 获取预览内容
        // 优先显示user_prompt，然后是system_prompt，最后是assistant_content
        let content = '';
        if (preset.user_prompt !== undefined && preset.user_prompt !== null && preset.user_prompt !== '') {
            content = preset.user_prompt;
        } else if (preset.system_prompt !== undefined && preset.system_prompt !== null && preset.system_prompt !== '') {
            content = preset.system_prompt;
        } else if (preset.assistant_content !== undefined && preset.assistant_content !== null && preset.assistant_content !== '') {
            content = preset.assistant_content;
        }
        
        // 检查是否有任何内容（包括参数配置）
        const hasContent = (preset.user_prompt !== undefined && preset.user_prompt !== '') ||
                          (preset.system_prompt !== undefined && preset.system_prompt !== '') ||
                          (preset.assistant_content !== undefined && preset.assistant_content !== '') ||
                          preset.temperature !== undefined ||
                          (preset.max_tokens !== undefined && preset.max_tokens !== null) ||
                          preset.top_logprobs !== undefined ||
                          (preset.model !== undefined && preset.model !== '');
        
        const preview = content ? (content.length > 50 ? content.substring(0, 50) + '...' : content) : 
                     (hasContent ? '(参数配置)' : '无内容');
        
        presetItem.innerHTML = `
            <div class="preset-item-header">
                <span class="preset-item-name">${escapeHtml(name)}</span>
                <button class="preset-item-delete" onclick="deletePreset('${escapeHtml(name)}')">删除</button>
            </div>
            <div class="preset-item-fields">
                <span class="preset-fields-tag">${fields.join(', ')}</span>
            </div>
            <div class="preset-item-content">${escapeHtml(preview)}</div>
        `;
        
        presetItem.addEventListener('click', (e) => {
            // 阻止事件冒泡，避免删除按钮的点击事件
            e.stopPropagation();
            
            if (e.target.classList.contains('preset-item-delete')) {
                return;
            }
            
            // 加载预设
            console.log('点击预设:', name, '预设数据:', preset);
            loadPreset(name, preset);
        });
        
        elements.presetList.appendChild(presetItem);
    });
}

// 加载预设到输入框
function loadPreset(name, preset) {
    console.log('加载预设:', name, preset);
    
    // 加载对话内容（包括空字符串的情况）
    if (preset.system_prompt !== undefined) {
        elements.systemPrompt.value = preset.system_prompt || '';
        console.log('加载System Prompt:', preset.system_prompt);
    } else {
        elements.systemPrompt.value = ''; // 如果没有保存，清空
    }
    
    if (preset.user_prompt !== undefined) {
        elements.userPrompt.value = preset.user_prompt || '';
        console.log('加载User Prompt:', preset.user_prompt);
    } else {
        elements.userPrompt.value = ''; // 如果没有保存，清空
    }
    
    if (preset.assistant_content !== undefined) {
        elements.presetAssistant.value = preset.assistant_content || '';
        console.log('加载Assistant Content:', preset.assistant_content);
    } else {
        elements.presetAssistant.value = ''; // 如果没有保存，清空
    }
    
    // 加载参数配置
    if (preset.temperature !== undefined && preset.temperature !== null) {
        elements.temperature.value = preset.temperature;
        console.log('加载Temperature:', preset.temperature);
    }
    
    if (preset.max_tokens !== undefined && preset.max_tokens !== null) {
        elements.maxTokens.value = preset.max_tokens;
        console.log('加载Max Tokens:', preset.max_tokens);
    } else {
        elements.maxTokens.value = ''; // 清空max_tokens
    }
    
    if (preset.top_logprobs !== undefined && preset.top_logprobs !== null) {
        elements.topLogprobs.value = preset.top_logprobs;
        console.log('加载Top Logprobs:', preset.top_logprobs);
    }
    
    if (preset.model !== undefined && preset.model !== null && preset.model !== '') {
        elements.model.value = preset.model;
        console.log('加载Model:', preset.model);
    }
    
    // 检查elements对象是否正确
    console.log('Elements检查:', {
        systemPrompt: elements.systemPrompt ? '存在' : '不存在',
        userPrompt: elements.userPrompt ? '存在' : '不存在',
        presetAssistant: elements.presetAssistant ? '存在' : '不存在',
        temperature: elements.temperature ? '存在' : '不存在',
        maxTokens: elements.maxTokens ? '存在' : '不存在',
        topLogprobs: elements.topLogprobs ? '存在' : '不存在',
        model: elements.model ? '存在' : '不存在'
    });
}

// 删除预设
async function deletePreset(name) {
    if (!confirm(`确定要删除预设 "${name}" 吗？`)) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/presets/${encodeURIComponent(name)}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error('删除预设失败');
        }

        loadPresets();
    } catch (error) {
        console.error('Error deleting preset:', error);
        alert('删除预设失败: ' + error.message);
    }
}

// HTML转义
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// SSE调试功能
function logSSEData(rawLine, parsedData) {
    if (!elements.debugOutput) return;
    
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = {
        timestamp: timestamp,
        raw: rawLine,
        parsed: parsedData
    };
    
    const logText = `[${timestamp}] ${JSON.stringify(parsedData, null, 2)}\n`;
    elements.debugOutput.textContent += logText;
    
    // 使用防抖滚动，调试信息可以稍微慢一点，避免过于频繁
    if (debugScrollTimeout) {
        clearTimeout(debugScrollTimeout);
    }
    debugScrollTimeout = setTimeout(() => {
        elements.debugOutput.scrollTop = elements.debugOutput.scrollHeight;
        debugScrollTimeout = null;
    }, 100); // 调试信息100ms防抖，避免影响性能
}

function clearDebugOutput() {
    if (elements.debugOutput) {
        elements.debugOutput.textContent = '';
    }
}

function copyDebugOutput() {
    if (elements.debugOutput) {
        navigator.clipboard.writeText(elements.debugOutput.textContent).then(() => {
            alert('调试信息已复制到剪贴板');
        }).catch(err => {
            console.error('复制失败:', err);
        });
    }
}

// 处理思考过程数据
function handleReasoningData(reasoning) {
    if (!elements.reasoningOutput) return;
    
    // 移除占位符
    const placeholder = elements.reasoningOutput.querySelector('.reasoning-placeholder');
    if (placeholder) {
        placeholder.remove();
    }
    
    // 如果思考过程区域是隐藏的，自动展开
    const reasoningContent = document.getElementById('reasoning-content');
    if (reasoningContent && reasoningContent.style.display === 'none') {
        toggleReasoningSection();
    }
    
    // 追加思考过程内容（流式追加）
    const reasoningText = document.createTextNode(reasoning);
    elements.reasoningOutput.appendChild(reasoningText);
    
    // 强制浏览器立即渲染（触发重排）
    void elements.reasoningOutput.offsetHeight;
    
    // 立即滚动到底部，提供打字机效果
    elements.reasoningOutput.scrollTop = elements.reasoningOutput.scrollHeight;
}

// 清空思考过程
function clearReasoningOutput() {
    if (elements.reasoningOutput) {
        elements.reasoningOutput.innerHTML = '<div class="reasoning-placeholder">等待模型思考...</div>';
    }
}

// 复制思考过程
function copyReasoningOutput() {
    if (elements.reasoningOutput) {
        const text = elements.reasoningOutput.textContent || elements.reasoningOutput.innerText;
        navigator.clipboard.writeText(text).then(() => {
            alert('思考过程已复制到剪贴板');
        }).catch(err => {
            console.error('复制失败:', err);
        });
    }
}

// 切换思考过程区域显示/隐藏
function toggleReasoningSection() {
    const reasoningContent = document.getElementById('reasoning-content');
    const reasoningToggle = document.getElementById('reasoning-toggle');
    
    if (reasoningContent && reasoningToggle) {
        if (reasoningContent.style.display === 'none') {
            reasoningContent.style.display = 'block';
            reasoningToggle.textContent = '▲';
        } else {
            reasoningContent.style.display = 'none';
            reasoningToggle.textContent = '▼';
        }
    }
}

function toggleDebugSection() {
    const debugContent = document.getElementById('debug-content');
    const debugToggle = document.getElementById('debug-toggle');
    
    if (debugContent.style.display === 'none') {
        debugContent.style.display = 'block';
        debugToggle.textContent = '▲';
    } else {
        debugContent.style.display = 'none';
        debugToggle.textContent = '▼';
    }
}

// 保存配置到localStorage
function saveConfig() {
    const config = {
        baseUrl: elements.baseUrl.value.trim(),
        apiKey: elements.apiKey.value.trim(),
        model: elements.model.value.trim()
    };
    localStorage.setItem('apiConfig', JSON.stringify(config));
}

// 从localStorage加载配置
function loadConfig() {
    try {
        const savedConfig = localStorage.getItem('apiConfig');
        if (savedConfig) {
            const config = JSON.parse(savedConfig);
            if (config.baseUrl) elements.baseUrl.value = config.baseUrl;
            if (config.apiKey) elements.apiKey.value = config.apiKey;
            if (config.model) elements.model.value = config.model;
        } else {
            // 如果没有保存的配置，使用默认值（DeepSeek配置）
            elements.baseUrl.value = 'https://api.deepseek.com';
            elements.apiKey.value = '';
            elements.model.value = 'deepseek-reasoner';
        }
    } catch (error) {
        console.error('Error loading config:', error);
    }
}

// 加载显示模式
function loadDisplayMode() {
    try {
        const savedMode = localStorage.getItem('tokenDisplayMode');
        if (savedMode === 'raw' || savedMode === 'rendered') {
            tokenDisplayMode = savedMode;
        }
        
        // 更新按钮文本
        if (elements.toggleDisplayModeText) {
            elements.toggleDisplayModeText.textContent = tokenDisplayMode === 'raw' ? '原始' : '渲染';
        }
    } catch (error) {
        console.error('Error loading display mode:', error);
    }
}

