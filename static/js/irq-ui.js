// The INTERRUPTS panel in the bottom-left corner, and the route map that
// unfolds beside it on hover.
//
// The panel keeps the plain style of the live panels; the detail belongs to the
// card a click opens. The map is deliberately thin: it shows the line, the
// softirq vector its bottom half lands in, and the kernel function that vector
// runs — and nothing else. A line whose device class says nothing about the
// vector gets a map with one station and an admission, which is the honest
// shape of that answer.
(function initIrqUI(){
const PANEL_X = 30;
const PANEL_W = 232;
const TITLE_H = 22;
const HARD_ROW = 15;
const SOFT_ROW = 14;
const MAX_HARD = 5;
const MAX_SOFT = 4;
const MONO = 'Share Tech Mono, monospace';

let hoveredIrq = null;

function panelGeometry(hardCount, softCount) {
    const softLines = Math.ceil(softCount / 2);
    const height = TITLE_H + 8 + hardCount * HARD_ROW + 12 + softLines * SOFT_ROW + 10;
    return {
        x: PANEL_X,
        y: Math.max(20, window.innerHeight - height - 44),
        w: PANEL_W,
        h: height,
        softLines
    };
}

function clip(text, max) {
    const value = String(text || '');
    return value.length > max ? `${value.slice(0, max - 1)}~` : value;
}

function renderIrqStackPanel(executionData) {
    d3.selectAll('.irq-stack-group').remove();
    d3.selectAll('.irq-route-overlay').remove();
    if (isMobileLayout()) return;

    const irqStack = executionData && executionData.irq_stack ? executionData.irq_stack : {};
    const hardRows = (Array.isArray(irqStack.hard) ? irqStack.hard : []).slice(0, MAX_HARD);
    const softRows = (Array.isArray(irqStack.soft) ? irqStack.soft : []).slice(0, MAX_SOFT);
    const summary = irqStack.summary || {};
    if (!hardRows.length && !softRows.length) return;

    const svgRoot = d3.select('svg');
    const box = panelGeometry(hardRows.length, softRows.length);

    const group = svgRoot.append('g').attr('class', 'irq-stack-group');

    group.append('rect')
        .attr('x', box.x)
        .attr('y', box.y)
        .attr('width', box.w)
        .attr('height', box.h)
        .attr('rx', 8)
        .style('fill', '#333')
        .style('stroke', '#555')
        .style('stroke-width', '1px');

    group.append('text')
        .attr('x', box.x + 12)
        .attr('y', box.y + 15)
        .style('font-family', MONO)
        .style('font-size', '10px')
        .style('letter-spacing', '0.5px')
        .style('fill', '#c8ccd4')
        .text('INTERRUPTS');

    const hardTotal = Number(summary.hard_total_per_sec || 0);
    group.append('text')
        .attr('x', box.x + box.w - 12)
        .attr('y', box.y + 15)
        .attr('text-anchor', 'end')
        .style('font-family', MONO)
        .style('font-size', '9px')
        .style('fill', '#8b929c')
        .text(`${hardTotal.toFixed(0)}/s`);

    let y = box.y + TITLE_H + 16;
    hardRows.forEach((row) => {
        const rowY = y;
        const rowGroup = group.append('g')
            .style('cursor', 'pointer')
            .on('mouseenter', () => {
                hoveredIrq = String(row.irq);
                highlight.style('opacity', 1);
                drawIrqRouteOverlay(row, softRows, box, rowY);
            })
            .on('mouseleave', () => {
                hoveredIrq = null;
                highlight.style('opacity', 0);
                // Long enough to reach the map, which sits right beside the row.
                setTimeout(() => {
                    if (!window.__irqRouteMapHover && hoveredIrq === null) {
                        d3.selectAll('.irq-route-overlay').remove();
                    }
                }, 400);
            })
            .on('click', (event) => {
                event.stopPropagation();
                d3.selectAll('.irq-route-overlay').remove();
                if (window.IrqCard) {
                    window.IrqCard.open(
                        row,
                        { x: box.x + box.w, y: rowY - 4 },
                        { soft: softRows }
                    );
                }
            });

        const highlight = rowGroup.append('rect')
            .attr('x', box.x + 6)
            .attr('y', rowY - 11)
            .attr('width', box.w - 12)
            .attr('height', 14)
            .attr('rx', 3)
            .attr('fill', 'rgba(200, 204, 212, 0.10)')
            .style('opacity', 0);

        rowGroup.append('rect')
            .attr('x', box.x + 6)
            .attr('y', rowY - 11)
            .attr('width', box.w - 12)
            .attr('height', 14)
            .attr('fill', 'transparent');

        rowGroup.append('text')
            .attr('x', box.x + 12)
            .attr('y', rowY)
            .style('font-family', MONO)
            .style('font-size', '9px')
            .style('fill', '#d3d7de')
            .text(clip(row.irq, 4));

        rowGroup.append('text')
            .attr('x', box.x + 52)
            .attr('y', rowY)
            .style('font-family', MONO)
            .style('font-size', '9px')
            .style('fill', '#a9b0ba')
            .text(clip(row.device || row.label, 20));

        rowGroup.append('text')
            .attr('x', box.x + box.w - 12)
            .attr('y', rowY)
            .attr('text-anchor', 'end')
            .style('font-family', MONO)
            .style('font-size', '9px')
            .style('fill', '#c8ccd4')
            .text(`${Number(row.per_sec || 0).toFixed(1)}/s`);

        y += HARD_ROW;
    });

    group.append('line')
        .attr('x1', box.x + 12)
        .attr('x2', box.x + box.w - 12)
        .attr('y1', y - 7)
        .attr('y2', y - 7)
        .attr('stroke', 'rgba(120, 120, 120, 0.45)')
        .attr('stroke-width', 0.8);

    y += 6;
    softRows.forEach((row, index) => {
        const col = index % 2;
        const line = Math.floor(index / 2);
        const sx = box.x + 12 + col * 108;
        const sy = y + line * SOFT_ROW;
        group.append('text')
            .attr('x', sx)
            .attr('y', sy)
            .style('font-family', MONO)
            .style('font-size', '8.5px')
            .style('letter-spacing', '0.4px')
            .style('fill', '#8b929c')
            .text(clip(row.name, 8));
        group.append('text')
            .attr('x', sx + 96)
            .attr('y', sy)
            .attr('text-anchor', 'end')
            .style('font-family', MONO)
            .style('font-size', '8.5px')
            .style('fill', '#b6c7d8')
            .text(`${Number(row.per_sec || 0).toFixed(1)}/s`);
    });
}

// The identity of a line does not change while the machine is up, and the
// counters move slowly, so a hover does not have to ask twice. The short life
// keeps the CPU shares from freezing at whatever they were an hour ago.
const DETAIL_TTL_MS = 10000;
const detailCache = new Map();

function irqDetail(irq) {
    const cached = detailCache.get(irq);
    if (cached && (Date.now() - cached.at) < DETAIL_TTL_MS) {
        return Promise.resolve(cached.data);
    }
    return fetch(`/api/irq/${encodeURIComponent(irq)}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((data) => {
            detailCache.set(irq, { at: Date.now(), data });
            return data;
        });
}

// The stations of the route, in the order the interrupt visits them. Each one
// is something the machine reports: the wire, the CPU that answered, the
// deferred vector and the function that runs it. The vector is the single
// reasoned step, and it arrives on a dashed segment so the map says as much
// without a caption.
function routeStations(row, detail, softRows) {
    const vector = row.vector ? String(row.vector).toUpperCase() : null;
    const soft = vector
        ? (softRows || []).find((r) => String(r.name || '').toUpperCase() === vector)
        : null;
    const perCpu = (detail && Array.isArray(detail.per_cpu)) ? detail.per_cpu : [];
    const total = perCpu.reduce((a, b) => a + Number(b || 0), 0);
    const topCpu = perCpu.length
        ? perCpu.indexOf(Math.max(...perCpu))
        : (Number.isFinite(Number(row.top_cpu)) ? Number(row.top_cpu) : null);

    const stations = [];

    stations.push({
        title: detail && detail.kind === 'aggregate' ? String(row.irq) : `IRQ ${row.irq}`,
        lines: [
            clip(row.device || row.label, 22),
            detail && detail.chip
                ? clip([detail.chip, detail.type].filter(Boolean).join(' · '), 22)
                : null,
            `${Number(row.per_sec || 0).toFixed(1)}/s`
        ].filter(Boolean)
    });

    if (topCpu !== null) {
        const share = total ? (Number(perCpu[topCpu] || 0) / total) : 1;
        const allowed = detail && detail.affinity ? detail.affinity.allowed : null;
        stations.push({
            title: `CPU${topCpu}`,
            lines: [
                total ? `${(share * 100).toFixed(0)}% of this line` : 'answers the line',
                allowed ? `allowed ${allowed}` : null
            ].filter(Boolean),
            // One tick per online CPU, lit for the ones that took a share of
            // this line. On a single-CPU box that is one lit tick, honestly.
            ticks: perCpu.length ? perCpu.map((v) => Number(v || 0) / (total || 1)) : null
        });
    }

    if (vector) {
        stations.push({
            title: vector,
            lines: [
                soft ? `${Number(soft.per_sec || 0).toFixed(1)}/s measured` : 'softirq',
                'by driver class'
            ],
            dashedBefore: true,
            amber: true
        });
        if (soft && soft.symbol) {
            stations.push({
                title: String(soft.symbol),
                lines: ['runs the deferred half', 'in kallsyms']
            });
        }
    }

    // A driver that asked for a threaded handler is served by that kthread, so
    // the route ends there rather than in a softirq. Most lines have no thread
    // and the route ends at the function above.
    const thread = detail && detail.thread;
    if (thread) {
        stations.push({
            title: clip(thread.comm, 20),
            lines: [`pid ${thread.pid}`, 'threaded handler']
        });
    }

    return { stations, vector };
}

// The map itself. The line runs left to right and changes track with 45°
// jogs, each station carrying its own small block of text — the shape the
// panel has always used, now with only stations the machine can vouch for.
function drawIrqRouteOverlay(row, softRows, box, rowY) {
    const token = `${row.irq}:${Date.now()}`;
    window.__irqRouteToken = token;
    irqDetail(row.irq)
        .then((detail) => {
            if (window.__irqRouteToken !== token) return;
            paintRouteOverlay(row, softRows, box, rowY, detail || {});
        })
        .catch(() => {
            if (window.__irqRouteToken !== token) return;
            paintRouteOverlay(row, softRows, box, rowY, {});
        });
}

function paintRouteOverlay(row, softRows, box, rowY, detail) {
    d3.selectAll('.irq-route-overlay').remove();
    const svgRoot = d3.select('svg');
    const overlay = svgRoot.append('g').attr('class', 'irq-route-overlay');

    const { stations, vector } = routeStations(row, detail, softRows);

    const ROW_A = 64;
    const ROW_B = 96;
    const STEP = 150;
    const LEAD = 40;
    const TAIL = 118;

    // The frame ends under the deepest label rather than at a fixed height:
    // a two-station route would otherwise sit in a half-empty box.
    const deepest = stations.reduce((most, station, index) => (
        index % 2 === 0 ? most : Math.max(most, (station.lines || []).length || 1)
    ), 0);
    const MAP_H = ROW_B + 24 + Math.max(1, deepest) * 8 + 10;

    const mapX = box.x + box.w + 26;
    const wanted = LEAD + (stations.length - 1) * STEP + TAIL;
    const mapW = Math.min(wanted, window.innerWidth - mapX - 24);
    if (mapW < 260) return;
    const mapY = box.y + box.h - MAP_H;
    const step = stations.length > 1
        ? (mapW - LEAD - TAIL) / (stations.length - 1)
        : 0;

    overlay.append('path')
        .attr('class', 'kcard-frame')
        .attr('d', dossierCardPath(mapX, mapY, mapW, MAP_H, 13))
        .style('pointer-events', 'all')
        .on('mouseenter', () => { window.__irqRouteMapHover = true; })
        .on('mouseleave', () => {
            window.__irqRouteMapHover = false;
            d3.selectAll('.irq-route-overlay').remove();
        });

    overlay.append('path')
        .attr('d', `M ${box.x + box.w} ${rowY - 4} L ${mapX} ${mapY + MAP_H / 2}`)
        .attr('fill', 'none')
        .attr('stroke', 'rgba(118, 136, 155, 0.42)')
        .attr('stroke-width', 0.9)
        .attr('stroke-dasharray', '2 3');

    const label = (cls, x, y, value) => overlay.append('text')
        .attr('class', cls)
        .attr('x', x).attr('y', y)
        .text(value);

    label('kcard-section', mapX + 14, mapY + 18, 'ROUTE INTO THE KERNEL');
    overlay.append('text')
        .attr('class', 'kcard-note')
        .attr('x', mapX + mapW - 14).attr('y', mapY + 18)
        .attr('text-anchor', 'end')
        .text('CLICK THE ROW FOR THE CARD');

    if (!vector && stations.length < 2) {
        label('kcard-symbol', mapX + 14, mapY + 52, clip(row.device || row.label, 40));
        label('kcard-faint', mapX + 14, mapY + 70, 'NO SOFTIRQ VECTOR FOLLOWS FROM THIS DEVICE CLASS');
        return;
    }

    const at = (index) => ({
        x: mapX + LEAD + step * index,
        y: mapY + (index % 2 === 0 ? ROW_A : ROW_B),
        up: index % 2 === 0
    });

    // Each leg is its own path so the reasoned one can be dashed on its own.
    for (let i = 0; i < stations.length - 1; i += 1) {
        const from = at(i);
        const to = at(i + 1);
        const drop = Math.abs(to.y - from.y);
        const turn = to.x - drop;
        const d = drop
            ? `M ${from.x} ${from.y} L ${turn} ${from.y} L ${to.x} ${to.y}`
            : `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
        overlay.append('path')
            .attr('class', stations[i + 1].dashedBefore ? 'irq-track is-reasoned' : 'irq-track')
            .attr('d', d);
    }

    stations.forEach((station, index) => drawStation(overlay, at(index), station));
}

function drawStation(overlay, at, station) {
    overlay.append('circle')
        .attr('class', station.amber ? 'irq-station is-reasoned' : 'irq-station')
        .attr('cx', at.x).attr('cy', at.y).attr('r', 2.8);

    // Ruler ticks along the track, on the side the label does not occupy.
    if (Array.isArray(station.ticks)) {
        station.ticks.slice(0, 8).forEach((share, i) => {
            overlay.append('rect')
                .attr('class', share > 0.01 ? 'irq-tick is-lit' : 'irq-tick')
                .attr('x', at.x + 10 + i * 5)
                .attr('y', at.y + (at.up ? 5 : -9))
                .attr('width', 3)
                .attr('height', 4);
        });
    }

    const lines = (station.lines || []).slice(0, 3);
    const lx = at.x + 9;
    // A block above the track has to be lifted by its own height, or its last
    // line lands on the rail it belongs to.
    const ty = at.up
        ? at.y - 17 - Math.max(0, lines.length - 1) * 8
        : at.y + 15;
    overlay.append('text')
        .attr('class', 'irq-station-title')
        .attr('x', lx).attr('y', ty)
        .text(clip(station.title, 20));
    lines.forEach((line, i) => {
        overlay.append('text')
            .attr('class', line === 'by driver class' ? 'kcard-inferred' : 'irq-station-line')
            .attr('x', lx).attr('y', ty + 9 + i * 8)
            .text(clip(String(line).toUpperCase(), 24));
    });
}

window.IrqUI = {
    renderIrqStackPanel,
    drawIrqRouteOverlay
};
})();
