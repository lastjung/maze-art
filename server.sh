#!/bin/bash

# 1. 경로 설정 (범용 표준)
PID_DIR="node_modules/.cache"
PID_FILE="$PID_DIR/dev-server.pid"

# 2. 실행 중인 서버 종료 함수
stop_server() {
    PID=$(cat "$PID_FILE")
    if kill -0 $PID 2>/dev/null; then
        echo "Stopping Server (PID: $PID)..."
        kill $PID
        rm "$PID_FILE"
        echo "Server stopped."
        exit 0
    fi
}

# 3. 메인 로직: 이미 실행 중이면 종료(Toggle)
if [ -f "$PID_FILE" ]; then
    stop_server
fi

# 4. 서버 시작 및 클린업 설정
mkdir -p "$PID_DIR"
echo "Starting Server (Press Ctrl+C to stop)..."

# 백그라운드로 실행할 시 PID 저장이 명확해야 하므로, 실행 직후 PID를 기록하는 방식을 선택합니다.
# 하지만 'pnpm dev'가 전면에서 실행되어야 로그를 볼 수 있다면 그대로 둡니다.
# 가이드상의 $$ (현재 스크립트 PID)를 사용하는 것은 스크립트 자체가 서버를 띄운 주체가 되기 때문입니다.

echo $$ > "$PID_FILE"

# 종료 시 PID 파일 삭제 트리거
trap 'rm -f "$PID_FILE"; exit' INT TERM EXIT

# maze-art 프로젝트의 실행 명령어 (package.json: dev -> serve -l 3000 .)
pnpm dev
