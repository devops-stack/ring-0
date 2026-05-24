// Security Subsystem Visualization (Stage 4: Kernel Security Core)
// Version: 13

debugLog('🛡️ security-belt.js v13: Script loading...');

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
        this.ringHitAreas = [];
        this.focusedRingKey = null;
        this.hoveredRingKey = null;
        this.ringFocusPinned = false;
        this.panelRects = {};
        this.panelSpotlight = null;
        this.canvasClickHandler = null;
        this.canvasMouseMoveHandler = null;
        this.canvasDoubleClickHandler = null;
        this.showSecurityCorePanel = false;
        this.corePanelToggleButton = null;
        this.ringDerivedVerdictFilter = null;
        this.focusStatusNode = null;
        this.unpinButton = null;
        this.trustGraphMode = 'topology';
        this.trustModeButton = null;
        this.trustForensicsLayout = new Map();
        this.trustForensicsFreezeUntil = 0;
        this.trustForensicsFreezeWindowMs = 8000;
        this.selectedIncidentTrail = [];
        this.incidentTrailWindowMs = 22000;
        this.incidentTrailMaxPoints = 36;
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
        this.canvasDoubleClickHandler = (event) => this.onCanvasDoubleClick(event);
        this.canvas.addEventListener('click', this.canvasClickHandler);
        this.canvas.addEventListener('mousemove', this.canvasMouseMoveHandler);
        this.canvas.addEventListener('dblclick', this.canvasDoubleClickHandler);

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
        legend.textContent = 'ring-first security model: policy / sandbox / threat pressure';
        this.container.appendChild(legend);
        this.overlayNodes.push(legend);

        const focusStatus = document.createElement('div');
        focusStatus.style.cssText = `
            position: absolute;
            top: 92px;
            left: 24px;
            color: rgba(170, 188, 214, 0.88);
            font-family: 'Share Tech Mono', monospace;
            font-size: 10px;
            letter-spacing: 0.3px;
            z-index: 1001;
        `;
        focusStatus.textContent = 'FOCUS: NONE';
        this.container.appendChild(focusStatus);
        this.overlayNodes.push(focusStatus);
        this.focusStatusNode = focusStatus;

        const unpinBtn = document.createElement('button');
        unpinBtn.textContent = 'UNPIN';
        unpinBtn.style.cssText = `
            position: absolute;
            top: 88px;
            left: 218px;
            padding: 3px 8px;
            background: rgba(8, 12, 18, 0.56);
            border: 1px solid rgba(150, 164, 188, 0.22);
            color: rgba(188, 200, 219, 0.55);
            font-family: 'Share Tech Mono', monospace;
            font-size: 9px;
            letter-spacing: 0.25px;
            cursor: not-allowed;
            z-index: 1001;
        `;
        unpinBtn.onclick = () => {
            if (!this.ringFocusPinned) return;
            this.ringFocusPinned = false;
            this.focusedRingKey = null;
            this.applyRingFocusVerdictFilter();
            this.updateFocusStatusUi();
        };
        this.container.appendChild(unpinBtn);
        this.overlayNodes.push(unpinBtn);
        this.unpinButton = unpinBtn;

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
            this.selectedIncidentTrail = [];
            this.updateClearProcessButtonState();
        };
        filterPanel.appendChild(clearBtn);
        this.clearProcessButton = clearBtn;
        this.overlayNodes.push(clearBtn);

        const coreToggleBtn = document.createElement('button');
        coreToggleBtn.textContent = 'CORE PANEL: OFF';
        coreToggleBtn.style.cssText = `
            padding: 4px 8px;
            background: rgba(8, 12, 18, 0.56);
            border: 1px solid rgba(150, 164, 188, 0.22);
            color: rgba(188, 200, 219, 0.8);
            font-family: 'Share Tech Mono', monospace;
            font-size: 9px;
            letter-spacing: 0.3px;
            cursor: pointer;
        `;
        coreToggleBtn.onclick = () => {
            this.showSecurityCorePanel = !this.showSecurityCorePanel;
            this.updateCorePanelToggleButtonState();
        };
        filterPanel.appendChild(coreToggleBtn);
        this.corePanelToggleButton = coreToggleBtn;
        this.overlayNodes.push(coreToggleBtn);

        const trustModeBtn = document.createElement('button');
        trustModeBtn.textContent = 'TRUST MODE: TOPOLOGY';
        trustModeBtn.style.cssText = `
            padding: 4px 8px;
            background: rgba(8, 12, 18, 0.56);
            border: 1px solid rgba(150, 164, 188, 0.22);
            color: rgba(188, 200, 219, 0.8);
            font-family: 'Share Tech Mono', monospace;
            font-size: 9px;
            letter-spacing: 0.3px;
            cursor: pointer;
        `;
        trustModeBtn.onclick = () => this.toggleTrustGraphMode();
        filterPanel.appendChild(trustModeBtn);
        this.trustModeButton = trustModeBtn;
        this.overlayNodes.push(trustModeBtn);

        this.setVerdictFilter(this.verdictFilter);
        this.updateClearProcessButtonState();
        this.updateCorePanelToggleButtonState();
        this.updateTrustGraphModeButtonState();
        this.updateFocusStatusUi();
    }

    updateCorePanelToggleButtonState() {
        if (!this.corePanelToggleButton) return;
        const on = this.showSecurityCorePanel;
        this.corePanelToggleButton.textContent = on ? 'CORE PANEL: ON' : 'CORE PANEL: OFF';
        this.corePanelToggleButton.style.background = on ? 'rgba(32, 52, 81, 0.92)' : 'rgba(8, 12, 18, 0.56)';
        this.corePanelToggleButton.style.borderColor = on ? 'rgba(124, 178, 255, 0.9)' : 'rgba(150, 164, 188, 0.22)';
        this.corePanelToggleButton.style.color = on ? '#d9ecff' : 'rgba(188, 200, 219, 0.8)';
    }

    toggleTrustGraphMode() {
        const order = ['topology', 'risk', 'forensics'];
        const currentIdx = order.indexOf(this.trustGraphMode);
        const nextIdx = currentIdx >= 0 ? ((currentIdx + 1) % order.length) : 0;
        this.trustGraphMode = order[nextIdx];
        this.updateTrustGraphModeButtonState();
    }

    updateTrustGraphModeButtonState() {
        if (!this.trustModeButton) return;
        const labels = {
            topology: 'TOPOLOGY',
            risk: 'RISK HEAT',
            forensics: 'FORENSICS'
        };
        const modeLabel = labels[this.trustGraphMode] || 'TOPOLOGY';
        const isRisk = this.trustGraphMode === 'risk';
        const isForensics = this.trustGraphMode === 'forensics';
        this.trustModeButton.textContent = `TRUST MODE: ${modeLabel}`;
        this.trustModeButton.style.background = isRisk
            ? 'rgba(70, 35, 32, 0.92)'
            : (isForensics ? 'rgba(28, 45, 64, 0.92)' : 'rgba(8, 12, 18, 0.56)');
        this.trustModeButton.style.borderColor = isRisk
            ? 'rgba(255, 156, 126, 0.9)'
            : (isForensics ? 'rgba(132, 190, 255, 0.88)' : 'rgba(150, 164, 188, 0.22)');
        this.trustModeButton.style.color = isRisk
            ? '#ffd8cb'
            : (isForensics ? '#e3f2ff' : 'rgba(188, 200, 219, 0.8)');
    }

    buildForensicsLayout(rows, cx, cy, innerRadius, maxRadius) {
        const layout = new Map();
        const ordered = rows.slice().sort((a, b) => Number(a?.pid || 0) - Number(b?.pid || 0));
        ordered.forEach((row, idx) => {
            const pid = Number(row?.pid || 0);
            const risk = Number(row?.risk_score || 0);
            const riskNorm = Math.max(0, Math.min(1, risk / 100));
            const seed = ((pid % 37) + 37) % 37;
            const offset = (seed / 37 - 0.5) * 0.34;
            const angle = ((Math.PI * 2) / Math.max(ordered.length, 1)) * idx - Math.PI / 2 + offset;
            const orbit = innerRadius + (maxRadius - innerRadius) * (0.24 + riskNorm * 0.76);
            layout.set(pid, {
                angle,
                orbit,
                nx: cx + Math.cos(angle) * orbit,
                ny: cy + Math.sin(angle) * orbit
            });
        });
        return layout;
    }

    findSelectedTrustRow(rows) {
        if (!this.selectedProcessFilter || !Array.isArray(rows) || !rows.length) return null;
        const selectedPid = Number(this.selectedProcessFilter.pid || 0);
        const selectedName = this.normalizeName(this.selectedProcessFilter.name || '');
        return rows.find((row) => {
            const rowPid = Number(row?.pid || 0);
            const rowName = this.normalizeName(row?.name || '');
            return rowPid === selectedPid || (selectedName && rowName === selectedName);
        }) || null;
    }

    updateSelectedIncidentTrail(rows) {
        if (!this.selectedProcessFilter) {
            this.selectedIncidentTrail = [];
            return;
        }
        const selectedRow = this.findSelectedTrustRow(rows);
        if (!selectedRow) return;
        const now = Date.now();
        const risk = Number(selectedRow.risk_score || 0);
        const trust = String(selectedRow.trust || 'trusted');
        const prev = this.selectedIncidentTrail[this.selectedIncidentTrail.length - 1];
        if (!prev || Math.abs(Number(prev.risk || 0) - risk) >= 0.5 || prev.trust !== trust || (now - Number(prev.ts || 0)) >= 1300) {
            this.selectedIncidentTrail.push({ ts: now, risk, trust });
        } else {
            prev.ts = now;
            prev.risk = risk;
            prev.trust = trust;
        }
        const cutoff = now - this.incidentTrailWindowMs;
        this.selectedIncidentTrail = this.selectedIncidentTrail
            .filter((item) => Number(item.ts || 0) >= cutoff)
            .slice(-this.incidentTrailMaxPoints);
    }

    drawIncidentTrail(x, y, w, h, selectedNode) {
        if (!this.selectedProcessFilter || this.selectedIncidentTrail.length < 2) return;
        const trail = this.selectedIncidentTrail;
        const now = Date.now();
        const chartX = x + 14;
        const chartY = y + h - 58;
        const chartW = Math.max(110, w - 28);
        const chartH = 42;

        this.drawRoundedRect(chartX, chartY, chartW, chartH, 5);
        this.ctx.fillStyle = 'rgba(9, 13, 19, 0.56)';
        this.ctx.fill();
        this.ctx.strokeStyle = 'rgba(122, 141, 166, 0.28)';
        this.ctx.lineWidth = 0.9;
        this.ctx.stroke();

        this.ctx.beginPath();
        trail.forEach((entry, idx) => {
            const age = Math.max(0, now - Number(entry.ts || now));
            const progress = 1 - Math.min(1, age / this.incidentTrailWindowMs);
            const px = chartX + 8 + progress * (chartW - 16);
            const py = chartY + chartH - 8 - (Math.max(0, Math.min(100, Number(entry.risk || 0))) / 100) * (chartH - 14);
            if (idx === 0) this.ctx.moveTo(px, py);
            else this.ctx.lineTo(px, py);
        });
        this.ctx.strokeStyle = 'rgba(151, 210, 255, 0.88)';
        this.ctx.lineWidth = 1.2;
        this.ctx.stroke();

        const latest = trail[trail.length - 1];
        const latestAge = Math.max(0, now - Number(latest.ts || now));
        const latestProgress = 1 - Math.min(1, latestAge / this.incidentTrailWindowMs);
        const latestX = chartX + 8 + latestProgress * (chartW - 16);
        const latestY = chartY + chartH - 8 - (Math.max(0, Math.min(100, Number(latest.risk || 0))) / 100) * (chartH - 14);
        this.ctx.beginPath();
        this.ctx.arc(latestX, latestY, 2.6, 0, Math.PI * 2);
        this.ctx.fillStyle = 'rgba(175, 228, 255, 0.95)';
        this.ctx.fill();

        this.ctx.fillStyle = 'rgba(154, 176, 206, 0.85)';
        this.ctx.font = '8px "Share Tech Mono", monospace';
        this.ctx.fillText(`incident trail ${Math.min(this.incidentTrailWindowMs / 1000, (now - Number(trail[0].ts || now)) / 1000).toFixed(1)}s`, chartX + 8, chartY + 12);
        this.ctx.fillText(`risk ${Number(latest.risk || 0).toFixed(1)} ${String(latest.trust || '').toUpperCase()}`, chartX + chartW - 154, chartY + 12);

        // Thin halo markers from historical risk samples around the selected node.
        if (selectedNode) {
            const historyToDraw = trail.slice(-8);
            const angle = Number(selectedNode.angle || -Math.PI / 2);
            historyToDraw.forEach((entry, idx) => {
                const riskNorm = Math.max(0, Math.min(1, Number(entry.risk || 0) / 100));
                const rr = selectedNode.innerRadius + (selectedNode.maxRadius - selectedNode.innerRadius) * (0.2 + riskNorm * 0.8);
                const hx = selectedNode.cx + Math.cos(angle) * rr;
                const hy = selectedNode.cy + Math.sin(angle) * rr;
                const alpha = 0.16 + (idx / Math.max(1, historyToDraw.length)) * 0.45;
                this.ctx.beginPath();
                this.ctx.arc(hx, hy, 1.1 + idx * 0.1, 0, Math.PI * 2);
                this.ctx.fillStyle = `rgba(158, 219, 255, ${alpha.toFixed(3)})`;
                this.ctx.fill();
            });
        }
    }

    updateFocusStatusUi() {
        const ringTone = {
            policy: '#8bd0ff',
            sandbox: '#8ff0bf',
            threat: '#ff9aa6'
        };
        if (this.focusStatusNode) {
            if (!this.focusedRingKey) {
                this.focusStatusNode.textContent = 'FOCUS: NONE';
                this.focusStatusNode.style.color = 'rgba(170, 188, 214, 0.88)';
            } else {
                const ringLabel = String(this.focusedRingKey).toUpperCase();
                this.focusStatusNode.textContent = this.ringFocusPinned
                    ? `FOCUS: ${ringLabel} (PINNED)`
                    : `FOCUS: ${ringLabel}`;
                this.focusStatusNode.style.color = ringTone[this.focusedRingKey] || 'rgba(170, 188, 214, 0.88)';
            }
        }
        if (this.unpinButton) {
            const active = Boolean(this.ringFocusPinned && this.focusedRingKey);
            this.unpinButton.style.background = active ? 'rgba(32, 52, 81, 0.92)' : 'rgba(8, 12, 18, 0.56)';
            this.unpinButton.style.borderColor = active ? 'rgba(124, 178, 255, 0.9)' : 'rgba(150, 164, 188, 0.22)';
            this.unpinButton.style.color = active ? '#d9ecff' : 'rgba(188, 200, 219, 0.55)';
            this.unpinButton.style.cursor = active ? 'pointer' : 'not-allowed';
        }
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
        return window.fetchJson('/api/security-realtime', { cache: 'no-store' }, {
            timeoutMs: 6000,
            suppressToast: true,
            context: 'security-realtime'
        })
            .then((data) => {
                if (!data || data.error) {
                    throw new Error(data?.error || 'No security data');
                }
                this.telemetry = data;
                const trustRows = Array.isArray(data?.trust_graph) ? data.trust_graph : [];
                this.updateSelectedIncidentTrail(trustRows);
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
        const ringHit = this.getRingHitAt(x, y);
        if (ringHit) {
            this.focusedRingKey = this.focusedRingKey === ringHit.key ? null : ringHit.key;
            this.ringFocusPinned = false;
            this.applyRingFocusVerdictFilter();
            this.updateFocusStatusUi();
            return;
        }
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
            this.selectedIncidentTrail = [];
            this.updateClearProcessButtonState();
            return;
        }
        this.selectedProcessFilter = {
            pid,
            name: this.normalizeName(matched.name || 'unknown')
        };
        this.selectedIncidentTrail = [];
        this.updateClearProcessButtonState();
    }

    onCanvasDoubleClick(event) {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const ringHit = this.getRingHitAt(x, y);
        if (!ringHit) return;
        this.focusedRingKey = ringHit.key;
        this.ringFocusPinned = true;
        this.applyRingFocusVerdictFilter();
        this.updateFocusStatusUi();
        this.triggerPanelFocusFromRing(ringHit.key);
    }

    applyRingFocusVerdictFilter() {
        if (!this.focusedRingKey) {
            this.ringDerivedVerdictFilter = null;
            this.ringFocusPinned = false;
            this.updateFocusStatusUi();
            return;
        }
        const map = {
            policy: 'audit',
            sandbox: 'allow',
            threat: 'deny'
        };
        this.ringDerivedVerdictFilter = map[this.focusedRingKey] || null;
        this.updateFocusStatusUi();
    }

    triggerPanelFocusFromRing(ringKey) {
        const map = {
            policy: 'lsm',
            sandbox: 'seccomp',
            threat: 'attack'
        };
        const panelKey = map[ringKey] || 'pipeline';
        this.panelSpotlight = {
            panelKey,
            startedAt: performance.now(),
            durationMs: 2100
        };
    }

    getRingHitAt(x, y) {
        for (const ring of this.ringHitAreas) {
            const dx = x - ring.cx;
            const dy = y - ring.cy;
            const radiusNorm = Math.sqrt((dx * dx) / (ring.rx * ring.rx) + (dy * dy) / (ring.ry * ring.ry));
            if (radiusNorm >= ring.hitMin && radiusNorm <= ring.hitMax) {
                return ring;
            }
        }
        return null;
    }

    onCanvasMouseMove(event) {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const ringHit = this.getRingHitAt(x, y);
        this.hoveredRingKey = ringHit ? ringHit.key : null;
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
        this.canvas.style.cursor = (hovered || ringHit) ? 'pointer' : 'default';
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

    isPanelInFocusedRing(panelKey) {
        if (!this.focusedRingKey) return true;
        const map = {
            policy: new Set(['lsm', 'core', 'pipeline']),
            sandbox: new Set(['seccomp', 'capabilities', 'core']),
            threat: new Set(['attack', 'trust', 'pipeline', 'core'])
        };
        const set = map[this.focusedRingKey];
        if (!set) return true;
        return set.has(panelKey);
    }

    drawPanel(x, y, w, h, title, panelKey = 'generic') {
        this.drawRoundedRect(x, y, w, h, 8);
        const active = this.isPanelInFocusedRing(panelKey);
        this.ctx.fillStyle = active ? 'rgba(8, 11, 16, 0.9)' : 'rgba(8, 11, 16, 0.5)';
        this.ctx.fill();
        this.ctx.strokeStyle = active ? 'rgba(165, 178, 200, 0.4)' : 'rgba(110, 122, 140, 0.2)';
        this.ctx.lineWidth = 0.95;
        this.ctx.stroke();

        this.ctx.fillStyle = active ? '#d8e5f7' : 'rgba(180, 196, 218, 0.52)';
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
        this.drawPanel(x, y, w, h, 'THREAT DECISION PIPELINE', 'pipeline');
        const lanes = Array.isArray(telemetry?.pipeline?.lanes) ? telemetry.pipeline.lanes : [];
        const effectiveVerdictFilter = this.ringDerivedVerdictFilter || this.verdictFilter;
        const selected = this.selectedProcessFilter;
        const filtered = lanes.filter((lane) => {
            const verdictMatch = effectiveVerdictFilter === 'all' || lane.verdict === effectiveVerdictFilter;
            if (!verdictMatch) return false;
            if (!selected) return true;
            const lanePid = Number(lane.pid || 0);
            const laneName = this.normalizeName(lane.process);
            return lanePid === Number(selected.pid || 0) || laneName === this.normalizeName(selected.name);
        });
        const priorityScore = (lane) => {
            const verdict = String(lane.verdict || '').toLowerCase();
            const hook = String(lane.hook || '').toLowerCase();
            if (this.focusedRingKey === 'threat') {
                let score = verdict === 'deny' ? 100 : (verdict === 'audit' ? 75 : 40);
                if (hook.includes('netfilter') || hook.includes('lsm')) score += 10;
                return score;
            }
            if (this.focusedRingKey === 'sandbox') {
                let score = hook.includes('seccomp') ? 95 : (hook.includes('cap') ? 82 : 55);
                if (verdict === 'allow') score += 8;
                return score;
            }
            if (this.focusedRingKey === 'policy') {
                let score = hook.includes('lsm') ? 95 : (hook.includes('policy') ? 80 : 56);
                if (verdict === 'audit') score += 10;
                return score;
            }
            return 0;
        };
        const laneRows = filtered
            .slice()
            .sort((a, b) => priorityScore(b) - priorityScore(a))
            .slice(0, 7);

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
                this.ctx.fillText(`NO EVENTS FOR CURRENT FILTER (${String(effectiveVerdictFilter).toUpperCase()})`, x + 18, y + h - 16);
            }
        } else if (this.focusedRingKey) {
            this.ctx.fillStyle = 'rgba(149, 189, 234, 0.82)';
            this.ctx.font = '9px "Share Tech Mono", monospace';
            this.ctx.fillText(`ring focus: ${this.focusedRingKey} / verdict ${String(effectiveVerdictFilter).toUpperCase()}`, x + 18, y + h - 16);
        }
    }

    drawTrustGraph(x, y, w, h, telemetry) {
        this.drawPanel(x, y, w, h, 'PROCESS TRUST GRAPH', 'trust');
        this.trustNodeHitAreas = [];
        const mode = this.trustGraphMode || 'topology';
        const nodeLimit = mode === 'forensics' ? 12 : 10;
        const rows = Array.isArray(telemetry?.trust_graph) ? telemetry.trust_graph.slice(0, nodeLimit) : [];
        const cx = x + Math.floor(w * 0.5);
        const cy = y + Math.floor(h * 0.58);
        const maxRadius = Math.min(w, h) * 0.31;
        const innerRadius = Math.max(30, Math.floor(maxRadius * 0.24));
        const now = performance.now();

        const highRiskCount = rows.filter((row) => Number(row?.risk_score || 0) >= 70).length;
        this.ctx.fillStyle = 'rgba(168, 186, 210, 0.82)';
        this.ctx.font = '9px "Share Tech Mono", monospace';
        this.ctx.fillText(`nodes ${rows.length}`, x + 14, y + 34);
        this.ctx.fillStyle = highRiskCount > 0 ? 'rgba(255, 164, 170, 0.92)' : 'rgba(146, 226, 181, 0.86)';
        this.ctx.fillText(`high risk ${highRiskCount}`, x + 92, y + 34);
        if (this.selectedProcessFilter) {
            this.ctx.fillStyle = 'rgba(141, 197, 255, 0.92)';
            this.ctx.fillText(`selected pid ${Number(this.selectedProcessFilter.pid || 0)}`, x + 210, y + 34);
        }
        this.ctx.fillStyle = mode === 'risk'
            ? 'rgba(255, 176, 155, 0.95)'
            : (mode === 'forensics' ? 'rgba(168, 219, 255, 0.95)' : 'rgba(173, 194, 219, 0.86)');
        this.ctx.fillText(`mode ${String(mode).toUpperCase()}`, x + w - 122, y + 34);
        if (mode === 'forensics') {
            const freezeLeftSec = Math.max(0, (this.trustForensicsFreezeUntil - now) / 1000);
            this.ctx.fillStyle = 'rgba(148, 198, 255, 0.88)';
            this.ctx.fillText(`freeze ${freezeLeftSec.toFixed(1)}s`, x + w - 208, y + 34);
        }

        // Risk zones: inner = stable, middle = caution, outer = critical.
        const zones = [
            {
                r: maxRadius * 0.48,
                color: mode === 'risk' ? 'rgba(142, 236, 181, 0.14)' : 'rgba(113, 222, 163, 0.12)'
            },
            {
                r: maxRadius * 0.76,
                color: mode === 'risk' ? 'rgba(255, 213, 128, 0.16)' : 'rgba(244, 201, 119, 0.11)'
            },
            {
                r: maxRadius,
                color: mode === 'risk' ? 'rgba(255, 136, 148, 0.15)' : 'rgba(255, 143, 152, 0.1)'
            }
        ];
        zones.forEach((zone) => {
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, zone.r, 0, Math.PI * 2);
            this.ctx.fillStyle = zone.color;
            this.ctx.fill();
            this.ctx.strokeStyle = 'rgba(162, 176, 198, 0.18)';
            this.ctx.lineWidth = 0.8;
            this.ctx.stroke();
        });

        this.ctx.beginPath();
        this.ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2);
        this.ctx.fillStyle = 'rgba(7, 10, 15, 0.92)';
        this.ctx.fill();
        this.ctx.strokeStyle = 'rgba(162, 176, 198, 0.34)';
        this.ctx.lineWidth = 1.1;
        this.ctx.stroke();
        this.ctx.fillStyle = '#cde6ff';
        this.ctx.font = '10px "Share Tech Mono", monospace';
        this.ctx.fillText('LSM', cx - 10, cy + 3);

        if (!rows.length) {
            this.ctx.fillStyle = 'rgba(178, 195, 219, 0.75)';
            this.ctx.font = '10px "Share Tech Mono", monospace';
            this.ctx.fillText('no trust graph data', cx - 54, cy + maxRadius + 16);
            this.trustForensicsLayout.clear();
            return;
        }

        if (mode === 'forensics') {
            const pidSet = new Set(rows.map((row) => Number(row?.pid || 0)));
            let layoutMismatch = this.trustForensicsLayout.size !== pidSet.size;
            if (!layoutMismatch) {
                for (const pid of pidSet) {
                    if (!this.trustForensicsLayout.has(pid)) {
                        layoutMismatch = true;
                        break;
                    }
                }
            }
            const shouldRebuild = now >= this.trustForensicsFreezeUntil || this.trustForensicsLayout.size === 0 || layoutMismatch;
            if (shouldRebuild) {
                this.trustForensicsLayout = this.buildForensicsLayout(rows, cx, cy, innerRadius, maxRadius);
                this.trustForensicsFreezeUntil = now + this.trustForensicsFreezeWindowMs;
            }
        }

        const riskBandColor = (risk) => {
            if (risk >= 70) return '#ff8f97';
            if (risk >= 45) return '#f4c977';
            return '#71dfa8';
        };
        let selectedNode = null;

        rows.forEach((row, idx) => {
            const risk = Number(row.risk_score || 0);
            const riskNorm = Math.max(0, Math.min(1, risk / 100));
            const pid = Number(row.pid || 0);
            const forensicsEntry = mode === 'forensics' ? this.trustForensicsLayout.get(pid) : null;
            const a = forensicsEntry
                ? Number(forensicsEntry.angle || 0)
                : (((Math.PI * 2) / Math.max(rows.length, 1)) * idx - Math.PI / 2);
            const baseOrbit = mode === 'risk'
                ? innerRadius + (maxRadius - innerRadius) * (0.2 + riskNorm * 0.8)
                : innerRadius + (maxRadius - innerRadius) * (0.35 + riskNorm * 0.65);
            const orbit = forensicsEntry
                ? Number(forensicsEntry.orbit || baseOrbit)
                : Math.max(innerRadius + 8, baseOrbit);
            const nx = forensicsEntry
                ? Number(forensicsEntry.nx || (cx + Math.cos(a) * orbit))
                : (cx + Math.cos(a) * orbit);
            const ny = forensicsEntry
                ? Number(forensicsEntry.ny || (cy + Math.sin(a) * orbit))
                : (cy + Math.sin(a) * orbit);
            const trust = String(row.trust || 'trusted');
            const color = mode === 'risk' ? riskBandColor(risk) : this.trustColor(trust);
            const pulse = 0.78 + 0.22 * Math.sin(this.tick * 0.04 + idx * 0.5);
            const isSelected = Boolean(this.selectedProcessFilter) && (
                Number(this.selectedProcessFilter.pid || 0) === pid
                || this.normalizeName(this.selectedProcessFilter.name || '') === this.normalizeName(row.name || '')
            );
            const isHovered = Number(this.hoveredProcessPid || 0) === pid;
            const isCritical = risk >= 70 || trust === 'blocked';
            const nodeR = isSelected ? 12 : (isHovered ? 11 : (isCritical ? 10 : (mode === 'forensics' ? 9.5 : 9)));
            const glowR = isSelected ? 20 : (isHovered ? 16 : (isCritical ? 11 : 0));
            if (isSelected) {
                selectedNode = {
                    cx,
                    cy,
                    angle: a,
                    innerRadius,
                    maxRadius
                };
            }

            this.ctx.beginPath();
            this.ctx.moveTo(cx, cy);
            this.ctx.lineTo(nx, ny);
            this.ctx.strokeStyle = isCritical
                ? `rgba(255, 147, 156, ${0.24 + 0.22 * pulse})`
                : `rgba(155, 168, 190, ${0.18 + 0.14 * pulse})`;
            this.ctx.lineWidth = isSelected ? 1.2 : 0.9;
            this.ctx.stroke();

            if (glowR > 0) {
                const glow = this.ctx.createRadialGradient(nx, ny, 0, nx, ny, glowR);
                glow.addColorStop(
                    0,
                    isSelected
                        ? 'rgba(124, 178, 255, 0.4)'
                        : (isCritical ? 'rgba(255, 137, 149, 0.26)' : 'rgba(138, 156, 234, 0.22)')
                );
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

            const rightSide = Math.cos(a) >= 0;
            const labelX = rightSide ? (nx + 14) : (nx - (mode === 'forensics' ? 116 : 98));
            const labelY = ny + 18;
            this.ctx.fillStyle = isSelected ? '#dff0ff' : 'rgba(207, 220, 237, 0.9)';
            this.ctx.font = '9px "Share Tech Mono", monospace';
            const label = `${String(row.name || 'proc').slice(0, 10)} #${pid}`;
            const shouldShowLabel = mode === 'forensics' || isSelected || isHovered || isCritical;
            if (shouldShowLabel) {
                this.ctx.fillText(label, labelX, labelY);
                this.ctx.fillStyle = isCritical ? 'rgba(255, 166, 173, 0.95)' : 'rgba(164, 186, 212, 0.86)';
                this.ctx.fillText(`risk ${risk.toFixed(0)} ${String(trust).toUpperCase()}`, labelX, labelY + 10);
                if (mode === 'forensics') {
                    this.ctx.fillStyle = 'rgba(151, 173, 202, 0.8)';
                    this.ctx.fillText(`orbit ${Math.round(orbit)} freeze ${(Math.max(0, this.trustForensicsFreezeUntil - now) / 1000).toFixed(1)}s`, labelX, labelY + 20);
                }
            }

            this.trustNodeHitAreas.push({
                x: nx,
                y: ny,
                r: nodeR,
                pid,
                name: row.name || 'unknown'
            });
        });

        this.drawIncidentTrail(x, y, w, h, selectedNode);
    }

    drawAttackSurface(x, y, w, h, telemetry) {
        this.drawPanel(x, y, w, h, 'ATTACK SURFACE MAP', 'attack');
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
        this.drawPanel(x, y, w, h, 'LSM STATUS MATRIX', 'lsm');
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
        this.drawPanel(x, y, w, h, 'CAPABILITIES DRIFT', 'capabilities');
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
        this.drawPanel(x, y, w, h, 'SECCOMP COVERAGE', 'seccomp');
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

    drawGhostShellSecurityRings(x, y, w, h, telemetry) {
        const ctx = this.ctx;
        const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));
        const cx = x + Math.floor(w * 0.5);
        const cy = y + Math.floor(h * 0.49);
        const baseRx = Math.max(120, Math.floor(w * 0.2));
        const baseRy = Math.max(42, Math.floor(h * 0.15));
        const t = this.tick * 0.013;

        const meta = telemetry?.meta || {};
        const core = telemetry?.security_core || {};
        const seccompCov = telemetry?.security_tools?.seccomp_coverage || {};
        const attackRows = Array.isArray(telemetry?.attack_surface) ? telemetry.attack_surface : [];
        const capRows = Array.isArray(telemetry?.security_tools?.capabilities_drift) ? telemetry.security_tools.capabilities_drift : [];
        const lsmEngines = Array.isArray(core.lsm_engines) ? core.lsm_engines : [];

        const decisionsPerSec = Number(meta.decisions_per_sec || 0);
        const events = Math.max(1, Number(meta.events || 0));
        const blocked = Number(meta.blocked || 0);
        const suspicious = Number(meta.suspicious || 0);
        const enforcingCount = lsmEngines.filter((item) => String(item.status || '').toLowerCase() === 'enforcing').length;
        const lsmCount = Math.max(1, lsmEngines.length);
        const seccompCoverage = Number(seccompCov.coverage_percent || 0);
        const unsandboxedCount = Array.isArray(seccompCov.high_risk_unsandboxed) ? seccompCov.high_risk_unsandboxed.length : 0;
        const dangerousCapsCount = capRows.reduce((acc, row) => acc + Number(row?.dangerous_count || 0), 0);
        const avgAttackRisk = attackRows.length > 0
            ? attackRows.reduce((acc, row) => acc + Number(row?.risk_score || 0), 0) / attackRows.length
            : 0;

        const policyScore = clamp01((decisionsPerSec / 2400) * 0.55 + (enforcingCount / lsmCount) * 0.45);
        const sandboxStrength = clamp01((seccompCoverage / 100) * 0.72 + (1 - clamp01((unsandboxedCount + dangerousCapsCount * 0.3) / 18)) * 0.28);
        const threatPressure = clamp01(((blocked + suspicious * 0.55) / events) * 1.9 + (avgAttackRisk / 100) * 0.65 + (unsandboxedCount / 12) * 0.4);

        const verdict = threatPressure >= 0.72
            ? 'UNDER ATTACK'
            : (sandboxStrength < 0.42 || threatPressure >= 0.46 ? 'DEGRADED' : 'SAFE');
        const verdictColor = verdict === 'UNDER ATTACK' ? '#ff8f98' : (verdict === 'DEGRADED' ? '#f4c977' : '#71dfa8');

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';

        const rings = [
            {
                key: 'policy',
                label: 'POLICY',
                score: policyScore,
                speed: 0.32,
                color: '126,196,255',
                rx: baseRx * 0.88,
                ry: baseRy * 0.9,
                metric: `lsm ${enforcingCount}/${lsmCount} dec ${decisionsPerSec.toFixed(1)}/s`
            },
            {
                key: 'sandbox',
                label: 'SANDBOX',
                score: sandboxStrength,
                speed: -0.26,
                color: '120,230,174',
                rx: baseRx * 1.16,
                ry: baseRy * 1.3,
                metric: `seccomp ${seccompCoverage.toFixed(1)}% unsbx ${unsandboxedCount}`
            },
            {
                key: 'threat',
                label: 'THREAT',
                score: threatPressure,
                speed: 0.18,
                color: '255,148,156',
                rx: baseRx * 1.42,
                ry: baseRy * 1.62,
                metric: `risk ${avgAttackRisk.toFixed(1)} block ${blocked}`
            }
        ];

        this.ringHitAreas = [];
        rings.forEach((ring, idx) => {
            const phase = t * ring.speed + idx * 1.27;
            const isFocused = this.focusedRingKey === ring.key;
            const isHovered = this.hoveredRingKey === ring.key;
            const dimmed = Boolean(this.focusedRingKey) && !isFocused;
            const alphaBase = 0.12 + ring.score * 0.24;
            const arcSpan = 0.52 + ring.score * 2.2;
            const emphasis = isFocused ? 1.25 : (isHovered ? 1.12 : 1);
            const alphaMul = dimmed ? 0.32 : (isFocused ? 1.2 : 1);

            // Base orbit.
            ctx.strokeStyle = `rgba(${ring.color}, ${Math.min(1, alphaBase * alphaMul).toFixed(3)})`;
            ctx.lineWidth = (1 + ring.score * 1.6) * emphasis;
            ctx.beginPath();
            ctx.ellipse(cx, cy, ring.rx, ring.ry, -0.08, 0, Math.PI * 2);
            ctx.stroke();

            // Informative arc indicating score magnitude.
            ctx.strokeStyle = `rgba(${ring.color}, ${Math.min(1, (0.42 + ring.score * 0.5) * alphaMul).toFixed(3)})`;
            ctx.lineWidth = (2 + ring.score * 2.4) * emphasis;
            ctx.beginPath();
            ctx.ellipse(cx, cy, ring.rx, ring.ry, -0.08, phase, phase + arcSpan);
            ctx.stroke();

            // Orbiting probes.
            for (let i = 0; i < 3; i++) {
                const a = phase + i * 2.09;
                const px = cx + Math.cos(a) * ring.rx;
                const py = cy + Math.sin(a) * ring.ry;
                ctx.fillStyle = `rgba(${ring.color}, ${Math.min(1, (0.3 + i * 0.16) * alphaMul).toFixed(3)})`;
                ctx.beginPath();
                ctx.arc(px, py, (1.3 + i * 0.55) * emphasis, 0, Math.PI * 2);
                ctx.fill();
            }

            // Ring label + core metric near arc.
            const lx = cx + Math.cos(phase + arcSpan + 0.16) * (ring.rx + 12);
            const ly = cy + Math.sin(phase + arcSpan + 0.16) * (ring.ry + 12);
            ctx.fillStyle = `rgba(${ring.color}, ${Math.min(1, 0.86 * alphaMul + (isFocused ? 0.12 : 0)).toFixed(3)})`;
            ctx.font = '9px "Share Tech Mono", monospace';
            ctx.fillText(`${ring.label} ${(ring.score * 100).toFixed(0)}%`, lx, ly);
            ctx.fillStyle = `rgba(${ring.color}, ${Math.min(1, 0.54 * alphaMul).toFixed(3)})`;
            ctx.font = '8px "Share Tech Mono", monospace';
            ctx.fillText(ring.metric, lx, ly + 10);

            this.ringHitAreas.push({
                key: ring.key,
                cx,
                cy,
                rx: ring.rx,
                ry: ring.ry,
                hitMin: 0.84,
                hitMax: 1.18
            });
        });

        // Center verdict core.
        this.drawRoundedRect(cx - 118, cy - 40, 236, 74, 10);
        ctx.fillStyle = 'rgba(8, 13, 20, 0.64)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(150, 178, 214, 0.42)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.fillStyle = 'rgba(164, 190, 223, 0.92)';
        ctx.font = '9px "Share Tech Mono", monospace';
        ctx.fillText('RING-FIRST SECURITY VERDICT', cx - 96, cy - 20);
        ctx.fillStyle = verdictColor;
        ctx.font = '15px "Share Tech Mono", monospace';
        ctx.fillText(verdict, cx - 66, cy + 2);
        ctx.fillStyle = 'rgba(176, 198, 228, 0.8)';
        ctx.font = '8px "Share Tech Mono", monospace';
        ctx.fillText(`threat ${(threatPressure * 100).toFixed(0)}%  sandbox ${(sandboxStrength * 100).toFixed(0)}%  policy ${(policyScore * 100).toFixed(0)}%`, cx - 108, cy + 18);

        // Ambient data noise strings around outer ring.
        const tokenPool = [
            `deny:${blocked}`,
            `sus:${suspicious}`,
            `risk:${avgAttackRisk.toFixed(0)}`,
            `sec:${seccompCoverage.toFixed(0)}%`,
            `dec:${decisionsPerSec.toFixed(1)}/s`,
            `unsbx:${unsandboxedCount}`,
            'lsm',
            'seccomp',
            'cap',
            'audit'
        ];
        ctx.font = '8px "Share Tech Mono", monospace';
        ctx.fillStyle = 'rgba(150, 216, 255, 0.5)';
        for (let i = 0; i < 12; i++) {
            const token = tokenPool[(i + Math.floor(this.tick / 8)) % tokenPool.length];
            const a = t * 0.29 + i * (Math.PI * 2 / 12);
            const rx = baseRx * 1.62;
            const ry = baseRy * 1.92;
            const px = cx + Math.cos(a) * rx;
            const py = cy + Math.sin(a) * ry;
            ctx.fillText(token, px, py);
        }
        ctx.fillStyle = 'rgba(170, 194, 224, 0.68)';
        ctx.fillText('click ring to focus related panels', cx - 90, cy + baseRy * 1.98);

        ctx.restore();
    }

    drawSecurityCore(x, y, w, h, telemetry) {
        this.drawPanel(x, y, w, h, 'KERNEL SECURITY CORE', 'core');
        const core = telemetry?.security_core || {};
        const lsmEngines = Array.isArray(core.lsm_engines) ? core.lsm_engines : [];
        const seccompProcs = Array.isArray(core.seccomp_processes) ? core.seccomp_processes : [];
        const capProcs = Array.isArray(core.capabilities_processes) ? core.capabilities_processes : [];
        const stacking = Boolean(core.stacking_enabled);
        
        // Draw LSM engines section (left side).
        this.ctx.fillStyle = '#9ed4ff';
        this.ctx.font = '10px "Share Tech Mono", monospace';
        this.ctx.fillText('LSM POLICY ENGINES', x + 14, y + 38);
        if (stacking) {
            this.ctx.fillStyle = '#60d69d';
            this.ctx.fillText('STACKING: ON', x + w - 120, y + 38);
        }
        
        lsmEngines.forEach((engine, idx) => {
            const yy = y + 52 + idx * 32;
            const name = String(engine.name || 'LSM');
            const status = String(engine.status || 'unknown');
            const decisions = Number(engine.decisions_per_sec || 0);
            const hooks = Array.isArray(engine.hooks) ? engine.hooks : [];
            
            this.drawRoundedRect(x + 12, yy - 14, Math.floor(w * 0.48), 26, 4);
            this.ctx.fillStyle = status === 'enforcing' ? 'rgba(32, 52, 81, 0.72)' : 'rgba(10, 14, 20, 0.46)';
            this.ctx.fill();
            this.ctx.strokeStyle = status === 'enforcing' ? 'rgba(124, 178, 255, 0.65)' : 'rgba(112, 123, 140, 0.28)';
            this.ctx.lineWidth = 0.9;
            this.ctx.stroke();
            
            this.ctx.fillStyle = status === 'enforcing' ? '#d9ecff' : 'rgba(185, 200, 220, 0.62)';
            this.ctx.font = '10px "Share Tech Mono", monospace';
            this.ctx.fillText(name, x + 16, yy);
            this.ctx.fillStyle = status === 'enforcing' ? '#60d69d' : '#8a9cea';
            this.ctx.fillText(`${decisions}/s`, x + Math.floor(w * 0.28), yy);
            this.ctx.fillStyle = 'rgba(185, 200, 220, 0.72)';
            this.ctx.font = '8px "Share Tech Mono", monospace';
            this.ctx.fillText(hooks.slice(0, 2).join(', '), x + 16, yy + 12);
        });
        
        // Draw seccomp section (top right).
        const seccompY = y + 52;
        this.ctx.fillStyle = '#9ed4ff';
        this.ctx.font = '10px "Share Tech Mono", monospace';
        this.ctx.fillText('SECCOMP SANDBOX', x + Math.floor(w * 0.52), seccompY - 14);
        
        seccompProcs.slice(0, 3).forEach((proc, idx) => {
            const yy = seccompY + idx * 32;
            const pid = Number(proc.pid || 0);
            const name = String(proc.name || 'proc').slice(0, 10);
            const mode = String(proc.mode || 'none');
            const allowed = Array.isArray(proc.allowed_syscalls) ? proc.allowed_syscalls : [];
            const blocked = Array.isArray(proc.blocked_syscalls) ? proc.blocked_syscalls : [];
            
            this.drawRoundedRect(x + Math.floor(w * 0.52), yy - 14, Math.floor(w * 0.46), 26, 4);
            this.ctx.fillStyle = mode === 'strict' ? 'rgba(32, 52, 81, 0.72)' : (mode === 'filter' ? 'rgba(22, 34, 52, 0.56)' : 'rgba(10, 14, 20, 0.46)');
            this.ctx.fill();
            this.ctx.strokeStyle = mode === 'strict' ? '#60d69d' : (mode === 'filter' ? '#f4c977' : 'rgba(112, 123, 140, 0.28)');
            this.ctx.lineWidth = 0.9;
            this.ctx.stroke();
            
            this.ctx.fillStyle = '#d8e5f7';
            this.ctx.font = '9px "Share Tech Mono", monospace';
            this.ctx.fillText(`${name}:${pid}`, x + Math.floor(w * 0.54), yy);
            this.ctx.fillStyle = mode === 'strict' ? '#60d69d' : '#f4c977';
            this.ctx.fillText(`${allowed.length} allow`, x + Math.floor(w * 0.54), yy + 12);
            this.ctx.fillStyle = '#eb7e7e';
            this.ctx.fillText(`${blocked.length} block`, x + Math.floor(w * 0.72), yy + 12);
        });
        
        // Draw capabilities section (bottom).
        const capY = y + Math.floor(h * 0.48);
        this.ctx.fillStyle = '#9ed4ff';
        this.ctx.font = '10px "Share Tech Mono", monospace';
        this.ctx.fillText('CAPABILITIES (GRANULAR RIGHTS)', x + 14, capY);
        
        capProcs.slice(0, 4).forEach((proc, idx) => {
            const yy = capY + 18 + idx * 28;
            const pid = Number(proc.pid || 0);
            const name = String(proc.name || 'proc').slice(0, 10);
            const caps = Array.isArray(proc.capabilities) ? proc.capabilities : [];
            const dangerous = Array.isArray(proc.dangerous_caps) ? proc.dangerous_caps : [];
            
            this.drawRoundedRect(x + 12, yy - 12, w - 24, 22, 4);
            this.ctx.fillStyle = dangerous.length > 0 ? 'rgba(32, 52, 81, 0.72)' : 'rgba(10, 14, 20, 0.46)';
            this.ctx.fill();
            this.ctx.strokeStyle = dangerous.length > 0 ? '#eb7e7e' : 'rgba(112, 123, 140, 0.28)';
            this.ctx.lineWidth = 0.9;
            this.ctx.stroke();
            
            this.ctx.fillStyle = '#d8e5f7';
            this.ctx.font = '9px "Share Tech Mono", monospace';
            this.ctx.fillText(`${name}:${pid}`, x + 16, yy + 2);
            
            // Draw capability "keys" as small squares.
            const keySize = 6;
            const keySpacing = 8;
            let keyX = x + Math.floor(w * 0.28);
            caps.slice(0, 12).forEach((cap, capIdx) => {
                const isDangerous = dangerous.includes(cap);
                this.ctx.fillStyle = isDangerous ? '#eb7e7e' : (cap.startsWith('CAP_SYS') ? '#f4c977' : '#60d69d');
                this.ctx.fillRect(keyX + capIdx * keySpacing, yy + 6, keySize, keySize);
                this.ctx.strokeStyle = '#0e1621';
                this.ctx.lineWidth = 0.5;
                this.ctx.strokeRect(keyX + capIdx * keySpacing, yy + 6, keySize, keySize);
            });
            
            if (dangerous.length > 0) {
                this.ctx.fillStyle = '#eb7e7e';
                this.ctx.font = '8px "Share Tech Mono", monospace';
                this.ctx.fillText(`⚠ ${dangerous.slice(0, 2).join(', ')}`, x + Math.floor(w * 0.78), yy + 2);
            }
        });
        
        // Draw enforcement flow arrow (center).
        const flowY = y + Math.floor(h * 0.42);
        const flowX = x + Math.floor(w * 0.5);
        this.ctx.strokeStyle = 'rgba(124, 178, 255, 0.45)';
        this.ctx.lineWidth = 1.2;
        this.ctx.beginPath();
        this.ctx.moveTo(flowX - 40, flowY);
        this.ctx.lineTo(flowX + 40, flowY);
        this.ctx.stroke();
        this.ctx.beginPath();
        this.ctx.moveTo(flowX + 35, flowY - 3);
        this.ctx.lineTo(flowX + 40, flowY);
        this.ctx.lineTo(flowX + 35, flowY + 3);
        this.ctx.stroke();
        this.ctx.fillStyle = 'rgba(180, 196, 220, 0.86)';
        this.ctx.font = '8px "Share Tech Mono", monospace';
        this.ctx.fillText('ENFORCEMENT FLOW', flowX - 38, flowY - 6);
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

    drawPanelSpotlight() {
        if (!this.panelSpotlight || !this.ctx) return;
        const rect = this.panelRects[this.panelSpotlight.panelKey];
        if (!rect) return;
        const now = performance.now();
        const elapsed = now - Number(this.panelSpotlight.startedAt || now);
        const duration = Math.max(800, Number(this.panelSpotlight.durationMs || 1800));
        if (elapsed >= duration) {
            this.panelSpotlight = null;
            return;
        }

        const t = elapsed / duration;
        const pulse = 0.5 + 0.5 * Math.sin(elapsed * 0.012);
        const alpha = (1 - t) * (0.34 + pulse * 0.24);
        const expand = 4 + pulse * 7;
        const x = rect.x - expand;
        const y = rect.y - expand;
        const w = rect.w + expand * 2;
        const h = rect.h + expand * 2;

        this.ctx.save();
        this.drawRoundedRect(x, y, w, h, 10);
        this.ctx.strokeStyle = `rgba(154, 220, 255, ${alpha.toFixed(3)})`;
        this.ctx.lineWidth = 2.1 + pulse * 1.3;
        this.ctx.stroke();
        this.ctx.restore();
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
        const coreH = Math.max(240, Math.floor(h * 0.28));
        const panelH = Math.max(220, h - panelTop - toolsH - coreH - gap * 3 - 24);
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
        const coreY = toolsY + toolsH + gap;
        this.panelRects = {
            pipeline: { x: leftX, y: panelTop, w: leftW, h: panelH },
            trust: { x: centerX, y: panelTop, w: centerW, h: panelH },
            attack: { x: rightX, y: panelTop, w: rightW, h: panelH },
            lsm: { x: leftX, y: toolsY, w: toolsW, h: toolsH },
            capabilities: { x: tools2X, y: toolsY, w: toolsW, h: toolsH },
            seccomp: { x: tools3X, y: toolsY, w: toolsW, h: toolsH },
            core: { x: leftX, y: coreY, w: w - gap * 2, h: coreH }
        };

        this.drawGhostShellSecurityRings(leftX, coreY, w - gap * 2, coreH, this.telemetry);
        this.drawDecisionPipeline(leftX, panelTop, leftW, panelH, this.telemetry);
        this.drawTrustGraph(centerX, panelTop, centerW, panelH, this.telemetry);
        this.drawAttackSurface(rightX, panelTop, rightW, panelH, this.telemetry);
        this.drawLsmStatusCard(leftX, toolsY, toolsW, toolsH, this.telemetry);
        this.drawCapabilitiesCard(tools2X, toolsY, toolsW, toolsH, this.telemetry);
        this.drawSeccompCoverageCard(tools3X, toolsY, toolsW, toolsH, this.telemetry);
        if (this.showSecurityCorePanel) {
            this.drawSecurityCore(leftX, coreY, w - gap * 2, coreH, this.telemetry);
        }
        this.drawPanelSpotlight();
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
