/**
 * MazeEngine (Shared Hex Math & Pathfinding Core)
 *
 * This engine handles the underlying hexagonal grid mathematics,
 * A* / Dijkstra / BFS / DFS pathfinding state, and audio synthesis
 * for the pathfinding animations.
 *
 * It is completely decoupled from the specific visual case (Heart, Spiral, etc.)
 * allowing it to be used by any case that provides walls and endpoints.
 */

class PriorityQueue {
    constructor() {
        this.elements = [];
    }

    put(item, priority) {
        this.elements.push({ item, priority });
        this.elements.sort((a, b) => a.priority - b.priority);
    }

    get() {
        return this.elements.shift().item;
    }

    empty() {
        return this.elements.length === 0;
    }
}

const MazeEngine = {
    // -------------------------------------------------------------
    // Core Engine Configuration
    // -------------------------------------------------------------
    sqrt3: Math.sqrt(3),
    directions: [
        { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
        { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }
    ],
    // Specific multi-hex step used by random DFS maze generator
    mazeStepDirections: [
        { q: 2, r: 0 }, { q: 2, r: -2 }, { q: 0, r: -2 },
        { q: -2, r: 0 }, { q: -2, r: 2 }, { q: 0, r: 2 }
    ],
    
    // Default shared themes
    themes: {
        rainbow: {
            wall: '#FFFFFF',        // Dynamically overridden by hsl in the render loop
            explored: 'rgba(255, 255, 255, 0.1)',    // Very subtle white
            frontier: 'rgba(255, 255, 255, 0.25)',   // Slightly brighter white
            start: '#00FF00',       // Bright Green
            goal: '#FF0000',        // Universal Red Goal
            path: 'rgba(255, 255, 255, 0.45)', // White tinted path cells
            current: '#FFFFFF'      // Pure white path LINE
        },
        basic: {
            wall: '#86efac',        // Green
            explored: '#ec4899',    // Pink
            frontier: '#f472b6',    // Light Pink
            start: '#00CC00',       // Bright Green
            goal: '#FF0000',        // Red
            path: 'rgba(255, 0, 0, 0.45)', // Red (like Ocean theme)
            current: '#FF0000'      // Red path LINE (like Ocean theme)
        },
        ocean: {
            wall: '#22d3ee',        // Cyan (Sky Blue)
            explored: '#3b82f6',    // Blue
            frontier: '#93c5fd',    // Light Blue
            start: '#0891b2',       // Dark Cyan
            goal: '#FF0000',        // Universal Red Goal for visibility
            path: 'rgba(255, 0, 0, 0.45)', // Red tinted path cells
            current: '#FF0000'      // Red path LINE
        },
        sunset: {
            wall: '#fdba74',        // Light Orange
            explored: '#7c3aed',    // Purple
            frontier: '#a78bfa',    // Light Purple
            start: '#f97316',       // Orange
            goal: '#FF0000',        // Red
            path: 'rgba(255, 255, 255, 0.25)', // Subtle white fill for cells
            current: '#39ff14'                 // Neon Green for the path LINE
        },
        neon: {
            wall: '#f3f4f6',        // Light Gray wall
            explored: '#4d7c0f',    // Dark Lime search
            frontier: '#84cc16',    // Bright Lime frontier
            start: '#1f2937', 
            goal: '#FF0000',        // Red
            path: 'rgba(132, 204, 22, 0.2)', // Light lime tint for cells
            current: '#FFD700'      // Yellow for the path LINE
        }
    },

    // -------------------------------------------------------------
    // Shared Hex Grid Math
    // -------------------------------------------------------------
    key(h) {
        return `${h.q},${h.r}`;
    },

    hexDistance(a, b = { q: 0, r: 0 }) {
        return (Math.abs(a.q - b.q) + Math.abs((a.q + a.r) - (b.q + b.r)) + Math.abs(a.r - b.r)) / 2;
    },

    isInside(node, gridRadius) {
        return this.hexDistance(node) <= gridRadius;
    },

    heuristic(a, b) {
        return this.hexDistance(a, b);
    },

    isWalkable(node, gridRadius, walls) {
        return this.isInside(node, gridRadius) && !walls.has(this.key(node));
    },

    forEachHex(gridRadius, callback) {
        const N = gridRadius;
        for (let q = -N; q <= N; q++) {
            const r1 = Math.max(-N, -q - N);
            const r2 = Math.min(N, -q + N);
            for (let r = r1; r <= r2; r++) {
                callback({ q, r });
            }
        }
    },

    getNeighbors(node, gridRadius, walls) {
        const results = [];
        for (const dir of this.directions) {
            const next = { q: node.q + dir.q, r: node.r + dir.r };
            if (this.isWalkable(next, gridRadius, walls)) results.push(next);
        }
        return results;
    },

    getNeighborsIgnoringWalls(node, gridRadius) {
        const results = [];
        for (const dir of this.directions) {
            const next = { q: node.q + dir.q, r: node.r + dir.r };
            if (this.isInside(next, gridRadius)) results.push(next);
        }
        return results;
    },

    randomChoice(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    },

    pixelToHex(x, y, hexSize) {
        const q = (this.sqrt3 / 3 * x - 1 / 3 * y) / hexSize;
        const r = (2 / 3 * y) / hexSize;
        return this.hexRound(q, r);
    },

    hexRound(q, r) {
        const s = -q - r;
        let rq = Math.round(q);
        let rr = Math.round(r);
        let rs = Math.round(s);

        const qDiff = Math.abs(rq - q);
        const rDiff = Math.abs(rr - r);
        const sDiff = Math.abs(rs - s);

        if (qDiff > rDiff && qDiff > sDiff) rq = -rr - rs;
        else if (rDiff > sDiff) rr = -rq - rs;
        else rs = -rq - rr;

        return { q: rq, r: rr };
    },

    hexLerp(a, b, t) {
        return {
            q: a.q + (b.q - a.q) * t,
            r: a.r + (b.r - a.r) * t,
            s: (-a.q - a.r) + ((-b.q - b.r) - (-a.q - a.r)) * t
        };
    },

    hexRoundFractional(h) {
        let rq = Math.round(h.q);
        let rr = Math.round(h.r);
        let rs = Math.round(h.s);

        const qDiff = Math.abs(rq - h.q);
        const rDiff = Math.abs(rr - h.r);
        const sDiff = Math.abs(rs - h.s);

        if (qDiff > rDiff && qDiff > sDiff) rq = -rr - rs;
        else if (rDiff > sDiff) rr = -rq - rs;

        return { q: rq, r: rr };
    },

    getHexLine(a, b) {
        const N = this.hexDistance(a, b);
        const results = [];
        const steps = Math.max(1, N);
        for (let i = 0; i <= steps; i++) {
            results.push(this.hexRoundFractional(this.hexLerp(a, b, 1.0 / steps * i)));
        }
        return results;
    },
    
    hexToPixel(q, r, hexSize) {
        const x = hexSize * (this.sqrt3 * q + this.sqrt3 / 2 * r);
        const y = hexSize * (3 / 2 * r);
        return { x, y };
    },

    // -------------------------------------------------------------
    // Search Core Utilities
    // -------------------------------------------------------------
    speedToDelay(speed) {
        return 205 - speed * 5;
    },

    delayToSpeed(delayMs) {
        return Math.max(1, Math.min(50, Math.round((205 - delayMs) / 5)));
    },

    findNearestWalkable(node, gridRadius, walls) {
        if (this.isWalkable(node, gridRadius, walls)) return node;
        if (!this.isInside(node, gridRadius)) return null;

        const queue = [node];
        let head = 0;
        const seen = new Set([this.key(node)]);

        while (head < queue.length) {
            const current = queue[head++];
            if (this.isWalkable(current, gridRadius, walls)) return current;

            for (const next of this.getNeighborsIgnoringWalls(current, gridRadius)) {
                const nk = this.key(next);
                if (seen.has(nk)) continue;
                seen.add(nk);
                queue.push(next);
            }
        }
        return null;
    },
    
    pickAnyOpenNode(gridRadius, walls) {
        let found = null;
        this.forEachHex(gridRadius, (h) => {
            if (!found && !walls.has(this.key(h))) {
                found = h;
            }
        });
        return found;
    },

    farthestReachableFrom(source, gridRadius, walls) {
        const queue = [source];
        let head = 0;
        const dist = { [this.key(source)]: 0 };
        let farthest = source;

        while (head < queue.length) {
            const current = queue[head++];
            const currentKey = this.key(current);
            const currentDist = dist[currentKey];
            const farKey = this.key(farthest);
            if (currentDist > dist[farKey]) farthest = current;

            for (const next of this.getNeighbors(current, gridRadius, walls)) {
                const nk = this.key(next);
                if (nk in dist) continue;
                dist[nk] = currentDist + 1;
                queue.push(next);
            }
        }
        return farthest;
    },

    // -------------------------------------------------------------
    // Audio Module
    // -------------------------------------------------------------
    audioCtx: null,

    ensureAudioContext(sfxEnabled) {
        if (!sfxEnabled) return null;
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

    playTone(freq, durationSec, type = 'sine', volumeMul = 1, attackSec = 0.003, contextData) {
        if (!contextData.sfxEnabled || contextData.sfxVolume <= 0) return;
        const ctx = this.ensureAudioContext(contextData.sfxEnabled);
        if (!ctx) return;

        const now = ctx.currentTime;
        const gain = ctx.createGain();
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = freq;

        const peak = Math.max(0, Math.min(1, contextData.sfxVolume * volumeMul));
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(peak, now + attackSec);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + durationSec + 0.01);
    },

    playResultSound(found, contextData) {
        if (found) {
            this.playTone(523.25, 0.12, 'sine', 0.9, 0.003, contextData);
            setTimeout(() => this.playTone(659.25, 0.12, 'sine', 0.8, 0.003, contextData), 90);
            setTimeout(() => this.playTone(783.99, 0.18, 'sine', 0.75, 0.003, contextData), 180);
            return;
        }
        this.playTone(180, 0.16, 'sawtooth', 0.7, 0.003, contextData);
    },

    destroyAudio() {
        if (this.audioCtx) {
            this.audioCtx.close().catch(() => {});
            this.audioCtx = null;
        }
    }
};

window.PriorityQueue = PriorityQueue;
window.MazeEngine = MazeEngine;
