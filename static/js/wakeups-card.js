// What the scheduler bar opens: who woke whom, over one sampled window.
//
// Every other card in this project shows a state that was simply there to be
// read. This one shows events that no longer exist by the time they are drawn,
// caught by a tracepoint for a quarter of a second at a time. That difference
// is the card's main honesty problem, so the window, its length and the gap
// between windows are said plainly rather than dressed up as a live feed.
const WakeupsCard = (() => {
    const W = 620;
    const PAD = 14;
    const CUT = 15;
    const HEADER = 25;
    const LINE = 14;
    const ROW_STEP = 16;
    const FOOTER = 34;
    const MAX_ROWS = 10;

    const COL_WOKEN = 220;
    const TIMES_INSET = 62;

    let isOpen = false;
    let topKeeper = null;
    let requestSeq = 0;

    const CONTEXT_TAG = { task: "task", softirq: "softirq", hardirq: "irq" };

    function clip(text, max) {
        const value = String(text || "");
        return value.length > max ? `${value.slice(0, max - 1)}…` : value;
    }

    function close() {
        isOpen = false;
        requestSeq += 1;
        svg.selectAll(".wakeups-card-scrim, .wakeups-card-layer").remove();
        if (topKeeper) topKeeper.stop();
        d3.select("body").on("keydown.wakeupscard", null);
        window.dispatchEvent(new CustomEvent("kcard-closed"));
    }

    function open(anchor) {
        if (isOpen) {
            close();
            return;
        }
        isOpen = true;
        const seq = ++requestSeq;
        fetch("/api/wakeups", { cache: "no-store" })
            .then((r) => r.json())
            .then((data) => {
                if (seq !== requestSeq) return;
                draw(data || {}, anchor);
            })
            .catch((err) => {
                if (seq !== requestSeq) return;
                isOpen = false;
                if (window.frontendLogger) {
                    window.frontendLogger.error("wakeups card failed to draw", {
                        source: "wakeups-card", stack: String((err && err.stack) || err)
                    });
                }
            });
    }

    // The dominant context is the one sentence worth drawing from a window:
    // it says whether this machine is woken by its own software or by the world
    // outside it.
    function verdict(contexts, events) {
        const rows = Object.entries(contexts || {})
            .map(([name, item]) => [name, Number((item && item.count) || 0)])
            .sort((a, b) => b[1] - a[1]);
        if (!rows.length || !events) return null;
        const [name, count] = rows[0];
        const share = Math.round((count / events) * 100);
        if (name === "hardirq") {
            return `${share}% of it came from hardware interrupts — this machine is woken from outside`;
        }
        if (name === "softirq") {
            return `${share}% of it came from deferred kernel work — the network and timer path`;
        }
        return `${share}% of it was one task deciding another should run`;
    }

    function side(end) {
        if (!end) return "";
        if (end.idle) return "idle cpu";
        const tid = end.tid === null || end.tid === undefined ? "" : ` ${end.tid}`;
        return `${clip(end.comm, 16)}${tid}`;
    }

    function draw(data, anchor) {
        const svgNode = svg.node();
        const viewW = (svgNode && svgNode.clientWidth) || window.innerWidth;
        const viewH = (svgNode && svgNode.clientHeight) || window.innerHeight;
        const cw = Math.min(W, viewW - 24);
        const compact = cw < 480;

        const available = !!data.available;
        const edges = (data.edges || []).slice(0, MAX_ROWS);
        const events = Number(data.events || 0);
        const window_s = Number(data.window_s || 0);
        const lost = Number(data.lost || 0);
        const line = available ? verdict(data.contexts, events) : null;
        const hasObserver = edges.some((e) => (e.waker && e.waker.observer)
            || (e.woken && e.woken.observer));

        // A pair with a big count and a task with many partners are different
        // shapes of busy: one is a conversation, the other is a hub.
        const hub = (row, verb) => (row && row.count
            ? `${clip(row.comm, 16)} ${row.tid} ${verb} ${row.count} times across ${row.partners} ${row.partners === 1 ? "task" : "tasks"}`
            : null);
        const hubs = available
            ? [hub((data.wakers || [])[0], "woke"), hub((data.wakees || [])[0], "was woken")]
                .filter(Boolean)
            : [];

        const reason = ((data.source || {}).reason) || "";
        const missing = available ? null
            : (reason === "stale" ? "THE LAST WINDOW IS TOO OLD TO SHOW"
                : "SAMPLING WAKEUPS NEEDS THE ROOT COLLECTOR");

        const notes = [];
        if (available) {
            notes.push("A WINDOW IS A SAMPLE — BETWEEN WINDOWS THE MACHINE WAKES UNOBSERVED");
            if (hasObserver) notes.push("THE SAMPLER WAKES WHAT IT READS — ITS OWN ROWS ARE MARKED");
            if (lost) notes.push(`${lost} EVENTS OVERRAN THE BUFFER AND WERE LOST`);
        }

        // ── height ─────────────────────────────────────────────────────────
        let h = HEADER + 12 + 10;
        if (!available) {
            h += LINE;
        } else {
            h += LINE;                       // how many, and whether any were lost
            h += LINE;                       // the split by context
            if (line) h += LINE;             // what that split means
            h += 16 + LINE + LINE + edges.length * ROW_STEP;
            if (hubs.length) h += 16 + LINE + hubs.length * LINE;
        }
        if (notes.length) h += 10 + notes.length * LINE;
        h += FOOTER;

        const from = anchor && Number.isFinite(anchor.x) ? anchor.x : 240;
        let x = Number.isFinite(anchor && anchor.clearOf) ? anchor.clearOf : from + 40;
        if (x + cw + 16 > viewW) x = Math.max(12, viewW - cw - 16);
        let y = (anchor && Number.isFinite(anchor.y) ? anchor.y : 120) - 24;
        y = Math.max(12, Math.min(viewH - h - 12, y));

        ensureDossierDefs();
        svg.append("rect")
            .attr("class", "wakeups-card-scrim")
            .attr("x", 0).attr("y", 0).attr("width", viewW).attr("height", viewH)
            .attr("fill", ensureFocusVeilGradient())
            .style("opacity", 0)
            .style("cursor", "pointer")
            .on("click", () => close())
            .transition().duration(200).style("opacity", 1);

        const layer = svg.append("g").attr("class", "wakeups-card-layer");
        if (!topKeeper) {
            topKeeper = createOverlayTopKeeper("wakeups-card-scrim", ["wakeups-card-layer"], () => isOpen);
        }
        topKeeper.start();

        if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
            const connY = Math.max(y + 12, Math.min(y + h - 12, anchor.y));
            layer.append("circle")
                .attr("class", "kcard-anchor")
                .attr("cx", anchor.x).attr("cy", anchor.y).attr("r", 3);
            layer.append("line")
                .attr("class", "kcard-conn")
                .attr("x1", anchor.x).attr("y1", anchor.y)
                .attr("x2", anchor.x).attr("y2", anchor.y)
                .transition().duration(220).ease(d3.easeCubicOut)
                .attr("x2", x).attr("y2", connY);
        }

        const panel = layer.append("g")
            .attr("transform", `translate(${x}, ${y})`)
            .on("click", (event) => event.stopPropagation());

        panel.append("path")
            .attr("class", "kcard-frame")
            .attr("d", dossierCardPath(0, 0, cw, h, CUT))
            .attr("filter", "url(#dossier-drop)")
            .attr("transform", `translate(0, ${h / 2}) scale(1, 0.02)`)
            .transition().delay(120).duration(200).ease(d3.easeCubicOut)
            .attr("transform", "translate(0,0) scale(1,1)");

        const body = panel.append("g").attr("class", "wakeups-card-body").style("opacity", 0);
        body.transition().delay(250).duration(180).style("opacity", 1);

        const text = (cls, tx, ty, value, anchorEnd) => body.append("text")
            .attr("class", cls)
            .attr("x", tx).attr("y", ty)
            .attr("text-anchor", anchorEnd ? "end" : "start")
            .text(value);

        body.append("path")
            .attr("class", "kcard-strip")
            .attr("d", `M0,0 H${cw - CUT} L${cw},${CUT} V${HEADER} H0 Z`);
        body.append("circle")
            .attr("class", "kcard-glyph-ring")
            .attr("cx", PAD).attr("cy", HEADER / 2).attr("r", 4.2);
        body.append("circle")
            .attr("class", "kcard-glyph-dot")
            .attr("cx", PAD).attr("cy", HEADER / 2).attr("r", 1.6);
        text("kcard-title", PAD + 12, HEADER / 2 + 3.5, "WAKEUPS · WHO STARTS WHOM");
        if (available && data.rate_per_s) {
            text("kcard-meta", cw - 13, HEADER / 2 + 3.5, `${data.rate_per_s} / S`, true)
                .style("fill", "rgba(244, 244, 236, 0.5)");
        }
        body.append("line")
            .attr("class", "kcard-divider")
            .attr("x1", 0).attr("y1", HEADER).attr("x2", cw).attr("y2", HEADER);

        let cy = HEADER + 12 + 10;

        if (!available) {
            text("kcard-faint", PAD, cy, missing);
            cy += LINE;
        } else {
            const ms = Math.round(window_s * 1000);
            text("kcard-line", PAD, cy,
                `${events} wakeups in a window of ${ms} ms${lost ? `, ${lost} lost` : ""}`);
            cy += LINE;

            const split = Object.entries(data.contexts || {})
                .sort((a, b) => (b[1].count || 0) - (a[1].count || 0))
                .map(([name, item]) => `${item.count} ${CONTEXT_TAG[name] || name}`);
            text("kcard-summary", PAD, cy, clip(split.join("  ·  "), compact ? 46 : 70));
            cy += LINE;
            if (line) {
                text("kcard-summary", PAD, cy, clip(line, compact ? 52 : 80));
                cy += LINE;
            }

            cy += 16;
            const distinct = Number(data.distinct_edges || edges.length);
            text("kcard-section", PAD, cy, distinct > edges.length
                ? `WHO WAKES WHOM · ${edges.length} BUSIEST OF ${distinct} PAIRS`
                : "WHO WAKES WHOM");
            cy += LINE;

            text("kcard-stage", PAD, cy, "WAKER");
            text("kcard-stage", COL_WOKEN, cy, "WOKEN");
            text("kcard-stage", cw - PAD - TIMES_INSET, cy, "TIMES", true);
            text("kcard-stage", cw - PAD, cy, "FROM", true);
            cy += LINE;

            edges.forEach((edge, i) => {
                const ty = cy + 4 + i * ROW_STEP;
                const waker = edge.waker || {};
                const woken = edge.woken || {};
                if (waker.observer || woken.observer) {
                    body.append("circle")
                        .attr("class", "kcard-glyph-dot")
                        .attr("cx", PAD - 6).attr("cy", ty - 3).attr("r", 1.5);
                }
                text(waker.idle ? "kcard-faint" : "kcard-waiter", PAD, ty, side(waker));
                text("kcard-waiter-dim", COL_WOKEN, ty, side(woken));
                text("kcard-waiter-dim", cw - PAD - TIMES_INSET, ty, edge.count, true);
                const where = Object.entries(edge.contexts || {})
                    .sort((a, b) => b[1] - a[1])[0];
                const tag = edge.new ? "first run" : (where ? (CONTEXT_TAG[where[0]] || where[0]) : "");
                text(where && where[0] === "hardirq" ? "kcard-symbol is-sleep" : "kcard-faint",
                    cw - PAD, ty, tag, true);
            });
            cy += edges.length * ROW_STEP;

            if (hubs.length) {
                cy += 16;
                text("kcard-section", PAD, cy, "THE BUSIEST ENDS OF THE WINDOW");
                cy += LINE;
                hubs.forEach((hubLine) => {
                    text("kcard-summary", PAD, cy, clip(hubLine, compact ? 52 : 78));
                    cy += LINE;
                });
            }
        }

        if (notes.length) {
            cy += 10;
            notes.forEach((note) => {
                text("kcard-faint", PAD, cy, note);
                cy += LINE;
            });
        }

        body.append("line")
            .attr("class", "kcard-divider")
            .attr("x1", 0).attr("y1", h - FOOTER + 8).attr("x2", cw).attr("y2", h - FOOTER + 8);
        text("kcard-foot", PAD, h - 10, "ESC OR CLICK OUTSIDE TO CLOSE");
        const age = Number((data.source || {}).age_s);
        if (Number.isFinite(age)) {
            text("kcard-foot", cw - PAD, h - 10, `WINDOW FROM ${age.toFixed(1)} S AGO`, true);
        }

        d3.select("body").on("keydown.wakeupscard", (event) => {
            if (event.key === "Escape") close();
        });
    }

    return {
        open,
        close,
        isOpen: () => isOpen
    };
})();

window.WakeupsCard = WakeupsCard;
