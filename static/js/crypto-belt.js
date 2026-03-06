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

        const lanes = Array.isArray(payload.items) ? payload.items : [];
        const topY = 150;
        const protocolY = 250;
        const cryptoY = 350;
        const algoY = 450;
        const endpointY = 520;

        const startX = width * 0.16;
        const usableWidth = width * 0.70;
        const laneCount = Math.max(lanes.length, 1);
        const laneStep = laneCount > 1 ? usableWidth / (laneCount - 1) : 0;

        lanes.forEach((lane, idx) => {
            const x = startX + laneStep * idx;
            const intensity = Math.min(1 + lane.weight * 0.35, 2.2);
            const emphasis = Boolean(lane.isNew || lane.isHot);
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
            .text('ACTIVE PATHS');

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
                    this.telemetryNode.textContent = `ops/s: ${ops} | tls: ${tls} | active: ${flows} | unknown-pid: ${unknownPid} | terminator: ${terms || '-'} | source: ${source}`;
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
