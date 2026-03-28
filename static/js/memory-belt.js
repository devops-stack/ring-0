// Linux memory subsystem — strip map (same API payload as processes-realtime memory_visual)
// Version: 1

debugLog('💾 memory-belt.js v1: Script loading...');

class MemorySubsystemVisualization {
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
        this.memoryHoverStrip = null;
        this.memoryStripHits = [];
        this.memoryMapHit = null;
        this.memoryHoverCell = null;
        this.mouseMoveHandler = null;
    }

    init(containerId = 'memory-belt-container') {
        this.container = document.createElement('div');
        this.container.id = containerId;
        this.container.style.cssText = `
            position: fixed;
            inset: 0;
            width: 100%;
            height: 100%;
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
        return true;
    }

    onMouseMove(event) {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        this.memoryHoverStrip = null;
        this.memoryHoverCell = null;
        if (this.memoryStripHits.length) {
            for (const hit of this.memoryStripHits) {
                if (x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h) {
                    this.memoryHoverStrip = hit;
                    this.canvas.style.cursor = 'crosshair';
                    return;
                }
            }
        }
        this.canvas.style.cursor = 'default';
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
                    memory_visual: {
                        layout: 'strips',
                        rows: [],
                        summary: {
                            total_mb: 0,
                            used_percent: 0,
                            available_mb: 0,
                            swap_percent: 0,
                            source: 'fallback'
                        }
                    }
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

    drawKernelHeader() {
        const w = window.innerWidth;
        this.ctx.textAlign = 'center';
        this.ctx.fillStyle = 'rgba(232, 240, 252, 0.92)';
        this.ctx.font = '12px "Share Tech Mono", monospace';
        this.ctx.fillText('linux kernel · memory management subsystem', w * 0.5, 26);
        this.ctx.textAlign = 'start';
    }

    drawMemoryStats(x, y, w, h) {
        const sum = this.telemetry?.memory_visual?.summary || {};
        this.drawPanel(x, y, w, h, 'physical memory · /proc/meminfo + psutil', { alpha: 0.88 });
        this.ctx.fillStyle = '#c4f8ff';
        this.ctx.font = '11px "Share Tech Mono", monospace';
        this.ctx.fillText(`total ${Number(sum.total_mb || 0).toFixed(0)} MiB`, x + 16, y + 46);
        this.ctx.fillText(`used ${Number(sum.used_percent || 0).toFixed(1)}%`, x + 138, y + 46);
        this.ctx.fillText(`avail ${Number(sum.available_mb || 0).toFixed(0)} MiB`, x + 238, y + 46);
        this.ctx.fillText(`swap ${Number(sum.swap_percent || 0).toFixed(1)}%`, x + 388, y + 46);
        this.ctx.fillText(`buf ${Number(sum.buffers_mb ?? 0).toFixed(0)} · cache ${Number(sum.cached_mb ?? 0).toFixed(0)} · anon ${Number(sum.anon_mb ?? 0).toFixed(0)} MiB`, x + 16, y + 64);
        this.ctx.fillStyle = 'rgba(0, 229, 255, 0.55)';
        this.ctx.font = '9px "Share Tech Mono", monospace';
        this.ctx.fillText('strips ≈ meminfo buckets; task row = RSS share of sampled PIDs; not a physical PFN map', x + 16, y + 80);
    }

    tronHeatColor(t) {
        const u = Math.max(0, Math.min(1, t));
        if (u < 0.42) {
            const v = u / 0.42;
            return `rgba(0, ${Math.floor(140 + 70 * v)}, ${Math.floor(160 + 95 * v)}, ${0.1 + v * 0.28})`;
        }
        const v = (u - 0.42) / 0.58;
        return `rgba(${Math.floor(120 + 135 * v)}, ${Math.floor(255 - 20 * v)}, ${Math.floor(200 + 55 * v)}, ${0.32 + v * 0.48})`;
    }

    tronHeatColorKind(kind, t) {
        const u = Math.max(0, Math.min(1, t));
        const k = String(kind || 'anon');
        if (k === 'cached' || k === 'buffers' || k === 'mapped') {
            return `rgba(${Math.floor(0 + 30 * u)}, ${Math.floor(165 + 90 * u)}, ${Math.floor(220)}, ${0.14 + u * 0.38})`;
        }
        if (k === 'slab' || k === 'kmeta') {
            return `rgba(${Math.floor(80 + 60 * u)}, ${Math.floor(100 + 80 * u)}, ${Math.floor(240)}, ${0.16 + u * 0.42})`;
        }
        if (k === 'swap') {
            return `rgba(${Math.floor(200 + 55 * u)}, ${Math.floor(80 + 40 * u)}, ${Math.floor(120 + 40 * u)}, ${0.22 + u * 0.45})`;
        }
        if (k === 'task') {
            return this.tronHeatColor(u);
        }
        return this.tronHeatColor(u);
    }

    drawMemorySidebarTron(sx, sy, sh, bars, label) {
        this.ctx.fillStyle = 'rgba(0, 20, 28, 0.75)';
        this.ctx.fillRect(sx, sy, 40, sh);
        this.ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(sx + 0.5, sy + 0.5, 39, sh - 1);
        this.ctx.fillStyle = 'rgba(0, 229, 255, 0.65)';
        this.ctx.font = '8px "Share Tech Mono", monospace';
        this.ctx.fillText(label, sx + 4, sy + 10);
        const n = Math.min(bars.length, 14);
        for (let i = 0; i < n; i++) {
            const bw = 4 + Math.floor(bars[i] * 28);
            const by = sy + 10 + i * Math.floor((sh - 20) / n);
            this.ctx.fillStyle = `rgba(0, 229, 255, ${0.15 + bars[i] * 0.5})`;
            this.ctx.fillRect(sx + 6, by, bw, 3);
            if (bars[i] > 0.55) {
                this.ctx.fillStyle = `rgba(255, 252, 220, ${0.35 + bars[i] * 0.45})`;
                this.ctx.fillRect(sx + 6, by, bw, 3);
            }
        }
    }

    drawMemoryView(x, y, w, h) {
        this.memoryMapHit = null;
        this.memoryStripHits = [];
        const mv = this.telemetry?.memory_visual;
        const stripRows = Array.isArray(mv?.rows) ? mv.rows : [];
        const titleH = 34;
        this.drawPanel(x, y, w, titleH, 'memory topology strip · kernel accounting (not PFN map)', { alpha: 0.9 });

        const side = 42;
        const bottomH = 42;
        const pad = 6;
        const labelCol = 108;
        const innerX = Math.floor(x + pad + side);
        const innerY = Math.floor(y + titleH + pad);
        const innerW = Math.floor(w - pad * 2 - side * 2);
        const innerH = Math.floor(h - titleH - bottomH - pad * 2);

        this.ctx.strokeStyle = 'rgba(0, 229, 255, 0.48)';
        this.ctx.lineWidth = 1;
        this.ctx.shadowColor = 'rgba(0, 229, 255, 0.35)';
        this.ctx.shadowBlur = 12;
        this.ctx.strokeRect(innerX + 0.5, innerY + 0.5, innerW - 1, innerH - 1);
        this.ctx.shadowBlur = 0;
        this.ctx.strokeStyle = 'rgba(0, 229, 255, 0.18)';
        this.ctx.strokeRect(innerX + 2.5, innerY + 2.5, innerW - 5, innerH - 5);

        if (stripRows.length === 0) {
            this.ctx.fillStyle = 'rgba(200, 230, 255, 0.7)';
            this.ctx.font = '11px "Share Tech Mono", monospace';
            this.ctx.fillText('no memory strip data — waiting for /api/processes-realtime', innerX + 12, innerY + 40);
            return;
        }

        const nrows = stripRows.length;
        const gapY = 3;
        const totalGap = gapY * Math.max(0, nrows - 1);
        const rowAreaH = Math.max(16, Math.floor((innerH - totalGap) / Math.max(1, nrows)));
        const stripX = innerX + labelCol + 4;
        const stripW = Math.max(40, innerW - labelCol - 8);

        const barL = stripRows.map((row) => {
            const bl = row.blocks || [];
            if (!bl.length) return 0.2;
            return bl.reduce((a, b) => a + Number(b.heat || 0), 0) / bl.length;
        });
        const barR = stripRows.map((row) => {
            const bl = row.blocks || [];
            if (!bl.length) return 0.2;
            return Math.max(...bl.map((b) => Number(b.heat || 0)));
        });
        this.drawMemorySidebarTron(Math.floor(x + pad), innerY, innerH, barL, 'SEG_A');
        this.drawMemorySidebarTron(Math.floor(x + w - pad - 38), innerY, innerH, barR, 'SEG_B');

        const gridDivs = 28;
        for (let g = 0; g <= gridDivs; g++) {
            const gx = stripX + (g / gridDivs) * stripW + 0.5;
            this.ctx.beginPath();
            this.ctx.moveTo(gx, innerY);
            this.ctx.lineTo(gx, innerY + innerH);
            this.ctx.strokeStyle = g % 4 === 0 ? 'rgba(0, 229, 255, 0.14)' : 'rgba(0, 229, 255, 0.06)';
            this.ctx.lineWidth = 1;
            this.ctx.stroke();
        }

        stripRows.forEach((row, ri) => {
            const ry = innerY + ri * (rowAreaH + gapY);
            const blocks = Array.isArray(row.blocks) ? row.blocks : [];
            this.ctx.fillStyle = 'rgba(0, 229, 255, 0.42)';
            this.ctx.font = '8px "Share Tech Mono", monospace';
            const pct = row.pct_of_ram != null ? `${Number(row.pct_of_ram).toFixed(1)}%` : '';
            this.ctx.fillText(String(row.label || row.id || '').slice(0, 22), innerX + 4, ry + rowAreaH * 0.62);
            this.ctx.fillStyle = 'rgba(0, 180, 200, 0.55)';
            this.ctx.font = '7px "Share Tech Mono", monospace';
            this.ctx.fillText(`${pct} · ${Number(row.kb || 0).toFixed(0)}k`, innerX + 4, ry + rowAreaH * 0.95);

            let cx = stripX;
            blocks.forEach((blk, bi) => {
                const bw = Number(blk.w || 0) * stripW;
                const t = Number(blk.heat || 0);
                const kind = blk.kind || row.id || 'anon';
                const px = Math.floor(cx);
                const nx = Math.floor(cx + bw);
                const pw = Math.max(1, nx - px);
                cx += bw;
                const ph = Math.max(4, Math.floor(rowAreaH) - 2);
                const py = Math.floor(ry + 1);
                this.ctx.fillStyle = this.tronHeatColorKind(kind, t);
                this.ctx.fillRect(px, py, pw, ph);
                if (t > 0.58) {
                    this.ctx.fillStyle = 'rgba(255, 255, 235, 0.28)';
                    this.ctx.fillRect(px, py, pw, ph);
                }
                const greeble = ((ri * 131 + bi) * 7919) % 997;
                if (pw > 10 && (greeble % 5 === 0)) {
                    this.ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
                    this.ctx.strokeRect(px + 1.5, py + 1.5, Math.min(pw - 3, 8), Math.min(ph - 3, 6));
                }
                if (pw > 22) {
                    const hx = (greeble * 0x1000).toString(16).slice(0, 4);
                    this.ctx.fillStyle = 'rgba(200, 255, 255, 0.35)';
                    this.ctx.font = '6px "Share Tech Mono", monospace';
                    this.ctx.fillText(`0x${hx}`, px + 2, py + ph - 2);
                }
                if (kind === 'task' && blk.pid && pw > 36) {
                    this.ctx.fillStyle = 'rgba(255, 255, 240, 0.5)';
                    this.ctx.font = '6px "Share Tech Mono", monospace';
                    this.ctx.fillText(`${blk.name || blk.pid}`.slice(0, 8), px + 2, py + 8);
                }
                this.memoryStripHits.push({
                    x: px,
                    y: py,
                    w: pw,
                    h: ph,
                    rowId: row.id,
                    kind,
                    blk,
                    label: row.label
                });
            });

            const ly = ry + rowAreaH + 0.5;
            this.ctx.beginPath();
            this.ctx.moveTo(stripX, ly);
            this.ctx.lineTo(innerX + innerW, ly);
            this.ctx.strokeStyle = 'rgba(0, 229, 255, 0.11)';
            this.ctx.stroke();
        });

        if (this.memoryHoverStrip) {
            const hit = this.memoryHoverStrip;
            this.ctx.strokeStyle = 'rgba(255, 248, 160, 0.9)';
            this.ctx.lineWidth = 1;
            this.ctx.strokeRect(hit.x + 0.5, hit.y + 0.5, hit.w - 1, hit.h - 1);
            let detail = `${hit.label || ''} · ${hit.kind}`;
            if (hit.blk && hit.blk.pid) detail += ` · pid ${hit.blk.pid}`;
            if (hit.blk && hit.blk.name) detail += ` ${hit.blk.name}`;
            this.ctx.fillStyle = 'rgba(255, 252, 220, 0.95)';
            this.ctx.font = '9px "Share Tech Mono", monospace';
            this.ctx.fillText(detail.slice(0, 72), stripX, innerY + innerH - 6);
        }

        this.ctx.fillStyle = 'rgba(0, 229, 255, 0.4)';
        this.ctx.font = '7px "Share Tech Mono", monospace';
        const base = innerY + innerH + 12;
        for (let k = 0; k < 8; k++) {
            const addr = 0xffff888000000000 + k * 0x2a00000;
            this.ctx.fillText(`0x${addr.toString(16).slice(0, 12)}`, x + pad + k * (Math.min(140, w / 8.2)), base);
        }
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

        this.ctx.fillStyle = '#020305';
        this.ctx.fillRect(0, 0, w, h);
        const gmem = this.ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.45, Math.max(w, h) * 0.65);
        gmem.addColorStop(0, 'rgba(0, 45, 55, 0.35)');
        gmem.addColorStop(0.5, 'rgba(0, 12, 18, 0.92)');
        gmem.addColorStop(1, '#010203');
        this.ctx.fillStyle = gmem;
        this.ctx.fillRect(0, 0, w, h);
        this.drawKernelHeader();
        this.drawMemoryStats(gap, top, w - gap * 2, statsH);
        this.drawMemoryView(gap, graphY, w - gap * 2, graphH);
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

window.MemorySubsystemVisualization = MemorySubsystemVisualization;
debugLog('💾 memory-belt.js: MemorySubsystemVisualization exported to window');
