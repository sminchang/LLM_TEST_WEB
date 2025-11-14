"""
로컬 LLM 테스트 웹 서비스
FastAPI 기반 백엔드 서버
"""

import os
from typing import Optional, Dict, Any
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx
from dotenv import load_dotenv

# .env 파일 로드
load_dotenv()

# 환경변수에서 설정 읽기
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "http://localhost:8000/v1")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL")
if not OPENAI_MODEL:
    try:
        # 모델 목록 API 호출
        with httpx.Client(timeout=5.0) as client:
            response = client.get(f"{OPENAI_BASE_URL}/models")
            if response.status_code == 200:
                models = response.json().get("data", [])
                if models:
                    OPENAI_MODEL = models[0]["id"]
                    print(f"✓ 모델 자동 감지: {OPENAI_MODEL}")
                else:
                    raise ValueError("모델 목록이 비어있습니다")
            else:
                raise ValueError(f"API 응답 오류: {response.status_code}")
    except Exception as e:
        print(f"모델 자동 감지 실패: {e}")
        OPENAI_MODEL = "gpt-oss-120b"

# 기본값 (사용자가 UI에서 변경 가능)
DEFAULT_TEMPERATURE = float(os.getenv("TEMPERATURE", "0.7"))
DEFAULT_MAX_TOKENS = int(os.getenv("MAX_TOKENS", "2000"))

# 전역 HTTP 클라이언트 (connection pooling을 위해 재사용)
http_client: Optional[httpx.AsyncClient] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 시작/종료 시 리소스 관리"""
    global http_client

    # 앱 시작 시: HTTP 클라이언트 생성
    # limits: 최대 100개 연결, 호스트당 최대 20개 연결
    http_client = httpx.AsyncClient(
        timeout=300.0,
        limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)
    )
    print("HTTP 클라이언트 초기화 완료")

    yield

    # 앱 종료 시: HTTP 클라이언트 정리
    if http_client:
        await http_client.aclose()
        print("HTTP 클라이언트 종료 완료")


# FastAPI 앱 초기화
app = FastAPI(title="LLM Test Web Service", version="0.1.0", lifespan=lifespan)

# CORS 설정 - 개발 환경용
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ===== 데이터 모델 =====

class ChatRequest(BaseModel):
    """채팅 요청 모델"""
    messages: list[Dict[str, str]]
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    reasoning_effort: Optional[str] = None
    stream: Optional[bool] = False


# ===== API 엔드포인트 =====

@app.get("/")
async def root():
    """루트 경로 - index.html 반환"""
    static_dir = Path(__file__).parent / "static"
    index_file = static_dir / "index.html"

    if index_file.exists():
        return FileResponse(index_file)
    else:
        raise HTTPException(status_code=404, detail="index.html not found")


async def stream_chat_response(url: str, payload: Dict[str, Any], headers: Dict[str, str]):
    """
    스트리밍 응답을 처리하는 제너레이터
    """
    try:
        async with http_client.stream("POST", url, json=payload, headers=headers) as response:
            if response.status_code != 200:
                error_text = await response.aread()
                yield f"data: {{'error': 'LLM 서버 오류: {error_text.decode()}'}}\n\n"
                return

            async for line in response.aiter_lines():
                if line.strip():
                    # SSE 형식으로 그대로 전달
                    yield f"{line}\n"
    except httpx.TimeoutException:
        yield f"data: {{'error': 'LLM 서버 타임아웃'}}\n\n"
    except httpx.ConnectError:
        yield f"data: {{'error': 'LLM 서버에 연결할 수 없습니다'}}\n\n"
    except Exception as e:
        yield f"data: {{'error': '오류 발생: {str(e)}'}}\n\n"


@app.post("/api/chat")
async def chat(request: ChatRequest):
    """
    LLM 채팅 API
    .env 파일의 OPENAI_BASE_URL을 사용하여 로컬 LLM 서버로 요청 프록시
    스트리밍 모드 지원
    """
    # .env에서 읽은 BASE_URL 사용
    url = f"{OPENAI_BASE_URL}/chat/completions"

    # 사용자가 지정한 값 또는 기본값 사용
    temperature = request.temperature if request.temperature is not None else DEFAULT_TEMPERATURE
    max_tokens = request.max_tokens if request.max_tokens is not None else DEFAULT_MAX_TOKENS

    payload = {
        "model": OPENAI_MODEL,
        "messages": request.messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": request.stream,
    }

    # reasoning_effort 파라미터 추가 (지정된 경우에만)
    if request.reasoning_effort:
        payload["chat_template_kwargs"] = {
            "reasoning_effort": request.reasoning_effort
        }

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json"
    }
    if OPENAI_API_KEY:
        headers["Authorization"] = f"Bearer {OPENAI_API_KEY}"

    # 스트리밍 모드일 경우
    if request.stream:
        return StreamingResponse(
            stream_chat_response(url, payload, headers),
            media_type="text/event-stream"
        )

    # 비스트리밍 모드 (기존 방식)
    try:
        response = await http_client.post(url, json=payload, headers=headers)

        if response.status_code == 200:
            return response.json()
        else:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"LLM 서버 오류: {response.text}"
            )
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="LLM 서버 타임아웃")
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="LLM 서버에 연결할 수 없습니다")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"오류 발생: {str(e)}")


# 정적 파일 서빙 (HTML, CSS, JS)
app.mount("/static", StaticFiles(directory="static"), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)
