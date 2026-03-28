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
    activeNodes: new Set(),
    
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
    frontierQueue: null,
    frontierStack: null,
    frontierHead: 0,
    costSoFar: null,
    searchStartedAtMs: 0,
    searchElapsedMs: 0,
    searchTimeout: null,
    lastEnteredNodeCount: 0,
    solutionSpeed: 70,
    pathProgress: 0,
    pathMap: new Map(),
    pathAnimTimer: null,

    // Config (Mirrored from HexMazeCase)
    config: {
        numPoints: 1200,
        lloydIterations: 3,
        theme: 'ocean',
        speed: 40,
        sfxEnabled: true,
        sfxVolume: 0.1,
        audioMode: 'synth',
        searchMode: 'astar'
    },
    mazeShape: 'random',

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
                value: this.mazeShape || 'random',
                options: [
                    { value: 'random', label: 'Random (Default)' },
                    { value: 'spiral', label: 'Spiral Path' }
                ],
                onChange: (v) => {
                    this.mazeShape = v;
                    this.reset();
                }
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
                    { value: 'rainbow', label: '0. High Contrast' },
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
                id: 'pm_sol_speed',
                label: 'Solution Speed',
                min: 1,
                max: 100,
                step: 1,
                value: this.solutionSpeed,
                onChange: (v) => { this.solutionSpeed = v; }
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
                label: 'Point Count',
                min: 300,
                max: 3200,
                step: 50,
                value: this.config.numPoints,
                live: false,
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
        this.startNodeIdx = null;
        this.goalNodeIdx = null;
        
        this.generateTopology();
        this.generateMaze();
        
        // Pick start and goal
        // Start: nearest to left-top, Goal: nearest to right-bottom
        if (this.startNodeIdx === null || this.goalNodeIdx === null) {
            this.startNodeIdx = this.findNearestIdx(this.width * 0.1, this.height * 0.1);
            this.goalNodeIdx = this.findNearestIdx(this.width * 0.9, this.height * 0.9);
        }
        
        this.clearSearchState();
        this.draw();
    },

    generateTopology() {
        this.points = [];
        const totalPoints = Math.max(300, Math.floor(this.config.numPoints));
        const w = this.width;
        const h = this.height;

        if (this.mazeShape === 'spiral') {
            // Keep a chunk of points on/near the spiral so the grid has finer local detail.
            const guideCount = Math.max(180, Math.floor(totalPoints * 0.35));
            const randomCount = Math.max(0, totalPoints - guideCount);
            for (let i = 0; i < randomCount; i++) {
                this.points.push({ x: Math.random() * w, y: Math.random() * h });
            }

            const cx = w * 0.5;
            const cy = h * 0.5;
            const maxR = Math.min(w, h) * 0.45;
            const turns = 3.4;
            for (let i = 0; i < guideCount; i++) {
                const t = i / Math.max(1, guideCount - 1);
                const theta = turns * Math.PI * 2 * t - Math.PI / 2;
                const r = 8 + maxR * t;
                const jitter = 6 + (1 - t) * 5;
                const x = cx + Math.cos(theta) * r + (Math.random() - 0.5) * jitter;
                const y = cy + Math.sin(theta) * r + (Math.random() - 0.5) * jitter;
                this.points.push({
                    x: Math.max(0, Math.min(w, x)),
                    y: Math.max(0, Math.min(h, y))
                });
            }
        } else {
            for(let i = 0; i < totalPoints; i++) {
                this.points.push({ x: Math.random() * w, y: Math.random() * h });
            }
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

        // Keep only bounded Voronoi cells; unbounded edge cells can create
        // "outside ground" traversal artifacts.
        this.activeNodes = new Set();
        const margin = 2;
        this.centers.forEach((c, i) => {
            const verts = c.voronoiVertices || [];
            if (verts.length < 3) return;
            const bounded = verts.every(v =>
                Number.isFinite(v.x) &&
                Number.isFinite(v.y) &&
                v.x >= margin &&
                v.x <= this.width - margin &&
                v.y >= margin &&
                v.y <= this.height - margin
            );
            if (bounded) this.activeNodes.add(i);
        });

        this.neighbors = Array.from({length: this.points.length}, () => []);
        this.mazeEdges = [];
        const seenEdges = new Set();

        for(let e=0; e < delaunay.halfedges.length; e++) {
            const p = delaunay.triangles[e];
            const q = delaunay.triangles[e % 3 === 2 ? e - 2 : e + 1];
            if (!this.activeNodes.has(p) || !this.activeNodes.has(q)) continue;
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
        if (this.mazeShape === 'spiral') {
            this.generateSpiralMaze();
            return;
        }

        this.openEdges.clear();
        const activeList = Array.from(this.activeNodes);
        if (activeList.length === 0) return;

        const visited = new Set();
        const start = activeList[Math.floor(Math.random() * activeList.length)];
        const stack = [start];
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

    generateSpiralMaze() {
        this.openEdges.clear();
        const activeList = Array.from(this.activeNodes);
        if (activeList.length < 2) return;

        const cx = this.width * 0.5;
        const cy = this.height * 0.5;
        const maxR = Math.min(this.width, this.height) * 0.45;
        const turns = 3.4;
        const samples = Math.max(220, Math.min(900, Math.floor(activeList.length * 1.1)));
        const twoPi = Math.PI * 2;

        const spiralR = new Map();
        const spiralS = new Map();
        for (const idx of activeList) {
            const p = this.points[idx];
            const dx = p.x - cx;
            const dy = p.y - cy;
            const r = Math.hypot(dx, dy);
            let angle = Math.atan2(dy, dx);
            if (angle < 0) angle += twoPi;
            const s = angle + turns * twoPi * (r / Math.max(1, maxR));
            spiralR.set(idx, r);
            spiralS.set(idx, s);
        }

        const allowEdge = (a, b) => {
            const sa = spiralS.get(a);
            const sb = spiralS.get(b);
            const ra = spiralR.get(a);
            const rb = spiralR.get(b);
            if (sa === undefined || sb === undefined || ra === undefined || rb === undefined) return false;
            const ds = Math.abs(sa - sb);
            const dr = Math.abs(ra - rb);
            // Prevent cross-turn shortcuts that collapse the maze into a near-single line.
            if (ds > 1.05) return false;
            if (dr > maxR * 0.12) return false;
            return true;
        };

        // Build explicit spiral waypoints in screen space, then snap each point
        // to the nearest active polygon center.
        const anchors = [];
        const seen = new Set();
        for (let i = 0; i <= samples; i++) {
            const t = i / samples;
            const theta = turns * Math.PI * 2 * t - Math.PI / 2;
            const r = 10 + maxR * t;
            const x = cx + Math.cos(theta) * r;
            const y = cy + Math.sin(theta) * r;

            let nearest = -1;
            let best = Infinity;
            for (const idx of activeList) {
                const p = this.points[idx];
                const d2 = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
                if (d2 < best) {
                    best = d2;
                    nearest = idx;
                }
            }
            if (nearest === -1 || seen.has(nearest)) continue;
            seen.add(nearest);
            anchors.push(nearest);
        }
        if (anchors.length < 2) {
            // Fallback: build one random maze pass when snapping failed.
            const prev = this.mazeShape;
            this.mazeShape = 'random';
            this.generateMaze();
            this.mazeShape = prev;
            return;
        }

        const carvePath = (startIdx, goalIdx, strict = true) => {
            if (startIdx === goalIdx) return [startIdx];
            const pq = new PriorityQueue();
            const came = new Map();
            const cost = new Map();
            pq.put(startIdx, 0);
            came.set(startIdx, null);
            cost.set(startIdx, 0);

            while (!pq.empty()) {
                const current = pq.get();
                if (current === goalIdx) break;
                const cc = cost.get(current);
                const neighbors = this.neighbors[current] || [];
                for (const next of neighbors) {
                    if (!this.activeNodes.has(next)) continue;
                    if (strict && !allowEdge(current, next)) continue;
                    const stepCost = 1;
                    const newCost = cc + stepCost;
                    const old = cost.get(next);
                    if (old !== undefined && newCost >= old) continue;
                    cost.set(next, newCost);
                    came.set(next, current);
                    const h = Math.hypot(
                        this.points[next].x - this.points[goalIdx].x,
                        this.points[next].y - this.points[goalIdx].y
                    );
                    pq.put(next, newCost + h * 0.06);
                }
            }

            if (!came.has(goalIdx)) return [startIdx];
            const path = [];
            let cur = goalIdx;
            while (cur !== null) {
                path.push(cur);
                cur = came.get(cur) ?? null;
            }
            path.reverse();
            return path;
        };

        const backboneNodes = new Set();
        for (let i = 0; i < anchors.length - 1; i++) {
            let path = carvePath(anchors[i], anchors[i + 1], true);
            if (path.length < 2) {
                // Fallback if strict constraints disconnected this local segment.
                path = carvePath(anchors[i], anchors[i + 1], false);
            }
            for (let j = 0; j < path.length - 1; j++) {
                const a = path[j];
                const b = path[j + 1];
                const edgeKey = a < b ? `${a}-${b}` : `${b}-${a}`;
                this.openEdges.add(edgeKey);
                backboneNodes.add(a);
                backboneNodes.add(b);
            }
        }

        // Expand from the spiral backbone to create many alternate routes.
        const visited = new Set(backboneNodes);
        const frontier = Array.from(backboneNodes);
        const branchTarget = Math.max(120, Math.floor(activeList.length * 0.82));
        let guard = 0;

        while (visited.size < branchTarget && frontier.length > 0 && guard < activeList.length * 30) {
            guard++;
            const fi = Math.floor(Math.random() * frontier.length);
            const current = frontier[fi];
            const candidates = (this.neighbors[current] || []).filter(n =>
                this.activeNodes.has(n) && !visited.has(n) && allowEdge(current, n)
            );

            if (candidates.length === 0) {
                frontier.splice(fi, 1);
                continue;
            }

            const next = candidates[Math.floor(Math.random() * candidates.length)];
            const edgeKey = current < next ? `${current}-${next}` : `${next}-${current}`;
            this.openEdges.add(edgeKey);
            visited.add(next);
            frontier.push(next);
        }

        // Add extra loops so the solver has to explore/compare alternatives.
        const closedEdges = [];
        for (const i of activeList) {
            for (const n of this.neighbors[i] || []) {
                if (i >= n || !this.activeNodes.has(n)) continue;
                if (!allowEdge(i, n)) continue;
                const edgeKey = i < n ? `${i}-${n}` : `${n}-${i}`;
                if (this.openEdges.has(edgeKey)) continue;
                if (!visited.has(i) && !visited.has(n)) continue;
                closedEdges.push(edgeKey);
            }
        }

        const loopBudget = Math.min(
            closedEdges.length,
            Math.max(50, Math.floor(activeList.length * 0.22))
        );
        for (let i = 0; i < loopBudget; i++) {
            const pick = i + Math.floor(Math.random() * (closedEdges.length - i));
            const tmp = closedEdges[i];
            closedEdges[i] = closedEdges[pick];
            closedEdges[pick] = tmp;
            this.openEdges.add(closedEdges[i]);
        }

        this.startNodeIdx = anchors[0];
        this.goalNodeIdx = anchors[anchors.length - 1];
    },

    findNearestIdx(x, y) {
        let minDist = Infinity;
        let nearest = null;
        this.points.forEach((p, i) => {
            if (!this.activeNodes.has(i)) return;
            const d = (p.x - x)**2 + (p.y - y)**2;
            if (d < minDist) { minDist = d; nearest = i; }
        });
        return nearest ?? 0;
    },

    clearSearchState() {
        if (window.synthAudio) window.synthAudio.randomizeMelody();
        this.frontier = [];
        this.explored.clear();
        this.parentMap.clear();
        this.path = [];
        this.pathProgress = 0;
        this.pathMap.clear();
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
            MazeEngine.playResultSound(true, this.config);
            if (typeof Core !== 'undefined') {
                Core.syncPlayButton();
                Core.updateControls();
            }
            this.startPathAnimation();
            this.draw();
            return;
        }

        // Sound
        if (this.config.audioMode === 'synth' && window.synthAudio) {
            const stepDelayMs = MazeEngine.speedToDelay(this.config.speed);
            const durationSec = Math.max(0.05, stepDelayMs / 1000.0);
            const pt = { 
                x: (this.points[current].x / this.width) * 2 - 1, 
                y: 0, 
                z: 0 
            };
            // Default sfx volume to 0.1 if not strictly defined in config
            window.synthAudio.triggerNote(pt, 0, 0, this.config.sfxVolume || 0.1, durationSec);
        } else {
            const dist = Math.sqrt((this.points[current].x - this.points[goal].x)**2 + (this.points[current].y - this.points[goal].y)**2);
            const freq = 200 + (1 - dist / this.width) * 800;
            MazeEngine.playTone(freq, 0.05, 'sine', 0.1, 0.003, this.config);
        }

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
                    priority += Math.sqrt((this.points[next].x - this.points[goal].x)**2 + (this.points[next].y - this.points[goal].y)**2) / 4;
                } else if (this.config.searchMode === 'greedy') {
                    priority = Math.sqrt((this.points[next].x - this.points[goal].x)**2 + (this.points[next].y - this.points[goal].y)**2);
                }
                
                this.pushFrontier(next, priority);
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
        this.path = [];
        let curr = goal;
        while (curr !== null) {
            this.path.push(curr);
            curr = this.parentMap.get(curr);
        }
        this.path.reverse();

        // Build map for O(1) index lookup
        this.pathMap.clear();
        this.path.forEach((idx, i) => {
            this.pathMap.set(idx, i);
        });
    },

    startPathAnimation() {
        this.pathProgress = 0;
        if (this.pathAnimTimer) clearTimeout(this.pathAnimTimer);
        this.animatePath();
    },

    animatePath() {
        if (!this.found || this.searchPaused) return;
        if (this.pathProgress < this.path.length) {
            const step = Math.ceil(Math.pow(this.solutionSpeed / 25, 2));
            this.pathProgress = Math.min(this.path.length, this.pathProgress + step);
            
            const delay = Math.max(1, 150 - this.solutionSpeed * 1.4);
            this.pathAnimTimer = setTimeout(() => this.animatePath(), delay);
            this.draw();
        } else {
            MazeEngine.playSolutionFinishSound(this.config);
        }
    },

    draw() {
        if (!this.ctx) return;
        const ctx = this.ctx;
        const theme = this.config.theme === 'rainbow'
            ? {
                wall: '#ffe066',
                explored: 'rgba(255, 64, 129, 0.78)',
                frontier: 'rgba(0, 229, 255, 0.9)',
                start: '#39ff14',
                goal: '#ff1744',
                path: 'rgba(255, 214, 0, 0.34)',
                current: '#ffffff'
            }
            : (MazeEngine.themes[this.config.theme] || MazeEngine.themes.ocean);
        ctx.clearRect(0, 0, this.width, this.height);

        // Layered background gives depth instead of a flat dark fill.
        const bg = ctx.createLinearGradient(0, 0, this.width, this.height);
        bg.addColorStop(0, '#0b1220');
        bg.addColorStop(1, '#1b2330');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, this.width, this.height);

        const vignette = ctx.createRadialGradient(
            this.width * 0.5,
            this.height * 0.45,
            Math.min(this.width, this.height) * 0.1,
            this.width * 0.5,
            this.height * 0.5,
            Math.max(this.width, this.height) * 0.75
        );
        vignette.addColorStop(0, 'rgba(255,255,255,0.04)');
        vignette.addColorStop(1, 'rgba(0,0,0,0.42)');
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, this.width, this.height);

        // 1. Draw Polygons
        this.centers.forEach((c, i) => {
            if (!this.activeNodes.has(i)) return;
            if (c.voronoiVertices.length < 3) return;

            ctx.beginPath();
            ctx.moveTo(c.voronoiVertices[0].x, c.voronoiVertices[0].y);
            for (let j = 1; j < c.voronoiVertices.length; j++) {
                ctx.lineTo(c.voronoiVertices[j].x, c.voronoiVertices[j].y);
            }
            ctx.closePath();

            // Fill based on search state
            let fill = 'rgba(240, 248, 255, 0.05)';
            const pathIdx = this.pathMap.get(i);
            
            if (pathIdx !== undefined && pathIdx < this.pathProgress) {
                fill = theme.path;
            } else if (i === this.currentIdx) {
                fill = theme.current;
            } else if (this.explored.has(i)) {
                fill = theme.explored;
            } else if (this.frontier.includes(i)) {
                fill = theme.frontier;
            } else if (i === this.startNodeIdx) {
                fill = theme.start;
            } else if (i === this.goalNodeIdx) {
                fill = theme.goal;
            }

            ctx.fillStyle = fill;
            ctx.fill();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
            ctx.lineWidth = 0.5;
            ctx.stroke();

            // Draw Walls (Edges that are NOT in openEdges)
            this.neighbors[i].forEach(nIdx => {
                const edgeKey = i < nIdx ? `${i}-${nIdx}` : `${nIdx}-${i}`;
                if (!this.openEdges.has(edgeKey)) {
                    // Find common voronoi vertices
                    const shared = this.getSharedVertices(i, nIdx);
                    if (shared.length >= 2) {
                        ctx.beginPath();
                        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
                        ctx.lineWidth = 4;
                        ctx.moveTo(shared[0].x, shared[0].y);
                        ctx.lineTo(shared[1].x, shared[1].y);
                        ctx.stroke();

                        ctx.beginPath();
                        ctx.strokeStyle = theme.wall;
                        ctx.lineWidth = 1.4;
                        ctx.moveTo(shared[0].x, shared[0].y);
                        ctx.lineTo(shared[1].x, shared[1].y);
                        ctx.stroke();
                    }
                }
            });

            // Start/Goal indicators
            if (i === this.startNodeIdx || i === this.goalNodeIdx) {
                ctx.beginPath();
                ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
                ctx.fillStyle = i === this.startNodeIdx ? theme.start : theme.goal;
                ctx.fill();
            }
        });

        // 2. Draw Path Line
        if (this.path.length > 0 && this.pathProgress > 0) {
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.lineWidth = 7;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.moveTo(this.points[this.path[0]].x, this.points[this.path[0]].y);
            for (let i = 1; i < this.pathProgress; i++) {
                ctx.lineTo(this.points[this.path[i]].x, this.points[this.path[i]].y);
            }
            ctx.stroke();

            ctx.beginPath();
            ctx.strokeStyle = theme.current;
            ctx.lineWidth = 2.6;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.moveTo(this.points[this.path[0]].x, this.points[this.path[0]].y);
            for (let i = 1; i < this.pathProgress; i++) {
                ctx.lineTo(this.points[this.path[i]].x, this.points[this.path[i]].y);
            }
            ctx.stroke();
        }

        if (this.currentIdx !== null && this.points[this.currentIdx]) {
            const p = this.points[this.currentIdx];
            const pulse = 6 + Math.sin(performance.now() * 0.008) * 2.5;
            ctx.beginPath();
            ctx.arc(p.x, p.y, pulse, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
            ctx.lineWidth = 1.4;
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
        if (this.pathAnimTimer) clearTimeout(this.pathAnimTimer);
    },

    destroy() { 
        this.stopSearchAnimation(); 
        if (this.pathAnimTimer) clearTimeout(this.pathAnimTimer);
    }
};

window.PolygonMazeCase = PolygonMazeCase;
