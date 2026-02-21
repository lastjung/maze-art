/**
 * PolygonMazeCase
 * Maze generation and pathfinding on a Voronoi-based polygonal grid.
 * UI and settings adapted from HexMazeCase for consistency.
 */
const PolygonMazeCase = {
    canvas: null,
    ctx: null,
    width: 0,
    height: 0,

    // Voronoi Data
    points: [],
    centers: [],
    neighbors: [],
    
    // Maze Data
    walls: new Set(), // Set of "edge keys" (centerIdx1-centerIdx2) that are CLOSED
    mazeEdges: [],    // All possible dual graph edges
    openEdges: new Set(), // Edges that are OPEN (walkable)
    
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

    // Internal Search Instance for resuming (Must be members to support Pause/Resume)
    pq: null,
    costSoFar: null,
    searchStartedAtMs: 0,
    searchElapsedMs: 0,
    searchTimeout: null,
    lastEnteredNodeCount: 0,

    // Config (Mirrored from HexMazeCase)
    config: {
        numPoints: 800,
        lloydIterations: 2,
        theme: 'ocean',
        speed: 40,
        sfxEnabled: true,
        sfxVolume: 0.1,
        searchMode: 'astar'
    },

    init() {
        this.canvas = document.getElementById('mathCanvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
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
                id: 'pm_shape',
                label: 'Maze Shape',
                value: 'random',
                options: [{ value: 'random', label: 'Random (Default)' }],
                onChange: () => { this.reset(); }
            },
            {
                type: 'select',
                id: 'pm_algorithm',
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
                id: 'pm_theme',
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
                id: 'pm_speed',
                label: 'Search Speed',
                min: 1,
                max: 50,
                step: 1,
                value: this.config.speed,
                onChange: (v) => { this.config.speed = v; }
            },
            {
                type: 'slider',
                id: 'pm_sfx_volume',
                label: 'SFX Volume',
                min: 0,
                max: 0.3,
                step: 0.01,
                value: this.config.sfxVolume,
                onChange: (v) => { this.config.sfxVolume = v; }
            },
            {
                type: 'slider',
                id: 'pm_radius',
                label: 'Grid Radius',
                min: 100,
                max: 2000,
                step: 100,
                value: this.config.numPoints,
                onChange: (v) => { this.config.numPoints = v; this.reset(); }
            },
            { type: 'info', label: 'Start (Green)', value: 'Drag to Move' },
            { type: 'info', label: 'Goal (Red)', value: 'Drag to Move' },
            { type: 'info', label: 'Walls (Gray)', value: 'Drag to Edit' },
            { type: 'info', label: 'Maze Control', value: 'Use top Reset Maze + Go' }
        ];
    },

    reset() {
        this.stopSearchAnimation();
        if (this.width === 0 || this.height === 0) this.resize();
        
        this.generateTopology();
        this.generateMaze();
        
        // Pick start and goal
        // Start: nearest to left-top, Goal: nearest to right-bottom
        this.startNodeIdx = this.findNearestIdx(this.width * 0.1, this.height * 0.1);
        this.goalNodeIdx = this.findNearestIdx(this.width * 0.9, this.height * 0.9);
        
        this.clearSearchState();
        this.draw();
    },

    generateTopology() {
        this.points = [];
        for(let i=0; i<this.config.numPoints; i++) {
            this.points.push({ x: Math.random() * this.width, y: Math.random() * this.height });
        }

        // Simple Lloyd Relaxation
        for(let iter=0; iter < this.config.lloydIterations; iter++) {
            const coords = new Float64Array(this.points.length * 2);
            for(let i=0; i < this.points.length; i++) {
                coords[i*2] = this.points[i].x;
                coords[i*2+1] = this.points[i].y;
            }
            const delaunay = new Delaunator(coords);
            const newPoints = [];
            for(let i=0; i < this.points.length; i++) {
                let cx=0, cy=0, count=0;
                // Simplified relaxation: just average neighbors in triangulation
                // For a truer Voronoi relaxation, we'd use circumcenters, 
                // but this is enough for "maze aesthetics".
                const neighbors = this.getDelaunayNeighbors(delaunay, i);
                neighbors.forEach(n => {
                    cx += this.points[n].x;
                    cy += this.points[n].y;
                    count++;
                });
                if(count > 0) newPoints.push({ x: cx/count, y: cy/count });
                else newPoints.push(this.points[i]);
            }
            this.points = newPoints;
        }

        // Build Graph
        const coords = new Float64Array(this.points.length * 2);
        for(let i=0; i < this.points.length; i++) {
            coords[i*2] = this.points[i].x;
            coords[i*2+1] = this.points[i].y;
        }
        const delaunay = new Delaunator(coords);
        
        this.centers = this.points.map((p, i) => ({
            idx: i,
            x: p.x,
            y: p.y,
            voronoiVertices: this.getVoronoiVertices(delaunay, i)
        }));

        this.neighbors = Array.from({length: this.points.length}, () => []);
        this.mazeEdges = [];
        const seenEdges = new Set();

        for(let e=0; e < delaunay.halfedges.length; e++) {
            const p = delaunay.triangles[e];
            const q = delaunay.triangles[e % 3 === 2 ? e - 2 : e + 1];
            if (!this.neighbors[p].includes(q)) this.neighbors[p].push(q);
            
            const edgeKey = p < q ? `${p}-${q}` : `${q}-${p}`;
            if (!seenEdges.has(edgeKey)) {
                seenEdges.add(edgeKey);
                this.mazeEdges.push({ p, q, key: edgeKey });
            }
        }
    },

    getDelaunayNeighbors(delaunay, i) {
        const neighbors = [];
        for (let e = 0; e < delaunay.halfedges.length; e++) {
            if (delaunay.triangles[e] === i) {
                neighbors.push(delaunay.triangles[e % 3 === 2 ? e - 2 : e + 1]);
            }
        }
        return [...new Set(neighbors)];
    },

    getVoronoiVertices(delaunay, i) {
        let vertices = [];
        let edges = [];
        for (let e = 0; e < delaunay.halfedges.length; e++) {
            if (delaunay.triangles[e] === i) edges.push(e);
        }
        
        edges.forEach(e => {
            const t = Math.floor(e / 3);
            const p1 = { x: delaunay.coords[delaunay.triangles[t*3]*2], y: delaunay.coords[delaunay.triangles[t*3]*2+1] };
            const p2 = { x: delaunay.coords[delaunay.triangles[t*3+1]*2], y: delaunay.coords[delaunay.triangles[t*3+1]*2+1] };
            const p3 = { x: delaunay.coords[delaunay.triangles[t*3+2]*2], y: delaunay.coords[delaunay.triangles[t*3+2]*2+1] };
            vertices.push(this.getCircumcenter(p1, p2, p3));
        });
        
        // Sort vertices based on angle from center to keep them in order for drawing
        const center = this.points[i];
        vertices.sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x));
        
        return vertices.filter(v => isFinite(v.x) && isFinite(v.y));
    },

    getCircumcenter(a, b, c) {
        const ad = a.x * a.x + a.y * a.y;
        const bd = b.x * b.x + b.y * b.y;
        const cd = c.x * c.x + c.y * c.y;
        const D = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
        if (Math.abs(D) < 0.000001) return { x: a.x, y: a.y };
        return {
            x: 1 / D * (ad * (b.y - c.y) + bd * (c.y - a.y) + cd * (a.y - b.y)),
            y: 1 / D * (ad * (c.x - b.x) + bd * (a.x - c.x) + cd * (b.x - a.x))
        };
    },

    generateMaze() {
        this.openEdges.clear();
        const visited = new Set();
        const stack = [Math.floor(Math.random() * this.points.length)];
        visited.add(stack[0]);

        while(stack.length > 0) {
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

    findNearestIdx(x, y) {
        let minDist = Infinity;
        let nearest = 0;
        this.points.forEach((p, i) => {
            const d = (p.x - x)**2 + (p.y - y)**2;
            if (d < minDist) { minDist = d; nearest = i; }
        });
        return nearest;
    },

    clearSearchState() {
        this.frontier = [];
        this.explored.clear();
        this.parentMap.clear();
        this.path = [];
        this.found = false;
        this.searchInProgress = false;
        this.searchPaused = false;
        this.currentIdx = null;
        this.pq = null;
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
        if (typeof Core !== 'undefined' && Core.isRunning) {
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
        const goal = this.goalNodeIdx;

        this.pq = new PriorityQueue();
        this.pq.put(start, 0);

        this.costSoFar = new Map();
        this.costSoFar.set(start, 0);
        this.parentMap.set(start, null);
        this.frontier = [start];

        if (typeof Core !== 'undefined') Core.syncPlayButton();
        this.searchStep();
    },

    searchStep() {
        if (!this.searchInProgress || this.searchPaused || !this.pq || this.pq.empty()) {
            if (!this.found && !this.searchPaused && this.searchInProgress) {
                this.searchInProgress = false;
                this.searchElapsedMs += performance.now() - this.searchStartedAtMs;
                this.searchStartedAtMs = 0;
                MazeEngine.playResultSound(false, this.config);
                if (typeof Core !== 'undefined') Core.syncPlayButton();
            }
            return;
        }

        const current = this.pq.get();
        const goal = this.goalNodeIdx;
        this.currentIdx = current;
        this.explored.add(current);

        if (current === goal) {
            this.found = true;
            this.searchInProgress = false;
            this.searchElapsedMs += performance.now() - this.searchStartedAtMs;
            this.searchStartedAtMs = 0;
            this.lastEnteredNodeCount = this.explored.size;
            this.reconstructPath(goal);
            MazeEngine.playResultSound(true, this.config);
            if (typeof Core !== 'undefined') {
                Core.syncPlayButton();
                Core.updateControls();
            }
            this.draw();
            return;
        }

        // Sound
        const dist = Math.sqrt((this.points[current].x - this.points[goal].x)**2 + (this.points[current].y - this.points[goal].y)**2);
        const freq = 200 + (1 - dist / this.width) * 800;
        MazeEngine.playTone(freq, 0.05, 'sine', 0.1, 0.003, this.config);

        const neighbors = this.neighbors[current].filter(n => {
            const edgeKey = current < n ? `${current}-${n}` : `${n}-${current}`;
            return this.openEdges.has(edgeKey);
        });

        for (const next of neighbors) {
            const newCost = this.costSoFar.get(current) + 1;
            if (!this.costSoFar.has(next) || newCost < this.costSoFar.get(next)) {
                this.costSoFar.set(next, newCost);
                
                let priority = newCost;
                if (this.config.searchMode === 'astar') {
                    priority += Math.sqrt((this.points[next].x - this.points[goal].x)**2 + (this.points[next].y - this.points[goal].y)**2) / 4;
                } else if (this.config.searchMode === 'greedy') {
                    priority = Math.sqrt((this.points[next].x - this.points[goal].x)**2 + (this.points[next].y - this.points[goal].y)**2);
                } else if (this.config.searchMode === 'bfs' || this.config.searchMode === 'dfs') {
                    priority = 0; // Standard Queue/Stack behavior implicitly handled by PQ if same priority, but DFS needs careful handling
                }
                
                this.pq.put(next, priority);
                this.parentMap.set(next, current);
                if (!this.frontier.includes(next)) this.frontier.push(next);
            }
        }

        this.draw();
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
        let curr = goal;
        while (curr !== null) {
            this.path.push(curr);
            curr = this.parentMap.get(curr);
        }
        this.path.reverse();
    },

    draw() {
        if (!this.ctx) return;
        const theme = MazeEngine.themes[this.config.theme] || MazeEngine.themes.ocean;
        this.ctx.clearRect(0, 0, this.width, this.height);
        this.ctx.fillStyle = '#1e1e1e';
        this.ctx.fillRect(0, 0, this.width, this.height);

        // 1. Draw Polygons
        this.centers.forEach((c, i) => {
            if (c.voronoiVertices.length < 3) return;

            this.ctx.beginPath();
            this.ctx.moveTo(c.voronoiVertices[0].x, c.voronoiVertices[0].y);
            for (let j = 1; j < c.voronoiVertices.length; j++) {
                this.ctx.lineTo(c.voronoiVertices[j].x, c.voronoiVertices[j].y);
            }
            this.ctx.closePath();

            // Fill based on search state
            let fill = 'rgba(240, 248, 255, 0.05)';
            if (this.path.includes(i)) {
                fill = theme.path;
            } else if (i === this.currentIdx) {
                fill = theme.current;
            } else if (this.explored.has(i)) {
                fill = theme.explored;
            } else if (this.frontier.includes(i)) {
                fill = theme.frontier;
            }
            this.ctx.fillStyle = fill;
            this.ctx.fill();

            // Draw Walls (Edges that are NOT in openEdges)
            this.neighbors[i].forEach(nIdx => {
                const edgeKey = i < nIdx ? `${i}-${nIdx}` : `${nIdx}-${i}`;
                if (!this.openEdges.has(edgeKey)) {
                    // Find common voronoi vertices
                    const shared = this.getSharedVertices(i, nIdx);
                    if (shared.length >= 2) {
                        this.ctx.beginPath();
                        this.ctx.strokeStyle = theme.wall;
                        this.ctx.lineWidth = 2;
                        this.ctx.moveTo(shared[0].x, shared[0].y);
                        this.ctx.lineTo(shared[1].x, shared[1].y);
                        this.ctx.stroke();
                    }
                }
            });

            // Start/Goal indicators
            if (i === this.startNodeIdx || i === this.goalNodeIdx) {
                this.ctx.beginPath();
                this.ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
                this.ctx.fillStyle = i === this.startNodeIdx ? theme.start : theme.goal;
                this.ctx.fill();
            }
        });

        // 2. Draw Path Line
        if (this.path.length > 0) {
            this.ctx.beginPath();
            this.ctx.strokeStyle = theme.current;
            this.ctx.lineWidth = 3;
            this.ctx.lineJoin = 'round';
            this.ctx.moveTo(this.points[this.path[0]].x, this.points[this.path[0]].y);
            for (let i = 1; i < this.path.length; i++) {
                this.ctx.lineTo(this.points[this.path[i]].x, this.points[this.path[i]].y);
            }
            this.ctx.stroke();
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
        ctx.fillText(`Cells Entered: ${this.explored.size}`, 20, 70);
        ctx.fillText(`Last: ${this.lastEnteredNodeCount}`, 20, 90);
        ctx.restore();
    },

    getSharedVertices(idx1, idx2) {
        const v1 = this.centers[idx1].voronoiVertices;
        const v2 = this.centers[idx2].voronoiVertices;
        const shared = [];
        v1.forEach(p1 => {
            v2.forEach(p2 => {
                if (Math.abs(p1.x - p2.x) < 0.1 && Math.abs(p1.y - p2.y) < 0.1) {
                    shared.push(p1);
                }
            });
        });
        return shared;
    },

    startPausedOnLoad: true,
    autoPlayOnReset: false,

    start() { 
        if (this.found) this.reset(); 
        if (this.searchPaused) this.resumeSearch();
        else this.startSearchAnimation();
    },

    stop() { 
        if (this.searchInProgress) this.pauseSearch();
        else this.stopSearchAnimation();
    },

    destroy() { 
        this.stopSearchAnimation(); 
    }
};

window.PolygonMazeCase = PolygonMazeCase;
