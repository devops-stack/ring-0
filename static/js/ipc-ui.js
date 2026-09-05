// IPC UI module extracted from main.js
(function initIpcUI(){
const svg = d3.select("svg");
function normalizeProcName(name) {
    if (!name) return '';
    const lower = String(name).toLowerCase().trim();
    if (!lower) return '';
    // Normalize "nginx: master process ..." to "nginx".
    if (lower.startsWith('nginx:')) return 'nginx';
    return lower;
}

const IPC_CHANNELS = [
    { key: 'unix', label: 'UNIX', short: 'U', weightKey: 'unixSocketWeight', degreeKey: 'unixSocketDegree', statKey: 'shared_unix_socket_inodes', radiusOffset: -30, color: 'rgba(28, 28, 28, 0.72)', dash: '2 5' },
    { key: 'pipe', label: 'PIPE', short: 'P', weightKey: 'pipeWeight', degreeKey: 'pipeDegree', statKey: 'shared_pipe_inodes', radiusOffset: -10, color: 'rgba(72, 72, 72, 0.62)', dash: '7 5' },
    { key: 'tcp', label: 'TCP', short: 'T', weightKey: 'tcpWeight', degreeKey: 'tcpDegree', statKey: 'shared_tcp_socket_inodes', radiusOffset: 12, color: 'rgba(16, 58, 78, 0.66)', dash: 'none' },
    { key: 'shm', label: 'SHM', short: 'M', weightKey: 'shmWeight', degreeKey: 'shmDegree', statKey: 'shared_memory_regions', radiusOffset: 34, color: 'rgba(86, 62, 28, 0.55)', dash: '1 8' }
];

function getSharedChannelType(socketWeight, pipeWeight, shmWeight, nsWeight, unixSocketWeight = 0, tcpWeight = 0) {
    const channels = [];
    if (Number(unixSocketWeight || 0) > 0) channels.push('UNIX');
    if (Number(tcpWeight || 0) > 0) channels.push('TCP');
    const genericSocketWeight = Number(socketWeight || 0) - Number(unixSocketWeight || 0) - Number(tcpWeight || 0);
    if (genericSocketWeight > 0) channels.push('SOCKET');
    if (Number(pipeWeight || 0) > 0) channels.push('PIPE');
    if (Number(shmWeight || 0) > 0) channels.push('SHM');
    if (Number(nsWeight || 0) > 0) channels.push('NS');
    if (!channels.length) return 'UNKNOWN';
    if (channels.length === 1) return channels[0];
    return `MIXED (${channels.join('+')})`;
}

function channelWeight(link, channel) {
    return Number(link[channel.weightKey] || 0);
}

function dominantChannel(row) {
    let best = IPC_CHANNELS[0];
    let bestValue = -1;
    IPC_CHANNELS.forEach((channel) => {
        const value = Number(row[channel.degreeKey] || row[channel.weightKey] || 0);
        if (value > bestValue) {
            best = channel;
            bestValue = value;
        }
    });
    return bestValue > 0 ? best : null;
}

function buildChannelArc(cx, cy, startAngle, endAngle, radius) {
    let delta = endAngle - startAngle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const sweepFlag = delta >= 0 ? 1 : 0;
    const largeArcFlag = Math.abs(delta) > Math.PI ? 1 : 0;
    const sx = cx + Math.cos(startAngle) * radius;
    const sy = cy + Math.sin(startAngle) * radius;
    const ex = cx + Math.cos(endAngle) * radius;
    const ey = cy + Math.sin(endAngle) * radius;
    return `M ${sx} ${sy} A ${radius} ${radius} 0 ${largeArcFlag} ${sweepFlag} ${ex} ${ey}`;
}

const POLL_MS = 3000;
const MAX_STATIONS = 14;
let pollTimer = null;
let pollSeq = 0;
let lastCenter = null;
let lastAnchors = null;
let stationAngle = new Map();
let vacatedAngles = [];

function stopIpcOrbit() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    pollSeq += 1;
}

function drawIpcRelationshipRing(centerX, centerY, processAnchorsByName) {
    stopIpcOrbit();
    stationAngle = new Map();
    vacatedAngles = [];
    lastCenter = { x: centerX, y: centerY };
    lastAnchors = processAnchorsByName;
    d3.selectAll('.ipc-ring-layer').remove();
    const seq = ++pollSeq;
    fetchIpcAndPaint(centerX, centerY, processAnchorsByName, false, seq);
    pollTimer = setInterval(() => {
        if (document.hidden || !lastCenter) return;
        fetchIpcAndPaint(lastCenter.x, lastCenter.y, lastAnchors, true, pollSeq);
    }, POLL_MS);
}

function fetchIpcAndPaint(centerX, centerY, processAnchorsByName, live, seq) {
    fetch('/api/ipc-links?max_nodes=18&max_pairs=120')
        .then(res => {
            if (!res.ok) {
                throw new Error(`IPC API HTTP ${res.status}`);
            }
            return res.json();
        })
        .then(data => {
            if (seq !== pollSeq) return;
            paintIpcOrbit(data, centerX, centerY, processAnchorsByName, live);
        })
        .catch((error) => {
            if (seq !== pollSeq) return;
            console.warn('IPC ring data unavailable:', error);
            if (live) return;
            paintIpcFallback(centerX, centerY, processAnchorsByName);
        });
}

function angleForStation(name, index, total) {
    if (stationAngle.has(name)) return stationAngle.get(name);
    const reused = vacatedAngles.shift();
    const angle = reused != null
        ? reused
        : (-Math.PI / 2 + (index / Math.max(total, 1)) * Math.PI * 2);
    stationAngle.set(name, angle);
    return angle;
}

function forgetMissingStations(names) {
    const seen = new Set(names);
    stationAngle.forEach((angle, name) => {
        if (!seen.has(name)) {
            stationAngle.delete(name);
            vacatedAngles.push(angle);
        }
    });
}

function orbitTranslate(cx, cy, radius, angle) {
    return `translate(${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius})`;
}

// First paint: start as a tight cluster at 12 o'clock, then slide apart
// along the ring to even 2π/n homes. Live polls keep the home angle.
function clusterAngle(index, total) {
    if (total <= 1) return -Math.PI / 2;
    return -Math.PI / 2 + (index - (total - 1) / 2) * 0.048;
}

function paintIpcOrbit(data, centerX, centerY, processAnchorsByName, live) {
            const ringCx = centerX;
            const ringCy = centerY;
            // Place IPC ring around the process circle (outside process endpoints).
            const ringR = 355;

            let ringGroup = svg.select('.ipc-ring-layer');
            const hasRails = !ringGroup.empty() && !ringGroup.select('.ipc-orbit-rail').empty();
            if (!live || !hasRails) {
                d3.selectAll('.ipc-ring-layer').remove();
                ringGroup = svg.append('g').attr('class', 'ipc-ring-layer');
                IPC_CHANNELS.forEach((channel, idx) => {
                    const radius = ringR + channel.radiusOffset;
                    ringGroup.append('circle')
                        .attr('class', 'ipc-orbit-rail')
                        .attr('cx', ringCx)
                        .attr('cy', ringCy)
                        .attr('r', radius)
                        .attr('fill', 'none')
                        .attr('stroke', channel.color)
                        .attr('stroke-width', idx === 2 ? 1.05 : 0.75)
                        .attr('stroke-dasharray', channel.dash)
                        .attr('opacity', 0.46);

                    ringGroup.append('text')
                        .attr('class', 'ipc-orbit-rail')
                        .attr('x', ringCx + radius + 8)
                        .attr('y', ringCy - 3 + idx * 9)
                        .style('font-family', 'Share Tech Mono, monospace')
                        .style('font-size', '7px')
                        .style('letter-spacing', '0.8px')
                        .style('fill', channel.color)
                        .text(channel.label);
                });
            }

            ringGroup.select('.ipc-orbit-live').remove();
            d3.selectAll('.ipc-link-tooltip').remove();
            const liveGroup = ringGroup.append('g').attr('class', 'ipc-orbit-live');

            if (!data || data.error) {
                console.warn('IPC API payload error:', data && data.error);
            }

            let nodes = ((data && data.process_nodes) || []).slice(0, MAX_STATIONS);
            // Fallback: if IPC endpoint is empty/unavailable on host, still render ring nodes from process anchors.
            if (!nodes.length) {
                const fallbackNames = Array.from(processAnchorsByName.keys()).slice(0, 14);
                nodes = fallbackNames.map((nm) => ({
                    name: nm,
                    degree: 1,
                    socket_degree: 0,
                    unix_socket_degree: 0,
                    tcp_degree: 0,
                    pipe_degree: 0,
                    shm_degree: 0,
                    ns_degree: 0
                }));
            }
            if (!nodes.length) {
                return;
            }

            const stats = (data && data.stats) || {};
            liveGroup.append('text')
                .attr('x', ringCx)
                .attr('y', ringCy - ringR - 12)
                .attr('text-anchor', 'middle')
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '8px')
                .style('letter-spacing', '0.7px')
                .style('fill', 'rgba(58, 58, 58, 0.58)')
                .text(`IPC ORBIT  UNIX:${stats.shared_unix_socket_inodes || 0}  PIPE:${stats.shared_pipe_inodes || 0}  TCP:${(stats.shared_tcp_socket_inodes || 0) + (stats.local_tcp_pairs || 0)}  SHM:${stats.shared_memory_regions || 0}  PAIRS:${stats.pair_count || 0}`);

            const peerMap = new Map();
            (((data && data.pair_links) || [])).forEach((link) => {
                const left = normalizeProcName(link.left || '');
                const right = normalizeProcName(link.right || '');
                if (!left || !right) return;
                if (!peerMap.has(left)) peerMap.set(left, []);
                if (!peerMap.has(right)) peerMap.set(right, []);
                peerMap.get(left).push({
                    peer: link.right || right,
                    weight: Number(link.weight || 0),
                    socketWeight: Number(link.socket_weight || 0),
                    unixSocketWeight: Number(link.unix_socket_weight || 0),
                    tcpWeight: Number(link.tcp_weight || 0),
                    pipeWeight: Number(link.pipe_weight || 0),
                    shmWeight: Number(link.shm_weight || 0),
                    nsWeight: Number(link.ns_weight || 0)
                });
                peerMap.get(right).push({
                    peer: link.left || left,
                    weight: Number(link.weight || 0),
                    socketWeight: Number(link.socket_weight || 0),
                    unixSocketWeight: Number(link.unix_socket_weight || 0),
                    tcpWeight: Number(link.tcp_weight || 0),
                    pipeWeight: Number(link.pipe_weight || 0),
                    shmWeight: Number(link.shm_weight || 0),
                    nsWeight: Number(link.ns_weight || 0)
                });
            });
            peerMap.forEach((arr, key) => {
                arr.sort((a, b) => b.weight - a.weight);
                peerMap.set(key, arr.slice(0, 3));
            });

            const enterMotion = !live;
            const nodeCount = nodes.length;
            const pairArcLayer = liveGroup.append('g')
                .attr('class', 'ipc-pair-arc-layer');
            const maxDegree = Math.max(...nodes.map(n => Number(n.degree || 0)), 1);
            const placedNames = nodes.map((node) => normalizeProcName(node.name || '')).filter(Boolean);
            forgetMissingStations(placedNames);
            const nodePos = [];
            nodes.forEach((node, i) => {
                const normalizedName = normalizeProcName(node.name || '');
                const homeAngle = angleForStation(normalizedName, i, nodeCount);
                const fromAngle = enterMotion
                    ? (nodeCount <= 1 ? homeAngle - 0.34 : clusterAngle(i, nodeCount))
                    : homeAngle;
                const nx = ringCx + Math.cos(homeAngle) * ringR;
                const ny = ringCy + Math.sin(homeAngle) * ringR;
                const degree = Number(node.degree || 0);
                const radius = 2.8 + (degree / maxDegree) * 2.8;
                nodePos.push({
                    x: nx,
                    y: ny,
                    name: normalizedName,
                    displayName: node.name || normalizedName,
                    radius,
                    degree,
                    socketDegree: Number(node.socket_degree || 0),
                    unixSocketDegree: Number(node.unix_socket_degree || 0),
                    tcpDegree: Number(node.tcp_degree || 0),
                    pipeDegree: Number(node.pipe_degree || 0),
                    shmDegree: Number(node.shm_degree || 0),
                    nsDegree: Number(node.ns_degree || 0)
                });

                const nodeChannelRow = {
                    unixSocketDegree: Number(node.unix_socket_degree || 0),
                    tcpDegree: Number(node.tcp_degree || 0),
                    pipeDegree: Number(node.pipe_degree || 0),
                    shmDegree: Number(node.shm_degree || 0)
                };
                const nodeChannel = dominantChannel(nodeChannelRow);

                const station = liveGroup.append('g')
                    .attr('class', 'ipc-orbit-station')
                    .attr('transform', orbitTranslate(ringCx, ringCy, ringR, fromAngle));
                if (enterMotion) {
                    station.transition()
                        .delay(i * 42)
                        .duration(1180)
                        .ease(d3.easeCubicOut)
                        .attrTween('transform', () => (t) => {
                            const a = fromAngle + (homeAngle - fromAngle) * t;
                            return orbitTranslate(ringCx, ringCy, ringR, a);
                        });
                }

                station.append('circle')
                    .attr('cx', 0)
                    .attr('cy', 0)
                    .attr('r', radius)
                    .attr('fill', nodeChannel ? nodeChannel.color : 'rgba(90, 90, 90, 0.55)')
                    .attr('stroke', 'rgba(24, 24, 24, 0.5)')
                    .attr('stroke-width', 0.85)
                    .style('pointer-events', 'all')
                    .style('cursor', 'pointer')
                    .on('mouseenter', () => {
                        d3.selectAll('.ipc-link-tooltip').remove();
                        const peers = peerMap.get(normalizedName) || [];
                        const peerText = peers.length
                            ? peers.map((p) => {
                                const channelType = getSharedChannelType(p.socketWeight, p.pipeWeight, p.shmWeight, p.nsWeight, p.unixSocketWeight, p.tcpWeight);
                                return `${p.peer}: ${p.weight} [${channelType}] (unix:${p.unixSocketWeight} pipe:${p.pipeWeight} tcp:${p.tcpWeight} shm:${p.shmWeight})`;
                            }).join('<br>')
                            : 'No peer details';
                        const tooltip = d3.select('body')
                            .append('div')
                            .attr('class', 'tooltip ipc-link-tooltip')
                            .style('position', 'absolute')
                            .style('background', 'rgba(0, 0, 0, 0.88)')
                            .style('color', '#fff')
                            .style('padding', '8px 10px')
                            .style('border-radius', '4px')
                            .style('font-size', '11px')
                            .style('font-family', 'Share Tech Mono, monospace')
                            .style('pointer-events', 'none')
                            .style('z-index', '1200')
                            .style('left', `${nx + 10}px`)
                            .style('top', `${ny - 14}px`)
                            .html(`<strong>${node.name || normalizedName}</strong><br>Links: ${degree}<br>UNIX: ${Number(node.unix_socket_degree || 0)} | PIPE: ${Number(node.pipe_degree || 0)} | TCP: ${Number(node.tcp_degree || 0)} | SHM: ${Number(node.shm_degree || 0)}<br><hr style="border-color:#555;margin:4px 0;">${peerText}`);
                        if (typeof window.placeHoverPopup === 'function') {
                            window.placeHoverPopup(tooltip, nx, ny, { gap: 10, maxWidth: 420 });
                        }
                    })
                    .on('mouseleave', () => {
                        d3.selectAll('.ipc-link-tooltip').remove();
                    })
                    .on('click', (event) => {
                        event.stopPropagation();
                        d3.selectAll('.ipc-link-tooltip').remove();
                        const matches = (processAnchorsByName && processAnchorsByName.get(normalizedName)) || [];
                        const hintPid = matches[0] && matches[0].pid;
                        if (typeof window.openProcessDossier === "function") {
                            window.openProcessDossier({
                                pid: hintPid,
                                name: node.name || normalizedName
                            });
                        }
                    });

                IPC_CHANNELS.forEach((channel, channelIdx) => {
                    const active = Number(nodeChannelRow[channel.degreeKey] || 0) > 0;
                    const dotAngle = homeAngle - 0.18 + channelIdx * 0.12;
                    const dotRadius = radius + 8.5;
                    station.append('circle')
                        .attr('cx', Math.cos(dotAngle) * dotRadius)
                        .attr('cy', Math.sin(dotAngle) * dotRadius)
                        .attr('r', active ? 1.9 : 1.05)
                        .attr('fill', active ? channel.color : 'rgba(92, 92, 92, 0.20)')
                        .attr('stroke', active ? 'rgba(18,18,18,0.35)' : 'none')
                        .attr('stroke-width', 0.45)
                        .style('pointer-events', 'none');
                });

                if (i < 10) {
                    const label = String(node.name || normalizedName);
                    station.append('text')
                        .attr('x', Math.cos(homeAngle) * 11)
                        .attr('y', Math.sin(homeAngle) * 11)
                        .attr('text-anchor', Math.cos(homeAngle) >= 0 ? 'start' : 'end')
                        .attr('dominant-baseline', 'middle')
                        .style('font-family', 'Share Tech Mono, monospace')
                        .style('font-size', '7px')
                        .style('fill', 'rgba(62, 62, 62, 0.58)')
                        .text(label.length > 12 ? `${label.slice(0, 11)}~` : label);
                }
            });

            const nodeByName = new Map(nodePos.map((node) => [node.name, node]));
            let pairArcCount = 0;
            (((data && data.pair_links) || [])).forEach((link) => {
                if (pairArcCount > 90) return;
                const leftNode = nodeByName.get(normalizeProcName(link.left || ''));
                const rightNode = nodeByName.get(normalizeProcName(link.right || ''));
                if (!leftNode || !rightNode) return;
                const startAngle = Math.atan2(leftNode.y - ringCy, leftNode.x - ringCx);
                const endAngle = Math.atan2(rightNode.y - ringCy, rightNode.x - ringCx);
                const sameStation = leftNode === rightNode;
                const linkWeights = {
                    unixSocketWeight: Number(link.unix_socket_weight || 0),
                    pipeWeight: Number(link.pipe_weight || 0),
                    tcpWeight: Number(link.tcp_weight || 0),
                    shmWeight: Number(link.shm_weight || 0)
                };
                IPC_CHANNELS.forEach((channel) => {
                    const weight = channelWeight(linkWeights, channel);
                    if (weight <= 0 || pairArcCount > 90) return;
                    const radius = ringR + channel.radiusOffset;
                    // Two processes of the same name share a channel: a short
                    // bump on the ring, not an arc from a station to itself.
                    const arc = sameStation
                        ? buildChannelArc(ringCx, ringCy, startAngle - 0.14, startAngle + 0.14, radius)
                        : buildChannelArc(ringCx, ringCy, startAngle, endAngle, radius);
                    const destOpacity = channel.key === 'shm' ? 0.38 : 0.5;
                    const arcPath = pairArcLayer.append('path')
                        .attr('d', arc)
                        .attr('fill', 'none')
                        .attr('stroke', channel.color)
                        .attr('stroke-width', Math.min(2.1, 0.65 + weight * 0.18))
                        .attr('stroke-dasharray', channel.dash)
                        .attr('stroke-linecap', 'round')
                        .attr('opacity', enterMotion ? 0 : destOpacity)
                        .style('pointer-events', 'none');
                    if (enterMotion) {
                        arcPath.transition()
                            .delay(880)
                            .duration(420)
                            .attr('opacity', destOpacity);
                    }
                    pairArcCount += 1;
                });
            });

            let linkOrdinal = 0;
            const laneOffsets = [-26, -14, 14, 26, -20, 20];
            nodePos.forEach((ipcNode) => {
                const matches = processAnchorsByName.get(ipcNode.name) || [];
                if (!matches.length) return;
                const maxLinks = Math.min(3, matches.length);
                for (let i = 0; i < maxLinks; i++) {
                    const procAnchor = matches[i];
                    const laneOffset = laneOffsets[linkOrdinal % laneOffsets.length];
                    const routedPath = buildIpcRoutedPath(
                        centerX,
                        centerY,
                        procAnchor.x,
                        procAnchor.y,
                        ipcNode.x,
                        ipcNode.y,
                        ringR,
                        laneOffset
                    );
                    const spoke = liveGroup.append('path')
                        .attr('d', routedPath)
                        .attr('fill', 'none')
                        .attr('stroke', 'rgba(78, 78, 78, 0.22)')
                        .attr('stroke-width', 0.7)
                        .attr('stroke-linecap', 'round')
                        .attr('opacity', enterMotion ? 0 : 1)
                        .style('pointer-events', 'none');
                    if (enterMotion) {
                        spoke.transition()
                            .delay(880)
                            .duration(420)
                            .attr('opacity', 1);
                    }
                    linkOrdinal += 1;
                }
            });
}

function paintIpcFallback(centerX, centerY, processAnchorsByName) {
            const fallbackNames = Array.from(processAnchorsByName.keys()).slice(0, MAX_STATIONS);
            if (!fallbackNames.length) return;
            const ringGroup = svg.append('g')
                .attr('class', 'ipc-ring-layer');
            const ringCx = centerX;
            const ringCy = centerY;
            const ringR = 355;
            ringGroup.append('circle')
                .attr('cx', ringCx)
                .attr('cy', ringCy)
                .attr('r', ringR)
                .attr('fill', 'none')
                .attr('stroke', 'rgba(70, 70, 70, 0.26)')
                .attr('stroke-width', 0.9);
            fallbackNames.forEach((name, i) => {
                const t = i / fallbackNames.length;
                const angle = -Math.PI / 2 + t * (Math.PI * 2);
                const nx = ringCx + Math.cos(angle) * ringR;
                const ny = ringCy + Math.sin(angle) * ringR;
                ringGroup.append('circle')
                    .attr('cx', nx)
                    .attr('cy', ny)
                    .attr('r', 2.8)
                    .attr('fill', 'rgba(90, 90, 90, 0.5)')
                    .attr('stroke', 'rgba(34, 34, 34, 0.3)')
                    .attr('stroke-width', 0.7);
                ringGroup.append('text')
                    .attr('x', nx + Math.cos(angle) * 10)
                    .attr('y', ny + Math.sin(angle) * 10)
                    .attr('text-anchor', Math.cos(angle) >= 0 ? 'start' : 'end')
                    .attr('dominant-baseline', 'middle')
                    .style('font-family', 'Share Tech Mono, monospace')
                    .style('font-size', '7px')
                    .style('fill', 'rgba(62, 62, 62, 0.58)')
                    .text(name.length > 12 ? `${name.slice(0, 11)}~` : name);
            });
}

function buildIpcRoutedPath(cx, cy, startX, startY, targetX, targetY, outerRingRadius, laneOffset = 0) {
    const startAngle = Math.atan2(startY - cy, startX - cx);
    const targetAngle = Math.atan2(targetY - cy, targetX - cx);
    const startRadius = Math.hypot(startX - cx, startY - cy);
    const midBase = startRadius + (outerRingRadius - startRadius) * 0.5;
    const minR = startRadius + 18;
    const maxR = outerRingRadius - 18;
    const midRadius = Math.max(minR, Math.min(maxR, midBase + laneOffset));

    const bendX = cx + Math.cos(startAngle) * midRadius;
    const bendY = cy + Math.sin(startAngle) * midRadius;
    const arcEndX = cx + Math.cos(targetAngle) * midRadius;
    const arcEndY = cy + Math.sin(targetAngle) * midRadius;

    let delta = targetAngle - startAngle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const largeArcFlag = Math.abs(delta) > Math.PI ? 1 : 0;
    const sweepFlag = delta >= 0 ? 1 : 0;

    return `M ${startX} ${startY}
            L ${bendX} ${bendY}
            A ${midRadius} ${midRadius} 0 ${largeArcFlag} ${sweepFlag} ${arcEndX} ${arcEndY}
            L ${targetX} ${targetY}`;
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden || !lastCenter || !pollTimer) return;
    fetchIpcAndPaint(lastCenter.x, lastCenter.y, lastAnchors, true, pollSeq);
});

window.IpcUI = {
    normalizeProcName,
    getSharedChannelType,
    drawIpcRelationshipRing,
    stopIpcOrbit,
    buildIpcRoutedPath
};
})();
