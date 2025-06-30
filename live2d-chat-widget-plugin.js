// live2d-chat-extension.js
// Live2D Widget 聊天扩展 - 可以直接集成到现有的 live2d-widget.js 项目中

(function() {
    'use strict';

    // 聊天扩展类
    class L2DChatExtension {
        constructor(options = {}) {
            // 默认配置
            this.config = {
                apiEndpoint: options.apiEndpoint || '/api/chat',
                configEndpoint: options.configEndpoint || '/api/config',
                position: options.position || 'right', // 聊天框位置：left, right
                theme: options.theme || 'default', // 主题：default, dark, cute
                showOnHover: options.showOnHover !== false, // 悬停显示
                messages: options.messages || {
                    placeholder: '输入消息...',
                    title: '与我聊天',
                    error: '哎呀，我暂时还不想回答这个问题，等一会儿再来问我吧。',
                    thinking: '思考中...'
                },
                ...options
            };

            this.messages = [];
            this.isStreaming = false;
            this.chatVisible = false;
            this.turnstileToken = null;
            this.turnstileWidgetId = null;

            // 初始化
            this.init();
        }

        // 初始化
        async init() {
            // 加载配置
            await this.loadConfig();
            
            // 创建聊天界面
            this.createChatUI();
            
            // 绑定事件
            this.bindEvents();
            
            // 添加样式
            this.injectStyles();
        }

        // 加载服务器配置
        async loadConfig() {
            try {
                const response = await fetch(this.config.configEndpoint);
                if (response.ok) {
                    const serverConfig = await response.json();
                    Object.assign(this.config, serverConfig);
                    
                    // 如果需要 Turnstile，加载脚本
                    if (this.config.requireTurnstile && this.config.turnstileSiteKey) {
                        await this.loadTurnstile();
                    }
                }
            } catch (error) {
                console.warn('Failed to load chat config:', error);
            }
        }

        // 加载 Turnstile 脚本
        async loadTurnstile() {
            return new Promise((resolve) => {
                if (window.turnstile) {
                    resolve();
                    return;
                }

                const script = document.createElement('script');
                script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
                script.async = true;
                script.onload = resolve;
                document.head.appendChild(script);
            });
        }

        // 创建聊天UI
        createChatUI() {
            // 创建聊天容器
            const chatHTML = `
                <div id="l2d-chat-container" class="l2d-chat-container ${this.config.position} ${this.config.theme}">
                    <div class="l2d-chat-header">
                        <span class="l2d-chat-title">${this.config.messages.title}</span>
                        <button class="l2d-chat-close">&times;</button>
                    </div>
                    <div class="l2d-chat-messages" id="l2d-chat-messages"></div>
                    <div class="l2d-chat-input-container">
                        <div id="l2d-turnstile-container" class="l2d-turnstile-container"></div>
                        <div class="l2d-chat-input-row">
                            <input type="text" 
                                   class="l2d-chat-input" 
                                   id="l2d-chat-input" 
                                   placeholder="${this.config.messages.placeholder}"
                                   autocomplete="off">
                            <button class="l2d-chat-send" id="l2d-chat-send">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                                    <path d="M22 2L11 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                    <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            `;

            // 插入到页面
            const chatDiv = document.createElement('div');
            chatDiv.innerHTML = chatHTML;
            document.body.appendChild(chatDiv.firstElementChild);

            // 保存元素引用
            this.elements = {
                container: document.getElementById('l2d-chat-container'),
                messages: document.getElementById('l2d-chat-messages'),
                input: document.getElementById('l2d-chat-input'),
                sendBtn: document.getElementById('l2d-chat-send'),
                closeBtn: document.querySelector('.l2d-chat-close'),
                turnstileContainer: document.getElementById('l2d-turnstile-container')
            };
        }

        // 绑定事件
        bindEvents() {
            // Live2D 容器悬停事件
            if (this.config.showOnHover) {
                const live2dContainer = document.getElementById('live2d-widget') || 
                                       document.querySelector('.live2d-widget') ||
                                       document.querySelector('#live2dcanvas');
                
                if (live2dContainer) {
                    live2dContainer.addEventListener('mouseenter', () => this.show());
                    
                    // 鼠标离开时的处理
                    let hideTimeout;
                    const startHideTimeout = () => {
                        hideTimeout = setTimeout(() => {
                            if (!this.isMouseOverChat()) {
                                this.hide();
                            }
                        }, 500);
                    };

                    live2dContainer.addEventListener('mouseleave', startHideTimeout);
                    
                    this.elements.container.addEventListener('mouseenter', () => {
                        clearTimeout(hideTimeout);
                    });
                    
                    this.elements.container.addEventListener('mouseleave', () => {
                        if (!this.isMouseOverLive2D()) {
                            this.hide();
                        }
                    });
                }
            }

            // 关闭按钮
            this.elements.closeBtn.addEventListener('click', () => this.hide());

            // 发送消息
            this.elements.sendBtn.addEventListener('click', () => this.sendMessage());
            this.elements.input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });
        }

        // 检查鼠标是否在聊天框上
        isMouseOverChat() {
            return this.elements.container.matches(':hover');
        }

        // 检查鼠标是否在 Live2D 上
        isMouseOverLive2D() {
            const live2d = document.getElementById('live2d-widget') || 
                          document.querySelector('.live2d-widget') ||
                          document.querySelector('#live2dcanvas');
            return live2d && live2d.matches(':hover');
        }

        // 显示聊天框
        show() {
            this.elements.container.classList.add('show');
            this.chatVisible = true;
            
            // 初始化 Turnstile（如果需要且尚未初始化）
            if (this.config.requireTurnstile && this.config.turnstileSiteKey && !this.turnstileWidgetId) {
                this.initTurnstile();
            }
        }

        // 初始化 Turnstile
        initTurnstile() {
            if (!window.turnstile || !this.elements.turnstileContainer) return;

            this.turnstileWidgetId = window.turnstile.render(this.elements.turnstileContainer, {
                sitekey: this.config.turnstileSiteKey,
                callback: (token) => {
                    this.turnstileToken = token;
                },
                'expired-callback': () => {
                    this.turnstileToken = null;
                },
                size: 'compact',
                theme: this.config.theme === 'dark' ? 'dark' : 'light'
            });
        }

        // 隐藏聊天框
        hide() {
            this.elements.container.classList.remove('show');
            this.chatVisible = false;
        }

        // 切换显示/隐藏
        toggle() {
            if (this.chatVisible) {
                this.hide();
            } else {
                this.show();
            }
        }

        // 添加消息到界面
        addMessage(role, content, isStreaming = false) {
            const messageEl = document.createElement('div');
            messageEl.className = `l2d-chat-message ${role}`;
            
            const bubbleEl = document.createElement('div');
            bubbleEl.className = 'l2d-chat-bubble';
            
            if (isStreaming && role === 'assistant') {
                bubbleEl.innerHTML = `
                    <div class="l2d-chat-typing">
                        <span></span><span></span><span></span>
                    </div>
                `;
            } else {
                bubbleEl.textContent = content;
            }
            
            messageEl.appendChild(bubbleEl);
            this.elements.messages.appendChild(messageEl);
            
            // 滚动到底部
            this.elements.messages.scrollTop = this.elements.messages.scrollHeight;
            
            return bubbleEl;
        }

        // 发送消息
        async sendMessage() {
            const message = this.elements.input.value.trim();
            if (!message || this.isStreaming) return;

            // 检查 Turnstile 验证
            if (this.config.requireTurnstile && !this.turnstileToken) {
                this.addMessage('system', '请完成验证后再发送消息。');
                return;
            }

            // 添加用户消息
            this.addMessage('user', message);
            this.messages.push({ role: 'user', content: message });
            
            // 清空输入框
            this.elements.input.value = '';
            
            // 禁用输入
            this.elements.input.disabled = true;
            this.elements.sendBtn.disabled = true;
            this.isStreaming = true;

            // 添加 AI 回复占位符
            const aiMessageBubble = this.addMessage('assistant', '', true);

            try {
                // 准备请求数据
                const requestData = {
                    messages: this.messages.slice(-10), // 保留最近10条消息作为上下文
                    stream: true,
                    turnstileToken: this.turnstileToken
                };

                // 发送请求
                const response = await fetch(this.config.apiEndpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestData)
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'API request failed');
                }

                // 处理流式响应
                await this.handleStreamResponse(response, aiMessageBubble);

                // 重置 Turnstile
                if (this.config.requireTurnstile && window.turnstile) {
                    window.turnstile.reset(this.turnstileWidgetId);
                    this.turnstileToken = null;
                }

            } catch (error) {
                console.error('Chat error:', error);
                aiMessageBubble.innerHTML = error.message || this.config.messages.error;
            } finally {
                this.elements.input.disabled = false;
                this.elements.sendBtn.disabled = false;
                this.isStreaming = false;
                this.elements.input.focus();
            }
        }

        // 处理流式响应
        async handleStreamResponse(response, messageBubble) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let content = '';
            let isFirstChunk = true;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;

                        try {
                            const json = JSON.parse(data);
                            const delta = json.choices?.[0]?.delta?.content;
                            if (delta) {
                                if (isFirstChunk) {
                                    messageBubble.innerHTML = '';
                                    isFirstChunk = false;
                                }
                                content += delta;
                                messageBubble.textContent = content;
                                this.elements.messages.scrollTop = this.elements.messages.scrollHeight;
                            }
                        } catch (e) {
                            // 忽略解析错误
                        }
                    }
                }
            }

            // 保存 AI 回复到上下文
            this.messages.push({ role: 'assistant', content: content });
        }

        // 注入样式
        injectStyles() {
            const styles = `
                .l2d-chat-container {
                    position: fixed;
                    bottom: 20px;
                    width: 350px;
                    height: 500px;
                    background: rgba(255, 255, 255, 0.95);
                    border-radius: 12px;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
                    display: flex;
                    flex-direction: column;
                    z-index: 1000;
                    backdrop-filter: blur(10px);
                    opacity: 0;
                    transform: translateY(20px);
                    transition: all 0.3s ease;
                    pointer-events: none;
                }

                .l2d-chat-container.right {
                    right: 320px;
                }

                .l2d-chat-container.left {
                    left: 320px;
                }

                .l2d-chat-container.show {
                    opacity: 1;
                    transform: translateY(0);
                    pointer-events: auto;
                }

                /* Dark theme */
                .l2d-chat-container.dark {
                    background: rgba(30, 30, 30, 0.95);
                    color: #fff;
                }

                .l2d-chat-container.dark .l2d-chat-header {
                    background: linear-gradient(135deg, #434343 0%, #262626 100%);
                }

                .l2d-chat-container.dark .l2d-chat-messages {
                    background: #1a1a1a;
                }

                .l2d-chat-container.dark .l2d-chat-input {
                    background: #2a2a2a;
                    color: #fff;
                    border-color: #444;
                }

                .l2d-chat-container.dark .l2d-chat-message.assistant .l2d-chat-bubble {
                    background: #2a2a2a;
                    color: #fff;
                }

                /* Cute theme */
                .l2d-chat-container.cute .l2d-chat-header {
                    background: linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%);
                }

                .l2d-chat-container.cute .l2d-chat-send {
                    background: linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%);
                }

                .l2d-chat-container.cute .l2d-chat-message.user .l2d-chat-bubble {
                    background: linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%);
                }

                /* Header */
                .l2d-chat-header {
                    padding: 15px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    border-radius: 12px 12px 0 0;
                    font-weight: bold;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    user-select: none;
                }

                .l2d-chat-close {
                    background: none;
                    border: none;
                    color: white;
                    font-size: 24px;
                    cursor: pointer;
                    opacity: 0.8;
                    transition: opacity 0.2s;
                    padding: 0;
                    width: 30px;
                    height: 30px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .l2d-chat-close:hover {
                    opacity: 1;
                }

                /* Messages container */
                .l2d-chat-messages {
                    flex: 1;
                    overflow-y: auto;
                    padding: 15px;
                    background: #f7f7f8;
                }

                .l2d-chat-message {
                    margin-bottom: 15px;
                    animation: l2d-message-slide 0.3s ease;
                }

                @keyframes l2d-message-slide {
                    from {
                        opacity: 0;
                        transform: translateX(-10px);
                    }
                    to {
                        opacity: 1;
                        transform: translateX(0);
                    }
                }

                .l2d-chat-message.user {
                    text-align: right;
                }

                .l2d-chat-message.assistant {
                    text-align: left;
                }

                .l2d-chat-bubble {
                    display: inline-block;
                    max-width: 80%;
                    padding: 10px 15px;
                    border-radius: 18px;
                    word-wrap: break-word;
                    white-space: pre-wrap;
                }

                .l2d-chat-message.user .l2d-chat-bubble {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                }

                .l2d-chat-message.assistant .l2d-chat-bubble {
                    background: white;
                    color: #333;
                    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
                }

                .l2d-chat-message.system {
                    text-align: center;
                    margin: 10px 0;
                }

                .l2d-chat-message.system .l2d-chat-bubble {
                    background: #f0f0f0;
                    color: #666;
                    font-size: 13px;
                    padding: 8px 12px;
                    border-radius: 12px;
                }

                /* Input container */
                .l2d-chat-input-container {
                    padding: 15px;
                    background: white;
                    border-top: 1px solid #e0e0e0;
                    border-radius: 0 0 12px 12px;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                }

                /* Turnstile container */
                .l2d-turnstile-container {
                    display: flex;
                    justify-content: center;
                    min-height: 0;
                    transition: min-height 0.3s ease;
                }

                .l2d-turnstile-container:not(:empty) {
                    min-height: 65px;
                }

                /* Input row */
                .l2d-chat-input-row {
                    display: flex;
                    gap: 10px;
                }

                .l2d-chat-input {
                    flex: 1;
                    padding: 10px 15px;
                    border: 1px solid #e0e0e0;
                    border-radius: 25px;
                    outline: none;
                    font-size: 14px;
                    transition: border-color 0.3s;
                    background: white;
                }

                .l2d-chat-input:focus {
                    border-color: #667eea;
                }

                .l2d-chat-input:disabled {
                    opacity: 0.6;
                }

                .l2d-chat-send {
                    padding: 10px 15px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    border: none;
                    border-radius: 50%;
                    cursor: pointer;
                    transition: transform 0.2s;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 40px;
                    height: 40px;
                }

                .l2d-chat-send:hover:not(:disabled) {
                    transform: scale(1.05);
                }

                .l2d-chat-send:active {
                    transform: scale(0.95);
                }

                .l2d-chat-send:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                /* Typing indicator */
                .l2d-chat-typing {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }

                .l2d-chat-typing span {
                    display: inline-block;
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    background-color: #666;
                    animation: l2d-typing 1.4s infinite;
                }

                .l2d-chat-typing span:nth-child(2) {
                    animation-delay: 0.2s;
                }

                .l2d-chat-typing span:nth-child(3) {
                    animation-delay: 0.4s;
                }

                @keyframes l2d-typing {
                    0%, 60%, 100% {
                        transform: translateY(0);
                        opacity: 0.4;
                    }
                    30% {
                        transform: translateY(-10px);
                        opacity: 1;
                    }
                }

                /* Scrollbar */
                .l2d-chat-messages::-webkit-scrollbar {
                    width: 6px;
                }

                .l2d-chat-messages::-webkit-scrollbar-track {
                    background: #f1f1f1;
                    border-radius: 3px;
                }

                .l2d-chat-messages::-webkit-scrollbar-thumb {
                    background: #888;
                    border-radius: 3px;
                }

                .l2d-chat-messages::-webkit-scrollbar-thumb:hover {
                    background: #555;
                }

                /* Mobile responsive */
                @media (max-width: 768px) {
                    .l2d-chat-container {
                        width: calc(100vw - 40px);
                        height: 400px;
                        right: 20px !important;
                        left: 20px !important;
                    }
                }
            `;

            const styleEl = document.createElement('style');
            styleEl.textContent = styles;
            document.head.appendChild(styleEl);
        }
    }

    // 导出到全局
    window.L2DChatExtension = L2DChatExtension;

    // 自动初始化（可选）
    if (window.L2DChatAutoInit !== false) {
        document.addEventListener('DOMContentLoaded', () => {
            // 等待 Live2D 初始化完成
            setTimeout(() => {
                window.l2dChat = new L2DChatExtension(window.L2DChatConfig || {});
            }, 1000);
        });
    }
})();

/* 使用示例：

// 方式1：自动初始化（默认配置）
// 只需要引入脚本即可

// 方式2：手动初始化（自定义配置）
window.L2DChatAutoInit = false; // 禁用自动初始化
document.addEventListener('DOMContentLoaded', () => {
    const chat = new L2DChatExtension({
        apiEndpoint: '/api/chat',
        position: 'right',
        theme: 'cute',
        showOnHover: true,
        messages: {
            placeholder: '想和我聊什么呢？',
            title: 'Live2D 助手',
            error: '哎呀，出错了呢~',
            thinking: '让我想想...'
        }
    });
});

// 方式3：通过全局配置
window.L2DChatConfig = {
    theme: 'dark',
    position: 'left'
};
// 然后引入脚本，会自动使用配置

*/
