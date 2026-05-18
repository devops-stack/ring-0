// Linux memory subsystem — strip map (same API payload as processes-realtime memory_visual)
// Version: 2 — deeper meminfo: slab split, dirty/writeback, THP, vmalloc, LRU

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
        this.memoryFabricHits = [];
        this.memorySelectedCell = null;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        this.mouseMoveHandler = null;
        this.clickHandler = null;
        this.viewMode = 'fabric';
        this.viewModeButton = null;
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

        const modeBtn = document.createElement('button');
        modeBtn.style.cssText = `
            position:absolute;top:18px;left:18px;padding:8px 12px;z-index:10021;
            background: rgba(7, 10, 16, 0.92); border:1px solid rgba(178,190,212,0.45);
            color:#d5dce8; font-family:'Share Tech Mono', monospace; font-size:11px; cursor:pointer;
            box-shadow: 0 0 14px rgba(150,175,220,0.18);
        `;
        modeBtn.onclick = () => this.toggleViewMode();
        this.container.appendChild(modeBtn);
        this.viewModeButton = modeBtn;
        this.updateViewModeButton();
        return true;
    }

    toggleViewMode() {
        this.viewMode = this.viewMode === 'fabric' ? 'strips' : 'fabric';
        this.updateViewModeButton();
    }

    updateViewModeButton() {
        if (!this.viewModeButton) return;
        const isFabric = this.viewMode === 'fabric';
        this.viewModeButton.textContent = isFabric ? 'VIEW: FABRIC' : 'VIEW: STRIPS';
        this.viewModeButton.style.background = isFabric ? 'rgba(22, 42, 62, 0.94)' : 'rgba(7, 10, 16, 0.92)';
        this.viewModeButton.style.borderColor = isFabric ? 'rgba(138, 198, 255, 0.92)' : 'rgba(178,190,212,0.45)';
        this.viewModeButton.style.color = isFabric ? '#e2f2ff' : '#d5dce8';
    }

    onMouseMove(event) {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        this.lastMouseX = x;
        this.lastMouseY = y;
        this.memoryHoverStrip = null;
        this.memoryHoverCell = null;
        if (this.memoryFabricHits.length) {
            for (const hit of this.memoryFabricHits) {
                if (x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h) {
                    this.memoryHoverCell = hit;
                    this.canvas.style.cursor = 'pointer';
                    return;
                }
            }
        }
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

    onCanvasClick(event) {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        if (this.memoryFabricHits.length) {
            for (const hit of this.memoryFabricHits) {
                if (x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h) {
                    const same = this.memorySelectedCell && Number(this.memorySelectedCell.pid || 0) === Number(hit.pid || 0);
                    this.memorySelectedCell = same ? null : hit;
                    return;
                }
            }
        }
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
                        },
                        process_pressure: [],
                        kernel_memory_workers: [],
                        kernel_memory_state: {
                            psi_memory: {
                                some_avg10: 0,
                                some_avg60: 0,
                                some_avg300: 0,
                                full_avg10: 0,
                                full_avg60: 0,
                                full_avg300: 0
                            },
                            vmstat: {},
                            psi_factor: 1
                        },
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
        const procPressure = Array.isArray(this.telemetry?.memory_visual?.process_pressure)
            ? this.telemetry.memory_visual.process_pressure
            : [];
        const psiMem = this.telemetry?.memory_visual?.kernel_memory_state?.psi_memory || {};
        this.drawPanel(x, y, w, h, 'physical memory · /proc/meminfo + psutil', { alpha: 0.88 });
        this.ctx.fillStyle = '#c4f8ff';
        this.ctx.font = '11px "Share Tech Mono", monospace';
        this.ctx.fillText(`total ${Number(sum.total_mb || 0).toFixed(0)} MiB`, x + 16, y + 46);
        this.ctx.fillText(`used ${Number(sum.used_percent || 0).toFixed(1)}%`, x + 138, y + 46);
        this.ctx.fillText(`avail ${Number(sum.available_mb || 0).toFixed(0)} MiB`, x + 238, y + 46);
        this.ctx.fillText(`swap ${Number(sum.swap_percent || 0).toFixed(1)}%`, x + 388, y + 46);
        this.ctx.fillText(`buf ${Number(sum.buffers_mb ?? 0).toFixed(0)} · cache ${Number(sum.cached_mb ?? 0).toFixed(0)} · anon ${Number(sum.anon_mb ?? 0).toFixed(0)} MiB`, x + 16, y + 64);
        const sr = Number(sum.sreclaimable_mb ?? 0);
        const su = Number(sum.sunreclaim_mb ?? 0);
        const slabLine = sr > 0 || su > 0
            ? `slab ${Number(sum.slab_mb ?? 0).toFixed(0)} MiB (recl ${sr.toFixed(0)} · unrecl ${su.toFixed(0)})`
            : `slab ${Number(sum.slab_mb ?? 0).toFixed(0)} MiB`;
        this.ctx.fillText(slabLine, x + 16, y + 80);
        const dw = Number(sum.dirty_writeback_mb ?? 0);
        const dirty = Number(sum.dirty_mb ?? 0);
        const wb = Number(sum.writeback_mb ?? 0);
        const line3 = [
            dw > 0 ? `dirty+wb ${dw.toFixed(2)} MiB (d ${dirty.toFixed(2)} · wb ${wb.toFixed(2)})` : null,
            Number(sum.anon_huge_mb ?? 0) > 0 ? `THP anon ${Number(sum.anon_huge_mb).toFixed(2)} MiB` : null,
            Number(sum.shmem_huge_mb ?? 0) > 0 ? `huge shmem ${Number(sum.shmem_huge_mb).toFixed(2)} MiB` : null,
            Number(sum.vmalloc_mb ?? 0) > 0 ? `vmalloc ${Number(sum.vmalloc_mb).toFixed(1)} MiB` : null,
            Number(sum.active_mb ?? 0) > 0 ? `LRU act ${Number(sum.active_mb).toFixed(0)}` : null,
            Number(sum.inactive_mb ?? 0) > 0 ? `inact ${Number(sum.inactive_mb).toFixed(0)} MiB` : null,
        ].filter(Boolean).join('  ·  ');
        if (line3) {
            this.ctx.fillText(line3.slice(0, 118), x + 16, y + 96);
        }
        const topProc = procPressure[0];
        if (topProc) {
            this.ctx.fillStyle = 'rgba(153, 215, 255, 0.84)';
            this.ctx.font = '9px "Share Tech Mono", monospace';
            this.ctx.fillText(
                `top pressure ${String(topProc.name || 'proc').slice(0, 16)}:${Number(topProc.pid || 0)} score ${Number(topProc.pressure_score || 0).toFixed(1)} rss ${Number(topProc.rss_mb || 0).toFixed(1)}MB`,
                x + 16,
                y + 112
            );
            this.ctx.fillText(
                `psi mem some10 ${Number(psiMem.some_avg10 || 0).toFixed(2)} full10 ${Number(psiMem.full_avg10 || 0).toFixed(2)}`,
                x + Math.max(320, w - 320),
                y + 112
            );
        }
        this.ctx.fillStyle = 'rgba(0, 229, 255, 0.55)';
        this.ctx.font = '9px "Share Tech Mono", monospace';
        this.ctx.fillText('strips ≈ meminfo buckets; fabric cells bind to sampled process pressure; not a physical PFN map', x + 16, y + 124);
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
        if (k === 'dirty_wb') {
            return `rgba(${Math.floor(255 * u)}, ${Math.floor(120 + 80 * u)}, ${Math.floor(40 + 40 * u)}, ${0.22 + u * 0.42})`;
        }
        if (k === 'anon_huge' || k === 'shmem_huge') {
            return `rgba(${Math.floor(60 + 100 * u)}, ${Math.floor(220)}, ${Math.floor(140 + 60 * u)}, ${0.18 + u * 0.4})`;
        }
        if (k === 'vmalloc') {
            return `rgba(${Math.floor(180 + 50 * u)}, ${Math.floor(80 + 100 * u)}, ${Math.floor(255)}, ${0.2 + u * 0.38})`;
        }
        if (k === 'active' || k === 'inactive') {
            return `rgba(${Math.floor(40 + 80 * u)}, ${Math.floor(200 + 40 * u)}, ${Math.floor(255)}, ${0.15 + u * 0.35})`;
        }
        if (k === 'slab' || k === 'sreclaim' || k === 'sunreclaim' || k === 'kmeta') {
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

    drawMemoryFabricView(x, y, w, h) {
        const mv = this.telemetry?.memory_visual;
        const stripRows = Array.isArray(mv?.rows) ? mv.rows : [];
        const summary = mv?.summary || {};
        const processPressure = Array.isArray(mv?.process_pressure) ? mv.process_pressure : [];
        const kernelState = mv?.kernel_memory_state || {};
        const psiMem = kernelState.psi_memory || {};
        this.memoryFabricHits = [];
        this.drawPanel(x, y, w, h, 'memory fabric map · panoramic pressure field', { alpha: 0.9 });
        const innerX = x + 10;
        const innerY = y + 30;
        const innerW = w - 20;
        const innerH = h - 40;

        // Panoramic viewport to match cinematic reference rhythm.
        const targetAspect = 2.35;
        let viewW = innerW - 16;
        let viewH = Math.floor(viewW / targetAspect);
        if (viewH > innerH - 14) {
            viewH = innerH - 14;
            viewW = Math.floor(viewH * targetAspect);
        }
        const viewX = innerX + Math.floor((innerW - viewW) * 0.5);
        const viewY = innerY + Math.floor((innerH - viewH) * 0.5);

        this.ctx.fillStyle = 'rgba(3, 8, 14, 0.88)';
        this.ctx.fillRect(innerX, innerY, innerW, innerH);
        this.ctx.fillStyle = 'rgba(5, 11, 18, 0.94)';
        this.ctx.fillRect(viewX, viewY, viewW, viewH);
        this.ctx.strokeStyle = 'rgba(118, 166, 220, 0.28)';
        this.ctx.strokeRect(viewX + 0.5, viewY + 0.5, viewW - 1, viewH - 1);

        const cols = Math.max(110, Math.min(220, Math.floor(viewW / 6)));
        const rows = Math.max(24, Math.min(74, Math.floor(viewH / 6)));
        const cellW = viewW / cols;
        const cellH = viewH / rows;
        const writeLevel = Math.max(0, Math.min(1, Number(summary.dirty_writeback_mb || 0) / 512));
        const swapLevel = Math.max(0, Math.min(1, Number(summary.swap_percent || 0) / 100));
        const hugeLevel = Math.max(0, Math.min(1, Number(summary.anon_huge_mb || 0) / Math.max(1, Number(summary.total_mb || 1)) * 14));

        // Flatten rows into weighted fabric source.
        const fabricCells = [];
        stripRows.forEach((row) => {
            const blocks = Array.isArray(row.blocks) ? row.blocks : [];
            blocks.forEach((blk) => fabricCells.push({
                kind: blk.kind || row.id || 'anon',
                heat: Number(blk.heat || 0),
                width: Number(blk.w || 0)
            }));
        });
        if (!fabricCells.length) {
            this.ctx.fillStyle = 'rgba(192, 220, 255, 0.7)';
            this.ctx.font = '11px "Share Tech Mono", monospace';
            this.ctx.fillText('no memory fabric data', viewX + 12, viewY + 24);
            return;
        }

        const weightedProcPool = [];
        processPressure.slice(0, 12).forEach((proc) => {
            const score = Math.max(1, Number(proc?.pressure_score || 0));
            const reps = Math.max(1, Math.min(7, Math.floor(score / 18) + 1));
            for (let i = 0; i < reps; i += 1) {
                weightedProcPool.push(proc);
            }
        });

        const centerX = viewX + viewW * 0.5;
        const centerY = viewY + viewH * 0.5;
        const maxD = Math.max(1, Math.hypot(viewW * 0.5, viewH * 0.5));
        const hotBias = 0.008 + writeLevel * 0.008 + swapLevel * 0.004;
        const hotspotPoints = [];

        for (let ry = 0; ry < rows; ry++) {
            for (let cx = 0; cx < cols; cx++) {
                const idx = (ry * cols + cx) % fabricCells.length;
                const src = fabricCells[idx];
                const px = viewX + cx * cellW;
                const py = viewY + ry * cellH;
                const noise = (Math.sin(this.tick * 0.028 + cx * 0.33 + ry * 0.21) + 1) * 0.5;
                const corridor = 0.5 + 0.5 * Math.sin((cx / cols) * Math.PI * 2 + this.tick * 0.012 + Math.sin((ry / rows) * Math.PI * 2) * 1.2);
                const heat = Math.max(0, Math.min(1, src.heat * 0.65 + noise * 0.2 + corridor * 0.15));
                const dx = px - centerX;
                const dy = py - centerY;
                const edge = Math.max(0, Math.min(1, Math.hypot(dx, dy) / maxD));
                const edgeFalloff = 1 - Math.pow(edge, 1.55);
                let alpha = (0.05 + heat * 0.52) * edgeFalloff;
                if (src.kind === 'dirty_wb') alpha += writeLevel * 0.25;
                if (src.kind === 'swap') alpha += swapLevel * 0.2;
                if (src.kind === 'anon_huge' || src.kind === 'shmem_huge') alpha += hugeLevel * 0.16;
                alpha = Math.min(0.95, alpha);
                const seed = ((cx + 11) * 73856093) ^ ((ry + 17) * 19349663) ^ Math.floor(this.tick * 0.8);
                const hotGate = ((seed >>> 0) % 1000) / 1000;
                const isHotspot = hotGate > (0.992 - hotBias) && heat > 0.48;
                const procOwner = weightedProcPool.length
                    ? weightedProcPool[(Math.abs((cx * 97 + ry * 53 + (seed >>> 4))) % weightedProcPool.length)]
                    : null;

                if (src.kind === 'dirty_wb') {
                    this.ctx.fillStyle = `rgba(${Math.floor(200 + 55 * heat)}, ${Math.floor(140 + 70 * heat)}, ${Math.floor(80 + 28 * heat)}, ${alpha.toFixed(3)})`;
                } else if (src.kind === 'cached' || src.kind === 'buffers' || src.kind === 'mapped') {
                    this.ctx.fillStyle = `rgba(${Math.floor(52 + 32 * heat)}, ${Math.floor(180 + 64 * heat)}, 255, ${alpha.toFixed(3)})`;
                } else if (src.kind === 'swap') {
                    this.ctx.fillStyle = `rgba(${Math.floor(224 + 22 * heat)}, ${Math.floor(105 + 35 * heat)}, ${Math.floor(140 + 35 * heat)}, ${alpha.toFixed(3)})`;
                } else {
                    this.ctx.fillStyle = `rgba(${Math.floor(80 + 80 * heat)}, ${Math.floor(155 + 80 * heat)}, ${Math.floor(200 + 45 * heat)}, ${alpha.toFixed(3)})`;
                }

                const rw = Math.max(1, cellW - 1.2);
                const rh = Math.max(1, cellH - 1.2);
                this.ctx.fillRect(px, py, rw, rh);
                if (isHotspot) {
                    this.ctx.fillStyle = `rgba(255, 250, 232, ${(0.62 + heat * 0.32).toFixed(3)})`;
                    this.ctx.fillRect(px, py, rw, rh);
                    if (hotspotPoints.length < 180) {
                        hotspotPoints.push({
                            x: px + rw * 0.5,
                            y: py + rh * 0.5,
                            heat
                        });
                    }
                }
                if (procOwner && (isHotspot || heat > 0.7) && this.memoryFabricHits.length < 700) {
                    this.memoryFabricHits.push({
                        x: px,
                        y: py,
                        w: rw,
                        h: rh,
                        heat,
                        kind: src.kind,
                        pid: Number(procOwner.pid || 0),
                        name: String(procOwner.name || 'proc'),
                        role: String(procOwner.role || 'userspace'),
                        pressure_score: Number(procOwner.pressure_score || 0),
                        rss_mb: Number(procOwner.rss_mb || 0),
                        swap_mb: Number(procOwner.swap_mb || 0),
                        anon_mb: Number(procOwner.anon_mb || 0),
                        file_mb: Number(procOwner.file_mb || 0),
                        majflt: Number(procOwner.majflt || 0),
                    });
                }
            }
        }

        // Soft bloom around sparse hotspot peaks.
        if (hotspotPoints.length) {
            this.ctx.save();
            this.ctx.globalCompositeOperation = 'lighter';
            hotspotPoints.forEach((p, i) => {
                if (i % 2 !== 0) return;
                const rr = 2.6 + p.heat * 6.4;
                const glow = this.ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
                glow.addColorStop(0, `rgba(244, 252, 255, ${(0.2 + p.heat * 0.33).toFixed(3)})`);
                glow.addColorStop(1, 'rgba(180, 232, 255, 0)');
                this.ctx.fillStyle = glow;
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
                this.ctx.fill();
            });
            this.ctx.restore();
        }

        // Glow scanline to mimic cinematic analyzer rhythm.
        const scanY = viewY + ((Math.sin(this.tick * 0.02) + 1) * 0.5) * viewH;
        const grad = this.ctx.createLinearGradient(viewX, scanY - 14, viewX, scanY + 14);
        grad.addColorStop(0, 'rgba(120, 210, 255, 0)');
        grad.addColorStop(0.5, 'rgba(146, 232, 255, 0.18)');
        grad.addColorStop(1, 'rgba(120, 210, 255, 0)');
        this.ctx.fillStyle = grad;
        this.ctx.fillRect(viewX, scanY - 14, viewW, 28);

        // Vignette and glass pass.
        const vignette = this.ctx.createRadialGradient(centerX, centerY, Math.min(viewW, viewH) * 0.2, centerX, centerY, Math.max(viewW, viewH) * 0.72);
        vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
        vignette.addColorStop(1, 'rgba(0, 0, 0, 0.32)');
        this.ctx.fillStyle = vignette;
        this.ctx.fillRect(viewX, viewY, viewW, viewH);
        const glass = this.ctx.createLinearGradient(viewX, viewY, viewX, viewY + viewH);
        glass.addColorStop(0, 'rgba(176, 220, 255, 0.06)');
        glass.addColorStop(0.2, 'rgba(176, 220, 255, 0.01)');
        glass.addColorStop(1, 'rgba(176, 220, 255, 0)');
        this.ctx.fillStyle = glass;
        this.ctx.fillRect(viewX, viewY, viewW, viewH);

        // HUD corner markers.
        this.ctx.strokeStyle = 'rgba(148, 208, 255, 0.72)';
        this.ctx.lineWidth = 1;
        const cm = 16;
        this.ctx.beginPath();
        this.ctx.moveTo(viewX + 1, viewY + cm); this.ctx.lineTo(viewX + 1, viewY + 1); this.ctx.lineTo(viewX + cm, viewY + 1);
        this.ctx.moveTo(viewX + viewW - cm, viewY + 1); this.ctx.lineTo(viewX + viewW - 1, viewY + 1); this.ctx.lineTo(viewX + viewW - 1, viewY + cm);
        this.ctx.moveTo(viewX + 1, viewY + viewH - cm); this.ctx.lineTo(viewX + 1, viewY + viewH - 1); this.ctx.lineTo(viewX + cm, viewY + viewH - 1);
        this.ctx.moveTo(viewX + viewW - cm, viewY + viewH - 1); this.ctx.lineTo(viewX + viewW - 1, viewY + viewH - 1); this.ctx.lineTo(viewX + viewW - 1, viewY + viewH - cm);
        this.ctx.stroke();

        // Subtle terminal refresh jitter (rare, low amplitude).
        const pulse = ((Math.sin(this.tick * 0.017) + 1) * 0.5);
        if (pulse > 0.9) {
            const bandCount = 2 + (Math.floor(this.tick) % 2);
            for (let i = 0; i < bandCount; i++) {
                const by = viewY + Math.floor((((i + 1) * 0.23) + (pulse * 0.19)) * viewH) % Math.max(1, viewH - 10);
                const bh = 2 + ((i + Math.floor(this.tick)) % 3);
                const shift = ((i % 2 === 0) ? 1 : -1) * (0.8 + pulse * 1.1);
                this.ctx.drawImage(
                    this.canvas,
                    viewX,
                    by,
                    viewW,
                    bh,
                    viewX + shift,
                    by,
                    viewW,
                    bh
                );
                this.ctx.fillStyle = `rgba(170, 225, 255, ${(0.03 + pulse * 0.05).toFixed(3)})`;
                this.ctx.fillRect(viewX, by, viewW, bh);
            }
        }

        // Thin scanline texture for cinematic monitor feel.
        this.ctx.strokeStyle = 'rgba(150, 205, 242, 0.05)';
        this.ctx.lineWidth = 1;
        for (let ly = viewY + 1; ly < viewY + viewH; ly += 3) {
            this.ctx.beginPath();
            this.ctx.moveTo(viewX, ly + 0.5);
            this.ctx.lineTo(viewX + viewW, ly + 0.5);
            this.ctx.stroke();
        }

        // Right-side compact activity ruler (HUD micro-bars).
        const hudX = viewX + viewW - 10;
        const hudY = viewY + 12;
        const hudH = Math.max(30, viewH - 24);
        const segments = 22;
        for (let i = 0; i < segments; i++) {
            const t = i / Math.max(1, segments - 1);
            const segY = hudY + t * hudH;
            const pulse = 0.5 + 0.5 * Math.sin(this.tick * 0.05 + i * 0.7);
            const level = Math.max(writeLevel * 0.8, swapLevel * 0.5, hugeLevel * 0.4) * 0.6 + pulse * 0.4;
            this.ctx.fillStyle = `rgba(152, 220, 255, ${(0.08 + level * 0.24).toFixed(3)})`;
            this.ctx.fillRect(hudX, segY, 4, 2);
        }

        this.ctx.fillStyle = 'rgba(160, 204, 232, 0.84)';
        this.ctx.font = '8px "Share Tech Mono", monospace';
        this.ctx.fillText(`nodes ${rows * cols} · hot ${(hotBias * 100).toFixed(1)}% · writer ${Math.round(writeLevel * 100)}%`, viewX + 8, viewY - 6);
        this.ctx.fillText(
            `psi some10 ${Number(psiMem.some_avg10 || 0).toFixed(2)} · full10 ${Number(psiMem.full_avg10 || 0).toFixed(2)}`,
            viewX + Math.max(180, viewW - 250),
            viewY - 6
        );
        this.ctx.fillText('cells represent memory buckets and pressure hotspots, not physical PFN map', viewX + 8, viewY + viewH - 8);

        const tip = this.memorySelectedCell || this.memoryHoverCell;
        if (tip && tip.pid) {
            this.drawMemoryProcessTooltip(tip, viewX, viewY, viewW, viewH);
        }
    }

    drawMemoryProcessTooltip(cell, viewX, viewY, viewW, viewH) {
        const tw = 274;
        const th = 82;
        let tx = Math.floor(this.lastMouseX + 16);
        let ty = Math.floor(this.lastMouseY + 16);
        if (tx + tw > viewX + viewW - 6) tx = viewX + viewW - tw - 8;
        if (ty + th > viewY + viewH - 6) ty = viewY + viewH - th - 8;
        if (tx < viewX + 6) tx = viewX + 6;
        if (ty < viewY + 6) ty = viewY + 6;

        this.drawPanel(tx, ty, tw, th, '', { alpha: 0.93, showTitle: false });
        this.ctx.fillStyle = 'rgba(225, 242, 255, 0.95)';
        this.ctx.font = '10px "Share Tech Mono", monospace';
        this.ctx.fillText(`${String(cell.name || 'proc').slice(0, 22)} · pid ${Number(cell.pid || 0)}`, tx + 10, ty + 16);
        this.ctx.fillStyle = 'rgba(166, 203, 236, 0.88)';
        this.ctx.font = '8px "Share Tech Mono", monospace';
        this.ctx.fillText(
            `${String(cell.role || 'userspace')} · score ${Number(cell.pressure_score || 0).toFixed(1)} · ${String(cell.kind || 'anon')}`,
            tx + 10,
            ty + 30
        );
        this.ctx.fillText(
            `rss ${Number(cell.rss_mb || 0).toFixed(1)} MB · anon ${Number(cell.anon_mb || 0).toFixed(1)} · file ${Number(cell.file_mb || 0).toFixed(1)}`,
            tx + 10,
            ty + 44
        );
        this.ctx.fillText(
            `swap ${Number(cell.swap_mb || 0).toFixed(1)} MB · majflt ${Math.round(Number(cell.majflt || 0))}`,
            tx + 10,
            ty + 58
        );
        this.ctx.fillStyle = this.memorySelectedCell ? 'rgba(157, 214, 255, 0.9)' : 'rgba(142, 182, 220, 0.78)';
        this.ctx.fillText(this.memorySelectedCell ? 'selected (click same process to clear)' : 'hover for process pressure details', tx + 10, ty + 72);
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
        const labelCol = 132;
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
            this.ctx.fillText(String(row.label || row.id || '').slice(0, 28), innerX + 4, ry + rowAreaH * 0.62);
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
        const statsH = 128;
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
        if (this.viewMode === 'fabric') {
            const fabricH = Math.max(220, Math.min(420, Math.floor(graphH * 0.58)));
            const stripY = graphY + fabricH + gap;
            const stripH = Math.max(160, graphH - fabricH - gap);
            this.drawMemoryFabricView(gap, graphY, w - gap * 2, fabricH);
            this.drawMemoryView(gap, stripY, w - gap * 2, stripH);
        } else {
            this.drawMemoryView(gap, graphY, w - gap * 2, graphH);
        }
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
