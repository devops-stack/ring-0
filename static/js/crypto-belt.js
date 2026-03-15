// Crypto subsystem realtime interaction visualization
// Version: 4

debugLog('🔐 crypto-belt.js v4: Script loading...');

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

    drawAlgorithmCompetition(layer, meta, width) {
        const comp = this.getCompetitionPayload(meta);
        const request = String(comp.request || this.selectedCompetitionAlgorithm || 'AES').toUpperCase();
        const impls = Array.isArray(comp.implementations) ? comp.implementations.slice(0, 5) : [];
        const selectedName = String(comp?.selected?.name || '').toLowerCase();

        const panelX = Math.floor(width * 0.73);
        const panelY = 130;
        const panelW = Math.max(260, Math.floor(width * 0.24));
        const panelH = Math.max(220, 170 + impls.length * 30);

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

        const stepsY = panelY + 92;
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
            .attr('y2', stepsY + 28)
            .style('stroke', '#7c8ca2')
            .style('stroke-width', 1);

        panel.append('text')
            .attr('x', panelX + 14)
            .attr('y', stepsY + 42)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '10px')
            .style('fill', '#b3bece')
            .text('CRYPTO LOOKUP');

        const baseY = stepsY + 64;
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
            const y = baseY + idx * 30;
            const name = String(impl.name || 'unknown');
            const prio = Number(impl.priority || 0);
            const isSelected = name.toLowerCase() === selectedName;

            panel.append('rect')
                .attr('x', panelX + 12)
                .attr('y', y - 12)
                .attr('width', panelW - 24)
                .attr('height', 22)
                .attr('rx', 5)
                .style('fill', isSelected ? 'rgba(20, 39, 29, 0.9)' : 'rgba(14, 18, 24, 0.85)')
                .style('stroke', isSelected ? 'rgba(114, 242, 173, 0.8)' : 'rgba(150, 162, 182, 0.28)')
                .style('stroke-width', isSelected ? 1.2 : 0.8);

            panel.append('text')
                .attr('x', panelX + 20)
                .attr('y', y + 2)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '10px')
                .style('fill', isSelected ? '#9effca' : '#c5cedb')
                .text(`${name}  priority ${prio}`);

            if (isSelected) {
                panel.append('text')
                    .attr('x', panelX + panelW - 70)
                    .attr('y', y + 2)
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
        const panelX = Math.floor(width * 0.73);
        const panelW = Math.max(260, Math.floor(width * 0.24));
        const panelY = Math.max(450, Math.floor(height * 0.52));
        const panelH = 278;

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
                    .attr('y', panelY + 46 + idx * 14)
                    .attr('width', panelW - 20)
                    .attr('height', 13)
                    .attr('rx', 3)
                .style('fill', isActiveRequester ? 'rgba(37, 58, 92, 0.62)' : 'transparent')
                .style('stroke', isActiveRequester ? 'rgba(120, 170, 245, 0.72)' : 'transparent')
                    .style('stroke-width', 0.8);
                row.append('text')
                    .attr('x', panelX + 14)
                    .attr('y', panelY + 56 + idx * 14)
                    .style('font-family', 'Share Tech Mono, monospace')
                    .style('font-size', '9px')
                    .style('fill', isActiveRequester ? '#e1eeff' : (idx === 0 ? '#cce2ff' : '#95a6bc'))
                    .text(`- ${reqName} [${reqKind}] (${reqScore})`);
            });
        }

        const stepsBaseY = panelY + 102;
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
                .attr('y', stepsBaseY + idx * 22)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '10px')
                .style('fill', idx === 5 ? '#a4ffcf' : '#b8c3d4')
                .text(line);
        });

        panel.append('text')
            .attr('x', panelX + 14)
            .attr('y', panelY + 240)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '10px')
            .style('fill', fallbackActive ? '#ffb0b0' : '#95a6bc')
            .text(`fallback: ${fallbackDriver} (${fallbackActive ? 'active' : 'not active'})`);

        panel.append('text')
            .attr('x', panelX + 14)
            .attr('y', panelY + 258)
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

        const rightColumnX = Math.floor(width * 0.73);
        const cardX = Math.floor(width * 0.41) + 10;
        const maxSafeW = Math.max(300, rightColumnX - cardX - 16);
        const cardW = Math.max(330, Math.min(Math.min(470, Math.floor(width * 0.3)), maxSafeW));
        const cardH = 226;
        const decisionPanelY = Math.max(450, Math.floor(height * 0.52));
        const cardY = decisionPanelY;

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
        const rightColumnX = Math.floor(width * 0.73);
        const panelX = Math.floor(width * 0.41) + 10;
        const maxSafeW = Math.max(300, rightColumnX - panelX - 16);
        const panelW = Math.max(330, Math.min(Math.min(470, Math.floor(width * 0.3)), maxSafeW));
        const panelH = 238;
        const decisionPanelY = Math.max(450, Math.floor(height * 0.52));
        const materialCardH = 226;
        const panelY = Math.min(height - panelH - 22, decisionPanelY + materialCardH + 16);
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
        const cloudH = panelH - 100;
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
        const keyBaseY = panelY + 112;
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
        const srcY = panelY + 152;
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

        const panelW = Math.max(270, Math.floor(width * 0.23));
        const baseX = 26;
        const gap = 12;
        const clientsH = 134;
        const queueH = 86;
        const offloadH = 116;
        const totalH = clientsH + queueH + offloadH + (gap * 2);
        // Keep stage-1 HUD fully visible even on shorter viewports.
        const baseY = Math.max(180, height - totalH - 20);
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
        const width = Math.min(Math.max(150, String(label).length * 8 + 28), 250);
        const height = 34;
        const radius = 8;
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
            .style('font-size', '11px')
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
        this.drawProtocolLegend(layer);
        this.drawEntropyCloud(layer, payload?.meta || {}, width, height);
        this.drawAlgorithmCompetition(layer, payload?.meta || {}, width);
        this.drawDecisionPipeline(layer, payload?.meta || {}, width, height);
        this.drawAlgorithmMaterialCard(layer, payload?.meta || {}, width, height);
        this.drawStage1Panels(layer, payload?.meta || {}, width, height);

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
        return fetch('/api/crypto-realtime', { cache: 'no-store' })
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
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
