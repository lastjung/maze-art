/**
 * FibonacciMazeCase
 * A standalone hex maze based on the Golden Angle (Phyllotaxis).
 * Uses the shared MazeEngine for pathfinding and hex math.
 */

const FibonacciMazeCase = {
    canvas: null,
    ctx: null,

    // Config
    hexSize: 6,
    gridRadius: 35,
    seedCount: 1870,
    spreadScale: 1.2,
    goldenAngleSteps: 1, 
    solveAnimation: true,
    
    // Animation Config
    spinSpeed: 0.5, // radians per second
    growthSpeed: 800, // seeds per second

    searchMode: 'dijkstra',
    searchDelayMs: 20, // corresponding to speed 40 -> 100 - 40*2 = 20
    sfxEnabled: true,
    sfxVolume: 0.1,

    // Graph State
    startNode: { q: 0, r: 0 },
    goalNode: { q: 0, r: 0 },
    walls: new Set(),

    // Search Visualization State
    cameFrom: {},
    costSoFar: {},
    path: [],
    pathSet: new Set(),
    globalPath: [],        // For multi-waypoint
    globalPathSet: new Set(),
    waypoints: [],         // Sequence of nodes to visit
    currentWaypointIndex: 1,
    frontierSet: new Set(),
    exploredSet: new Set(),
    globalExploredSet: new Set(),
    currentNode: null,

    frontierPQ: null,
    frontierQueue: null,
    frontierStack: null,
    frontierHead: 0,

    searchTimer: null,
    searchInProgress: false,
    searchPaused: false,
    colorTheme: 'rainbow',

    searchStartedAtMs: 0,
    searchElapsedMs: 0,
    totalSearchCount: 0,
    totalFindCount: 0,
    lastSearchMs: 0,
    lastEnteredHexCount: 0,
    stepSoundTick: 0,
    lastStepSoundAt: 0,

    // Interaction
    isDraggingStart: false,
    isDraggingGoal: false,
    isDrawingWall: false,
    isErasingWall: false,
    eventsBound: false,
    
    // Animation State
    animationId: null,
    lastTime: 0,
    growth: 0,
    spinAngle: 0,
    gridAlpha: 0,
    wallOrder: new Map(),

    init() {
        this.canvas = document.getElementById('mathCanvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');

        this.handleMouseDown = this.onMouseDown.bind(this);
        this.handleMouseMove = this.onMouseMove.bind(this);
        this.handleMouseUp = this.onMouseUp.bind(this);

        this.resize();
        this.bindEvents();
        this.generateMaze({ solve: false });

        // Ensure the visual loop runs immediately on load, even if A* is paused
        if (!this.animationId) {
            this.lastTime = performance.now();
            this.animationId = requestAnimationFrame((t) => this.loop(t));
        }
    },

    get uiConfig() {
        return [
            // --- Standard Maze Controls ---
            {
                type: 'select',
                id: 'fib_algorithm',
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
                id: 'fib_theme',
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
                id: 'fib_speed',
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
                id: 'fib_sfx_volume',
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
                id: 'fib_hex_size',
                label: 'Hex Size',
                min: 4,
                max: 28,
                step: 1,
                value: this.hexSize,
                onChange: (v) => {
                    this.hexSize = v;
                    this.generateMaze({ solve: false }); // Rebuild based on new size
                }
            },
            {
                type: 'slider',
                id: 'fib_radius',
                label: 'Grid Radius',
                min: 10,
                max: 60,
                step: 1,
                value: this.gridRadius,
                onChange: (v) => {
                    this.gridRadius = v;
                    this.generateMaze({ solve: false });
                }
            },
            // --- Specific to Fibonacci ---
            {
                type: 'slider',
                id: 'fib_seed_count',
                label: 'Seed Count',
                min: 50,
                max: 2000,
                step: 10,
                value: this.seedCount,
                onChange: (v) => {
                    this.seedCount = v;
                    this.generateMaze({ solve: this.isCoreRunning() });
                }
            },
            {
                type: 'slider',
                id: 'fib_spread',
                label: 'Seed Spread',
                min: 0.5,
                max: 3.0,
                step: 0.1,
                value: this.spreadScale,
                onChange: (v) => {
                    this.spreadScale = v;
                    this.generateMaze({ solve: false });
                }
            },
            {
                type: 'slider',
                id: 'fib_spin',
                label: 'Rotation Speed',
                min: 0,
                max: 1.0,
                step: 0.05,
                value: this.spinSpeed,
                onChange: (v) => {
                    this.spinSpeed = v;
                }
            },
            // --- Helper Info ---
            { type: 'info', label: 'Start (Green)', value: 'Drag to Move' },
            { type: 'info', label: 'Goal (Red)', value: 'Drag to Move' },
            { type: 'info', label: 'Walls (Rainbow)', value: 'Drag to Edit' },
            { type: 'info', label: 'Maze Control', value: 'Use top Reset Maze + Go' }
        ];
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
        this.globalPath = []; // Array of path segments (Array of Arrays)
        this.globalPathSet = new Set();
        this.globalExploredSet = new Set();
        this.currentWaypointIndex = 1;
        this.frontierSet.clear();
        this.exploredSet.clear();
        this.globalExploredSet.clear();
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
        if (!MazeEngine.isWalkable(this.startNode, this.gridRadius, this.walls)) {
            this.startNode = MazeEngine.findNearestWalkable(this.startNode, this.gridRadius, this.walls) || { q: 0, r: 0 };
        }
        if (!MazeEngine.isWalkable(this.goalNode, this.gridRadius, this.walls)) {
            this.goalNode = MazeEngine.findNearestWalkable(this.goalNode, this.gridRadius, this.walls) || this.startNode;
        }
    },

    // ------------------------------------------------------------------
    // Core Pathfinding Callbacks directly mirroring HexMazeCase
    // ------------------------------------------------------------------
    initializeSearch() {
        this.normalizeEndpoints();
        
        // If starting fresh (index 1), clear everything
        if (this.currentWaypointIndex === 1) {
            this.clearSearchState();
            this.totalSearchCount += 1;
            this.searchStartedAtMs = performance.now();
        } else {
            // If continuing to next waypoint, only clear segment states
            this.cameFrom = {};
            this.costSoFar = {};
            this.path = [];
            this.pathSet.clear();
            this.frontierSet.clear();
            this.exploredSet.clear();
            this.currentNode = null;
        }

        // Set current segment start and goal
        this.startNode = this.waypoints[this.currentWaypointIndex - 1];
        this.goalNode = this.waypoints[this.currentWaypointIndex];

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
        
        if (found) {
            this.reconstructPath();
            
            // Append segment to global path
            if (this.path.length > 0) {
                this.globalPath.push([...this.path]);
                this.path.forEach(node => {
                    this.globalPathSet.add(MazeEngine.key(node));
                });
            }
            
            // Retain previously explored nodes across multi-waypoint segments visually
            this.exploredSet.forEach(k => this.globalExploredSet.add(k));

            this.currentWaypointIndex++;
            if (this.currentWaypointIndex < this.waypoints.length) {
                // Instantly start the next leg of the journey
                this.initializeSearch();
                this.searchTimer = setTimeout(() => this.stepSearch(), this.searchDelayMs);
                return;
            }
            
            // We reached the absolute final goal
            if (this.searchStartedAtMs > 0) {
                this.searchElapsedMs = performance.now() - this.searchStartedAtMs;
                this.lastSearchMs = this.searchElapsedMs;
                this.searchStartedAtMs = 0;
            }
            this.totalFindCount += 1;
            MazeEngine.playResultSound(true, this);
        } else {
            // Failed to find path to current waypoint
            this.exploredSet.forEach(k => this.globalExploredSet.add(k));
            
            if (this.searchStartedAtMs > 0) {
                this.searchElapsedMs = performance.now() - this.searchStartedAtMs;
                this.lastSearchMs = this.searchElapsedMs;
                this.searchStartedAtMs = 0;
            }
            MazeEngine.playResultSound(false, this);
        }

        this.lastEnteredHexCount = this.exploredSet.size;
        this.currentNode = null;
        this.draw();

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
            if (this.exploredSet.has(currentKey)) continue;

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
            if (this.growth >= this.seedCount && this.gridAlpha >= 1.0) {
                this.startSearchAnimation();
            } else {
                this.normalizeEndpoints();
                this.clearSearchState();
            }
        } else {
            this.normalizeEndpoints();
            this.clearSearchState();
            this.draw();
        }
    },

    // ------------------------------------------------------------------
    // Maze Generation (The Core Difference)
    // ------------------------------------------------------------------
    generateMaze({ solve = false } = {}) {
        this.stopSearchAnimation();
        this.walls.clear();
        this.wallOrder.clear();
        this.gridAlpha = 0;
        this.growth = 0;

        const goldenAngle = Math.PI * (3 - Math.sqrt(5));
        let index = 1;

        for (let n = 1; n <= this.seedCount; n++) {
            const theta = n * goldenAngle;
            const r = this.spreadScale * this.hexSize * Math.sqrt(n);
            const x = r * Math.cos(theta);
            const y = r * Math.sin(theta);

            const hex = MazeEngine.pixelToHex(x, y, this.hexSize);
            const k = MazeEngine.key(hex);

            if (MazeEngine.isInside(hex, this.gridRadius)) {
                this.walls.add(k);
            }
            // Store every generated seed's mathematical index regardless of bounds or overlaps.
            // This guarantees the animation loop can count up to this.seedCount seamlessly.
            if (!this.wallOrder.has(k)) {
                this.wallOrder.set(k, n); // Use 'n' (1 to seedCount) as the direct index
            }
        }

        // --- Waypoint Generation (Star Pattern) ---
        // Instead of a single start/goal, we create a zigzag puzzle
        const radius = Math.floor(this.gridRadius * 0.95);
        this.waypoints = [
            { q: 0, r: 0 }, // Start at center
            MazeEngine.pixelToHex(0, -radius * this.hexSize, this.hexSize), // Top
            MazeEngine.pixelToHex(radius * this.hexSize * 0.866, radius * this.hexSize * 0.5, this.hexSize), // Bottom Right
            MazeEngine.pixelToHex(-radius * this.hexSize * 0.866, radius * this.hexSize * 0.5, this.hexSize), // Bottom Left
            MazeEngine.pixelToHex(0, radius * this.hexSize, this.hexSize) // Bottom tip (Final Goal)
        ];

        // Ensure all absolute waypoints are physically free of walls
        this.waypoints.forEach(wp => {
            const wk = MazeEngine.key(wp);
            this.walls.delete(wk);
            this.wallOrder.delete(wk);
        });

        // Initialize display nodes for the UI
        this.startNode = this.waypoints[0];
        this.goalNode = this.waypoints[this.waypoints.length - 1];

        // Guaranteed solvability: Carve an organic path connecting ALL waypoints sequentially
        const carvePath = (fromNode, toNode) => {
            const cameFrom = {};
            const costSoFar = {};
            const pq = new PriorityQueue();
            pq.put(fromNode, 0);
            
            const fromKey = MazeEngine.key(fromNode);
            cameFrom[fromKey] = null;
            costSoFar[fromKey] = 0;

            let carverFound = false;
            while (!pq.empty()) {
                const curr = pq.get();
                if (curr.q === toNode.q && curr.r === toNode.r) {
                    carverFound = true;
                    break;
                }
                const curKey = MazeEngine.key(curr);
                
                const neighbors = MazeEngine.getNeighborsIgnoringWalls(curr, this.gridRadius);
                for (const next of neighbors) {
                    const nextKey = MazeEngine.key(next);
                    const stepCost = this.walls.has(nextKey) ? 60 : 1; 
                    const newCost = costSoFar[curKey] + stepCost;

                    if (!(nextKey in costSoFar) || newCost < costSoFar[nextKey]) {
                        costSoFar[nextKey] = newCost;
                        cameFrom[nextKey] = curr;
                        pq.put(next, newCost + MazeEngine.heuristic(toNode, next));
                    }
                }
            }

            if (carverFound) {
                let curr = toNode;
                while (curr) {
                    const k = MazeEngine.key(curr);
                    if (this.walls.has(k)) {
                        this.walls.delete(k);
                        this.wallOrder.delete(k); // Erase from animation queue
                    }
                    curr = cameFrom[k];
                }
            }
        };

        // Carve segments sequentially
        for (let i = 0; i < this.waypoints.length - 1; i++) {
            carvePath(this.waypoints[i], this.waypoints[i+1]);
        }
        this.normalizeEndpoints();

        if (solve) {
            this.growth = this.seedCount + 1; // Complete instantly if solving directly
            this.gridAlpha = 1;
            this.startSearchAnimation();
        } else {
            this.clearSearchState();
        }
    },

    // ------------------------------------------------------------------
    // Interaction Events
    // ------------------------------------------------------------------
    getHexFromEvent(e) {
        const rect = this.canvas.getBoundingClientRect();
        
        // Offset relative to center point where we translate
        let cx = e.clientX - rect.left - this.canvas.width / 2;
        let cy = e.clientY - rect.top - this.canvas.height / 2;

        // Apply inverse rotation
        const cosTheta = Math.cos(-this.spinAngle);
        const sinTheta = Math.sin(-this.spinAngle);
        const rx = cx * cosTheta - cy * sinTheta;
        const ry = cx * sinTheta + cy * cosTheta;

        return MazeEngine.pixelToHex(rx, ry, this.hexSize);
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

    // ------------------------------------------------------------------
    // Core Lifecycle Events
    // ------------------------------------------------------------------
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
        if (!this.animationId) this.draw();
    },

    autoPlayOnReset: false,
    startPausedOnLoad: true,

    loop(time) {
        if (!this.lastTime) this.lastTime = time;
        const dt = (time - this.lastTime) / 1000;
        this.lastTime = time;
        this.time = time / 1000;

        // 1. Visual animation always proceeds independently of search/play state,
        // UNLESS the pathfinding has fully completed (game over hold state)
        if (!(this.searchElapsedMs > 0 && this.searchStartedAtMs === 0 && this.currentWaypointIndex >= this.waypoints.length)) {
            this.spinAngle += this.spinSpeed * dt;
        }
        
        const maxIndex = this.seedCount;
        if (this.growth < maxIndex) {
            // Speed up the growth animation slightly based on seed count so huge numbers don't take forever
            const dynamicSpeed = Math.max(this.growthSpeed, this.seedCount * 0.4); 
            this.growth += dynamicSpeed * dt;
        } else if (this.gridAlpha < 1.0) {
            this.growth = maxIndex; // Clamp accurately
            this.gridAlpha = Math.min(1.0, this.gridAlpha + dt * 1.5);
        }

        // 2. If user pressed "Go" (isCoreRunning = true) but we were still animating,
        // auto-start the pathfinding solver as soon as the grid fully fades in.
        if (this.growth >= maxIndex && this.gridAlpha >= 1.0) {
            // Only auto-trigger if we haven't started a search yet at all
            if (this.isCoreRunning() && !this.searchInProgress && this.path.length === 0 && !this.searchPaused && Object.keys(this.cameFrom).length === 0) {
                this.startSearchAnimation();
            }
        }

        this.draw();
        this.animationId = requestAnimationFrame((t) => this.loop(t));
    },

    start() {
        this.bindEvents();
        if (this.searchPaused) {
            this.resumeSearch();
        } else if (this.growth >= this.seedCount && this.gridAlpha >= 1.0) {
            // Force a restart if Go is clicked again after finishing
            this.clearSearchState();
            this.startSearchAnimation();
        }
        
        if (!this.animationId) {
            this.lastTime = performance.now();
            this.animationId = requestAnimationFrame((t) => this.loop(t));
        }
    },

    stop() {
        if (this.searchInProgress) {
            this.pauseSearch();
        } else {
            this.stopSearchAnimation();
        }
        
        // Deep Sleep Mode Check: If the entire engine is idle, we completely stop burning CPU
        if (typeof Core !== 'undefined' && Core.isIdle) {
            if (this.animationId) {
                cancelAnimationFrame(this.animationId);
                this.animationId = null;
            }
        }
    },

    reset() {
        this.generateMaze({ solve: false });
    },

    destroy() {
        this.stop();
        this.unbindEvents();
        MazeEngine.destroyAudio();

        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    },

    // ------------------------------------------------------------------
    // Drawing
    // ------------------------------------------------------------------
    drawHex(q, r) {
        const k = MazeEngine.key({ q, r });
        const center = MazeEngine.hexToPixel(q, r, this.hexSize);
        
        const isWall = this.walls.has(k);
        const wallIndex = isWall ? this.wallOrder.get(k) : Infinity;

        // During generating animation, walls don't exist visually until growth reaches them
        if (isWall && wallIndex > this.growth) return;

        // Don't draw regular hex map until walls are fully formed, and then fade it in
        if (!isWall && this.gridAlpha <= 0) return;

        const drawSize = isWall ? this.hexSize * 0.85 : this.hexSize * 0.92;
        const ctx = this.ctx;

        let fill = 'rgba(240, 248, 255, 0.16)';
        let stroke = 'rgba(255, 255, 255, 0.22)';
        
        const theme = MazeEngine.themes[this.colorTheme] || MazeEngine.themes.rainbow;

        if (isWall) {
            if (this.colorTheme === 'rainbow') {
                const pct = wallIndex / this.seedCount;
                fill = `hsl(${(pct * 360 + (this.time || 0) * 50) % 360}, 70%, 60%)`;
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
        } else if (this.waypoints.some(wp => MazeEngine.key(wp) === k)) {
            fill = '#FFFF00'; // Intermediate waypoints are yellow
            stroke = 'rgba(255,255,255,0.8)';
        } else if (this.globalPathSet.has(k) || this.pathSet.has(k)) {
            fill = theme.path;
        } else if (k === (this.currentNode ? MazeEngine.key(this.currentNode) : '')) {
            fill = theme.current;
            stroke = theme.current;
        } else if (this.frontierSet.has(k)) {
            if (this.colorTheme === 'rainbow') {
                fill = 'rgba(255, 255, 255, 0.5)';
            } else {
                fill = theme.frontier;
            }
        } else if (this.exploredSet.has(k) || this.globalExploredSet.has(k)) {
            if (this.colorTheme === 'rainbow') {
                // Calculate color based on polar angle to match the spiral aesthetic
                const angle = Math.atan2(center.y, center.x);
                const pct = (angle + Math.PI) / (Math.PI * 2);
                fill = `hsla(${(pct * 360 + (this.time || 0) * 50) % 360}, 80%, 60%, 0.45)`;
            } else {
                fill = theme.explored;
            }
        }

        ctx.beginPath();
        if (isWall) {
            ctx.arc(center.x, center.y, drawSize, 0, Math.PI * 2);
        } else {
            for (let i = 0; i < 6; i++) {
                const angle = Math.PI / 180 * (60 * i + 30);
                const px = center.x + drawSize * Math.cos(angle);
                const py = center.y + drawSize * Math.sin(angle);
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.closePath();
        }

        const isCurrent = k === (this.currentNode ? MazeEngine.key(this.currentNode) : '');

        ctx.save();
        if (!isWall) {
            ctx.globalAlpha = this.gridAlpha;
        }

        ctx.fillStyle = fill;
        ctx.fill();

        if (isCurrent) {
            ctx.shadowColor = theme.current;
            ctx.shadowBlur = 14;
            ctx.fillStyle = theme.current;
            ctx.fill();
            ctx.strokeStyle = theme.current === '#FF0000' ? '#FFD700' : '#FFFFFF';
            ctx.lineWidth = 3;
            ctx.stroke();
        } else if (!isWall && this.gridAlpha > 0) {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 1;
            ctx.stroke();
        } else if (isWall) {
             ctx.strokeStyle = stroke;
             ctx.lineWidth = 1;
             ctx.stroke();
        }
        
        ctx.restore();
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
        
        ctx.rotate(this.spinAngle);

        MazeEngine.forEachHex(this.gridRadius, (h) => this.drawHex(h.q, h.r));

        if (this.globalPath.length > 1 || this.path.length > 1) {
            const theme = MazeEngine.themes[this.colorTheme] || MazeEngine.themes.ocean;
            ctx.beginPath();
            ctx.strokeStyle = theme.current; 
            ctx.lineWidth = Math.max(2, this.hexSize * 0.28);
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';

            // Draw completed global path segments
            this.globalPath.forEach(segment => {
                segment.forEach((node, i) => {
                    const p = MazeEngine.hexToPixel(node.q, node.r, this.hexSize);
                    if (i === 0) ctx.moveTo(p.x, p.y);
                    else ctx.lineTo(p.x, p.y);
                });
            });
            
            // Continue drawing the active segment path directly from its own start
            if (this.path.length > 0) {
                this.path.forEach((node, i) => {
                    const p = MazeEngine.hexToPixel(node.q, node.r, this.hexSize);
                    if (i === 0) ctx.moveTo(p.x, p.y);
                    else ctx.lineTo(p.x, p.y);
                });
            }

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
    }
};
