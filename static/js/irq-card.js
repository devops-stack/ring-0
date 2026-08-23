// The card a row of the INTERRUPTS panel opens.
//
// An interrupt line is a kernel element like any other, so it gets the same
// card as a syscall does: what device registered it, which chip delivers it,
// which CPU is allowed to take it and which one actually did, and what runs
// afterwards in softirq context.
//
// One stage of the chain is reasoned rather than measured — the kernel keeps no
// record of which softirq vector a given line raises, so it is concluded from
// the class of the device — and that stage is labelled as an inference instead
// of being dressed up as a reading. Everything else is off /sys and /proc.
//
// Rates come from the panel rather than from the request: the panel measures
// them across its polling interval, a far steadier window than one request
// could sample.
const IrqCard = (() => {
    const W = 430;
    const PAD = 14;
    const CUT = 15;
    const HEADER = 25;
    const LINE = 14;
    const CHAIN_STEP = 21;
    const BAR_STEP = 16;
    const FOOTER = 34;
    const MAX_CPU_BARS = 8;

    let openIrq = null;
    let topKeeper = null;
    let requestSeq = 0;
    let lastLayout = null;
    let lastRow = null;

    const SUBSYSTEM_TINT = {
        net: "rgba(103, 190, 224, 0.92)",
        drivers: "rgba(224, 175, 98, 0.95)",
        sched: "rgba(167, 200, 120, 0.9)",
        kernel: "rgba(176, 186, 198, 0.9)"
    };

    function grouped(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return "—";
        return number.toLocaleString("en-US").replace(/,/g, " ");
    }

    function clip(text, max) {
        const value = String(text || "");
        return value.length > max ? `${value.slice(0, max - 1)}…` : value;
    }

    function close() {
        openIrq = null;
        lastLayout = null;
        lastRow = null;
        requestSeq += 1;
        svg.selectAll(".irq-card-scrim, .irq-card-layer").remove();
        if (topKeeper) topKeeper.stop();
        d3.select("body").on("keydown.irqcard", null);
        if (window.IrqHistoryCard && typeof window.IrqHistoryCard.close === "function") {
            window.IrqHistoryCard.close();
        }
        window.dispatchEvent(new CustomEvent("irq-card-closed"));
    }

    // ``context`` carries what the panel already measured: the rate of this
    // line and the rates of the softirq vectors, both over the polling
    // interval. The card shows those rather than sampling its own.
    function open(row, anchor, context) {
        const irq = String((row && row.irq) || "");
        if (!irq) return;
        if (openIrq === irq) {
            close();
            return;
        }
        close();
        openIrq = irq;
        lastRow = row;
        const seq = ++requestSeq;

        fetch(`/api/irq/${encodeURIComponent(irq)}`, { cache: "no-store" })
            .then((r) => r.json())
            .then((data) => {
                if (seq !== requestSeq) return;
                if (!data || data.found === false) {
                    openIrq = null;
                    return;
                }
                draw(data, row, anchor, context || {});
            })
            .catch(() => {
                if (seq !== requestSeq) return;
                openIrq = null;
            });
    }

    function softirqRate(context, vector) {
        const rows = (context && context.soft) || [];
        const hit = rows.find((r) => String(r.name || "").toUpperCase() === String(vector || "").toUpperCase());
        return hit ? Number(hit.per_sec) : null;
    }

    function draw(data, row, anchor, context) {
        const svgNode = svg.node();
        const viewW = (svgNode && svgNode.clientWidth) || window.innerWidth;
        const viewH = (svgNode && svgNode.clientHeight) || window.innerHeight;
        const cw = Math.min(W, viewW - 24);

        const chain = Array.isArray(data.chain) ? data.chain : [];
        const children = Array.isArray(data.children) ? data.children : [];
        const perCpu = Array.isArray(data.per_cpu) ? data.per_cpu : [];
        const manyCpus = perCpu.length > 1;
        const cpuBars = manyCpus ? perCpu.slice(0, MAX_CPU_BARS) : [];

        const subsystem = String((row && row.subsystem) || "kernel").toLowerCase();
        const tint = SUBSYSTEM_TINT[subsystem] || SUBSYSTEM_TINT.kernel;

        // Height follows the content: an aggregate counter has no chain, a
        // single-CPU box has no distribution to draw, and only the hypervisor
        // callback has anything coming through it.
        let h = HEADER + 12 + LINE;
        if (data.summary || data.kind === "aggregate") h += LINE;
        h += 8 + LINE;
        if (chain.length) h += 16 + LINE + chain.length * CHAIN_STEP;
        h += 16 + LINE;
        h += manyCpus ? cpuBars.length * BAR_STEP : 0;
        if (children.length) h += 16 + LINE + children.length * BAR_STEP + LINE + 8;
        h += FOOTER;

        let x = 290;
        if (x + cw + 16 > viewW) x = Math.max(12, viewW - cw - 16);
        let y = (anchor && anchor.y ? anchor.y : viewH - h - 40) - 40;
        y = Math.max(12, Math.min(viewH - h - 12, y));
        lastLayout = { x, y, cw, h };

        ensureDossierDefs();
        svg.append("rect")
            .attr("class", "irq-card-scrim")
            .attr("x", 0).attr("y", 0).attr("width", viewW).attr("height", viewH)
            .attr("fill", ensureFocusVeilGradient())
            .style("opacity", 0)
            .style("cursor", "pointer")
            .on("click", () => close())
            .transition().duration(200).style("opacity", 1);

        const layer = svg.append("g").attr("class", "irq-card-layer");
        if (!topKeeper) {
            topKeeper = createOverlayTopKeeper("irq-card-scrim", ["irq-card-layer"], () => !!openIrq);
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

        const body = panel.append("g").attr("class", "irq-card-body").style("opacity", 0);
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

        // A lettered row is one of the kernel's own counters, not a wire, so it
        // is not announced as an IRQ number.
        const title = data.kind === "aggregate"
            ? `COUNTER · ${data.irq}`
            : `IRQ ${data.irq}${data.device ? ` · ${String(data.device).toUpperCase()}` : ""}`;
        text("kcard-title", PAD + 12, HEADER / 2 + 3.5, clip(title, window.IrqHistoryCard ? 20 : 36));
        if (window.IrqHistoryCard) {
            const metaLabel = subsystem.toUpperCase();
            const histW = 52;
            const histX = cw - 13 - Math.max(36, metaLabel.length * 6.8) - 18 - histW;
            const histLabel = text("kcard-signature", histX, HEADER / 2 + 3.5, "HISTORY")
                .attr("letter-spacing", 1.2);
            const histRule = body.append("line")
                .attr("x1", histX).attr("x2", histX + histW)
                .attr("y1", HEADER / 2 + 6.5).attr("y2", HEADER / 2 + 6.5)
                .attr("stroke", "#e2a33e")
                .attr("stroke-width", 1)
                .attr("opacity", 0.35);
            body.append("rect")
                .attr("x", histX - 6).attr("y", 4)
                .attr("width", histW + 12).attr("height", 18)
                .attr("fill", "transparent")
                .style("cursor", "pointer")
                .on("mouseenter", () => {
                    histRule.attr("opacity", 1);
                })
                .on("mouseleave", () => {
                    histRule.attr("opacity", 0.35);
                })
                .on("click", (event) => {
                    event.stopPropagation();
                    const box = lastLayout || { x: 0, y: 0, cw };
                    IrqHistoryCard.open(data.irq, {
                        x: box.x + histX + 20,
                        y: box.y + HEADER / 2,
                        clearOf: box.x + box.cw + 16
                    }, lastRow && lastRow.per_sec);
                });
        }
        text("kcard-meta", cw - 13, HEADER / 2 + 3.5, subsystem.toUpperCase(), true).style("fill", tint);
        body.append("line")
            .attr("class", "kcard-divider")
            .attr("x1", 0).attr("y1", HEADER).attr("x2", cw).attr("y2", HEADER);

        let cy = HEADER + 12 + 10;

        const aggregate = data.kind === "aggregate";
        const identity = aggregate
            ? String(data.summary || "kernel counter")
            : [data.chip, data.name, data.type].filter(Boolean).join("  ·  ");
        text("kcard-line", PAD, cy, clip(identity, 52));
        cy += LINE;

        const second = aggregate ? "the kernel counts this itself; no device is behind it" : data.summary;
        if (second) {
            text(aggregate ? "kcard-faint" : "kcard-summary", PAD, cy, clip(second, 56));
            cy += LINE;
        }

        cy += 8;
        const rate = row && Number.isFinite(Number(row.per_sec)) ? `${Number(row.per_sec).toFixed(1)}/s now` : null;
        text("kcard-signature", PAD, cy,
            [`${grouped(data.total)} since boot`, rate].filter(Boolean).join("   ·   "));
        cy += LINE;

        if (chain.length) {
            cy += 16;
            text("kcard-section", PAD, cy, "PATH INTO THE KERNEL");
            cy += LINE;

            const railX = PAD + 62;
            body.append("line")
                .attr("class", "kcard-rail")
                .attr("x1", railX).attr("y1", cy - 2)
                .attr("x2", railX).attr("y2", cy - 2 + (chain.length - 1) * CHAIN_STEP);

            chain.forEach((step, i) => {
                const sy = cy - 2 + i * CHAIN_STEP;
                const raises = step.stage === "raises";
                body.append("circle")
                    .attr("class", raises
                        ? "kcard-node is-sleep"
                        : (step.confirmed ? "kcard-node" : "kcard-node is-unconfirmed"))
                    .attr("cx", railX).attr("cy", sy).attr("r", raises ? 3.4 : 2.4);
                text("kcard-stage", PAD, sy + 3, String(step.stage || "").toUpperCase());

                // The vector carries the rate the panel measured for it, so the
                // reasoned stage is at least anchored to a real number.
                let symbol = String(step.symbol || "");
                if (raises) {
                    const vectorRate = softirqRate(context, step.symbol);
                    if (vectorRate !== null && Number.isFinite(vectorRate)) {
                        symbol = `${symbol}   ${vectorRate.toFixed(1)}/s`;
                    }
                }
                body.append("text")
                    .attr("class", raises ? "kcard-symbol is-sleep" : "kcard-symbol")
                    .attr("x", railX + 12).attr("y", sy + 3.5)
                    .style("opacity", step.confirmed ? 1 : 0.45)
                    .text(clip(symbol, 32));

                if (step.note) {
                    text(step.inferred ? "kcard-inferred" : "kcard-note",
                        cw - PAD, sy + 3.5, String(step.note).toUpperCase(), true);
                }
            });
            cy += chain.length * CHAIN_STEP;
        }

        cy += 16;
        text("kcard-section", PAD, cy, "WHICH CPU TAKES IT");
        cy += LINE;

        const affinity = data.affinity || {};
        const affinityNote = [
            affinity.allowed ? `ALLOWED ${affinity.allowed}` : null,
            data.cpus_online === 1 ? "ONLY CPU ONLINE" : null
        ].filter(Boolean).join(" · ");

        if (!manyCpus) {
            // One core, so the distribution is a foregone conclusion. Saying it
            // in a sentence beats drawing a bar that can only ever be full.
            text("kcard-symbol", PAD, cy, `CPU${(data.per_cpu && data.per_cpu.length ? 0 : 0)}`);
            text("kcard-line", PAD + 48, cy, "every one of them");
            if (affinityNote) text("kcard-note", cw - PAD, cy, affinityNote, true);
        } else {
            const total = perCpu.reduce((a, b) => a + Number(b || 0), 0) || 1;
            const top = Math.max(...cpuBars.map((v) => Number(v || 0)));
            const bx = PAD + 42;
            const bw = cw - bx - 74;
            cpuBars.forEach((value, index) => {
                const by = cy - 7 + index * BAR_STEP;
                const share = Number(value || 0) / total;
                text("kcard-stage", PAD, by + 7, `CPU${index}`);
                body.append("rect")
                    .attr("class", "kcard-bar-bg")
                    .attr("x", bx).attr("y", by).attr("width", bw).attr("height", 8).attr("rx", 1);
                body.append("rect")
                    .attr("class", Number(value || 0) === top ? "kcard-bar-fill is-top" : "kcard-bar-fill")
                    .attr("x", bx).attr("y", by)
                    .attr("width", 0).attr("height", 8).attr("rx", 1)
                    .transition().delay(280 + index * 40).duration(260).ease(d3.easeCubicOut)
                    .attr("width", Math.max(1.5, bw * share));
                text("kcard-faint", cw - PAD, by + 7, `${(share * 100).toFixed(0)}%`, true);
            });
            cy += cpuBars.length * BAR_STEP;
            if (affinityNote) text("kcard-note", PAD, cy - 1, affinityNote);
        }

        if (children.length) {
            cy += manyCpus ? 16 : 30;
            text("kcard-section", PAD, cy, "WHAT CAME THROUGH IT");
            cy += LINE;
            const childTotal = Number(data.children_total)
                || children.reduce((a, c) => a + Number(c.total || 0), 0) || 1;
            const top = Math.max(...children.map((c) => Number(c.total || 0)));
            const bx = PAD + 122;
            // The share and the count share the right margin, and the count of
            // a busy channel runs to nine digits, so it gets the room for them.
            const bw = cw - bx - 120;
            children.forEach((child, index) => {
                const by = cy - 7 + index * BAR_STEP;
                const share = Number(child.total || 0) / childTotal;
                text("kcard-symbol", PAD, by + 7, clip(`IRQ ${child.irq}  ${child.device || ""}`, 18));
                body.append("rect")
                    .attr("class", "kcard-bar-bg")
                    .attr("x", bx).attr("y", by).attr("width", bw).attr("height", 8).attr("rx", 1);
                body.append("rect")
                    .attr("class", Number(child.total || 0) === top ? "kcard-bar-fill is-top" : "kcard-bar-fill")
                    .attr("x", bx).attr("y", by)
                    .attr("width", 0).attr("height", 8).attr("rx", 1)
                    .transition().delay(280 + index * 40).duration(260).ease(d3.easeCubicOut)
                    .attr("width", Math.max(1.5, bw * share));
                text("kcard-faint", cw - PAD, by + 7,
                    `${(share * 100).toFixed(1)}%  ${grouped(child.total)}`, true);
            });
            cy += children.length * BAR_STEP;

            // The counter and the channels are read a moment apart, so the two
            // totals never match to the digit. Stating the coverage says what
            // the arithmetic is for without inviting a diff of two numbers.
            const covered = Math.round((childTotal / (Number(data.total) || childTotal)) * 100);
            const hidden = Number(data.children_hidden || 0);
            text("kcard-note", PAD, cy + 2,
                `THESE ACCOUNT FOR ${covered}% OF THE COUNTER`
                + (hidden ? ` · ${hidden} MORE CHANNEL${hidden === 1 ? "" : "S"}` : ""));
        }

        body.append("line")
            .attr("class", "kcard-divider")
            .attr("x1", 0).attr("y1", h - FOOTER + 8).attr("x2", cw).attr("y2", h - FOOTER + 8);
        text("kcard-foot", PAD, h - 10, "ESC OR CLICK OUTSIDE TO CLOSE");
        text("kcard-foot", cw - PAD, h - 10, "/SYS/KERNEL/IRQ · /PROC/INTERRUPTS", true);

        d3.select("body").on("keydown.irqcard", (event) => {
            if (event.key !== "Escape") return;
            if (window.IrqHistoryCard && IrqHistoryCard.isOpen()) return;
            close();
        });
    }

    return {
        open,
        close,
        isOpen: () => !!openIrq,
        openedIrq: () => openIrq
    };
})();

window.IrqCard = IrqCard;
