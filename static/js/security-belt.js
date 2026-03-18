// Security Subsystem Visualization (Stage 3)
// Version: 10

debugLog('🛡️ security-belt.js v10: Script loading...');

class SecuritySubsystemVisualization {
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
        this.verdictFilter = 'all';
        this.filterButtons = new Map();
        this.clearProcessButton = null;
        this.selectedProcessFilter = null;
        this.hoveredProcessPid = null;
        this.trustNodeHitAreas = [];
        this.capabilityRowHitAreas = [];
        this.canvasClickHandler = null;
        this.canvasMouseMoveHandler = null;
    }

    init(containerId = 'security-belt-container') {
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
                background: radial-gradient(circle at 50% 40%, #121821 0%, #0a0d12 70%);
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
            color: #d4dbe8;
            font-family: 'Share Tech Mono', monospace;
            font-size: 24px;
            letter-spacing: 1px;
            z-index: 1001;
            text-shadow: 0 0 8px rgba(180, 210, 255, 0.25);
        `;
        title.textContent = 'KERNEL SECURITY SUBSYSTEM (stage 3)';
        this.container.appendChild(title);
        this.overlayNodes.push(title);

        const legend = document.createElement('div');
        legend.style.cssText = `
            position: absolute;
            top: 72px;
            left: 50%;
            transform: translateX(-50%);
            color: #a7b6cb;
            font-family: 'Share Tech Mono', monospace;
            font-size: 11px;
            z-index: 1001;
        `;
        legend.textContent = 'pipeline + trust + attack surface + lsm/capabilities/seccomp tools';
        this.container.appendChild(legend);
        this.overlayNodes.push(legend);

        const filterPanel = document.createElement('div');
        filterPanel.style.cssText = `
            position: absolute;
            top: 72px;
            right: 22px;
            display: flex;
            gap: 6px;
            z-index: 1001;
        `;
        const filters = [
            { key: 'all', label: 'ALL' },
            { key: 'allow', label: 'ALLOW' },
            { key: 'audit', label: 'AUDIT' },
            { key: 'deny', label: 'DENY' }
        ];
        filters.forEach((item) => {
            const btn = document.createElement('button');
            btn.textContent = item.label;
            btn.style.cssText = `
                padding: 4px 8px;
                background: rgba(8, 12, 18, 0.86);
                border: 1px solid rgba(150, 164, 188, 0.35);
                color: #bcc8db;
                font-family: 'Share Tech Mono', monospace;
                font-size: 9px;
                letter-spacing: 0.3px;
                cursor: pointer;
            `;
            btn.onclick = () => this.setVerdictFilter(item.key);
            filterPanel.appendChild(btn);
            this.filterButtons.set(item.key, btn);
            this.overlayNodes.push(btn);
        });
        this.container.appendChild(filterPanel);
        this.overlayNodes.push(filterPanel);

        const clearBtn = document.createElement('button');
        clearBtn.textContent = 'CLEAR PROCESS';
        clearBtn.style.cssText = `
            padding: 4px 8px;
            background: rgba(8, 12, 18, 0.56);
            border: 1px solid rgba(150, 164, 188, 0.22);
            color: rgba(188, 200, 219, 0.55);
            font-family: 'Share Tech Mono', monospace;
            font-size: 9px;
            letter-spacing: 0.3px;
            cursor: not-allowed;
        `;
        clearBtn.onclick = () => {
            if (!this.selectedProcessFilter) return;
            this.selectedProcessFilter = null;
            this.updateClearProcessButtonState();
        };
        filterPanel.appendChild(clearBtn);
        this.clearProcessButton = clearBtn;
        this.overlayNodes.push(clearBtn);
        this.setVerdictFilter(this.verdictFilter);
        this.updateClearProcessButtonState();
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
            background: rgba(7, 10, 16, 0.92);
            border: 1px solid rgba(178, 190, 212, 0.45);
            color: #d5dce8;
            font-family: 'Share Tech Mono', monospace;
            font-size: 12px;
            cursor: pointer;
            z-index: 1001;
            box-shadow: 0 0 14px rgba(150, 175, 220, 0.25);
            transition: all 0.25s ease;
        `;
        btn.onmouseenter = () => {
            btn.style.background = 'rgba(19, 25, 37, 0.95)';
            btn.style.color = '#fff';
        };
        btn.onmouseleave = () => {
            btn.style.background = 'rgba(7, 10, 16, 0.92)';
            btn.style.color = '#d5dce8';
        };
        btn.onclick = () => {
            const path = String(window.location.pathname || '').replace(/\/+$/, '') || '/';
            if (path === '/security' || path === '/linux-security-subsystem') {
                window.history.replaceState({}, '', '/');
            }
            if (window.kernelContextMenu) {
                window.kernelContextMenu.deactivateViews();
            } else {
                this.deactivate();
            }
        };
        this.container.appendChild(btn);
        this.exitButton = btn;
    }

    setVerdictFilter(filterKey) {
        this.verdictFilter = ['all', 'allow', 'audit', 'deny'].includes(filterKey) ? filterKey : 'all';
        this.filterButtons.forEach((btn, key) => {
            const active = key === this.verdictFilter;
            btn.style.background = active ? 'rgba(32, 52, 81, 0.92)' : 'rgba(8, 12, 18, 0.86)';
            btn.style.borderColor = active ? 'rgba(124, 178, 255, 0.9)' : 'rgba(150, 164, 188, 0.35)';
            btn.style.color = active ? '#d9ecff' : '#bcc8db';
        });
    }

    updateClearProcessButtonState() {
        if (!this.clearProcessButton) return;
        const active = Boolean(this.selectedProcessFilter);
        this.clearProcessButton.style.background = active ? 'rgba(32, 52, 81, 0.92)' : 'rgba(8, 12, 18, 0.56)';
        this.clearProcessButton.style.borderColor = active ? 'rgba(124, 178, 255, 0.9)' : 'rgba(150, 164, 188, 0.22)';
        this.clearProcessButton.style.color = active ? '#d9ecff' : 'rgba(188, 200, 219, 0.55)';
        this.clearProcessButton.style.cursor = active ? 'pointer' : 'not-allowed';
    }

    fetchTelemetry() {
        return fetch('/api/security-realtime')
            .then((res) => res.json())
            .then((data) => {
                if (!data || data.error) {
                    throw new Error(data?.error || 'No security data');
                }
                this.telemetry = data;
            })
            .catch(() => {
                this.telemetry = {
                    pipeline: { lanes: [] },
                    trust_graph: [],
                    attack_surface: [],
                    meta: { decisions_per_sec: 0, mode: 'fallback' }
                };
            });
    }

    normalizeName(name) {
        return String(name || '').trim().toLowerCase();
    }

    onCanvasClick(event) {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        let matched = null;
        for (const node of this.trustNodeHitAreas) {
            const dx = x - node.x;
            const dy = y - node.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist <= node.r + 4) {
                matched = node;
                break;
            }
        }
        if (!matched) {
            for (const row of this.capabilityRowHitAreas) {
                if (x >= row.x && x <= row.x + row.w && y >= row.y && y <= row.y + row.h) {
                    matched = row;
                    break;
                }
            }
        }
        if (!matched) return;
        const pid = Number(matched.pid || 0);
        if (this.selectedProcessFilter && Number(this.selectedProcessFilter.pid || 0) === pid) {
            this.selectedProcessFilter = null;
            this.updateClearProcessButtonState();
            return;
        }
        this.selectedProcessFilter = {
            pid,
            name: this.normalizeName(matched.name || 'unknown')
        };
        this.updateClearProcessButtonState();
    }

    onCanvasMouseMove(event) {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        let hovered = null;
        for (const node of this.trustNodeHitAreas) {
            const dx = x - node.x;
            const dy = y - node.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist <= node.r + 4) {
                hovered = Number(node.pid || 0);
                break;
            }
        }
        if (!hovered) {
            for (const row of this.capabilityRowHitAreas) {
                if (x >= row.x && x <= row.x + row.w && y >= row.y && y <= row.y + row.h) {
                    hovered = Number(row.pid || 0);
                    break;
                }
            }
        }
        this.hoveredProcessPid = hovered;
        this.canvas.style.cursor = hovered ? 'pointer' : 'default';
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

    drawPanel(x, y, w, h, title) {
        this.drawRoundedRect(x, y, w, h, 8);
        this.ctx.fillStyle = 'rgba(8, 11, 16, 0.88)';
        this.ctx.fill();
        this.ctx.strokeStyle = 'rgba(165, 178, 200, 0.35)';
        this.ctx.lineWidth = 0.95;
        this.ctx.stroke();

        this.ctx.fillStyle = '#d8e5f7';
        this.ctx.font = '13px "Share Tech Mono", monospace';
        this.ctx.fillText(title, x + 14, y + 20);
    }

    verdictColor(verdict) {
        if (verdict === 'deny') return '#eb7e7e';
        if (verdict === 'audit') return '#f4c977';
        if (verdict === 'allow') return '#60d69d';
        return '#8a9cea';
    }

    trustColor(trust) {
        if (trust === 'blocked') return '#eb7e7e';
        if (trust === 'suspicious') return '#f4c977';
        if (trust === 'observe') return '#8a9cea';
        return '#60d69d';
    }

    drawDecisionPipeline(x, y, w, h, telemetry) {
        this.drawPanel(x, y, w, h, 'THREAT DECISION PIPELINE');
        const lanes = Array.isArray(telemetry?.pipeline?.lanes) ? telemetry.pipeline.lanes : [];
        const selected = this.selectedProcessFilter;
        const filtered = lanes.filter((lane) => {
            const verdictMatch = this.verdictFilter === 'all' || lane.verdict === this.verdictFilter;
            if (!verdictMatch) return false;
            if (!selected) return true;
            const lanePid = Number(lane.pid || 0);
            const laneName = this.normalizeName(lane.process);
            return lanePid === Number(selected.pid || 0) || laneName === this.normalizeName(selected.name);
        });
        const laneRows = filtered.slice(0, 7);

        const stageXs = [x + 18, x + Math.floor(w * 0.44), x + Math.floor(w * 0.78)];
        const stageW = 130;
        const stageH = 24;
        const stageTitles = ['request event', 'lsm/seccomp hook', 'policy verdict'];
        stageXs.forEach((sx, i) => {
            this.drawRoundedRect(sx, y + 34, stageW, stageH, 5);
            this.ctx.fillStyle = 'rgba(12, 16, 22, 0.62)';
            this.ctx.fill();
            this.ctx.strokeStyle = 'rgba(112, 123, 140, 0.28)';
            this.ctx.stroke();
            this.ctx.fillStyle = '#9ed4ff';
            this.ctx.font = '10px "Share Tech Mono", monospace';
            this.ctx.fillText(stageTitles[i], sx + 8, y + 50);
            if (i < stageXs.length - 1) {
                this.ctx.beginPath();
                this.ctx.moveTo(sx + stageW + 6, y + 46);
                this.ctx.lineTo(stageXs[i + 1] - 8, y + 46);
                this.ctx.strokeStyle = 'rgba(155, 168, 190, 0.32)';
                this.ctx.stroke();
            }
        });

        laneRows.forEach((lane, idx) => {
            const yy = y + 76 + idx * 30;
            const color = this.verdictColor(String(lane.verdict || ''));
            const selected = this.selectedProcessFilter;
            const laneMatchSelected = !selected
                || Number(lane.pid || 0) === Number(selected.pid || 0)
                || this.normalizeName(lane.process) === this.normalizeName(selected.name);
            this.ctx.fillStyle = laneMatchSelected ? 'rgba(11, 16, 22, 0.72)' : 'rgba(10, 14, 20, 0.46)';
            this.ctx.fillRect(x + 14, yy - 12, w - 28, 24);

            this.ctx.fillStyle = laneMatchSelected ? '#d8ebff' : 'rgba(185, 200, 220, 0.62)';
            this.ctx.font = '10px "Share Tech Mono", monospace';
            this.ctx.fillText(`${String(lane.process || 'unknown').slice(0, 16)}:${lane.pid || 0}`, stageXs[0] + 4, yy + 2);
            this.ctx.fillText(String(lane.hook || '-').slice(0, 22), stageXs[1] + 4, yy + 2);
            this.ctx.fillStyle = laneMatchSelected ? color : 'rgba(140, 154, 173, 0.62)';
            this.ctx.fillText(String(lane.verdict || '-').toUpperCase(), stageXs[2] + 4, yy + 2);
        });

        if (!laneRows.length) {
            this.ctx.fillStyle = 'rgba(196, 207, 224, 0.72)';
            this.ctx.font = '11px "Share Tech Mono", monospace';
            if (selected) {
                this.ctx.fillText(`NO EVENTS FOR ${selected.name || 'PROCESS'} + FILTER`, x + 18, y + h - 16);
            } else {
                this.ctx.fillText('NO EVENTS FOR CURRENT FILTER', x + 18, y + h - 16);
            }
        }
    }

    drawTrustGraph(x, y, w, h, telemetry) {
        this.drawPanel(x, y, w, h, 'PROCESS TRUST GRAPH');
        this.trustNodeHitAreas = [];
        const rows = Array.isArray(telemetry?.trust_graph) ? telemetry.trust_graph.slice(0, 10) : [];
        const cx = x + Math.floor(w * 0.5);
        const cy = y + Math.floor(h * 0.56);
        const radius = Math.min(w, h) * 0.28;

        this.ctx.beginPath();
        this.ctx.arc(cx, cy, radius + 24, 0, Math.PI * 2);
        this.ctx.strokeStyle = 'rgba(162, 176, 198, 0.18)';
        this.ctx.stroke();
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        this.ctx.strokeStyle = 'rgba(162, 176, 198, 0.32)';
        this.ctx.stroke();
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, 26, 0, Math.PI * 2);
        this.ctx.fillStyle = 'rgba(7, 10, 15, 0.9)';
        this.ctx.fill();
        this.ctx.strokeStyle = 'rgba(162, 176, 198, 0.32)';
        this.ctx.stroke();
        this.ctx.fillStyle = '#cde6ff';
        this.ctx.font = '10px "Share Tech Mono", monospace';
        this.ctx.fillText('LSM', cx - 10, cy + 3);

        rows.forEach((row, idx) => {
            const a = ((Math.PI * 2) / Math.max(rows.length, 1)) * idx - Math.PI / 2;
            const nx = cx + Math.cos(a) * radius;
            const ny = cy + Math.sin(a) * radius;
            const trust = String(row.trust || 'trusted');
            const color = this.trustColor(trust);
            const pulse = 0.78 + 0.22 * Math.sin(this.tick * 0.04 + idx * 0.5);
            const pid = Number(row.pid || 0);
            const isSelected = this.selectedProcessFilter && Number(this.selectedProcessFilter.pid || 0) === pid;
            const isHovered = Number(this.hoveredProcessPid || 0) === pid;
            const nodeR = isSelected ? 12 : (isHovered ? 11 : 10);
            const glowR = isSelected ? 18 : (isHovered ? 15 : 0);

            this.ctx.beginPath();
            this.ctx.moveTo(cx, cy);
            this.ctx.lineTo(nx, ny);
            this.ctx.strokeStyle = `rgba(155, 168, 190, ${0.20 + 0.15 * pulse})`;
            this.ctx.lineWidth = isSelected ? 1.15 : 0.9;
            this.ctx.stroke();

            if (glowR > 0) {
                const glow = this.ctx.createRadialGradient(nx, ny, 0, nx, ny, glowR);
                glow.addColorStop(0, isSelected ? 'rgba(124, 178, 255, 0.38)' : 'rgba(138, 156, 234, 0.24)');
                glow.addColorStop(1, 'rgba(124, 178, 255, 0)');
                this.ctx.beginPath();
                this.ctx.arc(nx, ny, glowR, 0, Math.PI * 2);
                this.ctx.fillStyle = glow;
                this.ctx.fill();
            }

            this.ctx.beginPath();
            this.ctx.arc(nx, ny, nodeR, 0, Math.PI * 2);
            this.ctx.fillStyle = color;
            this.ctx.globalAlpha = 0.86;
            this.ctx.fill();
            this.ctx.globalAlpha = 1;
            this.ctx.strokeStyle = isSelected ? 'rgba(124, 178, 255, 0.95)' : '#0e1621';
            this.ctx.lineWidth = isSelected ? 1.5 : 0.95;
            this.ctx.stroke();
            this.ctx.lineWidth = 1;

            this.ctx.fillStyle = '#cfdced';
            this.ctx.font = '9px "Share Tech Mono", monospace';
            const label = `${String(row.name || 'proc').slice(0, 9)} (${row.risk_score || 0})`;
            this.ctx.fillText(label, nx - 32, ny + 21);

            this.trustNodeHitAreas.push({
                x: nx,
                y: ny,
                r: nodeR,
                pid,
                name: row.name || 'unknown'
            });
        });
    }

    drawAttackSurface(x, y, w, h, telemetry) {
        this.drawPanel(x, y, w, h, 'ATTACK SURFACE MAP');
        const rows = Array.isArray(telemetry?.attack_surface) ? telemetry.attack_surface.slice(0, 8) : [];

        rows.forEach((row, idx) => {
            const yy = y + 42 + idx * 34;
            const severity = String(row.severity || 'low');
            const color = severity === 'high' ? '#eb7e7e' : (severity === 'medium' ? '#f4c977' : '#8a9cea');
            this.drawRoundedRect(x + 14, yy, w - 28, 26, 5);
            this.ctx.fillStyle = 'rgba(12, 16, 22, 0.62)';
            this.ctx.fill();
            this.ctx.strokeStyle = 'rgba(112, 123, 140, 0.28)';
            this.ctx.lineWidth = 0.9;
            this.ctx.stroke();

            this.ctx.fillStyle = '#b6c6da';
            this.ctx.font = '10px "Share Tech Mono", monospace';
            this.ctx.fillText(String(row.name || '-').toUpperCase(), x + 22, yy + 17);
            this.ctx.fillStyle = '#d8e5f7';
            this.ctx.fillText(String(row.value || 0), x + w - 88, yy + 17);
            this.ctx.fillStyle = color;
            this.ctx.fillText(severity.toUpperCase(), x + w - 50, yy + 17);
        });
    }

    drawLsmStatusCard(x, y, w, h, telemetry) {
        this.drawPanel(x, y, w, h, 'LSM STATUS MATRIX');
        const rows = Array.isArray(telemetry?.security_tools?.lsm_status)
            ? telemetry.security_tools.lsm_status.slice(0, 6)
            : [];
        rows.forEach((row, idx) => {
            const yy = y + 40 + idx * 22;
            const status = String(row.status || 'unknown').toLowerCase();
            let color = '#8a9cea';
            if (status.includes('enforcing') || status.includes('blocked') || status.includes('hardened') || status.includes('present')) color = '#60d69d';
            if (status.includes('relaxed')) color = '#f4c977';
            if (status.includes('disabled') || status.includes('absent')) color = '#eb7e7e';
            this.ctx.fillStyle = 'rgba(10, 14, 20, 0.46)';
            this.ctx.fillRect(x + 12, yy - 12, w - 24, 18);
            this.ctx.fillStyle = '#cfdced';
            this.ctx.font = '10px "Share Tech Mono", monospace';
            this.ctx.fillText(String(row.name || 'lsm'), x + 16, yy);
            this.ctx.fillStyle = color;
            this.ctx.fillText(String(row.status || 'unknown').toUpperCase(), x + Math.floor(w * 0.56), yy);
            this.ctx.fillStyle = 'rgba(185, 200, 220, 0.7)';
            this.ctx.fillText(String(row.detail || ''), x + w - 74, yy);
        });
    }

    drawCapabilitiesCard(x, y, w, h, telemetry) {
        this.drawPanel(x, y, w, h, 'CAPABILITIES DRIFT');
        this.capabilityRowHitAreas = [];
        const rows = Array.isArray(telemetry?.security_tools?.capabilities_drift)
            ? telemetry.security_tools.capabilities_drift.slice(0, 6)
            : [];
        rows.forEach((row, idx) => {
            const yy = y + 40 + idx * 22;
            const pid = Number(row.pid || 0);
            const risk = Number(row.risk_score || 0);
            const danger = Array.isArray(row.dangerous) ? row.dangerous : [];
            const color = risk >= 70 ? '#eb7e7e' : (risk >= 45 ? '#f4c977' : '#8a9cea');
            const isSelected = this.selectedProcessFilter && Number(this.selectedProcessFilter.pid || 0) === pid;
            const isHovered = Number(this.hoveredProcessPid || 0) === pid;
            const rowX = x + 12;
            const rowY = yy - 12;
            const rowW = w - 24;
            const rowH = 18;
            this.ctx.fillStyle = isSelected ? 'rgba(32, 52, 81, 0.62)' : (isHovered ? 'rgba(22, 34, 52, 0.56)' : 'rgba(10, 14, 20, 0.46)');
            this.ctx.fillRect(rowX, rowY, rowW, rowH);
            if (isSelected || isHovered) {
                this.ctx.strokeStyle = isSelected ? 'rgba(124, 178, 255, 0.95)' : 'rgba(112, 152, 216, 0.72)';
                this.ctx.lineWidth = isSelected ? 1.2 : 0.9;
                this.ctx.strokeRect(rowX + 0.5, rowY + 0.5, rowW - 1, rowH - 1);
            }
            this.ctx.fillStyle = '#d8e5f7';
            this.ctx.font = '10px "Share Tech Mono", monospace';
            this.ctx.fillText(`${String(row.name || 'proc').slice(0, 10)}:${pid || 0}`, x + 16, yy);
            this.ctx.fillStyle = color;
            this.ctx.fillText(`risk ${risk}`, x + Math.floor(w * 0.40), yy);
            this.ctx.fillStyle = 'rgba(185, 200, 220, 0.72)';
            this.ctx.fillText(danger.slice(0, 2).join(','), x + Math.floor(w * 0.56), yy);
            this.capabilityRowHitAreas.push({
                x: rowX,
                y: rowY,
                w: rowW,
                h: rowH,
                pid,
                name: row.name || 'unknown'
            });
        });
    }

    drawSeccompCoverageCard(x, y, w, h, telemetry) {
        this.drawPanel(x, y, w, h, 'SECCOMP COVERAGE');
        const cov = telemetry?.security_tools?.seccomp_coverage || {};
        const none = Number(cov.none || 0);
        const strict = Number(cov.strict || 0);
        const filter = Number(cov.filter || 0);
        const unknown = Number(cov.unknown || 0);
        const coverage = Number(cov.coverage_percent || 0);

        this.ctx.fillStyle = 'rgba(179, 203, 232, 0.9)';
        this.ctx.font = '11px "Share Tech Mono", monospace';
        this.ctx.fillText(`coverage ${coverage.toFixed(2)}%`, x + 14, y + 42);
        this.ctx.fillText(`filter:${filter} strict:${strict} none:${none} unknown:${unknown}`, x + 14, y + 60);

        const barX = x + 14;
        const barY = y + 72;
        const barW = w - 28;
        const barH = 12;
        this.ctx.fillStyle = 'rgba(12, 16, 22, 0.62)';
        this.ctx.fillRect(barX, barY, barW, barH);
        const fillW = Math.max(0, Math.min(barW, (coverage / 100) * barW));
        this.ctx.fillStyle = coverage >= 80 ? '#60d69d' : (coverage >= 50 ? '#f4c977' : '#eb7e7e');
        this.ctx.fillRect(barX, barY, fillW, barH);

        const unsandboxed = Array.isArray(cov.high_risk_unsandboxed) ? cov.high_risk_unsandboxed.slice(0, 4) : [];
        unsandboxed.forEach((row, idx) => {
            const yy = y + 102 + idx * 20;
            this.ctx.fillStyle = 'rgba(10, 14, 20, 0.46)';
            this.ctx.fillRect(x + 12, yy - 11, w - 24, 16);
            this.ctx.fillStyle = '#d8e5f7';
            this.ctx.font = '10px "Share Tech Mono", monospace';
            this.ctx.fillText(`${String(row.name || 'proc').slice(0, 14)}:${row.pid || 0}`, x + 16, yy);
            this.ctx.fillStyle = '#eb7e7e';
            this.ctx.fillText(`risk ${Number(row.risk_score || 0)}`, x + w - 88, yy);
        });
    }

    drawHeaderStats(telemetry) {
        const meta = telemetry?.meta || {};
        this.ctx.fillStyle = 'rgba(179, 203, 232, 0.92)';
        this.ctx.font = '11px "Share Tech Mono", monospace';
        this.ctx.fillText(`decisions/s ${Number(meta.decisions_per_sec || 0).toFixed(2)}`, 26, 114);
        this.ctx.fillText(`events ${Number(meta.events || 0)}`, 226, 114);
        this.ctx.fillText(`mode ${String(meta.mode || 'n/a')}`, 326, 114);
        this.ctx.fillText(
            `trust T:${meta.trusted || 0} O:${meta.observe || 0} S:${meta.suspicious || 0} B:${meta.blocked || 0}`,
            500,
            114
        );
        this.ctx.fillText(`seccomp coverage ${Number(meta.seccomp_coverage_percent || 0).toFixed(2)}%`, 930, 114);
        this.ctx.fillStyle = 'rgba(180, 196, 220, 0.86)';
        const selected = this.selectedProcessFilter;
        if (selected) {
            this.ctx.fillText(`selected process: ${selected.name}:${selected.pid} (click again to clear)`, 26, 132);
        } else {
            this.ctx.fillText('tip: click a process node or CAPABILITIES DRIFT row to filter pipeline', 26, 132);
        }
    }

    drawScene() {
        if (!this.ctx || !this.canvas) return;
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.ctx.clearRect(0, 0, w, h);
        this.tick += 1;

        // Match crypto page background treatment.
        const bg = this.ctx.createRadialGradient(
            w * 0.5,
            h * 0.4,
            0,
            w * 0.5,
            h * 0.4,
            Math.max(w, h) * 0.72
        );
        bg.addColorStop(0, '#121821');
        bg.addColorStop(0.7, '#0a0d12');
        bg.addColorStop(1, '#0a0d12');
        this.ctx.fillStyle = bg;
        this.ctx.fillRect(0, 0, w, h);

        // Grid backdrop.
        this.ctx.strokeStyle = 'rgba(108, 120, 139, 0.14)';
        this.ctx.lineWidth = 0.9;
        for (let x = 0; x < w; x += 54) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, h);
            this.ctx.stroke();
        }
        for (let y = 0; y < h; y += 42) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(w, y);
            this.ctx.stroke();
        }

        if (!this.telemetry) return;
        this.drawHeaderStats(this.telemetry);

        const gap = 16;
        const panelTop = 172;
        const toolsH = Math.max(128, Math.min(176, Math.floor(h * 0.22)));
        const panelH = Math.max(220, h - panelTop - toolsH - gap - 24);
        const leftW = Math.max(440, Math.floor(w * 0.42));
        const centerW = Math.max(330, Math.floor(w * 0.26));
        const rightW = Math.max(310, w - leftW - centerW - gap * 4);

        const leftX = gap;
        const centerX = leftX + leftW + gap;
        const rightX = centerX + centerW + gap;
        const toolsY = panelTop + panelH + gap;
        const toolsW = Math.max(220, Math.floor((w - gap * 4) / 3));
        const tools2X = leftX + toolsW + gap;
        const tools3X = tools2X + toolsW + gap;

        this.drawDecisionPipeline(leftX, panelTop, leftW, panelH, this.telemetry);
        this.drawTrustGraph(centerX, panelTop, centerW, panelH, this.telemetry);
        this.drawAttackSurface(rightX, panelTop, rightW, panelH, this.telemetry);
        this.drawLsmStatusCard(leftX, toolsY, toolsW, toolsH, this.telemetry);
        this.drawCapabilitiesCard(tools2X, toolsY, toolsW, toolsH, this.telemetry);
        this.drawSeccompCoverageCard(tools3X, toolsY, toolsW, toolsH, this.telemetry);
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
        }, 1300);

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
        if (this.canvas) {
            this.canvas.style.cursor = 'default';
        }
    }

    onResize() {
        if (!this.canvas) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.canvas.width = Math.floor(window.innerWidth * dpr);
        this.canvas.height = Math.floor(window.innerHeight * dpr);
        this.canvas.style.width = `${window.innerWidth}px`;
        this.canvas.style.height = `${window.innerHeight}px`;
        if (this.ctx) this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
}

window.SecuritySubsystemVisualization = SecuritySubsystemVisualization;
debugLog('🛡️ security-belt.js: SecuritySubsystemVisualization exported to window');
