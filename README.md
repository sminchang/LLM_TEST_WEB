# LLM Test Web

로컬 LLM 테스트를 위한 웹 인터페이스

FastAPI 기반 백엔드 서버로, OpenAI API 호환 로컬 LLM 서버로 요청을 프록시합니다.

## Quick Start

### 1. 가상환경 생성 및 활성화

```bash
python3 -m venv venv
source venv/bin/activate
```

### 2. 의존성 설치

```bash
pip install -e .
```

### 3. 환경 변수 설정

`.env` 파일을 생성하고 설정:

```bash
cp .env.example .env
# .env 파일을 편집하여 LLM 서버 주소 설정
```

`.env` 예시:
```
OPENAI_BASE_URL=http://172.30.1.58:8000/v1
OPENAI_API_KEY=
OPENAI_MODEL=gpt-oss-120b
TEMPERATURE=0.7
MAX_TOKENS=500
```

### 4. 서버 실행

#### 포그라운드 실행 (개발용)
```bash
python app.py
```

#### 백그라운드 실행 (운영용)
```bash
# 백그라운드로 시작
nohup python3 app.py > app.log 2>&1 &

# 프로세스 ID 확인
echo $!

# 실행 확인
ps aux | grep app.py

# 로그 확인
tail -f app.log

# 종료
pkill -f "python3 app.py"
# 또는
kill <PID>
```