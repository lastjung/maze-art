/**
 * PathfindingCase
 * Hex maze + animated multi-algorithm pathfinding.
 * Now utilizing the decoupled MazeEngine for core logic.
 */
const HexMazeCase = {
    canvas: null,
    ctx: null,

    // Config
    hexSize: 8,
    gridRadius: 25,
    searchMode: 'astar', // astar | dijkstra | greedy | bfs | dfs
    searchDelayMs: 35,
    sfxEnabled: true,
    sfxVolume: 0.08,

    // Graph State
    startNode: { q: 0, r: 0 },
    goalNode: { q: 0, r: 0 },
    walls: new Set(),

    // Search Visualization State
    cameFrom: {},
    costSoFar: {},
    path: [],
    pathSet: new Set(),
    frontierSet: new Set(),
    exploredSet: new Set(),
    currentNode: null,

    frontierPQ: null,
    frontierQueue: null,
    frontierStack: null,
    frontierHead: 0,

    searchTimer: null,
    searchInProgress: false,
    searchPaused: false,
    colorTheme: 'basic',

    themes: {
        basic: {
            wall: '#86efac',        // Green
            explored: '#ec4899',    // Pink
            frontier: '#f472b6',    // Light Pink
            start: '#00CC00',       // Bright Green
            goal: '#FF0000',        // Red
            path: 'rgba(255, 215, 0, 0.30)', // Gold
            current: '#FFD700'      // Yellow
        },
        ocean: {
            wall: '#22d3ee',        // Cyan (Sky Blue)
            explored: '#3b82f6',    // Blue
            frontier: '#93c5fd',    // Light Blue
            start: '#0891b2',       // Dark Cyan
            goal: '#FF0000',        // Universal Red Goal for visibility
            path: 'rgba(255, 0, 0, 0.45)', // Red tinted path cells
            current: '#FF0000'      // Red path LINE
        },
        sunset: {
            wall: '#fdba74',        // Light Orange
            explored: '#7c3aed',    // Purple
            frontier: '#a78bfa',    // Light Purple
            start: '#f97316',       // Orange
            goal: '#FF0000',        // Red
            path: 'rgba(255, 255, 255, 0.25)', // Subtle white fill for cells
            current: '#39ff14'                 // Neon Green for the path LINE
        },
        neon: {
            wall: '#f3f4f6',        // Light Gray wall
            explored: '#4d7c0f',    // Dark Lime search
            frontier: '#84cc16',    // Bright Lime frontier
            start: '#1f2937', 
            goal: '#FF0000',        // Red
            path: 'rgba(132, 204, 22, 0.2)', // Light lime tint for cells
            current: '#FFD700'      // Yellow for the path LINE
        }
    },

    searchStartedAtMs: 0,
    searchElapsedMs: 0,
    totalSearchCount: 0,
    totalFindCount: 0,
    lastSearchMs: 0,
    lastEnteredHexCount: 0,
    audioCtx: null,
    stepSoundTick: 0,
    lastStepSoundAt: 0,

    // Interaction
    isDraggingStart: false,
    isDraggingGoal: false,
    isDrawingWall: false,
    isErasingWall: false,
    eventsBound: false,

    init() {
        this.canvas = document.getElementById('mathCanvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');

        this.handleMouseDown = this.onMouseDown.bind(this);
        this.handleMouseMove = this.onMouseMove.bind(this);
        this.handleMouseUp = this.onMouseUp.bind(this);

        this.resize();
        this.bindEvents();
        // Build maze first, then Go/start will show the search process.
        this.generateMaze({ solve: false });
    },

    get uiConfig() {
        return [
            {
                type: 'select',
                id: 'pf_shape',
                label: 'Maze Shape',
                value: this.mazeShape || 'random',
                options: [
                    { value: 'random', label: 'Random (Default)' },
                    { value: 'heart', label: 'Heart Path' },
                    { value: 'star', label: 'Star Path' },
                    { value: 'infinity', label: 'Infinity (∞) Path' },
                    { value: 'spiral', label: 'Spiral Path' }
                ],
                onChange: (v) => {
                    this.mazeShape = v;
                    this.generateMaze({ solve: this.isCoreRunning() });
                }
            },
            {
                type: 'select',
                id: 'pf_algorithm',
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
                id: 'pf_theme',
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
                id: 'pf_speed',
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
                id: 'pf_sfx_volume',
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
                id: 'pf_hex_size',
                label: 'Hex Size',
                min: 4,
                max: 28,
                step: 1,
                value: this.hexSize,
                onChange: (v) => {
                    this.hexSize = v;
                    this.draw();
                }
            },
            {
                type: 'slider',
                id: 'pf_radius',
                label: 'Grid Radius',
                min: 8,
                max: 50,
                step: 1,
                value: this.gridRadius,
                onChange: (v) => {
                    this.gridRadius = v;
                    this.generateMaze({ solve: this.isCoreRunning() });
                }
            },
            { type: 'info', label: 'Start (Green)', value: 'Drag to Move' },
            { type: 'info', label: 'Goal (Red)', value: 'Drag to Move' },
            { type: 'info', label: 'Walls (Gray)', value: 'Drag to Edit' },
            { type: 'info', label: 'Maze Control', value: 'Use top Reset Maze + Go' }
        ];
    },

    key(h) {
        return MazeEngine.key(h);
    },

    isWalkable(node) {
        return MazeEngine.isWalkable(node, this.gridRadius, this.walls);
    },

    isInside(node) {
        return MazeEngine.isInside(node, this.gridRadius);
    },

    isCoreRunning() {
        return typeof Core !== 'undefined' ? !!Core.isRunning : true;
    },

    caseAudioLabel() {
        return 'SFX Status';
    },

    isCaseAudioMuted() {
        return !this.sfxEnabled;
    },

    toggleCaseAudio() {
        this.sfxEnabled = !this.sfxEnabled;
    },

    playStepSound() {
        const now = performance.now();
        if (now - this.lastStepSoundAt < 40) return;
        this.lastStepSoundAt = now;
        this.stepSoundTick += 1;

        if (this.stepSoundTick % 2 !== 0) return;
        const pitch = 240 + (this.stepSoundTick % 10) * 18;
        MazeEngine.playTone(pitch, 0.05, 'triangle', 0.45, 0.003, this);
    },

    clearSearchState() {
        this.stopSearchAnimation();
        this.cameFrom = {};
        this.costSoFar = {};
        this.path = [];
        this.pathSet.clear();
        this.frontierSet.clear();
        this.exploredSet.clear();
        this.currentNode = null;
        this.searchInProgress = false;
        this.searchPaused = false;
        this.stepSoundTick = 0;
        this.lastStepSoundAt = 0;
        this.searchElapsedMs = 0;
        this.searchStartedAtMs = 0;
    },

    stopSearchAnimation() {
        if (this.searchTimer) {
            clearTimeout(this.searchTimer);
            this.searchTimer = null;
        }
        this.searchInProgress = false;
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

    normalizeEndpoints() {
        if (!this.isWalkable(this.startNode)) {
            this.startNode = MazeEngine.findNearestWalkable(this.startNode, this.gridRadius, this.walls) || { q: 0, r: 0 };
        }
        if (!this.isWalkable(this.goalNode)) {
            this.goalNode = MazeEngine.findNearestWalkable(this.goalNode, this.gridRadius, this.walls) || this.startNode;
        }
    },

    initializeSearch() {
        this.normalizeEndpoints();
        this.clearSearchState();
        this.totalSearchCount += 1;
        this.searchStartedAtMs = performance.now();

        const startKey = MazeEngine.key(this.startNode);
        this.cameFrom[startKey] = null;
        this.costSoFar[startKey] = 0;

        if (this.searchMode === 'bfs') {
            this.frontierQueue = [this.startNode];
            this.frontierHead = 0;
            this.frontierPQ = null;
            this.frontierStack = null;
        } else if (this.searchMode === 'dfs') {
            this.frontierStack = [this.startNode];
            this.frontierQueue = null;
            this.frontierPQ = null;
        } else {
            this.frontierPQ = new PriorityQueue();
            this.frontierPQ.put(this.startNode, 0);
            this.frontierQueue = null;
            this.frontierStack = null;
        }

        this.frontierSet.add(startKey);
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
        const nk = MazeEngine.key(node);
        if (this.searchMode === 'bfs') this.frontierQueue.push(node);
        else if (this.searchMode === 'dfs') this.frontierStack.push(node);
        else this.frontierPQ.put(node, priority);
        this.frontierSet.add(nk);
    },

    reconstructPath() {
        this.path = [];
        this.pathSet.clear();

        const goalKey = MazeEngine.key(this.goalNode);
        if (!(goalKey in this.cameFrom)) return;

        let current = this.goalNode;
        while (current) {
            this.path.push(current);
            this.pathSet.add(MazeEngine.key(current));
            current = this.cameFrom[MazeEngine.key(current)];
        }
        this.path.reverse();
    },

    finishSearch(found) {
        this.stopSearchAnimation();
        if (this.searchStartedAtMs > 0) {
            this.searchElapsedMs = performance.now() - this.searchStartedAtMs;
            this.lastSearchMs = this.searchElapsedMs;
            this.searchStartedAtMs = 0;
        }
        if (found) this.reconstructPath();
        if (found) this.totalFindCount += 1;
        this.lastEnteredHexCount = this.exploredSet.size;
        MazeEngine.playResultSound(found, this);
        this.currentNode = null;
        this.draw();

        // Sync button state: search is done → "Go"
        if (typeof Core !== 'undefined' && Core.currentCase === this) {
            Core.syncPlayButton();
            Core.updateControls();
        }
    },

    stepSearch() {
        while (this.hasFrontier()) {
            const current = this.popFrontier();
            const currentKey = MazeEngine.key(current);

            this.frontierSet.delete(currentKey);
            if (this.exploredSet.has(currentKey)) {
                continue;
            }

            this.currentNode = current;
            this.exploredSet.add(currentKey);
            this.playStepSound();
            if (this.searchStartedAtMs > 0) {
                this.searchElapsedMs = performance.now() - this.searchStartedAtMs;
            }

            if (current.q === this.goalNode.q && current.r === this.goalNode.r) {
                this.finishSearch(true);
                return;
            }

            for (const next of MazeEngine.getNeighbors(current, this.gridRadius, this.walls)) {
                const nextKey = MazeEngine.key(next);
                const newCost = this.costSoFar[currentKey] + 1;

                if (this.searchMode === 'bfs' || this.searchMode === 'dfs') {
                    if (nextKey in this.cameFrom) continue;
                    this.cameFrom[nextKey] = current;
                    this.costSoFar[nextKey] = newCost;
                    this.pushFrontier(next);
                    continue;
                }

                if (this.searchMode === 'greedy') {
                    if (nextKey in this.cameFrom) continue;
                    this.cameFrom[nextKey] = current;
                    this.costSoFar[nextKey] = newCost;
                    this.pushFrontier(next, MazeEngine.heuristic(this.goalNode, next));
                    continue;
                }

                if (!(nextKey in this.costSoFar) || newCost < this.costSoFar[nextKey]) {
                    this.costSoFar[nextKey] = newCost;
                    this.cameFrom[nextKey] = current;
                    const priority = this.searchMode === 'dijkstra'
                        ? newCost
                        : newCost + MazeEngine.heuristic(this.goalNode, next);
                    this.pushFrontier(next, priority);
                }
            }

            this.draw();
            this.searchTimer = setTimeout(() => this.stepSearch(), this.searchDelayMs);
            return;
        }

        this.finishSearch(false);
    },

    startSearchAnimation() {
        this.initializeSearch();
        this.draw();
        this.searchTimer = setTimeout(() => this.stepSearch(), this.searchDelayMs);
    },

    triggerSearch() {
        if (this.isCoreRunning()) {
            this.startSearchAnimation();
        } else {
            this.normalizeEndpoints();
            this.clearSearchState();
            this.draw();
        }
    },

    pickAnyOpenNode() {
        return MazeEngine.pickAnyOpenNode(this.gridRadius, this.walls);
    },

    farthestReachableFrom(source) {
        return MazeEngine.farthestReachableFrom(source, this.gridRadius, this.walls);
    },

    generateMaze({ solve = false } = {}) {
        this.stopSearchAnimation();

        this.walls.clear();
        MazeEngine.forEachHex(this.gridRadius, (h) => this.walls.add(MazeEngine.key(h)));

        if (this.mazeShape === 'heart' || this.mazeShape === 'star' || this.mazeShape === 'infinity' || this.mazeShape === 'spiral') {
            const waypoints = [];
            if (this.mazeShape === 'heart') {
                const numPoints = 80;
                for (let i = 6; i <= numPoints - 6; i++) {
                    let t = (i / numPoints) * (Math.PI * 2);
                    let x = 16 * Math.pow(Math.sin(t), 3);
                    let y = 13 * Math.cos(t) - 5 * Math.cos(2*t) - 2 * Math.cos(3*t) - Math.cos(4*t);
                    x *= 1.8 * this.hexSize;
                    y *= -1.8 * this.hexSize;
                    y += 4 * this.hexSize;
                    waypoints.push(MazeEngine.pixelToHex(x, y, this.hexSize));
                }
            } else if (this.mazeShape === 'star') {
                const numPoints = 10;
                for (let i = 0; i <= numPoints; i++) {
                    const angle = -Math.PI/2 + (i / numPoints) * Math.PI * 2;
                    const isOuter = i % 2 === 0;
                    const r_dist = (isOuter ? 30 : 18) * this.hexSize;
                    let x = r_dist * Math.cos(angle);
                    let y = r_dist * Math.sin(angle);
                    if (i === 0) x += 3.5 * this.hexSize;
                    else if (i === numPoints) x -= 3.5 * this.hexSize;
                    waypoints.push(MazeEngine.pixelToHex(x, y, this.hexSize));
                }
            } else if (this.mazeShape === 'infinity') {
                waypoints.length = 0;
                let s = Math.floor(this.gridRadius * 0.40); // 10
                let h = Math.floor(this.gridRadius * 0.25); // 6 (Vertical height offset)
                
                let nodes = [
                    {q: -s*2, r: -h},     // Far Left Top
                    {q: -s,   r: -h*2},   // Left Upper Curve
                    {q: -1,   r: -1},     // Center Pinch Top (Left side)
                    {q: s,    r: -h*2},   // Right Upper Curve
                    {q: s*2,  r: -h},     // Far Right Top
                    {q: s*2,  r: h},      // Far Right Bottom
                    {q: s,    r: h*2},    // Right Lower Curve
                    {q: 1,    r: 1},      // Center Pinch Bottom (Right side)
                    {q: -s,   r: h*2},    // Left Lower Curve
                    {q: -s*2, r: h}       // Far Left Bottom
                ];

                for (let i = 0; i < nodes.length; i++) {
                    let a = nodes[i];
                    let b = nodes[(i + 1) % nodes.length];
                    
                    const N = MazeEngine.hexDistance(a, b);
                    const steps = Math.max(1, N);
                    let endStep = (i === nodes.length - 1) ? Math.max(1, steps - 4) : steps;
                    
                    for (let j = 0; j < endStep; j++) {
                        waypoints.push(MazeEngine.hexRoundFractional(MazeEngine.hexLerp(a, b, j / steps)));
                    }
                }

            } else if (this.mazeShape === 'spiral') {
                const loops = 5.0; 
                const numPoints = 800; 
                
                for (let i = 0; i <= numPoints; i++) {
                    let t = (i / numPoints) * (Math.PI * 2 * loops);
                    let r = 2.0 * this.hexSize + 5.5 * this.hexSize * (t / (Math.PI * 2));
                    let x = r * Math.cos(t);
                    let y = r * Math.sin(t);
                    waypoints.push(MazeEngine.pixelToHex(x, y, this.hexSize));
                }
            }
            
            const pathList = [];
            const pathKeys = new Set();
            for (let i = 0; i < waypoints.length - 1; i++) {
                const line = MazeEngine.getHexLine(waypoints[i], waypoints[i+1]);
                for (const h of line) {
                    if (!this.isInside(h)) continue;
                    const k = MazeEngine.key(h);
                    if (!pathKeys.has(k)) {
                        pathKeys.add(k);
                        pathList.push(h);
                    }
                }
            }

            if (pathList.length > 2) {
                // By default, Start is at the very beginning of the array,
                // Goal is at the very end.
                // For infinity, this places Start and Goal right next to each other
                // physically, but separated by a 4-hex solid wall. 
                // This PERFECTLY forces the algorithm to travel the ENTIRE loop!
                this.startNode = pathList[0];
                this.goalNode = pathList[pathList.length - 1];

                const W = new Set();
                for (const h of pathList) {
                    const k = MazeEngine.key(h);
                    this.walls.delete(k);
                    W.add(k);
                }

                const pathSetKeys = new Set(W); 
                const eligible = [];

                MazeEngine.forEachHex(this.gridRadius, h => {
                    if (this.walls.has(MazeEngine.key(h))) {
                        let wNeighbors = 0;
                        for (const n of MazeEngine.getNeighborsIgnoringWalls(h, this.gridRadius)) {
                            if (W.has(MazeEngine.key(n))) wNeighbors++;
                        }
                        if (wNeighbors === 1) eligible.push(h);
                    }
                });
                eligible.sort(() => Math.random() - 0.5);

                while (eligible.length > 0) {
                    if (Math.random() < 0.2) {
                        const swapIdx = Math.floor(Math.random() * eligible.length);
                        const temp = eligible[eligible.length - 1];
                        eligible[eligible.length - 1] = eligible[swapIdx];
                        eligible[swapIdx] = temp;
                    }
                    
                    const curr = eligible.pop();
                    const k = MazeEngine.key(curr);
                    if (!this.walls.has(k)) continue;

                    let wNeighbors = 0;
                    let touchesOriginalPath = 0;

                    for (const n of MazeEngine.getNeighborsIgnoringWalls(curr, this.gridRadius)) {
                        const nk = MazeEngine.key(n);
                        if (W.has(nk)) {
                            wNeighbors++;
                            if (pathSetKeys.has(nk)) {
                                touchesOriginalPath++;
                            }
                        }
                    }

                    if (wNeighbors === 1 && touchesOriginalPath <= 1) {
                        this.walls.delete(k);
                        W.add(k);
                        for (const n of MazeEngine.getNeighborsIgnoringWalls(curr, this.gridRadius)) {
                            if (this.walls.has(MazeEngine.key(n))) {
                                let wn = 0;
                                let origTouches = 0;
                                for (const nn of MazeEngine.getNeighborsIgnoringWalls(n, this.gridRadius)) {
                                    const nnk = MazeEngine.key(nn);
                                    if (W.has(nnk)) {
                                        wn++;
                                        if (pathSetKeys.has(nnk)) origTouches++;
                                    }
                                }
                                if (wn === 1 && origTouches <= 1) eligible.push(n);
                            }
                        }
                    }
                }

                if (solve) this.startSearchAnimation();
                else {
                    this.clearSearchState();
                    this.draw();
                }
                return;
            }
        }

        const cellSet = new Set();
        const cells = [];
        MazeEngine.forEachHex(this.gridRadius, (h) => {
            if (h.q % 2 === 0 && h.r % 2 === 0) {
                const k = MazeEngine.key(h);
                cellSet.add(k);
                cells.push(h);
            }
        });

        if (cells.length === 0) {
            this.clearWalls({ solve });
            return;
        }

        const startCell = MazeEngine.randomChoice(cells);
        const stack = [startCell];
        const visited = new Set([MazeEngine.key(startCell)]);
        this.walls.delete(MazeEngine.key(startCell));

        while (stack.length) {
            const current = stack[stack.length - 1];
            const options = [];

            // Still need mazeStepDirections, it's specific to this generator
            for (const dir of MazeEngine.mazeStepDirections) {
                const next = { q: current.q + dir.q, r: current.r + dir.r };
                const nextKey = MazeEngine.key(next);
                if (!MazeEngine.isInside(next, this.gridRadius)) continue;
                if (!cellSet.has(nextKey)) continue;
                if (visited.has(nextKey)) continue;
                options.push(next);
            }

            if (!options.length) {
                stack.pop();
                continue;
            }

            const next = MazeEngine.randomChoice(options);
            const bridge = { q: (current.q + next.q) / 2, r: (current.r + next.r) / 2 };

            this.walls.delete(MazeEngine.key(bridge));
            this.walls.delete(MazeEngine.key(next));
            visited.add(MazeEngine.key(next));
            stack.push(next);
        }

        const seed = this.pickAnyOpenNode();
        if (!seed) {
            this.clearWalls({ solve });
            return;
        }

        const a = this.farthestReachableFrom(seed);
        const b = this.farthestReachableFrom(a);
        this.startNode = a;
        this.goalNode = b;

        this.walls.delete(MazeEngine.key(this.startNode));
        this.walls.delete(MazeEngine.key(this.goalNode));

        if (solve) this.startSearchAnimation();
        else {
            this.clearSearchState();
            this.draw();
        }
    },

    clearWalls({ solve = false } = {}) {
        this.stopSearchAnimation();
        this.walls.clear();
        this.startNode = { q: -Math.floor(this.gridRadius / 2), r: 0 };
        this.goalNode = { q: Math.floor(this.gridRadius / 2), r: 0 };

        if (solve) this.startSearchAnimation();
        else {
            this.clearSearchState();
            this.draw();
        }
    },

    getHexFromEvent(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left - this.canvas.width / 2;
        const y = e.clientY - rect.top - this.canvas.height / 2;
        return MazeEngine.pixelToHex(x, y, this.hexSize);
    },

    onMouseDown(e) {
        const hex = this.getHexFromEvent(e);
        if (!MazeEngine.isInside(hex, this.gridRadius)) return;

        const k = MazeEngine.key(hex);
        const startK = MazeEngine.key(this.startNode);
        const goalK = MazeEngine.key(this.goalNode);

        if (k === startK) {
            this.isDraggingStart = true;
            return;
        }
        if (k === goalK) {
            this.isDraggingGoal = true;
            return;
        }

        if (this.walls.has(k)) {
            this.walls.delete(k);
            this.isErasingWall = true;
        } else {
            this.walls.add(k);
            this.isDrawingWall = true;
        }
        this.triggerSearch();
    },

    onMouseMove(e) {
        if (!this.isDraggingStart && !this.isDraggingGoal && !this.isDrawingWall && !this.isErasingWall) {
            return;
        }

        const hex = this.getHexFromEvent(e);
        if (!MazeEngine.isInside(hex, this.gridRadius)) return;

        const k = MazeEngine.key(hex);
        const startK = MazeEngine.key(this.startNode);
        const goalK = MazeEngine.key(this.goalNode);

        if (this.isDraggingStart) {
            if (k !== goalK && !this.walls.has(k)) {
                this.startNode = hex;
                this.triggerSearch();
            }
        } else if (this.isDraggingGoal) {
            if (k !== startK && !this.walls.has(k)) {
                this.goalNode = hex;
                this.triggerSearch();
            }
        } else if (this.isDrawingWall) {
            if (k !== startK && k !== goalK) {
                this.walls.add(k);
                this.triggerSearch();
            }
        } else if (this.isErasingWall) {
            this.walls.delete(k);
            this.triggerSearch();
        }
    },

    onMouseUp() {
        this.isDraggingStart = false;
        this.isDraggingGoal = false;
        this.isDrawingWall = false;
        this.isErasingWall = false;
    },

    drawHex(q, r) {
        const k = MazeEngine.key({ q, r });
        const center = MazeEngine.hexToPixel(q, r, this.hexSize);
        const drawSize = this.hexSize * 0.92;
        const ctx = this.ctx;

        let fill = 'rgba(240, 248, 255, 0.16)';
        let stroke = 'rgba(255, 255, 255, 0.22)';
        const theme = MazeEngine.themes[this.colorTheme] || MazeEngine.themes.basic;

        if (this.walls.has(k)) {
            if (this.colorTheme === 'rainbow') {
                const dist = Math.sqrt(center.x * center.x + center.y * center.y);
                const angle = Math.atan2(center.y, center.x);
                const pct = (angle + Math.PI) / (Math.PI * 2);
                fill = `hsl(${(pct * 360 + dist * 0.5 - (this.time || 0) * 50) % 360}, 70%, 60%)`;
                stroke = 'rgba(255, 255, 255, 0.1)';
            } else {
                fill = theme.wall;
                stroke = theme.colorTheme === 'basic' ? 'rgba(134, 239, 172, 0.5)' : 'rgba(255, 255, 255, 0.1)';
            }
        } else if (k === MazeEngine.key(this.startNode)) {
            fill = theme.start;
            stroke = theme.colorTheme === 'basic' ? '#00AA00' : 'rgba(255,255,255,0.4)';
        } else if (k === MazeEngine.key(this.goalNode)) {
            fill = theme.goal;
            stroke = theme.colorTheme === 'basic' ? '#CC0000' : 'rgba(255,255,255,0.4)';
        } else if (this.pathSet.has(k)) {
            fill = theme.path;
        } else if (k === (this.currentNode ? MazeEngine.key(this.currentNode) : '')) {
            fill = theme.current;
            stroke = theme.current;
        } else if (this.frontierSet.has(k)) {
            fill = theme.frontier;
        } else if (this.exploredSet.has(k)) {
            fill = theme.explored;
        }

        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = Math.PI / 180 * (60 * i + 30);
            const px = center.x + drawSize * Math.cos(angle);
            const py = center.y + drawSize * Math.sin(angle);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();

        const isCurrent = k === (this.currentNode ? MazeEngine.key(this.currentNode) : '');

        ctx.fillStyle = fill;
        ctx.fill();

        if (isCurrent) {
            ctx.save();
            ctx.shadowColor = theme.current;
            ctx.shadowBlur = 14;
            ctx.fillStyle = theme.current;
            ctx.fill();
            ctx.strokeStyle = theme.current === '#FF0000' ? '#FFD700' : '#FFFFFF';
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.restore();
        } else {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    },

    draw() {
        if (!this.ctx || !this.canvas) return;
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;

        ctx.fillStyle = '#1e1e1e';
        ctx.fillRect(0, 0, width, height);

        ctx.save();
        ctx.translate(width / 2, height / 2);

        MazeEngine.forEachHex(this.gridRadius, (h) => this.drawHex(h.q, h.r));

        if (this.path.length > 1) {
            const theme = MazeEngine.themes[this.colorTheme] || MazeEngine.themes.basic;
            ctx.beginPath();
            ctx.strokeStyle = theme.current; 
            ctx.lineWidth = Math.max(2, this.hexSize * 0.28);
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';

            this.path.forEach((node, i) => {
                const p = MazeEngine.hexToPixel(node.q, node.r, this.hexSize);
                if (i === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
            });
            ctx.stroke();
        }

        ctx.restore();
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
            ? performance.now() - this.searchStartedAtMs
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
        ctx.fillText(`Hex Entered: ${enteredNow}`, 26, 78);
        ctx.fillText(`Last: ${this.lastEnteredHexCount}`, 26, 98);
        ctx.restore();
    },

    bindEvents() {
        if (this.eventsBound || !this.canvas) return;
        this.canvas.addEventListener('mousedown', this.handleMouseDown);
        window.addEventListener('mousemove', this.handleMouseMove);
        window.addEventListener('mouseup', this.handleMouseUp);
        this.eventsBound = true;
    },

    unbindEvents() {
        if (!this.eventsBound || !this.canvas) return;
        this.canvas.removeEventListener('mousedown', this.handleMouseDown);
        window.removeEventListener('mousemove', this.handleMouseMove);
        window.removeEventListener('mouseup', this.handleMouseUp);
        this.eventsBound = false;
    },

    resize() {
        if (!this.canvas || !this.canvas.parentElement) return;
        this.canvas.width = this.canvas.parentElement.clientWidth;
        this.canvas.height = this.canvas.parentElement.clientHeight;
        this.draw();
    },

    autoPlayOnReset: false,
    startPausedOnLoad: true,

    start() {
        this.bindEvents();
        if (this.searchPaused) {
            this.resumeSearch();
        } else {
            this.startSearchAnimation();
        }
    },

    stop() {
        if (this.searchInProgress) {
            this.pauseSearch();
        } else {
            this.stopSearchAnimation();
        }
    },

    reset() {
        this.generateMaze({ solve: false });
    },

    destroy() {
        this.stopSearchAnimation();
        this.unbindEvents();
        MazeEngine.destroyAudio();
    }
};
