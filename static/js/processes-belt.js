// Processes Subsystem Visualization
// Version: 13

debugLog('🧠 processes-belt.js v13: Script loading...');

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
            position:absolute;top:18px;right:18px;padding:8px 14px;z-index:10021;
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
            position:absolute;top:18px;left:18px;display:flex;gap:8px;z-index:1001;
        `;
        const modes = [
            { key: 'temporal', label: '3-LAYER GRAPH' },
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
            position:absolute;top:54px;left:18px;display:flex;flex-wrap:wrap;max-width:min(520px,92vw);gap:6px;z-index:1001;
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

    drawPanel(x, y, w, h, title, opts = {}) {
        const alpha = typeof opts.alpha === 'number' ? opts.alpha : 0.88;
        const showTitle = opts.showTitle !== false;
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
        this.ctx.fillStyle = `rgba(5, 9, 16, ${alpha})`;
        this.ctx.fill();
        this.ctx.strokeStyle = 'rgba(140, 168, 210, 0.38)';
        this.ctx.lineWidth = 1;
        this.ctx.stroke();
        if (showTitle && title) {
            this.ctx.fillStyle = '#e8f0fc';
            this.ctx.font = '12px "Share Tech Mono", monospace';
            this.ctx.fillText(title, x + 12, y + 20);
        }
    }

    drawPerspectiveGrid(areaX, areaY, areaW, areaH) {
        const vpX = areaX + areaW * 0.5;
        const vpY = areaY - areaH * 1.35;
        const rows = 16;
        for (let i = 0; i <= rows; i++) {
            const t = i / rows;
            const yy = areaY + t * areaH;
            const spread = 0.42 + t * 1.05;
            this.ctx.beginPath();
            this.ctx.moveTo(vpX - areaW * spread, yy);
            this.ctx.lineTo(vpX + areaW * spread, yy);
            this.ctx.strokeStyle = `rgba(130, 185, 255, ${0.06 + t * 0.28})`;
            this.ctx.lineWidth = 1;
            this.ctx.stroke();
        }
        for (let i = -10; i <= 10; i++) {
            const tx = 0.5 + i * 0.055;
            const xb = areaX + areaW * tx;
            this.ctx.beginPath();
            this.ctx.moveTo(vpX, vpY);
            this.ctx.lineTo(xb, areaY + areaH);
            this.ctx.strokeStyle = 'rgba(110, 165, 235, 0.14)';
            this.ctx.stroke();
        }
    }

    drawSparklineInBox(bx, by, bw, bh, seed) {
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        this.ctx.fillRect(bx, by, bw, bh);
        this.ctx.strokeStyle = 'rgba(57, 255, 120, 0.45)';
        this.ctx.strokeRect(bx, by, bw, bh);
        this.ctx.strokeStyle = 'rgba(74, 222, 128, 0.92)';
        this.ctx.lineWidth = 1.25;
        this.ctx.shadowColor = 'rgba(74, 255, 140, 0.55)';
        this.ctx.shadowBlur = 6;
        this.ctx.beginPath();
        const steps = 20;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const vx = bx + 2 + t * (bw - 4);
            const wave = Math.sin(this.tick * 0.065 + seed * 1.7 + t * 9.2)
                + 0.35 * Math.sin(this.tick * 0.11 + t * 14);
            const vy = by + bh * 0.55 + wave * (bh * 0.32);
            if (i === 0) this.ctx.moveTo(vx, vy);
            else this.ctx.lineTo(vx, vy);
        }
        this.ctx.stroke();
        this.ctx.shadowBlur = 0;
    }

    drawLayerMeta(cx, topY, wBox, lines) {
        const hBox = 12 + lines.length * 14;
        const x0 = cx - wBox * 0.5;
        this.ctx.fillStyle = 'rgba(4, 8, 14, 0.82)';
        this.ctx.strokeStyle = 'rgba(150, 178, 220, 0.4)';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        const r = 4;
        this.ctx.moveTo(x0 + r, topY);
        this.ctx.lineTo(x0 + wBox - r, topY);
        this.ctx.quadraticCurveTo(x0 + wBox, topY, x0 + wBox, topY + r);
        this.ctx.lineTo(x0 + wBox, topY + hBox - r);
        this.ctx.quadraticCurveTo(x0 + wBox, topY + hBox, x0 + wBox - r, topY + hBox);
        this.ctx.lineTo(x0 + r, topY + hBox);
        this.ctx.quadraticCurveTo(x0, topY + hBox, x0, topY + hBox - r);
        this.ctx.lineTo(x0, topY + r);
        this.ctx.quadraticCurveTo(x0, topY, x0 + r, topY);
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.stroke();
        this.ctx.fillStyle = 'rgba(220, 232, 248, 0.95)';
        this.ctx.font = '10px "Share Tech Mono", monospace';
        lines.forEach((line, i) => {
            this.ctx.fillText(line, x0 + 8, topY + 16 + i * 14);
        });
    }

    drawKernelHeader() {
        const w = window.innerWidth;
        this.ctx.textAlign = 'center';
        this.ctx.fillStyle = 'rgba(232, 240, 252, 0.92)';
        this.ctx.font = '12px "Share Tech Mono", monospace';
        this.ctx.fillText('linux kernel · process management subsystem', w * 0.5, 26);
        this.ctx.textAlign = 'start';
    }

    quadraticControlForEdge(x1, y1, x2, y2, salt) {
        const mx = (x1 + x2) * 0.5;
        const my = (y1 + y2) * 0.5;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.max(1e-6, Math.hypot(dx, dy));
        const nx = -dy / len;
        const ny = dx / len;
        const u = this.stableUnit(salt);
        const sign = u >= 0.5 ? 1 : -1;
        const wobble = (u - 0.5) * 0.55;
        const mag = Math.min(130, len * 0.4) * (0.55 + Math.abs(u - 0.5) * 0.9);
        return {
            cx: mx + nx * mag * (sign + wobble),
            cy: my + ny * mag * (sign + wobble)
        };
    }

    quadBezierPoint(x0, y0, cx, cy, x1, y1, t) {
        const omt = 1 - t;
        return {
            x: omt * omt * x0 + 2 * omt * t * cx + t * t * x1,
            y: omt * omt * y0 + 2 * omt * t * cy + t * t * y1
        };
    }

    quadBezierTangent(x0, y0, cx, cy, x1, y1, t) {
        const omt = 1 - t;
        const tx = 2 * omt * (cx - x0) + 2 * t * (x1 - cx);
        const ty = 2 * omt * (cy - y0) + 2 * t * (y1 - cy);
        const l = Math.hypot(tx, ty) || 1;
        return { tx: tx / l, ty: ty / l };
    }

    drawCurvedStroke(x1, y1, x2, y2, color, width, salt, withArrow, controlOverride) {
        const { cx, cy } = controlOverride || this.quadraticControlForEdge(x1, y1, x2, y2, salt);
        this.ctx.beginPath();
        this.ctx.moveTo(x1, y1);
        this.ctx.quadraticCurveTo(cx, cy, x2, y2);
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = width;
        this.ctx.stroke();
        if (withArrow) {
            const tip = this.quadBezierPoint(x1, y1, cx, cy, x2, y2, 0.995);
            const tan = this.quadBezierTangent(x1, y1, cx, cy, x2, y2, 0.98);
            const ux = tan.tx;
            const uy = tan.ty;
            const back = 7;
            const ex = tip.x - ux * back;
            const ey = tip.y - uy * back;
            this.ctx.beginPath();
            this.ctx.moveTo(tip.x, tip.y);
            this.ctx.lineTo(ex - uy * 3 - ux * 4, ey + ux * 3 - uy * 4);
            this.ctx.lineTo(ex + uy * 3 - ux * 4, ey - ux * 3 - uy * 4);
            this.ctx.closePath();
            this.ctx.fillStyle = color;
            this.ctx.fill();
        }
    }

    radialCurveControl(sx, sy, tx, ty, centerX, centerY, salt) {
        const mx = (sx + tx) * 0.5;
        const my = (sy + ty) * 0.5;
        const vx = mx - centerX;
        const vy = my - centerY;
        const len = Math.hypot(vx, vy) || 1;
        const u = this.stableUnit(salt);
        const bump = (u - 0.5) * 2;
        const amp = Math.min(95, Math.hypot(tx - sx, ty - sy) * 0.42);
        return {
            cx: mx + (vx / len) * amp * (0.65 + bump * 0.35),
            cy: my + (vy / len) * amp * (0.65 + bump * 0.35)
        };
    }

    edgeColor(type) {
        if (type === 'syscalls') return 'rgba(138,156,234,0.42)';
        if (type === 'ipc') return 'rgba(96,214,157,0.42)';
        if (type === 'network') return 'rgba(244,201,119,0.46)';
        if (type === 'file_access') return 'rgba(235,126,126,0.44)';
        return 'rgba(165,178,200,0.38)';
    }

    stableUnit(n) {
        const u = ((Number(n) * 1103515245 + 12345) >>> 0) % 10001;
        return u / 10000;
    }

    drawNeuralGraph(x, y, w, h) {
        this.drawPanel(x, y, w, 36, 'task graph · fork / wait / signals / IO', { alpha: 0.9 });
        const innerY = y + 42;
        const innerH = h - 50;
        const graph = this.telemetry?.neural_graph || {};
        const nodes = Array.isArray(graph.nodes) ? graph.nodes.slice(0, 24) : [];
        const rawEdges = Array.isArray(graph.edges) ? graph.edges.slice(0, 180) : [];
        const edges = rawEdges.filter((e) => this.edgeFilter === 'all' || String(e.type || '') === this.edgeFilter);
        if (!nodes.length) {
            this.ctx.fillStyle = 'rgba(196,207,224,0.72)';
            this.ctx.font = '12px "Share Tech Mono", monospace';
            this.ctx.fillText('NO PROCESS GRAPH DATA', x + 20, innerY + 28);
            return;
        }

        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(x + 2, innerY, w - 4, innerH);
        this.ctx.clip();
        this.drawPerspectiveGrid(x + 4, innerY + innerH * 0.5, w - 8, innerH * 0.48);
        this.ctx.restore();

        if (this.layoutMode === 'radial') {
            const pos = new Map();
            this.drawRadialNeuralGraph(nodes, edges, pos, x, innerY, w, innerH);
            return;
        }

        this.nodeHitAreas = [];
        const leftX = x + w * 0.2;
        const midX = x + w * 0.5;
        const rightX = x + w * 0.8;
        const panelY = innerY + 44;
        const panelH = innerH - 56;
        const panelW = Math.min(300, w * 0.29);
        const metaW = Math.min(168, panelW - 8);

        this.drawPanel(leftX - panelW * 0.5, panelY, panelW, panelH, '', { alpha: 0.74, showTitle: false });
        this.drawPanel(midX - panelW * 0.5, panelY, panelW, panelH, '', { alpha: 0.74, showTitle: false });
        this.drawPanel(rightX - panelW * 0.5, panelY, panelW, panelH, '', { alpha: 0.74, showTitle: false });

        const leftNodes = nodes.slice(0, 9);
        const midNodes = nodes.slice(9, 18);
        const rightNodes = nodes.slice(18, 24);
        const outLabels = [
            'RUNNING', 'SLEEP (S)', 'DISK (D)', 'STOPPED (T)', 'ZOMBIE', 'TRACE (t)',
            'RT BAND', 'CGROUP', 'IDLE', 'FORCED', 'IOWAIT', 'NICE+'
        ];

        this.drawLayerMeta(leftX, innerY + 8, metaW, [
            `tasks sampled: ${leftNodes.length}`,
            'metrics: cpu · rss · ctx · faults'
        ]);
        this.drawLayerMeta(midX, innerY + 8, metaW, [
            `related tasks: ${midNodes.length}`,
            'links: parent/child · fd · ipc'
        ]);
        this.drawLayerMeta(rightX, innerY + 8, metaW, [
            `task_state: ${rightNodes.length}`,
            'scheduler: CFS · runqueue'
        ]);

        const leftPos = [];
        const midPos = [];
        const rightPos = [];
        const positionByPid = new Map();
        const metricNames = [
            'CPU %', 'RSS MiB', 'CTX/s', 'FAULT/s', 'OPEN FD', 'NICE', 'THREADS',
            'IO WAIT', 'CGROUP Q'
        ];

        const highlightIdx = Math.floor(this.tick / 55) % Math.max(1, leftNodes.length);

        const setLayer = (arr, colX, list, mode) => {
            const step = panelH / (Math.max(1, list.length) + 1);
            list.forEach((node, idx) => {
                const yy = panelY + step * (idx + 1);
                const pid = Number(node.pid || 0);
                let tag = '';
                if (mode === 'input') {
                    tag = `${metricNames[idx % metricNames.length]} · ${String(node.name || 'proc').slice(0, 8)}`;
                } else if (mode === 'hidden') {
                    tag = `pid ${pid || idx + 1}`;
                } else {
                    tag = outLabels[idx % outLabels.length];
                }
                const point = { x: colX, y: yy, node, pid, tag, idx, mode };
                arr.push(point);
                positionByPid.set(pid, point);
            });
        };
        setLayer(leftPos, leftX, leftNodes, 'input');
        setLayer(midPos, midX, midNodes, 'hidden');
        setLayer(rightPos, rightX, rightNodes, 'output');

        const drawDense = (from, to, alphaScale) => {
            from.forEach((a, ai) => {
                to.forEach((b, bi) => {
                    const pairSalt = ai * 7919 + bi * 104729;
                    const alpha = Math.min(0.34, (0.1 + this.stableUnit(pairSalt) * 0.16) * alphaScale);
                    this.ctx.globalAlpha = alpha;
                    this.drawCurvedStroke(a.x, a.y, b.x, b.y, 'rgba(228, 236, 252, 0.92)', 0.7, pairSalt, false);
                    this.ctx.globalAlpha = 1;
                });
            });
        };
        drawDense(leftPos, midPos, 1.0);
        drawDense(midPos, rightPos, 1.08);

        edges.forEach((edge, eidx) => {
            const s = positionByPid.get(Number(edge.source || 0));
            const t = positionByPid.get(Number(edge.target || 0));
            if (!s || !t) return;
            const color = this.edgeColor(String(edge.type || ''));
            const isHoverEdge = this.hoveredNodePid && (s.pid === this.hoveredNodePid || t.pid === this.hoveredNodePid);
            this.ctx.globalAlpha = isHoverEdge ? 0.92 : 0.52;
            const salt = Number(edge.source || 0) * 31 + Number(edge.target || 0) * 17 + eidx * 13;
            this.drawCurvedStroke(s.x, s.y, t.x, t.y, color, isHoverEdge ? 1.15 : 0.85, salt, true);
            this.ctx.globalAlpha = 1;
        });

        const neighborPids = new Set();
        if (this.hoveredNodePid) {
            edges.forEach((edge) => {
                const s = Number(edge.source || 0);
                const t = Number(edge.target || 0);
                if (s === this.hoveredNodePid) neighborPids.add(t);
                if (t === this.hoveredNodePid) neighborPids.add(s);
            });
        }

        const sparkW = 52;
        const sparkH = 18;
        const labelLeftPad = leftX - panelW * 0.46;
        const outputHighlightIdx = Math.floor(this.tick / 70) % Math.max(1, rightPos.length);

        const rowYellow = (p) => p.mode === 'input' && highlightIdx === p.idx;

        leftPos.forEach((p) => {
            const rowHi = highlightIdx === p.idx && p.mode === 'input';
            if (rowHi) {
                this.ctx.fillStyle = 'rgba(255, 214, 64, 0.34)';
                this.ctx.fillRect(labelLeftPad - 6, p.y - 14, leftX - labelLeftPad + sparkW + 36, 30);
            }
            this.ctx.fillStyle = 'rgba(232, 240, 252, 0.95)';
            this.ctx.font = '10px "Share Tech Mono", monospace';
            this.ctx.textAlign = 'right';
            const shortLabel = p.tag.split('·')[0].trim();
            this.ctx.fillText(shortLabel, leftX - sparkW - 14, p.y + 3);
            this.ctx.textAlign = 'start';
            this.drawSparklineInBox(leftX - sparkW - 6, p.y - 10, sparkW, sparkH, p.pid + p.idx);
            const v = this.stableUnit(p.pid + this.tick * 0);
            const pressure = Number(p.node.syscall_pressure || 0);
            const val = (pressure / 100 * 0.4 + v * 0.6).toFixed(3);
            this.ctx.fillStyle = 'rgba(200, 214, 232, 0.88)';
            this.ctx.font = '9px "Share Tech Mono", monospace';
            this.ctx.fillText(val, leftX - sparkW - 6, p.y + 14);
        });

        const drawNeuron = (p, style) => {
            const pressure = Number(p.node.syscall_pressure || 0);
            const danger = pressure >= 72;
            const isHovered = this.hoveredNodePid && p.pid === this.hoveredNodePid;
            const isNeighbor = this.hoveredNodePid && neighborPids.has(p.pid);
            const r = isHovered ? 8.5 : 6.5;
            const fill = danger ? '#ff8a8a' : '#f4f8ff';

            if (isHovered || rowYellow(p)) {
                const g = this.ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.2);
                g.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
                g.addColorStop(1, 'rgba(255, 255, 255, 0)');
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, r * 3.2, 0, Math.PI * 2);
                this.ctx.fillStyle = g;
                this.ctx.fill();
            }

            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            this.ctx.fillStyle = fill;
            this.ctx.globalAlpha = isHovered ? 1 : (isNeighbor ? 0.94 : 0.9);
            this.ctx.fill();
            this.ctx.globalAlpha = 1;
            this.ctx.strokeStyle = isHovered ? '#fff6a8' : 'rgba(255, 255, 255, 0.92)';
            this.ctx.lineWidth = isHovered ? 2 : 1;
            this.ctx.stroke();

            this.ctx.fillStyle = '#eaf1fb';
            this.ctx.font = '10px "Share Tech Mono", monospace';
            if (style === 'hidden') {
                this.ctx.textAlign = 'right';
                this.ctx.fillText(p.tag, p.x - r - 6, p.y + 3);
                this.ctx.textAlign = 'start';
            } else if (style === 'output') {
                const hi = isHovered || (p.idx === outputHighlightIdx);
                if (hi) {
                    this.ctx.fillStyle = 'rgba(255, 224, 70, 0.42)';
                    this.ctx.fillRect(p.x + r + 4, p.y - 10, panelW * 0.42, 20);
                }
                this.ctx.fillStyle = '#f0f6ff';
                this.ctx.fillText(p.tag, p.x + r + 10, p.y + 3);
            }
            this.nodeHitAreas.push({ x: p.x, y: p.y, r, pid: p.pid });
        };

        leftPos.forEach((p) => drawNeuron(p, 'input'));
        midPos.forEach((p) => drawNeuron(p, 'hidden'));
        rightPos.forEach((p) => drawNeuron(p, 'output'));

        this.ctx.fillStyle = 'rgba(140, 158, 188, 0.85)';
        this.ctx.font = '9px "Share Tech Mono", monospace';
        this.ctx.fillText('hover task: highlight syscall / ipc / net / vfs edges', x + 12, y + h - 10);
    }

    drawRadialNeuralGraph(nodes, edges, pos, x, y, w, h) {
        const cx = x + w * 0.5;
        const cy = y + h * 0.52;
        const ring = Math.min(w, h) * 0.38;
        this.nodeHitAreas = [];
        nodes.forEach((node, idx) => {
            const pid = Number(node.pid || 0);
            const a = ((Math.PI * 2) / Math.max(1, nodes.length)) * idx - Math.PI / 2;
            const drift = Math.sin(this.tick * 0.0035 + idx * 0.4) * 0.018;
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
            const salt = idx * 97 + Number(edge.source || 0) + Number(edge.target || 0);
            const ctrl = this.radialCurveControl(s.x, s.y, t.x, t.y, cx, cy, salt);
            this.drawCurvedStroke(s.x, s.y, t.x, t.y, color, 0.65 + wv, salt, true, ctrl);
            this.ctx.globalAlpha = 1;
            const tp = (this.tick * 0.006 + idx * 0.08) % 1;
            const p = this.quadBezierPoint(s.x, s.y, ctrl.cx, ctrl.cy, t.x, t.y, tp);
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, 1.7, 0, Math.PI * 2);
            this.ctx.fillStyle = 'rgba(240, 248, 255, 0.95)';
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
        this.ctx.fillText('radial: task ring · curved edges · hover neighborhood', x + 14, y + h - 14);
    }

    drawTopStats(x, y, w, h) {
        this.drawPanel(x, y, w, h, 'runtime snapshot');
        const meta = this.telemetry?.meta || {};
        const graph = this.telemetry?.neural_graph || {};
        const n = Array.isArray(graph.nodes) ? graph.nodes.length : 0;
        const e = Array.isArray(graph.edges) ? graph.edges.length : 0;
        this.ctx.fillStyle = '#d8e5f7';
        this.ctx.font = '11px "Share Tech Mono", monospace';
        this.ctx.fillText(`tasks ${n}`, x + 16, y + 50);
        this.ctx.fillText(`relations ${e}`, x + 118, y + 50);
        this.ctx.fillText(`seccomp filter ${Number(meta.seccomp_filter_percent || 0).toFixed(1)}%`, x + 238, y + 50);
        this.ctx.fillStyle = '#a7b6cb';
        this.ctx.fillText('vertices: processes · edges: syscalls · ipc · sockets · vfs', x + 16, y + 72);
    }

    drawScene() {
        if (!this.ctx || !this.canvas) return;
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.ctx.clearRect(0, 0, w, h);
        this.tick += 1;

        const gap = 16;
        const top = 58;
        const statsH = 98;
        const graphY = top + statsH + gap;
        const graphH = Math.max(260, h - graphY - 36);

        const bg = this.ctx.createRadialGradient(w * 0.5, h * 0.38, 0, w * 0.5, h * 0.38, Math.max(w, h) * 0.78);
        bg.addColorStop(0, '#0f1a2e');
        bg.addColorStop(0.55, '#070d18');
        bg.addColorStop(1, '#03060e');
        this.ctx.fillStyle = bg;
        this.ctx.fillRect(0, 0, w, h);

        this.drawKernelHeader();
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
