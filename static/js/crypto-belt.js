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
        this.activeCryptoView = 'LIVE_FLOW';
        this.viewToggleNode = null;
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
            ['LIVE_FLOW', 'LIVE FLOW'],
            ['LINEAR_ANALYSIS', 'LINEAR ANALYSIS']
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
        const rightColumnX = Math.floor(width * 0.67);
        const rightColumnW = Math.max(360, width - rightColumnX - 16);
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
            materialCardH: lowerRowH
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
                .attr('y', baseY + idx * 21)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', idx === 0 ? '10px' : '9.5px')
                .style('fill', idx === 0 ? '#f0f4fb' : '#a7b3c4')
                .text(line);
        });

        const cloudX = cardX + Math.floor(cardW * 0.57);
        const cloudY = cardY + 34;
        const cloudW = cardW - Math.floor(cardW * 0.57) - 14;
        const cloudH = cardH - 46;
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
            const localY = 20 + row * 40 + ((Math.floor(jitter / 7) % 11) - 5);
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
        const panelY = layout.lowerRowY + layout.materialCardH + 16;
        const maxPanelH = Math.max(140, height - panelY - 22);
        const panelH = Math.min(248, maxPanelH);
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
        const cloudW = Math.max(130, panelW - 220);
        const cloudH = Math.max(60, panelH - 102);
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
        const keyBaseX = panelX + panelW - 110;
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

        const srcX = panelX + panelW - 158;
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

    drawLinearAnalysisDashboard(layer, payload, width, height, tickId) {
        const model = this.buildLinearAnalysisModel(payload);
        const items = Array.isArray(payload?.items) ? payload.items : [];
        const runtimeSources = Array.isArray(payload?.runtime_sources)
            ? payload.runtime_sources
            : (Array.isArray(payload?.meta?.runtime_sources) ? payload.meta.runtime_sources : []);
        const primary = items[0] || {};
        const algLabel = model.request === 'AES' ? 'AES-128' : model.request;
        const margin = 10;
        const gap = 8;
        const topY = 82;
        const topH = Math.max(200, Math.floor(height * 0.33));
        const midY = topY + topH + gap;
        const midH = Math.max(170, Math.floor(height * 0.28));
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
            .attr('x', centerX + 8)
            .attr('y', 30)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '18px')
            .style('letter-spacing', '1px')
            .style('fill', '#dfe8f7')
            .text('LINEAR CRYPTOANALYSIS VISUALIZATION');
        layer.append('text')
            .attr('x', centerX + 8)
            .attr('y', 50)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '10px')
            .style('fill', '#9cabc0')
            .text(`${algLabel} - ${model.rounds} ROUNDS - LINEAR APPROXIMATION TRACKING`);

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
                .attr('y', 20)
                .attr('width', 76)
                .attr('height', 22)
                .attr('rx', 4)
                .style('fill', isActive ? 'rgba(38, 63, 98, 0.95)' : 'rgba(7, 11, 17, 0.82)')
                .style('stroke', isActive ? 'rgba(128, 190, 255, 0.86)' : 'rgba(122, 145, 176, 0.32)')
                .style('stroke-width', 1);
            btn.append('text')
                .attr('x', x + 38)
                .attr('y', 35)
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
                .attr('y', 58)
                .attr('width', 108)
                .attr('height', 18)
                .attr('rx', 4)
                .style('fill', 'rgba(8, 13, 20, 0.82)')
                .style('stroke', color)
                .style('stroke-opacity', 0.42);
            layer.append('text')
                .attr('x', x + 8)
                .attr('y', 71)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '8px')
                .style('fill', color)
                .text(`${String(source.label || source.id).slice(0, 11)}:${src}`);
        });

        const ctx = panel(margin, 10, leftW, 116, 'PROCESS CONTEXT');
        [
            ['process', primary.process || 'kernel/user'],
            ['pid', primary.pid || '?'],
            ['protocol', primary.protocol || 'CRYPTO API'],
            ['algorithm', primary.algorithm || `${model.request}-GCM/SHA256`],
            ['kernel path', model.selectedDriver],
            ['cpu flags', model.selectedDriver.includes('aes') ? 'AES-NI, PCLMULQDQ' : 'generic/simd']
        ].forEach(([k, v], idx) => {
            ctx.append('text')
                .attr('x', margin + 14)
                .attr('y', 42 + idx * 13)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '8.8px')
                .style('fill', '#9fb0c7')
                .text(`${k}:`);
            ctx.append('text')
                .attr('x', margin + 76)
                .attr('y', 42 + idx * 13)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '8.8px')
                .style('fill', '#d0dae8')
                .text(String(v).slice(0, 24));
        });

        const flow = panel(margin, 136, leftW, 178, 'DATA FLOW');
        const flowSteps = ['userspace', 'TLS 1.3', 'sendmsg()/recvmsg()', 'AF_ALG', 'crypto_aead_encrypt', `${model.selectedDriver}`];
        flowSteps.forEach((step, idx) => {
            const y = 168 + idx * 24;
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
                    .attr('y2', y + 18)
                    .style('stroke', 'rgba(122, 150, 190, 0.48)');
            }
        });

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
                    const v = Math.sin((model.seed + idx * 11 + row * 7 + col) * 0.22);
                    const cellRect = map.append('rect')
                        .attr('x', x - 13 + col * 7)
                        .attr('y', bitY(row) - 5)
                        .attr('width', 4)
                        .attr('height', 10)
                        .style('fill', heatColor(v))
                        .style('opacity', 0.28 + Math.abs(v) * 0.5)
                        .style('cursor', 'crosshair')
                        .on('mouseenter', (event) => {
                            cellRect.style('opacity', 1).style('stroke', '#ffffff').style('stroke-width', 0.5);
                            showAnalysisTip([
                                `LAT cell    : R${idx} / bit ${row}.${col}`,
                                `mask value  : ${v >= 0 ? '+' : ''}${v.toFixed(4)}`,
                                `bias class  : ${Math.abs(v) > 0.72 ? 'hot approximation' : 'low signal'}`,
                                `source      : deterministic model`
                            ], event);
                        })
                        .on('mousemove', (event) => this.positionHoverCard(event))
                        .on('mouseleave', () => {
                            cellRect.style('opacity', 0.28 + Math.abs(v) * 0.5).style('stroke', 'none');
                            this.hideHoverCard();
                        });
                }
            }
        });
        const bestTrailPath = d3.path();
        layerXs.forEach((x, idx) => {
            const y = bitY((idx * 2 + (model.seed % bitRows)) % bitRows);
            if (idx === 0) bestTrailPath.moveTo(x - 22, y);
            bestTrailPath.lineTo(x, y);
            if (idx === layerXs.length - 1) bestTrailPath.lineTo(mapRight + 26, y);
        });
        map.append('path')
            .attr('d', bestTrailPath.toString())
            .style('fill', 'none')
            .style('stroke', '#ffcf7a')
            .style('stroke-width', 2.2)
            .style('stroke-opacity', 0.9)
            .style('filter', 'url(#crypto-line-glow)');
        map.append('text')
            .attr('x', mapLeft + 8)
            .attr('y', mapTop - 22)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '9px')
            .style('fill', '#ffcf7a')
            .text(`BEST LINEAR TRAIL | bias +${model.maxBias.toFixed(5)} | live-source score ${runtimeQuality}`);
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

        const info = panel(centerX + centerW + gap, topY, rightW, 138, 'LINEAR APPROXIMATION INFO');
        [
            `approximation:`,
            `P[L(P,K) = L(C)] = ${(0.5 + model.maxBias).toFixed(7)}`,
            `bias: +${model.maxBias.toFixed(7)}`,
            `correlation: +${(model.maxBias * 2).toFixed(7)}`,
            `mask(hex):`,
            `P: 0x${(model.seed & 0xffff).toString(16).padStart(4, '0')}`,
            `C: 0x${((model.seed * 17) & 0xffff).toString(16).padStart(4, '0')}`,
            `rounds: ${model.rounds}/${model.rounds}`,
            `quality: good`
        ].forEach((line, idx) => {
            info.append('text')
                .attr('x', centerX + centerW + gap + 12)
                .attr('y', topY + 42 + idx * 11)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '8.2px')
                .style('fill', idx === 2 || idx === 8 ? '#8effc8' : '#b3bfd0')
                .text(line);
        });
        const biasPanel = panel(centerX + centerW + gap, topY + 146, rightW, topH - 146, 'BIAS OVER ROUNDS');
        const chartX = centerX + centerW + gap + 34;
        const chartY = topY + 186;
        const chartW = rightW - 58;
        const chartH = topH - 202;
        biasPanel.append('line').attr('x1', chartX).attr('x2', chartX + chartW).attr('y1', chartY + chartH / 2).attr('y2', chartY + chartH / 2).style('stroke', 'rgba(116, 138, 170, 0.28)');
        const bp = d3.path();
        model.bestTrail.forEach((step, idx) => {
            const x = chartX + (chartW / Math.max(1, model.bestTrail.length - 1)) * idx;
            const y = chartY + chartH * 0.5 - Math.sin(idx * 0.8 + model.seed) * chartH * 0.2 - (step.bias / model.maxBias) * chartH * 0.28;
            if (idx === 0) bp.moveTo(x, y);
            else bp.lineTo(x, y);
            biasPanel.append('circle').attr('cx', x).attr('cy', y).attr('r', 2).style('fill', idx > model.bestTrail.length * 0.55 ? '#ff9a55' : '#9d55ff');
        });
        biasPanel.append('path').attr('d', bp.toString()).style('fill', 'none').style('stroke', '#ff8655').style('stroke-width', 1.5);

        const diffW = Math.max(320, width * 0.33);
        const keyW = Math.max(320, width * 0.33);
        const entropyW = width - margin * 2 - diffW - keyW - gap * 2;
        const diff = panel(margin, midY, diffW, midH, 'DIFFUSION & AVALANCHE VISUALIZATION', 'FLIP 1 BIT IN PLAINTEXT -> OBSERVE PROPAGATION');
        const cell = Math.max(5, Math.min(10, (diffW - 58) / 38));
        for (let round = 0; round < Math.min(10, model.rounds + 1); round += 1) {
            const gx = margin + 24 + (round % 5) * ((diffW - 48) / 5);
            const gy = midY + 54 + Math.floor(round / 5) * ((midH - 78) / 2);
            diff.append('text').attr('x', gx).attr('y', gy - 8).style('font-family', 'Share Tech Mono, monospace').style('font-size', '7.5px').style('fill', '#8fa0b8').text(`ROUND ${round}`);
            for (let a = 0; a < 6; a += 1) {
                for (let b = 0; b < 6; b += 1) {
                    const v = Math.abs(Math.sin((model.seed + round * 13 + a * 5 + b) * 0.2));
                    diff.append('circle').attr('cx', gx + b * cell * 1.6).attr('cy', gy + a * cell * 1.45).attr('r', cell * 0.42).style('fill', heatColor(v - 0.35)).style('opacity', 0.25 + v * 0.65);
                }
            }
        }

        const keyX = margin + diffW + gap;
        const key = panel(keyX, midY, keyW, midH, 'KEY HYPOTHESIS SPACE (RANKING)');
        const kcx = keyX + keyW * 0.5;
        const kcy = midY + midH * 0.55;
        const bestKey = {
            x: kcx + keyW * 0.23,
            y: kcy - midH * 0.18
        };
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
            .style('fill', '#9dafc5')
            .text(`entropy slope: ${(model.correlationDecay * 100).toFixed(0)}% | rounds ${model.rounds}`);

        const bottomPanels = [
            [margin, bottomY, width * 0.56 - margin, bottomH, 'KERNEL CRYPTO METRICS'],
            [width * 0.56 + gap, bottomY, width * 0.22, bottomH, 'ACTIVE ALGORITHMS (LIVE)'],
            [width * 0.78 + gap * 2, bottomY, width * 0.22 - margin * 2, bottomH, 'EVENT LOG (CRYPTO)']
        ];
        const metrics = panel(...bottomPanels[0]);
        const metricItems = [
            ['entropy pool', '256/256 bits', '#8fdcff'],
            ['rng health', 'good', '#8effc8'],
            ['aes-ni usage', `${Math.round(model.confidence * 100)}%`, '#9dffca'],
            ['avg latency', `${(model.maxBias * 100).toFixed(2)} us`, '#d6e3f4'],
            ['throughput', `${(items.length * 0.7 + 1.8).toFixed(2)} GB/s`, '#d6e3f4'],
            ['bias alert', model.maxBias > 0.06 ? 'watch' : 'none', '#ffcf8d']
        ];
        metricItems.forEach((m, idx) => {
            const x = margin + 14 + idx * ((width * 0.56 - 44) / metricItems.length);
            metrics.append('text').attr('x', x).attr('y', bottomY + 38).style('font-family', 'Share Tech Mono, monospace').style('font-size', '8.5px').style('fill', '#8fa0b8').text(m[0]);
            metrics.append('text').attr('x', x).attr('y', bottomY + 56).style('font-family', 'Share Tech Mono, monospace').style('font-size', '10px').style('fill', m[2]).text(m[1]);
            spark(metrics, x, bottomY + 66, 58, Math.max(12, bottomH - 78), model.seed + idx * 9, m[2]);
        });
        const algos = panel(...bottomPanels[1]);
        ['AES-GCM', 'ChaCha20-Poly1305', 'SHA256'].forEach((name, idx) => {
            const isSelected = name.toLowerCase().includes(model.request.toLowerCase().replace('20', ''));
            algos.append('text').attr('x', width * 0.56 + gap + 14).attr('y', bottomY + 42 + idx * 24).style('font-family', 'Share Tech Mono, monospace').style('font-size', '9px').style('fill', '#d2dce9').text(name);
            algos.append('text').attr('x', width * 0.56 + gap + width * 0.15).attr('y', bottomY + 42 + idx * 24).style('font-family', 'Share Tech Mono, monospace').style('font-size', '9px').style('fill', isSelected ? '#ffcf7a' : '#8effc8').text(isSelected ? 'selected' : 'active');
        });
        const log = panel(...bottomPanels[2]);
        [
            `crypto_req ${model.request.toLowerCase()}: init`,
            `${model.selectedDriver}: setkey`,
            `best trail locked bias=${model.maxBias.toFixed(5)}`,
            `runtime sources score=${runtimeQuality}`,
            `${model.request.toLowerCase()} done (${(model.maxBias * 100).toFixed(2)}us)`
        ].forEach((line, idx) => {
            log.append('text').attr('x', width * 0.78 + gap * 2 + 12).attr('y', bottomY + 40 + idx * 17).style('font-family', 'Share Tech Mono, monospace').style('font-size', '8.5px').style('fill', '#9fb0c7').text(`[${idx + 19}:21:3${idx}] ${line}`.slice(0, 42));
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

        const width = window.innerWidth;
        const height = window.innerHeight;
        this.svg.attr('viewBox', `0 0 ${width} ${height}`);
        this.svg.selectAll('.crypto-flow-layer').remove();

        const layer = this.svg.append('g').attr('class', 'crypto-flow-layer');
        this.drawGrid(layer, width, height);
        if (this.activeCryptoView === 'LINEAR_ANALYSIS') {
            this.drawLinearAnalysisView(layer, payload, width, height, tickId);
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
        const topY = 150;
        const protocolY = 250;
        const cryptoY = 350;
        const algoY = 450;
        const endpointY = 520;

        const startX = width * 0.16;
        const usableWidth = width * 0.52;
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

    fetchTelemetry() {
        return window.fetchJson('/api/crypto-realtime', { cache: 'no-store' }, {
            timeoutMs: 6000,
            suppressToast: true,
            context: 'crypto-realtime'
        })
            .then((data) => {
                if (!data || data.error) throw new Error(data?.error || 'No crypto telemetry');
                const normalized = this.normalizeTelemetry(data);
                this.renderFlowMap(normalized);

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
                this.renderFlowMap(normalized);
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

        if (this.telemetryInterval) clearInterval(this.telemetryInterval);
        this.telemetryInterval = setInterval(() => {
            if (this.isActive) this.fetchTelemetry();
        }, 1200);
    }

    deactivate() {
        this.isActive = false;
        this.activeAnimationTick += 1;
        this.hideHoverCard();

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
