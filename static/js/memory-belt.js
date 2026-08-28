// Linux memory subsystem — strip map (same API payload as processes-realtime memory_visual)
// Version: 11 — noise sits on a locked grid; hot marks are horizontal runs

debugLog('💾 memory-belt.js v11: Script loading...');

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
        this.prevMemoryVmstat = null;
        this.memoryVmstatDelta = {};
        this.fabricFocus = null; // { kind, rowId, label, heat, pid? }
        this.fabricViewBounds = null;
        this.parallaxX = 0;
        this.parallaxY = 0;
        this.parallaxTX = 0;
        this.parallaxTY = 0;
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
            position:absolute;top:18px;left:150px;padding:8px 12px;z-index:10021;
            background: rgba(2, 10, 14, 0.92); border:1px solid rgba(0, 220, 230, 0.45);
            color:#b8e8f0; font-family:'Share Tech Mono', monospace; font-size:11px; cursor:pointer;
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
        this.viewModeButton.textContent = isFabric ? 'HERO: FABRIC' : 'VIEW: STRIPS';
        this.viewModeButton.style.background = isFabric ? 'rgba(0, 28, 36, 0.95)' : 'rgba(2, 10, 14, 0.92)';
        this.viewModeButton.style.borderColor = isFabric ? 'rgba(220, 235, 200, 0.7)' : 'rgba(0, 220, 230, 0.45)';
        this.viewModeButton.style.color = isFabric ? '#e8f0d0' : '#b8e8f0';
    }

    onMouseMove(event) {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        this.lastMouseX = x;
        this.lastMouseY = y;

        const b = this.fabricViewBounds;
        if (b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
            const nx = (x - (b.x + b.w * 0.5)) / Math.max(1, b.w * 0.5);
            const ny = (y - (b.y + b.h * 0.5)) / Math.max(1, b.h * 0.5);
            this.parallaxTX = Math.max(-1, Math.min(1, nx)) * 10;
            this.parallaxTY = Math.max(-1, Math.min(1, ny)) * 6;
        } else {
            this.parallaxTX *= 0.86;
            this.parallaxTY *= 0.86;
        }

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
                    this.canvas.style.cursor = 'pointer';
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
                    this.setFabricFocus(hit);
                    return;
                }
            }
        }
        if (this.memoryStripHits.length) {
            for (const hit of this.memoryStripHits) {
                if (x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h) {
                    this.setFabricFocus({
                        kind: hit.kind,
                        rowId: hit.rowId,
                        label: hit.label,
                        heat: Number(hit.blk?.heat || 0),
                        pid: hit.blk?.pid,
                        name: hit.blk?.name
                    });
                    return;
                }
            }
        }
    }

    setFabricFocus(hit) {
        if (!hit) {
            this.fabricFocus = null;
            this.memorySelectedCell = null;
            return;
        }
        const kind = String(hit.kind || 'anon');
        const rowId = hit.rowId || this.kindToRowId(kind);
        const same = this.fabricFocus
            && String(this.fabricFocus.kind) === kind
            && String(this.fabricFocus.rowId || '') === String(rowId || '')
            && Number(this.fabricFocus.pid || 0) === Number(hit.pid || 0);
        if (same) {
            this.fabricFocus = null;
            this.memorySelectedCell = null;
            return;
        }
        this.fabricFocus = {
            kind,
            rowId,
            label: hit.label || kind,
            heat: Number(hit.heat || 0),
            pid: hit.pid ? Number(hit.pid) : null,
            name: hit.name || null,
            role: hit.role || null,
            pressure_score: hit.pressure_score,
            rss_mb: hit.rss_mb,
            swap_mb: hit.swap_mb,
            anon_mb: hit.anon_mb,
            file_mb: hit.file_mb,
            majflt: hit.majflt
        };
        this.memorySelectedCell = hit.pid ? hit : null;
    }

    fabricKindTint(kind, heat, alpha) {
        // Cold cyan mass (Tron) — weak kind bias only.
        const u = Math.max(0, Math.min(1, heat));
        const a = Math.max(0, Math.min(1, alpha));
        const k = String(kind || 'anon');
        // base cyan: r low, g mid-high, b high
        let r = 20 + 25 * u;
        let g = 110 + 70 * u;
        let b = 140 + 70 * u;
        if (k === 'cached' || k === 'buffers' || k === 'mapped') {
            r = 15 + 20 * u; g = 130 + 60 * u; b = 170 + 50 * u;
        } else if (k.includes('slab') || k === 'sreclaim' || k === 'sunreclaim' || k === 'kmeta') {
            r = 40 + 30 * u; g = 100 + 50 * u; b = 170 + 55 * u;
        } else if (k === 'dirty_wb' || k === 'writeback') {
            r = 90 + 40 * u; g = 110 + 40 * u; b = 90 + 30 * u;
        } else if (k === 'swap') {
            r = 80 + 40 * u; g = 70 + 30 * u; b = 140 + 40 * u;
        }
        return `rgba(${Math.floor(r)}, ${Math.floor(g)}, ${Math.floor(b)}, ${a.toFixed(3)})`;
    }

    kindToRowId(kind) {
        const k = String(kind || '');
        const rows = this.telemetry?.memory_visual?.rows || [];
        const exact = rows.find((r) => r.id === k || (r.blocks || []).some((b) => b.kind === k));
        if (exact) return exact.id;
        if (k.includes('anon')) return rows.find((r) => /anon/i.test(r.id || r.label || ''))?.id || k;
        if (k.includes('cache') || k === 'buffers' || k === 'mapped') {
            return rows.find((r) => /cache|file|map/i.test(r.id || r.label || ''))?.id || k;
        }
        if (k.includes('slab') || k === 'sreclaim' || k === 'sunreclaim' || k === 'kmeta') {
            return rows.find((r) => /slab/i.test(r.id || r.label || ''))?.id || k;
        }
        if (k === 'swap') return rows.find((r) => /swap/i.test(r.id || r.label || ''))?.id || k;
        return k;
    }

    getMemoryKindStory(kind) {
        const k = String(kind || 'anon');
        const table = {
            anon: {
                title: 'ANONYMOUS',
                lines: [
                    'heap/stack pages · no file backing',
                    'fault → do_anonymous_page()',
                    'pressure → reclaim / swap candidates'
                ],
                ghost: 'do_anonymous_page()'
            },
            cached: {
                title: 'PAGE CACHE',
                lines: [
                    'file pages in address_space',
                    'read hits avoid disk I/O',
                    'reclaim via shrink_lruvec()'
                ],
                ghost: 'filemap_fault()'
            },
            buffers: {
                title: 'BUFFERS',
                lines: [
                    'block device metadata cache',
                    'feeds writeback / journal paths',
                    'counted in meminfo Buffers'
                ],
                ghost: 'block_read_full_folio()'
            },
            mapped: {
                title: 'FILE MAPPED',
                lines: [
                    'mmap file-backed VMAs',
                    'shared with page cache',
                    'msync / writeback on dirty'
                ],
                ghost: 'do_mmap()'
            },
            slab: {
                title: 'SLAB / SLUB',
                lines: [
                    'kernel object caches',
                    'kmem_cache_alloc path',
                    'reclaimable vs unreclaimable'
                ],
                ghost: 'kmem_cache_alloc()'
            },
            sreclaim: {
                title: 'SLAB RECLAIMABLE',
                lines: [
                    'dentries / inodes caches',
                    'shrinkers can free under pressure',
                    'SReclaimable in meminfo'
                ],
                ghost: 'super_cache_scan()'
            },
            sunreclaim: {
                title: 'SLAB UNRECLAIMABLE',
                lines: [
                    'pinned kernel objects',
                    'not shrinker-friendly',
                    'SUnreclaim in meminfo'
                ],
                ghost: 'kmem_cache_alloc()'
            },
            dirty_wb: {
                title: 'DIRTY / WRITEBACK',
                lines: [
                    'dirty pages await flush',
                    'flusher threads · writeback',
                    'pressure rises with Dirty+Writeback'
                ],
                ghost: 'wb_workfn()'
            },
            swap: {
                title: 'SWAP',
                lines: [
                    'anon pages moved to swap',
                    'swap_readpage / swap_writepage',
                    'PSI full often tracks stalls'
                ],
                ghost: 'swap_read_folio()'
            },
            active: {
                title: 'LRU ACTIVE',
                lines: [
                    'recently referenced pages',
                    'protected from quick reclaim',
                    'Active(anon/file) lists'
                ],
                ghost: 'mark_page_accessed()'
            },
            inactive: {
                title: 'LRU INACTIVE',
                lines: [
                    'reclaim candidates',
                    'kswapd / direct reclaim scan',
                    'Inactive → free / swap'
                ],
                ghost: 'shrink_inactive_list()'
            },
            task: {
                title: 'TASK RSS',
                lines: [
                    'sampled process pressure',
                    'RSS = anon + file pages',
                    'click dock row for bucket map'
                ],
                ghost: 'get_mm_rss()'
            }
        };
        return table[k] || {
            title: k.toUpperCase().slice(0, 18),
            lines: [
                'memory accounting bucket',
                'linked from fabric pressure field',
                'see topology dock highlight'
            ],
            ghost: null
        };
    }

    fetchTelemetry() {
        return fetch('/api/processes-realtime', { cache: 'no-store' })
            .then((res) => res.json())
            .then((data) => {
                if (!data || data.error) throw new Error(data?.error || 'No data');
                this.telemetry = data;
                this.updateMemoryKernelDeltas();
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

    updateMemoryKernelDeltas() {
        const vmstat = this.telemetry?.memory_visual?.kernel_memory_state?.vmstat || {};
        const keys = [
            'pgfault', 'pgmajfault', 'pgscan_kswapd', 'pgscan_direct',
            'pgsteal_kswapd', 'pgsteal_direct', 'compact_stall', 'oom_kill'
        ];
        const next = {};
        keys.forEach((key) => {
            const cur = Number(vmstat[key] || 0);
            const prev = this.prevMemoryVmstat ? Number(this.prevMemoryVmstat[key] || 0) : cur;
            next[key] = Math.max(0, cur - prev);
        });
        this.memoryVmstatDelta = next;
        this.prevMemoryVmstat = { ...vmstat };
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
        this.ctx.fillStyle = 'rgba(0, 220, 230, 0.55)';
        this.ctx.font = '10px "Share Tech Mono", monospace';
        this.ctx.fillText('linux kernel · memory management subsystem', w * 0.5, 22);
        this.ctx.textAlign = 'start';
    }

    drawHudFrame(x, y, w, h) {
        this.ctx.fillStyle = 'rgba(2, 8, 12, 0.78)';
        this.ctx.fillRect(x, y, w, h);
        this.ctx.strokeStyle = 'rgba(0, 220, 230, 0.55)';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        // corner ticks
        const t = 8;
        this.ctx.beginPath();
        this.ctx.moveTo(x + 1, y + t); this.ctx.lineTo(x + 1, y + 1); this.ctx.lineTo(x + t, y + 1);
        this.ctx.moveTo(x + w - t, y + 1); this.ctx.lineTo(x + w - 1, y + 1); this.ctx.lineTo(x + w - 1, y + t);
        this.ctx.moveTo(x + 1, y + h - t); this.ctx.lineTo(x + 1, y + h - 1); this.ctx.lineTo(x + t, y + h - 1);
        this.ctx.moveTo(x + w - t, y + h - 1); this.ctx.lineTo(x + w - 1, y + h - 1); this.ctx.lineTo(x + w - 1, y + h - t);
        this.ctx.strokeStyle = 'rgba(0, 210, 220, 0.45)';
        this.ctx.stroke();
    }

    drawFabricHeroHud(viewX, viewY, viewW, viewH) {
        const sum = this.telemetry?.memory_visual?.summary || {};
        const psiMem = this.telemetry?.memory_visual?.kernel_memory_state?.psi_memory || {};
        const procPressure = Array.isArray(this.telemetry?.memory_visual?.process_pressure)
            ? this.telemetry.memory_visual.process_pressure
            : [];
        const pathItems = this.buildKernelMemoryPathItems(sum, psiMem);

        // Left micro-rail
        const sideW = 42;
        const sx = viewX + 6;
        const sy = viewY + 64;
        const sh = Math.max(140, viewH - 170);
        this.ctx.strokeStyle = 'rgba(0, 200, 220, 0.4)';
        this.ctx.strokeRect(sx + 0.5, sy + 0.5, sideW - 1, sh - 1);
        this.ctx.fillStyle = 'rgba(0, 210, 230, 0.55)';
        this.ctx.font = '6px "Share Tech Mono", monospace';
        this.ctx.fillText('SYS', sx + 6, sy + 10);
        const bars = [
            Math.min(1, Number(sum.used_percent || 0) / 100),
            Math.min(1, Number(sum.swap_percent || 0) / 100),
            Math.min(1, Number(psiMem.some_avg10 || 0) / 8),
            Math.min(1, Number(sum.cached_mb || 0) / Math.max(1, Number(sum.total_mb || 1))),
            Math.min(1, Number(sum.anon_mb || 0) / Math.max(1, Number(sum.total_mb || 1))),
            Math.min(1, Number(sum.slab_mb || 0) / Math.max(1, Number(sum.total_mb || 1))),
            Math.min(1, Number(sum.dirty_writeback_mb || 0) / 64)
        ];
        bars.forEach((v, i) => {
            const by = sy + 16 + i * ((sh - 28) / bars.length);
            this.ctx.fillStyle = 'rgba(0, 30, 40, 0.95)';
            this.ctx.fillRect(sx + 6, by, 28, 3);
            this.ctx.fillStyle = v > 0.55 ? 'rgba(240, 245, 200, 0.9)' : 'rgba(0, 210, 230, 0.75)';
            this.ctx.fillRect(sx + 6, by, Math.max(1, 28 * v), 3);
            // diamond tick
            this.ctx.fillStyle = 'rgba(0, 200, 220, 0.45)';
            this.ctx.fillRect(sx + 34, by, 2, 2);
        });

        // Right micro-rail (Tron symmetry)
        const rx0 = viewX + viewW - sideW - 6;
        this.ctx.strokeStyle = 'rgba(0, 200, 220, 0.4)';
        this.ctx.strokeRect(rx0 + 0.5, sy + 0.5, sideW - 1, sh - 1);
        this.ctx.fillStyle = 'rgba(0, 210, 230, 0.55)';
        this.ctx.font = '6px "Share Tech Mono", monospace';
        this.ctx.fillText('MM', rx0 + 8, sy + 10);
        pathItems.forEach((item, i) => {
            const by = sy + 18 + i * ((sh - 30) / Math.max(1, pathItems.length));
            this.ctx.fillStyle = item.active ? 'rgba(240, 245, 200, 0.85)' : 'rgba(0, 90, 105, 0.7)';
            this.ctx.fillRect(rx0 + 8, by, 24, 3);
            this.ctx.fillStyle = 'rgba(140, 200, 210, 0.55)';
            this.ctx.font = '5px "Share Tech Mono", monospace';
            this.ctx.fillText(item.label.slice(0, 6), rx0 + 8, by + 10);
        });

        // Bottom telemetry row — three thin tables
        const rowH = 70;
        const rowY = viewY + viewH - rowH - 8;
        const gap = 8;
        const leftW = Math.floor((viewW - gap * 2 - 100) * 0.28);
        const midW = Math.floor((viewW - gap * 2 - 100) * 0.4);
        const rightW = Math.floor((viewW - gap * 2 - 100) * 0.32);
        const leftX = viewX + 52;
        const midX = leftX + leftW + gap;
        const rightX = midX + midW + gap;

        this.drawHudFrame(leftX, rowY, leftW, rowH);
        this.ctx.fillStyle = 'rgba(0, 210, 230, 0.75)';
        this.ctx.font = '7px "Share Tech Mono", monospace';
        this.ctx.fillText('MEM · PHYSICAL', leftX + 8, rowY + 12);
        this.ctx.fillStyle = 'rgba(235, 245, 250, 0.95)';
        this.ctx.font = '10px "Share Tech Mono", monospace';
        this.ctx.fillText(`${Number(sum.total_mb || 0).toFixed(0)} MiB`, leftX + 8, rowY + 28);
        this.ctx.fillText(`${Number(sum.used_percent || 0).toFixed(1)}%`, leftX + 90, rowY + 28);
        // mini util bar like GPU panel
        this.ctx.fillStyle = 'rgba(0, 40, 50, 0.95)';
        this.ctx.fillRect(leftX + 8, rowY + 36, leftW - 16, 5);
        this.ctx.fillStyle = 'rgba(0, 210, 230, 0.85)';
        this.ctx.fillRect(leftX + 8, rowY + 36, Math.max(1, (leftW - 16) * Math.min(1, Number(sum.used_percent || 0) / 100)), 5);
        this.ctx.fillStyle = 'rgba(120, 180, 195, 0.85)';
        this.ctx.font = '7px "Share Tech Mono", monospace';
        this.ctx.fillText(`cache ${Number(sum.cached_mb || 0).toFixed(0)}  anon ${Number(sum.anon_mb || 0).toFixed(0)}  slab ${Number(sum.slab_mb || 0).toFixed(0)}`, leftX + 8, rowY + 54);
        this.ctx.fillText(`swap ${Number(sum.swap_percent || 0).toFixed(1)}%  avail ${Number(sum.available_mb || 0).toFixed(0)}`, leftX + 8, rowY + 64);

        this.drawHudFrame(midX, rowY, midW, rowH);
        this.ctx.fillStyle = 'rgba(0, 210, 230, 0.75)';
        this.ctx.font = '7px "Share Tech Mono", monospace';
        this.ctx.fillText('KERNEL PATH', midX + 8, rowY + 12);
        const step = (midW - 20) / pathItems.length;
        pathItems.forEach((item, i) => {
            const cx = midX + 14 + i * step;
            const cy = rowY + 34;
            if (i > 0) {
                this.ctx.beginPath();
                this.ctx.moveTo(cx - step + 5, cy);
                this.ctx.lineTo(cx - 5, cy);
                this.ctx.strokeStyle = 'rgba(0, 160, 180, 0.35)';
                this.ctx.stroke();
            }
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, item.active ? 3.4 : 2.4, 0, Math.PI * 2);
            this.ctx.fillStyle = item.active ? 'rgba(245, 248, 210, 0.95)' : 'rgba(0, 120, 135, 0.65)';
            this.ctx.fill();
            this.ctx.strokeStyle = 'rgba(0, 200, 220, 0.45)';
            this.ctx.stroke();
            this.ctx.fillStyle = 'rgba(140, 195, 210, 0.75)';
            this.ctx.font = '5px "Share Tech Mono", monospace';
            this.ctx.fillText(item.label.slice(0, 8), cx - 10, cy + 14);
        });

        this.drawHudFrame(rightX, rowY, rightW, rowH);
        this.ctx.fillStyle = 'rgba(0, 210, 230, 0.75)';
        this.ctx.font = '7px "Share Tech Mono", monospace';
        this.ctx.fillText('PSI / VM', rightX + 8, rowY + 12);
        const rows = [
            { label: 'SOME10', v: Math.min(1, Number(psiMem.some_avg10 || 0) / 10), val: Number(psiMem.some_avg10 || 0).toFixed(2) },
            { label: 'FULL10', v: Math.min(1, Number(psiMem.full_avg10 || 0) / 5), val: Number(psiMem.full_avg10 || 0).toFixed(2) },
            { label: 'SWAP', v: Math.min(1, Number(sum.swap_percent || 0) / 100), val: `${Number(sum.swap_percent || 0).toFixed(1)}%` },
            { label: 'DIRTY', v: Math.min(1, Number(sum.dirty_writeback_mb || 0) / 64), val: Number(sum.dirty_writeback_mb || 0).toFixed(1) }
        ];
        rows.forEach((r, i) => {
            const yy = rowY + 24 + i * 11;
            this.ctx.fillStyle = 'rgba(120, 175, 190, 0.8)';
            this.ctx.font = '6px "Share Tech Mono", monospace';
            this.ctx.fillText(r.label, rightX + 8, yy);
            const trackX = rightX + 52;
            const trackW = rightW - 88;
            this.ctx.fillStyle = 'rgba(0, 30, 38, 0.95)';
            this.ctx.fillRect(trackX, yy - 5, trackW, 4);
            this.ctx.fillStyle = r.v > 0.55 ? 'rgba(245, 248, 210, 0.92)' : 'rgba(0, 210, 230, 0.8)';
            this.ctx.fillRect(trackX, yy - 5, Math.max(1, trackW * r.v), 4);
            this.ctx.fillStyle = 'rgba(160, 210, 220, 0.7)';
            this.ctx.fillText(r.val, rightX + rightW - 30, yy);
        });

        const topProc = procPressure[0];
        if (topProc) {
            this.ctx.fillStyle = 'rgba(140, 195, 210, 0.6)';
            this.ctx.font = '6px "Share Tech Mono", monospace';
            this.ctx.fillText(
                `${String(topProc.name || 'proc').slice(0, 10)}:${Number(topProc.pid || 0)}`,
                sx,
                sy + sh + 10
            );
        }
    }

    buildKernelMemoryPathItems(sum, psiMem) {
        const delta = this.memoryVmstatDelta || {};
        const dirtyWb = Number(sum.dirty_writeback_mb || 0);
        const swapPercent = Number(sum.swap_percent || 0);
        const psiSome = Number(psiMem.some_avg10 || 0);
        const psiFull = Number(psiMem.full_avg10 || 0);
        return [
            {
                label: 'page fault',
                value: Number(delta.pgfault || 0),
                active: Number(delta.pgfault || 0) > 0,
                color: 'rgba(120, 220, 255, 0.92)'
            },
            {
                label: 'reclaim',
                value: Number(delta.pgscan_kswapd || 0) + Number(delta.pgscan_direct || 0),
                active: Number(delta.pgscan_kswapd || 0) + Number(delta.pgscan_direct || 0) > 0 || psiSome > 0.01,
                color: 'rgba(126, 242, 210, 0.92)'
            },
            {
                label: 'kswapd',
                value: Number(delta.pgsteal_kswapd || 0),
                active: Number(delta.pgsteal_kswapd || 0) > 0,
                color: 'rgba(118, 230, 170, 0.9)'
            },
            {
                label: 'compaction',
                value: Number(delta.compact_stall || 0),
                active: Number(delta.compact_stall || 0) > 0,
                color: 'rgba(190, 150, 255, 0.9)'
            },
            {
                label: 'writeback',
                value: dirtyWb,
                active: dirtyWb > 0.01,
                color: 'rgba(255, 190, 110, 0.92)'
            },
            {
                label: 'swap',
                value: swapPercent,
                active: swapPercent > 0.1 || psiFull > 0.01,
                color: 'rgba(255, 120, 150, 0.9)'
            }
        ];
    }

    drawKernelMemoryPath(x, y, w, h, sum, psiMem) {
        const items = this.buildKernelMemoryPathItems(sum, psiMem);
        this.drawPanel(x, y, w, h, '', { alpha: 0.62, showTitle: false });
        this.ctx.fillStyle = 'rgba(214, 238, 255, 0.95)';
        this.ctx.font = '9px "Share Tech Mono", monospace';
        this.ctx.fillText('KERNEL MEMORY PATH', x + 10, y + 14);
        this.ctx.fillStyle = 'rgba(145, 198, 224, 0.82)';
        this.ctx.font = '7px "Share Tech Mono", monospace';
        this.ctx.fillText('vmstat delta / poll · psi pressure hints', x + 10, y + 26);

        const startY = y + 42;
        const stepX = Math.max(48, Math.floor((w - 26) / items.length));
        items.forEach((item, idx) => {
            const cx = x + 14 + idx * stepX;
            const activePulse = item.active ? (0.65 + 0.25 * Math.sin(this.tick * 0.08 + idx)) : 0.28;
            if (idx > 0) {
                this.ctx.beginPath();
                this.ctx.moveTo(cx - stepX + 18, startY);
                this.ctx.lineTo(cx - 8, startY);
                this.ctx.strokeStyle = item.active ? 'rgba(130, 230, 255, 0.34)' : 'rgba(100, 140, 165, 0.18)';
                this.ctx.lineWidth = 1;
                this.ctx.stroke();
            }
            this.ctx.beginPath();
            this.ctx.arc(cx, startY, item.active ? 4.6 : 3.4, 0, Math.PI * 2);
            this.ctx.fillStyle = item.active ? item.color : `rgba(110, 140, 160, ${activePulse})`;
            this.ctx.fill();
            this.ctx.strokeStyle = item.active ? 'rgba(236, 252, 255, 0.82)' : 'rgba(150, 178, 198, 0.38)';
            this.ctx.stroke();
            this.ctx.fillStyle = item.active ? 'rgba(226, 246, 255, 0.94)' : 'rgba(142, 166, 184, 0.72)';
            this.ctx.font = '7px "Share Tech Mono", monospace';
            this.ctx.fillText(item.label.slice(0, 11), cx - 8, startY + 14);
        });
    }

    drawMemoryStats(x, y, w, h) {
        const sum = this.telemetry?.memory_visual?.summary || {};
        const procPressure = Array.isArray(this.telemetry?.memory_visual?.process_pressure)
            ? this.telemetry.memory_visual.process_pressure
            : [];
        const psiMem = this.telemetry?.memory_visual?.kernel_memory_state?.psi_memory || {};
        this.drawPanel(x, y, w, h, 'physical memory · /proc/meminfo + psutil', { alpha: 0.88 });
        const pathW = Math.min(430, Math.max(330, w * 0.34));
        this.drawKernelMemoryPath(x + w - pathW - 14, y + 32, pathW, 68, sum, psiMem);
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

    drawMemoryFabricView(x, y, w, h, opts = {}) {
        const hero = opts.hero !== false;
        const mv = this.telemetry?.memory_visual;
        const stripRows = Array.isArray(mv?.rows) ? mv.rows : [];
        const summary = mv?.summary || {};
        const processPressure = Array.isArray(mv?.process_pressure) ? mv.process_pressure : [];
        const kernelState = mv?.kernel_memory_state || {};
        const psiMem = kernelState.psi_memory || {};
        this.memoryFabricHits = [];

        // Smooth parallax toward mouse target
        this.parallaxX += (this.parallaxTX - this.parallaxX) * 0.1;
        this.parallaxY += (this.parallaxTY - this.parallaxY) * 0.1;

        this.ctx.fillStyle = 'rgba(0, 2, 6, 0.98)';
        this.ctx.fillRect(x, y, w, h);
        this.ctx.strokeStyle = 'rgba(0, 180, 195, 0.5)';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

        const pad = 6;
        const viewX = x + pad;
        const viewY = y + pad;
        const viewW = w - pad * 2;
        const viewH = h - pad * 2;
        this.fabricViewBounds = { x: viewX, y: viewY, w: viewW, h: viewH };

        this.ctx.fillStyle = '#02080c';
        this.ctx.fillRect(viewX, viewY, viewW, viewH);

        // Locked lattice — noise is allowed only on this grid, not as free grain.
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(viewX, viewY, viewW, viewH);
        this.ctx.clip();
        const gStep = 10;
        this.ctx.strokeStyle = 'rgba(0, 120, 135, 0.12)';
        this.ctx.lineWidth = 1;
        for (let gx = viewX; gx <= viewX + viewW; gx += gStep) {
            this.ctx.beginPath();
            this.ctx.moveTo(gx + 0.5, viewY);
            this.ctx.lineTo(gx + 0.5, viewY + viewH);
            this.ctx.stroke();
        }
        this.ctx.strokeStyle = 'rgba(180, 220, 230, 0.07)';
        for (let gy = viewY; gy <= viewY + viewH; gy += 2) {
            this.ctx.beginPath();
            this.ctx.moveTo(viewX, gy + 0.5);
            this.ctx.lineTo(viewX + viewW, gy + 0.5);
            this.ctx.stroke();
        }
        this.ctx.strokeStyle = 'rgba(0, 140, 155, 0.22)';
        for (let gy = viewY; gy <= viewY + viewH; gy += gStep) {
            this.ctx.beginPath();
            this.ctx.moveTo(viewX, gy + 0.5);
            this.ctx.lineTo(viewX + viewW, gy + 0.5);
            this.ctx.stroke();
        }
        this.ctx.restore();

        // Bank scaffolding — larger Tron sections over fine grid
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(viewX, viewY, viewW, viewH);
        this.ctx.clip();
        const bankCols = 6;
        const bankRows = 4;
        this.ctx.strokeStyle = 'rgba(0, 160, 180, 0.14)';
        this.ctx.lineWidth = 1;
        for (let i = 1; i < bankCols; i++) {
            const bx = viewX + (viewW * i) / bankCols + this.parallaxX * 0.15;
            this.ctx.beginPath();
            this.ctx.moveTo(bx + 0.5, viewY);
            this.ctx.lineTo(bx + 0.5, viewY + viewH);
            this.ctx.stroke();
        }
        for (let j = 1; j < bankRows; j++) {
            const by = viewY + (viewH * j) / bankRows + this.parallaxY * 0.15;
            this.ctx.beginPath();
            this.ctx.moveTo(viewX, by + 0.5);
            this.ctx.lineTo(viewX + viewW, by + 0.5);
            this.ctx.stroke();
        }
        this.ctx.restore();

        const cols = Math.max(80, Math.min(150, Math.floor(viewW / 8)));
        const rows = Math.max(30, Math.min(58, Math.floor(viewH / 10)));
        const cellW = viewW / cols;
        const cellH = viewH / rows;
        const usedLevel = Math.max(0, Math.min(1, Number(summary.used_percent || 0) / 100));
        const psiSome = Number(psiMem.some_avg10 || 0);
        const psiFull = Number(psiMem.full_avg10 || 0);
        const swapPct = Number(summary.swap_percent || 0);
        const majfltDelta = Number(this.memoryVmstatDelta?.pgmajfault || 0);
        const reclaimDelta = Number(this.memoryVmstatDelta?.pgscan_kswapd || 0)
            + Number(this.memoryVmstatDelta?.pgscan_direct || 0);
        // Atmosphere weights (field only — diagnosis stays in HUD/path).
        const stallAtm = Math.max(0, Math.min(1, psiSome / 8 + psiFull / 3 + reclaimDelta / 4000));
        const thrashAtm = Math.max(0, Math.min(1, swapPct / 40 + majfltDelta / 80 + psiFull / 4));
        const pressureBoost = Math.max(0, Math.min(0.12, stallAtm * 0.08 + thrashAtm * 0.06));

        const fabricCells = [];
        stripRows.forEach((row) => {
            const blocks = Array.isArray(row.blocks) ? row.blocks : [];
            blocks.forEach((blk) => fabricCells.push({
                kind: blk.kind || row.id || 'anon',
                heat: Number(blk.heat || 0),
                rowId: row.id,
                label: row.label || row.id
            }));
        });
        if (!fabricCells.length) {
            this.ctx.fillStyle = 'rgba(160, 210, 220, 0.7)';
            this.ctx.font = '11px "Share Tech Mono", monospace';
            this.ctx.fillText('no memory fabric data', viewX + 12, viewY + 40);
            if (hero) this.drawFabricHeroHud(viewX, viewY, viewW, viewH);
            return;
        }

        const weightedProcPool = [];
        processPressure.slice(0, 12).forEach((proc) => {
            const score = Math.max(1, Number(proc?.pressure_score || 0));
            const reps = Math.max(1, Math.min(7, Math.floor(score / 18) + 1));
            for (let i = 0; i < reps; i += 1) weightedProcPool.push(proc);
        });

        const centerX = viewX + viewW * 0.5;
        const centerY = viewY + viewH * 0.5;
        const hotspotPoints = [];
        const hotMask = new Uint8Array(rows * cols);
        const cellState = new Array(rows * cols);
        const bandSigma = rows * 0.16;
        const bandCenter = rows * 0.5;
        let hotCount = 0;
        const focusKind = this.fabricFocus?.kind || null;
        const focusRow = this.fabricFocus?.rowId || null;

        for (let ry = 0; ry < rows; ry++) {
            const dy = (ry - bandCenter) / Math.max(1, bandSigma);
            const band = Math.exp(-0.5 * dy * dy);
            const bandGate = 0.12 + band * 0.72;
            for (let cx = 0; cx < cols; cx++) {
                const src = fabricCells[(ry * cols + cx) % fabricCells.length];
                const n1 = Math.sin(cx * 0.31 + ry * 0.17 + this.tick * 0.0035);
                const n2 = Math.cos(cx * 0.11 - ry * 0.29 + this.tick * 0.002);
                const n3 = Math.sin((cx + ry * 3) * 0.19 + this.tick * 0.0012);
                const noise = (n1 + n2 + n3 + 3) / 6;
                const heat = Math.max(0, Math.min(1, src.heat * 0.78 + noise * 0.22));
                // Slow discrete drift of lit pattern (~every ~40 frames)
                const seed = ((cx + 13) * 73856093) ^ ((ry + 29) * 19349663) ^ (Math.floor(this.tick * 0.05) * 83492791);
                const rnd = ((seed >>> 0) % 10000) / 10000;
                const leftHot = cx > 0 && hotMask[ry * cols + cx - 1];
                const aboveHot = ry > 0 && hotMask[(ry - 1) * cols + cx];
                const clump = (leftHot ? 0.16 : 0) + (aboveHot ? 0.08 : 0);
                // Cream = pressure now (PSI / reclaim / local heat), not byte occupancy.
                const lit = rnd < (bandGate * (0.18 + heat * 0.36) + clump * 1.05 + usedLevel * 0.02 + pressureBoost);
                hotMask[ry * cols + cx] = lit ? 1 : 0;
                // depth layer: 0 far mass, 1 mid mass, 2 pressure hotspots
                let layer = 0;
                if (lit) layer = 2;
                else if (heat > 0.32 && band > 0.15) layer = 1;
                else if (rnd < 0.4) layer = 0;
                else layer = -1;
                if (lit) hotCount += 1;
                cellState[ry * cols + cx] = { src, heat, rnd, lit, layer, seed, band };
            }
        }

        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(viewX, viewY, viewW, viewH);
        this.ctx.clip();

        const rh = Math.max(2, Math.min(cellH - 2.2, cellW * 0.42));
        const ox = this.parallaxX * 0.12;
        const oy = this.parallaxY * 0.08;

        // Cold mass: short dashes snapped to the lattice. Not a third layer of grain.
        for (let ry = 0; ry < rows; ry++) {
            let cx = 0;
            while (cx < cols) {
                const st = cellState[ry * cols + cx];
                if (!st || st.layer !== 1 || st.lit) {
                    cx += 1;
                    continue;
                }
                const start = cx;
                let heat = st.heat;
                let run = 1;
                const want = 1 + ((st.seed >>> 8) % 3);
                while (run < want && cx + 1 < cols) {
                    const nxt = cellState[ry * cols + cx + 1];
                    if (!nxt || nxt.layer !== 1 || nxt.lit) break;
                    cx += 1;
                    run += 1;
                    heat = Math.max(heat, nxt.heat);
                }
                const related = focusKind
                    && (st.src.kind === focusKind || st.src.rowId === focusRow);
                const dimUnrelated = focusKind && !related;
                const px = viewX + start * cellW + 0.7;
                const py = viewY + ry * cellH + (cellH - rh) * 0.5;
                const a = (0.14 + heat * 0.2) * (dimUnrelated ? 0.28 : 1) * (related ? 1.25 : 1);
                this.ctx.fillStyle = this.fabricKindTint(st.src.kind, heat, a);
                this.ctx.fillRect(px, py, Math.max(2, run * cellW - 1.6), rh);
                cx += 1 + ((st.seed >>> 12) % 2);
            }
        }

        // Hot noise: merge neighbours into horizontal runs. Flynn clusters / cclabs streaks.
        for (let ry = 0; ry < rows; ry++) {
            let cx = 0;
            while (cx < cols) {
                const st = cellState[ry * cols + cx];
                if (!st || !st.lit) {
                    cx += 1;
                    continue;
                }
                const start = cx;
                let heat = st.heat;
                while (cx + 1 < cols && cellState[ry * cols + cx + 1] && cellState[ry * cols + cx + 1].lit) {
                    cx += 1;
                    heat = Math.max(heat, cellState[ry * cols + cx].heat);
                }
                const run = cx - start + 1;
                const related = focusKind
                    && (st.src.kind === focusKind || st.src.rowId === focusRow);
                const dimUnrelated = focusKind && !related;
                const px = viewX + start * cellW + ox + 0.6;
                const py = viewY + ry * cellH + oy + (cellH - rh) * 0.5;
                const usedW = Math.max(2, run * cellW - 1.2);
                const thr = thrashAtm * 0.25;
                const r = Math.floor(235 + 20 * heat);
                const g = Math.floor(240 + 12 * heat - thr * 30);
                const b = Math.floor(200 + 30 * heat + thr * 25);
                const bright = (0.72 + heat * 0.28) * (dimUnrelated ? 0.25 : 1);
                this.ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${bright.toFixed(3)})`;
                this.ctx.fillRect(px, py, usedW, rh);
                this.ctx.fillStyle = `rgba(255, 255, 230, ${(0.1 * bright).toFixed(3)})`;
                this.ctx.fillRect(px - 0.4, py - 0.4, usedW + 0.8, rh + 0.8);
                if (related) {
                    this.ctx.strokeStyle = 'rgba(255, 252, 220, 0.95)';
                    this.ctx.lineWidth = 1;
                    this.ctx.strokeRect(px + 0.5, py + 0.5, usedW - 1, rh - 1);
                }
                if (heat > 0.55 || run >= 3) {
                    hotspotPoints.push({ x: px + usedW * 0.5, y: py + rh * 0.5, heat });
                }
                for (let k = start; k <= cx; k += 1) {
                    const cell = cellState[ry * cols + k];
                    const procOwner = weightedProcPool.length
                        ? weightedProcPool[(Math.abs(k * 97 + ry * 53 + (cell.seed >>> 4)) % weightedProcPool.length)]
                        : null;
                    if (this.memoryFabricHits.length < 1200) {
                        this.memoryFabricHits.push({
                            x: viewX + k * cellW + ox, y: py, w: cellW, h: rh,
                            heat: cell.heat,
                            kind: cell.src.kind,
                            rowId: cell.src.rowId,
                            label: cell.src.label,
                            pid: procOwner ? Number(procOwner.pid || 0) : null,
                            name: procOwner ? String(procOwner.name || 'proc') : null,
                            role: procOwner ? String(procOwner.role || 'userspace') : null,
                            pressure_score: procOwner ? Number(procOwner.pressure_score || 0) : 0,
                            rss_mb: procOwner ? Number(procOwner.rss_mb || 0) : 0,
                            swap_mb: procOwner ? Number(procOwner.swap_mb || 0) : 0,
                            anon_mb: procOwner ? Number(procOwner.anon_mb || 0) : 0,
                            file_mb: procOwner ? Number(procOwner.file_mb || 0) : 0,
                            majflt: procOwner ? Number(procOwner.majflt || 0) : 0
                        });
                    }
                }
                cx += 1;
            }
        }
        this.ctx.restore();

        if (stallAtm > 0.18) {
            this.ctx.save();
            this.ctx.beginPath();
            this.ctx.rect(viewX, viewY, viewW, viewH);
            this.ctx.clip();
            const smearY = viewY + viewH * (0.44 + 0.02 * Math.sin(this.tick * 0.01));
            const smearH = viewH * (0.06 + stallAtm * 0.06);
            const smear = this.ctx.createLinearGradient(viewX, smearY, viewX, smearY + smearH);
            smear.addColorStop(0, 'rgba(230, 240, 180, 0)');
            smear.addColorStop(0.5, `rgba(230, 240, 180, ${(0.02 + stallAtm * 0.05).toFixed(3)})`);
            smear.addColorStop(1, 'rgba(230, 240, 180, 0)');
            this.ctx.fillStyle = smear;
            this.ctx.fillRect(viewX, smearY, viewW, smearH);
            this.ctx.restore();
        }

        if (hotspotPoints.length) {
            this.ctx.save();
            this.ctx.beginPath();
            this.ctx.rect(viewX, viewY, viewW, viewH);
            this.ctx.clip();
            this.ctx.globalCompositeOperation = 'lighter';
            hotspotPoints.forEach((p, i) => {
                if (i % 7 !== 0) return;
                const rr = 3 + p.heat * 6;
                const glow = this.ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
                glow.addColorStop(0, `rgba(255, 255, 230, ${(0.06 + p.heat * 0.1).toFixed(3)})`);
                glow.addColorStop(1, 'rgba(40, 120, 100, 0)');
                this.ctx.fillStyle = glow;
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
                this.ctx.fill();
            });
            this.ctx.restore();
        }

        // Numeric dust — real meminfo / PSI / reclaim, locked to the mid-band.
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(viewX, viewY, viewW, viewH);
        this.ctx.clip();
        const dustVals = [
            Number(summary.cached_mb || 0).toFixed(0),
            Number(summary.anon_mb || 0).toFixed(0),
            Number(summary.available_mb || 0).toFixed(0),
            Number(summary.slab_mb || 0).toFixed(0),
            psiSome.toFixed(1),
            psiFull.toFixed(1),
            Number(summary.used_percent || 0).toFixed(1),
            Number(summary.swap_percent || 0).toFixed(1),
            reclaimDelta > 0 ? String(Math.round(reclaimDelta)) : null,
            Number(summary.active_mb || 0).toFixed(0),
            Number(summary.inactive_mb || 0).toFixed(0)
        ].filter((v) => v !== null && v !== '0' && v !== '0.0');
        this.ctx.font = '7px "Share Tech Mono", monospace';
        this.ctx.textAlign = 'left';
        const dustN = Math.min(16, dustVals.length * 3);
        for (let i = 0; i < dustN; i++) {
            const seed = ((i + 7) * 1103515245 + Math.floor(this.tick * 0.02) * 12345) >>> 0;
            const nx = ((seed & 0xffff) / 0xffff) - 0.5;
            const ny = (((seed >>> 16) & 0xffff) / 0xffff) - 0.5;
            const dx = viewX + viewW * (0.5 + nx * 0.62);
            const dy = viewY + viewH * (0.5 + ny * 0.28);
            const a = 0.18 + ((seed >>> 8) % 20) / 100;
            this.ctx.fillStyle = `rgba(190, 220, 230, ${a.toFixed(3)})`;
            this.ctx.fillText(dustVals[i % dustVals.length], dx, dy);
        }
        this.ctx.restore();

        const vignette = this.ctx.createRadialGradient(centerX, centerY, Math.min(viewW, viewH) * 0.2, centerX, centerY, Math.max(viewW, viewH) * 0.75);
        vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
        vignette.addColorStop(0.7, 'rgba(0, 0, 0, 0.08)');
        vignette.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
        this.ctx.fillStyle = vignette;
        this.ctx.fillRect(viewX, viewY, viewW, viewH);

        // Brand top — hollow FLYNN-style + flanking micro status
        this.ctx.save();
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        const brandSize = Math.max(40, Math.min(78, Math.floor(viewW * 0.07)));
        const letters = ['M', 'E', 'M', 'O', 'R', 'Y'];
        const tracking = brandSize * 0.86;
        const brandW = tracking * (letters.length - 1);
        const brandY = viewY + 30 + brandSize * 0.12;
        const brandX0 = centerX - brandW * 0.5;
        this.ctx.font = `600 ${brandSize}px "Share Tech Mono", monospace`;
        letters.forEach((ch, i) => {
            const lx = brandX0 + i * tracking;
            this.ctx.lineWidth = 2;
            this.ctx.strokeStyle = 'rgba(220, 240, 245, 0.88)';
            this.ctx.strokeText(ch, lx, brandY);
            this.ctx.lineWidth = 0.9;
            this.ctx.strokeStyle = 'rgba(0, 220, 235, 0.4)';
            this.ctx.strokeText(ch, lx, brandY);
        });
        // flanking micro bars (like FLYNN header chrome)
        const flankY = brandY - 6;
        const flankW = 54;
        [[brandX0 - flankW - 28, true], [brandX0 + brandW + 28, false]].forEach(([fx, left]) => {
            for (let i = 0; i < 4; i++) {
                const bw = 10 + ((i * 17 + Math.floor(this.tick * 0.02)) % 28);
                const bx = left ? fx + 54 - bw : fx;
                this.ctx.fillStyle = i === 1 ? 'rgba(245, 248, 210, 0.55)' : 'rgba(0, 180, 200, 0.35)';
                this.ctx.fillRect(bx, flankY + i * 5, bw, 3);
            }
        });
        this.ctx.restore();
        this.ctx.textAlign = 'start';
        this.ctx.textBaseline = 'alphabetic';

        this.ctx.strokeStyle = 'rgba(0, 210, 220, 0.55)';
        this.ctx.lineWidth = 1;
        const cm = 14;
        this.ctx.beginPath();
        this.ctx.moveTo(viewX + 1, viewY + cm); this.ctx.lineTo(viewX + 1, viewY + 1); this.ctx.lineTo(viewX + cm, viewY + 1);
        this.ctx.moveTo(viewX + viewW - cm, viewY + 1); this.ctx.lineTo(viewX + viewW - 1, viewY + 1); this.ctx.lineTo(viewX + viewW - 1, viewY + cm);
        this.ctx.moveTo(viewX + 1, viewY + viewH - cm); this.ctx.lineTo(viewX + 1, viewY + viewH - 1); this.ctx.lineTo(viewX + cm, viewY + viewH - 1);
        this.ctx.moveTo(viewX + viewW - cm, viewY + viewH - 1); this.ctx.lineTo(viewX + viewW - 1, viewY + viewH - 1); this.ctx.lineTo(viewX + viewW - 1, viewY + viewH - cm);
        this.ctx.stroke();

        const hotPct = ((hotCount / Math.max(1, rows * cols)) * 100);
        this.ctx.fillStyle = 'rgba(0, 180, 195, 0.55)';
        this.ctx.font = '7px "Share Tech Mono", monospace';
        this.ctx.fillText(
            `nodes ${rows * cols} · pressure ${hotPct.toFixed(1)}% · psi ${psiSome.toFixed(2)}/${psiFull.toFixed(2)}`
                + (stallAtm > 0.15 ? ' · stall' : '')
                + (thrashAtm > 0.15 ? ' · thrash' : ''),
            viewX + 58,
            viewY + 14
        );

        if (reclaimDelta > 0) {
            this.ctx.save();
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.font = '11px "Share Tech Mono", monospace';
            const capY = viewY + viewH - (hero ? 118 : 36);
            this.ctx.fillStyle = 'rgba(160, 230, 235, 0.88)';
            this.ctx.fillText('reclaiming pages', centerX - 62, capY);
            this.ctx.fillStyle = 'rgba(236, 244, 200, 0.82)';
            this.ctx.fillText('in the background.', centerX + 78, capY);
            this.ctx.restore();
            this.ctx.textAlign = 'start';
            this.ctx.textBaseline = 'alphabetic';
        }

        // Field legend — what this plane means
        const legY = viewY + viewH - (hero ? 96 : 18);
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        this.ctx.fillRect(viewX + 8, legY - 11, Math.min(620, viewW - 16), 16);
        this.ctx.fillStyle = 'rgba(236, 244, 200, 0.85)';
        this.ctx.fillRect(viewX + 14, legY - 5, 8, 5);
        this.ctx.fillStyle = 'rgba(0, 160, 170, 0.75)';
        this.ctx.fillRect(viewX + 92, legY - 5, 8, 5);
        this.ctx.fillStyle = 'rgba(160, 200, 210, 0.8)';
        this.ctx.font = '7px "Share Tech Mono", monospace';
        this.ctx.fillText(
            'white = pressure   cyan = mass   tint = kind   click → story   ≠ byte / PFN map',
            viewX + 28,
            legY
        );

        if (hero) this.drawFabricHeroHud(viewX, viewY, viewW, viewH);
        if (this.fabricFocus) this.drawFabricKernelStory(viewX, viewY, viewW, viewH);

        const tip = this.memorySelectedCell || (this.memoryHoverCell?.pid ? this.memoryHoverCell : null);
        if (tip && tip.pid) {
            this.drawMemoryProcessTooltip(tip, viewX, viewY, viewW, viewH);
        } else if (this.memoryHoverCell && !this.fabricFocus) {
            // light kind hint near cursor
            this.ctx.fillStyle = 'rgba(180, 220, 230, 0.75)';
            this.ctx.font = '8px "Share Tech Mono", monospace';
            this.ctx.fillText(
                `${this.memoryHoverCell.kind} · click → dock story`,
                Math.min(viewX + viewW - 180, this.lastMouseX + 12),
                Math.min(viewY + viewH - 20, this.lastMouseY - 8)
            );
        }
    }

    drawFabricKernelStory(viewX, viewY, viewW, viewH) {
        const focus = this.fabricFocus;
        if (!focus) return;
        const story = this.getMemoryKindStory(focus.kind);
        const tw = Math.min(300, Math.max(240, viewW * 0.24));
        const th = 118;
        const tx = viewX + 62;
        const ty = viewY + 56;
        this.drawHudFrame(tx, ty, tw, th);
        this.ctx.fillStyle = 'rgba(236, 244, 200, 0.92)';
        this.ctx.font = '9px "Share Tech Mono", monospace';
        this.ctx.fillText(`STORY · ${story.title}`, tx + 12, ty + 16);
        this.ctx.fillStyle = 'rgba(160, 210, 220, 0.85)';
        this.ctx.font = '8px "Share Tech Mono", monospace';
        this.ctx.fillText(`bucket ${String(focus.label || focus.kind).slice(0, 28)}`, tx + 12, ty + 32);
        (story.lines || []).forEach((line, i) => {
            this.ctx.fillStyle = 'rgba(210, 230, 235, 0.9)';
            this.ctx.font = '9px "Share Tech Mono", monospace';
            this.ctx.fillText(String(line).slice(0, 42), tx + 12, ty + 50 + i * 14);
        });
        this.ctx.fillStyle = 'rgba(0, 200, 210, 0.65)';
        this.ctx.font = '7px "Share Tech Mono", monospace';
        this.ctx.fillText(story.ghost ? `kernel · ${story.ghost}` : 'click again to clear', tx + 12, ty + th - 12);
        if (story.ghost && typeof this.flashArchGhost === 'function') {
            // no-op on memory page — keep text only
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

    drawMemoryView(x, y, w, h, opts = {}) {
        this.memoryMapHit = null;
        this.memoryStripHits = [];
        const mv = this.telemetry?.memory_visual;
        const stripRows = Array.isArray(mv?.rows) ? mv.rows : [];
        const dock = Boolean(opts.dock);
        const titleH = dock ? 22 : 34;
        const focusTitle = this.fabricFocus
            ? `topology dock · focus ${String(this.fabricFocus.kind || '').slice(0, 18)}`
            : 'topology dock · kernel accounting';
        const title = dock
            ? focusTitle
            : 'memory topology strip · kernel accounting (not PFN map)';
        this.drawPanel(x, y, w, titleH, title, { alpha: 0.9 });

        const side = dock ? 0 : 42;
        const bottomH = dock ? 8 : 42;
        const pad = dock ? 4 : 6;
        const labelCol = dock ? 100 : 132;
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
        if (!dock) {
            this.drawMemorySidebarTron(Math.floor(x + pad), innerY, innerH, barL, 'SEG_A');
            this.drawMemorySidebarTron(Math.floor(x + w - pad - 38), innerY, innerH, barR, 'SEG_B');
        }

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

            const rowFocused = this.fabricFocus
                && (String(this.fabricFocus.rowId || '') === String(row.id || '')
                    || String(this.fabricFocus.kind || '') === String(row.id || '')
                    || (row.blocks || []).some((b) => b.kind === this.fabricFocus.kind));
            if (this.fabricFocus && !rowFocused) {
                this.ctx.globalAlpha = 0.28;
            } else {
                this.ctx.globalAlpha = 1;
            }
            if (rowFocused) {
                this.ctx.strokeStyle = 'rgba(236, 244, 200, 0.85)';
                this.ctx.lineWidth = 1.2;
                this.ctx.strokeRect(innerX + 1, ry + 0.5, innerW - 2, rowAreaH);
                this.ctx.fillStyle = 'rgba(236, 244, 200, 0.08)';
                this.ctx.fillRect(innerX + 1, ry + 0.5, innerW - 2, rowAreaH);
            }

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
                const kindFocused = this.fabricFocus && (
                    String(this.fabricFocus.kind) === String(kind)
                    || String(this.fabricFocus.rowId || '') === String(row.id || '')
                );
                this.ctx.fillStyle = this.tronHeatColorKind(kind, t);
                this.ctx.fillRect(px, py, pw, ph);
                if (t > 0.58 || kindFocused) {
                    this.ctx.fillStyle = kindFocused ? 'rgba(236, 244, 200, 0.35)' : 'rgba(255, 255, 235, 0.28)';
                    this.ctx.fillRect(px, py, pw, ph);
                }
                if (kindFocused) {
                    this.ctx.strokeStyle = 'rgba(236, 244, 200, 0.95)';
                    this.ctx.lineWidth = 1;
                    this.ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
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
            this.ctx.globalAlpha = 1;
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

        if (!dock) {
            this.ctx.fillStyle = 'rgba(0, 229, 255, 0.4)';
            this.ctx.font = '7px "Share Tech Mono", monospace';
            const base = innerY + innerH + 12;
            for (let k = 0; k < 8; k++) {
                const addr = 0xffff888000000000 + k * 0x2a00000;
                this.ctx.fillText(`0x${addr.toString(16).slice(0, 12)}`, x + pad + k * (Math.min(140, w / 8.2)), base);
            }
        }
    }

    drawScene() {
        if (!this.ctx || !this.canvas) return;
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.ctx.clearRect(0, 0, w, h);
        this.tick += 1;

        this.ctx.fillStyle = '#010305';
        this.ctx.fillRect(0, 0, w, h);
        const gmem = this.ctx.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.42, Math.max(w, h) * 0.7);
        gmem.addColorStop(0, 'rgba(0, 40, 48, 0.4)');
        gmem.addColorStop(0.55, 'rgba(0, 10, 14, 0.94)');
        gmem.addColorStop(1, '#000102');
        this.ctx.fillStyle = gmem;
        this.ctx.fillRect(0, 0, w, h);
        this.drawKernelHeader();

        const gap = 12;
        if (this.viewMode === 'fabric') {
            // Fabric-hero: full-bleed block field + thin accounting dock.
            const top = 32;
            const dockH = Math.max(72, Math.min(100, Math.floor(h * 0.1)));
            const fabricY = top;
            const fabricH = Math.max(300, h - fabricY - dockH - gap - 10);
            this.drawMemoryFabricView(gap, fabricY, w - gap * 2, fabricH, { hero: true });
            this.drawMemoryView(gap, fabricY + fabricH + gap, w - gap * 2, dockH, { dock: true });
        } else {
            const top = 40;
            const graphH = Math.max(260, h - top - 28);
            this.drawMemoryView(gap, top, w - gap * 2, graphH);
        }
    }

    animate() {
        if (!this.isActive) return;
        this.animationId = requestAnimationFrame(() => this.animate());
        this.drawScene();
    }

    activate() {
        this.isActive = true;
        try { window.__memoryViz = this; } catch (e) { /* ignore */ }
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
