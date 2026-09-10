// Machine-wide SLUB cache card opened from the MEMORY subsystem bar.
//
// /proc/slabinfo is root-only, so the browser reads a slow root snapshot via
// /api/slabinfo.  Its occupancy is aggregate: the little object cassettes show
// the cache-wide active ratio, never a fabricated view of one physical slab.
const SlubCard = (() => {
    const W = 620;
    const PAD = 14;
    const CUT = 15;
    const HEADER = 25;
    const LINE = 14;
    const ROW_H = 32;
    const FOOTER = 34;
    const MAX_ROWS = 10;

    let isOpen = false;
    let requestSeq = 0;
    let topKeeper = null;

    function clip(value, max) {
        const text = String(value || "");
        return text.length > max ? `${text.slice(0, max - 1)}…` : text;
    }

    function bytes(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return "—";
        if (number >= 1073741824) return `${(number / 1073741824).toFixed(1)} GB`;
        if (number >= 1048576) return `${(number / 1048576).toFixed(number >= 104857600 ? 0 : 1)} MB`;
        if (number >= 1024) return `${(number / 1024).toFixed(number >= 102400 ? 0 : 1)} KB`;
        return `${number} B`;
    }

    function close() {
        if (!isOpen) return;
        isOpen = false;
        requestSeq += 1;
        svg.selectAll(".slub-card-scrim, .slub-card-layer").remove();
        if (topKeeper) topKeeper.stop();
        d3.select("body").on("keydown.slubcard", null);
        window.dispatchEvent(new CustomEvent("kcard-closed"));
    }

    function open(anchor) {
        if (isOpen) {
            close();
            return;
        }
        isOpen = true;
        const seq = ++requestSeq;
        fetch("/api/slabinfo", { cache: "no-store" })
            .then((response) => response.json())
            .then((data) => {
                if (seq !== requestSeq) return;
                draw(data || {}, anchor);
            })
            .catch(() => {
                if (seq !== requestSeq) return;
                draw({
                    source: { available: false, reason: "request-failed" },
                    caches: [],
                    totals: {}
                }, anchor);
            });
    }

    function drawCassette(body, row, x, y, width) {
        const count = 12;
        const gap = 2;
        const cellW = (width - gap * (count - 1)) / count;
        const ratio = Math.max(0, Math.min(1, Number(row.occupancy) || 0));
        const active = Math.round(ratio * count);
        body.append("path")
            .attr("d", `M${x} ${y} H${x + 22} L${x + 28} ${y - 5} H${x + width} V${y + 13} H${x} Z`)
            .attr("fill", "rgba(244,244,236,0.025)")
            .attr("stroke", "rgba(244,244,236,0.18)")
            .attr("stroke-width", 0.7);
        for (let index = 0; index < count; index += 1) {
            body.append("rect")
                .attr("x", x + index * (cellW + gap))
                .attr("y", y + 3)
                .attr("width", cellW)
                .attr("height", 7)
                .attr("rx", 0.5)
                .attr("fill", index < active ? "rgba(226,163,62,0.72)" : "rgba(142,166,181,0.08)")
                .attr("stroke", index < active ? "rgba(226,163,62,0.38)" : "rgba(142,166,181,0.24)")
                .attr("stroke-width", 0.45);
        }
    }

    function draw(data, anchor) {
        const svgNode = svg.node();
        const viewW = (svgNode && svgNode.clientWidth) || window.innerWidth;
        const viewH = (svgNode && svgNode.clientHeight) || window.innerHeight;
        const cw = Math.min(W, viewW - 24);
        const compact = cw < 520;
        const source = data.source || {};
        const allCaches = Array.isArray(data.caches) ? data.caches : [];
        const caches = allCaches.slice(0, MAX_ROWS);
        const totals = data.totals || {};
        const rows = source.available ? Math.max(1, caches.length) : 2;
        const h = HEADER + 26 + LINE + 18 + rows * ROW_H + 22 + LINE + FOOTER;

        const from = anchor && Number.isFinite(anchor.x) ? anchor.x : 240;
        let x = from + 44;
        if (x + cw + 16 > viewW) x = Math.max(12, viewW - cw - 16);
        let y = (anchor && Number.isFinite(anchor.y) ? anchor.y : 120) - 44;
        y = Math.max(12, Math.min(viewH - h - 12, y));

        ensureDossierDefs();
        svg.append("rect")
            .attr("class", "slub-card-scrim")
            .attr("x", 0).attr("y", 0).attr("width", viewW).attr("height", viewH)
            .attr("fill", ensureFocusVeilGradient())
            .style("opacity", 0)
            .style("cursor", "pointer")
            .on("click", close)
            .transition().duration(200).style("opacity", 1);

        const layer = svg.append("g").attr("class", "slub-card-layer");
        if (!topKeeper) {
            topKeeper = createOverlayTopKeeper("slub-card-scrim", ["slub-card-layer"], () => isOpen);
        }
        topKeeper.start();

        if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
            const connY = Math.max(y + 12, Math.min(y + h - 12, anchor.y));
            layer.append("circle").attr("class", "kcard-anchor")
                .attr("cx", anchor.x).attr("cy", anchor.y).attr("r", 3);
            layer.append("line").attr("class", "kcard-conn")
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

        const body = panel.append("g").attr("class", "slub-card-body").style("opacity", 0);
        body.transition().delay(250).duration(180).style("opacity", 1);
        const text = (cls, tx, ty, value, end) => body.append("text")
            .attr("class", cls).attr("x", tx).attr("y", ty)
            .attr("text-anchor", end ? "end" : "start").text(value);

        body.append("path").attr("class", "kcard-strip")
            .attr("d", `M0,0 H${cw - CUT} L${cw},${CUT} V${HEADER} H0 Z`);
        body.append("circle").attr("class", "kcard-glyph-ring")
            .attr("cx", PAD).attr("cy", HEADER / 2).attr("r", 4.2);
        body.append("circle").attr("class", "kcard-glyph-dot")
            .attr("cx", PAD).attr("cy", HEADER / 2).attr("r", 1.6);
        text("kcard-title", PAD + 12, HEADER / 2 + 3.5, "SLUB · KERNEL OBJECT CACHES");
        text("kcard-meta", cw - 13, HEADER / 2 + 3.5,
            source.available ? `${data.cache_count || caches.length} CACHES` : "UNAVAILABLE", true)
            .style("fill", "rgba(244,244,236,0.5)");
        body.append("line").attr("class", "kcard-divider")
            .attr("x1", 0).attr("y1", HEADER).attr("x2", cw).attr("y2", HEADER);

        let cy = HEADER + 22;
        if (source.available) {
            const occupancy = Number(totals.num_objs)
                ? Number(totals.active_objs || 0) / Number(totals.num_objs)
                : 0;
            text("kcard-line", PAD, cy,
                `${bytes(totals.reserved_bytes)} reserved · ${bytes(totals.active_bytes)} active objects`);
            text("kcard-summary", cw - PAD, cy, `${Math.round(occupancy * 100)}% aggregate occupancy`, true);
            cy += LINE;
            text("kcard-faint", PAD, cy,
                "cache → slabs → fixed-size objects · rows ordered by reserved pages");
        } else {
            text("kcard-line", PAD, cy, "SLUB CACHE SNAPSHOT IS NOT AVAILABLE");
            cy += LINE;
            text("kcard-faint", PAD, cy,
                `SOURCE: ${String(source.reason || "unknown").toUpperCase()}`);
        }
        cy += 18;
        text("kcard-stage", PAD, cy, "CACHE");
        if (!compact) text("kcard-stage", 190, cy, "OBJECT");
        text("kcard-stage", cw - PAD, cy, "AGGREGATE ACTIVE RATIO", true);
        cy += 8;

        if (source.available && !caches.length) {
            text("kcard-faint", PAD, cy + 16, "THE SNAPSHOT CONTAINS NO CACHES");
        }

        caches.forEach((row, index) => {
            const top = cy + index * ROW_H;
            const ratio = Math.max(0, Math.min(1, Number(row.occupancy) || 0));
            const group = body.append("g")
                .style("cursor", window.KernelTape ? "pointer" : "default");
            const name = group.append("text")
                .attr("class", "kcard-signature")
                .attr("x", PAD).attr("y", top + 14)
                .text(`› ${clip(row.name, compact ? 16 : 22)}`);
            if (!compact) {
                group.append("text").attr("class", "kcard-faint")
                    .attr("x", 190).attr("y", top + 14)
                    .text(`${bytes(row.object_size)} × ${Number(row.num_objs || 0).toLocaleString()}`);
            }
            drawCassette(group, row, compact ? 182 : 342, top + 3, compact ? cw - 196 : cw - 356);
            group.append("text").attr("class", "kcard-faint")
                .attr("x", cw - PAD).attr("y", top + 28)
                .attr("text-anchor", "end")
                .text(`${Math.round(ratio * 100)}% · ${bytes(row.reserved_bytes)}`);
            group.insert("rect", ":first-child")
                .attr("x", PAD - 5).attr("y", top)
                .attr("width", cw - PAD * 2 + 10).attr("height", ROW_H - 2)
                .attr("fill", "rgba(226,163,62,0.025)")
                .attr("stroke", "rgba(226,163,62,0.28)")
                .attr("stroke-width", 0.6);
            if (window.KernelTape && typeof window.KernelTape.openSlubInspector === "function") {
                group.on("mouseenter", () => {
                    name.attr("fill", "#f0b757");
                    group.select("rect").attr("fill", "rgba(226,163,62,0.08)")
                        .attr("stroke", "rgba(226,163,62,0.72)");
                })
                    .on("mouseleave", () => {
                        name.attr("fill", null);
                        group.select("rect").attr("fill", "rgba(226,163,62,0.025)")
                            .attr("stroke", "rgba(226,163,62,0.28)");
                    })
                    .on("click", (event) => {
                        event.stopPropagation();
                        const payload = { cache: row, slabinfoData: data };
                        close();
                        window.KernelTape.openSlubInspector(payload);
                    });
            }
        });
        cy += rows * ROW_H + 10;
        if (source.available) {
            text("kcard-faint", PAD, cy,
                `+${Math.max(0, Number(data.hidden || 0) + Math.max(0, allCaches.length - MAX_ROWS))} OTHER CACHES NOT DRAWN`);
            text("kcard-signature", cw - PAD, cy, "CLICK A CACHE TO INSPECT", true);
        }

        body.append("line").attr("class", "kcard-divider")
            .attr("x1", 0).attr("y1", h - FOOTER + 8).attr("x2", cw).attr("y2", h - FOOTER + 8);
        text("kcard-foot", PAD, h - 10, "ESC OR CLICK OUTSIDE TO CLOSE");
        text("kcard-foot", cw - PAD, h - 10,
            source.available && Number.isFinite(Number(source.age_s))
                ? `/PROC/SLABINFO · ${Number(source.age_s).toFixed(1)} S AGO`
                : "ROOT SNAPSHOT REQUIRED", true);
        d3.select("body").on("keydown.slubcard", (event) => {
            if (event.key === "Escape") close();
        });
    }

    return { open, close, isOpen: () => isOpen };
})();

window.SlubCard = SlubCard;
