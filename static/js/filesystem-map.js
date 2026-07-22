// Filesystem Block Map Visualization
// Version: 4

debugLog('🗂️ filesystem-map.js v4: Script loading...');

class FilesystemMapVisualization {
    constructor() {
        this.container = null;
        this.canvas = null;
        this.ctx = null;
        this.isActive = false;
        this.animationId = null;
        this.telemetryInterval = null;
        this.exitButton = null;
        this.overlayNodes = [];
        this.resizeHandler = null;
        this.keyHandler = null;
        this.telemetry = null;
        this.tick = 0;
        this.renderMode = 'occupancy';
        this.modeButtons = new Map();
        this.legendNode = null;
        this.infoNode = null;
        this.canvasClickHandler = null;
        this.canvasMouseMoveHandler = null;
        this.mountSortMode = 'size';
        this.sortModeButton = null;
        this.mountHitAreas = [];
        this.stageHitAreas = [];
        this.hoveredMountKey = null;
        this.selectedMountKey = null;
        this.drillScrim = null;
        this.drillPanel = null;
        this.wbHistory = [];
        this.fxScrim = null;
        this.fxCanvas = null;
        this.fxCtx = null;
        this.fxMode = null;
        this.fxRaf = null;
        this.fxW = 0;
        this.fxH = 0;
        this.hoveredStageId = null;
        this.ext4Data = null;
        this.jbd2Data = null;
        this.hotFilesData = null;
        this.pathWalkData = null;
        this.fxInterval = null;
        this.fxOpenTime = 0;
        this.fxHitAreas = [];
        this.fxHoverKey = null;
        this.stageOverlayMap = { vfs: 'ext4', pagecache: 'writeback', writeback: 'writeback', block: 'jbd2' };
    }

    _rr(ctx, x, y, w, h, r) {
        const radius = Math.max(0, Math.min(r, w / 2, h / 2));
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + w - radius, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
        ctx.lineTo(x + w, y + h - radius);
        ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
        ctx.lineTo(x + radius, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    }

    init(containerId = 'filesystem-map-container') {
        const existing = document.getElementById(containerId);
        if (existing) {
            this.container = existing;
        } else {
            this.container = document.createElement('div');
            this.container.id = containerId;
            this.container.style.cssText = `
                position: fixed;
                inset: 0;
                width: 100%;
                height: 100%;
                background: #090d14;
                z-index: 9999;
                display: none;
                visibility: hidden;
                pointer-events: none;
                overflow: hidden;
            `;
            document.body.appendChild(this.container);
        }

        this.canvas = document.createElement('canvas');
        this.canvas.style.cssText = `
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
        `;
        this.container.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');
        this.canvasClickHandler = (event) => this.onCanvasClick(event);
        this.canvasMouseMoveHandler = (event) => this.onCanvasMouseMove(event);
        this.canvas.addEventListener('click', this.canvasClickHandler);
        this.canvas.addEventListener('mousemove', this.canvasMouseMoveHandler);

        this.createOverlayUI();
        this.addExitButton();

        this.keyHandler = (event) => {
            if (event.key !== 'Escape') return;
            if (this.fxMode) this.closeFx();
            else if (this.selectedMountKey) this.closeMountDrilldown();
        };
        window.addEventListener('keydown', this.keyHandler);

        this.resizeHandler = () => this.onResize();
        window.addEventListener('resize', this.resizeHandler);
        this.onResize();
        return true;
    }

    createOverlayUI() {
        const title = document.createElement('div');
        title.style.cssText = `
            position: absolute;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            color: #c8ccd4;
            font-family: 'Share Tech Mono', monospace;
            font-size: 24px;
            letter-spacing: 1px;
            z-index: 1001;
        `;
        title.textContent = 'FILESYSTEM · VFS WRITE PATH';
        this.container.appendChild(title);
        this.overlayNodes.push(title);

        const legend = document.createElement('div');
        legend.style.cssText = `
            position: absolute;
            top: 72px;
            left: 50%;
            transform: translateX(-50%);
            color: #9aa2aa;
            font-family: 'Share Tech Mono', monospace;
            font-size: 11px;
            z-index: 1001;
        `;
        legend.textContent = 'live write path: VFS → page cache (dirty) → writeback → block/IO → device  ·  real mounts below';
        this.container.appendChild(legend);
        this.overlayNodes.push(legend);
        this.legendNode = legend;

        const modePanel = document.createElement('div');
        modePanel.style.cssText = `
            position: absolute;
            top: 72px;
            right: 22px;
            display: flex;
            gap: 6px;
            z-index: 1001;
        `;
        const modes = [
            { key: 'occupancy', label: 'USED %' },
            { key: 'inode', label: 'INODE %' },
            { key: 'write', label: 'I/O' }
        ];
        modes.forEach((item) => {
            const btn = document.createElement('button');
            btn.textContent = item.label;
            btn.style.cssText = `
                padding: 4px 8px;
                background: rgba(12, 18, 28, 0.9);
                border: 1px solid rgba(130, 148, 172, 0.35);
                color: #9fb0c8;
                font-family: 'Share Tech Mono', monospace;
                font-size: 9px;
                letter-spacing: 0.3px;
                cursor: pointer;
            `;
            btn.onclick = () => this.setRenderMode(item.key);
            modePanel.appendChild(btn);
            this.modeButtons.set(item.key, btn);
            this.overlayNodes.push(btn);
        });
        this.container.appendChild(modePanel);
        this.overlayNodes.push(modePanel);
        this.setRenderMode(this.renderMode);

        const sortBtn = document.createElement('button');
        sortBtn.textContent = 'SORT: SIZE';
        sortBtn.style.cssText = `
            position: absolute;
            top: 72px;
            left: 22px;
            padding: 4px 8px;
            background: rgba(12, 18, 28, 0.9);
            border: 1px solid rgba(130, 148, 172, 0.35);
            color: #9fb0c8;
            font-family: 'Share Tech Mono', monospace;
            font-size: 9px;
            letter-spacing: 0.3px;
            cursor: pointer;
            z-index: 1001;
        `;
        sortBtn.onclick = () => this.cycleMountSortMode();
        this.container.appendChild(sortBtn);
        this.overlayNodes.push(sortBtn);
        this.sortModeButton = sortBtn;
        this.updateSortModeButtonState();

        // Path caption + explore tools: one centered stack above the pipeline
        // (same axis as page title / path band — not a random side float).
        const featureRow = document.createElement('div');
        featureRow.style.cssText = `
            position: absolute;
            top: 152px;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
            z-index: 1001;
            pointer-events: auto;
        `;
        const pathCaption = document.createElement('div');
        pathCaption.textContent = 'WRITE PATH  ·  application → disk';
        pathCaption.style.cssText = `
            color: rgba(150, 178, 206, 0.82);
            font-family: 'Share Tech Mono', monospace;
            font-size: 10px;
            letter-spacing: 0.6px;
            user-select: none;
            white-space: nowrap;
        `;
        featureRow.appendChild(pathCaption);

        const exploreRow = document.createElement('div');
        exploreRow.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
        `;
        [['LIVE WRITERS', 'hotfiles'], ['PATH WALK', 'pathwalk']].forEach(([label, mode]) => {
            const b = document.createElement('button');
            b.textContent = `▸ ${label}`;
            b.style.cssText = `
                min-width: 132px;
                padding: 6px 12px;
                background: rgba(16, 28, 42, 0.92);
                border: 1px solid rgba(127, 194, 255, 0.55);
                color: #d3e7ff;
                font-family: 'Share Tech Mono', monospace;
                font-size: 10px;
                letter-spacing: 0.45px;
                cursor: pointer;
                text-align: center;
            `;
            b.onmouseenter = () => {
                b.style.borderColor = 'rgba(255, 176, 96, 0.85)';
                b.style.color = '#ffe6c8';
                b.style.background = 'rgba(28, 36, 48, 0.95)';
            };
            b.onmouseleave = () => {
                b.style.borderColor = 'rgba(127, 194, 255, 0.55)';
                b.style.color = '#d3e7ff';
                b.style.background = 'rgba(16, 28, 42, 0.92)';
            };
            b.onclick = () => this.openFx(mode);
            exploreRow.appendChild(b);
            this.overlayNodes.push(b);
        });
        featureRow.appendChild(exploreRow);
        this.container.appendChild(featureRow);
        this.overlayNodes.push(featureRow);
        this.featureRow = featureRow;
        this.layoutFeatureRow();

        const info = document.createElement('div');
        info.style.cssText = `
            position: absolute;
            bottom: 14px;
            left: 50%;
            transform: translateX(-50%);
            color: #a9aeb5;
            font-family: 'Share Tech Mono', monospace;
            font-size: 10px;
            z-index: 1001;
            opacity: 0.9;
            max-width: 90vw;
            text-align: center;
            white-space: nowrap;
        `;
        this.container.appendChild(info);
        this.overlayNodes.push(info);
        this.infoNode = info;

        // ---- Per-mount drill-down overlay (click a mount to inspect) --------
        const scrim = document.createElement('div');
        scrim.style.cssText = `
            position: absolute;
            inset: 0;
            z-index: 1200;
            display: none;
            pointer-events: auto;
            background: radial-gradient(ellipse at 50% 46%, rgba(8,12,20,0.62) 0%, rgba(6,9,15,0.86) 62%, rgba(4,6,11,0.94) 100%);
            backdrop-filter: blur(1.5px);
            font-family: 'Share Tech Mono', monospace;
        `;
        const panel = document.createElement('div');
        panel.style.cssText = `
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            width: min(640px, 80vw);
            background: rgba(11, 16, 26, 0.96);
            border: 1px solid rgba(103, 190, 224, 0.4);
            border-radius: 8px;
            box-shadow: 0 18px 60px rgba(0, 0, 0, 0.6);
            color: #cdd6e0;
            overflow: hidden;
        `;
        scrim.appendChild(panel);
        this.container.appendChild(scrim);
        this.overlayNodes.push(scrim);
        this.drillScrim = scrim;
        this.drillPanel = panel;
        scrim.addEventListener('click', (e) => {
            if (e.target === scrim) this.closeMountDrilldown();
        });

        // ---- Feature overlay (animated canvas: writeback / ext4 / jbd2) -----
        const fxScrim = document.createElement('div');
        fxScrim.style.cssText = `
            position: absolute;
            inset: 0;
            z-index: 1300;
            display: none;
            pointer-events: auto;
            background: radial-gradient(ellipse at 50% 46%, rgba(8,12,20,0.6) 0%, rgba(6,9,15,0.88) 60%, rgba(4,6,11,0.96) 100%);
            backdrop-filter: blur(2px);
            font-family: 'Share Tech Mono', monospace;
        `;
        const fxWrap = document.createElement('div');
        fxWrap.style.cssText = 'position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);';
        const fxCanvas = document.createElement('canvas');
        fxCanvas.style.cssText = 'display:block; border-radius:10px; box-shadow:0 20px 70px rgba(0,0,0,0.6);';
        const fxClose = document.createElement('div');
        fxClose.textContent = '✕';
        fxClose.style.cssText = `
            position:absolute; top:12px; right:12px; width:28px; height:28px;
            border:1px solid rgba(160,170,190,0.4); border-radius:5px;
            display:flex; align-items:center; justify-content:center;
            color:#c8ccd4; cursor:pointer; font-size:14px; z-index:2;
        `;
        fxWrap.appendChild(fxCanvas);
        fxWrap.appendChild(fxClose);
        fxScrim.appendChild(fxWrap);
        this.container.appendChild(fxScrim);
        this.overlayNodes.push(fxScrim);
        fxClose.onclick = () => this.closeFx();
        fxScrim.addEventListener('click', (e) => {
            if (e.target === fxScrim) this.closeFx();
        });
        this.fxScrim = fxScrim;
        this.fxCanvas = fxCanvas;
        this.fxCtx = fxCanvas.getContext('2d');
        fxCanvas.addEventListener('click', (e) => this.onFxClick(e));
        fxCanvas.addEventListener('mousemove', (e) => this.onFxMove(e));
    }

    onFxClick(event) {
        const rect = this.fxCanvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        for (const hit of this.fxHitAreas) {
            if (x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h) {
                if ((hit.action === 'pathwalk' || hit.action === 'ext4') && hit.path) this.openFx(hit.action, hit.path);
                return;
            }
        }
    }

    onFxMove(event) {
        const rect = this.fxCanvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        let over = null;
        for (const hit of this.fxHitAreas) {
            if (x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h) { over = hit; break; }
        }
        this.fxHoverKey = over ? over.key : null;
        this.fxCanvas.style.cursor = over ? 'pointer' : 'default';
    }

    addExitButton() {
        if (this.exitButton && this.exitButton.parentNode) {
            this.exitButton.parentNode.removeChild(this.exitButton);
        }
        const btn = document.createElement('button');
        btn.textContent = 'EXIT VIEW';
        btn.style.cssText = `
            position: absolute;
            top: 20px;
            right: 20px;
            padding: 10px 20px;
            background: rgba(12, 18, 28, 0.9);
            border: 1px solid rgba(160, 170, 190, 0.35);
            color: #c8ccd4;
            font-family: 'Share Tech Mono', monospace;
            font-size: 12px;
            cursor: pointer;
            z-index: 1001;
            transition: all 0.25s ease;
        `;
        btn.onmouseenter = () => {
            btn.style.background = 'rgba(20, 26, 36, 0.95)';
            btn.style.color = '#fff';
        };
        btn.onmouseleave = () => {
            btn.style.background = 'rgba(12, 18, 28, 0.9)';
            btn.style.color = '#c8ccd4';
        };
        btn.onclick = () => {
            if (window.kernelContextMenu) {
                window.kernelContextMenu.deactivateViews();
            } else {
                // Standalone page (e.g. /linux-filesystem-subsystem): go home like
                // the other subsystem pages instead of leaving a blank view.
                window.location.assign('/');
            }
        };
        this.container.appendChild(btn);
        this.exitButton = btn;
    }

    fetchTelemetry() {
        return window.fetchJson('/api/filesystem-blocks', { cache: 'no-store' }, {
            timeoutMs: 6000,
            suppressToast: true,
            context: 'filesystem-blocks'
        })
            .then((data) => {
                if (!data || data.error) {
                    throw new Error(data?.error || 'No filesystem data');
                }
                this.telemetry = data;
                const wb = data.writeback;
                if (wb) {
                    this.wbHistory.push({ dirty: Number(wb.dirty_mb || 0), wb: Number(wb.writeback_mb || 0), t: Date.now() });
                    if (this.wbHistory.length > 240) this.wbHistory.shift();
                }
                const m = data.meta || {};
                if (this.infoNode) {
                    this.infoNode.textContent =
                        `used ${(m.used_gb || 0).toFixed(1)}/${(m.total_gb || 0).toFixed(1)} GB (${m.used_percent || 0}%)` +
                        ` · free ${(m.free_gb || 0).toFixed(1)} GB` +
                        ` · write ${(m.write_mb_s || 0).toFixed(2)} MB/s` +
                        ` · dirty ${(m.dirty_mb || 0).toFixed(1)} MB` +
                        ` · inode(/) ${(m.inode_percent || 0).toFixed(1)}%` +
                        ` · mounts ${m.mount_count || 0}`;
                }
                if (this.selectedMountKey) this.refreshMountDrilldown();
            })
            .catch((err) => {
                if (this.infoNode) {
                    this.infoNode.textContent = `filesystem telemetry fallback: ${err.message}`;
                }
            });
    }

    drawRoundedRect(x, y, w, h, r) {
        const ctx = this.ctx;
        const radius = Math.max(0, Math.min(r, w / 2, h / 2));
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + w - radius, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
        ctx.lineTo(x + w, y + h - radius);
        ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
        ctx.lineTo(x + radius, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    }

    setRenderMode(modeKey) {
        this.renderMode = ['occupancy', 'write', 'inode'].includes(modeKey) ? modeKey : 'occupancy';
        this.modeButtons.forEach((btn, key) => {
            const active = key === this.renderMode;
            btn.style.background = active ? 'rgba(34, 58, 88, 0.92)' : 'rgba(12, 18, 28, 0.9)';
            btn.style.borderColor = active ? 'rgba(129, 180, 255, 0.9)' : 'rgba(130, 148, 172, 0.35)';
            btn.style.color = active ? '#d3e7ff' : '#9fb0c8';
        });
        if (this.legendNode) {
            this.legendNode.textContent = this.renderMode === 'write'
                ? 'mount bars colored by I/O throughput  ·  click a mount to inspect'
                : (this.renderMode === 'inode'
                    ? 'mount bars colored by inode usage  ·  click a mount to inspect'
                    : 'live write path above  ·  mount bars colored by used space  ·  click a mount to inspect');
        }
    }

    mountSortValue(mnt, mode) {
        if (mode === 'used') return Number(mnt.used_percent || 0);
        if (mode === 'io') return Number(mnt.write_bps || 0) + Number(mnt.read_bps || 0);
        return Number(mnt.total_gb || 0);
    }

    cycleMountSortMode() {
        const order = ['size', 'used', 'io'];
        const idx = order.indexOf(this.mountSortMode);
        this.mountSortMode = order[(idx + 1) % order.length];
        this.updateSortModeButtonState();
    }

    updateSortModeButtonState() {
        if (!this.sortModeButton) return;
        const mode = this.mountSortMode || 'size';
        const label = mode === 'used' ? 'USED' : (mode === 'io' ? 'I/O' : 'SIZE');
        this.sortModeButton.textContent = `SORT: ${label}`;
        this.sortModeButton.style.background = 'rgba(29, 43, 62, 0.92)';
        this.sortModeButton.style.borderColor = 'rgba(127, 194, 255, 0.7)';
        this.sortModeButton.style.color = '#dbf0ff';
    }

    mountBarValue(mnt) {
        const mode = this.renderMode;
        if (mode === 'inode') {
            const p = Number(mnt.inode_percent || 0);
            const f = Math.max(0, Math.min(1, p / 100));
            return {
                frac: f,
                color: p > 85 ? 'rgba(255,149,158,0.9)' : (p > 60 ? 'rgba(255,206,127,0.9)' : 'rgba(118,220,255,0.85)'),
                label: `inode ${p.toFixed(1)}%`
            };
        }
        if (mode === 'write') {
            const io = Number(mnt.write_bps || 0) + Number(mnt.read_bps || 0);
            const f = Math.max(0.02, Math.min(1, io / (20 * 1024 * 1024)));
            return { frac: f, color: 'rgba(255,206,127,0.9)', label: `io ${(io / 1024).toFixed(0)} KB/s` };
        }
        const p = Number(mnt.used_percent || 0);
        const f = Math.max(0, Math.min(1, p / 100));
        return {
            frac: f,
            color: p > 85 ? 'rgba(255,149,158,0.9)' : (p > 70 ? 'rgba(255,206,127,0.9)' : 'rgba(118,220,255,0.85)'),
            label: `used ${p.toFixed(1)}%`
        };
    }

    getMountHitAt(x, y) {
        for (const hit of this.mountHitAreas) {
            if (x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h) return hit;
        }
        return null;
    }

    onCanvasClick(event) {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const stage = this.getStageHitAt(x, y);
        if (stage && this.stageOverlayMap[stage.id]) {
            this.openFx(this.stageOverlayMap[stage.id]);
            return;
        }
        const hit = this.getMountHitAt(x, y);
        if (hit) this.openMountDrilldown(hit.key);
    }

    onCanvasMouseMove(event) {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const stage = this.getStageHitAt(x, y);
        const stageClickable = stage && !!this.stageOverlayMap[stage.id];
        this.hoveredStageId = stageClickable ? stage.id : null;
        const hit = stageClickable ? null : this.getMountHitAt(x, y);
        this.hoveredMountKey = hit ? hit.key : null;
        this.canvas.style.cursor = (stageClickable || hit) ? 'pointer' : 'default';
    }

    drawScene() {
        if (!this.ctx || !this.canvas) return;
        const ctx = this.ctx;
        const w = window.innerWidth;
        const h = window.innerHeight;
        ctx.clearRect(0, 0, w, h);
        this.tick += 1;
        ctx.fillStyle = '#090d14';
        ctx.fillRect(0, 0, w, h);

        this.mountHitAreas = [];
        this.stageHitAreas = [];

        const t = this.telemetry;
        if (!t) return;
        const m = t.meta || {};
        const wp = t.writepath || { stages: [], hot: 'block' };
        const mounts = Array.isArray(t.mounts) ? t.mounts : [];

        // ---- KPI row (real telemetry) ------------------------------------
        const kpis = [
            { label: 'USED /', value: `${Number(m.used_percent || 0).toFixed(1)}%`, tone: Number(m.used_percent || 0) >= 85 ? '#ff9ca6' : '#8fd8ff' },
            { label: 'WRITE', value: `${Number(m.write_mb_s || 0).toFixed(1)} MB/s`, tone: Number(m.write_mb_s || 0) >= 80 ? '#ffd08d' : '#8ff3c0' },
            { label: 'DIRTY', value: `${Number(m.dirty_mb || 0).toFixed(1)} MB`, tone: Number(m.dirty_mb || 0) >= 128 ? '#ffd08d' : '#8fd8ff' },
            { label: 'INODE /', value: `${Number(m.inode_percent || 0).toFixed(1)}%`, tone: Number(m.inode_percent || 0) >= 80 ? '#ff9ca6' : '#8fd8ff' }
        ];
        kpis.forEach((kpi, idx) => {
            const kx = 26 + idx * 150;
            const ky = 98;
            this.drawRoundedRect(kx, ky, 136, 44, 6);
            ctx.fillStyle = 'rgba(10, 16, 24, 0.74)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(122, 142, 168, 0.32)';
            ctx.lineWidth = 0.9;
            ctx.stroke();
            ctx.fillStyle = 'rgba(159, 177, 201, 0.84)';
            ctx.font = '8px "Share Tech Mono", monospace';
            ctx.fillText(kpi.label, kx + 10, ky + 14);
            ctx.fillStyle = kpi.tone;
            ctx.font = '13px "Share Tech Mono", monospace';
            ctx.fillText(kpi.value, kx + 10, ky + 32);
        });

        this.drawWritePath(w, h, wp);
        this.drawMountMap(w, h, mounts);
    }

    drawWritePath(w, h, wp) {
        const ctx = this.ctx;
        const stages = Array.isArray(wp.stages) ? wp.stages : [];
        if (!stages.length) return;
        const n = stages.length;
        // Slightly lower than before so stage labels clear the centered
        // WRITE PATH / explore stack under the KPI row.
        const bandY = Math.floor(h * 0.35);
        const x0 = Math.floor(w * 0.14);
        const x1 = Math.floor(w * 0.86);
        const span = Math.max(1, x1 - x0);
        const xs = stages.map((_, i) => x0 + (n > 1 ? span * i / (n - 1) : span / 2));
        const writeBps = Number(wp.write_bps || 0);
        const flow = Math.max(0.05, Math.min(1, writeBps / (20 * 1024 * 1024)));

        // Segments with flowing particles (density/brightness ~ write rate).
        for (let i = 0; i < n - 1; i += 1) {
            const ax = xs[i] + 22;
            const bx = xs[i + 1] - 22;
            ctx.beginPath();
            ctx.moveTo(ax, bandY);
            ctx.lineTo(bx, bandY);
            ctx.strokeStyle = 'rgba(90, 130, 175, 0.32)';
            ctx.lineWidth = 1.4;
            ctx.stroke();
            const segLen = bx - ax;
            const count = 3;
            for (let k = 0; k < count; k += 1) {
                const phase = ((this.tick * (0.004 + flow * 0.02) + k / count) % 1);
                const px = ax + segLen * phase;
                ctx.beginPath();
                ctx.arc(px, bandY, 2.2, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(150, 226, 255, ${(0.22 + flow * 0.6).toFixed(3)})`;
                ctx.fill();
            }
        }

        // Stage nodes.
        stages.forEach((s, i) => {
            const nx = xs[i];
            const ny = bandY;
            const norm = Math.max(0, Math.min(1, Number(s.norm || 0)));
            const isHot = s.id === wp.hot;
            const R = 18 + norm * 10;
            if (isHot) {
                const g = ctx.createRadialGradient(nx, ny, R * 0.4, nx, ny, R * 2);
                g.addColorStop(0, 'rgba(255, 200, 120, 0.34)');
                g.addColorStop(1, 'rgba(255, 200, 120, 0)');
                ctx.beginPath();
                ctx.arc(nx, ny, R * 2, 0, Math.PI * 2);
                ctx.fillStyle = g;
                ctx.fill();
            }
            ctx.beginPath();
            ctx.arc(nx, ny, R, 0, Math.PI * 2);
            ctx.fillStyle = isHot ? 'rgba(38, 30, 18, 0.95)' : 'rgba(14, 24, 36, 0.95)';
            ctx.fill();
            ctx.strokeStyle = isHot ? 'rgba(255, 196, 112, 0.95)' : 'rgba(103, 170, 214, 0.8)';
            ctx.lineWidth = isHot ? 2 : 1.2;
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(nx, ny, Math.max(2, R * norm), 0, Math.PI * 2);
            ctx.fillStyle = isHot ? 'rgba(255, 196, 112, 0.5)' : 'rgba(103, 190, 224, 0.4)';
            ctx.fill();

            ctx.textAlign = 'center';
            ctx.fillStyle = isHot ? '#ffd08d' : '#bcd4ea';
            ctx.font = '10px "Share Tech Mono", monospace';
            ctx.fillText(s.label, nx, ny - R - 10);
            ctx.fillStyle = 'rgba(150, 176, 204, 0.92)';
            ctx.font = '9px "Share Tech Mono", monospace';
            ctx.fillText(String(s.value || ''), nx, ny + R + 16);
            ctx.textAlign = 'left';

            // "inspect" hint on stages that open a deep-dive overlay.
            if (this.stageOverlayMap[s.id]) {
                ctx.fillStyle = this.hoveredStageId === s.id ? 'rgba(255,208,141,0.95)' : 'rgba(120,150,180,0.6)';
                ctx.font = '7.5px "Share Tech Mono", monospace';
                ctx.textAlign = 'center';
                ctx.fillText('▸ inspect', nx, ny + R + 28);
                ctx.textAlign = 'left';
            }
            this.stageHitAreas.push({ x: nx - R - 6, y: ny - R - 6, w: (R + 6) * 2, h: (R + 6) * 2, id: s.id });
        });
    }

    getStageHitAt(x, y) {
        for (const hit of this.stageHitAreas) {
            if (x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h) return hit;
        }
        return null;
    }

    drawMountMap(w, h, mounts) {
        const ctx = this.ctx;
        const colW = Math.min(940, Math.floor(w * 0.68));
        const x = Math.floor((w - colW) / 2);
        let y = Math.floor(h * 0.5);

        ctx.fillStyle = 'rgba(150,178,206,0.85)';
        ctx.font = '11px "Share Tech Mono", monospace';
        ctx.fillText(`MOUNTS · ${mounts.length}   (sorted by ${String(this.mountSortMode).toUpperCase()})`, x, y);
        y += 16;

        if (!mounts.length) {
            ctx.fillStyle = 'rgba(140,160,182,0.7)';
            ctx.font = '10px "Share Tech Mono", monospace';
            ctx.fillText('no mounted filesystems reported', x, y + 14);
            return;
        }

        const sorted = mounts.slice().sort((a, b) => this.mountSortValue(b, this.mountSortMode) - this.mountSortValue(a, this.mountSortMode));
        const rowH = 44;
        const gap = 8;
        const maxRows = Math.max(1, Math.floor((h - y - 46) / (rowH + gap)));

        sorted.slice(0, maxRows).forEach((mnt) => {
            const key = mnt.mountpoint;
            const hovered = this.hoveredMountKey === key;
            const selected = this.selectedMountKey === key;

            this.drawRoundedRect(x, y, colW, rowH, 6);
            ctx.fillStyle = selected ? 'rgba(20,34,52,0.95)' : (hovered ? 'rgba(16,26,40,0.95)' : 'rgba(11,18,28,0.9)');
            ctx.fill();
            ctx.strokeStyle = selected ? 'rgba(149,207,255,0.9)' : (hovered ? 'rgba(122,182,245,0.7)' : 'rgba(72,94,124,0.4)');
            ctx.lineWidth = selected ? 1.4 : 0.9;
            ctx.stroke();

            ctx.fillStyle = '#d3e7ff';
            ctx.font = '12px "Share Tech Mono", monospace';
            ctx.fillText(mnt.mountpoint, x + 12, y + 19);
            ctx.fillStyle = 'rgba(140,164,190,0.8)';
            ctx.font = '8.5px "Share Tech Mono", monospace';
            ctx.fillText(`${mnt.fstype} · ${mnt.device}`, x + 12, y + 34);

            const barX = x + 250;
            const barW = colW - 250 - 168;
            const barY = y + 11;
            const barH = 12;
            ctx.fillStyle = 'rgba(30,44,60,0.85)';
            this.drawRoundedRect(barX, barY, barW, barH, 3);
            ctx.fill();
            const bv = this.mountBarValue(mnt);
            this.drawRoundedRect(barX, barY, Math.max(2, barW * bv.frac), barH, 3);
            ctx.fillStyle = bv.color;
            ctx.fill();
            ctx.fillStyle = 'rgba(150,176,204,0.85)';
            ctx.font = '8px "Share Tech Mono", monospace';
            ctx.fillText(bv.label, barX, y + 37);

            ctx.textAlign = 'right';
            ctx.fillStyle = '#cfe0f0';
            ctx.font = '11px "Share Tech Mono", monospace';
            ctx.fillText(`${Number(mnt.used_gb || 0).toFixed(1)} / ${Number(mnt.total_gb || 0).toFixed(1)} GB`, x + colW - 12, y + 19);
            const io = Number(mnt.write_bps || 0) + Number(mnt.read_bps || 0);
            ctx.fillStyle = 'rgba(150,176,204,0.85)';
            ctx.font = '8.5px "Share Tech Mono", monospace';
            ctx.fillText(`inode ${Number(mnt.inode_percent || 0).toFixed(1)}%  ·  io ${(io / 1024).toFixed(0)} KB/s`, x + colW - 12, y + 34);
            ctx.textAlign = 'left';

            this.mountHitAreas.push({ x, y, w: colW, h: rowH, key });
            y += rowH + gap;
        });

        if (sorted.length > maxRows) {
            ctx.fillStyle = 'rgba(140,160,182,0.6)';
            ctx.font = '9px "Share Tech Mono", monospace';
            ctx.fillText(`+ ${sorted.length - maxRows} more`, x, y + 12);
        }
    }

    // ---- Drill-down overlay -------------------------------------------------
    fsTypeNote(fstype) {
        const notes = {
            ext4: 'Journaling filesystem. Inodes are fixed at mkfs time, so you can exhaust inodes while bytes remain free.',
            xfs: 'High-performance journaling filesystem with dynamic inode allocation.',
            btrfs: 'Copy-on-write filesystem with snapshots, checksums and dynamic inodes.',
            vfat: 'FAT filesystem (typically the EFI boot partition). No Unix permissions or inode concept.',
            iso9660: 'Read-only optical/image filesystem.',
            overlay: 'Union mount used for container layers (lowerdir + upperdir).',
            tmpfs: 'RAM-backed filesystem; contents are volatile and vanish on reboot.',
            zfs: 'Pooled copy-on-write filesystem with checksums and snapshots.'
        };
        return notes[fstype] || 'Mounted filesystem.';
    }

    openMountDrilldown(key) {
        if (!this.drillScrim || !this.drillPanel) return;
        this.selectedMountKey = key;
        this.refreshMountDrilldown();
        this.drillScrim.style.display = 'block';
    }

    refreshMountDrilldown() {
        if (!this.drillPanel || !this.selectedMountKey) return;
        const mounts = (this.telemetry && this.telemetry.mounts) || [];
        const mnt = mounts.find((x) => x.mountpoint === this.selectedMountKey);
        if (!mnt) return;
        const usedPct = Number(mnt.used_percent || 0);
        const inodePct = Number(mnt.inode_percent || 0);
        const usedCol = usedPct >= 90 ? 'rgba(232,96,104,0.95)' : (usedPct >= 75 ? 'rgba(230,193,90,0.95)' : 'rgba(103,190,224,0.95)');
        const inodeCol = inodePct >= 85 ? 'rgba(232,96,104,0.95)' : (inodePct >= 60 ? 'rgba(230,193,90,0.95)' : 'rgba(103,190,224,0.95)');
        const io = Number(mnt.write_bps || 0) + Number(mnt.read_bps || 0);
        const card = (k, v, sub, col) => `
            <div style="background:rgba(8,12,20,0.7); border:1px solid rgba(96,110,128,0.32); border-radius:4px; padding:8px 10px;">
                <div style="font-size:8.5px; letter-spacing:0.6px; color:#7f93a6; text-transform:uppercase;">${k}</div>
                <div style="font-size:18px; color:${col || '#e2edf5'}; line-height:1.15; margin-top:2px;">${v}</div>
                ${sub ? `<div style="font-size:8px; color:#728697; margin-top:1px;">${sub}</div>` : ''}
            </div>`;
        const watchBits = [];
        if (usedPct >= 90) watchBits.push('space is nearly full — writes may start failing.');
        if (inodePct >= 85) watchBits.push('inodes nearly exhausted — new files can fail even with free bytes.');
        const watch = watchBits.length
            ? `<div style="margin-top:12px; font-size:10.5px; line-height:1.55; color:#9db6c8; border-left:2px solid rgba(230,193,90,0.6); padding-left:9px;"><span style="color:#e6c15a;">WATCH · </span>${watchBits.join(' ')}</div>`
            : '';
        const html = `
            <div style="display:flex; align-items:center; gap:12px; padding:14px 18px; border-bottom:1px solid rgba(103,190,224,0.25); background:linear-gradient(90deg, rgba(103,190,224,0.10), rgba(103,190,224,0));">
                <div style="flex:1 1 auto;">
                    <div style="font-size:8px; letter-spacing:1.4px; color:#6f8597;">MOUNT · ${(mnt.fstype || '').toUpperCase()}</div>
                    <div style="font-size:20px; letter-spacing:1px; color:#e8f2f9;">${mnt.mountpoint}</div>
                    <div style="font-size:9px; color:#8ba0b2; margin-top:2px;">${mnt.device}</div>
                </div>
                <div class="ns-ov-close" style="flex:none; cursor:pointer; width:26px; height:26px; border:1px solid rgba(160,170,190,0.4); border-radius:4px; display:flex; align-items:center; justify-content:center; color:#c8ccd4; font-size:14px;">✕</div>
            </div>
            <div style="padding:14px 18px 16px;">
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:8px; margin-bottom:14px;">
                    ${card('SPACE USED', `${usedPct.toFixed(1)}%`, `${Number(mnt.used_gb || 0).toFixed(1)} / ${Number(mnt.total_gb || 0).toFixed(1)} GB`, usedCol)}
                    ${card('FREE', `${Number(mnt.free_gb || 0).toFixed(1)} GB`, 'available', null)}
                    ${card('INODES USED', `${inodePct.toFixed(1)}%`, `${Number(mnt.inode_used || 0).toLocaleString()} / ${Number(mnt.inode_total || 0).toLocaleString()}`, inodeCol)}
                    ${card('I/O', `${(io / 1024).toFixed(0)} KB/s`, `wr ${(Number(mnt.write_bps || 0) / 1024).toFixed(0)} · rd ${(Number(mnt.read_bps || 0) / 1024).toFixed(0)} KB/s`, null)}
                </div>
                <div style="font-size:11.5px; line-height:1.6; color:#c2cede;">${this.fsTypeNote(mnt.fstype)} Space (bytes) and inodes (file/dir slots) are tracked separately by <b style="color:#a9d4e8">statvfs</b> — an inode shortage and a byte shortage are two different ways to run out.</div>
                ${watch}
            </div>`;
        window.setSafeHtml(this.drillPanel, html);
        const closeBtn = this.drillPanel.querySelector('.ns-ov-close');
        if (closeBtn) closeBtn.addEventListener('click', () => this.closeMountDrilldown());
    }

    closeMountDrilldown() {
        this.selectedMountKey = null;
        if (this.drillScrim) this.drillScrim.style.display = 'none';
    }

    // ---- Feature overlay (animated) ----------------------------------------
    openFx(mode, arg) {
        if (!this.fxScrim || !this.fxCanvas) return;
        this.fxMode = mode;
        this.fxHitAreas = [];
        this.fxHoverKey = null;
        const W = Math.min(1040, Math.floor(window.innerWidth * 0.86));
        const H = Math.min(624, Math.floor(window.innerHeight * 0.82));
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.fxCanvas.width = Math.floor(W * dpr);
        this.fxCanvas.height = Math.floor(H * dpr);
        this.fxCanvas.style.width = `${W}px`;
        this.fxCanvas.style.height = `${H}px`;
        this.fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.fxW = W;
        this.fxH = H;
        this.fxScrim.style.display = 'block';
        this.fxOpenTime = Date.now();
        if (this.fxInterval) { clearInterval(this.fxInterval); this.fxInterval = null; }
        if (mode === 'ext4') this.fetchExt4(arg);
        if (mode === 'jbd2') this.fetchJbd2();
        if (mode === 'pathwalk') this.fetchPathWalk(arg);
        if (mode === 'hotfiles') {
            this.fetchHotFiles();
            this.fxInterval = setInterval(() => { if (this.fxMode === 'hotfiles') this.fetchHotFiles(); }, 1300);
        }
        if (this.fxRaf) cancelAnimationFrame(this.fxRaf);
        this.fxAnimate();
    }

    fetchHotFiles() {
        window.fetchJson('/api/hot-files', { cache: 'no-store' }, {
            timeoutMs: 6000, suppressToast: true, context: 'hot-files'
        })
            .then((d) => { this.hotFilesData = d || { writers: [] }; })
            .catch((e) => { this.hotFilesData = { writers: [], error: e.message }; });
    }

    fetchPathWalk(targetPath) {
        this.pathWalkData = null;
        const url = targetPath
            ? `/api/path-walk?path=${encodeURIComponent(targetPath)}`
            : '/api/path-walk';
        window.fetchJson(url, { cache: 'no-store' }, {
            timeoutMs: 6000, suppressToast: true, context: 'path-walk'
        })
            .then((d) => { this.pathWalkData = d || { steps: [] }; })
            .catch((e) => { this.pathWalkData = { steps: [], error: e.message }; });
    }

    fetchExt4(targetPath) {
        this.ext4Data = null;
        const url = targetPath
            ? `/api/ext4-anatomy?path=${encodeURIComponent(targetPath)}`
            : '/api/ext4-anatomy';
        window.fetchJson(url, { cache: 'no-store' }, {
            timeoutMs: 6000, suppressToast: true, context: 'ext4-anatomy'
        })
            .then((d) => { this.ext4Data = d || { available: false, reason: 'empty' }; })
            .catch((e) => { this.ext4Data = { available: false, reason: e.message }; });
    }

    fetchJbd2() {
        this.jbd2Data = null;
        window.fetchJson('/api/ext4-journal', { cache: 'no-store' }, {
            timeoutMs: 6000, suppressToast: true, context: 'ext4-journal'
        })
            .then((d) => { this.jbd2Data = d || { available: false, reason: 'empty' }; })
            .catch((e) => { this.jbd2Data = { available: false, reason: e.message }; });
    }

    closeFx() {
        this.fxMode = null;
        if (this.fxRaf) {
            cancelAnimationFrame(this.fxRaf);
            this.fxRaf = null;
        }
        if (this.fxInterval) {
            clearInterval(this.fxInterval);
            this.fxInterval = null;
        }
        if (this.fxScrim) this.fxScrim.style.display = 'none';
    }

    fxAnimate() {
        if (!this.fxScrim || this.fxScrim.style.display === 'none') return;
        this.fxRaf = requestAnimationFrame(() => this.fxAnimate());
        const ctx = this.fxCtx;
        const W = this.fxW;
        const H = this.fxH;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = 'rgba(11, 16, 26, 0.98)';
        this._rr(ctx, 0, 0, W, H, 10);
        ctx.fill();
        ctx.strokeStyle = 'rgba(103, 190, 224, 0.35)';
        ctx.lineWidth = 1;
        this._rr(ctx, 0.5, 0.5, W - 1, H - 1, 10);
        ctx.stroke();
        if (this.fxMode === 'writeback') this.drawFxWriteback(ctx, W, H);
        else if (this.fxMode === 'ext4') this.drawFxExt4(ctx, W, H);
        else if (this.fxMode === 'jbd2') this.drawFxJbd2(ctx, W, H);
        else if (this.fxMode === 'hotfiles') this.drawFxHotfiles(ctx, W, H);
        else if (this.fxMode === 'pathwalk') this.drawFxPathwalk(ctx, W, H);
    }

    drawFxHotfiles(ctx, W, H) {
        const FM = '"Share Tech Mono", monospace';
        const pad = 26;
        const now = Date.now();
        this.fxHitAreas = [];
        const d = this.hotFilesData;
        const meta = (this.telemetry && this.telemetry.meta) || {};
        ctx.textAlign = 'left';
        ctx.fillStyle = '#e8f2f9';
        ctx.font = `18px ${FM}`;
        ctx.fillText('LIVE WRITERS · who is touching the filesystem now', pad, 32);
        if (!d) {
            ctx.fillStyle = 'rgba(150,178,206,0.75)';
            ctx.font = `12px ${FM}`;
            ctx.fillText('sampling /proc/*/io …', pad, 64);
            return;
        }
        ctx.fillStyle = 'rgba(150,178,206,0.72)';
        ctx.font = `10px ${FM}`;
        const scope = d.source === 'collector'
            ? `system-wide (root collector) · ${d.accessible_procs || 0} processes`
            : `same-uid only (user ${d.visible_user || '?'}) · ${d.accessible_procs || 0} readable`;
        ctx.fillText(`${scope}  ·  system write ${(meta.write_mb_s || 0).toFixed(2)} MB/s`, pad, 50);

        const writers = Array.isArray(d.writers) ? d.writers : [];
        const listY = 74;
        const listH = H - listY - 92;
        if (!writers.length) {
            ctx.fillStyle = 'rgba(255,206,127,0.85)';
            ctx.font = `11px ${FM}`;
            ctx.fillText('no active writers visible to this user right now (root/other-uid processes are hidden)', pad, listY + 24);
        } else {
            let maxW = 1;
            writers.forEach((w) => { maxW = Math.max(maxW, w.write_bps + w.disk_write_bps); });
            const rowH = Math.min(46, Math.max(34, listH / writers.length));
            writers.forEach((w, i) => {
                const ry = listY + i * rowH;
                if (ry + rowH > listY + listH) return;
                const total = w.write_bps + w.disk_write_bps;
                const frac = Math.max(0.01, Math.min(1, total / maxW));
                const clickable = Array.isArray(w.files) && w.files.length > 0;
                const hovered = this.fxHoverKey === w.pid;
                if (clickable) {
                    this.fxHitAreas.push({ x: pad, y: ry, w: W - pad * 2, h: rowH, key: w.pid, action: 'pathwalk', path: w.files[0] });
                    if (hovered) {
                        ctx.fillStyle = 'rgba(118,220,255,0.08)';
                        this._rr(ctx, pad - 6, ry + 2, W - pad * 2 + 12, rowH - 4, 5);
                        ctx.fill();
                    }
                }
                // bar
                const barX = pad + 250;
                const barW = W - pad - barX - 8;
                ctx.fillStyle = 'rgba(24,34,48,0.85)';
                this._rr(ctx, barX, ry + 8, barW, rowH - 18, 4);
                ctx.fill();
                ctx.fillStyle = 'rgba(118,220,255,0.8)';
                this._rr(ctx, barX, ry + 8, barW * frac, rowH - 18, 4);
                ctx.fill();
                // labels
                ctx.fillStyle = '#dbeafe';
                ctx.font = `12px ${FM}`;
                ctx.fillText(`${i + 1}. ${w.name}`, pad, ry + 18);
                ctx.fillStyle = 'rgba(140,164,190,0.8)';
                ctx.font = `8px ${FM}`;
                ctx.fillText(`pid ${w.pid} · ${w.user}`, pad, ry + 31);
                // rate on bar
                ctx.fillStyle = '#e8f2f9';
                ctx.font = `10px ${FM}`;
                const rateTxt = `${this._fmtRate(w.write_bps)}/s wchar` + (w.disk_write_bps > 1 ? ` · ${this._fmtRate(w.disk_write_bps)}/s disk` : '');
                ctx.fillText(rateTxt, barX + 6, ry + 20);
                // files + walk hint
                if (clickable) {
                    ctx.fillStyle = 'rgba(150,178,206,0.7)';
                    ctx.font = `8px ${FM}`;
                    ctx.fillText(w.files[0].length > 84 ? '…' + w.files[0].slice(-82) : w.files[0], barX + 6, ry + rowH - 4);
                    ctx.fillStyle = hovered ? 'rgba(143,243,192,0.95)' : 'rgba(120,150,180,0.65)';
                    ctx.font = `8px ${FM}`;
                    ctx.textAlign = 'right';
                    ctx.fillText('▸ walk path', W - pad - 4, ry + rowH - 4);
                    ctx.textAlign = 'left';
                }
            });
        }

        const ex = [
            '/proc/<pid>/io exposes per-process I/O: wchar = bytes handed to write()/pwrite() (may land in the page cache), write_bytes = bytes',
            'actually issued to the block device. A process can show high wchar but near-zero disk writes — that is writeback doing its job.',
            'Unprivileged readers see only same-uid processes, so root daemons and nginx are hidden here unless the app runs as root.'
        ];
        ctx.fillStyle = 'rgba(178,196,214,0.9)';
        ctx.font = `9.5px ${FM}`;
        let ey = H - 60;
        ex.forEach((line) => { ctx.fillText(line, pad, ey); ey += 15; });
    }

    _fmtRate(bps) {
        if (bps >= 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(1)} MB`;
        if (bps >= 1024) return `${(bps / 1024).toFixed(1)} KB`;
        return `${bps.toFixed(0)} B`;
    }

    drawFxPathwalk(ctx, W, H) {
        const FM = '"Share Tech Mono", monospace';
        const pad = 26;
        const now = Date.now();
        this.fxHitAreas = [];
        const d = this.pathWalkData;
        ctx.textAlign = 'left';
        ctx.fillStyle = '#e8f2f9';
        ctx.font = `18px ${FM}`;
        ctx.fillText('PATH RESOLUTION · walking the dentry cache', pad, 32);
        if (!d) {
            ctx.fillStyle = 'rgba(150,178,206,0.75)';
            ctx.font = `12px ${FM}`;
            ctx.fillText('resolving path …', pad, 64);
            return;
        }
        ctx.fillStyle = 'rgba(150,178,206,0.72)';
        ctx.font = `10px ${FM}`;
        ctx.fillText(`${d.path}  ·  ${d.depth} components`, pad, 50);

        const steps = Array.isArray(d.steps) ? d.steps : [];
        const startY = 84;
        const rowGap = Math.min(58, Math.max(40, (H - startY - 96) / Math.max(1, steps.length)));
        const nodeW = 340;
        const typeIcon = { dir: '📁', file: '📄', symlink: '🔗' };

        steps.forEach((s, i) => {
            const revealT = Math.max(0, Math.min(1, (now - this.fxOpenTime - i * 150) / 240));
            if (revealT <= 0) return;
            const indent = pad + 20 + i * 26;
            const y = startY + i * rowGap;
            const nh = 40;
            // connector from previous
            if (i > 0) {
                const pIndent = pad + 20 + (i - 1) * 26;
                ctx.strokeStyle = `rgba(118,220,255,${(0.5 * revealT).toFixed(3)})`;
                ctx.lineWidth = 1.3;
                ctx.beginPath();
                ctx.moveTo(pIndent + 14, y - rowGap + nh);
                ctx.lineTo(pIndent + 14, y + nh / 2);
                ctx.lineTo(indent, y + nh / 2);
                ctx.stroke();
                // travelling lookup pulse
                const pp = ((now * 0.001 + i * 0.2) % 1);
                const py = (y - rowGap + nh) + ((y + nh / 2) - (y - rowGap + nh)) * pp;
                ctx.beginPath();
                ctx.arc(pIndent + 14, py, 2, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(150,226,255,${(0.8 * revealT).toFixed(3)})`;
                ctx.fill();
            }
            ctx.save();
            ctx.globalAlpha = revealT;
            const scale = 0.9 + 0.1 * revealT;
            const isLast = i === steps.length - 1;
            const clickable = isLast && s.type === 'file' && !s.error;
            const hovered = clickable && this.fxHoverKey === 'ext4-file';
            const nw = nodeW * scale;
            if (clickable && revealT >= 1) {
                this.fxHitAreas.push({ x: indent, y, w: nw, h: nh, key: 'ext4-file', action: 'ext4', path: d.path });
            }
            const col = s.error ? [232, 120, 120] : (s.type === 'dir' ? [118, 220, 255] : (s.type === 'symlink' ? [200, 170, 255] : [143, 243, 192]));
            ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${hovered ? 0.20 : 0.10})`;
            this._rr(ctx, indent, y, nw, nh, 6);
            ctx.fill();
            ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${isLast ? 0.95 : 0.6})`;
            ctx.lineWidth = isLast ? 1.6 : 1;
            this._rr(ctx, indent, y, nw, nh, 6);
            ctx.stroke();
            ctx.fillStyle = '#e8f2f9';
            ctx.font = `13px ${FM}`;
            ctx.fillText(`${typeIcon[s.type] || '·'} ${s.name}`, indent + 12, y + 18);
            ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},0.95)`;
            ctx.font = `9px ${FM}`;
            const detail = s.error ? `ENOENT: ${s.error}` : `inode #${s.inode}  ${s.mode_str || ''}` + (s.size_kb != null ? `  ${s.size_kb} KB` : '') + (s.target ? `  → ${s.target}` : '');
            ctx.fillText(detail, indent + 12, y + 32);
            if (clickable) {
                ctx.fillStyle = hovered ? 'rgba(143,243,192,0.98)' : 'rgba(143,243,192,0.72)';
                ctx.font = `10px ${FM}`;
                ctx.textAlign = 'right';
                ctx.fillText('▸ inode & extents', indent + nw - 12, y + 24);
                ctx.textAlign = 'left';
            }
            ctx.restore();
        });

        // ---- dcache stats panel (right) ----
        const dc = d.dentry_state || {};
        const px = W - 300;
        const pyy = 84;
        ctx.fillStyle = 'rgba(16,26,40,0.9)';
        this._rr(ctx, px, pyy, 274, 150, 8);
        ctx.fill();
        ctx.strokeStyle = 'rgba(118,220,255,0.45)';
        ctx.lineWidth = 1;
        this._rr(ctx, px, pyy, 274, 150, 8);
        ctx.stroke();
        ctx.fillStyle = '#8fd8ff';
        ctx.font = `12px ${FM}`;
        ctx.fillText('DENTRY CACHE (system)', px + 14, pyy + 22);
        const dstat = (label, value, yy, col) => {
            ctx.fillStyle = 'rgba(127,147,166,0.9)';
            ctx.font = `8px ${FM}`;
            ctx.fillText(label, px + 14, yy);
            ctx.fillStyle = col || '#e2edf5';
            ctx.font = `15px ${FM}`;
            ctx.fillText(value, px + 14, yy + 17);
        };
        dstat('TOTAL DENTRIES', `${(dc.nr_dentry || 0).toLocaleString()}`, pyy + 44, '#dbeafe');
        dstat('ACTIVE (in use)', `${(dc.active || 0).toLocaleString()}`, pyy + 84, '#8ff3c0');
        dstat('CACHED / UNUSED', `${(dc.nr_unused || 0).toLocaleString()}`, pyy + 124, '#ffd08d');

        const ex = [
            'To open a path the kernel walks it component by component. For each name it looks up a dentry (directory entry) in the dcache — an',
            'in-memory hash keyed by (parent, name). A hit returns the child dentry → inode instantly; a miss triggers a real directory read and',
            'inserts a new dentry. "Negative" dentries even cache non-existent names, so repeated failed lookups stay cheap. Cached-but-unused',
            'dentries are kept on an LRU and reclaimed under memory pressure — which is why a warm path opens far faster than a cold one.'
        ];
        ctx.fillStyle = 'rgba(178,196,214,0.9)';
        ctx.font = `9.5px ${FM}`;
        let ey = H - 62;
        ex.forEach((line) => { ctx.fillText(line, pad, ey); ey += 14; });
    }

    drawFxJbd2(ctx, W, H) {
        const FM = '"Share Tech Mono", monospace';
        const pad = 26;
        const now = Date.now();
        const d = this.jbd2Data;
        ctx.textAlign = 'left';
        ctx.fillStyle = '#e8f2f9';
        ctx.font = `18px ${FM}`;
        ctx.fillText('jbd2 · JOURNALING & DURABILITY', pad, 32);
        if (!d) {
            ctx.fillStyle = 'rgba(150,178,206,0.75)';
            ctx.font = `12px ${FM}`;
            ctx.fillText('reading journal state…', pad, 64);
            return;
        }
        if (!d.available) {
            ctx.fillStyle = 'rgba(255,156,166,0.9)';
            ctx.font = `12px ${FM}`;
            ctx.fillText(`unavailable: ${d.reason || 'unknown'}`, pad, 64);
            return;
        }
        const j = d.jbd2 || {};
        ctx.fillStyle = 'rgba(150,178,206,0.72)';
        ctx.font = `10px ${FM}`;
        ctx.fillText(`${d.device}  ·  data=${d.mode}  ·  ${d.jbd2_device || 'jbd2'}`, pad, 50);

        // ---- Transaction lifecycle cycle (left) ----
        const cx = pad + 150;
        const cy = 200;
        const R = 92;
        const phases = [
            { id: 'running', label: 'RUNNING', sub: `${(j.avg_running_ms || 0).toFixed(0)}ms`, col: [118, 220, 255] },
            { id: 'committing', label: 'COMMITTING', sub: `${(j.commit_time_ms || 0).toFixed(2)}ms`, col: [255, 206, 127] },
            { id: 'checkpoint', label: 'CHECKPOINT', sub: 'flush + free', col: [143, 243, 192] }
        ];
        const trav = (now * 0.00018) % 1;
        const curPhase = Math.min(2, Math.floor(trav * 3));
        ctx.fillStyle = 'rgba(150,178,206,0.7)';
        ctx.font = `10px ${FM}`;
        ctx.textAlign = 'center';
        ctx.fillText('TRANSACTION LIFECYCLE', cx, cy - R - 24);
        ctx.textAlign = 'left';
        // ring
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(90,120,150,0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
        // travelling marker
        const ma = -Math.PI / 2 + trav * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(ma) * R, cy + Math.sin(ma) * R, 4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(150,226,255,0.95)';
        ctx.fill();
        phases.forEach((p, i) => {
            const a = -Math.PI / 2 + i * (Math.PI * 2 / 3);
            const nx = cx + Math.cos(a) * R;
            const ny = cy + Math.sin(a) * R;
            const active = i === curPhase;
            const pulse = active ? (0.6 + 0.4 * (0.5 + 0.5 * Math.sin(now * 0.006))) : 0.4;
            ctx.beginPath();
            ctx.arc(nx, ny, active ? 26 : 22, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${p.col[0]},${p.col[1]},${p.col[2]},${(0.12 + (active ? 0.18 : 0)).toFixed(3)})`;
            ctx.fill();
            ctx.strokeStyle = `rgba(${p.col[0]},${p.col[1]},${p.col[2]},${pulse.toFixed(3)})`;
            ctx.lineWidth = active ? 2 : 1.1;
            ctx.stroke();
            ctx.fillStyle = `rgb(${p.col[0]},${p.col[1]},${p.col[2]})`;
            ctx.font = `9px ${FM}`;
            ctx.textAlign = 'center';
            ctx.fillText(p.label, nx, ny - 2);
            ctx.fillStyle = 'rgba(200,214,228,0.85)';
            ctx.font = `8px ${FM}`;
            ctx.fillText(p.sub, nx, ny + 10);
            ctx.textAlign = 'left';
        });

        // ---- Metrics column (right of cycle) ----
        const sx = cx + R + 60;
        let sy = 96;
        const stat = (label, value, col) => {
            ctx.fillStyle = 'rgba(127,147,166,0.9)';
            ctx.font = `8px ${FM}`;
            ctx.fillText(label, sx, sy);
            ctx.fillStyle = col || '#e2edf5';
            ctx.font = `14px ${FM}`;
            ctx.fillText(value, sx, sy + 16);
            sy += 32;
        };
        stat('JOURNAL MODE', `data=${d.mode}`, d.mode === 'journal' ? '#8ff3c0' : (d.mode === 'writeback' ? '#ffd08d' : '#8fd8ff'));
        stat('TRANSACTIONS COMMITTED', `${(j.transactions || 0).toLocaleString()}`, '#8fd8ff');
        stat('AVG COMMIT TIME', `${(j.commit_time_ms || 0).toFixed(2)} ms`, '#ffd08d');
        stat('AVG RUNNING WINDOW', `${(j.avg_running_ms || 0).toFixed(0)} ms`, '#cfe0f0');
        stat('BLOCKS / TXN (logged)', `${j.blocks_per_txn || 0} (${j.logged_blocks_per_txn || 0})`, '#cfe0f0');
        stat('HANDLES / TXN', `${j.handles_per_txn || 0}  ·  max ${(j.max_blocks_per_txn || 0).toLocaleString()} blk`, '#a9d4e8');

        // ---- Durability ladder (bottom) ----
        const lY = 316;
        ctx.fillStyle = 'rgba(150,178,206,0.72)';
        ctx.font = `11px ${FM}`;
        ctx.fillText('DURABILITY LADDER · what survives a power cut at each stage', pad, lY);
        const steps = [
            { t: 'write()', s: 'copied into page cache; syscall returns immediately', durable: false },
            { t: 'dirty page', s: 'in RAM only, not yet on disk', durable: false },
            { t: 'fsync / commit', s: 'jbd2 writes journal + barrier/FUA flush to platter', durable: true },
            { t: 'checkpoint', s: 'data at final location; journal space freed', durable: true }
        ];
        const sw = (W - pad * 2 - (steps.length - 1) * 40) / steps.length;
        const stepY = lY + 18;
        const stepH = 92;
        steps.forEach((st, i) => {
            const stx = pad + i * (sw + 40);
            const col = st.durable ? [143, 243, 192] : [232, 120, 120];
            ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},0.10)`;
            this._rr(ctx, stx, stepY, sw, stepH, 6);
            ctx.fill();
            ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},0.7)`;
            ctx.lineWidth = 1.1;
            this._rr(ctx, stx, stepY, sw, stepH, 6);
            ctx.stroke();
            ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
            ctx.font = `12px ${FM}`;
            ctx.fillText(st.t, stx + 12, stepY + 24);
            ctx.fillStyle = st.durable ? 'rgba(143,243,192,0.9)' : 'rgba(255,170,170,0.9)';
            ctx.font = `8px ${FM}`;
            ctx.fillText(st.durable ? '✓ DURABLE' : '✗ VOLATILE', stx + 12, stepY + 40);
            ctx.fillStyle = 'rgba(200,214,228,0.85)';
            ctx.font = `8.5px ${FM}`;
            this._wrapText(ctx, st.s, stx + 12, stepY + 58, sw - 20, 12);
            // arrow + flowing marker to next
            if (i < steps.length - 1) {
                const ax0 = stx + sw;
                const ax1 = stx + sw + 40;
                const ay = stepY + stepH / 2;
                ctx.strokeStyle = 'rgba(150,178,206,0.5)';
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.moveTo(ax0 + 3, ay);
                ctx.lineTo(ax1 - 6, ay);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(ax1 - 6, ay - 4);
                ctx.lineTo(ax1 - 1, ay);
                ctx.lineTo(ax1 - 6, ay + 4);
                ctx.stroke();
                const fp = ((now * 0.0009) % 1);
                ctx.beginPath();
                ctx.arc(ax0 + 3 + (ax1 - ax0 - 9) * fp, ay, 2, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(150,226,255,0.9)';
                ctx.fill();
            }
        });
        // durability boundary marker between step 2 and 3
        const boundaryX = pad + 2 * (sw + 40) - 20;
        ctx.strokeStyle = 'rgba(143,243,192,0.5)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(boundaryX, stepY - 4);
        ctx.lineTo(boundaryX, stepY + stepH + 16);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(143,243,192,0.85)';
        ctx.font = `8px ${FM}`;
        ctx.textAlign = 'center';
        ctx.fillText('crash-safe boundary', boundaryX, stepY + stepH + 14);
        ctx.textAlign = 'left';

        // ---- Explainer ----
        const ex = [
            `In data=${d.mode} mode, jbd2 batches many operations into one transaction, then commits it atomically to the journal with a barrier/FUA`,
            'flush before touching the real filesystem. If power is lost mid-write, on reboot the journal is replayed: committed transactions are',
            'redone, incomplete ones discarded — so metadata (and in data=journal, file data too) never ends up half-written. fsync() forces the',
            "current transaction to commit now, which is why it's the durability guarantee databases rely on."
        ];
        ctx.fillStyle = 'rgba(178,196,214,0.9)';
        ctx.font = `9.5px ${FM}`;
        let ey = H - 62;
        ex.forEach((line) => { ctx.fillText(line, pad, ey); ey += 14; });
    }

    _wrapText(ctx, text, x, y, maxW, lh) {
        const words = String(text).split(' ');
        let line = '';
        let yy = y;
        words.forEach((wd) => {
            const test = line ? line + ' ' + wd : wd;
            if (ctx.measureText(test).width > maxW && line) {
                ctx.fillText(line, x, yy);
                line = wd;
                yy += lh;
            } else {
                line = test;
            }
        });
        if (line) ctx.fillText(line, x, yy);
    }

    drawFxExt4(ctx, W, H) {
        const FM = '"Share Tech Mono", monospace';
        const pad = 26;
        const now = Date.now();
        const d = this.ext4Data;
        ctx.textAlign = 'left';
        ctx.fillStyle = '#e8f2f9';
        ctx.font = `18px ${FM}`;
        ctx.fillText('ext4 · FILE ANATOMY', pad, 32);

        if (!d) {
            ctx.fillStyle = 'rgba(150,178,206,0.75)';
            ctx.font = `12px ${FM}`;
            ctx.fillText('resolving inode…', pad, 64);
            return;
        }
        if (!d.available) {
            ctx.fillStyle = 'rgba(255,156,166,0.9)';
            ctx.font = `12px ${FM}`;
            ctx.fillText(`unavailable: ${d.reason || 'unknown'}`, pad, 64);
            return;
        }

        ctx.fillStyle = 'rgba(150,178,206,0.72)';
        ctx.font = `10px ${FM}`;
        ctx.fillText(`${d.path}   ·   ${d.fstype}`, pad, 50);

        // ---- INODE card (left) ----
        const cardX = pad;
        const cardY = 72;
        const cardW = 262;
        const cardH = H - 72 - 168;
        ctx.fillStyle = 'rgba(16,26,40,0.92)';
        this._rr(ctx, cardX, cardY, cardW, cardH, 8);
        ctx.fill();
        ctx.strokeStyle = 'rgba(118,220,255,0.55)';
        ctx.lineWidth = 1.2;
        this._rr(ctx, cardX, cardY, cardW, cardH, 8);
        ctx.stroke();
        ctx.fillStyle = '#8fd8ff';
        ctx.font = `13px ${FM}`;
        ctx.fillText(`INODE #${d.inode}`, cardX + 14, cardY + 24);
        ctx.fillStyle = 'rgba(150,178,206,0.6)';
        ctx.font = `8px ${FM}`;
        ctx.fillText('the on-disk metadata object', cardX + 14, cardY + 38);
        const irow = (label, value, yy, col) => {
            ctx.fillStyle = 'rgba(127,147,166,0.9)';
            ctx.font = `8.5px ${FM}`;
            ctx.fillText(label, cardX + 14, yy);
            ctx.fillStyle = col || '#dbeafe';
            ctx.font = `11px ${FM}`;
            ctx.fillText(value, cardX + 120, yy);
        };
        let iy = cardY + 62;
        const step = Math.max(20, Math.min(26, (cardH - 70) / 9));
        irow('mode', `${d.mode_str}`, iy, '#a9d4e8'); iy += step;
        irow('perm', `${d.mode_octal}`, iy); iy += step;
        irow('owner', `${d.uid}:${d.gid}`, iy); iy += step;
        irow('links', `${d.nlink}`, iy); iy += step;
        irow('size', `${d.size_kb} KB`, iy, '#8fd8ff'); iy += step;
        irow('512-blocks', `${d.blocks_512}`, iy); iy += step;
        irow('fs blocks', `${d.fs_blocks} × ${d.block_size}B`, iy, '#ffd08d'); iy += step;
        irow('mtime', `${(d.mtime || '').replace('T', ' ')}`, iy); iy += step;
        irow('ctime', `${(d.ctime || '').replace('T', ' ')}`, iy);

        // ---- EXTENT TREE (center/right) ----
        const exX = cardX + cardW + 40;
        const exW = W - pad - exX;
        const exY = cardY;
        ctx.fillStyle = '#ffd08d';
        ctx.font = `13px ${FM}`;
        ctx.fillText(`EXTENT TREE · ${d.extent_count} extent${d.extent_count === 1 ? '' : 's'}${d.fragmented ? ' (fragmented)' : ' (contiguous)'}`, exX, exY + 16);
        ctx.fillStyle = 'rgba(150,178,206,0.6)';
        ctx.font = `8.5px ${FM}`;
        ctx.fillText('inode → extent header → [ logical block range ] maps to [ physical block range ]', exX, exY + 30);

        const extents = Array.isArray(d.extents) ? d.extents : [];
        // Animated connector from inode card to the extent list.
        const linkY = exY + 52;
        ctx.strokeStyle = 'rgba(118,220,255,0.5)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(cardX + cardW, cardY + 40);
        ctx.bezierCurveTo(cardX + cardW + 20, cardY + 40, exX - 20, linkY, exX, linkY);
        ctx.stroke();
        const cp = (now * 0.0004) % 1;
        const cpx = (cardX + cardW) + (exX - (cardX + cardW)) * cp;
        const cpy = (cardY + 40) + (linkY - (cardY + 40)) * cp;
        ctx.beginPath();
        ctx.arc(cpx, cpy, 2.4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(150,226,255,0.95)';
        ctx.fill();

        if (!extents.length) {
            ctx.fillStyle = 'rgba(255,206,127,0.85)';
            ctx.font = `10px ${FM}`;
            ctx.fillText(d.filefrag_available ? 'no extents reported' : 'filefrag not available on host — extent map hidden', exX, linkY + 26);
        }

        const rowH = 30;
        const maxRows = Math.max(1, Math.floor((H - 172 - linkY) / rowH));
        const shown = extents.slice(0, maxRows);
        const extentRowY = [];
        shown.forEach((e, i) => {
            const ry = linkY + 14 + i * rowH;
            extentRowY.push({ y: ry + rowH / 2, e });
            const hot = ((now * 0.001) % shown.length | 0) === i;
            ctx.fillStyle = hot ? 'rgba(40,34,20,0.95)' : 'rgba(20,28,40,0.9)';
            this._rr(ctx, exX, ry, exW, rowH - 6, 5);
            ctx.fill();
            ctx.strokeStyle = hot ? 'rgba(255,206,127,0.9)' : 'rgba(90,120,150,0.4)';
            ctx.lineWidth = hot ? 1.4 : 0.8;
            this._rr(ctx, exX, ry, exW, rowH - 6, 5);
            ctx.stroke();
            ctx.fillStyle = 'rgba(127,147,166,0.9)';
            ctx.font = `8px ${FM}`;
            ctx.fillText(`#${i}`, exX + 8, ry + 15);
            ctx.fillStyle = '#a9d4e8';
            ctx.font = `10px ${FM}`;
            ctx.fillText(`logical ${e.logical}‥${e.logical + e.length - 1}`, exX + 34, ry + 16);
            ctx.fillStyle = 'rgba(150,178,206,0.7)';
            ctx.fillText('→', exX + exW * 0.44, ry + 16);
            ctx.fillStyle = '#ffd08d';
            ctx.fillText(`physical ${e.physical}‥${e.physical + e.length - 1}`, exX + exW * 0.49, ry + 16);
            ctx.fillStyle = 'rgba(150,178,206,0.75)';
            ctx.font = `8.5px ${FM}`;
            ctx.textAlign = 'right';
            ctx.fillText(`${e.length} blk${e.flags ? ' · ' + e.flags : ''}`, exX + exW - 10, ry + 15);
            ctx.textAlign = 'left';
        });
        if (extents.length > maxRows) {
            ctx.fillStyle = 'rgba(150,178,206,0.6)';
            ctx.font = `8.5px ${FM}`;
            ctx.fillText(`+ ${extents.length - maxRows} more extents`, exX, linkY + 14 + maxRows * rowH + 4);
        }

        // ---- DEVICE TRACK (bottom) ----
        const devTotal = Number(d.device_total_blocks || 0);
        const tX = pad;
        const tW = W - pad * 2;
        const tY = H - 150;
        const tH = 30;
        ctx.fillStyle = 'rgba(150,178,206,0.72)';
        ctx.font = `10px ${FM}`;
        ctx.fillText(`BLOCK DEVICE  ·  ${devTotal.toLocaleString()} blocks × ${d.block_size}B`, tX, tY - 8);
        ctx.fillStyle = 'rgba(22,30,42,0.95)';
        this._rr(ctx, tX, tY, tW, tH, 5);
        ctx.fill();
        ctx.strokeStyle = 'rgba(90,120,150,0.4)';
        ctx.lineWidth = 0.8;
        this._rr(ctx, tX, tY, tW, tH, 5);
        ctx.stroke();
        if (devTotal > 0) {
            extents.forEach((e, i) => {
                const startFrac = e.physical / devTotal;
                const wFrac = Math.max(0.003, e.length / devTotal);
                const sxp = tX + tW * startFrac;
                const swp = Math.max(4, tW * wFrac);
                ctx.fillStyle = 'rgba(255,206,127,0.95)';
                this._rr(ctx, sxp, tY + 3, swp, tH - 6, 2);
                ctx.fill();
                // connector from extent row to its device position
                const rowInfo = extentRowY[i];
                if (rowInfo) {
                    ctx.strokeStyle = 'rgba(255,206,127,0.28)';
                    ctx.lineWidth = 0.8;
                    ctx.beginPath();
                    ctx.moveTo(exX + 20, rowInfo.y);
                    ctx.bezierCurveTo(sxp, rowInfo.y + 30, sxp, tY - 20, sxp + swp / 2, tY);
                    ctx.stroke();
                }
            });
            // position callout
            const span = d.device_span || {};
            ctx.fillStyle = 'rgba(150,178,206,0.7)';
            ctx.font = `8px ${FM}`;
            ctx.fillText('0', tX, tY + tH + 12);
            ctx.textAlign = 'right';
            ctx.fillText(`${devTotal.toLocaleString()}`, tX + tW, tY + tH + 12);
            ctx.textAlign = 'center';
            const cxp = tX + tW * ((Number(span.min || 0)) / devTotal);
            ctx.fillStyle = 'rgba(255,206,127,0.9)';
            ctx.fillText(`file lives near block ${Number(span.min || 0).toLocaleString()}`, Math.min(tX + tW - 90, Math.max(tX + 90, cxp)), tY + tH + 12);
            ctx.textAlign = 'left';
        }

        // ---- Explainer ----
        const ex = [
            'ext4 stores each file as an inode (fixed metadata: permissions, owner, size, timestamps, block count) plus an extent tree that maps',
            'contiguous logical block ranges to physical ranges on the device. Extents replaced the old indirect block-pointer scheme, so a large',
            'contiguous file needs just one extent — fewer seeks, less metadata. Many extents = fragmentation. Bytes live in data blocks; the name',
            'lives in the parent directory, which is just another file whose data maps filenames → inode numbers.'
        ];
        ctx.fillStyle = 'rgba(178,196,214,0.9)';
        ctx.font = `9.5px ${FM}`;
        let ey = H - 74;
        ex.forEach((line) => { ctx.fillText(line, pad, ey); ey += 15; });
    }

    drawFxWriteback(ctx, W, H) {
        const FM = '"Share Tech Mono", monospace';
        const wb = (this.telemetry && this.telemetry.writeback) || {};
        const sched = (this.telemetry && this.telemetry.io_scheduler) || null;
        const pad = 26;
        const now = Date.now();
        const pulse = 0.5 + 0.5 * Math.sin(now * 0.005);

        const dirty = Number(wb.dirty_mb || 0);
        const wbMb = Number(wb.writeback_mb || 0);
        const bgT = Number(wb.bg_thresh_mb || 0);
        const hardT = Number(wb.thresh_mb || 1);

        // Header.
        ctx.textAlign = 'left';
        ctx.fillStyle = '#e8f2f9';
        ctx.font = `18px ${FM}`;
        ctx.fillText('WRITEBACK · DIRTY PAGE THROTTLING', pad, 32);
        ctx.fillStyle = 'rgba(150,178,206,0.72)';
        ctx.font = `10px ${FM}`;
        ctx.fillText('balance_dirty_pages(): the kernel slows writers as dirty pages approach vm.dirty_ratio', pad, 50);

        // State pill (top-right).
        const state = wb.throttling
            ? { t: 'THROTTLING WRITERS', c: [232, 96, 104] }
            : (wb.bg_flushing ? { t: 'BACKGROUND FLUSHING', c: [230, 193, 90] } : { t: 'IDLE', c: [103, 190, 224] });
        ctx.font = `11px ${FM}`;
        const pw = ctx.measureText(state.t).width + 26;
        const px = W - pad - pw;
        const glow = state.t === 'IDLE' ? 0.5 : (0.4 + 0.35 * pulse);
        ctx.fillStyle = `rgba(${state.c[0]},${state.c[1]},${state.c[2]},${(0.14 + glow * 0.14).toFixed(3)})`;
        this._rr(ctx, px, 16, pw, 24, 12);
        ctx.fill();
        ctx.strokeStyle = `rgba(${state.c[0]},${state.c[1]},${state.c[2]},${glow.toFixed(3)})`;
        ctx.lineWidth = 1.2;
        this._rr(ctx, px, 16, pw, 24, 12);
        ctx.stroke();
        ctx.fillStyle = `rgb(${state.c[0]},${state.c[1]},${state.c[2]})`;
        ctx.fillText(state.t, px + 13, 32);

        // ---- Pressure bar: 0 → hard limit, with bg + throttle markers ----
        const barX = pad;
        const barY = 74;
        const barW = W - pad * 2;
        const barH = 30;
        ctx.fillStyle = 'rgba(24,34,48,0.9)';
        this._rr(ctx, barX, barY, barW, barH, 6);
        ctx.fill();
        // zone shading: idle (0..bg) / flush (bg..hard) / throttle (>hard is off-scale)
        const bgX = barX + barW * Math.min(1, bgT / hardT);
        ctx.fillStyle = 'rgba(230,193,90,0.10)';
        this._rr(ctx, bgX, barY, (barX + barW) - bgX, barH, 6);
        ctx.fill();
        // current fill
        const fillFrac = Math.max(0.004, Math.min(1, dirty / hardT));
        const fillCol = wb.throttling ? '232,96,104' : (wb.bg_flushing ? '230,193,90' : '118,220,255');
        ctx.fillStyle = `rgba(${fillCol},0.85)`;
        this._rr(ctx, barX, barY, barW * fillFrac, barH, 6);
        ctx.fill();
        // markers
        const marker = (mx, label, col) => {
            ctx.strokeStyle = col;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(mx, barY - 4);
            ctx.lineTo(mx, barY + barH + 4);
            ctx.stroke();
            ctx.fillStyle = col;
            ctx.font = `8.5px ${FM}`;
            ctx.textAlign = 'center';
            ctx.fillText(label, mx, barY + barH + 15);
            ctx.textAlign = 'left';
        };
        marker(bgX, `bg flush ${bgT.toFixed(0)}MB`, 'rgba(230,193,90,0.9)');
        marker(barX + barW - 1, `throttle ${hardT.toFixed(0)}MB`, 'rgba(232,96,104,0.9)');
        ctx.fillStyle = '#dbeafe';
        ctx.font = `10px ${FM}`;
        ctx.fillText(`dirty ${dirty.toFixed(1)} MB  (${Number(wb.pct_of_thresh || 0).toFixed(1)}% of limit)`, barX + 6, barY - 6);

        // ---- Rolling history curve ----
        const gX = pad;
        const gY = 138;
        const gW = W - pad * 2 - 244;
        const gH = H - gY - 96;
        ctx.strokeStyle = 'rgba(90,120,150,0.35)';
        ctx.lineWidth = 1;
        this._rr(ctx, gX, gY, gW, gH, 6);
        ctx.stroke();
        ctx.fillStyle = 'rgba(150,178,206,0.7)';
        ctx.font = `9px ${FM}`;
        ctx.fillText('DIRTY / WRITEBACK  (MB, live)', gX + 6, gY - 6);

        const hist = this.wbHistory || [];
        let maxV = 0.5;
        hist.forEach((s) => { maxV = Math.max(maxV, s.dirty, s.wb); });
        maxV *= 1.25;
        const n = hist.length;
        const plot = (getV, color, fill) => {
            if (n < 2) return;
            ctx.beginPath();
            hist.forEach((s, i) => {
                const xx = gX + gW * (i / (n - 1));
                const yy = gY + gH - gH * Math.min(1, getV(s) / maxV);
                if (i === 0) ctx.moveTo(xx, yy);
                else ctx.lineTo(xx, yy);
            });
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.6;
            ctx.stroke();
            if (fill) {
                ctx.lineTo(gX + gW, gY + gH);
                ctx.lineTo(gX, gY + gH);
                ctx.closePath();
                ctx.fillStyle = fill;
                ctx.fill();
            }
        };
        plot((s) => s.dirty, 'rgba(118,220,255,0.95)', 'rgba(118,220,255,0.10)');
        plot((s) => s.wb, 'rgba(255,206,127,0.9)', null);
        // y-axis labels
        ctx.fillStyle = 'rgba(150,178,206,0.6)';
        ctx.font = `8px ${FM}`;
        ctx.fillText(`${maxV.toFixed(1)}`, gX + 4, gY + 10);
        ctx.fillText('0', gX + 4, gY + gH - 3);
        // legend
        ctx.fillStyle = 'rgba(118,220,255,0.95)';
        ctx.fillText('■ dirty', gX + gW - 96, gY + 10);
        ctx.fillStyle = 'rgba(255,206,127,0.9)';
        ctx.fillText('■ writeback', gX + gW - 96, gY + 22);

        // ---- Right stats column ----
        const sx = gX + gW + 22;
        const sw = W - pad - sx;
        let sy = gY + 4;
        const stat = (label, value, col) => {
            ctx.fillStyle = 'rgba(127,147,166,0.9)';
            ctx.font = `8px ${FM}`;
            ctx.fillText(label, sx, sy);
            ctx.fillStyle = col || '#e2edf5';
            ctx.font = `14px ${FM}`;
            ctx.fillText(value, sx, sy + 16);
            sy += 34;
        };
        stat('DIRTY PAGES', `${dirty.toFixed(1)} MB`, '#8fd8ff');
        stat('IN WRITEBACK', `${wbMb.toFixed(1)} MB`, '#ffd08d');
        stat('% OF HARD LIMIT', `${Number(wb.pct_of_thresh || 0).toFixed(1)}%`, wb.throttling ? '#ff9ca6' : '#8fd8ff');
        stat('BG FLUSH THRESHOLD', `${bgT.toFixed(0)} MB`, '#e6c15a');
        stat('THROTTLE LIMIT', `${hardT.toFixed(0)} MB`, '#ff9ca6');
        stat('vm.dirty_ratio', `${wb.dirty_ratio || 0}% / bg ${wb.dirty_background_ratio || 0}%`, '#cfe0f0');
        stat('DIRTYABLE MEM', `${Number(wb.dirtyable_mb || 0).toFixed(0)} MB`, '#cfe0f0');
        if (sched) stat('I/O SCHEDULER', `${sched.scheduler} · ${sched.device}`, '#a9d4e8');

        // ---- Explainer ----
        const ex = [
            'The page cache absorbs writes instantly; dirty pages are flushed to disk later. Two thresholds govern this control loop:',
            'at vm.dirty_background_ratio the kernel wakes flusher threads (async, invisible); at vm.dirty_ratio it forces the writing',
            'process itself to block in balance_dirty_pages() until pages drain — a built-in feedback brake so RAM cannot fill with dirty data.',
            'Thresholds here are computed over dirtyable memory (≈ available + dirty), so they track the real kernel budget closely.'
        ];
        ctx.fillStyle = 'rgba(178,196,214,0.9)';
        ctx.font = `10px ${FM}`;
        let ey = H - 74;
        ex.forEach((line) => { ctx.fillText(line, pad, ey); ey += 16; });
    }

    animate() {
        if (!this.isActive) return;
        this.animationId = requestAnimationFrame(() => this.animate());
        this.drawScene();
    }

    activate() {
        if (!this.container) {
            const ok = this.init();
            if (ok === false) return;
        }
        this.isActive = true;
        this.container.style.display = 'block';
        this.container.style.visibility = 'visible';
        this.container.style.pointerEvents = 'auto';
        this.onResize();

        this.fetchTelemetry();
        if (this.telemetryInterval) clearInterval(this.telemetryInterval);
        this.telemetryInterval = setInterval(() => {
            if (this.isActive) this.fetchTelemetry();
        }, 1200);

        this.animate();
    }

    deactivate() {
        this.isActive = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        if (this.telemetryInterval) {
            clearInterval(this.telemetryInterval);
            this.telemetryInterval = null;
        }
        this.closeMountDrilldown();
        this.closeFx();
        if (this.container) {
            this.container.style.display = 'none';
            this.container.style.visibility = 'hidden';
            this.container.style.pointerEvents = 'none';
        }
    }

    layoutFeatureRow() {
        if (!this.featureRow) return;
        // Park just under the KPI cards (canvas y≈98..142). Path band is lower
        // (h*0.35) so VFS/PAGE CACHE labels stay clear of this stack.
        this.featureRow.style.left = '50%';
        this.featureRow.style.transform = 'translateX(-50%)';
        this.featureRow.style.top = '150px';
    }

    onResize() {
        if (!this.canvas) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.canvas.width = Math.floor(window.innerWidth * dpr);
        this.canvas.height = Math.floor(window.innerHeight * dpr);
        this.canvas.style.width = `${window.innerWidth}px`;
        this.canvas.style.height = `${window.innerHeight}px`;
        if (this.ctx) {
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        this.layoutFeatureRow();
    }
}

window.FilesystemMapVisualization = FilesystemMapVisualization;
debugLog('🗂️ filesystem-map.js: FilesystemMapVisualization exported to window');
