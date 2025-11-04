from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel
from typing import Optional, List, Dict
import openai
import json
import asyncio
import httpx
import os
from config import BASE_URL, API_KEY, MODEL_NAME

app = FastAPI(title="OpenAI/Ollama Logprobs可视化工具")

# 配置文件路径
CONFIG_FILE = "config.json"

# 默认使用.env中的配置，但支持动态配置
def create_client(api_key: Optional[str] = None, base_url: Optional[str] = None):
    """动态创建OpenAI兼容客户端"""
    client_api_key = api_key or API_KEY
    client_base_url = base_url or BASE_URL
    
    return openai.OpenAI(
        api_key=client_api_key,
        base_url=client_base_url,
        http_client=httpx.Client(
            timeout=httpx.Timeout(60.0, connect=10.0),
            follow_redirects=True,
        )
    )

# 挂载静态文件
app.mount("/static", StaticFiles(directory="static"), name="static")


class ChatRequest(BaseModel):
    system_prompt: Optional[str] = None
    user_prompt: str
    model: str = MODEL_NAME
    temperature: float = 1.0
    max_tokens: Optional[int] = None  # 可选参数，为空时不设置
    logprobs: bool = True
    top_logprobs: int = 5
    preset_assistant: Optional[str] = None
    # 支持自定义API配置
    base_url: Optional[str] = None
    api_key: Optional[str] = None


class PresetRequest(BaseModel):
    name: str
    system_prompt: Optional[str] = None
    user_prompt: Optional[str] = None
    assistant_content: Optional[str] = None
    # 参数配置
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    top_logprobs: Optional[int] = None
    model: Optional[str] = None


def save_presets_to_file(presets_data: Dict[str, Dict]):
    """保存预设配置到 config.json 文件"""
    try:
        # 确保目录存在
        os.makedirs(os.path.dirname(CONFIG_FILE) if os.path.dirname(CONFIG_FILE) else '.', exist_ok=True)
        
        # 保存为格式化的 JSON
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump({"presets": presets_data}, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"保存预设配置失败: {e}")
        raise


def load_presets_from_file() -> Dict[str, Dict]:
    """从 config.json 文件加载预设配置"""
    if not os.path.exists(CONFIG_FILE):
        # 如果文件不存在，创建空的配置文件
        save_presets_to_file({})
        return {}
    
    try:
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            # 如果文件中包含 presets 键，使用它；否则假设整个文件就是 presets 字典
            if isinstance(data, dict) and 'presets' in data:
                return data.get('presets', {})
            elif isinstance(data, dict):
                return data
            else:
                return {}
    except json.JSONDecodeError:
        # 如果 JSON 格式错误，返回空字典并创建新文件
        print(f"警告: {CONFIG_FILE} 文件格式错误，将创建新文件")
        save_presets_to_file({})
        return {}
    except Exception as e:
        print(f"加载预设配置失败: {e}")
        return {}


# 启动时加载预设配置
presets = load_presets_from_file()


@app.get("/", response_class=HTMLResponse)
async def read_root():
    with open("static/index.html", "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())


@app.post("/api/presets")
async def create_preset(preset: PresetRequest):
    """创建预设对话"""
    preset_data = {}
    # 保存对话内容（包括空字符串）
    if preset.system_prompt is not None:
        preset_data["system_prompt"] = preset.system_prompt
    if preset.user_prompt is not None:
        preset_data["user_prompt"] = preset.user_prompt
    if preset.assistant_content is not None:
        preset_data["assistant_content"] = preset.assistant_content
    
    # 保存参数配置
    if preset.temperature is not None:
        preset_data["temperature"] = preset.temperature
    if preset.max_tokens is not None:
        preset_data["max_tokens"] = preset.max_tokens
    if preset.top_logprobs is not None:
        preset_data["top_logprobs"] = preset.top_logprobs
    if preset.model is not None:
        preset_data["model"] = preset.model
    
    # 如果预设已存在，合并数据；否则创建新预设
    if preset.name in presets:
        presets[preset.name].update(preset_data)
    else:
        presets[preset.name] = preset_data
    
    # 保存到文件
    try:
        save_presets_to_file(presets)
    except Exception as e:
        print(f"保存预设到文件失败: {e}")
        # 即使保存失败，也返回成功，但记录错误
    
    return {"status": "success", "preset": presets[preset.name]}


@app.get("/api/presets")
async def get_presets():
    """获取所有预设对话"""
    return {"presets": presets}


@app.delete("/api/presets/{name}")
async def delete_preset(name: str):
    """删除预设对话"""
    if name in presets:
        del presets[name]
        # 保存到文件
        try:
            save_presets_to_file(presets)
        except Exception as e:
            print(f"保存预设到文件失败: {e}")
            # 即使保存失败，也返回成功，但记录错误
        return {"status": "success"}
    raise HTTPException(status_code=404, detail="预设不存在")


@app.post("/api/chat/stream")
async def chat_stream(request: ChatRequest):
    """流式聊天接口，返回logprobs数据"""
    
    messages = []
    
    # 添加system prompt
    if request.system_prompt:
        messages.append({"role": "system", "content": request.system_prompt})
    
    # 添加user prompt
    messages.append({"role": "user", "content": request.user_prompt})
    
    # 如果有预设的assistant内容，添加到messages中
    if request.preset_assistant:
        messages.append({"role": "assistant", "content": request.preset_assistant})
    
    async def generate():
        try:
            # 动态创建客户端（使用请求中的配置或默认配置）
            client = create_client(
                api_key=request.api_key,
                base_url=request.base_url
            )
            
            # 构建API调用参数
            api_params = {
                "model": request.model,
                "messages": messages,
                "temperature": request.temperature,
                "stream": True
            }
            
            # max_tokens为可选参数，只有设置时才添加
            if request.max_tokens is not None and request.max_tokens > 0:
                api_params["max_tokens"] = request.max_tokens
            
            # 如果支持logprobs，添加参数
            if request.logprobs:
                try:
                    api_params["logprobs"] = True
                    api_params["top_logprobs"] = request.top_logprobs
                except Exception:
                    # 如果API不支持logprobs参数，忽略它
                    pass
            
            # 调用API（支持OpenAI和Ollama兼容API）
            stream = client.chat.completions.create(**api_params)
            
            for chunk in stream:
                if chunk.choices and len(chunk.choices) > 0:
                    delta = chunk.choices[0].delta
                    finish_reason = chunk.choices[0].finish_reason
                    
                    # 获取content，可能为空
                    content = delta.content or "" if hasattr(delta, 'content') else ""
                    
                    # 获取reasoning字段（思考过程），用于推理模型
                    reasoning = None
                    if hasattr(delta, 'reasoning') and delta.reasoning:
                        reasoning = delta.reasoning
                    elif hasattr(chunk.choices[0], 'delta') and hasattr(chunk.choices[0].delta, 'reasoning'):
                        reasoning = chunk.choices[0].delta.reasoning
                    
                    # 构建响应数据
                    data = {
                        "type": "token",
                        "content": content,
                        "reasoning": reasoning,  # 添加思考过程字段
                        "logprobs": None,
                        "finish_reason": finish_reason
                    }
                    
                    # 如果有logprobs数据
                    if hasattr(chunk.choices[0], 'logprobs') and chunk.choices[0].logprobs:
                        logprobs_obj = chunk.choices[0].logprobs
                        # 处理content中的logprobs
                        # 根据OpenAI API文档，logprobs_obj.content是一个列表
                        # 每个元素对应生成序列中的一个位置，包含top_logprobs个候选token
                        if hasattr(logprobs_obj, 'content') and logprobs_obj.content:
                            logprobs_data = []
                            # logprobs_obj.content 是一个列表，每个元素是一个ContentLogprob对象
                            # 每个ContentLogprob对象包含top_logprobs个TopLogprob对象
                            for content_item in logprobs_obj.content:
                                # 检查content_item的类型和结构
                                # 如果是ContentLogprob对象，应该有top_logprobs属性
                                if hasattr(content_item, 'top_logprobs') and content_item.top_logprobs:
                                    # 遍历所有top_logprobs候选
                                    for top_logprob in content_item.top_logprobs:
                                        if hasattr(top_logprob, 'token') and hasattr(top_logprob, 'logprob'):
                                            logprobs_data.append({
                                                "token": top_logprob.token,
                                                "logprob": top_logprob.logprob,
                                                "bytes": list(top_logprob.bytes) if hasattr(top_logprob, 'bytes') and top_logprob.bytes else None
                                            })
                                # 如果content_item本身就是TopLogprob对象（单个候选）
                                elif hasattr(content_item, 'token') and hasattr(content_item, 'logprob'):
                                    logprobs_data.append({
                                        "token": content_item.token,
                                        "logprob": content_item.logprob,
                                        "bytes": list(content_item.bytes) if hasattr(content_item, 'bytes') and content_item.bytes else None
                                    })
                                # 如果content_item是列表
                                elif isinstance(content_item, list):
                                    for top_logprob in content_item:
                                        if hasattr(top_logprob, 'token') and hasattr(top_logprob, 'logprob'):
                                            logprobs_data.append({
                                                "token": top_logprob.token,
                                                "logprob": top_logprob.logprob,
                                                "bytes": list(top_logprob.bytes) if hasattr(top_logprob, 'bytes') and top_logprob.bytes else None
                                            })
                            
                            # logprobs 包含当前位置的 top_logprobs 个可能的 token
                            # 这些是下一个 token 的预测，应该保存给下一个 token 使用
                            if logprobs_data:
                                data["logprobs"] = logprobs_data
                                # 调试：打印logprobs数据
                                print(f"DEBUG: logprobs count: {len(logprobs_data)}, content: {content}")
                                print(f"DEBUG: logprobs_data: {logprobs_data}")
                    
                    # 如果 finish_reason 是 "length"，说明达到了 max_tokens 限制
                    # 如果用户没有设置 max_tokens，这可能是一个问题
                    if finish_reason == "length" and request.max_tokens is None:
                        # 记录警告，但不中断输出
                        error_data = {
                            "type": "warning",
                            "message": "输出因达到长度限制而中断。建议设置 max_tokens 参数以避免此问题。"
                        }
                        yield f"data: {json.dumps(error_data, ensure_ascii=False)}\n\n"
                    
                    # 只要有content、reasoning或logprobs，就立即发送数据，确保流式传输
                    # 即使content为空，只要有reasoning或logprobs也发送（这样前端可以更新预测信息）
                    if content or reasoning or (data.get("logprobs") and len(data["logprobs"]) > 0):
                        # 立即发送数据，不等待
                        chunk_data = f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
                        yield chunk_data
                    
                    # 如果finish_reason存在，发送完成信号
                    if finish_reason:
                        yield f"data: {json.dumps({'type': 'done', 'finish_reason': finish_reason}, ensure_ascii=False)}\n\n"
                        break
                        
        except Exception as e:
            error_data = {
                "type": "error",
                "message": str(e)
            }
            yield f"data: {json.dumps(error_data, ensure_ascii=False)}\n\n"
    
    return StreamingResponse(
        generate(), 
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"  # 禁用nginx缓冲
        }
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

