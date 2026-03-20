// Processes Subsystem Visualization
// Version: 6

debugLog('🧠 processes-belt.js v6: Script loading...');

class ProcessesSubsystemVisualization {
    constructor() {
        this.container = null;
        this.canvas = null;
        this.ctx = null;
        this.exitButton = null;
        this.isActive = false;
        this.animationId = null;
        this.telemetryInterval = null;
        this.telemetry = null;
        this.tick = 0;
        this.nodeLayout = new Map();
        this.layoutMode = 'temporal';
        this.modeButtons = new Map();
        this.edgeFilter = 'all';
        this.filterButtons = new Map();
        this.overlayNodes = [];
        this.hoveredNodePid = null;
        this.nodeHitAreas = [];
        this.positionHistory = [];
        this.mouseMoveHandler = null;
    }

    init(containerId = 'processes-belt-container') {
        this.container = document.createElement('div');
        this.container.id = containerId;
        this.container.style.cssText = `
            position: fixed;
            inset: 0;
            width: 100%;
            height: 100%;
            background: radial-gradient(circle at 50% 40%, #121821 0%, #0a0d12 70%);
            z-index: 9999;
            overflow: hidden;
        `;
        document.body.appendChild(this.container);

        this.canvas = document.createElement('canvas');
        this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
        this.container.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');
        this.mouseMoveHandler = (event) => this.onMouseMove(event);
        this.canvas.addEventListener('mousemove', this.mouseMoveHandler);
        this.onResize();
        window.addEventListener('resize', () => this.onResize());

        this.exitButton = document.createElement('button');
        this.exitButton.textContent = 'BACK TO MAIN';
        this.exitButton.style.cssText = `
            position:absolute;top:20px;right:20px;padding:10px 18px;z-index:1001;
            background: rgba(7, 10, 16, 0.92); border:1px solid rgba(178,190,212,0.45);
            color:#d5dce8; font-family:'Share Tech Mono', monospace; font-size:12px; cursor:pointer;
            box-shadow: 0 0 14px rgba(150,175,220,0.25);
        `;
        this.exitButton.onclick = () => window.location.assign('/');
        this.container.appendChild(this.exitButton);
        this.overlayNodes.push(this.exitButton);

        this.createModeToggle();
        this.createEdgeFilterToggle();
        return true;
    }

    createModeToggle() {
        const panel = document.createElement('div');
        panel.style.cssText = `
            position:absolute;top:20px;left:20px;display:flex;gap:8px;z-index:1001;
        `;
        const modes = [
            { key: 'temporal', label: 'TEMPORAL T-1/T/T+1' },
            { key: 'radial', label: 'RADIAL GRAPH' }
        ];
        modes.forEach((m) => {
            const btn = document.createElement('button');
            btn.textContent = m.label;
            btn.style.cssText = `
                padding:8px 10px;background:rgba(8,12,18,0.86);
                border:1px solid rgba(150,164,188,0.35);color:#bcc8db;
                font-family:'Share Tech Mono', monospace;font-size:10px;cursor:pointer;
            `;
            btn.onclick = () => this.setLayoutMode(m.key);
            panel.appendChild(btn);
            this.modeButtons.set(m.key, btn);
            this.overlayNodes.push(btn);
        });
        this.container.appendChild(panel);
        this.overlayNodes.push(panel);
        this.setLayoutMode(this.layoutMode);
    }

    setLayoutMode(modeKey) {
        this.layoutMode = (modeKey === 'radial') ? 'radial' : 'temporal';
        this.modeButtons.forEach((btn, key) => {
            const active = key === this.layoutMode;
            btn.style.background = active ? 'rgba(32, 52, 81, 0.92)' : 'rgba(8,12,18,0.86)';
            btn.style.borderColor = active ? 'rgba(124, 178, 255, 0.9)' : 'rgba(150,164,188,0.35)';
            btn.style.color = active ? '#d9ecff' : '#bcc8db';
        });
    }

    createEdgeFilterToggle() {
        const panel = document.createElement('div');
        panel.style.cssText = `
            position:absolute;top:56px;left:20px;display:flex;gap:6px;z-index:1001;
        `;
        const filters = [
            { key: 'all', label: 'ALL' },
            { key: 'syscalls', label: 'SYSCALLS' },
            { key: 'ipc', label: 'IPC' },
            { key: 'network', label: 'NETWORK' },
            { key: 'file_access', label: 'FILE' }
        ];
        filters.forEach((f) => {
            const btn = document.createElement('button');
            btn.textContent = f.label;
            btn.style.cssText = `
                padding:5px 8px;background:rgba(8,12,18,0.86);
                border:1px solid rgba(150,164,188,0.35);color:#bcc8db;
                font-family:'Share Tech Mono', monospace;font-size:9px;cursor:pointer;
            `;
            btn.onclick = () => this.setEdgeFilter(f.key);
            panel.appendChild(btn);
            this.filterButtons.set(f.key, btn);
            this.overlayNodes.push(btn);
        });
        this.container.appendChild(panel);
        this.overlayNodes.push(panel);
        this.setEdgeFilter(this.edgeFilter);
    }

    setEdgeFilter(filterKey) {
        const valid = new Set(['all', 'syscalls', 'ipc', 'network', 'file_access']);
        this.edgeFilter = valid.has(filterKey) ? filterKey : 'all';
        this.filterButtons.forEach((btn, key) => {
            const active = key === this.edgeFilter;
            btn.style.background = active ? 'rgba(32, 52, 81, 0.92)' : 'rgba(8,12,18,0.86)';
            btn.style.borderColor = active ? 'rgba(124,178,255,0.9)' : 'rgba(150,164,188,0.35)';
            btn.style.color = active ? '#d9ecff' : '#bcc8db';
        });
    }

    onMouseMove(event) {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        let hovered = null;
        for (const n of this.nodeHitAreas) {
            const dx = x - n.x;
            const dy = y - n.y;
            if (Math.sqrt(dx * dx + dy * dy) <= n.r + 3) {
                hovered = Number(n.pid || 0);
                break;
            }
        }
        this.hoveredNodePid = hovered;
        this.canvas.style.cursor = hovered ? 'pointer' : 'default';
    }

    fetchTelemetry() {
        return fetch('/api/processes-realtime', { cache: 'no-store' })
            .then((res) => res.json())
            .then((data) => {
                if (!data || data.error) throw new Error(data?.error || 'No data');
                this.telemetry = data;
            })
            .catch(() => {
                this.telemetry = {
                    neural_graph: { nodes: [], edges: [] },
                    meta: { mode: 'fallback', seccomp_filter_percent: 0 }
                };
            });
    }

    drawPanel(x, y, w, h, title) {
        const r = Math.max(0, Math.min(8, w / 2, h / 2));
        this.ctx.beginPath();
        this.ctx.moveTo(x + r, y);
        this.ctx.lineTo(x + w - r, y);
        this.ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        this.ctx.lineTo(x + w, y + h - r);
        this.ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        this.ctx.lineTo(x + r, y + h);
        this.ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        this.ctx.lineTo(x, y + r);
        this.ctx.quadraticCurveTo(x, y, x + r, y);
        this.ctx.closePath();
        this.ctx.fillStyle = 'rgba(8, 11, 16, 0.88)';
        this.ctx.fill();
        this.ctx.strokeStyle = 'rgba(165, 178, 200, 0.35)';
        this.ctx.lineWidth = 1;
        this.ctx.stroke();
        this.ctx.fillStyle = '#d8e5f7';
        this.ctx.font = '13px "Share Tech Mono", monospace';
        this.ctx.fillText(title, x + 14, y + 22);
    }

    edgeColor(type) {
        if (type === 'syscalls') return 'rgba(138,156,234,0.42)';
        if (type === 'ipc') return 'rgba(96,214,157,0.42)';
        if (type === 'network') return 'rgba(244,201,119,0.46)';
        if (type === 'file_access') return 'rgba(235,126,126,0.44)';
        return 'rgba(165,178,200,0.38)';
    }

    drawArrow(x1, y1, x2, y2, color, width = 1) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const ux = dx / len;
        const uy = dy / len;
        const ex = x2 - ux * 7;
        const ey = y2 - uy * 7;
        this.ctx.beginPath();
        this.ctx.moveTo(x1, y1);
        this.ctx.lineTo(ex, ey);
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = width;
        this.ctx.stroke();
        this.ctx.beginPath();
        this.ctx.moveTo(ex, ey);
        this.ctx.lineTo(ex - uy * 3 - ux * 4, ey + ux * 3 - uy * 4);
        this.ctx.lineTo(ex + uy * 3 - ux * 4, ey - ux * 3 - uy * 4);
        this.ctx.closePath();
        this.ctx.fillStyle = color;
        this.ctx.fill();
    }

    drawNeuralGraph(x, y, w, h) {
        this.drawPanel(x, y, w, h, 'PROCESS NEURAL GRAPH');
        const graph = this.telemetry?.neural_graph || {};
        const nodes = Array.isArray(graph.nodes) ? graph.nodes.slice(0, 18) : [];
        const rawEdges = Array.isArray(graph.edges) ? graph.edges.slice(0, 72) : [];
        const edges = rawEdges.filter((e) => this.edgeFilter === 'all' || String(e.type || '') === this.edgeFilter);
        if (!nodes.length) {
            this.ctx.fillStyle = 'rgba(196,207,224,0.72)';
            this.ctx.font = '12px "Share Tech Mono", monospace';
            this.ctx.fillText('NO PROCESS GRAPH DATA', x + 20, y + 56);
            return;
        }

        const pos = new Map();
        this.nodeHitAreas = [];
        if (this.layoutMode === 'radial') {
            this.drawRadialNeuralGraph(nodes, edges, pos, x, y, w, h);
            return;
        }

        // Temporal layers to mimic T-1 / T / T+1 style.
        const layerXs = [x + w * 0.24, x + w * 0.5, x + w * 0.76];
        const layerLabels = ['T-1', 'T', 'T+1'];
        const layers = [[], [], []];
        nodes.forEach((node, idx) => layers[idx % 3].push(node));

        layerXs.forEach((lx, li) => {
            this.ctx.strokeStyle = 'rgba(160, 176, 200, 0.15)';
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.moveTo(lx, y + 40);
            this.ctx.lineTo(lx, y + h - 36);
            this.ctx.stroke();
            this.ctx.fillStyle = 'rgba(200, 214, 232, 0.78)';
            this.ctx.font = '15px "Share Tech Mono", monospace';
            this.ctx.fillText(layerLabels[li], lx - 16, y + h - 12);
        });

        layers.forEach((layerNodes, li) => {
            const lx = layerXs[li];
            const step = Math.max(30, (h - 120) / Math.max(1, layerNodes.length));
            const startY = y + 66 + Math.max(0, ((h - 130) - step * layerNodes.length) * 0.5);
            layerNodes.forEach((node, idx) => {
                const pid = Number(node.pid || 0);
                const wave = Math.sin(this.tick * 0.02 + idx * 0.6 + li * 0.8) * 8;
                const nx = lx + wave;
                const ny = startY + idx * step;
                pos.set(pid, { x: nx, y: ny, layer: li });
            });
        });

        // Track short history to show trails (T-2/T-1/T).
        this.positionHistory.push(pos);
        if (this.positionHistory.length > 3) this.positionHistory.shift();

        // Hover neighborhood detection.
        const neighborPids = new Set();
        if (this.hoveredNodePid) {
            edges.forEach((edge) => {
                const s = Number(edge.source || 0);
                const t = Number(edge.target || 0);
                if (s === this.hoveredNodePid) neighborPids.add(t);
                if (t === this.hoveredNodePid) neighborPids.add(s);
            });
        }

        // Intra-layer dense links (neural cluster style)
        layers.forEach((layerNodes) => {
            for (let i = 0; i < layerNodes.length; i++) {
                for (let j = i + 1; j < Math.min(layerNodes.length, i + 4); j++) {
                    const pa = pos.get(Number(layerNodes[i].pid || 0));
                    const pb = pos.get(Number(layerNodes[j].pid || 0));
                    if (!pa || !pb) continue;
                    this.ctx.beginPath();
                    this.ctx.moveTo(pa.x, pa.y);
                    this.ctx.lineTo(pb.x, pb.y);
                    this.ctx.strokeStyle = 'rgba(196, 220, 245, 0.24)';
                    this.ctx.lineWidth = 0.9;
                    this.ctx.stroke();
                }
            }
        });

        // Inter-layer long links from telemetry edges.
        edges.forEach((edge, idx) => {
            const s = pos.get(Number(edge.source || 0));
            const t = pos.get(Number(edge.target || 0));
            if (!s || !t) return;
            const wv = Number(edge.weight || 0.4);
            const color = this.edgeColor(String(edge.type || ''));
            const isHoverEdge = this.hoveredNodePid && (Number(edge.source || 0) === this.hoveredNodePid || Number(edge.target || 0) === this.hoveredNodePid);
            this.ctx.globalAlpha = isHoverEdge ? 0.95 : (0.2 + wv * 0.4);
            this.drawArrow(s.x, s.y, t.x, t.y, color, 0.7 + wv * 1.1);
            this.ctx.globalAlpha = 1;
            const tpos = (this.tick * 0.006 + idx * 0.07) % 1;
            const px = s.x + (t.x - s.x) * tpos;
            const py = s.y + (t.y - s.y) * tpos;
            this.ctx.beginPath();
            this.ctx.arc(px, py, 1.8, 0, Math.PI * 2);
            this.ctx.fillStyle = color.replace('0.4', '0.95');
            this.ctx.fill();
        });

        nodes.forEach((node, idx) => {
            const pid = Number(node.pid || 0);
            const p = pos.get(pid);
            if (!p) return;
            const pressure = Number(node.syscall_pressure || 0);
            const nodeR = 8 + Math.min(7, pressure / 20);
            const danger = pressure >= 70;
            const mode = String(node.seccomp_mode || 'unknown');
            const fill = danger ? '#eb7e7e' : (mode === 'filter' || mode === 'strict' ? '#60d69d' : '#8a9cea');
            const isHovered = this.hoveredNodePid && pid === this.hoveredNodePid;
            const isNeighbor = this.hoveredNodePid && neighborPids.has(pid);

            // Draw node trail ghosts.
            for (let hi = 0; hi < this.positionHistory.length - 1; hi++) {
                const histPos = this.positionHistory[hi].get(pid);
                if (!histPos) continue;
                const ghostAlpha = 0.08 + hi * 0.08;
                this.ctx.beginPath();
                this.ctx.arc(histPos.x, histPos.y, Math.max(2, nodeR * 0.6), 0, Math.PI * 2);
                this.ctx.fillStyle = fill;
                this.ctx.globalAlpha = ghostAlpha;
                this.ctx.fill();
            }
            this.ctx.globalAlpha = 1;

            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, nodeR, 0, Math.PI * 2);
            this.ctx.fillStyle = fill;
            this.ctx.globalAlpha = isHovered ? 1 : (isNeighbor ? 0.95 : 0.85);
            this.ctx.fill();
            this.ctx.globalAlpha = 1;
            this.ctx.strokeStyle = isHovered ? 'rgba(255,255,255,0.98)' : 'rgba(227, 241, 255, 0.95)';
            this.ctx.lineWidth = isHovered ? 2 : 1.1;
            this.ctx.stroke();
            this.ctx.fillStyle = '#d8e5f7';
            this.ctx.font = '9px "Share Tech Mono", monospace';
            this.ctx.fillText(`${String(node.name || 'proc').slice(0, 8)}`, p.x - 20, p.y + nodeR + 13);
            this.nodeHitAreas.push({ x: p.x, y: p.y, r: nodeR, pid });
        });

        // Legend
        this.ctx.fillStyle = '#a7b6cb';
        this.ctx.font = '10px "Share Tech Mono", monospace';
        this.ctx.fillText('hover node: highlight neighborhood | trails show T-2/T-1/T', x + 14, y + h - 14);
    }

    drawRadialNeuralGraph(nodes, edges, pos, x, y, w, h) {
        const cx = x + w * 0.5;
        const cy = y + h * 0.52;
        const ring = Math.min(w, h) * 0.38;
        this.nodeHitAreas = [];
        nodes.forEach((node, idx) => {
            const pid = Number(node.pid || 0);
            const a = ((Math.PI * 2) / Math.max(1, nodes.length)) * idx - Math.PI / 2;
            const drift = Math.sin(this.tick * 0.02 + idx * 0.4) * 0.06;
            const nx = cx + Math.cos(a + drift) * (ring * (0.75 + (idx % 4) * 0.07));
            const ny = cy + Math.sin(a + drift) * (ring * (0.75 + (idx % 4) * 0.07));
            pos.set(pid, { x: nx, y: ny });
        });

        this.positionHistory.push(pos);
        if (this.positionHistory.length > 3) this.positionHistory.shift();

        const neighborPids = new Set();
        if (this.hoveredNodePid) {
            edges.forEach((edge) => {
                const s = Number(edge.source || 0);
                const t = Number(edge.target || 0);
                if (s === this.hoveredNodePid) neighborPids.add(t);
                if (t === this.hoveredNodePid) neighborPids.add(s);
            });
        }

        // Core glow
        const coreGrad = this.ctx.createRadialGradient(cx, cy, 8, cx, cy, 120);
        coreGrad.addColorStop(0, 'rgba(124,178,255,0.45)');
        coreGrad.addColorStop(1, 'rgba(124,178,255,0)');
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, 120, 0, Math.PI * 2);
        this.ctx.fillStyle = coreGrad;
        this.ctx.fill();

        edges.forEach((edge, idx) => {
            const s = pos.get(Number(edge.source || 0));
            const t = pos.get(Number(edge.target || 0));
            if (!s || !t) return;
            const wv = Number(edge.weight || 0.4);
            const color = this.edgeColor(String(edge.type || ''));
            const isHoverEdge = this.hoveredNodePid && (Number(edge.source || 0) === this.hoveredNodePid || Number(edge.target || 0) === this.hoveredNodePid);
            this.ctx.globalAlpha = isHoverEdge ? 0.95 : (0.2 + wv * 0.38);
            this.drawArrow(s.x, s.y, t.x, t.y, color, 0.7 + wv);
            this.ctx.globalAlpha = 1;
            const tp = (this.tick * 0.006 + idx * 0.08) % 1;
            const px = s.x + (t.x - s.x) * tp;
            const py = s.y + (t.y - s.y) * tp;
            this.ctx.beginPath();
            this.ctx.arc(px, py, 1.7, 0, Math.PI * 2);
            this.ctx.fillStyle = color.replace('0.4', '0.95');
            this.ctx.fill();
        });

        nodes.forEach((node) => {
            const pid = Number(node.pid || 0);
            const p = pos.get(pid);
            if (!p) return;
            const pressure = Number(node.syscall_pressure || 0);
            const nodeR = 7 + Math.min(8, pressure / 18);
            const danger = pressure >= 70;
            const mode = String(node.seccomp_mode || 'unknown');
            const fill = danger ? '#eb7e7e' : (mode === 'filter' || mode === 'strict' ? '#60d69d' : '#8a9cea');
            const isHovered = this.hoveredNodePid && pid === this.hoveredNodePid;
            const isNeighbor = this.hoveredNodePid && neighborPids.has(pid);

            for (let hi = 0; hi < this.positionHistory.length - 1; hi++) {
                const histPos = this.positionHistory[hi].get(pid);
                if (!histPos) continue;
                const ghostAlpha = 0.07 + hi * 0.08;
                this.ctx.beginPath();
                this.ctx.arc(histPos.x, histPos.y, Math.max(2, nodeR * 0.6), 0, Math.PI * 2);
                this.ctx.fillStyle = fill;
                this.ctx.globalAlpha = ghostAlpha;
                this.ctx.fill();
            }
            this.ctx.globalAlpha = 1;

            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, nodeR, 0, Math.PI * 2);
            this.ctx.fillStyle = fill;
            this.ctx.fill();
            this.ctx.strokeStyle = isHovered ? 'rgba(255,255,255,0.98)' : 'rgba(227,241,255,0.95)';
            this.ctx.lineWidth = isHovered ? 2 : 1;
            this.ctx.stroke();
            this.ctx.fillStyle = '#d8e5f7';
            this.ctx.globalAlpha = isHovered ? 1 : (isNeighbor ? 0.95 : 0.82);
            this.ctx.font = '9px "Share Tech Mono", monospace';
            this.ctx.fillText(`${String(node.name || 'proc').slice(0, 8)}`, p.x - 20, p.y + nodeR + 12);
            this.ctx.globalAlpha = 1;
            this.nodeHitAreas.push({ x: p.x, y: p.y, r: nodeR, pid });
        });

        this.ctx.fillStyle = '#a7b6cb';
        this.ctx.font = '10px "Share Tech Mono", monospace';
        this.ctx.fillText('radial mode: global coupling + hover neighborhood + short trails', x + 14, y + h - 14);
    }

    drawTopStats(x, y, w, h) {
        this.drawPanel(x, y, w, h, 'BEHAVIOR SIGNALS');
        const meta = this.telemetry?.meta || {};
        const graph = this.telemetry?.neural_graph || {};
        const n = Array.isArray(graph.nodes) ? graph.nodes.length : 0;
        const e = Array.isArray(graph.edges) ? graph.edges.length : 0;
        this.ctx.fillStyle = '#d8e5f7';
        this.ctx.font = '11px "Share Tech Mono", monospace';
        this.ctx.fillText(`nodes ${n}`, x + 16, y + 50);
        this.ctx.fillText(`edges ${e}`, x + 130, y + 50);
        this.ctx.fillText(`seccomp ${Number(meta.seccomp_filter_percent || 0).toFixed(2)}%`, x + 232, y + 50);
        this.ctx.fillStyle = '#a7b6cb';
        this.ctx.fillText('processes as neural behavior graph: nodes=processes, edges=syscalls/ipc/network/file', x + 16, y + 72);
    }

    drawScene() {
        if (!this.ctx || !this.canvas) return;
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.ctx.clearRect(0, 0, w, h);
        this.tick += 1;

        const bg = this.ctx.createRadialGradient(w * 0.5, h * 0.4, 0, w * 0.5, h * 0.4, Math.max(w, h) * 0.72);
        bg.addColorStop(0, '#121821');
        bg.addColorStop(0.7, '#0a0d12');
        bg.addColorStop(1, '#0a0d12');
        this.ctx.fillStyle = bg;
        this.ctx.fillRect(0, 0, w, h);

        this.ctx.fillStyle = '#d4dbe8';
        this.ctx.font = '24px "Share Tech Mono", monospace';
        this.ctx.fillText('KERNEL PROCESSES SUBSYSTEM', w * 0.5 - 220, 42);
        this.ctx.fillStyle = '#a7b6cb';
        this.ctx.font = '11px "Share Tech Mono", monospace';
        this.ctx.fillText('neural behavior model: processes as nodes, kernel interactions as edges', w * 0.5 - 290, 64);

        const gap = 16;
        const top = 86;
        const statsH = 98;
        const graphY = top + statsH + gap;
        const graphH = Math.max(260, h - graphY - 20);
        this.drawTopStats(gap, top, w - gap * 2, statsH);
        this.drawNeuralGraph(gap, graphY, w - gap * 2, graphH);
    }

    animate() {
        if (!this.isActive) return;
        this.animationId = requestAnimationFrame(() => this.animate());
        this.drawScene();
    }

    activate() {
        this.isActive = true;
        this.fetchTelemetry();
        this.telemetryInterval = setInterval(() => {
            if (this.isActive) this.fetchTelemetry();
        }, 1200);
        this.animate();
    }

    onResize() {
        if (!this.canvas || !this.ctx) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.canvas.width = Math.floor(window.innerWidth * dpr);
        this.canvas.height = Math.floor(window.innerHeight * dpr);
        this.canvas.style.width = `${window.innerWidth}px`;
        this.canvas.style.height = `${window.innerHeight}px`;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
}

window.ProcessesSubsystemVisualization = ProcessesSubsystemVisualization;
debugLog('🧠 processes-belt.js: ProcessesSubsystemVisualization exported to window');
