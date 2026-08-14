// The card a syscall row opens.
//
// A system call is a kernel element in its own right, so it gets its own card
// rather than borrowing the process dossier: the number this architecture
// assigns it, the prototype userspace calls it with, the chain of kernel
// symbols it travels through, and the tasks parked in it at this moment.
//
// Everything the card prints comes from the running machine. The chain is
// filtered against /proc/kallsyms, so a symbol this kernel inlined away is
// simply absent, and the last stage is the function the kernel itself reports
// in /proc/<pid>/wchan.
const SyscallCard = (() => {
    const W = 448;
    const PAD = 14;
    const CUT = 15;
    const HEADER = 25;
    const LINE = 14;
    const CHAIN_STEP = 21;
    const WAITER_STEP = 17;
    const FOOTER = 34;
    const MAX_WAITERS = 7;
    const MAX_CHARS = 58;

    let openName = null;
    let topKeeper = null;
    let requestSeq = 0;

    const SUBSYSTEM_TINT = {
        net: "rgba(103, 190, 224, 0.92)",
        fs: "rgba(188, 188, 188, 0.92)",
        sched: "rgba(167, 200, 120, 0.9)",
        mm: "rgba(180, 160, 214, 0.9)"
    };

    // The prototype is the one line that will not fit; break it on argument
    // boundaries so each line still reads as C.
    function wrapSignature(text, maxChars) {
        const words = String(text || "").split(" ").filter(Boolean);
        const lines = [];
        let line = "";
        words.forEach((word) => {
            if (line && (line.length + word.length + 1) > maxChars) {
                lines.push(line);
                line = "    " + word;
            } else {
                line = line ? `${line} ${word}` : word;
            }
        });
        if (line) lines.push(line);
        return lines;
    }

    function clip(text, max) {
        const value = String(text || "");
        return value.length > max ? `${value.slice(0, max - 1)}…` : value;
    }

    function close() {
        openName = null;
        requestSeq += 1;
        svg.selectAll(".syscall-card-scrim, .syscall-card-layer").remove();
        if (topKeeper) topKeeper.stop();
        d3.select("body").on("keydown.syscallcard", null);
        window.dispatchEvent(new CustomEvent("kcard-closed"));
    }

    // ``tag`` is the subsystem the panel put on the row. The card reuses it
    // instead of the server's coarser mapping, so the header and the row the
    // card came from never disagree.
    function open(row, anchor, tag) {
        const name = String((row && row.name) || "");
        if (!name) return;
        if (openName === name) {
            close();
            return;
        }
        close();
        openName = name;
        const seq = ++requestSeq;

        fetch(`/api/syscall/${encodeURIComponent(name)}`, { cache: "no-store" })
            .then((r) => r.json())
            .then((data) => {
                // The user may have clicked elsewhere while this was in flight.
                if (seq !== requestSeq) return;
                draw(data, anchor, tag);
            })
            .catch(() => {
                if (seq !== requestSeq) return;
                openName = null;
            });
    }

    function draw(data, anchor, tag) {
        const svgNode = svg.node();
        const viewW = (svgNode && svgNode.clientWidth) || window.innerWidth;
        const viewH = (svgNode && svgNode.clientHeight) || window.innerHeight;

        // On a phone the card takes the width it can get, and the prototype
        // wraps to match rather than running off the frame.
        const cw = Math.min(W, viewW - 24);
        const maxChars = Math.max(24, Math.floor((cw - 2 * PAD) / 5.75));

        const chain = Array.isArray(data.chain) ? data.chain : [];
        const waiters = Array.isArray(data.waiters) ? data.waiters : [];
        const shownWaiters = waiters.slice(0, MAX_WAITERS);
        const signature = wrapSignature(data.signature, maxChars);
        const label = (tag && tag.text) || String(data.subsystem || "").toUpperCase();
        const tint = (tag && tag.color)
            || SUBSYSTEM_TINT[String(data.subsystem || "").toLowerCase()]
            || "rgba(176, 186, 198, 0.9)";

        // Height follows the content: an undocumented call has no prototype
        // line, and a call nobody is parked in has no task list.
        let h = HEADER + 12;
        h += LINE;                                    // nr / arch / source
        h += LINE;                                    // register convention
        if (signature.length) h += 8 + signature.length * LINE;
        if (data.summary) h += LINE;
        h += 16 + LINE;                               // "path into the kernel"
        h += chain.length * CHAIN_STEP;
        h += 16 + LINE;                               // "parked now"
        h += Math.max(1, shownWaiters.length) * WAITER_STEP;
        if (waiters.length > shownWaiters.length || (data.count || 0) > waiters.length) h += LINE;
        h += FOOTER;

        let x = 290;
        if (x + cw + 16 > viewW) x = Math.max(12, viewW - cw - 16);
        let y = (anchor && anchor.y ? anchor.y : 90) - 40;
        y = Math.max(12, Math.min(viewH - h - 12, y));

        ensureDossierDefs();
        svg.append("rect")
            .attr("class", "syscall-card-scrim")
            .attr("x", 0).attr("y", 0).attr("width", viewW).attr("height", viewH)
            .attr("fill", ensureFocusVeilGradient())
            .style("opacity", 0)
            .style("cursor", "pointer")
            .on("click", () => close())
            .transition().duration(200).style("opacity", 1);

        const layer = svg.append("g").attr("class", "syscall-card-layer");
        if (!topKeeper) {
            topKeeper = createOverlayTopKeeper("syscall-card-scrim", ["syscall-card-layer"], () => !!openName);
        }
        topKeeper.start();

        // A line back to the row that was clicked, so the card reads as that
        // row unfolding rather than as a window from nowhere.
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

        const body = panel.append("g").attr("class", "syscall-card-body").style("opacity", 0);
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
        text("kcard-title", PAD + 12, HEADER / 2 + 3.5, `SYSCALL · ${String(data.name || "").toUpperCase()}`);
        text("kcard-meta", cw - 13, HEADER / 2 + 3.5, label, true).style("fill", tint);
        body.append("line")
            .attr("class", "kcard-divider")
            .attr("x1", 0).attr("y1", HEADER).attr("x2", cw).attr("y2", HEADER);

        let cy = HEADER + 12 + 10;

        const identity = [
            data.nr === null || data.nr === undefined ? "NR UNKNOWN" : `NR ${data.nr}`,
            String(data.arch || "").toUpperCase(),
            data.source ? data.source : ""
        ].filter(Boolean).join("  ·  ");
        text("kcard-line", PAD, cy, identity);
        cy += LINE;

        text("kcard-faint", PAD, cy, String(data.abi || ""));
        cy += LINE;

        if (signature.length) {
            cy += 8;
            signature.forEach((line) => {
                text("kcard-signature", PAD, cy, line);
                cy += LINE;
            });
        }

        if (data.summary) {
            text("kcard-summary", PAD, cy, data.summary);
            cy += LINE;
        }

        // The path into the kernel: one rail, one node per confirmed stage.
        cy += 16;
        text("kcard-section", PAD, cy, "PATH INTO THE KERNEL");
        cy += LINE;

        const railX = PAD + 62;
        if (chain.length) {
            body.append("line")
                .attr("class", "kcard-rail")
                .attr("x1", railX).attr("y1", cy - 2)
                .attr("x2", railX).attr("y2", cy - 2 + (chain.length - 1) * CHAIN_STEP);
        }
        chain.forEach((step, i) => {
            const sy = cy - 2 + i * CHAIN_STEP;
            const sleeping = step.stage === "sleep";
            body.append("circle")
                .attr("class", sleeping ? "kcard-node is-sleep" : (step.confirmed ? "kcard-node" : "kcard-node is-unconfirmed"))
                .attr("cx", railX).attr("cy", sy).attr("r", sleeping ? 3.4 : 2.4);
            text("kcard-stage", PAD, sy + 3, String(step.stage || "").toUpperCase());
            text(sleeping ? "kcard-symbol is-sleep" : "kcard-symbol", railX + 12, sy + 3.5, clip(step.symbol, 34));
            if (step.note) text("kcard-note", cw - PAD, sy + 3.5, String(step.note).toUpperCase(), true);
        });
        cy += chain.length * CHAIN_STEP;

        // Who is standing in it right now.
        cy += 16;
        const count = Number(data.count || 0);
        text("kcard-section", PAD, cy, `PARKED NOW · ${count} ${count === 1 ? "TASK" : "TASKS"}`);
        cy += LINE;

        if (!shownWaiters.length) {
            text("kcard-faint", PAD, cy + 4, "NOBODY IS PARKED IN THIS CALL RIGHT NOW");
            cy += WAITER_STEP;
        }
        shownWaiters.forEach((waiter) => {
            const who = waiter.tid && waiter.tid !== waiter.pid
                ? `${waiter.pid}/${waiter.tid} ${waiter.comm || "unnamed"}`
                : `${waiter.pid} ${waiter.comm || "unnamed"}`;
            text("kcard-waiter", PAD, cy + 4, clip(who, 24));
            text("kcard-waiter-dim", PAD + 156, cy + 4,
                [waiter.state, waiter.wchan].filter(Boolean).join(" · "));
            if (waiter.fd_target) {
                text("kcard-waiter-dim", cw - PAD, cy + 4,
                    `fd ${waiter.fd} → ${clip(waiter.fd_target, 22)}`, true);
            }
            cy += WAITER_STEP;
        });

        const notListed = Math.max(0, count - shownWaiters.length);
        if (notListed) {
            text("kcard-faint", PAD, cy + 4, `+${notListed} MORE PARKED HERE`);
            cy += LINE;
        }

        body.append("line")
            .attr("class", "kcard-divider")
            .attr("x1", 0).attr("y1", h - FOOTER + 8).attr("x2", cw).attr("y2", h - FOOTER + 8);
        text("kcard-foot", PAD, h - 10, "ESC OR CLICK OUTSIDE TO CLOSE");
        const scope = (data.sample && data.sample.scope) === "machine" ? "WHOLE MACHINE" : "BACKEND ONLY";
        text("kcard-foot", cw - PAD, h - 10, scope, true);

        d3.select("body").on("keydown.syscallcard", (event) => {
            if (event.key === "Escape") close();
        });
    }

    return {
        open,
        close,
        isOpen: () => !!openName,
        openedName: () => openName
    };
})();

window.SyscallCard = SyscallCard;
