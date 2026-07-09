// Crypto subsystem realtime interaction visualization
// Version: 10

debugLog('🔐 crypto-belt.js v10: Script loading...');

class CryptoSubsystemVisualization {
    constructor() {
        this.container = null;
        this.svg = null;
        this.isActive = false;
        this.resizeHandler = null;
        this.telemetryInterval = null;
        this.telemetryNode = null;
        this.terminatorNode = null;
        this.exitButton = null;
        this.hoverCard = null;
        this.lastPayload = null;
        this.activeAnimationTick = 0;
        this.prevLaneKeys = new Set();
        this.laneHistory = new Map();
        this.recentlyGone = [];
        this.selectedCompetitionAlgorithm = 'AES';
        this.algorithmModes = ['AES', 'SHA', 'CHACHA20'];
        this.selectedClientFilters = new Set();
        this.selectedRequesterFilter = null;
        this.selectedImplementationClassFilter = null;
        this.activeCryptoView = 'LINEAR_ANALYSIS';
        this.titleNode = null;
        this.subtitleNode = null;
        this.viewToggleNode = null;
        this.linearAnalysisRendered = false;
        this.lastLinearAnalysisRenderAt = 0;
        this.linearAnalysisMinRenderMs = 8000;
    }

    init(containerId = 'crypto-belt-container') {
        const existing = document.getElementById(containerId);
        if (existing) {
            this.container = existing;
            this.container.innerHTML = '';
        } else {
            this.container = document.createElement('div');
            this.container.id = containerId;
            this.container.style.cssText = [
                'position: fixed',
                'inset: 0',
                'width: 100%',
                'height: 100%',
                'background: radial-gradient(circle at 50% 40%, #121821 0%, #0a0d12 70%)',
                'z-index: 9999',
                'display: none',
                'visibility: hidden',
                'pointer-events: none',
                'overflow: hidden'
            ].join(';');
            document.body.appendChild(this.container);
        }

        this.svg = d3.select(this.container)
            .append('svg')
            .attr('class', 'crypto-flow-svg')
            .style('width', '100%')
            .style('height', '100%')
            .style('display', 'block');

        const defs = this.svg.append('defs');
        defs.append('marker')
            .attr('id', 'crypto-flow-arrow')
            .attr('viewBox', '0 0 10 10')
            .attr('refX', 8)
            .attr('refY', 5)
            .attr('markerWidth', 5)
            .attr('markerHeight', 5)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M 0 0 L 10 5 L 0 10 z')
            .attr('fill', '#d6dbe3');

        const glow = defs.append('filter')
            .attr('id', 'crypto-line-glow')
            .attr('x', '-50%')
            .attr('y', '-50%')
            .attr('width', '200%')
            .attr('height', '200%');
        glow.append('feGaussianBlur').attr('stdDeviation', 1.8).attr('result', 'blur');
        glow.append('feMerge')
            .selectAll('feMergeNode')
            .data(['blur', 'SourceGraphic'])
            .enter()
            .append('feMergeNode')
            .attr('in', (d) => d);

        this.createOverlayUI();
        this.addExitButton();

        this.resizeHandler = () => this.onResize();
        window.addEventListener('resize', this.resizeHandler);
        return true;
    }

    createOverlayUI() {
        const title = document.createElement('div');
        title.style.cssText = [
            'position: absolute',
            'top: 20px',
            'left: 50%',
            'transform: translateX(-50%)',
            'color: #e3e8ef',
            'font-family: "Share Tech Mono", monospace',
            'font-size: 24px',
            'letter-spacing: 1px',
            'z-index: 1001',
            'text-shadow: 0 0 8px rgba(180, 210, 255, 0.25)'
        ].join(';');
        title.textContent = 'KERNEL CRYPTO LIVE INTERACTIONS (in development)';
        this.container.appendChild(title);
        this.titleNode = title;

        const subtitle = document.createElement('div');
        subtitle.style.cssText = [
            'position: absolute',
            'top: 64px',
            'left: 50%',
            'transform: translateX(-50%)',
            'color: #9da7b6',
            'font-family: "Share Tech Mono", monospace',
            'font-size: 11px',
            'z-index: 1001'
        ].join(';');
        subtitle.textContent = 'process -> protocol -> crypto subsystem -> algorithm';
        this.container.appendChild(subtitle);
        this.subtitleNode = subtitle;

        const terminator = document.createElement('div');
        terminator.style.cssText = [
            'position: absolute',
            'top: 86px',
            'left: 50%',
            'transform: translateX(-50%)',
            'padding: 4px 10px',
            'background: rgba(8, 12, 18, 0.86)',
            'border: 1px solid rgba(150, 164, 188, 0.35)',
            'color: #bfc9d9',
            'font-family: "Share Tech Mono", monospace',
            'font-size: 10px',
            'letter-spacing: 0.35px',
            'z-index: 1001'
        ].join(';');
        terminator.textContent = 'TLS TERMINATED BY: DETECTING...';
        this.container.appendChild(terminator);
        this.terminatorNode = terminator;

        const viewToggle = document.createElement('div');
        viewToggle.style.cssText = [
            'position: absolute',
            'top: 86px',
            'left: 50%',
            'transform: translateX(-50%) translateY(34px)',
            'display: flex',
            'gap: 8px',
            'z-index: 1001'
        ].join(';');
        this.container.appendChild(viewToggle);
        this.viewToggleNode = viewToggle;
        this.updateCryptoViewToggle();

        const telemetry = document.createElement('div');
        telemetry.style.cssText = [
            'position: absolute',
            'bottom: 16px',
            'right: 20px',
            'color: #bac2cf',
            'font-family: "Share Tech Mono", monospace',
            'font-size: 10px',
            'z-index: 1001',
            'text-align: right',
            'line-height: 1.45',
            'opacity: 0.95'
        ].join(';');
        this.container.appendChild(telemetry);
        this.telemetryNode = telemetry;

        const hoverCard = document.createElement('div');
        hoverCard.style.cssText = [
            'position: absolute',
            'display: none',
            'pointer-events: none',
            'padding: 10px 12px',
            'background: rgba(7, 10, 16, 0.92)',
            'border: 1px solid rgba(178, 190, 212, 0.45)',
            'color: #dee6f2',
            'font-family: "Share Tech Mono", monospace',
            'font-size: 10px',
            'line-height: 1.5',
            'white-space: pre',
            'z-index: 1002',
            'box-shadow: 0 0 14px rgba(150, 175, 220, 0.25)'
        ].join(';');
        this.container.appendChild(hoverCard);
        this.hoverCard = hoverCard;
    }

    setTerminatorBadge(statusText) {
        if (!this.terminatorNode) return;
        const status = String(statusText || '').toUpperCase();
        let color = '#bfc9d9';
        let border = 'rgba(150, 164, 188, 0.35)';
        let bg = 'rgba(8, 12, 18, 0.86)';

        if (status === 'NGINX') {
            color = '#89f7c5';
            border = 'rgba(96, 214, 157, 0.55)';
            bg = 'rgba(8, 18, 14, 0.9)';
        } else if (status === 'EDGE PROXY') {
            color = '#ffe19e';
            border = 'rgba(244, 201, 119, 0.55)';
            bg = 'rgba(22, 18, 9, 0.9)';
        } else if (status === 'UNKNOWN') {
            color = '#ff9f9f';
            border = 'rgba(235, 126, 126, 0.6)';
            bg = 'rgba(23, 10, 10, 0.92)';
        } else if (status === 'EXTERNAL LB / UPSTREAM') {
            color = '#a7b8ff';
            border = 'rgba(138, 156, 234, 0.55)';
            bg = 'rgba(10, 13, 24, 0.9)';
        } else if (status === 'NO ACTIVE TLS') {
            color = '#95a0b3';
            border = 'rgba(126, 138, 158, 0.45)';
            bg = 'rgba(10, 12, 16, 0.9)';
        } else if (status === 'MOCK/FALLBACK') {
            color = '#d3b3ff';
            border = 'rgba(172, 126, 227, 0.55)';
            bg = 'rgba(17, 11, 24, 0.9)';
        }

        this.terminatorNode.style.color = color;
        this.terminatorNode.style.borderColor = border;
        this.terminatorNode.style.background = bg;
        this.terminatorNode.textContent = `TLS TERMINATED BY: ${status}`;
    }

    updateCryptoViewToggle() {
        if (!this.viewToggleNode) return;
        const views = [
            ['LINEAR_ANALYSIS', 'AES INTERNALS'],
            ['LIVE_FLOW', 'LIVE FLOW']
        ];
        this.viewToggleNode.innerHTML = '';
        views.forEach(([id, label]) => {
            const btn = document.createElement('button');
            const isActive = this.activeCryptoView === id;
            btn.textContent = label;
            btn.style.cssText = [
                'padding: 5px 12px',
                `background: ${isActive ? 'rgba(35, 58, 88, 0.94)' : 'rgba(8, 12, 18, 0.86)'}`,
                `border: 1px solid ${isActive ? 'rgba(125, 186, 255, 0.86)' : 'rgba(150, 164, 188, 0.35)'}`,
                `color: ${isActive ? '#d8eaff' : '#9da7b6'}`,
                'font-family: "Share Tech Mono", monospace',
                'font-size: 10px',
                'letter-spacing: 0.45px',
                'cursor: pointer',
                'border-radius: 4px',
                'box-shadow: none'
            ].join(';');
            btn.onclick = () => {
                this.activeCryptoView = id;
                this.updateCryptoViewToggle();
                this.renderFlowMap(this.lastPayload || this.normalizeTelemetry(this.getFallbackTelemetry()));
            };
            this.viewToggleNode.appendChild(btn);
        });
    }

    syncOverlayForCurrentView() {
        const isLinear = this.activeCryptoView === 'LINEAR_ANALYSIS';
        if (this.titleNode) {
            this.titleNode.style.display = isLinear ? 'none' : 'block';
        }
        if (this.subtitleNode) {
            this.subtitleNode.style.display = isLinear ? 'none' : 'block';
        }
        if (this.terminatorNode) {
            this.terminatorNode.style.display = isLinear ? 'none' : 'block';
        }
        if (this.viewToggleNode) {
            this.viewToggleNode.style.top = isLinear ? '18px' : '112px';
            this.viewToggleNode.style.left = isLinear ? 'auto' : '50%';
            this.viewToggleNode.style.right = isLinear ? '170px' : 'auto';
            this.viewToggleNode.style.transform = isLinear ? 'none' : 'translateX(-50%)';
        }
    }

    detectTlsTerminator(meta, lanes) {
        const termList = Array.isArray(meta?.tls_terminators) ? meta.tls_terminators.filter(Boolean) : [];
        const tlsLanes = (Array.isArray(lanes) ? lanes : []).filter((lane) => lane.protocol === 'TLS');
        const laneTermSet = new Set(
            tlsLanes
                .map((lane) => String(lane.tls_terminator || '').toLowerCase())
                .filter((name) => name && name !== 'n/a')
        );

        const allCandidates = Array.from(new Set([
            ...termList.map((x) => String(x).toLowerCase()),
            ...Array.from(laneTermSet)
        ]));

        if (allCandidates.some((name) => name.includes('nginx'))) return 'nginx';
        if (allCandidates.some((name) => name.includes('haproxy') || name.includes('envoy') || name.includes('traefik') || name.includes('caddy'))) {
            return 'edge proxy';
        }
        if (allCandidates.some((name) => name.includes('listener:')) || Number(meta?.unknown_pid_flows || 0) > 0) return 'unknown';
        if (tlsLanes.length > 0) return 'external lb / upstream';
        return 'no active tls';
    }

    addExitButton() {
        if (this.exitButton && this.exitButton.parentNode) {
            this.exitButton.parentNode.removeChild(this.exitButton);
        }

        const btn = document.createElement('button');
        btn.textContent = 'EXIT VIEW';
        btn.style.cssText = [
            'position: absolute',
            'top: 20px',
            'right: 20px',
            'padding: 10px 20px',
            'background: rgba(10, 14, 21, 0.9)',
            'border: 1px solid rgba(165, 178, 200, 0.34)',
            'color: #d2d8e2',
            'font-family: "Share Tech Mono", monospace',
            'font-size: 12px',
            'cursor: pointer',
            'z-index: 1001',
            'transition: all 0.22s ease'
        ].join(';');

        btn.onmouseenter = () => {
            btn.style.background = 'rgba(19, 25, 37, 0.95)';
            btn.style.color = '#ffffff';
            btn.style.boxShadow = '0 0 10px rgba(160, 190, 230, 0.25)';
        };
        btn.onmouseleave = () => {
            btn.style.background = 'rgba(10, 14, 21, 0.9)';
            btn.style.color = '#d2d8e2';
            btn.style.boxShadow = 'none';
        };

        btn.onclick = () => {
            const path = String(window.location.pathname || '').replace(/\/+$/, '') || '/';
            if ((path === '/crypto' || path === '/linux-crypto-subsystem')
                && window.history
                && typeof window.history.replaceState === 'function') {
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

    inferProtocol(process) {
        if (process.includes('ssh')) return 'SSH';
        if (process.includes('wg') || process.includes('wireguard')) return 'WIREGUARD';
        if (process.includes('nginx') || process.includes('haproxy') || process.includes('curl') || process.includes('openssl')) return 'TLS';
        return 'CRYPTO API';
    }

    inferAlgorithm(protocol, process) {
        const p = (process || '').toLowerCase();
        const proto = (protocol || '').toUpperCase();
        if (proto === 'SSH') return 'CHACHA20-POLY1305';
        if (proto === 'WIREGUARD') return 'CHACHA20';
        if (p.includes('nginx') || p.includes('haproxy')) return 'AES-GCM/SHA256';
        if (p.includes('curl') || p.includes('python')) return 'AES-256-GCM';
        if (proto === 'TLS') return 'AES-GCM/SHA256';
        return 'AES/SHA';
    }

    getProtocolPalette(protocol) {
        const p = String(protocol || '').toUpperCase();
        if (p === 'TLS') {
            return {
                accent: '#6ed0ff',
                stroke: '#9ec6dd',
                link: '#7dc4e6',
                fill: '#0a1218',
                packet: '#b8e9ff',
                label: '#87d5fa'
            };
        }
        if (p === 'SSH' || p === 'WIREGUARD') {
            return {
                accent: '#e2a8ff',
                stroke: '#cba8df',
                link: '#ba98d2',
                fill: '#120c16',
                packet: '#f0ccff',
                label: '#d9b1f4'
            };
        }
        return {
            accent: '#c6d2e2',
            stroke: '#a9b5c6',
            link: '#9eafc4',
            fill: '#0d1015',
            packet: '#e6edf8',
            label: '#c9d4e4'
        };
    }

    normalizeTelemetry(data) {
        const srcItems = Array.isArray(data?.items) ? data.items : [];
        const normalizedItems = srcItems
            .map((item) => {
                const process = String(item.process || '').trim().toLowerCase();
                if (!process) return null;
                const protocol = String(item.protocol || this.inferProtocol(process)).trim().toUpperCase();
                const algorithm = String(item.algorithm || this.inferAlgorithm(protocol, process)).trim().toUpperCase();
                return {
                    process,
                    protocol,
                    algorithm,
                    endpoint: String(item.endpoint || '-'),
                    status: String(item.status || ''),
                    pid: Number(item.pid || 0),
                    tls_terminator: String(item.tls_terminator || 'n/a'),
                    source_kind: String(item.source_kind || 'connection'),
                    weight: 1
                };
            })
            .filter(Boolean);

        const map = new Map();
        normalizedItems.forEach((item) => {
            const key = `${item.process}|${item.protocol}|${item.algorithm}`;
            const prev = map.get(key);
            if (prev) {
                prev.weight += 1;
                if (item.endpoint !== '-' && prev.endpoint === '-') prev.endpoint = item.endpoint;
            } else {
                map.set(key, item);
            }
        });

        let items = Array.from(map.values());
        if (!items.length) {
            const fallbackProcesses = Array.isArray(data?.processes) ? data.processes : ['nginx', 'sshd', 'curl'];
            items = fallbackProcesses.slice(0, 8).map((name) => {
                const process = String(name).toLowerCase();
                const protocol = this.inferProtocol(process);
                return {
                    process,
                    protocol,
                    algorithm: this.inferAlgorithm(protocol, process),
                    endpoint: '-',
                    status: 'IDLE',
                    pid: 0,
                    tls_terminator: 'n/a',
                    source_kind: 'fallback',
                    weight: 1
                };
            });
        }

        items.sort((a, b) => {
            if (b.weight !== a.weight) return b.weight - a.weight;
            return a.process.localeCompare(b.process);
        });

        const trimmed = items.slice(0, 12);
        this.updateLaneLifecycle(trimmed);

        return {
            items: trimmed,
            meta: data?.meta || {}
        };
    }

    updateLaneLifecycle(items) {
        const now = Date.now();
        const currentKeys = new Set();

        items.forEach((lane) => {
            const key = `${lane.process}|${lane.protocol}|${lane.algorithm}`;
            lane.key = key;
            lane.palette = this.getProtocolPalette(lane.protocol);

            const prevMeta = this.laneHistory.get(key);
            lane.isNew = !prevMeta;
            lane.isHot = Boolean(prevMeta && lane.weight > prevMeta.prevWeight);

            this.laneHistory.set(key, {
                firstSeen: prevMeta ? prevMeta.firstSeen : now,
                lastSeen: now,
                prevWeight: lane.weight,
                label: `${lane.process} -> ${lane.protocol} -> ${lane.algorithm}`
            });
            currentKeys.add(key);
        });

        this.prevLaneKeys.forEach((key) => {
            if (!currentKeys.has(key)) {
                const prev = this.laneHistory.get(key);
                if (prev) {
                    this.recentlyGone.unshift({
                        key,
                        label: prev.label,
                        at: now
                    });
                }
                this.laneHistory.delete(key);
            }
        });

        this.recentlyGone = this.recentlyGone
            .filter((item) => now - item.at < 9000)
            .slice(0, 8);

        this.prevLaneKeys = currentKeys;
    }

    showHoverCard(lane, event) {
        if (!this.hoverCard) return;
        this.hoverCard.textContent = [
            `process : ${lane.process}`,
            `pid     : ${lane.pid || '-'}`,
            `proto   : ${lane.protocol}`,
            `algo    : ${lane.algorithm}`,
            `status  : ${lane.status || '-'}`,
            `endpoint: ${lane.endpoint || '-'}`,
            `term    : ${lane.tls_terminator || 'n/a'}`,
            `kind    : ${lane.source_kind || 'connection'}`,
            `weight  : ${lane.weight}`
        ].join('\n');
        this.hoverCard.style.display = 'block';
        this.positionHoverCard(event);
    }

    positionHoverCard(event) {
        if (!this.hoverCard || this.hoverCard.style.display === 'none') return;
        const width = this.hoverCard.offsetWidth || 180;
        const height = this.hoverCard.offsetHeight || 120;
        const left = Math.min(event.clientX + 14, window.innerWidth - width - 12);
        const top = Math.min(event.clientY + 14, window.innerHeight - height - 12);
        this.hoverCard.style.left = `${left}px`;
        this.hoverCard.style.top = `${top}px`;
    }

    hideHoverCard() {
        if (this.hoverCard) {
            this.hoverCard.style.display = 'none';
        }
    }

    drawGrid(layer, width, height) {
        const grid = layer.append('g').attr('class', 'crypto-grid').style('opacity', 0.17);
        const step = 80;

        for (let x = 0; x <= width; x += step) {
            grid.append('line')
                .attr('x1', x)
                .attr('y1', 0)
                .attr('x2', x)
                .attr('y2', height)
                .style('stroke', '#8fa0b5')
                .style('stroke-width', x % (step * 4) === 0 ? 0.8 : 0.45)
                .style('stroke-opacity', x % (step * 4) === 0 ? 0.35 : 0.2);
        }

        for (let y = 0; y <= height; y += step) {
            grid.append('line')
                .attr('x1', 0)
                .attr('y1', y)
                .attr('x2', width)
                .attr('y2', y)
                .style('stroke', '#8fa0b5')
                .style('stroke-width', y % (step * 4) === 0 ? 0.8 : 0.45)
                .style('stroke-opacity', y % (step * 4) === 0 ? 0.35 : 0.2);
        }
    }

    drawProtocolLegend(layer) {
        const legend = layer.append('g').attr('class', 'crypto-protocol-legend');
        const items = [
            ['TLS', this.getProtocolPalette('TLS').label],
            ['SSH/WIREGUARD', this.getProtocolPalette('SSH').label],
            ['CRYPTO API', this.getProtocolPalette('CRYPTO API').label]
        ];

        const lx = 26;
        const ly = 92;
        legend.append('text')
            .attr('x', lx)
            .attr('y', ly)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '10px')
            .style('fill', '#b5bfce')
            .text('PROTOCOL COLORS');

        items.forEach((entry, idx) => {
            legend.append('rect')
                .attr('x', lx)
                .attr('y', ly + 10 + idx * 15)
                .attr('width', 9)
                .attr('height', 9)
                .style('fill', entry[1]);
            legend.append('text')
                .attr('x', lx + 14)
                .attr('y', ly + 18 + idx * 15)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '10px')
                .style('fill', '#aab4c5')
                .text(entry[0]);
        });
    }

    drawRuntimeSourcesPanel(layer, payload, width, height) {
        const sources = Array.isArray(payload?.runtime_sources)
            ? payload.runtime_sources
            : (Array.isArray(payload?.meta?.runtime_sources) ? payload.meta.runtime_sources : []);
        const layout = this.getCryptoLayout(width, height);
        const panelX = layout.rightColumnX;
        const panelY = 82;
        const panelW = layout.rightColumnW;
        const panelH = 38;
        const activeSources = sources.filter((source) => source.active);
        const shown = (activeSources.length ? activeSources : sources).slice(0, 4);

        const panel = layer.append('g').attr('class', 'crypto-runtime-sources');
        panel.append('rect')
            .attr('x', panelX)
            .attr('y', panelY)
            .attr('width', panelW)
            .attr('height', panelH)
            .attr('rx', 8)
            .style('fill', 'rgba(7, 10, 16, 0.78)')
            .style('stroke', 'rgba(150, 178, 220, 0.34)')
            .style('stroke-width', 1);

        panel.append('text')
            .attr('x', panelX + 12)
            .attr('y', panelY + 15)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '9px')
            .style('fill', '#d7ddea')
            .text('CRYPTO RUNTIME SOURCES');

        if (!shown.length) {
            panel.append('text')
                .attr('x', panelX + 12)
                .attr('y', panelY + 30)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '8.5px')
                .style('fill', '#8393a8')
                .text('waiting for live system signals');
            return;
        }

        const sourceColor = (source) => {
            if (!source.active) return '#778396';
            if (source.source === 'direct') return '#8effc8';
            if (source.source === 'procfs') return '#8fdcff';
            return '#ffd58d';
        };
        const chipW = Math.max(70, Math.floor((panelW - 24) / Math.max(1, shown.length)));
        shown.forEach((source, idx) => {
            const x = panelX + 12 + idx * chipW;
            const label = String(source.label || source.id || 'source');
            const color = sourceColor(source);
            panel.append('circle')
                .attr('cx', x + 4)
                .attr('cy', panelY + 28)
                .attr('r', 3)
                .style('fill', color)
                .style('opacity', source.active ? 0.95 : 0.45);
            panel.append('text')
                .attr('x', x + 12)
                .attr('y', panelY + 31)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '8px')
                .style('fill', source.active ? '#c5d0df' : '#758399')
                .text(`${label.slice(0, 12)}:${String(source.source || 'n/a')}`);
        });
    }

    getCryptoLayout(width, height) {
        const originalRightColumnX = Math.floor(width * 0.67);
        const originalRightColumnW = Math.max(280, width - originalRightColumnX - 16);
        const rightColumnW = Math.max(280, Math.floor(originalRightColumnW * 0.8));
        const rightColumnX = width - rightColumnW - 16;
        const leftColumnX = 26;
        const leftColumnW = Math.max(300, Math.floor(width * 0.26));
        const middleColumnX = Math.max(
            leftColumnX + leftColumnW + 18,
            Math.floor(width * 0.38)
        );
        const middleColumnW = Math.max(340, rightColumnX - middleColumnX - 16);
        const flowBottomY = 530;
        const lowerRowY = Math.max(flowBottomY + 36, Math.floor(height * 0.57));
        const lowerRowH = Math.max(232, Math.min(286, height - lowerRowY - 20));
        const materialCardH = Math.max(162, Math.min(182, Math.floor(lowerRowH * 0.72)));
        const protectedZonesY = 128;
        const protectedZonesH = 168;
        const algoCompetitionY = protectedZonesY + protectedZonesH + 14;
        return {
            rightColumnX,
            rightColumnW,
            leftColumnX,
            leftColumnW,
            middleColumnX,
            middleColumnW,
            lowerRowY,
            lowerRowH,
            protectedZonesY,
            protectedZonesH,
            algoCompetitionY,
            materialCardH
        };
    }

    drawProtectedKernelZones(layer, payload, width, height) {
        const zones = Array.isArray(payload?.protected_zones)
            ? payload.protected_zones
            : (Array.isArray(payload?.meta?.protected_zones) ? payload.meta.protected_zones : []);
        const layout = this.getCryptoLayout(width, height);
        const panelX = layout.rightColumnX;
        const panelY = layout.protectedZonesY;
        const panelW = layout.rightColumnW;
        const panelH = layout.protectedZonesH;
        const cx = panelX + panelW * 0.5;
        const cy = panelY + 70;
        const radius = Math.min(40, panelW * 0.18);
        const panel = layer.append('g').attr('class', 'crypto-protected-zones');

        panel.append('rect')
            .attr('x', panelX)
            .attr('y', panelY)
            .attr('width', panelW)
            .attr('height', panelH)
            .attr('rx', 10)
            .style('fill', 'rgba(7, 10, 16, 0.78)')
            .style('stroke', 'rgba(150, 178, 220, 0.34)')
            .style('stroke-width', 1);
        panel.append('text')
            .attr('x', panelX + 14)
            .attr('y', panelY + 22)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '10px')
            .style('fill', '#d7ddea')
            .text('PROTECTED KERNEL ZONES');
        panel.append('text')
            .attr('x', panelX + 14)
            .attr('y', panelY + 38)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '8px')
            .style('fill', '#8795aa')
            .text('segmented shield: protected kernel paths');

        const activeCount = zones.filter((z) => z.active).length;
        const weakCount = zones.filter((z) => !z.active || String(z.status || '').includes('weak')).length;
        panel.append('text')
            .attr('x', panelX + panelW - 116)
            .attr('y', panelY + 22)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '8px')
            .style('fill', '#9fb1c8')
            .text(`protected ${activeCount} · weak ${weakCount}`);

        panel.append('circle')
            .attr('cx', cx)
            .attr('cy', cy)
            .attr('r', radius * 0.56)
            .style('fill', 'rgba(12, 18, 26, 0.92)')
            .style('stroke', 'rgba(214, 225, 242, 0.22)')
            .style('stroke-width', 1);

        const safeZones = zones.length ? zones : [
            { id: 'tls', label: 'TLS / kTLS', active: false, status: 'unknown', strength: 0.2 },
            { id: 'block', label: 'dm-crypt / block', active: false, status: 'unknown', strength: 0.2 },
            { id: 'entropy', label: 'random / entropy', active: false, status: 'unknown', strength: 0.2 }
        ];
        const arc = d3.arc().innerRadius(radius * 0.64).outerRadius(radius).cornerRadius(3);
        const angleStep = (Math.PI * 2) / Math.max(1, safeZones.length);
        const colorFor = (zone) => {
            const status = String(zone.status || '');
            if (zone.active && status === 'active') return '#78efc1';
            if (zone.active) return '#bfe9ff';
            if (status.includes('weak')) return '#ffd279';
            return '#7d899a';
        };
        const shield = panel.append('g').attr('transform', `translate(${cx},${cy})`);
        safeZones.forEach((zone, idx) => {
            const start = -Math.PI / 2 + idx * angleStep + 0.03;
            const end = start + angleStep - 0.06;
            const color = colorFor(zone);
            shield.append('path')
                .attr('d', arc({ startAngle: start, endAngle: end }))
                .style('fill', color)
                .style('fill-opacity', zone.active ? (0.18 + Number(zone.strength || 0.4) * 0.42) : 0.08)
                .style('stroke', color)
                .style('stroke-opacity', zone.active ? 0.86 : 0.32)
                .style('stroke-width', zone.active ? 1.4 : 0.8);
        });
        shield.append('text')
            .attr('text-anchor', 'middle')
            .attr('y', -3)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '9px')
            .style('fill', '#d7ddea')
            .text('KERNEL');
        shield.append('text')
            .attr('text-anchor', 'middle')
            .attr('y', 11)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '8px')
            .style('fill', '#92a2b8')
            .text('CRYPTO SHIELD');

        safeZones.slice(0, 5).forEach((zone, idx) => {
            const rowY = panelY + 104 + idx * 12;
            const color = colorFor(zone);
            panel.append('rect')
                .attr('x', panelX + 14)
                .attr('y', rowY - 6)
                .attr('width', 7)
                .attr('height', 7)
                .style('fill', color)
                .style('opacity', zone.active ? 0.9 : 0.38);
            panel.append('text')
                .attr('x', panelX + 28)
                .attr('y', rowY)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '9px')
                .style('fill', zone.active ? '#cdd8e8' : '#78869a')
                .text(`${String(zone.label || zone.id).slice(0, 28)} · ${String(zone.status || 'unknown').toUpperCase()}`);
        });
    }

    getCompetitionPayload(meta) {
        const selected = String(this.selectedCompetitionAlgorithm || 'AES').toLowerCase();
        const groups = meta?.algorithm_competitions || null;
        if (groups && groups[selected]) return groups[selected];
        return meta?.algorithm_competition || {
            request: this.selectedCompetitionAlgorithm,
            implementations: [],
            selected: null,
            selection_policy: 'max-priority'
        };
    }

    getDecisionPipelinePayload(meta) {
        const selected = String(this.selectedCompetitionAlgorithm || 'AES').toLowerCase();
        const groups = meta?.crypto_decision_pipelines || null;
        if (groups && groups[selected]) return groups[selected];
        return meta?.crypto_decision_pipeline || {
            request: this.selectedCompetitionAlgorithm,
            request_origin: 'user/kernel request',
            requesters: [{ name: 'user/kernel request', kind: 'generic', score: 1 }],
            tfm_lookup: 'crypto_lookup(?)',
            impl_shortlist: [],
            priority_check: 'max priority wins',
            capability_check: 'generic-cpu-only',
            selected_driver: 'unknown',
            fallback_driver: 'none',
            fallback_active: false,
            fallback_reason: 'not-triggered',
            source: 'mock'
        };
    }

    getEntropyPayload(meta) {
        return meta?.entropy_cloud || {
            entropy_pool_bits: 256,
            entropy_pool_size_bits: 256,
            crng_state: 'ready',
            random_subsystem_state: 'stable',
            particle_density: 44,
            key_birth_rate_est: 6.2,
            sources: [
                { source: 'interrupt timing', intensity: 72, status: 'active' },
                { source: 'disk IO', intensity: 45, status: 'active' },
                { source: 'network timing', intensity: 38, status: 'active' },
                { source: 'hardware RNG', intensity: 62, status: 'active' }
            ],
            read_wakeup_threshold: 128,
            write_wakeup_threshold: 64,
            mode: 'mock'
        };
    }

    drawAlgorithmCompetition(layer, meta, width, height) {
        const comp = this.getCompetitionPayload(meta);
        const request = String(comp.request || this.selectedCompetitionAlgorithm || 'AES').toUpperCase();
        const impls = Array.isArray(comp.implementations) ? comp.implementations.slice(0, 5) : [];
        const selectedName = String(comp?.selected?.name || '').toLowerCase();

        const layout = this.getCryptoLayout(width, height);
        const panelX = layout.rightColumnX;
        const panelY = layout.algoCompetitionY;
        const panelW = layout.rightColumnW;
        const listRowStep = 18;
        const panelH = Math.max(
            196,
            Math.min(layout.lowerRowY - panelY - 12, 118 + impls.length * listRowStep)
        );

        const panel = layer.append('g').attr('class', 'crypto-algo-competition');
        panel.append('rect')
            .attr('x', panelX)
            .attr('y', panelY)
            .attr('width', panelW)
            .attr('height', panelH)
            .attr('rx', 8)
            .style('fill', 'rgba(8, 11, 16, 0.88)')
            .style('stroke', 'rgba(165, 178, 200, 0.35)')
            .style('stroke-width', 1);

        panel.append('text')
            .attr('x', panelX + 14)
            .attr('y', panelY + 22)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '11px')
            .style('fill', '#d7ddea')
            .text('ALGORITHM COMPETITION');

        const toggleY = panelY + 38;
        this.algorithmModes.forEach((mode, idx) => {
            const isActive = mode === request;
            const btnX = panelX + 14 + idx * 86;
            const btn = panel.append('g')
                .attr('class', 'algo-toggle-btn')
                .style('cursor', 'pointer')
                .on('click', () => {
                    this.selectedCompetitionAlgorithm = mode;
                    this.selectedImplementationClassFilter = null;
                    this.renderFlowMap(this.lastPayload || this.normalizeTelemetry(this.getFallbackTelemetry()));
                });

            btn.append('rect')
                .attr('x', btnX)
                .attr('y', toggleY)
                .attr('width', 78)
                .attr('height', 18)
                .attr('rx', 4)
                .style('fill', isActive ? 'rgba(32, 52, 81, 0.92)' : 'rgba(12, 16, 22, 0.85)')
                .style('stroke', isActive ? 'rgba(124, 178, 255, 0.9)' : 'rgba(150, 162, 182, 0.35)')
                .style('stroke-width', isActive ? 1.1 : 0.8);

            btn.append('text')
                .attr('x', btnX + 39)
                .attr('y', toggleY + 12)
                .attr('text-anchor', 'middle')
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '9px')
                .style('letter-spacing', '0.3px')
                .style('fill', isActive ? '#cfe2ff' : '#a7b3c5')
                .text(mode);
        });

        panel.append('text')
            .attr('x', panelX + 14)
            .attr('y', panelY + 67)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '10px')
            .style('fill', '#99a8bd')
            .text(`request ${request} -> lookup -> pick max priority`);

        const stepsY = panelY + 80;
        panel.append('text')
            .attr('x', panelX + 14)
            .attr('y', stepsY)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '10px')
            .style('fill', '#b3bece')
            .text(`${request} REQUEST`);

        panel.append('line')
            .attr('x1', panelX + 20)
            .attr('y1', stepsY + 8)
            .attr('x2', panelX + 20)
            .attr('y2', stepsY + 22)
            .style('stroke', '#7c8ca2')
            .style('stroke-width', 1);

        panel.append('text')
            .attr('x', panelX + 14)
            .attr('y', stepsY + 34)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '10px')
            .style('fill', '#b3bece')
            .text('CRYPTO LOOKUP');

        const baseY = stepsY + 42;
        if (!impls.length) {
            panel.append('text')
                .attr('x', panelX + 14)
                .attr('y', baseY)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '10px')
                .style('fill', '#97a5ba')
                .text('No implementations detected');
            return;
        }

        impls.forEach((impl, idx) => {
            const y = baseY + idx * listRowStep;
            const name = String(impl.name || 'unknown');
            const prio = Number(impl.priority || 0);
            const isSelected = name.toLowerCase() === selectedName;

            panel.append('rect')
                .attr('x', panelX + 12)
                .attr('y', y - 12)
                .attr('width', panelW - 24)
                .attr('height', 16)
                .attr('rx', 5)
                .style('fill', isSelected ? 'rgba(20, 39, 29, 0.9)' : 'rgba(14, 18, 24, 0.85)')
                .style('stroke', isSelected ? 'rgba(114, 242, 173, 0.8)' : 'rgba(150, 162, 182, 0.28)')
                .style('stroke-width', isSelected ? 1.2 : 0.8);

            panel.append('text')
                .attr('x', panelX + 20)
                .attr('y', y + 1)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '10px')
                .style('fill', isSelected ? '#9effca' : '#c5cedb')
                .text(`${name}  priority ${prio}`);

            if (isSelected) {
                panel.append('text')
                    .attr('x', panelX + panelW - 78)
                    .attr('y', y + 1)
                    .style('font-family', 'Share Tech Mono, monospace')
                    .style('font-size', '9px')
                    .style('fill', '#9effca')
                    .text('SELECTED');
            }
        });
    }

    drawDecisionPipeline(layer, meta, width, height) {
        const pipeline = this.getDecisionPipelinePayload(meta);
        const request = String(pipeline.request || this.selectedCompetitionAlgorithm || 'AES').toUpperCase();
        const shortlist = Array.isArray(pipeline.impl_shortlist) ? pipeline.impl_shortlist.slice(0, 3) : [];
        const requesters = Array.isArray(pipeline.requesters) ? pipeline.requesters.slice(0, 3) : [];
        const selectedDriver = String(pipeline.selected_driver || 'unknown');
        const fallbackDriver = String(pipeline.fallback_driver || 'none');
        const fallbackActive = Boolean(pipeline.fallback_active);
        const layout = this.getCryptoLayout(width, height);
        const panelX = layout.rightColumnX;
        const panelW = layout.rightColumnW;
        const panelY = layout.lowerRowY;
        const panelH = layout.lowerRowH;

        const panel = layer.append('g').attr('class', 'crypto-decision-pipeline');
        panel.append('rect')
            .attr('x', panelX)
            .attr('y', panelY)
            .attr('width', panelW)
            .attr('height', panelH)
            .attr('rx', 8)
            .style('fill', 'rgba(8, 11, 16, 0.88)')
            .style('stroke', 'rgba(165, 178, 200, 0.35)')
            .style('stroke-width', 1);

        panel.append('text')
            .attr('x', panelX + 14)
            .attr('y', panelY + 20)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '11px')
            .style('fill', '#d7ddea')
            .text('CRYPTO DECISION PIPELINE');

        panel.append('text')
            .attr('x', panelX + 14)
            .attr('y', panelY + 40)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '10px')
            .style('fill', '#a8b7cd')
            .text('requestors -> request');

        if (!requesters.length) {
            panel.append('text')
                .attr('x', panelX + 14)
                .attr('y', panelY + 56)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '9px')
                .style('fill', '#708095')
                .text('none detected');
        } else {
            requesters.forEach((req, idx) => {
                const reqName = String(req.name || 'unknown');
                const reqKind = String(req.kind || 'generic');
                const reqScore = Number(req.score || 0);
                const isActiveRequester = Boolean(
                    this.selectedRequesterFilter
                    && String(this.selectedRequesterFilter.name || '').toLowerCase() === reqName.toLowerCase()
                    && String(this.selectedRequesterFilter.kind || '').toLowerCase() === reqKind.toLowerCase()
                );
                const row = panel.append('g')
                    .style('cursor', 'pointer')
                    .on('click', () => {
                        if (
                            this.selectedRequesterFilter
                            && String(this.selectedRequesterFilter.name || '').toLowerCase() === reqName.toLowerCase()
                            && String(this.selectedRequesterFilter.kind || '').toLowerCase() === reqKind.toLowerCase()
                        ) {
                            this.selectedRequesterFilter = null;
                        } else {
                            this.selectedRequesterFilter = { name: reqName, kind: reqKind };
                        }
                        this.renderFlowMap(this.lastPayload || this.normalizeTelemetry(this.getFallbackTelemetry()));
                    });
                row.append('rect')
                    .attr('x', panelX + 10)
                    .attr('y', panelY + 46 + idx * 18)
                    .attr('width', panelW - 20)
                    .attr('height', 16)
                    .attr('rx', 3)
                .style('fill', isActiveRequester ? 'rgba(37, 58, 92, 0.62)' : 'transparent')
                .style('stroke', isActiveRequester ? 'rgba(120, 170, 245, 0.72)' : 'transparent')
                    .style('stroke-width', 0.8);
                row.append('text')
                    .attr('x', panelX + 14)
                    .attr('y', panelY + 58 + idx * 18)
                    .style('font-family', 'Share Tech Mono, monospace')
                    .style('font-size', '10px')
                    .style('fill', isActiveRequester ? '#e1eeff' : (idx === 0 ? '#cce2ff' : '#95a6bc'))
                    .text(`- ${reqName} [${reqKind}] (${reqScore})`);
            });
        }

        const stepsBaseY = panelY + 108;
        const lineStep = 22;
        const lines = [
            `request (${request}) from ${String(pipeline.request_origin || 'user/kernel request')}`,
            `tfm lookup: ${String(pipeline.tfm_lookup || 'crypto_lookup(?)')}`,
            `impl shortlist: ${shortlist.length ? shortlist.join(' | ') : 'none'}`,
            `priority check: ${String(pipeline.priority_check || 'max priority wins')}`,
            `capability check: ${String(pipeline.capability_check || 'generic-cpu-only')}`,
            `selected driver: ${selectedDriver}`
        ];

        lines.forEach((line, idx) => {
            panel.append('text')
                .attr('x', panelX + 14)
                .attr('y', stepsBaseY + idx * lineStep)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '10px')
                .style('fill', line.startsWith('selected') ? '#a4ffcf' : '#b8c3d4')
                .text(line);
        });

        panel.append('text')
            .attr('x', panelX + 14)
            .attr('y', panelY + panelH - 24)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '10px')
            .style('fill', fallbackActive ? '#ffb0b0' : '#95a6bc')
            .text(`fallback: ${fallbackDriver} (${fallbackActive ? 'active' : 'not active'})`);

        panel.append('text')
            .attr('x', panelX + 14)
            .attr('y', panelY + panelH - 10)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '9px')
            .style('fill', '#8393a8')
            .text(`reason: ${String(pipeline.fallback_reason || 'not-triggered')}`);
    }

    getImplementationClass(implName) {
        const name = String(implName || '').toLowerCase();
        if (!name) return 'generic';
        if (name.includes('aesni') || name.includes('vaes') || name.includes('ce')) return 'cpu-instr';
        if (name.includes('avx') || name.includes('sse') || name.includes('simd') || name.includes('neon')) return 'simd';
        if (name.includes('qat') || name.includes('virtio')) return 'offload';
        if (name.includes('generic')) return 'generic';
        return 'generic';
    }

    hashText(text) {
        let hash = 0;
        const src = String(text || '');
        for (let i = 0; i < src.length; i += 1) {
            hash = ((hash << 5) - hash) + src.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash);
    }

    laneMatchesSelectedAlgorithm(lane) {
        const selectedAlgo = String(this.selectedCompetitionAlgorithm || 'AES').toLowerCase();
        const protocol = String(lane?.protocol || '').toUpperCase();
        const algo = String(lane?.algorithm || '').toLowerCase();
        if (selectedAlgo === 'aes') {
            return algo.includes('aes') || protocol === 'TLS';
        }
        if (selectedAlgo === 'sha') {
            return algo.includes('sha') || protocol === 'TLS';
        }
        if (selectedAlgo === 'chacha20') {
            return algo.includes('chacha') || protocol === 'WIREGUARD' || protocol === 'SSH';
        }
        return true;
    }

    laneMatchesSelectedImplementationClass(lane) {
        const cls = String(this.selectedImplementationClassFilter || '');
        if (!cls) return true;
        if (!this.laneMatchesSelectedAlgorithm(lane)) return false;

        const protocol = String(lane?.protocol || '').toUpperCase();
        const sourceKind = String(lane?.source_kind || '').toLowerCase();

        if (cls === 'cpu-instr') {
            // CPU instruction path is mainly relevant for AES/SHA-family flows.
            const selectedAlgo = String(this.selectedCompetitionAlgorithm || 'AES').toLowerCase();
            return selectedAlgo === 'aes' || selectedAlgo === 'sha';
        }
        if (cls === 'simd') {
            return true;
        }
        if (cls === 'offload') {
            return protocol === 'TLS' || protocol === 'WIREGUARD' || sourceKind === 'connection';
        }
        if (cls === 'generic') {
            return true;
        }
        return true;
    }

    drawAlgorithmMaterialCard(layer, meta, width, height) {
        const comp = this.getCompetitionPayload(meta);
        const pipeline = this.getDecisionPipelinePayload(meta);
        const request = String(comp.request || this.selectedCompetitionAlgorithm || 'AES').toUpperCase();
        const impls = Array.isArray(comp.implementations) ? comp.implementations.slice(0, 8) : [];
        const selectedName = String(comp?.selected?.name || '').toLowerCase();
        const selectedPriority = Number(comp?.selected?.priority || 0);
        const requesters = Array.isArray(pipeline?.requesters) ? pipeline.requesters : [];
        const topRequester = requesters.length ? requesters[0] : null;

        const layout = this.getCryptoLayout(width, height);
        const cardX = layout.middleColumnX;
        const cardW = layout.middleColumnW;
        const cardH = layout.materialCardH;
        const cardY = layout.lowerRowY;

        const card = layer.append('g').attr('class', 'crypto-material-card');
        card.append('rect')
            .attr('x', cardX)
            .attr('y', cardY)
            .attr('width', cardW)
            .attr('height', cardH)
            .attr('rx', 9)
            .style('fill', 'rgba(7, 10, 15, 0.9)')
            .style('stroke', 'rgba(162, 176, 198, 0.32)')
            .style('stroke-width', 1);

        card.append('text')
            .attr('x', cardX + 14)
            .attr('y', cardY + 22)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '11px')
            .style('letter-spacing', '0.5px')
            .style('fill', '#d7ddea')
            .text('ALGORITHM MATERIAL CARD');

        const leftX = cardX + 14;
        const baseY = cardY + 44;
        const details = [
            `${request} - UID: ${String(comp?.selected?.type || 'tfm').toUpperCase()}`,
            `classification: kernel crypto algorithm`,
            `requestor: ${topRequester ? topRequester.name : 'unknown'}`,
            `tfm lookup: ${String(pipeline.tfm_lookup || 'crypto_lookup(?)')}`,
            `selected: ${String(comp?.selected?.name || 'unknown')}`,
            `priority: ${selectedPriority || '-'}`,
            `capability: ${String(pipeline.capability_check || 'generic-cpu-only')}`
        ];
        details.forEach((line, idx) => {
            card.append('text')
                .attr('x', leftX)
                .attr('y', baseY + idx * 16)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', idx === 0 ? '10px' : '9.5px')
                .style('fill', idx === 0 ? '#f0f4fb' : '#a7b3c4')
                .text(line);
        });

        const cloudX = cardX + Math.floor(cardW * 0.57);
        const cloudY = cardY + 34;
        const cloudW = cardW - Math.floor(cardW * 0.57) - 14;
        const cloudH = Math.max(86, cardH - 50);
        card.append('rect')
            .attr('x', cloudX)
            .attr('y', cloudY)
            .attr('width', cloudW)
            .attr('height', cloudH)
            .attr('rx', 7)
            .style('fill', 'rgba(12, 16, 22, 0.62)')
            .style('stroke', 'rgba(112, 123, 140, 0.28)')
            .style('stroke-width', 0.8);

        const maxPriority = Math.max(...impls.map((i) => Number(i.priority || 0)), 1);
        const classAccent = {
            'cpu-instr': '#6ed0ff',
            simd: '#d9b1f4',
            offload: '#95f0cf',
            generic: '#9da9bd'
        };

        impls.forEach((impl, idx) => {
            const name = String(impl.name || 'unknown');
            const prio = Number(impl.priority || 0);
            const cls = this.getImplementationClass(name);
            const jitter = this.hashText(name);
            const col = idx % 3;
            const row = Math.floor(idx / 3);
            const localX = 16 + col * Math.max(22, Math.floor((cloudW - 40) / 3)) + (jitter % 11) - 5;
            const localY = 18 + row * 28 + ((Math.floor(jitter / 7) % 9) - 4);
            const cx = Math.max(cloudX + 12, Math.min(cloudX + cloudW - 12, cloudX + localX));
            const cy = Math.max(cloudY + 12, Math.min(cloudY + cloudH - 12, cloudY + localY));
            const radius = 3.8 + ((prio / maxPriority) * 5.8);
            const isSelected = name.toLowerCase() === selectedName;
            const isClassFiltered = this.selectedImplementationClassFilter === cls;

            card.append('circle')
                .attr('cx', cx)
                .attr('cy', cy)
                .attr('r', radius)
                .style('fill', isSelected ? classAccent[cls] : 'rgba(18, 24, 32, 0.92)')
                .style('stroke', isSelected ? classAccent[cls] : classAccent[cls])
                .style('stroke-width', isSelected ? 1.55 : 0.9)
                .style('opacity', isSelected ? 0.98 : (isClassFiltered ? 0.95 : 0.82))
                .style('cursor', 'pointer')
                .on('click', () => {
                    this.selectedImplementationClassFilter = this.selectedImplementationClassFilter === cls ? null : cls;
                    this.renderFlowMap(this.lastPayload || this.normalizeTelemetry(this.getFallbackTelemetry()));
                });

            if (isSelected) {
                card.append('circle')
                    .attr('cx', cx)
                    .attr('cy', cy)
                    .attr('r', radius + 3.5)
                    .style('fill', 'none')
                    .style('stroke', classAccent[cls])
                    .style('stroke-width', 0.85)
                    .style('opacity', 0.7);
            }

            if (isClassFiltered) {
                card.append('circle')
                    .attr('cx', cx)
                    .attr('cy', cy)
                    .attr('r', radius + 2.1)
                    .style('fill', 'none')
                    .style('stroke', '#e5ebf5')
                    .style('stroke-width', 0.8)
                    .style('opacity', 0.88)
                    .style('pointer-events', 'none');
            }
        });

        card.append('text')
            .attr('x', cloudX + 8)
            .attr('y', cardY + cardH - 14)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '8.5px')
            .style('fill', '#8f9eb3')
            .text('dots = implementations, size = priority');

        if (this.selectedImplementationClassFilter) {
            card.append('text')
                .attr('x', leftX)
                .attr('y', cardY + cardH - 14)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '8.5px')
                .style('fill', '#c8d6ea')
                .text(`class filter: ${this.selectedImplementationClassFilter} (click dot to clear)`);
        }
    }

    drawEntropyCloud(layer, meta, width, height) {
        const entropy = this.getEntropyPayload(meta);
        const sources = Array.isArray(entropy.sources) ? entropy.sources.slice(0, 4) : [];
        const layout = this.getCryptoLayout(width, height);
        const panelX = layout.middleColumnX;
        const panelW = layout.middleColumnW;
        const panelY = layout.lowerRowY + layout.materialCardH + 12;
        const maxPanelH = Math.max(150, height - panelY - 18);
        const panelH = Math.max(150, Math.min(224, maxPanelH));
        const panel = layer.append('g').attr('class', 'crypto-entropy-cloud');

        panel.append('rect')
            .attr('x', panelX)
            .attr('y', panelY)
            .attr('width', panelW)
            .attr('height', panelH)
            .attr('rx', 9)
            .style('fill', 'rgba(7, 10, 15, 0.9)')
            .style('stroke', 'rgba(162, 176, 198, 0.32)')
            .style('stroke-width', 1);

        panel.append('text')
            .attr('x', panelX + 14)
            .attr('y', panelY + 22)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '11px')
            .style('letter-spacing', '0.45px')
            .style('fill', '#d7ddea')
            .text('KERNEL ENTROPY CLOUD');

        const poolBits = Number(entropy.entropy_pool_bits || 0);
        const poolSizeBits = Math.max(Number(entropy.entropy_pool_size_bits || 256), 1);
        const poolPct = Math.max(0, Math.min(100, (poolBits / poolSizeBits) * 100));
        panel.append('text')
            .attr('x', panelX + 14)
            .attr('y', panelY + 42)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '9.5px')
            .style('fill', '#a8b5c8')
            .text(`entropy pool: ${poolBits}/${poolSizeBits} bits (${poolPct.toFixed(0)}%)`);
        panel.append('text')
            .attr('x', panelX + 14)
            .attr('y', panelY + 58)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '9.5px')
            .style('fill', '#a8b5c8')
            .text(`CRNG (ChaCha20): ${String(entropy.crng_state || 'unknown').toUpperCase()}`);
        panel.append('text')
            .attr('x', panelX + 14)
            .attr('y', panelY + 74)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '9.5px')
            .style('fill', '#a8b5c8')
            .text(`random subsystem: ${String(entropy.random_subsystem_state || 'unknown').toUpperCase()}`);

        const cloudX = panelX + 12;
        const cloudY = panelY + 86;
        // Keep particle viewport compact so right-side source metrics fit comfortably.
        const cloudW = Math.max(150, panelW - 220);
        const cloudH = Math.max(72, panelH - 104);
        panel.append('rect')
            .attr('x', cloudX)
            .attr('y', cloudY)
            .attr('width', cloudW)
            .attr('height', cloudH)
            .attr('rx', 7)
            .style('fill', 'rgba(11, 16, 22, 0.7)')
            .style('stroke', 'rgba(108, 120, 139, 0.24)')
            .style('stroke-width', 0.8);

        const particleCount = Math.max(12, Math.min(90, Number(entropy.particle_density || 32)));
        for (let i = 0; i < particleCount; i += 1) {
            const h = this.hashText(`entropy-${i}`);
            const px = cloudX + 10 + (h % Math.max(12, cloudW - 20));
            const py = cloudY + 10 + ((Math.floor(h / 9)) % Math.max(12, cloudH - 20));
            const phase = (this.activeAnimationTick * 0.55) + (i * 0.37);
            const pulse = 0.45 + 0.55 * ((Math.sin(phase) + 1) / 2);
            const radius = 1.3 + ((h % 17) / 18) * 2.1 + pulse * 1.25;
            const alpha = 0.28 + pulse * 0.64;
            const hue = i % 7 === 0 ? '#80dbe8' : '#6eb1d5';
            panel.append('circle')
                .attr('cx', px)
                .attr('cy', py)
                .attr('r', radius)
                .style('fill', hue)
                .style('opacity', Math.min(alpha, 0.86));
        }

        const keyRate = Number(entropy.key_birth_rate_est || 0);
        const keyNodes = Math.max(1, Math.min(5, Math.round(keyRate / 2.2)));
        const keyBaseX = panelX + panelW - 112;
        const srcY = panelY + panelH - 66;
        const keyBaseY = srcY - 28;
        panel.append('text')
            .attr('x', keyBaseX)
            .attr('y', keyBaseY - 12)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '9px')
            .style('fill', '#99a8bd')
            .text(`key births/s est: ${keyRate.toFixed(2)}`);

        for (let i = 0; i < keyNodes; i += 1) {
            const x = keyBaseX + (i % 3) * 20;
            const y = keyBaseY + Math.floor(i / 3) * 18;
            panel.append('rect')
                .attr('x', x)
                .attr('y', y)
                .attr('width', 8)
                .attr('height', 8)
                .attr('transform', `rotate(45, ${x + 4}, ${y + 4})`)
                .style('fill', '#9de8ff')
                .style('opacity', 0.84);
        }

        panel.append('line')
            .attr('x1', cloudX + cloudW + 4)
            .attr('y1', cloudY + Math.floor(cloudH / 2))
            .attr('x2', keyBaseX - 6)
            .attr('y2', keyBaseY + 2)
            .style('stroke', '#7fc4e8')
            .style('stroke-width', 1)
            .style('stroke-opacity', 0.7);

        const srcX = panelX + panelW - 162;
        const sourceBarX = srcX + 70;
        const sourceBarW = Math.max(64, Math.min(76, panelX + panelW - sourceBarX - 8));
        panel.append('text')
            .attr('x', srcX)
            .attr('y', srcY)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '9px')
            .style('fill', '#a2b0c4')
            .text('entropy sources');

        sources.forEach((item, idx) => {
            const y = srcY + 15 + idx * 16;
            const intensity = Math.max(0, Math.min(100, Number(item.intensity || 0)));
            const status = String(item.status || 'low').toLowerCase();
            const barW = Math.round((intensity / 100) * sourceBarW);
            const color = status === 'active' ? '#8ff0ff' : (status === 'limited' ? '#ffd18d' : '#8798ad');
            panel.append('text')
                .attr('x', srcX)
                .attr('y', y)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '8.5px')
                .style('fill', '#95a5bb')
                .text(String(item.source || 'source'));
            panel.append('rect')
                .attr('x', sourceBarX)
                .attr('y', y - 8)
                .attr('width', sourceBarW)
                .attr('height', 5)
                .attr('rx', 2)
                .style('fill', 'rgba(35, 42, 52, 0.9)');
            panel.append('rect')
                .attr('x', sourceBarX)
                .attr('y', y - 8)
                .attr('width', barW)
                .attr('height', 5)
                .attr('rx', 2)
                .style('fill', color)
                .style('opacity', 0.88);
        });

        panel.append('text')
            .attr('x', panelX + panelW - 10)
            .attr('y', panelY + panelH - 8)
            .attr('text-anchor', 'end')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '8px')
            .style('fill', '#718199')
            .text(`mode: ${String(entropy.mode || 'live-heuristic')}`);
    }

    drawStage1Panels(layer, meta, width, height) {
        const stage = meta?.crypto_stage1 || {};
        const clients = Array.isArray(stage.kernel_clients) ? stage.kernel_clients.slice(0, 6) : [];
        const syncAsync = stage.sync_async || {};
        const offload = Array.isArray(stage.hw_offload) ? stage.hw_offload.slice(0, 5) : [];

        const layout = this.getCryptoLayout(width, height);
        const panelW = layout.leftColumnW;
        const baseX = layout.leftColumnX;
        const gap = 12;
        const clientsH = 134;
        const queueH = 86;
        const offloadH = 116;
        const baseY = layout.lowerRowY;
        const isAllSelected = this.selectedClientFilters.size === 0;

        const drawPanelShell = (x, y, w, h, title) => {
            const g = layer.append('g').attr('class', 'crypto-stage1-panel');
            g.append('rect')
                .attr('x', x)
                .attr('y', y)
                .attr('width', w)
                .attr('height', h)
                .attr('rx', 8)
                .style('fill', 'rgba(8, 11, 16, 0.84)')
                .style('stroke', 'rgba(155, 168, 190, 0.32)')
                .style('stroke-width', 1);
            g.append('text')
                .attr('x', x + 12)
                .attr('y', y + 18)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '10px')
                .style('fill', '#d2d9e6')
                .text(title);
            return g;
        };

        const clientsPanel = drawPanelShell(baseX, baseY, panelW, clientsH, 'KERNEL CRYPTO CLIENTS');
        const resetGroup = clientsPanel.append('g')
            .style('cursor', 'pointer')
            .on('click', () => {
                this.selectedClientFilters.clear();
                this.renderFlowMap(this.lastPayload || this.normalizeTelemetry(this.getFallbackTelemetry()));
            });
        resetGroup.append('rect')
            .attr('x', baseX + panelW - 56)
            .attr('y', baseY + 7)
            .attr('width', 42)
            .attr('height', 14)
            .attr('rx', 4)
            .style('fill', isAllSelected ? 'rgba(40, 66, 100, 0.9)' : 'rgba(13, 18, 24, 0.82)')
            .style('stroke', isAllSelected ? 'rgba(129, 180, 255, 0.9)' : 'rgba(150, 164, 184, 0.3)')
            .style('stroke-width', 0.8);
        resetGroup.append('text')
            .attr('x', baseX + panelW - 35)
            .attr('y', baseY + 17)
            .attr('text-anchor', 'middle')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '9px')
            .style('fill', isAllSelected ? '#d3e7ff' : '#9aa9bc')
            .text('ALL');

        clientsPanel.append('text')
            .attr('x', baseX + panelW - 96)
            .attr('y', baseY + 34)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '8px')
            .style('fill', '#7f8ea4')
            .text('multi-select');

        if (!clients.length) {
            clientsPanel.append('text')
                .attr('x', baseX + 12)
                .attr('y', baseY + 40)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '10px')
                .style('fill', '#95a4b7')
                .text('No active clients');
        } else {
            clients.forEach((item, idx) => {
                const y = baseY + 36 + idx * 16;
                const status = String(item.status || 'idle').toLowerCase();
                const dotColor = status === 'active' ? '#8effc8' : '#8f9caf';
                const itemName = String(item.name || '');
                const isActiveFilter = this.selectedClientFilters.has(itemName);
                const row = clientsPanel.append('g')
                    .style('cursor', 'pointer')
                    .on('click', () => {
                        if (this.selectedClientFilters.has(itemName)) {
                            this.selectedClientFilters.delete(itemName);
                        } else {
                            this.selectedClientFilters.add(itemName);
                        }
                        this.renderFlowMap(this.lastPayload || this.normalizeTelemetry(this.getFallbackTelemetry()));
                    });
                row.append('rect')
                    .attr('x', baseX + 8)
                    .attr('y', y - 12)
                    .attr('width', panelW - 16)
                    .attr('height', 14)
                    .attr('rx', 3)
                    .style('fill', isActiveFilter ? 'rgba(37, 58, 92, 0.62)' : 'transparent')
                    .style('stroke', isActiveFilter ? 'rgba(120, 170, 245, 0.72)' : 'transparent')
                    .style('stroke-width', 0.8);
                row.append('circle')
                    .attr('cx', baseX + 14)
                    .attr('cy', y - 3)
                    .attr('r', 2.8)
                    .style('fill', dotColor);
                row.append('text')
                    .attr('x', baseX + 22)
                    .attr('y', y)
                    .style('font-family', 'Share Tech Mono, monospace')
                    .style('font-size', '10px')
                    .style('fill', isActiveFilter ? '#d8e7ff' : '#b7c2d3')
                    .text(`${itemName}: ${status} (${Number(item.active_flows || 0)})`);
            });
        }

        const queueY = baseY + clientsH + gap;
        const queuePanel = drawPanelShell(baseX, queueY, panelW, queueH, 'SYNC VS ASYNC QUEUE');
        const syncOps = Number(syncAsync.sync_ops_est || 0);
        const asyncOps = Number(syncAsync.async_ops_est || 0);
        const qDepth = Number(syncAsync.queue_depth_est || 0);
        const qLat = Number(syncAsync.queue_latency_ms_est || 0);
        queuePanel.append('text')
            .attr('x', baseX + 12)
            .attr('y', queueY + 38)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '10px')
            .style('fill', '#aeb9ca')
            .text(`sync:${syncOps}  async:${asyncOps}  depth:${qDepth}`);
        queuePanel.append('text')
            .attr('x', baseX + 12)
            .attr('y', queueY + 56)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '10px')
            .style('fill', '#aeb9ca')
            .text(`queue latency est: ${qLat.toFixed(2)} ms`);

        const offloadY = queueY + queueH + gap;
        const offloadPanel = drawPanelShell(baseX, offloadY, panelW, offloadH, 'HW OFFLOAD STATUS');
        if (!offload.length) {
            offloadPanel.append('text')
                .attr('x', baseX + 12)
                .attr('y', offloadY + 38)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '10px')
                .style('fill', '#95a4b7')
                .text('No offload providers detected');
        } else {
            offload.forEach((item, idx) => {
                const y = offloadY + 34 + idx * 16;
                const status = String(item.status || 'unavailable').toLowerCase();
                const color = status === 'active'
                    ? '#8effc8'
                    : (status === 'available' ? '#ffe39f' : '#9aa7b9');
                offloadPanel.append('text')
                    .attr('x', baseX + 12)
                    .attr('y', y)
                    .style('font-family', 'Share Tech Mono, monospace')
                    .style('font-size', '10px')
                    .style('fill', color)
                    .text(`${item.engine}: ${status}`);
            });
        }
    }

    laneMatchesClient(clientName, lane) {
        const client = String(clientName || '').toLowerCase();
        if (!client || client === 'all') return true;
        const process = String(lane?.process || '').toLowerCase();
        const protocol = String(lane?.protocol || '').toUpperCase();
        const algo = String(lane?.algorithm || '').toLowerCase();
        const sourceKind = String(lane?.source_kind || '').toLowerCase();

        if (client === 'ktls') {
            return protocol === 'TLS' || ['nginx', 'haproxy', 'envoy', 'caddy', 'apache', 'httpd', 'traefik'].some((x) => process.includes(x));
        }
        if (client === 'wireguard') {
            return protocol === 'WIREGUARD' || process.includes('wg') || process.includes('wireguard');
        }
        if (client === 'ipsec/xfrm') {
            return process.includes('ipsec') || process.includes('strongswan') || process.includes('charon') || process.includes('racoon');
        }
        if (client === 'dm-crypt') {
            return process.includes('crypt') || process.includes('luks') || sourceKind === 'process';
        }
        if (client === 'fscrypt') {
            return process.includes('fscrypt');
        }
        if (client === 'af_alg') {
            return ['openssl', 'python', 'curl', 'wget'].some((x) => process.includes(x)) || sourceKind === 'connection';
        }
        return true;
    }

    laneMatchesSelectedClients(lane) {
        if (!this.selectedClientFilters.size) return true;
        for (const clientName of this.selectedClientFilters) {
            if (this.laneMatchesClient(clientName, lane)) return true;
        }
        return false;
    }

    laneMatchesSelectedRequester(lane) {
        const req = this.selectedRequesterFilter;
        if (!req) return true;

        const reqName = String(req.name || '').toLowerCase();
        const reqKind = String(req.kind || '').toLowerCase();
        const process = String(lane?.process || '').toLowerCase();
        const protocol = String(lane?.protocol || '').toUpperCase();
        const algo = String(lane?.algorithm || '').toLowerCase();

        if (!this.laneMatchesSelectedAlgorithm(lane)) return false;

        if (reqKind === 'kernel-client') {
            return this.laneMatchesClient(reqName, lane);
        }
        if (reqKind === 'process') {
            return process.includes(reqName);
        }
        return process.includes(reqName) || protocol.toLowerCase().includes(reqName) || algo.includes(reqName);
    }

    drawNode(group, x, y, label, level, intensity, palette, emphasis) {
        const width = Math.min(Math.max(132, String(label).length * 7 + 24), 220);
        const height = 30;
        const radius = 7;
        const lineColor = emphasis ? palette.accent : (intensity > 1.2 ? palette.accent : palette.stroke);
        const fillColor = level === 'crypto' ? '#11161f' : palette.fill;

        group.append('rect')
            .attr('x', x - width / 2)
            .attr('y', y - height / 2)
            .attr('width', width)
            .attr('height', height)
            .attr('rx', radius)
            .style('fill', fillColor)
            .style('stroke', lineColor)
            .style('stroke-width', emphasis ? 1.5 : (intensity > 1.2 ? 1.2 : 0.9))
            .style('opacity', 0.96)
            .style('filter', emphasis || intensity > 1.2 ? 'url(#crypto-line-glow)' : null);

        group.append('text')
            .attr('x', x)
            .attr('y', y)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '10px')
            .style('letter-spacing', '0.35px')
            .style('fill', emphasis ? '#ffffff' : '#eef3fb')
            .text(String(label).toUpperCase());

        return {
            top: { x, y: y - height / 2 },
            bottom: { x, y: y + height / 2 }
        };
    }

    drawPath(group, points, intensity, palette, emphasis) {
        const path = d3.path();
        path.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i += 1) {
            path.lineTo(points[i].x, points[i].y);
        }

        group.append('path')
            .attr('d', path.toString())
            .style('fill', 'none')
            .style('stroke', emphasis ? palette.accent : palette.link)
            .style('stroke-width', emphasis ? 1.6 : (intensity > 1.2 ? 1.25 : 0.9))
            .style('stroke-opacity', emphasis ? 0.98 : 0.88)
            .attr('marker-end', 'url(#crypto-flow-arrow)')
            .style('filter', emphasis || intensity > 1.2 ? 'url(#crypto-line-glow)' : null);
    }

    animatePacket(group, points, intensity, laneId, palette, emphasis) {
        const dot = group.append('circle')
            .attr('r', emphasis ? 3.4 : (intensity > 1.2 ? 3 : 2.2))
            .attr('cx', points[0].x)
            .attr('cy', points[0].y)
            .style('fill', palette.packet)
            .style('opacity', emphasis ? 0.95 : 0.85)
            .style('filter', 'url(#crypto-line-glow)');

        const segmentDuration = Math.max(240, (emphasis ? 360 : 440) - Math.round(intensity * 50));

        const runLoop = () => {
            if (!this.isActive || laneId !== this.activeAnimationTick) {
                dot.remove();
                return;
            }

            let chain = dot.transition().duration(0);
            for (let i = 1; i < points.length; i += 1) {
                chain = chain.duration(segmentDuration)
                    .attr('cx', points[i].x)
                    .attr('cy', points[i].y);
            }

            chain.on('end', () => {
                dot.attr('cx', points[0].x).attr('cy', points[0].y);
                runLoop();
            });
        };

        runLoop();
    }

    animateKeyHypothesisOrbit(group, cx, cy, tickId, direction = 1) {
        const runLoop = () => {
            if (!this.isActive || tickId !== this.activeAnimationTick || this.activeCryptoView !== 'LINEAR_ANALYSIS') {
                return;
            }
            group
                .transition()
                .duration(18000)
                .ease(d3.easeLinear)
                .attrTween('transform', () => {
                    const start = 0;
                    const end = 360 * direction;
                    return (t) => `rotate(${start + (end - start) * t}, ${cx}, ${cy})`;
                })
                .on('end', () => {
                    group.attr('transform', `rotate(0, ${cx}, ${cy})`);
                    runLoop();
                });
        };
        runLoop();
    }

    buildLinearAnalysisModel(payload) {
        const meta = payload?.meta || {};
        const comp = this.getCompetitionPayload(meta);
        const pipeline = this.getDecisionPipelinePayload(meta);
        const request = String(comp.request || this.selectedCompetitionAlgorithm || 'AES').toUpperCase();
        const impls = Array.isArray(comp.implementations) ? comp.implementations : [];
        const lanes = Array.isArray(payload?.items) ? payload.items : [];
        const selectedDriver = String(comp?.selected?.name || pipeline.selected_driver || 'generic');
        const seed = this.hashText(`${request}-${selectedDriver}-${lanes.length}-${impls.length}`);
        const flowWeight = lanes.reduce((sum, lane) => sum + Number(lane.weight || 1), 0);
        const maxPriority = Math.max(...impls.map((impl) => Number(impl.priority || 0)), 1);
        const selectedPriority = Math.max(Number(comp?.selected?.priority || maxPriority), 1);
        const driverQuality = Math.max(0.05, Math.min(1, selectedPriority / maxPriority));
        const trafficPressure = Math.max(0.2, Math.min(1.8, flowWeight / Math.max(1, lanes.length || 1)));
        const baseBias = Math.max(0.003, Math.min(0.078, (1 - driverQuality) * 0.045 + trafficPressure * 0.011 + (seed % 17) / 1000));
        const rounds = request === 'AES' ? 10 : (request === 'SHA' ? 8 : 6);
        const decay = request === 'SHA' ? 0.58 : (request === 'CHACHA20' ? 0.68 : 0.62);
        const bestTrail = Array.from({ length: rounds }, (_, idx) => {
            const round = idx + 1;
            const local = Math.max(0.001, baseBias * Math.pow(decay, idx) * (1 + (((seed >> (idx % 8)) & 3) - 1) * 0.08));
            return {
                round,
                bias: local,
                correlation: Math.min(1, local * 2),
                activeSboxes: Math.max(1, Math.round(2 + round * (request === 'AES' ? 1.35 : 0.9))),
                label: `r${round}: mask ${((seed + round * 37) & 0xff).toString(16).padStart(2, '0')} -> ${((seed + round * 71) & 0xff).toString(16).padStart(2, '0')}`
            };
        });

        return {
            request,
            selectedDriver,
            baseBias,
            maxBias: bestTrail[0]?.bias || baseBias,
            correlationDecay: decay,
            latEnergy: Math.min(100, Math.round((baseBias * 760 + trafficPressure * 9 + impls.length * 2))),
            activeSboxes: bestTrail[bestTrail.length - 1]?.activeSboxes || rounds,
            confidence: Math.min(0.98, 0.54 + driverQuality * 0.26 + Math.min(lanes.length, 8) * 0.025),
            rounds,
            seed,
            bestTrail
        };
    }

    computeAesLive(aes) {
        // Live avalanche for the CURRENT user-selected input difference, computed
        // in the browser with the real AES-128 so bit-flips update instantly.
        if (!aes || !window.AESRef) return null;
        const R = window.AESRef;
        const pt = R.hexToBytes(aes.demo_vectors.plaintext);
        const key = R.hexToBytes(aes.demo_vectors.key);
        if (pt.length !== 16 || key.length !== 16) return null;
        if (!Array.isArray(this.aesInputDiff) || this.aesInputDiff.length !== 16) {
            this.aesInputDiff = new Array(16).fill(0);
            this.aesInputDiff[0] = 0x80; // default: flip MSB of byte 0 (matches backend demo)
        }
        const traceA = R.encryptTrace(pt, key);
        // Self-check against the verified backend ciphertext; degrade gracefully.
        if (R.bytesToHex(traceA.ciphertext) !== String(aes.demo_vectors.ciphertext)) {
            return null;
        }
        const diff = this.aesInputDiff;
        const ptB = pt.map((v, i) => v ^ diff[i]);
        const traceB = R.encryptTrace(ptB, key);
        const rounds = traceA.roundStates.length;
        const grids = [];
        const curve = [];
        for (let r = 0; r < rounds; r += 1) {
            const g = [];
            let h = 0;
            for (let i = 0; i < 16; i += 1) {
                const pc = R.popcount(traceA.roundStates[r][i] ^ traceB.roundStates[r][i]);
                g.push(pc);
                h += pc;
            }
            grids.push(g);
            curve.push(h);
        }
        const flippedBits = diff.reduce((s, v) => s + R.popcount(v), 0);
        return {
            pt, key, diff, traceA, traceB, grids, curve, rounds, flippedBits,
            curvePct: curve.map((h) => Math.round((1000 * h) / 128) / 10)
        };
    }

    toggleAesInputBit(byteIndex) {
        if (!Array.isArray(this.aesInputDiff) || this.aesInputDiff.length !== 16) {
            this.aesInputDiff = new Array(16).fill(0);
        }
        // Toggle the most-significant bit of the clicked byte's difference mask.
        this.aesInputDiff[byteIndex] ^= 0x80;
        if (this.lastPayload) this.renderFlowMap(this.lastPayload);
    }

    resetAesInputDiff() {
        this.aesInputDiff = new Array(16).fill(0);
        this.aesInputDiff[0] = 0x80;
        if (this.lastPayload) this.renderFlowMap(this.lastPayload);
    }

    showTip(lines, event) {
        if (!this.hoverCard) return;
        this.hoverCard.textContent = lines.join('\n');
        this.hoverCard.style.display = 'block';
        this.positionHoverCard(event);
    }

    openAesOpsOverlay(round) {
        this.aesOverlay = 'ops';
        this.aesOpsRound = Math.max(1, Math.min(10, round));
        this.aesOpsClock = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        this.renderAesOpsOverlay();
    }

    closeAesOpsOverlay() {
        this.aesOverlay = null;
        this.aesOpsRound = null;
        if (this.svg) this.svg.selectAll('.aes-ops-overlay').remove();
        if (this._aesOpsRaf) {
            cancelAnimationFrame(this._aesOpsRaf);
            this._aesOpsRaf = null;
        }
    }

    _aesOverlayShell(titleText, subtitleText) {
        // Shared modal shell used by the key-schedule and mode overlays.
        const width = window.innerWidth;
        const height = window.innerHeight;
        this.svg.selectAll('.aes-ops-overlay').remove();
        const ov = this.svg.append('g').attr('class', 'aes-ops-overlay').style('cursor', 'default');
        ov.append('rect').attr('x', 0).attr('y', 0).attr('width', width).attr('height', height)
            .style('fill', 'rgba(4, 7, 12, 0.72)').style('cursor', 'pointer')
            .on('click', () => this.closeAesOpsOverlay());
        const panelW = Math.min(1180, Math.max(680, width * 0.82));
        const panelH = Math.min(560, Math.max(380, height * 0.66));
        const px = (width - panelW) / 2;
        const py = (height - panelH) / 2;
        const box = ov.append('g');
        box.append('rect').attr('x', px).attr('y', py).attr('width', panelW).attr('height', panelH).attr('rx', 10)
            .style('fill', 'rgba(6, 10, 16, 0.96)').style('stroke', 'rgba(150, 180, 220, 0.5)').style('stroke-width', 1.2);
        box.append('text').attr('x', px + 22).attr('y', py + 30)
            .style('font-family', 'Share Tech Mono, monospace').style('font-size', '14px')
            .style('letter-spacing', '0.6px').style('fill', '#e6edf8').text(titleText);
        box.append('text').attr('x', px + 22).attr('y', py + 48)
            .style('font-family', 'Share Tech Mono, monospace').style('font-size', '9.5px')
            .style('fill', '#8fa0b8').text(subtitleText);
        const closeG = box.append('g').style('cursor', 'pointer').on('click', () => this.closeAesOpsOverlay());
        closeG.append('circle').attr('cx', px + panelW - 24).attr('cy', py + 24).attr('r', 11)
            .style('fill', 'rgba(255,120,90,0.14)').style('stroke', 'rgba(255,140,110,0.6)');
        closeG.append('text').attr('x', px + panelW - 24).attr('y', py + 28).attr('text-anchor', 'middle')
            .style('font-family', 'Share Tech Mono, monospace').style('font-size', '12px').style('fill', '#ffb59a').text('x');
        return { box, px, py, panelW, panelH };
    }

    openKeyScheduleOverlay(pinWord = null) {
        this.aesOverlay = 'keysched';
        // When opened from an AddRoundKey ⊕XX tag, pin the highlight to that word
        // (and its two parents) instead of running the auto-sweep.
        this._aesKeySchedPin = (Number.isInteger(pinWord) && pinWord >= 0 && pinWord < 44) ? pinWord : null;
        this.aesOpsClock = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        this.renderKeyScheduleOverlay();
    }

    renderKeyScheduleOverlay() {
        if (!this.svg || this.aesOverlay !== 'keysched' || !this.aesDemo || !window.AESRef) return;
        const R = window.AESRef;
        const key = R.hexToBytes(this.aesDemo.demo_vectors.key);
        if (key.length !== 16) return;

        // Recompute the 44 words exactly as the key schedule does, capturing the
        // RotWord / SubWord / Rcon derivation for every 4th word.
        const words = [];
        const derivations = [];
        for (let i = 0; i < 4; i += 1) words.push([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]);
        for (let i = 4; i < 44; i += 1) {
            const prev = words[i - 1].slice();
            let t = prev.slice();
            let rot = null; let sub = null; let rcon = null;
            if (i % 4 === 0) {
                rot = [t[1], t[2], t[3], t[0]];
                sub = rot.map((b) => R.SBOX[b]);
                rcon = R.RCON[i / 4 - 1];
                t = sub.slice();
                t[0] ^= rcon;
            }
            const w = words[i - 4].map((v, j) => v ^ t[j]);
            words.push(w);
            derivations.push({ i, prev, rot, sub, rcon, base: words[i - 4], out: w, special: i % 4 === 0 });
        }

        const pin = Number.isInteger(this._aesKeySchedPin) ? this._aesKeySchedPin : null;
        const shell = this._aesOverlayShell(
            'AES-128 KEY SCHEDULE · 16-BYTE KEY -> 11 ROUND KEYS (44 WORDS)',
            pin !== null
                ? `linked from AddRoundKey: word w${pin} = K${Math.floor(pin / 4)}[col ${pin % 4}] · shown with its parents w${pin - 4} and w${pin - 1} · click grid to resume sweep`
                : 'each word = word[i-4] XOR word[i-1]; every 4th word first passes RotWord -> SubWord -> XOR Rcon (highlighted)'
        );
        const { box, px, py, panelW, panelH } = shell;
        const gridTop = py + 66;
        const gridH = panelH - 150;
        const colW = (panelW - 44) / 11;      // 11 round keys
        const wordH = gridH / 4;              // 4 words per round key
        const cellW = colW / 4;               // 4 bytes per word

        this._aesKeySchedGeom = { words, derivations, box, px, py, panelW, gridTop, colW, wordH, cellW };

        // Column (round-key) headers.
        for (let rk = 0; rk < 11; rk += 1) {
            box.append('text').attr('x', px + 22 + rk * colW + colW / 2).attr('y', gridTop - 8).attr('text-anchor', 'middle')
                .style('font-family', 'Share Tech Mono, monospace').style('font-size', '8px')
                .style('fill', rk === 0 ? '#ffcf9a' : '#8fa0b8').text(rk === 0 ? 'KEY' : `K${rk}`);
        }

        const wordCells = [];
        for (let wi = 0; wi < 44; wi += 1) {
            const rk = Math.floor(wi / 4);
            const wr = wi % 4;
            const wx = px + 22 + rk * colW;
            const wy = gridTop + wr * wordH;
            const isSpecial = wi >= 4 && wi % 4 === 0;
            const cells = [];
            for (let bidx = 0; bidx < 4; bidx += 1) {
                const rect = box.append('rect')
                    .attr('x', wx + bidx * cellW + 1).attr('y', wy + 1)
                    .attr('width', cellW - 2).attr('height', wordH - 3).attr('rx', 2)
                    .style('fill', 'rgba(20,30,45,0.7)')
                    .style('stroke', isSpecial ? 'rgba(255,170,110,0.5)' : 'rgba(140,165,200,0.22)')
                    .style('stroke-width', isSpecial ? 0.9 : 0.6);
                const label = box.append('text')
                    .attr('x', wx + bidx * cellW + cellW / 2).attr('y', wy + wordH / 2 + 2).attr('text-anchor', 'middle')
                    .style('font-family', 'Share Tech Mono, monospace')
                    .style('font-size', `${Math.max(6, Math.min(9, cellW * 0.32))}px`)
                    .style('fill', '#dbe6f5').style('pointer-events', 'none')
                    .text((words[wi][bidx] & 0xff).toString(16).padStart(2, '0'));
                cells.push({ rect, label, val: words[wi][bidx] & 0xff });
            }
            // Per-word click target: pin/inspect this word (click the pinned word to resume sweep).
            box.append('rect')
                .attr('x', wx + 1).attr('y', wy + 1).attr('width', colW - 2).attr('height', wordH - 3)
                .style('fill', 'transparent').style('cursor', 'pointer')
                .on('click', () => this.openKeyScheduleOverlay(this._aesKeySchedPin === wi ? null : wi));
            wordCells.push({ wi, cells, isSpecial });
        }
        this._aesKeySchedCells = wordCells;

        // Derivation caption area (updates with the animated cursor).
        this._aesKeySchedCaption = box.append('text')
            .attr('x', px + 22).attr('y', py + panelH - 22)
            .style('font-family', 'Share Tech Mono, monospace').style('font-size', '9px')
            .style('fill', '#a9c2e6').text('');

        this._startKeySchedAnim();
    }

    _startKeySchedAnim() {
        if (this._aesOpsRaf) cancelAnimationFrame(this._aesOpsRaf);
        const cells = this._aesKeySchedCells;
        const geom = this._aesKeySchedGeom;
        if (!cells || !geom) return;
        const stepMs = 320;
        const frame = () => {
            if (this.aesOverlay !== 'keysched' || !this.svg || this.svg.selectAll('.aes-ops-overlay').empty()) {
                this._aesOpsRaf = null;
                return;
            }
            const now = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
            const elapsed = now - (this.aesOpsClock || now);
            // A cursor sweeps word by word (4..43); when pinned it freezes on the
            // linked word so its derivation stays visible.
            const pin = Number.isInteger(this._aesKeySchedPin) ? this._aesKeySchedPin : null;
            const cursor = pin !== null ? pin : (4 + Math.floor(elapsed / stepMs) % 40);
            const parents = pin !== null ? new Set([pin - 4, pin - 1]) : new Set();
            cells.forEach((wc) => {
                const isCursor = wc.wi === cursor;
                const isParent = parents.has(wc.wi);
                const revealed = pin !== null ? true : (wc.wi <= cursor || wc.wi < 4);
                wc.cells.forEach((c) => {
                    c.rect.style('opacity', revealed ? 1 : 0.18);
                    c.label.style('opacity', revealed ? 1 : (pin !== null ? 0.5 : 0.18));
                    if (isCursor) {
                        const pulse = 0.5 + 0.5 * Math.sin(elapsed * 0.012);
                        c.rect.style('fill', wc.isSpecial ? 'rgba(255,150,90,0.5)' : 'rgba(90,130,190,0.5)')
                            .style('stroke', wc.isSpecial ? '#ff9a55' : '#8fdcff').style('stroke-width', 1.4 + pulse);
                    } else if (isParent) {
                        c.rect.style('fill', 'rgba(90,180,140,0.35)')
                            .style('stroke', '#8effc8').style('stroke-width', 1.2);
                    } else {
                        c.rect.style('fill', wc.wi < 4 ? 'rgba(60,50,30,0.55)' : 'rgba(20,30,45,0.7)')
                            .style('stroke', wc.isSpecial ? 'rgba(255,170,110,0.5)' : 'rgba(140,165,200,0.22)')
                            .style('stroke-width', wc.isSpecial ? 0.9 : 0.6);
                        if (pin !== null && revealed) c.rect.style('opacity', 0.4);
                    }
                });
            });
            const der = geom.derivations[cursor - 4];
            if (der && this._aesKeySchedCaption) {
                const hex = (arr) => arr.map((b) => (b & 0xff).toString(16).padStart(2, '0')).join(' ');
                if (der.special) {
                    this._aesKeySchedCaption.style('fill', '#ffcf9a').text(
                        `w${der.i}: RotWord(${hex(der.prev)})=${hex(der.rot)} · SubWord=${hex(der.sub)} · XOR Rcon(${der.rcon.toString(16).padStart(2, '0')}) · XOR w${der.i - 4}(${hex(der.base)}) = ${hex(der.out)}`
                    );
                } else {
                    this._aesKeySchedCaption.style('fill', '#a9c2e6').text(
                        `w${der.i} = w${der.i - 4}(${hex(der.base)}) XOR w${der.i - 1}(${hex(der.prev)}) = ${hex(der.out)}`
                    );
                }
            }
            this._aesOpsRaf = requestAnimationFrame(frame);
        };
        this._aesOpsRaf = requestAnimationFrame(frame);
    }

    openModeOverlay(mode) {
        this.aesOverlay = 'mode';
        this.aesModeKind = mode || 'CTR';
        this.aesOpsClock = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        this.renderModeOverlay();
    }

    renderModeOverlay() {
        if (!this.svg || this.aesOverlay !== 'mode' || !this.aesDemo || !window.AESRef) return;
        const R = window.AESRef;
        const key = R.hexToBytes(this.aesDemo.demo_vectors.key);
        if (key.length !== 16) return;
        const isGcm = this.aesModeKind === 'GCM';

        const shell = this._aesOverlayShell(
            isGcm ? 'AES-GCM · COUNTER MODE + GHASH AUTHENTICATION' : 'AES-CTR · BLOCK CIPHER -> KEYSTREAM',
            isGcm
                ? 'AES encrypts counter blocks -> keystream XOR plaintext; ciphertext + AAD feed GHASH -> authentication tag'
                : 'AES encrypts an incrementing counter to make a keystream; keystream XOR plaintext = ciphertext (a stream cipher)'
        );
        const { box, px, py, panelW, panelH } = shell;

        // Mode switch buttons inside the overlay.
        [['CTR', px + panelW - 210], ['GCM', px + panelW - 150]].forEach(([m, bx]) => {
            const on = (m === this.aesModeKind);
            const g = box.append('g').style('cursor', 'pointer').on('click', () => this.openModeOverlay(m));
            g.append('rect').attr('x', bx).attr('y', py + 14).attr('width', 52).attr('height', 20).attr('rx', 4)
                .style('fill', on ? 'rgba(38,63,98,0.95)' : 'rgba(7,11,17,0.82)')
                .style('stroke', on ? 'rgba(128,190,255,0.86)' : 'rgba(122,145,176,0.32)');
            g.append('text').attr('x', bx + 26).attr('y', py + 28).attr('text-anchor', 'middle')
                .style('font-family', 'Share Tech Mono, monospace').style('font-size', '9px')
                .style('fill', on ? '#d8eaff' : '#9dafc5').text(m);
        });

        // Build N counter blocks: nonce(12) || counter(4). Encrypt each with real AES.
        const nBlocks = 4;
        const nonce = R.hexToBytes('00112233445566778899aabb');
        const laneY = py + 92;
        // Reserve room at the bottom for the real GHASH accumulation chain (GCM).
        const ghashReserve = isGcm ? 132 : 34;
        const laneH = (py + panelH - 26 - ghashReserve - laneY) / nBlocks;
        const colCtr = px + 40;
        const colCipher = px + 40 + (panelW - 80) * 0.20;
        const colKs = px + 40 + (panelW - 80) * 0.52;
        const colPt = px + 40 + (panelW - 80) * 0.72;
        const colOut = px + 40 + (panelW - 80) * 0.9;

        box.append('text').attr('x', colCtr).attr('y', laneY - 12).style('font-family', 'Share Tech Mono, monospace').style('font-size', '8px').style('fill', '#8fdcff').text('COUNTER BLOCK');
        box.append('text').attr('x', colCipher).attr('y', laneY - 12).style('font-family', 'Share Tech Mono, monospace').style('font-size', '8px').style('fill', '#c9b6ff').text('AES_K( · )');
        box.append('text').attr('x', colKs).attr('y', laneY - 12).style('font-family', 'Share Tech Mono, monospace').style('font-size', '8px').style('fill', '#ff9a55').text('KEYSTREAM');
        box.append('text').attr('x', colPt).attr('y', laneY - 12).style('font-family', 'Share Tech Mono, monospace').style('font-size', '8px').style('fill', '#9fb1c8').text('⊕ PLAINTEXT');
        box.append('text').attr('x', colOut).attr('y', laneY - 12).style('font-family', 'Share Tech Mono, monospace').style('font-size', '8px').style('fill', '#8effc8').text('= CIPHERTEXT');

        const lanes = [];
        for (let b = 0; b < nBlocks; b += 1) {
            const ctr = nonce.concat([0, 0, 0, b + 1]);
            const ks = R.encryptTrace(ctr, key).ciphertext;
            const pt = [];
            for (let i = 0; i < 16; i += 1) pt.push((0x40 + b * 16 + i) & 0xff);
            const ct = ks.map((v, i) => v ^ pt[i]);
            const y = laneY + b * laneH + laneH / 2;
            const chip = (x, bytes, color, w) => {
                const g = box.append('g');
                g.append('rect').attr('x', x).attr('y', y - 9).attr('width', w).attr('height', 18).attr('rx', 3)
                    .style('fill', 'rgba(14,20,30,0.9)').style('stroke', color).style('stroke-width', 0.8);
                const t = g.append('text').attr('x', x + w / 2).attr('y', y + 3).attr('text-anchor', 'middle')
                    .style('font-family', 'Share Tech Mono, monospace').style('font-size', '7px').style('fill', color)
                    .text(bytes.slice(0, 4).map((v) => (v & 0xff).toString(16).padStart(2, '0')).join('') + '…');
                return { g, rect: g.select('rect'), text: t };
            };
            const ctrChip = chip(colCtr, ctr, '#8fdcff', (panelW - 80) * 0.17);
            const ksChip = chip(colKs, ks, '#ff9a55', (panelW - 80) * 0.17);
            const ptChip = chip(colPt, pt, '#9fb1c8', (panelW - 80) * 0.15);
            const outChip = chip(colOut, ct, '#8effc8', (panelW - 80) * 0.1);
            box.append('text').attr('x', colCipher + (panelW - 80) * 0.06).attr('y', y + 3).attr('text-anchor', 'middle')
                .style('font-family', 'Share Tech Mono, monospace').style('font-size', '11px').style('fill', '#c9b6ff').text('AES');
            box.append('text').attr('x', colKs - 10).attr('y', y + 3).attr('text-anchor', 'middle').style('fill', '#6f8296').style('font-size', '10px').text('→');
            box.append('text').attr('x', colOut - 8).attr('y', y + 3).attr('text-anchor', 'middle').style('fill', '#6f8296').style('font-size', '10px').text('=');
            lanes.push({ b, y, ct, ctrChip, ksChip, ptChip, outChip });
        }

        // Real GHASH authentication (GCM only): H = AES_K(0^128); the tag folds
        // AAD, every ciphertext block and a length block through GF(2^128), then
        // masks with AES_K(J0). All arithmetic is the genuine NIST SP 800-38D GHASH.
        this._aesGhash = null;
        if (isGcm) {
            const H = R.encryptTrace(new Array(16).fill(0), key).ciphertext;
            const aad = R.hexToBytes('6b65726e656c2d61693a67636d2001'); // "kernel-ai:gcm " + 0x01 (15 bytes)
            while (aad.length < 16) aad.push(0);
            const cBlocks = lanes.map((ln) => ln.ct);
            const lenBlock = R.be64(16 * 8).concat(R.be64(cBlocks.length * 16 * 8)); // len(A) || len(C) in bits
            const absorbed = [{ label: 'AAD', block: aad, kind: 'aad' }]
                .concat(cBlocks.map((blk, i) => ({ label: `C${i + 1}`, block: blk, kind: 'ct' })))
                .concat([{ label: 'LEN', block: lenBlock, kind: 'len' }]);
            const yStates = R.ghashSteps(H, absorbed.map((a) => a.block)); // Y0..Y6
            const S = yStates[yStates.length - 1];
            const ekj0 = R.encryptTrace(nonce.concat([0, 0, 0, 1]), key).ciphertext; // AES_K(J0)
            const tag = S.map((v, j) => v ^ ekj0[j]);

            const gTop = py + panelH - ghashReserve + 4;
            const hex = (b, n = 16) => b.slice(0, n).map((v) => (v & 0xff).toString(16).padStart(2, '0')).join('');
            box.append('text').attr('x', px + 22).attr('y', gTop + 2)
                .style('font-family', 'Share Tech Mono, monospace').style('font-size', '9px').style('fill', '#d9c2ff')
                .text(`GHASH over GF(2^128) · H = AES_K(0) = ${hex(H, 8)}… · Y_i = (Y_{i-1} ⊕ block_i) · H`);

            // Accumulation chain: Y0 -> (⊕AAD ×H) -> Y1 -> ... -> S -> (⊕ E(J0)) -> TAG
            const chainY = gTop + 34;
            const nSteps = absorbed.length;
            const usableW = panelW - 44;
            const stepW = usableW / (nSteps + 1);
            const nodeW = Math.min(stepW - 10, 86);
            const stepNodes = [];
            const yColor = '#c9b6ff';
            const drawChip = (cx, label, valHex, color, sub) => {
                const g = box.append('g');
                g.append('rect').attr('x', cx - nodeW / 2).attr('y', chainY - 12).attr('width', nodeW).attr('height', 24).attr('rx', 3)
                    .style('fill', 'rgba(14,20,30,0.92)').style('stroke', color).style('stroke-width', 0.9);
                g.append('text').attr('x', cx).attr('y', chainY - 2).attr('text-anchor', 'middle')
                    .style('font-family', 'Share Tech Mono, monospace').style('font-size', '7px').style('fill', color).text(label);
                g.append('text').attr('x', cx).attr('y', chainY + 8).attr('text-anchor', 'middle')
                    .style('font-family', 'Share Tech Mono, monospace').style('font-size', '6.5px').style('fill', '#9fb1c8').text(valHex + '…');
                if (sub) {
                    g.append('text').attr('x', cx).attr('y', chainY + 22).attr('text-anchor', 'middle')
                        .style('font-family', 'Share Tech Mono, monospace').style('font-size', '6px').style('fill', color).text(sub);
                }
                return g;
            };
            // Y0 node
            let prevX = px + 22 + stepW * 0.5;
            drawChip(prevX, 'Y0 = 0', hex(yStates[0], 6), '#6f8296');
            for (let s = 0; s < nSteps; s += 1) {
                const cx = px + 22 + stepW * (s + 1.5);
                // transition annotation
                box.append('text').attr('x', (prevX + cx) / 2).attr('y', chainY - 16).attr('text-anchor', 'middle')
                    .style('font-family', 'Share Tech Mono, monospace').style('font-size', '6.5px').style('fill', '#8fa0b8')
                    .text(`⊕${absorbed[s].label} ×H`);
                box.append('text').attr('x', (prevX + cx) / 2).attr('y', chainY + 4).attr('text-anchor', 'middle')
                    .style('fill', '#5f6f82').style('font-size', '9px').text('→');
                const isLast = s === nSteps - 1;
                const g = drawChip(cx, isLast ? 'S (Σ)' : `Y${s + 1}`, hex(yStates[s + 1], 6), yColor);
                stepNodes.push({ g, rect: g.select('rect'), step: s });
                prevX = cx;
            }
            // Tag node
            const tagX = Math.min(px + panelW - 24 - nodeW / 2, prevX + stepW);
            box.append('text').attr('x', (prevX + tagX) / 2).attr('y', chainY - 16).attr('text-anchor', 'middle')
                .style('font-family', 'Share Tech Mono, monospace').style('font-size', '6.5px').style('fill', '#ffcf9a')
                .text('⊕ E(J0)');
            const tagG = drawChip(tagX, 'TAG', hex(tag, 8), '#8effc8', '128-bit auth');
            tagG.select('rect').style('stroke-width', 1.4).style('fill', 'rgba(20,40,32,0.92)');

            this._aesGhash = { stepNodes, tagRect: tagG.select('rect'), nSteps };
        }

        this._aesModeLanes = lanes;
        this._startModeAnim();
    }

    _startModeAnim() {
        if (this._aesOpsRaf) cancelAnimationFrame(this._aesOpsRaf);
        const lanes = this._aesModeLanes;
        if (!lanes) return;
        const stepMs = 900;
        const frame = () => {
            if (this.aesOverlay !== 'mode' || !this.svg || this.svg.selectAll('.aes-ops-overlay').empty()) {
                this._aesOpsRaf = null;
                return;
            }
            const now = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
            const elapsed = now - (this.aesOpsClock || now);
            const active = Math.floor(elapsed / stepMs) % lanes.length;
            lanes.forEach((ln) => {
                const on = ln.b === active;
                const pulse = 0.6 + 0.4 * Math.sin(elapsed * 0.01);
                [ln.ctrChip, ln.ksChip, ln.ptChip, ln.outChip].forEach((ch) => {
                    ch.rect.style('stroke-width', on ? 1.6 : 0.8).style('opacity', on ? 1 : 0.55);
                });
                ln.ksChip.rect.style('filter', on ? 'url(#crypto-line-glow)' : null).style('stroke-opacity', on ? pulse : 0.6);
            });
            // Walk the GHASH accumulation chain (GCM): highlight each block being
            // absorbed in turn, then flash the final tag.
            const gh = this._aesGhash;
            if (gh && gh.stepNodes) {
                const total = gh.nSteps + 1; // +1 for the tag flash
                const ghActive = Math.floor(elapsed / 700) % total;
                const pulse = 0.6 + 0.4 * Math.sin(elapsed * 0.012);
                gh.stepNodes.forEach((n) => {
                    const on = n.step === ghActive;
                    const done = n.step < ghActive;
                    n.rect.style('stroke-width', on ? 1.8 : 0.9)
                        .style('opacity', on ? 1 : (done ? 0.9 : 0.4))
                        .style('filter', on ? 'url(#crypto-line-glow)' : null)
                        .style('stroke-opacity', on ? pulse : 0.7);
                });
                const tagOn = ghActive === gh.nSteps;
                gh.tagRect.style('filter', tagOn ? 'url(#crypto-line-glow)' : null)
                    .style('stroke-width', tagOn ? 2 : 1.4)
                    .style('stroke-opacity', tagOn ? pulse : 1);
            }
            this._aesOpsRaf = requestAnimationFrame(frame);
        };
        this._aesOpsRaf = requestAnimationFrame(frame);
    }

    renderAesOpsOverlay() {
        if (!this.svg || !this.aesOpsRound || !this.aesDemo || !window.AESRef) return;
        const R = window.AESRef;
        const aes = this.aesDemo;
        const pt = R.hexToBytes(aes.demo_vectors.plaintext);
        const key = R.hexToBytes(aes.demo_vectors.key);
        const trace = R.encryptTrace(pt, key);
        const round = Math.max(1, Math.min(10, this.aesOpsRound));
        const op = trace.ops[round - 1];
        if (!op) return;

        const width = window.innerWidth;
        const height = window.innerHeight;

        // Stages of one AES round, each transforming a 4x4 state.
        const stages = [
            { key: 'SubBytes', from: op.input, to: op.subBytes, accent: '#ff9a55',
              note: 'byte substitution via S-box (confusion)' },
            { key: 'ShiftRows', from: op.subBytes, to: op.shiftRows, accent: '#8fdcff',
              note: 'cyclic row shifts (inter-column diffusion)' }
        ];
        if (op.hasMix) {
            stages.push({ key: 'MixColumns', from: op.shiftRows, to: op.mixColumns, accent: '#c9b6ff',
                note: 'GF(2^8) column mixing (intra-column diffusion)' });
        }
        stages.push({ key: 'AddRoundKey', from: op.hasMix ? op.mixColumns : op.shiftRows, to: op.addRoundKey,
            accent: '#8effc8', note: 'XOR with round key (key mixing)' });

        this.svg.selectAll('.aes-ops-overlay').remove();
        const ov = this.svg.append('g').attr('class', 'aes-ops-overlay').style('cursor', 'default');

        // Scrim (click to close).
        ov.append('rect')
            .attr('x', 0).attr('y', 0).attr('width', width).attr('height', height)
            .style('fill', 'rgba(4, 7, 12, 0.72)')
            .style('cursor', 'pointer')
            .on('click', () => this.closeAesOpsOverlay());

        const panelW = Math.min(1120, Math.max(640, width * 0.78));
        const panelH = Math.min(520, Math.max(360, height * 0.62));
        const px = (width - panelW) / 2;
        const py = (height - panelH) / 2;
        const box = ov.append('g');
        box.append('rect')
            .attr('x', px).attr('y', py).attr('width', panelW).attr('height', panelH).attr('rx', 10)
            .style('fill', 'rgba(6, 10, 16, 0.96)')
            .style('stroke', 'rgba(150, 180, 220, 0.5)')
            .style('stroke-width', 1.2);
        box.append('rect')
            .attr('x', px).attr('y', py).attr('width', panelW).attr('height', panelH).attr('rx', 10)
            .style('fill', 'none').style('pointer-events', 'none');

        box.append('text').attr('x', px + 22).attr('y', py + 30)
            .style('font-family', 'Share Tech Mono, monospace').style('font-size', '14px')
            .style('letter-spacing', '0.6px').style('fill', '#e6edf8')
            .text(`AES-128 · ROUND ${round} OF 10 · OPERATION LAYERS`);
        box.append('text').attr('x', px + 22).attr('y', py + 48)
            .style('font-family', 'Share Tech Mono, monospace').style('font-size', '9.5px')
            .style('fill', '#8fa0b8')
            .text('hover a SubBytes cell to see the S-box lookup · use < / > or the pips to step rounds · click backdrop to close');

        // Round navigation: prev / next arrows.
        const navArrow = (cxp, label, target) => {
            const enabled = target >= 1 && target <= 10;
            const g = box.append('g').style('cursor', enabled ? 'pointer' : 'default')
                .on('click', enabled ? () => this.openAesOpsOverlay(target) : null);
            g.append('circle').attr('cx', cxp).attr('cy', py + 24).attr('r', 11)
                .style('fill', enabled ? 'rgba(90,130,180,0.18)' : 'rgba(60,70,85,0.12)')
                .style('stroke', enabled ? 'rgba(140,180,230,0.6)' : 'rgba(110,125,145,0.3)');
            g.append('text').attr('x', cxp).attr('y', py + 28).attr('text-anchor', 'middle')
                .style('font-family', 'Share Tech Mono, monospace').style('font-size', '12px')
                .style('fill', enabled ? '#cfe1f7' : '#5f6b7d').text(label);
            return g;
        };
        navArrow(px + panelW - 96, '<', round - 1);
        navArrow(px + panelW - 68, '>', round + 1);

        // Close affordance.
        const closeG = box.append('g').style('cursor', 'pointer').on('click', () => this.closeAesOpsOverlay());
        closeG.append('circle').attr('cx', px + panelW - 24).attr('cy', py + 24).attr('r', 11)
            .style('fill', 'rgba(255,120,90,0.14)').style('stroke', 'rgba(255,140,110,0.6)');
        closeG.append('text').attr('x', px + panelW - 24).attr('y', py + 28).attr('text-anchor', 'middle')
            .style('font-family', 'Share Tech Mono, monospace').style('font-size', '12px').style('fill', '#ffb59a').text('x');

        // Round pips: jump to any of the 10 rounds.
        const pipsG = box.append('g');
        const pipW = 15;
        const pipsTotalW = pipW * 10;
        const pipStartX = px + panelW - 130 - pipsTotalW;
        for (let r = 1; r <= 10; r += 1) {
            const isCur = r === round;
            const pg = pipsG.append('g').style('cursor', 'pointer').on('click', () => this.openAesOpsOverlay(r));
            pg.append('rect').attr('x', pipStartX + (r - 1) * pipW).attr('y', py + 18).attr('width', pipW - 3).attr('height', 12).attr('rx', 2)
                .style('fill', isCur ? 'rgba(143,220,255,0.9)' : 'rgba(120,145,180,0.22)')
                .style('stroke', isCur ? '#8fdcff' : 'rgba(140,165,200,0.35)').style('stroke-width', 0.7);
            pg.append('text').attr('x', pipStartX + (r - 1) * pipW + (pipW - 3) / 2).attr('y', py + 27).attr('text-anchor', 'middle')
                .style('font-family', 'Share Tech Mono, monospace').style('font-size', '7px')
                .style('fill', isCur ? '#06121f' : '#9fb1c8').style('pointer-events', 'none').text(r);
        }

        const nStages = stages.length;
        const contentY = py + 74;
        const contentH = panelH - 118;
        const colGap = 18;
        const colW = (panelW - 44 - colGap * (nStages - 1)) / nStages;
        const gridCells = 4;
        const cellSize = Math.min((colW - 28) / gridCells, (contentH - 60) / gridCells);
        const gridW = cellSize * gridCells;

        // Precompute per-stage geometry and store for the animation loop.
        const stageGeom = stages.map((st, si) => {
            const cx0 = px + 22 + si * (colW + colGap);
            const gx = cx0 + (colW - gridW) / 2;
            const gy = contentY + 30;
            return { st, si, cx0, gx, gy };
        });

        const cellCenter = (gx, gy, col, row) => ({
            x: gx + col * cellSize + cellSize / 2,
            y: gy + row * cellSize + cellSize / 2
        });

        stageGeom.forEach((sg) => {
            const { st, cx0, gx, gy } = sg;
            box.append('text').attr('x', cx0 + colW / 2).attr('y', contentY + 12).attr('text-anchor', 'middle')
                .style('font-family', 'Share Tech Mono, monospace').style('font-size', '11px')
                .style('fill', st.accent).text(st.key);
            box.append('text').attr('x', cx0 + colW / 2).attr('y', gy + gridW + 26).attr('text-anchor', 'middle')
                .style('font-family', 'Share Tech Mono, monospace').style('font-size', '8px')
                .style('fill', '#7f90a6').text(st.note);
            // Cells (16 bytes). Column-major AES index = row + 4*col.
            const cells = [];
            for (let col = 0; col < 4; col += 1) {
                for (let row = 0; row < 4; row += 1) {
                    const idx = row + 4 * col;
                    const cellG = box.append('g');
                    const rect = cellG.append('rect')
                        .attr('x', gx + col * cellSize + 1.5).attr('y', gy + row * cellSize + 1.5)
                        .attr('width', cellSize - 3).attr('height', cellSize - 3).attr('rx', 3)
                        .style('stroke', 'rgba(140,165,200,0.28)').style('stroke-width', 0.7);
                    const label = cellG.append('text')
                        .attr('x', gx + col * cellSize + cellSize / 2).attr('y', gy + row * cellSize + cellSize / 2 + 3)
                        .attr('text-anchor', 'middle')
                        .style('font-family', 'Share Tech Mono, monospace')
                        .style('font-size', `${Math.max(7, Math.min(11, cellSize * 0.3))}px`)
                        .style('fill', '#dbe6f5').style('pointer-events', 'none');
                    cells.push({ idx, col, row, rect, label });
                }
            }
            sg.cells = cells;

            // Per-operation decoration layer (modulated by the animation loop).
            const decor = box.append('g').style('opacity', 0.35);
            sg.decor = decor;

            if (st.key === 'ShiftRows') {
                // Each row r is cyclically shifted left by r bytes.
                for (let row = 1; row < 4; row += 1) {
                    const yc = gy + row * cellSize + cellSize / 2;
                    const xEnd = gx + gridW - cellSize * 0.3;
                    const xStart = xEnd - row * cellSize;
                    decor.append('line').attr('x1', xEnd).attr('y1', yc).attr('x2', xStart).attr('y2', yc)
                        .style('stroke', st.accent).style('stroke-width', 1.4);
                    decor.append('path')
                        .attr('d', `M${xStart + 6},${yc - 4} L${xStart},${yc} L${xStart + 6},${yc + 4}`)
                        .style('fill', 'none').style('stroke', st.accent).style('stroke-width', 1.4);
                    decor.append('text').attr('x', xEnd + 4).attr('y', yc + 3)
                        .style('font-family', 'Share Tech Mono, monospace').style('font-size', '8px')
                        .style('fill', st.accent).text(`«${row}`);
                }
            } else if (st.key === 'MixColumns') {
                // Every output byte in a column depends on all 4 input bytes of that column.
                for (let col = 0; col < 4; col += 1) {
                    const xc = gx + col * cellSize + cellSize / 2;
                    decor.append('line').attr('x1', xc).attr('y1', gy + cellSize * 0.35).attr('x2', xc).attr('y2', gy + gridW - cellSize * 0.35)
                        .style('stroke', st.accent).style('stroke-width', 1.2).style('stroke-dasharray', '3,2');
                    for (let row = 0; row < 4; row += 1) {
                        const cc = cellCenter(gx, gy, col, row);
                        decor.append('circle').attr('cx', xc).attr('cy', cc.y).attr('r', 2.2).style('fill', st.accent);
                    }
                }
                decor.append('text').attr('x', gx + gridW / 2).attr('y', gy - 4).attr('text-anchor', 'middle')
                    .style('font-family', 'Share Tech Mono, monospace').style('font-size', '7.5px')
                    .style('fill', st.accent).text('× [2 3 1 1] per column');
            } else if (st.key === 'AddRoundKey' && op.roundKey) {
                // Show the round-key byte XORed into each cell (corner tag). Each
                // column corresponds to key-schedule word (4*round + col) — click a
                // cell to open the key schedule with that word pinned.
                for (let col = 0; col < 4; col += 1) {
                    const linkedWord = 4 * round + col;
                    for (let row = 0; row < 4; row += 1) {
                        const idx = row + 4 * col;
                        decor.append('text')
                            .attr('x', gx + col * cellSize + 4).attr('y', gy + row * cellSize + 11)
                            .style('font-family', 'Share Tech Mono, monospace').style('font-size', '6.5px')
                            .style('fill', st.accent).style('pointer-events', 'none')
                            .text(`⊕${(op.roundKey[idx] & 0xff).toString(16).padStart(2, '0')}`);
                    }
                    // Column-wide click target -> key schedule word for this column.
                    box.append('rect')
                        .attr('x', gx + col * cellSize + 1.5).attr('y', gy + 1.5)
                        .attr('width', cellSize - 3).attr('height', cellSize * 4 - 3)
                        .style('fill', 'transparent').style('cursor', 'pointer')
                        .on('click', () => this.openKeyScheduleOverlay(linkedWord))
                        .on('mouseenter', (event) => this.showTip([
                            `AddRoundKey column ${col}`,
                            `round key K${round} = key-schedule words w${4 * round}..w${4 * round + 3}`,
                            `this column XORs word w${linkedWord}`,
                            `click -> open key schedule (word pinned)`
                        ], event))
                        .on('mouseleave', () => this.hideHoverCard());
                }
            }

            // S-box hover exploration on the SubBytes stage.
            if (st.key === 'SubBytes') {
                sg.cells.forEach((c) => {
                    const inV = op.input[c.idx] & 0xff;
                    const outV = window.AESRef.SBOX[inV] & 0xff;
                    c.rect.style('cursor', 'help')
                        .on('mouseenter', (event) => {
                            c.rect.style('stroke', '#ffffff').style('stroke-width', 1.4);
                            this.showTip([
                                `S-box lookup (SubBytes)`,
                                `in  : 0x${inV.toString(16).padStart(2, '0')}  (row ${(inV >> 4).toString(16)}, col ${(inV & 0xf).toString(16)})`,
                                `out : 0x${outV.toString(16).padStart(2, '0')}`,
                                `nonlinear substitution -> confusion`
                            ], event);
                        })
                        .on('mouseleave', () => {
                            c.rect.style('stroke', 'rgba(140,165,200,0.28)').style('stroke-width', 0.7);
                            this.hideHoverCard();
                        });
                });
            }
        });

        // Flow arrows between stages.
        stageGeom.forEach((sg, i) => {
            if (i === 0) return;
            const prev = stageGeom[i - 1];
            const ax = prev.cx0 + colW - 4;
            const ay = contentY + 30 + gridW / 2;
            box.append('text').attr('x', (ax + sg.cx0) / 2).attr('y', ay + 4).attr('text-anchor', 'middle')
                .style('font-family', 'Share Tech Mono, monospace').style('font-size', '14px')
                .style('fill', 'rgba(150,175,210,0.5)').text('>');
        });

        this._aesOpsGeom = stageGeom;
        this._startAesOpsAnim();
    }

    _startAesOpsAnim() {
        if (this._aesOpsRaf) cancelAnimationFrame(this._aesOpsRaf);
        const R = window.AESRef;
        const geom = this._aesOpsGeom;
        if (!geom || !R) return;
        const stagePeriod = 1500; // ms per stage highlight
        const heat = (v) => {
            const x = Math.max(0, Math.min(1, v));
            if (x < 0.001) return '#12202f';
            if (x < 0.25) return '#3b4c8f';
            if (x < 0.5) return '#7b40d8';
            if (x < 0.75) return '#e05274';
            return '#ff8a42';
        };
        const frame = () => {
            if (!this.aesOpsRound || !this.svg || this.svg.selectAll('.aes-ops-overlay').empty()) {
                this._aesOpsRaf = null;
                return;
            }
            const now = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
            const elapsed = now - (this.aesOpsClock || now);
            const nStages = geom.length;
            const activeStage = Math.floor(elapsed / stagePeriod) % nStages;
            const local = (elapsed % stagePeriod) / stagePeriod; // 0..1 within active stage
            geom.forEach((sg, si) => {
                const active = si === activeStage;
                const morph = active ? local : (si < activeStage ? 1 : 0);
                sg.cells.forEach((c) => {
                    const fromV = sg.st.from[c.idx] & 0xff;
                    const toV = sg.st.to[c.idx] & 0xff;
                    const changed = fromV !== toV;
                    // value shown: flips at the midpoint of the active stage morph
                    const shown = (morph >= 0.5) ? toV : fromV;
                    c.label.text(shown.toString(16).padStart(2, '0'));
                    const changedBits = R.popcount(fromV ^ toV) / 8;
                    let fill = 'rgba(20,30,45,0.6)';
                    let stroke = 'rgba(140,165,200,0.28)';
                    if (active) {
                        const pulse = 0.5 + 0.5 * Math.sin(elapsed * 0.012 + c.idx);
                        fill = changed ? heat(0.3 + changedBits * 0.7) : 'rgba(40,55,80,0.6)';
                        stroke = sg.st.accent;
                        c.rect.style('opacity', 0.7 + 0.3 * (changed ? pulse : 0.4));
                    } else if (si < activeStage) {
                        fill = changed ? heat(0.2 + changedBits * 0.5) : 'rgba(28,38,56,0.5)';
                        c.rect.style('opacity', 0.85);
                    } else {
                        c.rect.style('opacity', 0.35);
                    }
                    c.rect.style('fill', fill).style('stroke', stroke)
                        .style('stroke-width', active ? 1.3 : 0.7);
                });
                if (sg.decor) {
                    const decorOpacity = active
                        ? (0.6 + 0.4 * Math.abs(Math.sin(elapsed * 0.006)))
                        : (si < activeStage ? 0.4 : 0.16);
                    sg.decor.style('opacity', decorOpacity);
                }
            });
            this._aesOpsRaf = requestAnimationFrame(frame);
        };
        this._aesOpsRaf = requestAnimationFrame(frame);
    }

    drawLinearAnalysisDashboard(layer, payload, width, height, tickId) {
        const model = this.buildLinearAnalysisModel(payload);
        const aes = (this.aesDemo && this.aesDemo.diffusion) ? this.aesDemo : null;
        const aesLive = this.computeAesLive(aes);
        const items = Array.isArray(payload?.items) ? payload.items : [];
        const metaAll = payload?.meta || {};
        const cpuFlags = metaAll.cpu_flags || {};
        const cryptoMetrics = metaAll.crypto_metrics || {};
        const activeAlgorithms = Array.isArray(metaAll.active_algorithms) ? metaAll.active_algorithms : [];
        const kernelOps = metaAll.kernel_ops || {};
        const kernelOpsAvail = !!kernelOps.available;
        const kernelTopOp = (Array.isArray(kernelOps.by_driver) && kernelOps.by_driver.length) ? kernelOps.by_driver[0] : null;
        const eventLog = Array.isArray(metaAll.event_log) ? metaAll.event_log : [];
        const entropyCloud = metaAll.entropy_cloud || {};
        const runtimeSources = Array.isArray(payload?.runtime_sources)
            ? payload.runtime_sources
            : (Array.isArray(payload?.meta?.runtime_sources) ? payload.meta.runtime_sources : []);
        const primary = items[0] || {};
        const algLabel = model.request === 'AES' ? 'AES-128' : model.request;
        const margin = 10;
        const gap = 8;
        const headerY = 24;
        const controlsY = 58;
        const badgesY = 84;
        const topY = 112;
        const topH = Math.max(230, Math.floor(height * 0.30));
        const leftTopY = topY;
        const contextH = 102;
        const dataFlowY = leftTopY + contextH + gap;
        const dataFlowH = Math.max(118, Math.min(146, topY + topH - dataFlowY));
        const midY = topY + topH + gap;
        const midH = Math.max(160, Math.floor(height * 0.25));
        const bottomY = midY + midH + gap;
        const bottomH = Math.max(84, height - bottomY - 12);
        const leftW = Math.max(205, Math.floor(width * 0.16));
        const rightW = Math.max(225, Math.floor(width * 0.18));
        const centerX = margin + leftW + gap;
        const centerW = width - centerX - rightW - gap - margin;

        const panel = (x, y, w, h, title, subtitle = '') => {
            const g = layer.append('g').attr('class', 'linear-analysis-panel');
            g.append('rect')
                .attr('x', x)
                .attr('y', y)
                .attr('width', w)
                .attr('height', h)
                .attr('rx', 4)
                .style('fill', 'rgba(5, 9, 15, 0.82)')
                .style('stroke', 'rgba(92, 122, 158, 0.42)')
                .style('stroke-width', 1);
            g.append('text')
                .attr('x', x + 10)
                .attr('y', y + 18)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '11px')
                .style('letter-spacing', '0.45px')
                .style('fill', '#d9e4f5')
                .text(title);
            if (subtitle) {
                g.append('text')
                    .attr('x', x + 10)
                    .attr('y', y + 34)
                    .style('font-family', 'Share Tech Mono, monospace')
                    .style('font-size', '9px')
                    .style('fill', '#8fa0b8')
                    .text(subtitle);
            }
            return g;
        };
        const heatColor = (v) => {
            const value = Math.max(-1, Math.min(1, v));
            if (value < -0.18) return '#544cff';
            if (value < 0) return '#7b40d8';
            if (value < 0.22) return '#b23db5';
            if (value < 0.5) return '#e05274';
            return '#ff8a42';
        };
        const spark = (g, x, y, w, h, seed, color) => {
            const p = d3.path();
            for (let i = 0; i < 28; i += 1) {
                const px = x + (w / 27) * i;
                const v = Math.sin((seed + i) * 0.7) * 0.35 + Math.sin((seed + i) * 0.19) * 0.2;
                const py = y + h * 0.5 - v * h * 0.7;
                if (i === 0) p.moveTo(px, py);
                else p.lineTo(px, py);
            }
            g.append('path')
                .attr('d', p.toString())
                .style('fill', 'none')
                .style('stroke', color)
                .style('stroke-width', 1)
                .style('stroke-opacity', 0.82);
        };
        const showAnalysisTip = (lines, event) => {
            if (!this.hoverCard) return;
            this.hoverCard.textContent = lines.join('\n');
            this.hoverCard.style.display = 'block';
            this.positionHoverCard(event);
        };
        const runtimeQuality = runtimeSources.filter((source) => source.active).reduce((score, source) => {
            const src = String(source.source || '');
            if (src === 'direct') return score + 3;
            if (src === 'procfs') return score + 2;
            return score + 1;
        }, 0);

        layer.append('text')
            .attr('x', width * 0.5)
            .attr('y', headerY)
            .attr('text-anchor', 'middle')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '18px')
            .style('letter-spacing', '1px')
            .style('fill', '#dfe8f7')
            .text('LINEAR CRYPTOANALYSIS VISUALIZATION');
        layer.append('text')
            .attr('x', width * 0.5)
            .attr('y', headerY + 18)
            .attr('text-anchor', 'middle')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '10px')
            .style('fill', '#9cabc0')
            .text(aes
                ? `${algLabel} - ${aes.rounds} ROUNDS - REFERENCE COMPUTATION (DEMO VECTORS)`
                : `${algLabel} - ${model.rounds} ROUNDS - LINEAR APPROXIMATION TRACKING`);

        if (aes) {
            const explore = [
                ['KEY SCHEDULE', () => this.openKeyScheduleOverlay()],
                ['GCM / CTR MODE', () => this.openModeOverlay(this.aesModeKind || 'CTR')]
            ];
            explore.forEach(([label, onClick], idx) => {
                const bw = 118;
                const bx = margin + 4 + idx * (bw + 8);
                const g = layer.append('g').style('cursor', 'pointer').on('click', onClick);
                g.append('rect').attr('x', bx).attr('y', controlsY - 16).attr('width', bw).attr('height', 22).attr('rx', 4)
                    .style('fill', 'rgba(24, 40, 62, 0.9)').style('stroke', 'rgba(128, 190, 255, 0.6)').style('stroke-width', 1);
                g.append('text').attr('x', bx + bw / 2).attr('y', controlsY - 1).attr('text-anchor', 'middle')
                    .style('font-family', 'Share Tech Mono, monospace').style('font-size', '9px')
                    .style('fill', '#cfe3ff').text(label);
            });
        }

        this.algorithmModes.forEach((mode, idx) => {
            const isActive = mode === model.request;
            const x = centerX + centerW - 252 + idx * 84;
            const btn = layer.append('g')
                .style('cursor', 'pointer')
                .on('click', () => {
                    this.selectedCompetitionAlgorithm = mode;
                    this.renderFlowMap(this.lastPayload || this.normalizeTelemetry(this.getFallbackTelemetry()));
                });
            btn.append('rect')
                .attr('x', x)
                .attr('y', controlsY - 16)
                .attr('width', 76)
                .attr('height', 22)
                .attr('rx', 4)
                .style('fill', isActive ? 'rgba(38, 63, 98, 0.95)' : 'rgba(7, 11, 17, 0.82)')
                .style('stroke', isActive ? 'rgba(128, 190, 255, 0.86)' : 'rgba(122, 145, 176, 0.32)')
                .style('stroke-width', 1);
            btn.append('text')
                .attr('x', x + 38)
                .attr('y', controlsY - 1)
                .attr('text-anchor', 'middle')
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '9px')
                .style('fill', isActive ? '#d8eaff' : '#9dafc5')
                .text(mode);
        });

        runtimeSources.filter((source) => source.active).slice(0, 4).forEach((source, idx) => {
            const src = String(source.source || 'heuristic');
            const color = src === 'direct' ? '#8effc8' : (src === 'procfs' ? '#8fdcff' : '#ffd58d');
            const x = centerX + 8 + idx * 118;
            layer.append('rect')
                .attr('x', x)
                .attr('y', badgesY - 14)
                .attr('width', 108)
                .attr('height', 18)
                .attr('rx', 4)
                .style('fill', 'rgba(8, 13, 20, 0.82)')
                .style('stroke', color)
                .style('stroke-opacity', 0.42);
            layer.append('text')
                .attr('x', x + 8)
                .attr('y', badgesY - 1)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '8px')
                .style('fill', color)
                .text(`${String(source.label || source.id).slice(0, 11)}:${src}`);
        });

        const ctx = panel(margin, leftTopY, leftW, contextH, 'PROCESS CONTEXT');
        [
            ['process', primary.process || 'kernel/user'],
            ['pid', primary.pid || '?'],
            ['protocol', primary.protocol || 'CRYPTO API'],
            ['algorithm', primary.algorithm || `${model.request}-GCM/SHA256`],
            ['kernel path', model.selectedDriver],
            ['cpu flags', (Array.isArray(cpuFlags.display) && cpuFlags.display.length)
                ? cpuFlags.display.join(', ')
                : (model.selectedDriver.includes('aes') ? 'AES-NI, PCLMULQDQ' : 'generic/simd')]
        ].forEach(([k, v], idx) => {
            ctx.append('text')
                .attr('x', margin + 14)
                .attr('y', leftTopY + 28 + idx * 12)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '8.8px')
                .style('fill', '#9fb0c7')
                .text(`${k}:`);
            ctx.append('text')
                .attr('x', margin + 76)
                .attr('y', leftTopY + 28 + idx * 12)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '8.8px')
                .style('fill', '#d0dae8')
                .text(String(v).slice(0, 24));
        });

        const flow = panel(margin, dataFlowY, leftW, dataFlowH, 'DATA FLOW');
        const flowSteps = ['userspace', 'TLS 1.3', 'sendmsg()/recvmsg()', 'AF_ALG', 'crypto_aead_encrypt', `${model.selectedDriver}`];
        flowSteps.forEach((step, idx) => {
            const y = dataFlowY + 30 + idx * 18;
            flow.append('text')
                .attr('x', margin + leftW * 0.5)
                .attr('y', y)
                .attr('text-anchor', 'middle')
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '9px')
                .style('fill', idx === flowSteps.length - 1 ? '#9dffca' : '#b6c4d7')
                .text(step.slice(0, 24));
            if (idx < flowSteps.length - 1) {
                flow.append('line')
                    .attr('x1', margin + leftW * 0.5)
                    .attr('x2', margin + leftW * 0.5)
                    .attr('y1', y + 6)
                    .attr('y2', y + 14)
                    .style('stroke', 'rgba(122, 150, 190, 0.48)');
            }
        });
        if (kernelOpsAvail && kernelTopOp) {
            flow.append('text')
                .attr('x', margin + leftW * 0.5)
                .attr('y', dataFlowY + dataFlowH - 8)
                .attr('text-anchor', 'middle')
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '7.5px')
                .style('fill', '#9dffca')
                .text(`live: ${String(kernelTopOp.op || '')} ${Math.round(Number(kernelTopOp.ops_per_sec) || 0)}/s`);
        }

        const map = panel(centerX, topY, centerW, topH, 'BIT CORRELATION MAP (LINEAR APPROXIMATION)');
        const mapLeft = centerX + 72;
        const mapRight = centerX + centerW - 94;
        const mapTop = topY + 56;
        const mapBottom = topY + topH - 72;
        const bitRows = 8;
        const roundCount = Math.min(model.rounds, 8);
        const bitY = (idx) => mapTop + (mapBottom - mapTop) * (idx / Math.max(1, bitRows - 1));
        map.append('text').attr('x', mapLeft - 38).attr('y', topY + 44).style('font-family', 'Share Tech Mono, monospace').style('font-size', '9px').style('fill', '#9eafc4').text('PLAINTEXT BITS');
        map.append('text').attr('x', mapRight + 6).attr('y', topY + 44).style('font-family', 'Share Tech Mono, monospace').style('font-size', '9px').style('fill', '#9eafc4').text('CIPHERTEXT BITS');
        for (let row = 0; row < bitRows; row += 1) {
            const y = bitY(row);
            map.append('text').attr('x', mapLeft - 54).attr('y', y + 3).style('font-family', 'Share Tech Mono, monospace').style('font-size', '8px').style('fill', '#8fa0b8').text(`P${row}`);
            map.append('text').attr('x', mapRight + 54).attr('y', y + 3).style('font-family', 'Share Tech Mono, monospace').style('font-size', '8px').style('fill', '#8fa0b8').text(`C${row}`);
            for (let b = 0; b < 5; b += 1) {
                map.append('circle').attr('cx', mapLeft - 30 + b * 7).attr('cy', y).attr('r', 1.8).style('fill', ((model.seed + row + b) % 3) ? '#7754d8' : '#ff704c').style('opacity', 0.68);
                map.append('circle').attr('cx', mapRight + 18 + b * 7).attr('cy', y).attr('r', 1.8).style('fill', ((model.seed + row + b) % 4) ? '#ff704c' : '#7754d8').style('opacity', 0.68);
            }
        }
        const layerXs = Array.from({ length: roundCount }, (_, idx) => mapLeft + 56 + ((mapRight - mapLeft - 112) / Math.max(1, roundCount - 1)) * idx);
        layerXs.forEach((x, idx) => {
            const bias = model.bestTrail[idx]?.bias || model.baseBias;
            const color = heatColor((bias / Math.max(model.maxBias, 0.001)) - 0.45);
            const depLayer = aes ? (aes.diffusion.dependency_layers[idx] || null) : null;
            map.append('text').attr('x', x).attr('y', topY + 46).attr('text-anchor', 'middle').style('font-family', 'Share Tech Mono, monospace').style('font-size', '8.5px').style('fill', '#b7c3d3').text(idx % 3 === 0 ? `R${idx}` : (idx % 3 === 1 ? `M${idx}` : `K${idx}`));
            const roundRect = map.append('rect')
                .attr('x', x - 17)
                .attr('y', mapTop - 12)
                .attr('width', 34)
                .attr('height', mapBottom - mapTop + 24)
                .style('fill', color)
                .style('fill-opacity', 0.18 + idx * 0.025)
                .style('stroke', color)
                .style('stroke-opacity', 0.58)
                .style('cursor', 'crosshair')
                .on('mouseenter', (event) => {
                    roundRect.style('stroke-width', 2).style('stroke-opacity', 0.95);
                    showAnalysisTip([
                        `round layer : ${idx}`,
                        `stage       : ${idx % 3 === 0 ? 'round' : (idx % 3 === 1 ? 'mix/linear' : 'key add')}`,
                        `bias        : +${bias.toFixed(6)}`,
                        `correlation : +${(bias * 2).toFixed(6)}`,
                        `active sbox : ${model.bestTrail[idx]?.activeSboxes || '-'}`
                    ], event);
                })
                .on('mousemove', (event) => this.positionHoverCard(event))
                .on('mouseleave', () => {
                    roundRect.style('stroke-width', 1).style('stroke-opacity', 0.58);
                    this.hideHoverCard();
                });
            for (let row = 0; row < bitRows; row += 1) {
                for (let col = 0; col < 4; col += 1) {
                    const depVal = depLayer ? Number(depLayer[row][col]) : null;
                    const v = (depVal != null) ? (depVal * 1.4 - 0.45) : Math.sin((model.seed + idx * 11 + row * 7 + col) * 0.22);
                    const cellOpacity = (depVal != null) ? (0.2 + depVal * 0.72) : (0.28 + Math.abs(v) * 0.5);
                    const cellRect = map.append('rect')
                        .attr('x', x - 13 + col * 7)
                        .attr('y', bitY(row) - 5)
                        .attr('width', 4)
                        .attr('height', 10)
                        .style('fill', heatColor(v))
                        .style('opacity', cellOpacity)
                        .style('cursor', 'crosshair')
                        .on('mouseenter', (event) => {
                            cellRect.style('opacity', 1).style('stroke', '#ffffff').style('stroke-width', 0.5);
                            showAnalysisTip((depVal != null) ? [
                                `diffusion cell : round ${idx}`,
                                `in byte-group  : ${row}  ->  out byte-group : ${col}`,
                                `influence      : ${(depVal * 100).toFixed(1)}%`,
                                `source         : real AES-128 (demo vectors)`
                            ] : [
                                `LAT cell    : R${idx} / bit ${row}.${col}`,
                                `mask value  : ${v >= 0 ? '+' : ''}${v.toFixed(4)}`,
                                `bias class  : ${Math.abs(v) > 0.72 ? 'hot approximation' : 'low signal'}`,
                                `source      : deterministic model`
                            ], event);
                        })
                        .on('mousemove', (event) => this.positionHoverCard(event))
                        .on('mouseleave', () => {
                            cellRect.style('opacity', cellOpacity).style('stroke', 'none');
                            this.hideHoverCard();
                        });
                }
            }
        });
        for (let row = 0; row < bitRows; row += 1) {
            const startY = bitY(row);
            layerXs.forEach((x, idx) => {
                const nextX = idx === layerXs.length - 1 ? mapRight + 14 : layerXs[idx + 1] - 18;
                const nextY = bitY((row + idx + (model.seed % 3)) % bitRows);
                const p = d3.path();
                p.moveTo(idx === 0 ? mapLeft - 8 : x + 18, startY);
                p.bezierCurveTo(x + 22, startY, nextX - 24, nextY, nextX, nextY);
                map.append('path')
                    .attr('d', p.toString())
                    .style('fill', 'none')
                    .style('stroke', heatColor(Math.sin((row + idx + model.seed) * 0.31)))
                    .style('stroke-width', 0.65)
                    .style('stroke-opacity', 0.34);
            });
        }
        const biasX = centerX + centerW * 0.26;
        const biasY = topY + topH - 40;
        map.append('text').attr('x', centerX + centerW * 0.5).attr('y', biasY - 12).attr('text-anchor', 'middle').style('font-family', 'Share Tech Mono, monospace').style('font-size', '8px').style('fill', '#9caec5').text('CORRELATION (BIAS)');
        map.append('line').attr('x1', biasX).attr('x2', biasX + centerW * 0.48).attr('y1', biasY).attr('y2', biasY).style('stroke', '#fa7d48').style('stroke-width', 3).style('filter', 'url(#crypto-line-glow)');
        map.append('line').attr('x1', biasX).attr('x2', biasX + centerW * 0.24).attr('y1', biasY).attr('y2', biasY).style('stroke', '#5b48ff').style('stroke-width', 3);
        ['-0.5', '0', '+0.5'].forEach((t, idx) => map.append('text').attr('x', biasX + idx * centerW * 0.24).attr('y', biasY + 16).attr('text-anchor', 'middle').style('font-family', 'Share Tech Mono, monospace').style('font-size', '8px').style('fill', '#9caec5').text(t));

        const infoH = Math.max(118, Math.min(138, Math.floor(topH * 0.58)));
        const biasPanelY = topY + infoH + 8;
        const biasPanelH = Math.max(64, topH - infoH - 8);
        const info = panel(centerX + centerW + gap, topY, rightW, infoH, 'LINEAR APPROXIMATION INFO');
        const infoLines = aes ? (() => {
            const t0 = (aes.lat.top && aes.lat.top[0]) ? aes.lat.top[0] : { in_mask: 0, out_mask: 0, bias: aes.lat.max_bias };
            const b = aes.lat.max_bias;
            return [
                `S-box linear approx:`,
                `P[a.x = b.S(x)] = ${(0.5 + Math.abs(b)).toFixed(6)}`,
                `max bias: ${b >= 0 ? '+' : ''}${b.toFixed(6)}`,
                `correlation: ${(aes.lat.max_correlation).toFixed(6)}`,
                `best masks (hex):`,
                `a (in) : 0x${Number(t0.in_mask).toString(16).padStart(2, '0')}`,
                `b (out): 0x${Number(t0.out_mask).toString(16).padStart(2, '0')}`,
                `#approx |bias|=${aes.lat.max_abs_lat}/256`,
                `source: real S-box`
            ];
        })() : [
            `approximation:`,
            `P[L(P,K) = L(C)] = ${(0.5 + model.maxBias).toFixed(7)}`,
            `bias: +${model.maxBias.toFixed(7)}`,
            `correlation: +${(model.maxBias * 2).toFixed(7)}`,
            `mask(hex):`,
            `P: 0x${(model.seed & 0xffff).toString(16).padStart(4, '0')}`,
            `C: 0x${((model.seed * 17) & 0xffff).toString(16).padStart(4, '0')}`,
            `rounds: ${model.rounds}/${model.rounds}`,
            `quality: good`
        ];
        infoLines.forEach((line, idx) => {
            info.append('text')
                .attr('x', centerX + centerW + gap + 12)
                .attr('y', topY + 42 + idx * 11)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '8.2px')
                .style('fill', idx === 2 || idx === 8 ? '#8effc8' : '#b3bfd0')
                .text(line);
        });
        const biasPanel = panel(centerX + centerW + gap, biasPanelY, rightW, biasPanelH, aes ? 'AVALANCHE OVER ROUNDS' : 'BIAS OVER ROUNDS', aes ? '% OF STATE BITS FLIPPED' : '');
        const chartX = centerX + centerW + gap + 34;
        const chartY = biasPanelY + 42;
        const chartW = rightW - 58;
        const chartH = Math.max(24, biasPanelH - 56);
        biasPanel.append('line').attr('x1', chartX).attr('x2', chartX + chartW).attr('y1', chartY + chartH / 2).attr('y2', chartY + chartH / 2).style('stroke', 'rgba(116, 138, 170, 0.28)');
        const bp = d3.path();
        if (aes) {
            const curve = (aesLive ? aesLive.curvePct : aes.diffusion.avg_curve_pct) || [];
            // baseline (50%) reference line
            biasPanel.append('line').attr('x1', chartX).attr('x2', chartX + chartW)
                .attr('y1', chartY + chartH * 0.1).attr('y2', chartY + chartH * 0.1)
                .style('stroke', 'rgba(141, 220, 255, 0.35)').style('stroke-dasharray', '2,2');
            curve.forEach((pct, idx) => {
                const x = chartX + (chartW / Math.max(1, curve.length - 1)) * idx;
                const y = chartY + chartH - (Math.max(0, Math.min(100, pct)) / 100) * chartH * 1.8;
                if (idx === 0) bp.moveTo(x, y);
                else bp.lineTo(x, y);
                biasPanel.append('circle').attr('cx', x).attr('cy', y).attr('r', 2).style('fill', pct >= 45 ? '#8effc8' : '#ff9a55');
            });
            biasPanel.append('path').attr('d', bp.toString()).style('fill', 'none').style('stroke', '#8effc8').style('stroke-width', 1.5);
        } else {
            model.bestTrail.forEach((step, idx) => {
                const x = chartX + (chartW / Math.max(1, model.bestTrail.length - 1)) * idx;
                const y = chartY + chartH * 0.5 - Math.sin(idx * 0.8 + model.seed) * chartH * 0.2 - (step.bias / model.maxBias) * chartH * 0.28;
                if (idx === 0) bp.moveTo(x, y);
                else bp.lineTo(x, y);
                biasPanel.append('circle').attr('cx', x).attr('cy', y).attr('r', 2).style('fill', idx > model.bestTrail.length * 0.55 ? '#ff9a55' : '#9d55ff');
            });
            biasPanel.append('path').attr('d', bp.toString()).style('fill', 'none').style('stroke', '#ff8655').style('stroke-width', 1.5);
        }

        const diffW = Math.max(320, width * 0.33);
        const keyW = Math.max(320, width * 0.33);
        const entropyW = width - margin * 2 - diffW - keyW - gap * 2;
        const diffSubtitle = aesLive
            ? `CLICK INPUT BYTES TO FLIP BITS · ${aesLive.flippedBits} FLIPPED -> ${aesLive.curve[aesLive.curve.length - 1]}/128 · CLICK A ROUND FOR ITS OPERATIONS`
            : (aes ? `FLIP 1 BIT IN PLAINTEXT -> ${aes.diffusion.avalanche_curve[aes.diffusion.avalanche_curve.length - 1]}/128 BITS CHANGED` : 'FLIP 1 BIT IN PLAINTEXT -> OBSERVE PROPAGATION');
        const diff = panel(margin, midY, diffW, midH, 'DIFFUSION & AVALANCHE VISUALIZATION', diffSubtitle);
        const cell = Math.max(5, Math.min(10, (diffW - 58) / 38));
        const roundCap = Math.min(10, model.rounds + 1);
        const pulse = 0.5 + 0.5 * Math.sin(this.activeAnimationTick * 0.18);
        for (let round = 0; round < roundCap; round += 1) {
            const gx = margin + 24 + (round % 5) * ((diffW - 48) / 5);
            const gy = midY + 54 + Math.floor(round / 5) * ((midH - 78) / 2);
            const grid = aesLive ? (aesLive.grids[round] || null) : (aes ? (aes.diffusion.avalanche_grids[round] || null) : null);
            const changed = grid ? grid.reduce((s, v) => s + (v > 0 ? 1 : 0), 0) : 0;
            const isInput = round === 0;
            const canInspect = aesLive && round >= 1;
            const labelTxt = grid ? (isInput ? `INPUT Δ · ${changed}/16` : `R${round} · ${changed}/16${canInspect ? ' ›' : ''}`) : `ROUND ${round}`;
            if (canInspect) {
                // Transparent hit rect: <text> only registers clicks on painted glyphs.
                diff.append('rect').attr('x', gx - 4).attr('y', gy - 18).attr('width', 78).attr('height', 16)
                    .style('fill', 'transparent').style('cursor', 'pointer')
                    .on('click', () => this.openAesOpsOverlay(round));
            }
            diff.append('text').attr('x', gx).attr('y', gy - 8).style('font-family', 'Share Tech Mono, monospace').style('font-size', '7.5px')
                .style('fill', isInput ? '#ffcf9a' : (canInspect ? '#a9c2e6' : '#8fa0b8'))
                .style('cursor', canInspect ? 'pointer' : 'default')
                .style('pointer-events', 'none')
                .text(labelTxt);
            if (grid) {
                // 4x4 AES state rendered as "balls"; radius/heat = bits flipped in that byte (0..8).
                const stepX = cell * 2.0;
                const stepY = cell * 1.8;
                for (let a = 0; a < 4; a += 1) {
                    for (let b = 0; b < 4; b += 1) {
                        const idx = a + 4 * b;
                        const bits = Number(grid[idx]) || 0;
                        const v = bits / 8;
                        const cxp = gx + b * stepX + cell * 0.85;
                        const cyp = gy + a * stepY + cell * 0.8;
                        const on = bits > 0;
                        const rBall = on ? (cell * 0.42 + v * cell * 0.5) : cell * 0.3;
                        const ballOpacity = on ? (0.5 + v * 0.5) * (isInput ? 1 : (0.7 + 0.3 * pulse)) : 0.4;
                        const ball = diff.append('circle')
                            .attr('cx', cxp).attr('cy', cyp).attr('r', rBall)
                            .style('fill', on ? heatColor(v * 1.3 - 0.25) : 'rgba(120,140,170,0.14)')
                            .style('stroke', on ? 'rgba(255,190,130,0.6)' : 'rgba(120,140,170,0.28)')
                            .style('stroke-width', on ? 0.7 : 0.5)
                            .style('opacity', ballOpacity);
                        // Forgiving transparent hit target so the tiny balls are
                        // easy to click (the visible circle can be < 3px radius).
                        const addHit = (handler, enter, leave) => {
                            diff.append('circle')
                                .attr('cx', cxp).attr('cy', cyp).attr('r', Math.max(cell, rBall + 3))
                                .style('fill', 'transparent')
                                .style('cursor', 'pointer')
                                .on('click', handler)
                                .on('mouseenter', enter || null)
                                .on('mouseleave', leave || null);
                        };
                        if (isInput && aesLive) {
                            addHit(
                                () => this.toggleAesInputBit(idx),
                                (event) => {
                                    ball.style('stroke', '#ffffff').style('stroke-width', 1.2);
                                    showAnalysisTip([
                                        `input byte : ${idx} (row ${a}, col ${b})`,
                                        `flip state : ${on ? 'FLIPPED (1 bit)' : 'unchanged'}`,
                                        `action     : click to toggle a bit`,
                                        `then watch : difference diffuses across rounds`
                                    ], event);
                                },
                                () => {
                                    ball.style('stroke', on ? 'rgba(255,190,130,0.6)' : 'rgba(120,140,170,0.28)').style('stroke-width', on ? 0.7 : 0.5);
                                    this.hideHoverCard();
                                }
                            );
                        } else if (canInspect) {
                            addHit(() => this.openAesOpsOverlay(round));
                        }
                    }
                }
            } else {
                for (let a = 0; a < 6; a += 1) {
                    for (let b = 0; b < 6; b += 1) {
                        const v = Math.abs(Math.sin((model.seed + round * 13 + a * 5 + b) * 0.2));
                        diff.append('circle').attr('cx', gx + b * cell * 1.6).attr('cy', gy + a * cell * 1.45).attr('r', cell * 0.42).style('fill', heatColor(v - 0.35)).style('opacity', 0.25 + v * 0.65);
                    }
                }
            }
        }
        if (aesLive) {
            const resetG = diff.append('g').style('cursor', 'pointer').on('click', () => this.resetAesInputDiff());
            resetG.append('rect').attr('x', margin + diffW - 78).attr('y', midY + 6).attr('width', 66).attr('height', 16)
                .style('fill', 'transparent');
            resetG.append('text').attr('x', margin + diffW - 14).attr('y', midY + 16).attr('text-anchor', 'end')
                .style('font-family', 'Share Tech Mono, monospace').style('font-size', '8px')
                .style('pointer-events', 'none')
                .style('fill', '#9fb6d4').text('[ reset Δ ]');
        }

        const keyX = margin + diffW + gap;
        const key = panel(keyX, midY, keyW, midH, 'KEY HYPOTHESIS SPACE (RANKING)');
        const kcx = keyX + keyW * 0.5;
        const kcy = midY + midH * 0.55;
        const orbitSystem = key.append('g').attr('class', 'key-hypothesis-orbit-system');
        const orbitSystemReverse = key.append('g').attr('class', 'key-hypothesis-orbit-system-reverse');
        const bestKey = {
            x: kcx + keyW * 0.23,
            y: kcy - midH * 0.18
        };
        if (aes) {
            const kr = aes.key_recovery;
            const ranking = Array.isArray(kr.ranking) ? kr.ranking : [];
            const maxAbs = Math.max(0.01, ...ranking.map((r) => Math.abs(r.corr)));
            const sx0 = keyX + 26;
            const sw = keyW - 48;
            const syTop = midY + 44;
            const syBot = midY + midH - 62;
            const sh = Math.max(20, syBot - syTop);
            key.append('line').attr('x1', sx0).attr('x2', sx0 + sw).attr('y1', syBot).attr('y2', syBot)
                .style('stroke', 'rgba(116,138,170,0.35)');
            key.append('text').attr('x', sx0).attr('y', syTop - 6)
                .style('font-family', 'Share Tech Mono, monospace').style('font-size', '7.5px')
                .style('fill', '#8fa0b8').text('|correlation| per key guess (0..255)');
            let bx = sx0;
            let by = syBot;
            ranking.forEach((r) => {
                const px = sx0 + (Number(r.guess) / 255) * sw;
                const py = syBot - (Math.abs(Number(r.corr)) / maxAbs) * sh;
                const isTrue = Number(r.guess) === Number(kr.true_key);
                if (isTrue) { bx = px; by = py; }
                key.append('line').attr('x1', px).attr('x2', px).attr('y1', syBot).attr('y2', py)
                    .style('stroke', isTrue ? 'rgba(255,173,122,0.6)' : 'rgba(126,168,255,0.28)').style('stroke-width', isTrue ? 1.4 : 0.8);
                key.append('circle').attr('cx', px).attr('cy', py).attr('r', isTrue ? 4 : 2)
                    .style('fill', isTrue ? '#ffad7a' : '#7ea8ff').style('opacity', isTrue ? 1 : 0.62)
                    .style('filter', isTrue ? 'url(#crypto-line-glow)' : null);
            });
            key.append('text').attr('x', bx + 8).attr('y', by - 8)
                .style('font-family', 'Share Tech Mono, monospace').style('font-size', '8.5px')
                .style('fill', '#ffcf9a').text(`true key ${kr.true_key_hex} · rank #${kr.true_rank}`);

            // Convergence curve: true-key rank vs number of observed messages.
            const conv = Array.isArray(kr.convergence) ? kr.convergence : [];
            const cx0 = keyX + 26;
            const cw = keyW - 48;
            const cyBot = midY + midH - 16;
            const chH = 22;
            key.append('text').attr('x', cx0).attr('y', cyBot - chH - 4)
                .style('font-family', 'Share Tech Mono, monospace').style('font-size', '7.5px')
                .style('fill', '#8fa0b8').text('true-key rank vs messages (converges to #1)');
            const cp = d3.path();
            conv.forEach((c, i) => {
                const px = cx0 + (cw / Math.max(1, conv.length - 1)) * i;
                const frac = Math.min(1, (Number(c.true_rank) - 1) / 255);
                const py = (cyBot - chH) + frac * chH;
                if (i === 0) cp.moveTo(px, py); else cp.lineTo(px, py);
                key.append('circle').attr('cx', px).attr('cy', py).attr('r', Number(c.true_rank) === 1 ? 2.6 : 1.6)
                    .style('fill', Number(c.true_rank) === 1 ? '#8effc8' : '#ff9a55');
                key.append('text').attr('x', px).attr('y', cyBot + 2).attr('text-anchor', 'middle')
                    .style('font-family', 'Share Tech Mono, monospace').style('font-size', '6px')
                    .style('fill', '#6f8098').text(c.n);
            });
            key.append('path').attr('d', cp.toString()).style('fill', 'none').style('stroke', '#8effc8').style('stroke-width', 1.2);
        }
        if (!aes) {
        for (let i = 0; i < 420; i += 1) {
            const h = this.hashText(`${model.seed}-key-${i}`);
            const angle = h * 0.018;
            const rr = Math.min(keyW, midH) * (0.08 + ((h % 1000) / 1000) * 0.42);
            const px = kcx + Math.cos(angle) * rr * 1.35;
            const py = kcy + Math.sin(angle * 0.72) * rr * 0.55;
            const v = Math.sin(h * 0.03);
            key.append('circle').attr('cx', px).attr('cy', py).attr('r', Math.abs(v) > 0.92 ? 1.8 : 0.8).style('fill', heatColor(v)).style('opacity', 0.28 + Math.abs(v) * 0.38);
        }
        const spiral = d3.path();
        for (let i = 0; i < 90; i += 1) {
            const t = i / 8;
            const r = 4 + t * 4.4;
            const x = kcx + Math.cos(t) * r * 1.45;
            const y = kcy + Math.sin(t) * r * 0.86;
            if (i === 0) spiral.moveTo(x, y);
            else spiral.lineTo(x, y);
        }
        key.append('path').attr('d', spiral.toString()).style('fill', 'none').style('stroke', '#ff6b55').style('stroke-width', 1.2).style('stroke-opacity', 0.72);
        [0.22, 0.34, 0.47].forEach((scale, idx) => {
            const rx = keyW * scale;
            const ry = midH * (0.08 + idx * 0.055);
            orbitSystem.append('ellipse')
                .attr('cx', kcx)
                .attr('cy', kcy)
                .attr('rx', rx)
                .attr('ry', ry)
                .attr('transform', `rotate(${-18 + idx * 22}, ${kcx}, ${kcy})`)
                .style('fill', 'none')
                .style('stroke', idx === 0 ? '#ff875e' : '#6e58ff')
                .style('stroke-width', 0.75)
                .style('stroke-opacity', 0.28);
        });
        for (let i = 0; i < 18; i += 1) {
            const h = this.hashText(`${model.seed}-orbit-${i}`);
            const angle = (Math.PI * 2 * i) / 18;
            const rx = keyW * (0.18 + (h % 100) / 420);
            const ry = midH * (0.08 + ((h >> 3) % 100) / 900);
            const x = kcx + Math.cos(angle) * rx;
            const y = kcy + Math.sin(angle) * ry;
            orbitSystem.append('circle')
                .attr('cx', x)
                .attr('cy', y)
                .attr('r', i % 5 === 0 ? 2.6 : 1.5)
                .style('fill', i % 5 === 0 ? '#ffad7a' : '#8f7dff')
                .style('opacity', 0.45 + (i % 4) * 0.1)
                .style('filter', i % 5 === 0 ? 'url(#crypto-line-glow)' : null);
        }
        for (let i = 0; i < 9; i += 1) {
            const angle = (Math.PI * 2 * i) / 9;
            const rx = keyW * 0.28;
            const ry = midH * 0.12;
            orbitSystemReverse.append('rect')
                .attr('x', kcx + Math.cos(angle) * rx)
                .attr('y', kcy + Math.sin(angle) * ry)
                .attr('width', 4)
                .attr('height', 4)
                .attr('transform', `rotate(45, ${kcx + Math.cos(angle) * rx + 2}, ${kcy + Math.sin(angle) * ry + 2})`)
                .style('fill', '#7ee7ff')
                .style('opacity', 0.58);
        }
        this.animateKeyHypothesisOrbit(orbitSystem, kcx, kcy, tickId, 1);
        this.animateKeyHypothesisOrbit(orbitSystemReverse, kcx, kcy, tickId, -1);
        for (let i = 0; i < 3; i += 1) {
            key.append('circle')
                .attr('cx', bestKey.x)
                .attr('cy', bestKey.y)
                .attr('r', 10 + i * 8 + Math.sin(this.activeAnimationTick * 0.22 + i) * 2)
                .style('fill', 'none')
                .style('stroke', '#ffad7a')
                .style('stroke-opacity', 0.34 - i * 0.08)
                .style('filter', 'url(#crypto-line-glow)');
        }
        key.append('circle')
            .attr('cx', bestKey.x)
            .attr('cy', bestKey.y)
            .attr('r', 4.6)
            .style('fill', '#ffad7a')
            .style('filter', 'url(#crypto-line-glow)');
        key.append('line')
            .attr('x1', kcx)
            .attr('y1', kcy)
            .attr('x2', bestKey.x)
            .attr('y2', bestKey.y)
            .style('stroke', '#ff6b55')
            .style('stroke-width', 1)
            .style('stroke-opacity', 0.72);
        key.append('text').attr('x', bestKey.x + 12).attr('y', bestKey.y - 16).style('font-family', 'Share Tech Mono, monospace').style('font-size', '9px').style('fill', '#ffad7a').text('best hypothesis');
        key.append('text').attr('x', bestKey.x + 12).attr('y', bestKey.y - 2).style('font-family', 'Share Tech Mono, monospace').style('font-size', '8.5px').style('fill', '#ffcf9a').text(`rank #1 | bias +${model.maxBias.toFixed(4)}`);
        }

        const entX = keyX + keyW + gap;
        const ent = panel(entX, midY, entropyW, midH, 'ENTROPY COLLAPSE (SPIRAL VIEW)', 'FIBONACCI SPIRAL - ENTROPY REDUCTION OVER ROUNDS');
        const ecx = entX + entropyW * 0.48;
        const ecy = midY + midH * 0.55;
        const ep = d3.path();
        for (let i = 0; i < 190; i += 1) {
            const t = i * 0.16;
            const r = Math.min(entropyW, midH) * 0.42 * (1 - i / 205);
            const x = ecx + Math.cos(t) * r;
            const y = ecy + Math.sin(t) * r;
            if (i === 0) ep.moveTo(x, y);
            else ep.lineTo(x, y);
        }
        ent.append('path').attr('d', ep.toString()).style('fill', 'none').style('stroke', '#7557ff').style('stroke-width', 1.4).style('filter', 'url(#crypto-line-glow)');
        for (let r = 0; r < 7; r += 1) {
            ent.append('circle').attr('cx', ecx).attr('cy', ecy).attr('r', 10 + r * Math.min(entropyW, midH) * 0.055).style('fill', 'none').style('stroke', r < 2 ? '#ff7a44' : '#5968d8').style('stroke-opacity', 0.32);
        }
        const entPoolBits = Number(cryptoMetrics.entropy_pool_bits ?? entropyCloud.entropy_pool_bits ?? 0);
        const entPoolSize = Number(cryptoMetrics.entropy_pool_size_bits ?? entropyCloud.entropy_pool_size_bits ?? 256) || 256;
        const entPct = Math.max(0, Math.min(1, entPoolBits / entPoolSize));
        const entMaxR = 10 + 6 * Math.min(entropyW, midH) * 0.055;
        ent.append('circle')
            .attr('cx', ecx).attr('cy', ecy)
            .attr('r', 8 + entPct * (entMaxR - 8))
            .style('fill', 'none')
            .style('stroke', entPct > 0.5 ? '#8effc8' : '#ffcf7a')
            .style('stroke-width', 2)
            .style('stroke-opacity', 0.9)
            .style('filter', 'url(#crypto-line-glow)');
        [128, 96, 64, 32].forEach((bits, idx) => {
            ent.append('text')
                .attr('x', entX + entropyW - 48)
                .attr('y', midY + 60 + idx * 28)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '8px')
                .style('fill', idx < 2 ? '#8fdcff' : '#ffad7a')
                .text(`${bits}b`);
        });
        ent.append('text')
            .attr('x', entX + 14)
            .attr('y', midY + midH - 16)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '8.5px')
            .style('fill', entPct > 0.5 ? '#8effc8' : '#ffcf7a')
            .text(`live pool: ${Math.round(entPct * 100)}% (${entPoolBits}/${entPoolSize}b) | crng ${String(cryptoMetrics.crng_state || entropyCloud.crng_state || 'n/a')}`);

        const bottomPanels = [
            [margin, bottomY, width * 0.56 - margin, bottomH, 'KERNEL CRYPTO METRICS'],
            [width * 0.56 + gap, bottomY, width * 0.22, bottomH, 'ACTIVE ALGORITHMS (LIVE)'],
            [width * 0.78 + gap * 2, bottomY, width * 0.22 - margin * 2, bottomH, 'EVENT LOG (CRYPTO)']
        ];
        const metrics = panel(...bottomPanels[0]);
        const mPoolBits = Number(cryptoMetrics.entropy_pool_bits ?? entropyCloud.entropy_pool_bits ?? 0);
        const mPoolSize = Number(cryptoMetrics.entropy_pool_size_bits ?? entropyCloud.entropy_pool_size_bits ?? 256) || 256;
        const mRngHealth = cryptoMetrics.rng_health || (String(entropyCloud.crng_state || '').toLowerCase() === 'ready' ? 'good' : 'warming');
        const mAesNi = cryptoMetrics.aes_ni_status || (cpuFlags.aes_ni ? 'available' : 'n/a');
        const mLatency = (cryptoMetrics.latency_ms != null) ? `${Number(cryptoMetrics.latency_ms).toFixed(2)} ms` : 'n/a';
        const mNet = (cryptoMetrics.net_mb_s != null) ? `${Number(cryptoMetrics.net_mb_s).toFixed(2)} MB/s` : 'n/a';
        const mOps = (cryptoMetrics.ops_per_sec ?? metaAll.ops_per_sec);
        const kOpsAvail = !!cryptoMetrics.kernel_ops_available;
        const kOps = cryptoMetrics.kernel_ops_per_sec;
        const kMb = cryptoMetrics.kernel_mb_s;
        const metricItems = [
            ['entropy pool', `${mPoolBits}/${mPoolSize} b`, '#8fdcff'],
            ['rng health', mRngHealth, mRngHealth === 'good' ? '#8effc8' : '#ffcf8d'],
            ['aes-ni', mAesNi, mAesNi === 'active' ? '#9dffca' : (mAesNi === 'available' ? '#8fdcff' : '#d6e3f4')],
            ['crypto latency', mLatency, kOpsAvail ? '#9dffca' : '#d6e3f4'],
            [kOpsAvail ? 'kernel throughput' : 'net throughput',
                (kOpsAvail && kMb != null) ? `${Number(kMb).toFixed(2)} MB/s` : mNet,
                kOpsAvail ? '#9dffca' : '#d6e3f4'],
            [kOpsAvail ? 'kernel ops/s' : 'crypto ops/s',
                (kOpsAvail && kOps != null) ? `${Number(kOps).toFixed(0)}` : ((mOps != null) ? `${Number(mOps).toFixed(0)}` : 'n/a'),
                '#ffcf8d']
        ];
        const metricsPanelX = bottomPanels[0][0];
        const metricsPanelW = bottomPanels[0][2];
        metrics.append('text')
            .attr('x', metricsPanelX + metricsPanelW - 12)
            .attr('y', bottomY + 15)
            .attr('text-anchor', 'end')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '8px')
            .style('fill', kOpsAvail ? '#9dffca' : '#8fa0b8')
            .text(kOpsAvail ? 'live: kprobe (kernel)' : 'source: heuristic');
        metricItems.forEach((m, idx) => {
            const x = margin + 14 + idx * ((width * 0.56 - 44) / metricItems.length);
            metrics.append('text').attr('x', x).attr('y', bottomY + 38).style('font-family', 'Share Tech Mono, monospace').style('font-size', '8.5px').style('fill', '#8fa0b8').text(m[0]);
            metrics.append('text').attr('x', x).attr('y', bottomY + 56).style('font-family', 'Share Tech Mono, monospace').style('font-size', '10px').style('fill', m[2]).text(m[1]);
            spark(metrics, x, bottomY + 66, 58, Math.max(12, bottomH - 78), model.seed + idx * 9, m[2]);
        });
        const algos = panel(...bottomPanels[1]);
        const algoBaseX = width * 0.56 + gap;
        const algoPanelW = width * 0.22;
        const algoRows = activeAlgorithms.length
            ? activeAlgorithms.slice(0, 3)
            : [
                { family: 'AES', driver: 'aesni-intel', status: 'selected', source: 'kernel' },
                { family: 'ChaCha20', driver: 'chacha20-neon', status: 'selected', source: 'kernel' },
                { family: 'SHA-2', driver: 'sha256-avx2', status: 'selected', source: 'kernel' }
            ];
        algoRows.forEach((a, idx) => {
            const rowY = bottomY + 40 + idx * Math.max(26, (bottomH - 46) / algoRows.length);
            const isReal = String(a.source || '') === 'kernel';
            algos.append('text').attr('x', algoBaseX + 14).attr('y', rowY)
                .style('font-family', 'Share Tech Mono, monospace').style('font-size', '9.5px').style('fill', '#d2dce9')
                .text(String(a.family || '').slice(0, 12));
            algos.append('text').attr('x', algoBaseX + 14).attr('y', rowY + 12)
                .style('font-family', 'Share Tech Mono, monospace').style('font-size', '8px')
                .style('fill', isReal ? '#86e0c0' : '#8fa0b8')
                .text(String(a.driver || 'n/a').slice(0, 22));
            const isExecuting = a.status === 'executing';
            const statusLabel = isExecuting
                ? `${Math.round(Number(a.observed_ops_per_sec) || 0)}/s`
                : String(a.status || 'active');
            const statusColor = isExecuting ? '#9dffca' : (a.status === 'selected' ? '#ffcf7a' : '#8effc8');
            algos.append('text').attr('x', algoBaseX + algoPanelW - 12).attr('y', rowY).attr('text-anchor', 'end')
                .style('font-family', 'Share Tech Mono, monospace').style('font-size', '8px')
                .style('fill', statusColor)
                .text(statusLabel);
            if (isExecuting) {
                algos.append('text').attr('x', algoBaseX + algoPanelW - 12).attr('y', rowY + 11).attr('text-anchor', 'end')
                    .style('font-family', 'Share Tech Mono, monospace').style('font-size', '7px').style('fill', '#6fae92')
                    .text('executing');
            }
        });
        const log = panel(...bottomPanels[2]);
        const logBaseX = width * 0.78 + gap * 2;
        const tagColor = (tag) => {
            const t = String(tag || '').toLowerCase();
            if (t === 'random') return '#8fdcff';
            if (t === 'flows') return '#ffcf7a';
            if (t === 'offload') return '#9dffca';
            if (t === 'aes' || t === 'sha-2' || t === 'chacha20') return '#c9b6ff';
            return '#9fb0c7';
        };
        const logRows = eventLog.length
            ? eventLog.slice(0, 8)
            : [
                { ts: '', tag: 'crypto', msg: 'crypto telemetry online' },
                { ts: '', tag: model.request.toLowerCase(), msg: `${model.selectedDriver}: selected` }
            ];
        const logStep = Math.max(13, Math.min(16, (bottomH - 30) / Math.max(logRows.length, 1)));
        logRows.forEach((e, idx) => {
            const prefix = e.ts ? `[${e.ts}] ` : '';
            const line = `${prefix}${e.tag ? e.tag + ': ' : ''}${e.msg || ''}`;
            log.append('text').attr('x', logBaseX + 12).attr('y', bottomY + 38 + idx * logStep)
                .style('font-family', 'Share Tech Mono, monospace').style('font-size', '8px')
                .style('fill', tagColor(e.tag))
                .text(line.slice(0, 46));
        });
    }

    drawLinearAnalysisView(layer, payload, width, height, tickId) {
        this.drawLinearAnalysisDashboard(layer, payload, width, height, tickId);
        return;
        const model = this.buildLinearAnalysisModel(payload);
        const cx = width * 0.5;
        const cy = height * 0.52;
        const radius = Math.min(width, height) * 0.32;
        const goldenAngle = Math.PI * (3 - Math.sqrt(5));
        const pointCount = 220;

        layer.append('text')
            .attr('x', width * 0.5)
            .attr('y', 152)
            .attr('text-anchor', 'middle')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '12px')
            .style('letter-spacing', '0.8px')
            .style('fill', '#b8c6dc')
            .text(`${model.request} LINEAR CRYPTANALYSIS OBSERVATORY | VOGEL FIELD + FIBONACCI TRAIL`);

        const field = layer.append('g').attr('class', 'crypto-linear-vogel-field');
        field.append('circle')
            .attr('cx', cx)
            .attr('cy', cy)
            .attr('r', radius + 18)
            .style('fill', 'rgba(5, 8, 13, 0.48)')
            .style('stroke', 'rgba(130, 165, 210, 0.22)')
            .style('stroke-width', 1);

        for (let ring = 1; ring <= 5; ring += 1) {
            field.append('circle')
                .attr('cx', cx)
                .attr('cy', cy)
                .attr('r', (radius / 5) * ring)
                .style('fill', 'none')
                .style('stroke', ring === 5 ? 'rgba(140, 175, 220, 0.18)' : 'rgba(90, 115, 145, 0.12)')
                .style('stroke-width', 0.8);
        }

        for (let i = 0; i < pointCount; i += 1) {
            const n = i + 1;
            const angle = n * goldenAngle;
            const r = radius * Math.sqrt(n / pointCount);
            const hash = this.hashText(`${model.seed}-${i}-${model.request}`);
            const bias = Math.abs(Math.sin(hash * 0.013 + model.baseBias * 80)) * model.baseBias * (1.15 - r / (radius * 1.55));
            const hot = bias > model.baseBias * 0.82;
            const px = cx + Math.cos(angle) * r;
            const py = cy + Math.sin(angle) * r;
            const color = hot ? '#ffad7a' : (bias > model.baseBias * 0.48 ? '#f4da87' : '#7fd7ff');
            field.append('circle')
                .attr('cx', px)
                .attr('cy', py)
                .attr('r', hot ? 3.4 : 1.7 + bias * 30)
                .style('fill', color)
                .style('opacity', hot ? 0.88 : 0.42 + bias * 6)
                .style('filter', hot ? 'url(#crypto-line-glow)' : null);
        }

        const trail = layer.append('g').attr('class', 'crypto-linear-fibonacci-trail');
        const fibScale = radius / 11;
        const trailPoints = model.bestTrail.map((step, idx) => {
            const t = idx / Math.max(1, model.bestTrail.length - 1);
            const angle = 0.75 + idx * 0.72;
            const r = fibScale * Math.pow(1.618, idx * 0.36);
            return {
                x: cx + Math.cos(angle) * r,
                y: cy + Math.sin(angle) * r,
                step,
                t
            };
        });
        const path = d3.path();
        trailPoints.forEach((point, idx) => {
            if (idx === 0) path.moveTo(point.x, point.y);
            else path.lineTo(point.x, point.y);
        });
        trail.append('path')
            .attr('d', path.toString())
            .style('fill', 'none')
            .style('stroke', '#f2c979')
            .style('stroke-width', 2.1)
            .style('stroke-opacity', 0.78)
            .style('filter', 'url(#crypto-line-glow)');

        trailPoints.forEach((point, idx) => {
            const phase = (this.activeAnimationTick * 0.16 + idx * 0.7);
            const pulse = 0.55 + 0.45 * ((Math.sin(phase) + 1) / 2);
            trail.append('circle')
                .attr('cx', point.x)
                .attr('cy', point.y)
                .attr('r', 4.2 + pulse * 2.2)
                .style('fill', idx === 0 ? '#ffbe7a' : '#9ee8ff')
                .style('opacity', 0.74 + pulse * 0.2);
            trail.append('text')
                .attr('x', point.x + 10)
                .attr('y', point.y - 8)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '9px')
                .style('fill', '#d7e3f5')
                .text(`r${point.step.round} bias ${point.step.bias.toFixed(4)}`);
        });

        this.animateLinearBiasProbe(trail, trailPoints, tickId);
        this.drawLinearAnalysisPanels(layer, model, width, height);
    }

    animateLinearBiasProbe(group, points, tickId) {
        if (!points.length) return;
        const probe = group.append('circle')
            .attr('r', 4)
            .attr('cx', points[0].x)
            .attr('cy', points[0].y)
            .style('fill', '#ffffff')
            .style('opacity', 0.92)
            .style('filter', 'url(#crypto-line-glow)');

        const runLoop = () => {
            if (!this.isActive || tickId !== this.activeAnimationTick || this.activeCryptoView !== 'LINEAR_ANALYSIS') {
                probe.remove();
                return;
            }
            let chain = probe.transition().duration(0);
            for (let i = 1; i < points.length; i += 1) {
                chain = chain.duration(520).attr('cx', points[i].x).attr('cy', points[i].y);
            }
            chain.on('end', () => {
                probe.attr('cx', points[0].x).attr('cy', points[0].y);
                runLoop();
            });
        };
        runLoop();
    }

    drawLinearAnalysisPanels(layer, model, width, height) {
        const panel = (x, y, w, h, title) => {
            const g = layer.append('g');
            g.append('rect')
                .attr('x', x)
                .attr('y', y)
                .attr('width', w)
                .attr('height', h)
                .attr('rx', 10)
                .style('fill', 'rgba(7, 10, 15, 0.86)')
                .style('stroke', 'rgba(165, 185, 220, 0.34)')
                .style('stroke-width', 1);
            g.append('text')
                .attr('x', x + 14)
                .attr('y', y + 24)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '11px')
                .style('fill', '#dbe4f2')
                .text(title);
            return g;
        };

        const left = panel(26, 176, Math.max(310, width * 0.25), 232, 'LINEAR APPROXIMATION TABLE');
        const metrics = [
            `algorithm: ${model.request}`,
            `selected driver: ${model.selectedDriver}`,
            `LAT energy: ${model.latEnergy}/100`,
            `max bias: ${model.maxBias.toFixed(5)}`,
            `correlation decay: ${model.correlationDecay.toFixed(2)}`,
            `active S-boxes est: ${model.activeSboxes}`,
            `confidence: ${(model.confidence * 100).toFixed(0)}%`
        ];
        metrics.forEach((line, idx) => {
            left.append('text')
                .attr('x', 42)
                .attr('y', 214 + idx * 24)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', idx < 2 ? '10.5px' : '10px')
                .style('fill', idx === 3 ? '#ffcb8a' : '#aebbd0')
                .text(line);
        });

        const rightW = Math.max(330, width * 0.26);
        const rightX = width - rightW - 24;
        const right = panel(rightX, 176, rightW, 278, 'FIBONACCI BIAS TRAIL');
        right.append('text')
            .attr('x', rightX + 14)
            .attr('y', 214)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '9.5px')
            .style('fill', '#8fa0b8')
            .text('round path: plaintext mask -> nonlinear layer -> diffusion');
        model.bestTrail.slice(0, 8).forEach((step, idx) => {
            const y = 242 + idx * 24;
            const barW = Math.max(10, Math.min(rightW - 160, step.bias / Math.max(model.maxBias, 0.001) * (rightW - 172)));
            right.append('text')
                .attr('x', rightX + 14)
                .attr('y', y)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '9.5px')
                .style('fill', '#c5d0df')
                .text(step.label);
            right.append('rect')
                .attr('x', rightX + rightW - 130)
                .attr('y', y - 8)
                .attr('width', rightW - 150)
                .attr('height', 5)
                .attr('rx', 2)
                .style('fill', 'rgba(38, 44, 56, 0.9)');
            right.append('rect')
                .attr('x', rightX + rightW - 130)
                .attr('y', y - 8)
                .attr('width', barW)
                .attr('height', 5)
                .attr('rx', 2)
                .style('fill', idx === 0 ? '#ffb979' : '#8fdcff');
        });

        const bottom = panel(26, height - 126, width - 52, 92, 'MODEL NOTE');
        bottom.append('text')
            .attr('x', 42)
            .attr('y', height - 84)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '10px')
            .style('fill', '#aeb9ca')
            .text('educational model: masks/bias are derived from live crypto state and deterministic heuristics, not from decrypted traffic');
        bottom.append('text')
            .attr('x', 42)
            .attr('y', height - 58)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '10px')
            .style('fill', '#8fa0b8')
            .text('Vogel spiral = distribution of candidate linear masks; Fibonacci trail = bias decay across rounds');
    }

    renderFlowMap(payload) {
        if (!this.svg) return;
        this.lastPayload = payload;
        this.activeAnimationTick += 1;
        const tickId = this.activeAnimationTick;
        this.syncOverlayForCurrentView();
        if (this.activeCryptoView === 'LINEAR_ANALYSIS') {
            this.linearAnalysisRendered = true;
            this.lastLinearAnalysisRenderAt = Date.now();
        } else {
            this.linearAnalysisRendered = false;
            if (this.aesOverlay) this.closeAesOpsOverlay();
        }

        const width = window.innerWidth;
        const height = window.innerHeight;
        this.svg.attr('viewBox', `0 0 ${width} ${height}`);
        this.svg.selectAll('.crypto-flow-layer').remove();

        const layer = this.svg.append('g').attr('class', 'crypto-flow-layer');
        this.drawGrid(layer, width, height);
        if (this.activeCryptoView === 'LINEAR_ANALYSIS') {
            this.drawLinearAnalysisView(layer, payload, width, height, tickId);
            if (this.aesOverlay) this.svg.select('.aes-ops-overlay').raise();
            return;
        }
        this.drawProtocolLegend(layer);
        this.drawRuntimeSourcesPanel(layer, payload, width, height);
        this.drawEntropyCloud(layer, payload?.meta || {}, width, height);
        this.drawAlgorithmCompetition(layer, payload?.meta || {}, width, height);
        this.drawDecisionPipeline(layer, payload?.meta || {}, width, height);
        this.drawAlgorithmMaterialCard(layer, payload?.meta || {}, width, height);
        this.drawStage1Panels(layer, payload?.meta || {}, width, height);
        this.drawProtectedKernelZones(layer, payload, width, height);

        const sourceLanes = Array.isArray(payload.items) ? payload.items : [];
        const lanes = sourceLanes.filter((lane) => (
            this.laneMatchesSelectedClients(lane)
            && this.laneMatchesSelectedRequester(lane)
            && this.laneMatchesSelectedImplementationClass(lane)
        ));
        const topY = 172;
        const protocolY = 265;
        const cryptoY = 358;
        const algoY = 452;
        const endpointY = 532;

        const liveLayout = this.getCryptoLayout(width, height);
        const startX = width * 0.14;
        const flowRightX = Math.max(startX + 220, liveLayout.rightColumnX - 82);
        const usableWidth = Math.max(160, flowRightX - startX);
        const laneCount = Math.max(lanes.length, 1);
        const laneStep = laneCount > 1 ? usableWidth / (laneCount - 1) : 0;

        if (!lanes.length) {
            const selectedLabel = this.selectedClientFilters.size
                ? Array.from(this.selectedClientFilters).join(' + ')
                : 'ALL';
            const requesterLabel = this.selectedRequesterFilter
                ? ` | requester:${this.selectedRequesterFilter.name}`
                : '';
            const classLabel = this.selectedImplementationClassFilter
                ? ` | class:${this.selectedImplementationClassFilter}`
                : '';
            layer.append('text')
                .attr('x', width * 0.42)
                .attr('y', 320)
                .attr('text-anchor', 'middle')
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '12px')
                .style('fill', '#8fa0b6')
                .text(`NO ACTIVE PATHS FOR ${selectedLabel.toUpperCase()}${requesterLabel.toUpperCase()}${classLabel.toUpperCase()}`);
        }

        lanes.forEach((lane, idx) => {
            const x = startX + laneStep * idx;
            const intensity = Math.min(1 + lane.weight * 0.35, 2.2);
            const emphasis = Boolean(
                lane.isNew
                || lane.isHot
                || this.selectedRequesterFilter
                || this.selectedImplementationClassFilter
            );
            const laneGroup = layer.append('g').attr('class', 'crypto-lane');

            const pNode = this.drawNode(laneGroup, x, topY, lane.process, 'process', intensity, lane.palette, emphasis);
            const protoNode = this.drawNode(laneGroup, x, protocolY, lane.protocol, 'protocol', intensity, lane.palette, emphasis);
            const cNode = this.drawNode(laneGroup, x, cryptoY, 'crypto subsystem', 'crypto', intensity, lane.palette, emphasis);
            const aNode = this.drawNode(laneGroup, x, algoY, lane.algorithm, 'algorithm', intensity, lane.palette, emphasis);

            const p1 = [pNode.bottom, protoNode.top];
            const p2 = [protoNode.bottom, cNode.top];
            const p3 = [cNode.bottom, aNode.top];

            this.drawPath(laneGroup, p1, intensity, lane.palette, emphasis);
            this.drawPath(laneGroup, p2, intensity, lane.palette, emphasis);
            this.drawPath(laneGroup, p3, intensity, lane.palette, emphasis);

            this.animatePacket(
                laneGroup,
                [pNode.bottom, protoNode.top, protoNode.bottom, cNode.top, cNode.bottom, aNode.top],
                intensity,
                tickId,
                lane.palette,
                emphasis
            );

            laneGroup.append('text')
                .attr('x', x)
                .attr('y', endpointY)
                .attr('text-anchor', 'middle')
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '10px')
                .style('fill', '#9ba5b4')
                .style('letter-spacing', '0.2px')
                .text(`pid:${lane.pid || '?'}  ${lane.endpoint || '-'}`);

            if (lane.isNew || lane.isHot) {
                laneGroup.append('text')
                    .attr('x', x)
                    .attr('y', 118)
                    .attr('text-anchor', 'middle')
                    .style('font-family', 'Share Tech Mono, monospace')
                    .style('font-size', '10px')
                    .style('fill', lane.isNew ? '#86ffd0' : '#ffd38c')
                    .style('letter-spacing', '0.3px')
                    .text(lane.isNew ? 'NEW' : 'HOT');
            }

            laneGroup
                .style('cursor', 'crosshair')
                .on('mouseenter', (event) => this.showHoverCard(lane, event))
                .on('mousemove', (event) => this.positionHoverCard(event))
                .on('mouseleave', () => this.hideHoverCard());
        });

        const legend = layer.append('g').attr('class', 'crypto-legend');
        const lx = 26;
        const ly = 160;
        legend.append('text')
            .attr('x', lx)
            .attr('y', ly)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '11px')
            .style('fill', '#d2d9e5')
            .text(
                this.selectedClientFilters.size || this.selectedRequesterFilter
                || this.selectedImplementationClassFilter
                    ? `ACTIVE PATHS (${[
                        this.selectedClientFilters.size
                            ? Array.from(this.selectedClientFilters).join(' + ')
                            : null,
                        this.selectedRequesterFilter
                            ? `requester:${this.selectedRequesterFilter.name}`
                            : null,
                        this.selectedImplementationClassFilter
                            ? `class:${this.selectedImplementationClassFilter}`
                            : null
                    ].filter(Boolean).join(' | ')})`
                    : 'ACTIVE PATHS'
            );

        lanes.slice(0, 8).forEach((lane, idx) => {
            legend.append('text')
                .attr('x', lx)
                .attr('y', ly + 22 + idx * 15)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '10px')
                .style('fill', lane.palette.label)
                .text(`${lane.process} -> ${lane.protocol} -> ${lane.algorithm}`);
        });

        const goneY = ly + 165;
        legend.append('text')
            .attr('x', lx)
            .attr('y', goneY)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '10px')
            .style('fill', '#9fa9b9')
            .text('RECENTLY CLOSED');

        this.recentlyGone.slice(0, 5).forEach((item, idx) => {
            const age = Math.max(0, Math.round((Date.now() - item.at) / 1000));
            legend.append('text')
                .attr('x', lx)
                .attr('y', goneY + 16 + idx * 14)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '10px')
            .style('fill', '#8e98a9')
                .text(`- ${item.label} (${age}s)`);
        });
    }

    renderTelemetryPayload(normalized) {
        if (this.activeCryptoView !== 'LINEAR_ANALYSIS') {
            this.renderFlowMap(normalized);
            return;
        }

        const now = Date.now();
        const shouldRender = !this.linearAnalysisRendered
            || (now - this.lastLinearAnalysisRenderAt) >= this.linearAnalysisMinRenderMs;

        if (shouldRender) {
            this.renderFlowMap(normalized);
            return;
        }

        // Keep telemetry fresh without tearing down and rebuilding the analytical SVG.
        this.lastPayload = normalized;
        this.syncOverlayForCurrentView();
    }

    getFallbackTelemetry() {
        return {
            items: [
                { process: 'nginx', protocol: 'TLS', algorithm: 'AES-GCM/SHA256', endpoint: '10.0.0.10:443', pid: 2110, status: 'ESTABLISHED', weight: 2 },
                { process: 'sshd', protocol: 'SSH', algorithm: 'CHACHA20-POLY1305', endpoint: '10.0.0.44:22', pid: 844, status: 'ESTABLISHED', weight: 2 },
                { process: 'curl', protocol: 'TLS', algorithm: 'AES-256-GCM', endpoint: '151.101.1.69:443', pid: 4021, status: 'ESTABLISHED', weight: 1 }
            ],
            meta: {
                ops_per_sec: 960,
                tls_sessions: 2,
                active_flows: 3,
                algorithm_competition: {
                    request: 'AES',
                    implementations: [
                        { name: 'aesni-intel', priority: 300, type: 'skcipher' },
                        { name: 'aes-avx', priority: 200, type: 'skcipher' },
                        { name: 'aes-generic', priority: 100, type: 'skcipher' }
                    ],
                    selected: { name: 'aesni-intel', priority: 300, type: 'skcipher' },
                    selection_policy: 'max-priority'
                },
                algorithm_competitions: {
                    aes: {
                        request: 'AES',
                        implementations: [
                            { name: 'aesni-intel', priority: 300, type: 'skcipher' },
                            { name: 'aes-avx', priority: 200, type: 'skcipher' },
                            { name: 'aes-generic', priority: 100, type: 'skcipher' }
                        ],
                        selected: { name: 'aesni-intel', priority: 300, type: 'skcipher' },
                        selection_policy: 'max-priority'
                    },
                    sha: {
                        request: 'SHA',
                        implementations: [
                            { name: 'sha256-avx2', priority: 240, type: 'shash' },
                            { name: 'sha256-ssse3', priority: 180, type: 'shash' },
                            { name: 'sha256-generic', priority: 100, type: 'shash' }
                        ],
                        selected: { name: 'sha256-avx2', priority: 240, type: 'shash' },
                        selection_policy: 'max-priority'
                    },
                    chacha20: {
                        request: 'CHACHA20',
                        implementations: [
                            { name: 'chacha20-neon', priority: 260, type: 'skcipher' },
                            { name: 'chacha20-simd', priority: 220, type: 'skcipher' },
                            { name: 'chacha20-generic', priority: 100, type: 'skcipher' }
                        ],
                        selected: { name: 'chacha20-neon', priority: 260, type: 'skcipher' },
                        selection_policy: 'max-priority'
                    }
                },
                crypto_stage1: {
                    kernel_clients: [
                        { name: 'kTLS', status: 'active', active_flows: 2 },
                        { name: 'WireGuard', status: 'idle', active_flows: 0 },
                        { name: 'IPsec/XFRM', status: 'idle', active_flows: 0 },
                        { name: 'dm-crypt', status: 'active', active_flows: 1 },
                        { name: 'fscrypt', status: 'idle', active_flows: 0 },
                        { name: 'AF_ALG', status: 'active', active_flows: 1 }
                    ],
                    sync_async: {
                        sync_ops_est: 3,
                        async_ops_est: 2,
                        queue_depth_est: 1,
                        queue_latency_ms_est: 1.28
                    },
                    hw_offload: [
                        { engine: 'AES-NI / CPU INSTR', status: 'active' },
                        { engine: 'SIMD (AVX/NEON)', status: 'available' },
                        { engine: 'ARM CRYPTO EXT', status: 'unavailable' },
                        { engine: 'QAT OFFLOAD', status: 'unavailable' },
                        { engine: 'VIRTIO-CRYPTO', status: 'unavailable' }
                    ]
                },
                crypto_decision_pipeline: {
                    request: 'AES',
                    request_origin: 'kernel client: kTLS',
                    requesters: [
                        { name: 'kTLS', kind: 'kernel-client', score: 3 },
                        { name: 'nginx', kind: 'process', score: 2 },
                        { name: 'AF_ALG', kind: 'kernel-client', score: 1 }
                    ],
                    tfm_lookup: 'crypto_alloc_skcipher(aes)',
                    impl_shortlist: ['aesni-intel', 'aes-avx', 'aes-generic'],
                    priority_check: 'max priority wins',
                    capability_check: 'AES-NI / CPU INSTR, SIMD (AVX/NEON)',
                    selected_driver: 'aesni-intel',
                    fallback_driver: 'aes-generic',
                    fallback_active: false,
                    fallback_reason: 'not-triggered',
                    source: 'mock'
                },
                crypto_decision_pipelines: {
                    aes: {
                        request: 'AES',
                        request_origin: 'kernel client: kTLS',
                        requesters: [
                            { name: 'kTLS', kind: 'kernel-client', score: 3 },
                            { name: 'nginx', kind: 'process', score: 2 },
                            { name: 'AF_ALG', kind: 'kernel-client', score: 1 }
                        ],
                        tfm_lookup: 'crypto_alloc_skcipher(aes)',
                        impl_shortlist: ['aesni-intel', 'aes-avx', 'aes-generic'],
                        priority_check: 'max priority wins',
                        capability_check: 'AES-NI / CPU INSTR, SIMD (AVX/NEON)',
                        selected_driver: 'aesni-intel',
                        fallback_driver: 'aes-generic',
                        fallback_active: false,
                        fallback_reason: 'not-triggered',
                        source: 'mock'
                    },
                    sha: {
                        request: 'SHA',
                        request_origin: 'kernel client: AF_ALG',
                        requesters: [
                            { name: 'AF_ALG', kind: 'kernel-client', score: 2 },
                            { name: 'kTLS', kind: 'kernel-client', score: 1 },
                            { name: 'nginx', kind: 'process', score: 1 }
                        ],
                        tfm_lookup: 'crypto_alloc_shash(sha*)',
                        impl_shortlist: ['sha256-avx2', 'sha256-ssse3', 'sha256-generic'],
                        priority_check: 'max priority wins',
                        capability_check: 'SIMD (AVX/NEON)',
                        selected_driver: 'sha256-avx2',
                        fallback_driver: 'sha256-generic',
                        fallback_active: false,
                        fallback_reason: 'not-triggered',
                        source: 'mock'
                    },
                    chacha20: {
                        request: 'CHACHA20',
                        request_origin: 'kernel client: WireGuard',
                        requesters: [
                            { name: 'WireGuard', kind: 'kernel-client', score: 2 },
                            { name: 'sshd', kind: 'process', score: 1 },
                            { name: 'AF_ALG', kind: 'kernel-client', score: 1 }
                        ],
                        tfm_lookup: 'crypto_alloc_skcipher(chacha20)',
                        impl_shortlist: ['chacha20-neon', 'chacha20-simd', 'chacha20-generic'],
                        priority_check: 'max priority wins',
                        capability_check: 'SIMD (AVX/NEON)',
                        selected_driver: 'chacha20-neon',
                        fallback_driver: 'chacha20-generic',
                        fallback_active: false,
                        fallback_reason: 'not-triggered',
                        source: 'mock'
                    }
                },
                algorithm_requesters: {
                    aes: [
                        { name: 'kTLS', kind: 'kernel-client', score: 3 },
                        { name: 'nginx', kind: 'process', score: 2 },
                        { name: 'AF_ALG', kind: 'kernel-client', score: 1 }
                    ],
                    sha: [
                        { name: 'AF_ALG', kind: 'kernel-client', score: 2 },
                        { name: 'kTLS', kind: 'kernel-client', score: 1 },
                        { name: 'nginx', kind: 'process', score: 1 }
                    ],
                    chacha20: [
                        { name: 'WireGuard', kind: 'kernel-client', score: 2 },
                        { name: 'sshd', kind: 'process', score: 1 },
                        { name: 'AF_ALG', kind: 'kernel-client', score: 1 }
                    ]
                },
                entropy_cloud: {
                    entropy_pool_bits: 238,
                    entropy_pool_size_bits: 256,
                    crng_state: 'ready',
                    random_subsystem_state: 'stable',
                    particle_density: 52,
                    key_birth_rate_est: 7.4,
                    sources: [
                        { source: 'interrupt timing', intensity: 76, status: 'active' },
                        { source: 'disk IO', intensity: 42, status: 'active' },
                        { source: 'network timing', intensity: 38, status: 'active' },
                        { source: 'hardware RNG', intensity: 64, status: 'active' }
                    ],
                    read_wakeup_threshold: 128,
                    write_wakeup_threshold: 64,
                    mode: 'mock'
                },
                source: 'mock'
            }
        };
    }

    fetchAesDemo() {
        // Real AES-128 internals on demo vectors. All AES interactivity (bit
        // flipping, round overlays, key schedule, modes) is gated on this data,
        // so it must load reliably. We deliberately avoid 'force-cache': a stale
        // cached error from an earlier session (before this endpoint existed)
        // would otherwise permanently disable interactivity. On failure we clear
        // the in-flight flag so the telemetry loop can retry until it succeeds.
        if (this.aesDemo || this.aesDemoRequested) return;
        this.aesDemoRequested = true;
        window.fetchJson('/api/crypto-aes-demo', { cache: 'no-store' }, {
            timeoutMs: 8000,
            suppressToast: true,
            context: 'crypto-aes-demo'
        })
            .then((data) => {
                if (!data || data.error || !data.demo_vectors) {
                    this.aesDemoRequested = false;
                    return;
                }
                this.aesDemo = data;
                if (this.isActive && this.lastPayload) {
                    this.renderFlowMap(this.lastPayload);
                }
            })
            .catch(() => { this.aesDemoRequested = false; });
    }

    fetchTelemetry() {
        return window.fetchJson('/api/crypto-realtime', { cache: 'no-store' }, {
            timeoutMs: 6000,
            suppressToast: true,
            context: 'crypto-realtime'
        })
            .then((data) => {
                if (!data || data.error) throw new Error(data?.error || 'No crypto telemetry');
                const normalized = this.normalizeTelemetry(data);
                this.renderTelemetryPayload(normalized);

                if (this.terminatorNode) {
                    const tlsTerminator = this.detectTlsTerminator(data?.meta || {}, normalized.items || []);
                    this.setTerminatorBadge(tlsTerminator);
                }

                if (this.telemetryNode) {
                    const ops = Number(data?.meta?.ops_per_sec || 0);
                    const tls = Number(data?.meta?.tls_sessions || 0);
                    const flows = Number(data?.meta?.active_flows || normalized.items.length || 0);
                    const source = String(data?.meta?.source || 'api');
                    const unknownPid = Number(data?.meta?.unknown_pid_flows || 0);
                    const terms = Array.isArray(data?.meta?.tls_terminators) ? data.meta.tls_terminators.join(',') : '-';
                    const selectedComp = this.getCompetitionPayload(data?.meta || {});
                    const selectedImpl = String(selectedComp?.selected?.name || '-');
                    const reqLabel = String(selectedComp?.request || this.selectedCompetitionAlgorithm || 'AES').toUpperCase();
                    this.telemetryNode.textContent = `ops/s: ${ops} | tls: ${tls} | active: ${flows} | unknown-pid: ${unknownPid} | terminator: ${terms || '-'} | ${reqLabel}: ${selectedImpl} | source: ${source}`;
                }
            })
            .catch(() => {
                const fallback = this.getFallbackTelemetry();
                const normalized = this.normalizeTelemetry(fallback);
                this.renderTelemetryPayload(normalized);
                if (this.terminatorNode) {
                    this.setTerminatorBadge('mock/fallback');
                }
                if (this.telemetryNode) {
                    this.telemetryNode.textContent = `ops/s: ${fallback.meta.ops_per_sec} | tls: ${fallback.meta.tls_sessions} | active flows: ${fallback.meta.active_flows} | source: mock`;
                }
            });
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

        this.fetchTelemetry();
        this.fetchAesDemo();

        if (this.telemetryInterval) clearInterval(this.telemetryInterval);
        this.telemetryInterval = setInterval(() => {
            if (!this.isActive) return;
            this.fetchTelemetry();
            // Retry the (one-shot) AES demo load until it succeeds; without it
            // the AES INTERNALS view stays in its non-interactive fallback.
            if (!this.aesDemo) this.fetchAesDemo();
        }, 1200);
    }

    deactivate() {
        this.isActive = false;
        this.activeAnimationTick += 1;
        this.hideHoverCard();
        if (this.aesOverlay) this.closeAesOpsOverlay();

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
        if (!this.isActive) return;
        this.renderFlowMap(this.lastPayload || this.normalizeTelemetry(this.getFallbackTelemetry()));
    }
}

window.CryptoSubsystemVisualization = CryptoSubsystemVisualization;
debugLog('🔐 crypto-belt.js: CryptoSubsystemVisualization exported to window');
