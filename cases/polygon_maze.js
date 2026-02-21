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
    isSearching: false,
    found: false,
    currentIdx: null,

    // Config (Mirrored from HexMazeCase)
    config: {
        numPoints: 800,
        lloydIterations: 2,
        theme: 'ocean',
        speed: 40,
        sfxEnabled: true,
        sfxVolume: 0.2
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
    },

    get uiConfig() {
        return [
            {
                type: 'select',
                id: 'pm_theme',
                label: 'Theme',
                options: Object.keys(MazeEngine.themes).map(t => ({ label: t.charAt(0).toUpperCase() + t.slice(1), value: t })),
                value: this.config.theme,
                onChange: (v) => { this.config.theme = v; this.draw(); }
            },
            {
                type: 'slider',
                id: 'pm_complexity',
                label: 'Complexity',
                min: 100,
                max: 2000,
                step: 100,
                value: this.config.numPoints,
                onChange: (v) => { this.config.numPoints = v; this.reset(); }
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
                type: 'toggle',
                id: 'pm_sfx',
                label: 'Sound Effects',
                value: this.config.sfxEnabled,
                onChange: (v) => { this.config.sfxEnabled = v; }
            },
            {
                type: 'button',
                id: 'pm_new_maze',
                label: 'New Maze',
                value: 'Generate',
                onClick: () => this.reset()
            },
            {
                type: 'button',
                id: 'pm_solve',
                label: 'Solve Maze',
                value: 'Start A*',
                onClick: () => this.startSearch()
            }
        ];
    },

    reset() {
        this.stop();
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
        this.isSearching = false;
        this.currentIdx = null;
    },

    startSearch() {
        if (this.isSearching) return;
        this.clearSearchState();
        this.isSearching = true;

        const start = this.startNodeIdx;
        const goal = this.goalNodeIdx;

        const pq = new PriorityQueue();
        pq.put(start, 0);

        const costSoFar = new Map();
        costSoFar.set(start, 0);
        this.parentMap.set(start, null);
        this.frontier = [start];

        const step = () => {
            if (!this.isSearching || pq.empty()) {
                if (!this.found) {
                    this.isSearching = false;
                    MazeEngine.playResultSound(false, this.config);
                }
                return;
            }

            const current = pq.get();
            this.currentIdx = current;
            this.explored.add(current);

            if (current === goal) {
                this.found = true;
                this.isSearching = false;
                this.reconstructPath(goal);
                MazeEngine.playResultSound(true, this.config);
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
                const newCost = costSoFar.get(current) + 1;
                if (!costSoFar.has(next) || newCost < costSoFar.get(next)) {
                    costSoFar.set(next, newCost);
                    const priority = newCost + Math.sqrt((this.points[next].x - this.points[goal].x)**2 + (this.points[next].y - this.points[goal].y)**2) / 10;
                    pq.put(next, priority);
                    this.parentMap.set(next, current);
                    if (!this.frontier.includes(next)) this.frontier.push(next);
                }
            }

            this.draw();
            setTimeout(step, MazeEngine.speedToDelay(this.config.speed));
        };

        step();
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
        const theme = MazeEngine.themes[this.config.theme];
        this.ctx.clearRect(0, 0, this.width, this.height);
        this.ctx.fillStyle = '#0f172a';
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
            if (this.path.includes(i)) {
                this.ctx.fillStyle = theme.path;
            } else if (i === this.currentIdx) {
                this.ctx.fillStyle = theme.current;
            } else if (this.explored.has(i)) {
                this.ctx.fillStyle = theme.explored;
            } else if (this.frontier.includes(i)) {
                this.ctx.fillStyle = theme.frontier;
            } else {
                this.ctx.fillStyle = 'transparent';
            }
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

    start() { this.reset(); },
    stop() { this.isSearching = false; },
    destroy() { this.stop(); }
};

window.PolygonMazeCase = PolygonMazeCase;
