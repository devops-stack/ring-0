// The card the HISTORY door of an IRQ card opens.
//
// The IRQ card is the path into the kernel: chip, handler, the inferred
// softirq, which CPU is allowed to take it. History is how that line has
// lived since boot — how many times it rang, what share of every interrupt
// that is, the mean rate over uptime, and whether it is hotter now than
// that mean. The kernel does not keep a clock of the first fire.
//
// Not a second device chain. Not another CPU bar.
const IrqHistoryCard = (() => {
    const W = 480;
    const PAD = 14;
    const CUT = 15;
    const HEADER = 25;
    const LINE = 16;
    const FOOTER = 34;
    const LABEL_W = 78;
    const POLL_MS = 2000;

    let openIrq = null;
    let topKeeper = null;
    let requestSeq = 0;
    let pollTimer = null;
    let lastAnchor = null;
    let lastNowRate = null;
    let lastSample = null;
    let layout = null;

    function clip(text, max) {
        const value = String(text || "");
        return value.length > max ? `${value.slice(0, max - 1)}…` : value;
    }

    function grouped(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return "—";
        return number.toLocaleString("en-US").replace(/,/g, " ");
    }

    function formatAge(seconds) {
        const s = Math.max(0, Math.floor(Number(seconds)));
        if (!Number.isFinite(Number(seconds)) || Number(seconds) <= 0) return "—";
        if (s < 60) return `${s}s`;
        if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
        if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
        return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
    }

    function formatRate(value) {
        if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
        const v = Number(value);
        if (v < 0.1) return `${v.toFixed(2)}/s`;
        if (v < 10) return `${v.toFixed(1)}/s`;
        return `${Math.round(v)}/s`;
    }

    function formatShare(value) {
        if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
        const pct = Number(value) * 100;
        if (pct < 0.1) return "<0.1%";
        if (pct < 10) return `${pct.toFixed(1)}%`;
        return `${Math.round(pct)}%`;
    }

    function vsMean(nowRate, meanRate) {
        if (!Number.isFinite(Number(nowRate)) || !Number.isFinite(Number(meanRate))) return "—";
        const now = Number(nowRate);
        const mean = Number(meanRate);
        if (mean <= 0) return now > 0 ? "hotter · was silent over uptime" : "quiet";
        const delta = (now - mean) / mean;
        if (Math.abs(delta) < 0.08) return "in line with the mean";
        const pct = `${delta > 0 ? "+" : ""}${Math.round(delta * 100)}%`;
        return delta > 0 ? `hotter  ·  ${pct}` : `quieter  ·  ${pct}`;
    }

    function stopPoll() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    function close() {
        stopPoll();
        openIrq = null;
        lastAnchor = null;
        lastNowRate = null;
        lastSample = null;
        layout = null;
        requestSeq += 1;
        svg.selectAll(".irq-history-scrim, .irq-history-layer").remove();
        if (topKeeper) topKeeper.stop();
        d3.select("body").on("keydown.irqhistory", null);
        window.dispatchEvent(new CustomEvent("kcard-closed"));
    }

    function load(irq) {
        return fetch(`/api/irq/${encodeURIComponent(irq)}/history`, { cache: "no-store" })
            .then((r) => r.json());
    }

    function noteSample(data) {
        const total = Number(data && data.total);
        const ts = Date.now() / 1000;
        if (lastSample && lastSample.irq === data.irq && Number.isFinite(total)) {
            const dt = Math.max(0.2, ts - lastSample.ts);
            const delta = total - lastSample.total;
            if (delta >= 0) lastNowRate = delta / dt;
        }
        if (Number.isFinite(total)) lastSample = { irq: data.irq, total, ts };
    }

    function startPoll(irq) {
        stopPoll();
        pollTimer = setInterval(() => {
            if (openIrq !== irq) {
                stopPoll();
                return;
            }
            if (document.hidden) return;
            const seq = requestSeq;
            load(irq).then((data) => {
                if (seq !== requestSeq || openIrq !== irq) return;
                if (!data || data.found === false) {
                    close();
                    return;
                }
                noteSample(data);
                draw(data, lastAnchor, true);
            }).catch(() => {});
        }, POLL_MS);
    }

    function open(irq, anchor, nowRate) {
        const key = String(irq || "");
        if (!key) return;
        if (openIrq === key) {
            close();
            return;
        }
        close();
        openIrq = key;
        lastAnchor = anchor;
        lastNowRate = Number.isFinite(Number(nowRate)) ? Number(nowRate) : null;
        lastSample = null;
        const seq = ++requestSeq;
        load(key).then((data) => {
            if (seq !== requestSeq) return;
            if (!data || data.found === false) {
                openIrq = null;
                return;
            }
            noteSample(data);
            draw(data, anchor, false);
            startPoll(key);
        }).catch((err) => {
            if (seq !== requestSeq) return;
            openIrq = null;
            if (window.frontendLogger) {
                window.frontendLogger.error("irq history card failed to draw", {
                    source: "irq-history-card", stack: String((err && err.stack) || err)
                });
            }
        });
    }

    function cardHeight() {
        let h = HEADER + 12 + 10;
        h += LINE * 3;
        h += 16 + LINE;
        h += LINE * 4;
        h += 16 + LINE;
        h += LINE * 3;
        h += FOOTER;
        return h;
    }

    function draw(data, anchor, live) {
        const svgNode = svg.node();
        const viewW = (svgNode && svgNode.clientWidth) || window.innerWidth;
        const viewH = (svgNode && svgNode.clientHeight) || window.innerHeight;
        const cw = (live && layout) ? layout.cw : Math.min(W, viewW - 24);
        const compact = cw < 420;
        const h = cardHeight();

        let x;
        let y;
        if (live && layout) {
            x = layout.x;
            y = layout.y;
        } else {
            const from = anchor && Number.isFinite(anchor.x) ? anchor.x : 300;
            x = Number.isFinite(anchor && anchor.clearOf) ? anchor.clearOf : from + 40;
            if (x + cw + 16 > viewW) x = Math.max(12, from - cw - 40);
            if (x < 12) x = Math.max(12, viewW - cw - 16);
            y = (anchor && Number.isFinite(anchor.y) ? anchor.y : 120) - 30;
            y = Math.max(12, Math.min(viewH - h - 12, y));
        }
        layout = { x, y, cw, h };

        let layer;
        let panel;
        if (live) {
            layer = svg.select(".irq-history-layer");
            panel = layer.select(".irq-history-panel");
            if (layer.empty() || panel.empty()) return;
            panel.attr("transform", `translate(${x}, ${y})`);
            panel.select(".kcard-frame").attr("d", dossierCardPath(0, 0, cw, h, CUT));
            if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
                const connY = Math.max(y + 12, Math.min(y + h - 12, anchor.y));
                layer.select(".kcard-conn").attr("x2", x).attr("y2", connY);
            }
            panel.select(".irq-history-body").remove();
        } else {
            ensureDossierDefs();
            svg.append("rect")
                .attr("class", "irq-history-scrim")
                .attr("x", 0).attr("y", 0).attr("width", viewW).attr("height", viewH)
                .attr("fill", ensureFocusVeilGradient())
                .style("opacity", 0)
                .style("cursor", "pointer")
                .on("click", () => close())
                .transition().duration(200).style("opacity", 1);

            layer = svg.append("g").attr("class", "irq-history-layer");
            if (!topKeeper) {
                topKeeper = createOverlayTopKeeper(
                    "irq-history-scrim",
                    ["irq-history-layer"],
                    () => openIrq !== null
                );
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

            panel = layer.append("g")
                .attr("class", "irq-history-panel")
                .attr("transform", `translate(${x}, ${y})`)
                .on("click", (event) => event.stopPropagation());

            panel.append("path")
                .attr("class", "kcard-frame")
                .attr("d", dossierCardPath(0, 0, cw, h, CUT))
                .attr("filter", "url(#dossier-drop)")
                .attr("transform", `translate(0, ${h / 2}) scale(1, 0.02)`)
                .transition().delay(120).duration(200).ease(d3.easeCubicOut)
                .attr("transform", "translate(0,0) scale(1,1)");
        }

        const body = panel.append("g").attr("class", "irq-history-body");
        if (!live) {
            body.style("opacity", 0);
            body.transition().delay(250).duration(180).style("opacity", 1);
        }

        paintBody(body, data, cw, compact, h);
        d3.select("body").on("keydown.irqhistory", (event) => {
            if (event.key === "Escape") close();
        });
    }

    function paintBody(body, data, cw, compact, h) {
        const aggregate = data.kind === "aggregate";
        const title = aggregate
            ? `HISTORY · ${String(data.irq || "").toUpperCase()}`
            : `HISTORY · IRQ ${data.irq}`;
        const valueX = PAD + LABEL_W;
        const maxVal = compact ? 34 : 46;

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
        text("kcard-title", PAD + 12, HEADER / 2 + 3.5, clip(title, 36));
        text("kcard-meta", cw - 13, HEADER / 2 + 3.5,
            aggregate ? "COUNTER" : "LINE", true)
            .style("fill", "rgba(244, 244, 236, 0.5)");
        body.append("line")
            .attr("class", "kcard-divider")
            .attr("x1", 0).attr("y1", HEADER).attr("x2", cw).attr("y2", HEADER);

        let cy = HEADER + 12 + 10;

        function fact(label, value, accent) {
            text("kcard-section", PAD, cy, label);
            text(accent ? "kcard-signature" : "kcard-line", valueX, cy, clip(value || "—", maxVal));
            cy += LINE;
        }

        fact("DEVICE", clip(data.device || data.label || "—", maxVal));
        fact("CHIP", aggregate ? "kernel counter" : (data.chip || "—"));
        fact("UPTIME", `boot  ·  ${formatAge(data.uptime_s)} ago`);

        cy += 16;
        text("kcard-section", PAD, cy, "LIFE");
        cy += LINE;

        fact("COUNT", `${grouped(data.total)} since boot`, true);
        fact("MEAN", `${formatRate(data.lifetime_per_sec)} over uptime`);
        fact("SHARE", `${formatShare(data.share)} of all interrupts`);
        fact("CPU", data.top_cpu == null
            ? "—"
            : `CPU${data.top_cpu} took ${formatShare(data.top_cpu_share)}`);

        cy += 16;
        text("kcard-section", PAD, cy, "NOW");
        cy += LINE;

        fact("RATE", formatRate(lastNowRate));
        fact("VS MEAN", vsMean(lastNowRate, data.lifetime_per_sec));

        const soft = data.softirq;
        if (soft && soft.vector) {
            fact("SOFTIRQ", `${soft.vector}  ·  ${grouped(soft.total)} since boot`);
        } else {
            fact("SOFTIRQ", aggregate ? "none · this is the counter" : "not attributed");
        }

        body.append("line")
            .attr("class", "kcard-divider")
            .attr("x1", 0).attr("y1", h - FOOTER + 8).attr("x2", cw).attr("y2", h - FOOTER + 8);
        text("kcard-foot", PAD, h - 10, "ESC OR CLICK OUTSIDE TO CLOSE");
        text("kcard-foot", cw - PAD, h - 10, "/PROC/INTERRUPTS", true);
    }

    return { open, close, isOpen: () => openIrq !== null };
})();

window.IrqHistoryCard = IrqHistoryCard;
