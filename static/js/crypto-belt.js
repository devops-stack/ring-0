// Crypto subsystem realtime interaction visualization
// Version: 15 — Architecture + consumer/primitive morph

debugLog('🔐 crypto-belt.js v15: Script loading...');

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
        // Default: AES LAB first; Architecture and Live Flow are secondary.
        this.activeCryptoView = 'LINEAR_ANALYSIS';
        this.archFocus = null; // { layer, id, label, hint }
        this.archMorphTarget = null; // { id, label, layer }
        this.archMorphNode = null;
        this.schemeSource = null; // { id, label } — opened from Architecture click
        this.schemeKind = 'aes-gcm'; // aes-gcm | wg-chacha
        this.schemePhase = 0;
        this.schemePlaying = false;
        this._schemePlayTimer = null;
        this.schemeRendered = false;
        this.handshakeRendered = false;
        this.schemeNr = 10; // AES-128=10, AES-256=14
        this.schemeInspectByte = 0;
        this._archGhostEl = null;
        this._archGhostTimer = null;
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
        title.textContent = 'KERNEL CRYPTO ARCHITECTURE';
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
        subtitle.textContent = 'consumers → Kernel Crypto API → primitives / drivers / acceleration';
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

        const morph = document.createElement('div');
        morph.className = 'crypto-arch-morph-host';
        morph.style.cssText = [
            'position: absolute',
            'left: 50%',
            'top: 50%',
            'transform: translate(-50%, -50%)',
            'width: min(560px, 86vw)',
            'max-height: min(72vh, 640px)',
            'overflow: auto',
            'z-index: 1005',
            'display: none',
            'pointer-events: auto'
        ].join(';');
        this.container.appendChild(morph);
        this.archMorphNode = morph;
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
            ['LINEAR_ANALYSIS', 'AES LAB'],
            ['ARCHITECTURE', 'ARCHITECTURE'],
            ['HANDSHAKE', 'HANDSHAKE'],
            ['LIVE_FLOW', 'LIVE FLOW']
        ];
        this.viewToggleNode.innerHTML = '';
        views.forEach(([id, label]) => {
            const btn = document.createElement('button');
            const isActive = this.activeCryptoView === id;
            btn.textContent = label;
            btn.title = ({
                ARCHITECTURE: 'Consumers → Crypto API → implementations · click kTLS/AES for scheme',
                HANDSHAKE: 'TLS 1.3: Hello → Certificate (auth) → X25519 → HKDF → AES-GCM',
                LIVE_FLOW: 'Live interaction lanes',
                LINEAR_ANALYSIS: 'AES linear analysis demo'
            })[id] || label;
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
                if (id !== 'ARCHITECTURE') this.closeArchMorph();
                if (id !== 'SCHEME') {
                    this.stopSchemePlay();
                    this.schemeSource = null;
                    this.schemeRendered = false;
                }
                // Re-enter HANDSHAKE with a fresh step cascade; leave clears the latch.
                this.handshakeRendered = false;
                if (id !== 'HANDSHAKE') {
                    if (this._handshakeTheater) this._handshakeTheater.stopAuto();
                    if (this._handshakeKeyHandler) {
                        window.removeEventListener('keydown', this._handshakeKeyHandler);
                        this._handshakeKeyHandler = null;
                    }
                    this._handshakeTheater = null;
                    this._handshakeTronBoard = null;
                }
                this.activeCryptoView = id;
                this.updateCryptoViewToggle();
                this.syncOverlayForCurrentView();
                this.renderFlowMap(this.lastPayload || this.normalizeTelemetry(this.getFallbackTelemetry()));
            };
            this.viewToggleNode.appendChild(btn);
        });
    }

    syncOverlayForCurrentView() {
        const isLinear = this.activeCryptoView === 'LINEAR_ANALYSIS';
        const isArch = this.activeCryptoView === 'ARCHITECTURE';
        const isScheme = this.activeCryptoView === 'SCHEME';
        const isHandshake = this.activeCryptoView === 'HANDSHAKE';
        if (this.titleNode) {
            this.titleNode.style.display = isLinear ? 'none' : 'block';
            if (isArch) this.titleNode.textContent = 'KERNEL CRYPTO ARCHITECTURE';
            else if (isScheme) {
                const src = this.schemeSource?.label || this.schemeSource?.id || 'AES';
                const tail = this.schemeKind === 'wg-chacha' ? 'CHACHA20-POLY1305' : 'AES-GCM';
                this.titleNode.textContent = `SCHEME · ${String(src).toUpperCase()} → ${tail}`;
            } else if (isHandshake) this.titleNode.textContent = 'TLS 1.3 · HANDSHAKE → KEYS';
            else if (!isLinear) this.titleNode.textContent = 'KERNEL CRYPTO LIVE INTERACTIONS';
        }
        if (this.subtitleNode) {
            this.subtitleNode.style.display = isLinear ? 'none' : 'block';
            if (isArch) {
                this.subtitleNode.textContent = 'click kTLS/AES or WireGuard/ChaCha for textbook SCHEME · other nodes → morph';
            } else if (isScheme) {
                const kind = this.schemeKind === 'wg-chacha' ? 'WireGuard · ChaCha20-Poly1305' : 'kTLS · AES-GCM';
                this.subtitleNode.textContent = `opened from Architecture · ${kind} · CODE refs → Elixir`;
            } else if (isHandshake) {
                this.subtitleNode.textContent = 'TLS story · theater + GRID board expand each step (userspace → Crypto API → kTLS)';
            } else if (!isLinear) {
                this.subtitleNode.textContent = 'process -> protocol -> crypto subsystem -> algorithm';
            }
        }
        if (this.terminatorNode) {
            // Architecture map is structural — hide TLS terminator chrome.
            this.terminatorNode.style.display = (isLinear || isArch) ? 'none' : 'block';
        }
        if (this.viewToggleNode) {
            this.viewToggleNode.style.top = '18px';
            this.viewToggleNode.style.left = 'auto';
            this.viewToggleNode.style.right = '170px';
            this.viewToggleNode.style.transform = 'none';
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
            const gfSteps = [];
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
                // Drill-down: this step is Y_{s+1} = (Y_s ⊕ block_{s+1}) · H in GF(2^128).
                const Xin = yStates[s].map((v, j) => v ^ (absorbed[s].block[j] & 0xff));
                gfSteps.push({ label: absorbed[s].label, X: Xin, H, prevY: yStates[s], block: absorbed[s].block, resultY: yStates[s + 1] });
                g.style('cursor', 'pointer').on('click', () => this.openGfMulOverlay(s));
                stepNodes.push({ g, rect: g.select('rect'), step: s });
                prevX = cx;
            }
            this._aesGfSteps = gfSteps;
            // Hint that the chain is drill-downable.
            box.append('text').attr('x', px + 22).attr('y', chainY + 46)
                .style('font-family', 'Share Tech Mono, monospace').style('font-size', '7px').style('fill', '#8a7fce')
                .text('click any Y-node to watch its (Y ⊕ block) · H carry-less multiply in GF(2^128)');
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

    // Pure math for the GCM demo (CTR lanes + GHASH accumulation). Shared by the
    // GCM overlay and the standalone GHASH-multiply entry so the two never drift.
    _computeGcmDemo() {
        const R = window.AESRef;
        if (!this.aesDemo || !R) return null;
        const key = R.hexToBytes(this.aesDemo.demo_vectors.key);
        if (key.length !== 16) return null;
        const nonce = R.hexToBytes('00112233445566778899aabb');
        const lanes = [];
        for (let b = 0; b < 4; b += 1) {
            const ctr = nonce.concat([0, 0, 0, b + 1]);
            const ks = R.encryptTrace(ctr, key).ciphertext;
            const pt = [];
            for (let i = 0; i < 16; i += 1) pt.push((0x40 + b * 16 + i) & 0xff);
            const ct = ks.map((v, i) => v ^ pt[i]);
            lanes.push({ b, ctr, ks, pt, ct });
        }
        const H = R.encryptTrace(new Array(16).fill(0), key).ciphertext;
        const aad = R.hexToBytes('6b65726e656c2d61693a67636d2001');
        while (aad.length < 16) aad.push(0);
        const cBlocks = lanes.map((ln) => ln.ct);
        const lenBlock = R.be64(16 * 8).concat(R.be64(cBlocks.length * 16 * 8));
        const absorbed = [{ label: 'AAD', block: aad, kind: 'aad' }]
            .concat(cBlocks.map((blk, i) => ({ label: `C${i + 1}`, block: blk, kind: 'ct' })))
            .concat([{ label: 'LEN', block: lenBlock, kind: 'len' }]);
        const yStates = R.ghashSteps(H, absorbed.map((a) => a.block));
        const gfSteps = absorbed.map((a, s) => ({
            label: a.label,
            X: yStates[s].map((v, j) => v ^ (a.block[j] & 0xff)),
            H,
            prevY: yStates[s],
            block: a.block,
            resultY: yStates[s + 1]
        }));
        return { key, nonce, lanes, H, aad, absorbed, yStates, gfSteps };
    }

    // Direct entry: open the GF(2^128) multiply without going through GCM first.
    openGhashMul(stepIndex = 1) {
        if (!this._aesGfSteps || !this._aesGfSteps.length) {
            const gcm = this._computeGcmDemo();
            if (!gcm) return;
            this._aesGfSteps = gcm.gfSteps;
        }
        this.openGfMulOverlay(Math.min(Math.max(stepIndex, 0), this._aesGfSteps.length - 1));
    }

    openGfMulOverlay(stepIndex) {
        if (!this._aesGfSteps || !this._aesGfSteps[stepIndex]) return;
        this.aesOverlay = 'gfmul';
        this._aesGfIndex = stepIndex;
        this.aesOpsClock = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        this.renderGfMulOverlay();
    }

    renderGfMulOverlay() {
        if (!this.svg || this.aesOverlay !== 'gfmul' || !window.AESRef) return;
        const R = window.AESRef;
        const step = (this._aesGfSteps || [])[this._aesGfIndex];
        if (!step) return;
        const trace = R.gfmul128Trace(step.X, step.H);
        const hex = (b, n = 16) => b.slice(0, n).map((v) => (v & 0xff).toString(16).padStart(2, '0')).join('');

        const shell = this._aesOverlayShell(
            `GHASH MULTIPLY · (Y_prev ⊕ ${step.label}) · H  in GF(2^128)`,
            'carry-less (XOR) multiply with reduction by x^128 + x^7 + x^2 + x + 1 · 128 shift-and-add steps'
        );
        const { box, px, py, panelW, panelH } = shell;

        // Back-to-GCM affordance (× / backdrop still fully close).
        const backG = box.append('g').style('cursor', 'pointer').on('click', () => this.openModeOverlay('GCM'));
        backG.append('rect').attr('x', px + panelW - 320).attr('y', py + 14).attr('width', 108).attr('height', 20).attr('rx', 4)
            .style('fill', 'rgba(7,11,17,0.82)').style('stroke', 'rgba(122,145,176,0.5)');
        backG.append('text').attr('x', px + panelW - 266).attr('y', py + 28).attr('text-anchor', 'middle')
            .style('font-family', 'Share Tech Mono, monospace').style('font-size', '9px').style('fill', '#cfe3ff').text('‹ BACK TO GCM');

        // Block navigation: browse every GHASH multiply (AAD, C1..Cn, LEN).
        const steps = this._aesGfSteps || [];
        const idx = this._aesGfIndex;
        const navY = py + 52;
        const goTo = (i) => { if (i >= 0 && i < steps.length) this.openGfMulOverlay(i); };
        box.append('text').attr('x', px + 22).attr('y', navY + 14)
            .style('font-family', 'Share Tech Mono, monospace').style('font-size', '8px').style('fill', '#7f8ea3').text('BLOCK');
        let nx = px + 22 + 40;
        const mkArrow = (label, i) => {
            const on = i >= 0 && i < steps.length;
            const g = box.append('g').style('cursor', on ? 'pointer' : 'default');
            if (on) g.on('click', () => goTo(i));
            g.append('rect').attr('x', nx).attr('y', navY).attr('width', 20).attr('height', 20).attr('rx', 4)
                .style('fill', 'rgba(7,11,17,0.82)').style('stroke', on ? 'rgba(122,145,176,0.5)' : 'rgba(122,145,176,0.16)');
            g.append('text').attr('x', nx + 10).attr('y', navY + 14).attr('text-anchor', 'middle')
                .style('font-family', 'Share Tech Mono, monospace').style('font-size', '11px').style('fill', on ? '#cfe3ff' : '#46525f').text(label);
            nx += 24;
        };
        mkArrow('‹', idx - 1);
        steps.forEach((st, i) => {
            const on = i === idx;
            const bw = 34;
            const g = box.append('g').style('cursor', 'pointer').on('click', () => goTo(i));
            g.append('rect').attr('x', nx).attr('y', navY).attr('width', bw).attr('height', 20).attr('rx', 4)
                .style('fill', on ? 'rgba(38,63,98,0.95)' : 'rgba(7,11,17,0.82)')
                .style('stroke', on ? 'rgba(128,190,255,0.86)' : 'rgba(122,145,176,0.32)');
            g.append('text').attr('x', nx + bw / 2).attr('y', navY + 14).attr('text-anchor', 'middle')
                .style('font-family', 'Share Tech Mono, monospace').style('font-size', '8px')
                .style('fill', on ? '#d8eaff' : '#9dafc5').text(st.label);
            nx += bw + 4;
        });
        mkArrow('›', idx + 1);

        // Operand readouts.
        const opY = py + 96;
        const opText = (x, label, val, color) => {
            box.append('text').attr('x', x).attr('y', opY).style('font-family', 'Share Tech Mono, monospace').style('font-size', '8px').style('fill', color).text(label);
            box.append('text').attr('x', x).attr('y', opY + 13).style('font-family', 'Share Tech Mono, monospace').style('font-size', '8px').style('fill', '#c5d0df').text(hex(val));
        };
        opText(px + 22, `X = Y_prev ⊕ ${step.label}  (multiplier)`, step.X, '#8fdcff');
        opText(px + 22 + (panelW - 44) * 0.52, 'H = AES_K(0)  (multiplicand)', step.H, '#d9c2ff');

        // Three 16×8 bit grids: X (multiplier), V (running H·x^i), Z (accumulator).
        const cols = 16, rows = 8;
        const gap = 26;
        const gridW = Math.min((panelW - 44 - gap * 2) / 3, 300);
        const cs = Math.min(gridW / cols, 15);
        const gy0 = py + 130;
        const mkGrid = (gx, title, color) => {
            box.append('text').attr('x', gx).attr('y', gy0 - 7).style('font-family', 'Share Tech Mono, monospace').style('font-size', '8px').style('fill', color).text(title);
            const cells = [];
            for (let i = 0; i < 128; i += 1) {
                const c = i % cols, r = (i / cols) | 0;
                cells.push(box.append('rect')
                    .attr('x', gx + c * cs).attr('y', gy0 + r * cs).attr('width', cs - 1.6).attr('height', cs - 1.6).attr('rx', 1.5)
                    .style('fill', 'rgba(40,52,74,0.5)'));
            }
            return cells;
        };
        const xCells = mkGrid(px + 22, 'X bits (MSB→LSB, consumed left→right)', '#8fdcff');
        const vCells = mkGrid(px + 22 + gridW + gap, 'V = H·xⁱ (shift + reduce)', '#d9c2ff');
        const zCells = mkGrid(px + 22 + 2 * (gridW + gap), 'Z accumulator → product', '#8effc8');

        const annoY = gy0 + rows * cs + 26;
        const anno = box.append('text').attr('x', px + 22).attr('y', annoY)
            .style('font-family', 'Share Tech Mono, monospace').style('font-size', '9px').style('fill', '#e6edf8');
        const counter = box.append('text').attr('x', px + panelW - 24).attr('y', annoY).attr('text-anchor', 'end')
            .style('font-family', 'Share Tech Mono, monospace').style('font-size', '9px').style('fill', '#9fb1c8');
        const barY = annoY + 10;
        box.append('rect').attr('x', px + 22).attr('y', barY).attr('width', panelW - 44).attr('height', 4).attr('rx', 2).style('fill', 'rgba(40,52,74,0.6)');
        const barFill = box.append('rect').attr('x', px + 22).attr('y', barY).attr('width', 0).attr('height', 4).attr('rx', 2).style('fill', '#8effc8');
        const resultText = box.append('text').attr('x', px + 22).attr('y', barY + 24)
            .style('font-family', 'Share Tech Mono, monospace').style('font-size', '9px').style('fill', '#8effc8');

        this._aesGfViz = { trace, X: step.X, H: step.H, xCells, vCells, zCells, anno, counter, barFill, resultText, resultY: step.resultY, hex, barW: panelW - 44 };
        this._startGfMulAnim();
    }

    _startGfMulAnim() {
        if (this._aesOpsRaf) cancelAnimationFrame(this._aesOpsRaf);
        const viz = this._aesGfViz;
        if (!viz) return;
        const steps = viz.trace.steps;
        const N = steps.length;
        const stepMs = 42, holdMs = 1600;
        const cycle = N * stepMs + holdMs;
        const dim = 'rgba(40,52,74,0.5)';
        const bitOf = (arr, i) => (arr[i >> 3] >> (7 - (i & 7))) & 1;
        let lastK = -2;
        const frame = () => {
            if (this.aesOverlay !== 'gfmul' || !this.svg || this.svg.selectAll('.aes-ops-overlay').empty()) {
                this._aesOpsRaf = null;
                return;
            }
            const now = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
            const elapsed = (now - (this.aesOpsClock || now)) % cycle;
            let k = Math.floor(elapsed / stepMs);
            const done = k >= N;
            if (k >= N) k = N - 1;
            if (k !== lastK) {
                lastK = k;
                const st = steps[k];
                const vBefore = k === 0 ? viz.H : steps[k - 1].v; // value that is XORed at step k
                viz.xCells.forEach((cell, i) => {
                    const b = bitOf(viz.X, i);
                    if (i === k && !done) cell.style('fill', '#ffffff').style('opacity', 1);
                    else if (i < k || done) cell.style('fill', b ? 'rgba(120,200,255,0.55)' : 'rgba(40,52,74,0.32)').style('opacity', 0.85);
                    else cell.style('fill', b ? '#8fdcff' : dim).style('opacity', b ? 0.9 : 0.4);
                });
                viz.vCells.forEach((cell, i) => {
                    const b = bitOf(vBefore, i);
                    cell.style('fill', b ? '#d9c2ff' : dim).style('opacity', b ? 0.9 : 0.4);
                });
                viz.zCells.forEach((cell, i) => {
                    const b = bitOf(done ? viz.resultY : st.z, i);
                    cell.style('fill', b ? '#8effc8' : dim).style('opacity', b ? 0.95 : 0.4);
                });
                viz.anno.text(done
                    ? 'complete · Z is the product (Y ⊕ block)·H'
                    : `bit ${k} of X = ${st.bit}  →  ${st.bit ? 'Z ^= V' : 'skip (bit is 0)'}   ·   then V = V·x${st.reduced ? '  ⊕ R  (reduction fired)' : ''}`);
                viz.counter.text(`${done ? N : k + 1} / ${N}`);
                viz.barFill.attr('width', ((done ? N : k + 1) / N) * viz.barW);
                if (done) {
                    const ok = viz.hex(viz.trace.result) === viz.hex(viz.resultY);
                    viz.resultText.style('fill', ok ? '#8effc8' : '#ff9a9a')
                        .text(`Z = ${viz.hex(viz.trace.result)}  ${ok ? '✓ equals the Y-node in the GHASH chain' : '⚠ mismatch'}`);
                } else {
                    viz.resultText.text('');
                }
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
                ['GCM / CTR MODE', () => this.openModeOverlay(this.aesModeKind || 'CTR')],
                ['GHASH ⊗ GF(2¹²⁸)', () => this.openGhashMul(1)]
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

    escapeArchHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    getConsumerMorphScript(id) {
        const scripts = {
            wireguard: {
                title: 'WIREGUARD → CRYPTO TRANSLATION',
                tagline: 'a tunnel is not “encrypted packets” — it is Noise + AEAD through the crypto API',
                ghost: 'crypto_aead_encrypt()',
                accent: 'rgba(150,255,190,0.45)',
                steps: [
                    { sym: 'wg_encrypt / noise_handshake', title: '1 · CONSUMER', body: 'WireGuard builds a Noise_IK message<br><span style="color:#8d99a7;font-size:10px;">peer keys · counters · packet payload</span>' },
                    { sym: 'crypto_alloc_aead / crypto_alloc_kpp', title: '2 · CRYPTO API', body: 'request <span style="color:#e6c15a">aead</span> + <span style="color:#a9d4e8">kpp</span><br><span style="color:#8d99a7;font-size:10px;">name lookup → tfm allocation</span>' },
                    { sym: 'struct crypto_aead *', title: '3 · TFM HANDLE', body: 'tfm holds setkey / encrypt / decrypt ops<br><span style="color:#8d99a7;font-size:10px;">one handle, many backends</span>' },
                    { sym: 'chacha20poly1305 + curve25519', title: '4 · PRIMITIVES', body: '<span style="color:#96ffbe">ChaCha20-Poly1305</span> for data<br><span style="color:#a9d4e8">Curve25519 (X25519)</span> for handshake' },
                    { sym: 'chacha20-simd / generic', title: '5 · IMPLEMENTATION', body: 'priority race picks SIMD/generic path<br><span style="color:#8d99a7;font-size:10px;">same API — faster bytes</span>' }
                ]
            },
            ktls: {
                title: 'kTLS → CRYPTO TRANSLATION',
                tagline: 'TLS records leave userspace — AEAD runs beside the TCP stack',
                ghost: 'tls_sw_sendmsg()',
                accent: 'rgba(103,190,224,0.5)',
                openHandshake: true,
                steps: [
                    { sym: 'tls_sw_sendmsg / kTLS', title: '1 · CONSUMER', body: 'socket send path hits kernel TLS<br><span style="color:#8d99a7;font-size:10px;">record framing stays in-kernel</span>' },
                    { sym: 'crypto_aead_encrypt', title: '2 · CRYPTO API', body: 'kTLS asks the unified AEAD API<br><span style="color:#8d99a7;font-size:10px;">no userspace crypto round-trip</span>' },
                    { sym: 'crypto_alloc_aead(aes-gcm)', title: '3 · TFM HANDLE', body: 'tfm bound to TLS keys / IV / seq<br><span style="color:#8d99a7;font-size:10px;">per-connection crypto state</span>' },
                    { sym: 'AES-GCM', title: '4 · PRIMITIVE', body: '<span style="color:#e6c15a">AES</span> + <span style="color:#a9d4e8">GHASH</span> over the record<br><span style="color:#8d99a7;font-size:10px;">confidentiality + integrity together</span>' },
                    { sym: 'aesni / cryptd(__aes-aesni)', title: '5 · IMPLEMENTATION', body: 'AES-NI (+PCLMUL) wins on x86<br><span style="color:#8d99a7;font-size:10px;">cryptd may wrap for async</span>' }
                ]
            },
            af_alg: {
                title: 'AF_ALG → CRYPTO TRANSLATION',
                tagline: 'userspace speaks sockets — the kernel hears crypto_tfm',
                ghost: 'af_alg_sendmsg()',
                accent: 'rgba(230,193,90,0.5)',
                steps: [
                    { sym: 'socket(AF_ALG) / accept', title: '1 · CONSUMER', body: 'userspace opens an alg socket<br><span style="color:#8d99a7;font-size:10px;">bind type+name · setkey · sendmsg</span>' },
                    { sym: 'af_alg → crypto_skcipher/aead', title: '2 · CRYPTO API', body: 'AF_ALG is a thin gateway into crypto API<br><span style="color:#8d99a7;font-size:10px;">same alloc/lookup as in-kernel clients</span>' },
                    { sym: 'struct crypto_tfm *', title: '3 · TFM HANDLE', body: 'accepted fd holds a live transform<br><span style="color:#8d99a7;font-size:10px;">ops dispatched per request</span>' },
                    { sym: 'AES / SHA / ChaCha…', title: '4 · PRIMITIVE', body: 'name string selects the algorithm family<br><span style="color:#8d99a7;font-size:10px;">one socket model · many algos</span>' },
                    { sym: 'aesni / sha*-avx2 / simd', title: '5 · IMPLEMENTATION', body: 'best registered driver for this CPU<br><span style="color:#8d99a7;font-size:10px;">transparent to the application</span>' }
                ]
            },
            dm_crypt: {
                title: 'dm-crypt → CRYPTO TRANSLATION',
                tagline: 'block I/O becomes skcipher requests on the way to disk',
                ghost: 'crypt_convert()',
                accent: 'rgba(232,96,104,0.45)',
                steps: [
                    { sym: 'dm-crypt map / crypt_convert', title: '1 · CONSUMER', body: 'bio hits the crypto target<br><span style="color:#8d99a7;font-size:10px;">sector → IV → cipher request</span>' },
                    { sym: 'crypto_skcipher_encrypt', title: '2 · CRYPTO API', body: 'dm-crypt talks skcipher (often XTS)<br><span style="color:#8d99a7;font-size:10px;">same API as AF_ALG / fscrypt</span>' },
                    { sym: 'crypto_alloc_skcipher', title: '3 · TFM HANDLE', body: 'per-device tfm with volume key<br><span style="color:#8d99a7;font-size:10px;">setkey once · encrypt many bios</span>' },
                    { sym: 'AES-XTS', title: '4 · PRIMITIVE', body: '<span style="color:#e6c15a">AES</span> in XTS mode for disk blocks<br><span style="color:#8d99a7;font-size:10px;">tweakable encryption per sector</span>' },
                    { sym: 'aes-aesni / cryptd', title: '5 · IMPLEMENTATION', body: 'AES-NI preferred · cryptd if async needed<br><span style="color:#8d99a7;font-size:10px;">storage latency meets crypto throughput</span>' }
                ]
            },
            fscrypt: {
                title: 'fscrypt → CRYPTO TRANSLATION',
                tagline: 'files and directories encrypt through the same skcipher spine',
                ghost: 'fscrypt_encrypt_pagecache_blocks()',
                accent: 'rgba(196,176,255,0.5)',
                steps: [
                    { sym: 'fscrypt / inode policy', title: '1 · CONSUMER', body: 'VFS pagecache write hits fscrypt<br><span style="color:#8d99a7;font-size:10px;">per-file key derived from master</span>' },
                    { sym: 'crypto_skcipher_encrypt', title: '2 · CRYPTO API', body: 'contents via skcipher · names via hashes<br><span style="color:#8d99a7;font-size:10px;">API shared with dm-crypt</span>' },
                    { sym: 'crypto_alloc_skcipher', title: '3 · TFM HANDLE', body: 'tfm cached with derived key<br><span style="color:#8d99a7;font-size:10px;">reuse across pages</span>' },
                    { sym: 'AES / Adiantum', title: '4 · PRIMITIVE', body: 'typically <span style="color:#e6c15a">AES</span> modes · sometimes Adiantum<br><span style="color:#8d99a7;font-size:10px;">policy chooses the primitive</span>' },
                    { sym: 'aesni / generic', title: '5 · IMPLEMENTATION', body: 'CPU-accelerated when available<br><span style="color:#8d99a7;font-size:10px;">filesystem never picks registers itself</span>' }
                ]
            },
            ipsec: {
                title: 'IPsec/XFRM → CRYPTO TRANSLATION',
                tagline: 'ESP/AH transforms are just crypto API clients on the packet path',
                ghost: 'xfrm_output()',
                accent: 'rgba(103,190,224,0.45)',
                steps: [
                    { sym: 'xfrm_output / ESP', title: '1 · CONSUMER', body: 'XFRM applies a transform to the skb<br><span style="color:#8d99a7;font-size:10px;">policy → state → crypto</span>' },
                    { sym: 'crypto_aead_encrypt', title: '2 · CRYPTO API', body: 'ESP almost always uses AEAD<br><span style="color:#8d99a7;font-size:10px;">encrypt + auth in one call</span>' },
                    { sym: 'crypto_alloc_aead', title: '3 · TFM HANDLE', body: 'per-SA tfm with keys from IKE<br><span style="color:#8d99a7;font-size:10px;">lifetime tied to xfrm_state</span>' },
                    { sym: 'AES-GCM / SHA', title: '4 · PRIMITIVE', body: 'modern stacks prefer <span style="color:#e6c15a">AES-GCM</span><br><span style="color:#8d99a7;font-size:10px;">older: cipher + auth separately</span>' },
                    { sym: 'aesni / offload', title: '5 · IMPLEMENTATION', body: 'AES-NI or NIC IPsec offload<br><span style="color:#8d99a7;font-size:10px;">same SA · different engine</span>' }
                ]
            },
            ima: {
                title: 'IMA/EVM → CRYPTO TRANSLATION',
                tagline: 'integrity is hashing and signatures — still through crypto API',
                ghost: 'ima_calc_file_hash()',
                accent: 'rgba(230,193,90,0.45)',
                steps: [
                    { sym: 'ima_file_check / evm', title: '1 · CONSUMER', body: 'measure or appraise a file<br><span style="color:#8d99a7;font-size:10px;">policy hooks into LSM path</span>' },
                    { sym: 'crypto_shash_digest', title: '2 · CRYPTO API', body: 'hashes via shash · sigs via akcipher<br><span style="color:#8d99a7;font-size:10px;">unified digest/verify entry points</span>' },
                    { sym: 'crypto_alloc_shash', title: '3 · TFM HANDLE', body: 'hash tfm for measurement<br><span style="color:#8d99a7;font-size:10px;">optional ECDSA/RSA verify tfm</span>' },
                    { sym: 'SHA-2 + ECDSA', title: '4 · PRIMITIVES', body: '<span style="color:#96ffbe">SHA-256/512</span> measure<br><span style="color:#a9d4e8">ECDSA</span> can appraise' },
                    { sym: 'sha*-avx2 / generic', title: '5 · IMPLEMENTATION', body: 'SIMD hash when present<br><span style="color:#8d99a7;font-size:10px;">signature path may stay generic</span>' }
                ]
            },
            random: {
                title: 'random/CRNG → CRYPTO TRANSLATION',
                tagline: 'the entropy pool’s output mixer is ChaCha20 in disguise',
                ghost: 'crng_fast_key_erasure()',
                accent: 'rgba(150,255,190,0.4)',
                steps: [
                    { sym: 'get_random_bytes', title: '1 · CONSUMER', body: 'kernel clients ask for random bytes<br><span style="color:#8d99a7;font-size:10px;">keys · nonces · IV material</span>' },
                    { sym: 'CRNG core', title: '2 · CRYPTO ENGINE', body: 'ChaCha20-based CRNG mixes state<br><span style="color:#8d99a7;font-size:10px;">fast path after initial seed</span>' },
                    { sym: 'chacha_block', title: '3 · PRIMITIVE', body: '<span style="color:#96ffbe">ChaCha20</span> expands a secret state<br><span style="color:#8d99a7;font-size:10px;">not a tfm alloc every call</span>' },
                    { sym: 'SIMD ChaCha', title: '4 · IMPLEMENTATION', body: 'arch SIMD helpers when available<br><span style="color:#8d99a7;font-size:10px;">same stream cipher family as WireGuard</span>' },
                    { sym: 'reuse across kernel', title: '5 · MAGIC', body: 'one primitive · many consumers<br><span style="color:#8d99a7;font-size:10px;">VPN AEAD and RNG share ChaCha DNA</span>' }
                ]
            }
        };
        return scripts[id] || {
            title: 'CONSUMER → CRYPTO TRANSLATION',
            tagline: 'subsystem request becomes a crypto API transform',
            ghost: 'crypto_alloc_tfm()',
            accent: 'rgba(169,212,232,0.45)',
            steps: [
                { sym: 'subsystem hook', title: '1 · CONSUMER', body: 'a kernel client needs crypto<br><span style="color:#8d99a7;font-size:10px;">encrypt · hash · sign · agree</span>' },
                { sym: 'crypto_alloc_*', title: '2 · CRYPTO API', body: 'unified entry by type + name<br><span style="color:#8d99a7;font-size:10px;">lookup · priority · tfm</span>' },
                { sym: 'struct crypto_tfm *', title: '3 · TFM', body: 'opaque handle to algorithm ops<br><span style="color:#8d99a7;font-size:10px;">setkey · encrypt · digest</span>' },
                { sym: 'primitive', title: '4 · PRIMITIVE', body: 'AES · ChaCha · SHA · ECC…<br><span style="color:#8d99a7;font-size:10px;">math the subsystem asked for</span>' },
                { sym: 'driver / acceleration', title: '5 · IMPLEMENTATION', body: 'generic · simd · aesni · offload<br><span style="color:#8d99a7;font-size:10px;">fastest registered winner</span>' }
            ]
        };
    }

    getPrimitiveMorphScript(id) {
        const scripts = {
            aes: {
                title: 'AES → KERNEL DRILL',
                tagline: 'one block cipher · GCM for TLS · XTS for disks · many consumers',
                ghost: 'aesni_enc()',
                accent: 'rgba(230,193,90,0.55)',
                openAesLab: true,
                steps: [
                    { sym: 'who asks for AES?', title: '1 · CONSUMERS', body: '<span style="color:#a9d4e8">kTLS</span> · IPsec · dm-crypt · fscrypt · AF_ALG<br><span style="color:#8d99a7;font-size:10px;">same primitive · different I/O paths</span>' },
                    { sym: 'crypto_alloc_aead / skcipher', title: '2 · API SHAPE', body: 'AES-GCM → <span style="color:#e6c15a">aead</span><br>AES-XTS → <span style="color:#e6c15a">skcipher</span><br><span style="color:#8d99a7;font-size:10px;">mode decides the API type</span>' },
                    { sym: 'rounds · SubBytes · MixColumns', title: '3 · INSIDE THE CIPHER', body: '10/12/14 rounds transform the state<br><span style="color:#8d99a7;font-size:10px;">demo of those rounds → AES LAB</span>' },
                    { sym: 'GHASH / XTS tweak', title: '4 · MODE MAGIC', body: 'GCM authenticates · XTS tweaks per sector<br><span style="color:#8d99a7;font-size:10px;">AES is the engine · mode is the mission</span>' },
                    { sym: 'aes-aesni / cryptd / offload', title: '5 · IMPLEMENTATION', body: '<span style="color:#96ffbe">AES-NI</span> wins on modern x86<br><span style="color:#8d99a7;font-size:10px;">generic/simd/offload as fallbacks</span>' }
                ]
            },
            curve25519: {
                title: 'CURVE25519 → KERNEL DRILL',
                tagline: 'elliptic-curve DH — short keys, fast agreement, no AES involved',
                ghost: 'curve25519_generic()',
                accent: 'rgba(169,212,232,0.55)',
                openHandshake: true,
                steps: [
                    { sym: 'who needs X25519?', title: '1 · CONSUMERS', body: '<span style="color:#96ffbe">WireGuard</span> Noise_IK · TLS 1.3 ECDHE<br><span style="color:#8d99a7;font-size:10px;">handshake / key agreement only</span>' },
                    { sym: 'crypto_alloc_kpp', title: '2 · KPP API', body: 'key-agreement type in crypto API<br><span style="color:#8d99a7;font-size:10px;">set_secret · generate_public · compute_shared</span>' },
                    { sym: 'X25519 scalar mult', title: '3 · THE MATH', body: 'clamp scalar · Montgomery ladder on Curve25519<br><span style="color:#8d99a7;font-size:10px;">32-byte public · 32-byte shared secret</span>' },
                    { sym: 'shared secret → HKDF/Noise', title: '4 · AFTER ECDH', body: 'secret feeds key schedule — not the record cipher<br><span style="color:#8d99a7;font-size:10px;">WireGuard → ChaCha · TLS → often AES-GCM</span>' },
                    { sym: 'curve25519-generic / fiat', title: '5 · IMPLEMENTATION', body: 'constant-time software paths in-tree<br><span style="color:#8d99a7;font-size:10px;">no AES-NI here — different silicon story</span>' }
                ]
            },
            chacha: {
                title: 'CHACHA20 → KERNEL DRILL',
                tagline: 'stream cipher DNA shared by VPN AEAD and the CRNG',
                ghost: 'chacha_permute()',
                accent: 'rgba(150,255,190,0.5)',
                steps: [
                    { sym: 'who streams ChaCha?', title: '1 · CONSUMERS', body: 'WireGuard AEAD · random CRNG · AF_ALG<br><span style="color:#8d99a7;font-size:10px;">one ARX design · two worlds</span>' },
                    { sym: 'aead vs CRNG core', title: '2 · API SHAPE', body: 'packets → <span style="color:#e6c15a">chacha20poly1305</span> aead<br>entropy → in-kernel ChaCha CRNG<br><span style="color:#8d99a7;font-size:10px;">not always a tfm alloc</span>' },
                    { sym: '20 rounds · quarter-round', title: '3 · INSIDE', body: 'add-rotate-xor mixes a 512-bit state<br><span style="color:#8d99a7;font-size:10px;">software-friendly · SIMD loves it</span>' },
                    { sym: 'Poly1305 tag', title: '4 · WITH POLY', body: 'AEAD pairs ChaCha with <span style="color:#a9d4e8">Poly1305</span><br><span style="color:#8d99a7;font-size:10px;">encrypt + authenticate together</span>' },
                    { sym: 'chacha20-simd / generic', title: '5 · IMPLEMENTATION', body: 'AVX/NEON when present<br><span style="color:#8d99a7;font-size:10px;">same family powers get_random_bytes</span>' }
                ]
            },
            sha2: {
                title: 'SHA-2 → KERNEL DRILL',
                tagline: 'the measurement workhorse — IMA, HMAC, key derivation helpers',
                ghost: 'sha256_transform()',
                accent: 'rgba(196,176,255,0.5)',
                steps: [
                    { sym: 'who hashes?', title: '1 · CONSUMERS', body: 'IMA/EVM · AF_ALG · IPsec auth · fscrypt names<br><span style="color:#8d99a7;font-size:10px;">integrity more often than secrecy</span>' },
                    { sym: 'crypto_alloc_shash', title: '2 · SHASH API', body: 'init/update/final on a shash tfm<br><span style="color:#8d99a7;font-size:10px;">HMAC built on the same digest</span>' },
                    { sym: 'SHA-256 / SHA-512', title: '3 · PRIMITIVE', body: 'Merkle–Damgård compression of blocks<br><span style="color:#8d99a7;font-size:10px;">fixed-size digest · one-way</span>' },
                    { sym: 'reuse with AES/ECC', title: '4 · IN PROTOCOLS', body: 'TLS finished / HKDF often sit on SHA-2<br><span style="color:#8d99a7;font-size:10px;">companion to AES-GCM or X25519</span>' },
                    { sym: 'sha256-avx2 / generic', title: '5 · IMPLEMENTATION', body: 'SIMD digest paths when available<br><span style="color:#8d99a7;font-size:10px;">IMA loves throughput here</span>' }
                ]
            },
            ecdsa: {
                title: 'ECDSA → KERNEL DRILL',
                tagline: 'signatures on NIST curves — appraisal, modules, trust',
                ghost: 'ecdsa_verify()',
                accent: 'rgba(232,150,150,0.5)',
                steps: [
                    { sym: 'who verifies?', title: '1 · CONSUMERS', body: 'IMA/EVM appraisal · module signing paths<br><span style="color:#8d99a7;font-size:10px;">prove origin · not encrypt bytes</span>' },
                    { sym: 'crypto_alloc_akcipher', title: '2 · AKCIPHER API', body: 'asymmetric verify/sign through crypto API<br><span style="color:#8d99a7;font-size:10px;">keys as cert/raw coordinates</span>' },
                    { sym: 'P-256 / P-384', title: '3 · CURVE', body: 'ECDSA over prime-field NIST curves<br><span style="color:#8d99a7;font-size:10px;">different curve family than Curve25519</span>' },
                    { sym: 'hash-then-sign', title: '4 · WITH SHA-2', body: 'digest first (often SHA-2) · then verify<br><span style="color:#8d99a7;font-size:10px;">two primitives · one trust decision</span>' },
                    { sym: 'ecdsa-generic', title: '5 · IMPLEMENTATION', body: 'mostly software · careful constant-time<br><span style="color:#8d99a7;font-size:10px;">no AES-NI analogue for ECDSA</span>' }
                ]
            },
            poly: {
                title: 'POLY1305 → KERNEL DRILL',
                tagline: 'one-time authenticator — the “tag” half of ChaCha20-Poly1305',
                ghost: 'poly1305_core()',
                accent: 'rgba(150,255,190,0.4)',
                steps: [
                    { sym: 'who needs a MAC?', title: '1 · CONSUMERS', body: 'WireGuard · any chacha20poly1305 aead user<br><span style="color:#8d99a7;font-size:10px;">integrity for the ciphertext</span>' },
                    { sym: 'inside AEAD', title: '2 · NOT ALONE', body: 'almost always paired with ChaCha20<br><span style="color:#8d99a7;font-size:10px;">one-time key from the cipher state</span>' },
                    { sym: 'polynomial MAC', title: '3 · THE MATH', body: 'evaluate a poly over the message in prime field<br><span style="color:#8d99a7;font-size:10px;">fast in software · forgery-resistant with OTKs</span>' },
                    { sym: '16-byte tag', title: '4 · OUTPUT', body: 'auth tag appended / checked on decrypt<br><span style="color:#8d99a7;font-size:10px;">fail closed on mismatch</span>' },
                    { sym: 'poly1305-simd / generic', title: '5 · IMPLEMENTATION', body: 'SIMD helpers beside ChaCha<br><span style="color:#8d99a7;font-size:10px;">ships as part of the AEAD driver</span>' }
                ]
            }
        };
        return scripts[id] || null;
    }

    getArchMorphScript(target) {
        const id = target?.id;
        const layer = target?.layer || 'consumers';
        if (layer === 'primitives') {
            return this.getPrimitiveMorphScript(id) || {
                title: 'PRIMITIVE → KERNEL DRILL',
                tagline: 'algorithm reused across subsystems through the crypto API',
                ghost: 'crypto_alg_lookup()',
                accent: 'rgba(150,255,190,0.4)',
                steps: [
                    { sym: 'consumers', title: '1 · WHO USES IT', body: 'multiple kernel paths may request this alg<br><span style="color:#8d99a7;font-size:10px;">reuse is the point of the framework</span>' },
                    { sym: 'crypto_alloc_*', title: '2 · API', body: 'allocated by type + name<br><span style="color:#8d99a7;font-size:10px;">aead · skcipher · shash · kpp</span>' },
                    { sym: 'tfm', title: '3 · HANDLE', body: 'ops table bound to this primitive<br><span style="color:#8d99a7;font-size:10px;">setkey · encrypt · digest</span>' },
                    { sym: 'driver race', title: '4 · IMPLEMENTATION', body: 'priority picks simd/cpu/offload<br><span style="color:#8d99a7;font-size:10px;">same name · faster bytes</span>' }
                ]
            };
        }
        return this.getConsumerMorphScript(id);
    }

    clearArchGhost() {
        if (this._archGhostTimer) {
            clearTimeout(this._archGhostTimer);
            this._archGhostTimer = null;
        }
        if (this._archGhostEl) {
            this._archGhostEl.remove();
            this._archGhostEl = null;
        }
    }

    flashArchGhost(code) {
        this.clearArchGhost();
        if (!this.container) return;
        const el = document.createElement('div');
        el.textContent = String(code || 'crypto_alloc_tfm()');
        el.style.cssText = [
            'position:absolute',
            'left:50%',
            'top:18%',
            'transform:translate(-50%,-8px)',
            'opacity:0',
            'pointer-events:none',
            'z-index:1006',
            'font:13px "Share Tech Mono", monospace',
            'letter-spacing:0.5px',
            'color:rgba(230,193,90,0.92)',
            'text-shadow:0 0 14px rgba(230,193,90,0.45)',
            'background:rgba(8,12,20,0.55)',
            'border:1px solid rgba(230,193,90,0.35)',
            'border-radius:4px',
            'padding:5px 12px',
            'transition:opacity 240ms ease, transform 240ms ease'
        ].join(';');
        this.container.appendChild(el);
        this._archGhostEl = el;
        requestAnimationFrame(() => {
            el.style.opacity = '1';
            el.style.transform = 'translate(-50%,0)';
        });
        this._archGhostTimer = setTimeout(() => {
            el.style.opacity = '0';
            el.style.transform = 'translate(-50%,-10px)';
            setTimeout(() => {
                if (this._archGhostEl === el) {
                    el.remove();
                    this._archGhostEl = null;
                }
            }, 280);
        }, 1700);
    }

    closeArchMorph() {
        this.archMorphTarget = null;
        this.clearArchGhost();
        if (this.archMorphNode) {
            this.archMorphNode.style.display = 'none';
            this.archMorphNode.innerHTML = '';
        }
    }

    isSchemeNode(id) {
        return ['ktls', 'aes', 'aead', 'aesni', 'wireguard', 'chacha', 'poly'].includes(String(id || ''));
    }

    resolveSchemeKind(id) {
        const x = String(id || '');
        if (['wireguard', 'chacha', 'poly'].includes(x)) return 'wg-chacha';
        return 'aes-gcm';
    }

    stopSchemePlay() {
        this.schemePlaying = false;
        if (this._schemePlayTimer) {
            clearInterval(this._schemePlayTimer);
            this._schemePlayTimer = null;
        }
    }

    openSchemeDiagram(source) {
        this.closeArchMorph();
        this.stopSchemePlay();
        const id = source?.id || 'aes';
        this.schemeKind = this.resolveSchemeKind(id);
        this.schemeSource = {
            id,
            label: source?.label || id,
            layer: source?.layer || ''
        };
        this.schemePhase = 0;
        this.schemeRendered = false;
        this.archFocus = null;
        this.activeCryptoView = 'SCHEME';
        this.updateCryptoViewToggle();
        this.syncOverlayForCurrentView();
        this.renderFlowMap(this.lastPayload || this.normalizeTelemetry(this.getFallbackTelemetry()));
        // Auto-play once so the diagram feels alive immediately.
        setTimeout(() => this.startSchemePlay(), 280);
    }

    startSchemePlay() {
        if (this.activeCryptoView !== 'SCHEME') return;
        this.stopSchemePlay();
        this.schemePlaying = true;
        this.schemePhase = 0;
        if (this.svg) this.svg.select('.scheme-play-label').text('■ STOP');
        this.applySchemePhase(0);
        this._schemePlayTimer = setInterval(() => {
            if (!this.isActive || this.activeCryptoView !== 'SCHEME' || !this.schemePlaying) {
                this.stopSchemePlay();
                if (this.svg) this.svg.select('.scheme-play-label').text('▶ PLAY');
                return;
            }
            this.schemePhase = (this.schemePhase + 1) % 7;
            this.applySchemePhase(this.schemePhase);
        }, 1100);
    }

    schemeElixirIdent(sym) {
        const clean = String(sym || '')
            .replace(/\(\)$/, '')
            .replace(/\(.*\)$/, '')
            .split(/[\s/]+/)[0]
            .trim();
        if (!clean || clean.startsWith('…')) return null;
        return `https://elixir.bootlin.com/linux/latest/A/ident/${encodeURIComponent(clean)}`;
    }

    schemeElixirFile(path) {
        const clean = String(path || '').replace(/^\/+/, '');
        if (!clean) return null;
        return `https://elixir.bootlin.com/linux/latest/source/${clean}`;
    }

    openSchemeCodeRef(ref) {
        if (!ref) return;
        const url = ref.url || this.schemeElixirIdent(ref.sym) || this.schemeElixirFile(ref.file);
        if (!url) return;
        try {
            window.open(url, '_blank', 'noopener,noreferrer');
        } catch (e) {
            /* ignore popup blockers quietly */
        }
        this.flashArchGhost(ref.sym || ref.file || 'kernel source');
    }

    getSchemePhaseMeta(phase) {
        if (this.schemeKind === 'wg-chacha') return this.getWgChachaSchemePhaseMeta(phase);
        return this.getAesGcmSchemePhaseMeta(phase);
    }

    getWgChachaSchemePhaseMeta(phase) {
        const table = [
            {
                narr: 'WireGuard packet ready — Noise keys already agreed, AEAD protects the payload',
                ghost: 'wg_packet_encrypt_worker()',
                kernel: 0,
                keyStage: 0,
                inspect: [
                    'WIREGUARD',
                    'skb enters encrypt path',
                    'peer keys / counters ready',
                    'ChaCha20-Poly1305 is the AEAD'
                ],
                refs: [
                    { sym: 'wg_packet_encrypt_worker', file: 'drivers/net/wireguard/send.c', note: 'encrypt worker' },
                    { sym: 'wg_socket_send_buffer_as_reply_to_skb', file: 'drivers/net/wireguard/socket.c', note: 'send path' },
                    { sym: 'curve25519_generic', file: 'lib/crypto/curve25519.c', note: 'handshake ECDH' }
                ]
            },
            {
                narr: 'crypto_alloc_aead("chacha20poly1305") — unified crypto API entry',
                ghost: 'crypto_alloc_aead()',
                kernel: 1,
                keyStage: 1,
                inspect: [
                    'CRYPTO API',
                    'name lookup → tfm',
                    'same alloc path as kTLS',
                    'priority race picks SIMD/generic'
                ],
                refs: [
                    { sym: 'crypto_alloc_aead', file: 'crypto/api.c', note: 'tfm allocation' },
                    { sym: 'chacha20poly1305_encrypt', file: 'lib/crypto/chacha20poly1305.c', note: 'lib AEAD helper' },
                    { sym: 'crypto_register_aeads', file: 'crypto/aead.c', note: 'register AEAD algs' }
                ]
            },
            {
                narr: 'ChaCha20 · 20 rounds of ARX quarter-rounds on 512-bit state',
                ghost: 'chacha_permute()',
                kernel: 2,
                keyStage: 3,
                inspect: [
                    'CHACHA20',
                    'add-rotate-xor quarter-rounds',
                    'counter + nonce → keystream',
                    'software-friendly · SIMD loves it'
                ],
                refs: [
                    { sym: 'chacha_block_generic', file: 'lib/crypto/chacha.c', note: 'generic block' },
                    { sym: 'chacha_2block_xor_avx2', file: 'arch/x86/crypto/chacha_x86_64_glue.c', note: 'AVX2 path' },
                    { sym: 'chacha_init_generic', file: 'lib/crypto/chacha.c', note: 'state init' }
                ]
            },
            {
                narr: 'rounds continue · 10 double-rounds (20 quarter-round layers)',
                ghost: '… 20 rounds …',
                kernel: 2,
                keyStage: 4,
                inspect: [
                    'MIDDLE ROUNDS',
                    'diagram compresses like textbook · · ·',
                    'keystream fills 64-byte blocks',
                    'no AES-NI here — different silicon story'
                ],
                refs: [
                    { sym: 'chacha_permute', file: 'lib/crypto/chacha.c', note: 'core permute' },
                    { sym: 'chacha_crypt_generic', file: 'lib/crypto/chacha.c', note: 'XOR keystream' }
                ]
            },
            {
                narr: 'keystream ⊕ plaintext → ciphertext (same length)',
                ghost: 'chacha20poly1305_encrypt()',
                kernel: 2,
                keyStage: 3,
                inspect: [
                    'XOR KEYSTREAM',
                    'stream cipher · no block padding',
                    'WireGuard packet body encrypted',
                    'auth still pending (Poly1305)'
                ],
                refs: [
                    { sym: 'chacha20poly1305_encrypt', file: 'lib/crypto/chacha20poly1305.c', note: 'encrypt+tag API' },
                    { sym: 'chacha_crypt_generic', file: 'lib/crypto/chacha.c', note: 'keystream XOR' }
                ]
            },
            {
                narr: 'Poly1305 one-time MAC → 16-byte tag over AAD + ciphertext',
                ghost: 'poly1305_core()',
                kernel: 3,
                keyStage: 2,
                inspect: [
                    'POLY1305',
                    'polynomial MAC in prime field',
                    'one-time key from ChaCha state',
                    'forgery-resistant with OTKs'
                ],
                refs: [
                    { sym: 'poly1305_core_blocks', file: 'lib/crypto/poly1305.c', note: 'Poly1305 core' },
                    { sym: 'poly1305_update', file: 'crypto/poly1305_generic.c', note: 'generic update' },
                    { sym: 'chacha20poly1305_encrypt', file: 'lib/crypto/chacha20poly1305.c', note: 'AEAD wrapper' }
                ]
            },
            {
                narr: 'ciphertext ∥ tag → WireGuard UDP — Noise handshake already done',
                ghost: 'wg_socket_send_skb()',
                kernel: 4,
                keyStage: 0,
                inspect: [
                    'WIRE OUT',
                    'encrypted transport message',
                    'X25519 only in handshake path',
                    '→ HANDSHAKE for ECDH story'
                ],
                refs: [
                    { sym: 'wg_packet_create_data_done', file: 'drivers/net/wireguard/send.c', note: 'packet done' },
                    { sym: 'udp_sendmsg', file: 'net/ipv4/udp.c', note: 'UDP transmit' },
                    { sym: 'curve25519_generic', file: 'lib/crypto/curve25519.c', note: 'handshake only' }
                ]
            }
        ];
        const row = table[phase] || table[0];
        row.refs = (row.refs || []).map((r) => ({
            ...r,
            url: this.schemeElixirIdent(r.sym) || this.schemeElixirFile(r.file)
        }));
        return row;
    }

    getAesGcmSchemePhaseMeta(phase) {
        const nr = this.schemeNr || 10;
        const driver = (() => {
            try {
                const meta = this.lastPayload?.meta || {};
                const comp = this.getCompetitionPayload(meta) || {};
                return String(comp?.selected?.name || 'aesni / ce').replace(/^_+/, '').slice(0, 28);
            } catch (e) {
                return 'aesni / ce';
            }
        })();
        const isArmCe = /(-ce\b|neon|armv8|aes-ce)/i.test(driver);
        const aesImpl = isArmCe
            ? { sym: 'ce_aes_ecb_encrypt', file: 'arch/arm64/crypto/aes-ce-glue.c', label: 'AES-CE glue' }
            : { sym: 'aesni_encrypt', file: 'arch/x86/crypto/aesni-intel_glue.c', label: 'AES-NI glue' };
        const ghashImpl = isArmCe
            ? { sym: 'gcm_setkey', file: 'arch/arm64/crypto/aes-ce-ccm-glue.c', label: 'ARM CE GCM' }
            : { sym: 'ghash_clmulni_digest', file: 'arch/x86/crypto/ghash-clmulni-intel_glue.c', label: 'PCLMUL GHASH' };

        const table = [
            {
                narr: 'TLS record lands in kTLS — 128-bit AES state ready',
                ghost: 'tls_sw_sendmsg()',
                kernel: 0,
                keyStage: 0,
                inspect: [
                    'KERNEL',
                    'tls_sw_sendmsg / kTLS record path',
                    'plaintext + AAD prepared for AEAD',
                    `driver waiting: ${driver}`
                ],
                refs: [
                    { sym: 'tls_sw_sendmsg', file: 'net/tls/tls_sw.c', note: 'kTLS software send' },
                    { sym: 'tls_sw_recvmsg', file: 'net/tls/tls_sw.c', note: 'kTLS software recv' },
                    { sym: 'crypto_alloc_aead', file: 'crypto/api.c', note: 'tfm allocation gate' }
                ]
            },
            {
                narr: 'round 1 · AddRoundKey ⊕ K₀ → SubBytes → ShiftRows → MixColumns',
                ghost: 'crypto_aead_encrypt()',
                kernel: 1,
                keyStage: 3,
                inspect: [
                    'ROUND 1',
                    '⊕ K₀ mixes key into state',
                    'S-box · ShiftRows · MixColumns',
                    'first diffusion of the block'
                ],
                refs: [
                    { sym: 'crypto_aead_encrypt', file: 'include/linux/crypto.h', note: 'AEAD encrypt entry' },
                    { sym: 'crypto_aead_setkey', file: 'crypto/aead.c', note: 'bind traffic key' },
                    { sym: aesImpl.sym, file: aesImpl.file, note: aesImpl.label }
                ]
            },
            {
                narr: 'round 2 · same spine · next round key K₁',
                ghost: `${aesImpl.sym}()`,
                kernel: 2,
                keyStage: 4,
                inspect: [
                    'ROUND 2',
                    'silicon path preferred when present',
                    `selected: ${driver}`,
                    'same API — faster bytes'
                ],
                refs: [
                    { sym: aesImpl.sym, file: aesImpl.file, note: aesImpl.label },
                    { sym: 'crypto_aes_encrypt', file: 'crypto/aes_generic.c', note: 'generic fallback' },
                    { sym: 'crypto_register_algs', file: 'crypto/algapi.c', note: 'priority registration' }
                ]
            },
            {
                narr: `rounds 3…${nr - 1} · omitted middle (Nr=${nr})`,
                ghost: `… ${nr - 2} rounds …`,
                kernel: 2,
                keyStage: 4,
                inspect: [
                    'MIDDLE ROUNDS',
                    `AES-${nr === 14 ? '256' : '128'} → Nr=${nr}`,
                    'diagram compresses like textbook · · ·',
                    'toggle Nr chips to switch story length'
                ],
                refs: [
                    { sym: 'crypto_aes_set_key', file: 'crypto/aes_generic.c', note: 'key expand / Nr' },
                    { sym: aesImpl.sym, file: aesImpl.file, note: 'hot round loop' },
                    { sym: 'aes_expandkey', file: 'lib/crypto/aes.c', note: 'lib/crypto expand' }
                ]
            },
            {
                narr: `final round ${nr} · no MixColumns · ⊕ Kₙ`,
                ghost: `${aesImpl.sym}()`,
                kernel: 2,
                keyStage: 5,
                inspect: [
                    'FINAL ROUND',
                    'SubBytes + ShiftRows + ⊕ Kₙ',
                    'MixColumns omitted on last round',
                    'state is now ciphertext block'
                ],
                refs: [
                    { sym: aesImpl.sym, file: aesImpl.file, note: 'final round in asm/glue' },
                    { sym: 'crypto_aes_encrypt', file: 'crypto/aes_generic.c', note: 'C reference path' }
                ]
            },
            {
                narr: 'GHASH authenticates AAD + ciphertext → tag',
                ghost: 'ghash_update()',
                kernel: 3,
                keyStage: 2,
                inspect: [
                    'AEAD TAG',
                    'GHASH over AAD ∥ ciphertext',
                    'PCLMULQDQ helps on x86',
                    'integrity without a separate HMAC'
                ],
                refs: [
                    { sym: ghashImpl.sym, file: ghashImpl.file, note: ghashImpl.label },
                    { sym: 'crypto_gcm_encrypt', file: 'crypto/gcm.c', note: 'GCM mode wrapper' },
                    { sym: 'ghash_update', file: 'crypto/ghash-generic.c', note: 'generic GHASH' }
                ]
            },
            {
                narr: 'ciphertext ∥ tag leaves on the TCP / kTLS path',
                ghost: 'tls_sw_sendmsg()',
                kernel: 4,
                keyStage: 1,
                inspect: [
                    'WIRE OUT',
                    'encrypted TLS record on the socket',
                    'X25519 already left the hot path',
                    '→ HANDSHAKE for the key-agreement story'
                ],
                refs: [
                    { sym: 'tls_sw_sendmsg', file: 'net/tls/tls_sw.c', note: 'push encrypted record' },
                    { sym: 'tcp_sendmsg', file: 'net/ipv4/tcp.c', note: 'TCP transmit' },
                    { sym: 'crypto_aead_encrypt', file: 'include/linux/crypto.h', note: 'completed AEAD op' }
                ]
            }
        ];
        const row = table[phase] || table[0];
        row.refs = (row.refs || []).map((r) => ({
            ...r,
            url: this.schemeElixirIdent(r.sym) || this.schemeElixirFile(r.file)
        }));
        return row;
    }

    applySchemePhase(phase) {
        if (!this.svg) return;
        const root = this.svg.select('.crypto-scheme-view');
        if (root.empty()) return;
        const meta = this.getSchemePhaseMeta(phase);
        const nr = this.schemeNr || 10;

        root.selectAll('.scheme-phase-group').style('opacity', function opacity() {
            const p = Number(this.getAttribute('data-phase'));
            if (Number.isNaN(p)) return 0.55;
            return p === phase ? 1 : (Math.abs(p - phase) === 1 ? 0.72 : 0.28);
        });
        root.selectAll('.scheme-phase-group').select('rect.scheme-phase-glow')
            .style('opacity', function glowOp() {
                const p = Number(this.parentNode.getAttribute('data-phase'));
                return p === phase ? 0.55 : 0;
            });

        root.select('.scheme-narrator').text(meta.narr || '');
        root.select('.scheme-phase-pip').text(
            this.schemeKind === 'wg-chacha'
                ? `phase ${phase + 1}/7 · ChaCha 20 rounds · PLAY / STEP / click stage`
                : `phase ${phase + 1}/7 · Nr=${nr} · PLAY / STEP / click stage`
        );

        // Kernel call rail
        root.selectAll('.scheme-kernel-step').style('opacity', function kOp() {
            const k = Number(this.getAttribute('data-kernel'));
            return k === meta.kernel ? 1 : (Math.abs(k - meta.kernel) === 1 ? 0.55 : 0.22);
        });
        root.selectAll('.scheme-kernel-step').select('rect')
            .style('stroke', function kStroke() {
                const k = Number(this.parentNode.getAttribute('data-kernel'));
                return k === meta.kernel ? '#e6c15a' : 'rgba(120,140,170,0.35)';
            });

        // Key schedule sync
        root.selectAll('.scheme-key-stage').style('opacity', function keyOp() {
            const k = Number(this.getAttribute('data-key-stage'));
            return k === meta.keyStage ? 1 : 0.35;
        });
        root.selectAll('.scheme-key-stage').select('ellipse, rect')
            .style('stroke', function keyStroke() {
                const k = Number(this.parentNode.getAttribute('data-key-stage'));
                return k === meta.keyStage ? '#e6c15a' : 'rgba(196,176,255,0.45)';
            });

        // Mini state grid + optional demo byte
        let demoHex = null;
        try {
            const pt = this.aesDemo?.demo_vectors?.plaintext;
            if (pt && typeof pt === 'string') demoHex = pt.replace(/\s/g, '');
        } catch (e) { /* ignore */ }
        root.selectAll('.scheme-state-cell').each((d, i, nodes) => {
            const el = d3.select(nodes[i]);
            const mine = Number(el.attr('data-i'));
            const hot = (mine === ((this.schemeInspectByte + phase * 3) % 16));
            el.style('fill', hot
                ? 'rgba(230,193,90,0.9)'
                : (mine % 4 === phase % 4 ? 'rgba(150,255,190,0.45)' : 'rgba(40,55,75,0.85)'));
            el.style('stroke', hot ? '#e6c15a' : 'rgba(140,160,180,0.35)');
        });

        // Inspect panel
        const lines = meta.inspect || [];
        root.selectAll('.scheme-inspect-line').each(function insp(d, i) {
            d3.select(this).text(lines[i] || '');
        });
        if (this.schemeKind === 'wg-chacha') {
            const labels = ['const', 'const', 'const', 'const', 'key', 'key', 'key', 'key',
                'key', 'key', 'key', 'key', 'ctr', 'nonce', 'nonce', 'nonce'];
            const li = this.schemeInspectByte % 16;
            root.select('.scheme-inspect-byte')
                .text(`ChaCha state[${li}] · ${labels[li]} word · 512-bit matrix`);
        } else if (demoHex && demoHex.length >= 32) {
            const bi = (this.schemeInspectByte % 16) * 2;
            const byte = demoHex.slice(bi, bi + 2).toUpperCase();
            root.select('.scheme-inspect-byte')
                .text(`demo state[${this.schemeInspectByte}] = 0x${byte}  (educational vector)`);
        } else {
            root.select('.scheme-inspect-byte')
                .text('demo vector: load AES LAB data for live bytes');
        }

        // Code refs for this phase
        const refs = meta.refs || [];
        this._schemePhaseRefs = refs;
        root.selectAll('.scheme-code-ref').each(function refRow(d, i) {
            const row = d3.select(this);
            const ref = refs[i];
            if (!ref) {
                row.style('display', 'none');
                return;
            }
            row.style('display', null).attr('data-ref-i', i);
            row.select('.scheme-code-sym').text(ref.sym || '');
            row.select('.scheme-code-file').text(ref.file || '');
            row.select('.scheme-code-note').text(ref.note || '');
        });
        root.select('.scheme-code-hint')
            .text(refs[0] ? `click a symbol → Elixir · primary: ${refs[0].sym}` : 'no code refs');

        root.selectAll('.scheme-key-inject').style('stroke-opacity', function inj() {
            const p = Number(this.getAttribute('data-phase'));
            return p === phase ? 1 : 0.25;
        });

        root.selectAll('.scheme-nr-chip').style('opacity', function nrOp() {
            return Number(this.getAttribute('data-nr')) === nr ? 1 : 0.4;
        });

        if (meta.ghost) this.flashArchGhost(meta.ghost);
    }

    openArchMorph(target) {
        if (!target?.id) return;
        // Textbook scheme opens from relevant Architecture nodes — not a separate menu tab.
        if (this.isSchemeNode(target.id)) {
            this.openSchemeDiagram(target);
            return;
        }
        this.archFocus = {
            layer: target.layer || 'consumers',
            id: target.id,
            label: target.label,
            hint: target.hint
        };
        this.archMorphTarget = target;
        this.renderArchMorphRibbon();
        this.renderFlowMap(this.lastPayload || this.normalizeTelemetry(this.getFallbackTelemetry()));
    }

    renderArchMorphRibbon() {
        if (!this.archMorphNode || !this.archMorphTarget) return;
        const script = this.getArchMorphScript(this.archMorphTarget);
        const esc = (v) => this.escapeArchHtml(v);
        const stepsHtml = (script.steps || []).map((step, idx) => (
            '<div class="crypto-arch-morph-step" style="opacity:0; transform:translateY(8px); transition:opacity 340ms ease, transform 340ms ease; margin:0 0 '
            + (idx === script.steps.length - 1 ? '0' : '8px')
            + '; padding:10px 12px; background:rgba(8,12,20,0.82); border:1px solid '
            + (idx === 0 ? script.accent : 'rgba(96,110,128,0.35)')
            + '; border-radius:6px;">'
            + '<div style="font-size:8px; letter-spacing:0.7px; color:#7f93a6; margin-bottom:3px;">' + esc(step.title) + '</div>'
            + '<div style="font-size:12px; color:#e8f2f9; line-height:1.4;">' + step.body + '</div>'
            + '<div style="margin-top:6px; font-size:9px; letter-spacing:0.35px; color:#a9d4e8;">' + esc(step.sym) + '</div>'
            + '</div>'
        )).join('');

        const labBtn = script.openAesLab
            ? '<button type="button" class="crypto-arch-open-aeslab" style="cursor:pointer; font:inherit; font-size:9px; letter-spacing:0.5px; color:#e6c15a; background:rgba(230,193,90,0.12); border:1px solid rgba(230,193,90,0.45); border-radius:12px; padding:4px 10px;">AES LAB</button>'
            : '';
        const hsBtn = script.openHandshake
            ? '<button type="button" class="crypto-arch-open-handshake" style="cursor:pointer; font:inherit; font-size:9px; letter-spacing:0.5px; color:#96ffbe; background:rgba(150,255,190,0.10); border:1px solid rgba(150,255,190,0.45); border-radius:12px; padding:4px 10px;">HANDSHAKE</button>'
            : '';
        this.archMorphNode.innerHTML = (
            '<div style="padding:14px 16px; border:1px solid '
            + script.accent
            + '; border-radius:10px; background:linear-gradient(180deg, rgba(20,28,40,0.96), rgba(8,12,18,0.94)); box-shadow:0 0 28px rgba(80,140,200,0.18);">'
            + '<div style="display:flex; align-items:flex-start; gap:12px; margin-bottom:12px;">'
            + '<div style="flex:1;">'
            + '<div style="font-size:9px; letter-spacing:1px; color:#e6c15a;">' + esc(script.title) + '</div>'
            + '<div style="font-size:11px; color:#9db0c6; margin-top:4px; line-height:1.45;">' + esc(script.tagline) + '</div>'
            + '</div>'
            + hsBtn
            + labBtn
            + '<button type="button" class="crypto-arch-morph-close" style="cursor:pointer; font:inherit; font-size:9px; letter-spacing:0.5px; color:#c8ccd4; background:transparent; border:1px solid rgba(160,170,190,0.35); border-radius:12px; padding:4px 10px;">CLOSE</button>'
            + '</div>'
            + stepsHtml
            + '<div style="margin-top:10px; font-size:8.5px; color:#556273; letter-spacing:0.4px;">'
            + (this.archMorphTarget.layer === 'primitives'
                ? 'magic: one primitive · many subsystems · mode chooses the API'
                : 'magic: one API · many consumers · fastest impl wins')
            + '</div></div>'
        );
        this.archMorphNode.style.display = 'block';

        const closeBtn = this.archMorphNode.querySelector('.crypto-arch-morph-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeArchMorph();
                this.renderFlowMap(this.lastPayload || this.normalizeTelemetry(this.getFallbackTelemetry()));
            });
        }
        const lab = this.archMorphNode.querySelector('.crypto-arch-open-aeslab');
        if (lab) {
            lab.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeArchMorph();
                this.selectedCompetitionAlgorithm = 'AES';
                this.activeCryptoView = 'LINEAR_ANALYSIS';
                this.updateCryptoViewToggle();
                this.syncOverlayForCurrentView();
                this.renderFlowMap(this.lastPayload || this.normalizeTelemetry(this.getFallbackTelemetry()));
            });
        }
        const hs = this.archMorphNode.querySelector('.crypto-arch-open-handshake');
        if (hs) {
            hs.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeArchMorph();
                this.handshakeRendered = false;
                this.activeCryptoView = 'HANDSHAKE';
                this.updateCryptoViewToggle();
                this.syncOverlayForCurrentView();
                this.renderFlowMap(this.lastPayload || this.normalizeTelemetry(this.getFallbackTelemetry()));
            });
        }
        const steps = [...this.archMorphNode.querySelectorAll('.crypto-arch-morph-step')];
        steps.forEach((el, i) => {
            setTimeout(() => {
                el.style.opacity = '1';
                el.style.transform = 'translateY(0)';
            }, 80 + i * 140);
        });
        this.flashArchGhost(script.ghost);
    }

    drawSchemeXor(g, cx, cy, r = 9) {
        g.append('circle')
            .attr('cx', cx)
            .attr('cy', cy)
            .attr('r', r)
            .style('fill', 'rgba(8,12,18,0.95)')
            .style('stroke', '#d7e3f0')
            .style('stroke-width', 1.4);
        g.append('line').attr('x1', cx - r + 3).attr('y1', cy).attr('x2', cx + r - 3).attr('y2', cy)
            .style('stroke', '#d7e3f0').style('stroke-width', 1.2);
        g.append('line').attr('x1', cx).attr('y1', cy - r + 3).attr('x2', cx).attr('y2', cy + r - 3)
            .style('stroke', '#d7e3f0').style('stroke-width', 1.2);
    }

    drawSchemeOp(g, cx, cy, letter, color = '#8fdcff', r = 11) {
        g.append('circle')
            .attr('cx', cx)
            .attr('cy', cy)
            .attr('r', r)
            .style('fill', 'rgba(10,14,22,0.95)')
            .style('stroke', color)
            .style('stroke-width', 1.3);
        g.append('text')
            .attr('x', cx)
            .attr('y', cy + 4)
            .attr('text-anchor', 'middle')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '11px')
            .style('fill', color)
            .text(letter);
    }

    drawSchemeBox(g, x, y, w, h, title, sub, stroke = 'rgba(169,212,232,0.55)') {
        g.append('rect')
            .attr('x', x)
            .attr('y', y)
            .attr('width', w)
            .attr('height', h)
            .attr('rx', 4)
            .style('fill', 'rgba(10,14,20,0.92)')
            .style('stroke', stroke);
        g.append('text')
            .attr('x', x + w / 2)
            .attr('y', y + (sub ? h / 2 - 2 : h / 2 + 4))
            .attr('text-anchor', 'middle')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '11px')
            .style('fill', '#e8f0fa')
            .text(title);
        if (sub) {
            g.append('text')
                .attr('x', x + w / 2)
                .attr('y', y + h / 2 + 12)
                .attr('text-anchor', 'middle')
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '9px')
                .style('fill', '#7f93a6')
                .text(sub);
        }
    }

    drawSchemeArrow(g, x1, y1, x2, y2, color = 'rgba(180,200,220,0.65)') {
        g.append('line')
            .attr('x1', x1)
            .attr('y1', y1)
            .attr('x2', x2)
            .attr('y2', y2)
            .style('stroke', color)
            .style('stroke-width', 1.2)
            .attr('marker-end', 'url(#scheme-arrow)');
    }

    drawSchemeChrome(g, width, height, opts) {
        const self = this;
        const {
            title,
            narrator,
            shortDriver,
            showNr = true,
            footerExtra = ''
        } = opts;

        const defs = g.append('defs');
        defs.append('marker')
            .attr('id', 'scheme-arrow')
            .attr('viewBox', '0 0 10 10')
            .attr('refX', 8)
            .attr('refY', 5)
            .attr('markerWidth', 6)
            .attr('markerHeight', 6)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M 0 0 L 10 5 L 0 10 z')
            .style('fill', 'rgba(180,200,220,0.75)');

        const marginX = 28;
        const top = 100;
        const frameH = Math.min(height - top - 52, 640);
        const frameW = width - marginX * 2;

        g.append('rect')
            .attr('x', marginX)
            .attr('y', top)
            .attr('width', frameW)
            .attr('height', frameH)
            .attr('rx', 10)
            .style('fill', 'rgba(6, 10, 16, 0.48)')
            .style('stroke', 'rgba(120, 140, 170, 0.3)');

        g.append('text')
            .attr('x', marginX + 16)
            .attr('y', top + 20)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '12px')
            .style('letter-spacing', '0.8px')
            .style('fill', '#e6c15a')
            .text(title);

        g.append('text')
            .attr('class', 'scheme-narrator')
            .attr('x', marginX + 16)
            .attr('y', top + 38)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '11px')
            .style('fill', '#96ffbe')
            .text(narrator);

        g.append('text')
            .attr('class', 'scheme-phase-pip')
            .attr('x', marginX + 16)
            .attr('y', top + 54)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '9px')
            .style('fill', '#6f8597')
            .text('phase 1/7 · click PLAY or a stage');

        const ctrlX = width - marginX - 118;
        const playBtn = g.append('g')
            .style('cursor', 'pointer')
            .on('click', () => {
                if (self.schemePlaying) self.stopSchemePlay();
                else self.startSchemePlay();
                playLabel.text(self.schemePlaying ? '■ STOP' : '▶ PLAY');
            });
        playBtn.append('rect')
            .attr('x', ctrlX)
            .attr('y', top + 12)
            .attr('width', 100)
            .attr('height', 28)
            .attr('rx', 14)
            .style('fill', 'rgba(230,193,90,0.12)')
            .style('stroke', '#e6c15a');
        const playLabel = playBtn.append('text')
            .attr('class', 'scheme-play-label')
            .attr('x', ctrlX + 50)
            .attr('y', top + 30)
            .attr('text-anchor', 'middle')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '11px')
            .style('fill', '#e6c15a')
            .text(this.schemePlaying ? '■ STOP' : '▶ PLAY');

        const stepBtn = g.append('g')
            .style('cursor', 'pointer')
            .on('click', () => {
                self.stopSchemePlay();
                playLabel.text('▶ PLAY');
                self.schemePhase = (self.schemePhase + 1) % 7;
                self.applySchemePhase(self.schemePhase);
            });
        stepBtn.append('rect')
            .attr('x', ctrlX - 88)
            .attr('y', top + 12)
            .attr('width', 80)
            .attr('height', 28)
            .attr('rx', 14)
            .style('fill', 'rgba(143,220,255,0.10)')
            .style('stroke', '#8fdcff');
        stepBtn.append('text')
            .attr('x', ctrlX - 48)
            .attr('y', top + 30)
            .attr('text-anchor', 'middle')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '11px')
            .style('fill', '#8fdcff')
            .text('STEP ▶');

        if (showNr) {
            [10, 14].forEach((nr, i) => {
                const chip = g.append('g')
                    .attr('class', 'scheme-nr-chip')
                    .attr('data-nr', nr)
                    .style('cursor', 'pointer')
                    .style('opacity', this.schemeNr === nr ? 1 : 0.4)
                    .on('click', () => {
                        self.schemeNr = nr;
                        self.applySchemePhase(self.schemePhase);
                    });
                chip.append('rect')
                    .attr('x', ctrlX - 200 + i * 54)
                    .attr('y', top + 14)
                    .attr('width', 50)
                    .attr('height', 24)
                    .attr('rx', 10)
                    .style('fill', 'rgba(150,255,190,0.08)')
                    .style('stroke', '#96ffbe');
                chip.append('text')
                    .attr('x', ctrlX - 175 + i * 54)
                    .attr('y', top + 30)
                    .attr('text-anchor', 'middle')
                    .style('font-family', 'Share Tech Mono, monospace')
                    .style('font-size', '10px')
                    .style('fill', '#96ffbe')
                    .text(nr === 10 ? 'Nr10' : 'Nr14');
            });
        } else {
            const chip = g.append('g');
            chip.append('rect')
                .attr('x', ctrlX - 146)
                .attr('y', top + 14)
                .attr('width', 50)
                .attr('height', 24)
                .attr('rx', 10)
                .style('fill', 'rgba(150,255,190,0.12)')
                .style('stroke', '#96ffbe');
            chip.append('text')
                .attr('x', ctrlX - 121)
                .attr('y', top + 30)
                .attr('text-anchor', 'middle')
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '10px')
                .style('fill', '#96ffbe')
                .text('20r');
        }

        return { marginX, top, frameH, frameW, playLabel, shortDriver, footerExtra };
    }

    drawSchemePanels(g, layout, self) {
        const { marginX, top, frameH, frameW } = layout;
        const inspW = Math.min(300, frameW * 0.28);
        const codeW = Math.min(360, frameW * 0.34);
        const inspX = marginX + frameW - inspW - codeW - 28;
        const codeX = marginX + frameW - codeW - 16;
        const inspY = top + frameH - 124;
        const insp = g.append('g').attr('class', 'scheme-inspect');
        insp.append('rect')
            .attr('x', inspX)
            .attr('y', inspY)
            .attr('width', inspW)
            .attr('height', 96)
            .attr('rx', 8)
            .style('fill', 'rgba(8,12,20,0.94)')
            .style('stroke', 'rgba(230,193,90,0.45)');
        insp.append('text')
            .attr('x', inspX + 12)
            .attr('y', inspY + 16)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '9px')
            .style('letter-spacing', '0.6px')
            .style('fill', '#e6c15a')
            .text('INSPECT · phase detail');
        for (let i = 0; i < 4; i += 1) {
            insp.append('text')
                .attr('class', 'scheme-inspect-line')
                .attr('x', inspX + 12)
                .attr('y', inspY + 34 + i * 13)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', i === 0 ? '11px' : '9px')
                .style('fill', i === 0 ? '#e8f0fa' : '#9db0c6')
                .text('');
        }

        const codePanel = g.append('g').attr('class', 'scheme-code-panel');
        codePanel.append('rect')
            .attr('x', codeX)
            .attr('y', inspY)
            .attr('width', codeW)
            .attr('height', 96)
            .attr('rx', 8)
            .style('fill', 'rgba(8,12,20,0.94)')
            .style('stroke', 'rgba(143,220,255,0.45)');
        codePanel.append('text')
            .attr('x', codeX + 12)
            .attr('y', inspY + 16)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '9px')
            .style('letter-spacing', '0.6px')
            .style('fill', '#8fdcff')
            .text('CODE · elixir.bootlin.com');
        const openPrimary = codePanel.append('g')
            .style('cursor', 'pointer')
            .on('click', () => {
                const refs = self._schemePhaseRefs || [];
                if (refs[0]) self.openSchemeCodeRef(refs[0]);
            });
        openPrimary.append('rect')
            .attr('x', codeX + codeW - 86)
            .attr('y', inspY + 6)
            .attr('width', 74)
            .attr('height', 18)
            .attr('rx', 9)
            .style('fill', 'rgba(143,220,255,0.12)')
            .style('stroke', '#8fdcff');
        openPrimary.append('text')
            .attr('x', codeX + codeW - 49)
            .attr('y', inspY + 18)
            .attr('text-anchor', 'middle')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '9px')
            .style('fill', '#8fdcff')
            .text('OPEN ↗');

        for (let i = 0; i < 3; i += 1) {
            const ry = inspY + 28 + i * 22;
            const row = codePanel.append('g')
                .attr('class', 'scheme-code-ref')
                .attr('data-ref-i', i)
                .style('cursor', 'pointer')
                .on('click', () => {
                    const refs = self._schemePhaseRefs || [];
                    if (refs[i]) self.openSchemeCodeRef(refs[i]);
                })
                .on('mousemove', (ev) => {
                    const refs = self._schemePhaseRefs || [];
                    const ref = refs[i];
                    if (!ref || !self.hoverCard) return;
                    self.hoverCard.style.display = 'block';
                    self.hoverCard.textContent = [
                        ref.sym,
                        ref.file,
                        ref.note || '',
                        'click → open on Elixir Bootlin'
                    ].filter(Boolean).join('\n');
                    self.positionHoverCard(ev);
                })
                .on('mouseleave', () => {
                    if (self.hoverCard) self.hoverCard.style.display = 'none';
                });
            row.append('rect')
                .attr('x', codeX + 8)
                .attr('y', ry - 2)
                .attr('width', codeW - 16)
                .attr('height', 20)
                .attr('rx', 4)
                .style('fill', 'rgba(20,28,40,0.75)')
                .style('stroke', 'rgba(100,120,150,0.25)');
            row.append('text')
                .attr('class', 'scheme-code-sym')
                .attr('x', codeX + 14)
                .attr('y', ry + 12)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '10px')
                .style('fill', '#96ffbe')
                .text('');
            row.append('text')
                .attr('class', 'scheme-code-file')
                .attr('x', codeX + 14 + Math.min(150, codeW * 0.42))
                .attr('y', ry + 12)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '8px')
                .style('fill', '#9db0c6')
                .text('');
            row.append('text')
                .attr('class', 'scheme-code-note')
                .attr('x', codeX + codeW - 14)
                .attr('y', ry + 12)
                .attr('text-anchor', 'end')
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '8px')
                .style('fill', '#6f8597')
                .text('');
        }
        g.append('text')
            .attr('class', 'scheme-code-hint')
            .attr('x', marginX + 16)
            .attr('y', top + frameH - 18)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '9px')
            .style('fill', '#8fdcff')
            .text('click a symbol → Elixir');
        g.append('text')
            .attr('class', 'scheme-inspect-byte')
            .attr('x', marginX + 16)
            .attr('y', top + frameH - 32)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '9px')
            .style('fill', '#6f8597')
            .text('');
    }

    drawSchemeCtas(g, width, height, marginX) {
        const ctaY = height - 40;
        const makeCta = (label, x, stroke, onClick) => {
            const cta = g.append('g').style('cursor', 'pointer').on('click', onClick);
            cta.append('rect').attr('x', x).attr('y', ctaY).attr('width', 140).attr('height', 26).attr('rx', 13)
                .style('fill', 'rgba(8,12,18,0.9)').style('stroke', stroke);
            cta.append('text').attr('x', x + 70).attr('y', ctaY + 17).attr('text-anchor', 'middle')
                .style('font-family', 'Share Tech Mono, monospace').style('font-size', '10px').style('fill', stroke)
                .text(label);
        };
        makeCta('← ARCHITECTURE', marginX, '#a9d4e8', () => {
            this.stopSchemePlay();
            this.schemeSource = null;
            this.schemeRendered = false;
            this.activeCryptoView = 'ARCHITECTURE';
            this.updateCryptoViewToggle();
            this.syncOverlayForCurrentView();
            this.renderFlowMap(this.lastPayload || this.normalizeTelemetry(this.getFallbackTelemetry()));
        });
        makeCta('→ AES LAB', marginX + 152, '#e6c15a', () => {
            this.stopSchemePlay();
            this.schemeSource = null;
            this.schemeRendered = false;
            this.selectedCompetitionAlgorithm = 'AES';
            this.activeCryptoView = 'LINEAR_ANALYSIS';
            this.updateCryptoViewToggle();
            this.syncOverlayForCurrentView();
            this.renderFlowMap(this.lastPayload || this.normalizeTelemetry(this.getFallbackTelemetry()));
        });
        makeCta('→ HANDSHAKE', marginX + 304, '#96ffbe', () => {
            this.stopSchemePlay();
            this.schemeSource = null;
            this.schemeRendered = false;
            this.handshakeRendered = false;
            this.activeCryptoView = 'HANDSHAKE';
            this.updateCryptoViewToggle();
            this.syncOverlayForCurrentView();
            this.renderFlowMap(this.lastPayload || this.normalizeTelemetry(this.getFallbackTelemetry()));
        });
    }

    drawSchemeView(layer, payload, width, height) {
        if (this.schemeKind === 'wg-chacha') {
            this.drawWgChachaSchemeView(layer, payload, width, height);
            return;
        }
        const g = layer.append('g').attr('class', 'crypto-scheme-view');
        const meta = payload?.meta || {};
        const comp = this.getCompetitionPayload(meta) || {};
        const selected = String(comp?.selected?.name || 'aes-aesni / gcm-aes-ce');
        const shortDriver = selected.replace(/^_+/, '').slice(0, 22);
        const self = this;

        const layout = this.drawSchemeChrome(g, width, height, {
            title: `Рис. · ${(this.schemeSource?.label || 'kTLS / AES').toString()} → AES-GCM`,
            narrator: 'TLS record lands in kTLS — 128-bit AES state ready',
            shortDriver,
            showNr: true
        });
        const { marginX, top, frameH, frameW, playLabel } = layout;

        const colTop = top + 68;
        const leftX = marginX + frameW * 0.06;
        const midX = marginX + frameW * 0.38;
        const rightX = marginX + frameW * 0.66;
        const boxW = Math.min(150, frameW * 0.18);
        const spineX = midX;

        // Mini AES state 4×4
        const grid = g.append('g').attr('class', 'scheme-state-grid');
        const cell = 14;
        const gx0 = leftX;
        const gy0 = colTop + 8;
        grid.append('text')
            .attr('x', gx0)
            .attr('y', gy0 - 6)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '9px')
            .style('fill', '#8fdcff')
            .text('AES state 4×4 · click byte');
        for (let i = 0; i < 16; i += 1) {
            const r = Math.floor(i / 4);
            const c = i % 4;
            grid.append('rect')
                .attr('class', 'scheme-state-cell')
                .attr('data-i', i)
                .attr('x', gx0 + c * (cell + 3))
                .attr('y', gy0 + r * (cell + 3))
                .attr('width', cell)
                .attr('height', cell)
                .attr('rx', 2)
                .style('fill', 'rgba(40,55,75,0.85)')
                .style('stroke', 'rgba(140,160,180,0.35)')
                .style('cursor', 'pointer')
                .on('click', () => {
                    self.schemeInspectByte = i;
                    self.applySchemePhase(self.schemePhase);
                });
        }

        // Kernel call rail under the state grid
        const kernelCalls = [
            { id: 0, label: 'kTLS record' },
            { id: 1, label: 'aead_encrypt' },
            { id: 2, label: 'aesni / ce' },
            { id: 3, label: 'GHASH tag' },
            { id: 4, label: 'wire out' }
        ];
        const railY0 = gy0 + 4 * (cell + 3) + 18;
        g.append('text')
            .attr('x', gx0)
            .attr('y', railY0 - 4)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '9px')
            .style('fill', '#e6c15a')
            .text('KERNEL CALLS');
        const kernelSymById = {
            0: 'tls_sw_sendmsg',
            1: 'crypto_aead_encrypt',
            2: /(-ce\b|neon|aes-ce)/i.test(shortDriver) ? 'ce_aes_ecb_encrypt' : 'aesni_encrypt',
            3: 'ghash_update',
            4: 'tcp_sendmsg'
        };
        kernelCalls.forEach((kc, i) => {
            const ky = railY0 + 6 + i * 28;
            const step = g.append('g')
                .attr('class', 'scheme-kernel-step')
                .attr('data-kernel', kc.id)
                .style('opacity', 0.35)
                .style('cursor', 'pointer')
                .on('click', () => {
                    self.openSchemeCodeRef({ sym: kernelSymById[kc.id] });
                })
                .on('mousemove', (ev) => {
                    if (!self.hoverCard) return;
                    self.hoverCard.style.display = 'block';
                    self.hoverCard.textContent = `${kernelSymById[kc.id]}()\nclick → open executing code on Elixir`;
                    self.positionHoverCard(ev);
                })
                .on('mouseleave', () => {
                    if (self.hoverCard) self.hoverCard.style.display = 'none';
                });
            step.append('rect')
                .attr('x', gx0)
                .attr('y', ky)
                .attr('width', 92)
                .attr('height', 22)
                .attr('rx', 4)
                .style('fill', 'rgba(10,14,20,0.9)')
                .style('stroke', 'rgba(120,140,170,0.35)');
            step.append('text')
                .attr('x', gx0 + 46)
                .attr('y', ky + 15)
                .attr('text-anchor', 'middle')
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '9px')
                .style('fill', '#d7e3f0')
                .text(kc.label);
            if (i < kernelCalls.length - 1) {
                g.append('line')
                    .attr('x1', gx0 + 46)
                    .attr('y1', ky + 22)
                    .attr('x2', gx0 + 46)
                    .attr('y2', ky + 28)
                    .style('stroke', 'rgba(160,180,200,0.35)')
                    .style('stroke-width', 1);
            }
        });

        this.drawSchemePanels(g, layout, self);
        const tip = (title, body) => {
            if (!this.hoverCard) return;
            this.hoverCard.style.display = 'block';
            this.hoverCard.textContent = `${title}\n${body}`;
        };

        const phaseGroup = (phase, x, y, w, h) => {
            const grp = g.append('g')
                .attr('class', 'scheme-phase-group')
                .attr('data-phase', phase)
                .style('cursor', 'pointer')
                .style('opacity', 0.55)
                .on('click', () => {
                    self.stopSchemePlay();
                    playLabel.text('▶ PLAY');
                    self.schemePhase = phase;
                    self.applySchemePhase(phase);
                });
            grp.append('rect')
                .attr('class', 'scheme-phase-glow')
                .attr('x', x)
                .attr('y', y)
                .attr('width', w)
                .attr('height', h)
                .attr('rx', 8)
                .style('fill', 'rgba(230,193,90,0.08)')
                .style('stroke', 'rgba(230,193,90,0.55)')
                .style('opacity', 0);
            return grp;
        };

        g.append('text')
            .attr('x', spineX)
            .attr('y', colTop)
            .attr('text-anchor', 'middle')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '10px')
            .style('fill', '#a9d4e8')
            .text('DATA PATH');
        g.append('text')
            .attr('x', rightX + boxW / 2)
            .attr('y', colTop)
            .attr('text-anchor', 'middle')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '10px')
            .style('fill', '#c4b0ff')
            .text('KEY / DRIVER SCHEDULE');

        const inY = colTop + 14;
        const p0 = phaseGroup(0, leftX - 6, inY - 4, boxW * 2.2, 56);
        this.drawSchemeBox(p0, leftX + 78, inY, boxW * 0.85, 40, 'TLS record', 'plaintext · AAD', 'rgba(169,212,232,0.65)');
        this.drawSchemeBox(p0, spineX - boxW * 0.4, inY, boxW * 0.85, 40, '128-bit block', 'into AES state', 'rgba(150,255,190,0.5)');

        let y = inY + 72;
        this.drawSchemeArrow(g, spineX, inY + 40, spineX, y);

        const drawRound = (parent, roundLabel, keyLabel, y0, showMix, phase) => {
            const xorY = y0;
            this.drawSchemeXor(parent, spineX, xorY, 10);
            const inject = parent.append('line')
                .attr('class', 'scheme-key-inject')
                .attr('data-phase', phase)
                .attr('x1', rightX)
                .attr('y1', xorY)
                .attr('x2', spineX + 10)
                .attr('y2', xorY)
                .style('stroke', '#c4b0ff')
                .style('stroke-width', 1.4)
                .style('stroke-dasharray', '5 4')
                .attr('stroke-dashoffset', 20)
                .attr('marker-end', 'url(#scheme-arrow)');
            const runDash = () => {
                inject.transition().duration(1400).ease(d3.easeLinear)
                    .attr('stroke-dashoffset', 0)
                    .on('end', () => {
                        inject.attr('stroke-dashoffset', 20);
                        runDash();
                    });
            };
            runDash();
            parent.append('text')
                .attr('x', (rightX + spineX) / 2)
                .attr('y', xorY - 8)
                .attr('text-anchor', 'middle')
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '9px')
                .style('fill', '#c4b0ff')
                .text(keyLabel);
            parent.append('text')
                .attr('x', spineX - 52)
                .attr('y', xorY + 4)
                .attr('text-anchor', 'end')
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '9px')
                .style('fill', '#e6c15a')
                .text(roundLabel);

            let yy = xorY + 22;
            this.drawSchemeArrow(parent, spineX, xorY + 10, spineX, yy - 11);
            const s = parent.append('g').style('cursor', 'help')
                .on('mousemove', (ev) => { tip('SubBytes (S)', 'non-linear byte substitution · S-box'); this.positionHoverCard(ev); })
                .on('mouseleave', () => { if (this.hoverCard) this.hoverCard.style.display = 'none'; });
            this.drawSchemeOp(s, spineX, yy, 'S', '#e6c15a');
            parent.append('text').attr('x', spineX + 18).attr('y', yy + 4)
                .style('font-family', 'Share Tech Mono, monospace').style('font-size', '9px').style('fill', '#8d99a7')
                .text('SubBytes');

            yy += 26;
            this.drawSchemeArrow(parent, spineX, yy - 15, spineX, yy - 11);
            const p = parent.append('g').style('cursor', 'help')
                .on('mousemove', (ev) => { tip('ShiftRows (P)', 'row-wise rotation of the 4×4 state'); this.positionHoverCard(ev); })
                .on('mouseleave', () => { if (this.hoverCard) this.hoverCard.style.display = 'none'; });
            this.drawSchemeOp(p, spineX, yy, 'P', '#8fdcff');
            parent.append('text').attr('x', spineX + 18).attr('y', yy + 4)
                .style('font-family', 'Share Tech Mono, monospace').style('font-size', '9px').style('fill', '#8d99a7')
                .text('ShiftRows');

            if (showMix) {
                yy += 26;
                this.drawSchemeArrow(parent, spineX, yy - 15, spineX, yy - 11);
                const m = parent.append('g').style('cursor', 'help')
                    .on('mousemove', (ev) => { tip('MixColumns (M)', 'column diffusion in GF(2^8)'); this.positionHoverCard(ev); })
                    .on('mouseleave', () => { if (this.hoverCard) this.hoverCard.style.display = 'none'; });
                this.drawSchemeOp(m, spineX, yy, 'M', '#96ffbe');
                parent.append('text').attr('x', spineX + 18).attr('y', yy + 4)
                    .style('font-family', 'Share Tech Mono, monospace').style('font-size', '9px').style('fill', '#8d99a7')
                    .text('MixColumns');
            }
            return yy + 16;
        };

        const p1 = phaseGroup(1, spineX - 120, y - 8, 250, 110);
        y = drawRound(p1, 'round 1', 'K₀', y, true, 1);
        this.drawSchemeArrow(g, spineX, y - 6, spineX, y + 8);
        y += 12;
        const p2 = phaseGroup(2, spineX - 120, y - 8, 250, 110);
        y = drawRound(p2, 'round 2', 'K₁', y, true, 2);

        const ellY = y + 6;
        const p3 = phaseGroup(3, spineX - 120, ellY - 4, 250, 36);
        p3.append('text').attr('x', spineX).attr('y', ellY + 18).attr('text-anchor', 'middle')
            .style('font-family', 'Share Tech Mono, monospace').style('font-size', '16px').style('fill', '#6f8597')
            .text('· · ·');
        p3.append('text').attr('x', spineX + 40).attr('y', ellY + 18)
            .style('font-family', 'Share Tech Mono, monospace').style('font-size', '9px').style('fill', '#6f8597')
            .text('rounds 3 … Nr−1');

        y = ellY + 40;
        this.drawSchemeArrow(g, spineX, ellY + 28, spineX, y);
        const p4 = phaseGroup(4, spineX - 120, y - 8, 250, 90);
        y = drawRound(p4, 'round Nr', 'Kₙ', y, false, 4);

        const outY = Math.min(y + 24, top + frameH - 78);
        this.drawSchemeArrow(g, spineX, y, spineX, outY - 6);
        const p5 = phaseGroup(5, leftX - 4, outY - 56, boxW * 0.95, 48);
        this.drawSchemeBox(p5, leftX, outY - 50, boxW * 0.9, 40, 'GHASH', 'AAD + ciphertext', 'rgba(143,220,255,0.55)');
        g.append('line')
            .attr('x1', leftX + boxW * 0.9)
            .attr('y1', outY - 30)
            .attr('x2', spineX - 70)
            .attr('y2', outY + 12)
            .style('stroke', 'rgba(143,220,255,0.45)')
            .style('stroke-width', 1)
            .style('stroke-dasharray', '3 3');

        const p6 = phaseGroup(6, spineX - boxW * 0.6, outY - 4, boxW * 1.2, 52);
        this.drawSchemeBox(p6, spineX - boxW * 0.55, outY, boxW * 1.1, 44, 'ciphertext ∥ tag', 'AES-GCM record out', 'rgba(230,193,90,0.6)');

        // Right column — key/driver schedule with stage sync
        let ky = inY;
        const kw = boxW * 1.05;
        const keyWrap = (stage, drawFn) => {
            const grp = g.append('g')
                .attr('class', 'scheme-key-stage')
                .attr('data-key-stage', stage)
                .style('opacity', 0.35);
            drawFn(grp);
            return grp;
        };
        keyWrap(0, (grp) => {
            this.drawSchemeBox(grp, rightX, ky, kw, 38, 'traffic key', 'HKDF / handshake', 'rgba(196,176,255,0.55)');
        });
        ky += 48;
        this.drawSchemeArrow(g, rightX + kw / 2, ky - 10, rightX + kw / 2, ky);
        keyWrap(1, (grp) => {
            this.drawSchemeBox(grp, rightX, ky, kw, 38, 'crypto_alloc_aead', 'gcm(aes)', 'rgba(230,193,90,0.45)');
        });
        ky += 48;
        this.drawSchemeArrow(g, rightX + kw / 2, ky - 10, rightX + kw / 2, ky);
        keyWrap(2, (grp) => {
            this.drawSchemeBox(grp, rightX, ky, kw, 46, 'priority race', shortDriver || 'aesni / ce', 'rgba(150,255,190,0.5)');
        });
        g.append('text')
            .attr('class', 'scheme-selected-driver')
            .attr('x', rightX + kw / 2)
            .attr('y', ky + 58)
            .attr('text-anchor', 'middle')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '8px')
            .style('fill', '#96ffbe')
            .text(`live: ${shortDriver}`);
        ky += 70;
        this.drawSchemeArrow(g, rightX + kw / 2, ky - 12, rightX + kw / 2, ky);
        keyWrap(3, (grp) => {
            this.drawSchemeBox(grp, rightX, ky, kw, 38, 'setkey(tfm)', 'K → round keys', 'rgba(169,212,232,0.5)');
        });
        ky += 50;
        ['K₀ expand', 'ROL / S-box', 'K₁ … Kₙ'].forEach((label, i) => {
            const oy = ky + i * 34;
            const stage = i === 0 ? 3 : (i === 1 ? 4 : 5);
            const grp = g.append('g')
                .attr('class', 'scheme-key-stage')
                .attr('data-key-stage', stage)
                .style('opacity', 0.35);
            grp.append('ellipse')
                .attr('cx', rightX + kw / 2)
                .attr('cy', oy + 10)
                .attr('rx', kw * 0.42)
                .attr('ry', 13)
                .style('fill', 'rgba(12,16,24,0.95)')
                .style('stroke', 'rgba(196,176,255,0.55)');
            grp.append('text')
                .attr('x', rightX + kw / 2)
                .attr('y', oy + 14)
                .attr('text-anchor', 'middle')
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '9px')
                .style('fill', '#d7c6ff')
                .text(label);
        });

        g.append('text')
            .attr('x', marginX + 180)
            .attr('y', top + frameH - 18)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '9px')
            .style('fill', '#6f8597')
            .text(`· Nr10/14 · ${shortDriver}`);

        this.drawSchemeCtas(g, width, height, marginX);
        this.schemeRendered = true;
        this.applySchemePhase(this.schemePhase || 0);
    }

    drawWgChachaSchemeView(layer, payload, width, height) {
        const g = layer.append('g').attr('class', 'crypto-scheme-view');
        const meta = payload?.meta || {};
        const comp = this.getCompetitionPayload(meta) || {};
        const selected = String(comp?.selected?.name || 'chacha20poly1305 / simd');
        const shortDriver = selected.replace(/^_+/, '').slice(0, 22);
        const self = this;
        const src = (this.schemeSource?.label || 'WireGuard').toString();

        const layout = this.drawSchemeChrome(g, width, height, {
            title: `Рис. · ${src} → ChaCha20-Poly1305`,
            narrator: 'WireGuard transport — Noise keys ready, AEAD encrypts the packet',
            shortDriver,
            showNr: false
        });
        const { marginX, top, frameH, frameW, playLabel } = layout;
        const colTop = top + 68;
        const leftX = marginX + frameW * 0.06;
        const midX = marginX + frameW * 0.38;
        const rightX = marginX + frameW * 0.66;
        const boxW = Math.min(150, frameW * 0.18);
        const spineX = midX;

        // ChaCha 4×4 state (32-bit words)
        const grid = g.append('g').attr('class', 'scheme-state-grid');
        const cell = 14;
        const gx0 = leftX;
        const gy0 = colTop + 8;
        grid.append('text')
            .attr('x', gx0)
            .attr('y', gy0 - 6)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '9px')
            .style('fill', '#8fdcff')
            .text('ChaCha state 4×4 · 32-bit words');
        for (let i = 0; i < 16; i += 1) {
            const r = Math.floor(i / 4);
            const c = i % 4;
            grid.append('rect')
                .attr('class', 'scheme-state-cell')
                .attr('data-i', i)
                .attr('x', gx0 + c * (cell + 3))
                .attr('y', gy0 + r * (cell + 3))
                .attr('width', cell)
                .attr('height', cell)
                .attr('rx', 2)
                .style('fill', 'rgba(40,55,75,0.85)')
                .style('stroke', 'rgba(140,160,180,0.35)')
                .style('cursor', 'pointer')
                .on('click', () => {
                    self.schemeInspectByte = i;
                    self.applySchemePhase(self.schemePhase);
                });
        }

        const kernelCalls = [
            { id: 0, label: 'wg encrypt' },
            { id: 1, label: 'alloc_aead' },
            { id: 2, label: 'chacha20' },
            { id: 3, label: 'poly1305' },
            { id: 4, label: 'UDP out' }
        ];
        const railY0 = gy0 + 4 * (cell + 3) + 18;
        g.append('text')
            .attr('x', gx0)
            .attr('y', railY0 - 4)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '9px')
            .style('fill', '#e6c15a')
            .text('KERNEL CALLS');
        const kernelSymById = {
            0: 'wg_packet_encrypt_worker',
            1: 'crypto_alloc_aead',
            2: 'chacha_block_generic',
            3: 'poly1305_core_blocks',
            4: 'udp_sendmsg'
        };
        kernelCalls.forEach((kc, i) => {
            const ky = railY0 + 6 + i * 28;
            const step = g.append('g')
                .attr('class', 'scheme-kernel-step')
                .attr('data-kernel', kc.id)
                .style('opacity', 0.35)
                .style('cursor', 'pointer')
                .on('click', () => {
                    self.openSchemeCodeRef({ sym: kernelSymById[kc.id] });
                })
                .on('mousemove', (ev) => {
                    if (!self.hoverCard) return;
                    self.hoverCard.style.display = 'block';
                    self.hoverCard.textContent = `${kernelSymById[kc.id]}()\nclick → open executing code on Elixir`;
                    self.positionHoverCard(ev);
                })
                .on('mouseleave', () => {
                    if (self.hoverCard) self.hoverCard.style.display = 'none';
                });
            step.append('rect')
                .attr('x', gx0)
                .attr('y', ky)
                .attr('width', 92)
                .attr('height', 22)
                .attr('rx', 4)
                .style('fill', 'rgba(10,14,20,0.9)')
                .style('stroke', 'rgba(120,140,170,0.35)');
            step.append('text')
                .attr('x', gx0 + 46)
                .attr('y', ky + 15)
                .attr('text-anchor', 'middle')
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '9px')
                .style('fill', '#d7e3f0')
                .text(kc.label);
            if (i < kernelCalls.length - 1) {
                g.append('line')
                    .attr('x1', gx0 + 46)
                    .attr('y1', ky + 22)
                    .attr('x2', gx0 + 46)
                    .attr('y2', ky + 28)
                    .style('stroke', 'rgba(160,180,200,0.35)')
                    .style('stroke-width', 1);
            }
        });

        this.drawSchemePanels(g, layout, self);

        const tip = (title, body) => {
            if (!this.hoverCard) return;
            this.hoverCard.style.display = 'block';
            this.hoverCard.textContent = `${title}\n${body}`;
        };

        const phaseGroup = (phase, x, y, w, h) => {
            const grp = g.append('g')
                .attr('class', 'scheme-phase-group')
                .attr('data-phase', phase)
                .style('cursor', 'pointer')
                .style('opacity', 0.55)
                .on('click', () => {
                    self.stopSchemePlay();
                    playLabel.text('▶ PLAY');
                    self.schemePhase = phase;
                    self.applySchemePhase(phase);
                });
            grp.append('rect')
                .attr('class', 'scheme-phase-glow')
                .attr('x', x)
                .attr('y', y)
                .attr('width', w)
                .attr('height', h)
                .attr('rx', 8)
                .style('fill', 'rgba(230,193,90,0.08)')
                .style('stroke', 'rgba(230,193,90,0.55)')
                .style('opacity', 0);
            return grp;
        };

        g.append('text')
            .attr('x', spineX)
            .attr('y', colTop)
            .attr('text-anchor', 'middle')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '10px')
            .style('fill', '#a9d4e8')
            .text('DATA PATH');
        g.append('text')
            .attr('x', rightX + boxW / 2)
            .attr('y', colTop)
            .attr('text-anchor', 'middle')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '10px')
            .style('fill', '#c4b0ff')
            .text('KEY / DRIVER SCHEDULE');

        const inY = colTop + 14;
        const p0 = phaseGroup(0, leftX - 6, inY - 4, boxW * 2.2, 56);
        this.drawSchemeBox(p0, leftX + 78, inY, boxW * 0.85, 40, 'WG packet', 'plaintext · AAD', 'rgba(169,212,232,0.65)');
        this.drawSchemeBox(p0, spineX - boxW * 0.4, inY, boxW * 0.85, 40, '512-bit state', 'into ChaCha', 'rgba(150,255,190,0.5)');

        let y = inY + 72;
        this.drawSchemeArrow(g, spineX, inY + 40, spineX, y);

        const drawQr = (parent, roundLabel, y0, phase) => {
            const xorY = y0;
            parent.append('text')
                .attr('x', spineX - 52)
                .attr('y', xorY + 4)
                .attr('text-anchor', 'end')
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '9px')
                .style('fill', '#e6c15a')
                .text(roundLabel);

            let yy = xorY;
            const ops = [
                { l: '+', name: 'ADD', tip: 'word add mod 2³²', c: '#e6c15a' },
                { l: '≪', name: 'ROL', tip: 'rotate left · ARX rotate', c: '#8fdcff' },
                { l: '⊕', name: 'XOR', tip: 'bitwise mix of columns/diagonals', c: '#96ffbe' }
            ];
            ops.forEach((op, oi) => {
                if (oi > 0) this.drawSchemeArrow(parent, spineX, yy - 12, spineX, yy - 8);
                const node = parent.append('g').style('cursor', 'help')
                    .on('mousemove', (ev) => { tip(op.name, op.tip); this.positionHoverCard(ev); })
                    .on('mouseleave', () => { if (this.hoverCard) this.hoverCard.style.display = 'none'; });
                this.drawSchemeOp(node, spineX, yy, op.l, op.c, 12);
                parent.append('text').attr('x', spineX + 18).attr('y', yy + 4)
                    .style('font-family', 'Share Tech Mono, monospace').style('font-size', '9px').style('fill', '#8d99a7')
                    .text(op.name);
                const inject = parent.append('line')
                    .attr('class', 'scheme-key-inject')
                    .attr('data-phase', phase)
                    .attr('x1', rightX)
                    .attr('y1', yy)
                    .attr('x2', spineX + 12)
                    .attr('y2', yy)
                    .style('stroke', '#c4b0ff')
                    .style('stroke-width', oi === 0 ? 1.4 : 0.8)
                    .style('stroke-dasharray', '5 4')
                    .attr('stroke-dashoffset', 20)
                    .style('opacity', oi === 0 ? 1 : 0.35)
                    .attr('marker-end', oi === 0 ? 'url(#scheme-arrow)' : null);
                if (oi === 0) {
                    const runDash = () => {
                        inject.transition().duration(1400).ease(d3.easeLinear)
                            .attr('stroke-dashoffset', 0)
                            .on('end', () => {
                                inject.attr('stroke-dashoffset', 20);
                                runDash();
                            });
                    };
                    runDash();
                    parent.append('text')
                        .attr('x', (rightX + spineX) / 2)
                        .attr('y', yy - 8)
                        .attr('text-anchor', 'middle')
                        .style('font-family', 'Share Tech Mono, monospace')
                        .style('font-size', '9px')
                        .style('fill', '#c4b0ff')
                        .text('state words');
                }
                yy += 28;
            });
            return yy + 4;
        };

        const p1 = phaseGroup(1, spineX - 120, y - 8, 250, 40);
        // phase 1 is alloc in meta — keep visual as entry into rounds
        this.drawSchemeBox(p1, spineX - boxW * 0.45, y, boxW * 0.95, 36, 'crypto API', 'chacha20poly1305', 'rgba(230,193,90,0.5)');
        y += 52;
        this.drawSchemeArrow(g, spineX, y - 12, spineX, y);

        const p2 = phaseGroup(2, spineX - 120, y - 8, 250, 100);
        y = drawQr(p2, 'QR · column', y, 2);
        this.drawSchemeArrow(g, spineX, y - 6, spineX, y + 8);
        y += 12;
        const p3 = phaseGroup(3, spineX - 120, y - 4, 250, 36);
        p3.append('text').attr('x', spineX).attr('y', y + 18).attr('text-anchor', 'middle')
            .style('font-family', 'Share Tech Mono, monospace').style('font-size', '16px').style('fill', '#6f8597')
            .text('· · ·');
        p3.append('text').attr('x', spineX + 40).attr('y', y + 18)
            .style('font-family', 'Share Tech Mono, monospace').style('font-size', '9px').style('fill', '#6f8597')
            .text('10 double-rounds · 20 QR layers');

        y += 40;
        this.drawSchemeArrow(g, spineX, y - 12, spineX, y);
        const p4 = phaseGroup(4, spineX - 120, y - 8, 250, 56);
        this.drawSchemeXor(p4, spineX, y + 14, 11);
        p4.append('text').attr('x', spineX + 20).attr('y', y + 18)
            .style('font-family', 'Share Tech Mono, monospace').style('font-size', '10px').style('fill', '#e8f0fa')
            .text('keystream ⊕ plaintext');
        p4.append('text').attr('x', spineX + 20).attr('y', y + 34)
            .style('font-family', 'Share Tech Mono, monospace').style('font-size', '9px').style('fill', '#8d99a7')
            .text('stream cipher · no padding');

        const outY = Math.min(y + 72, top + frameH - 78);
        this.drawSchemeArrow(g, spineX, y + 48, spineX, outY - 6);
        const p5 = phaseGroup(5, leftX - 4, outY - 56, boxW * 0.95, 48);
        this.drawSchemeBox(p5, leftX, outY - 50, boxW * 0.9, 40, 'Poly1305', 'AAD + ciphertext', 'rgba(143,220,255,0.55)');
        g.append('line')
            .attr('x1', leftX + boxW * 0.9)
            .attr('y1', outY - 30)
            .attr('x2', spineX - 70)
            .attr('y2', outY + 12)
            .style('stroke', 'rgba(143,220,255,0.45)')
            .style('stroke-width', 1)
            .style('stroke-dasharray', '3 3');

        const p6 = phaseGroup(6, spineX - boxW * 0.6, outY - 4, boxW * 1.2, 52);
        this.drawSchemeBox(p6, spineX - boxW * 0.55, outY, boxW * 1.1, 44, 'ciphertext ∥ tag', 'WireGuard UDP out', 'rgba(230,193,90,0.6)');

        // Right column
        let ky = inY;
        const kw = boxW * 1.05;
        const keyWrap = (stage, drawFn) => {
            const grp = g.append('g')
                .attr('class', 'scheme-key-stage')
                .attr('data-key-stage', stage)
                .style('opacity', 0.35);
            drawFn(grp);
            return grp;
        };
        keyWrap(0, (grp) => {
            this.drawSchemeBox(grp, rightX, ky, kw, 38, 'Noise keys', 'handshake done', 'rgba(196,176,255,0.55)');
        });
        ky += 48;
        this.drawSchemeArrow(g, rightX + kw / 2, ky - 10, rightX + kw / 2, ky);
        keyWrap(1, (grp) => {
            this.drawSchemeBox(grp, rightX, ky, kw, 38, 'crypto_alloc_aead', 'chacha20poly1305', 'rgba(230,193,90,0.45)');
        });
        ky += 48;
        this.drawSchemeArrow(g, rightX + kw / 2, ky - 10, rightX + kw / 2, ky);
        keyWrap(2, (grp) => {
            this.drawSchemeBox(grp, rightX, ky, kw, 46, 'priority race', shortDriver || 'simd / generic', 'rgba(150,255,190,0.5)');
        });
        g.append('text')
            .attr('class', 'scheme-selected-driver')
            .attr('x', rightX + kw / 2)
            .attr('y', ky + 58)
            .attr('text-anchor', 'middle')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '8px')
            .style('fill', '#96ffbe')
            .text(`live: ${shortDriver}`);
        ky += 70;
        this.drawSchemeArrow(g, rightX + kw / 2, ky - 12, rightX + kw / 2, ky);
        keyWrap(3, (grp) => {
            this.drawSchemeBox(grp, rightX, ky, kw, 38, 'setkey(tfm)', 'key · nonce · ctr', 'rgba(169,212,232,0.5)');
        });
        ky += 50;
        ['state init', 'QR columns', 'QR diagonals'].forEach((label, i) => {
            const oy = ky + i * 34;
            const stage = i === 0 ? 3 : 4;
            const grp = g.append('g')
                .attr('class', 'scheme-key-stage')
                .attr('data-key-stage', stage)
                .style('opacity', 0.35);
            grp.append('ellipse')
                .attr('cx', rightX + kw / 2)
                .attr('cy', oy + 10)
                .attr('rx', kw * 0.42)
                .attr('ry', 13)
                .style('fill', 'rgba(12,16,24,0.95)')
                .style('stroke', 'rgba(196,176,255,0.55)');
            grp.append('text')
                .attr('x', rightX + kw / 2)
                .attr('y', oy + 14)
                .attr('text-anchor', 'middle')
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '9px')
                .style('fill', '#d7c6ff')
                .text(label);
        });

        g.append('text')
            .attr('x', marginX + 180)
            .attr('y', top + frameH - 18)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '9px')
            .style('fill', '#6f8597')
            .text(`· ARX · Poly1305 · ${shortDriver}`);

        this.drawSchemeCtas(g, width, height, marginX);
        this.schemeRendered = true;
        this.applySchemePhase(this.schemePhase || 0);
    }

    getHandshakeStorySteps() {
        return [
            {
                id: 'hello',
                title: '1 · CLIENTHELLO',
                does: 'PROPOSE',
                sym: 'key_share · cipher suites',
                body: 'client lists what it can speak\nX25519 + AES-GCM are offers only\nstill no secrets, no trust yet',
                accent: '#a9d4e8',
                kernel: 'userspace TLS stack',
                layer: 'USERSPACE',
                ring: 'TLS library (OpenSSL/BoringSSL)',
                symbol: 'SSL_do_handshake()',
                path: 'userspace · not in kernel yet',
                story: 'Handshake begins above the kernel. The client only advertises capabilities — no crypto tfm is allocated in Linux yet.'
            },
            {
                id: 'cert',
                title: '2 · CERTIFICATE',
                does: 'AUTHENTICATE',
                sym: 'CertificateVerify · pubkey',
                body: 'server proves its identity\nsigns the handshake transcript\ndoes NOT create AES keys',
                accent: '#ffb4a2',
                kernel: 'X.509 · asymmetric sign',
                layer: 'USERSPACE → ASYM',
                ring: 'X.509 verify + signature check',
                symbol: 'X509_verify_cert() / EVP_DigestVerify',
                path: 'crypto may assist via AF_ALG later',
                story: 'Identity is proven by signing the transcript hash with the leaf private key. This gates trust — it never becomes the AES traffic key.'
            },
            {
                id: 'x25519',
                title: '3 · X25519',
                does: 'AGREE',
                sym: 'crypto_alloc_kpp / curve25519',
                body: 'both sides run ECDHE\nget the same 32-byte secret\ncurve = agreement, not a cipher',
                accent: '#8fdcff',
                kernel: 'kpp · Curve25519',
                layer: 'KERNEL CRYPTO API',
                ring: 'KPP · key-agreement',
                symbol: 'crypto_alloc_kpp("curve25519")',
                path: 'lib/crypto/curve25519.c',
                story: 'Linux Crypto API allocates a KPP transform. curve25519_generic computes the shared secret — agreement only, not encryption.'
            },
            {
                id: 'secret',
                title: '4 · SHARED SECRET',
                does: 'HOLD RAW',
                sym: 'compute_shared_secret()',
                body: 'ECDH output is still raw bytes\nunsafe to use as a traffic key\nmust be distilled next',
                accent: '#96ffbe',
                kernel: 'handshake transcript',
                layer: 'BOUNDARY',
                ring: 'raw ECDH output buffer',
                symbol: 'crypto_kpp_compute_shared_secret()',
                path: 'include/crypto/kpp.h',
                story: 'The kernel returns 32 raw bytes. They are not yet keys — HKDF must extract/expand them into the TLS key schedule.'
            },
            {
                id: 'hkdf',
                title: '5 · HKDF',
                does: 'DERIVE',
                sym: 'HKDF-Extract / Expand-Label',
                body: 'hash-based key schedule\nturns secret → traffic secrets\nbridge from ECC into AES world',
                accent: '#c4b0ff',
                kernel: 'shash · SHA-2',
                layer: 'USERSPACE (+ shash)',
                ring: 'HKDF over SHA-256',
                symbol: 'HKDF-Extract / Expand-Label',
                path: 'TLS stack · optional crypto_shash',
                story: 'HKDF distills the ECDHE secret into traffic secrets. This is the bridge from asymmetric agreement into the symmetric world.'
            },
            {
                id: 'aesgcm',
                title: '6 · AES-GCM KEYS',
                does: 'ARM CIPHER',
                sym: 'crypto_aead_setkey',
                body: 'install record key + IV\nAES-GCM is ready to protect bytes\nthis is where “encryption” starts',
                accent: '#e6c15a',
                kernel: 'aead · AES-GCM',
                layer: 'KERNEL CRYPTO API',
                ring: 'AEAD transform ready',
                symbol: 'crypto_alloc_aead / crypto_aead_setkey',
                path: 'crypto/aead.c · aesni/gcm drivers',
                story: 'Now the kernel holds a keyed AEAD tfm. Encryption finally exists as a loaded transform — still waiting for record I/O.'
            },
            {
                id: 'ktls',
                title: '7 · RECORDS',
                does: 'ENCRYPT I/O',
                sym: 'tls_sw_sendmsg / kTLS',
                body: 'application data is sealed\ncert / X25519 already left the path\nhot path = symmetric AEAD only',
                accent: '#e6c15a',
                kernel: 'kTLS · crypto_aead',
                layer: 'kTLS HOT PATH',
                ring: 'net/tls record offload',
                symbol: 'tls_sw_sendmsg() → crypto_aead_encrypt()',
                path: 'net/tls/tls_sw.c',
                story: 'Application bytes hit kTLS. Cert and X25519 are gone — only AEAD seals records on the send/recv hot path.'
            }
        ];
    }

    _hsHexPath(cx, cy, r) {
        const pts = [];
        for (let i = 0; i < 6; i += 1) {
            const a = (Math.PI / 6) + i * (Math.PI / 3);
            pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        }
        return `M${pts.map((p) => p.join(',')).join('L')}Z`;
    }

    _hsHexToBytes(hex) {
        const s = String(hex || '').replace(/[^0-9a-fA-F]/g, '');
        const out = new Uint8Array(s.length / 2);
        for (let i = 0; i < out.length; i += 1) {
            out[i] = parseInt(s.substr(i * 2, 2), 16);
        }
        return out;
    }

    _hsBytesToHex(bytes, group = 0) {
        const hex = Array.from(bytes || [], (b) => (b & 0xff).toString(16).padStart(2, '0')).join('');
        if (!group) return hex;
        const parts = hex.match(new RegExp(`.{1,${group}}`, 'g'));
        return parts ? parts.join(' ') : hex;
    }

    /** Sync SHA-256 for handshake math strip (educational, deterministic). */
    _hsSha256Hex(bytes) {
        const K = new Uint32Array([
            0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
            0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
            0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
            0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
            0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
            0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
            0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
            0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
        ]);
        const rotr = (x, n) => (x >>> n) | (x << (32 - n));
        const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
        const bitLen = data.length * 8;
        const withOne = data.length + 1;
        let padLen = withOne % 64;
        padLen = padLen <= 56 ? 56 - padLen : 120 - padLen;
        const buf = new Uint8Array(withOne + padLen + 8);
        buf.set(data);
        buf[data.length] = 0x80;
        const view = new DataView(buf.buffer);
        // length in bits as big-endian 64-bit
        const hi = Math.floor(bitLen / 0x100000000);
        const lo = bitLen >>> 0;
        view.setUint32(buf.length - 8, hi, false);
        view.setUint32(buf.length - 4, lo, false);

        let h0 = 0x6a09e667;
        let h1 = 0xbb67ae85;
        let h2 = 0x3c6ef372;
        let h3 = 0xa54ff53a;
        let h4 = 0x510e527f;
        let h5 = 0x9b05688c;
        let h6 = 0x1f83d9ab;
        let h7 = 0x5be0cd19;
        const w = new Uint32Array(64);

        for (let i = 0; i < buf.length; i += 64) {
            for (let j = 0; j < 16; j += 1) w[j] = view.getUint32(i + j * 4, false);
            for (let j = 16; j < 64; j += 1) {
                const s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
                const s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
                w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
            }
            let a = h0;
            let b = h1;
            let c = h2;
            let d = h3;
            let e = h4;
            let f = h5;
            let g = h6;
            let h = h7;
            for (let j = 0; j < 64; j += 1) {
                const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
                const ch = (e & f) ^ (~e & g);
                const t1 = (h + S1 + ch + K[j] + w[j]) >>> 0;
                const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
                const maj = (a & b) ^ (a & c) ^ (b & c);
                const t2 = (S0 + maj) >>> 0;
                h = g;
                g = f;
                f = e;
                e = (d + t1) >>> 0;
                d = c;
                c = b;
                b = a;
                a = (t1 + t2) >>> 0;
            }
            h0 = (h0 + a) >>> 0;
            h1 = (h1 + b) >>> 0;
            h2 = (h2 + c) >>> 0;
            h3 = (h3 + d) >>> 0;
            h4 = (h4 + e) >>> 0;
            h5 = (h5 + f) >>> 0;
            h6 = (h6 + g) >>> 0;
            h7 = (h7 + h) >>> 0;
        }
        const out = new Uint8Array(32);
        const ov = new DataView(out.buffer);
        ov.setUint32(0, h0, false);
        ov.setUint32(4, h1, false);
        ov.setUint32(8, h2, false);
        ov.setUint32(12, h3, false);
        ov.setUint32(16, h4, false);
        ov.setUint32(20, h5, false);
        ov.setUint32(24, h6, false);
        ov.setUint32(28, h7, false);
        return this._hsBytesToHex(out);
    }

    /**
     * Deterministic demo TLS 1.3 material for GRID math strip.
     * Public values shown in full; secret material only as SHA-256.
     */
    _ensureHandshakeDemoSession() {
        if (this._hsDemoSession) return this._hsDemoSession;
        // Fixed educational vectors (not a live capture) — stable across reloads.
        const clientPub = this._hsHexToBytes(
            '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a'
        );
        const serverPub = this._hsHexToBytes(
            'de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f'
        );
        // Demo ECDH shared secret Z (32 bytes) — display only via SHA-256.
        const sharedZ = this._hsHexToBytes(
            'c3da55379de9c782c7e6e93d11e8f4e4b6d5c6a9e1f0d2c3b4a5968778695a4b'
        );
        // Demo leaf SPKI bytes (truncated-shaped educational blob).
        const leafSpki = this._hsHexToBytes(
            '3059301306072a8648ce3d020106082a8648ce3d03010703420004'
            + '6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'
            + '4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5'
        );
        const trafficKey = this._hsHexToBytes(
            '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
        );
        const transcript = this._hsHexToBytes(
            '48656c6c6f436c69656e7448656c6c6f5365727665724365727469666963617465'
        );
        // Demo private scalars — NEVER shown raw; only SHA-256 provenance anchors.
        const ephSk = this._hsHexToBytes(
            '77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a'
        );
        const leafSk = this._hsHexToBytes(
            'c37b7e3ab1e5f7d8c9a0b1c2d3e4f5061728394a5b6c7d8e9f00112233445566'
        );

        this._hsDemoSession = {
            clientPubHex: this._hsBytesToHex(clientPub),
            serverPubHex: this._hsBytesToHex(serverPub),
            clientPubSha: this._hsSha256Hex(clientPub),
            serverPubSha: this._hsSha256Hex(serverPub),
            sharedSha: this._hsSha256Hex(sharedZ),
            leafSpkiSha: this._hsSha256Hex(leafSpki),
            leafPubHex: this._hsBytesToHex(leafSpki.slice(-64)), // last 64 bytes ≈ uncompressed point region
            trafficKeySha: this._hsSha256Hex(trafficKey),
            transcriptSha: this._hsSha256Hex(transcript),
            // HKDF-Extract demo: SHA-256(salt || IKM) stand-in for PRK fingerprint
            prkSha: this._hsSha256Hex(this._hsHexToBytes(
                `${this._hsBytesToHex(sharedZ)}${this._hsBytesToHex(transcript)}`
            )),
            ephSkSha: this._hsSha256Hex(ephSk),
            leafSkSha: this._hsSha256Hex(leafSk)
        };
        return this._hsDemoSession;
    }

    /**
     * Session math tape for GRID board — full hex always visible;
     * each step highlights only its segment (frame color).
     */
    getHandshakeMathTape() {
        const S = this._ensureHandshakeDemoSession();
        const segments = [
            {
                ids: ['hello'],
                tag: 'PUBLIC',
                label: 'client_pub · key_share',
                hex: S.clientPubHex,
                focus: [0, 16],
                line: 'ecdh',
                fromSk: 'eph',
                provNode: 'pub'
            },
            {
                ids: ['cert'],
                tag: 'DIGEST',
                label: 'leaf SPKI · SHA-256',
                hex: S.leafSpkiSha,
                focus: [0, 16],
                line: 'cert',
                fromSk: 'leaf',
                provNode: 'spki'
            },
            {
                ids: ['x25519'],
                tag: 'PUBLIC',
                label: 'server_pub · KPP input',
                hex: S.serverPubHex,
                focus: [0, 64],
                line: 'ecdh',
                fromSk: 'eph',
                provNode: 'peer'
            },
            {
                ids: ['secret'],
                tag: 'DIGEST',
                label: 'SHA256(Z) · shared secret',
                hex: S.sharedSha,
                focus: [0, 16],
                line: 'ecdh',
                fromSk: 'eph',
                provNode: 'Z'
            },
            {
                ids: ['hkdf'],
                tag: 'DIGEST',
                label: 'PRK⋆ · HKDF fingerprint',
                hex: S.prkSha,
                focus: [0, 16],
                line: 'ecdh',
                fromSk: 'eph',
                provNode: 'PRK'
            },
            {
                ids: ['aesgcm', 'ktls'],
                tag: 'DIGEST',
                label: 'SHA256(traffic_key)',
                hex: S.trafficKeySha,
                focus: [0, 16],
                line: 'ecdh',
                fromSk: 'eph',
                provNode: 'key'
            }
        ];
        let offset = 0;
        return segments.map((seg) => {
            const start = offset;
            const end = offset + seg.hex.length;
            offset = end;
            return Object.assign({}, seg, { start, end });
        });
    }

    /** Provenance chains — private keys only as SHA-256; segments are derived, not slices. */
    getHandshakeSkProvenance(stepId) {
        const S = this._ensureHandshakeDemoSession();
        const active = this.getHandshakeMathTape().find((s) => s.ids.indexOf(stepId) >= 0);
        const ecdhNodes = [
            { id: 'sk', label: 'sk_eph', tip: 'SHA256(sk)', sha: S.ephSkSha, kind: 'private' },
            { id: 'pub', label: 'client_pub', tip: 'X25519(sk)·G', kind: 'public' },
            { id: 'peer', label: 'server_pub', tip: 'peer u-coord', kind: 'public' },
            { id: 'Z', label: 'H(Z)', tip: 'SHA256(X25519(sk,peer))', kind: 'derived' },
            { id: 'PRK', label: 'PRK⋆', tip: 'HKDF-Extract⋆', kind: 'derived' },
            { id: 'key', label: 'H(key)', tip: 'SHA256(traffic_key)', kind: 'derived' }
        ];
        const certNodes = [
            { id: 'sk', label: 'sk_leaf', tip: 'SHA256(sk)', sha: S.leafSkSha, kind: 'private' },
            { id: 'spki', label: 'SPKI', tip: 'SHA256(SPKI)', kind: 'public' }
        ];
        // Which chain nodes are "reached" / lit for this step
        const ecdhLit = {
            hello: ['sk', 'pub'],
            x25519: ['sk', 'pub', 'peer'],
            secret: ['sk', 'pub', 'peer', 'Z'],
            hkdf: ['sk', 'pub', 'peer', 'Z', 'PRK'],
            aesgcm: ['sk', 'pub', 'peer', 'Z', 'PRK', 'key'],
            ktls: ['sk', 'pub', 'peer', 'Z', 'PRK', 'key'],
            cert: []
        };
        const certLit = {
            cert: ['sk', 'spki'],
            hello: [],
            x25519: [],
            secret: [],
            hkdf: [],
            aesgcm: [],
            ktls: []
        };
        return {
            activeLine: active ? active.line : 'ecdh',
            activeNode: active ? active.provNode : null,
            ecdh: {
                title: 'ECDHE lineage  ·  sk ≠ slices of tape',
                nodes: ecdhNodes,
                lit: ecdhLit[stepId] || [],
                skSha: S.ephSkSha
            },
            cert: {
                title: 'CERT lineage  ·  separate private key',
                nodes: certNodes,
                lit: certLit[stepId] || [],
                skSha: S.leafSkSha
            }
        };
    }

    getHandshakeMathForStep(stepId) {
        const tape = this.getHandshakeMathTape();
        const fullHex = tape.map((s) => s.hex).join('');
        const active = tape.find((s) => s.ids.indexOf(stepId) >= 0) || tape[0];
        const focusStart = active.start + active.focus[0];
        const focusEnd = active.start + active.focus[1];
        const prov = this.getHandshakeSkProvenance(stepId);
        return {
            tag: active.tag,
            label: active.label,
            fullHex,
            tape,
            active,
            focusStart,
            focusEnd,
            provenance: prov,
            note: active.tag === 'PUBLIC'
                ? 'full public material on the tape · frame color = active fragment'
                : 'secret material as SHA-256 only · frame color = active fragment'
        };
    }

    /** Draw full key tape on the right; highlight active fragment + sk provenance. */
    _drawHandshakeMathKeyPanel(parent, opts) {
        const {
            x, y, w, h, edge, stepId,
            mono = 'Share Tech Mono, monospace'
        } = opts;
        const math = this.getHandshakeMathForStep(stepId);
        if (!math) return;
        const prov = math.provenance;

        parent.append('rect')
            .attr('x', x).attr('y', y)
            .attr('width', w).attr('height', h)
            .attr('rx', 6)
            .style('fill', 'rgba(0, 8, 14, 0.96)')
            .style('stroke', edge)
            .style('stroke-opacity', 0.7)
            .style('stroke-width', 1.6);

        parent.append('text')
            .attr('x', x + 12).attr('y', y + 15)
            .style('font-family', mono)
            .style('font-size', '9px')
            .style('letter-spacing', '1.8px')
            .style('fill', edge)
            .text(`MATH · ${math.tag}  ·  ${math.active.label}`);

        parent.append('text')
            .attr('x', x + w - 12).attr('y', y + 15)
            .attr('text-anchor', 'end')
            .style('font-family', mono)
            .style('font-size', '8px')
            .style('fill', 'rgba(140, 180, 200, 0.55)')
            .text('sk only as SHA-256 · not tape slices');

        // Provenance rails (top of panel)
        const railH = 54;
        const drawRail = (railY, chain, accent) => {
            const nodes = chain.nodes;
            const n = nodes.length;
            const x0 = x + 14;
            const x1 = x + w - 14;
            const span = x1 - x0;
            parent.append('text')
                .attr('x', x0).attr('y', railY - 2)
                .style('font-family', mono)
                .style('font-size', '7px')
                .style('letter-spacing', '0.8px')
                .style('fill', 'rgba(140, 170, 190, 0.65)')
                .text(chain.title);

            parent.append('line')
                .attr('x1', x0 + 18).attr('x2', x1 - 18)
                .attr('y1', railY + 14).attr('y2', railY + 14)
                .style('stroke', accent)
                .style('stroke-opacity', 0.25)
                .style('stroke-width', 1.2);

            nodes.forEach((node, i) => {
                const nx = x0 + (n === 1 ? span / 2 : (i / (n - 1)) * span);
                const lit = chain.lit.indexOf(node.id) >= 0;
                const isHere = math.active.provNode === node.id
                    || (node.id === 'sk' && lit && prov.activeLine === (chain === prov.ecdh ? 'ecdh' : 'cert'));
                const col = lit ? accent : 'rgba(80, 100, 120, 0.55)';
                parent.append('circle')
                    .attr('cx', nx).attr('cy', railY + 14)
                    .attr('r', isHere ? 6 : 4)
                    .style('fill', lit ? accent : 'rgba(10, 16, 24, 0.95)')
                    .style('stroke', col)
                    .style('stroke-width', isHere ? 2 : 1)
                    .style('fill-opacity', lit && node.kind === 'private' ? 0.35 : (lit ? 0.85 : 0.5));
                parent.append('text')
                    .attr('x', nx).attr('y', railY + 28)
                    .attr('text-anchor', 'middle')
                    .style('font-family', mono)
                    .style('font-size', '7px')
                    .style('fill', lit ? accent : 'rgba(120, 140, 160, 0.45)')
                    .text(node.label);
            });
        };

        const ecdhHot = prov.activeLine === 'ecdh' ? edge : 'rgba(110, 239, 255, 0.55)';
        const certHot = prov.activeLine === 'cert' ? edge : 'rgba(255, 180, 140, 0.55)';
        drawRail(y + 28, prov.ecdh, ecdhHot);
        drawRail(y + 28 + railH, prov.cert, certHot);

        const skLine = prov.activeLine === 'cert' ? prov.cert : prov.ecdh;
        parent.append('text')
            .attr('x', x + 12).attr('y', y + 28 + railH * 2 + 2)
            .style('font-family', mono)
            .style('font-size', '8px')
            .style('fill', edge)
            .text(`SHA256(${prov.activeLine === 'cert' ? 'sk_leaf' : 'sk_eph'})  ${skLine.skSha}`);

        // Character grid — full tape
        const padX = 12;
        const padTop = 28 + railH * 2 + 12;
        const availW = w - padX * 2;
        const availH = h - padTop - 16;
        const fontSize = availW > 340 ? 12 : (availW > 260 ? 11 : 10);
        const pairW = fontSize * 1.55;
        const cols = Math.max(8, Math.min(16, Math.floor(availW / pairW)));
        const rowH = fontSize + 6;
        const maxRows = Math.max(3, Math.floor(availH / rowH));
        const pairs = [];
        for (let i = 0; i < math.fullHex.length; i += 2) {
            pairs.push({ hex: math.fullHex.substr(i, 2), ci: i });
        }
        let startPair = 0;
        const activePair0 = Math.floor(math.active.start / 2);
        const activePair1 = Math.ceil(math.active.end / 2);
        if (activePair1 > cols * maxRows) {
            startPair = Math.max(0, activePair0 - Math.floor(cols / 2));
            const maxStart = Math.max(0, pairs.length - cols * maxRows);
            startPair = Math.min(startPair, maxStart);
        }
        const windowPairs = pairs.slice(startPair, startPair + cols * maxRows);

        const g = parent.append('g').attr('class', 'hs-math-tape');
        windowPairs.forEach((p, idx) => {
            const row = Math.floor(idx / cols);
            const col = idx % cols;
            const cx = x + padX + col * (availW / cols) + 2;
            const cy = y + padTop + row * rowH + fontSize;
            const inActive = p.ci >= math.active.start && p.ci < math.active.end;
            const inFocus = p.ci >= math.focusStart && p.ci < math.focusEnd;
            const seg = math.tape.find((s) => p.ci >= s.start && p.ci < s.end);
            const sameLine = seg && seg.line === prov.activeLine;
            let fill = sameLine ? 'rgba(90, 110, 130, 0.5)' : 'rgba(70, 80, 95, 0.28)';
            let weight = '400';
            let opacity = sameLine ? 0.45 : 0.28;
            if (inActive) {
                fill = edge;
                weight = inFocus ? '700' : '500';
                opacity = 1;
            }
            g.append('text')
                .attr('x', cx).attr('y', cy)
                .style('font-family', mono)
                .style('font-size', `${fontSize}px`)
                .style('font-weight', weight)
                .style('fill', fill)
                .style('opacity', opacity)
                .text(p.hex);
            if (inFocus) {
                g.append('rect')
                    .attr('x', cx - 1)
                    .attr('y', cy - fontSize + 1)
                    .attr('width', fontSize * 1.35)
                    .attr('height', 2)
                    .style('fill', edge)
                    .style('opacity', 0.9);
            }
        });

        const legY = y + h - 7;
        let lx = x + 12;
        math.tape.forEach((seg) => {
            const on = seg.ids.indexOf(stepId) >= 0;
            const lab = parent.append('text')
                .attr('x', lx).attr('y', legY)
                .style('font-family', mono)
                .style('font-size', '7px')
                .style('letter-spacing', '0.3px')
                .style('fill', on ? edge : 'rgba(120, 140, 160, 0.4)')
                .text(`${seg.label.split('·')[0].trim()}←${seg.fromSk === 'leaf' ? 'sk_leaf' : 'sk_eph'}`);
            try {
                lx += (lab.node().getComputedTextLength() || 50) + 8;
            } catch (_) {
                lx += 56;
            }
        });
    }

    /**
     * Tron Legacy process board — expands the active handshake step
     * under the theater (grid floor · light-path · identity disc · reveal panel).
     */
    drawHandshakeTronBoard(parent, opts) {
        const {
            x, y, w, h,
            steps = this.getHandshakeStorySteps(),
            onSelect = null
        } = opts;

        const CYAN = '#6EEFFF';
        const ORANGE = '#FF8A3A';
        const board = parent.append('g')
            .attr('class', 'crypto-handshake-tron')
            .style('opacity', 0);

        // Void chassis (rounded windows — previous format)
        board.append('rect')
            .attr('x', x).attr('y', y)
            .attr('width', w).attr('height', h)
            .attr('rx', 8)
            .style('fill', 'rgba(1, 4, 10, 0.94)')
            .style('stroke', 'rgba(110, 239, 255, 0.45)')
            .style('stroke-width', 1.4);

        // Inner rim glow
        board.append('rect')
            .attr('x', x + 3).attr('y', y + 3)
            .attr('width', w - 6).attr('height', h - 6)
            .attr('rx', 6)
            .style('fill', 'none')
            .style('stroke', 'rgba(110, 239, 255, 0.12)')
            .style('stroke-width', 1);

        // Perspective floor grid (Tron Legacy board)
        const floor = board.append('g').attr('class', 'tron-floor').style('opacity', 0.55);
        const vanishingY = y + h * 0.42;
        const floorTop = y + h * 0.48;
        const floorBot = y + h - 10;
        const cx = x + w / 2;
        for (let i = 0; i <= 10; i += 1) {
            const t = i / 10;
            const yy = floorTop + t * t * (floorBot - floorTop);
            const half = (w * 0.42) * (0.22 + t * 0.78);
            floor.append('line')
                .attr('x1', cx - half).attr('x2', cx + half)
                .attr('y1', yy).attr('y2', yy)
                .style('stroke', CYAN)
                .style('stroke-opacity', 0.12 + t * 0.18)
                .style('stroke-width', 0.7);
        }
        for (let i = -5; i <= 5; i += 1) {
            const edge = (w * 0.42) * 0.98;
            floor.append('line')
                .attr('x1', cx + i * (edge / 5) * 0.22)
                .attr('y1', floorTop)
                .attr('x2', cx + i * (edge / 5))
                .attr('y2', floorBot)
                .style('stroke', CYAN)
                .style('stroke-opacity', 0.1)
                .style('stroke-width', 0.6);
        }
        // Horizon light bar
        board.append('line')
            .attr('x1', x + 24).attr('x2', x + w - 24)
            .attr('y1', vanishingY).attr('y2', vanishingY)
            .style('stroke', CYAN)
            .style('stroke-opacity', 0.35)
            .style('stroke-width', 1.2);

        // Header
        board.append('text')
            .attr('x', x + 22).attr('y', y + 22)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '10px')
            .style('letter-spacing', '2.2px')
            .style('fill', CYAN)
            .text('GRID · HANDSHAKE PROGRAM');

        const stepMeta = board.append('text')
            .attr('x', x + w - 22).attr('y', y + 22)
            .attr('text-anchor', 'end')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '9px')
            .style('letter-spacing', '1.4px')
            .style('fill', 'rgba(110, 239, 255, 0.55)')
            .text('');

        // Light-path nodes across top of board
        const pathY = y + 48;
        const pathX0 = x + 36;
        const pathX1 = x + w - 36;
        const lightBase = board.append('line')
            .attr('x1', pathX0).attr('x2', pathX1)
            .attr('y1', pathY).attr('y2', pathY)
            .style('stroke', 'rgba(60, 90, 110, 0.55)')
            .style('stroke-width', 2);
        const lightFill = board.append('line')
            .attr('x1', pathX0).attr('x2', pathX0)
            .attr('y1', pathY).attr('y2', pathY)
            .style('stroke', CYAN)
            .style('stroke-width', 2.4)
            .style('stroke-linecap', 'round')
            .style('filter', 'url(#glow)');

        if (this.svg) {
            let defs = this.svg.select('defs');
            if (defs.empty()) defs = this.svg.append('defs');
            if (defs.select('#tron-cyan-glow').empty()) {
                const filter = defs.append('filter')
                    .attr('id', 'tron-cyan-glow')
                    .attr('x', '-50%').attr('y', '-50%')
                    .attr('width', '200%').attr('height', '200%');
                filter.append('feGaussianBlur').attr('stdDeviation', '2.2').attr('result', 'b');
                filter.append('feMerge').selectAll('feMergeNode').data(['b', 'SourceGraphic'])
                    .enter().append('feMergeNode').attr('in', (d) => d);
            }
        }
        lightFill.style('filter', 'url(#tron-cyan-glow)');
        lightBase.style('pointer-events', 'none');

        const nodes = steps.map((step, i) => {
            const nx = pathX0 + (i / Math.max(1, steps.length - 1)) * (pathX1 - pathX0);
            const g = board.append('g')
                .style('cursor', 'pointer')
                .on('click', (event) => {
                    if (event && event.stopPropagation) event.stopPropagation();
                    if (typeof onSelect === 'function') onSelect(i);
                    setStep(i);
                });
            // Outer ring (identity disc)
            const ring = g.append('circle')
                .attr('cx', nx).attr('cy', pathY)
                .attr('r', 9)
                .style('fill', 'rgba(2, 8, 14, 0.95)')
                .style('stroke', step.accent || CYAN)
                .style('stroke-width', 1.2)
                .style('stroke-opacity', 0.4);
            const core = g.append('circle')
                .attr('cx', nx).attr('cy', pathY)
                .attr('r', 3.2)
                .style('fill', 'rgba(40, 60, 80, 0.9)');
            const num = g.append('text')
                .attr('x', nx).attr('y', pathY - 14)
                .attr('text-anchor', 'middle')
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '8px')
                .style('fill', 'rgba(160, 190, 210, 0.55)')
                .text(String(i + 1));
            return { g, ring, core, num, nx, step };
        });

        // Reveal panel (expanded step)
        const panelX = x + 18;
        const panelY = y + 68;
        const panelW = w - 36;
        const panelH = Math.max(96, h - 84);
        const reveal = board.append('g').attr('class', 'tron-reveal');

        const wrapWords = (text, maxChars, maxLines) => {
            const words = String(text || '').split(/\s+/);
            const lines = [];
            let cur = '';
            words.forEach((word) => {
                const next = cur ? `${cur} ${word}` : word;
                if (next.length > maxChars) {
                    if (cur) lines.push(cur);
                    cur = word;
                } else cur = next;
            });
            if (cur) lines.push(cur);
            return lines.slice(0, maxLines);
        };

        const setStep = (idx) => {
            const step = steps[idx];
            if (!step) return;
            const accent = step.accent || CYAN;
            const isHot = step.id === 'cert' || step.id === 'aesgcm' || step.id === 'ktls';
            const edge = isHot ? ORANGE : CYAN;

            stepMeta.text(`STEP ${idx + 1}/${steps.length}  ·  ${step.does || ''}`);

            nodes.forEach((n, i) => {
                const on = i === idx;
                const past = i < idx;
                n.ring.transition().duration(320)
                    .attr('r', on ? 12 : 9)
                    .style('stroke', on ? edge : (n.step.accent || CYAN))
                    .style('stroke-opacity', on ? 1 : (past ? 0.55 : 0.35))
                    .style('stroke-width', on ? 2.2 : 1.2);
                n.core.transition().duration(320)
                    .attr('r', on ? 4.5 : 3.2)
                    .style('fill', on ? edge : (past ? accent : 'rgba(40, 60, 80, 0.9)'));
                n.num.style('fill', on ? edge : 'rgba(160, 190, 210, 0.55)');
            });
            lightFill
                .style('stroke', edge)
                .transition().duration(420)
                .attr('x2', nodes[idx].nx);

            reveal.selectAll('*').remove();
            const pane = reveal.append('g').style('opacity', 0);

            // Reveal chassis (rounded window)
            pane.append('rect')
                .attr('x', panelX).attr('y', panelY)
                .attr('width', panelW).attr('height', panelH)
                .attr('rx', 8)
                .style('fill', 'rgba(4, 10, 18, 0.88)')
                .style('stroke', edge)
                .style('stroke-opacity', 0.65)
                .style('stroke-width', 1.5);

            // Split: left copy · right FULL key tape (large, fragment highlight)
            const keyW = Math.min(Math.max(panelW * 0.52, 320), panelW - 220);
            const keyX = panelX + panelW - keyW - 10;
            const keyY = panelY + 10;
            const keyH = panelH - 20;
            const leftW = keyX - panelX - 16;

            // Identity disc (left)
            const discX = panelX + 44;
            const discY = panelY + 52;
            pane.append('circle')
                .attr('cx', discX).attr('cy', discY)
                .attr('r', 28)
                .style('fill', 'rgba(2, 8, 14, 0.95)')
                .style('stroke', edge)
                .style('stroke-width', 2)
                .style('filter', 'url(#tron-cyan-glow)');
            pane.append('circle')
                .attr('cx', discX).attr('cy', discY)
                .attr('r', 20)
                .style('fill', 'none')
                .style('stroke', accent)
                .style('stroke-opacity', 0.45)
                .style('stroke-dasharray', '3 5');
            pane.append('circle')
                .attr('cx', discX).attr('cy', discY)
                .attr('r', 6)
                .style('fill', edge)
                .style('fill-opacity', 0.85);
            pane.append('text')
                .attr('x', discX).attr('y', discY + 42)
                .attr('text-anchor', 'middle')
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '7px')
                .style('letter-spacing', '1.2px')
                .style('fill', edge)
                .text(String(step.layer || 'KERNEL').slice(0, 16));

            const tx = panelX + 82;
            const tw = leftW - 82;

            pane.append('text')
                .attr('x', tx).attr('y', panelY + 24)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '11px')
                .style('letter-spacing', '2px')
                .style('fill', edge)
                .text(String(step.does || 'PROCESS'));

            pane.append('text')
                .attr('x', tx).attr('y', panelY + 46)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '16px')
                .style('letter-spacing', '1.4px')
                .style('fill', '#EAF6FF')
                .text(String(step.title || ''));

            const bodyLines = String(step.body || '').split('\n').filter(Boolean);
            bodyLines.slice(0, 3).forEach((line, li) => {
                pane.append('text')
                    .attr('x', tx).attr('y', panelY + 70 + li * 13)
                    .style('font-family', 'Share Tech Mono, monospace')
                    .style('font-size', '10px')
                    .style('fill', 'rgba(190, 215, 230, 0.9)')
                    .text(line);
            });

            const dockH = 34;
            const dockY = panelY + panelH - dockH - 10;
            const storyY = panelY + 70 + Math.min(3, bodyLines.length) * 13 + 8;
            wrapWords(step.story, tw < 200 ? 28 : 36, 3).forEach((line, li) => {
                if (storyY + li * 12 > dockY - 8) return;
                pane.append('text')
                    .attr('x', tx).attr('y', storyY + li * 12)
                    .style('font-family', 'Share Tech Mono, monospace')
                    .style('font-size', '9px')
                    .style('fill', 'rgba(150, 180, 200, 0.78)')
                    .text(line);
            });

            pane.append('rect')
                .attr('x', panelX + 10).attr('y', dockY)
                .attr('width', leftW).attr('height', dockH)
                .attr('rx', 4)
                .style('fill', 'rgba(0, 12, 20, 0.92)')
                .style('stroke', 'rgba(110, 239, 255, 0.35)');
            pane.append('text')
                .attr('x', panelX + 20).attr('y', dockY + 13)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '9px')
                .style('fill', CYAN)
                .text(String(step.symbol || step.sym || ''));
            pane.append('text')
                .attr('x', panelX + 20).attr('y', dockY + 26)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '8px')
                .style('fill', 'rgba(140, 170, 190, 0.75)')
                .text(`${step.path || ''}  ·  ${step.ring || ''}`);

            // Right: full key tape — active fragment = frame color
            this._drawHandshakeMathKeyPanel(pane, {
                x: keyX,
                y: keyY,
                w: keyW,
                h: keyH,
                edge,
                stepId: step.id
            });

            // Light streak sweep on enter
            const streak = pane.append('rect')
                .attr('x', panelX)
                .attr('y', panelY)
                .attr('width', 18)
                .attr('height', panelH)
                .style('fill', edge)
                .style('fill-opacity', 0.18)
                .style('pointer-events', 'none');
            streak.transition().duration(700).ease(d3.easeCubicOut)
                .attr('x', panelX + panelW - 18)
                .style('fill-opacity', 0)
                .on('end', function end() { d3.select(this).remove(); });

            pane.transition().duration(380).style('opacity', 1);
        };

        board.transition().delay(160).duration(550).style('opacity', 1);
        setStep(0);

        const controller = { setStep };
        this._handshakeTronBoard = controller;
        return controller;
    }

    drawHandshakeAuthRitual(parent, opts) {
        // Kernel Process Theater — one full scene per handshake step (designer reveal).
        // Replaces the cramped multi-station conduit with a sequential stage.
        return this.drawHandshakeKernelTheater(parent, opts);
    }

    drawHandshakeKernelTheater(parent, opts) {
        const {
            x, y, w, h,
            steps = this.getHandshakeStorySteps(),
            stepDelay = 700,
            startDelay = 280
        } = opts;

        const theater = parent.append('g')
            .attr('class', 'crypto-handshake-theater')
            .style('opacity', 0);

        // Chassis
        theater.append('rect')
            .attr('x', x).attr('y', y)
            .attr('width', w).attr('height', h)
            .attr('rx', 8)
            .style('fill', 'rgba(1, 5, 12, 0.92)')
            .style('stroke', 'rgba(110, 239, 255, 0.38)')
            .style('stroke-width', 1.3);

        // Ambient scan lines (subtle atmosphere)
        const ambience = theater.append('g').style('opacity', 0.12);
        for (let i = 0; i < 6; i += 1) {
            ambience.append('line')
                .attr('x1', x + 16).attr('x2', x + w - 16)
                .attr('y1', y + 36 + i * ((h - 50) / 6))
                .attr('y2', y + 36 + i * ((h - 50) / 6))
                .style('stroke', '#8fdcff')
                .style('stroke-width', 0.6);
        }

        // Header
        theater.append('text')
            .attr('x', x + 20).attr('y', y + 20)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '10px')
            .style('letter-spacing', '1.6px')
            .style('fill', '#8fdcff')
            .text('KERNEL PROCESS THEATER');

        theater.append('text')
            .attr('x', x + w - 148).attr('y', y + 20)
            .attr('text-anchor', 'end')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '8px')
            .style('fill', 'rgba(150, 180, 200, 0.55)')
            .text('click card / rail · ◀ ▶ to browse');

        // Prev / Next controls
        const mkNav = (label, nx, onClick) => {
            const btn = theater.append('g')
                .style('cursor', 'pointer')
                .on('click', (event) => {
                    if (event && event.stopPropagation) event.stopPropagation();
                    onClick();
                });
            btn.append('rect')
                .attr('x', nx).attr('y', y + 8)
                .attr('width', 28).attr('height', 18).attr('rx', 3)
                .style('fill', 'rgba(20, 36, 48, 0.9)')
                .style('stroke', 'rgba(143, 220, 255, 0.45)');
            btn.append('text')
                .attr('x', nx + 14).attr('y', y + 20)
                .attr('text-anchor', 'middle')
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '11px')
                .style('fill', '#8fdcff')
                .text(label);
            return btn;
        };

        // Progress rail
        const railY = y + h - 18;
        const railX0 = x + 56;
        const railX1 = x + w - 56;
        theater.append('line')
            .attr('x1', railX0).attr('x2', railX1)
            .attr('y1', railY).attr('y2', railY)
            .style('stroke', 'rgba(90, 120, 150, 0.35)')
            .style('stroke-width', 1.2);
        const dots = steps.map((step, i) => {
            const dx = railX0 + (i / Math.max(1, steps.length - 1)) * (railX1 - railX0);
            const hit = theater.append('circle')
                .attr('cx', dx).attr('cy', railY)
                .attr('r', 10)
                .style('fill', 'transparent')
                .style('cursor', 'pointer');
            const dot = theater.append('circle')
                .attr('cx', dx).attr('cy', railY)
                .attr('r', 3.2)
                .style('fill', 'rgba(60, 80, 100, 0.8)')
                .style('stroke', step.accent)
                .style('stroke-width', 1)
                .style('stroke-opacity', 0.35)
                .style('pointer-events', 'none');
            return { dot, hit, dx, step };
        });
        const railFill = theater.append('line')
            .attr('x1', railX0).attr('x2', railX0)
            .attr('y1', railY).attr('y2', railY)
            .style('stroke', '#96ffbe')
            .style('stroke-width', 2)
            .style('stroke-linecap', 'round')
            .style('pointer-events', 'none');

        const stepLabel = theater.append('text')
            .attr('x', (railX0 + railX1) / 2)
            .attr('y', railY - 10)
            .attr('text-anchor', 'middle')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '8px')
            .style('fill', 'rgba(180, 200, 220, 0.7)')
            .text('');

        // Stage viewport (cleared/redrawn per step)
        const stageRoot = theater.append('g').attr('class', 'hs-theater-stage');
        const stageX = x + 16;
        const stageY = y + 32;
        const stageW = w - 32;
        const stageH = h - 58;

        const drawSceneGraphic = (g, step, gx, gy, gw, gh) => {
            const cx = gx + gw * 0.42;
            const cy = gy + gh * 0.52;
            const accent = step.accent || '#8fdcff';

            // Soft field
            g.append('ellipse')
                .attr('cx', cx).attr('cy', cy)
                .attr('rx', Math.min(110, gw * 0.42))
                .attr('ry', Math.min(48, gh * 0.38))
                .style('fill', accent)
                .style('fill-opacity', 0.06)
                .style('stroke', 'none');

            if (step.id === 'hello') {
                // Offer packets floating toward stack
                ['X25519', 'AES-GCM', 'SHA-256'].forEach((label, i) => {
                    const px = gx + 28 + i * 52;
                    const py = cy - 10 + (i % 2) * 12;
                    const chip = g.append('g').style('opacity', 0);
                    chip.append('rect')
                        .attr('x', px).attr('y', py)
                        .attr('width', 44).attr('height', 18).attr('rx', 3)
                        .style('fill', 'rgba(20, 30, 42, 0.9)')
                        .style('stroke', accent);
                    chip.append('text')
                        .attr('x', px + 22).attr('y', py + 12)
                        .attr('text-anchor', 'middle')
                        .style('font-family', 'Share Tech Mono, monospace')
                        .style('font-size', '8px')
                        .style('fill', accent)
                        .text(label);
                    chip.transition().delay(120 + i * 160).duration(400).style('opacity', 1)
                        .attr('transform', `translate(0, ${-6 + i})`);
                });
                // Userspace slab
                g.append('rect')
                    .attr('x', gx + 20).attr('y', cy + 28)
                    .attr('width', gw * 0.7).attr('height', 16).attr('rx', 3)
                    .style('fill', 'rgba(30, 45, 60, 0.7)')
                    .style('stroke', 'rgba(169, 212, 232, 0.35)');
                g.append('text')
                    .attr('x', gx + 28).attr('y', cy + 39)
                    .style('font-family', 'Share Tech Mono, monospace')
                    .style('font-size', '8px')
                    .style('fill', '#a9d4e8')
                    .text('USERSPACE TLS  ·  kernel idle');
            } else if (step.id === 'cert') {
                // Dual rails: SIG vs HASH into verify lens
                const left = gx + 36;
                const right = gx + gw * 0.55;
                [['SIG', '#ff8a6a', cy - 18], ['HASH', '#8fdcff', cy + 10]].forEach(([lab, col, yy], i) => {
                    g.append('rect')
                        .attr('x', left).attr('y', yy)
                        .attr('width', 36).attr('height', 16).attr('rx', 2)
                        .style('fill', 'rgba(20, 16, 18, 0.9)')
                        .style('stroke', col);
                    g.append('text')
                        .attr('x', left + 18).attr('y', yy + 11)
                        .attr('text-anchor', 'middle')
                        .style('font-family', 'Share Tech Mono, monospace')
                        .style('font-size', '8px')
                        .style('fill', col)
                        .text(lab);
                    const path = g.append('path')
                        .attr('d', `M ${left + 36} ${yy + 8} L ${right - 8} ${cy}`)
                        .style('fill', 'none')
                        .style('stroke', col)
                        .style('stroke-opacity', 0.35)
                        .style('stroke-width', 1.4)
                        .style('stroke-dasharray', '3 4');
                    try {
                        const n = path.node();
                        const len = n.getTotalLength();
                        const dot = g.append('circle').attr('r', 3).style('fill', col).style('opacity', 0);
                        const p0 = n.getPointAtLength(0);
                        dot.attr('cx', p0.x).attr('cy', p0.y)
                            .transition().delay(200 + i * 180).duration(700)
                            .style('opacity', 1)
                            .attrTween('cx', () => (t) => n.getPointAtLength(t * len).x)
                            .attrTween('cy', () => (t) => n.getPointAtLength(t * len).y);
                    } catch (_) { /* ignore */ }
                });
                g.append('path')
                    .attr('d', this._hsHexPath(right + 10, cy, 22))
                    .style('fill', 'rgba(255, 140, 110, 0.08)')
                    .style('stroke', '#ffb4a2')
                    .style('stroke-width', 1.6);
                g.append('text')
                    .attr('x', right + 10).attr('y', cy + 4)
                    .attr('text-anchor', 'middle')
                    .style('font-family', 'Share Tech Mono, monospace')
                    .style('font-size', '9px')
                    .style('fill', '#96ffbe')
                    .style('opacity', 0)
                    .text('TRUST')
                    .transition().delay(900).duration(400).style('opacity', 1);
            } else if (step.id === 'x25519') {
                // Two peer orbs → shared field (KPP)
                const a = gx + 40;
                const b = gx + gw * 0.62;
                [a, b].forEach((px, i) => {
                    g.append('circle')
                        .attr('cx', px).attr('cy', cy)
                        .attr('r', 16)
                        .style('fill', 'rgba(20, 36, 48, 0.85)')
                        .style('stroke', accent)
                        .style('stroke-width', 1.5);
                    g.append('text')
                        .attr('x', px).attr('y', cy + 3)
                        .attr('text-anchor', 'middle')
                        .style('font-family', 'Share Tech Mono, monospace')
                        .style('font-size', '8px')
                        .style('fill', accent)
                        .text(i === 0 ? 'A' : 'B');
                });
                const mid = (a + b) / 2;
                g.append('path')
                    .attr('d', `M ${a + 16} ${cy} Q ${mid} ${cy - 36}, ${b - 16} ${cy}`)
                    .style('fill', 'none')
                    .style('stroke', accent)
                    .style('stroke-width', 1.6)
                    .style('stroke-dasharray', '4 4')
                    .style('opacity', 0)
                    .transition().delay(200).duration(600).style('opacity', 0.8);
                g.append('path')
                    .attr('d', this._hsHexPath(mid, cy - 8, 14))
                    .style('fill', 'rgba(143, 220, 255, 0.1)')
                    .style('stroke', '#8fdcff')
                    .style('opacity', 0)
                    .transition().delay(500).duration(500).style('opacity', 1);
                g.append('text')
                    .attr('x', mid).attr('y', cy + 36)
                    .attr('text-anchor', 'middle')
                    .style('font-family', 'Share Tech Mono, monospace')
                    .style('font-size', '8px')
                    .style('fill', '#8fdcff')
                    .text('KPP · curve25519_generic');
            } else if (step.id === 'secret') {
                // Raw buffer cells
                for (let i = 0; i < 8; i += 1) {
                    const cell = g.append('rect')
                        .attr('x', gx + 30 + i * 22)
                        .attr('y', cy - 12)
                        .attr('width', 18).attr('height', 24).attr('rx', 2)
                        .style('fill', 'rgba(30, 50, 40, 0.7)')
                        .style('stroke', accent)
                        .style('stroke-opacity', 0.3)
                        .style('opacity', 0);
                    cell.transition().delay(100 + i * 70).duration(280)
                        .style('opacity', 1)
                        .style('stroke-opacity', 0.8);
                }
                g.append('text')
                    .attr('x', gx + 30).attr('y', cy + 36)
                    .style('font-family', 'Share Tech Mono, monospace')
                    .style('font-size', '8px')
                    .style('fill', '#96ffbe')
                    .text('32 raw bytes  ·  not a traffic key yet');
                // Warning stripe
                g.append('rect')
                    .attr('x', gx + 30).attr('y', cy - 28)
                    .attr('width', 170).attr('height', 10).attr('rx', 2)
                    .style('fill', 'rgba(230, 193, 90, 0.12)')
                    .style('stroke', 'rgba(230, 193, 90, 0.4)');
                g.append('text')
                    .attr('x', gx + 36).attr('y', cy - 20)
                    .style('font-family', 'Share Tech Mono, monospace')
                    .style('font-size', '7px')
                    .style('fill', '#e6c15a')
                    .text('UNSAFE AS KEY MATERIAL');
            } else if (step.id === 'hkdf') {
                // Funnel: secret → extract → expand → secrets
                const nodes = [
                    { lab: 'ECDHE', x: gx + 36, c: '#8fdcff' },
                    { lab: 'Extract', x: gx + 110, c: '#c4b0ff' },
                    { lab: 'Expand', x: gx + 184, c: '#c4b0ff' },
                    { lab: 'secrets', x: gx + 258, c: '#e6c15a' }
                ];
                nodes.forEach((n, i) => {
                    const ng = g.append('g').style('opacity', 0);
                    ng.append('circle')
                        .attr('cx', n.x).attr('cy', cy)
                        .attr('r', 18)
                        .style('fill', 'rgba(18, 22, 34, 0.9)')
                        .style('stroke', n.c);
                    ng.append('text')
                        .attr('x', n.x).attr('y', cy + 3)
                        .attr('text-anchor', 'middle')
                        .style('font-family', 'Share Tech Mono, monospace')
                        .style('font-size', '7px')
                        .style('fill', n.c)
                        .text(n.lab);
                    ng.transition().delay(150 + i * 200).duration(400).style('opacity', 1);
                    if (i < nodes.length - 1) {
                        g.append('path')
                            .attr('d', `M ${n.x + 18} ${cy} L ${nodes[i + 1].x - 18} ${cy}`)
                            .style('fill', 'none')
                            .style('stroke', n.c)
                            .style('stroke-opacity', 0)
                            .style('stroke-width', 1.5)
                            .transition().delay(250 + i * 200).duration(350)
                            .style('stroke-opacity', 0.7);
                    }
                });
                g.append('text')
                    .attr('x', gx + 36).attr('y', cy + 40)
                    .style('font-family', 'Share Tech Mono, monospace')
                    .style('font-size', '8px')
                    .style('fill', '#c4b0ff')
                    .text('HKDF = bridge ECC → symmetric schedule');
            } else if (step.id === 'aesgcm') {
                // AEAD tfm block with key slots lighting
                g.append('rect')
                    .attr('x', gx + 40).attr('y', cy - 34)
                    .attr('width', 200).attr('height', 68).attr('rx', 6)
                    .style('fill', 'rgba(28, 24, 12, 0.85)')
                    .style('stroke', accent);
                g.append('text')
                    .attr('x', gx + 52).attr('y', cy - 16)
                    .style('font-family', 'Share Tech Mono, monospace')
                    .style('font-size', '9px')
                    .style('fill', accent)
                    .text('struct crypto_aead');
                ['key', 'iv', 'tag'].forEach((lab, i) => {
                    const sx = gx + 52 + i * 60;
                    const slot = g.append('rect')
                        .attr('x', sx).attr('y', cy)
                        .attr('width', 48).attr('height', 18).attr('rx', 3)
                        .style('fill', 'rgba(40, 36, 18, 0.9)')
                        .style('stroke', accent)
                        .style('stroke-opacity', 0.25);
                    g.append('text')
                        .attr('x', sx + 24).attr('y', cy + 12)
                        .attr('text-anchor', 'middle')
                        .style('font-family', 'Share Tech Mono, monospace')
                        .style('font-size', '8px')
                        .style('fill', accent)
                        .text(lab);
                    slot.transition().delay(200 + i * 220).duration(350)
                        .style('stroke-opacity', 1)
                        .style('fill', 'rgba(230, 193, 90, 0.12)');
                });
            } else if (step.id === 'ktls') {
                // Packet through kTLS pipe into AEAD
                const pipeY = cy;
                g.append('rect')
                    .attr('x', gx + 28).attr('y', pipeY - 16)
                    .attr('width', gw * 0.72).attr('height', 32).attr('rx', 4)
                    .style('fill', 'rgba(24, 22, 12, 0.75)')
                    .style('stroke', accent)
                    .style('stroke-dasharray', '4 3');
                g.append('text')
                    .attr('x', gx + 40).attr('y', pipeY - 24)
                    .style('font-family', 'Share Tech Mono, monospace')
                    .style('font-size', '8px')
                    .style('fill', accent)
                    .text('net/tls · tls_sw_sendmsg');
                const pkt = g.append('rect')
                    .attr('x', gx + 36).attr('y', pipeY - 8)
                    .attr('width', 34).attr('height', 16).attr('rx', 2)
                    .style('fill', 'rgba(230, 193, 90, 0.25)')
                    .style('stroke', accent);
                pkt.transition().delay(200).duration(1200).ease(d3.easeCubicInOut)
                    .attr('x', gx + gw * 0.55);
                g.append('text')
                    .attr('x', gx + gw * 0.58).attr('y', pipeY + 36)
                    .style('font-family', 'Share Tech Mono, monospace')
                    .style('font-size', '8px')
                    .style('fill', '#e6c15a')
                    .text('→ crypto_aead_encrypt()');
            } else {
                g.append('path')
                    .attr('d', this._hsHexPath(cx, cy, 26))
                    .style('fill', 'rgba(143, 220, 255, 0.08)')
                    .style('stroke', accent);
            }
        };

        const showStep = (idx) => {
            const step = steps[idx];
            if (!step) return;
            stageRoot.selectAll('*').remove();

            // Highlight rail
            dots.forEach((d, i) => {
                d.dot.transition().duration(280)
                    .attr('r', i === idx ? 5 : 3.2)
                    .style('fill', i <= idx ? step.accent : 'rgba(60, 80, 100, 0.8)')
                    .style('fill-opacity', i === idx ? 0.95 : (i < idx ? 0.55 : 0.8))
                    .style('stroke-opacity', i === idx ? 1 : 0.35);
            });
            const fillX = dots[idx].dx;
            railFill.transition().duration(400).attr('x2', fillX);

            const g = stageRoot.append('g').style('opacity', 0);

            // Split layout: graphic | copy
            const split = Math.min(stageW * 0.52, 420);
            drawSceneGraphic(g, step, stageX, stageY, split - 12, stageH);

            const tx = stageX + split + 8;
            const tw = stageW - split - 8;

            // Layer badge
            g.append('rect')
                .attr('x', tx).attr('y', stageY + 4)
                .attr('width', Math.min(210, tw)).attr('height', 18).attr('rx', 3)
                .style('fill', 'rgba(20, 36, 48, 0.85)')
                .style('stroke', step.accent)
                .style('stroke-opacity', 0.55);
            g.append('text')
                .attr('x', tx + 10).attr('y', stageY + 16)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '9px')
                .style('letter-spacing', '1px')
                .style('fill', step.accent)
                .text(String(step.layer || 'KERNEL'));

            g.append('text')
                .attr('x', tx).attr('y', stageY + 42)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '16px')
                .style('letter-spacing', '1.5px')
                .style('fill', '#e8eef6')
                .text(String(step.does || ''));

            g.append('text')
                .attr('x', tx).attr('y', stageY + 60)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '10px')
                .style('fill', step.accent)
                .text(String(step.title || ''));

            // Story wrapped roughly
            const story = String(step.story || '');
            const max = tw < 280 ? 42 : 54;
            const words = story.split(/\s+/);
            const lines = [];
            let cur = '';
            words.forEach((word) => {
                const next = cur ? `${cur} ${word}` : word;
                if (next.length > max) {
                    if (cur) lines.push(cur);
                    cur = word;
                } else cur = next;
            });
            if (cur) lines.push(cur);
            lines.slice(0, 4).forEach((line, li) => {
                g.append('text')
                    .attr('x', tx).attr('y', stageY + 84 + li * 14)
                    .style('font-family', 'Share Tech Mono, monospace')
                    .style('font-size', '10px')
                    .style('fill', '#b7c6d6')
                    .text(line);
            });

            // Kernel symbol dock
            const dockY = stageY + stageH - 44;
            g.append('rect')
                .attr('x', tx).attr('y', dockY)
                .attr('width', tw).attr('height', 40).attr('rx', 4)
                .style('fill', 'rgba(8, 14, 22, 0.92)')
                .style('stroke', 'rgba(143, 220, 255, 0.28)');
            g.append('text')
                .attr('x', tx + 12).attr('y', dockY + 16)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '9px')
                .style('fill', '#8fdcff')
                .text(String(step.symbol || step.sym || ''));
            g.append('text')
                .attr('x', tx + 12).attr('y', dockY + 32)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '8px')
                .style('fill', 'rgba(150, 180, 200, 0.7)')
                .text(`${step.path || ''}  ·  ${step.ring || ''}`);

            g.transition().duration(420).style('opacity', 1);
            stepLabel.text(`${idx + 1}/${steps.length}  ·  ${step.does || ''}  ·  ${step.title || ''}`);
            if (typeof opts.onStep === 'function') opts.onStep(idx, step);
        };

        let currentIdx = 0;
        let manual = false;
        const autoTimers = [];
        const stopAuto = () => {
            manual = true;
            while (autoTimers.length) {
                clearTimeout(autoTimers.pop());
            }
        };
        const goTo = (idx, fromUser = false) => {
            if (fromUser) stopAuto();
            const next = Math.max(0, Math.min(steps.length - 1, idx));
            currentIdx = next;
            if (!theater.node() || !theater.node().isConnected) return;
            showStep(currentIdx);
        };
        const next = () => goTo(currentIdx + 1, true);
        const prev = () => goTo(currentIdx - 1, true);

        mkNav('◀', x + w - 72, prev);
        mkNav('▶', x + w - 40, next);

        dots.forEach((d, i) => {
            d.hit.on('click', (event) => {
                if (event && event.stopPropagation) event.stopPropagation();
                goTo(i, true);
            });
        });

        // Keyboard when handshake view is active
        const onKey = (event) => {
            if (this.activeCryptoView !== 'HANDSHAKE') return;
            if (event.key === 'ArrowRight' || event.key === ']') {
                event.preventDefault();
                next();
            } else if (event.key === 'ArrowLeft' || event.key === '[') {
                event.preventDefault();
                prev();
            }
        };
        // Replace previous handshake key handler if any
        if (this._handshakeKeyHandler) {
            window.removeEventListener('keydown', this._handshakeKeyHandler);
        }
        this._handshakeKeyHandler = onKey;
        window.addEventListener('keydown', onKey);

        theater.transition().delay(80).duration(500).style('opacity', 1);

        // Intro autoplay once; stops on first manual navigation
        steps.forEach((_, idx) => {
            const t = startDelay + idx * stepDelay;
            autoTimers.push(setTimeout(() => {
                if (manual) return;
                if (!theater.node() || !theater.node().isConnected) return;
                goTo(idx, false);
            }, t));
        });

        const controller = { goTo, next, prev, stopAuto, get index() { return currentIdx; } };
        this._handshakeTheater = controller;
        return controller;
    }

    drawHandshakeStoryView(layer, payload, width, height) {
        const g = layer.append('g').attr('class', 'crypto-handshake-story');
        const steps = this.getHandshakeStorySteps();
        const marginX = 28;
        const top = 96;
        // Theater keeps full stage height; GRID expands into remaining bottom space.
        const cardH = Math.min(88, Math.max(72, height * 0.095));
        const theaterH = Math.min(220, Math.max(188, height * 0.24));
        const gap = steps.length >= 7 ? 8 : 12;
        const usableW = width - marginX * 2;
        const cardW = Math.min(168, Math.max(100, (usableW - gap * (steps.length - 1)) / steps.length));
        const totalW = steps.length * cardW + (steps.length - 1) * gap;
        const startX = marginX + Math.max(0, (usableW - totalW) / 2);
        const cardY = top + 30;
        const theaterY = cardY + cardH + 10;
        const bottomReserve = 48; // CTA + footer
        const tronY = theaterY + theaterH + 10;
        const tronH = Math.max(200, height - tronY - bottomReserve);

        g.append('rect')
            .attr('x', marginX - 8)
            .attr('y', top - 18)
            .attr('width', width - marginX * 2 + 16)
            .attr('height', Math.max(cardH + theaterH + tronH + 60, height - top - 8))
            .attr('rx', 10)
            .style('fill', 'rgba(2, 6, 12, 0.42)')
            .style('stroke', 'rgba(110, 239, 255, 0.22)');

        g.append('text')
            .attr('x', marginX)
            .attr('y', top)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '11px')
            .style('letter-spacing', '1.6px')
            .style('fill', '#6EEFFF')
            .text('HANDSHAKE → KERNEL CRYPTO PATH');

        g.append('text')
            .attr('x', marginX)
            .attr('y', top + 14)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '9px')
            .style('fill', '#7f93a6')
            .text('cards / theater / GRID board  ·  ◀ ▶ or ← →  ·  autoplay stops on first click');

        // Connector line behind cards
        const lineY = cardY + cardH / 2;
        g.append('path')
            .attr('d', `M ${startX + cardW / 2} ${lineY} L ${startX + totalW - cardW / 2} ${lineY}`)
            .style('fill', 'none')
            .style('stroke', 'rgba(150, 255, 190, 0.22)')
            .style('stroke-width', 2)
            .style('stroke-dasharray', '4 6');

        const cardNodes = [];
        const paintCardSelection = (activeIdx) => {
            cardNodes.forEach(({ rect, step }, i) => {
                const on = i === activeIdx;
                rect
                    .style('stroke-opacity', on ? 1 : (step.id === 'cert' ? 0.9 : 0.55))
                    .style('stroke-width', on ? 2.2 : (step.id === 'cert' ? 1.8 : 1))
                    .style('fill', on
                        ? 'rgba(18, 28, 40, 0.96)'
                        : (step.id === 'cert' ? 'rgba(28, 16, 14, 0.94)' : 'rgba(10, 14, 20, 0.92)'));
            });
        };

        steps.forEach((step, idx) => {
            const x = startX + idx * (cardW + gap);
            const node = g.append('g')
                .attr('class', `crypto-handshake-step${step.id === 'cert' ? ' is-cert' : ''}`)
                .style('opacity', 0)
                .style('cursor', 'pointer');

            const cardFill = step.id === 'cert'
                ? 'rgba(28, 16, 14, 0.94)'
                : 'rgba(10, 14, 20, 0.92)';

            const rect = node.append('rect')
                .attr('x', x)
                .attr('y', cardY)
                .attr('width', cardW)
                .attr('height', cardH)
                .attr('rx', 8)
                .style('fill', cardFill)
                .style('stroke', step.accent)
                .style('stroke-opacity', step.id === 'cert' ? 0.9 : 0.65)
                .style('stroke-width', step.id === 'cert' ? 1.8 : 1);
            cardNodes.push({ rect, step, node });

            node.append('circle')
                .attr('cx', x + cardW / 2)
                .attr('cy', cardY - 2)
                .attr('r', step.id === 'cert' ? 5 : 4)
                .style('fill', step.accent);

            // Sci-fi identity badge on cert card
            if (step.id === 'cert') {
                const sx = x + cardW - 16;
                const sy = cardY + 16;
                node.append('path')
                    .attr('d', this._hsHexPath(sx, sy, 8))
                    .style('fill', 'rgba(255, 120, 90, 0.14)')
                    .style('stroke', '#ff8a6a')
                    .style('stroke-width', 1.2);
                node.append('circle')
                    .attr('cx', sx)
                    .attr('cy', sy)
                    .attr('r', 2.2)
                    .style('fill', '#8fdcff');
            }

            node.append('text')
                .attr('x', x + 10)
                .attr('y', cardY + 15)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', cardW < 120 ? '8px' : '9px')
                .style('letter-spacing', '0.4px')
                .style('fill', step.accent)
                .text(step.title);

            // What this step does (verb)
            if (step.does) {
                node.append('text')
                    .attr('x', x + 10)
                    .attr('y', cardY + 28)
                    .style('font-family', 'Share Tech Mono, monospace')
                    .style('font-size', '8px')
                    .style('letter-spacing', '1.1px')
                    .style('fill', 'rgba(230, 236, 245, 0.88)')
                    .text(String(step.does));
            }

            // Compact body — full story lives in the Tron GRID board below.
            const bodyLines = String(step.body || '').split('\n').slice(0, 2);
            const maxChars = cardW < 120 ? 22 : (cardW < 140 ? 26 : 30);
            bodyLines.forEach((line, li) => {
                node.append('text')
                    .attr('x', x + 10)
                    .attr('y', cardY + 44 + li * 11)
                    .style('font-family', 'Share Tech Mono, monospace')
                    .style('font-size', '8px')
                    .style('fill', '#b8c6d6')
                    .text(line.length > maxChars ? `${line.slice(0, maxChars - 1)}…` : line);
            });

            node.append('text')
                .attr('x', x + 10)
                .attr('y', cardY + cardH - 10)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '7px')
                .style('fill', '#6f8597')
                .text(String(step.kernel || '').length > 24
                    ? `${String(step.kernel).slice(0, 23)}…`
                    : step.kernel);

            // Slow cascade so each card is readable (~0.7s apart).
            node.transition()
                .delay(280 + idx * 700)
                .duration(650)
                .style('opacity', 1);

            node.on('click', (event) => {
                if (event && event.stopPropagation) event.stopPropagation();
                if (this._handshakeTheater && typeof this._handshakeTheater.goTo === 'function') {
                    this._handshakeTheater.goTo(idx, true);
                }
                paintCardSelection(idx);
            });

            if (idx < steps.length - 1) {
                const ax = x + cardW + 2;
                g.append('path')
                    .attr('d', `M ${ax} ${lineY} L ${ax + gap - 4} ${lineY}`)
                    .style('fill', 'none')
                    .style('stroke', step.accent)
                    .style('stroke-width', 1.4)
                    .style('opacity', 0.55);
            }
        });

        const tronBoard = this.drawHandshakeTronBoard(g, {
            x: marginX,
            y: tronY,
            w: usableW,
            h: tronH,
            steps,
            onSelect: (idx) => {
                if (this._handshakeTheater && typeof this._handshakeTheater.goTo === 'function') {
                    this._handshakeTheater.goTo(idx, true);
                }
                paintCardSelection(idx);
            }
        });

        this.drawHandshakeKernelTheater(g, {
            x: marginX,
            y: theaterY,
            w: usableW,
            h: theaterH,
            steps,
            stepDelay: 700,
            startDelay: 280,
            onStep: (idx) => {
                paintCardSelection(idx);
                if (tronBoard && typeof tronBoard.setStep === 'function') {
                    tronBoard.setStep(idx);
                }
            }
        });

        // CTA chips under Tron board (bottom edge)
        const ctaY = Math.min(height - 36, tronY + tronH + 8);
        const makeCta = (label, x, fill, stroke, onClick) => {
            const cta = g.append('g').style('cursor', 'pointer').on('click', onClick);
            cta.append('rect')
                .attr('x', x)
                .attr('y', ctaY)
                .attr('width', 150)
                .attr('height', 28)
                .attr('rx', 14)
                .style('fill', fill)
                .style('stroke', stroke);
            cta.append('text')
                .attr('x', x + 75)
                .attr('y', ctaY + 18)
                .attr('text-anchor', 'middle')
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '10px')
                .style('letter-spacing', '0.5px')
                .style('fill', stroke)
                .text(label);
        };
        makeCta('→ CURVE25519', marginX, 'rgba(143,220,255,0.10)', '#8fdcff', () => {
            this.handshakeRendered = false;
            this.activeCryptoView = 'ARCHITECTURE';
            this.updateCryptoViewToggle();
            this.syncOverlayForCurrentView();
            this.openArchMorph({ layer: 'primitives', id: 'curve25519', label: 'Curve25519', hint: 'X25519 key exchange' });
        });
        makeCta('→ AES LAB', marginX + 166, 'rgba(230,193,90,0.10)', '#e6c15a', () => {
            this.handshakeRendered = false;
            this.selectedCompetitionAlgorithm = 'AES';
            this.activeCryptoView = 'LINEAR_ANALYSIS';
            this.updateCryptoViewToggle();
            this.syncOverlayForCurrentView();
            this.renderFlowMap(this.lastPayload || this.normalizeTelemetry(this.getFallbackTelemetry()));
        });
        makeCta('→ ARCHITECTURE', marginX + 332, 'rgba(169,212,232,0.10)', '#a9d4e8', () => {
            this.handshakeRendered = false;
            this.activeCryptoView = 'ARCHITECTURE';
            this.updateCryptoViewToggle();
            this.syncOverlayForCurrentView();
            this.renderFlowMap(this.lastPayload || this.normalizeTelemetry(this.getFallbackTelemetry()));
        });

        // Ghost cycle: auth → agreement → derive → encrypt
        const ghosts = [
            'x509_verify_cert()',
            'curve25519_generic()',
            'hkdf_expand_label()',
            'crypto_aead_encrypt()'
        ];
        const ghostIdx = Math.floor(Date.now() / 3200) % ghosts.length;
        this.flashArchGhost(ghosts[ghostIdx]);

        g.append('text')
            .attr('x', marginX)
            .attr('y', height - 14)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '9px')
            .style('fill', '#6f8597')
            .text('handshake story · educational TLS 1.3 path · not a live packet decoder');

        this.handshakeRendered = true;
    }

    getArchitectureModel(payload) {
        const meta = payload?.meta || {};
        const competition = this.getCompetitionPayload(meta) || meta.algorithm_competition || {};
        const selected = String(competition?.selected?.name || meta.selected_driver || 'aes-aesni');
        const request = String(competition?.request || this.selectedCompetitionAlgorithm || 'AES').toUpperCase();
        const lanes = Array.isArray(payload?.items) ? payload.items : [];
        const liveProtocols = new Set(lanes.map((l) => String(l.protocol || '').toUpperCase()));
        const liveAlgs = new Set(lanes.map((l) => String(l.algorithm || '').toUpperCase()));

        const consumers = [
            { id: 'ktls', label: 'kTLS', uses: ['aead', 'aes', 'chacha'], hint: 'TLS record offload in kernel', live: liveProtocols.has('TLS') },
            { id: 'af_alg', label: 'AF_ALG', uses: ['skcipher', 'aead', 'shash'], hint: 'userspace → crypto API sockets', live: true },
            { id: 'wireguard', label: 'WireGuard', uses: ['aead', 'chacha', 'curve25519'], hint: 'Noise_IK · ChaCha20-Poly1305 · X25519', live: liveProtocols.has('WIREGUARD') || liveAlgs.has('CHACHA20-POLY1305') },
            { id: 'ipsec', label: 'IPsec/XFRM', uses: ['aead', 'aes', 'shash'], hint: 'ESP/AH transforms', live: liveProtocols.has('IPSEC') },
            { id: 'dm_crypt', label: 'dm-crypt', uses: ['skcipher', 'aes'], hint: 'block device encryption', live: false },
            { id: 'fscrypt', label: 'fscrypt', uses: ['skcipher', 'aes', 'shash'], hint: 'file/directory encryption', live: false },
            { id: 'ima', label: 'IMA/EVM', uses: ['shash', 'ecdsa'], hint: 'integrity measurement / signatures', live: false },
            { id: 'random', label: 'random', uses: ['chacha'], hint: 'CRNG (ChaCha20)', live: true }
        ];

        const api = [
            { id: 'alloc', label: 'crypto_alloc_*', hint: 'allocate tfm by name/type' },
            { id: 'tfm', label: 'struct crypto_tfm', hint: 'transform handle' },
            { id: 'skcipher', label: 'skcipher', hint: 'symmetric cipher API' },
            { id: 'aead', label: 'aead', hint: 'auth encryption API' },
            { id: 'shash', label: 'shash', hint: 'synchronous hash API' },
            { id: 'kpp', label: 'kpp', hint: 'key-agreement (ECDH/X25519)' }
        ];

        const primitives = [
            { id: 'aes', label: 'AES', family: 'block', hint: 'AES-128/256 · GCM/XTS/CTR' },
            { id: 'chacha', label: 'ChaCha20', family: 'stream', hint: 'ChaCha20-Poly1305' },
            { id: 'sha2', label: 'SHA-2', family: 'hash', hint: 'SHA-256 / SHA-512' },
            { id: 'curve25519', label: 'Curve25519', family: 'ecc', hint: 'X25519 key exchange' },
            { id: 'ecdsa', label: 'ECDSA', family: 'ecc', hint: 'P-256/P-384 signatures' },
            { id: 'poly', label: 'Poly1305', family: 'mac', hint: 'one-time authenticator' }
        ];

        const drivers = [
            { id: 'generic', label: 'generic', hint: 'portable C fallback' },
            { id: 'simd', label: 'simd/avx', hint: 'vector software path' },
            { id: 'aesni', label: 'AES-NI', hint: 'CPU AES instructions', hot: /aesni|vaes/i.test(selected) },
            { id: 'cryptd', label: 'cryptd', hint: 'async crypto daemon wrapper', hot: /cryptd/i.test(selected) },
            { id: 'neon', label: 'NEON/CE', hint: 'ARM crypto extensions' },
            { id: 'offload', label: 'HW offload', hint: 'qat / ccp / engine' }
        ];

        // Edges: consumer → api type, api → primitive, primitive → driver family
        const edges = [
            ['ktls', 'aead'], ['ktls', 'aes'],
            ['af_alg', 'skcipher'], ['af_alg', 'aead'], ['af_alg', 'shash'],
            ['wireguard', 'aead'], ['wireguard', 'chacha'], ['wireguard', 'curve25519'], ['wireguard', 'kpp'],
            ['ipsec', 'aead'], ['ipsec', 'aes'],
            ['dm_crypt', 'skcipher'], ['dm_crypt', 'aes'],
            ['fscrypt', 'skcipher'], ['fscrypt', 'aes'],
            ['ima', 'shash'], ['ima', 'ecdsa'],
            ['random', 'chacha'],
            ['aead', 'aes'], ['aead', 'chacha'], ['aead', 'poly'],
            ['skcipher', 'aes'], ['skcipher', 'chacha'],
            ['shash', 'sha2'],
            ['kpp', 'curve25519'], ['kpp', 'ecdsa'],
            ['aes', 'aesni'], ['aes', 'generic'], ['aes', 'cryptd'],
            ['chacha', 'simd'], ['chacha', 'generic'],
            ['sha2', 'simd'], ['sha2', 'generic'],
            ['curve25519', 'generic'], ['ecdsa', 'generic'],
            ['aes', 'offload'], ['aes', 'neon']
        ];

        return { consumers, api, primitives, drivers, edges, selected, request, liveCount: lanes.length };
    }

    drawArchitectureMapView(layer, payload, width, height) {
        const model = this.getArchitectureModel(payload);
        const focus = this.archFocus;
        const marginX = 36;
        const top = 108;
        const bottom = height - 52;
        const usableH = Math.max(420, bottom - top);
        const bandH = usableH / 4;
        const bands = [
            { key: 'consumers', title: 'CONSUMERS · kernel subsystems', y: top, items: model.consumers, color: '#a9d4e8' },
            { key: 'api', title: 'KERNEL CRYPTO API · unified entry', y: top + bandH, items: model.api, color: '#e6c15a' },
            { key: 'primitives', title: 'PRIMITIVES · algorithms', y: top + bandH * 2, items: model.primitives, color: '#96ffbe' },
            { key: 'drivers', title: 'IMPLEMENTATIONS · software / CPU / offload', y: top + bandH * 3, items: model.drivers, color: '#c4b0ff' }
        ];

        const nodeMap = new Map();
        const related = new Set();
        if (focus?.id) {
            related.add(focus.id);
            model.edges.forEach(([a, b]) => {
                if (a === focus.id || b === focus.id) {
                    related.add(a);
                    related.add(b);
                }
            });
            // one hop expand
            const hop = [...related];
            model.edges.forEach(([a, b]) => {
                if (hop.includes(a) || hop.includes(b)) {
                    related.add(a);
                    related.add(b);
                }
            });
        }

        const g = layer.append('g').attr('class', 'crypto-architecture-map');

        // Ambient frame
        g.append('rect')
            .attr('x', marginX - 8)
            .attr('y', top - 28)
            .attr('width', width - marginX * 2 + 16)
            .attr('height', usableH + 48)
            .attr('rx', 10)
            .style('fill', 'rgba(6, 10, 16, 0.35)')
            .style('stroke', 'rgba(120, 140, 170, 0.22)');

        bands.forEach((band) => {
            const rowY = band.y + 36;
            const n = band.items.length;
            const gap = 12;
            const rowW = width - marginX * 2;
            const nodeW = Math.min(132, Math.max(88, (rowW - gap * (n - 1)) / n));
            const totalW = n * nodeW + (n - 1) * gap;
            const startX = marginX + (rowW - totalW) / 2;

            g.append('text')
                .attr('x', marginX)
                .attr('y', band.y + 14)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '10px')
                .style('letter-spacing', '1px')
                .style('fill', band.color)
                .text(band.title);

            band.items.forEach((item, idx) => {
                const x = startX + idx * (nodeW + gap);
                const y = rowY;
                const isFocus = focus?.id === item.id;
                const isRelated = !focus || related.has(item.id);
                const isLive = Boolean(item.live || item.hot);
                const opacity = isRelated ? 1 : 0.22;
                const stroke = isFocus
                    ? band.color
                    : (isLive ? 'rgba(150,255,190,0.55)' : 'rgba(120,140,170,0.35)');
                const fill = isFocus
                    ? 'rgba(28, 40, 58, 0.95)'
                    : 'rgba(10, 14, 20, 0.88)';

                const node = g.append('g')
                    .attr('class', 'crypto-arch-node')
                    .style('cursor', 'pointer')
                    .style('opacity', opacity)
                    .on('click', () => {
                        if (this.isSchemeNode(item.id)) {
                            this.openSchemeDiagram({
                                layer: band.key,
                                id: item.id,
                                label: item.label,
                                hint: item.hint
                            });
                            return;
                        }
                        const morphable = band.key === 'consumers' || band.key === 'primitives';
                        if (morphable) {
                            if (this.archMorphTarget?.id === item.id && this.archMorphTarget?.layer === band.key) {
                                this.closeArchMorph();
                                this.archFocus = null;
                                this.renderFlowMap(this.lastPayload || payload);
                                return;
                            }
                            this.openArchMorph({
                                layer: band.key,
                                id: item.id,
                                label: item.label,
                                hint: item.hint
                            });
                            return;
                        }
                        this.closeArchMorph();
                        this.archFocus = (this.archFocus?.id === item.id)
                            ? null
                            : { layer: band.key, id: item.id, label: item.label, hint: item.hint };
                        this.renderFlowMap(this.lastPayload || payload);
                    })
                    .on('mousemove', (event) => {
                        if (!this.hoverCard) return;
                        this.hoverCard.style.display = 'block';
                        const tip = this.isSchemeNode(item.id)
                            ? (this.resolveSchemeKind(item.id) === 'wg-chacha'
                                ? 'click → textbook SCHEME (ChaCha20-Poly1305)'
                                : 'click → textbook SCHEME (AES-GCM path)')
                            : (band.key === 'consumers'
                                ? 'click → consumer→crypto morph'
                                : (band.key === 'primitives'
                                    ? 'click → primitive drill morph'
                                    : 'click to highlight reuse edges'));
                        this.hoverCard.textContent = [
                            item.label,
                            item.hint || '',
                            isLive ? 'status: live / active path' : 'status: architectural link',
                            tip
                        ].filter(Boolean).join('\n');
                        this.positionHoverCard(event);
                    })
                    .on('mouseleave', () => {
                        if (this.hoverCard) this.hoverCard.style.display = 'none';
                    });

                node.append('rect')
                    .attr('x', x)
                    .attr('y', y)
                    .attr('width', nodeW)
                    .attr('height', 44)
                    .attr('rx', 6)
                    .style('fill', fill)
                    .style('stroke', stroke)
                    .style('stroke-width', isFocus ? 1.6 : 1);

                node.append('text')
                    .attr('x', x + nodeW / 2)
                    .attr('y', y + 27)
                    .attr('text-anchor', 'middle')
                    .style('font-family', 'Share Tech Mono, monospace')
                    .style('font-size', nodeW < 100 ? '9px' : '11px')
                    .style('fill', '#e7eef8')
                    .text(item.label);

                if (isLive) {
                    node.append('circle')
                        .attr('cx', x + nodeW - 10)
                        .attr('cy', y + 10)
                        .attr('r', 3.2)
                        .style('fill', '#96ffbe');
                }

                nodeMap.set(item.id, {
                    x: x + nodeW / 2,
                    y: y + 44,
                    top: y,
                    band: band.key,
                    color: band.color
                });
            });
        });

        // Draw edges under nodes (insert before nodes by raising nodes - draw edges first in a lower group)
        const edgeLayer = g.insert('g', ':first-child').attr('class', 'crypto-arch-edges');
        const idToBand = {};
        bands.forEach((b) => b.items.forEach((it) => { idToBand[it.id] = b.key; }));
        const bandOrder = { consumers: 0, api: 1, primitives: 2, drivers: 3 };

        model.edges.forEach(([from, to]) => {
            const a = nodeMap.get(from);
            const b = nodeMap.get(to);
            if (!a || !b) return;
            // Only draw downward (or equal) architectural links
            if ((bandOrder[idToBand[to]] ?? 9) < (bandOrder[idToBand[from]] ?? 0)) return;
            const active = !focus || (related.has(from) && related.has(to));
            const x1 = a.x;
            const y1 = a.y;
            const x2 = b.x;
            const y2 = b.top;
            const midY = (y1 + y2) / 2;
            edgeLayer.append('path')
                .attr('d', `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`)
                .style('fill', 'none')
                .style('stroke', active ? 'rgba(169, 212, 232, 0.55)' : 'rgba(90, 110, 130, 0.10)')
                .style('stroke-width', active && focus ? 1.6 : 1)
                .style('opacity', active ? 1 : 0.7);
        });

        // Detail card
        const detail = focus || {
            label: 'Kernel Crypto API',
            hint: 'One API, many consumers — click a node to see reuse edges',
            id: 'api'
        };
        const cardW = Math.min(360, width * 0.28);
        const cardX = width - cardW - 28;
        const cardY = top - 8;
        const card = g.append('g').attr('class', 'crypto-arch-detail');
        card.append('rect')
            .attr('x', cardX)
            .attr('y', cardY)
            .attr('width', cardW)
            .attr('height', 118)
            .attr('rx', 8)
            .style('fill', 'rgba(8, 12, 20, 0.9)')
            .style('stroke', 'rgba(230, 193, 90, 0.35)');
        card.append('text')
            .attr('x', cardX + 14)
            .attr('y', cardY + 22)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '9px')
            .style('letter-spacing', '0.8px')
            .style('fill', '#e6c15a')
            .text(this.archMorphTarget ? 'MORPH · CRYPTO PATH' : (focus ? 'FOCUS · REUSE PATH' : 'ARCHITECTURE MAP'));
        card.append('text')
            .attr('x', cardX + 14)
            .attr('y', cardY + 46)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '14px')
            .style('fill', '#e8f0fa')
            .text(String(detail.label || detail.id));
        const hint = String(detail.hint || '');
        card.append('text')
            .attr('x', cardX + 14)
            .attr('y', cardY + 68)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '10px')
            .style('fill', '#9db0c6')
            .text(hint.length > 42 ? `${hint.slice(0, 42)}…` : hint);
        card.append('text')
            .attr('x', cardX + 14)
            .attr('y', cardY + 92)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '9px')
            .style('fill', '#7f93a6')
            .text(`live flows: ${model.liveCount} · selected: ${model.selected}`);
        card.append('text')
            .attr('x', cardX + 14)
            .attr('y', cardY + 108)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '9px')
            .style('fill', '#8fdcff')
            .text(this.archMorphTarget
                ? 'CLOSE ribbon or re-click node'
                : 'click CONSUMER or PRIMITIVE for morph');

        // Footer legend
        g.append('text')
            .attr('x', marginX)
            .attr('y', height - 22)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '9px')
            .style('fill', '#6f8597')
            .text('kTLS/AES → AES-GCM SCHEME · WireGuard/ChaCha/Poly → ChaCha SCHEME · other nodes → morph · API/impl → reuse');

        if (this.archMorphTarget && this.archMorphNode) {
            // Keep ribbon above the map after SVG rebuild.
            this.archMorphNode.style.display = 'block';
        }
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
        if (this.activeCryptoView === 'ARCHITECTURE') {
            this.drawArchitectureMapView(layer, payload, width, height);
            if (this.archMorphTarget && this.archMorphNode && this.archMorphNode.style.display === 'none') {
                this.renderArchMorphRibbon();
            }
            return;
        }
        if (this.activeCryptoView === 'SCHEME') {
            this.closeArchMorph();
            this.drawSchemeView(layer, payload, width, height);
            return;
        }
        if (this.activeCryptoView === 'HANDSHAKE') {
            this.closeArchMorph();
            this.drawHandshakeStoryView(layer, payload, width, height);
            return;
        }
        this.closeArchMorph();
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
        // Keep SCHEME interactive (PLAY / phase) — do not rebuild SVG on every poll.
        if (this.activeCryptoView === 'SCHEME' && this.schemeRendered) {
            this.lastPayload = normalized;
            const meta = normalized?.meta || {};
            const comp = this.getCompetitionPayload(meta) || {};
            const selected = String(comp?.selected?.name || '').replace(/^_+/, '').slice(0, 22);
            if (selected && this.svg) {
                this.svg.select('.scheme-selected-driver').text(`live: ${selected}`);
            }
            return;
        }

        // HANDSHAKE step cascade must not restart on every telemetry tick.
        if (this.activeCryptoView === 'HANDSHAKE' && this.handshakeRendered) {
            this.lastPayload = normalized;
            return;
        }

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
        this.closeArchMorph();
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
