// Filesystem Block Map Visualization
// Version: 2

console.log('🗂️ filesystem-map.js v2: Script loading...');

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
                background: #0E1114;
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
        title.textContent = 'FILESYSTEM BLOCK MAP';
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
        legend.textContent = 'filesystem map by zones: gray=free, black=used, yellow=actively writing';
        this.container.appendChild(legend);
        this.overlayNodes.push(legend);

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
        return fetch('/api/filesystem-blocks')
            .then((res) => res.json())
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
                        ` | active blocks ${m.writing_blocks || 0}`;
                }
            })
            .catch((err) => {
                if (this.infoNode) {
                    this.infoNode.textContent = `filesystem telemetry fallback: ${err.message}`;
                }
            });
    }

    drawGrid() {
        if (!this.ctx || !this.canvas) return;
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.ctx.clearRect(0, 0, w, h);

        this.ctx.fillStyle = '#0E1114';
        this.ctx.fillRect(0, 0, w, h);

        if (!this.telemetry || !Array.isArray(this.telemetry.blocks)) return;

        const rows = Math.max(1, Number(this.telemetry.rows || 1));
        const cols = Math.max(1, Number(this.telemetry.cols || 1));
        const blocks = this.telemetry.blocks;
        const zones = Array.isArray(this.telemetry.zones) ? this.telemetry.zones : [];

        const topPad = 120;
        const bottomPad = 40;
        const sidePad = 70;
        const availableW = Math.max(100, w - sidePad * 2);
        const availableH = Math.max(100, h - topPad - bottomPad);

        const cellW = Math.floor(availableW / cols);
        const cellH = Math.floor(availableH / rows);
        const size = Math.max(4, Math.min(cellW, cellH) - 2);
        const startX = Math.floor((w - (cols * (size + 2))) / 2);
        const startY = Math.floor(topPad + (availableH - (rows * (size + 2))) / 2);

        blocks.forEach((b) => {
            const r = Number.isFinite(Number(b.r)) ? Number(b.r) : Math.floor(Number(b.i || 0) / cols);
            const c = Number.isFinite(Number(b.c)) ? Number(b.c) : (Number(b.i || 0) % cols);
            const x = startX + c * (size + 2);
            const y = startY + r * (size + 2);

            if (b.state === 'free') this.ctx.fillStyle = '#8f9499';
            else if (b.state === 'writing') this.ctx.fillStyle = '#e6c15a';
            else this.ctx.fillStyle = '#15171a';

            this.ctx.fillRect(x, y, size, size);
        });

        // Draw zone boundaries and labels to make a readable filesystem map.
        this.ctx.font = '11px "Share Tech Mono", monospace';
        zones.forEach((z) => {
            const rs = Number(z.row_start || 0);
            const re = Number(z.row_end || rs);
            const zx = startX - 6;
            const zy = startY + rs * (size + 2) - 4;
            const zw = cols * (size + 2) + 8;
            const zh = (re - rs + 1) * (size + 2) + 6;

            this.ctx.strokeStyle = 'rgba(170, 178, 188, 0.26)';
            this.ctx.lineWidth = 1;
            this.ctx.strokeRect(zx, zy, zw, zh);

            const label = `${z.name}  used:${z.used_percent}%  act:${z.activity}`;
            this.ctx.fillStyle = 'rgba(200, 206, 216, 0.92)';
            this.ctx.fillText(label, zx + 8, zy + 14);
        });
    }

    animate() {
        if (!this.isActive) return;
        this.animationId = requestAnimationFrame(() => this.animate());
        this.drawGrid();
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
console.log('🗂️ filesystem-map.js: FilesystemMapVisualization exported to window');
