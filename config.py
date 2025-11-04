import os
from dotenv import load_dotenv

load_dotenv()

# 支持OpenAI和Ollama
BASE_URL = os.getenv("BASE_URL", "https://api.openai.com/v1")
API_KEY = os.getenv("API_KEY") or os.getenv("OPENAI_API_KEY")
MODEL_NAME = os.getenv("MODEL_NAME", "gpt-3.5-turbo")

if not API_KEY:
    raise ValueError("请在.env文件中设置API_KEY或OPENAI_API_KEY")

