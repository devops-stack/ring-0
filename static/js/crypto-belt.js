// Crypto subsystem realtime interaction visualization
// Version: 3

debugLog('🔐 crypto-belt.js v3: Script loading...');

class CryptoSubsystemVisualization {
    constructor() {
        this.container = null;
        this.svg = null;
        this.isActive = false;
        this.resizeHandler = null;
        this.telemetryInterval = null;
        this.telemetryNode = null;
        this.exitButton = null;
        this.lastPayload = null;
        this.activeAnimationTick = 0;
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
        title.textContent = 'CRYPTO LIVE INTERACTIONS (in development)';
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
            if (window.kernelContextMenu) {
                window.kernelContextMenu.deactivateViews();
            } else {
                this.deactivate();
            }
        };

        this.container.appendChild(btn);
        this.exitButton = btn;
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
                    weight: 1
                };
            })
            .filter(Boolean);

        // Collapse duplicates to keep lanes readable.
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
                    weight: 1
                };
            });
        }

        items.sort((a, b) => {
            if (b.weight !== a.weight) return b.weight - a.weight;
            return a.process.localeCompare(b.process);
        });

        return {
            items: items.slice(0, 12),
            meta: data?.meta || {}
        };
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

    drawNode(group, x, y, label, level, intensity) {
        const width = Math.min(Math.max(150, String(label).length * 8 + 28), 250);
        const height = 34;
        const radius = 8;
        const lineColor = intensity > 1.2 ? '#f0f5ff' : '#d6dde8';
        const fillColor = level === 'crypto' ? '#11161f' : '#090d12';

        group.append('rect')
            .attr('x', x - width / 2)
            .attr('y', y - height / 2)
            .attr('width', width)
            .attr('height', height)
            .attr('rx', radius)
            .style('fill', fillColor)
            .style('stroke', lineColor)
            .style('stroke-width', intensity > 1.2 ? 1.2 : 0.9)
            .style('opacity', 0.96)
            .style('filter', intensity > 1.2 ? 'url(#crypto-line-glow)' : null);

        group.append('text')
            .attr('x', x)
            .attr('y', y)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '11px')
            .style('letter-spacing', '0.35px')
            .style('fill', '#eef3fb')
            .text(String(label).toUpperCase());

        return {
            top: { x, y: y - height / 2 },
            bottom: { x, y: y + height / 2 },
            left: { x: x - width / 2, y },
            right: { x: x + width / 2, y }
        };
    }

    drawPath(group, points, intensity) {
        const path = d3.path();
        path.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i += 1) {
            path.lineTo(points[i].x, points[i].y);
        }

        const stroke = intensity > 1.2 ? '#e8eefb' : '#bbc6d8';

        group.append('path')
            .attr('d', path.toString())
            .style('fill', 'none')
            .style('stroke', stroke)
            .style('stroke-width', intensity > 1.2 ? 1.25 : 0.9)
            .style('stroke-opacity', 0.85)
            .attr('marker-end', 'url(#crypto-flow-arrow)')
            .style('filter', intensity > 1.2 ? 'url(#crypto-line-glow)' : null);
    }

    animatePacket(group, points, intensity, laneId) {
        const dot = group.append('circle')
            .attr('r', intensity > 1.2 ? 3 : 2.2)
            .attr('cx', points[0].x)
            .attr('cy', points[0].y)
            .style('fill', '#f2f7ff')
            .style('opacity', 0.85)
            .style('filter', 'url(#crypto-line-glow)');

        const segmentDuration = Math.max(260, 440 - Math.round(intensity * 50));

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

        const lanes = Array.isArray(payload.items) ? payload.items : [];
        const topY = 150;
        const protocolY = 250;
        const cryptoY = 350;
        const algoY = 450;
        const endpointY = 512;

        const startX = width * 0.12;
        const usableWidth = width * 0.76;
        const laneCount = Math.max(lanes.length, 1);
        const laneStep = laneCount > 1 ? usableWidth / (laneCount - 1) : 0;

        lanes.forEach((lane, idx) => {
            const x = startX + laneStep * idx;
            const intensity = Math.min(1 + lane.weight * 0.35, 2.2);
            const laneGroup = layer.append('g').attr('class', 'crypto-lane');

            const pNode = this.drawNode(laneGroup, x, topY, lane.process, 'process', intensity);
            const protoNode = this.drawNode(laneGroup, x, protocolY, lane.protocol, 'protocol', intensity);
            const cNode = this.drawNode(laneGroup, x, cryptoY, 'crypto subsystem', 'crypto', intensity);
            const aNode = this.drawNode(laneGroup, x, algoY, lane.algorithm, 'algorithm', intensity);

            const p1 = [pNode.bottom, protoNode.top];
            const p2 = [protoNode.bottom, cNode.top];
            const p3 = [cNode.bottom, aNode.top];

            this.drawPath(laneGroup, p1, intensity);
            this.drawPath(laneGroup, p2, intensity);
            this.drawPath(laneGroup, p3, intensity);

            this.animatePacket(laneGroup, [pNode.bottom, protoNode.top, protoNode.bottom, cNode.top, cNode.bottom, aNode.top], intensity, tickId);

            laneGroup.append('text')
                .attr('x', x)
                .attr('y', endpointY)
                .attr('text-anchor', 'middle')
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '10px')
                .style('fill', '#9ba5b4')
                .style('letter-spacing', '0.2px')
                .text(`pid:${lane.pid || '-'}  ${lane.endpoint || '-'}`);
        });

        // Side legend for quick scan
        const legend = layer.append('g').attr('class', 'crypto-legend');
        const lx = 26;
        const ly = 126;
        legend.append('text')
            .attr('x', lx)
            .attr('y', ly)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '11px')
            .style('fill', '#d2d9e5')
            .text('ACTIVE PATHS');

        lanes.slice(0, 10).forEach((lane, idx) => {
            legend.append('text')
                .attr('x', lx)
                .attr('y', ly + 22 + idx * 15)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '10px')
                .style('fill', '#aab5c5')
                .text(`${lane.process} -> ${lane.protocol} -> ${lane.algorithm}`);
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

                if (this.telemetryNode) {
                    const ops = Number(data?.meta?.ops_per_sec || 0);
                    const tls = Number(data?.meta?.tls_sessions || 0);
                    const flows = Number(data?.meta?.active_flows || normalized.items.length || 0);
                    const source = String(data?.meta?.source || 'api');
                    this.telemetryNode.textContent = `ops/s: ${ops} | tls: ${tls} | active flows: ${flows} | source: ${source}`;
                }
            })
            .catch(() => {
                const fallback = this.getFallbackTelemetry();
                this.renderFlowMap(fallback);
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
        this.renderFlowMap(this.lastPayload || this.getFallbackTelemetry());
    }
}

window.CryptoSubsystemVisualization = CryptoSubsystemVisualization;
debugLog('🔐 crypto-belt.js: CryptoSubsystemVisualization exported to window');
