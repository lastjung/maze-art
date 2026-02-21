# maze-art

미적 감각이 가미된 미로 생성 및 시각화 프로젝트입니다. Hexagon, Fibonacci, Circular, Polygon 기반의 다양한 미로 알고리즘을 감상할 수 있습니다.

## 포함된 미로 유형

- **Hexagon Maze**: 육각형 그리드 기반의 미로
- **Fibonacci Maze**: 피보나치 수열을 이용한 나선형 미로
- **Circular Obstacles**: 원형 장애물을 가로지르는 미로
- **Polygon Map**: 불규칙한 다각형 맵 기반의 미로

## 실행 방법

### 로컬 개발 서버용 (npm)

독립적인 실행을 위해 `serve` 패키지를 사용합니다.

```bash
npm install
npm run dev
```

브라우저 접속: [http://localhost:3000](http://localhost:3000)

### 간단 실행 (Python)

별도의 설치 없이 Python3를 사용하여 실행할 수 있습니다.

```bash
python3 -m http.server 3000
```

## 기술 스택

- **Core**: HTML5 Canvas, JavaScript
- **Libraries**: `delaunator` (Triangulation), `simplex-noise` (Noise Generation), `gsap` (Animation)
- **Styling**: Vanilla CSS
