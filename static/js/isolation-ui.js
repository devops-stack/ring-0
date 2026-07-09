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
        collapseNamespaceTree(false);
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

// Short human meaning of each Linux namespace, shown in the HUD tooltip.
const NS_META = {
    mnt:    { name: 'MOUNT',  isolates: 'Mount points, filesystem tree' },
    pid:    { name: 'PID',    isolates: 'Process tree, PID isolation' },
    net:    { name: 'NET',    isolates: 'Interfaces, stack, ports, routes' },
    ipc:    { name: 'IPC',    isolates: 'System V IPC, POSIX queues' },
    uts:    { name: 'UTS',    isolates: 'Hostname and domain name' },
    user:   { name: 'USER',   isolates: 'UID/GID mapping, privileges' },
    cgroup: { name: 'CGROUP', isolates: 'Cgroup hierarchy root' },
    time:   { name: 'TIME',   isolates: 'boottime / monotonic clocks' },
};

// Kernel facets each namespace isolates (leaves of the unfolding tree).
const NS_FACETS = {
    mnt:    ['mount table', 'root filesystem', 'bind & propagation'],
    pid:    ['process tree', 'PID 1 (init)', '/proc view'],
    net:    ['interfaces', 'routes & ARP', 'sockets & ports'],
    ipc:    ['SysV shm / sem', 'POSIX mqueues'],
    uts:    ['hostname', 'domain name'],
    user:   ['UID / GID map', 'capabilities'],
    cgroup: ['cgroup root'],
    time:   ['boottime clock', 'monotonic clock'],
};

// Where the namespace pointer lives inside the kernel task struct.
const NS_KIND = {
    mnt: 'nsproxy', net: 'nsproxy', uts: 'nsproxy', ipc: 'nsproxy',
    time: 'nsproxy', cgroup: 'nsproxy', pid: 'pid struct', user: 'cred',
};

let expandedNsId = null;

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
    const gap = 0.045;
    // Center namespace slices on the Icon1 orbit (r=150).
    const ringInner = 110;
    const ringOuter = 190;

    // Ink-on-paper palette (page bg is #e6e6e6 → use dark ink for contrast).
    const INK = '58, 61, 68';
    const cells = [];

    const restoreFocus = () => {
        cells.forEach(c => {
            c.segment.attr('opacity', 1);
            c.halo.attr('opacity', 0);
        });
    };

    const setFocus = (idx) => {
        cells.forEach((c, j) => {
            const focused = j === idx;
            c.segment.attr('opacity', focused ? 1 : 0.22);
            c.halo.attr('opacity', focused ? 1 : 0);
        });
    };

    for (let i = 0; i < numSlots; i++) {
        const ns = namespaceSlots[i];
        const centerAngle = i * angleStep;
        const startAngle = centerAngle - angleStep / 2 + gap;
        const endAngle = centerAngle + angleStep / 2 - gap;
        const arcPath = d3.arc()
            .innerRadius(ringInner)
            .outerRadius(ringOuter)
            .startAngle(startAngle)
            .endAngle(endAngle)
            .cornerRadius(6);
        const dPath = arcPath();

        // Empty slot → muted "unused" placeholder so the ring reads as complete.
        if (!ns) {
            shellGroup.append('path')
                .attr('d', dPath)
                .attr('transform', `translate(${centerX}, ${centerY})`)
                .attr('fill', 'rgba(90, 92, 98, 0.03)')
                .attr('stroke', 'rgba(120, 122, 128, 0.28)')
                .attr('stroke-width', 0.8)
                .attr('stroke-dasharray', '2 4');
            continue;
        }

        const activity = Math.max(0, Math.min(1, Number(ns.activity || 0)));
        const meta = NS_META[ns.id] || {};
        const nsName = ns.label || meta.name || String(ns.id || 'NS').toUpperCase();
        // A cell with more than one distinct inode contains real isolation
        // (containers / sandboxes) — the most security-relevant signal.
        const isolated = !!ns.isolated || Number(ns.unique_count || 0) > 1;
        const ACCENT = '88, 182, 216';
        const kind = NS_KIND[ns.id] || 'nsproxy';

        // Soft focus halo behind the segment (hidden until hover).
        const halo = shellGroup.append('path')
            .attr('d', dPath)
            .attr('transform', `translate(${centerX}, ${centerY})`)
            .attr('fill', 'none')
            .attr('stroke', `rgba(${INK}, 0.20)`)
            .attr('stroke-width', 7)
            .attr('opacity', 0)
            .style('pointer-events', 'none');

        const segment = shellGroup.append('path')
            .attr('d', dPath)
            .attr('transform', `translate(${centerX}, ${centerY})`)
            .attr('fill', isolated
                ? `rgba(${ACCENT}, ${0.08 + activity * 0.2})`
                : `rgba(${INK}, ${0.06 + activity * 0.22})`)
            .attr('stroke', isolated
                ? `rgba(${ACCENT}, ${0.7 + activity * 0.3})`
                : `rgba(${INK}, ${0.42 + activity * 0.4})`)
            .attr('stroke-width', isolated ? 1.8 + activity * 1.4 : 1.1 + activity * 1.6)
            .style('cursor', 'pointer');

        const mid = (startAngle + endAngle) / 2;

        // Pulsing marker flags cells that actually contain isolation.
        if (isolated) {
            const markR = ringOuter + 6;
            shellGroup.append('circle')
                .attr('class', 'ns-isolated-marker')
                .attr('cx', centerX + Math.cos(mid - Math.PI / 2) * markR)
                .attr('cy', centerY + Math.sin(mid - Math.PI / 2) * markR)
                .attr('r', 2.6)
                .attr('fill', `rgb(${ACCENT})`)
                .style('pointer-events', 'none');
        }

        const idx = cells.length;
        cells.push({ segment, halo });

        segment
            .on('mouseenter', (event) => {
                setFocus(idx);
                d3.selectAll('.ns-tooltip').remove();
                d3.select('body')
                    .append('div')
                    .attr('class', 'tooltip ns-tooltip ns-hud-tooltip')
                    .style('left', `${event.pageX + 14}px`)
                    .style('top', `${event.pageY - 10}px`)
                    .html(`
                        <div class="ns-hud-top">
                            <div>
                                <div class="ns-hud-over">NAMESPACE</div>
                                <div class="ns-hud-name">${nsName.toUpperCase()}</div>
                            </div>
                            <div class="ns-hud-pill ${isolated ? 'is-iso' : ''}">${isolated ? 'ISOLATED' : 'SINGLE'}</div>
                        </div>
                        <div class="ns-hud-desc">${meta.isolates || 'Resource isolation'}</div>
                        <div class="ns-hud-rows">
                            <div class="ns-hud-row"><span>WORLDS</span><b>${ns.unique_count || 0}</b></div>
                            <div class="ns-hud-row"><span>DOMINANT</span><b>${ns.dominant_count || 0} procs</b></div>
                            <div class="ns-hud-row"><span>INODE</span><b>${ns.dominant_inode || 'n/a'}</b></div>
                            <div class="ns-hud-row"><span>VIA</span><b>${kind}</b></div>
                        </div>
                        <div class="ns-hud-bar"><i style="width:${Math.round(activity * 100)}%"></i></div>
                        <div class="ns-hud-foot"><span>ACTIVITY ${Math.round(activity * 100)}%</span><span class="ns-hud-hint">click to unfold ▸</span></div>
                    `);
            })
            .on('mousemove', (event) => {
                d3.selectAll('.ns-tooltip')
                    .style('left', `${event.pageX + 14}px`)
                    .style('top', `${event.pageY - 10}px`);
            })
            .on('mouseleave', () => {
                restoreFocus();
                d3.selectAll('.ns-tooltip').remove();
            })
            .on('click', (event) => {
                event.stopPropagation();
                d3.selectAll('.ns-tooltip').remove();
                if (expandedNsId === ns.id) {
                    collapseNamespaceTree();
                } else {
                    restoreFocus();
                    expandNamespaceTree(ns, meta, nsName, centerX, centerY, mid);
                }
            });
    }
}

function collapseNamespaceTree(animated = true) {
    expandedNsId = null;
    d3.select('body').on('keydown.nstree', null);
    const layer = svg.selectAll('.ns-tree-layer');
    const scrim = svg.selectAll('.ns-tree-scrim');
    if (layer.empty() && scrim.empty()) return;
    if (!animated) { layer.remove(); scrim.remove(); return; }
    scrim.transition().duration(220).style('opacity', 0).remove();
    layer.transition().duration(200).style('opacity', 0).remove();
}

// Mechanically unfold a system-info tree out of the clicked namespace cell.
function expandNamespaceTree(ns, meta, nsName, cx, cy, mid) {
    collapseNamespaceTree(false);
    expandedNsId = ns.id;

    const svgNode = svg.node();
    const W = (svgNode && svgNode.clientWidth) || window.innerWidth;
    const H = (svgNode && svgNode.clientHeight) || window.innerHeight;

    // Light scrim calms the busy ring behind the readout.
    svg.append('rect')
        .attr('class', 'ns-tree-scrim')
        .attr('x', 0).attr('y', 0).attr('width', W).attr('height', H)
        .attr('fill', 'rgba(230, 231, 233, 0.62)')
        .style('opacity', 0)
        .style('cursor', 'pointer')
        .on('click', () => collapseNamespaceTree())
        .transition().duration(220).style('opacity', 1);

    const layer = svg.append('g').attr('class', 'ns-tree-layer');

    // Anchor = outer-mid point of the clicked cell (the "square" it grows from).
    const a = mid - Math.PI / 2;
    const rx = Math.cos(a), ry = Math.sin(a);
    const anchorX = cx + rx * 202;
    const anchorY = cy + ry * 202;

    // Build the tree: identity + live isolated worlds + kernel facets.
    const kind = NS_KIND[ns.id] || 'nsproxy';
    const isolated = !!ns.isolated || Number(ns.unique_count || 0) > 1;
    const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
    const worlds = Array.isArray(ns.worlds) ? ns.worlds : [];
    const worldLeaves = worlds.length
        ? worlds.map((w) => ({
            label: clip(`${w.count}p · ${(w.sample && w.sample[0]) || '—'}`, 20),
            title: `inode ${w.inode} · ${w.count} procs\n${(w.sample || []).join(', ') || 'n/a'}`,
        }))
        : [{ label: `${ns.dominant_count || 0} procs` }];

    const branches = [
        { label: 'IDENTITY', leaves: [
            { label: clip(`inode ${ns.dominant_inode || 'n/a'}`, 20) },
            { label: `/proc/1/ns/${ns.id}` },
            { label: `via ${kind} · ${Math.round((ns.activity || 0) * 100)}%` },
        ] },
        { label: `WORLDS (${ns.unique_count || 0})`, leaves: worldLeaves },
        { label: 'ISOLATES', leaves: (NS_FACETS[ns.id] || ['resource']).map((f) => ({ label: f })) },
    ];

    // Panel geometry (local content coords).
    const rowH = 24;
    const headerH = 40;
    const footerH = 16;
    const padX = 14;
    const col0 = padX;        // root chip
    const rootW = 56;
    const col1 = padX + 78;   // branch chips
    const branchW = 100;
    const col2 = padX + 196;  // leaf chips
    const leafW = 152;
    const panelW = col2 + leafW + padX;
    const totalLeaves = branches.reduce((s, b) => s + b.leaves.length, 0);
    const contentTop = headerH + 8;
    const panelH = contentTop + totalLeaves * rowH + footerH;

    // Assign rows: leaves stack, branch = mean of its leaves, root = mean of branches.
    let row = 0;
    const laidBranches = branches.map((br) => {
        const leafYs = br.leaves.map(() => contentTop + (row++) * rowH + rowH / 2);
        const by = leafYs.reduce((s, v) => s + v, 0) / leafYs.length;
        return { ...br, by, leafYs };
    });
    const rootY = laidBranches.reduce((s, b) => s + b.by, 0) / laidBranches.length;

    // Position panel; grow away from screen centre, clamp to viewport.
    const dir = anchorX >= cx ? 1 : -1;
    let panelX = dir === 1 ? anchorX + 24 : anchorX - 24 - panelW;
    let panelY = anchorY - panelH / 2;
    const m = 12;
    panelX = Math.max(m, Math.min(W - panelW - m, panelX));
    panelY = Math.max(m, Math.min(H - panelH - m, panelY));

    // Connector from the cell → panel edge ("unfolds from the square").
    const connX = dir === 1 ? panelX : panelX + panelW;
    const connY = Math.max(panelY + 12, Math.min(panelY + panelH - 12, anchorY));
    layer.append('circle')
        .attr('class', 'ns-tree-anchor')
        .attr('cx', anchorX).attr('cy', anchorY).attr('r', 3);
    layer.append('line')
        .attr('class', 'ns-tree-conn')
        .attr('x1', anchorX).attr('y1', anchorY)
        .attr('x2', anchorX).attr('y2', anchorY)
        .transition().duration(240).ease(d3.easeCubicOut)
        .attr('x2', connX).attr('y2', connY);

    const panel = layer.append('g')
        .attr('transform', `translate(${panelX}, ${panelY})`)
        .on('click', (event) => event.stopPropagation());

    // Frame unfolds vertically from its centre (mechanical open).
    panel.append('rect')
        .attr('class', 'ns-tree-frame')
        .attr('width', panelW).attr('height', panelH).attr('rx', 4)
        .attr('transform', `translate(0, ${panelH / 2}) scale(1, 0.02)`)
        .transition().delay(140).duration(220).ease(d3.easeCubicOut)
        .attr('transform', 'translate(0,0) scale(1,1)');

    // Header: name + status pill + activity track + close affordance.
    const header = panel.append('g').attr('class', 'ns-tree-header').style('opacity', 0);
    header.transition().delay(280).duration(200).style('opacity', 1);

    header.append('text')
        .attr('class', 'ns-tree-title')
        .attr('x', padX).attr('y', 16)
        .text(`NAMESPACE · ${nsName.toUpperCase()}`);

    const pct = Math.round((ns.activity || 0) * 100);
    const trackX = padX, trackY = 26, trackW = panelW - padX * 2;
    header.append('rect')
        .attr('class', 'ns-tree-track')
        .attr('x', trackX).attr('y', trackY).attr('width', trackW).attr('height', 3).attr('rx', 1.5);
    header.append('rect')
        .attr('class', isolated ? 'ns-tree-track-fill is-iso' : 'ns-tree-track-fill')
        .attr('x', trackX).attr('y', trackY).attr('width', 0).attr('height', 3).attr('rx', 1.5)
        .transition().delay(340).duration(320).ease(d3.easeCubicOut)
        .attr('width', Math.max(2, trackW * (pct / 100)));

    header.append('line')
        .attr('class', 'ns-tree-divider')
        .attr('x1', padX).attr('y1', headerH - 4).attr('x2', panelW - padX).attr('y2', headerH - 4);

    const linksG = panel.append('g').attr('class', 'ns-tree-links');
    const nodesG = panel.append('g').attr('class', 'ns-tree-nodes');

    const elbow = (sx, sy, tx, ty) => {
        const mx = (sx + tx) / 2;
        return `M ${sx},${sy} H ${mx} V ${ty} H ${tx}`;
    };
    // Links draw like a circuit trace (stroke-dashoffset), timed to the chips.
    const addLink = (sx, sy, tx, ty, delay) => {
        const path = linksG.append('path')
            .attr('class', 'ns-tree-link')
            .attr('d', elbow(sx, sy, tx, ty));
        const len = path.node().getTotalLength();
        path.attr('stroke-dasharray', len).attr('stroke-dashoffset', len)
            .transition().delay(delay).duration(260).ease(d3.easeCubicOut)
            .attr('stroke-dashoffset', 0);
    };
    const addChip = (fromX, fromY, x, y, w, label, cls, delay, title) => {
        const g = nodesG.append('g')
            .attr('class', cls)
            .attr('transform', `translate(${fromX}, ${fromY}) scale(0.1)`)
            .style('opacity', 0);
        if (title) {
            g.style('cursor', 'help').append('title').text(title);
        }
        g.append('rect')
            .attr('x', 0).attr('y', -9).attr('width', w).attr('height', 18).attr('rx', 3);
        g.append('text')
            .attr('x', 9).attr('y', 4)
            .text(label);
        g.transition().delay(delay).duration(260).ease(d3.easeBackOut.overshoot(1.5))
            .attr('transform', `translate(${x}, ${y}) scale(1)`)
            .style('opacity', 1);
        return g;
    };

    // Root chip (accent when the namespace holds real isolation).
    addChip(col0, rootY, col0, rootY, rootW, nsName.toUpperCase(), isolated ? 'ns-tree-root is-iso' : 'ns-tree-root', 120);

    // Branches + leaves.
    let leafSeq = 0;
    laidBranches.forEach((br, bi) => {
        const branchDelay = 260 + bi * 90;
        const isWorlds = /^WORLDS/.test(br.label);
        const branchCls = (isWorlds && isolated) ? 'ns-tree-branch is-iso' : 'ns-tree-branch';
        addLink(col0 + rootW, rootY, col1, br.by, branchDelay - 40);
        addChip(col0 + rootW, rootY, col1, br.by, branchW, br.label, branchCls, branchDelay);
        br.leaves.forEach((lf, li) => {
            const leafDelay = 430 + leafSeq * 55;
            leafSeq += 1;
            const leafCls = (isWorlds && isolated) ? 'ns-tree-leaf is-iso' : 'ns-tree-leaf';
            addLink(col1 + branchW, br.by, col2, br.leafYs[li], leafDelay - 40);
            addChip(col1 + branchW, br.by, col2, br.leafYs[li], leafW, lf.label, leafCls, leafDelay, lf.title);
        });
    });

    d3.select('body').on('keydown.nstree', (e) => {
        if (e.key === 'Escape') collapseNamespaceTree();
    });
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
