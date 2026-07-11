// Processes Subsystem Visualization
// Version: 39 — SCHEDULER default mode, removed RADIAL, observed history vs projection

debugLog('🧠 processes-belt.js v39: Script loading...');

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
        this.layoutMode = 'scheduler';
        this.modeButtons = new Map();
        this.edgeFilter = 'all';
        this.filterButtons = new Map();
        this.overlayNodes = [];
        this.hoveredNodePid = null;
        this.selectedNodePid = null;
        this.lastMicroscopeFocusPid = null;
        this.autoFocusEnabled = true;
        this.autoFocusButton = null;
        this.nodeHitAreas = [];
        this.positionHistory = [];
        this.processHistory = new Map();
        this.processHistoryWindowMs = 60000;
        this.processHistoryMaxPoints = 90;
        this.mouseMoveHandler = null;
        this.clickHandler = null;
        // SCHEDULER (EEVDF + PELT) mode state.
        this.schedulerData = null;
        this.schedulerInterval = null;
        this.schedSelectedPid = null;
        this.schedHoverPid = null;
        this.schedHistory = new Map();   // pid -> [{util, load}]
        this.schedHistoryMax = 80;
        this.schedRectHits = [];
        this.schedOverlayPid = null;     // task drill-down overlay
        this.schedOverlayHits = [];
        this._schedOverlayPanel = null;
        this._schedT0 = Date.now();      // wall-clock base for overlay animation
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
        this.clickHandler = (event) => this.onCanvasClick(event);
        this.canvas.addEventListener('mousemove', this.mouseMoveHandler);
        this.canvas.addEventListener('click', this.clickHandler);
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
        this.createAutoFocusToggle();
        this.createEdgeFilterToggle();
        return true;
    }

    createModeToggle() {
        const panel = document.createElement('div');
        panel.style.cssText = `
            position:absolute;top:18px;left:18px;display:flex;gap:8px;z-index:1001;
        `;
        const modes = [
            { key: 'scheduler', label: 'SCHEDULER' },
            { key: 'microscope', label: 'MICROSCOPE' },
            { key: 'temporal', label: '3-LAYER GRAPH' },
            { key: 'wireframe', label: 'WIREFRAME PROC' }
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
        this.layoutMode = ['temporal', 'microscope', 'wireframe', 'scheduler'].includes(modeKey) ? modeKey : 'scheduler';
        this.modeButtons.forEach((btn, key) => {
            const active = key === this.layoutMode;
            btn.style.background = active ? 'rgba(32, 52, 81, 0.92)' : 'rgba(8,12,18,0.86)';
            btn.style.borderColor = active ? 'rgba(124, 178, 255, 0.9)' : 'rgba(150,164,188,0.35)';
            btn.style.color = active ? '#d9ecff' : '#bcc8db';
        });
        this.updateAutoFocusButtonState();
        this.updateSchedulerPolling();
    }

    updateSchedulerPolling() {
        const on = this.layoutMode === 'scheduler';
        if (on && !this.schedulerInterval) {
            this.fetchSchedulerData();
            this.schedulerInterval = setInterval(() => {
                if (this.isActive && this.layoutMode === 'scheduler') this.fetchSchedulerData();
            }, 1500);
        } else if (!on && this.schedulerInterval) {
            clearInterval(this.schedulerInterval);
            this.schedulerInterval = null;
            this.schedOverlayPid = null;
        }
    }

    fetchSchedulerData() {
        return fetch('/api/scheduler-pelt', { cache: 'no-store' })
            .then((res) => res.json())
            .then((data) => {
                if (!data || data.error) throw new Error(data?.error || 'no data');
                this.schedulerData = data;
                this.updateSchedHistory(data);
            })
            .catch(() => { /* keep last good frame */ });
    }

    updateSchedHistory(data) {
        const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
        const keep = new Set();
        tasks.forEach((t) => {
            const pid = Number(t.pid || 0);
            if (pid <= 0) return;
            keep.add(pid);
            const arr = this.schedHistory.get(pid) || [];
            arr.push({ util: Number(t.util_avg || 0), load: Number(t.load_avg || 0) });
            this.schedHistory.set(pid, arr.slice(-this.schedHistoryMax));
        });
        for (const pid of this.schedHistory.keys()) {
            if (!keep.has(pid) && pid !== this.schedSelectedPid) this.schedHistory.delete(pid);
        }
    }

    createAutoFocusToggle() {
        const btn = document.createElement('button');
        btn.style.cssText = `
            position:absolute;top:18px;left:392px;z-index:1001;
            padding:8px 10px;background:rgba(8,12,18,0.86);
            border:1px solid rgba(150,164,188,0.35);color:#bcc8db;
            font-family:'Share Tech Mono', monospace;font-size:10px;cursor:pointer;
        `;
        btn.onclick = () => this.toggleAutoFocus();
        this.container.appendChild(btn);
        this.autoFocusButton = btn;
        this.overlayNodes.push(btn);
        this.updateAutoFocusButtonState();
    }

    toggleAutoFocus() {
        this.autoFocusEnabled = !this.autoFocusEnabled;
        this.updateAutoFocusButtonState();
    }

    updateAutoFocusButtonState() {
        if (!this.autoFocusButton) return;
        const active = this.autoFocusEnabled;
        const visible = this.layoutMode === 'microscope';
        this.autoFocusButton.textContent = active ? 'AUTO FOCUS: ON' : 'AUTO FOCUS: OFF';
        this.autoFocusButton.style.background = active ? 'rgba(32, 52, 81, 0.92)' : 'rgba(8,12,18,0.86)';
        this.autoFocusButton.style.borderColor = active ? 'rgba(124,178,255,0.9)' : 'rgba(150,164,188,0.35)';
        this.autoFocusButton.style.color = active ? '#d9ecff' : '#bcc8db';
        this.autoFocusButton.style.opacity = visible ? '1' : '0.35';
        this.autoFocusButton.style.pointerEvents = visible ? 'auto' : 'none';
    }

    onCanvasClick(event) {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        if (this.layoutMode === 'scheduler') {
            if (this.schedOverlayPid !== null) {
                for (const hit of this.schedOverlayHits) {
                    if (x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h) {
                        if (hit.kind === 'close') this.schedOverlayPid = null;
                        return;
                    }
                }
                const p = this._schedOverlayPanel;
                if (p && (x < p.x || x > p.x + p.w || y < p.y || y > p.y + p.h)) {
                    this.schedOverlayPid = null;
                }
                return;
            }
            for (const hit of this.schedRectHits) {
                if (x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h) {
                    this.schedSelectedPid = hit.pid;
                    this.schedOverlayPid = hit.pid;
                    this._schedT0 = Date.now();
                    return;
                }
            }
            return;
        }
        for (const hit of this.nodeHitAreas) {
            const dx = x - hit.x;
            const dy = y - hit.y;
            if (Math.hypot(dx, dy) <= hit.r + 3) {
                const pid = Number(hit.pid || 0);
                if (pid <= 0) return;
                this.selectedNodePid = this.selectedNodePid === pid ? null : pid;
                return;
            }
        }
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
        if (this.layoutMode === 'scheduler') {
            let hv = null;
            for (const hit of this.schedRectHits) {
                if (x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h) { hv = hit.pid; break; }
            }
            this.schedHoverPid = hv;
            this.canvas.style.cursor = hv ? 'pointer' : 'default';
            return;
        }
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

    updateProcessHistory() {
        const now = Date.now();
        const cutoff = now - this.processHistoryWindowMs;
        const nodes = Array.isArray(this.telemetry?.neural_graph?.nodes) ? this.telemetry.neural_graph.nodes : [];
        const keepPids = new Set();
        nodes.forEach((node) => {
            const pid = Number(node?.pid || 0);
            if (pid <= 0) return;
            keepPids.add(pid);
            const row = {
                ts: now,
                syscall_pressure: Number(node?.syscall_pressure || 0),
                rss_mb: Number(node?.rss_bytes || 0) / (1024 * 1024),
                fd_count: Number(node?.fd_count || 0),
                connections: Number(node?.connections || 0),
            };
            const arr = this.processHistory.get(pid) || [];
            arr.push(row);
            this.processHistory.set(
                pid,
                arr.filter((entry) => Number(entry.ts || 0) >= cutoff).slice(-this.processHistoryMaxPoints)
            );
        });
        for (const pid of this.processHistory.keys()) {
            if (!keepPids.has(pid) && pid !== this.selectedNodePid) {
                this.processHistory.delete(pid);
            }
        }
    }

    getFocusProcess(nodes) {
        if (!Array.isArray(nodes) || !nodes.length) return null;
        if (this.selectedNodePid) {
            const selected = nodes.find((n) => Number(n?.pid || 0) === Number(this.selectedNodePid));
            if (selected) {
                this.lastMicroscopeFocusPid = Number(selected.pid || 0);
                return selected;
            }
            this.selectedNodePid = null;
        }
        if (this.autoFocusEnabled) {
            const top = nodes.slice().sort((a, b) => Number(b?.syscall_pressure || 0) - Number(a?.syscall_pressure || 0))[0];
            if (top) {
                this.lastMicroscopeFocusPid = Number(top.pid || 0);
            }
            return top || nodes[0] || null;
        }
        if (this.lastMicroscopeFocusPid) {
            const prev = nodes.find((n) => Number(n?.pid || 0) === Number(this.lastMicroscopeFocusPid));
            if (prev) return prev;
        }
        if (this.hoveredNodePid) {
            const hovered = nodes.find((n) => Number(n?.pid || 0) === Number(this.hoveredNodePid));
            if (hovered) {
                this.lastMicroscopeFocusPid = Number(hovered.pid || 0);
                return hovered;
            }
        }
        const fallback = nodes[0] || null;
        if (fallback) this.lastMicroscopeFocusPid = Number(fallback.pid || 0);
        return fallback;
    }

    fetchTelemetry() {
        return fetch('/api/processes-realtime', { cache: 'no-store' })
            .then((res) => res.json())
            .then((data) => {
                if (!data || data.error) throw new Error(data?.error || 'No data');
                this.telemetry = data;
                this.updateProcessHistory();
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
            this.ctx.strokeStyle = `rgba(142, 224, 255, ${0.04 + t * 0.2})`;
            this.ctx.lineWidth = 1;
            this.ctx.stroke();
        }
        for (let i = -10; i <= 10; i++) {
            const tx = 0.5 + i * 0.055;
            const xb = areaX + areaW * tx;
            this.ctx.beginPath();
            this.ctx.moveTo(vpX, vpY);
            this.ctx.lineTo(xb, areaY + areaH);
            this.ctx.strokeStyle = 'rgba(122, 205, 242, 0.11)';
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
        this.ctx.fillStyle = 'rgba(155, 200, 232, 0.78)';
        this.ctx.font = '8px "Share Tech Mono", monospace';
        this.ctx.fillText('SCANNING NODE', w * 0.5, 16);
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
        if (type === 'syscalls') return 'rgba(136,201,255,0.4)';
        if (type === 'ipc') return 'rgba(126,242,210,0.38)';
        if (type === 'network') return 'rgba(181,240,255,0.42)';
        if (type === 'file_access') return 'rgba(255,184,168,0.4)';
        return 'rgba(170,214,244,0.34)';
    }

    stableUnit(n) {
        const u = ((Number(n) * 1103515245 + 12345) >>> 0) % 10001;
        return u / 10000;
    }

    drawNeuralGraph(x, y, w, h) {
        this.drawPanel(x, y, w, 36, 'process microscope · fork / wait / signals / io', { alpha: 0.9 });
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

        if (this.layoutMode !== 'wireframe') {
            this.ctx.save();
            this.ctx.beginPath();
            this.ctx.rect(x + 2, innerY, w - 4, innerH);
            this.ctx.clip();
            this.drawPerspectiveGrid(x + 4, innerY + innerH * 0.5, w - 8, innerH * 0.48);
            this.ctx.restore();
        }

        if (this.layoutMode === 'radial') {
            const pos = new Map();
            this.drawRadialNeuralGraph(nodes, edges, pos, x, innerY, w, innerH);
            return;
        }
        if (this.layoutMode === 'microscope') {
            this.drawMicroscopeGraph(nodes, edges, x, innerY, w, innerH);
            return;
        }
        if (this.layoutMode === 'wireframe') {
            this.drawWireframeProcGraph(nodes, edges, x, innerY, w, innerH);
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
        const outer = Math.min(w, h) * 0.34;
        const inner = outer * 0.46;
        this.nodeHitAreas = [];

        [outer, outer * 0.78, outer * 0.58, inner].forEach((r, idx) => {
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, r, 0, Math.PI * 2);
            this.ctx.strokeStyle = idx === 0 ? 'rgba(140,212,255,0.22)' : 'rgba(118,190,232,0.16)';
            this.ctx.lineWidth = idx === 0 ? 1.2 : 1;
            this.ctx.stroke();
        });

        this.ctx.strokeStyle = 'rgba(120,195,235,0.14)';
        this.ctx.lineWidth = 1;
        for (let i = 0; i < 8; i += 1) {
            const a = (Math.PI * 2 * i) / 8;
            this.ctx.beginPath();
            this.ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
            this.ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
            this.ctx.stroke();
        }

        const sweep = (this.tick * 0.0025) % (Math.PI * 2);
        this.ctx.beginPath();
        this.ctx.moveTo(cx, cy);
        this.ctx.arc(cx, cy, outer, sweep - 0.14, sweep + 0.14);
        this.ctx.closePath();
        this.ctx.fillStyle = 'rgba(120, 210, 245, 0.08)';
        this.ctx.fill();

        nodes.forEach((node, idx) => {
            const pid = Number(node.pid || 0);
            const a = ((Math.PI * 2) / Math.max(1, nodes.length)) * idx - Math.PI / 2;
            const noise = Math.sin(this.tick * 0.004 + idx * 0.31) * 0.02;
            const radius = outer * (0.62 + (idx % 4) * 0.08);
            pos.set(pid, {
                x: cx + Math.cos(a + noise) * radius,
                y: cy + Math.sin(a + noise) * radius
            });
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

        edges.forEach((edge, idx) => {
            const s = pos.get(Number(edge.source || 0));
            const t = pos.get(Number(edge.target || 0));
            if (!s || !t) return;
            const weight = Number(edge.weight || 0.4);
            const color = this.edgeColor(String(edge.type || ''));
            const isHoverEdge = this.hoveredNodePid && (Number(edge.source || 0) === this.hoveredNodePid || Number(edge.target || 0) === this.hoveredNodePid);
            this.ctx.globalAlpha = isHoverEdge ? 0.94 : (0.18 + weight * 0.34);
            const salt = idx * 97 + Number(edge.source || 0) + Number(edge.target || 0);
            const ctrl = this.radialCurveControl(s.x, s.y, t.x, t.y, cx, cy, salt);
            this.drawCurvedStroke(s.x, s.y, t.x, t.y, color, isHoverEdge ? 1.2 : 0.8, salt, false, ctrl);
            this.ctx.globalAlpha = 1;
        });

        nodes.forEach((node) => {
            const pid = Number(node.pid || 0);
            const p = pos.get(pid);
            if (!p) return;
            const pressure = Number(node.syscall_pressure || 0);
            const nodeR = 4.2 + Math.min(4.8, pressure / 30);
            const mode = String(node.seccomp_mode || 'unknown');
            const danger = pressure >= 70;
            const fill = danger ? '#ef8f8f' : (mode === 'filter' || mode === 'strict' ? '#75dfb4' : '#9cb8df');
            const isHovered = this.hoveredNodePid && pid === this.hoveredNodePid;
            const isNeighbor = this.hoveredNodePid && neighborPids.has(pid);
            const alpha = isHovered ? 1 : (isNeighbor ? 0.94 : 0.82);

            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, nodeR, 0, Math.PI * 2);
            this.ctx.fillStyle = fill;
            this.ctx.globalAlpha = alpha;
            this.ctx.fill();
            this.ctx.globalAlpha = 1;
            this.ctx.strokeStyle = isHovered ? 'rgba(255,255,255,0.98)' : 'rgba(227,241,255,0.82)';
            this.ctx.lineWidth = isHovered ? 1.8 : 0.9;
            this.ctx.stroke();
            this.nodeHitAreas.push({ x: p.x, y: p.y, r: nodeR + 1, pid });
        });

        this.ctx.fillStyle = '#a7b6cb';
        this.ctx.font = '10px "Share Tech Mono", monospace';
        this.ctx.fillText('radial graph: process pressure and edge topology', x + 14, y + h - 14);
    }

    drawMicroscopeTimeline(focusNode, x, y, w, h) {
        const pid = Number(focusNode?.pid || 0);
        if (!pid) return;
        const points = this.processHistory.get(pid) || [];
        this.drawPanel(x, y, w, h, '', { alpha: 0.84, showTitle: false });
        this.ctx.fillStyle = 'rgba(198, 220, 248, 0.92)';
        this.ctx.font = '9px "Share Tech Mono", monospace';
        this.ctx.fillText(`timeline 60s · pid ${pid}`, x + 10, y + 14);
        if (points.length < 2) return;
        const now = Date.now();
        const plotX = x + 10;
        const plotY = y + 20;
        const plotW = w - 20;
        const plotH = h - 30;
        const drawSeries = (getValue, color, alpha = 0.95) => {
            this.ctx.beginPath();
            points.forEach((pt, idx) => {
                const age = Math.max(0, now - Number(pt.ts || now));
                const px = plotX + (1 - Math.min(1, age / this.processHistoryWindowMs)) * plotW;
                const v = Math.max(0, Math.min(100, Number(getValue(pt) || 0)));
                const py = plotY + plotH - (v / 100) * plotH;
                if (idx === 0) this.ctx.moveTo(px, py);
                else this.ctx.lineTo(px, py);
            });
            this.ctx.strokeStyle = color;
            this.ctx.globalAlpha = alpha;
            this.ctx.lineWidth = 1.2;
            this.ctx.stroke();
            this.ctx.globalAlpha = 1;
        };
        drawSeries((pt) => pt.syscall_pressure, 'rgba(150, 214, 255, 0.95)');
        drawSeries((pt) => Math.min(100, pt.rss_mb / 12), 'rgba(120, 230, 170, 0.85)', 0.86);
        drawSeries((pt) => Math.min(100, pt.fd_count * 2), 'rgba(255, 205, 128, 0.82)', 0.8);
    }

    drawProcessControlRoom(nodes, edges, x, y, w, h) {
        const innerY = y + 4;
        const innerH = h - 8;
        this.nodeHitAreas = [];
        if (!nodes.length) {
            this.ctx.fillStyle = 'rgba(196,207,224,0.72)';
            this.ctx.font = '12px "Share Tech Mono", monospace';
            this.ctx.fillText('NO PROCESS GRAPH DATA', x + 20, innerY + 28);
            return;
        }

        const byPid = new Map(nodes.map((n) => [Number(n.pid || 0), n]));
        const focus = this.getFocusProcess(nodes);
        if (!focus) return;
        const focusPid = Number(focus.pid || 0);
        const panelGap = 14;
        const sideW = Math.max(210, Math.min(300, w * 0.24));
        const leftX = x + 18;
        const rightX = x + w - sideW - 18;
        const centerX0 = leftX + sideW + panelGap;
        const centerW = Math.max(360, rightX - centerX0 - panelGap);
        const centerX = centerX0 + centerW * 0.5;
        const centerY = innerY + innerH * 0.47;
        const parent = byPid.get(Number(focus.ppid || 0)) || null;
        const children = nodes.filter((n) => Number(n.ppid || 0) === focusPid).slice(0, 6);
        const neighbors = [];
        edges.forEach((edge) => {
            const s = Number(edge.source || 0);
            const t = Number(edge.target || 0);
            if (s === focusPid && byPid.has(t)) neighbors.push({ node: byPid.get(t), type: String(edge.type || 'link') });
            if (t === focusPid && byPid.has(s)) neighbors.push({ node: byPid.get(s), type: String(edge.type || 'link') });
        });
        const uniqNeighbors = [];
        const seen = new Set();
        neighbors.forEach((it) => {
            const pid = Number(it?.node?.pid || 0);
            if (pid <= 0 || seen.has(pid) || pid === focusPid) return;
            seen.add(pid);
            uniqNeighbors.push(it);
        });

        const syscalls = Array.isArray(this.telemetry?.syscalls_interception) ? this.telemetry.syscalls_interception : [];
        const networkRows = Array.isArray(this.telemetry?.network_tracing) ? this.telemetry.network_tracing : [];
        const securityHooks = Array.isArray(this.telemetry?.security_hooks) ? this.telemetry.security_hooks : [];
        const threadsCount = Math.max(1, Number(focus.num_threads || 1));
        const pressure = Math.max(0, Math.min(100, Number(focus.syscall_pressure || 0)));
        const graphRadius = Math.min(centerW, innerH) * 0.34;
        const familyR = graphRadius * 0.42;
        const threadR = graphRadius * 0.66;
        const ioR = graphRadius * 0.95;
        const hotProcesses = nodes
            .slice()
            .sort((a, b) => Number(b.syscall_pressure || 0) - Number(a.syscall_pressure || 0))
            .slice(0, 7);
        const edgeCounts = edges.reduce((acc, edge) => {
            const type = String(edge.type || 'link');
            acc[type] = (acc[type] || 0) + 1;
            return acc;
        }, {});

        this.drawPanel(leftX, innerY + 34, sideW, innerH - 54, '', { alpha: 0.72, showTitle: false });
        this.drawPanel(centerX0, innerY + 34, centerW, innerH - 54, '', { alpha: 0.52, showTitle: false });
        this.drawPanel(rightX, innerY + 34, sideW, innerH - 54, '', { alpha: 0.72, showTitle: false });

        this.ctx.strokeStyle = 'rgba(140, 220, 255, 0.25)';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.moveTo(x + 12, innerY + 18);
        this.ctx.lineTo(x + w - 12, innerY + 18);
        this.ctx.stroke();
        this.ctx.fillStyle = 'rgba(198, 230, 255, 0.86)';
        this.ctx.font = '9px "Share Tech Mono", monospace';
        this.ctx.fillText('PROCESS CONTROL ROOM', x + 18, innerY + 13);
        this.ctx.textAlign = 'center';
        this.ctx.fillText(`${this.autoFocusEnabled ? 'AUTO' : 'PINNED'} FOCUS · PID ${focusPid}`, centerX, innerY + 13);
        this.ctx.textAlign = 'start';

        [familyR, threadR, ioR].forEach((r, idx) => {
            this.ctx.beginPath();
            this.ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
            this.ctx.strokeStyle = idx === 0 ? 'rgba(130, 210, 255, 0.24)' : 'rgba(120,200,240,0.14)';
            this.ctx.lineWidth = idx === 0 ? 1.2 : 0.9;
            this.ctx.stroke();
        });
        [
            { label: 'FAMILY', r: familyR, color: 'rgba(170, 205, 255, 0.78)' },
            { label: 'THREADS', r: threadR, color: 'rgba(118, 230, 170, 0.78)' },
            { label: 'IO / IPC / NET', r: ioR, color: 'rgba(255, 204, 132, 0.78)' }
        ].forEach((ring, idx) => {
            this.ctx.fillStyle = ring.color;
            this.ctx.font = '8px "Share Tech Mono", monospace';
            this.ctx.fillText(ring.label, centerX + ring.r + 8, centerY - 6 + idx * 12);
        });

        const nodePos = new Map();
        const placeNode = (node, px, py, radius, fill, label) => {
            this.ctx.beginPath();
            this.ctx.arc(px, py, radius, 0, Math.PI * 2);
            this.ctx.fillStyle = fill;
            this.ctx.fill();
            this.ctx.strokeStyle = 'rgba(228, 239, 255, 0.92)';
            this.ctx.lineWidth = 1;
            this.ctx.stroke();
            this.ctx.fillStyle = '#eaf1fb';
            this.ctx.font = '9px "Share Tech Mono", monospace';
            this.ctx.fillText(label, px + radius + 6, py + 3);
            const pid = Number(node?.pid || 0);
            if (pid > 0) this.nodeHitAreas.push({ x: px, y: py, r: radius + 2, pid });
            if (pid > 0) nodePos.set(pid, { x: px, y: py });
        };

        const focusGlow = this.ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 62);
        focusGlow.addColorStop(0, pressure >= 70 ? 'rgba(255, 120, 120, 0.34)' : 'rgba(126, 205, 255, 0.34)');
        focusGlow.addColorStop(1, 'rgba(126, 205, 255, 0)');
        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, 62, 0, Math.PI * 2);
        this.ctx.fillStyle = focusGlow;
        this.ctx.fill();
        placeNode(focus, centerX, centerY, 13, pressure >= 70 ? 'rgba(255, 138, 138, 0.92)' : 'rgba(163, 220, 255, 0.94)', `${String(focus.name || 'proc').slice(0, 14)}:${focusPid}`);

        if (parent) {
            placeNode(parent, centerX, centerY - familyR, 7, 'rgba(192, 210, 238, 0.85)', `parent ${String(parent.name || '').slice(0, 10)}:${Number(parent.pid || 0)}`);
        }
        children.forEach((ch, idx) => {
            const a = (Math.PI * 2 * idx / Math.max(1, children.length)) - Math.PI / 2;
            placeNode(ch, centerX + Math.cos(a) * familyR, centerY + Math.sin(a) * familyR, 6.2, 'rgba(152, 204, 255, 0.82)', `child ${String(ch.name || '').slice(0, 8)}:${Number(ch.pid || 0)}`);
        });
        const threadsToDraw = Math.min(16, Math.max(3, threadsCount));
        for (let i = 0; i < threadsToDraw; i++) {
            const a = (Math.PI * 2 * i / threadsToDraw) + this.tick * 0.005;
            this.ctx.beginPath();
            this.ctx.arc(centerX + Math.cos(a) * threadR, centerY + Math.sin(a) * threadR, 2.1, 0, Math.PI * 2);
            this.ctx.fillStyle = 'rgba(120, 230, 170, 0.85)';
            this.ctx.fill();
        }
        uniqNeighbors.slice(0, 10).forEach((item, idx) => {
            const n = item.node;
            const a = (Math.PI * 2 * idx / Math.max(1, Math.min(10, uniqNeighbors.length))) + Math.PI * 0.06;
            const edgeType = String(item.type || '');
            const color = edgeType === 'network' ? 'rgba(244,201,119,0.88)'
                : (edgeType === 'ipc' ? 'rgba(96,214,157,0.88)'
                    : (edgeType === 'file_access' ? 'rgba(235,126,126,0.88)' : 'rgba(160,180,210,0.85)'));
            placeNode(n, centerX + Math.cos(a) * ioR, centerY + Math.sin(a) * ioR, 5.2, color, `${edgeType || 'link'} ${String(n.name || '').slice(0, 8)}:${Number(n.pid || 0)}`);
        });
        for (const [pid, p] of nodePos.entries()) {
            if (pid === focusPid) continue;
            this.drawCurvedStroke(centerX, centerY, p.x, p.y, 'rgba(204, 224, 248, 0.38)', 0.9, focusPid * 17 + pid, false);
        }

        this.ctx.fillStyle = 'rgba(212, 232, 255, 0.95)';
        this.ctx.font = '10px "Share Tech Mono", monospace';
        this.ctx.fillText('HOT PROCESSES', leftX + 12, innerY + 56);
        hotProcesses.forEach((node, idx) => {
            const pid = Number(node.pid || 0);
            const rowY = innerY + 78 + idx * 32;
            const rowActive = pid === focusPid;
            if (rowActive) {
                this.ctx.fillStyle = 'rgba(124, 178, 255, 0.14)';
                this.ctx.fillRect(leftX + 8, rowY - 15, sideW - 16, 26);
            }
            const rowPressure = Math.max(0, Math.min(100, Number(node.syscall_pressure || 0)));
            this.ctx.fillStyle = rowActive ? '#eaf5ff' : 'rgba(205, 222, 245, 0.92)';
            this.ctx.font = '9px "Share Tech Mono", monospace';
            this.ctx.fillText(`${idx + 1}. ${String(node.name || 'proc').slice(0, 15)}:${pid}`, leftX + 12, rowY - 2);
            this.ctx.fillStyle = 'rgba(80, 108, 140, 0.55)';
            this.ctx.fillRect(leftX + 12, rowY + 6, sideW - 72, 4);
            this.ctx.fillStyle = rowPressure >= 70 ? 'rgba(255, 130, 130, 0.88)' : 'rgba(116, 205, 255, 0.82)';
            this.ctx.fillRect(leftX + 12, rowY + 6, (sideW - 72) * (rowPressure / 100), 4);
            this.ctx.fillStyle = 'rgba(166, 195, 226, 0.88)';
            this.ctx.fillText(`${rowPressure.toFixed(0)}%`, leftX + sideW - 44, rowY + 10);
            this.nodeHitAreas.push({ x: leftX + sideW * 0.5, y: rowY - 4, r: sideW * 0.45, pid });
        });

        const detailY = innerY + innerH - 126;
        this.ctx.fillStyle = 'rgba(212, 232, 255, 0.95)';
        this.ctx.font = '10px "Share Tech Mono", monospace';
        this.ctx.fillText('FOCUS DETAIL', leftX + 12, detailY);
        this.ctx.fillStyle = 'rgba(166, 195, 226, 0.9)';
        this.ctx.font = '9px "Share Tech Mono", monospace';
        this.ctx.fillText(`${String(focus.name || 'proc').slice(0, 18)}:${focusPid}`, leftX + 12, detailY + 20);
        this.ctx.fillText(`rss ${(Number(focus.rss_bytes || 0) / (1024 * 1024)).toFixed(1)}MB · fd ${Number(focus.fd_count || 0)}`, leftX + 12, detailY + 36);
        this.ctx.fillText(`threads ${threadsCount} · seccomp ${String(focus.seccomp_mode || 'unknown')}`, leftX + 12, detailY + 52);
        this.ctx.fillText(`parent ${parent ? `${String(parent.name || '').slice(0, 9)}:${Number(parent.pid || 0)}` : 'none'}`, leftX + 12, detailY + 68);
        this.ctx.fillText(`children ${children.length} · links ${uniqNeighbors.length}`, leftX + 12, detailY + 84);

        const barRow = (label, value, max, y0, color) => {
            const pct = Math.max(0, Math.min(1, Number(value || 0) / Math.max(1, max)));
            this.ctx.fillStyle = 'rgba(205, 232, 255, 0.9)';
            this.ctx.font = '9px "Share Tech Mono", monospace';
            this.ctx.fillText(label, rightX + 12, y0);
            this.ctx.fillStyle = 'rgba(72, 98, 128, 0.48)';
            this.ctx.fillRect(rightX + 94, y0 - 8, sideW - 118, 5);
            this.ctx.fillStyle = color;
            this.ctx.fillRect(rightX + 94, y0 - 8, (sideW - 118) * pct, 5);
            this.ctx.fillStyle = 'rgba(166, 195, 226, 0.9)';
            this.ctx.fillText(String(value), rightX + sideW - 28, y0);
        };

        this.ctx.fillStyle = 'rgba(212, 232, 255, 0.95)';
        this.ctx.font = '10px "Share Tech Mono", monospace';
        this.ctx.fillText('LIVE CHANNELS', rightX + 12, innerY + 56);
        barRow('syscalls', edgeCounts.syscalls || 0, Math.max(1, edges.length), innerY + 82, 'rgba(136,201,255,0.82)');
        barRow('network', edgeCounts.network || 0, Math.max(1, edges.length), innerY + 106, 'rgba(181,240,255,0.82)');
        barRow('ipc', edgeCounts.ipc || 0, Math.max(1, edges.length), innerY + 130, 'rgba(126,242,210,0.82)');
        barRow('file', edgeCounts.file_access || 0, Math.max(1, edges.length), innerY + 154, 'rgba(255,184,168,0.82)');

        this.ctx.fillStyle = 'rgba(212, 232, 255, 0.95)';
        this.ctx.font = '10px "Share Tech Mono", monospace';
        this.ctx.fillText('NETWORK TRACE', rightX + 12, innerY + 194);
        networkRows.slice(0, 3).forEach((row, idx) => {
            const y0 = innerY + 214 + idx * 18;
            this.ctx.fillStyle = 'rgba(166, 195, 226, 0.9)';
            this.ctx.font = '8px "Share Tech Mono", monospace';
            this.ctx.fillText(`${String(row.name || 'proc').slice(0, 12)}:${Number(row.pid || 0)} c${Number(row.connections || 0)}`, rightX + 12, y0);
            this.ctx.fillText(String(row.top_state || 'STATE').slice(0, 12), rightX + sideW - 76, y0);
        });

        this.ctx.fillStyle = 'rgba(212, 232, 255, 0.95)';
        this.ctx.font = '10px "Share Tech Mono", monospace';
        this.ctx.fillText('SECURITY HOOKS', rightX + 12, innerY + 286);
        securityHooks.slice(0, 4).forEach((hook, idx) => {
            const y0 = innerY + 306 + idx * 18;
            const active = String(hook.status || '') === 'active';
            this.ctx.fillStyle = active ? 'rgba(118, 230, 170, 0.9)' : 'rgba(255, 184, 128, 0.86)';
            this.ctx.fillText(active ? 'o' : '-', rightX + 12, y0);
            this.ctx.fillStyle = 'rgba(166, 195, 226, 0.9)';
            this.ctx.font = '8px "Share Tech Mono", monospace';
            this.ctx.fillText(`${String(hook.name || 'hook').slice(0, 22)}`, rightX + 26, y0);
        });

        const syscallFocus = syscalls.find((row) => Number(row.pid || 0) === focusPid) || syscalls[0];
        if (syscallFocus) {
            this.ctx.fillStyle = 'rgba(212, 232, 255, 0.95)';
            this.ctx.font = '10px "Share Tech Mono", monospace';
            this.ctx.fillText('SYSCALL SAMPLE', rightX + 12, innerY + innerH - 108);
            this.ctx.fillStyle = 'rgba(166, 195, 226, 0.9)';
            this.ctx.font = '8px "Share Tech Mono", monospace';
            this.ctx.fillText(`${String(syscallFocus.name || 'proc').slice(0, 16)}:${Number(syscallFocus.pid || 0)}`, rightX + 12, innerY + innerH - 88);
            this.ctx.fillText(`threads ${Number(syscallFocus.num_threads || 0)} · fd ${Number(syscallFocus.fd_count || 0)}`, rightX + 12, innerY + innerH - 72);
            this.ctx.fillText(`pressure ${Number(syscallFocus.syscall_pressure || 0).toFixed(0)}%`, rightX + 12, innerY + innerH - 56);
        }

        this.drawMicroscopeTimeline(focus, centerX0 + 18, innerY + innerH - 106, centerW - 36, 86);
        this.ctx.fillStyle = 'rgba(140, 158, 188, 0.85)';
        this.ctx.font = '9px "Share Tech Mono", monospace';
        this.ctx.fillText('click process: pin focus · center rings: family, threads, io/ipc/network · right panels: live telemetry', x + 12, y + h - 10);
    }

    drawProcessOrbitalMap(nodes, edges, x, y, w, h) {
        const innerY = y + 4;
        const innerH = h - 8;
        this.nodeHitAreas = [];
        if (!nodes.length) {
            this.ctx.fillStyle = 'rgba(196,207,224,0.72)';
            this.ctx.font = '12px "Share Tech Mono", monospace';
            this.ctx.fillText('NO PROCESS ORBIT DATA', x + 20, innerY + 28);
            return;
        }

        const focus = this.getFocusProcess(nodes);
        const focusPid = Number(focus?.pid || 0);
        const hotProcesses = nodes
            .slice()
            .sort((a, b) => Number(b.syscall_pressure || 0) - Number(a.syscall_pressure || 0))
            .slice(0, 9);
        const networkRows = Array.isArray(this.telemetry?.network_tracing) ? this.telemetry.network_tracing : [];
        const securityHooks = Array.isArray(this.telemetry?.security_hooks) ? this.telemetry.security_hooks : [];
        const edgeCounts = edges.reduce((acc, edge) => {
            const type = String(edge.type || 'link');
            acc[type] = (acc[type] || 0) + 1;
            return acc;
        }, {});
        const totalEdges = Math.max(1, edges.length);
        const kernelX = x + w * 0.18;
        const kernelY = innerY + innerH * 0.52;
        const kernelR = Math.min(w, innerH) * 0.19;

        this.ctx.fillStyle = 'rgba(126, 190, 230, 0.08)';
        for (let i = 0; i < 44; i += 1) {
            const px = x + 36 + this.stableUnit(i * 137) * (w - 72);
            const py = innerY + 44 + this.stableUnit(i * 271) * (innerH - 120);
            const blink = 0.22 + 0.18 * Math.sin(this.tick * 0.018 + i);
            this.ctx.globalAlpha = blink;
            this.ctx.fillRect(px, py, 2, 2);
        }
        this.ctx.globalAlpha = 1;

        this.ctx.strokeStyle = 'rgba(120, 215, 255, 0.26)';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(x + 0.5, innerY + 0.5, w - 1, innerH - 1);
        this.ctx.fillStyle = 'rgba(198, 230, 255, 0.86)';
        this.ctx.font = '8px "Share Tech Mono", monospace';
        const tabs = ['AUTONOMOUS', 'PROC CONTROL', 'IPC CHANNEL', 'VFS ROUTES', 'NET TRACE', 'SECURITY MAP', 'SCHEDULER', 'SETTINGS'];
        tabs.forEach((tab, idx) => {
            const tx = x + 52 + idx * Math.min(118, w / 9);
            this.ctx.strokeStyle = 'rgba(70, 156, 200, 0.42)';
            this.ctx.strokeRect(tx, innerY + 8, Math.min(104, w / 10), 12);
            this.ctx.fillText(tab, tx + 5, innerY + 17);
        });

        const planetGradient = this.ctx.createRadialGradient(kernelX - kernelR * 0.32, kernelY - kernelR * 0.36, kernelR * 0.08, kernelX, kernelY, kernelR);
        planetGradient.addColorStop(0, 'rgba(220, 255, 250, 0.98)');
        planetGradient.addColorStop(0.36, 'rgba(116, 224, 224, 0.9)');
        planetGradient.addColorStop(0.78, 'rgba(40, 118, 148, 0.72)');
        planetGradient.addColorStop(1, 'rgba(16, 43, 66, 0.94)');
        this.ctx.beginPath();
        this.ctx.arc(kernelX, kernelY, kernelR, 0, Math.PI * 2);
        this.ctx.fillStyle = planetGradient;
        this.ctx.fill();
        this.ctx.strokeStyle = 'rgba(196, 255, 244, 0.72)';
        this.ctx.lineWidth = 1.2;
        this.ctx.stroke();
        for (let i = -4; i <= 4; i += 1) {
            const yy = kernelY + i * kernelR * 0.18;
            const half = Math.sqrt(Math.max(0, kernelR * kernelR - (yy - kernelY) * (yy - kernelY)));
            this.ctx.beginPath();
            this.ctx.moveTo(kernelX - half * 0.85, yy);
            this.ctx.quadraticCurveTo(kernelX, yy + Math.sin(i + this.tick * 0.01) * 7, kernelX + half * 0.85, yy);
            this.ctx.strokeStyle = 'rgba(220, 255, 248, 0.15)';
            this.ctx.stroke();
        }
        this.ctx.beginPath();
        this.ctx.arc(kernelX, kernelY, kernelR * 1.17, -0.28, Math.PI * 1.18);
        this.ctx.strokeStyle = 'rgba(120, 230, 255, 0.28)';
        this.ctx.stroke();

        this.ctx.fillStyle = 'rgba(220, 255, 248, 0.96)';
        this.ctx.font = '12px "Share Tech Mono", monospace';
        this.ctx.fillText('KERNEL CORE', kernelX - kernelR * 0.18, kernelY - kernelR - 26);
        this.ctx.fillStyle = 'rgba(166, 230, 244, 0.9)';
        this.ctx.font = '9px "Share Tech Mono", monospace';
        this.ctx.fillText(`STATUS: ONLINE`, kernelX - kernelR * 0.18, kernelY - kernelR - 12);
        this.ctx.fillText(`TASKS ${nodes.length} · EDGES ${edges.length}`, kernelX - kernelR * 0.18, kernelY + kernelR + 22);

        const stationLayout = [
            [0.43, 0.26], [0.56, 0.18], [0.68, 0.35], [0.81, 0.22], [0.9, 0.42],
            [0.47, 0.62], [0.62, 0.72], [0.76, 0.62], [0.9, 0.72]
        ];
        const stationPos = new Map();
        hotProcesses.forEach((node, idx) => {
            const [fx, fy] = stationLayout[idx] || [0.45 + idx * 0.05, 0.5];
            const px = x + w * fx;
            const py = innerY + innerH * fy;
            const pid = Number(node.pid || 0);
            const pressure = Math.max(0, Math.min(100, Number(node.syscall_pressure || 0)));
            const active = pid === focusPid;
            stationPos.set(pid, { x: px, y: py, node });

            this.ctx.setLineDash([3, 4]);
            this.ctx.beginPath();
            this.ctx.moveTo(kernelX + kernelR * 0.72, kernelY - kernelR * 0.16 + idx * 5);
            const mx = kernelX + (px - kernelX) * 0.52;
            this.ctx.lineTo(mx, py);
            this.ctx.lineTo(px - 34, py);
            this.ctx.strokeStyle = active ? 'rgba(255, 225, 130, 0.72)' : 'rgba(120, 215, 255, 0.24)';
            this.ctx.lineWidth = active ? 1.4 : 0.8;
            this.ctx.stroke();
            this.ctx.setLineDash([]);

            const nodeR = active ? 10 : 7;
            const nodeColor = pressure >= 70 ? 'rgba(255, 136, 118, 0.96)' : (pressure >= 38 ? 'rgba(255, 204, 118, 0.94)' : 'rgba(105, 232, 198, 0.94)');
            const halo = this.ctx.createRadialGradient(px, py, 0, px, py, 42);
            halo.addColorStop(0, active ? 'rgba(255, 230, 130, 0.26)' : 'rgba(120, 230, 255, 0.16)');
            halo.addColorStop(1, 'rgba(120, 230, 255, 0)');
            this.ctx.beginPath();
            this.ctx.arc(px, py, 42, 0, Math.PI * 2);
            this.ctx.fillStyle = halo;
            this.ctx.fill();
            this.ctx.beginPath();
            this.ctx.arc(px, py, nodeR, 0, Math.PI * 2);
            this.ctx.fillStyle = nodeColor;
            this.ctx.fill();
            this.ctx.strokeStyle = active ? 'rgba(255,255,230,0.98)' : 'rgba(220,246,255,0.82)';
            this.ctx.stroke();
            this.nodeHitAreas.push({ x: px, y: py, r: 16, pid });

            this.drawPanel(px + 14, py - 28, 190, 54, '', { alpha: active ? 0.82 : 0.62, showTitle: false });
            this.ctx.fillStyle = active ? '#fff7bf' : 'rgba(212, 238, 255, 0.94)';
            this.ctx.font = '10px "Share Tech Mono", monospace';
            this.ctx.fillText(`PROC: ${String(node.name || 'proc').slice(0, 14)}`, px + 24, py - 10);
            this.ctx.fillStyle = 'rgba(150, 220, 238, 0.9)';
            this.ctx.font = '8px "Share Tech Mono", monospace';
            this.ctx.fillText(`PID ${pid} · STATUS: ${pressure >= 70 ? 'HOT' : 'ONLINE'}`, px + 24, py + 5);
            this.ctx.fillText(`pressure ${pressure.toFixed(0)} · fd ${Number(node.fd_count || 0)} · th ${Number(node.num_threads || 0)}`, px + 24, py + 18);
        });

        edges.slice(0, 70).forEach((edge, idx) => {
            const s = stationPos.get(Number(edge.source || 0));
            const t = stationPos.get(Number(edge.target || 0));
            if (!s || !t) return;
            this.ctx.globalAlpha = 0.24 + Math.min(0.32, Number(edge.weight || 0) * 0.22);
            this.drawCurvedStroke(s.x, s.y, t.x, t.y, this.edgeColor(String(edge.type || '')), 0.8, idx * 31, false);
            this.ctx.globalAlpha = 1;
        });

        const legendX = x + w * 0.48;
        const legendY = innerY + innerH - 54;
        this.drawPanel(legendX, legendY, Math.min(420, w * 0.34), 36, '', { alpha: 0.66, showTitle: false });
        [
            ['SYSCALL', edgeCounts.syscalls || 0, 'rgba(136,201,255,0.9)'],
            ['NETWORK', edgeCounts.network || 0, 'rgba(181,240,255,0.9)'],
            ['IPC', edgeCounts.ipc || 0, 'rgba(126,242,210,0.9)'],
            ['FILE', edgeCounts.file_access || 0, 'rgba(255,184,168,0.9)']
        ].forEach((item, idx) => {
            const lx = legendX + 14 + idx * 96;
            this.ctx.fillStyle = item[2];
            this.ctx.fillRect(lx, legendY + 13, 8, 8);
            this.ctx.fillStyle = 'rgba(207, 229, 246, 0.92)';
            this.ctx.font = '8px "Share Tech Mono", monospace';
            this.ctx.fillText(`${item[0]} ${item[1]}`, lx + 14, legendY + 20);
        });

        const rightPanelX = x + w - 172;
        this.drawPanel(rightPanelX, innerY + innerH - 202, 148, 136, '', { alpha: 0.62, showTitle: false });
        this.ctx.fillStyle = 'rgba(212, 238, 255, 0.94)';
        this.ctx.font = '9px "Share Tech Mono", monospace';
        this.ctx.fillText('LIVE TELEMETRY', rightPanelX + 10, innerY + innerH - 184);
        const net = networkRows[0];
        this.ctx.fillStyle = 'rgba(160, 205, 228, 0.88)';
        this.ctx.font = '8px "Share Tech Mono", monospace';
        this.ctx.fillText(`routes ${totalEdges}`, rightPanelX + 10, innerY + innerH - 164);
        this.ctx.fillText(`net ${net ? `${String(net.name || 'proc').slice(0, 9)} c${Number(net.connections || 0)}` : 'none'}`, rightPanelX + 10, innerY + innerH - 148);
        securityHooks.slice(0, 3).forEach((hook, idx) => {
            const active = String(hook.status || '') === 'active';
            this.ctx.fillStyle = active ? 'rgba(105, 230, 170, 0.9)' : 'rgba(255, 190, 120, 0.86)';
            this.ctx.fillText(`${active ? 'o' : '-'} ${String(hook.name || 'hook').slice(0, 15)}`, rightPanelX + 10, innerY + innerH - 126 + idx * 16);
        });

        this.ctx.fillStyle = 'rgba(140, 158, 188, 0.85)';
        this.ctx.font = '9px "Share Tech Mono", monospace';
        this.ctx.fillText('orbital process map: kernel core -> process stations -> ipc/network/file routes · click station to pin focus', x + 12, y + h - 10);
    }

    buildSemanticOpsForProcess(node, networkRows, securityHooks) {
        const pid = Number(node?.pid || 0);
        const semanticRows = Array.isArray(this.telemetry?.semantic_ops) ? this.telemetry.semantic_ops : [];
        const backendRow = semanticRows.find((row) => Number(row?.pid || 0) === pid);
        if (backendRow && Array.isArray(backendRow.ops) && backendRow.ops.length) {
            return backendRow.ops.slice(0, 8).map((op) => ({
                label: String(op?.label || 'kernel op'),
                type: String(op?.type || 'task'),
                active: op?.active !== false,
                weight: Number(op?.weight || 1),
                source: String(op?.source || backendRow.source || 'backend'),
                evidence: op?.evidence || {}
            }));
        }
        const name = String(node?.name || 'process').toLowerCase();
        const fdCount = Number(node?.fd_count || 0);
        const threads = Number(node?.num_threads || 0);
        const pressure = Number(node?.syscall_pressure || 0);
        const netRow = networkRows.find((row) => Number(row.pid || 0) === pid);
        const connections = Number(netRow?.connections || node?.connections || 0);
        const hasNetworkName = /nginx|node|python|gunicorn|curl|ssh|agent|chrome|firefox|http|tcp/.test(name);
        const activeSecurity = securityHooks.some((hook) => String(hook.status || '') === 'active');
        const ops = [
            { label: 'sched_pick_next()', type: 'sched', active: true, weight: Math.max(threads, 1) },
            { label: 'clone/fork lineage', type: 'task', active: Number(node?.ppid || 0) > 0, weight: 1 },
            { label: 'seccomp/LSM check', type: 'security', active: activeSecurity || String(node?.seccomp_mode || '') !== 'unknown', weight: activeSecurity ? 2 : 1 },
            { label: 'epoll_wait()', type: 'event', active: fdCount > 8 || connections > 0 || /nginx|node|gunicorn/.test(name), weight: fdCount },
            { label: 'socket()', type: 'network', active: connections > 0 || hasNetworkName, weight: connections },
            { label: 'connect()/accept()', type: 'network', active: connections > 0, weight: connections },
            { label: 'nf_conntrack', type: 'netfilter', active: connections > 0, weight: Number(netRow?.unique_peers || 0) },
            { label: 'tcp retransmission', type: 'tcp', active: connections > 0 && pressure >= 35, weight: pressure },
            { label: 'TLS handshake', type: 'crypto', active: /nginx|curl|chrome|firefox|http|ssl|tls/.test(name), weight: pressure },
            { label: 'sendfile()/splice()', type: 'vfs', active: fdCount >= 12 || /nginx|http/.test(name), weight: fdCount },
        ];
        return ops.filter((op) => op.active).slice(0, 8);
    }

    semanticOpColor(type, active = true) {
        const alpha = active ? 0.94 : 0.42;
        if (type === 'sched') return `rgba(132, 205, 255, ${alpha})`;
        if (type === 'task') return `rgba(186, 210, 242, ${alpha})`;
        if (type === 'security') return `rgba(125, 235, 174, ${alpha})`;
        if (type === 'event') return `rgba(255, 216, 128, ${alpha})`;
        if (type === 'network') return `rgba(124, 232, 255, ${alpha})`;
        if (type === 'netfilter') return `rgba(168, 146, 255, ${alpha})`;
        if (type === 'tcp') return `rgba(255, 146, 118, ${alpha})`;
        if (type === 'crypto') return `rgba(238, 186, 255, ${alpha})`;
        if (type === 'vfs') return `rgba(255, 188, 132, ${alpha})`;
        return `rgba(190, 220, 245, ${alpha})`;
    }

    drawSemanticKernelGraphEngine(nodes, edges, x, y, w, h) {
        const innerY = y + 4;
        const innerH = h - 8;
        this.nodeHitAreas = [];
        if (!nodes.length) {
            this.ctx.fillStyle = 'rgba(196,207,224,0.72)';
            this.ctx.font = '12px "Share Tech Mono", monospace';
            this.ctx.fillText('NO SEMANTIC KERNEL GRAPH DATA', x + 20, innerY + 28);
            return;
        }

        const focus = this.getFocusProcess(nodes);
        const focusPid = Number(focus?.pid || 0);
        const networkRows = Array.isArray(this.telemetry?.network_tracing) ? this.telemetry.network_tracing : [];
        const securityHooks = Array.isArray(this.telemetry?.security_hooks) ? this.telemetry.security_hooks : [];
        const hotProcesses = nodes
            .slice()
            .sort((a, b) => Number(b.syscall_pressure || 0) - Number(a.syscall_pressure || 0))
            .slice(0, 7);
        const edgeCounts = edges.reduce((acc, edge) => {
            const type = String(edge.type || 'link');
            acc[type] = (acc[type] || 0) + 1;
            return acc;
        }, {});

        const kernelX = x + w * 0.17;
        const kernelY = innerY + innerH * 0.54;
        const kernelR = Math.min(w, innerH) * 0.17;
        const graphX0 = x + w * 0.36;
        const graphW = w * 0.58;
        const rowTop = innerY + 86;
        const rowStep = Math.min(74, Math.max(56, (innerH - 178) / Math.max(1, hotProcesses.length)));

        this.ctx.fillStyle = 'rgba(2, 6, 12, 0.72)';
        this.ctx.fillRect(x, innerY, w, innerH);
        this.ctx.strokeStyle = 'rgba(76, 164, 205, 0.16)';
        this.ctx.lineWidth = 1;
        for (let gx = x + 28; gx < x + w; gx += 44) {
            this.ctx.beginPath();
            this.ctx.moveTo(gx + 0.5, innerY);
            this.ctx.lineTo(gx + 0.5, innerY + innerH);
            this.ctx.stroke();
        }
        for (let gy = innerY + 28; gy < innerY + innerH; gy += 38) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, gy + 0.5);
            this.ctx.lineTo(x + w, gy + 0.5);
            this.ctx.stroke();
        }

        this.ctx.strokeStyle = 'rgba(110, 220, 255, 0.32)';
        this.ctx.strokeRect(x + 0.5, innerY + 0.5, w - 1, innerH - 1);
        this.ctx.fillStyle = 'rgba(210, 242, 255, 0.96)';
        this.ctx.font = '12px "Share Tech Mono", monospace';
        this.ctx.fillText('SEMANTIC KERNEL GRAPH ENGINE', x + 18, innerY + 20);
        this.ctx.fillStyle = 'rgba(126, 210, 235, 0.78)';
        this.ctx.font = '8px "Share Tech Mono", monospace';
        this.ctx.fillText(`REALTIME LINUX GRAPH: process -> syscall -> subsystem -> effect · focus pid ${focusPid || '-'}`, x + 18, innerY + 36);
        ['PROCESS', 'SYSCALL', 'SECURITY', 'NETFILTER', 'TCP/TLS', 'EVENT LOOP', 'VFS'].forEach((label, idx) => {
            const tx = graphX0 + idx * (graphW / 7);
            this.ctx.strokeStyle = 'rgba(70, 156, 200, 0.42)';
            this.ctx.strokeRect(tx, innerY + 14, Math.min(92, graphW / 8), 14);
            this.ctx.fillStyle = 'rgba(165, 225, 245, 0.82)';
            this.ctx.font = '8px "Share Tech Mono", monospace';
            this.ctx.fillText(label, tx + 5, innerY + 24);
        });

        const coreGradient = this.ctx.createRadialGradient(kernelX - kernelR * 0.28, kernelY - kernelR * 0.32, kernelR * 0.05, kernelX, kernelY, kernelR);
        coreGradient.addColorStop(0, 'rgba(230,255,250,0.98)');
        coreGradient.addColorStop(0.34, 'rgba(112,231,222,0.9)');
        coreGradient.addColorStop(0.72, 'rgba(36,118,148,0.72)');
        coreGradient.addColorStop(1, 'rgba(10,30,55,0.96)');
        this.ctx.beginPath();
        this.ctx.arc(kernelX, kernelY, kernelR, 0, Math.PI * 2);
        this.ctx.fillStyle = coreGradient;
        this.ctx.fill();
        this.ctx.strokeStyle = 'rgba(196, 255, 244, 0.72)';
        this.ctx.lineWidth = 1.2;
        this.ctx.stroke();
        for (let i = -4; i <= 4; i += 1) {
            const yy = kernelY + i * kernelR * 0.18;
            const half = Math.sqrt(Math.max(0, kernelR * kernelR - (yy - kernelY) * (yy - kernelY)));
            this.ctx.beginPath();
            this.ctx.moveTo(kernelX - half * 0.85, yy);
            this.ctx.quadraticCurveTo(kernelX, yy + Math.sin(i + this.tick * 0.01) * 7, kernelX + half * 0.85, yy);
            this.ctx.strokeStyle = 'rgba(220, 255, 248, 0.15)';
            this.ctx.stroke();
        }
        this.ctx.fillStyle = 'rgba(220, 255, 248, 0.96)';
        this.ctx.font = '12px "Share Tech Mono", monospace';
        this.ctx.fillText('LINUX KERNEL CORE', kernelX - kernelR * 0.34, kernelY - kernelR - 22);
        this.ctx.fillStyle = 'rgba(166, 230, 244, 0.9)';
        this.ctx.font = '9px "Share Tech Mono", monospace';
        this.ctx.fillText(`TASKS ${nodes.length} · RELATIONS ${edges.length}`, kernelX - kernelR * 0.22, kernelY + kernelR + 22);

        const opPositions = [];
        hotProcesses.forEach((node, rowIdx) => {
            const pid = Number(node.pid || 0);
            const rowY = rowTop + rowIdx * rowStep;
            const pressure = Math.max(0, Math.min(100, Number(node.syscall_pressure || 0)));
            const active = pid === focusPid;
            const ops = this.buildSemanticOpsForProcess(node, networkRows, securityHooks);
            const processX = graphX0;
            const processColor = pressure >= 70 ? 'rgba(255, 132, 112, 0.96)' : (active ? 'rgba(255, 230, 132, 0.96)' : 'rgba(112, 232, 204, 0.92)');

            this.ctx.setLineDash([3, 5]);
            this.ctx.beginPath();
            this.ctx.moveTo(kernelX + kernelR * 0.85, kernelY - kernelR * 0.2 + rowIdx * 9);
            this.ctx.lineTo(processX - 40, rowY);
            this.ctx.strokeStyle = active ? 'rgba(255, 232, 135, 0.64)' : 'rgba(120, 215, 255, 0.22)';
            this.ctx.lineWidth = active ? 1.4 : 0.8;
            this.ctx.stroke();
            this.ctx.setLineDash([]);

            this.ctx.beginPath();
            this.ctx.arc(processX, rowY, active ? 9 : 7, 0, Math.PI * 2);
            this.ctx.fillStyle = processColor;
            this.ctx.fill();
            this.ctx.strokeStyle = active ? 'rgba(255,255,230,0.98)' : 'rgba(220,246,255,0.82)';
            this.ctx.stroke();
            this.nodeHitAreas.push({ x: processX, y: rowY, r: 16, pid });
            this.ctx.fillStyle = active ? '#fff7bf' : 'rgba(212, 238, 255, 0.94)';
            this.ctx.font = '10px "Share Tech Mono", monospace';
            this.ctx.fillText(`${String(node.name || 'process').slice(0, 15)}:${pid}`, processX + 14, rowY - 6);
            this.ctx.fillStyle = 'rgba(150, 220, 238, 0.88)';
            this.ctx.font = '8px "Share Tech Mono", monospace';
            this.ctx.fillText(`pressure ${pressure.toFixed(0)} · fd ${Number(node.fd_count || 0)} · th ${Number(node.num_threads || 0)}`, processX + 14, rowY + 8);

            let prev = { x: processX, y: rowY };
            ops.forEach((op, opIdx) => {
                const px = graphX0 + 110 + opIdx * Math.min(112, (graphW - 130) / Math.max(1, ops.length));
                const py = rowY + Math.sin(this.tick * 0.015 + rowIdx + opIdx) * 3;
                this.ctx.beginPath();
                this.ctx.moveTo(prev.x + 8, prev.y);
                this.ctx.lineTo(px - 10, py);
                this.ctx.strokeStyle = this.semanticOpColor(op.type, op.active).replace('0.94', active ? '0.72' : '0.34');
                this.ctx.lineWidth = active ? 1.4 : 0.9;
                this.ctx.stroke();

                const r = active ? 5.2 : 4.2;
                this.ctx.beginPath();
                this.ctx.arc(px, py, r, 0, Math.PI * 2);
                this.ctx.fillStyle = this.semanticOpColor(op.type, true);
                this.ctx.fill();
                this.ctx.strokeStyle = 'rgba(235,248,255,0.74)';
                this.ctx.stroke();
                this.ctx.fillStyle = active ? 'rgba(245, 252, 255, 0.96)' : 'rgba(190, 215, 235, 0.82)';
                this.ctx.font = '8px "Share Tech Mono", monospace';
                this.ctx.fillText(op.label, px + 8, py + 3);
                opPositions.push({ x: px, y: py, type: op.type, active });
                prev = { x: px, y: py };
            });
        });

        opPositions.forEach((a, idx) => {
            const b = opPositions.slice(idx + 1).find((candidate) => candidate.type === a.type && Math.abs(candidate.y - a.y) > 20);
            if (!b) return;
            this.ctx.globalAlpha = a.active || b.active ? 0.18 : 0.08;
            this.drawCurvedStroke(a.x, a.y, b.x, b.y, this.semanticOpColor(a.type, true), 0.55, idx * 19, false);
            this.ctx.globalAlpha = 1;
        });

        const legendX = x + w * 0.36;
        const legendY = innerY + innerH - 48;
        this.drawPanel(legendX, legendY, Math.min(560, w * 0.44), 34, '', { alpha: 0.66, showTitle: false });
        [
            ['sched', 'scheduler', this.semanticOpColor('sched')],
            ['sec', 'LSM/seccomp', this.semanticOpColor('security')],
            ['net', 'socket/tcp', this.semanticOpColor('network')],
            ['tls', 'crypto path', this.semanticOpColor('crypto')],
            ['vfs', 'sendfile/vfs', this.semanticOpColor('vfs')]
        ].forEach((item, idx) => {
            const lx = legendX + 14 + idx * 104;
            this.ctx.fillStyle = item[2];
            this.ctx.fillRect(lx, legendY + 12, 8, 8);
            this.ctx.fillStyle = 'rgba(207, 229, 246, 0.92)';
            this.ctx.font = '8px "Share Tech Mono", monospace';
            this.ctx.fillText(item[1], lx + 14, legendY + 19);
        });

        const statusX = x + w - 190;
        this.drawPanel(statusX, innerY + innerH - 158, 166, 96, '', { alpha: 0.62, showTitle: false });
        this.ctx.fillStyle = 'rgba(212, 238, 255, 0.94)';
        this.ctx.font = '9px "Share Tech Mono", monospace';
        this.ctx.fillText('ENGINE SIGNALS', statusX + 10, innerY + innerH - 140);
        this.ctx.fillStyle = 'rgba(160, 205, 228, 0.88)';
        this.ctx.font = '8px "Share Tech Mono", monospace';
        this.ctx.fillText(`syscalls ${edgeCounts.syscalls || 0}`, statusX + 10, innerY + innerH - 120);
        this.ctx.fillText(`network ${edgeCounts.network || 0}`, statusX + 10, innerY + innerH - 104);
        this.ctx.fillText(`ipc ${edgeCounts.ipc || 0}`, statusX + 10, innerY + innerH - 88);
        this.ctx.fillText(`file ${edgeCounts.file_access || 0}`, statusX + 10, innerY + innerH - 72);

        this.ctx.fillStyle = 'rgba(140, 158, 188, 0.85)';
        this.ctx.font = '9px "Share Tech Mono", monospace';
        this.ctx.fillText('semantic kernel graph: process -> syscall -> LSM/netfilter/TCP/TLS/event-loop/VFS · click process to pin focus', x + 12, y + h - 10);
    }

    drawEbpfKernelModule(coreX, coreY, coreR, x, innerY, w, innerH, securityHooks) {
        const activeBpf = securityHooks.some((hook) => /bpf/i.test(String(hook.name || '')) && String(hook.status || '') === 'active');
        const pulse = 0.55 + 0.25 * Math.sin(this.tick * 0.06);
        const start = -0.55;
        const end = 0.2;
        const r0 = coreR * 0.34;
        const r1 = coreR * 0.96;

        this.ctx.beginPath();
        this.ctx.arc(coreX, coreY, r1, start, end);
        this.ctx.arc(coreX, coreY, r0, end, start, true);
        this.ctx.closePath();
        this.ctx.fillStyle = activeBpf ? `rgba(90, 255, 190, ${0.22 + pulse * 0.18})` : 'rgba(90, 185, 220, 0.18)';
        this.ctx.fill();
        this.ctx.strokeStyle = activeBpf ? 'rgba(135, 255, 205, 0.78)' : 'rgba(120, 220, 255, 0.42)';
        this.ctx.lineWidth = activeBpf ? 1.6 : 1;
        this.ctx.stroke();

        for (let i = 0; i < 5; i += 1) {
            const a = start + (end - start) * (i / 4);
            const px = coreX + Math.cos(a) * (r0 + (r1 - r0) * 0.58);
            const py = coreY + Math.sin(a) * (r0 + (r1 - r0) * 0.58);
            this.ctx.beginPath();
            this.ctx.arc(px, py, i === 2 ? 3.2 : 2.2, 0, Math.PI * 2);
            this.ctx.fillStyle = activeBpf ? 'rgba(190, 255, 220, 0.95)' : 'rgba(130, 210, 235, 0.72)';
            this.ctx.fill();
        }

        const panelX = x + Math.min(w * 0.31, coreX + coreR * 0.96);
        const panelY = coreY - coreR * 0.08;
        this.ctx.setLineDash([3, 4]);
        this.ctx.beginPath();
        this.ctx.moveTo(coreX + Math.cos(-0.12) * r1, coreY + Math.sin(-0.12) * r1);
        this.ctx.lineTo(panelX - 12, panelY + 22);
        this.ctx.strokeStyle = activeBpf ? 'rgba(135, 255, 205, 0.58)' : 'rgba(120, 220, 255, 0.28)';
        this.ctx.stroke();
        this.ctx.setLineDash([]);

        this.drawPanel(panelX, panelY, 178, 82, '', { alpha: activeBpf ? 0.72 : 0.56, showTitle: false });
        this.ctx.fillStyle = activeBpf ? 'rgba(175, 255, 214, 0.96)' : 'rgba(190, 230, 245, 0.9)';
        this.ctx.font = '9px "Share Tech Mono", monospace';
        this.ctx.fillText('eBPF EMBEDDED MODULE', panelX + 10, panelY + 15);
        this.ctx.fillStyle = activeBpf ? 'rgba(120, 255, 202, 0.94)' : 'rgba(150, 205, 224, 0.82)';
        this.ctx.font = '7px "Share Tech Mono", monospace';
        const rows = [
            ['loader', 'userspace -> bpf()'],
            ['verifier', 'safety proof'],
            ['maps', 'shared state'],
            ['JIT', 'native kernel code'],
            ['hooks', 'kprobe/tc/tracepoint']
        ];
        rows.forEach((row, idx) => {
            const yy = panelY + 30 + idx * 10;
            this.ctx.fillStyle = idx === 1 ? 'rgba(255, 232, 145, 0.92)' : (activeBpf ? 'rgba(170, 245, 220, 0.86)' : 'rgba(150, 205, 224, 0.72)');
            this.ctx.fillText(`${row[0]}: ${row[1]}`.slice(0, 34), panelX + 10, yy);
        });

        this.ctx.fillStyle = 'rgba(132, 235, 255, 0.18)';
        for (let i = 0; i < 4; i += 1) {
            const mx = x + w * (0.36 + i * 0.1);
            const my = innerY + innerH * (0.21 + i * 0.12);
            this.ctx.beginPath();
            this.ctx.arc(mx, my, 5 + i, 0, Math.PI * 2);
            this.ctx.strokeStyle = 'rgba(120, 235, 255, 0.18)';
            this.ctx.stroke();
        }
    }

    drawReferenceSemanticKernelGraph(nodes, edges, x, y, w, h) {
        const innerY = y + 4;
        const innerH = h - 8;
        this.nodeHitAreas = [];
        if (!nodes.length) {
            this.ctx.fillStyle = 'rgba(196,207,224,0.72)';
            this.ctx.font = '12px "Share Tech Mono", monospace';
            this.ctx.fillText('NO SEMANTIC KERNEL GRAPH DATA', x + 20, innerY + 28);
            return;
        }

        const focus = this.getFocusProcess(nodes);
        const focusPid = Number(focus?.pid || 0);
        const networkRows = Array.isArray(this.telemetry?.network_tracing) ? this.telemetry.network_tracing : [];
        const securityHooks = Array.isArray(this.telemetry?.security_hooks) ? this.telemetry.security_hooks : [];
        const edgeCounts = edges.reduce((acc, edge) => {
            const type = String(edge.type || 'link');
            acc[type] = (acc[type] || 0) + 1;
            return acc;
        }, {});
        const rankedProcesses = nodes
            .slice()
            .sort((a, b) => Number(b.syscall_pressure || 0) - Number(a.syscall_pressure || 0))
            .slice(0, 8);
        const hotProcesses = rankedProcesses.some((node) => Number(node.pid || 0) === focusPid) || !focus
            ? rankedProcesses
            : [focus, ...rankedProcesses.filter((node) => Number(node.pid || 0) !== focusPid)].slice(0, 8);

        const coreX = x + w * 0.04;
        const coreY = innerY + innerH * 0.56;
        const coreR = Math.min(w, innerH) * 0.28;
        const stationLayout = [
            [0.38, 0.28], [0.55, 0.20], [0.68, 0.37], [0.82, 0.24],
            [0.43, 0.62], [0.58, 0.74], [0.75, 0.64], [0.90, 0.46]
        ];

        this.ctx.fillStyle = 'rgba(2, 6, 12, 0.88)';
        this.ctx.fillRect(x, innerY, w, innerH);
        const bgGlow = this.ctx.createRadialGradient(x + w * 0.4, innerY + innerH * 0.42, 0, x + w * 0.4, innerY + innerH * 0.42, w * 0.72);
        bgGlow.addColorStop(0, 'rgba(36, 84, 104, 0.24)');
        bgGlow.addColorStop(0.45, 'rgba(8, 18, 28, 0.24)');
        bgGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        this.ctx.fillStyle = bgGlow;
        this.ctx.fillRect(x, innerY, w, innerH);

        this.ctx.strokeStyle = 'rgba(52, 118, 150, 0.16)';
        this.ctx.lineWidth = 1;
        for (let gx = x + 18; gx < x + w; gx += 34) {
            this.ctx.beginPath();
            this.ctx.moveTo(gx + 0.5, innerY);
            this.ctx.lineTo(gx + 0.5, innerY + innerH);
            this.ctx.stroke();
        }
        for (let gy = innerY + 18; gy < innerY + innerH; gy += 30) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, gy + 0.5);
            this.ctx.lineTo(x + w, gy + 0.5);
            this.ctx.stroke();
        }

        this.ctx.strokeStyle = 'rgba(66, 178, 220, 0.42)';
        this.ctx.strokeRect(x + 0.5, innerY + 0.5, w - 1, innerH - 1);
        const topTabs = ['AUTONOMIC', 'PROC GRAPH', 'EBPF VM', 'IPC CHAIN', 'NET FILTER', 'TLS MAP', 'VFS ROUTES', 'SECURITY'];
        topTabs.forEach((tab, idx) => {
            const tw = Math.min(104, (w - 120) / topTabs.length);
            const tx = x + 52 + idx * (tw + 6);
            this.ctx.strokeStyle = 'rgba(67, 165, 215, 0.52)';
            this.ctx.strokeRect(tx, innerY + 8, tw, 13);
            this.ctx.fillStyle = idx === 1 ? 'rgba(205, 244, 255, 0.95)' : 'rgba(125, 201, 228, 0.82)';
            this.ctx.font = '7px "Share Tech Mono", monospace';
            this.ctx.fillText(tab, tx + 5, innerY + 18);
        });

        for (let i = 0; i < 8; i += 1) {
            const by = innerY + 42 + i * 24;
            this.ctx.strokeStyle = 'rgba(0, 228, 185, 0.38)';
            this.ctx.strokeRect(x + 4, by, 26, 16);
            this.ctx.fillStyle = i % 3 === 0 ? 'rgba(120, 235, 190, 0.42)' : 'rgba(22, 82, 96, 0.62)';
            this.ctx.fillRect(x + 7, by + 3, 20, 10);
        }

        for (let i = 0; i < 54; i += 1) {
            const px = x + 40 + this.stableUnit(i * 977) * (w - 80);
            const py = innerY + 44 + this.stableUnit(i * 431) * (innerH - 120);
            this.ctx.globalAlpha = 0.08 + 0.14 * this.stableUnit(i * 71);
            this.ctx.fillStyle = i % 4 === 0 ? 'rgba(255, 126, 110, 0.9)' : 'rgba(85, 230, 205, 0.9)';
            this.ctx.fillRect(px, py, 2, 2);
        }
        this.ctx.globalAlpha = 1;

        const coreGradient = this.ctx.createRadialGradient(coreX + coreR * 0.18, coreY - coreR * 0.32, coreR * 0.04, coreX, coreY, coreR);
        coreGradient.addColorStop(0, 'rgba(230, 255, 248, 0.98)');
        coreGradient.addColorStop(0.36, 'rgba(110, 232, 224, 0.9)');
        coreGradient.addColorStop(0.72, 'rgba(39, 133, 154, 0.74)');
        coreGradient.addColorStop(1, 'rgba(8, 32, 54, 0.98)');
        this.ctx.beginPath();
        this.ctx.arc(coreX, coreY, coreR, 0, Math.PI * 2);
        this.ctx.fillStyle = coreGradient;
        this.ctx.fill();
        this.ctx.strokeStyle = 'rgba(210, 255, 246, 0.72)';
        this.ctx.lineWidth = 1.4;
        this.ctx.stroke();
        for (let i = -6; i <= 6; i += 1) {
            const yy = coreY + i * coreR * 0.12;
            const half = Math.sqrt(Math.max(0, coreR * coreR - (yy - coreY) * (yy - coreY)));
            this.ctx.beginPath();
            this.ctx.moveTo(coreX - half * 0.88, yy);
            this.ctx.quadraticCurveTo(coreX, yy + Math.sin(i + this.tick * 0.01) * 8, coreX + half * 0.88, yy);
            this.ctx.strokeStyle = 'rgba(220, 255, 248, 0.14)';
            this.ctx.stroke();
        }
        this.ctx.beginPath();
        this.ctx.arc(coreX, coreY, coreR * 1.18, -0.36, Math.PI * 1.12);
        this.ctx.strokeStyle = 'rgba(120, 230, 255, 0.32)';
        this.ctx.stroke();
        this.drawEbpfKernelModule(coreX, coreY, coreR, x, innerY, w, innerH, securityHooks);

        this.ctx.fillStyle = 'rgba(220, 255, 248, 0.98)';
        this.ctx.font = '13px "Share Tech Mono", monospace';
        this.ctx.fillText('ESD: LINUX KERNEL', x + 72, coreY - coreR * 0.72);
        this.ctx.fillStyle = 'rgba(120, 255, 202, 0.96)';
        this.ctx.font = '13px "Share Tech Mono", monospace';
        this.ctx.fillText('STATUS: ONLINE', x + 72, coreY - coreR * 0.72 + 17);
        this.ctx.fillStyle = 'rgba(151, 210, 232, 0.86)';
        this.ctx.font = '8px "Share Tech Mono", monospace';
        this.ctx.fillText(`SEMANTIC GRAPH ACTIVE · TASKS ${nodes.length} · EDGES ${edges.length}`, x + 74, coreY - coreR * 0.72 + 30);
        if (focus) {
            this.drawPanel(x + 78, coreY + coreR * 0.32, 184, 54, '', { alpha: 0.58, showTitle: false });
            this.ctx.fillStyle = 'rgba(255, 238, 160, 0.96)';
            this.ctx.font = '9px "Share Tech Mono", monospace';
            this.ctx.fillText('FOCUS TRACE', x + 90, coreY + coreR * 0.32 + 16);
            this.ctx.fillStyle = 'rgba(176, 226, 240, 0.9)';
            this.ctx.font = '8px "Share Tech Mono", monospace';
            this.ctx.fillText(`${String(focus.name || 'process').slice(0, 18)}:${focusPid}`, x + 90, coreY + coreR * 0.32 + 31);
            this.ctx.fillText(`pressure ${Number(focus.syscall_pressure || 0).toFixed(0)} · fd ${Number(focus.fd_count || 0)}`, x + 90, coreY + coreR * 0.32 + 44);
        }

        const stationPoints = [];
        hotProcesses.forEach((node, idx) => {
            const [fx, fy] = stationLayout[idx] || [0.5, 0.5];
            const px = x + w * fx;
            const py = innerY + innerH * fy;
            const pid = Number(node.pid || 0);
            const pressure = Math.max(0, Math.min(100, Number(node.syscall_pressure || 0)));
            const active = pid === focusPid;
            const ops = this.buildSemanticOpsForProcess(node, networkRows, securityHooks).slice(0, 5);
            stationPoints.push({ x: px, y: py, pid, node });

            const startX = coreX + coreR * 0.86;
            const startY = coreY - coreR * 0.12 + idx * 8;
            const bendX = x + w * (0.29 + (idx % 3) * 0.08);
            const routePulse = (Math.sin(this.tick * 0.04 + idx) + 1) * 0.5;
            this.ctx.setLineDash([2, 3]);
            this.ctx.beginPath();
            this.ctx.moveTo(startX, startY);
            this.ctx.lineTo(bendX, startY);
            this.ctx.lineTo(bendX, py);
            this.ctx.lineTo(px - 24, py);
            this.ctx.strokeStyle = active ? 'rgba(255, 226, 128, 0.78)' : 'rgba(120, 215, 255, 0.28)';
            this.ctx.lineWidth = active ? 1.5 : 0.8;
            this.ctx.stroke();
            this.ctx.setLineDash([]);
            if (active) {
                this.ctx.shadowColor = 'rgba(255, 226, 128, 0.75)';
                this.ctx.shadowBlur = 12;
                this.ctx.beginPath();
                const particleX = bendX + (px - 24 - bendX) * routePulse;
                this.ctx.arc(particleX, py, 3.2, 0, Math.PI * 2);
                this.ctx.fillStyle = 'rgba(255, 244, 178, 0.95)';
                this.ctx.fill();
                this.ctx.shadowBlur = 0;
            }

            const orbitR = active ? 43 : 32;
            this.ctx.beginPath();
            this.ctx.ellipse(px, py, orbitR, orbitR * 0.42, this.tick * 0.002 + idx, 0, Math.PI * 2);
            this.ctx.strokeStyle = active ? 'rgba(255, 226, 128, 0.36)' : 'rgba(84, 208, 232, 0.22)';
            this.ctx.stroke();
            this.ctx.beginPath();
            this.ctx.arc(px, py, active ? 10 : 7, 0, Math.PI * 2);
            this.ctx.fillStyle = pressure >= 70 ? 'rgba(255, 126, 102, 0.96)' : (active ? 'rgba(255, 226, 132, 0.96)' : 'rgba(100, 230, 204, 0.96)');
            this.ctx.fill();
            this.ctx.strokeStyle = 'rgba(230, 252, 255, 0.86)';
            this.ctx.stroke();
            this.nodeHitAreas.push({ x: px, y: py, r: 16, pid });

            const labelW = active ? 204 : 178;
            const labelH = 45 + Math.min(3, ops.length) * 10;
            const labelX = px > x + w * 0.78 ? px - labelW - 16 : px + 14;
            const labelY = py - 28;
            this.drawPanel(labelX, labelY, labelW, labelH, '', { alpha: active ? 0.78 : 0.58, showTitle: false });
            if (active) {
                this.ctx.strokeStyle = 'rgba(255, 226, 128, 0.7)';
                this.ctx.strokeRect(labelX + 0.5, labelY + 0.5, labelW - 1, labelH - 1);
            }
            this.ctx.fillStyle = active ? '#fff7bf' : 'rgba(212, 238, 255, 0.94)';
            this.ctx.font = '10px "Share Tech Mono", monospace';
            this.ctx.fillText(`ESD: ${String(node.name || 'process').slice(0, 13).toUpperCase()}`, labelX + 10, labelY + 15);
            this.ctx.fillStyle = pressure >= 70 ? 'rgba(255, 160, 126, 0.94)' : 'rgba(120, 255, 202, 0.94)';
            this.ctx.fillText(`STATUS: ${pressure >= 70 ? 'HOT' : 'ONLINE'}`, labelX + 10, labelY + 29);
            this.ctx.fillStyle = 'rgba(151, 210, 232, 0.86)';
            this.ctx.font = '7px "Share Tech Mono", monospace';
            this.ctx.fillText(`PID ${pid} · P ${pressure.toFixed(0)} · FD ${Number(node.fd_count || 0)}`, labelX + 10, labelY + 40);
            ops.slice(0, 3).forEach((op, opIdx) => {
                this.ctx.fillStyle = this.semanticOpColor(op.type, true);
                this.ctx.fillText(`├ ${op.label}`, labelX + 10, labelY + 52 + opIdx * 10);
            });
        });

        edges.slice(0, 54).forEach((edge, idx) => {
            const s = stationPoints.find((p) => p.pid === Number(edge.source || 0));
            const t = stationPoints.find((p) => p.pid === Number(edge.target || 0));
            if (!s || !t) return;
            this.ctx.globalAlpha = 0.14 + Math.min(0.28, Number(edge.weight || 0) * 0.18);
            this.drawCurvedStroke(s.x, s.y, t.x, t.y, this.edgeColor(String(edge.type || '')), 0.65, idx * 37, false);
            this.ctx.globalAlpha = 1;
        });

        const tileY = innerY + innerH - 76;
        [
            ['socket()', networkRows.length],
            ['epoll_wait()', hotProcesses.filter((node) => Number(node.fd_count || 0) > 8).length],
            ['nf_conntrack', edgeCounts.network || 0],
            ['sendfile()', edgeCounts.file_access || 0],
            ['eBPF', securityHooks.some((h) => /bpf/i.test(String(h.name || '')) && String(h.status || '') === 'active') ? 'ON' : 'VM'],
            ['LSM hooks', securityHooks.length]
        ].forEach((tile, idx) => {
            const tx = x + w * 0.46 + idx * 74;
            this.ctx.fillStyle = 'rgba(7, 42, 52, 0.72)';
            this.ctx.fillRect(tx, tileY, 62, 24);
            this.ctx.strokeStyle = 'rgba(70, 210, 190, 0.42)';
            this.ctx.strokeRect(tx + 0.5, tileY + 0.5, 61, 23);
            this.ctx.fillStyle = 'rgba(142, 244, 218, 0.88)';
            this.ctx.font = '7px "Share Tech Mono", monospace';
            this.ctx.fillText(String(tile[0]).toUpperCase(), tx + 5, tileY + 9);
            this.ctx.fillStyle = 'rgba(224, 246, 255, 0.9)';
            this.ctx.font = '10px "Share Tech Mono", monospace';
            this.ctx.fillText(String(tile[1]), tx + 5, tileY + 20);
        });

        const dockY = innerY + innerH - 36;
        const dockFill = this.ctx.createLinearGradient(x + 6, dockY, x + w - 6, dockY);
        dockFill.addColorStop(0, 'rgba(4, 18, 28, 0.3)');
        dockFill.addColorStop(0.5, 'rgba(22, 78, 88, 0.36)');
        dockFill.addColorStop(1, 'rgba(4, 18, 28, 0.3)');
        this.ctx.fillStyle = dockFill;
        this.ctx.fillRect(x + 6, dockY, w - 12, 26);
        this.ctx.strokeStyle = 'rgba(74, 184, 224, 0.46)';
        this.ctx.strokeRect(x + 6, dockY, w - 12, 26);
        const dockItems = [
            ['SYSCALL', edgeCounts.syscalls || 0, 'rgba(136,201,255,0.9)'],
            ['NETWORK', edgeCounts.network || 0, 'rgba(181,240,255,0.9)'],
            ['IPC', edgeCounts.ipc || 0, 'rgba(126,242,210,0.9)'],
            ['FILE', edgeCounts.file_access || 0, 'rgba(255,184,168,0.9)'],
            ['SECURITY', securityHooks.filter((h) => String(h.status || '') === 'active').length, 'rgba(120,235,170,0.9)']
        ];
        dockItems.forEach((item, idx) => {
            const bx = x + w * 0.47 + idx * 86;
            this.ctx.fillStyle = item[2];
            this.ctx.fillRect(bx, dockY + 8, 9, 9);
            this.ctx.fillStyle = 'rgba(207, 229, 246, 0.92)';
            this.ctx.font = '8px "Share Tech Mono", monospace';
            this.ctx.fillText(`${item[0]} ${item[1]}`, bx + 14, dockY + 16);
        });

        const sideX = x + w - 62;
        for (let i = 0; i < 4; i += 1) {
            const py = innerY + innerH * 0.34 + i * 52;
            this.ctx.strokeStyle = 'rgba(74, 184, 224, 0.46)';
            this.ctx.strokeRect(sideX, py, 42, 28);
            this.ctx.beginPath();
            this.ctx.moveTo(sideX + 7, py + 19);
            for (let sx = 0; sx < 24; sx += 1) {
                const vx = sideX + 7 + sx;
                const vy = py + 15 + Math.sin(this.tick * 0.06 + sx * 0.7 + i) * 5;
                if (sx === 0) this.ctx.moveTo(vx, vy);
                else this.ctx.lineTo(vx, vy);
            }
            this.ctx.strokeStyle = 'rgba(96, 226, 255, 0.62)';
            this.ctx.stroke();
        }

        this.ctx.fillStyle = 'rgba(140, 158, 188, 0.85)';
        this.ctx.font = '9px "Share Tech Mono", monospace';
        this.ctx.fillText('semantic kernel graph engine: linux core -> process stations -> syscall/netfilter/tcp/tls/vfs chains · click station to pin', x + 12, y + h - 10);
    }

    drawMicroscopeGraph(nodes, edges, x, y, w, h) {
        this.drawReferenceSemanticKernelGraph(nodes, edges, x, y, w, h);
    }

    projectWireframePoint(px, py, pz, originX, originY, scale) {
        return {
            x: originX + (px - py) * scale,
            y: originY + (px + py) * scale * 0.44 - pz * scale
        };
    }

    drawWireframeCube(cx, cy, cz, size, originX, originY, scale, color, alpha, lineWidth) {
        const h = size * 0.5;
        const vertices = [
            [-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h],
            [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]
        ].map(([vx, vy, vz]) => this.projectWireframePoint(cx + vx, cy + vy, cz + vz, originX, originY, scale));
        const edges = [
            [0, 1], [1, 2], [2, 3], [3, 0],
            [4, 5], [5, 6], [6, 7], [7, 4],
            [0, 4], [1, 5], [2, 6], [3, 7]
        ];
        this.ctx.globalAlpha = alpha;
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = lineWidth;
        edges.forEach(([a, b]) => {
            this.ctx.beginPath();
            this.ctx.moveTo(vertices[a].x, vertices[a].y);
            this.ctx.lineTo(vertices[b].x, vertices[b].y);
            this.ctx.stroke();
        });
        this.ctx.globalAlpha = 1;
        return vertices.reduce(
            (box, point) => ({
                minX: Math.min(box.minX, point.x),
                minY: Math.min(box.minY, point.y),
                maxX: Math.max(box.maxX, point.x),
                maxY: Math.max(box.maxY, point.y)
            }),
            { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
        );
    }

    drawProcfsCoveragePanel(x, y, w, h) {
        const procfs = this.telemetry?.procfs_map || {};
        const sources = Array.isArray(procfs.sources) ? procfs.sources : [];
        this.drawPanel(x, y, w, h, '', { alpha: 0.66, showTitle: false });
        this.ctx.fillStyle = 'rgba(210, 230, 245, 0.94)';
        this.ctx.font = '9px "Share Tech Mono", monospace';
        this.ctx.fillText('PROCFS COVERAGE', x + 12, y + 18);
        this.ctx.fillStyle = 'rgba(140, 170, 196, 0.86)';
        this.ctx.font = '8px "Share Tech Mono", monospace';
        this.ctx.fillText(`/proc dirs ${Number(procfs.pid_dirs || 0)} · sampled ${Number(procfs.sampled_pids || 0)}`, x + 12, y + 34);

        const groupColor = (group) => {
            if (group === 'process') return 'rgba(170, 212, 245, 0.82)';
            if (group === 'network') return 'rgba(126, 232, 255, 0.82)';
            if (group === 'memory') return 'rgba(126, 242, 210, 0.82)';
            if (group === 'security') return 'rgba(255, 210, 128, 0.82)';
            return 'rgba(180, 190, 210, 0.72)';
        };
        sources.slice(0, 8).forEach((src, idx) => {
            const yy = y + 52 + idx * 15;
            const active = src.active !== false;
            this.ctx.strokeStyle = active ? groupColor(String(src.group || '')) : 'rgba(90, 105, 122, 0.36)';
            this.ctx.strokeRect(x + 12.5, yy - 8.5, 8, 8);
            this.ctx.fillStyle = active ? groupColor(String(src.group || '')) : 'rgba(90, 105, 122, 0.36)';
            this.ctx.fillRect(x + 15, yy - 6, 3, 3);
            this.ctx.fillStyle = active ? 'rgba(190, 216, 238, 0.86)' : 'rgba(120, 140, 158, 0.62)';
            this.ctx.fillText(`${String(src.path || '').replace('/proc/', '')}`.slice(0, 26), x + 28, yy);
            this.ctx.fillStyle = 'rgba(132, 158, 184, 0.78)';
            this.ctx.fillText(String(src.samples || 0), x + w - 32, yy);
        });
        this.ctx.fillStyle = 'rgba(120, 150, 176, 0.68)';
        this.ctx.font = '7px "Share Tech Mono", monospace';
        this.ctx.fillText('sampled atlas · not recursive full procfs mirror', x + 12, y + h - 10);
    }

    drawWireframeProcGraph(nodes, edges, x, y, w, h) {
        this.nodeHitAreas = [];
        const originX = x + w * 0.5;
        const originY = y + h * 0.43;
        const scale = Math.max(20, Math.min(34, w / 42));
        const visibleNodes = nodes.slice(0, 24);
        const cols = 7;
        const pos = new Map();
        const ghostCubes = [];
        const bg = this.ctx.createRadialGradient(x + w * 0.5, y + h * 0.42, 0, x + w * 0.5, y + h * 0.42, Math.max(w, h) * 0.66);
        bg.addColorStop(0, 'rgba(20, 28, 38, 0.96)');
        bg.addColorStop(0.6, 'rgba(7, 12, 18, 0.96)');
        bg.addColorStop(1, 'rgba(2, 5, 10, 0.98)');
        this.ctx.fillStyle = bg;
        this.ctx.fillRect(x + 2, y, w - 4, h);
        this.ctx.strokeStyle = 'rgba(120, 165, 205, 0.18)';
        this.ctx.strokeRect(x + 2.5, y + 0.5, w - 5, h - 1);
        this.drawPanel(x + 12, y + 12, Math.min(370, w * 0.34), 76, '', { alpha: 0.72, showTitle: false });
        this.ctx.fillStyle = 'rgba(230, 240, 252, 0.92)';
        this.ctx.font = '12px "Share Tech Mono", monospace';
        this.ctx.fillText('WIREFRAME PROC ARCHITECTURE', x + 26, y + 34);
        this.ctx.fillStyle = 'rgba(154, 190, 220, 0.86)';
        this.ctx.font = '9px "Share Tech Mono", monospace';
        this.ctx.fillText('processes as transparent cubes · links: syscalls / ipc / net / vfs', x + 26, y + 52);
        this.ctx.fillText(`nodes ${visibleNodes.length} · edges ${edges.length} · hover/click cube to pin`, x + 26, y + 68);

        // Isometric construction guide lines.
        this.ctx.globalAlpha = 0.28;
        this.ctx.strokeStyle = 'rgba(118, 184, 224, 0.16)';
        this.ctx.lineWidth = 1;
        for (let i = -10; i <= 10; i += 1) {
            const a = this.projectWireframePoint(i, -6, -0.4, originX, originY, scale);
            const b = this.projectWireframePoint(i, 10, -0.4, originX, originY, scale);
            const c = this.projectWireframePoint(-6, i, -0.4, originX, originY, scale);
            const d = this.projectWireframePoint(10, i, -0.4, originX, originY, scale);
            this.ctx.beginPath();
            this.ctx.moveTo(a.x, a.y);
            this.ctx.lineTo(b.x, b.y);
            this.ctx.moveTo(c.x, c.y);
            this.ctx.lineTo(d.x, d.y);
            this.ctx.stroke();
        }
        this.ctx.globalAlpha = 1;

        const procfsSources = Array.isArray(this.telemetry?.procfs_map?.sources) ? this.telemetry.procfs_map.sources : [];
        procfsSources.slice(0, 10).forEach((src, idx) => {
            const group = String(src.group || 'procfs');
            const layer = group === 'process' ? -0.65 : (group === 'network' ? 0.25 : (group === 'memory' ? 0.9 : 1.45));
            const gx = -4.6 + (idx % 5) * 1.18 + (idx % 2) * 0.28;
            const gy = 3.1 + Math.floor(idx / 5) * 1.12;
            const gz = 0.15 + layer + Math.min(1.2, Number(src.samples || 0) / 12);
            ghostCubes.push({
                x: gx,
                y: gy,
                z: gz,
                size: 0.42 + Math.min(0.38, Number(src.samples || 0) / 50),
                group,
                label: String(src.path || '').replace('/proc/', ''),
            });
        });
        ghostCubes.forEach((cube, idx) => {
            const color = cube.group === 'network' ? 'rgba(126, 232, 255, 0.34)'
                : (cube.group === 'memory' ? 'rgba(126, 242, 210, 0.32)'
                    : (cube.group === 'security' ? 'rgba(255, 210, 128, 0.32)' : 'rgba(170, 212, 245, 0.28)'));
            this.drawWireframeCube(cube.x, cube.y, cube.z, cube.size, originX, originY, scale, color, 0.34, 0.75);
            if (idx < 4) {
                const p = this.projectWireframePoint(cube.x, cube.y, cube.z + cube.size * 0.5, originX, originY, scale);
                this.ctx.fillStyle = 'rgba(132, 158, 184, 0.58)';
                this.ctx.font = '7px "Share Tech Mono", monospace';
                this.ctx.fillText(cube.label.slice(0, 18), p.x + 5, p.y - 3);
            }
        });
        [
            { x: -5.2, y: -3.8, z: 0.2, size: 1.9 },
            { x: 4.8, y: -2.9, z: 0.6, size: 2.2 },
            { x: 5.6, y: 4.1, z: 0.1, size: 1.8 },
            { x: -3.8, y: 5.2, z: 0.4, size: 1.5 },
        ].forEach((cube) => {
            this.drawWireframeCube(cube.x, cube.y, cube.z, cube.size, originX, originY, scale, 'rgba(135, 170, 200, 0.16)', 0.22, 0.7);
        });

        visibleNodes.forEach((node, idx) => {
            const pid = Number(node.pid || 0);
            const col = idx % cols;
            const row = Math.floor(idx / cols);
            const pressure = Math.max(0, Math.min(100, Number(node.syscall_pressure || 0)));
            const fd = Number(node.fd_count || 0);
            const conns = Number(node.connections || 0);
            const px = (col - (cols - 1) / 2) * 1.32 + (row % 2) * 0.46;
            const py = row * 1.16 - 2.35;
            const pz = 0.25 + Math.min(2.4, pressure / 44 + fd / 90 + conns / 7);
            const size = 0.62 + Math.min(0.7, pressure / 170 + fd / 190);
            const screen = this.projectWireframePoint(px, py, pz, originX, originY, scale);
            pos.set(pid, { x: px, y: py, z: pz, screenX: screen.x, screenY: screen.y, size, node, idx });
        });

        edges.slice(0, 120).forEach((edge, idx) => {
            const s = pos.get(Number(edge.source || 0));
            const t = pos.get(Number(edge.target || 0));
            if (!s || !t) return;
            const sp = this.projectWireframePoint(s.x, s.y, s.z, originX, originY, scale);
            const tp = this.projectWireframePoint(t.x, t.y, t.z, originX, originY, scale);
            const color = this.edgeColor(String(edge.type || ''));
            this.ctx.globalAlpha = 0.18 + Math.min(0.32, Number(edge.weight || 0) * 0.22);
            this.drawCurvedStroke(sp.x, sp.y, tp.x, tp.y, color, 0.6, idx * 13, false);
            this.ctx.globalAlpha = 1;
        });

        const sorted = Array.from(pos.values()).sort((a, b) => (a.x + a.y + a.z) - (b.x + b.y + b.z));
        sorted.forEach((item) => {
            const node = item.node;
            const pid = Number(node.pid || 0);
            const pressure = Math.max(0, Math.min(100, Number(node.syscall_pressure || 0)));
            const active = pid === this.selectedNodePid || pid === this.hoveredNodePid;
            const color = pressure >= 70 ? 'rgba(255, 142, 128, 0.72)' : 'rgba(170, 212, 245, 0.5)';
            const accent = pressure >= 70 ? 'rgba(255, 120, 110, 0.88)' : (active ? 'rgba(255, 230, 148, 0.92)' : 'rgba(120, 190, 230, 0.42)');
            const box = this.drawWireframeCube(item.x, item.y, item.z, item.size, originX, originY, scale, color, active ? 0.96 : 0.58, active ? 1.6 : 0.95);
            if (active || pressure >= 70) {
                this.drawWireframeCube(item.x, item.y, item.z, item.size * 1.08, originX, originY, scale, accent, active ? 0.9 : 0.56, 1.15);
            }
            const cx = (box.minX + box.maxX) * 0.5;
            const cy = (box.minY + box.maxY) * 0.5;
            this.nodeHitAreas.push({ x: cx, y: cy, r: Math.max(16, (box.maxX - box.minX + box.maxY - box.minY) * 0.18), pid });
            if (active) {
                this.ctx.fillStyle = 'rgba(5, 10, 16, 0.84)';
                this.ctx.fillRect(box.maxX + 8, box.minY - 4, 174, 42);
                this.ctx.strokeStyle = 'rgba(150, 204, 240, 0.48)';
                this.ctx.strokeRect(box.maxX + 8.5, box.minY - 3.5, 173, 41);
                this.ctx.fillStyle = 'rgba(220, 236, 250, 0.94)';
                this.ctx.font = '9px "Share Tech Mono", monospace';
                this.ctx.fillText(`${String(node.name || 'proc').slice(0, 16)}:${pid}`, box.maxX + 16, box.minY + 11);
                this.ctx.fillText(`pressure ${pressure.toFixed(0)} · fd ${Number(node.fd_count || 0)} · net ${Number(node.connections || 0)}`, box.maxX + 16, box.minY + 27);
            }
        });

        this.drawPanel(x + w - 238, y + h - 116, 218, 78, '', { alpha: 0.66, showTitle: false });
        this.ctx.fillStyle = 'rgba(210, 230, 245, 0.9)';
        this.ctx.font = '9px "Share Tech Mono", monospace';
        this.ctx.fillText('WIRE LEGEND', x + w - 224, y + h - 96);
        [
            ['cube size', 'pressure + fd'],
            ['height', 'semantic activity'],
            ['links', 'syscalls/ipc/net/vfs']
        ].forEach((row, idx) => {
            this.ctx.fillStyle = 'rgba(140, 170, 196, 0.86)';
            this.ctx.fillText(`${row[0]}: ${row[1]}`, x + w - 224, y + h - 78 + idx * 15);
        });
        this.drawProcfsCoveragePanel(x + 18, y + h - 178, 268, 142);
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

    drawHudChrome(x, y, w, h) {
        const cx = x + w * 0.5;
        const cy = y + h * 0.5;
        this.ctx.strokeStyle = 'rgba(150, 222, 255, 0.2)';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

        // Side bracket arcs inspired by tactical HUD layouts.
        const arcR = Math.min(w, h) * 0.34;
        this.ctx.beginPath();
        this.ctx.arc(cx - w * 0.22, cy, arcR, -0.7, 0.7);
        this.ctx.arc(cx + w * 0.22, cy, arcR, Math.PI - 0.7, Math.PI + 0.7);
        this.ctx.strokeStyle = 'rgba(140, 220, 255, 0.24)';
        this.ctx.stroke();

        // Thin horizontal targeting bars.
        this.ctx.strokeStyle = 'rgba(150, 226, 255, 0.22)';
        this.ctx.beginPath();
        this.ctx.moveTo(x + 26, cy);
        this.ctx.lineTo(cx - 80, cy);
        this.ctx.moveTo(cx + 80, cy);
        this.ctx.lineTo(x + w - 26, cy);
        this.ctx.stroke();

        // Small center reticle.
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, 18, 0, Math.PI * 2);
        this.ctx.strokeStyle = 'rgba(178, 236, 255, 0.42)';
        this.ctx.stroke();
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, 7, 0, Math.PI * 2);
        this.ctx.strokeStyle = 'rgba(208, 247, 255, 0.9)';
        this.ctx.stroke();
    }

    schedUtilColor(frac) {
        const f = Math.max(0, Math.min(1, frac));
        if (f < 0.33) return `rgba(110,180,245,${0.55 + f})`;
        if (f < 0.66) return 'rgba(120,235,220,0.95)';
        if (f < 0.85) return 'rgba(255,205,120,0.95)';
        return 'rgba(255,140,120,0.98)';
    }

    drawSchedulerView(x, y, w, h) {
        this.schedRectHits = [];
        const ctx = this.ctx;
        const d = this.schedulerData;

        // Header strip.
        const headH = 46;
        this.drawPanel(x, y, w, headH, '', { alpha: 0.7, showTitle: false });
        ctx.fillStyle = 'rgba(210,235,255,0.95)';
        ctx.font = '13px "Share Tech Mono", monospace';
        ctx.fillText(`CPU SCHEDULER · ${d?.scheduler || '…'} + PELT`, x + 16, y + 20);
        ctx.font = '9px "Share Tech Mono", monospace';
        ctx.fillStyle = 'rgba(150,194,225,0.82)';
        if (!d) {
            ctx.fillText('loading /api/scheduler-pelt …', x + 16, y + 36);
            return;
        }
        const la = (d.loadavg || []).map((v) => v.toFixed(2)).join(' ');
        const src = d.eevdf?.source === 'kernel' ? 'sched_debug' : 'computed';
        ctx.fillText(
            `cpus ${d.cpus} · loadavg ${la} · tasks ${d.task_count} · y=${d.pelt.y} · half-life ${d.pelt.half_life_ms}ms · util,load ∈ [0,${d.pelt.capacity}] · EEVDF:${src}`,
            x + 16, y + 36
        );

        const bodyY = y + headH + 12;
        const bodyH = h - headH - 12;
        const leftW = Math.min(440, w * 0.4);
        const rightX = x + leftW + 14;
        const rightW = w - leftW - 14;

        const kernelH = Math.min(220, bodyH * 0.5);
        this.drawPeltDecayKernel(x, bodyY, leftW, kernelH, d);
        this.drawPeltSelfCheck(x, bodyY + kernelH + 12, leftW, bodyH - kernelH - 12, d);
        this.drawSchedTasks(rightX, bodyY, rightW, bodyH, d);

        if (this.schedOverlayPid !== null) this.drawSchedOverlay(d);
    }

    drawPeltDecayKernel(x, y, w, h, d) {
        const ctx = this.ctx;
        this.drawPanel(x, y, w, h, 'PELT DECAY KERNEL', { alpha: 0.82 });
        ctx.fillStyle = 'rgba(150,194,225,0.82)';
        ctx.font = '9px "Share Tech Mono", monospace';
        ctx.fillText('util_avg = Σ activityₖ · yᵏ   —  same EWMA as the Kernel DNA z-score', x + 14, y + 34);

        const weights = Array.isArray(d.pelt.kernel_weights) ? d.pelt.kernel_weights : [];
        const n = weights.length;
        if (!n) return;
        const plotX = x + 16;
        const plotY = y + 46;
        const plotW = w - 32;
        const plotH = h - 70;
        const bw = plotW / n;
        const sweep = (this.tick * 0.5) % n;
        weights.forEach((wgt, i) => {
            const bh = wgt * plotH;
            const bx = plotX + i * bw;
            const by = plotY + plotH - bh;
            const near = Math.abs(i - sweep) < 2.5;
            ctx.fillStyle = near ? 'rgba(150,225,255,0.98)' : `rgba(110,175,240,${0.28 + 0.5 * wgt})`;
            ctx.fillRect(bx, by, Math.max(1, bw - 0.7), bh);
        });

        // Half-life marker at k = 32 periods (~32 ms).
        const hlX = plotX + 32 * bw;
        ctx.strokeStyle = 'rgba(255,180,120,0.85)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(hlX, plotY);
        ctx.lineTo(hlX, plotY + plotH);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,195,150,0.95)';
        ctx.font = '8px "Share Tech Mono", monospace';
        ctx.fillText('½ · 32 ms', hlX + 4, plotY + 10);

        ctx.fillStyle = 'rgba(150,194,225,0.7)';
        ctx.fillText('now', plotX, plotY + plotH + 13);
        ctx.textAlign = 'right';
        ctx.fillText(`${n} ms ago`, plotX + plotW, plotY + plotH + 13);
        ctx.textAlign = 'left';
    }

    drawPeltSelfCheck(x, y, w, h, d) {
        const ctx = this.ctx;
        this.drawPanel(x, y, w, h, 'PELT NORMALISATION · OUR MATH vs KERNEL', { alpha: 0.82 });
        const tasks = Array.isArray(d.tasks) ? d.tasks : [];
        const task = tasks.find((t) => t.pid === this.schedSelectedPid) || tasks[0];
        if (!task) {
            ctx.fillStyle = 'rgba(196,207,224,0.7)';
            ctx.font = '10px "Share Tech Mono", monospace';
            ctx.fillText('no task data', x + 16, y + 40);
            return;
        }
        const maxv = d.pelt.load_avg_max;
        const cap = d.pelt.capacity;
        const ourUtil = task.util_sum / maxv;
        const kern = task.util_avg;
        const matchPct = kern > 0
            ? Math.max(0, 100 - Math.abs(ourUtil - kern) / kern * 100)
            : (ourUtil < 1 ? 100 : 0);

        ctx.font = '10px "Share Tech Mono", monospace';
        const tag = task.pid === this.schedSelectedPid ? '[selected]' : '[top]';
        const lines = [
            [`task            ${task.pid} ${task.comm}  ${tag}`, 'rgba(210,235,255,0.95)'],
            [`util_sum (Σ)    = ${task.util_sum.toLocaleString()}`, 'rgba(150,194,225,0.9)'],
            [`LOAD_AVG_MAX    = ${maxv}`, 'rgba(150,194,225,0.9)'],
            [`our util_avg    = util_sum / LOAD_AVG_MAX ≈ ${ourUtil.toFixed(1)}`, 'rgba(150,225,255,0.95)'],
            [`kernel util_avg = ${kern}`, 'rgba(150,255,190,0.95)'],
            [`match           = ${matchPct.toFixed(1)}%`, matchPct > 92 ? 'rgba(150,255,190,0.98)' : 'rgba(255,205,120,0.95)']
        ];
        let ly = y + 40;
        lines.forEach(([txt, col]) => {
            ctx.fillStyle = col;
            ctx.fillText(txt, x + 16, ly);
            ly += 16;
        });

        // Two comparison bars (our vs kernel), 0..cap.
        const barX = x + 16;
        const barW = w - 32;
        const drawBar = (by, val, col, label) => {
            ctx.fillStyle = 'rgba(60,80,110,0.5)';
            ctx.fillRect(barX, by, barW, 9);
            ctx.fillStyle = col;
            ctx.fillRect(barX, by, Math.min(1, val / cap) * barW, 9);
            ctx.fillStyle = 'rgba(196,207,224,0.8)';
            ctx.font = '8px "Share Tech Mono", monospace';
            ctx.fillText(label, barX, by - 2);
        };
        if (ly + 40 < y + h) {
            drawBar(ly + 6, ourUtil, 'rgba(120,200,255,0.9)', 'our util_avg (from util_sum)');
            drawBar(ly + 30, kern, 'rgba(150,255,190,0.9)', 'kernel util_avg');
            ctx.fillStyle = 'rgba(150,194,225,0.62)';
            ctx.font = '8px "Share Tech Mono", monospace';
            ctx.fillText('the few-% gap = the current partial 1 ms period in the kernel divider', barX, ly + 52);
        }
    }

    drawSchedTasks(x, y, w, h, d) {
        const ctx = this.ctx;
        this.drawPanel(x, y, w, h, 'RUNQUEUE · TOP TASKS BY PELT util  ·  click a task to inspect', { alpha: 0.82 });
        const tasks = Array.isArray(d.tasks) ? d.tasks : [];
        const cap = d.pelt.capacity;

        // Column header.
        ctx.font = '8px "Share Tech Mono", monospace';
        ctx.fillStyle = 'rgba(150,194,225,0.7)';
        const colGaugeX = x + w * 0.40;
        const colGaugeW = w * 0.24;
        const colSparkX = x + w * 0.68;
        const colSparkW = w * 0.16;
        ctx.fillText('pid · comm', x + 16, y + 34);
        ctx.fillText('util / load (0..1024)', colGaugeX, y + 34);
        ctx.fillText('util history', colSparkX, y + 34);
        ctx.fillText('vrt · nice · sw', x + w * 0.86, y + 34);

        const rowsY = y + 42;
        const footH = 30;
        const rowH = Math.max(20, Math.min(34, (h - (rowsY - y) - footH) / Math.max(1, tasks.length)));
        tasks.forEach((t, i) => {
            const ry = rowsY + i * rowH;
            const selected = t.pid === this.schedSelectedPid;
            const hover = t.pid === this.schedHoverPid;
            if (selected || hover) {
                ctx.fillStyle = selected ? 'rgba(40,70,110,0.5)' : 'rgba(30,50,80,0.32)';
                ctx.fillRect(x + 8, ry - 2, w - 16, rowH - 2);
            }
            this.schedRectHits.push({ x: x + 8, y: ry - 2, w: w - 16, h: rowH - 2, pid: t.pid });

            // pid + comm (▶ marks a currently runnable task).
            ctx.font = '10px "Share Tech Mono", monospace';
            ctx.fillStyle = t.runnable ? 'rgba(150,255,190,0.98)' : 'rgba(206,232,255,0.92)';
            const label = `${t.runnable ? '▶ ' : '   '}${t.pid} ${t.comm}`;
            ctx.fillText(label.slice(0, 24), x + 14, ry + 12);

            // util gauge (thick) + load gauge (thin) sharing the column.
            ctx.fillStyle = 'rgba(60,80,110,0.45)';
            ctx.fillRect(colGaugeX, ry + 2, colGaugeW, 8);
            ctx.fillStyle = this.schedUtilColor(t.util_avg / cap);
            ctx.fillRect(colGaugeX, ry + 2, Math.min(1, t.util_avg / cap) * colGaugeW, 8);
            ctx.fillStyle = 'rgba(150,180,255,0.7)';
            ctx.fillRect(colGaugeX, ry + 12, Math.min(1, t.load_avg / cap) * colGaugeW, 3);

            // util sparkline.
            const hist = this.schedHistory.get(t.pid) || [];
            if (hist.length > 1) {
                ctx.strokeStyle = 'rgba(140,215,255,0.85)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                hist.forEach((pt, k) => {
                    const px = colSparkX + (k / (this.schedHistoryMax - 1)) * colSparkW;
                    const py = ry + 12 - Math.min(1, pt.util / cap) * 12;
                    if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
                });
                ctx.stroke();
            }

            // right meta: util, nice, virtual-deadline offset (= virtual slice).
            ctx.font = '8px "Share Tech Mono", monospace';
            ctx.fillStyle = 'rgba(180,200,224,0.85)';
            let meta = `u${Math.round(t.util_avg)} n${t.nice} vd+${(t.vslice_ms || 0).toFixed(3)}ms`;
            ctx.fillText(meta, x + w * 0.86, ry + 8);
            if (t.eligible !== undefined && t.runnable) {
                ctx.fillStyle = t.eligible ? 'rgba(150,255,190,0.9)' : 'rgba(255,180,120,0.9)';
                ctx.fillText(`${t.eligible ? 'E' : 'N'} lag ${Number(t.vlag_ms || 0).toFixed(2)}`, x + w * 0.86, ry + 18);
            }
        });

        // EEVDF explainer footer.
        ctx.font = '8px "Share Tech Mono", monospace';
        ctx.fillStyle = 'rgba(150,194,225,0.66)';
        ctx.fillText(
            '▶ = runnable (state R). EEVDF runs the eligible task with the smallest virtual deadline; vruntime advances slower for higher-weight (lower nice) tasks.',
            x + 16, y + h - 12
        );
    }

    drawSchedOverlay(d) {
        const ctx = this.ctx;
        const W = window.innerWidth;
        const H = window.innerHeight;
        const task = (d.tasks || []).find((t) => t.pid === this.schedOverlayPid);
        if (!task) { this.schedOverlayPid = null; return; }

        ctx.fillStyle = 'rgba(4,8,14,0.82)';
        ctx.fillRect(0, 0, W, H);

        const pad = Math.min(64, W * 0.05);
        const px = pad;
        const py = 80;
        const pw = W - pad * 2;
        const ph = H - py - 40;
        this._schedOverlayPanel = { x: px, y: py, w: pw, h: ph };
        this.drawPanel(px, py, pw, ph, '', { alpha: 0.97, showTitle: false });

        ctx.fillStyle = 'rgba(215,238,255,0.98)';
        ctx.font = '15px "Share Tech Mono", monospace';
        ctx.fillText(`TASK ${task.pid} · ${task.comm}  —  EEVDF + PELT`, px + 22, py + 28);
        ctx.font = '9px "Share Tech Mono", monospace';
        ctx.fillStyle = 'rgba(150,194,225,0.82)';
        ctx.fillText(
            `nice ${task.nice} · weight ${task.weight} · slice ${task.slice_ms}ms · state ${task.state}${task.runnable ? ' (runnable)' : ''}`,
            px + 22, py + 46
        );

        // Close button.
        const cb = { kind: 'close', x: px + pw - 36, y: py + 14, w: 24, h: 24 };
        ctx.strokeStyle = 'rgba(200,220,245,0.75)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(cb.x + 6, cb.y + 6); ctx.lineTo(cb.x + 18, cb.y + 18);
        ctx.moveTo(cb.x + 18, cb.y + 6); ctx.lineTo(cb.x + 6, cb.y + 18);
        ctx.stroke();
        this.schedOverlayHits = [cb];

        const colY = py + 64;
        const colH = ph - 84;
        const colGap = 16;
        const colW = (pw - 44 - colGap * 2) / 3;
        const c1 = px + 22;
        const c2 = c1 + colW + colGap;
        const c3 = c2 + colW + colGap;
        this.drawOvPeltTrajectory(c1, colY, colW, colH, d, task);
        this.drawOvEevdf(c2, colY, colW, colH, d, task);
        this.drawOvReducer(c3, colY, colW, colH, d, task);

        ctx.fillStyle = 'rgba(150,194,225,0.58)';
        ctx.font = '8px "Share Tech Mono", monospace';
        ctx.fillText('click outside · × to close', px + 22, py + ph - 12);
    }

    drawOvPeltTrajectory(x, y, w, h, d, task) {
        const ctx = this.ctx;
        this.drawPanel(x, y, w, h, 'PELT TRAJECTORY', { alpha: 0.9 });
        ctx.fillStyle = 'rgba(150,194,225,0.8)';
        ctx.font = '8px "Share Tech Mono", monospace';
        ctx.fillText('util (cyan) & load (blue) history · kernel 1 ms-period EWMA, sampled ~1.5 s', x + 12, y + 30);

        const cap = d.pelt.capacity;
        const hist = this.schedHistory.get(task.pid) || [];
        const plotX = x + 16;
        const plotY = y + 42;
        const plotW = w - 40;
        const plotH = 150;

        // Grid + capacity reference lines (¼, ½, ¾, full CPU).
        ctx.strokeStyle = 'rgba(120,160,210,0.14)';
        ctx.lineWidth = 1;
        [0, 0.25, 0.5, 0.75, 1].forEach((f) => {
            const gy = plotY + plotH - f * plotH;
            ctx.beginPath();
            ctx.moveTo(plotX, gy);
            ctx.lineTo(plotX + plotW, gy);
            ctx.stroke();
            ctx.fillStyle = 'rgba(140,175,215,0.55)';
            ctx.fillText(`${Math.round(f * cap)}`, plotX + plotW + 3, gy + 3);
        });

        const drawSeries = (key, color, fill) => {
            if (hist.length < 2) return;
            ctx.beginPath();
            hist.forEach((pt, k) => {
                const sx = plotX + (k / (this.schedHistoryMax - 1)) * plotW;
                const sy = plotY + plotH - Math.min(1, (pt[key] || 0) / cap) * plotH;
                if (k === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
            });
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.stroke();
            if (fill) {
                const lastX = plotX + ((hist.length - 1) / (this.schedHistoryMax - 1)) * plotW;
                ctx.lineTo(lastX, plotY + plotH);
                ctx.lineTo(plotX, plotY + plotH);
                ctx.closePath();
                ctx.fillStyle = fill;
                ctx.fill();
            }
        };
        drawSeries('load', 'rgba(140,170,255,0.85)', null);
        drawSeries('util', 'rgba(140,225,255,0.95)', 'rgba(120,220,255,0.10)');

        // Estimated-util clamp band (util_est is the boosted running estimate).
        const estY = plotY + plotH - Math.min(1, (task.util_est || 0) / cap) * plotH;
        ctx.strokeStyle = 'rgba(255,205,120,0.6)';
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(plotX, estY);
        ctx.lineTo(plotX + plotW, estY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,205,120,0.85)';
        ctx.fillText('util_est', plotX + 2, estY - 3);

        ctx.fillStyle = 'rgba(150,194,225,0.6)';
        ctx.fillText('now', plotX + plotW - 18, plotY + plotH + 12);

        // --- PELT decay / recovery projection (real y, millisecond scale) ---
        this.drawOvPeltProjection(x, plotY + plotH + 26, w, 180, d, task, cap);

        // Current values.
        let ny = plotY + plotH + 26 + 180 + 20;
        const rows = [
            [`util_avg      ${task.util_avg}`, 'rgba(140,225,255,0.95)'],
            [`load_avg      ${task.load_avg}`, 'rgba(140,170,255,0.9)'],
            [`runnable_avg  ${task.runnable_avg}`, 'rgba(150,210,235,0.9)'],
            [`util_est      ${task.util_est}`, 'rgba(255,205,120,0.9)'],
            [`sum_exec      ${task.sum_exec_ms} ms`, 'rgba(180,200,224,0.85)']
        ];
        ctx.font = '9px "Share Tech Mono", monospace';
        rows.forEach(([txt, col]) => {
            ctx.fillStyle = col;
            ctx.fillText(txt, x + 14, ny);
            ny += 15;
        });
    }

    drawOvPeltProjection(x, y, w, h, d, task, cap) {
        const ctx = this.ctx;
        const y0 = d.pelt.y;               // real per-1ms-period decay factor
        const halfLife = d.pelt.half_life_ms;
        const cur = task.util_avg;
        const spanMs = Math.max(96, halfLife * 3);   // ~3 half-lives

        ctx.fillStyle = 'rgba(150,194,225,0.8)';
        ctx.font = '8px "Share Tech Mono", monospace';
        ctx.fillText(`PROJECTION · observed past → now → decay(idle)/recover(busy)  (y=${y0})`, x + 12, y);

        const plotX = x + 16;
        const plotY = y + 10;
        const plotW = w - 40;
        const plotH = h - 40;

        // "now" splits the panel: left = real observed samples (coarse, ~1.5s),
        // right = the millisecond-scale projection. Both share the util y-axis
        // and meet at the current util value, so the real trajectory flows
        // straight into the two hypothetical futures.
        const nowFrac = 0.42;
        const nowX = plotX + plotW * nowFrac;
        const projW = plotW * (1 - nowFrac);

        ctx.strokeStyle = 'rgba(120,160,210,0.14)';
        ctx.lineWidth = 1;
        [0, 0.5, 1].forEach((f) => {
            const gy = plotY + plotH - f * plotH;
            ctx.beginPath();
            ctx.moveTo(plotX, gy);
            ctx.lineTo(plotX + plotW, gy);
            ctx.stroke();
        });

        const mapY = (u) => plotY + plotH - Math.min(1, u / cap) * plotH;
        const mapXp = (tms) => nowX + (tms / spanMs) * projW;   // future (ms)

        // --- Observed past: real util samples flowing into "now". ---
        const hist = this.schedHistory.get(task.pid) || [];
        const M = Math.min(hist.length, 28);
        if (M >= 2) {
            const recent = hist.slice(-M);
            const leftW = nowX - plotX;
            ctx.strokeStyle = 'rgba(200,225,250,0.9)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            recent.forEach((pt, k) => {
                const sx = plotX + (k / (M - 1)) * leftW;
                const sy = mapY(pt.util || 0);
                if (k === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
            });
            ctx.stroke();
            // Sample dots.
            ctx.fillStyle = 'rgba(200,225,250,0.65)';
            recent.forEach((pt, k) => {
                const sx = plotX + (k / (M - 1)) * leftW;
                ctx.beginPath();
                ctx.arc(sx, mapY(pt.util || 0), 1.6, 0, Math.PI * 2);
                ctx.fill();
            });
        }

        // --- Future decay: u(t) = cur * y^t (task goes idle now). ---
        ctx.strokeStyle = 'rgba(140,225,255,0.95)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (let tms = 0; tms <= spanMs; tms += 1) {
            const u = cur * Math.pow(y0, tms);
            if (tms === 0) ctx.moveTo(mapXp(tms), mapY(u)); else ctx.lineTo(mapXp(tms), mapY(u));
        }
        ctx.stroke();

        // --- Future recovery: u(t) = cap - (cap - cur) * y^t (runs full-tilt). ---
        ctx.strokeStyle = 'rgba(150,255,190,0.9)';
        ctx.beginPath();
        for (let tms = 0; tms <= spanMs; tms += 1) {
            const u = cap - (cap - cur) * Math.pow(y0, tms);
            if (tms === 0) ctx.moveTo(mapXp(tms), mapY(u)); else ctx.lineTo(mapXp(tms), mapY(u));
        }
        ctx.stroke();

        // Half-life markers (right/future region).
        ctx.strokeStyle = 'rgba(255,180,120,0.7)';
        ctx.setLineDash([3, 3]);
        [1, 2, 3].forEach((k) => {
            const hx = mapXp(halfLife * k);
            if (hx > plotX + plotW) return;
            ctx.beginPath();
            ctx.moveTo(hx, plotY);
            ctx.lineTo(hx, plotY + plotH);
            ctx.stroke();
            ctx.fillStyle = 'rgba(255,195,150,0.8)';
            ctx.fillText(`${halfLife * k}ms`, hx + 2, plotY + plotH + 11);
        });
        ctx.setLineDash([]);

        // "now" divider.
        ctx.strokeStyle = 'rgba(215,238,255,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(nowX, plotY - 2);
        ctx.lineTo(nowX, plotY + plotH + 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(215,238,255,0.85)';
        ctx.fillText('now', nowX - 8, plotY - 4);

        // Animated marker sweeping along the decay curve.
        const t = (Date.now() - this._schedT0) / 1000;
        const sweepMs = (t * 24) % spanMs;   // ~24 ms/s sweep
        ctx.fillStyle = 'rgba(150,225,255,0.98)';
        ctx.beginPath();
        ctx.arc(mapXp(sweepMs), mapY(cur * Math.pow(y0, sweepMs)), 3.5, 0, Math.PI * 2);
        ctx.fill();

        // "now" point at current util.
        ctx.fillStyle = 'rgba(215,238,255,0.95)';
        ctx.beginPath();
        ctx.arc(nowX, mapY(cur), 3, 0, Math.PI * 2);
        ctx.fill();

        // Axis captions + legend.
        ctx.font = '8px "Share Tech Mono", monospace';
        ctx.fillStyle = 'rgba(150,194,225,0.6)';
        ctx.fillText('observed (~1.5s/sample)', plotX, plotY + plotH + 24);
        ctx.fillStyle = 'rgba(140,225,255,0.9)';
        ctx.fillText('— decay(idle)', plotX + plotW - 150, plotY + 10);
        ctx.fillStyle = 'rgba(150,255,190,0.9)';
        ctx.fillText('— recover(busy)', plotX + plotW - 150, plotY + 22);
    }

    drawOvEevdf(x, y, w, h, d, task) {
        const ctx = this.ctx;
        this.drawPanel(x, y, w, h, 'EEVDF · VIRTUAL DEADLINE & LAG', { alpha: 0.9 });
        const kernel = d.eevdf?.source === 'kernel' && task.eligible !== undefined;

        const v = task.vruntime;
        const vd = task.deadline_v;         // v + virtual slice (computed)
        const V = kernel ? task.avg_vruntime : null;
        // Only fold V into the axis window when it is close enough to v to be
        // meaningful (i.e. the task is actually competing). For long-sleeping
        // tasks V is far away and would collapse v/vd to a single pixel — we
        // then draw V as an off-axis arrow instead.
        const vNear = (V !== null && V !== undefined)
            && Math.abs(V - v) <= Math.max(50, task.vslice_ms * 40);
        const vals = [v, vd];
        if (vNear) vals.push(V);
        let lo = Math.min(...vals);
        let hi = Math.max(...vals);
        const span = Math.max(hi - lo, task.vslice_ms * 1.5, 0.02);
        lo -= span * 0.25;
        hi += span * 0.35;
        const axX = x + 18;
        const axW = w - 36;
        const axY = y + 74;
        const mapX = (val) => axX + ((val - lo) / (hi - lo)) * axW;

        // Axis.
        ctx.strokeStyle = 'rgba(150,180,220,0.5)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(axX, axY);
        ctx.lineTo(axX + axW, axY);
        ctx.stroke();
        ctx.fillStyle = 'rgba(150,194,225,0.7)';
        ctx.font = '8px "Share Tech Mono", monospace';
        ctx.fillText('virtual time (ms) →', axX, axY + 26);

        const marker = (val, color, label, up) => {
            const mx = mapX(val);
            const y1 = up ? axY - 30 : axY + 4;
            const y2 = up ? axY : axY + 14;
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(mx, y1);
            ctx.lineTo(mx, y2);
            ctx.stroke();
            ctx.fillStyle = color;
            ctx.fillText(label, mx - 6, up ? y1 - 3 : y2 + 10);
        };

        // Virtual slice bracket v -> vd.
        ctx.fillStyle = 'rgba(120,220,255,0.14)';
        ctx.fillRect(mapX(v), axY - 8, mapX(vd) - mapX(v), 16);
        marker(v, 'rgba(140,225,255,0.95)', 'v', true);
        marker(vd, 'rgba(150,255,190,0.95)', 'vd', false);
        if (vNear) {
            marker(V, 'rgba(255,205,120,0.95)', 'V', true);
        } else if (V !== null && V !== undefined) {
            // V is off-window: draw an arrow at the edge toward it.
            const rightward = V > v;
            const ex = rightward ? axX + axW - 2 : axX + 2;
            ctx.fillStyle = 'rgba(255,205,120,0.9)';
            ctx.font = '9px "Share Tech Mono", monospace';
            ctx.fillText(rightward ? 'V →' : '← V', rightward ? ex - 22 : ex, axY - 20);
        }

        ctx.font = '9px "Share Tech Mono", monospace';
        let ny = axY + 52;
        const line = (txt, col) => { ctx.fillStyle = col; ctx.fillText(txt, x + 14, ny); ny += 15; };
        line(`vruntime v   = ${v.toFixed(3)} ms`, 'rgba(140,225,255,0.95)');
        line(`virtual slice = slice·1024/w = ${task.vslice_ms.toFixed(4)} ms`, 'rgba(180,200,224,0.88)');
        line(`deadline  vd = v + vslice = ${vd.toFixed(3)} ms`, 'rgba(150,255,190,0.95)');
        if (kernel) {
            const elig = task.eligible;
            line(`avg_vruntime V = ${Number(V).toFixed(3)} ms`, 'rgba(255,205,120,0.95)');
            line(`lag = V - v   = ${Number(task.vlag_ms).toFixed(3)} ms`, 'rgba(210,225,245,0.9)');
            ny += 4;
            ctx.fillStyle = elig ? 'rgba(150,255,190,0.98)' : 'rgba(255,180,120,0.98)';
            ctx.font = '11px "Share Tech Mono", monospace';
            ctx.fillText(elig ? '● ELIGIBLE  (lag ≥ 0, v ≤ V)' : '○ NOT ELIGIBLE  (lag < 0)', x + 14, ny);
            ny += 18;
            if (!task.runnable) {
                ctx.fillStyle = 'rgba(150,194,225,0.6)';
                ctx.font = '8px "Share Tech Mono", monospace';
                ctx.fillText('(sleeping — lag/eligibility apply while runnable)', x + 14, ny);
                ny += 14;
            }
        } else {
            ny += 4;
            ctx.fillStyle = 'rgba(255,205,120,0.9)';
            ctx.font = '8px "Share Tech Mono", monospace';
            ctx.fillText('lag & eligibility need cfs_rq avg_vruntime (V),', x + 14, ny); ny += 12;
            ctx.fillText('which lives in root-only sched_debug.', x + 14, ny); ny += 12;
            ctx.fillText('→ enable the sched_debug collector for kernel-exact V.', x + 14, ny); ny += 16;
        }

        ctx.fillStyle = 'rgba(150,194,225,0.62)';
        ctx.font = '8px "Share Tech Mono", monospace';
        this._wrapText(
            'EEVDF runs the eligible task (lag ≥ 0) with the earliest virtual deadline. Bigger weight ⇒ smaller virtual slice ⇒ earlier deadline ⇒ scheduled sooner.',
            x + 14, ny + 4, w - 28, 11
        );
    }

    drawOvReducer(x, y, w, h, d, task) {
        const ctx = this.ctx;
        this.drawPanel(x, y, w, h, 'nice → weight → vruntime SPEED', { alpha: 0.9 });
        const weight = task.weight || 1024;
        const rate = 1024 / weight;   // virtual ms accrued per real ms of CPU
        const cx = x + 16;
        let ny = y + 36;

        ctx.font = '9px "Share Tech Mono", monospace';
        const stage = (label, val, col) => {
            ctx.fillStyle = 'rgba(150,194,225,0.7)';
            ctx.fillText(label, cx, ny);
            ctx.fillStyle = col;
            ctx.fillText(val, cx + 92, ny);
            ny += 14;
        };
        stage('nice', `${task.nice}`, 'rgba(215,238,255,0.95)');
        stage('→ weight', `${weight}`, 'rgba(140,225,255,0.95)');
        stage('→ vruntime ×', `${rate.toFixed(4)} /ns`, 'rgba(150,255,190,0.95)');
        ny += 6;

        // Two vruntime tracks: nice-0 reference vs this task, animated.
        const t = (Date.now() - this._schedT0) / 1000;
        const trackX = cx;
        const trackW = w - 32;
        const baseSpeed = 0.18; // fraction of track per second for the reference
        const drawTrack = (ty, speed, color, label) => {
            ctx.strokeStyle = 'rgba(120,160,210,0.25)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(trackX, ty);
            ctx.lineTo(trackX + trackW, ty);
            ctx.stroke();
            const pos = ((t * speed) % 1) * trackW;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(trackX + pos, ty, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(180,200,224,0.82)';
            ctx.font = '8px "Share Tech Mono", monospace';
            ctx.fillText(label, trackX, ty - 7);
        };
        drawTrack(ny + 14, baseSpeed, 'rgba(160,180,210,0.85)', 'nice 0 (weight 1024) — reference vruntime');
        drawTrack(ny + 44, baseSpeed * rate, 'rgba(150,255,190,0.95)', `nice ${task.nice} (weight ${weight}) — this task`);
        ny += 64;

        // Comparison bar: how fast this task's vruntime moves vs nice-0.
        ny += 8;
        const barX = cx;
        const barW = w - 32;
        const norm = Math.max(0, Math.min(1, Math.log2(rate * 16 + 1) / Math.log2(16 * 68 + 1)));
        ctx.fillStyle = 'rgba(60,80,110,0.5)';
        ctx.fillRect(barX, ny, barW, 9);
        ctx.fillStyle = rate < 1 ? 'rgba(140,225,255,0.9)' : 'rgba(255,180,120,0.9)';
        ctx.fillRect(barX, ny, norm * barW, 9);
        ny += 22;

        ctx.fillStyle = 'rgba(150,194,225,0.72)';
        ctx.font = '8px "Share Tech Mono", monospace';
        const verdict = rate < 1
            ? `vruntime advances ${(1 / rate).toFixed(1)}× SLOWER than nice 0 ⇒ the scheduler lets it run MORE.`
            : (rate > 1
                ? `vruntime advances ${rate.toFixed(1)}× FASTER than nice 0 ⇒ it yields the CPU sooner.`
                : 'baseline: vruntime advances 1:1 with real time.');
        this._wrapText(verdict, cx, ny, w - 28, 11);
        ny += 34;
        this._wrapText(
            'PELT feeds util_avg; EEVDF uses weight to scale real time into virtual time. Same geometric-decay math family as the Kernel DNA z-score.',
            cx, ny, w - 28, 11
        );
    }

    _wrapText(text, x, y, maxW, lineH) {
        const ctx = this.ctx;
        const words = String(text).split(' ');
        let line = '';
        let cy = y;
        words.forEach((word) => {
            const test = line ? `${line} ${word}` : word;
            if (ctx.measureText(test).width > maxW && line) {
                ctx.fillText(line, x, cy);
                line = word;
                cy += lineH;
            } else {
                line = test;
            }
        });
        if (line) ctx.fillText(line, x, cy);
        return cy;
    }

    drawScene() {
        if (!this.ctx || !this.canvas) return;
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.ctx.clearRect(0, 0, w, h);
        this.tick += 1;

        const gap = 16;
        const top = 58;
        const statsH = this.layoutMode === 'microscope' ? 74 : 98;
        const graphY = top + statsH + gap;
        const graphH = Math.max(260, h - graphY - 36);

        const bg = this.ctx.createRadialGradient(w * 0.5, h * 0.38, 0, w * 0.5, h * 0.38, Math.max(w, h) * 0.78);
        bg.addColorStop(0, '#0e1722');
        bg.addColorStop(0.55, '#060b13');
        bg.addColorStop(1, '#02050b');
        this.ctx.fillStyle = bg;
        this.ctx.fillRect(0, 0, w, h);

        // Global subtle matrix grid.
        this.ctx.strokeStyle = 'rgba(120, 188, 235, 0.08)';
        this.ctx.lineWidth = 1;
        for (let gx = 0; gx < w; gx += 36) {
            this.ctx.beginPath();
            this.ctx.moveTo(gx + 0.5, 0);
            this.ctx.lineTo(gx + 0.5, h);
            this.ctx.stroke();
        }
        for (let gy = 0; gy < h; gy += 36) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, gy + 0.5);
            this.ctx.lineTo(w, gy + 0.5);
            this.ctx.stroke();
        }

        if (this.layoutMode === 'scheduler') {
            this.drawKernelHeader();
            this.drawSchedulerView(gap, top, w - gap * 2, h - top - 30);
            return;
        }

        this.drawHudChrome(gap, graphY, w - gap * 2, graphH);

        this.drawKernelHeader();
        if (this.layoutMode === 'microscope') {
            this.drawPanel(gap, top, w - gap * 2, statsH, '', { alpha: 0.68, showTitle: false });
            this.ctx.fillStyle = 'rgba(206, 232, 255, 0.92)';
            this.ctx.font = '10px "Share Tech Mono", monospace';
            const graph = this.telemetry?.neural_graph || {};
            const n = Array.isArray(graph.nodes) ? graph.nodes.length : 0;
            const e = Array.isArray(graph.edges) ? graph.edges.length : 0;
            const seccompPct = Number(this.telemetry?.meta?.seccomp_filter_percent || 0).toFixed(1);
            this.ctx.fillText(`scan: tasks ${n} · relations ${e} · seccomp ${seccompPct}%`, gap + 14, top + 24);
            this.ctx.fillStyle = 'rgba(150, 194, 225, 0.82)';
            this.ctx.font = '9px "Share Tech Mono", monospace';
            this.ctx.fillText(`mode ${String(this.layoutMode).toUpperCase()} · edge ${String(this.edgeFilter).toUpperCase()} · ${this.autoFocusEnabled ? 'AUTO' : 'MANUAL'} FOCUS`, gap + 14, top + 44);
        } else {
            this.drawTopStats(gap, top, w - gap * 2, statsH);
        }
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
