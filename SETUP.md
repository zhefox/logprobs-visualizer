# 快速配置指南

## 创建 .env 文件

在项目根目录创建 `.env` 文件，内容如下：

### OpenAI配置（备用）

```env
BASE_URL=https://api.openai.com/v1
API_KEY=your_openai_api_key_here
MODEL_NAME=gpt-3.5-turbo
```

## 启动应用

### Windows
```bash
python main.py
```
或双击 `start.bat`

### Linux/Mac
```bash
python main.py
```
或运行 `start.sh`

## 访问应用

打开浏览器访问：`http://localhost:8000`

## 注意事项

1. 确保 `.env` 文件在项目根目录
2. 确保API密钥有效
3. 某些模型可能不支持logprobs参数，如果不支持，应用仍可正常使用，只是不会显示logprobs信息
4. 如果遇到连接问题，检查BASE_URL是否正确

