/**
 * SquareWaterMazeCase
 * Gravity-based water flow simulation on a rectangular grid.
 * - Prioritizes downward flow.
 * - Pressure builds up to allow upward/side overflow when paths are blocked.
 */
const SquareWaterMazeCase = {
    canvas: null,
    ctx: null,
    width: 0,
    height: 0,

    cols: 30,
    rows: 40,
    cellSize: 20,
    searchDelayMs: 20,
    colorTheme: 'ocean',
    gridShape: 'rectangle',
    sfxEnabled: true,
    sfxVolume: 0.1,

    grid: [],
    startNode: { x: 0, y: 0 },
    goalNode: { x: 0, y: 0 },

    frontierPQ: null,
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

    // Water flow specific states
    waterLevels: new Map(), // key -> 0.0-1.0
    pressures: new Map(),   // key -> 0.0+
    lastFlowTick: new Map(), // cellKey -> tick

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
                id: 'wat_shape',
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
                type: 'slider',
                id: 'wat_speed',
                label: 'Flow Speed',
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
                id: 'wat_grid',
                label: 'Density',
                min: 12,
                max: 60,
                step: 1,
                value: this.cols,
                live: false,
                onChange: (v) => {
                    this.cols = Math.floor(v);
                    this.reset();
                }
            },
            { type: 'info', label: 'Start (Top-Left)', value: 'Water Inlet' },
            { type: 'info', label: 'Goal (Bottom Line)', value: 'Catch Basin' },
            { type: 'info', label: 'Logic', value: 'Gravity + Pressure Overflow' }
        ];
    },

    caseAudioLabel() { return 'SFX'; },
    isCaseAudioMuted() { return !this.sfxEnabled; },
    toggleCaseAudio() { this.sfxEnabled = !this.sfxEnabled; },
    isCoreRunning() { return typeof Core !== 'undefined' ? !!Core.isRunning : true; },
    key(node) { return `${node.x},${node.y}`; },
    parseKey(k) { const [x, y] = k.split(',').map(Number); return { x, y }; },
    inBounds(x, y) { return x >= 0 && y >= 0 && x < this.cols && y < this.rows; },

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
        this.cellSize = Math.min(this.width / this.cols, this.height / this.rows) * 0.95;
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
                if (!this.inBounds(nx, ny) || visited.has(`${nx},${ny}`)) continue;
                options.push({ nx, ny, ...d });
            }
            if (!options.length) { stack.pop(); continue; }
            const pick = options[Math.floor(Math.random() * options.length)];
            this.grid[current.y][current.x].open |= pick.bit;
            this.grid[pick.ny][pick.nx].open |= pick.opp;
            visited.add(`${pick.nx},${pick.ny}`);
            stack.push({ x: pick.nx, y: pick.ny });
        }
        // Extra paths
        const extra = Math.floor(this.cols * this.rows * 0.08);
        for (let i = 0; i < extra; i++) {
            const x = Math.floor(Math.random() * this.cols);
            const y = Math.floor(Math.random() * this.rows);
            const d = dirs[Math.floor(Math.random() * 4)];
            const nx = x + d.dx, ny = y + d.dy;
            if (this.inBounds(nx, ny)) {
                this.grid[y][x].open |= d.bit;
                this.grid[ny][nx].open |= d.opp;
            }
        }
    },

    getNeighbors(node) {
        const N = 1, E = 2, S = 4, W = 8;
        const open = this.grid[node.y][node.x].open;
        const out = [];
        if (open & N) out.push({ x: node.x, y: node.y - 1, dir: 'up' });
        if (open & E) out.push({ x: node.x + 1, y: node.y, dir: 'side' });
        if (open & S) out.push({ x: node.x, y: node.y + 1, dir: 'down' });
        if (open & W) out.push({ x: node.x - 1, y: node.y, dir: 'side' });
        return out.filter(n => this.inBounds(n.x, n.y));
    },

    clearSearchState() {
        this.stopSearchAnimation();
        this.frontierPQ = null;
        this.frontierSet.clear();
        this.exploredSet.clear();
        this.cameFrom.clear();
        this.costSoFar.clear();
        this.waterLevels.clear();
        this.pressures.clear();
        this.lastFlowTick.clear();
        this.path = [];
        this.pathMap.clear();
        this.pathProgress = 0;
        this.currentNode = null;
        this.searchInProgress = false;
        this.searchPaused = false;
        this.stepSoundTick = 0;
        this.lastStepSoundAt = 0;
    },

    stopSearchAnimation() {
        if (this.searchTimer) { clearTimeout(this.searchTimer); this.searchTimer = null; }
        this.searchInProgress = false;
    },

    initializeSearch() {
        this.clearSearchState();
        this.totalSearchCount += 1;
        this.searchStartedAtMs = performance.now();
        const sKey = this.key(this.startNode);
        this.cameFrom.set(sKey, null);
        this.costSoFar.set(sKey, 0);
        this.pressures.set(sKey, 10.0); // Initial pressure at inlet

        this.frontierPQ = new PriorityQueue();
        this.frontierPQ.put(this.startNode, 0);
        this.frontierSet.add(sKey);
        this.searchInProgress = true;
    },

    playStepSound() {
        const now = performance.now();
        if (now - this.lastStepSoundAt < 40) return;
        this.lastStepSoundAt = now;
        this.stepSoundTick += 1;
        if (this.stepSoundTick % 2 !== 0) return;
        const pitch = 180 + (this.stepSoundTick % 12) * 12;
        MazeEngine.playTone(pitch, 0.04, 'sine', 0.3, 0.002, this);
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
        if (!this.searchInProgress || this.searchPaused) return;

        const activeKeys = Array.from(this.exploredSet).filter(k => (this.waterLevels.get(k) || 0) < 1.0);
        const frontierKeys = Array.from(this.frontierSet);
        const allRelevant = [...new Set([...activeKeys, ...frontierKeys])];

        if (allRelevant.length === 0 && this.frontierPQ.empty()) {
            this.finishSearch(false);
            return;
        }

        // --- 1. Fill & Pressure Update (Parallel-ish) ---
        for (const k of allRelevant) {
            let level = this.waterLevels.get(k) || 0;
            // Naturally fill active cells
            if (level < 1.0) {
                level += 0.15; // Base fill rate
                this.waterLevels.set(k, Math.min(1.0, level));
            }
            this.exploredSet.add(k);
            this.frontierSet.delete(k);
        }

        // --- 2. Horizontal Equalization (Pressure Leveling) ---
        const k_factor = 0.18;
        const currentLevels = new Map(this.waterLevels);
        for (const k of allRelevant) {
            const node = this.parseKey(k);
            const levelA = currentLevels.get(k) || 0;
            if (levelA <= 0) continue;

            // Only equalize with side neighbors for horizontal surface
            const neighbors = this.getNeighbors(node).filter(n => n.dir === 'side');
            for (const next of neighbors) {
                const nk = this.key(next);
                const levelB = currentLevels.get(nk) || 0;
                
                // Exchange flow: delta = (A - B) * k
                const delta = (levelA - levelB) * k_factor;
                this.waterLevels.set(k, (this.waterLevels.get(k) || 0) - delta);
                this.waterLevels.set(nk, (this.waterLevels.get(nk) || 0) + delta);
                
                if (this.waterLevels.get(nk) > 0.05) {
                    this.exploredSet.add(nk);
                    if (!this.cameFrom.has(nk)) this.cameFrom.set(nk, node);
                }
            }
        }

        // --- 3. Propagation (Level-centric Trigger) ---
        const nextFrontier = new Set();
        for (const k of Array.from(this.exploredSet)) {
            const level = this.waterLevels.get(k) || 0;
            if (level <= 0.05) continue;

            const node = this.parseKey(k);
            // Check Goal
            if (node.y === this.rows - 1) {
                this.goalNode = node;
                this.finishSearch(true);
                return;
            }

            const neighbors = this.getNeighbors(node);
            for (const next of neighbors) {
                const nk = this.key(next);
                if (this.waterLevels.get(nk) >= 0.98) continue;

                let canFlow = false;
                if (next.dir === 'down') {
                    canFlow = level >= 0.1; // Drops almost immediately
                } else if (next.dir === 'side') {
                    canFlow = level >= 0.6; // Needs to fill halfway to push side
                } else if (next.dir === 'up') {
                    // Upward: level >= 0.95 AND below is blocked or full
                    const belowOpen = (this.grid[node.y][node.x].open & 4);
                    const belowFull = !belowOpen || (this.waterLevels.get(this.key({x: node.x, y: node.y + 1})) >= 0.9);
                    canFlow = level >= 0.95 && belowFull;
                }

                if (canFlow) {
                    if (!this.exploredSet.has(nk)) {
                        nextFrontier.add(nk);
                        if (!this.cameFrom.has(nk)) this.cameFrom.set(nk, node);
                    }
                }
            }
        }

        for (const nk of nextFrontier) {
            this.frontierSet.add(nk);
            const node = this.parseKey(nk);
            this.frontierPQ.put(node, node.y); // Priority still helps a bit with ordering
        }

        this.playStepSound();
        this.draw();
        this.searchTimer = setTimeout(() => this.stepSearch(), this.searchDelayMs);
    },

    startPathAnimation() {
        this.pathProgress = 0;
        if (this.pathAnimTimer) clearTimeout(this.pathAnimTimer);
        this.animatePath();
    },

    animatePath() {
        if (this.pathProgress < this.path.length) {
            this.pathProgress += 2;
            this.pathAnimTimer = setTimeout(() => this.animatePath(), 30);
            this.draw();
        }
    },

    triggerSearch() {
        if (this.isCoreRunning()) this.startSearchAnimation();
        else { this.clearSearchState(); this.draw(); }
    },

    startSearchAnimation() {
        this.initializeSearch();
        this.draw();
        this.searchTimer = setTimeout(() => this.stepSearch(), this.searchDelayMs);
    },

    draw() {
        if (!this.ctx || !this.grid.length) return;
        const ctx = this.ctx;
        const ox = (this.width - this.cols * this.cellSize) * 0.5;
        const oy = (this.height - this.rows * this.cellSize) * 0.5;

        ctx.clearRect(0, 0, this.width, this.height);
        ctx.fillStyle = '#111827';
        ctx.fillRect(0, 0, this.width, this.height);

        // Grid Pass
        for (let y = 0; y < this.rows; y++) {
            for (let x = 0; x < this.cols; x++) {
                const k = `${x},${y}`;
                const px = ox + x * this.cellSize, py = oy + y * this.cellSize;
                const level = this.waterLevels.get(k) || 0;
                
                // Draw Cell Background
                ctx.fillStyle = 'rgba(255,255,255,0.03)';
                ctx.fillRect(px, py, this.cellSize, this.cellSize);

                if (level > 0) {
                    // Water Fill (Bottom-up)
                    const fillH = this.cellSize * level;
                    const grad = ctx.createLinearGradient(px, py, px, py + this.cellSize);
                    grad.addColorStop(0, '#3b82f6');
                    grad.addColorStop(1, '#1d4ed8');
                    ctx.fillStyle = grad;
                    ctx.fillRect(px, py + (this.cellSize - fillH), this.cellSize, fillH);

                    // Surface Highlight & Ripple
                    if (level < 1.0) {
                        const ripple = Math.sin(Date.now() * 0.01 + x * 0.5) * 1.2;
                        ctx.fillStyle = 'rgba(191,219,254,0.6)';
                        ctx.fillRect(px, py + (this.cellSize - fillH) + ripple, this.cellSize, 2);
                    }
                }
            }
        }

        // Walls Pass
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let y = 0; y < this.rows; y++) {
            for (let x = 0; x < this.cols; x++) {
                const c = this.grid[y][x], px = ox + x * this.cellSize, py = oy + y * this.cellSize;
                if (!(c.open & 1)) { ctx.moveTo(px, py); ctx.lineTo(px + this.cellSize, py); }
                if (!(c.open & 2)) { ctx.moveTo(px + this.cellSize, py); ctx.lineTo(px + this.cellSize, py + this.cellSize); }
                if (!(c.open & 4)) { ctx.moveTo(px, py + this.cellSize); ctx.lineTo(px + this.cellSize, py + this.cellSize); }
                if (!(c.open & 8)) { ctx.moveTo(px, py); ctx.lineTo(px, py + this.cellSize); }
            }
        }
        ctx.stroke();

        // Path Highlights
        if (this.path.length > 0 && this.pathProgress > 0) {
            ctx.beginPath();
            ctx.strokeStyle = '#60a5fa';
            ctx.lineWidth = 3;
            ctx.lineJoin = 'round';
            const limit = Math.min(this.path.length, this.pathProgress);
            for (let i = 0; i < limit; i++) {
                const p = this.path[i];
                const cx = ox + p.x * this.cellSize + this.cellSize * 0.5;
                const cy = oy + p.y * this.cellSize + this.cellSize * 0.5;
                if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
            }
            ctx.stroke();
        }

        this.drawHUD();
    },

    drawHUD() {
        const ctx = this.ctx;
        const liveMs = this.searchInProgress && this.searchStartedAtMs > 0 ? performance.now() - this.searchStartedAtMs + this.searchElapsedMs : this.searchElapsedMs;
        const format = (ms) => {
            const v = Math.max(0, ms);
            const m = Math.floor(v / 60000), s = Math.floor((v % 60000) / 1000), c = Math.floor((v % 1000) / 10);
            return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(c).padStart(2,'0')}`;
        };

        const hudX = this.width - 180, hudY = 20, hudW = 160, hudH = 90, r = 10;
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1.5;
        // Rounded Rect
        ctx.beginPath();
        ctx.moveTo(hudX+r, hudY); ctx.lineTo(hudX+hudW-r, hudY); ctx.quadraticCurveTo(hudX+hudW, hudY, hudX+hudW, hudY+r);
        ctx.lineTo(hudX+hudW, hudY+hudH-r); ctx.quadraticCurveTo(hudX+hudW, hudY+hudH, hudX+hudW-r, hudY+hudH);
        ctx.lineTo(hudX+r, hudH+hudY); ctx.quadraticCurveTo(hudX, hudY+hudH, hudX, hudY+hudH-r);
        ctx.lineTo(hudX, hudY+r); ctx.quadraticCurveTo(hudX, hudY, hudX+r, hudY);
        ctx.closePath();
        ctx.fill(); ctx.stroke();

        ctx.fillStyle = '#fff';
        ctx.font = '700 13px Inter';
        ctx.fillText('WATER FLOW SIM', hudX + 12, hudY + 22);
        ctx.font = '500 11px Inter';
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillText('FLOW TIME', hudX+12, hudY+42);
        ctx.fillStyle = '#3b82f6'; ctx.fillText(format(liveMs), hudX+85, hudY+42);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillText('FILLED', hudX+12, hudY+60);
        ctx.fillStyle = '#fff'; ctx.fillText(this.exploredSet.size, hudX+85, hudY+60);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillText('LAST VOL', hudX+12, hudY+78);
        ctx.fillStyle = '#fff'; ctx.fillText(this.lastEnteredCellCount, hudX+85, hudY+78);
        ctx.restore();
    },

    start() { if (this.searchPaused) this.resumeSearch(); else this.startSearchAnimation(); },
    stop() { this.stopSearchAnimation(); if (this.pathAnimTimer) clearTimeout(this.pathAnimTimer); },
    pauseSearch() { if (this.searchTimer) { clearTimeout(this.searchTimer); this.searchTimer = null; } this.searchPaused = true; },
    resumeSearch() { if (!this.searchPaused) return; this.searchPaused = false; this.searchInProgress = true; this.searchTimer = setTimeout(() => this.stepSearch(), this.searchDelayMs); },
    destroy() { this.stop(); }
};

window.SquareWaterMazeCase = SquareWaterMazeCase;
