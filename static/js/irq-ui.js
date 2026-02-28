// IRQ UI module extracted from main.js
(function initIrqUI(){
function renderIrqStackPanel(executionData) {
    d3.selectAll('.irq-stack-group').remove();
    d3.selectAll('.irq-route-overlay').remove();
    if (isMobileLayout()) return;

    const irqStack = executionData && executionData.irq_stack ? executionData.irq_stack : {};
    const hardRows = Array.isArray(irqStack.hard) ? irqStack.hard : [];
    const softRows = Array.isArray(irqStack.soft) ? irqStack.soft : [];
    const summary = irqStack.summary || {};

    const svg = d3.select('svg');
    // Reuse former "CGROUP PROFILE" slot (left-bottom corner).
    const panelX = 30;
    const panelY = Math.max(20, window.innerHeight - 230);
    const panelW = 230;
    const rowH = 18;
    const maxHard = 4;
    const maxSoft = 2;
    const shownHard = hardRows.slice(0, maxHard);
    const shownSoft = softRows.slice(0, maxSoft);
    const panelH = 24 + (shownHard.length + shownSoft.length + 2) * rowH + 16;

    const group = svg.append('g')
        .attr('class', 'irq-stack-group');

    group.append('rect')
        .attr('x', panelX)
        .attr('y', panelY - 6)
        .attr('width', panelW)
        .attr('height', panelH)
        .attr('rx', 8)
        .style('fill', '#333')
        .style('stroke', '#555')
        .style('stroke-width', '1px');

    group.append('text')
        .attr('x', panelX + 10)
        .attr('y', panelY + 8)
        .style('font-family', 'Share Tech Mono, monospace')
        .style('font-size', '10px')
        .style('letter-spacing', '0.5px')
        .style('fill', '#c8ccd4')
        .text('IRQ STACK (HARD + SOFT)');

    let y = panelY + 24;
    shownHard.forEach((row) => {
        const irqName = String(row.irq || '?');
        const labelRaw = String(row.label || irqName);
        const label = labelRaw.length > 14 ? `${labelRaw.slice(0, 13)}~` : labelRaw;
        const perSec = Number(row.per_sec || 0).toFixed(1);
        const cpu = row.top_cpu === null || row.top_cpu === undefined ? '-' : row.top_cpu;
        const rowGroup = group.append('g')
            .style('cursor', 'pointer')
            .on('mouseenter', () => {
                window.__irqRouteMapHover = false;
                drawIrqRouteOverlay(row, panelX + 10, y - 4);
            })
            .on('mouseleave', () => {
                // Give enough time to move cursor from IRQ row to the route map.
                setTimeout(() => {
                    if (!window.__irqRouteMapHover) {
                        d3.selectAll('.irq-route-overlay').remove();
                    }
                }, 1200);
            });

        rowGroup.append('rect')
            .attr('x', panelX + 6)
            .attr('y', y - 11)
            .attr('width', panelW - 14)
            .attr('height', 13)
            .attr('rx', 3)
            .attr('fill', 'rgba(70,70,70,0.22)');

        rowGroup.append('text')
            .attr('x', panelX + 10)
            .attr('y', y)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '9px')
            .style('fill', '#c8ccd4')
            .text(`IRQ${irqName} ${label} C${cpu} ${perSec}/s`);
        y += rowH;
    });

    group.append('line')
        .attr('x1', panelX + 8)
        .attr('x2', panelX + panelW - 8)
        .attr('y1', y - 8)
        .attr('y2', y - 8)
        .attr('stroke', 'rgba(120,120,120,0.45)')
        .attr('stroke-width', 0.8);

    shownSoft.forEach((row) => {
        const name = String(row.name || 'SOFT').toUpperCase();
        const perSec = Number(row.per_sec || 0).toFixed(1);
        group.append('text')
            .attr('x', panelX + 10)
            .attr('y', y)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '9px')
            .style('fill', '#b6c7d8')
            .text(`S:${name} ${perSec}/s`);
        y += rowH;
    });

    const hardRate = Number(summary.hard_total_per_sec || 0).toFixed(1);
    const softRate = Number(summary.soft_total_per_sec || 0).toFixed(1);
    const netRate = Number(summary.net_softirq_per_sec || 0).toFixed(1);
    group.append('text')
        .attr('x', panelX + 10)
        .attr('y', panelY + panelH - 10)
        .style('font-family', 'Share Tech Mono, monospace')
        .style('font-size', '9px')
        .style('fill', '#9ea9b6')
        .text(`H:${hardRate}/s  S:${softRate}/s  NET:${netRate}/s`);
}

function getIrqRouteHint(row) {
    const label = String(row && row.label ? row.label : '').toLowerCase();
    const subsystem = String(row && row.subsystem ? row.subsystem : '').toLowerCase();
    if (label.includes('eth') || label.includes('net') || label.includes('wifi') || subsystem.includes('net')) {
        return {
            profile: 'NET',
            soft: 'NET_RX',
            kernel: 'network stack',
            process: 'socket activity'
        };
    }
    if (label.includes('nvme') || label.includes('ahci') || label.includes('scsi') || label.includes('blk')) {
        return {
            profile: 'BLOCK',
            soft: 'BLOCK',
            kernel: 'block layer',
            process: 'read/write wakeup'
        };
    }
    if (label.includes('timer') || label.includes('sched') || subsystem.includes('timer') || subsystem.includes('sched')) {
        return {
            profile: 'TIMER',
            soft: 'TIMER',
            kernel: 'scheduler/timer',
            process: 'task wakeup'
        };
    }
    return {
        profile: 'GENERIC',
        soft: 'IRQ_THREAD',
        kernel: 'driver/core',
        process: 'syscall/io path'
    };
}

function normalizeProcessLabel(name) {
    if (!name) return '';
    const raw = String(name).trim();
    if (!raw) return '';
    const base = raw.split(':')[0].trim();
    return base || raw;
}

function inferProcessFromConnections(profile) {
    const manager = window.connectionsManager;
    if (!manager || typeof manager.getCurrentConnections !== 'function') return '';
    const connections = manager.getCurrentConnections() || [];
    const preferredPortsByProfile = {
        NET: { '80': 'nginx', '443': 'nginx', '8080': 'nginx', '3000': 'node', '8000': 'python', '9000': 'php-fpm' },
        BLOCK: { '5432': 'postgres', '3306': 'mysql', '27017': 'mongod', '6379': 'redis' },
        TIMER: { '123': 'chronyd' },
        GENERIC: {}
    };
    const map = preferredPortsByProfile[profile] || preferredPortsByProfile.GENERIC;

    for (let i = 0; i < connections.length; i += 1) {
        const local = String(connections[i].local || '');
        const idx = local.lastIndexOf(':');
        if (idx === -1) continue;
        const port = local.slice(idx + 1);
        if (map[port]) return map[port];
    }
    return '';
}

function getIrqWakeTarget(hint) {
    const fromHighlight = normalizeProcessLabel(
        window.__highlightedProcessName ||
        (window.__highlightedProcess && window.__highlightedProcess.name)
    );
    const fromConnections = inferProcessFromConnections(hint.profile);

    const defaults = {
        NET: 'nginx',
        BLOCK: 'postgres',
        TIMER: 'systemd',
        GENERIC: 'userspace'
    };

    if (fromHighlight) return fromHighlight;
    if (fromConnections) return fromConnections;
    return defaults[hint.profile] || defaults.GENERIC;
}

function getIrqWakeTargetMeta(wakeTarget) {
    const highlighted = window.__highlightedProcess || null;
    if (!highlighted) return null;
    const highlightedName = normalizeProcessLabel(highlighted.name || '').toLowerCase();
    const targetName = normalizeProcessLabel(wakeTarget || '').toLowerCase();
    if (targetName && highlightedName && targetName !== highlightedName) {
        return null;
    }
    return highlighted;
}

function getIrqStepContext(profile, stepLabel, hint, row, wakeTarget, rate) {
    const label = String(stepLabel || '').toLowerCase();
    const cpu = row && row.top_cpu !== undefined && row.top_cpu !== null ? `CPU${row.top_cpu}` : 'CPU-';
    const latencyHint = rate > 180 ? 'latency sensitive' : rate > 90 ? 'active path' : 'normal load';

    if (profile === 'NET') {
        if (label.includes('tcp')) {
            return { title: 'NET/TCP', line1: `softirq: ${hint.soft}`, line2: 'skb parse + protocol dispatch', line3: `${cpu} | ${latencyHint}` };
        }
        if (label.includes('wake_up')) {
            return { title: 'WAKE QUEUE', line1: 'socket waitqueue signal', line2: 'wake_up_interruptible()', line3: `${cpu} | ${latencyHint}` };
        }
        if (label.includes('epoll')) {
            return { title: 'EPOLL', line1: 'ep_poll_callback', line2: 'fd ready event fanout', line3: `${cpu} | ${latencyHint}` };
        }
        return { title: 'NET EFFECT', line1: `${wakeTarget} runnable`, line2: 'userspace event loop resume', line3: `${cpu} | ${latencyHint}` };
    }

    if (profile === 'BLOCK') {
        if (label.includes('bio')) {
            return { title: 'BLOCK COMPLETE', line1: 'bio completion callback', line2: 'blk-mq request done', line3: `${cpu} | io completion` };
        }
        if (label.includes('io_uring')) {
            return { title: 'IO_URING CQ', line1: 'completion queue publish', line2: 'submitter wake condition', line3: `${cpu} | ${latencyHint}` };
        }
        return { title: 'PROCESS WAKE', line1: `${wakeTarget} unblocked`, line2: 'read/write request finished', line3: `${cpu} | queue drained` };
    }

    if (profile === 'TIMER') {
        if (label.includes('hrtimer')) {
            return { title: 'HRTIMER', line1: 'high-res timer interrupt', line2: 'tick handler dispatch', line3: `${cpu} | periodic pulse` };
        }
        if (label.includes('scheduler')) {
            return { title: 'SCHED', line1: 'scheduler tick accounting', line2: 'timeslice / vruntime update', line3: `${cpu} | ${latencyHint}` };
        }
        return { title: 'RUNQUEUE', line1: `${wakeTarget} enqueue`, line2: 'task marked runnable', line3: `${cpu} | wake candidate` };
    }

    return { title: 'IRQ STEP', line1: stepLabel, line2: `softirq: ${hint.soft}`, line3: `${cpu} | ${latencyHint}` };
}

function drawIrqRouteOverlay(row, startX, startY) {
    d3.selectAll('.irq-route-overlay').remove();
    const svg = d3.select('svg');
    const overlay = svg.append('g').attr('class', 'irq-route-overlay');
    const width = window.innerWidth;
    const height = window.innerHeight;
    const hint = getIrqRouteHint(row);
    const irqLabel = String(row && row.irq ? row.irq : '?');
    const routeLabel = String(row && row.label ? row.label : '').trim();
    const wakeTarget = getIrqWakeTarget(hint);
    const wakeMeta = getIrqWakeTargetMeta(wakeTarget);
    const processStageLabel = hint.profile === 'GENERIC' ? hint.process : `${wakeTarget} wake`;
    const rate = Number(row && row.per_sec ? row.per_sec : 0);
    const intensity = Math.max(0.35, Math.min(1, rate / 220));

    const profileColors = {
        NET: 'rgba(103, 190, 224, 0.95)',
        BLOCK: 'rgba(224, 175, 98, 0.95)',
        TIMER: 'rgba(167, 200, 120, 0.95)',
        GENERIC: 'rgba(186, 194, 204, 0.92)'
    };
    const profileColor = profileColors[hint.profile] || profileColors.GENERIC;

    const mapX = Math.max(22, Math.min(width * 0.16, startX + 36));
    const mapH = 128;
    const mapY = Math.max(12, height - (mapH + 46));
    const mapW = Math.min(760, width - mapX - 20);
    const contextCardW = 182;
    const contextCardH = 56;
    const routeRightPadding = 18;
    const routeEndX = mapX + mapW - routeRightPadding;

    overlay.append('rect')
        .attr('x', mapX)
        .attr('y', mapY)
        .attr('width', mapW)
        .attr('height', mapH)
        .attr('rx', 8)
        .attr('fill', 'rgba(11, 14, 18, 0.9)')
        .attr('stroke', 'rgba(82, 92, 108, 0.42)')
        .attr('stroke-width', 0.9);

    const detailLayer = overlay.append('g')
        .attr('class', 'irq-route-detail')
        .style('opacity', 0.72);

    // Hover target for fading detailed layer to full opacity.
    overlay.append('rect')
        .attr('x', mapX)
        .attr('y', mapY)
        .attr('width', mapW)
        .attr('height', mapH)
        .attr('rx', 8)
        .attr('fill', 'transparent')
        .style('pointer-events', 'all')
        .on('mouseenter', () => {
            window.__irqRouteMapHover = true;
            detailLayer.transition().duration(120).style('opacity', 1);
        })
        .on('mouseleave', () => {
            window.__irqRouteMapHover = false;
            d3.selectAll('.irq-route-overlay').remove();
        });

    const flowYOffset = 24;
    const p0 = { x: mapX + 26, y: mapY + 38 + flowYOffset };
    const p1 = { x: mapX + Math.min(130, mapW * 0.22), y: mapY + 38 + flowYOffset };
    const p2 = { x: p1.x, y: mapY + 74 + flowYOffset };
    const p3 = { x: mapX + Math.min(300, mapW * 0.5), y: mapY + 74 + flowYOffset };
    const p4 = { x: p3.x, y: mapY + 48 + flowYOffset };
    const p5 = { x: Math.min(routeEndX - contextCardW - 36, mapX + Math.min(500, mapW * 0.72)), y: mapY + 48 + flowYOffset };
    const p6 = { x: p5.x, y: mapY + 74 + flowYOffset };
    const p7 = { x: routeEndX, y: mapY + 74 + flowYOffset };

    overlay.append('path')
        .attr('d', `M ${startX} ${startY} Q ${mapX - 24} ${mapY - 8} ${p0.x} ${p0.y}`)
        .attr('fill', 'none')
        .attr('stroke', 'rgba(118, 136, 155, 0.5)')
        .attr('stroke-width', 0.9)
        .attr('stroke-dasharray', '2 3');

    // Compact route line (always visible) + detailed metro line below.
    overlay.append('rect')
        .attr('x', mapX + 10)
        .attr('y', mapY + 6)
        .attr('width', mapW - 20)
        .attr('height', 16)
        .attr('rx', 4)
        .attr('fill', 'rgba(16, 20, 25, 0.9)')
        .attr('stroke', 'rgba(74, 88, 106, 0.45)')
        .attr('stroke-width', 0.6);

    overlay.append('text')
        .attr('x', mapX + 14)
        .attr('y', mapY + 17)
        .style('font-family', 'Share Tech Mono, monospace')
        .style('font-size', '8px')
        .style('letter-spacing', '0.35px')
        .style('fill', 'rgba(198, 215, 228, 0.92)')
        .text(`IRQ ${irqLabel} -> ${hint.soft} -> ${hint.kernel} -> ${processStageLabel}`);

    const metroPath = `M ${p0.x} ${p0.y}
        L ${p1.x} ${p1.y}
        L ${p2.x} ${p2.y}
        L ${p3.x} ${p3.y}
        L ${p4.x} ${p4.y}
        L ${p5.x} ${p5.y}
        L ${p6.x} ${p6.y}
        L ${p7.x} ${p7.y}`;

    detailLayer.append('path')
        .attr('d', metroPath)
        .attr('fill', 'none')
        .attr('stroke', 'rgba(35, 40, 48, 0.95)')
        .attr('stroke-width', 4.2 + intensity * 0.7)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round');

    detailLayer.append('path')
        .attr('d', metroPath)
        .attr('fill', 'none')
        .attr('stroke', profileColor)
        .attr('stroke-width', 1.9 + intensity * 1.1)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round');

    const drawBranch = (path, color, label, lx, ly) => {
        detailLayer.append('path')
            .attr('d', path)
            .attr('fill', 'none')
            .attr('stroke', 'rgba(35, 40, 48, 0.94)')
            .attr('stroke-width', 3.2)
            .attr('stroke-linecap', 'round')
            .attr('stroke-linejoin', 'round');

        detailLayer.append('path')
            .attr('d', path)
            .attr('fill', 'none')
            .attr('stroke', color)
            .attr('stroke-width', 1.5 + intensity * 0.9)
            .attr('stroke-linecap', 'round')
            .attr('stroke-linejoin', 'round');

        detailLayer.append('text')
            .attr('x', lx)
            .attr('y', ly)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '7px')
            .style('fill', 'rgba(182, 198, 212, 0.85)')
            .text(label);
    };

    const connectorUpLen = 14;
    const connectorHorizontalLen = contextCardW;
    const connectorVerticalLen = contextCardH;
    const connectorY = p7.y - connectorUpLen;
    const connectorLeftX = p7.x - connectorHorizontalLen;
    const contextCardX = connectorLeftX;
    const contextCardY = connectorY - contextCardH;
    const contextCard = overlay.append('g')
        .attr('class', 'irq-inline-context');

    contextCard.append('rect')
        .attr('x', contextCardX)
        .attr('y', contextCardY)
        .attr('width', contextCardW)
        .attr('height', contextCardH)
        .attr('rx', 5)
        .attr('fill', 'rgba(12, 16, 20, 0.94)')
        .attr('stroke', 'rgba(116, 165, 192, 0.5)')
        .attr('stroke-width', 0.8);

    // Reference-like connector: up -> left (tooltip width) -> up (tooltip height).
    const tooltipConnectorPath = `M ${p7.x} ${p7.y}
        L ${p7.x} ${connectorY}
        L ${connectorLeftX} ${connectorY}
        L ${connectorLeftX} ${connectorY - connectorVerticalLen}`;

    detailLayer.append('path')
        .attr('d', tooltipConnectorPath)
        .attr('fill', 'none')
        .attr('stroke', 'rgba(35, 40, 48, 0.94)')
        .attr('stroke-width', 4.2 + intensity * 0.7)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round');

    detailLayer.append('path')
        .attr('d', tooltipConnectorPath)
        .attr('fill', 'none')
        .attr('stroke', profileColor)
        .attr('stroke-width', 1.9 + intensity * 1.1)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round');

    const renderInlineContext = (ctx) => {
        contextCard.selectAll('.irq-inline-context-text').remove();
        const title = ctx && ctx.title ? ctx.title : 'IRQ CONTEXT';
        const line1 = ctx && ctx.line1 ? ctx.line1 : '';
        const line2 = ctx && ctx.line2 ? ctx.line2 : '';
        const line3 = ctx && ctx.line3 ? ctx.line3 : '';

        contextCard.append('text')
            .attr('class', 'irq-inline-context-text')
            .attr('x', contextCardX + 8)
            .attr('y', contextCardY + 11)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '7px')
            .style('fill', 'rgba(194, 214, 228, 0.93)')
            .text(title);

        contextCard.append('text')
            .attr('class', 'irq-inline-context-text')
            .attr('x', contextCardX + 8)
            .attr('y', contextCardY + 24)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '6.6px')
            .style('fill', 'rgba(178, 195, 209, 0.86)')
            .text(line1);

        contextCard.append('text')
            .attr('class', 'irq-inline-context-text')
            .attr('x', contextCardX + 8)
            .attr('y', contextCardY + 35)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '6.6px')
            .style('fill', 'rgba(178, 195, 209, 0.84)')
            .text(line2);

        contextCard.append('text')
            .attr('class', 'irq-inline-context-text')
            .attr('x', contextCardX + 8)
            .attr('y', contextCardY + 46)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '6.4px')
            .style('fill', 'rgba(162, 184, 202, 0.8)')
            .text(line3);
    };

    const showStepContextInCard = (label) => {
        renderInlineContext(getIrqStepContext(hint.profile, label, hint, row, wakeTarget, rate));
    };

    const showWakeContextInCard = () => {
        const pid = wakeMeta && wakeMeta.pid !== undefined ? wakeMeta.pid : '-';
        const rss = wakeMeta && wakeMeta.memory_mb !== undefined && wakeMeta.memory_mb !== null
            ? `${Number(wakeMeta.memory_mb).toFixed(1)} MB`
            : '-';
        const fds = wakeMeta && wakeMeta.num_fds !== undefined && wakeMeta.num_fds !== null
            ? String(wakeMeta.num_fds)
            : '-';
        renderInlineContext({
            title: `TARGET: ${wakeTarget}`,
            line1: `PID: ${pid}   RSS: ${rss}`,
            line2: `FDs: ${fds}`,
            line3: `${hint.soft} -> ${hint.kernel}`
        });
    };

    const drawFlowSequence = (x, y, labels, color, dx, dy) => {
        const points = labels.map((_, i) => ({
            x: x + i * dx,
            y: y + i * dy
        }));
        const pathData = points.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ');

        detailLayer.append('path')
            .attr('d', pathData)
            .attr('fill', 'none')
            .attr('stroke', 'rgba(35, 40, 48, 0.94)')
            .attr('stroke-width', 3.4)
            .attr('stroke-linecap', 'round')
            .attr('stroke-linejoin', 'round');

        detailLayer.append('path')
            .attr('d', pathData)
            .attr('fill', 'none')
            .attr('stroke', color)
            .attr('stroke-width', 1.55 + intensity * 0.95)
            .attr('stroke-linecap', 'round')
            .attr('stroke-linejoin', 'round');

        points.forEach((pt, i) => {
            detailLayer.append('circle')
                .attr('cx', pt.x)
                .attr('cy', pt.y)
                .attr('r', 2.8)
                .attr('fill', 'rgba(11, 14, 18, 0.96)')
                .attr('stroke', color)
                .attr('stroke-width', 1.1);

            detailLayer.append('text')
                .attr('x', pt.x + 5)
                .attr('y', pt.y - 4)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '6.6px')
                .style('letter-spacing', '0.2px')
                .style('fill', 'rgba(188, 204, 218, 0.86)')
                .text(labels[i]);

            detailLayer.append('circle')
                .attr('cx', pt.x)
                .attr('cy', pt.y)
                .attr('r', 8)
                .attr('fill', 'transparent')
                .style('pointer-events', 'all')
                .on('mouseenter', () => {
                    window.__irqRouteMapHover = true;
                    detailLayer.transition().duration(90).style('opacity', 1);
                    showStepContextInCard(labels[i]);
                });
        });
    };

    if (hint.profile === 'NET') {
        // Requested: IRQ -> NET_RX -> TCP -> wake_up_interruptible -> epoll -> nginx wake.
        drawFlowSequence(
            p2.x + 14,
            p2.y + 14,
            ['TCP', 'wake_up_interruptible', 'epoll_wait', `${wakeTarget} wake`],
            'rgba(103, 190, 224, 0.92)',
            66,
            0
        );
        const n1 = `M ${p4.x} ${p4.y} L ${p4.x + 52} ${p4.y - 16} L ${p4.x + 120} ${p4.y - 16}`;
        drawBranch(n1, 'rgba(103, 190, 224, 0.9)', 'socket/epoll wake', p4.x + 58, p4.y - 22);
    } else if (hint.profile === 'BLOCK') {
        drawFlowSequence(
            p3.x + 14,
            p3.y + 16,
            ['bio_complete', 'io_uring/cq', 'wake_up_process'],
            'rgba(224, 175, 98, 0.92)',
            66,
            0
        );
        const b1 = `M ${p3.x} ${p3.y} L ${p3.x + 50} ${p3.y + 16} L ${p3.x + 110} ${p3.y + 16}`;
        const b2 = `M ${p6.x} ${p6.y} L ${p6.x + 44} ${p6.y - 18} L ${p6.x + 102} ${p6.y - 18}`;
        drawBranch(b1, 'rgba(224, 175, 98, 0.9)', 'disk completion', p3.x + 56, p3.y + 28);
        drawBranch(b2, 'rgba(224, 175, 98, 0.9)', 'page cache wakeup', p6.x + 50, p6.y - 24);
    } else if (hint.profile === 'TIMER') {
        drawFlowSequence(
            p2.x + 18,
            p2.y + 12,
            ['hrtimer', 'scheduler tick', 'runqueue', 'task wake'],
            'rgba(167, 200, 120, 0.92)',
            58,
            0
        );
        const t1 = `M ${p2.x} ${p2.y} L ${p2.x + 54} ${p2.y - 20} L ${p2.x + 116} ${p2.y - 20}`;
        const t2 = `M ${p5.x} ${p5.y} L ${p5.x + 36} ${p5.y + 20} L ${p5.x + 98} ${p5.y + 20}`;
        drawBranch(t1, 'rgba(167, 200, 120, 0.9)', 'scheduler tick', p2.x + 60, p2.y - 26);
        drawBranch(t2, 'rgba(167, 200, 120, 0.9)', 'runqueue wakeup', p5.x + 42, p5.y + 30);
    }

    const stations = [
        { x: p0.x, y: p0.y, title: `IRQ ${irqLabel}`, detail: routeLabel || 'interrupt line', up: true },
        { x: p2.x, y: p2.y, title: hint.soft, detail: 'softirq', up: false },
        { x: p4.x, y: p4.y, title: hint.kernel, detail: 'kernel path', up: true },
        { x: p7.x, y: p7.y, title: processStageLabel, detail: 'userspace effect', up: false }
    ];

    stations.forEach((station) => {
        detailLayer.append('circle')
            .attr('cx', station.x)
            .attr('cy', station.y)
            .attr('r', 4.3)
            .attr('fill', 'rgba(10, 13, 17, 0.95)')
            .attr('stroke', 'rgba(148, 214, 238, 0.96)')
            .attr('stroke-width', 1.3);

        const textY = station.up ? station.y - 9 : station.y + 14;
        detailLayer.append('text')
            .attr('x', station.x)
            .attr('y', textY)
            .attr('text-anchor', 'middle')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '8px')
            .style('fill', 'rgba(196, 215, 228, 0.95)')
            .text(String(station.title).toUpperCase());
    });

    overlay.append('circle')
        .attr('cx', p7.x)
        .attr('cy', p7.y)
        .attr('r', 9)
        .attr('fill', 'transparent')
        .style('pointer-events', 'all')
        .on('mouseenter', () => {
            window.__irqRouteMapHover = true;
            detailLayer.transition().duration(90).style('opacity', 1);
            showWakeContextInCard();
        });

    // Show context immediately with the map (no focus transfer required).
    showWakeContextInCard();

    overlay.append('text')
        .attr('x', mapX + mapW - 186)
        .attr('y', mapY + 17)
        .style('font-family', 'Share Tech Mono, monospace')
        .style('font-size', '7px')
        .style('letter-spacing', '0.5px')
        .style('fill', 'rgba(140, 155, 171, 0.85)')
        .text(`IRQ ROUTE MAP  [${hint.profile}]  ${rate.toFixed(1)}/s`);
}

window.IrqUI = {
    renderIrqStackPanel,
    drawIrqRouteOverlay,
    getIrqRouteHint,
    normalizeProcessLabel,
    inferProcessFromConnections,
    getIrqWakeTarget,
    getIrqWakeTargetMeta,
    getIrqStepContext
};
})();
