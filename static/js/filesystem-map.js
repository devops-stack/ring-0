// Filesystem Block Map Visualization
// Version: 3

debugLog('🗂️ filesystem-map.js v3: Script loading...');

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
        this.telemetry = null;
        this.tick = 0;
        this.renderMode = 'occupancy';
        this.modeButtons = new Map();
        this.legendNode = null;
        this.orbHitArea = null;
        this.canvasClickHandler = null;
        this.canvasMouseMoveHandler = null;
        this.zoneHitAreas = [];
        this.selectedZoneId = null;
        this.hoveredZoneId = null;
        this.radialHitModel = null;
        this.zoneSortMode = 'risk';
        this.sortModeButton = null;
        this.archMapMode = 'detailed';
        this.focusMode = 'soft';
        this.focusModeButton = null;
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
        title.textContent = 'FILESYSTEM INDEX ARCHIVE (in development)';
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
        legend.textContent = 'filesystem packages + radial block index: blue=used, cyan=writing, dark=free';
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
            { key: 'occupancy', label: 'OCCUPANCY' },
            { key: 'write', label: 'WRITE HEAT' },
            { key: 'inode', label: 'INODE' }
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
        sortBtn.textContent = 'SORT: RISK';
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
        sortBtn.onclick = () => this.cycleZoneSortMode();
        this.container.appendChild(sortBtn);
        this.overlayNodes.push(sortBtn);
        this.sortModeButton = sortBtn;
        this.updateSortModeButtonState();

        const focusBtn = document.createElement('button');
        focusBtn.textContent = 'FOCUS: SOFT';
        focusBtn.style.cssText = `
            position: absolute;
            top: 72px;
            left: 136px;
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
        focusBtn.onclick = () => this.toggleFocusMode();
        this.container.appendChild(focusBtn);
        this.overlayNodes.push(focusBtn);
        this.focusModeButton = focusBtn;
        this.updateFocusModeButtonState();

        const info = document.createElement('div');
        info.style.cssText = `
            position: absolute;
            bottom: 18px;
            right: 20px;
            color: #a9aeb5;
            font-family: 'Share Tech Mono', monospace;
            font-size: 10px;
            z-index: 1001;
            opacity: 0.9;
            max-width: 46vw;
            text-align: right;
        `;
        this.container.appendChild(info);
        this.overlayNodes.push(info);
        this.infoNode = info;
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
                this.deactivate();
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
                if (this.infoNode) {
                    const m = data.meta || {};
                    this.infoNode.textContent =
                        `used ${m.used_gb || 0}GB / ${m.total_gb || 0}GB (${m.used_percent || 0}%)` +
                        ` | free ${m.free_gb || 0}GB` +
                        ` | write ${(m.write_bps || 0).toFixed(0)} B/s` +
                        ` | writing blocks ${m.writing_blocks || 0}` +
                        ` | inode ${m.inode_pressure || 0}%`;
                }
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

    drawPackageStack(x, y, w, h, layers, accentColor, label, metaText, subMetaText, isSelected, isHovered, isMuted = false, focusMode = 'soft') {
        const ctx = this.ctx;
        const hardFocus = focusMode === 'hard';
        const stackLayers = Math.max(2, Math.min(4, layers));
        for (let i = stackLayers - 1; i >= 0; i -= 1) {
            const dx = -i * 4;
            const dy = i * 3;
            this.drawRoundedRect(x + dx, y + dy, w, h, 5);
            ctx.fillStyle = i === 0
                ? (isMuted ? (hardFocus ? 'rgba(12, 18, 28, 0.46)' : 'rgba(12, 18, 28, 0.64)') : 'rgba(14, 24, 36, 0.95)')
                : (isMuted ? (hardFocus ? 'rgba(10, 16, 26, 0.3)' : 'rgba(10, 16, 26, 0.5)') : 'rgba(10, 16, 26, 0.85)');
            ctx.fill();
            const baseStroke = i === 0 ? accentColor : 'rgba(72, 94, 124, 0.35)';
            ctx.strokeStyle = isMuted
                ? (hardFocus ? 'rgba(82, 104, 132, 0.22)' : 'rgba(82, 104, 132, 0.38)')
                : (isSelected ? 'rgba(149, 207, 255, 0.95)' : (isHovered ? 'rgba(122, 182, 245, 0.82)' : baseStroke));
            ctx.lineWidth = isSelected ? 1.4 : (i === 0 ? 1.0 : 0.7);
            ctx.stroke();
        }
        ctx.fillStyle = isMuted ? (hardFocus ? 'rgba(132, 152, 178, 0.45)' : 'rgba(132, 152, 178, 0.62)') : (isSelected ? '#d9ecff' : '#9fc0e8');
        ctx.font = '10px "Share Tech Mono", monospace';
        ctx.fillText(label, x + 8, y + 14);
        ctx.fillStyle = isMuted ? (hardFocus ? 'rgba(124, 140, 160, 0.4)' : 'rgba(124, 140, 160, 0.58)') : (isSelected ? 'rgba(198, 222, 250, 0.96)' : 'rgba(155, 176, 204, 0.9)');
        ctx.font = '9px "Share Tech Mono", monospace';
        ctx.fillText(metaText, x + 8, y + 27);
        if (subMetaText) {
            ctx.fillStyle = isMuted ? (hardFocus ? 'rgba(120, 138, 162, 0.3)' : 'rgba(120, 138, 162, 0.46)') : 'rgba(132, 156, 186, 0.76)';
            ctx.font = '8px "Share Tech Mono", monospace';
            ctx.fillText(subMetaText, x + 8, y + 38);
        }
        ctx.fillStyle = isMuted ? (hardFocus ? 'rgba(88, 104, 128, 0.34)' : 'rgba(88, 104, 128, 0.54)') : accentColor;
        ctx.fillRect(x + 2, y + h - 3, Math.max(8, w - 4), 2);
    }

    drawParticleOrb(x, y, radius, meta) {
        const ctx = this.ctx;
        const mode = String(this.renderMode || 'occupancy');
        const inodePressure = Math.max(0, Math.min(100, Number(meta?.inode_pressure || 0)));
        const writeBps = Math.max(0, Number(meta?.write_bps || 0));
        const writeNorm = Math.max(0, Math.min(1, writeBps / (300 * 1024 * 1024)));
        const modeBoost = mode === 'write' ? 0.25 : (mode === 'inode' ? 0.18 : 0.08);
        const pulse = 0.45 + 0.55 * ((Math.sin(this.tick * 0.06) + 1) / 2);
        const glow = Math.max(0.1, Math.min(1.0, (inodePressure / 100) * 0.6 + writeNorm * 0.4 + modeBoost));

        // Outer glow
        const g = ctx.createRadialGradient(x, y, radius * 0.3, x, y, radius * 1.2);
        g.addColorStop(0, `rgba(145, 222, 255, ${0.12 + glow * 0.25})`);
        g.addColorStop(1, 'rgba(145, 222, 255, 0)');
        ctx.beginPath();
        ctx.arc(x, y, radius * 1.2, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();

        // Orb body
        const orb = ctx.createRadialGradient(x - radius * 0.25, y - radius * 0.35, radius * 0.2, x, y, radius);
        orb.addColorStop(0, 'rgba(196, 238, 255, 0.85)');
        orb.addColorStop(0.45, 'rgba(79, 148, 196, 0.46)');
        orb.addColorStop(1, 'rgba(11, 22, 36, 0.95)');
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = orb;
        ctx.fill();

        // Rim
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(137, 208, 245, ${0.58 + pulse * 0.22})`;
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Minimal version: no inner streaks and no labels.
    }

    drawFsArchitectureMap(x, y, w, h, meta, zones) {
        const ctx = this.ctx;
        const mode = this.archMapMode || 'simple';
        const usedPercent = Math.max(0, Math.min(100, Number(meta?.used_percent || 0)));
        const inodePressure = Math.max(0, Math.min(100, Number(meta?.inode_pressure || 0)));
        const writingBlocks = Math.max(0, Number(meta?.writing_blocks || 0));
        const writeBps = Math.max(0, Number(meta?.write_bps || 0));
        const writeMBs = writeBps / (1024 * 1024);
        const zoneList = Array.isArray(zones) ? zones : [];
        const activeZones = zoneList.filter((z) => Number(z?.activity || 0) > 8 || Number(z?.writing_blocks || 0) > 0).length;
        const hotZones = zoneList.filter((z) => Math.max(Number(z?.used_percent || 0), Number(z?.inode_pressure || 0)) >= 80).length;

        this.drawRoundedRect(x, y, w, h, 9);
        ctx.fillStyle = 'rgba(8, 13, 20, 0.78)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(122, 147, 179, 0.34)';
        ctx.lineWidth = 0.95;
        ctx.stroke();

        ctx.fillStyle = '#cde3ff';
        ctx.font = '10px "Share Tech Mono", monospace';
        ctx.fillText('LINUX FS ARCH MAP', x + 12, y + 18);
        ctx.fillStyle = 'rgba(151, 173, 203, 0.86)';
        ctx.font = '8px "Share Tech Mono", monospace';
        ctx.fillText(`active zones ${activeZones} | hot zones ${hotZones} | write ${writeMBs.toFixed(1)} MB/s`, x + 12, y + 32);
        ctx.fillText(`mode ${String(mode).toUpperCase()}`, x + w - 102, y + 18);

        const node = (nx, ny, nw, nh, title, sub, tone, small = false) => {
            this.drawRoundedRect(nx, ny, nw, nh, small ? 4 : 5);
            ctx.fillStyle = 'rgba(10, 16, 24, 0.82)';
            ctx.fill();
            ctx.strokeStyle = tone;
            ctx.lineWidth = small ? 0.85 : 0.95;
            ctx.stroke();
            ctx.fillStyle = '#cfe4ff';
            ctx.font = small ? '8px "Share Tech Mono", monospace' : '9px "Share Tech Mono", monospace';
            ctx.fillText(title, nx + 6, ny + (small ? 11 : 13));
            if (sub) {
                ctx.fillStyle = 'rgba(146, 170, 201, 0.88)';
                ctx.font = '8px "Share Tech Mono", monospace';
                ctx.fillText(sub, nx + 6, ny + (small ? 21 : 24));
            }
        };
        const link = (x0, y0, x1, y1, tone, weight = 1) => {
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.bezierCurveTo((x0 + x1) / 2, y0, (x0 + x1) / 2, y1, x1, y1);
            ctx.strokeStyle = tone;
            ctx.lineWidth = weight;
            ctx.stroke();
        };

        const rootX = x + 168;
        const rootY = y + 98;
        const syscallX = x + 12;
        const driverX = x + w - 126;
        const blockX = x + 152;
        const ioX = blockX + 122;
        const devX = ioX + 102;
        const writeTone = writeMBs >= 80 ? 'rgba(255, 154, 118, 0.86)' : 'rgba(142, 227, 255, 0.78)';

        node(syscallX, rootY - 16, 92, 34, 'SYSCALLS', `rw ${writeMBs.toFixed(1)} MB/s`, 'rgba(142, 206, 255, 0.85)');
        node(rootX, rootY - 22, 110, 44, 'VFS CORE', `used ${usedPercent.toFixed(1)}%`, 'rgba(132, 194, 255, 0.95)');
        node(driverX, rootY - 48, 104, 30, 'EXT4/XFS', `${activeZones} active`, 'rgba(145, 226, 255, 0.88)', true);
        node(driverX, rootY - 12, 104, 30, 'TMPFS/PROC', `inode ${inodePressure.toFixed(0)}%`, 'rgba(148, 198, 255, 0.84)', true);
        node(driverX, rootY + 24, 104, 30, 'OVERLAY/DM', `${writingBlocks} writing`, writingBlocks > 0 ? 'rgba(255, 164, 170, 0.86)' : 'rgba(142, 186, 230, 0.72)', true);
        node(blockX, y + h - 58, 102, 32, 'PAGECACHE', `dirty ${writingBlocks}`, writeTone, true);
        node(ioX, y + h - 58, 94, 32, 'BLOCK IO', `inode ${inodePressure.toFixed(0)}%`, 'rgba(132, 194, 255, 0.84)', true);
        node(devX, y + h - 58, 86, 32, 'NVME', `util ${usedPercent.toFixed(0)}%`, usedPercent > 86 ? 'rgba(255, 146, 156, 0.88)' : 'rgba(143, 217, 252, 0.85)', true);

        const flowWeight = 0.9 + Math.min(1.8, writeMBs / 70);
        link(syscallX + 92, rootY + 1, rootX, rootY + 1, 'rgba(124, 181, 234, 0.65)', 1.1);
        link(rootX + 110, rootY - 2, driverX, rootY - 33, 'rgba(130, 199, 245, 0.52)', 0.9);
        link(rootX + 110, rootY + 4, driverX, rootY + 3, 'rgba(130, 199, 245, 0.52)', 0.9);
        link(rootX + 110, rootY + 10, driverX, rootY + 39, 'rgba(130, 199, 245, 0.52)', 0.9);
        link(rootX + 56, rootY + 22, blockX + 50, y + h - 58, writeTone, flowWeight);
        link(blockX + 102, y + h - 42, ioX, y + h - 42, 'rgba(134, 196, 243, 0.75)', flowWeight * 0.9);
        link(ioX + 94, y + h - 42, devX, y + h - 42, usedPercent > 86 ? 'rgba(255, 152, 162, 0.88)' : 'rgba(142, 217, 252, 0.8)', flowWeight * 0.8);

        if (mode === 'detailed') {
            const dentryX = rootX - 4;
            const dentryY = y + 48;
            const journalX = driverX - 12;
            const journalY = y + h - 94;
            const wbX = blockX - 4;
            const wbY = y + h - 94;
            const schedX = ioX + 2;
            const schedY = y + h - 94;

            node(dentryX, dentryY, 88, 26, 'DENTRY', `${Math.max(55, 99 - inodePressure * 0.5).toFixed(0)}% hit`, 'rgba(137, 206, 255, 0.78)', true);
            node(dentryX + 92, dentryY, 88, 26, 'INODE', `${Math.max(48, 98 - usedPercent * 0.48).toFixed(0)}% hit`, 'rgba(132, 194, 255, 0.78)', true);
            node(journalX, journalY, 94, 26, 'JOURNAL', `${writingBlocks} pend`, writingBlocks > 0 ? 'rgba(255, 167, 136, 0.85)' : 'rgba(132, 180, 220, 0.72)', true);
            node(wbX, wbY, 86, 26, 'WRITEBACK', `${(writeMBs * 0.72).toFixed(1)} MB/s`, writeTone, true);
            node(schedX, schedY, 82, 26, 'IO SCHED', inodePressure > 72 ? 'congested' : 'normal', inodePressure > 72 ? 'rgba(255, 158, 166, 0.86)' : 'rgba(138, 198, 244, 0.8)', true);

            link(rootX + 60, rootY - 22, dentryX + 20, dentryY + 13, 'rgba(130, 197, 246, 0.55)', 0.9);
            link(rootX + 84, rootY - 22, dentryX + 110, dentryY + 13, 'rgba(130, 197, 246, 0.55)', 0.9);
            link(driverX + 52, rootY + 39, journalX + 40, journalY + 13, 'rgba(214, 148, 137, 0.46)', 0.9);
            link(journalX + 94, journalY + 13, wbX, wbY + 13, 'rgba(182, 156, 132, 0.45)', 0.8);
            link(wbX + 86, wbY + 13, schedX, schedY + 13, 'rgba(132, 194, 247, 0.62)', 0.85);
        }
    }

    drawLiveBlockMatrix(x, y, w, h, blocks, zones, meta, selectedZoneId = null, focusMode = 'soft') {
        const ctx = this.ctx;
        const hardFocus = focusMode === 'hard';
        const zoneMap = new Map((Array.isArray(zones) ? zones : []).map((z) => [String(z.id || ''), z]));
        const data = Array.isArray(blocks) ? blocks : [];
        if (!data.length) return;

        this.drawRoundedRect(x, y, w, h, 7);
        ctx.fillStyle = 'rgba(8, 13, 21, 0.62)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(122, 146, 178, 0.28)';
        ctx.lineWidth = 0.85;
        ctx.stroke();

        const cols = 64;
        const rows = 20;
        const innerX = x + 10;
        const innerY = y + 12;
        const innerW = w - 20;
        const innerH = h - 26;
        const cellW = innerW / cols;
        const cellH = innerH / rows;
        const inodePressure = Math.max(0, Math.min(100, Number(meta?.inode_pressure || 0)));
        const writeHot = Number(meta?.write_bps || 0) / (1024 * 1024);

        for (let i = 0; i < rows * cols; i += 1) {
            const b = data[i % data.length] || {};
            const zoneId = String(b.zone_id || '');
            const zone = zoneMap.get(String(b.zone_id || '')) || {};
            const zx = i % cols;
            const zy = Math.floor(i / cols);
            const px = innerX + zx * cellW;
            const py = innerY + zy * cellH;
            const zoneAct = Math.max(0, Math.min(100, Number(zone.activity || 0)));
            const zInode = Math.max(0, Math.min(100, Number(zone.inode_pressure || 0)));
            const flicker = 0.75 + 0.25 * Math.sin(this.tick * 0.05 + zx * 0.17 + zy * 0.23);
            const isFocused = !selectedZoneId || zoneId === String(selectedZoneId);
            const focusAlphaMul = isFocused ? 1 : (hardFocus ? 0.26 : 0.5);

            if (b.state === 'writing') {
                const alpha = 0.46 + Math.min(0.5, (zoneAct / 130) + (writeHot > 90 ? 0.18 : 0)) * flicker;
                ctx.fillStyle = `rgba(163, 238, 255, ${Math.min(0.95, alpha * focusAlphaMul).toFixed(3)})`;
            } else if (b.state === 'used') {
                const alpha = 0.22 + Math.min(0.5, ((zoneAct + inodePressure * 0.35) / 220)) * flicker;
                ctx.fillStyle = zInode >= 78
                    ? `rgba(255, 184, 132, ${Math.min(0.8, (alpha + 0.08) * focusAlphaMul).toFixed(3)})`
                    : `rgba(96, 166, 220, ${Math.min(0.8, alpha * focusAlphaMul).toFixed(3)})`;
            } else {
                ctx.fillStyle = `rgba(17, 30, 46, ${((0.24 + 0.08 * flicker) * focusAlphaMul).toFixed(3)})`;
            }

            const cw = Math.max(1.5, cellW - 1.15);
            const ch = Math.max(1.5, cellH - 1.1);
            ctx.fillRect(px, py, cw, ch);
        }

        ctx.fillStyle = 'rgba(166, 193, 225, 0.84)';
        ctx.font = '8px "Share Tech Mono", monospace';
        ctx.fillText('live block matrix: write glow / inode pressure / occupancy', x + 12, y + h - 8);
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
            if (this.renderMode === 'write') {
                this.legendNode.textContent = 'mode: write heat (cyan=write hot, blue=active, dark=cold)';
            } else if (this.renderMode === 'inode') {
                this.legendNode.textContent = 'mode: inode pressure (cyan=high inode pressure)';
            } else {
                this.legendNode.textContent = 'mode: occupancy (blue=used, cyan=writing, dark=free)';
            }
        }
    }

    cycleRenderMode() {
        const order = ['occupancy', 'write', 'inode'];
        const idx = order.indexOf(this.renderMode);
        const next = order[(idx + 1) % order.length];
        this.setRenderMode(next);
    }

    getZoneSortScore(zone, mode) {
        const used = Number(zone?.used_percent || 0);
        const inode = Number(zone?.inode_pressure || 0);
        const activity = Number(zone?.activity || 0);
        const writing = Number(zone?.writing_blocks || 0);
        if (mode === 'write') {
            return writing * 100 + activity * 4 + used * 0.2;
        }
        if (mode === 'inode') {
            return inode * 10 + used * 0.6 + activity * 0.5;
        }
        return Math.max(used, inode, writing > 0 ? 86 : 0) * 10 + activity;
    }

    cycleZoneSortMode() {
        const order = ['risk', 'write', 'inode'];
        const idx = order.indexOf(this.zoneSortMode);
        const next = order[(idx + 1) % order.length];
        this.zoneSortMode = next;
        this.updateSortModeButtonState();
    }

    updateSortModeButtonState() {
        if (!this.sortModeButton) return;
        const mode = this.zoneSortMode || 'risk';
        const label = mode === 'write' ? 'WRITE' : (mode === 'inode' ? 'INODE' : 'RISK');
        this.sortModeButton.textContent = `SORT: ${label}`;
        if (mode === 'write') {
            this.sortModeButton.style.background = 'rgba(45, 57, 30, 0.92)';
            this.sortModeButton.style.borderColor = 'rgba(168, 230, 140, 0.85)';
            this.sortModeButton.style.color = '#e4ffd3';
        } else if (mode === 'inode') {
            this.sortModeButton.style.background = 'rgba(29, 43, 62, 0.92)';
            this.sortModeButton.style.borderColor = 'rgba(127, 194, 255, 0.88)';
            this.sortModeButton.style.color = '#dbf0ff';
        } else {
            this.sortModeButton.style.background = 'rgba(62, 36, 36, 0.92)';
            this.sortModeButton.style.borderColor = 'rgba(255, 162, 170, 0.88)';
            this.sortModeButton.style.color = '#ffe1e5';
        }
    }

    toggleFocusMode() {
        this.focusMode = this.focusMode === 'hard' ? 'soft' : 'hard';
        this.updateFocusModeButtonState();
    }

    updateFocusModeButtonState() {
        if (!this.focusModeButton) return;
        const hard = this.focusMode === 'hard';
        this.focusModeButton.textContent = hard ? 'FOCUS: HARD' : 'FOCUS: SOFT';
        this.focusModeButton.style.background = hard ? 'rgba(68, 34, 44, 0.92)' : 'rgba(24, 42, 60, 0.9)';
        this.focusModeButton.style.borderColor = hard ? 'rgba(255, 158, 172, 0.86)' : 'rgba(132, 194, 255, 0.78)';
        this.focusModeButton.style.color = hard ? '#ffe3e7' : '#dff1ff';
    }

    getZoneHitAt(x, y) {
        for (const hit of this.zoneHitAreas) {
            if (x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h) {
                return hit;
            }
        }
        return null;
    }

    getRadialZoneAt(x, y) {
        const model = this.radialHitModel;
        if (!model) return null;
        const dx = x - model.cx;
        const dy = y - model.cy;
        const dist = Math.hypot(dx, dy);
        if (dist < model.innerR || dist > model.outerR) return null;
        const rIdx = Math.floor((dist - model.innerR) / model.ringGap);
        if (rIdx < 0 || rIdx >= model.rows) return null;
        let a = Math.atan2(dy, dx);
        if (a < 0) a += Math.PI * 2;
        const cIdx = Math.floor(a / model.angleStep);
        if (cIdx < 0 || cIdx >= model.cols) return null;
        const zoneId = model.zoneByCell.get(`${rIdx}:${cIdx}`) || null;
        if (!zoneId) return null;
        return { zoneId };
    }

    onCanvasClick(event) {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const zoneHit = this.getZoneHitAt(x, y);
        if (zoneHit) {
            this.selectedZoneId = this.selectedZoneId === zoneHit.zoneId ? null : zoneHit.zoneId;
            return;
        }
        const radialHit = this.getRadialZoneAt(x, y);
        if (radialHit) {
            this.selectedZoneId = this.selectedZoneId === radialHit.zoneId ? null : radialHit.zoneId;
            return;
        }
        if (!this.orbHitArea) return;
        const dx = x - this.orbHitArea.x;
        const dy = y - this.orbHitArea.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= this.orbHitArea.r * 1.25) {
            this.cycleRenderMode();
        }
    }

    onCanvasMouseMove(event) {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const zoneHit = this.getZoneHitAt(x, y);
        const radialHit = zoneHit ? null : this.getRadialZoneAt(x, y);
        this.hoveredZoneId = zoneHit ? zoneHit.zoneId : (radialHit ? radialHit.zoneId : null);
        const overOrb = this.orbHitArea && Math.hypot(x - this.orbHitArea.x, y - this.orbHitArea.y) <= this.orbHitArea.r * 1.25;
        this.canvas.style.cursor = zoneHit || radialHit || overOrb ? 'pointer' : 'default';
    }

    drawScene() {
        if (!this.ctx || !this.canvas) return;
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.ctx.clearRect(0, 0, w, h);
        this.tick += 1;

        this.ctx.fillStyle = '#090d14';
        this.ctx.fillRect(0, 0, w, h);

        if (!this.telemetry || !Array.isArray(this.telemetry.blocks)) return;

        const rows = Math.max(1, Number(this.telemetry.rows || 1));
        const cols = Math.max(1, Number(this.telemetry.cols || 1));
        const blocks = this.telemetry.blocks;
        const zones = Array.isArray(this.telemetry.zones) ? this.telemetry.zones : [];
        const zoneMap = new Map(zones.map((z) => [String(z.id || ''), z]));
        const selectedZoneId = this.selectedZoneId ? String(this.selectedZoneId) : null;
        const hasZoneFocus = Boolean(selectedZoneId);
        const hardFocus = this.focusMode === 'hard';
        this.zoneHitAreas = [];
        this.radialHitModel = null;

        const cx = Math.floor(w * 0.53);
        const cy = Math.floor(h * 0.63);
        const outerR = Math.max(130, Math.min(250, Math.floor(Math.min(w, h) * 0.28)));
        const innerR = Math.max(24, Math.floor(outerR * 0.14));
        const ringGap = (outerR - innerR) / Math.max(1, rows);
        const angleStep = (Math.PI * 2) / Math.max(1, cols);
        const m = this.telemetry.meta || {};
        const zoneByCell = new Map();

        const kpis = [
            {
                label: 'USED',
                value: `${Number(m.used_percent || 0).toFixed(1)}%`,
                tone: Number(m.used_percent || 0) >= 85 ? '#ff9ca6' : '#8fd8ff'
            },
            {
                label: 'WRITE',
                value: `${(Number(m.write_bps || 0) / (1024 * 1024)).toFixed(1)} MB/s`,
                tone: Number(m.write_bps || 0) >= (80 * 1024 * 1024) ? '#ffd08d' : '#8ff3c0'
            },
            {
                label: 'INODE',
                value: `${Number(m.inode_pressure || 0).toFixed(1)}%`,
                tone: Number(m.inode_pressure || 0) >= 75 ? '#ff9ca6' : '#8fd8ff'
            }
        ];
        kpis.forEach((kpi, idx) => {
            const kx = 26 + idx * 152;
            const ky = 98;
            this.drawRoundedRect(kx, ky, 138, 44, 6);
            this.ctx.fillStyle = 'rgba(10, 16, 24, 0.74)';
            this.ctx.fill();
            this.ctx.strokeStyle = 'rgba(122, 142, 168, 0.32)';
            this.ctx.lineWidth = 0.9;
            this.ctx.stroke();
            this.ctx.fillStyle = 'rgba(159, 177, 201, 0.84)';
            this.ctx.font = '8px "Share Tech Mono", monospace';
            this.ctx.fillText(kpi.label, kx + 10, ky + 14);
            this.ctx.fillStyle = kpi.tone;
            this.ctx.font = '12px "Share Tech Mono", monospace';
            this.ctx.fillText(kpi.value, kx + 10, ky + 31);
        });

        // Background circuit lines.
        this.ctx.strokeStyle = hasZoneFocus
            ? (hardFocus ? 'rgba(120, 52, 84, 0.1)' : 'rgba(120, 52, 84, 0.14)')
            : 'rgba(150, 38, 64, 0.17)';
        this.ctx.lineWidth = 1;
        for (let i = 0; i < 9; i += 1) {
            const y = 120 + i * 44;
            this.ctx.beginPath();
            this.ctx.moveTo(cx - outerR - 130, y);
            this.ctx.lineTo(cx + outerR + 130, y);
            this.ctx.stroke();
        }

        const matrixW = Math.min(760, Math.max(520, Math.floor(w * 0.54)));
        const matrixH = Math.min(320, Math.max(220, Math.floor(h * 0.28)));
        const matrixX = Math.max(24, Math.min(w - matrixW - 24, cx - Math.floor(matrixW * 0.52)));
        const matrixY = Math.max(126, cy - outerR - Math.floor(matrixH * 0.42));
        this.drawLiveBlockMatrix(matrixX, matrixY, matrixW, matrixH, blocks, zones, m, selectedZoneId, this.focusMode);

        // Main rings.
        for (let i = 0; i <= 7; i += 1) {
            const r = innerR + ((outerR - innerR) * i / 7);
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, r, 0, Math.PI * 2);
            this.ctx.strokeStyle = i % 2 === 0 ? 'rgba(89, 140, 192, 0.22)' : 'rgba(58, 96, 136, 0.16)';
            this.ctx.lineWidth = i === 7 ? 1.2 : 0.8;
            this.ctx.stroke();
        }

        // Radial block matrix.
        blocks.forEach((b) => {
            const rIdx = Number.isFinite(Number(b.r)) ? Number(b.r) : Math.floor(Number(b.i || 0) / cols);
            const cIdx = Number.isFinite(Number(b.c)) ? Number(b.c) : (Number(b.i || 0) % cols);
            if (rIdx >= 0 && rIdx < rows && cIdx >= 0 && cIdx < cols) {
                zoneByCell.set(`${rIdx}:${cIdx}`, String(b.zone_id || ''));
            }
            const r0 = innerR + rIdx * ringGap;
            const r1 = r0 + Math.max(1.3, ringGap * 0.8);
            const a0 = cIdx * angleStep;
            const a1 = a0 + angleStep * 0.88;
            const blockZoneId = String(b.zone_id || '');
            const isFocused = !hasZoneFocus || blockZoneId === selectedZoneId;
            const focusAlphaMul = isFocused ? 1 : (hardFocus ? 0.22 : 0.42);

            const z = zoneMap.get(String(b.zone_id || '')) || {};
            const zoneAct = Math.max(0, Math.min(100, Number(z.activity || 0)));
            const inodePressure = Math.max(0, Math.min(100, Number(z.inode_pressure || 0)));
            if (this.renderMode === 'write') {
                if (b.state === 'writing') this.ctx.fillStyle = `rgba(127, 232, 255, ${(0.92 * focusAlphaMul).toFixed(3)})`;
                else if (b.state === 'used') this.ctx.fillStyle = `rgba(44, 132, 184, ${((0.32 + Math.min(0.5, zoneAct / 120)) * focusAlphaMul).toFixed(3)})`;
                else this.ctx.fillStyle = `rgba(14, 28, 44, ${(0.48 * focusAlphaMul).toFixed(3)})`;
            } else if (this.renderMode === 'inode') {
                if (b.state === 'free') this.ctx.fillStyle = `rgba(12, 24, 38, ${(0.45 * focusAlphaMul).toFixed(3)})`;
                else this.ctx.fillStyle = `rgba(127, 232, 255, ${((0.18 + Math.min(0.72, inodePressure / 110)) * focusAlphaMul).toFixed(3)})`;
            } else {
                if (b.state === 'writing') this.ctx.fillStyle = `rgba(127, 232, 255, ${(0.9 * focusAlphaMul).toFixed(3)})`;
                else if (b.state === 'free') this.ctx.fillStyle = `rgba(19, 38, 58, ${(0.55 * focusAlphaMul).toFixed(3)})`;
                else this.ctx.fillStyle = `rgba(44, 132, 184, ${(0.72 * focusAlphaMul).toFixed(3)})`;
            }

            this.ctx.beginPath();
            this.ctx.arc(cx, cy, r1, a0, a1);
            this.ctx.arc(cx, cy, r0, a1, a0, true);
            this.ctx.closePath();
            this.ctx.fill();
        });
        this.radialHitModel = {
            cx,
            cy,
            innerR,
            outerR,
            ringGap,
            angleStep,
            rows,
            cols,
            zoneByCell,
        };

        // Central hole.
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, innerR - 3, 0, Math.PI * 2);
        this.ctx.fillStyle = '#081018';
        this.ctx.fill();

        // Alert banner.
        if (Number(m.writing_blocks || 0) > 0) {
            const pulse = 0.5 + 0.5 * Math.sin(this.tick * 0.08);
            const bw = 330;
            const bh = 40;
            const bx = cx - Math.floor(bw / 2);
            const by = cy - outerR - 26;
            this.drawRoundedRect(bx, by, bw, bh, 5);
            this.ctx.fillStyle = `rgba(${90 + Math.floor(80 * pulse)}, 20, 20, 0.9)`;
            this.ctx.fill();
            this.ctx.strokeStyle = 'rgba(220, 90, 90, 0.85)';
            this.ctx.lineWidth = 1;
            this.ctx.stroke();
            this.ctx.fillStyle = '#ffd8c0';
            this.ctx.font = 'bold 17px "Share Tech Mono", monospace';
            this.ctx.fillText('DATA PACKAGE WRITING', bx + 18, by + 26);
        }

        // Side package stacks from zones.
        const sortedZones = zones
            .slice()
            .sort((a, b) => this.getZoneSortScore(b, this.zoneSortMode) - this.getZoneSortScore(a, this.zoneSortMode));
        const zoneItems = sortedZones.slice(0, 14);
        const leftItems = zoneItems.filter((_, i) => i % 2 === 0);
        const rightItems = zoneItems.filter((_, i) => i % 2 === 1);
        const cardW = 130;
        const cardH = 46;
        const leftX = Math.max(24, cx - outerR - 220);
        const rightX = Math.min(w - cardW - 24, cx + outerR + 110);
        const topY = Math.max(150, cy - outerR + 12);

        const drawZonePack = (list, xBase, isLeft) => {
            list.forEach((z, idx) => {
                const y = topY + idx * 54;
                const usedPercent = Number(z.used_percent || 0);
                const writingBlocks = Number(z.writing_blocks || 0);
                const inodePressure = Number(z.inode_pressure || 0);
                const riskScore = Math.max(usedPercent, inodePressure, writingBlocks > 0 ? 86 : 0);
                const active = Number(z.activity || 0) > 6 || writingBlocks > 0;
                const accent = riskScore >= 80
                    ? 'rgba(255, 149, 158, 0.92)'
                    : (riskScore >= 55 ? 'rgba(255, 206, 127, 0.9)' : 'rgba(118, 220, 255, 0.92)');
                const layers = 2 + (active ? 2 : 1);
                const zoneId = String(z.id || z.name || `zone-${idx}`);
                const isSelected = this.selectedZoneId === zoneId;
                const isHovered = this.hoveredZoneId === zoneId;
                const isMuted = hasZoneFocus && !isSelected;
                this.drawPackageStack(
                    xBase,
                    y,
                    cardW,
                    cardH,
                    layers,
                    accent,
                    String(z.name || z.id || 'zone'),
                    `used ${usedPercent.toFixed(0)}% | inode ${inodePressure.toFixed(0)}%`,
                    `wr ${writingBlocks} | act ${Number(z.activity || 0).toFixed(0)}`,
                    isSelected,
                    isHovered,
                    isMuted,
                    this.focusMode
                );
                this.zoneHitAreas.push({ x: xBase, y, w: cardW, h: cardH, zoneId });

                // Connector to central disk with light bundling.
                const sx = isLeft ? xBase + cardW : xBase;
                const sy = y + cardH / 2;
                const tx = cx + (isLeft ? -outerR * 0.85 : outerR * 0.85);
                const ty = cy - outerR * 0.62 + idx * 9;
                const bundleX = cx + (isLeft ? -outerR * 1.05 : outerR * 1.05);
                const bundleY = cy - outerR * 0.5 + idx * 8;
                this.ctx.beginPath();
                this.ctx.moveTo(sx, sy);
                this.ctx.bezierCurveTo(
                    sx + (isLeft ? 60 : -60),
                    sy,
                    bundleX + (isLeft ? -22 : 22),
                    bundleY,
                    bundleX,
                    bundleY
                );
                this.ctx.strokeStyle = isMuted
                    ? (hardFocus ? 'rgba(82, 104, 132, 0.2)' : 'rgba(102, 122, 148, 0.32)')
                    : (isSelected
                    ? 'rgba(146, 204, 255, 0.86)'
                    : (riskScore >= 80 ? 'rgba(226, 92, 106, 0.44)' : 'rgba(169, 52, 80, 0.26)'));
                this.ctx.lineWidth = isSelected ? 1.5 : (isMuted ? (hardFocus ? 0.8 : 0.95) : 1);
                this.ctx.stroke();

                this.ctx.beginPath();
                this.ctx.moveTo(bundleX, bundleY);
                this.ctx.bezierCurveTo(
                    bundleX + (isLeft ? 24 : -24),
                    bundleY,
                    tx + (isLeft ? -34 : 34),
                    ty,
                    tx,
                    ty
                );
                this.ctx.strokeStyle = isMuted
                    ? (hardFocus ? 'rgba(82, 104, 132, 0.22)' : 'rgba(102, 122, 148, 0.35)')
                    : (isSelected ? 'rgba(146, 204, 255, 0.86)' : 'rgba(124, 156, 196, 0.34)');
                this.ctx.lineWidth = isSelected ? 1.3 : (isMuted ? (hardFocus ? 0.85 : 1) : 0.95);
                this.ctx.stroke();
            });
        };

        drawZonePack(leftItems, leftX, true);
        drawZonePack(rightItems, rightX, false);

        // Mini particle-view orb (reference-style status widget).
        const orbX = Math.max(84, leftX + 44);
        const orbY = Math.min(h - 48, topY + 290);
        this.drawParticleOrb(orbX, orbY, 42, m);
        this.orbHitArea = { x: orbX, y: orbY, r: 42 };

        // Minimal host-data labels.
        this.ctx.fillStyle = '#6fa4cf';
        this.ctx.font = '10px "Share Tech Mono", monospace';
        this.ctx.fillText(`HOST/DATA FILE ${(m.used_gb || 0).toFixed(0)}GB`, leftX, topY - 26);
        this.ctx.fillText(`HOST/DATA FILE ${(m.free_gb || 0).toFixed(0)}GB`, leftX, topY - 10);
        this.ctx.fillText(`HOST/DATA WR ${(m.write_bps || 0).toFixed(0)} B/s`, rightX - 40, topY - 10);
        this.ctx.fillStyle = 'rgba(164, 183, 209, 0.84)';
        this.ctx.fillText(`zones sorted by ${String(this.zoneSortMode || 'risk').toUpperCase()}`, leftX, topY - 42);

        const archW = Math.min(620, Math.max(470, Math.floor(w * 0.44)));
        const archH = 228;
        const archX = Math.max(24, Math.min(w - archW - 24, rightX - 120));
        const archY = 108;
        this.drawFsArchitectureMap(archX, archY, archW, archH, m, zones);

        const selectedZone = zones.find((z) => String(z.id || z.name || '') === String(this.selectedZoneId || ''));
        if (selectedZone) {
            const panelW = 328;
            const panelH = 96;
            const px = 24;
            const py = h - panelH - 26;
            this.drawRoundedRect(px, py, panelW, panelH, 8);
            this.ctx.fillStyle = 'rgba(9, 14, 22, 0.86)';
            this.ctx.fill();
            this.ctx.strokeStyle = 'rgba(132, 164, 202, 0.42)';
            this.ctx.lineWidth = 1;
            this.ctx.stroke();
            this.ctx.fillStyle = '#cfe5ff';
            this.ctx.font = '11px "Share Tech Mono", monospace';
            this.ctx.fillText(`ZONE FOCUS: ${String(selectedZone.name || selectedZone.id || 'zone').toUpperCase()}`, px + 12, py + 20);
            this.ctx.fillStyle = 'rgba(165, 187, 217, 0.9)';
            this.ctx.font = '9px "Share Tech Mono", monospace';
            this.ctx.fillText(`used ${Number(selectedZone.used_percent || 0).toFixed(1)}%`, px + 12, py + 40);
            this.ctx.fillText(`inode ${Number(selectedZone.inode_pressure || 0).toFixed(1)}%`, px + 12, py + 56);
            this.ctx.fillText(`activity ${Number(selectedZone.activity || 0).toFixed(1)}`, px + 12, py + 72);
            this.ctx.fillText(`writing blocks ${Number(selectedZone.writing_blocks || 0)}`, px + 170, py + 40);
            this.ctx.fillText(`free ${(100 - Number(selectedZone.used_percent || 0)).toFixed(1)}%`, px + 170, py + 56);
            this.ctx.fillText('click card again to clear focus', px + 170, py + 72);
        }
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
        if (this.container) {
            this.container.style.display = 'none';
            this.container.style.visibility = 'hidden';
            this.container.style.pointerEvents = 'none';
        }
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
    }
}

window.FilesystemMapVisualization = FilesystemMapVisualization;
debugLog('🗂️ filesystem-map.js: FilesystemMapVisualization exported to window');
