// The card the MEMORY tile of the process dossier opens.
//
// The tile is one number: how many megabytes of this process are sitting in
// RAM. The card is what that number is made of — the virtual map, the resident
// slice of it, the file the executable came from, the libraries, the heap and
// the stacks of the threads.
//
// Two files under /proc disagree about how complete they can be. The map names
// every area and is refused for a few processes; status always names the
// totals. The card draws the map when it has one and the totals either way,
// and says which of the two it is looking at.
const MemoryCard = (() => {
    const W = 600;
    const PAD = 14;
    const CUT = 15;
    const HEADER = 25;
    const LINE = 14;
    const ROW_STEP = 16;
    const FOOTER = 34;
    const BAR_H = 8;
    const MAX_LIBS = 8;
    const MAX_STACKS = 8;

    const KIND_TINT = {
        code: "#e2a33e",
        library: "rgba(226, 163, 62, 0.55)",
        heap: "rgba(244, 244, 236, 0.55)",
        stack: "rgba(244, 244, 236, 0.35)",
        anonymous: "rgba(244, 244, 236, 0.22)",
        file: "rgba(244, 244, 236, 0.18)",
        vdso: "rgba(244, 244, 236, 0.12)",
        device: "rgba(217, 138, 106, 0.55)",
        other: "rgba(244, 244, 236, 0.12)"
    };

    let openPid = null;
    let topKeeper = null;
    let requestSeq = 0;

    function clip(text, max) {
        const value = String(text || "");
        return value.length > max ? `${value.slice(0, max - 1)}…` : value;
    }

    function kb(value) {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) return "—";
        if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} GB`;
        if (n >= 1024) return `${n >= 10240 ? Math.round(n / 1024) : (n / 1024).toFixed(1)} MB`;
        return `${Math.round(n)} KB`;
    }

    function close() {
        openPid = null;
        requestSeq += 1;
        svg.selectAll(".memory-card-scrim, .memory-card-layer").remove();
        if (topKeeper) topKeeper.stop();
        d3.select("body").on("keydown.memorycard", null);
        window.dispatchEvent(new CustomEvent("kcard-closed"));
    }

    function open(pid, anchor) {
        const key = Number(pid);
        if (!Number.isFinite(key)) return;
        if (openPid === key) {
            close();
            return;
        }
        close();
        openPid = key;
        const seq = ++requestSeq;
        fetch(`/api/process/${key}/memory`, { cache: "no-store" })
            .then((r) => r.json())
            .then((data) => {
                if (seq !== requestSeq) return;
                if (!data || data.error) {
                    openPid = null;
                    return;
                }
                draw(data, anchor);
            })
            .catch((err) => {
                if (seq !== requestSeq) return;
                openPid = null;
                if (window.frontendLogger) {
                    window.frontendLogger.error("memory card failed to draw", {
                        source: "memory-card", stack: String((err && err.stack) || err)
                    });
                }
            });
    }

    function draw(data, anchor) {
        const svgNode = svg.node();
        const viewW = (svgNode && svgNode.clientWidth) || window.innerWidth;
        const viewH = (svgNode && svgNode.clientHeight) || window.innerHeight;
        const cw = Math.min(W, viewW - 24);
        const compact = cw < 460;

        const totals = data.totals || {};
        const kinds = data.kinds || [];
        const libraries = (data.libraries || []).slice(0, MAX_LIBS);
        const stacks = (data.stacks || []).slice(0, MAX_STACKS);
        const sources = data.sources || {};
        const hasMap = !!(sources.maps && sources.maps.available);
        const viaCollector = !!(sources.maps && sources.maps.via === "collector");
        const hiddenLibs = Math.max(0, Number(data.library_count || 0) - libraries.length);
        const hiddenStacks = Math.max(0, Number(data.stack_count || 0) - stacks.length);

        const notes = [];
        if (!hasMap) notes.push("THE MAP ITSELF IS CLOSED — THESE TOTALS ARE FROM /PROC/PID/STATUS");

        let h = HEADER + 12 + 10;
        h += LINE + LINE;                    // resident / virtual
        if (hasMap && kinds.length) h += 16 + LINE + BAR_H + 8 + LINE;
        if (data.executable || data.heap_kb) h += 16 + LINE + (data.executable ? LINE : 0) + (data.heap_kb ? LINE : 0);
        if (stacks.length) h += 16 + LINE + stacks.length * ROW_STEP + (hiddenStacks ? LINE : 0);
        if (libraries.length) h += 16 + LINE + libraries.length * ROW_STEP + (hiddenLibs ? LINE : 0);
        if (!hasMap && !kinds.length) h += 16 + LINE + LINE;
        if (notes.length) h += 10 + notes.length * LINE;
        h += FOOTER;

        const from = anchor && Number.isFinite(anchor.x) ? anchor.x : 300;
        let x = Number.isFinite(anchor && anchor.clearOf) ? anchor.clearOf : from + 40;
        if (x + cw + 16 > viewW) x = Math.max(12, from - cw - 40);
        if (x < 12) x = Math.max(12, viewW - cw - 16);
        let y = (anchor && Number.isFinite(anchor.y) ? anchor.y : 120) - 30;
        y = Math.max(12, Math.min(viewH - h - 12, y));

        ensureDossierDefs();
        svg.append("rect")
            .attr("class", "memory-card-scrim")
            .attr("x", 0).attr("y", 0).attr("width", viewW).attr("height", viewH)
            .attr("fill", ensureFocusVeilGradient())
            .style("opacity", 0)
            .style("cursor", "pointer")
            .on("click", () => close())
            .transition().duration(200).style("opacity", 1);

        const layer = svg.append("g").attr("class", "memory-card-layer");
        if (!topKeeper) {
            topKeeper = createOverlayTopKeeper("memory-card-scrim", ["memory-card-layer"], () => openPid !== null);
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

        const body = panel.append("g").attr("class", "memory-card-body").style("opacity", 0);
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
        text("kcard-title", PAD + 12, HEADER / 2 + 3.5,
            `MEMORY · ${String(data.comm || "process").toUpperCase()}`);
        text("kcard-meta", cw - 13, HEADER / 2 + 3.5, `PID ${data.pid}`, true)
            .style("fill", "rgba(244, 244, 236, 0.5)");
        body.append("line")
            .attr("class", "kcard-divider")
            .attr("x1", 0).attr("y1", HEADER).attr("x2", cw).attr("y2", HEADER);

        let cy = HEADER + 12 + 10;

        const rss = kb(totals.rss_kb);
        const virt = kb(totals.virtual_kb);
        const pss = totals.pss_kb != null ? kb(totals.pss_kb) : null;
        const reservedKb = Number((kinds.find((k) => k.kind === "reserved") || {}).virtual_kb || 0);
        const committed = Number(totals.virtual_kb || 0) - reservedKb;
        text("kcard-line", PAD, cy, reservedKb
            ? `${rss} resident · ${kb(committed)} committed · ${kb(reservedKb)} reserved`
            : `${rss} resident of ${virt} mapped`);
        cy += LINE;
        const bits = [];
        if (pss) bits.push(`${pss} proportional`);
        if (totals.private_kb) bits.push(`${kb(totals.private_kb)} private`);
        if (totals.shared_kb) bits.push(`${kb(totals.shared_kb)} shared`);
        if (totals.swap_kb) bits.push(`${kb(totals.swap_kb)} swapped`);
        text("kcard-summary", PAD, cy, bits.length
            ? bits.join("  ·  ")
            : (totals.exe_kb != null
                ? `exe ${kb(totals.exe_kb)}  ·  libraries ${kb(totals.lib_kb)}  ·  data ${kb(totals.data_kb)}`
                : "resident size is all /proc will say"));
        cy += LINE;

        if (hasMap && kinds.length) {
            cy += 16;
            text("kcard-section", PAD, cy, "THE MAP · VIRTUAL SIZE");
            cy += LINE;
            const drawn = kinds.filter((k) => k.kind !== "reserved");
            const span = drawn.reduce((sum, k) => sum + Number(k.virtual_kb || 0), 0) || 1;
            const barX = PAD;
            const barW = cw - PAD * 2;
            let at = barX;
            drawn.forEach((k) => {
                const w = Math.max(1, barW * (Number(k.virtual_kb || 0) / span));
                body.append("rect")
                    .attr("x", at).attr("y", cy)
                    .attr("width", w).attr("height", BAR_H)
                    .attr("fill", KIND_TINT[k.kind] || KIND_TINT.other);
                at += w;
            });
            cy += BAR_H + 8;
            text("kcard-faint", PAD, cy, clip(
                drawn.slice(0, compact ? 3 : 5)
                    .map((k) => `${kb(k.virtual_kb)} ${k.kind}`)
                    .join("  ·  "),
                compact ? 48 : 72));
            cy += LINE;
        }

        if (data.executable || data.heap_kb) {
            cy += 16;
            text("kcard-section", PAD, cy, "WHAT IT IS MADE OF");
            cy += LINE;
            if (data.executable) {
                text("kcard-waiter", PAD, cy, "code");
                text("kcard-waiter-dim", 74, cy, clip(data.executable.name || data.executable.path, compact ? 22 : 36));
                text("kcard-faint", cw - PAD, cy, kb(data.executable.virtual_kb), true);
                cy += LINE;
            }
            if (data.heap_kb) {
                text("kcard-waiter-dim", PAD, cy, "heap");
                text("kcard-faint", cw - PAD, cy, kb(data.heap_kb), true);
                cy += LINE;
            }
        }

        if (stacks.length) {
            cy += 16;
            text("kcard-section", PAD, cy,
                Number(data.stack_count) === 1 ? "THE STACK" : `STACKS · ${data.stack_count} THREADS`);
            cy += LINE;
            stacks.forEach((s, i) => {
                const ty = cy + 4 + i * ROW_STEP;
                if (s.main) {
                    body.append("circle")
                        .attr("class", "kcard-glyph-dot")
                        .attr("cx", PAD - 6).attr("cy", ty - 3).attr("r", 1.5);
                }
                text("kcard-waiter-dim", PAD, ty, s.tid);
                text("kcard-faint", 74, ty, s.main ? "main" : "thread");
                text("kcard-faint", cw - PAD, ty, kb(s.virtual_kb), true);
            });
            cy += stacks.length * ROW_STEP;
            if (hiddenStacks) {
                text("kcard-faint", PAD, cy + 4, `AND ${hiddenStacks} MORE`);
                cy += LINE;
            }
        }

        if (libraries.length) {
            cy += 16;
            text("kcard-section", PAD, cy,
                `LIBRARIES · ${data.library_count} MAPPED`);
            cy += LINE;
            libraries.forEach((lib, i) => {
                const ty = cy + 4 + i * ROW_STEP;
                text("kcard-waiter-dim", PAD, ty, clip(lib.name, compact ? 22 : 40));
                text("kcard-faint", cw - PAD, ty, kb(lib.virtual_kb), true);
            });
            cy += libraries.length * ROW_STEP;
            if (hiddenLibs) {
                text("kcard-faint", PAD, cy + 4, `AND ${hiddenLibs} MORE`);
                cy += LINE;
            }
        }

        if (!hasMap && !kinds.length) {
            cy += 16;
            text("kcard-faint", PAD, cy, "THE KERNEL WILL NOT SHOW THE AREAS OF THIS PROCESS");
            cy += LINE;
            text("kcard-faint", PAD, cy, "EXE · LIB · DATA ARE THE TOTALS IT STILL PUBLISHES");
            cy += LINE;
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
        text("kcard-foot", cw - PAD, h - 10,
            hasMap
                ? (viaCollector ? "COLLECTOR · KINDS AND SIZES" : `/PROC/${data.pid}/MAPS`)
                : `/PROC/${data.pid}/STATUS`, true);

        d3.select("body").on("keydown.memorycard", (event) => {
            if (event.key === "Escape") close();
        });
    }

    return { open, close, isOpen: () => openPid !== null };
})();

window.MemoryCard = MemoryCard;
