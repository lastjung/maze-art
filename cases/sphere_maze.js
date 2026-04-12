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
        sphereScale: 100,
        theme: 'ocean',
        speed: 30,
        solutionSpeed: 70, // Default path reveal speed
        sfxEnabled: true,
        sfxVolume: 0.3,
        audioMode: 'music', // New: 'music' or 'synth'
        searchMode: 'astar',
        autoTrack: true
    },
    sphereType: 'basic',

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
        return [
            {
                type: 'select',
                id: 'sm_shape',
                label: 'Sphere Type',
                value: this.sphereType || 'basic',
                options: [
                    { value: 'basic', label: 'Classic Sphere' },
                    { value: 'voronoi', label: 'Voronoi Sphere' },
                    { value: 'fibonacci', label: 'Fibonacci Sphere' },
                    { value: 'latlon', label: 'Lat-Lon Bands' },
                    { value: 'cube', label: 'Cube Projection' },
                    { value: 'soccer', label: 'Soccer Ball (Goldberg)' }
                ],
                onChange: (v) => {
                    this.sphereType = v;
                    this.reset();
                }
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
                id: 'sm_sound_engine',
                label: 'Sound Engine',
                value: this.config.audioMode,
                options: [
                    { value: 'music', label: 'Default Music' },
                    { value: 'synth', label: 'Algorithm Synth' },
                    { value: 'piano', label: 'Algorithm Piano' }
                ],
                onChange: (v) => {
                    this.config.audioMode = v;
                    if (v === 'synth' || v === 'piano') {
                        if (window.audioManager) window.audioManager.pause();
                        if (window.synthAudio) window.synthAudio.init();
                    } else {
                        if (window.audioManager) window.audioManager.resume();
                    }
                }
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
                max: 1.0,
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
        if (this.sphereType === 'soccer') {
            const topology = this.generateSoccerFaceTopology(this.config.numPoints);
            this.points = topology.points;
            this.neighbors = topology.neighbors;
            return;
        }

        const n = this.getEffectivePointCount();
        let pts;
        if (this.sphereType === 'latlon') pts = this.generateLatLonPoints(n);
        else if (this.sphereType === 'cube') pts = this.generateCubeProjectionPoints(n);
        else pts = this.generateFibonacciPoints(n);
        this.points = pts;

        if (this.sphereType === 'voronoi') this.neighbors = this.buildSphericalVoronoiGraph(pts);
        else this.neighbors = this.buildNearestNeighborGraph(pts, 6);
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
        const raw = Math.max(50, Math.floor(this.config.numPoints));
        if (this.sphereType === 'soccer') {
            const freq = this.getSoccerFrequency(raw);
            return 20 * freq * freq;
        }
        if (this.sphereType !== 'basic') return raw;
        // Basic mode intentionally keeps a coarser graph for a cleaner default look.
        return Math.max(80, Math.floor(raw * 0.62));
    },

    getSoccerFrequency(targetCount) {
        const target = Math.max(20, Math.floor(targetCount || 20));
        const frequencies = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        let bestFreq = 1;
        let bestDiff = Infinity;
        for (const freq of frequencies) {
            const faceCount = 20 * freq * freq;
            const diff = Math.abs(faceCount - target);
            if (diff < bestDiff) {
                bestDiff = diff;
                bestFreq = freq;
            }
        }
        return bestFreq;
    },

    generateFibonacciPoints(n) {
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
        return pts;
    },

    generateLatLonPoints(n) {
        const pts = [];
        const bands = Math.max(10, Math.round(Math.sqrt(n) * 1.4));
        for (let b = 0; b < bands; b++) {
            const v = (b + 0.5) / bands;
            const y = 1 - 2 * v;
            const r = Math.sqrt(Math.max(0, 1 - y * y));
            const around = Math.max(4, Math.round(2 * Math.PI * r * bands * 0.45));
            const phase = (b % 2) * (Math.PI / around);
            for (let j = 0; j < around; j++) {
                const theta = (j / around) * Math.PI * 2 + phase;
                pts.push({
                    x: Math.cos(theta) * r,
                    y,
                    z: Math.sin(theta) * r
                });
            }
        }
        // Allow the natural points to persist without truncation.
        // Truncating forces the south pole to vanish.
        while (pts.length < n) {
            const t = pts.length / Math.max(1, n - 1);
            const y = 1 - 2 * t;
            const r = Math.sqrt(Math.max(0, 1 - y * y));
            const theta = t * Math.PI * 12;
            pts.push({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r });
        }
        return pts;
    },

    generateCubeProjectionPoints(n) {
        const pts = [];
        const perFace = Math.max(2, Math.ceil(n / 6));
        const side = Math.max(2, Math.ceil(Math.sqrt(perFace)));
        const faces = [
            { axis: 'x', sign: 1 }, { axis: 'x', sign: -1 },
            { axis: 'y', sign: 1 }, { axis: 'y', sign: -1 },
            { axis: 'z', sign: 1 }, { axis: 'z', sign: -1 }
        ];

        for (const face of faces) {
            for (let iy = 0; iy < side; iy++) {
                for (let ix = 0; ix < side; ix++) {
                    const u = (ix + 0.5) / side * 2 - 1;
                    const v = (iy + 0.5) / side * 2 - 1;
                    let x = 0;
                    let y = 0;
                    let z = 0;
                    if (face.axis === 'x') { x = face.sign; y = u; z = v; }
                    else if (face.axis === 'y') { y = face.sign; x = u; z = v; }
                    else { z = face.sign; x = u; y = v; }

                    const len = Math.hypot(x, y, z) || 1;
                    pts.push({ x: x / len, y: y / len, z: z / len });
                }
            }
        }

        // Allow natural cube generation without truncation
        while (pts.length < n) {
            const t = pts.length / Math.max(1, n - 1);
            const y = 1 - 2 * t;
            const r = Math.sqrt(Math.max(0, 1 - y * y));
            const theta = t * Math.PI * 10;
            pts.push({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r });
        }
        return pts;
    },

    generateSoccerFaceTopology(targetCount) {
        const freq = this.getSoccerFrequency(targetCount);
        const base = this.buildIcosahedron();
        const subdivision = this.buildIcosphereByFrequency(base.vertices, base.faces, freq);
        const vertices = subdivision.vertices;
        const faces = subdivision.faces;

        const points = faces.map((face) => {
            const a = vertices[face[0]];
            const b = vertices[face[1]];
            const c = vertices[face[2]];
            const cx = (a.x + b.x + c.x) / 3;
            const cy = (a.y + b.y + c.y) / 3;
            const cz = (a.z + b.z + c.z) / 3;
            const len = Math.hypot(cx, cy, cz) || 1;
            return { x: cx / len, y: cy / len, z: cz / len };
        });

        const edgeSets = Array.from({ length: faces.length }, () => new Set());
        const edgeToFace = new Map();
        const addNeighbor = (f1, f2) => {
            if (f1 === f2 || f1 < 0 || f2 < 0) return;
            edgeSets[f1].add(f2);
            edgeSets[f2].add(f1);
        };

        for (let fi = 0; fi < faces.length; fi++) {
            const [a, b, c] = faces[fi];
            const edges = [[a, b], [b, c], [c, a]];
            for (const [u, v] of edges) {
                const key = u < v ? `${u}-${v}` : `${v}-${u}`;
                if (edgeToFace.has(key)) addNeighbor(fi, edgeToFace.get(key));
                else edgeToFace.set(key, fi);
            }
        }

        this.connectComponents(points, edgeSets);
        return { points, neighbors: edgeSets.map((s) => Array.from(s)) };
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
            const len = Math.hypot(x, y, z) || 1;
            const nx = x / len;
            const ny = y / len;
            const nz = z / len;
            const key = `${Math.round(nx * 1e6)}_${Math.round(ny * 1e6)}_${Math.round(nz * 1e6)}`;
            if (vertexMap.has(key)) return vertexMap.get(key);
            const idx = vertices.length;
            vertices.push({ x: nx, y: ny, z: nz });
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
        if (window.synthAudio) window.synthAudio.randomizeMelody();
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
        if (this.config.audioMode === 'piano' && window.synthAudio && this.currentNodeIndex !== -1) {
            const stepDelayMs = this.config.searchDelayMs;
            const durationSec = Math.max(0.05, stepDelayMs / 1000.0);
            window.synthAudio.triggerPianoNote(this.points[this.currentNodeIndex], this.config.sfxVolume, durationSec);
        } else if (this.config.audioMode === 'synth' && window.synthAudio && this.currentNodeIndex !== -1) {
            const stepDelayMs = this.config.searchDelayMs;
            const durationSec = Math.max(0.05, stepDelayMs / 1000.0);
            window.synthAudio.triggerNote(this.points[this.currentNodeIndex], this.config.sfxVolume, durationSec);
        } else {
            const dist = Math.sqrt((this.points[current].x - this.points[goal].x)**2 + (this.points[current].y - this.points[goal].y)**2 + (this.points[current].z - this.points[goal].z)**2);
            const freq = 300 + (1 - dist / 2) * 700;
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
        const isVoronoi = this.sphereType === 'voronoi';
        const isRainbowVivid = this.config.theme === 'rainbow-vivid';
        const theme = isRainbowVivid
            ? (MazeEngine.themes.ocean || MazeEngine.themes.rainbow)
            : (MazeEngine.themes[this.config.theme] || MazeEngine.themes.ocean);
        const renderTheme = theme;

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
        const rotatedSeeds = projected.map(p => p.rot);

        // Draw Sphere body with stronger contrast against dark background.
        const grad = ctx.createRadialGradient(
            cx - r * 0.22,
            cy - r * 0.28,
            r * 0.08,
            cx,
            cy,
            r
        );
        if (this.config.theme === 'rainbow' || this.config.theme === 'rainbow-vivid') {
            grad.addColorStop(0, 'rgba(40, 40, 40, 1.0)');
            grad.addColorStop(0.55, 'rgba(20, 20, 20, 1.0)');
            grad.addColorStop(1, 'rgba(0, 0, 0, 1.0)');
        } else if (this.config.theme === 'basic') {
            grad.addColorStop(0, 'rgba(120, 255, 150, 0.85)'); // Bright minty center
            grad.addColorStop(0.55, 'rgba(40, 200, 80, 0.8)');   // Vibrant middle green
            grad.addColorStop(1, 'rgba(10, 100, 30, 0.8)');      // Clean dark green edge
        } else if (this.config.theme === 'ocean') {
            grad.addColorStop(0, 'rgba(80, 200, 230, 0.85)');    // Bright soft cyan top
            grad.addColorStop(0.55, 'rgba(40, 150, 180, 0.8)');  // Medium teal
            grad.addColorStop(1, 'rgba(10, 80, 110, 0.8)');      // Distinct dark cyan edge
        } else if (this.config.theme === 'sunset') {
            grad.addColorStop(0, 'rgba(255, 200, 150, 0.85)');
            grad.addColorStop(0.55, 'rgba(255, 120, 60, 0.8)');
            grad.addColorStop(1, 'rgba(120, 20, 80, 0.8)');
        } else if (this.config.theme === 'neon') {
            grad.addColorStop(0, 'rgba(160, 160, 160, 0.85)');
            grad.addColorStop(0.55, 'rgba(80, 80, 80, 0.8)');
            grad.addColorStop(1, 'rgba(20, 20, 20, 0.8)');
        } else {
            grad.addColorStop(0, 'rgba(200, 200, 200, 0.85)');
            grad.addColorStop(0.55, 'rgba(100, 100, 100, 0.8)');
            grad.addColorStop(1, 'rgba(40, 40, 40, 0.8)');
        }
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();

        // 1. Draw Edges (Layered)
        ctx.lineCap = 'round';
        
        // Layer 1: Maze Paths (Only Open Edges)
        for (let i = 0; i < this.points.length; i++) {
            const p1 = projected[i];
            this.neighbors[i].forEach(nIdx => {
                if (i > nIdx) return;
                const edgeKey = i < nIdx ? `${i}-${nIdx}` : `${nIdx}-${i}`;
                const isOpen = this.openEdges.has(edgeKey);
                
                // If it's not an open path, don't draw it.
                if (!isOpen) return;

                const p2 = projected[nIdx];
                const avgZ = (p1.z + p2.z) / 2;
                if (avgZ < -0.4) return; // Occlusion

                ctx.beginPath();
                const alpha = Math.max(0.1, (avgZ + 0.5));
                ctx.globalAlpha = alpha;

                if (isVoronoi) {
            const useRainbow = this.config.theme === 'rainbow' || this.config.theme === 'rainbow-vivid';
                    ctx.strokeStyle = useRainbow ? this.vividColorForSeed(i, 1.0) : 'rgba(255, 255, 255, 0.95)';
                    ctx.lineWidth = 1.25;
                    ctx.globalAlpha = Math.min(1, alpha * 0.95);
                } else {
                    const useRainbow = this.config.theme === 'rainbow' || this.config.theme === 'rainbow-vivid';
                    ctx.strokeStyle = useRainbow ? this.vividColorForSeed(i, 1.0) : 'rgba(255, 255, 255, 0.45)';
                    ctx.lineWidth = 1.0;
                }

                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.stroke();
            });
        }
        
        // Layer 2: Search Tree (Explored Edges from parentMap)
        ctx.globalAlpha = 1.0;
        const useRainbowTree = this.config.theme === 'rainbow' || this.config.theme === 'rainbow-vivid';
        this.parentMap.forEach((parentIdx, childIdx) => {
            if (parentIdx === null) return;
            const p1 = projected[childIdx];
            const p2 = projected[parentIdx];
            const avgZ = (p1.z + p2.z) / 2;
            if (avgZ < -0.2) return; // Occlusion

            ctx.beginPath();
            ctx.strokeStyle = useRainbowTree ? '#FFFFFF' : renderTheme.explored;
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
            ctx.strokeStyle = renderTheme.current;
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
        if (isVoronoi) {
            // Draw subtle seeds so Voronoi structure reads as a tessellated surface.
            projected.forEach(p => {
                if (p.z < -0.02) return;
                const a = Math.max(0.18, Math.min(0.6, p.z + 0.35));
                ctx.globalAlpha = a;
                ctx.beginPath();
                ctx.arc(p.x, p.y, r * 0.0045, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(220, 235, 255, 0.95)';
                ctx.fill();
            });
            ctx.globalAlpha = 1.0;
        }
        projected.forEach(p => {
            if (p.z < -0.1) return;
            
            let fill = null;
            const pathIdx = this.path.indexOf(p.idx);
            if (pathIdx !== -1 && pathIdx < this.pathProgress) fill = renderTheme.path;
            else if (p.idx === this.currentIdx) fill = renderTheme.current;
            else if (this.explored.has(p.idx)) fill = useRainbowTree ? '#FFFFFF' : renderTheme.explored;
            else if (frontierSet.has(p.idx)) fill = renderTheme.frontier;

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
            ctx.fillStyle = idx === this.startNodeIdx ? renderTheme.start : renderTheme.goal;
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

window.SphereMazeCase = SphereMazeCase;
