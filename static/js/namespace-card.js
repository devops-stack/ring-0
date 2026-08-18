// The card a namespace slice on the host ring opens.
//
// The ring is the architecture: seven kinds of world around the processes.
// The card is one kind — what it cuts off, how many worlds live on this
// host, who left the host world. A process name is a door into its dossier.
const NamespaceCard = (() => {
    const W = 520;
    const PAD = 14;
    const CUT = 15;
    const HEADER = 25;
    const LINE = 14;
    const ROW_STEP = 16;
    const FOOTER = 34;
    const MAX_WORLDS = 6;

    const MEANING = {
        mnt: "the filesystem tree this process is allowed to see",
        pid: "its own process tree — PID 1 is not the host's",
        net: "interfaces, ports and routes of one network world",
        ipc: "queues and shm that stay inside this world",
        uts: "hostname and domain this world answers to",
        user: "which UIDs and capabilities it believes it has",
        cgroup: "which cgroup tree is the root it can see",
        time: "boot and monotonic clocks of this world"
    };

    let openKey = null;
    let topKeeper = null;
    let lastAnchor = null;
    let lastNs = null;
    let layout = null;

    function clip(text, max) {
        const value = String(text || "");
        return value.length > max ? `${value.slice(0, max - 1)}…` : value;
    }

    function close() {
        openKey = null;
        lastAnchor = null;
        lastNs = null;
        layout = null;
        svg.selectAll(".namespace-card-scrim, .namespace-card-layer").remove();
        if (topKeeper) topKeeper.stop();
        d3.select("body").on("keydown.nscard", null);
        window.dispatchEvent(new CustomEvent("kcard-closed"));
    }

    function door(body, label, x, y, width, onOpen) {
        label.style("fill", "#e2a33e");
        const rule = body.append("line")
            .attr("x1", x).attr("y1", y + 2.5)
            .attr("x2", x + width).attr("y2", y + 2.5)
            .attr("stroke", "#e2a33e")
            .attr("stroke-width", 1)
            .attr("opacity", 0.35);
        body.append("rect")
            .attr("x", x - 3).attr("y", y - 9)
            .attr("width", width + 8).attr("height", 13)
            .attr("fill", "transparent")
            .style("cursor", "pointer")
            .on("mouseenter", () => rule.attr("opacity", 1))
            .on("mouseleave", () => rule.attr("opacity", 0.35))
            .on("click", (event) => {
                event.stopPropagation();
                onOpen();
            });
    }

    function followProcess(name) {
        if (!name) return;
        close();
        if (typeof window.openProcessDossier === "function") {
            window.openProcessDossier({ name });
        }
    }

    function open(ns, anchor) {
        if (!ns || !ns.id) return;
        const key = String(ns.id);
        if (openKey === key) {
            close();
            return;
        }
        if (typeof window.collapseNamespaceTree === "function") {
            window.collapseNamespaceTree(false);
        }
        if (typeof window.closeOpenKernelCards === "function") {
            window.closeOpenKernelCards();
        } else {
            close();
        }
        openKey = key;
        lastAnchor = anchor;
        lastNs = ns;
        draw(ns, anchor);
    }

    function worldsOf(ns) {
        return (Array.isArray(ns.worlds) ? ns.worlds : []).slice(0, MAX_WORLDS);
    }

    function cardHeight(ns) {
        const worlds = worldsOf(ns);
        let h = HEADER + 12 + 10;
        h += LINE + LINE;
        h += 16 + LINE;
        if (!worlds.length) h += LINE;
        else h += worlds.length * ROW_STEP;
        const hidden = Math.max(0, Number(ns.unique_count || 0) - worlds.length);
        if (hidden) h += LINE;
        h += FOOTER;
        return h;
    }

    function draw(ns, anchor) {
        const svgNode = svg.node();
        const viewW = (svgNode && svgNode.clientWidth) || window.innerWidth;
        const viewH = (svgNode && svgNode.clientHeight) || window.innerHeight;
        const cw = Math.min(W, viewW - 24);
        const compact = cw < 420;
        const h = cardHeight(ns);

        const from = anchor && Number.isFinite(anchor.x) ? anchor.x : viewW * 0.5;
        let x = Number.isFinite(anchor && anchor.clearOf) ? anchor.clearOf : from + 28;
        if (x + cw + 16 > viewW) x = Math.max(12, from - cw - 28);
        if (x < 12) x = Math.max(12, viewW - cw - 16);
        let y = (anchor && Number.isFinite(anchor.y) ? anchor.y : 120) - 24;
        y = Math.max(12, Math.min(viewH - h - 12, y));
        layout = { x, y, cw, h };

        svg.selectAll(".namespace-card-scrim, .namespace-card-layer").remove();
        ensureDossierDefs();
        svg.append("rect")
            .attr("class", "namespace-card-scrim")
            .attr("x", 0).attr("y", 0).attr("width", viewW).attr("height", viewH)
            .attr("fill", ensureFocusVeilGradient())
            .style("opacity", 0)
            .style("cursor", "pointer")
            .on("click", () => close())
            .transition().duration(200).style("opacity", 1);

        const layer = svg.append("g").attr("class", "namespace-card-layer");
        if (!topKeeper) {
            topKeeper = createOverlayTopKeeper(
                "namespace-card-scrim",
                ["namespace-card-layer"],
                () => openKey !== null
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

        const panel = layer.append("g")
            .attr("class", "namespace-card-panel")
            .attr("transform", `translate(${x}, ${y})`)
            .on("click", (event) => event.stopPropagation());

        panel.append("path")
            .attr("class", "kcard-frame")
            .attr("d", dossierCardPath(0, 0, cw, h, CUT))
            .attr("filter", "url(#dossier-drop)")
            .attr("transform", `translate(0, ${h / 2}) scale(1, 0.02)`)
            .transition().delay(120).duration(200).ease(d3.easeCubicOut)
            .attr("transform", "translate(0,0) scale(1,1)");

        const body = panel.append("g").attr("class", "namespace-card-body")
            .style("opacity", 0);
        body.transition().delay(250).duration(180).style("opacity", 1);
        paintBody(body, ns, cw, compact, h);
        d3.select("body").on("keydown.nscard", (event) => {
            if (event.key === "Escape") close();
        });
    }

    function paintBody(body, ns, cw, compact, h) {
        const isolated = !!ns.isolated || Number(ns.unique_count || 0) > 1;
        const name = String(ns.label || ns.id || "NS").toUpperCase();
        const meaning = MEANING[ns.id] || "a separate world for one kernel resource";
        const worlds = worldsOf(ns);
        const hostInode = ns.dominant_inode;
        const hidden = Math.max(0, Number(ns.unique_count || 0) - worlds.length);

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
        text("kcard-title", PAD + 12, HEADER / 2 + 3.5, `NAMESPACE · ${name}`);
        text("kcard-meta", cw - 13, HEADER / 2 + 3.5,
            isolated ? "ISOLATED" : "ONE WORLD", true)
            .style("fill", isolated ? "#e2a33e" : "rgba(244, 244, 236, 0.5)");
        body.append("line")
            .attr("class", "kcard-divider")
            .attr("x1", 0).attr("y1", HEADER).attr("x2", cw).attr("y2", HEADER);

        let cy = HEADER + 12 + 10;
        text("kcard-line", PAD, cy, clip(meaning, compact ? 42 : 62));
        cy += LINE;
        text("kcard-faint", PAD, cy, isolated
            ? "more than one world — someone left the host"
            : "every process shares this world with the host");
        cy += LINE;

        cy += 16;
        text("kcard-section", PAD, cy,
            `WORLDS ON THIS HOST · ${ns.unique_count || worlds.length}`);
        cy += LINE;

        if (!worlds.length) {
            text("kcard-faint", PAD, cy, "NO WORLD TABLE FOR THIS NAMESPACE");
            cy += LINE;
        }

        worlds.forEach((world) => {
            const ty = cy + 4;
            const names = (Array.isArray(world.sample) ? world.sample : []).filter(Boolean).slice(0, 3);
            const isHost = hostInode != null && String(world.inode) === String(hostInode);
            text(isHost ? "kcard-faint" : "kcard-waiter", PAD, ty, isHost ? "HOST" : "LEFT");
            const countText = text("kcard-waiter-dim", PAD + 52, ty, `${world.count}p · `);
            let x = PAD + 52 + countText.node().getBBox().width;
            if (!names.length) {
                text("kcard-waiter-dim", x, ty, "—");
            }
            names.forEach((name, idx) => {
                if (idx) {
                    const sep = text("kcard-faint", x, ty, " · ");
                    x += sep.node().getBBox().width;
                }
                const who = text("kcard-waiter-dim", x, ty, clip(name, compact ? 10 : 16));
                const box = who.node().getBBox();
                door(body, who, box.x, ty, box.width, () => followProcess(name));
                x += box.width;
            });
            cy += ROW_STEP;
        });
        if (hidden) {
            text("kcard-faint", PAD, cy, `AND ${hidden} SMALLER ${hidden === 1 ? "WORLD" : "WORLDS"}`);
        }

        body.append("line")
            .attr("class", "kcard-divider")
            .attr("x1", 0).attr("y1", h - FOOTER + 8).attr("x2", cw).attr("y2", h - FOOTER + 8);
        text("kcard-foot", PAD, h - 10, "ESC OR CLICK OUTSIDE TO CLOSE");
        text("kcard-foot", cw - PAD, h - 10, `/PROC/*/NS/${String(ns.id || "").toUpperCase()}`, true);
    }

    return { open, close, isOpen: () => openKey !== null };
})();

window.NamespaceCard = NamespaceCard;
