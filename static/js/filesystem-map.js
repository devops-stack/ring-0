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
        this.canvas.addEventListener('click', this.canvasClickHandler);

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

    drawPackageStack(x, y, w, h, layers, accentColor, label, metaText) {
        const ctx = this.ctx;
        const stackLayers = Math.max(2, Math.min(4, layers));
        for (let i = stackLayers - 1; i >= 0; i -= 1) {
            const dx = -i * 4;
            const dy = i * 3;
            this.drawRoundedRect(x + dx, y + dy, w, h, 5);
            ctx.fillStyle = i === 0 ? 'rgba(14, 24, 36, 0.95)' : 'rgba(10, 16, 26, 0.85)';
            ctx.fill();
            ctx.strokeStyle = i === 0 ? accentColor : 'rgba(72, 94, 124, 0.35)';
            ctx.lineWidth = i === 0 ? 1.0 : 0.7;
            ctx.stroke();
        }
        ctx.fillStyle = '#9fc0e8';
        ctx.font = '9px "Share Tech Mono", monospace';
        ctx.fillText(label, x + 8, y + 13);
        ctx.fillStyle = 'rgba(122, 141, 167, 0.85)';
        ctx.font = '8px "Share Tech Mono", monospace';
        ctx.fillText(metaText, x + 8, y + 24);
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

    onCanvasClick(event) {
        if (!this.orbHitArea || !this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const dx = x - this.orbHitArea.x;
        const dy = y - this.orbHitArea.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= this.orbHitArea.r * 1.25) {
            this.cycleRenderMode();
        }
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

        const cx = Math.floor(w * 0.53);
        const cy = Math.floor(h * 0.63);
        const outerR = Math.max(130, Math.min(250, Math.floor(Math.min(w, h) * 0.28)));
        const innerR = Math.max(24, Math.floor(outerR * 0.14));
        const ringGap = (outerR - innerR) / Math.max(1, rows);
        const angleStep = (Math.PI * 2) / Math.max(1, cols);

        // Background circuit lines.
        this.ctx.strokeStyle = 'rgba(150, 38, 64, 0.17)';
        this.ctx.lineWidth = 1;
        for (let i = 0; i < 9; i += 1) {
            const y = 120 + i * 44;
            this.ctx.beginPath();
            this.ctx.moveTo(cx - outerR - 130, y);
            this.ctx.lineTo(cx + outerR + 130, y);
            this.ctx.stroke();
        }

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
            const r0 = innerR + rIdx * ringGap;
            const r1 = r0 + Math.max(1.3, ringGap * 0.8);
            const a0 = cIdx * angleStep;
            const a1 = a0 + angleStep * 0.88;

            const z = zoneMap.get(String(b.zone_id || '')) || {};
            const zoneAct = Math.max(0, Math.min(100, Number(z.activity || 0)));
            const inodePressure = Math.max(0, Math.min(100, Number(z.inode_pressure || 0)));
            if (this.renderMode === 'write') {
                if (b.state === 'writing') this.ctx.fillStyle = 'rgba(127, 232, 255, 0.92)';
                else if (b.state === 'used') this.ctx.fillStyle = `rgba(44, 132, 184, ${0.32 + Math.min(0.5, zoneAct / 120)})`;
                else this.ctx.fillStyle = 'rgba(14, 28, 44, 0.48)';
            } else if (this.renderMode === 'inode') {
                if (b.state === 'free') this.ctx.fillStyle = 'rgba(12, 24, 38, 0.45)';
                else this.ctx.fillStyle = `rgba(127, 232, 255, ${0.18 + Math.min(0.72, inodePressure / 110)})`;
            } else {
                if (b.state === 'writing') this.ctx.fillStyle = 'rgba(127, 232, 255, 0.9)';
                else if (b.state === 'free') this.ctx.fillStyle = 'rgba(19, 38, 58, 0.55)';
                else this.ctx.fillStyle = 'rgba(44, 132, 184, 0.72)';
            }

            this.ctx.beginPath();
            this.ctx.arc(cx, cy, r1, a0, a1);
            this.ctx.arc(cx, cy, r0, a1, a0, true);
            this.ctx.closePath();
            this.ctx.fill();
        });

        // Central hole.
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, innerR - 3, 0, Math.PI * 2);
        this.ctx.fillStyle = '#081018';
        this.ctx.fill();

        // Alert banner.
        const m = this.telemetry.meta || {};
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
        const zoneItems = zones.slice(0, 14);
        const leftItems = zoneItems.filter((_, i) => i % 2 === 0);
        const rightItems = zoneItems.filter((_, i) => i % 2 === 1);
        const cardW = 90;
        const cardH = 32;
        const leftX = Math.max(24, cx - outerR - 220);
        const rightX = Math.min(w - cardW - 24, cx + outerR + 110);
        const topY = Math.max(150, cy - outerR + 12);

        const drawZonePack = (list, xBase, isLeft) => {
            list.forEach((z, idx) => {
                const y = topY + idx * 42;
                const active = Number(z.activity || 0) > 6 || Number(z.writing_blocks || 0) > 0;
                const accent = active ? 'rgba(118, 220, 255, 0.92)' : 'rgba(90, 132, 178, 0.7)';
                const layers = 2 + (active ? 2 : 1);
                this.drawPackageStack(
                    xBase,
                    y,
                    cardW,
                    cardH,
                    layers,
                    accent,
                    String(z.name || z.id || 'zone'),
                    `used:${Number(z.used_percent || 0).toFixed(0)}%`
                );

                // Connector to central disk.
                const sx = isLeft ? xBase + cardW : xBase;
                const sy = y + cardH / 2;
                const tx = cx + (isLeft ? -outerR * 0.85 : outerR * 0.85);
                const ty = cy - outerR * 0.65 + idx * 10;
                this.ctx.beginPath();
                this.ctx.moveTo(sx, sy);
                this.ctx.bezierCurveTo(
                    sx + (isLeft ? 60 : -60),
                    sy,
                    tx + (isLeft ? -40 : 40),
                    ty,
                    tx,
                    ty
                );
                this.ctx.strokeStyle = 'rgba(169, 52, 80, 0.26)';
                this.ctx.lineWidth = 1;
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
