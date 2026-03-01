/**
 * SquareMazeCase
 * Rectangular grid maze with animated pathfinding.
 */
const SquareMazeCase = {
    canvas: null,
    ctx: null,
    width: 0,
    height: 0,

    cols: 30,
    rows: 20,
    cellSize: 24,
    searchMode: 'astar',
    searchDelayMs: 24,
    solutionSpeed: 70,
    colorTheme: 'ocean',
    gridShape: 'square',
    sfxEnabled: true,
    sfxVolume: 0.1,

    grid: [],
    startNode: { x: 0, y: 0 },
    goalNode: { x: 0, y: 0 },

    frontierPQ: null,
    frontierQueue: null,
    frontierStack: null,
    frontierHead: 0,
    frontierSet: new Set(),
    exploredSet: new Set(),
    cameFrom: new Map(),
    costSoFar: new Map(),
    path: [],
    pathMap: new Map(),
    pathProgress: 0,
    currentNode: null,
    searchTimer: null,
    pathAnimTimer: null,
    searchInProgress: false,
    searchPaused: false,

    searchStartedAtMs: 0,
    searchElapsedMs: 0,
    lastSearchMs: 0,
    lastEnteredCellCount: 0,
    totalSearchCount: 0,
    totalFindCount: 0,
    stepSoundTick: 0,
    lastStepSoundAt: 0,

    init() {
        this.canvas = document.getElementById('mathCanvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.resize();
        this.reset();
    },

    get uiConfig() {
        return [
            {
                type: 'select',
                id: 'sq_shape',
                label: 'Grid Shape',
                value: this.gridShape,
                options: [
                    { value: 'square', label: 'Square (NxN)' },
                    { value: 'rectangle', label: 'Rectangle (Fill)' }
                ],
                onChange: (v) => {
                    this.gridShape = v;
                    this.reset();
                }
            },
            {
                type: 'select',
                id: 'sq_algorithm',
                label: 'Pathfinding',
                value: this.searchMode,
                options: [
                    { value: 'astar', label: 'A*' },
                    { value: 'dijkstra', label: 'Dijkstra' },
                    { value: 'greedy', label: 'Greedy Best-First' },
                    { value: 'bfs', label: 'Breadth-First Search' },
                    { value: 'dfs', label: 'Depth-First Search' }
                ],
                onChange: (v) => {
                    this.searchMode = v;
                    this.triggerSearch();
                }
            },
            {
                type: 'select',
                id: 'sq_theme',
                label: 'Color Theme',
                value: this.colorTheme,
                options: [
                    { value: 'rainbow', label: '0. Default (Rainbow)' },
                    { value: 'basic', label: '1. Basic (Green/Pink)' },
                    { value: 'ocean', label: '2. Ocean (Cyan/Blue)' },
                    { value: 'sunset', label: '3. Sunset (Orange/Purple)' },
                    { value: 'neon', label: '4. Neon (Gray/Lime)' }
                ],
                onChange: (v) => {
                    this.colorTheme = v;
                    this.draw();
                }
            },
            {
                type: 'slider',
                id: 'sq_speed',
                label: 'Search Speed',
                min: 1,
                max: 50,
                step: 1,
                value: MazeEngine.delayToSpeed(this.searchDelayMs),
                onChange: (v) => {
                    this.searchDelayMs = MazeEngine.speedToDelay(v);
                }
            },
            {
                type: 'slider',
                id: 'sq_sol_speed',
                label: 'Solution Speed',
                min: 1,
                max: 100,
                step: 1,
                value: this.solutionSpeed,
                onChange: (v) => {
                    this.solutionSpeed = v;
                }
            },
            {
                type: 'slider',
                id: 'sq_sfx',
                label: 'SFX Volume',
                min: 0,
                max: 0.3,
                step: 0.01,
                value: this.sfxVolume,
                onChange: (v) => {
                    this.sfxVolume = v;
                }
            },
            {
                type: 'slider',
                id: 'sq_grid',
                label: 'Grid Density',
                min: 12,
                max: 46,
                step: 1,
                value: this.cols,
                live: false,
                onChange: (v) => {
                    this.cols = Math.floor(v);
                    this.reset();
                }
            },
            { type: 'info', label: 'Start (Green)', value: 'Top-left Cell' },
            { type: 'info', label: 'Goal (Red)', value: 'Bottom-right Cell' },
            { type: 'info', label: 'Maze Control', value: 'Use top Reset Maze + Go' }
        ];
    },

    caseAudioLabel() {
        return 'SFX';
    },

    isCaseAudioMuted() {
        return !this.sfxEnabled;
    },

    toggleCaseAudio() {
        this.sfxEnabled = !this.sfxEnabled;
    },

    isCoreRunning() {
        return typeof Core !== 'undefined' ? !!Core.isRunning : true;
    },

    key(node) {
        return `${node.x},${node.y}`;
    },

    parseKey(k) {
        const [x, y] = k.split(',').map(Number);
        return { x, y };
    },

    inBounds(x, y) {
        return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
    },

    resize() {
        if (!this.canvas || !this.canvas.parentElement) return;
        const parent = this.canvas.parentElement;
        this.width = this.canvas.width = parent.clientWidth || 800;
        this.height = this.canvas.height = parent.clientHeight || 600;
        if (this.grid.length) this.draw();
    },

    reset() {
        this.stopSearchAnimation();
        this.clearSearchState();
        this.buildGrid();
        this.generateMaze();
        this.startNode = { x: 0, y: 0 };
        this.goalNode = { x: this.cols - 1, y: this.rows - 1 };
        this.draw();
    },

    buildGrid() {
        if (this.gridShape === 'rectangle') {
            this.rows = Math.max(10, Math.floor(this.cols * (this.height / Math.max(1, this.width))));
            this.rows = Math.min(80, this.rows);
        } else {
            this.rows = this.cols;
        }

        this.cellSize = Math.min(this.width / this.cols, this.height / this.rows) * 0.92;
        this.grid = Array.from({ length: this.rows }, () =>
            Array.from({ length: this.cols }, () => ({ open: 0 }))
        );
    },

    generateMaze() {
        const N = 1, E = 2, S = 4, W = 8;
        const dirs = [
            { dx: 0, dy: -1, bit: N, opp: S },
            { dx: 1, dy: 0, bit: E, opp: W },
            { dx: 0, dy: 1, bit: S, opp: N },
            { dx: -1, dy: 0, bit: W, opp: E }
        ];

        const visited = new Set();
        const stack = [{ x: 0, y: 0 }];
        visited.add('0,0');

        while (stack.length) {
            const current = stack[stack.length - 1];
            const options = [];
            for (const d of dirs) {
                const nx = current.x + d.dx;
                const ny = current.y + d.dy;
                const k = `${nx},${ny}`;
                if (!this.inBounds(nx, ny) || visited.has(k)) continue;
                options.push({ nx, ny, ...d });
            }

            if (!options.length) {
                stack.pop();
                continue;
            }

            const pick = options[Math.floor(Math.random() * options.length)];
            this.grid[current.y][current.x].open |= pick.bit;
            this.grid[pick.ny][pick.nx].open |= pick.opp;
            visited.add(`${pick.nx},${pick.ny}`);
            stack.push({ x: pick.nx, y: pick.ny });
        }

        // Add sparse extra passages so search explores alternatives.
        const extra = Math.floor(this.cols * this.rows * 0.06);
        for (let i = 0; i < extra; i++) {
            const x = Math.floor(Math.random() * this.cols);
            const y = Math.floor(Math.random() * this.rows);
            const all = [
                { dx: 0, dy: -1, bit: N, opp: S },
                { dx: 1, dy: 0, bit: E, opp: W },
                { dx: 0, dy: 1, bit: S, opp: N },
                { dx: -1, dy: 0, bit: W, opp: E }
            ];
            const d = all[Math.floor(Math.random() * all.length)];
            const nx = x + d.dx;
            const ny = y + d.dy;
            if (!this.inBounds(nx, ny)) continue;
            this.grid[y][x].open |= d.bit;
            this.grid[ny][nx].open |= d.opp;
        }
    },

    getNeighbors(node) {
        const N = 1, E = 2, S = 4, W = 8;
        const open = this.grid[node.y][node.x].open;
        const out = [];
        if (open & N) out.push({ x: node.x, y: node.y - 1 });
        if (open & E) out.push({ x: node.x + 1, y: node.y });
        if (open & S) out.push({ x: node.x, y: node.y + 1 });
        if (open & W) out.push({ x: node.x - 1, y: node.y });
        return out.filter(n => this.inBounds(n.x, n.y));
    },

    heuristic(a, b) {
        return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    },

    clearSearchState() {
        this.stopSearchAnimation();
        this.frontierPQ = null;
        this.frontierQueue = null;
        this.frontierStack = null;
        this.frontierHead = 0;
        this.frontierSet.clear();
        this.exploredSet.clear();
        this.cameFrom.clear();
        this.costSoFar.clear();
        this.path = [];
        this.pathMap.clear();
        this.pathProgress = 0;
        this.currentNode = null;
        this.searchInProgress = false;
        this.searchPaused = false;
        this.stepSoundTick = 0;
        this.lastStepSoundAt = 0;
        if (this.pathAnimTimer) {
            clearTimeout(this.pathAnimTimer);
            this.pathAnimTimer = null;
        }
    },

    stopSearchAnimation() {
        if (this.searchTimer) {
            clearTimeout(this.searchTimer);
            this.searchTimer = null;
        }
        this.searchInProgress = false;
    },

    initializeSearch() {
        this.clearSearchState();
        this.totalSearchCount += 1;
        this.searchStartedAtMs = performance.now();
        const sKey = this.key(this.startNode);
        this.cameFrom.set(sKey, null);
        this.costSoFar.set(sKey, 0);

        if (this.searchMode === 'bfs') {
            this.frontierQueue = [this.startNode];
        } else if (this.searchMode === 'dfs') {
            this.frontierStack = [this.startNode];
        } else {
            this.frontierPQ = new PriorityQueue();
            this.frontierPQ.put(this.startNode, 0);
        }

        this.frontierSet.add(sKey);
        this.searchInProgress = true;
    },

    hasFrontier() {
        if (this.searchMode === 'bfs') return this.frontierHead < this.frontierQueue.length;
        if (this.searchMode === 'dfs') return this.frontierStack.length > 0;
        return this.frontierPQ && !this.frontierPQ.empty();
    },

    popFrontier() {
        if (this.searchMode === 'bfs') return this.frontierQueue[this.frontierHead++];
        if (this.searchMode === 'dfs') return this.frontierStack.pop();
        return this.frontierPQ.get();
    },

    pushFrontier(node, priority = 0) {
        if (this.searchMode === 'bfs') this.frontierQueue.push(node);
        else if (this.searchMode === 'dfs') this.frontierStack.push(node);
        else this.frontierPQ.put(node, priority);
        this.frontierSet.add(this.key(node));
    },

    playStepSound() {
        const now = performance.now();
        if (now - this.lastStepSoundAt < 40) return;
        this.lastStepSoundAt = now;
        this.stepSoundTick += 1;
        if (this.stepSoundTick % 2 !== 0) return;
        const pitch = 220 + (this.stepSoundTick % 10) * 16;
        MazeEngine.playTone(pitch, 0.05, 'triangle', 0.45, 0.003, this);
    },

    finishSearch(found) {
        this.stopSearchAnimation();
        if (this.searchStartedAtMs > 0) {
            this.searchElapsedMs = performance.now() - this.searchStartedAtMs;
            this.lastSearchMs = this.searchElapsedMs;
            this.searchStartedAtMs = 0;
        }

        if (found) {
            this.totalFindCount += 1;
            this.reconstructPath();
            this.startPathAnimation();
        }
        this.lastEnteredCellCount = this.exploredSet.size;
        MazeEngine.playResultSound(found, this);
        this.currentNode = null;
        this.draw();

        if (typeof Core !== 'undefined' && Core.currentCase === this) {
            Core.syncPlayButton();
            Core.updateControls();
        }
    },

    reconstructPath() {
        this.path = [];
        this.pathMap.clear();
        const goalKey = this.key(this.goalNode);
        if (!this.cameFrom.has(goalKey)) return;

        let cur = this.goalNode;
        while (cur) {
            this.path.push(cur);
            cur = this.cameFrom.get(this.key(cur));
        }
        this.path.reverse();
        this.path.forEach((n, i) => this.pathMap.set(this.key(n), i));
    },

    stepSearch() {
        while (this.hasFrontier()) {
            const current = this.popFrontier();
            const cKey = this.key(current);
            this.frontierSet.delete(cKey);
            if (this.exploredSet.has(cKey)) continue;

            this.currentNode = current;
            this.exploredSet.add(cKey);
            this.playStepSound();
            if (this.searchStartedAtMs > 0) this.searchElapsedMs = performance.now() - this.searchStartedAtMs;

            if (current.x === this.goalNode.x && current.y === this.goalNode.y) {
                this.finishSearch(true);
                return;
            }

            for (const next of this.getNeighbors(current)) {
                const nKey = this.key(next);
                const newCost = (this.costSoFar.get(cKey) ?? 0) + 1;

                if (this.searchMode === 'bfs' || this.searchMode === 'dfs') {
                    if (this.cameFrom.has(nKey)) continue;
                    this.cameFrom.set(nKey, current);
                    this.costSoFar.set(nKey, newCost);
                    this.pushFrontier(next);
                    continue;
                }

                if (this.searchMode === 'greedy') {
                    if (this.cameFrom.has(nKey)) continue;
                    this.cameFrom.set(nKey, current);
                    this.costSoFar.set(nKey, newCost);
                    this.pushFrontier(next, this.heuristic(this.goalNode, next));
                    continue;
                }

                if (!this.costSoFar.has(nKey) || newCost < this.costSoFar.get(nKey)) {
                    this.costSoFar.set(nKey, newCost);
                    this.cameFrom.set(nKey, current);
                    const p = this.searchMode === 'dijkstra'
                        ? newCost
                        : newCost + this.heuristic(this.goalNode, next);
                    this.pushFrontier(next, p);
                }
            }

            this.draw();
            this.searchTimer = setTimeout(() => this.stepSearch(), this.searchDelayMs);
            return;
        }

        this.finishSearch(false);
    },

    startPathAnimation() {
        this.pathProgress = 0;
        if (this.pathAnimTimer) clearTimeout(this.pathAnimTimer);
        this.animatePath();
    },

    animatePath() {
        if (this.pathProgress < this.path.length) {
            const step = Math.ceil(Math.pow(this.solutionSpeed / 25, 2));
            this.pathProgress = Math.min(this.path.length, this.pathProgress + step);
            const delay = Math.max(1, 150 - this.solutionSpeed * 1.4);
            this.pathAnimTimer = setTimeout(() => this.animatePath(), delay);
            this.draw();
        } else {
            MazeEngine.playSolutionFinishSound(this);
        }
    },

    triggerSearch() {
        if (this.isCoreRunning()) {
            this.startSearchAnimation();
        } else {
            this.clearSearchState();
            this.draw();
        }
    },

    startSearchAnimation() {
        this.initializeSearch();
        this.draw();
        this.searchTimer = setTimeout(() => this.stepSearch(), this.searchDelayMs);
    },

    pauseSearch() {
        if (this.searchTimer) {
            clearTimeout(this.searchTimer);
            this.searchTimer = null;
        }
        this.searchPaused = true;
    },

    resumeSearch() {
        if (!this.searchPaused || !this.hasFrontier()) return;
        this.searchPaused = false;
        this.searchInProgress = true;
        this.searchTimer = setTimeout(() => this.stepSearch(), this.searchDelayMs);
    },

    draw() {
        if (!this.ctx || !this.grid.length) return;
        const ctx = this.ctx;
        const theme = MazeEngine.themes[this.colorTheme] || MazeEngine.themes.ocean;
        const gridW = this.cols * this.cellSize;
        const gridH = this.rows * this.cellSize;
        const ox = (this.width - gridW) * 0.5;
        const oy = (this.height - gridH) * 0.5;
        const N = 1, E = 2, S = 4, W = 8;

        ctx.clearRect(0, 0, this.width, this.height);
        ctx.fillStyle = '#161c2a';
        ctx.fillRect(0, 0, this.width, this.height);

        // Fill cells by state
        for (let y = 0; y < this.rows; y++) {
            for (let x = 0; x < this.cols; x++) {
                const k = `${x},${y}`;
                const pathIdx = this.pathMap.get(k);
                let fill = null;
                if (pathIdx !== undefined && pathIdx < this.pathProgress) fill = theme.path;
                else if (this.currentNode && this.currentNode.x === x && this.currentNode.y === y) fill = theme.current;
                else if (this.exploredSet.has(k)) fill = theme.explored;
                else if (this.frontierSet.has(k)) fill = theme.frontier;
                else if (x === this.startNode.x && y === this.startNode.y) fill = theme.start;
                else if (x === this.goalNode.x && y === this.goalNode.y) fill = theme.goal;

                if (fill) {
                    ctx.fillStyle = fill;
                    ctx.fillRect(
                        ox + x * this.cellSize,
                        oy + y * this.cellSize,
                        this.cellSize,
                        this.cellSize
                    );
                }
            }
        }

        // Walls
        ctx.strokeStyle = theme.wall;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let y = 0; y < this.rows; y++) {
            for (let x = 0; x < this.cols; x++) {
                const cell = this.grid[y][x];
                const px = ox + x * this.cellSize;
                const py = oy + y * this.cellSize;

                if (!(cell.open & N)) { ctx.moveTo(px, py); ctx.lineTo(px + this.cellSize, py); }
                if (!(cell.open & E)) { ctx.moveTo(px + this.cellSize, py); ctx.lineTo(px + this.cellSize, py + this.cellSize); }
                if (!(cell.open & S)) { ctx.moveTo(px, py + this.cellSize); ctx.lineTo(px + this.cellSize, py + this.cellSize); }
                if (!(cell.open & W)) { ctx.moveTo(px, py); ctx.lineTo(px, py + this.cellSize); }
            }
        }
        ctx.stroke();

        // Path line overlay
        if (this.path.length > 1 && this.pathProgress > 0) {
            ctx.beginPath();
            ctx.strokeStyle = theme.current;
            ctx.lineWidth = Math.max(2, this.cellSize * 0.16);
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            const p0 = this.path[0];
            ctx.moveTo(
                ox + p0.x * this.cellSize + this.cellSize * 0.5,
                oy + p0.y * this.cellSize + this.cellSize * 0.5
            );
            for (let i = 1; i < this.pathProgress; i++) {
                const p = this.path[i];
                ctx.lineTo(
                    ox + p.x * this.cellSize + this.cellSize * 0.5,
                    oy + p.y * this.cellSize + this.cellSize * 0.5
                );
            }
            ctx.stroke();
        }

        this.drawScoreboard();
    },

    formatMs(ms) {
        const value = Math.max(0, ms || 0);
        const totalSec = value / 1000;
        const min = Math.floor(totalSec / 60);
        const sec = Math.floor(totalSec % 60);
        const centi = Math.floor((value % 1000) / 10);
        return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(centi).padStart(2, '0')}`;
    },

    drawScoreboard() {
        const ctx = this.ctx;
        if (!ctx || !this.canvas) return;

        const liveMs = this.searchInProgress && this.searchStartedAtMs > 0
            ? performance.now() - this.searchStartedAtMs + this.searchElapsedMs
            : this.searchElapsedMs;
        const timeLabel = this.formatMs(liveMs);
        const enteredNow = this.exploredSet.size;
        
        const algorithmNames = {
            astar: 'A*',
            dijkstra: 'Dijkstra',
            greedy: 'Greedy',
            bfs: 'BFS',
            dfs: 'DFS'
        };
        const algorithmLabel = algorithmNames[this.searchMode] || this.searchMode;

        ctx.save();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '600 13px Inter, system-ui, sans-serif';
        ctx.fillText(`Algorithm: ${algorithmLabel}`, 26, 36);

        ctx.font = '500 12px Inter, system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.fillText(`Time: ${timeLabel}`, 26, 58);
        ctx.fillText(`Cells Entered: ${enteredNow}`, 26, 78);
        ctx.fillText(`Last: ${this.lastEnteredCellCount}`, 26, 98);
        ctx.restore();
    },

    startPausedOnLoad: true,
    autoPlayOnReset: false,

    start() {
        if (this.searchPaused) this.resumeSearch();
        else this.startSearchAnimation();
    },

    stop() {
        if (this.searchInProgress) this.pauseSearch();
        else this.stopSearchAnimation();
        if (this.pathAnimTimer) clearTimeout(this.pathAnimTimer);
    },

    destroy() {
        this.stopSearchAnimation();
        if (this.pathAnimTimer) clearTimeout(this.pathAnimTimer);
    }
};

window.SquareMazeCase = SquareMazeCase;
