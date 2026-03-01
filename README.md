# maze-art
Live
https://lastjung.github.io/maze-art/

미적 감각이 가미된 미로 생성 및 시각화 프로젝트입니다. Hexagon, Fibonacci, Circular, Polygon 기반의 다양한 미로 알고리즘을 감상할 수 있습니다.

## 포함된 미로 유형

- **Hexagon Maze**: 육각형 그리드 기반의 미로
- **Fibonacci Maze**: 피보나치 수열을 이용한 나선형 미로
- **Circular Obstacles**: 원형 장애물을 가로지르는 미로
- **Polygon Maze**: 불규칙한 다각형 그리드 기반의 미로
- **Square Maze**: 직교 격자 기반의 미로
- **Sphere Maze**: 구면 그래프 기반의 미로
- **Sphere Face Maze**: Goldberg 계열 다면체의 면 중심 그래프 기반 미로

## 추가 구현 계획 (Roadmap)

아래 항목은 다음 단계로 확장 예정인 미로/탐색 기능입니다.

1. **Triangular Maze**
   - 삼각 격자 기반 미로 및 다중 방향 경로 탐색
2. **Weighted Terrain Maze**
   - 지형 가중치(늪/도로/장애 구역) 기반 최소 비용 경로 탐색
3. **Teleport Portal Maze**
   - 포털 노드(쌍) 연결을 포함한 그래프 탐색
4. **Dynamic Maze**
   - 시간에 따라 열리고 닫히는 벽을 반영한 동적 탐색
5. **Multi-Goal Maze**
   - 체크포인트를 순차 방문하는 다중 목표 퍼즐
6. **3D Layer Maze**
   - 다층(층간 연결) 구조를 가진 입체형 미로
7. **Fractal Maze**
   - Hilbert/Peano 등 재귀 패턴 기반 미로 생성
8. **Flow Field Maze**
   - 벡터장/노이즈 흐름 기반의 유기적 통로 생성

## 실행 방법

### 로컬 개발 서버용 (pnpm)

독립적인 실행을 위해 `serve` 패키지를 사용합니다.

```bash
pnpm install
pnpm dev
```

브라우저 접속: [http://localhost:3000](http://localhost:3000)

### 간단 실행 (Python)

별도의 설치 없이 Python3를 사용하여 실행할 수 있습니다.

```bash
python3 -m http.server 3000
```

## 기술 스택

- **Core**: HTML5 Canvas, JavaScript
- **Libraries**: `delaunator` (Triangulation), `gsap` (Animation)
- **Styling**: Vanilla CSS
