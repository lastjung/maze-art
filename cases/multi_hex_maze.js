/**
 * HexInstance
 * High-fidelity Hex Maze component used in Multi-Hex mode.
 */
class HexInstance {
    constructor(options = {}) {
        this.canvas = options.canvas;
        this.ctx = options.ctx;
        this.id = options.id || 'Maze';
        this.offsetX = 0; this.offsetY = 0;
        this.viewWidth = 0; this.viewHeight = 0;
        this.active = false; // Visibility toggle
        
        this.hexSize = 10;
        this.gridRadius = 18;
        this.searchMode = 'astar';
        this.searchDelayMs = 35;
        this.colorTheme = 'basic';
        this.mazeShape = 'random';
        this.solutionSpeed = 70;
        this.sfxEnabled = true;
        this.sfxVolume = 0.5;
        this.audioMode = 'music';

        this.startNode = { q: 0, r: 0 };
        this.goalNode = { q: 0, r: 0 };
        this.walls = new Set();
        
        this.resetSearch();
    }

    resetSearch() {
        if (this.searchTimer) clearTimeout(this.searchTimer);
        if (this.pathAnimTimer) clearTimeout(this.pathAnimTimer);
        this.cameFrom = {}; this.costSoFar = {}; this.path = [];
        this.pathMap = new Map(); this.pathSet = new Set();
        this.frontierSet = new Set(); this.exploredSet = new Set();
        this.currentNode = null;
        this.searchInProgress = false; this.searchPaused = false;
        this.pathProgress = 0; this.searchStartedAtMs = 0; this.searchElapsedMs = 0;
    }

    startSearch() {
        this.resetSearch();
        this.searchInProgress = true;
        this.searchStartedAtMs = performance.now();
        const startKey = MazeEngine.key(this.startNode);
        this.cameFrom[startKey] = null;
        this.costSoFar[startKey] = 0;
        this.frontier = (this.searchMode === 'bfs' || this.searchMode === 'dfs') ? [this.startNode] : [{ node: this.startNode, priority: 0 }];
        this.frontierSet.add(startKey);
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
        const ck = MazeEngine.key(current);
        this.frontierSet.delete(ck); this.exploredSet.add(ck);
        this.searchElapsedMs = performance.now() - this.searchStartedAtMs;

        if (this.sfxEnabled && this.sfxVolume > 0 && typeof Core !== 'undefined' && Core.isAudioEnabled !== false) {
            const idx = parseInt(this.id.split(' ')[1]) - 1 || 0;
            const pan = (this.offsetX < this.ctx.canvas.width / 3) ? -0.5 : (this.offsetX > this.ctx.canvas.width / 2) ? 0.5 : 0;
            
            if (window.synthAudio && (this.audioMode === 'synth' || this.audioMode === 'piano')) {
                const pt = { x: (this.currentNode ? this.currentNode.q / this.gridRadius : pan), y: 0, z: 0 };
                if (this.audioMode === 'piano') {
                    window.synthAudio.triggerPianoNote(pt, this.sfxVolume * 0.2, 1.2);
                } else {
                    window.synthAudio.triggerNote(pt, this.sfxVolume * 0.2, 0.15);
                }
            } else {
                const baseFreq = 200 + (idx * 100);
                const freq = baseFreq + (this.exploredSet.size % 40) * 12;
                MazeEngine.playTone(freq, 0.05, 'triangle', 0.25 * this.sfxVolume, 0.003, this, pan);
            }
        }

        if (current.q === this.goalNode.q && current.r === this.goalNode.r) { this.finish(true); return; }
        for (const next of MazeEngine.getNeighbors(current, this.gridRadius, this.walls)) {
            const nk = MazeEngine.key(next);
            if (this.exploredSet.has(nk)) continue;
            const newCost = (this.costSoFar[ck] || 0) + 1;
            if (this.costSoFar[nk] === undefined || newCost < this.costSoFar[nk]) {
                this.costSoFar[nk] = newCost; this.cameFrom[nk] = current;
                const h = MazeEngine.heuristic(this.goalNode, next);
                let prio = newCost;
                if (this.searchMode === 'astar') prio = newCost + h * 1.1; 
                else if (this.searchMode === 'greedy') prio = h;
                
                if (!this.frontierSet.has(nk)) {
                    if (this.searchMode === 'bfs' || this.searchMode === 'dfs') this.frontier.push(next);
                    else this.frontier.push({ node: next, priority: prio, h: h });
                    this.frontierSet.add(nk);
                } else if (this.searchMode !== 'bfs' && this.searchMode !== 'dfs') {
                    const existing = this.frontier.find(f => f.node.q === next.q && f.node.r === next.r);
                    if (existing && prio < existing.priority) { existing.priority = prio; existing.h = h; }
                }
            }
        }
        this.searchTimer = setTimeout(() => this.step(), this.searchDelayMs);
        if (this.onRefresh) this.onRefresh();
    }

    finish(found) {
        this.searchInProgress = false;
        const canPlay = (typeof Core === 'undefined' || Core.isAudioEnabled !== false);
        if (found) {
            let curr = this.goalNode;
            while(curr) { this.path.push(curr); curr = this.cameFrom[MazeEngine.key(curr)]; }
            this.path.reverse(); 
            this.path.forEach((n, i) => this.pathMap.set(MazeEngine.key(n), i));
            this.pathSet = new Set(this.pathMap.keys());
            if (canPlay) MazeEngine.playResultSound(true, this);
            this.animatePath();
        } else if (canPlay) MazeEngine.playResultSound(false, this);
        if (this.onRefresh) this.onRefresh();
        if (typeof Core !== 'undefined') Core.syncPlayButton();
    }

    animatePath() {
        if (this.pathProgress >= this.path.length) { MazeEngine.playSolutionFinishSound(this); return; }
        this.pathProgress += Math.max(0.5, this.solutionSpeed / 40);
        if (this.onRefresh) this.onRefresh();
        this.pathAnimTimer = setTimeout(() => this.animatePath(), 16);
    }

    formatMs(ms) {
        return (Math.max(0, ms || 0) / 1000).toFixed(2) + 's';
    }

    drawScoreboard() {
        const ctx = this.ctx;
        const liveMs = (this.searchInProgress && !this.searchPaused) ? (performance.now() - this.searchStartedAtMs) : this.searchElapsedMs;
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.beginPath(); ctx.roundRect(15, 15, 140, 65, 8); ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'; ctx.stroke();
        ctx.fillStyle = '#FFFFFF'; ctx.font = 'bold 11px Inter';
        ctx.fillText(`${this.id} - ${this.searchMode.toUpperCase()}`, 25, 35);
        ctx.font = '500 10px Inter'; ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.fillText(`TIME: ${this.formatMs(liveMs)}`, 25, 52);
        ctx.fillText(`EXPLORED: ${this.exploredSet.size}`, 25, 67);
        ctx.restore();
    }

    render() {
        if (!this.active) return;
        const ctx = this.ctx; ctx.save();
        ctx.beginPath(); ctx.rect(this.offsetX, this.offsetY, this.viewWidth, this.viewHeight); ctx.clip();
        ctx.translate(this.offsetX, this.offsetY);
        ctx.save();
        const mazeWidth = (2 * this.gridRadius + 1) * this.hexSize * MazeEngine.sqrt3;
        const mazeHeight = (1.5 * this.gridRadius + 1) * this.hexSize * 2;
        const scale = Math.min(1.0, (this.viewWidth * 0.85) / mazeWidth, (this.viewHeight * 0.85) / mazeHeight);
        ctx.translate(this.viewWidth / 2, this.viewHeight / 2);
        ctx.scale(scale, scale);
        const theme = MazeEngine.themes[this.colorTheme] || MazeEngine.themes.basic;
        const time = performance.now() / 1000;
        MazeEngine.forEachHex(this.gridRadius, h => {
            const k = MazeEngine.key(h); const p = MazeEngine.hexToPixel(h.q, h.r, this.hexSize); const drawSize = this.hexSize * 0.92;
            let fill = 'rgba(240, 248, 255, 0.16)'; let stroke = 'rgba(255, 255, 255, 0.22)';
            if (this.walls.has(k)) { if (this.colorTheme === 'rainbow') fill = `hsl(${(k.length*10 + time*40)%360}, 70%, 60%)`; else fill = theme.wall; }
            else if (k === MazeEngine.key(this.startNode)) { fill = '#4ade80'; stroke = '#fff'; }
            else if (k === MazeEngine.key(this.goalNode)) { fill = '#f87171'; stroke = '#fff'; }
            else if (this.pathMap.has(k) && this.pathMap.get(k) < this.pathProgress) fill = theme.path;
            else if (this.currentNode && h.q === this.currentNode.q && h.r === this.currentNode.r) fill = theme.current;
            else if (this.frontierSet.has(k)) fill = theme.frontier;
            else if (this.exploredSet.has(k)) fill = theme.explored;
            ctx.beginPath();
            for (let i = 0; i < 6; i++) { const a = Math.PI/180 * (60 * i + 30); ctx.lineTo(p.x + drawSize * Math.cos(a), p.y + drawSize * Math.sin(a)); }
            ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
            if (!this.walls.has(k)) { ctx.strokeStyle = stroke; ctx.lineWidth = 0.5; ctx.stroke(); }
        });
        ctx.restore(); this.drawScoreboard(); ctx.restore();
    }
}

/**
 * MultiHexMazeCase
 */
const MultiHexMazeCase = {
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
                const c = new HexInstance({ canvas: this.canvas, ctx: this.ctx, id: `Hex ${i+1}` });
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
                c.walls = new Set(master.walls);
                c.startNode = { ...master.startNode };
                c.goalNode = { ...master.goalNode };
                c.gridRadius = master.gridRadius;
                c.hexSize = master.hexSize;
                c.mazeShape = master.mazeShape;
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
                    { type: 'text', label: `${i+1}_Hexa`, flex: '0.8' },
                    { type: 'select', value: c.searchMode, flex: '1.2', options: [ { value: 'astar', label: 'A*' }, { value: 'dijkstra', label: 'Dijkstra' }, { value: 'greedy', label: 'Greedy' }, { value: 'bfs', label: 'BFS' }, { value: 'dfs', label: 'DFS' } ], onChange: v => { c.searchMode = v; c.resetSearch(); this.draw(); } },
                    { type: 'select', value: c.colorTheme, flex: '1.2', options: [ { value: 'rainbow', label: 'Rainbow' }, { value: 'basic', label: 'Basic' }, { value: 'ocean', label: 'Ocean' }, { value: 'sunset', label: 'Sunset' }, { value: 'neon', label: 'Neon' } ], onChange: v => { c.colorTheme = v; this.draw(); } },
                    { type: 'button', label: c.active ? 'ON' : 'OFF', flex: '0.8', active: c.active, onClick: () => { c.active = !c.active; this.resize(); Core.updateControls(); } }
                ]
            });
        });

        if (this.components[0]) {
            const c1 = this.components[0];
            config.push({ type: 'info', label: '--- Multi Global Settings ---', value: '' });
            config.push({ type: 'select', id: 'pf_shape', label: 'Maze Shape', value: c1.mazeShape || 'random', options: [ { value: 'random', label: 'Random (Default)' }, { value: 'heart', label: 'Heart Path' }, { value: 'star', label: 'Star Path' }, { value: 'infinity', label: 'Infinity (∞) Path' }, { value: 'spiral', label: 'Spiral Path' } ], onChange: v => { this.components.forEach(c => c.mazeShape = v); this.init(); } });
            config.push({ type: 'select', id: 'hex_sound_engine', label: 'Sound Engine', value: c1.audioMode || 'music', options: [ { value: 'music', label: 'Default Music' }, { value: 'synth', label: 'Algorithm Synth' }, { value: 'piano', label: 'Algorithm Piano' } ], onChange: v => { this.components.forEach(c => c.audioMode = v); } });
            config.push({ type: 'slider', id: 'pf_speed', label: 'Search Speed', min: 1, max: 50, step: 1, value: MazeEngine.delayToSpeed(c1.searchDelayMs), onChange: v => { const d = MazeEngine.speedToDelay(v); this.components.forEach(c => c.searchDelayMs = d); } });
            config.push({ type: 'slider', id: 'pf_sol_speed', label: 'Solution Speed', min: 1, max: 100, step: 1, value: c1.solutionSpeed, onChange: v => { this.components.forEach(c => c.solutionSpeed = v); } });
            config.push({ type: 'slider', id: 'pf_sfx_volume', label: 'SFX Volume', min: 0, max: 1.0, step: 0.01, value: c1.sfxVolume, onChange: v => { this.components.forEach(c => c.sfxVolume = v); } });
            config.push({ type: 'slider', id: 'pf_hex_size', label: 'Hex Size', min: 4, max: 28, step: 1, value: c1.hexSize, onChange: v => { this.components.forEach(c => c.hexSize = v); this.draw(); } });
            config.push({ type: 'slider', id: 'pf_radius', label: 'Grid Radius', min: 8, max: 50, step: 1, value: c1.gridRadius, live: false, onChange: v => { this.components.forEach(c => { c.gridRadius = v; c.resetSearch(); }); this.init(); } });
        }
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
        });
        this.draw();
    },

    draw() { if(!this.ctx) return; this.ctx.fillStyle='#1e1e1e'; this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height); this.components.filter(c => c.active).forEach(c => c.render()); },
    generateSharedMaze(c) {
        c.walls.clear(); MazeEngine.forEachHex(c.gridRadius, h => c.walls.add(MazeEngine.key(h)));
        const grid = []; MazeEngine.forEachHex(c.gridRadius, h => { if(h.q%2===0 && h.r%2===0) grid.push(h); });
        const carve = (curr, v) => {
            v.add(MazeEngine.key(curr)); c.walls.delete(MazeEngine.key(curr));
            const dirs = [...MazeEngine.mazeStepDirections].sort(()=>Math.random()-0.5);
            for(const d of dirs) { const next={q:curr.q+d.q, r:curr.r+d.r}; if(MazeEngine.isInside(next, c.gridRadius) && !v.has(MazeEngine.key(next))) { c.walls.delete(MazeEngine.key({q:(curr.q+next.q)/2, r:(curr.r+next.r)/2})); carve(next, v); } }
        };
        carve(grid[0] || {q:0,r:0}, new Set());
        const seed = MazeEngine.pickAnyOpenNode(c.gridRadius, c.walls);
        c.startNode = MazeEngine.farthestReachableFrom(seed, c.gridRadius, c.walls);
        c.goalNode = MazeEngine.farthestReachableFrom(c.startNode, c.gridRadius, c.walls);
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
                const h = MazeEngine.pixelToHex(x-c.offsetX-c.viewWidth/2, y-c.offsetY-c.viewHeight/2, c.hexSize);
                if (MazeEngine.isInside(h, c.gridRadius)) {
                    const k = MazeEngine.key(h); if(c.walls.has(k)) c.walls.delete(k); else c.walls.add(k);
                    this.components.filter(comp => comp.active).forEach(comp => { comp.walls = new Set(c.walls); comp.resetSearch(); }); this.draw();
                }
            }
        });
        this.bound = true;
    }
};
