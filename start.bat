@echo off
echo 正在启动 Ollama Logprobs 可视化工具...
echo.
echo 请确保已创建 .env 文件并配置了以下信息:
echo BASE_URL=https://ollama.com/v1
echo API_KEY=your_api_key_here
echo MODEL_NAME=gpt-oss:120b
echo.
python main.py
pause

