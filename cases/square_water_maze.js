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
            { type: 'info', label: 'Goal (Bottom-Right)', value: 'Drain' },
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
        this.smoothedLevels.clear();
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
        this.searchElapsedMs = 0;
        this.searchStartedAtMs = 0;
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
        if (!this.sfxEnabled || this.sfxVolume <= 0) return;
        const now = performance.now();
        if (now - this.lastStepSoundAt < 60) return;
        this.lastStepSoundAt = now;
        this.stepSoundTick += 1;
        if (this.stepSoundTick % 2 !== 0) return;

        const ctx = MazeEngine.ensureAudioContext(this.sfxEnabled);
        if (!ctx) return;

        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        // Water drip: high→low frequency sweep
        const startFreq = 600 + Math.random() * 400;  // 600-1000 Hz
        const endFreq = 150 + Math.random() * 100;     // 150-250 Hz
        osc.type = 'sine';
        osc.frequency.setValueAtTime(startFreq, t);
        osc.frequency.exponentialRampToValueAtTime(endFreq, t + 0.06);

        // Quick attack, fast decay (drip envelope)
        const vol = Math.max(0, Math.min(1, this.sfxVolume * 0.8));
        gain.gain.setValueAtTime(0.001, t);
        gain.gain.linearRampToValueAtTime(vol, t + 0.003);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.1);
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
        if (!this.frontierPQ || this.frontierPQ.empty()) {
            this.finishSearch(false);
            return;
        }

        const current = this.frontierPQ.get();
        const cKey = this.key(current);
        this.frontierSet.delete(cKey);

        // --- 1. Skip if already full ---
        const existingLevel = this.waterLevels.get(cKey) || 0;
        if (existingLevel >= 1.0) {
            // Already full, just move to next
            if (!this.frontierPQ.empty()) {
                this.searchTimer = setTimeout(() => this.stepSearch(), this.searchDelayMs);
            } else {
                this.finishSearch(false);
            }
            return;
        }
        
        // --- 2. Fill this cell ---
        const level = Math.min(1.0, existingLevel + 0.35);
        this.waterLevels.set(cKey, level);
        this.exploredSet.add(cKey);
        this.currentNode = current;
        this.playStepSound();

        // --- 3. Check Goal (specific cell: bottom-right) ---
        if (current.x === this.goalNode.x && current.y === this.goalNode.y && level > 0.5) {
            this.waterLevels.set(cKey, 1.0);
            this.finishSearch(true);
            return;
        }

        // --- 4. Flow Distribution ---
        if (level >= 0.85) {
            const neighbors = this.getNeighbors(current);
            
            for (const next of neighbors) {
                const nKey = this.key(next);
                const nLevel = this.waterLevels.get(nKey) || 0;

                // Skip cells that are already full
                if (nLevel >= 1.0) continue;

                // Priority: gravity pulls water down, but allows upward flow
                const weight = { down: 0, side: 3, up: 8 }[next.dir];
                const gravityPriority = -next.y + weight;

                if (!this.frontierSet.has(nKey)) {
                    // Track path for reconstruction
                    if (!this.cameFrom.has(nKey)) {
                        this.cameFrom.set(nKey, current);
                    }
                    this.frontierPQ.put(next, gravityPriority);
                    this.frontierSet.add(nKey);
                }
            }
        } else {
            // Not full yet — re-queue to keep filling
            this.frontierPQ.put(current, -current.y);
            this.frontierSet.add(cKey);
        }

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

    smoothedLevels: new Map(),

    draw() {
        if (!this.ctx || !this.grid.length) return;
        const ctx = this.ctx;
        
        // 1. Pixel Alignment: 0.5px offset for crisp lines
        const ox = Math.floor((this.width - this.cols * this.cellSize) * 0.5) + 0.5;
        const oy = Math.floor((this.height - this.rows * this.cellSize) * 0.5) + 0.5;
        const time = Date.now() * 0.002;

        ctx.clearRect(0, 0, this.width, this.height);
        ctx.fillStyle = '#0a0f1a'; // Deep dark ocean background
        ctx.fillRect(0, 0, this.width, this.height);

        // 2. Subtle Grid Background (Refined dots)
        ctx.fillStyle = 'rgba(255,255,255,0.03)';
        for (let y = 0; y <= this.rows; y++) {
            for (let x = 0; x <= this.cols; x++) {
                ctx.beginPath();
                ctx.arc(ox + x * this.cellSize - 0.5, oy + y * this.cellSize - 0.5, 0.7, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // 3. Water Rendering (Two-pass for continuity)
        const alpha = 0.25; // EMA factor
        for (const k of this.exploredSet) {
            const level = this.waterLevels.get(k) || 0;
            const last = this.smoothedLevels.get(k) || 0;
            this.smoothedLevels.set(k, last + (level - last) * alpha);
        }

        const allGroups = [];
        for (let y = 0; y < this.rows; y++) {
            let inWaterGroup = false;
            let currentGroup = [];
            for (let x = 0; x < this.cols; x++) {
                const k = `${x},${y}`;
                const level = this.smoothedLevels.get(k) || 0;
                if (level > 0.005) {
                    if (!inWaterGroup) { inWaterGroup = true; currentGroup = []; }
                    currentGroup.push({ x, y, level });
                } else if (inWaterGroup) {
                    allGroups.push(currentGroup);
                    inWaterGroup = false;
                }
            }
            if (inWaterGroup) allGroups.push(currentGroup);
        }

        // Pass A: All Fills (with slight vertical overlap to hide gaps)
        for (const group of allGroups) {
            this.drawWaterFill(group, ox, oy, time);
        }
        // Pass B: Surface Highlights only (where air meets water)
        for (const group of allGroups) {
            this.drawWaterSurface(group, ox, oy, time);
        }

        // 4. Walls Pass (Tiered: Inner vs Outer)
        const N = 1, E = 2, S = 4, W = 8;
        
        // A. Inner Walls
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        for (let y = 0; y < this.rows; y++) {
            for (let x = 0; x < this.cols; x++) {
                const cell = this.grid[y][x];
                const px = ox + x * this.cellSize, py = oy + y * this.cellSize;
                if (!(cell.open & N) && y > 0) { ctx.moveTo(px, py); ctx.lineTo(px + this.cellSize, py); }
                if (!(cell.open & E) && x < this.cols - 1) { ctx.moveTo(px + this.cellSize, py); ctx.lineTo(px + this.cellSize, py + this.cellSize); }
                if (!(cell.open & S) && y < this.rows - 1) { ctx.moveTo(px, py + this.cellSize); ctx.lineTo(px + this.cellSize, py + this.cellSize); }
                if (!(cell.open & W) && x > 0) { ctx.moveTo(px, py); ctx.lineTo(px, py + this.cellSize); }
            }
        }
        ctx.stroke();

        // B. Outer Boundary (Crisp/White)
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let y = 0; y < this.rows; y++) {
            for (let x = 0; x < this.cols; x++) {
                const cell = this.grid[y][x];
                const px = ox + x * this.cellSize, py = oy + y * this.cellSize;
                if (y === 0 && !(cell.open & N)) { ctx.moveTo(px, py); ctx.lineTo(px + this.cellSize, py); }
                if (x === this.cols - 1 && !(cell.open & E)) { ctx.moveTo(px + this.cellSize, py); ctx.lineTo(px + this.cellSize, py + this.cellSize); }
                if (y === this.rows - 1 && !(cell.open & S)) { ctx.moveTo(px, py + this.cellSize); ctx.lineTo(px + this.cellSize, py + this.cellSize); }
                if (x === 0 && !(cell.open & W)) { ctx.moveTo(px, py); ctx.lineTo(px, py + this.cellSize); }
            }
        }
        ctx.stroke();

        // 5. Start & Goal Markers
        const cs = this.cellSize;
        // Start (green)
        ctx.fillStyle = 'rgba(0, 200, 0, 0.6)';
        ctx.fillRect(
            Math.floor(ox + this.startNode.x * cs),
            Math.floor(oy + this.startNode.y * cs),
            Math.ceil(cs), Math.ceil(cs)
        );
        // Goal (red)
        ctx.fillStyle = 'rgba(255, 0, 0, 0.6)';
        ctx.fillRect(
            Math.floor(ox + this.goalNode.x * cs),
            Math.floor(oy + this.goalNode.y * cs),
            Math.ceil(cs), Math.ceil(cs)
        );

        // 6. Path Highlights
        if (this.path.length > 0 && this.pathProgress > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
            ctx.lineWidth = 4;
            ctx.setLineDash([5, 5]);
            const limit = Math.min(this.path.length, this.pathProgress);
            for (let i = 0; i < limit; i++) {
                const p = this.path[i];
                const cx = ox + p.x * this.cellSize + this.cellSize * 0.5;
                const cy = oy + p.y * this.cellSize + this.cellSize * 0.5;
                if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
            }
            ctx.stroke();
            ctx.restore();
        }

        this.drawHUD();
    },

    drawWaterFill(group, ox, oy, time) {
        const ctx = this.ctx;
        if (group.length === 0) return;
        const first = group[0], last = group[group.length - 1];
        
        ctx.beginPath();
        // Use perfect pixel alignment to avoid alpha-overlap lines
        const rowTopY = Math.floor(oy + first.y * this.cellSize);
        const rowBottomY = Math.floor(oy + (first.y + 1) * this.cellSize);
        ctx.moveTo(ox + first.x * this.cellSize, rowBottomY);
        
        for (let i = 0; i < group.length; i++) {
            const cell = group[i];
            const px = ox + cell.x * this.cellSize;
            const py = oy + cell.y * this.cellSize;
            const surfaceY = py + this.cellSize * (1 - cell.level);
            const wave = Math.sin(time + cell.x * 0.8) * 1.0;
            ctx.lineTo(px, surfaceY + wave);
            ctx.lineTo(px + this.cellSize, surfaceY + wave);
        }

        ctx.lineTo(ox + (last.x + 1) * this.cellSize, rowBottomY);
        ctx.closePath();

        // [CORE FIX] GLOBAL GRADIENT: spans the entire grid height
        const gridTopY = oy;
        const gridBottomY = oy + this.rows * this.cellSize;
        const globalGrad = ctx.createLinearGradient(0, gridTopY, 0, gridBottomY);
        globalGrad.addColorStop(0, 'rgba(59, 130, 246, 0.65)'); // Top: Bright
        globalGrad.addColorStop(1, 'rgba(30, 58, 138, 0.85)'); // Bottom: Deep Navy
        
        ctx.fillStyle = globalGrad;
        ctx.fill();

        // 3. Organic Caustics (Scattered)
        ctx.save();
        ctx.clip();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < group.length; i += 4) {
            const cell = group[i];
            const px = ox + cell.x * this.cellSize + (Math.sin(cell.x) * 5);
            const py = oy + cell.y * this.cellSize + (Math.cos(cell.y) * 5);
            const r = this.cellSize * 2.0;
            const g = ctx.createRadialGradient(px, py, 0, px, py, r);
            const flicker = Math.sin(time * 1.5 + cell.x) * 0.02;
            g.addColorStop(0, `rgba(255, 255, 255, ${0.05 + flicker})`);
            g.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = g;
            ctx.fillRect(px - r, py - r, r * 2, r * 2);
        }
        ctx.restore();
    },

    drawWaterSurface(group, ox, oy, time) {
        const ctx = this.ctx;
        ctx.save();
        ctx.beginPath();
        let active = false;
        
        for (let i = 0; i < group.length; i++) {
            const cell = group[i];
            const kAbove = `${cell.x},${cell.y - 1}`;
            // Use RAW water level for reactive check
            const rawLevelAbove = this.waterLevels.get(kAbove) || 0;
            
            // STRICT SURFACE: only if air is above OR the cell is clearly not full
            const isSurfaceBoundary = (rawLevelAbove < 0.1) || (cell.level < 0.98);
            
            if (isSurfaceBoundary) {
                const px = ox + cell.x * this.cellSize;
                const py = oy + cell.y * this.cellSize;
                const surfaceY = py + this.cellSize * (1 - cell.level);
                const wave = Math.sin(time + cell.x * 0.8) * 1.0;

                if (!active) {
                    ctx.moveTo(px, surfaceY + wave);
                    active = true;
                }
                ctx.lineTo(px + this.cellSize, surfaceY + wave);
            } else {
                active = false;
            }
        }
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = 'rgba(219, 234, 254, 0.55)'; // Softer, thinner
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.restore();
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

    startPausedOnLoad: true,
    autoPlayOnReset: false,

    start() { if (this.searchPaused) this.resumeSearch(); else this.startSearchAnimation(); },
    stop() { this.stopSearchAnimation(); if (this.pathAnimTimer) clearTimeout(this.pathAnimTimer); },
    pauseSearch() { if (this.searchTimer) { clearTimeout(this.searchTimer); this.searchTimer = null; } this.searchPaused = true; },
    resumeSearch() { if (!this.searchPaused) return; this.searchPaused = false; this.searchInProgress = true; this.searchTimer = setTimeout(() => this.stepSearch(), this.searchDelayMs); },
    destroy() { this.stop(); }
};

window.SquareWaterMazeCase = SquareWaterMazeCase;
