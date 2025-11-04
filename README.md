# OpenAI/Ollama Logprobs 可视化工具

一个完整的工程化Web应用，用于实时可视化OpenAI或Ollama模型的token预测概率。

![QQ_1762238058852](./README.assets/QQ_1762238058852.png)

## 功能特性

- ✅ **支持OpenAI输出**: 支持OpenAI/Ollama API的流式响应，实时显示生成的token
- ✅ **Logprobs可视化**: 鼠标悬浮在任意token上，查看该token的下一个token预测概率
- ✅ **System/User Prompt**: 支持自定义system prompt和user prompt
- ✅ **预设对话管理**: 可以保存和加载预设的assistant对话内容
- ✅ **美观的UI**: 现代化的渐变设计和响应式布局
- ✅ **参数配置**: 支持自定义模型、temperature、max_tokens等参数

## 安装步骤

1. **安装依赖**:
```bash
pip install -r requirements.txt
```

2. **配置API密钥**:
创建 `.env` 文件，添加你的API配置：

**Ollama配置示例**:
```
BASE_URL=https://ollama.com/v1
API_KEY=your_ollama_api_key_here
MODEL_NAME=gpt-oss:120b
```

**OpenAI配置示例**:
```
BASE_URL=https://api.openai.com/v1
API_KEY=your_openai_api_key_here
MODEL_NAME=gpt-3.5-turbo
```

或者使用旧的配置方式（向后兼容）:
```
OPENAI_API_KEY=your_openai_api_key_here
```

3. **启动服务**:
```bash
python main.py
```

或者使用uvicorn:
```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

4. **访问应用**:
打开浏览器访问 `http://localhost:8000`

## 使用说明

### 基本使用

1. 在左侧配置面板输入：
   - **System Prompt**: 系统提示词（可选）
   - **User Prompt**: 用户提示词（必填）
   - **预设 Assistant 内容**: 预设的assistant回复（可选）

2. 调整参数：
   - **模型**: 输入模型名称（如 gpt-oss:120b, gpt-3.5-turbo, gpt-4 等）
   - **Temperature**: 控制随机性（0-2）
   - **Max Tokens**: 最大生成token数
   - **Top Logprobs**: 显示前N个最可能的token（1-20）

3. 点击"发送"按钮开始生成

4. 实时查看输出，鼠标悬浮在任意token上查看下一个token的预测概率

### 预设对话管理

1. 输入预设名称
2. 填写system prompt和/或assistant内容
3. 点击"保存预设"
4. 点击预设列表中的项可以快速加载到输入框

## 技术栈

- **后端**: FastAPI + OpenAI Python SDK
- **前端**: 原生HTML/CSS/JavaScript
- **通信**: Server-Sent Events (SSE) 流式传输

## 注意事项

- 确保你的API密钥有效且有足够的余额
- 某些模型可能不支持logprobs参数，请查看相应API文档
- logprobs功能会增加API调用的成本
- Ollama API需要确保BASE_URL正确配置（如 https://ollama.com/v1）

## 项目结构

```
.
├── main.py              # FastAPI后端主文件
├── config.py            # 配置文件
├── requirements.txt     # Python依赖
├── README.md           # 项目说明
├── .env.example        # 环境变量示例
└── static/             # 静态文件目录
    ├── index.html      # 前端HTML
    ├── style.css       # 样式文件
    └── app.js          # 前端JavaScript
```

