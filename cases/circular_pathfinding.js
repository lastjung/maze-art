/**
 * Circular Obstacle Pathfinding Case
 * Logic based on Red Blob Games: https://redblobgames.github.io/circular-obstacle-pathfinding/
 */

const CircularPathfindingCase = {
    settingsStorageKey: 'circular_pathfinding_settings_v1',
    canvas: null,
    ctx: null,
    width: 0,
    height: 0,
    animationId: null,
    searchTimer: null,

    // Core Data
    obstacles: [],
    startNode: { x: 100, y: 100, r: 0 },
    goalNode: { x: 700, y: 500, r: 0 },
    nodes: [],
    edges: [],
    path: [],
    searchFrontier: [],
    searchBestDist: new Map(),
    searchPrev: new Map(),
    searchVisited: new Set(),
    searchFrontierSet: new Set(),
    currentSearchNode: null,
    searchStartRef: null,
    searchGoalRef: null,
    audioCtx: null,
    sfxEnabled: true,
    sfxVolume: 0.08,
    stepSoundTick: 0,
    lastStepSoundAt: 0,

    // Interaction State
    dragTarget: null,
    mouse: { x: 0, y: 0 },

    // Config
    config: {
        numObstacles: 16,
        minRadius: 30,
        maxRadius: 70,
        showGraph: true,
        showHugging: true,
        actorRadius: 10, // Minkowski expansion
        searchSpeedMs: 24
    },

    init() {
        this.canvas = document.getElementById('mathCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.loadSavedSettings();
        this.resize();
        this.reset({ pauseAfter: false });
        this.setupEvents();
    },

    resize() {
        const container = this.canvas.parentElement;
        this.width = container.clientWidth;
        this.height = container.clientHeight;
        this.canvas.width = this.width;
        this.canvas.height = this.height;
    },

    buildMazeCorridor() {
        const margin = 70;
        const left = margin;
        const right = this.width - margin;
        const top = margin;
        const bottom = this.height - margin;
        const midY = this.height * 0.5;

        const cols = Math.max(5, Math.min(11, Math.round(this.config.numObstacles / 3)));
        const stepX = (right - left) / (cols - 1);

        const points = [{ x: left, y: midY }];
        for (let i = 1; i < cols - 1; i++) {
            const x = left + i * stepX;
            const y = (i % 2 === 1) ? top : bottom;
            points.push({ x, y });
        }
        points.push({ x: right, y: midY });
        return points;
    },

    distancePointToPolyline(point, polyline) {
        let best = Infinity;
        for (let i = 0; i < polyline.length - 1; i++) {
            const d = this.distToSegment(point, polyline[i], polyline[i + 1]);
            if (d < best) best = d;
        }
        return best;
    },

    overlapsExisting(candidate, obstacles) {
        for (const obs of obstacles) {
            if (this.dist(candidate.x, candidate.y, obs.x, obs.y) < candidate.r + obs.r + 6) {
                return true;
            }
        }
        return false;
    },

    makeObstacle(x, y, r) {
        const h = Math.floor(Math.random() * 360);
        return {
            x,
            y,
            r,
            color: `hsl(${h}, 70%, 50%)`,
            glow: `hsl(${h}, 70%, 70%)`
        };
    },

    generateMazeObstacles(corridor) {
        const obstacles = [];
        const maxCount = this.config.numObstacles;
        const margin = 40;
        const left = margin;
        const right = this.width - margin;
        const top = margin;
        const bottom = this.height - margin;
        const minR = this.config.minRadius;
        const maxR = this.config.maxRadius;

        // Mandatory boundary blockers:
        // place circles along top/bottom so border-cheese paths are less likely.
        const mandatoryTotal = Math.min(maxCount, Math.max(6, Math.round(maxCount * 0.22)));
        const topCount = Math.floor(mandatoryTotal / 2);
        const bottomCount = mandatoryTotal - topCount;
        const placeBand = (count, yBase) => {
            if (count <= 0) return;
            const step = (right - left) / count;
            for (let i = 0; i < count && obstacles.length < maxCount; i++) {
                const x = left + step * (i + 0.5) + (Math.random() - 0.5) * step * 0.22;
                const y = yBase + (Math.random() - 0.5) * minR * 0.35;
                const r = (minR + Math.random() * (maxR - minR)) * 0.92;
                obstacles.push(this.makeObstacle(x, y, r));
            }
        };
        placeBand(topCount, top + minR * 0.55);
        placeBand(bottomCount, bottom - minR * 0.55);

        // Force-generate exactly requested count.
        // Overlap is allowed by design (user request).
        const endpointPadding = 16;
        let guard = 0;
        while (obstacles.length < maxCount && guard < maxCount * 200) {
            guard++;
            const r = minR + Math.random() * (maxR - minR);
            const candidate = this.makeObstacle(
                Math.random() * (right - left) + left,
                Math.random() * (bottom - top) + top,
                r
            );

            // Keep tiny space around start/goal so markers don't get fully buried.
            if (this.dist(candidate.x, candidate.y, this.startNode.x, this.startNode.y) < r + endpointPadding) continue;
            if (this.dist(candidate.x, candidate.y, this.goalNode.x, this.goalNode.y) < r + endpointPadding) continue;

            obstacles.push(candidate);
        }

        // Absolute fallback: if extremely unlucky with endpoint checks, fill remaining directly.
        while (obstacles.length < maxCount) {
            const r = minR + Math.random() * (maxR - minR);
            obstacles.push(this.makeObstacle(
                Math.random() * (right - left) + left,
                Math.random() * (bottom - top) + top,
                r
            ));
        }

        return obstacles;
    },

    setupEvents() {
        this.boundMouseDown = (e) => this.handleMouseDown(e);
        this.boundMouseMove = (e) => this.handleMouseMove(e);
        this.boundMouseUp = () => this.handleMouseUp();
        this.canvas.addEventListener('mousedown', this.boundMouseDown);
        this.canvas.addEventListener('mousemove', this.boundMouseMove);
        this.canvas.addEventListener('mouseup', this.boundMouseUp);
    },

    removeEvents() {
        if (!this.canvas) return;
        if (this.boundMouseDown) this.canvas.removeEventListener('mousedown', this.boundMouseDown);
        if (this.boundMouseMove) this.canvas.removeEventListener('mousemove', this.boundMouseMove);
        if (this.boundMouseUp) this.canvas.removeEventListener('mouseup', this.boundMouseUp);
        this.boundMouseDown = null;
        this.boundMouseMove = null;
        this.boundMouseUp = null;
    },

    handleMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Check Start/Goal
        if (this.dist(x, y, this.startNode.x, this.startNode.y) < 20) {
            this.dragTarget = this.startNode;
            return;
        }
        if (this.dist(x, y, this.goalNode.x, this.goalNode.y) < 20) {
            this.dragTarget = this.goalNode;
            return;
        }

        // Check Obstacles
        for (let obs of this.obstacles) {
            if (this.dist(x, y, obs.x, obs.y) < obs.r) {
                this.dragTarget = obs;
                break;
            }
        }
    },

    handleMouseMove(e) {
        if (!this.dragTarget) return;
        const rect = this.canvas.getBoundingClientRect();
        this.dragTarget.x = e.clientX - rect.left;
        this.dragTarget.y = e.clientY - rect.top;
        this.calculatePath();
    },

    handleMouseUp() {
        this.dragTarget = null;
    },

    dist(x1, y1, x2, y2) {
        return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    },

    // --- Pathfinding Logic ---

    buildVisibilityGraph() {
        this.nodes = [];
        this.edges = [];

        const expandedObstacles = this.obstacles.map((obs, idx) => ({
            ...obs,
            r: obs.r + this.config.actorRadius,
            originalIdx: idx
        }));

        // Add bitangents between all pairs of obstacles (plus Start and Goal)
        const entries = [
            { ...this.startNode, originalIdx: -1 }, 
            ...expandedObstacles, 
            { ...this.goalNode, originalIdx: -1 }
        ];
        
        for (let i = 0; i < entries.length; i++) {
            for (let j = i + 1; j < entries.length; j++) {
                const bitangents = this.getBitangents(entries[i], entries[j]);
                for (let edge of bitangents) {
                    if (!this.isBlocked(edge.p1, edge.p2, expandedObstacles)) {
                        this.addEdge(edge);
                    }
                }
            }
        }

        // Add hugging edges (arcs) if enabled
        if (this.config.showHugging) {
            expandedObstacles.forEach((obs, obsIdx) => {
                const obsNodes = this.nodes.filter(n => n.obsIdx === obsIdx);
                for (let i = 0; i < obsNodes.length; i++) {
                    for (let j = i + 1; j < obsNodes.length; j++) {
                        const p1 = obsNodes[i];
                        const p2 = obsNodes[j];
                        
                        let angle1 = Math.atan2(p1.y - obs.y, p1.x - obs.x);
                        let angle2 = Math.atan2(p2.y - obs.y, p2.x - obs.x);
                        let diff = Math.abs(angle1 - angle2);
                        if (diff > Math.PI) diff = 2 * Math.PI - diff;
                        
                        this.edges.push({
                            n1: p1, 
                            n2: p2, 
                            dist: diff * obs.r,
                            type: 'hugging'
                        });
                    }
                }
            });
        }

    },

    calculatePath() {
        this.buildVisibilityGraph();
        this.triggerSearch();
    },

    isCoreRunning() {
        return typeof Core !== 'undefined' ? !!Core.isRunning : true;
    },

    clearSearchVisuals() {
        this.path = [];
        this.searchFrontier = [];
        this.searchBestDist = new Map();
        this.searchPrev = new Map();
        this.searchVisited = new Set();
        this.searchFrontierSet = new Set();
        this.currentSearchNode = null;
        this.searchStartRef = null;
        this.searchGoalRef = null;
        this.stepSoundTick = 0;
        this.lastStepSoundAt = 0;
    },

    ensureAudioContext() {
        if (!this.sfxEnabled) return null;
        if (!this.audioCtx) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return null;
            this.audioCtx = new Ctx();
        }
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume().catch(() => {});
        }
        return this.audioCtx;
    },

    playTone(freq, durationSec, type = 'sine', volumeMul = 1) {
        const ctx = this.ensureAudioContext();
        if (!ctx || this.sfxVolume <= 0) return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        const peak = Math.max(0.0001, Math.min(1, this.sfxVolume * volumeMul));
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(peak, now + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + durationSec + 0.01);
    },

    playStepSound() {
        if (!this.sfxEnabled) return;
        const now = performance.now();
        if (now - this.lastStepSoundAt < 45) return;
        this.lastStepSoundAt = now;
        this.stepSoundTick += 1;
        if (this.stepSoundTick % 2 !== 0) return;
        const pitch = 220 + (this.stepSoundTick % 8) * 20;
        this.playTone(pitch, 0.045, 'triangle', 0.45);
    },

    playResultSound(found) {
        if (!this.sfxEnabled) return;
        if (found) {
            this.playTone(523.25, 0.12, 'sine', 0.9);
            setTimeout(() => this.playTone(659.25, 0.12, 'sine', 0.8), 90);
            setTimeout(() => this.playTone(783.99, 0.16, 'sine', 0.75), 170);
        } else {
            this.playTone(180, 0.16, 'sawtooth', 0.7);
        }
    },

    caseAudioLabel() {
        return 'SFX';
    },

    isCaseAudioMuted() {
        return !this.sfxEnabled;
    },

    toggleCaseAudio() {
        this.sfxEnabled = !this.sfxEnabled;
        this.saveSettings();
    },

    saveSettings() {
        try {
            localStorage.setItem(this.settingsStorageKey, JSON.stringify({
                numObstacles: this.config.numObstacles,
                actorRadius: this.config.actorRadius,
                searchSpeedMs: this.config.searchSpeedMs,
                sfxEnabled: this.sfxEnabled,
                sfxVolume: this.sfxVolume
            }));
        } catch (_) {}
    },

    loadSavedSettings() {
        try {
            const raw = localStorage.getItem(this.settingsStorageKey);
            if (!raw) return;
            const saved = JSON.parse(raw);
            if (typeof saved.numObstacles === 'number') this.config.numObstacles = Math.max(1, Math.min(64, Math.round(saved.numObstacles)));
            if (typeof saved.actorRadius === 'number') this.config.actorRadius = Math.max(0, Math.min(30, Math.round(saved.actorRadius)));
            if (typeof saved.searchSpeedMs === 'number') this.config.searchSpeedMs = Math.max(5, Math.min(200, Math.round(saved.searchSpeedMs)));
            if (typeof saved.sfxEnabled === 'boolean') this.sfxEnabled = saved.sfxEnabled;
            if (typeof saved.sfxVolume === 'number') this.sfxVolume = Math.max(0, Math.min(0.3, saved.sfxVolume));
        } catch (_) {}
    },

    stopSearchAnimation() {
        if (this.searchTimer) {
            clearTimeout(this.searchTimer);
            this.searchTimer = null;
        }
    },

    findStartGoalRefs() {
        const start = this.nodes.find(n => n.x === this.startNode.x && n.y === this.startNode.y);
        const goal = this.nodes.find(n => n.x === this.goalNode.x && n.y === this.goalNode.y);
        return { start, goal };
    },

    reconstructSearchPath(goalNode) {
        this.path = [];
        let current = goalNode;
        while (current) {
            this.path.push(current);
            current = this.searchPrev.get(current) || null;
        }
        this.path.reverse();
    },

    isPathCollisionFree(path) {
        if (!path || path.length < 2) return false;
        const expanded = this.obstacles.map(obs => ({
            x: obs.x,
            y: obs.y,
            r: obs.r + this.config.actorRadius
        }));

        for (let i = 0; i < path.length - 1; i++) {
            const a = path[i];
            const b = path[i + 1];
            for (const obs of expanded) {
                const d = this.distToSegment(obs, a, b);
                if (d < obs.r + 0.8) {
                    return false;
                }
            }
        }
        return true;
    },

    finishSearch(found) {
        this.stopSearchAnimation();
        if (found && this.searchGoalRef) {
            this.reconstructSearchPath(this.searchGoalRef);
            // Visibility-graph result can still look like tunneling in dense overlaps.
            // Validate the final polyline and fallback when needed.
            if (!this.isPathCollisionFree(this.path)) {
                const fallbackPath = this.findBestFallbackPath();
                this.path = fallbackPath.length > 1 ? fallbackPath : [];
            }
        } else {
            const fallbackPath = this.findBestFallbackPath();
            this.path = fallbackPath.length > 1 ? fallbackPath : [];
        }
        this.playResultSound(this.path.length > 1);
        this.currentSearchNode = null;
        this.draw();

        if (typeof Core !== 'undefined' && Core.currentCase === this && Core.isRunning) {
            Core.togglePlay();
        }
    },

    stepSearch() {
        while (this.searchFrontier.length > 0) {
            this.searchFrontier.sort((a, b) => a.dist - b.dist);
            const { node, dist } = this.searchFrontier.shift();
            this.searchFrontierSet.delete(node);

            if (this.searchVisited.has(node)) continue;
            this.currentSearchNode = node;
            this.searchVisited.add(node);
            this.playStepSound();

            if (node === this.searchGoalRef) {
                this.finishSearch(true);
                return;
            }

            const currentEdges = this.edges.filter(e => e.n1 === node || e.n2 === node);
            for (const edge of currentEdges) {
                const neighbor = edge.n1 === node ? edge.n2 : edge.n1;
                const newDist = dist + edge.dist;
                const oldDist = this.searchBestDist.get(neighbor);
                if (oldDist === undefined || newDist < oldDist) {
                    this.searchBestDist.set(neighbor, newDist);
                    this.searchPrev.set(neighbor, node);
                    this.searchFrontier.push({ node: neighbor, dist: newDist });
                    this.searchFrontierSet.add(neighbor);
                }
            }

            this.draw();
            this.searchTimer = setTimeout(() => this.stepSearch(), this.config.searchSpeedMs);
            return;
        }

        this.finishSearch(false);
    },

    startSearchAnimation() {
        this.stopSearchAnimation();
        this.clearSearchVisuals();
        const { start, goal } = this.findStartGoalRefs();
        this.searchStartRef = start;
        this.searchGoalRef = goal;
        if (!start || !goal) {
            this.draw();
            return;
        }

        this.searchBestDist.set(start, 0);
        this.searchPrev.set(start, null);
        this.searchFrontier.push({ node: start, dist: 0 });
        this.searchFrontierSet.add(start);
        this.draw();
        this.searchTimer = setTimeout(() => this.stepSearch(), this.config.searchSpeedMs);
    },

    triggerSearch() {
        if (this.isCoreRunning()) {
            this.startSearchAnimation();
        } else {
            this.stopSearchAnimation();
            this.clearSearchVisuals();
            this.draw();
        }
    },

    getBitangents(c1, c2) {
        const d = this.dist(c1.x, c1.y, c2.x, c2.y);
        const r1 = c1.r || 0;
        const r2 = c2.r || 0;
        
        if (d < Math.abs(r1 - r2) && d > 0.001) return []; // One inside another

        const results = [];
        const angleBetweenCenters = Math.atan2(c2.y - c1.y, c2.x - c1.x);

        // External Bitangents
        if (r1 > 0 && r2 > 0 && d > Math.abs(r1 - r2)) {
            const theta = Math.acos((r1 - r2) / d);
            for (let sign of [-1, 1]) {
                const alpha = angleBetweenCenters + sign * theta;
                results.push({
                    p1: { x: c1.x + Math.cos(alpha) * r1, y: c1.y + Math.sin(alpha) * r1, obsIdx: c1.originalIdx },
                    p2: { x: c2.x + Math.cos(alpha) * r2, y: c2.y + Math.sin(alpha) * r2, obsIdx: c2.originalIdx },
                    dist: d,
                    type: 'surfing'
                });
            }
        }

        // Internal Bitangents
        if (r1 > 0 && r2 > 0 && d > r1 + r2) {
            const theta = Math.acos((r1 + r2) / d);
            for (let sign of [-1, 1]) {
                const alpha1 = angleBetweenCenters + sign * theta;
                const alpha2 = alpha1 + Math.PI;
                results.push({
                    p1: { x: c1.x + Math.cos(alpha1) * r1, y: c1.y + Math.sin(alpha1) * r1, obsIdx: c1.originalIdx },
                    p2: { x: c2.x + Math.cos(alpha2) * r2, y: c2.y + Math.sin(alpha2) * r2, obsIdx: c2.originalIdx },
                    dist: Math.sqrt(d*d - (r1+r2)*(r1+r2)),
                    type: 'surfing'
                });
            }
        }

        // Handle case where one node is a point (radius 0)
        if (r1 === 0 || r2 === 0) {
            const r = r1 || r2;
            if (r === 0) {
                // Point to Point
                results.push({ p1: c1, p2: c2, dist: d, type: 'surfing' });
            } else {
                const center = r1 === 0 ? c2 : c1;
                const point = r1 === 0 ? c1 : c2;
                const distToCenter = this.dist(point.x, point.y, center.x, center.y);
                
                if (distToCenter > r) {
                    const theta = Math.acos(r / distToCenter);
                    const phi = Math.atan2(point.y - center.y, point.x - center.x);
                    for (let sign of [-1, 1]) {
                        const alpha = phi + sign * theta;
                        const tp = { 
                            x: center.x + Math.cos(alpha) * r, 
                            y: center.y + Math.sin(alpha) * r,
                            obsIdx: center.originalIdx 
                        };
                        results.push({
                            p1: r1 === 0 ? { ...point, obsIdx: -1 } : tp,
                            p2: r1 === 0 ? tp : { ...point, obsIdx: -1 },
                            dist: Math.sqrt(distToCenter*distToCenter - r*r),
                            type: 'surfing'
                        });
                    }
                }
            }
        }

        return results;
    },

    addEdge(edge) {
        // Find or create nodes
        const n1 = this.findOrCreateNode(edge.p1);
        const n2 = this.findOrCreateNode(edge.p2);
        this.edges.push({ n1, n2, dist: edge.dist, type: edge.type });
    },

    findOrCreateNode(p) {
        const threshold = 0.1;
        let node = this.nodes.find(n => this.dist(n.x, n.y, p.x, p.y) < threshold);
        if (!node) {
            node = { ...p, neighbors: [] };
            this.nodes.push(node);
        }
        return node;
    },

    isBlocked(p1, p2, obstacles) {
        // Prevent outer-boundary cheese paths by disallowing edges too close to screen borders.
        const boundaryMargin = this.config.actorRadius + 24;
        if (
            p1.x < boundaryMargin || p1.x > this.width - boundaryMargin ||
            p2.x < boundaryMargin || p2.x > this.width - boundaryMargin ||
            p1.y < boundaryMargin || p1.y > this.height - boundaryMargin ||
            p2.y < boundaryMargin || p2.y > this.height - boundaryMargin
        ) {
            return true;
        }

        for (let obs of obstacles) {
            // Allow touching the source/target obstacle of a tangent edge,
            // but block intersections with all other obstacles more strictly.
            if (obs.originalIdx === p1.obsIdx || obs.originalIdx === p2.obsIdx) {
                continue;
            }
            // Check if line p1-p2 is blocked by obs
            // Logic: distance from obs.center to line segment p1-p2
            const d = this.distToSegment(obs, p1, p2);
            if (d < obs.r + 0.6) return true;
        }
        return false;
    },

    distToSegment(p, v, w) {
        const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
        if (l2 === 0) return this.dist(p.x, p.y, v.x, v.y);
        let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        return this.dist(p.x, p.y, v.x + t * (w.x - v.x), v.y + t * (w.y - v.y));
    },

    findBestFallbackPath() {
        const factors = [1.0, 0.92, 0.84, 0.76, 0.68];
        for (const factor of factors) {
            const p = this.findGridFallbackPath(factor);
            if (p.length > 1) return p;
        }
        return [];
    },

    findGridFallbackPath(inflateFactor = 1.0) {
        const step = Math.max(12, Math.round(this.config.actorRadius * 1.6));
        const margin = this.config.actorRadius + 12;
        const minX = margin;
        const minY = margin;
        const maxX = this.width - margin;
        const maxY = this.height - margin;

        const cols = Math.max(2, Math.floor((maxX - minX) / step) + 1);
        const rows = Math.max(2, Math.floor((maxY - minY) / step) + 1);
        const toPoint = (gx, gy) => ({ x: minX + gx * step, y: minY + gy * step });
        const key = (gx, gy) => `${gx},${gy}`;

        const expanded = this.obstacles.map(obs => ({ x: obs.x, y: obs.y, r: obs.r + this.config.actorRadius }));
        const blocked = (x, y) => expanded.some(obs => this.dist(x, y, obs.x, obs.y) < obs.r * inflateFactor);
        const nearestCell = (p) => ({
            gx: Math.max(0, Math.min(cols - 1, Math.round((p.x - minX) / step))),
            gy: Math.max(0, Math.min(rows - 1, Math.round((p.y - minY) / step)))
        });
        const findNearestFree = (startCell) => {
            const q = [{ gx: startCell.gx, gy: startCell.gy }];
            let head = 0;
            const seen = new Set([key(startCell.gx, startCell.gy)]);
            const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
            while (head < q.length) {
                const cur = q[head++];
                const p = toPoint(cur.gx, cur.gy);
                if (!blocked(p.x, p.y)) return cur;
                for (const [dx, dy] of dirs) {
                    const nx = cur.gx + dx;
                    const ny = cur.gy + dy;
                    if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
                    const nk = key(nx, ny);
                    if (seen.has(nk)) continue;
                    seen.add(nk);
                    q.push({ gx: nx, gy: ny });
                }
            }
            return null;
        };

        let start = nearestCell(this.startNode);
        let goal = nearestCell(this.goalNode);
        start = findNearestFree(start);
        goal = findNearestFree(goal);
        if (!start || !goal) return [];
        const sPoint = toPoint(start.gx, start.gy);
        const gPoint = toPoint(goal.gx, goal.gy);
        if (blocked(sPoint.x, sPoint.y) || blocked(gPoint.x, gPoint.y)) return [];

        const dirs = [
            [1, 0], [-1, 0], [0, 1], [0, -1],
            [1, 1], [1, -1], [-1, 1], [-1, -1]
        ];

        const open = [{ gx: start.gx, gy: start.gy, f: 0 }];
        const gScore = new Map([[key(start.gx, start.gy), 0]]);
        const came = new Map();
        const heuristic = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

        while (open.length) {
            open.sort((a, b) => a.f - b.f);
            const cur = open.shift();
            if (cur.gx === goal.gx && cur.gy === goal.gy) {
                const points = [{ x: this.goalNode.x, y: this.goalNode.y }];
                let k = key(cur.gx, cur.gy);
                while (came.has(k)) {
                    const [gx, gy] = k.split(',').map(Number);
                    points.push(toPoint(gx, gy));
                    k = came.get(k);
                }
                points.push({ x: this.startNode.x, y: this.startNode.y });
                points.reverse();
                return points;
            }

            const curKey = key(cur.gx, cur.gy);
            const curG = gScore.get(curKey) ?? Infinity;

            for (const [dx, dy] of dirs) {
                const nx = cur.gx + dx;
                const ny = cur.gy + dy;
                if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
                const p = toPoint(nx, ny);
                if (blocked(p.x, p.y)) continue;

                const nk = key(nx, ny);
                const tentative = curG + Math.hypot(dx, dy);
                if (tentative >= (gScore.get(nk) ?? Infinity)) continue;

                came.set(nk, curKey);
                gScore.set(nk, tentative);
                const f = tentative + heuristic(nx, ny, goal.gx, goal.gy);
                open.push({ gx: nx, gy: ny, f });
            }
        }

        return [];
    },

    // --- Rendering ---

    start() {
        if (this.animationId) return;
        this.triggerSearch();
        const loop = () => {
            this.draw();
            this.animationId = requestAnimationFrame(loop);
        };
        loop();
    },

    stop() {
        this.stopSearchAnimation();
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    },

    draw() {
        this.ctx.clearRect(0, 0, this.width, this.height);

        // 1. Draw Grid/Graph (Optional)
        if (this.config.showGraph) {
            this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
            this.ctx.lineWidth = 1;
            for (let edge of this.edges) {
                this.ctx.beginPath();
                this.ctx.moveTo(edge.n1.x, edge.n1.y);
                this.ctx.lineTo(edge.n2.x, edge.n2.y);
                this.ctx.stroke();
            }
        }

        // Search progress points on graph
        if (this.searchVisited.size > 0 || this.searchFrontierSet.size > 0) {
            this.ctx.fillStyle = 'rgba(64, 196, 255, 0.85)';
            for (const node of this.searchVisited) {
                this.ctx.beginPath();
                this.ctx.arc(node.x, node.y, 3, 0, Math.PI * 2);
                this.ctx.fill();
            }

            this.ctx.fillStyle = 'rgba(80, 180, 255, 0.95)';
            for (const node of this.searchFrontierSet) {
                this.ctx.beginPath();
                this.ctx.arc(node.x, node.y, 4, 0, Math.PI * 2);
                this.ctx.fill();
            }
        }

        // 2. Draw Obstacles
        this.obstacles.forEach(obs => {
            // Minkowski Padding (Muted glow)
            this.ctx.beginPath();
            this.ctx.arc(obs.x, obs.y, obs.r + this.config.actorRadius, 0, Math.PI * 2);
            this.ctx.fillStyle = obs.glow.replace(')', ', 0.08)').replace('hsl', 'hsla');
            this.ctx.fill();

            // Real Obstacle
            this.ctx.beginPath();
            this.ctx.arc(obs.x, obs.y, obs.r, 0, Math.PI * 2);
            
            // Gradient fill for premium look
            const grad = this.ctx.createRadialGradient(obs.x - obs.r*0.3, obs.y - obs.r*0.3, obs.r*0.1, obs.x, obs.y, obs.r);
            grad.addColorStop(0, obs.glow);
            grad.addColorStop(1, obs.color);
            
            this.ctx.fillStyle = grad;
            this.ctx.fill();
            
            this.ctx.strokeStyle = 'rgba(0,0,0,0.2)';
            this.ctx.lineWidth = 1;
            this.ctx.stroke();
        });

        // 3. Draw Path
        if (this.path.length > 1) {
            this.ctx.beginPath();
            this.ctx.strokeStyle = '#29cc57';
            this.ctx.lineWidth = 4;
            this.ctx.setLineDash([]);
            this.ctx.moveTo(this.path[0].x, this.path[0].y);
            for (let i = 1; i < this.path.length; i++) {
                this.ctx.lineTo(this.path[i].x, this.path[i].y);
            }
            this.ctx.stroke();
        }

        // 4. Draw Start/Goal
        this.drawPoint(this.startNode, '#4CAF50', 'Start');
        this.drawPoint(this.goalNode, '#F44336', 'Goal');

        // Current step node highlight
        if (this.currentSearchNode) {
            this.ctx.beginPath();
            this.ctx.arc(this.currentSearchNode.x, this.currentSearchNode.y, 7, 0, Math.PI * 2);
            this.ctx.fillStyle = 'rgba(255, 42, 170, 0.95)';
            this.ctx.fill();
            this.ctx.strokeStyle = 'rgba(255, 210, 240, 1)';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();
        }
    },

    drawPoint(p, color, label) {
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
        this.ctx.fillStyle = color;
        this.ctx.fill();
        this.ctx.strokeStyle = '#fff';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();

        this.ctx.fillStyle = '#333';
        this.ctx.font = 'bold 14px Inter';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(label, p.x, p.y - 15);
    },

    get uiConfig() {
        return [
            {
                type: 'slider',
                id: 'cp_num_obs',
                label: 'Obstacles',
                min: 1,
                max: 64,
                step: 1,
                value: this.config.numObstacles,
                onChange: (v) => {
                    this.config.numObstacles = v;
                    this.saveSettings();
                    this.reset();
                }
            },
            {
                type: 'slider',
                id: 'cp_radius',
                label: 'Actor Radius',
                min: 0,
                max: 30,
                step: 2,
                value: this.config.actorRadius,
                onChange: (v) => {
                    this.config.actorRadius = v;
                    this.saveSettings();
                    this.calculatePath();
                }
            },
            {
                type: 'slider',
                id: 'cp_speed',
                label: 'Search Speed',
                min: 1,
                max: 40,
                step: 1,
                value: Math.max(1, Math.min(40, Math.round((205 - this.config.searchSpeedMs) / 5))),
                onChange: (v) => {
                    this.config.searchSpeedMs = 205 - v * 5;
                    this.saveSettings();
                }
            },
            {
                type: 'slider',
                id: 'cp_sfx',
                label: 'SFX Volume',
                min: 0,
                max: 0.3,
                step: 0.01,
                value: this.sfxVolume,
                onChange: (v) => {
                    this.sfxVolume = v;
                    this.saveSettings();
                }
            },
            {
                type: 'info',
                id: 'cp_info',
                label: 'Interaction',
                value: 'Drag Start/Goal/Circles'
            },
            {
                type: 'info',
                id: 'cp_info2',
                label: 'Maze Control',
                value: 'Use top Reset Maze + Go'
            }
        ];
    },

    autoPlayOnReset: false,
    startPausedOnLoad: true,

    reset({ pauseAfter = true } = {}) {
        this.obstacles = [];
        this.nodes = [];
        this.edges = [];
        this.path = [];

        const corridor = this.buildMazeCorridor();
        this.startNode = { x: corridor[0].x, y: corridor[0].y, r: 0 };
        this.goalNode = { x: corridor[corridor.length - 1].x, y: corridor[corridor.length - 1].y, r: 0 };
        this.obstacles = this.generateMazeObstacles(corridor);
        this.calculatePath();
        this.draw();

        if (pauseAfter && typeof Core !== 'undefined' && Core.isRunning) {
            Core.togglePlay();
        }
    },

    destroy() {
        this.stop();
        this.removeEvents();
        if (this.audioCtx) {
            this.audioCtx.close().catch(() => {});
            this.audioCtx = null;
        }
    }
};
