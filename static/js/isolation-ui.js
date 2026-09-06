// Isolation UI module extracted from main.js
(function initIsolationUI(){
const svg = d3.select("svg");
let isolationContextCache = null;
let isolationContextCacheTs = 0;
let isolationRenderToken = 0;

// Reading /proc/<pid>/ns/* of a foreign task needs ptrace-level access, so
// without the root collector the backend resolves only part of the process
// table. Every number on this ring is then a sample, and the ring has to say so
// rather than presenting it as the state of the machine.
let isolationCoverage = { source: null, scanned: 0, resolved: 0, partial: false };

// Say what was actually read, and why it is short when it is.
function coverageText() {
    const c = isolationCoverage;
    if (!c.scanned) return 'coverage unknown';
    if (!c.partial) return `${c.resolved} / ${c.scanned} procs`;
    return `${c.resolved} / ${c.scanned} procs · no collector`;
}

function readCoverage(data) {
    const scanned = Number(data && data.processes_scanned) || 0;
    const resolved = Number(data && data.processes_resolved) || 0;
    return {
        source: (data && data.source) || null,
        scanned,
        resolved,
        // Treat an older backend that reports no coverage at all as partial:
        // claiming full coverage we cannot prove is the failure mode to avoid.
        partial: !resolved || resolved < scanned,
    };
}

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
            isolationCoverage = readCoverage(data);
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
        clearNamespaceProcessFocus();
        return;
    }

    const renderToken = ++isolationRenderToken;
    clearNamespaceProcessFocus();
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

function clearNamespaceProcessFocus() {
    svg.classed('ns-world-process-focus', false);
    svg.selectAll('.process-line').classed('ns-world-member', false);
    svg.selectAll('.process-node-group').classed('ns-world-member', false);
    svg.selectAll('.ns-world-process-overlay').remove();
}

function focusNamespaceProcesses(pids) {
    const members = new Set((Array.isArray(pids) ? pids : []).map(pid => String(pid)));
    clearNamespaceProcessFocus();
    if (!members.size) return;
    svg.classed('ns-world-process-focus', true);
    svg.selectAll('.process-line').classed('ns-world-member', function () {
        return members.has(String(this.getAttribute('data-pid')));
    });
    svg.selectAll('.process-node-group').classed('ns-world-member', function () {
        return members.has(String(this.getAttribute('data-pid')));
    });

    // A namespace card sits above a focus veil. Mirror only the selected paths
    // between the veil and the card, otherwise the accurate highlight exists
    // but is visually buried under the modal layer.
    if (!svg.select('.namespace-card-scrim').empty()) {
        const overlay = svg.insert('g', '.namespace-card-layer')
            .attr('class', 'ns-world-process-overlay')
            .attr('pointer-events', 'none');
        svg.selectAll('.process-line.ns-world-member').each(function () {
            const source = d3.select(this);
            overlay.append('path')
                .attr('d', source.attr('d'))
                .attr('class', 'ns-world-overlay-line');
        });
        svg.selectAll('.process-node-group.ns-world-member').each(function () {
            const source = d3.select(this).select('circle.process-node');
            if (source.empty()) return;
            overlay.append('circle')
                .attr('cx', source.attr('cx'))
                .attr('cy', source.attr('cy'))
                .attr('r', 4)
                .attr('class', 'ns-world-overlay-node');
        });
    }
}

function focusNamespaceTrace(ns, nsName) {
    if (!window.KernelTape || typeof window.KernelTape.setPidFocus !== 'function') return;
    const pids = [];
    const worldByPid = {};
    (Array.isArray(ns.worlds) ? ns.worlds : []).forEach((world) => {
        (Array.isArray(world.pids) ? world.pids : []).forEach((pid) => {
            pids.push(pid);
            worldByPid[String(pid)] = world.inode;
        });
    });
    window.KernelTape.setPidFocus({
        key: `namespace:${ns.id}`,
        label: `${String(nsName || ns.id).toUpperCase()} NAMESPACE`,
        nsId: ns.id,
        pids,
        worldByPid,
    });
}

function clearNamespaceTrace() {
    if (window.KernelTape && typeof window.KernelTape.clearPidFocus === 'function') {
        window.KernelTape.clearPidFocus();
    }
}

// Cells on the outer edge of the ring would push the chip off screen, so it
// flips to the other side of the cursor instead of being clipped.
function placeNamespaceTooltip(tip, event) {
    const node = tip.node();
    if (!node) return;
    if (typeof window.placeHoverPopup === 'function') {
        window.placeHoverPopup(tip, event.pageX, event.pageY, { gap: 14, maxWidth: 300 });
        return;
    }
    const gap = 14;
    const margin = 10;
    let left = event.pageX + gap;
    if (left + node.offsetWidth > window.innerWidth - margin) {
        left = event.pageX - gap - node.offsetWidth;
    }
    const top = Math.min(event.pageY - 10, window.innerHeight - node.offsetHeight - margin);
    tip.style('left', `${Math.max(margin, left)}px`)
        .style('top', `${Math.max(margin, top)}px`);
}

// ---------------------------------------------------------------------------
// Kernel cutaway. The namespace cell is a cover plate; on hover it breaks open
// and an instrument sector extends out of the ring behind it.
//
// Everything here is flat, orthographic hairline work, because that is the only
// language on this page. An isometric solid would drag in a light source and a
// horizon that exist nowhere else and would read as a foreign object.
//
// The opening cannot happen inside the ring: the process chips sit at r=150 and
// are 49px across, so they occupy r=125..175 of a ring that spans 110..190 and
// leave two 15px slivers. So the cover breaks, and the mechanism extends
// outward into the clear annulus past r=190 — a drawer, not a lid. Removed
// material is marked the drafting way, with a dashed phantom outline of the
// cover plus a hatched band at the break.
const CUT_COVER_T = 5;       // thickness shown at the break
const CUT_COVER_BACK = 8;    // how far the cover edge retracts
const CUT_APERTURE = 56;     // depth of the extended sector (190 -> 246)
const CUT_AMBER = '176, 108, 22';

function ensureCutawayDefs(ink) {
    let defs = svg.select('defs.kernel-cutaway-defs');
    if (!defs.empty()) return;
    defs = svg.append('defs').attr('class', 'kernel-cutaway-defs');
    const pattern = defs.append('pattern')
        .attr('id', 'kernel-cut-hatch')
        .attr('width', 5)
        .attr('height', 5)
        .attr('patternUnits', 'userSpaceOnUse')
        .attr('patternTransform', 'rotate(45)');
    pattern.append('line')
        .attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 5)
        .attr('stroke', `rgba(${ink}, 0.55)`)
        .attr('stroke-width', 1);
}

// Math.min/max propagate NaN, which reaches the SVG as a broken coordinate.
const cutRatio = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(1, Number(v))) : 0);

// Pointy-top hex, the same silhouette as the process chips already on the ring,
// so the exposed mechanism belongs to this drawing rather than visiting it.
function cutHex(g, cx, cy, r) {
    const pts = [];
    for (let k = 0; k < 6; k++) {
        const a = -Math.PI / 2 + k * Math.PI / 3;
        pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`);
    }
    return g.append('polygon').attr('points', pts.join(' '));
}

// The instrument sector that extends past the ring once the cover breaks.
//
// The fan is a density plot, not texture: each world contributes a lobe at its
// own angle weighted by its process count, and the whole envelope scales with
// activity. So a namespace with one big world shows a single tall spike and one
// with six shows a ragged comb, and neither shape is invented.
function buildSectorAperture(g, ns, cx, cy, startAngle, endAngle, rIn, rOut, ink) {
    const worldRows = Array.isArray(ns.worlds) ? ns.worlds : [];
    const nWorlds = Math.max(1, Math.min(6, Number(ns.unique_count) || 1));
    const activity = cutRatio(ns.activity);
    const procs = Number.isFinite(Number(ns.dominant_count)) ? Number(ns.dominant_count) : 0;
    const span = endAngle - startAngle;

    // d3 arcs measure from 12 o'clock, screen angles from 3 o'clock.
    const at = (f, r) => {
        const a = startAngle + span * f - Math.PI / 2;
        return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    };
    const arcAt = (r, f0, f1) => {
        const [x0, y0] = at(f0, r);
        const [x1, y1] = at(f1, r);
        return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
    };
    // Reveal sweeps around the sector, the way the reference resolves detail.
    const staged = (sel, f) => sel.attr('data-cut-delay', Math.round(90 + f * 220));

    const inset = 0.14;
    const fOf = (k) => (nWorlds === 1 ? 0.5 : inset + (k / (nWorlds - 1)) * (1 - inset * 2));
    const counts = [];
    for (let k = 0; k < nWorlds; k++) {
        counts.push(Number((worldRows[k] || {}).count) || (k === 0 ? procs : 1));
    }
    const maxCount = Math.max(1, ...counts);
    const domIdx = counts.indexOf(maxCount);
    const sigma = 0.42 / nWorlds;

    const rFan = rIn + 4;
    const fanMax = 24 * (0.35 + 0.65 * activity);
    const density = (f) => {
        let s = 0;
        for (let k = 0; k < nWorlds; k++) {
            const d = (f - fOf(k)) / sigma;
            s += (counts[k] / maxCount) * Math.exp(-0.5 * d * d);
        }
        return Math.min(1, s);
    };

    const TICKS = 26;
    for (let i = 0; i < TICKS; i++) {
        const f = inset * 0.5 + (i / (TICKS - 1)) * (1 - inset);
        const len = 3 + fanMax * density(f);
        const [x0, y0] = at(f, rFan);
        const [x1, y1] = at(f, rFan + len);
        const hot = Math.abs(f - fOf(domIdx)) < sigma * 0.9;
        staged(g.append('line')
            .attr('x1', x0.toFixed(1)).attr('y1', y0.toFixed(1))
            .attr('x2', x1.toFixed(1)).attr('y2', y1.toFixed(1))
            .attr('stroke', hot ? `rgba(${CUT_AMBER}, 0.85)` : `rgba(${ink}, 0.5)`)
            .attr('stroke-width', hot ? 1 : 0.6), f);
    }

    // Datum arc the fan is measured against, plus a block per world on it.
    const rLane = rIn + 33;
    g.append('path')
        .attr('d', arcAt(rLane, inset * 0.5, 1 - inset * 0.5))
        .attr('fill', 'none')
        .attr('stroke', `rgba(${ink}, 0.38)`)
        .attr('stroke-width', 0.6)
        .attr('data-cut-delay', 90);

    for (let k = 0; k < nWorlds; k++) {
        const f = fOf(k);
        const w = 1.6 + 2.4 * (counts[k] / maxCount);
        const [ax, ay] = at(f - w / 200, rLane - 3);
        const [bx, by] = at(f + w / 200, rLane - 3);
        const [dxp, dyp] = at(f + w / 200, rLane + 3);
        const [exp_, eyp] = at(f - w / 200, rLane + 3);
        staged(g.append('polygon')
            .attr('points', [[ax, ay], [bx, by], [dxp, dyp], [exp_, eyp]]
                .map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '))
            .attr('fill', k === domIdx ? `rgba(${CUT_AMBER}, 0.9)` : `rgba(${ink}, 0.62)`)
            .attr('stroke', 'none'), f);
    }

    // One chip per isolated world — the mechanism's moving parts.
    const rChip = rIn + 44;
    for (let k = 0; k < nWorlds; k++) {
        const f = fOf(k);
        const [px, py] = at(f, rChip);
        const isDom = k === domIdx;
        staged(cutHex(g, px, py, 3.2 + 2.2 * (counts[k] / maxCount))
            .attr('fill', isDom ? `rgba(${CUT_AMBER}, 0.16)` : 'none')
            .attr('stroke', isDom ? `rgba(${CUT_AMBER}, 0.9)` : `rgba(${ink}, 0.55)`)
            .attr('stroke-width', 0.8), f);
    }

    // Outer rim closes the sector so it reads as one instrument. It goes dotted
    // when the numbers behind the sector came from a partial scan — same
    // distinction the rest of the page draws between observed and unobserved.
    const rim = g.append('path')
        .attr('d', arcAt(rOut - 2, 0.02, 0.98))
        .attr('fill', 'none')
        .attr('stroke', `rgba(${ink}, 0.45)`)
        .attr('stroke-width', 0.8)
        .attr('data-cut-delay', 120);
    if (isolationCoverage.partial) rim.attr('stroke-dasharray', '1.5 3');
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
    const gap = 0.045;
    // Center namespace slices on the Icon1 orbit (r=150).
    const ringInner = 110;
    const ringOuter = 190;

    // Ink-on-paper palette (page bg is #e6e6e6 → use dark ink for contrast).
    const INK = '58, 61, 68';
    const cells = [];

    // The shell layer is rebuilt on every refresh but defs survive, so last
    // pass's clip paths have to go or they accumulate forever.
    ensureCutawayDefs(INK);
    svg.selectAll('clipPath.ns-cut-clip').remove();

    // Break the cover open and run the sector out. The cover edge retracts, the
    // hatched break follows it, the phantom outline marks where material was,
    // and the instrument resolves with an angular sweep.
    const setCover = (cell, open) => {
        if (cell.open === open) return;
        cell.open = open;
        const from = open ? ringOuter : ringOuter - CUT_COVER_BACK;
        const to = open ? ringOuter - CUT_COVER_BACK : ringOuter;
        const dur = open ? 180 : 160;

        cell.segment.transition('cutaway').duration(dur).ease(d3.easeCubicOut)
            .attrTween('d', () => (t) => cell.arcFor(from + (to - from) * t))
            .attr('fill', open ? `rgba(${INK}, 0.02)` : `rgba(${INK}, 0.07)`);
        cell.edge.transition('cutaway').duration(dur).ease(d3.easeCubicOut)
            .attrTween('d', () => (t) => cell.edgeFor(from + (to - from) * t))
            .style('opacity', open ? 1 : 0);
        cell.phantom.transition('cutaway').duration(dur)
            .style('opacity', open ? 1 : 0);

        // Elements carry their own sweep delay; closing drops straight out so
        // the sector never lingers once the pointer has gone.
        cell.mach.selectAll('[data-cut-delay]')
            .transition('cutaway')
            .delay(function () { return open ? +this.getAttribute('data-cut-delay') : 0; })
            .duration(open ? 200 : 120)
            .style('opacity', open ? 1 : 0);
        cell.mach.style('pointer-events', 'none');
    };

    const restoreFocus = () => {
        cells.forEach(c => {
            c.segment.attr('opacity', 1);
            c.halo.attr('opacity', 0);
            setCover(c, false);
        });
        clearNamespaceProcessFocus();
        clearNamespaceTrace();
    };

    // The reference never blanks the inactive parts, it just lets them drop
    // back a step in contrast, so the ring stays whole while one cell is open.
    const setFocus = (idx) => {
        cells.forEach((c, j) => {
            const focused = j === idx;
            c.segment.attr('opacity', focused ? 1 : 0.55);
            c.halo.attr('opacity', focused ? 1 : 0);
            setCover(c, focused);
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
        const isolated = !!ns.isolated || Number(ns.unique_count || 0) > 1;
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

        const mid = (startAngle + endAngle) / 2;
        const idx = cells.length;

        // --- the mechanism, extended past the ring --------------------------
        // Drawn now at full extent and held at zero opacity; the sweep on hover
        // resolves it in place. Nothing is clipped, because the sector is meant
        // to reach into the clear annulus beyond r=190.
        const mach = shellGroup.append('g')
            .attr('class', 'ns-cut-aperture')
            .style('pointer-events', 'none');
        buildSectorAperture(
            mach, ns, centerX, centerY, startAngle, endAngle,
            ringOuter, ringOuter + CUT_APERTURE, INK,
        );
        mach.selectAll('[data-cut-delay]').style('opacity', 0);

        // Phantom outline: drafting shorthand for material that has been taken
        // away. It sits under the cover and shows once the cover breaks.
        const phantom = shellGroup.append('path')
            .attr('d', dPath)
            .attr('transform', `translate(${centerX}, ${centerY})`)
            .attr('fill', 'none')
            .attr('stroke', `rgba(${INK}, 0.5)`)
            .attr('stroke-width', 0.7)
            .attr('stroke-dasharray', '6 3 1.5 3')
            .style('opacity', 0)
            .style('pointer-events', 'none');

        // --- the cover ----------------------------------------------------
        const segment = shellGroup.append('path')
            .attr('d', dPath)
            .attr('transform', `translate(${centerX}, ${centerY})`)
            .attr('fill', `rgba(${INK}, 0.07)`)
            .attr('stroke', `rgba(${INK}, 0.44)`)
            .attr('stroke-width', 1.1)
            .style('pointer-events', 'none');

        const arcFor = (outer) => d3.arc()
            .innerRadius(ringInner)
            .outerRadius(outer)
            .startAngle(startAngle)
            .endAngle(endAngle)
            .cornerRadius(6)();
        // Hatched band on the cover's retreating edge: the break face.
        const edgeFor = (outer) => d3.arc()
            .innerRadius(Math.max(ringInner, outer - CUT_COVER_T))
            .outerRadius(outer)
            .startAngle(startAngle)
            .endAngle(endAngle)();

        const edge = shellGroup.append('path')
            .attr('d', edgeFor(ringOuter))
            .attr('transform', `translate(${centerX}, ${centerY})`)
            .attr('fill', 'url(#kernel-cut-hatch)')
            .attr('stroke', `rgba(${INK}, 0.6)`)
            .attr('stroke-width', 0.8)
            .style('opacity', 0)
            .style('pointer-events', 'none');

        // Hover must stay tied to the original sector footprint. The visible
        // cover retracts on focus; binding events to it makes the pointer leave
        // the path, close it, and immediately reopen it in a loop.
        const hitArea = shellGroup.append('path')
            .attr('class', 'namespace-sector-hit')
            .attr('data-namespace', ns.id)
            .attr('d', dPath)
            .attr('transform', `translate(${centerX}, ${centerY})`)
            .attr('fill', 'transparent')
            .attr('stroke', 'none')
            .style('cursor', 'pointer')
            .style('pointer-events', 'all');

        const cell = {
            segment,
            halo,
            mach,
            phantom,
            edge,
            arcFor,
            edgeFor,
            open: false,
            nsId: ns.id,
        };
        cells.push(cell);

        hitArea
            .on('mouseenter', (event) => {
                setFocus(idx);
                focusNamespaceTrace(ns, nsName);
                d3.selectAll('.ns-tooltip').remove();
                const tip = d3.select('body')
                    .append('div')
                    .attr('class', 'tooltip ns-tooltip ns-hud-tooltip')
                    .html(`
                        <div class="ns-hud-card">
                            <div class="ns-hud-head">
                                <i class="ns-hud-glyph"></i>
                                <span class="ns-hud-title">NAMESPACE</span>
                                <span class="ns-hud-flag ${isolated ? 'is-iso' : ''}">${isolated ? 'ISOLATED' : 'SINGLE'}</span>
                            </div>
                            <div class="ns-hud-body">
                                <div class="ns-hud-name">${nsName.toUpperCase()}</div>
                                <div class="ns-hud-desc">${meta.isolates || 'Resource isolation'}</div>
                                <div class="ns-hud-row"><span>WORLDS</span><b class="${isolated ? 'is-live' : ''}">${ns.unique_count || 0}</b></div>
                                <div class="ns-hud-row"><span>DOMINANT</span><b>${ns.dominant_count || 0} procs</b></div>
                                <div class="ns-hud-row"><span>INODE</span><b>${ns.dominant_inode || 'n/a'}</b></div>
                                <div class="ns-hud-row"><span>VIA</span><b>${kind}</b></div>
                                <div class="ns-hud-row"><span>SEEN</span><b class="${isolationCoverage.partial ? 'is-partial' : ''}">${coverageText()}</b></div>
                                <div class="ns-hud-meter"><i style="width:${Math.round(activity * 100)}%"></i></div>
                                <div class="ns-hud-foot"><span>ACTIVITY ${Math.round(activity * 100)}%</span><span class="ns-hud-hint">CLICK FOR THE CARD ▸</span></div>
                            </div>
                        </div>
                    `);
                placeNamespaceTooltip(tip, event);
            })
            .on('mousemove', (event) => {
                placeNamespaceTooltip(d3.selectAll('.ns-tooltip'), event);
            })
            .on('mouseleave', () => {
                restoreFocus();
                d3.selectAll('.ns-tooltip').remove();
            })
            .on('click', (event) => {
                event.stopPropagation();
                d3.selectAll('.ns-tooltip').remove();
                const anchorR = 202;
                const ax = centerX + Math.cos(mid - Math.PI / 2) * anchorR;
                const ay = centerY + Math.sin(mid - Math.PI / 2) * anchorR;
                if (window.NamespaceCard && typeof window.NamespaceCard.open === 'function') {
                    restoreFocus();
                    window.NamespaceCard.open(ns, { x: ax, y: ay });
                    return;
                }
                if (expandedNsId === ns.id) {
                    collapseNamespaceTree();
                } else {
                    restoreFocus();
                    expandNamespaceTree(ns, meta, nsName, centerX, centerY, mid);
                }
            });
    }
}

// Живые слои сцены дорисовываются в svg постоянно, поэтому пока панель открыта,
// её держит тот же сторож z-порядка, что и досье процесса.
let nsTreeTopKeeper = null;

function collapseNamespaceTree(animated = true) {
    expandedNsId = null;
    if (nsTreeTopKeeper) nsTreeTopKeeper.stop();
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

    // Same focus veil the process dossier uses, so overlays read as one system.
    svg.append('rect')
        .attr('class', 'ns-tree-scrim')
        .attr('x', 0).attr('y', 0).attr('width', W).attr('height', H)
        .attr('fill', ensureFocusVeilGradient())
        .style('opacity', 0)
        .style('cursor', 'pointer')
        .on('click', () => collapseNamespaceTree())
        .transition().duration(220).style('opacity', 1);

    const layer = svg.append('g').attr('class', 'ns-tree-layer');

    if (!nsTreeTopKeeper) {
        nsTreeTopKeeper = createOverlayTopKeeper('ns-tree-scrim', ['ns-tree-layer'], () => !!expandedNsId);
    }
    nsTreeTopKeeper.start();

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
            label: clip(`${w.count}p · ${(w.sample && w.sample[0]) || '—'}`, 22),
            title: `inode ${w.inode} · ${w.count} procs\n${(w.sample || []).join(', ') || 'n/a'}`,
        }))
        : [{ label: `${ns.dominant_count || 0} procs` }];
    // Only the richest inodes come back from the API, so name the remainder
    // instead of letting the branch count disagree with the rows.
    const hiddenWorlds = Math.max(0, Number(ns.unique_count || 0) - worlds.length);
    if (worlds.length && hiddenWorlds) {
        worldLeaves.push({ label: `+${hiddenWorlds} smaller ${hiddenWorlds === 1 ? 'world' : 'worlds'}` });
    }

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
    const rowH = 25;
    const headerH = 25;   // header strip, same height as the dossier cards
    const meterH = 2;
    const footerH = 26;
    const padX = 14;
    const col0 = padX;        // root chip
    const rootW = 56;
    const col1 = padX + 78;   // branch chips
    const branchW = 100;
    const col2 = padX + 196;  // leaf chips
    const leafW = 152;
    const panelW = col2 + leafW + padX;
    const totalLeaves = branches.reduce((s, b) => s + b.leaves.length, 0);
    const contentTop = headerH + meterH + 12;
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
    ensureDossierDefs();
    const cut = 15;
    panel.append('path')
        .attr('class', 'ns-tree-frame')
        .attr('d', dossierCardPath(0, 0, panelW, panelH, cut))
        .attr('filter', 'url(#dossier-drop)')
        .attr('transform', `translate(0, ${panelH / 2}) scale(1, 0.02)`)
        .transition().delay(140).duration(220).ease(d3.easeCubicOut)
        .attr('transform', 'translate(0,0) scale(1,1)');

    // Chrome: header strip with the ring glyph, activity meter, close hint.
    const chrome = panel.append('g').attr('class', 'ns-tree-chrome').style('opacity', 0);
    chrome.transition().delay(280).duration(200).style('opacity', 1);

    chrome.append('path')
        .attr('class', 'ns-tree-strip')
        .attr('d', `M0,0 H${panelW - cut} L${panelW},${cut} V${headerH} H0 Z`);
    chrome.append('circle')
        .attr('class', 'ns-tree-glyph-ring')
        .attr('cx', padX).attr('cy', headerH / 2).attr('r', 4.2);
    chrome.append('circle')
        .attr('class', 'ns-tree-glyph-dot')
        .attr('cx', padX).attr('cy', headerH / 2).attr('r', 1.6);

    chrome.append('text')
        .attr('class', 'ns-tree-title')
        .attr('x', padX + 12).attr('y', headerH / 2 + 3.5)
        .text(`NAMESPACE · ${nsName.toUpperCase()}`);
    chrome.append('text')
        .attr('class', isolated ? 'ns-tree-meta is-iso' : 'ns-tree-meta')
        .attr('x', panelW - 13).attr('y', headerH / 2 + 3.5)
        .attr('text-anchor', 'end')
        .text(isolated ? 'ISOLATED' : 'SINGLE');
    chrome.append('line')
        .attr('class', 'ns-tree-divider')
        .attr('x1', 0).attr('y1', headerH).attr('x2', panelW).attr('y2', headerH);

    // Activity reads as a hairline meter across the full width of the strip.
    const pct = Math.round((ns.activity || 0) * 100);
    chrome.append('rect')
        .attr('class', 'ns-tree-track')
        .attr('x', 0).attr('y', headerH).attr('width', panelW).attr('height', meterH);
    chrome.append('rect')
        .attr('class', 'ns-tree-track-fill')
        .attr('x', 0).attr('y', headerH).attr('width', 0).attr('height', meterH)
        .transition().delay(340).duration(320).ease(d3.easeCubicOut)
        .attr('width', Math.max(2, panelW * (pct / 100)));

    chrome.append('text')
        .attr('class', 'ns-tree-foot')
        .attr('x', padX).attr('y', panelH - 10)
        .text('ESC OR CLICK OUTSIDE TO CLOSE');
    chrome.append('text')
        .attr('class', 'ns-tree-foot')
        .attr('x', panelW - padX).attr('y', panelH - 10)
        .attr('text-anchor', 'end')
        .text(`ACTIVITY ${pct}%`);

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
    const addChip = (fromX, fromY, x, y, w, label, cls, delay, title, chamfer = 0) => {
        const g = nodesG.append('g')
            .attr('class', cls)
            .attr('transform', `translate(${fromX}, ${fromY}) scale(0.1)`)
            .style('opacity', 0);
        if (title) {
            g.style('cursor', 'help').append('title').text(title);
        }
        if (chamfer) {
            g.append('path').attr('d', dossierCardPath(0, -9, w, 18, chamfer));
        } else {
            g.append('rect')
                .attr('x', 0).attr('y', -9).attr('width', w).attr('height', 18);
        }
        g.append('text')
            .attr('x', 9).attr('y', 4)
            .text(label);
        g.transition().delay(delay).duration(260).ease(d3.easeBackOut.overshoot(1.5))
            .attr('transform', `translate(${x}, ${y}) scale(1)`)
            .style('opacity', 1);
        return g;
    };

    // Root chip echoes the panel's clipped corner (accent when truly isolated).
    addChip(col0, rootY, col0, rootY, rootW, nsName.toUpperCase(), isolated ? 'ns-tree-root is-iso' : 'ns-tree-root', 120, null, 5);

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
    drawCgroupConceptCard,
    focusNamespaceProcesses,
    clearNamespaceProcessFocus,
};
})();
