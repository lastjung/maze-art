/**
 * SphereFaceMazeCase
 * Face-following maze on a Goldberg-like spherical polyhedron.
 */
const SphereFaceMazeCase = {
    canvas: null,
    ctx: null,
    animationId: null,
    lastTimeMs: 0,
    
    // Grid/Topology State
    points: [],
    rotatedPoints: [],
    neighbors: [],
    faceCells: [],
    faceCellEdgeNeighbors: [],
    walls: new Set(),
    
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
    
    // Tracking Smoothing State
    trackingHistory: [],
    trackingSmoothedPoint: null,
    trackingVelX: 0,
    trackingVelY: 0,
    trackingLocked: false,

    // Rainbow-vivid performance cache (used only in rainbow-vivid theme)
    vividCacheCanvas: null,
    vividCacheCtx: null,
    vividCacheRadius: 0,
    vividCacheRotX: 0,
    vividCacheRotY: 0,
    vividCachePointCount: 0,
    vividCacheTick: 0,
    vividCacheDirty: true,

    // Interaction state
    isDragging: false,
    lastMouseX: 0,
    lastMouseY: 0,

    // Path animation state
    pathProgress: 0,
    pathAnimTimer: null,
    
    // Config
    config: {
        numPoints: 800,
        topologyMode: 'goldberg',
        sphereScale: 100,
        theme: 'ocean',
        speed: 30,
        solutionSpeed: 70, // Default path reveal speed
        sfxEnabled: true,
        sfxVolume: 0.1,
        searchMode: 'astar',
        autoTrack: true
    },
    themes: {
        rainbow: {
            wall: '#FFFFFF',
            explored: '#FFFFFF',
            frontier: '#FFFFFF',
            start: '#00FF00',
            goal: '#FF0000',
            path: 'rgba(0, 0, 0, 0.65)',
            current: '#000000'
        },
        basic: {
            wall: '#86efac',
            explored: '#ec4899',
            frontier: '#f472b6',
            start: '#00CC00',
            goal: '#FF0000',
            path: 'rgba(255, 215, 0, 0.30)',
            current: '#FFD700'
        },
        ocean: {
            wall: '#22d3ee',
            explored: '#3b82f6',
            frontier: '#93c5fd',
            start: '#0891b2',
            goal: '#FF0000',
            path: 'rgba(255, 0, 0, 0.45)',
            current: '#FF0000'
        },
        sunset: {
            wall: '#fdba74',
            explored: '#7c3aed',
            frontier: '#a78bfa',
            start: '#f97316',
            goal: '#FF0000',
            path: 'rgba(255, 255, 255, 0.25)',
            current: '#39ff14'
        },
        neon: {
            wall: '#f3f4f6',
            explored: '#4d7c0f',
            frontier: '#84cc16',
            start: '#1f2937',
            goal: '#FF0000',
            path: 'rgba(132, 204, 22, 0.2)',
            current: '#FFD700'
        }
    },
    toggleTracking() {
        this.config.autoTrack = !this.config.autoTrack;
    },
    
    isTrackingEnabled() {
        return this.config.autoTrack;
    },

    isCaseAudioMuted() {
        return !this.config.sfxEnabled;
    },

    toggleCaseAudio() {
        this.config.sfxEnabled = !this.config.sfxEnabled;
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
        
        // Start animation loop immediately for idle rotation
        if (!this.animationId) {
            this.lastTimeMs = null;
            const loop = (now) => {
                if (!this.lastTimeMs) this.lastTimeMs = now;
                const dt = Math.min(0.05, Math.max(0, (now - this.lastTimeMs) / 1000));
                this.lastTimeMs = now;
                
                // Auto track active search/path, or idle rotate
                let activePoint = null;
                let trackActive = false;

                if (this.config.autoTrack) {
                    if (this.searchInProgress && this.currentIdx !== null && this.points[this.currentIdx]) {
                        activePoint = this.points[this.currentIdx];
                        trackActive = true; 
                    } else if (this.path && this.path.length > 0 && this.pathProgress > 0 && this.pathProgress <= this.path.length) {
                        let idx = Math.min(this.path.length - 1, this.pathProgress - 1);
                        activePoint = this.points[this.path[idx]];
                        trackActive = true; 
                    }
                }

                // After solution reveal is complete, return to idle auto-rotation.
                if (this.found && !this.searchInProgress && this.pathProgress >= this.path.length) {
                    trackActive = false;
                    activePoint = null;
                }

                if (!this.isDragging) {
                    if (trackActive && activePoint) {
                        this.trackingHistory.push({ x: activePoint.x, y: activePoint.y, z: activePoint.z });
                        if (this.trackingHistory.length > 6) {
                            this.trackingHistory.shift();
                        }

                        let avgX = 0, avgY = 0, avgZ = 0;
                        for (let p of this.trackingHistory) {
                            avgX += p.x; avgY += p.y; avgZ += p.z;
                        }
                        avgX /= this.trackingHistory.length;
                        avgY /= this.trackingHistory.length;
                        avgZ /= this.trackingHistory.length;
                        
                        const averagedPoint = { x: avgX, y: avgY, z: avgZ };

                        // Temporal EMA on top of moving average to absorb high-frequency jumps.
                        if (!this.trackingSmoothedPoint) {
                            this.trackingSmoothedPoint = { ...averagedPoint };
                        } else {
                            const emaAlpha = 1 - Math.exp(-dt / 0.22);
                            this.trackingSmoothedPoint.x += (averagedPoint.x - this.trackingSmoothedPoint.x) * emaAlpha;
                            this.trackingSmoothedPoint.y += (averagedPoint.y - this.trackingSmoothedPoint.y) * emaAlpha;
                            this.trackingSmoothedPoint.z += (averagedPoint.z - this.trackingSmoothedPoint.z) * emaAlpha;
                            const len = Math.hypot(this.trackingSmoothedPoint.x, this.trackingSmoothedPoint.y, this.trackingSmoothedPoint.z) || 1;
                            this.trackingSmoothedPoint.x /= len;
                            this.trackingSmoothedPoint.y /= len;
                            this.trackingSmoothedPoint.z /= len;
                        }

                        const smoothedPoint = this.trackingSmoothedPoint;
                        const viewP = this.rotatePoint(smoothedPoint, this.rotX, this.rotY);
                        const radial = Math.hypot(viewP.x, viewP.y);

                        // Hysteresis prevents rapid track/idle flip near the center boundary.
                        const enterTrackRadius = 0.74;
                        const exitTrackRadius = 0.58;
                        if (!this.trackingLocked) {
                            if (viewP.z <= 0 || radial > enterTrackRadius) this.trackingLocked = true;
                        } else if (viewP.z > 0 && radial < exitTrackRadius) {
                            this.trackingLocked = false;
                        }

                        if (!this.trackingLocked) {
                            this.trackingVelX *= 0.88;
                            this.trackingVelY *= 0.88;
                            this.rotY += this.rotationSpeed * dt * 0.1;
                        } else {
                            const gain = 4.8;
                            const maxVel = 2.2;
                            const deadZone = 0.012;
                            const velAlpha = 1 - Math.exp(-dt / 0.14);

                            const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
                            let zNew = Math.hypot(smoothedPoint.x, smoothedPoint.z);
                            if (zNew > 0.001) {
                                const targetAngleY = Math.atan2(-smoothedPoint.x, smoothedPoint.z);
                                let dY = wrap(targetAngleY - this.rotY);
                                if (Math.abs(dY) < deadZone) dY = 0;
                                const desiredVelY = Math.max(-maxVel, Math.min(maxVel, dY * gain));
                                this.trackingVelY += (desiredVelY - this.trackingVelY) * velAlpha;
                            }

                            const targetAngleX = Math.atan2(smoothedPoint.y, zNew);
                            let dX = wrap(targetAngleX - this.rotX);
                            if (Math.abs(dX) < deadZone) dX = 0;
                            const desiredVelX = Math.max(-maxVel, Math.min(maxVel, dX * gain));
                            this.trackingVelX += (desiredVelX - this.trackingVelX) * velAlpha;

                            this.rotY += this.trackingVelY * dt;
                            this.rotX += this.trackingVelX * dt;
                        }
                    } else {
                        this.trackingHistory = [];
                        this.trackingSmoothedPoint = null;
                        this.trackingLocked = false;
                        this.trackingVelX *= 0.85;
                        this.trackingVelY *= 0.85;
                        this.rotY += this.rotationSpeed * dt;
                        this.rotX += this.rotationSpeed * dt * 0.4;
                    }
                    this.clampPitch();
                } else {
                    this.trackingVelX = 0;
                    this.trackingVelY = 0;
                }
                
                this.draw();
                this.animationId = requestAnimationFrame(loop);
            };
            this.animationId = requestAnimationFrame(loop);
        }
    },

    resize() {
        if (!this.canvas || !this.canvas.parentElement) return;
        const parent = this.canvas.parentElement;
        this.width = this.canvas.width = parent.clientWidth || 800;
        this.height = this.canvas.height = parent.clientHeight || 600;
        this.draw();
    },

    get uiConfig() {
        const isSoccer = this.config.topologyMode !== 'goldberg';
        const freq = this.getGoldbergFrequency(this.config.numPoints);
        const t = freq * freq;
        const faces = 10 * t + 2;
        return [
            {
                type: 'select',
                id: 'sfm_topology',
                label: 'Topology',
                value: this.config.topologyMode,
                options: [
                    { value: 'soccer', label: 'Soccer Ball GP(1,1)' },
                    { value: 'goldberg', label: 'Goldberg GP(m,n)' }
                ],
                onChange: (v) => {
                    this.config.topologyMode = v;
                    this.reset();
                }
            },
            {
                type: 'info',
                label: 'Topology Info',
                value: isSoccer ? '12 Pentagons + 20 Hexagons (32 Faces)' : `Class-I Goldberg GP(${freq},0), T=${t}, Faces=${faces}`
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
                    { value: 'rainbow', label: '0. Monochrome' },
                    { value: 'basic', label: '1. Basic (Green/Pink)' },
                    { value: 'ocean', label: '2. Ocean (Cyan/Blue)' },
                    { value: 'sunset', label: '3. Sunset (Orange/Purple)' },
                    { value: 'neon', label: '4. Neon (Gray/Lime)' },
                    { value: 'rainbow-vivid', label: '5. Rainbow (Vivid)' }
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
                id: 'sm_face_count',
                label: 'Point Count',
                min: 50,
                max: 1000,
                step: 50,
                value: this.config.numPoints,
                live: false,
                onChange: (v) => {
                    this.config.numPoints = v;
                    if (this.config.topologyMode === 'goldberg') this.reset();
                }
            },
            {
                type: 'slider',
                id: 'sm_scale',
                label: 'Sphere Scale',
                min: 60,
                max: 140,
                step: 1,
                value: this.config.sphereScale,
                onChange: (v) => { this.config.sphereScale = v; this.draw(); }
            },
            {
                type: 'info',
                label: 'Effective Nodes',
                value: `${this.points.length || this.getEffectivePointCount()}`
            },
            { type: 'info', label: 'Walls', value: 'Dark Thick Boundaries' },
            { type: 'info', label: 'Roads', value: 'Bright Thin Corridors' },
            { type: 'info', label: 'Path Domain', value: 'Face-to-Face Traversal' },
            { type: 'info', label: 'Start (Green)', value: 'Automatically Set' },
            { type: 'info', label: 'Goal (Red)', value: 'Automatically Set' },
            { type: 'info', label: 'Manual Rotation', value: 'Drag to Spin Sphere' },
            { type: 'info', label: 'Maze Control', value: 'Use top Reset Maze + Go' }
        ];
    },

    reset() {
        this.stopSearchAnimation();
        this.clearSearchState();
        this.trackingHistory = [];
        this.trackingSmoothedPoint = null;
        this.trackingLocked = false;
        this.trackingVelX = 0;
        this.trackingVelY = 0;
        this.vividCacheDirty = true;
        
        this.generateTopology();
        this.generateMaze();
        this.pickPolarEndpoints();
        
        this.draw();
    },

    generateTopology() {
        const isGoldberg = this.config.topologyMode === 'goldberg';
        const topology = isGoldberg
            ? this.generateGoldbergTopology(this.getGoldbergFrequency(this.config.numPoints))
            : this.generateSoccerBallTopology();
        this.points = topology.points;
        this.neighbors = topology.neighbors;
        if (isGoldberg) {
            // Preserve Goldberg dual-cell geometry from topology generation.
            // We only derive ordered edge-neighbor indices for wall rendering.
            const built = this.buildFaceCells(topology.points, topology.neighbors);
            this.faceCells = topology.faceCells;
            this.faceCellEdgeNeighbors = built.edgeNeighbors;
        } else {
            this.faceCells = topology.faceCells;
            this.faceCellEdgeNeighbors = topology.faceCellEdgeNeighbors || [];
        }
    },

    normalizePoint(v) {
        const len = Math.hypot(v.x, v.y, v.z) || 1;
        return { x: v.x / len, y: v.y / len, z: v.z / len };
    },

    buildFaceCells(points, neighbors) {
        const cells = Array.from({ length: points.length }, () => []);
        const edgeNeighbors = Array.from({ length: points.length }, () => []);
        const cross = (a, b) => ({
            x: a.y * b.z - a.z * b.y,
            y: a.z * b.x - a.x * b.z,
            z: a.x * b.y - a.y * b.x
        });
        const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            const ref = Math.abs(p.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
            let u = this.normalizePoint(cross(ref, p));
            let v = this.normalizePoint(cross(p, u));

            const ring = [];
            for (const nIdx of neighbors[i]) {
                const q = points[nIdx];
                const m = this.normalizePoint({ x: p.x + q.x, y: p.y + q.y, z: p.z + q.z });
                ring.push({ point: m, angle: Math.atan2(dot(m, v), dot(m, u)), neighborIdx: nIdx });
            }
            ring.sort((a, b) => a.angle - b.angle);
            cells[i] = ring.map((r) => r.point);
            edgeNeighbors[i] = ring.map((r) => r.neighborIdx);
        }
        return { cells, edgeNeighbors };
    },

    generateSoccerBallTopology() {
        const base = this.buildIcosahedron();
        const vertices = base.vertices;
        const faces = base.faces;
        const edgeSet = new Set();
        const vertexNeighbors = Array.from({ length: vertices.length }, () => new Set());

        const addEdge = (a, b) => {
            const key = a < b ? `${a}-${b}` : `${b}-${a}`;
            edgeSet.add(key);
            vertexNeighbors[a].add(b);
            vertexNeighbors[b].add(a);
        };

        for (const [a, b, c] of faces) {
            addEdge(a, b);
            addEdge(b, c);
            addEdge(c, a);
        }

        const truncatedVertices = [];
        const directedVertexIdx = new Map();
        const getDirectedVertex = (from, to) => {
            const key = `${from}->${to}`;
            if (directedVertexIdx.has(key)) return directedVertexIdx.get(key);
            const a = vertices[from];
            const b = vertices[to];
            // Truncation point near "from": true soccer-ball style corner cut.
            const p = this.normalizePoint({
                x: (2 * a.x + b.x) / 3,
                y: (2 * a.y + b.y) / 3,
                z: (2 * a.z + b.z) / 3
            });
            const idx = truncatedVertices.length;
            truncatedVertices.push(p);
            directedVertexIdx.set(key, idx);
            return idx;
        };

        const faceIndexLists = [];

        // 12 pentagons: one around each original icosahedron vertex.
        for (let i = 0; i < vertices.length; i++) {
            const ordered = this.orderNeighborsAroundVertex(i, vertices, Array.from(vertexNeighbors[i]));
            const pent = ordered.map((n) => getDirectedVertex(i, n));
            faceIndexLists.push(pent);
        }

        // 20 hexagons: one for each original icosahedron face.
        for (const [a, b, c] of faces) {
            faceIndexLists.push([
                getDirectedVertex(a, b),
                getDirectedVertex(b, a),
                getDirectedVertex(b, c),
                getDirectedVertex(c, b),
                getDirectedVertex(c, a),
                getDirectedVertex(a, c)
            ]);
        }

        const points = faceIndexLists.map((poly) => {
            let sx = 0;
            let sy = 0;
            let sz = 0;
            for (const vi of poly) {
                const p = truncatedVertices[vi];
                sx += p.x;
                sy += p.y;
                sz += p.z;
            }
            return this.normalizePoint({ x: sx, y: sy, z: sz });
        });

        const edgeSets = Array.from({ length: faceIndexLists.length }, () => new Set());
        const edgeToFace = new Map();
        const faceCellEdgeNeighbors = faceIndexLists.map((poly) => new Array(poly.length).fill(null));
        for (let fi = 0; fi < faceIndexLists.length; fi++) {
            const poly = faceIndexLists[fi];
            for (let i = 0; i < poly.length; i++) {
                const u = poly[i];
                const v = poly[(i + 1) % poly.length];
                const key = u < v ? `${u}-${v}` : `${v}-${u}`;
                if (edgeToFace.has(key)) {
                    const otherRef = edgeToFace.get(key);
                    const other = otherRef.faceIdx;
                    edgeSets[fi].add(other);
                    edgeSets[other].add(fi);
                    faceCellEdgeNeighbors[fi][i] = other;
                    faceCellEdgeNeighbors[other][otherRef.edgeIdx] = fi;
                } else {
                    edgeToFace.set(key, { faceIdx: fi, edgeIdx: i });
                }
            }
        }

        this.connectComponents(points, edgeSets);
        const neighbors = edgeSets.map((s) => Array.from(s));
        const faceCells = faceIndexLists.map((poly) => poly.map((vi) => truncatedVertices[vi]));
        return { points, neighbors, faceCells, faceCellEdgeNeighbors };
    },

    orderNeighborsAroundVertex(vertexIdx, vertices, neighbors) {
        const p = vertices[vertexIdx];
        const ref = Math.abs(p.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
        const cross = (a, b) => ({
            x: a.y * b.z - a.z * b.y,
            y: a.z * b.x - a.x * b.z,
            z: a.x * b.y - a.y * b.x
        });
        const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
        let u = cross(ref, p);
        u = this.normalizePoint(u);
        let v = cross(p, u);
        v = this.normalizePoint(v);

        const around = neighbors.map((nIdx) => {
            const q = vertices[nIdx];
            const radial = dot(q, p);
            const t = this.normalizePoint({
                x: q.x - p.x * radial,
                y: q.y - p.y * radial,
                z: q.z - p.z * radial
            });
            return {
                idx: nIdx,
                angle: Math.atan2(dot(t, v), dot(t, u))
            };
        });
        around.sort((a, b) => a.angle - b.angle);
        return around.map((n) => n.idx);
    },

    buildNearestNeighborGraph(pts, neighborCount = 6) {
        const n = pts.length;
        const neighbors = Array.from({ length: n }, () => []);
        for (let i = 0; i < n; i++) {
            const dists = [];
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                const d = (pts[i].x - pts[j].x)**2 + (pts[i].y - pts[j].y)**2 + (pts[i].z - pts[j].z)**2;
                dists.push({ idx: j, d });
            }
            dists.sort((a, b) => a.d - b.d);
            for (let k = 0; k < Math.min(neighborCount, dists.length); k++) {
                const neighborIdx = dists[k].idx;
                if (!neighbors[i].includes(neighborIdx)) neighbors[i].push(neighborIdx);
                if (!neighbors[neighborIdx].includes(i)) neighbors[neighborIdx].push(i);
            }
        }
        return neighbors;
    },

    buildSphericalVoronoiGraph(pts) {
        const n = pts.length;
        if (n <= 1) return Array.from({ length: n }, () => []);
        const edgeSets = Array.from({ length: n }, () => new Set());
        const addEdge = (a, b) => {
            if (a === b || a < 0 || b < 0 || a >= n || b >= n) return;
            edgeSets[a].add(b);
            edgeSets[b].add(a);
        };

        const projections = [
            ['x', 'y'],
            ['y', 'z'],
            ['z', 'x']
        ];

        if (typeof Delaunator !== 'undefined') {
            for (const [a, b] of projections) {
                const coords = new Float64Array(n * 2);
                for (let i = 0; i < n; i++) {
                    coords[i * 2] = pts[i][a];
                    coords[i * 2 + 1] = pts[i][b];
                }
                const delaunay = new Delaunator(coords);
                for (let e = 0; e < delaunay.halfedges.length; e++) {
                    const p = delaunay.triangles[e];
                    const q = delaunay.triangles[e % 3 === 2 ? e - 2 : e + 1];
                    addEdge(p, q);
                }
            }
        }

        const maxAngle = Math.min(1.2, Math.max(0.45, 12 / Math.sqrt(Math.max(4, n))));
        const minDot = Math.cos(maxAngle);
        for (let i = 0; i < n; i++) {
            for (const j of Array.from(edgeSets[i])) {
                if (i >= j) continue;
                const dot = pts[i].x * pts[j].x + pts[i].y * pts[j].y + pts[i].z * pts[j].z;
                if (dot < minDot) {
                    edgeSets[i].delete(j);
                    edgeSets[j].delete(i);
                }
            }
        }

        const sparseGraph = edgeSets.every(s => s.size < 2);
        if (sparseGraph) this.addNearestNeighborFallback(pts, edgeSets, 6);

        this.connectComponents(pts, edgeSets);
        return edgeSets.map(s => Array.from(s));
    },

    addNearestNeighborFallback(pts, edgeSets, count = 6) {
        for (let i = 0; i < pts.length; i++) {
            const dists = [];
            for (let j = 0; j < pts.length; j++) {
                if (i === j) continue;
                const d = (pts[i].x - pts[j].x) ** 2 + (pts[i].y - pts[j].y) ** 2 + (pts[i].z - pts[j].z) ** 2;
                dists.push({ idx: j, d });
            }
            dists.sort((a, b) => a.d - b.d);
            for (let k = 0; k < Math.min(count, dists.length); k++) {
                const j = dists[k].idx;
                edgeSets[i].add(j);
                edgeSets[j].add(i);
            }
        }
    },

    findComponents(edgeSets) {
        const n = edgeSets.length;
        const visited = new Array(n).fill(false);
        const components = [];

        for (let i = 0; i < n; i++) {
            if (visited[i]) continue;
            const comp = [];
            const stack = [i];
            visited[i] = true;
            while (stack.length > 0) {
                const curr = stack.pop();
                comp.push(curr);
                for (const next of edgeSets[curr]) {
                    if (!visited[next]) {
                        visited[next] = true;
                        stack.push(next);
                    }
                }
            }
            components.push(comp);
        }
        return components;
    },

    connectComponents(pts, edgeSets) {
        let components = this.findComponents(edgeSets);
        if (components.length <= 1) return;

        while (components.length > 1) {
            const base = components[0];
            let bestA = -1;
            let bestB = -1;
            let bestDot = -Infinity;

            for (let c = 1; c < components.length; c++) {
                for (const a of base) {
                    for (const b of components[c]) {
                        const dot = pts[a].x * pts[b].x + pts[a].y * pts[b].y + pts[a].z * pts[b].z;
                        if (dot > bestDot) {
                            bestDot = dot;
                            bestA = a;
                            bestB = b;
                        }
                    }
                }
            }

            if (bestA === -1 || bestB === -1) break;
            edgeSets[bestA].add(bestB);
            edgeSets[bestB].add(bestA);
            components = this.findComponents(edgeSets);
        }
    },

    getEffectivePointCount() {
        if (this.config.topologyMode === 'soccer') return 32;
        const freq = this.getGoldbergFrequency(this.config.numPoints);
        const t = freq * freq;
        return 10 * t + 2;
    },

    getGoldbergFrequency(targetCount) {
        const target = Math.max(12, Math.floor(targetCount || 12));
        const frequencies = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        let bestFreq = 1;
        let bestDiff = Infinity;
        for (const freq of frequencies) {
            const faceCount = 10 * freq * freq + 2;
            const diff = Math.abs(faceCount - target);
            if (diff < bestDiff) {
                bestDiff = diff;
                bestFreq = freq;
            }
        }
        return bestFreq;
    },

    generateGoldbergTopology(frequency) {
        const base = this.buildIcosahedron();
        const geo = this.buildIcosphereByFrequency(base.vertices, base.faces, frequency);
        const points = geo.vertices.map((v) => ({ x: v.x, y: v.y, z: v.z }));
        const triangles = geo.faces;

        const edgeSets = Array.from({ length: points.length }, () => new Set());
        const incidentTriangles = Array.from({ length: points.length }, () => []);

        const addEdge = (a, b) => {
            if (a === b) return;
            edgeSets[a].add(b);
            edgeSets[b].add(a);
        };

        const triCentroids = triangles.map(([a, b, c]) => {
            const pa = points[a];
            const pb = points[b];
            const pc = points[c];
            return this.normalizePoint({
                x: (pa.x + pb.x + pc.x) / 3,
                y: (pa.y + pb.y + pc.y) / 3,
                z: (pa.z + pb.z + pc.z) / 3
            });
        });

        for (let ti = 0; ti < triangles.length; ti++) {
            const [a, b, c] = triangles[ti];
            addEdge(a, b);
            addEdge(b, c);
            addEdge(c, a);
            incidentTriangles[a].push(ti);
            incidentTriangles[b].push(ti);
            incidentTriangles[c].push(ti);
        }

        const faceCells = Array.from({ length: points.length }, () => []);
        const cross = (a, b) => ({
            x: a.y * b.z - a.z * b.y,
            y: a.z * b.x - a.x * b.z,
            z: a.x * b.y - a.y * b.x
        });
        const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            const ref = Math.abs(p.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
            const u = this.normalizePoint(cross(ref, p));
            const v = this.normalizePoint(cross(p, u));
            const ring = incidentTriangles[i].map((ti) => {
                const c = triCentroids[ti];
                const radial = dot(c, p);
                const t = this.normalizePoint({
                    x: c.x - p.x * radial,
                    y: c.y - p.y * radial,
                    z: c.z - p.z * radial
                });
                return {
                    point: c,
                    angle: Math.atan2(dot(t, v), dot(t, u))
                };
            });
            ring.sort((a, b) => a.angle - b.angle);
            faceCells[i] = ring.map((r) => r.point);
        }

        this.connectComponents(points, edgeSets);
        return { points, neighbors: edgeSets.map((s) => Array.from(s)), faceCells };
    },

    buildIcosphereByFrequency(baseVertices, baseFaces, frequency) {
        const f = Math.max(1, Math.floor(frequency));
        if (f === 1) {
            return {
                vertices: baseVertices.map((v) => ({ x: v.x, y: v.y, z: v.z })),
                faces: baseFaces.map((tri) => [tri[0], tri[1], tri[2]])
            };
        }

        const vertices = [];
        const vertexMap = new Map();
        const faces = [];

        const addVertex = (x, y, z) => {
            const n = this.normalizePoint({ x, y, z });
            const key = `${Math.round(n.x * 1e6)}_${Math.round(n.y * 1e6)}_${Math.round(n.z * 1e6)}`;
            if (vertexMap.has(key)) return vertexMap.get(key);
            const idx = vertices.length;
            vertices.push(n);
            vertexMap.set(key, idx);
            return idx;
        };

        for (const [ia, ib, ic] of baseFaces) {
            const a = baseVertices[ia];
            const b = baseVertices[ib];
            const c = baseVertices[ic];
            const grid = [];

            for (let i = 0; i <= f; i++) {
                const row = [];
                for (let j = 0; j <= f - i; j++) {
                    const k = f - i - j;
                    const x = (a.x * i + b.x * j + c.x * k) / f;
                    const y = (a.y * i + b.y * j + c.y * k) / f;
                    const z = (a.z * i + b.z * j + c.z * k) / f;
                    row.push(addVertex(x, y, z));
                }
                grid.push(row);
            }

            for (let i = 0; i < f; i++) {
                for (let j = 0; j < f - i; j++) {
                    const v1 = grid[i][j];
                    const v2 = grid[i + 1][j];
                    const v3 = grid[i][j + 1];
                    faces.push([v1, v2, v3]);
                    if (j < f - i - 1) {
                        const v4 = grid[i + 1][j + 1];
                        faces.push([v2, v4, v3]);
                    }
                }
            }
        }

        return { vertices, faces };
    },

    buildIcosahedron() {
        const t = (1 + Math.sqrt(5)) / 2;
        const raw = [
            { x: -1, y: t, z: 0 }, { x: 1, y: t, z: 0 }, { x: -1, y: -t, z: 0 }, { x: 1, y: -t, z: 0 },
            { x: 0, y: -1, z: t }, { x: 0, y: 1, z: t }, { x: 0, y: -1, z: -t }, { x: 0, y: 1, z: -t },
            { x: t, y: 0, z: -1 }, { x: t, y: 0, z: 1 }, { x: -t, y: 0, z: -1 }, { x: -t, y: 0, z: 1 }
        ];

        const vertices = raw.map((v) => {
            const len = Math.hypot(v.x, v.y, v.z) || 1;
            return { x: v.x / len, y: v.y / len, z: v.z / len };
        });

        const faces = [
            [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
            [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
            [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
            [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
        ];
        return { vertices, faces };
    },

    subdivideIcosahedron(vertices, faces) {
        const newVertices = vertices.slice();
        const midpointCache = new Map();

        const midpointIndex = (i, j) => {
            const key = i < j ? `${i}-${j}` : `${j}-${i}`;
            const cached = midpointCache.get(key);
            if (cached !== undefined) return cached;
            const a = newVertices[i];
            const b = newVertices[j];
            const mx = (a.x + b.x) * 0.5;
            const my = (a.y + b.y) * 0.5;
            const mz = (a.z + b.z) * 0.5;
            const len = Math.hypot(mx, my, mz) || 1;
            const idx = newVertices.length;
            newVertices.push({ x: mx / len, y: my / len, z: mz / len });
            midpointCache.set(key, idx);
            return idx;
        };

        const newFaces = [];
        for (const [a, b, c] of faces) {
            const ab = midpointIndex(a, b);
            const bc = midpointIndex(b, c);
            const ca = midpointIndex(c, a);
            newFaces.push([a, ab, ca]);
            newFaces.push([b, bc, ab]);
            newFaces.push([c, ca, bc]);
            newFaces.push([ab, bc, ca]);
        }

        return { vertices: newVertices, faces: newFaces };
    },

    pickPolarEndpoints() {
        if (!this.points || this.points.length === 0) {
            this.startNodeIdx = 0;
            this.goalNodeIdx = 0;
            return;
        }
        let maxY = -Infinity;
        let minY = Infinity;
        let maxIdx = 0;
        let minIdx = 0;
        for (let i = 0; i < this.points.length; i++) {
            const y = this.points[i].y;
            if (y > maxY) {
                maxY = y;
                maxIdx = i;
            }
            if (y < minY) {
                minY = y;
                minIdx = i;
            }
        }
        this.startNodeIdx = maxIdx;
        this.goalNodeIdx = minIdx;
    },

    generateMaze() {
        this.walls = new Set();
        this.faceColors = new Map(); // Restore visual colors
        const numFaces = this.points.length;
        for (let i = 0; i < numFaces; i++) this.walls.add(i);

        // Visual: Color 50% of cells randomly (복구)
        const indices = Array.from({ length: numFaces }, (_, i) => i);
        for (let i = indices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [indices[i], indices[j]] = [indices[j], indices[i]];
        }
        for (let i = 0; i < Math.floor(numFaces * 0.5); i++) {
            this.faceColors.set(indices[i], this.vividColorForSeed(indices[i]));
        }



        // 1. Distance-2 Neighbors Map
        const d2Map = new Array(numFaces).fill(0).map(() => []);
        for (let i = 0; i < numFaces; i++) {
            for (const n1 of this.neighbors[i]) {
                for (const n2 of this.neighbors[n1]) {
                    if (n2 !== i && !this.neighbors[i].includes(n2)) {
                        d2Map[i].push({ next: n2, bridge: n1 });
                    }
                }
            }
        }

        // 2. Randomized DFS on Faces (D2 Jumps)
        const visitedNodes = new Set();
        const start = 0;
        const stack = [start];
        visitedNodes.add(start);
        this.walls.delete(start);

        while (stack.length > 0) {
            const current = stack[stack.length - 1];
            const options = d2Map[current].filter(opt => !visitedNodes.has(opt.next));

            if (options.length > 0) {
                const o = options[Math.floor(Math.random() * options.length)];
                this.walls.delete(o.bridge);
                this.walls.delete(o.next);
                visitedNodes.add(o.next);
                stack.push(o.next);
            } else {
                stack.pop();
            }
        }
        
        // Final punch: ensure entry and exit are NOT walls
        if (this.startNodeIdx !== null) this.walls.delete(this.startNodeIdx);
        if (this.goalNodeIdx !== null) this.walls.delete(this.goalNodeIdx);
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
            return !this.walls.has(n);
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
            const step = Math.ceil(Math.pow(this.config.solutionSpeed / 25, 2) * 0.5);
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

        // Grab-style drag: sphere follows pointer direction.
        this.rotY += dx * 0.005;
        this.rotX -= dy * 0.005;
        this.clampPitch();
        this.draw();
    },

    clampPitch() {
        const lim = Math.PI * 0.49;
        if (this.rotX > lim) this.rotX = lim;
        if (this.rotX < -lim) this.rotX = -lim;
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

    nearestSeedIndex(v, rotatedSeeds) {
        let best = 0;
        let bestDot = -Infinity;
        for (let i = 0; i < rotatedSeeds.length; i++) {
            const s = rotatedSeeds[i];
            const dot = v.x * s.x + v.y * s.y + v.z * s.z;
            if (dot > bestDot) {
                bestDot = dot;
                best = i;
            }
        }
        return best;
    },

    vividColorForSeed(index, alpha = 1) {
        const hue = (index * 137.5) % 360;
        const a = Math.max(0, Math.min(1, alpha));
        return `hsla(${hue.toFixed(1)}, 88%, 62%, ${a})`;
    },

    draw() {
        if (!this.ctx || !this.points || this.points.length === 0) return;
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;
        const cx = width / 2;
        const cy = height / 2;
        const scale = Math.max(0.6, Math.min(1.4, (this.config.sphereScale || 100) / 100));
        const r = Math.min(width, height) * 0.4 * scale;
        const renderTheme = this.themes[this.config.theme] || this.themes.basic;
        const isRainbowVivid = this.config.theme === 'rainbow-vivid';

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#1e1e1e';
        ctx.fillRect(0, 0, width, height);

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

        const visiblePath = new Set(this.path.slice(0, this.pathProgress));
        const frontierSet = new Set(this.frontier);


        // Draw sphere body.
        const grad = ctx.createRadialGradient(
            cx - r * 0.22,
            cy - r * 0.28,
            r * 0.08,
            cx,
            cy,
            r
        );
        // Body: Completely transparent (as requested)
        grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();

        // Build projected face-cell polygons.
        const projectedCells = this.faceCells.map((cell, idx) => {
            const verts = cell.map((v) => {
                const rot = this.rotatePoint(v, this.rotX, this.rotY);
                return {
                    x: cx + rot.x * r,
                    y: cy + rot.y * r,
                    z: rot.z
                };
            });
            const avgZ = verts.length > 0
                ? verts.reduce((sum, p) => sum + p.z, 0) / verts.length
                : -1;
            return { idx, verts, avgZ };
        })
            .filter((cell) => cell.verts.length >= 3 && cell.avgZ > -0.55)
            .sort((a, b) => a.avgZ - b.avgZ);

        // Face-domain rendering: each traversable state fills a face-cell.
        for (const cell of projectedCells) {
            const center = projected[cell.idx];
            const depthAlpha = Math.max(0.12, Math.min(0.95, cell.avgZ + 0.72));

            let fillStyle = null;
            let alpha = depthAlpha;
            if (visiblePath.has(cell.idx)) {
                fillStyle = renderTheme.path;
                alpha = Math.min(1, depthAlpha * 1.0);
            } else if (cell.idx === this.currentIdx) {
                fillStyle = renderTheme.current;
                alpha = Math.min(1, depthAlpha * 1.0);
            } else if (this.explored.has(cell.idx)) {
                fillStyle = renderTheme.explored;
                alpha = Math.min(0.92, depthAlpha * 0.88);
            } else if (frontierSet.has(cell.idx)) {
                fillStyle = renderTheme.frontier;
                alpha = Math.min(0.9, depthAlpha * 0.82);
            } else if (this.faceColors && this.faceColors.has(cell.idx)) {
                // FIXED: Restore the 50% random colors the user saw
                fillStyle = this.faceColors.get(cell.idx);
                alpha = 0.9;
            } else if (this.walls.has(cell.idx)) {
                fillStyle = renderTheme.wall;
                alpha = 1.0; 
            } else {
                fillStyle = 'rgba(0, 0, 0, 0)'; 
                alpha = 0;
            }

            ctx.globalAlpha = alpha;
            ctx.beginPath();
            ctx.moveTo(cell.verts[0].x, cell.verts[0].y);
            for (let i = 1; i < cell.verts.length; i++) {
                ctx.lineTo(cell.verts[i].x, cell.verts[i].y);
            }
            ctx.closePath();
            ctx.fillStyle = fillStyle;
            ctx.fill();

            ctx.globalAlpha = Math.max(0.2, depthAlpha * 0.34);
            ctx.strokeStyle = 'rgba(26, 28, 34, 0.85)';
            ctx.lineWidth = 0.7;
            ctx.stroke();

            // Preserve clear start/goal anchors.
            if ((cell.idx === this.startNodeIdx || cell.idx === this.goalNodeIdx) && center && center.z > -0.3) {
                ctx.globalAlpha = 1;
                ctx.beginPath();
                ctx.arc(center.x, center.y, 4.2, 0, Math.PI * 2);
                ctx.fillStyle = cell.idx === this.startNodeIdx ? renderTheme.start : renderTheme.goal;
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1.4;
                ctx.stroke();
            }
        }
        ctx.globalAlpha = 1.0;

        // Face boundaries: Consistent subtle lines (Hex style)
        for (const cell of projectedCells) {
            const edgeNeighbors = this.faceCellEdgeNeighbors[cell.idx] || [];
            const verts = cell.verts;
            if (verts.length < 2) continue;
            for (let e = 0; e < verts.length; e++) {
                const nIdx = edgeNeighbors[e];
                if (typeof nIdx !== 'number') continue;
                if (cell.idx >= nIdx) continue;

                const a = verts[e];
                const b = verts[(e + 1) % verts.length];
                const avgZ = (a.z + b.z) * 0.5;
                if (avgZ < -0.4) continue;

                ctx.globalAlpha = Math.max(0.15, Math.min(0.65, avgZ + 0.5));
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
                ctx.lineWidth = 0.5;
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();
            }
        }
        ctx.globalAlpha = 1.0;

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
        if (this.searchPaused) this.resumeSearch();
        else this.startSearchAnimation();
    },

    stop() {
        this.isCoreRunning = false;
        if (this.searchInProgress) this.pauseSearch();
        else this.stopSearchAnimation();
    },

    startPausedOnLoad: true,
    autoPlayOnReset: false,

    destroy() {
        this.stop();
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        this.canvas.removeEventListener('mousedown', this.handleMouseDown);
        window.removeEventListener('mousemove', this.handleMouseMove);
        window.removeEventListener('mouseup', this.handleMouseUp);
        if (this.pathAnimTimer) clearTimeout(this.pathAnimTimer);
    }
};

window.SphereFaceMazeCase = SphereFaceMazeCase;
