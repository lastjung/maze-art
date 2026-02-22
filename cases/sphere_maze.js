/**
 * SphereMazeCase
 * A maze on a rotating sphere surface using Fibonacci distribution.
 */
const SphereMazeCase = {
    canvas: null,
    ctx: null,
    animationId: null,
    lastTimeMs: 0,
    
    // Grid/Topology State
    points: [],
    rotatedPoints: [],
    neighbors: [],
    openEdges: new Set(),
    
    // Search State
    startNodeIdx: null,
    goalNodeIdx: null,
    frontier: [],
    explored: new Set(),
    parentMap: new Map(),
    path: [],
    searchInProgress: false,
    searchPaused: false,
    found: false,
    currentIdx: null,
    
    // Internal Search Instance
    pq: null,
    frontierQueue: null,
    frontierStack: null,
    frontierHead: 0,
    costSoFar: null,
    searchStartedAtMs: 0,
    searchElapsedMs: 0,
    searchTimeout: null,
    lastEnteredNodeCount: 0,

    // Animation state
    rotX: 0,
    rotY: 0,
    rotationSpeed: 0.15,
    isCoreRunning: false,
    
    // Interaction state
    isDragging: false,
    lastMouseX: 0,
    lastMouseY: 0,

    // Path animation state
    pathProgress: 0,
    pathAnimTimer: null,
    
    // Config
    config: {
        numPoints: 300,
        theme: 'ocean',
        speed: 40,
        solutionSpeed: 70, // Default path reveal speed
        sfxEnabled: true,
        sfxVolume: 0.1,
        searchMode: 'astar'
    },

    init() {
        this.canvas = document.getElementById('mathCanvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');

        this.handleMouseDown = this.onMouseDown.bind(this);
        this.handleMouseMove = this.onMouseMove.bind(this);
        this.handleMouseUp = this.onMouseUp.bind(this);

        this.canvas.addEventListener('mousedown', this.handleMouseDown);
        window.addEventListener('mousemove', this.handleMouseMove);
        window.addEventListener('mouseup', this.handleMouseUp);

        this.resize();
        this.reset();
    },

    resize() {
        if (!this.canvas || !this.canvas.parentElement) return;
        const parent = this.canvas.parentElement;
        this.width = this.canvas.width = parent.clientWidth || 800;
        this.height = this.canvas.height = parent.clientHeight || 600;
        this.draw();
    },

    get uiConfig() {
        return [
            {
                type: 'select',
                id: 'sm_shape',
                label: 'Sphere Type',
                value: 'fibonacci',
                options: [{ value: 'fibonacci', label: 'Fibonacci (Even)' }],
                onChange: () => { this.reset(); }
            },
            {
                type: 'select',
                id: 'sm_algorithm',
                label: 'Pathfinding',
                value: this.config.searchMode,
                options: [
                    { value: 'astar', label: 'A*' },
                    { value: 'dijkstra', label: 'Dijkstra' },
                    { value: 'greedy', label: 'Greedy' },
                    { value: 'bfs', label: 'BFS' },
                    { value: 'dfs', label: 'DFS' }
                ],
                onChange: (v) => { this.config.searchMode = v; this.triggerSearch(); }
            },
            {
                type: 'select',
                id: 'sm_theme',
                label: 'Color Theme',
                options: [
                    { value: 'rainbow', label: '0. Default (Rainbow)' },
                    { value: 'basic', label: '1. Basic (Green/Pink)' },
                    { value: 'ocean', label: '2. Ocean (Cyan/Blue)' },
                    { value: 'sunset', label: '3. Sunset (Orange/Purple)' },
                    { value: 'neon', label: '4. Neon (Gray/Lime)' }
                ],
                value: this.config.theme,
                onChange: (v) => { this.config.theme = v; this.draw(); }
            },
            {
                type: 'slider',
                id: 'sm_speed',
                label: 'Search Speed',
                min: 1,
                max: 50,
                step: 1,
                value: this.config.speed,
                onChange: (v) => { this.config.speed = v; }
            },
            {
                type: 'slider',
                id: 'sm_sol_speed',
                label: 'Solution Speed',
                min: 1,
                max: 100,
                step: 1,
                value: this.config.solutionSpeed,
                onChange: (v) => { this.config.solutionSpeed = v; }
            },
            {
                type: 'slider',
                id: 'sm_sfx_volume',
                label: 'SFX Volume',
                min: 0,
                max: 0.3,
                step: 0.01,
                value: this.config.sfxVolume,
                onChange: (v) => { this.config.sfxVolume = v; }
            },
            {
                type: 'slider',
                id: 'sm_radius',
                label: 'Point Count',
                min: 50,
                max: 1000,
                step: 50,
                value: this.config.numPoints,
                live: false,
                onChange: (v) => { this.config.numPoints = v; this.reset(); }
            },
            { type: 'info', label: 'Start (Green)', value: 'Automatically Set' },
            { type: 'info', label: 'Goal (Red)', value: 'Automatically Set' },
            { type: 'info', label: 'Manual Rotation', value: 'Drag to Spin Sphere' },
            { type: 'info', label: 'Maze Control', value: 'Use top Reset Maze + Go' }
        ];
    },

    reset() {
        this.stopSearchAnimation();
        this.clearSearchState();
        
        this.generateTopology();
        this.generateMaze();
        
        // Pick start/goal as polar opposites roughly
        this.startNodeIdx = 0;
        this.goalNodeIdx = this.points.length - 1;
        
        this.draw();
    },

    generateTopology() {
        // Fibonacci Sphere points
        const n = this.config.numPoints;
        const pts = [];
        const ga = Math.PI * (3 - Math.sqrt(5));
        for (let i = 0; i < n; i++) {
            const y = 1 - (i / Math.max(1, n - 1)) * 2;
            const r = Math.sqrt(Math.max(0, 1 - y * y));
            const theta = ga * i;
            pts.push({
                x: Math.cos(theta) * r,
                y,
                z: Math.sin(theta) * r
            });
        }
        this.points = pts;

        // Build adjacency graph based on distance
        this.neighbors = Array.from({ length: n }, () => []);
        // Simple but expensive: check all pairs. Optimization possible but n=300-1000 is fine.
        // For each point, find 5-7 nearest neighbors to form a graph
        for (let i = 0; i < n; i++) {
            const dists = [];
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                const d = (pts[i].x - pts[j].x)**2 + (pts[i].y - pts[j].y)**2 + (pts[i].z - pts[j].z)**2;
                dists.push({ idx: j, d });
            }
            dists.sort((a, b) => a.d - b.d);
            // Connect to top 6 nearest neighbors
            for (let k = 0; k < 6; k++) {
                const neighborIdx = dists[k].idx;
                if (!this.neighbors[i].includes(neighborIdx)) this.neighbors[i].push(neighborIdx);
                if (!this.neighbors[neighborIdx].includes(i)) this.neighbors[neighborIdx].push(i);
            }
        }
    },

    generateMaze() {
        this.openEdges = new Set();
        const visited = new Set();
        const stack = [0];
        visited.add(0);

        while (stack.length > 0) {
            const current = stack[stack.length - 1];
            const unvisitedNeighbors = this.neighbors[current].filter(n => !visited.has(n));

            if (unvisitedNeighbors.length > 0) {
                const next = unvisitedNeighbors[Math.floor(Math.random() * unvisitedNeighbors.length)];
                visited.add(next);
                const edgeKey = current < next ? `${current}-${next}` : `${next}-${current}`;
                this.openEdges.add(edgeKey);
                stack.push(next);
            } else {
                stack.pop();
            }
        }
    },

    clearSearchState() {
        this.frontier = [];
        this.explored.clear();
        this.parentMap.clear();
        this.path = [];
        this.pathProgress = 0;
        if (this.pathAnimTimer) clearTimeout(this.pathAnimTimer);
        this.found = false;
        this.searchInProgress = false;
        this.searchPaused = false;
        this.currentIdx = null;
        this.pq = null;
        this.frontierQueue = null;
        this.frontierStack = null;
        this.frontierHead = 0;
        this.costSoFar = null;
        this.searchStartedAtMs = 0;
        this.searchElapsedMs = 0;
        this.lastEnteredNodeCount = 0;
        if (this.searchTimeout) clearTimeout(this.searchTimeout);

        if (typeof Core !== 'undefined') {
            Core.syncPlayButton();
            Core.updateControls();
        }
    },

    triggerSearch() {
        if (this.isCoreRunning) {
            this.startSearchAnimation();
        } else {
            this.clearSearchState();
            this.draw();
        }
    },

    startSearchAnimation() {
        if (this.searchInProgress && !this.searchPaused) return;

        if (this.searchPaused) {
            this.resumeSearch();
            return;
        }

        this.clearSearchState();
        this.searchInProgress = true;
        this.searchStartedAtMs = performance.now();

        const start = this.startNodeIdx;
        this.costSoFar = new Map();
        this.costSoFar.set(start, 0);
        this.parentMap.set(start, null);
        this.frontier = [start];
        this.frontierHead = 0;

        if (this.config.searchMode === 'bfs') {
            this.frontierQueue = [start];
            this.frontierStack = null;
            this.pq = null;
        } else if (this.config.searchMode === 'dfs') {
            this.frontierStack = [start];
            this.frontierQueue = null;
            this.pq = null;
        } else {
            this.pq = new PriorityQueue();
            this.pq.put(start, 0);
            this.frontierQueue = null;
            this.frontierStack = null;
        }

        if (typeof Core !== 'undefined') Core.syncPlayButton();
        this.searchStep();
    },

    hasFrontier() {
        if (this.config.searchMode === 'bfs') return this.frontierHead < this.frontierQueue.length;
        if (this.config.searchMode === 'dfs') return this.frontierStack.length > 0;
        return this.pq && !this.pq.empty();
    },

    popFrontier() {
        if (this.config.searchMode === 'bfs') return this.frontierQueue[this.frontierHead++];
        if (this.config.searchMode === 'dfs') return this.frontierStack.pop();
        return this.pq.get();
    },

    pushFrontier(next, priority = 0) {
        if (this.config.searchMode === 'bfs') this.frontierQueue.push(next);
        else if (this.config.searchMode === 'dfs') this.frontierStack.push(next);
        else this.pq.put(next, priority);
    },

    searchStep() {
        if (!this.searchInProgress || this.searchPaused || !this.hasFrontier()) {
            if (!this.found && !this.searchPaused && this.searchInProgress) {
                this.searchInProgress = false;
                this.searchElapsedMs += performance.now() - this.searchStartedAtMs;
                this.searchStartedAtMs = 0;
                MazeEngine.playResultSound(false, this.config);
                if (typeof Core !== 'undefined') Core.syncPlayButton();
            }
            return;
        }

        const current = this.popFrontier();
        const goal = this.goalNodeIdx;
        this.currentIdx = current;
        this.explored.add(current);
        const frontierIdx = this.frontier.indexOf(current);
        if (frontierIdx !== -1) this.frontier.splice(frontierIdx, 1);

        if (current === goal) {
            this.found = true;
            this.searchInProgress = false;
            this.searchElapsedMs += performance.now() - this.searchStartedAtMs;
            this.searchStartedAtMs = 0;
            this.lastEnteredNodeCount = this.explored.size;
            this.reconstructPath(goal);
            this.startPathAnimation(); // New: Progressive reveal
            MazeEngine.playResultSound(true, this.config);
            if (typeof Core !== 'undefined') {
                Core.syncPlayButton();
                Core.updateControls();
            }
            return;
        }

        // Sound
        const dist = Math.sqrt((this.points[current].x - this.points[goal].x)**2 + (this.points[current].y - this.points[goal].y)**2 + (this.points[current].z - this.points[goal].z)**2);
        const freq = 300 + (1 - dist / 2) * 700;
        MazeEngine.playTone(freq, 0.05, 'sine', 0.1, 0.003, this.config);

        const neighbors = this.neighbors[current].filter(n => {
            const edgeKey = current < n ? `${current}-${n}` : `${n}-${current}`;
            return this.openEdges.has(edgeKey);
        });

        for (const next of neighbors) {
            const newCost = this.costSoFar.get(current) + 1;
            if (this.config.searchMode === 'bfs' || this.config.searchMode === 'dfs') {
                if (this.parentMap.has(next)) continue;
                this.costSoFar.set(next, newCost);
                this.parentMap.set(next, current);
                this.pushFrontier(next);
                if (!this.frontier.includes(next)) this.frontier.push(next);
                continue;
            }

            if (!this.costSoFar.has(next) || newCost < this.costSoFar.get(next)) {
                this.costSoFar.set(next, newCost);
                
                let priority = newCost;
                if (this.config.searchMode === 'astar') {
                    priority += Math.sqrt((this.points[next].x - this.points[goal].x)**2 + (this.points[next].y - this.points[goal].y)**2 + (this.points[next].z - this.points[goal].z)**2);
                } else if (this.config.searchMode === 'greedy') {
                    priority = Math.sqrt((this.points[next].x - this.points[goal].x)**2 + (this.points[next].y - this.points[goal].y)**2 + (this.points[next].z - this.points[goal].z)**2);
                }
                
                this.pushFrontier(next, priority);
                this.parentMap.set(next, current);
                if (!this.frontier.includes(next)) this.frontier.push(next);
            }
        }

        this.searchTimeout = setTimeout(() => this.searchStep(), MazeEngine.speedToDelay(this.config.speed));
    },

    pauseSearch() {
        if (!this.searchInProgress) return;
        this.searchPaused = true;
        this.searchElapsedMs += performance.now() - this.searchStartedAtMs;
        this.searchStartedAtMs = 0;
        if (this.searchTimeout) clearTimeout(this.searchTimeout);
        if (typeof Core !== 'undefined') Core.syncPlayButton();
    },

    resumeSearch() {
        if (!this.searchInProgress || !this.searchPaused) return;
        this.searchPaused = false;
        this.searchStartedAtMs = performance.now();
        if (typeof Core !== 'undefined') Core.syncPlayButton();
        this.searchStep();
    },

    stopSearchAnimation() {
        this.searchInProgress = false;
        this.searchPaused = false;
        if (this.searchTimeout) clearTimeout(this.searchTimeout);
        if (typeof Core !== 'undefined') Core.syncPlayButton();
    },

    reconstructPath(goal) {
        this.path = [];
        let curr = goal;
        while (curr !== null) {
            this.path.push(curr);
            curr = this.parentMap.get(curr);
        }
        this.path.reverse();
    },

    startPathAnimation() {
        this.pathProgress = 0;
        if (this.pathAnimTimer) clearTimeout(this.pathAnimTimer);
        this.animatePath();
    },

    animatePath() {
        if (!this.found || this.searchPaused) return;

        if (this.pathProgress < this.path.length) {
            // Faster speed mapping: use power to make high speeds much faster
            const step = Math.ceil(Math.pow(this.config.solutionSpeed / 25, 2));
            this.pathProgress = Math.min(this.path.length, this.pathProgress + step);
            
            const delay = Math.max(1, 150 - this.config.solutionSpeed * 1.4);
            this.pathAnimTimer = setTimeout(() => this.animatePath(), delay);
            this.draw();
        } else {
            // Play "Ding" sound when finished
            MazeEngine.playSolutionFinishSound(this.config);
        }
    },

    onMouseDown(e) {
        this.isDragging = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
    },

    onMouseMove(e) {
        if (!this.isDragging) return;
        const dx = e.clientX - this.lastMouseX;
        const dy = e.clientY - this.lastMouseY;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;

        // Sensible rotation speed mapping
        this.rotY += dx * 0.005;
        this.rotX += dy * 0.005;
        this.draw();
    },

    onMouseUp() {
        this.isDragging = false;
    },

    rotatePoint(p, rx, ry) {
        // Simple rotation around Y and X axis
        // Around Y
        let x = p.x * Math.cos(ry) + p.z * Math.sin(ry);
        let z = -p.x * Math.sin(ry) + p.z * Math.cos(ry);
        let y = p.y;
        
        // Around X
        let yFinal = y * Math.cos(rx) - z * Math.sin(rx);
        let zFinal = y * Math.sin(rx) + z * Math.cos(rx);
        
        return { x, y: yFinal, z: zFinal };
    },

    draw() {
        if (!this.ctx || !this.points || this.points.length === 0) return;
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;
        const cx = width / 2;
        const cy = height / 2;
        const r = Math.min(width, height) * 0.4;
        const theme = MazeEngine.themes[this.config.theme] || MazeEngine.themes.ocean;

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#1e1e1e';
        ctx.fillRect(0, 0, width, height);

        // Draw Sphere shadow/glow
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, 'rgba(255,255,255,0.05)');
        grad.addColorStop(1, 'rgba(0,0,0,0.2)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();

        // Project points
        const projected = this.points.map((p, i) => {
            const rot = this.rotatePoint(p, this.rotX, this.rotY);
            return {
                idx: i,
                x: cx + rot.x * r,
                y: cy + rot.y * r,
                z: rot.z, // depth for occlusion
                rot
            };
        });

        // Sort items by depth for simple painter's algorithm
        // We'll draw back edges first, then front edges
        
        // 1. Draw Edges (Layered)
        ctx.lineCap = 'round';
        
        // Layer 1: All Edges (Walls and Unvisited Open Paths)
        for (let i = 0; i < this.points.length; i++) {
            const p1 = projected[i];
            this.neighbors[i].forEach(nIdx => {
                if (i > nIdx) return;
                const edgeKey = i < nIdx ? `${i}-${nIdx}` : `${nIdx}-${i}`;
                const isOpen = this.openEdges.has(edgeKey);
                const p2 = projected[nIdx];
                const avgZ = (p1.z + p2.z) / 2;
                if (avgZ < -0.4) return; // Occlusion

                ctx.beginPath();
                // Front-facing lines are much brighter
                const alpha = Math.max(0.1, (avgZ + 0.5));
                ctx.globalAlpha = alpha;

                if (isOpen) {
                    // Unvisited Open Path - Subtle and thinner to reduce noise during rotation
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
                    ctx.lineWidth = 1.0;
                } else {
                    // Wall
                    ctx.strokeStyle = theme.wall;
                    ctx.lineWidth = 0.8;
                    ctx.globalAlpha = alpha * 0.2; // Walls are very subtle
                }

                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.stroke();
            });
        }

        // Layer 2: Search Tree (Explored Edges from parentMap)
        ctx.globalAlpha = 1.0;
        this.parentMap.forEach((parentIdx, childIdx) => {
            if (parentIdx === null) return;
            const p1 = projected[childIdx];
            const p2 = projected[parentIdx];
            const avgZ = (p1.z + p2.z) / 2;
            if (avgZ < -0.2) return; // Occlusion

            ctx.beginPath();
            ctx.strokeStyle = theme.explored;
            ctx.lineWidth = 1.5;
            // Depth-based opacity for search tree
            ctx.globalAlpha = Math.min(1.0, avgZ + 0.8);
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
        });

        // Layer 3: Final Path (if found)
        if (this.path.length > 1 && this.pathProgress > 0) {
            ctx.globalAlpha = 1.0;
            ctx.beginPath();
            ctx.strokeStyle = theme.current; // Solid Red (#FF0000)
            ctx.lineWidth = 2.5;
            let move = true;
            for (let i = 0; i < this.pathProgress; i++) {
                const idx = this.path[i];
                const p = projected[idx];
                if (p.z < -0.2) { move = true; continue; }
                if (move) { ctx.moveTo(p.x, p.y); move = false; }
                else ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
        }

        // 2. Draw Nodes (Front only)
        ctx.globalAlpha = 1.0;
        projected.forEach(p => {
            if (p.z < -0.1) return;
            
            let fill = null;
            const pathIdx = this.path.indexOf(p.idx);
            if (pathIdx !== -1 && pathIdx < this.pathProgress) fill = theme.path;
            else if (p.idx === this.currentIdx) fill = theme.current;
            else if (this.explored.has(p.idx)) fill = theme.explored;
            else if (this.frontier.includes(p.idx)) fill = theme.frontier;

            if (fill) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, r * 0.012, 0, Math.PI * 2);
                ctx.fillStyle = fill;
                ctx.fill();
            }
        });

        // Draw Start/Goal Indicators
        [this.startNodeIdx, this.goalNodeIdx].forEach(idx => {
            const p = projected[idx];
            if (p.z < -0.1) return;
            
            ctx.beginPath();
            ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = idx === this.startNodeIdx ? theme.start : theme.goal;
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
        });

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
        const liveMs = this.searchInProgress && this.searchStartedAtMs > 0
            ? performance.now() - this.searchStartedAtMs + this.searchElapsedMs
            : this.searchElapsedMs;
        
        ctx.save();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '600 13px Inter, sans-serif';
        ctx.fillText(`Algorithm: ${this.config.searchMode.toUpperCase()}`, 20, 30);
        ctx.font = '500 12px Inter, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.fillText(`Time: ${this.formatMs(liveMs)}`, 20, 50);
        ctx.fillText(`Nodes Visited: ${this.explored.size}`, 20, 70);
        ctx.fillText(`Last: ${this.lastEnteredNodeCount}`, 20, 90);
        ctx.restore();
    },

    start() {
        this.isCoreRunning = true;
        if (this.found) this.reset();
        
        if (this.searchPaused) this.resumeSearch();
        else this.startSearchAnimation();
        
        if (!this.animationId) {
            this.lastTimeMs = performance.now();
            const loop = (now) => {
                const dt = Math.min(0.05, (now - this.lastTimeMs) / 1000);
                this.lastTimeMs = now;
                
                // Slowly rotate if NOT dragging
                if (!this.isDragging) {
                    this.rotY += this.rotationSpeed * dt;
                    this.rotX += this.rotationSpeed * dt * 0.4;
                }
                
                this.draw();
                this.animationId = requestAnimationFrame(loop);
            };
            this.animationId = requestAnimationFrame(loop);
        }
    },

    stop() {
        this.isCoreRunning = false;
        if (this.searchInProgress) this.pauseSearch();
        else this.stopSearchAnimation();
        
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    },

    startPausedOnLoad: true,
    autoPlayOnReset: false,

    destroy() {
        this.stop();
        this.canvas.removeEventListener('mousedown', this.handleMouseDown);
        window.removeEventListener('mousemove', this.handleMouseMove);
        window.removeEventListener('mouseup', this.handleMouseUp);
        if (this.pathAnimTimer) clearTimeout(this.pathAnimTimer);
    }
};

window.SphereMazeCase = SphereMazeCase;
