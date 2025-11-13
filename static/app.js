// ===== 전역 변수 =====
let chatMessages = []; // 채팅 메시지 히스토리

// ===== 초기화 =====
document.addEventListener('DOMContentLoaded', function() {
    loadSettings();

    // Bootstrap Popover 초기화
    const popoverTriggerList = document.querySelectorAll('[data-bs-toggle="popover"]');
    const popoverList = [...popoverTriggerList].map(popoverTriggerEl => new bootstrap.Popover(popoverTriggerEl, {
        html: true,
        sanitize: false
    }));
});

// ===== 환경 설정 관리 =====

/**
 * LocalStorage에서 설정 불러오기
 */
function loadSettings() {
    const settings = JSON.parse(localStorage.getItem('llm-settings')) || {};

    document.getElementById('temperature').value = settings.temperature || 0.7;
    document.getElementById('max-tokens').value = settings.maxTokens || 500;
    document.getElementById('reasoning-effort').value = settings.reasoningEffort || '';
    document.getElementById('streaming-mode').checked = settings.streamingMode || false;
}

/**
 * 설정을 LocalStorage에 저장
 */
function saveSettings() {
    const settings = {
        temperature: parseFloat(document.getElementById('temperature').value),
        maxTokens: parseInt(document.getElementById('max-tokens').value),
        reasoningEffort: document.getElementById('reasoning-effort').value,
        streamingMode: document.getElementById('streaming-mode').checked,
    };

    localStorage.setItem('llm-settings', JSON.stringify(settings));

    // 알림 표시
    showToast('설정이 저장되었습니다', 'success');
}

/**
 * 현재 설정값 가져오기
 */
function getSettings() {
    const reasoningEffort = document.getElementById('reasoning-effort').value;
    const streamingMode = document.getElementById('streaming-mode').checked;

    const settings = {
        temperature: parseFloat(document.getElementById('temperature').value),
        max_tokens: parseInt(document.getElementById('max-tokens').value),
        stream: streamingMode,
    };

    // reasoning_effort가 설정된 경우만 추가
    if (reasoningEffort) {
        settings.reasoning_effort = reasoningEffort;
    }

    return settings;
}

// ===== 채팅 기능 =====

/**
 * 채팅 메시지 전송
 */
async function sendMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();

    if (!message) return;

    // 사용자 메시지 추가
    chatMessages.push({ role: 'user', content: message });
    displayMessage('user', message);

    // 입력창 초기화
    input.value = '';

    // 전송 버튼 비활성화
    const sendBtn = document.getElementById('send-btn');
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<span class="loading">전송 중</span>';

    // 시작 시간 기록
    const startTime = performance.now();

    // 설정 가져오기
    const settings = getSettings();

    try {
        // 스트리밍 모드
        if (settings.stream) {
            await handleStreamingResponse(settings, startTime);
        } else {
            // 비스트리밍 모드 (기존 방식)
            await handleNonStreamingResponse(settings, startTime);
        }
    } catch (error) {
        console.error('채팅 오류:', error);
        displayMessage('assistant', `오류가 발생했습니다: ${error.response?.data?.detail || error.message}`);
    } finally {
        // 전송 버튼 활성화
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<i class="bi bi-send"></i> 전송';
    }
}

/**
 * 비스트리밍 응답 처리
 */
async function handleNonStreamingResponse(settings, startTime) {
    const response = await axios.post('/api/chat', {
        messages: chatMessages,
        temperature: settings.temperature,
        max_tokens: settings.max_tokens,
        reasoning_effort: settings.reasoning_effort,
        stream: false,
    });

    // 종료 시간 계산
    const endTime = performance.now();
    const responseTime = ((endTime - startTime) / 1000).toFixed(2);

    // 어시스턴트 응답 추가
    const assistantMessage = response.data.choices[0].message.content;
    chatMessages.push({ role: 'assistant', content: assistantMessage });
    displayMessage('assistant', assistantMessage, responseTime);
}

/**
 * 스트리밍 응답 처리
 */
async function handleStreamingResponse(settings, startTime) {
    const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            messages: chatMessages,
            temperature: settings.temperature,
            max_tokens: settings.max_tokens,
            reasoning_effort: settings.reasoning_effort,
            stream: true,
        }),
    });

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    // 어시스턴트 메시지를 위한 컨테이너 생성
    const container = document.getElementById('chat-messages');

    // 첫 메시지인 경우 안내 텍스트 제거
    if (chatMessages.length === 1) {
        container.innerHTML = '';
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    messageDiv.appendChild(contentDiv);
    container.appendChild(messageDiv);

    let fullContent = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);

                    if (data === '[DONE]') {
                        break;
                    }

                    try {
                        const parsed = JSON.parse(data);

                        // 오류 체크
                        if (parsed.error) {
                            contentDiv.textContent = `오류: ${parsed.error}`;
                            return;
                        }

                        // 델타 콘텐츠 추출
                        const delta = parsed.choices?.[0]?.delta?.content;
                        if (delta) {
                            fullContent += delta;
                            contentDiv.textContent = fullContent;

                            // 스크롤을 최하단으로
                            container.scrollTop = container.scrollHeight;
                        }
                    } catch (e) {
                        // JSON 파싱 실패는 무시 (불완전한 청크일 수 있음)
                    }
                }
            }
        }

        // 종료 시간 계산 및 응답 시간 표시
        const endTime = performance.now();
        const responseTime = ((endTime - startTime) / 1000).toFixed(2);

        const timeDiv = document.createElement('div');
        timeDiv.className = 'response-time';
        timeDiv.textContent = `응답 시간: ${responseTime}초`;
        messageDiv.appendChild(timeDiv);

        // 메시지 히스토리에 추가
        chatMessages.push({ role: 'assistant', content: fullContent });

    } catch (error) {
        contentDiv.textContent = `스트리밍 오류: ${error.message}`;
        console.error('스트리밍 오류:', error);
    }
}

/**
 * 채팅 메시지를 화면에 표시
 */
function displayMessage(role, content, responseTime = null) {
    const container = document.getElementById('chat-messages');

    // 첫 메시지인 경우 안내 텍스트 제거
    if (chatMessages.length === 1) {
        container.innerHTML = '';
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.textContent = content;

    messageDiv.appendChild(contentDiv);

    // 응답 시간 표시 (assistant 메시지인 경우만)
    if (role === 'assistant' && responseTime !== null) {
        const timeDiv = document.createElement('div');
        timeDiv.className = 'response-time';
        timeDiv.textContent = `응답 시간: ${responseTime}초`;
        messageDiv.appendChild(timeDiv);
    }

    container.appendChild(messageDiv);

    // 스크롤을 최하단으로
    container.scrollTop = container.scrollHeight;
}

/**
 * 대화 히스토리 초기화
 */
function clearChat() {
    if (!confirm('대화 내용을 모두 삭제하시겠습니까?')) return;

    chatMessages = [];
    const container = document.getElementById('chat-messages');
    container.innerHTML = `
        <div class="text-center text-muted py-5">
            <i class="bi bi-chat-square-text" style="font-size: 3rem;"></i>
            <p class="mt-3">메시지를 입력하여 대화를 시작하세요</p>
        </div>
    `;
}

// ===== 유틸리티 함수 =====

/**
 * 토스트 알림 표시
 * Bootstrap의 alert 컴포넌트 대신 간단한 토스트 사용
 */
function showToast(message, type = 'info') {
    // 기존 토스트 컨테이너가 없으면 생성
    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        toastContainer.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
        `;
        document.body.appendChild(toastContainer);
    }

    // 토스트 생성
    const toast = document.createElement('div');
    toast.className = `alert alert-${type} alert-dismissible fade show`;
    toast.style.cssText = 'min-width: 250px; margin-bottom: 10px;';
    toast.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;

    toastContainer.appendChild(toast);

    // 3초 후 자동 제거
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 150);
    }, 3000);
}
