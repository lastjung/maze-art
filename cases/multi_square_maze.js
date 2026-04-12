/**
 * SquareInstance
 * Component for a single square maze in Multi-Square mode.
 * Matches the official SquareMazeCase rendering and logic.
 */
class SquareInstance {
    constructor(options = {}) {
        this.canvas = options.canvas;
        this.ctx = options.ctx;
        this.id = options.id || 'Square';
        this.offsetX = 0; this.offsetY = 0;
        this.viewWidth = 0; this.viewHeight = 0;
        this.active = false;

        this.cols = 20;
        this.rows = 20;
        this.cellSize = 20;
        this.searchMode = 'astar';
        this.searchDelayMs = 24;
        this.colorTheme = 'ocean';
        this.solutionSpeed = 70;
        this.sfxEnabled = true;
        this.sfxVolume = 0.3;
        this.audioMode = 'music';

        this.grid = []; // Array of arrays of { open: bitmask }
        this.startNode = { x: 0, y: 0 };
        this.goalNode = { x: 0, y: 0 };
        
        this.resetSearch();
    }

    resetSearch() {
        if (this.searchTimer) clearTimeout(this.searchTimer);
        if (this.pathAnimTimer) clearTimeout(this.pathAnimTimer);
        this.cameFrom = new Map();
        this.costSoFar = new Map();
        this.path = [];
        this.pathMap = new Map();
        this.frontierSet = new Set();
        this.exploredSet = new Set();
        this.currentNode = null;
        this.searchInProgress = false;
        this.searchPaused = false;
        this.pathProgress = 0;
        this.searchStartedAtMs = 0;
        this.searchElapsedMs = 0;
    }

    key(n) { return `${n.x},${n.y}`; }

    heuristic(a, b) {
        return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); // Manhattan
    }

    startSearch() {
        this.resetSearch();
        this.searchInProgress = true;
        this.searchStartedAtMs = performance.now();
        const sKey = this.key(this.startNode);
        this.cameFrom.set(sKey, null);
        this.costSoFar.set(sKey, 0);

        if (this.searchMode === 'bfs' || this.searchMode === 'dfs') {
            this.frontier = [this.startNode];
        } else {
            this.frontier = [{ node: this.startNode, priority: 0, h: this.heuristic(this.startNode, this.goalNode) }];
        }
        this.frontierSet.add(sKey);
        this.step();
    }

    step() {
        if (!this.searchInProgress || this.searchPaused) return;
        if (!this.frontier || this.frontier.length === 0) { this.finish(false); return; }

        let current = null;
        if (this.searchMode === 'bfs') current = this.frontier.shift();
        else if (this.searchMode === 'dfs') current = this.frontier.pop();
        else {
            let bestIdx = 0;
            for(let i=1; i<this.frontier.length; i++) {
                if (this.frontier[i].priority < this.frontier[bestIdx].priority) bestIdx = i;
                else if (this.frontier[i].priority === this.frontier[bestIdx].priority) {
                    if (this.frontier[i].h < this.frontier[bestIdx].h) bestIdx = i;
                }
            }
            current = this.frontier.splice(bestIdx, 1)[0].node;
        }

        this.currentNode = current;
        const ck = this.key(current);
        this.frontierSet.delete(ck);
        this.exploredSet.add(ck);
        this.searchElapsedMs = performance.now() - this.searchStartedAtMs;

        if (this.sfxEnabled && this.sfxVolume > 0 && typeof Core !== 'undefined' && Core.isAudioEnabled) {
            const idx = parseInt(this.id.split(' ')[1]) - 1 || 0;
            const pan = (this.offsetX < this.ctx.canvas.width / 3) ? -0.5 : (this.offsetX > this.ctx.canvas.width / 2) ? 0.5 : 0;
            if (window.synthAudio && (this.audioMode === 'synth' || this.audioMode === 'piano')) {
                const pt = { x: (this.currentNode.x / this.cols) * 2 - 1, y: 0, z: 0 };
                if (this.audioMode === 'piano') {
                    window.synthAudio.triggerPianoNote(pt, this.sfxVolume * 0.2, 1.2);
                } else {
                    window.synthAudio.triggerNote(pt, this.sfxVolume * 0.2, 0.15);
                }
            } else {
                const baseFreq = 220 + (idx * 110);
                const freq = baseFreq + (this.exploredSet.size % 40) * 12;
                MazeEngine.playTone(freq, 0.05, 'triangle', 0.25 * this.sfxVolume, 0.003, this, pan);
            }
        }

        if (current.x === this.goalNode.x && current.y === this.goalNode.y) { this.finish(true); return; }

        const N = 1, E = 2, S = 4, W = 8;
        const dirs = [
            { dx: 0, dy: -1, bit: N },
            { dx: 1, dy: 0, bit: E },
            { dx: 0, dy: 1, bit: S },
            { dx: -1, dy: 0, bit: W }
        ];
        
        const cellOpen = this.grid[current.y][current.x].open;

        for (const d of dirs) {
            if (!(cellOpen & d.bit)) continue; // Wall is closed

            const next = { x: current.x + d.dx, y: current.y + d.dy };
            if (next.x < 0 || next.x >= this.cols || next.y < 0 || next.y >= this.rows) continue;

            const nk = this.key(next);
            if (this.exploredSet.has(nk)) continue;

            const newCost = (this.costSoFar.get(ck) || 0) + 1;
            if (!this.costSoFar.has(nk) || newCost < this.costSoFar.get(nk)) {
                this.costSoFar.set(nk, newCost);
                this.cameFrom.set(nk, current);
                const h = this.heuristic(next, this.goalNode);
                let prio = newCost;
                if (this.searchMode === 'astar') prio = newCost + h * 1.1;
                else if (this.searchMode === 'greedy') prio = h;

                if (!this.frontierSet.has(nk)) {
                    if (this.searchMode === 'bfs' || this.searchMode === 'dfs') this.frontier.push(next);
                    else this.frontier.push({ node: next, priority: prio, h: h });
                    this.frontierSet.add(nk);
                } else if (this.searchMode !== 'bfs' && this.searchMode !== 'dfs') {
                    const existing = this.frontier.find(f => f.node.x === next.x && f.node.y === next.y);
                    if (existing && prio < existing.priority) { existing.priority = prio; existing.h = h; }
                }
            }
        }

        this.searchTimer = setTimeout(() => this.step(), this.searchDelayMs);
        if (this.onRefresh) this.onRefresh();
    }

    finish(found) {
        this.searchInProgress = false;
        if (found) {
            let curr = this.goalNode;
            while(curr) { this.path.push(curr); curr = this.cameFrom.get(this.key(curr)); }
            this.path.reverse();
            this.path.forEach((n, i) => this.pathMap.set(this.key(n), i));
            if (Core.isAudioEnabled) MazeEngine.playResultSound(true, this);
            this.animatePath();
        } else if (Core.isAudioEnabled) MazeEngine.playResultSound(false, this);
        if (this.onRefresh) this.onRefresh();
        if (typeof Core !== 'undefined') Core.syncPlayButton();
    }

    animatePath() {
        if (this.pathProgress >= this.path.length) { MazeEngine.playSolutionFinishSound(this); return; }
        this.pathProgress += Math.max(0.6, this.solutionSpeed / 30);
        if (this.onRefresh) this.onRefresh();
        this.pathAnimTimer = setTimeout(() => this.animatePath(), 16);
    }

    render() {
        if (!this.active) return;
        const ctx = this.ctx; ctx.save();
        ctx.beginPath(); ctx.rect(this.offsetX, this.offsetY, this.viewWidth, this.viewHeight); ctx.clip();
        ctx.translate(this.offsetX, this.offsetY);

        const mazeW = this.cols * this.cellSize;
        const mazeH = this.rows * this.cellSize;
        const scale = Math.min(1.0, (this.viewWidth * 0.9) / mazeW, (this.viewHeight * 0.9) / mazeH);
        
        ctx.translate(this.viewWidth/2, this.viewHeight/2);
        ctx.scale(scale, scale);
        ctx.translate(-mazeW/2, -mazeH/2);

        const theme = MazeEngine.themes[this.colorTheme] || MazeEngine.themes.ocean;
        const N = 1, E = 2, S = 4, W = 8;
        
        // 1. Fill Cells
        for(let y=0; y<this.rows; y++) {
            for(let x=0; x<this.cols; x++) {
                const k = `${x},${y}`;
                let fill = null;
                if (x === this.startNode.x && y === this.startNode.y) fill = theme.start;
                else if (x === this.goalNode.x && y === this.goalNode.y) fill = theme.goal;
                else if (this.pathMap.has(k) && this.pathMap.get(k) < this.pathProgress) fill = theme.path;
                else if (this.currentNode && x === this.currentNode.x && y === this.currentNode.y) fill = theme.current;
                else if (this.frontierSet.has(k)) fill = theme.frontier;
                else if (this.exploredSet.has(k)) fill = theme.explored;

                if (fill) {
                    ctx.fillStyle = fill;
                    ctx.fillRect(x * this.cellSize + 0.5, y * this.cellSize + 0.5, this.cellSize, this.cellSize);
                }
            }
        }

        // 2. Draw Walls (Lines)
        ctx.strokeStyle = theme.wall;
        ctx.lineWidth = 1.0;
        ctx.globalAlpha = 0.8;
        for(let y=0; y<this.rows; y++) {
            for(let x=0; x<this.cols; x++) {
                const cell = this.grid[y][x];
                const px = x * this.cellSize + 0.5;
                const py = y * this.cellSize + 0.5;
                ctx.beginPath();
                if (!(cell.open & N)) { ctx.moveTo(px, py); ctx.lineTo(px + this.cellSize, py); }
                if (!(cell.open & E)) { ctx.moveTo(px + this.cellSize, py); ctx.lineTo(px + this.cellSize, py + this.cellSize); }
                if (!(cell.open & S)) { ctx.moveTo(px, py + this.cellSize); ctx.lineTo(px + this.cellSize, py + this.cellSize); }
                if (!(cell.open & W)) { ctx.moveTo(px, py); ctx.lineTo(px, py + this.cellSize); }
                ctx.stroke();
            }
        }
        
        ctx.restore();
        const liveMs = (this.searchInProgress && !this.searchPaused) ? (performance.now() - this.searchStartedAtMs) : this.searchElapsedMs;
        ctx.save();
        ctx.translate(this.offsetX, this.offsetY);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.beginPath(); ctx.roundRect(15, 15, 140, 65, 8); ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'; ctx.stroke();
        ctx.fillStyle = '#FFFFFF'; ctx.font = 'bold 11px Inter';
        ctx.fillText(`${this.id} - ${this.searchMode.toUpperCase()}`, 25, 35);
        ctx.font = '500 10px Inter'; ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.fillText(`TIME: ${(liveMs/1000).toFixed(2)}s`, 25, 52);
        ctx.fillText(`EXPLORED: ${this.exploredSet.size}`, 25, 67);
        ctx.restore();
    }
}

/**
 * MultiSquareMazeCase
 */
const MultiSquareMazeCase = {
    canvas: null, ctx: null, components: [],
    get searchInProgress() { return this.components.some(c => c.active && c.searchInProgress); },
    get searchPaused() { return this.components.every(c => !c.active || c.searchPaused); },

    init() {
        this.canvas = document.getElementById('mathCanvas'); this.ctx = this.canvas.getContext('2d');
        const defaults = [
            { mode: 'astar', theme: 'basic' },
            { mode: 'dijkstra', theme: 'ocean' },
            { mode: 'bfs', theme: 'sunset' },
            { mode: 'dfs', theme: 'neon' }
        ];

        if (this.components.length === 0) {
            for(let i=0; i<4; i++) {
                const c = new SquareInstance({ canvas: this.canvas, ctx: this.ctx, id: `Sq ${i+1}` });
                c.active = true; c.onRefresh = () => this.draw();
                this.components.push(c);
            }
        }

        this.components.forEach((c, i) => {
            if (i < defaults.length) {
                c.searchMode = defaults[i].mode;
                c.colorTheme = defaults[i].theme;
                c.audioMode = c.audioMode || 'music';
            }
        });

        if (this.components[0]) {
            const master = this.components[0];
            this.generateSharedMaze(master);
            this.components.forEach(c => {
                c.grid = master.grid.map(row => row.map(cell => ({ ...cell })));
                c.startNode = { ...master.startNode };
                c.goalNode = { ...master.goalNode };
                c.cols = master.cols;
                c.rows = master.rows;
                c.resetSearch();
            });
        }
        this.resize(); this.bind();
        if (typeof Core !== 'undefined') { Core.syncPlayButton(); Core.updateControls(); }
    },

    get uiConfig() {
        const config = [];
        this.components.forEach((c, i) => {
            config.push({
                type: 'row',
                items: [
                    { type: 'text', label: `${i+1}_Sq`, flex: '0.8' },
                    { type: 'select', value: c.searchMode, flex: '1.2', options: [ { value: 'astar', label: 'A*' }, { value: 'dijkstra', label: 'Dijkstra' }, { value: 'greedy', label: 'Greedy' }, { value: 'bfs', label: 'BFS' }, { value: 'dfs', label: 'DFS' } ], onChange: v => { c.searchMode = v; c.resetSearch(); this.draw(); } },
                    { type: 'select', value: c.colorTheme, flex: '1.2', options: [ { value: 'rainbow', label: 'Rainbow' }, { value: 'basic', label: 'Basic' }, { value: 'ocean', label: 'Ocean' }, { value: 'sunset', label: 'Sunset' }, { value: 'neon', label: 'Neon' } ], onChange: v => { c.colorTheme = v; this.draw(); } },
                    { type: 'button', label: c.active ? 'ON' : 'OFF', flex: '0.8', active: c.active, onClick: () => { c.active = !c.active; this.resize(); Core.updateControls(); } }
                ]
            });
        });

        const c1 = this.components[0];
        config.push({ type: 'info', label: '--- Multi Global Settings ---', value: '' });
        config.push({ type: 'select', id: 'hex_sound_engine', label: 'Sound Engine', value: c1.audioMode, options: [ { value: 'music', label: 'Default Music' }, { value: 'synth', label: 'Algorithm Synth' }, { value: 'piano', label: 'Algorithm Piano' } ], onChange: v => { this.components.forEach(c => c.audioMode = v); } });
        config.push({ type: 'slider', id: 'pf_speed', label: 'Search Speed', min: 1, max: 100, step: 1, value: 50, onChange: v => { const d = Math.max(1, 100 - v); this.components.forEach(c => c.searchDelayMs = d); } });
        config.push({ type: 'slider', id: 'pf_cols', label: 'Cols/Rows', min: 10, max: 50, step: 2, value: c1.cols, live: false, onChange: v => { this.components.forEach(c => { c.cols = v; c.rows = v; }); this.init(); } });
        return config;
    },

    resize() {
        if(!this.canvas) return;
        this.canvas.width = this.canvas.parentElement.clientWidth; this.canvas.height = this.canvas.parentElement.clientHeight;
        const activeUnits = this.components.filter(c => c.active);
        const n = activeUnits.length; const width = this.canvas.width; const height = this.canvas.height;
        activeUnits.forEach((c, i) => {
            if (n === 1) { c.offsetX = 0; c.offsetY = 0; c.viewWidth = width; c.viewHeight = height; }
            else if (n === 2) { if (width > height) { c.offsetX = (width / 2) * i; c.offsetY = 0; c.viewWidth = width / 2; c.viewHeight = height; } else { c.offsetX = 0; c.offsetY = (height / 2) * i; c.viewWidth = width; c.viewHeight = height / 2; } }
            else { const col = i % 2; const row = Math.floor(i / 2); c.offsetX = (width / 2) * col; c.offsetY = (height / 2) * row; c.viewWidth = width / 2; c.viewHeight = height / 2; }
            c.cellSize = Math.min(c.viewWidth / c.cols, c.viewHeight / c.rows) * 0.88;
        });
        this.draw();
    },

    draw() { if(!this.ctx) return; this.ctx.fillStyle='#131313'; this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height); this.components.filter(c => c.active).forEach(c => c.render()); },
    
    generateSharedMaze(c) {
        const N = 1, E = 2, S = 4, W = 8;
        const dirs = [
            { dx: 0, dy: -1, bit: N, opp: S },
            { dx: 1, dy: 0, bit: E, opp: W },
            { dx: 0, dy: 1, bit: S, opp: N },
            { dx: -1, dy: 0, bit: W, opp: E }
        ];

        c.grid = Array.from({ length: c.rows }, () => Array.from({ length: c.cols }, () => ({ open: 0 })));
        const visited = new Set();
        const stack = [{ x: 0, y: 0 }];
        visited.add('0,0');

        while (stack.length) {
            const current = stack[stack.length - 1];
            const options = [];
            for (const d of dirs) {
                const nx = current.x + d.dx, ny = current.y + d.dy;
                if (nx >= 0 && nx < c.cols && ny >= 0 && ny < c.rows && !visited.has(`${nx},${ny}`)) {
                    options.push({ nx, ny, ...d });
                }
            }

            if (!options.length) { stack.pop(); continue; }

            const pick = options[Math.floor(Math.random() * options.length)];
            c.grid[current.y][current.x].open |= pick.bit;
            c.grid[pick.ny][pick.nx].open |= pick.opp;
            visited.add(`${pick.nx},${pick.ny}`);
            stack.push({ x: pick.nx, y: pick.ny });
        }

        // Add 6% extra passages for search alternatives
        for (let i = 0; i < (c.cols * c.rows * 0.06); i++) {
            const x = Math.floor(Math.random() * c.cols), y = Math.floor(Math.random() * c.rows);
            const d = dirs[Math.floor(Math.random() * 4)];
            const nx = x + d.dx, ny = y + d.dy;
            if (nx >= 0 && nx < c.cols && ny >= 0 && ny < c.rows) {
                c.grid[y][x].open |= d.bit;
                c.grid[ny][nx].open |= d.opp;
            }
        }

        c.startNode = { x: 0, y: 0 };
        c.goalNode = { x: c.cols - 1, y: c.rows - 1 };
    },

    start() { this.components.filter(c => c.active).forEach(c => c.searchPaused ? (c.searchPaused=false, c.step()) : c.startSearch()); if(typeof Core !== 'undefined') Core.syncPlayButton(); },
    stop() { this.components.forEach(c => { if(c.searchInProgress) c.searchPaused=true; }); if(typeof Core !== 'undefined') Core.syncPlayButton(); },
    reset() { this.components.forEach(c => c.resetSearch()); this.init(); if(typeof Core !== 'undefined') Core.syncPlayButton(); },
    bind() {
        if (this.bound) return;
        this.canvas.addEventListener('mousedown', e => {
            const rect = this.canvas.getBoundingClientRect(); const x = e.clientX-rect.left; const y = e.clientY-rect.top;
            const activeUnits = this.components.filter(c => c.active);
            let targetIdx = -1; activeUnits.forEach((c, idx) => { if (x >= c.offsetX && x <= c.offsetX + c.viewWidth && y >= c.offsetY && y <= c.offsetY + c.viewHeight) targetIdx = idx; });
            const c = activeUnits[targetIdx];
            if (c) {
                const mazeW = c.cols * c.cellSize; const mazeH = c.rows * c.cellSize;
                const mx = (x - c.offsetX - c.viewWidth/2) + mazeW/2;
                const my = (y - c.offsetY - c.viewHeight/2) + mazeH/2;
                const gx = Math.floor(mx / c.cellSize); const gy = Math.floor(my / c.cellSize);
                if (gx >= 0 && gx < c.cols && gy >= 0 && gy < c.rows) {
                    // Manual Edit logic: Toggle N/E/S/W walls randomly or smartly?
                    // For simplicity in Multi, we can just clear/fill a cell or open it all
                    c.grid[gy][gx].open = c.grid[gy][gx].open ? 0 : 15;
                    this.components.filter(comp => comp.active).forEach(comp => { comp.grid = c.grid.map(row => row.map(cell => ({ ...cell }))); comp.resetSearch(); });
                    this.draw();
                }
            }
        });
        this.bound = true;
    }
};
