// Isolation UI module extracted from main.js
(function initIsolationUI(){
const svg = d3.select("svg");
let isolationContextCache = null;
let isolationContextCacheTs = 0;
let isolationRenderToken = 0;

function fetchIsolationContext(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && isolationContextCache && (now - isolationContextCacheTs < 8000)) {
        return Promise.resolve(isolationContextCache);
    }
    return fetch('/api/isolation-context')
        .then(res => res.json())
        .then(data => {
            if (!data || data.error) {
                throw new Error(data?.error || 'No isolation data');
            }
            isolationContextCache = data;
            isolationContextCacheTs = now;
            return data;
        })
        .catch(err => {
            console.warn('Isolation context unavailable:', err.message);
            return null;
        });
}

function drawIsolationConceptLayer(centerX, centerY, width, height) {
    const mobileLayout = isMobileLayout();
    // Skip overlay in Matrix/DNA modes to keep views clean.
    if (window.kernelContextMenu && ['matrix', 'dna', 'dna-timeline'].includes(window.kernelContextMenu.currentView)) {
        return;
    }

    const renderToken = ++isolationRenderToken;
    d3.selectAll('.namespace-shell-layer, .cgroup-card-layer').remove();
    fetchIsolationContext().then((data) => {
        if (renderToken !== isolationRenderToken) return;
        if (!data) return;
        if (window.kernelContextMenu && ['matrix', 'dna', 'dna-timeline'].includes(window.kernelContextMenu.currentView)) {
            return;
        }
        drawNamespaceShell(centerX, centerY, data.namespaces || []);
        // Left-bottom slot is now reserved for IRQ stack panel.
        // Keep cgroup card disabled to avoid visual overlap/noise.
        d3.selectAll('.cgroup-card-layer').remove();
    });
}

function drawNamespaceShell(centerX, centerY, namespaces) {
    const shellGroup = svg.selectAll('.tag-icon').empty()
        ? svg.append('g').attr('class', 'namespace-shell-layer')
        : svg.insert('g', '.tag-icon').attr('class', 'namespace-shell-layer');

    const preferredOrder = ['mnt', 'pid', 'net', 'ipc', 'uts', 'user'];
    const byId = {};
    namespaces.forEach(ns => { byId[ns.id] = ns; });
    const ordered = preferredOrder.map(id => byId[id]).filter(Boolean);
    const fallback = namespaces.filter(ns => !preferredOrder.includes(ns.id));
    const namespaceSlots = [...ordered, ...fallback].slice(0, 8);

    const numSlots = 8;
    const angleStep = (2 * Math.PI) / numSlots;
    const gap = 0.04;
    // Keep enlarged scale while restoring "circle slice" geometry.
    // Center namespace slices on Icon1 orbit (r=150).
    const ringInner = 110;
    const ringOuter = 190;

    for (let i = 0; i < numSlots; i++) {
        const ns = namespaceSlots[i];
        if (!ns) continue; // keep free slots empty

        const activity = Math.max(0, Math.min(1, Number(ns.activity || 0)));
        // Center each namespace slice on the corresponding Icon1 angle.
        const centerAngle = i * angleStep;
        const startAngle = centerAngle - angleStep / 2 + gap;
        const endAngle = centerAngle + angleStep / 2 - gap;
        const arcPath = d3.arc()
            .innerRadius(ringInner)
            .outerRadius(ringOuter)
            .startAngle(startAngle)
            .endAngle(endAngle);

        const segment = shellGroup.append('path')
            .attr('d', arcPath())
            .attr('transform', `translate(${centerX}, ${centerY})`)
            .attr('fill', `rgba(60, 60, 60, ${0.07 + activity * 0.16})`)
            .attr('stroke', `rgba(90, 90, 90, ${0.5 + activity * 0.32})`)
            .attr('stroke-width', 1 + activity * 1.4)
            .style('cursor', 'help');

        const mid = (startAngle + endAngle) / 2;
        const labelR = ringOuter - 12;
        const lx = centerX + Math.cos(mid - Math.PI / 2) * labelR;
        const ly = centerY + Math.sin(mid - Math.PI / 2) * labelR;
        shellGroup.append('text')
            .attr('x', lx)
            .attr('y', ly)
            .attr('text-anchor', 'middle')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '8px')
            .style('letter-spacing', '0.5px')
            .style('fill', '#d2d6de')
            .text(ns.label || String(ns.id || 'NS').toUpperCase());

        segment
            .on('mouseenter', (event) => {
                d3.selectAll('.ns-tooltip').remove();
                d3.select('body')
                    .append('div')
                    .attr('class', 'tooltip ns-tooltip')
                    .style('opacity', 0.95)
                    .style('left', `${event.pageX + 10}px`)
                    .style('top', `${event.pageY - 10}px`)
                    .html(`
                        <strong>Namespace ${ns.label || String(ns.id || '').toUpperCase()}</strong><br>
                        <strong>Unique:</strong> ${ns.unique_count || 0}<br>
                        <strong>Dominant:</strong> ${ns.dominant_count || 0} procs<br>
                        <strong>Inode:</strong> ${ns.dominant_inode || 'n/a'}
                    `);
            })
            .on('mousemove', (event) => {
                d3.selectAll('.ns-tooltip')
                    .style('left', `${event.pageX + 10}px`)
                    .style('top', `${event.pageY - 10}px`);
            })
            .on('mouseleave', () => d3.selectAll('.ns-tooltip').remove());
    }
}

function drawCgroupConceptCard(width, height, topCgroups) {
    if (!topCgroups || topCgroups.length === 0) return;
    const cgroup = topCgroups[0];
    const cardX = 20;
    const cardY = height - 230;
    const cardW = 260;
    const cardH = 145;
    const barW = 150;

    const group = svg.append('g')
        .attr('class', 'cgroup-card-layer');

    group.append('rect')
        .attr('x', cardX)
        .attr('y', cardY)
        .attr('width', cardW)
        .attr('height', cardH)
        .attr('rx', 8)
        .style('fill', '#333')
        .style('stroke', '#555')
        .style('stroke-width', '1px')
        .style('opacity', 0.92);

    group.append('text')
        .attr('x', cardX + 10)
        .attr('y', cardY + 18)
        .style('font-family', 'Share Tech Mono, monospace')
        .style('font-size', '10px')
        .style('fill', '#d9dde4')
        .style('letter-spacing', '0.7px')
        .text('CGROUP PROFILE');

    const shortPath = (cgroup.path || '/').length > 32 ? `${cgroup.path.slice(0, 29)}...` : (cgroup.path || '/');
    group.append('text')
        .attr('x', cardX + 10)
        .attr('y', cardY + 32)
        .style('font-family', 'Share Tech Mono, monospace')
        .style('font-size', '9px')
        .style('fill', '#c8ccd4')
        .text(shortPath);

    const drawMetricRow = (label, valueText, ratio, rowIndex) => {
        const y = cardY + 48 + rowIndex * 22;
        group.append('text')
            .attr('x', cardX + 10)
            .attr('y', y)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '8.5px')
            .style('fill', '#c8ccd4')
            .text(label);

        group.append('rect')
            .attr('x', cardX + 65)
            .attr('y', y - 8)
            .attr('width', barW)
            .attr('height', 8)
            .attr('rx', 2)
            .attr('fill', 'rgba(220, 220, 220, 0.2)');

        group.append('rect')
            .attr('x', cardX + 65)
            .attr('y', y - 8)
            .attr('width', Math.max(2, barW * Math.max(0, Math.min(1, ratio))))
            .attr('height', 8)
            .attr('rx', 2)
            .attr('fill', 'rgba(88, 182, 216, 0.68)');

        group.append('text')
            .attr('x', cardX + cardW - 8)
            .attr('y', y)
            .attr('text-anchor', 'end')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '8px')
            .style('fill', '#dde2ea')
            .text(valueText);
    };

    const procRatio = Math.min(1, (Number(cgroup.process_count || 0) / 120));
    const memCurrent = Number(cgroup.memory_current_mb || cgroup.memory_mb_sum || 0);
    const memMax = Number(cgroup.memory_max_mb || 0);
    const memRatio = memMax > 0 ? Math.min(1, memCurrent / memMax) : Math.min(1, memCurrent / 4096);
    const pidsCurrent = Number(cgroup.pids_current || cgroup.process_count || 0);
    const pidsMax = Number(cgroup.pids_max || 0);
    const pidsRatio = pidsMax > 0 ? Math.min(1, pidsCurrent / pidsMax) : Math.min(1, pidsCurrent / 256);
    const ioMb = Number(cgroup.io_total_mb || 0);
    const ioRatio = Math.min(1, ioMb / 1024);

    drawMetricRow('PROC', `${cgroup.process_count || 0}`, procRatio, 0);
    drawMetricRow('MEM', `${Math.round(memCurrent)}MB`, memRatio, 1);
    drawMetricRow('PIDS', pidsMax > 0 ? `${pidsCurrent}/${pidsMax}` : `${pidsCurrent}`, pidsRatio, 2);
    drawMetricRow('IO', `${Math.round(ioMb)}MB`, ioRatio, 3);
}

window.IsolationUI = {
    fetchIsolationContext,
    drawIsolationConceptLayer,
    drawNamespaceShell,
    drawCgroupConceptCard
};
})();
