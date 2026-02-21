/**
 * PolygonMapCase
 * Procedural Map Generation using Voronoi Diagrams.
 * Based on Amit Patel's (Red Blob Games) algorithm.
 */
const PolygonMapCase = {
    canvas: null,
    ctx: null,
    width: 0,
    height: 0,
    
    // Core Data
    points: [],      // Seed points for Voronoi
    centers: [],     // Polygon centers
    corners: [],     // Polygon corners
    edges: [],       // Dual graph edges
    
    // Config
    config: {
        numPoints: 800,
        lloydIterations: 2,
        seed: Math.random(),
        islandShape: 'perlin', // 'radial', 'perlin'
        showRivers: true,
        renderMode: 'Normal', // 'Normal', 'Relief', 'Artistic'
        riverThreshold: 4.0
    },

    init() {
        this.canvas = document.getElementById('mathCanvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.noise = typeof SimplexNoise !== 'undefined' ? new SimplexNoise() : { noise2D: () => 0 };
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
                id: 'pm_mode',
                label: 'Render Mode',
                options: [
                    { label: 'Normal', value: 'Normal' },
                    { label: 'Relief', value: 'Relief' },
                    { label: 'Artistic', value: 'Artistic' }
                ],
                value: this.config.renderMode,
                onChange: (v) => { this.config.renderMode = v; this.draw(); }
            },
            {
                type: 'slider',
                id: 'pm_points',
                label: 'Complexity',
                min: 100,
                max: 3000,
                step: 100,
                value: this.config.numPoints,
                onChange: (v) => { this.config.numPoints = v; this.reset(); }
            },
            {
                type: 'slider',
                id: 'pm_rivers',
                label: 'River Density',
                min: 1.0,
                max: 20.0,
                step: 0.5,
                value: this.config.riverThreshold,
                onChange: (v) => { this.config.riverThreshold = v; this.draw(); }
            },
            {
                type: 'button',
                id: 'pm_regenerate',
                label: 'New Island',
                value: 'Generate New',
                onClick: () => this.reset()
            }
        ];
    },

    reset() {
        if (this.width === 0 || this.height === 0) this.resize();
        this.config.seed = Math.random();
        this.noise = typeof SimplexNoise !== 'undefined' ? new SimplexNoise(this.config.seed) : this.noise;
        this.generateMap();
        this.draw();
    },

    generateMap() {
        this.points = [];
        const w = this.width || 800;
        const h = this.height || 600;
        
        // 1. Generate Random Points
        for(let i=0; i<this.config.numPoints; i++) {
            this.points.push({
                x: Math.random() * w,
                y: Math.random() * h
            });
        }

        // 2. Lloyd Relaxation
        for(let i=0; i<this.config.lloydIterations; i++) {
            this.points = this.relaxPoints(this.points);
        }

        // 3. Delaunay & Voronoi
        const coords = new Float64Array(this.points.length * 2);
        for(let i=0; i<this.points.length; i++) {
            coords[i*2] = this.points[i].x;
            coords[i*2+1] = this.points[i].y;
        }
        const delaunay = new Delaunator(coords);
        this.buildGraph(delaunay);
        
        // 4. Elevation (Noise-based)
        this.assignElevation();
        
        // 5. Rivers
        this.assignRivers(delaunay);
        
        // 6. Moisture & Biomes
        this.assignMoisture();
        this.assignBiomes();
    },

    relaxPoints(points) {
        const coords = new Float64Array(points.length * 2);
        for(let i=0; i<points.length; i++) {
            coords[i*2] = points[i].x;
            coords[i*2+1] = points[i].y;
        }
        const delaunay = new Delaunator(coords);
        
        const inedges = new Int32Array(points.length).fill(-1);
        for (let e = 0; e < delaunay.halfedges.length; e++) {
            const p = delaunay.triangles[e % 3 === 2 ? e - 2 : e + 1];
            if (delaunay.halfedges[e] === -1 || inedges[p] === -1) inedges[p] = e;
        }

        const newPoints = [];
        for (let i = 0; i < points.length; i++) {
            let centerX = 0, centerY = 0, count = 0;
            let e = inedges[i];
            if (e === -1) { newPoints.push(points[i]); continue; }
            const startNode = e;
            do {
                const t = Math.floor(e / 3);
                const p1_idx = delaunay.triangles[t * 3];
                const p2_idx = delaunay.triangles[t * 3 + 1];
                const p3_idx = delaunay.triangles[t * 3 + 2];
                if (p1_idx === undefined) break;
                const p1 = { x: delaunay.coords[p1_idx * 2], y: delaunay.coords[p1_idx * 2 + 1] };
                const p2 = { x: delaunay.coords[p2_idx * 2], y: delaunay.coords[p2_idx * 2 + 1] };
                const p3 = { x: delaunay.coords[p3_idx * 2], y: delaunay.coords[p3_idx * 2 + 1] };
                const cc = this.getCircumcenter(p1, p2, p3);
                if (isFinite(cc.x)) { centerX += cc.x; centerY += cc.y; count++; }
                e = delaunay.halfedges[e];
                if (e === -1) break;
                e = e % 3 === 2 ? e - 2 : e + 1;
            } while (e !== startNode);
            newPoints.push(count > 0 ? { x: centerX / count, y: centerY / count } : points[i]);
        }
        return newPoints;
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

    buildGraph(delaunay) {
        this.centers = [];
        this.neighbors = Array.from({length: this.points.length}, () => []);
        
        const { halfedges, triangles } = delaunay;
        for (let i = 0; i < this.points.length; i++) {
            this.centers.push({
                idx: i,
                x: this.points[i].x,
                y: this.points[i].y,
                elevation: 0,
                moisture: 0,
                biome: 'OCEAN',
                water: false,
                flow: 0,
                downslope: -1
            });
        }

        // Neighbors
        for (let e = 0; e < halfedges.length; e++) {
            const p = triangles[e];
            const q = triangles[e % 3 === 2 ? e - 2 : e + 1];
            if (!this.neighbors[p].includes(q)) this.neighbors[p].push(q);
            if (!this.neighbors[q].includes(p)) this.neighbors[q].push(p);
        }
    },

    assignElevation() {
        this.centers.forEach(c => {
            const nx = c.x / this.width - 0.5;
            const ny = c.y / this.height - 0.5;
            const d = Math.sqrt(nx*nx + ny*ny) * 2; // 0 at center, 1 at edge
            
            // Perlin noise for irregular shape
            let e = (1 + this.noise.noise2D(nx * 2, ny * 2)) / 2 * 0.5;
            e += (1 + this.noise.noise2D(nx * 4, ny * 4)) / 2 * 0.25;
            e += (1 + this.noise.noise2D(nx * 8, ny * 8)) / 2 * 0.125;
            
            // Mask with radial gradient to ensure island
            e = (e + 0.2) * (1.1 - d * d);
            
            c.elevation = Math.max(0, e);
            c.water = c.elevation < 0.15;
            if (c.water) c.elevation *= 0.5;
        });
    },

    assignRivers(delaunay) {
        // 1. Find downslope for each cell
        this.centers.forEach(c => {
            if (c.water) return;
            let lowest = c;
            this.neighbors[c.idx].forEach(nIdx => {
                if (this.centers[nIdx].elevation < lowest.elevation) {
                    lowest = this.centers[nIdx];
                }
            });
            c.downslope = lowest.idx !== c.idx ? lowest.idx : -1;
        });

        // 2. Sort by elevation (high to low)
        const sorted = [...this.centers].sort((a, b) => b.elevation - a.elevation);
        
        // 3. Accumulate flow
        this.centers.forEach(c => c.flow = c.water ? 0 : 1); // Start with rainfall
        sorted.forEach(c => {
            if (c.downslope !== -1) {
                this.centers[c.downslope].flow += c.flow;
            }
        });
    },

    assignMoisture() {
        this.centers.forEach(c => {
            if (c.water) {
                c.moisture = 1.0;
            } else {
                // Moisture based on flow and a bit of noise
                const nx = c.x / this.width;
                const ny = c.y / this.height;
                const noise = (1 + this.noise.noise2D(nx * 5, ny * 5)) / 2;
                c.moisture = Math.min(1.0, (c.flow / 20) + noise * 0.3);
            }
        });
    },

    assignBiomes() {
        this.centers.forEach(c => {
            const e = c.elevation;
            const m = c.moisture;
            
            if (c.water) {
                c.biome = e < 0.05 ? 'DEEP_OCEAN' : 'OCEAN';
            } else if (e > 0.8) {
                c.biome = 'SNOW';
            } else if (e > 0.6) {
                c.biome = m > 0.5 ? 'TUNDRA' : 'BARE';
            } else if (e > 0.4) {
                if (m > 0.6) c.biome = 'TAIGA';
                else if (m > 0.3) c.biome = 'SHRUBLAND';
                else c.biome = 'TEMPERATE_DESERT';
            } else if (e > 0.2) {
                if (m > 0.6) c.biome = 'TEMPERATE_RAIN_FOREST';
                else if (m > 0.3) c.biome = 'TEMPERATE_DECIDUOUS_FOREST';
                else c.biome = 'GRASSLAND';
            } else {
                if (m > 0.6) c.biome = 'TROPICAL_RAIN_FOREST';
                else if (m > 0.3) c.biome = 'TROPICAL_SEASONAL_FOREST';
                else if (m > 0.1) c.biome = 'GRASSLAND';
                else c.biome = 'SUBTROPICAL_DESERT';
            }
            // Beach check
            if (!c.water && this.neighbors[c.idx].some(n => this.centers[n].water && this.centers[n].biome === 'OCEAN') && e < 0.2) {
                c.biome = 'BEACH';
            }
        });
    },

    getBiomeColor(biome, elevation = 0.5) {
        const colors = {
            'DEEP_OCEAN': '#152036',
            'OCEAN': '#1a2b4a',
            'BEACH': '#d2b98b',
            'SNOW': '#ffffff',
            'TUNDRA': '#bbbbaa',
            'BARE': '#888888',
            'TAIGA': '#99aa77',
            'SHRUBLAND': '#889977',
            'TEMPERATE_DESERT': '#c9d29b',
            'TEMPERATE_RAIN_FOREST': '#448855',
            'TEMPERATE_DECIDUOUS_FOREST': '#679459',
            'GRASSLAND': '#88aa55',
            'TROPICAL_RAIN_FOREST': '#337755',
            'TROPICAL_SEASONAL_FOREST': '#559944',
            'SUBTROPICAL_DESERT': '#d2b48c'
        };
        
        let color = colors[biome] || '#444';
        
        // Artistic or Relief adjustments
        if (this.config.renderMode === 'Artistic') {
            // Soften colors
            return color + 'EE';
        }
        
        return color;
    },

    draw() {
        if(!this.ctx) return;
        this.ctx.clearRect(0, 0, this.width, this.height);
        
        // Artistic background
        if (this.config.renderMode === 'Artistic') {
            this.ctx.fillStyle = '#f4e4bc'; // Parchment
            this.ctx.fillRect(0, 0, this.width, this.height);
        }

        const coords = new Float64Array(this.points.length * 2);
        for(let i=0; i<this.points.length; i++) {
            coords[i*2] = this.points[i].x;
            coords[i*2+1] = this.points[i].y;
        }
        const delaunay = new Delaunator(coords);
        
        const inedges = new Int32Array(this.points.length).fill(-1);
        for (let e = 0; e < delaunay.halfedges.length; e++) {
            const p = delaunay.triangles[e % 3 === 2 ? e - 2 : e + 1];
            if (delaunay.halfedges[e] === -1 || inedges[p] === -1) inedges[p] = e;
        }

        // 1. Draw Biomes & Relief
        for (let i = 0; i < this.points.length; i++) {
            const center = this.centers[i];
            if (!center || !center.biome) continue;

            let voronoiPoints = [];
            let e = inedges[i];
            if (e === -1) continue;
            
            const startNode = e;
            do {
                const t = Math.floor(e / 3);
                const p1_idx = delaunay.triangles[t * 3];
                const p2_idx = delaunay.triangles[t * 3 + 1];
                const p3_idx = delaunay.triangles[t * 3 + 2];
                if (p1_idx === undefined) break;
                const p1 = { x: delaunay.coords[p1_idx * 2], y: delaunay.coords[p1_idx * 2 + 1] };
                const p2 = { x: delaunay.coords[p2_idx * 2], y: delaunay.coords[p2_idx * 2 + 1] };
                const p3 = { x: delaunay.coords[p3_idx * 2], y: delaunay.coords[p3_idx * 2 + 1] };
                voronoiPoints.push(this.getCircumcenter(p1, p2, p3));
                e = delaunay.halfedges[e];
                if (e === -1) break;
                e = e % 3 === 2 ? e - 2 : e + 1;
            } while (e !== startNode);
            
            if (voronoiPoints.length > 2) {
                this.ctx.beginPath();
                this.ctx.moveTo(voronoiPoints[0].x, voronoiPoints[0].y);
                for (let j = 1; j < voronoiPoints.length; j++) this.ctx.lineTo(voronoiPoints[j].x, voronoiPoints[j].y);
                this.ctx.closePath();
                
                let baseColor = this.getBiomeColor(center.biome);
                
                if (this.config.renderMode === 'Relief' && !center.water) {
                    // Calculate shadow based on downslope direction (simple fake 3D)
                    let brightness = 100;
                    if (center.downslope !== -1) {
                        const dc = this.centers[center.downslope];
                        const angle = Math.atan2(dc.y - center.y, dc.x - center.x);
                        const lightDir = -Math.PI / 4; // Light from top-left
                        const diff = Math.cos(angle - lightDir);
                        brightness = 100 + diff * 20;
                    }
                    this.ctx.fillStyle = `hsl(${this.getHSL(baseColor)}, ${brightness}%)`;
                } else {
                    this.ctx.fillStyle = baseColor;
                }
                
                this.ctx.fill();
                
                if (this.config.renderMode === 'Artistic') {
                    this.ctx.strokeStyle = '#d2b98b';
                    this.ctx.lineWidth = 0.3;
                    this.ctx.stroke();
                } else {
                    this.ctx.strokeStyle = 'rgba(0,0,0,0.05)';
                    this.ctx.lineWidth = 0.5;
                    this.ctx.stroke();
                }
            }
        }

        // 2. Draw Rivers
        if (this.config.showRivers) {
            this.ctx.save();
            this.ctx.lineCap = 'round';
            this.ctx.strokeStyle = this.config.renderMode === 'Artistic' ? '#30407f' : '#30407fd0';
            
            this.centers.forEach(c => {
                if (c.downslope !== -1 && c.flow >= this.config.riverThreshold) {
                    const dc = this.centers[c.downslope];
                    this.ctx.beginPath();
                    this.ctx.lineWidth = Math.min(5, Math.sqrt(c.flow) * 0.5);
                    this.ctx.moveTo(c.x, c.y);
                    this.ctx.lineTo(dc.x, dc.y);
                    this.ctx.stroke();
                }
            });
            this.ctx.restore();
        }

        // 3. UI Labels
        this.ctx.fillStyle = this.config.renderMode === 'Artistic' ? '#5d4037' : 'rgba(255,255,255,0.8)';
        this.ctx.font = 'bold 24px Inter';
        this.ctx.fillText('Polygon Map Pro', 40, 60);
        this.ctx.font = '14px Inter';
        this.ctx.fillText(`Mode: ${this.config.renderMode} | Rivers: ${this.config.showRivers ? 'ON' : 'OFF'}`, 40, 90);
    },

    getHSL(hex) {
        // Simple hex to HSL conversion for relief shading
        let r = parseInt(hex.slice(1, 3), 16) / 255;
        let g = parseInt(hex.slice(3, 5), 16) / 255;
        let b = parseInt(hex.slice(5, 7), 16) / 255;
        let max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;
        if (max === min) h = s = 0;
        else {
            let d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }
        return `${h * 360}, ${s * 100}%`;
    },

    start() {
        this.reset();
    },

    stop() {},

    destroy() {}
};

// Export to window
window.PolygonMapCase = PolygonMapCase;
