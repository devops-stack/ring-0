// The card the LOAD line of the subsystem panel opens.
//
// A load average is this queue's length, averaged: every five seconds the
// kernel counts the tasks that are runnable or stuck in an uninterruptible
// wait, and folds that count into three exponential curves. The three numbers
// say how crowded the machine has been. They never say who was in the crowd,
// and that is the whole point of this card.
//
// What it shows is one frame. The queue is rebuilt thousands of times a second,
// and every row here was printed by the kernel in a single pass over a single
// runqueue, so the vruntimes and deadlines can honestly be compared with each
// other. The price of that consistency is that the frame is a second or two
// old, and the footer says how old.
const RunqueueCard = (() => {
    const W = 660;
    const PAD = 14;
    const CUT = 15;
    const HEADER = 25;
    const LINE = 14;
    const ROW_STEP = 17;
    const FOOTER = 34;

    const COL_TASK = 62;
    const TASK_CHARS = 14;
    const COL_UNIT = 162;
    const UNIT_CHARS = 22;
    const COL_STANDING = 306;
    const STANDING_CHARS = 38;
    const VERDICT_INSET = 52;

    let isOpen = false;
    let topKeeper = null;
    let requestSeq = 0;

    function clip(text, max) {
        const value = String(text || "");
        return value.length > max ? `${value.slice(0, max - 1)}…` : value;
    }

    function num(value, digits) {
        const v = Number(value);
        if (!Number.isFinite(v)) return null;
        return Math.abs(v) >= 100 ? String(Math.round(v)) : v.toFixed(digits === undefined ? 1 : digits);
    }

    function close() {
        if (!isOpen) return;
        isOpen = false;
        requestSeq += 1;
        svg.selectAll(".runqueue-card-scrim, .runqueue-card-layer").remove();
        if (topKeeper) topKeeper.stop();
        d3.select("body").on("keydown.runqueuecard", null);
        window.dispatchEvent(new CustomEvent("kcard-closed"));
    }

    function open(anchor) {
        if (isOpen) {
            close();
            return;
        }
        isOpen = true;
        const seq = ++requestSeq;

        fetch("/api/runqueue", { cache: "no-store" })
            .then((r) => r.json())
            .then((data) => {
                if (seq !== requestSeq) return;
                if (!data || data.error) {
                    isOpen = false;
                    return;
                }
                draw(data, anchor);
            })
            .catch(() => {
                if (seq !== requestSeq) return;
                isOpen = false;
            });
    }

    // Why this task is in the queue at all: it holds the CPU, or it is waiting
    // for it. The observer is called out because reading the kernel's own
    // bookkeeping is what put it there.
    function standing(row) {
        if (row.observer) return row.current ? "on the cpu · reading this file" : "waiting · reads this file";
        if (row.current) return "on the cpu";
        if (row.rt) return "waiting · real-time class";
        return "waiting for the cpu";
    }

    function verdictLabel(row) {
        if (row.eligible === undefined || row.eligible === null) return null;
        const lag = num(row.vlag_ms);
        const mark = row.eligible ? "E" : "N";
        if (lag === null) return mark;
        return `${mark} ${Number(row.vlag_ms) > 0 ? "+" : ""}${lag}`;
    }

    function dueLabel(row) {
        const due = num(row.due_ms);
        return due === null ? null : `due ${due}`;
    }

    function nextLine(cpu) {
        const nxt = cpu.next;
        if (!nxt) return null;
        const named = nxt.tid
            ? (cpu.queue.find((r) => r.tid === nxt.tid) || {})
            : null;
        const who = named ? `${nxt.tid} ${String(named.comm || "").toUpperCase()}` : null;
        if (nxt.exact) return `NEXT: ${who} · ELIGIBLE, EARLIEST DEADLINE`;
        if (!who) return `NEXT: NOT DECIDABLE HERE · ${nxt.reason.toUpperCase()}`;
        return `NEXT IN ITS OWN QUEUE: ${who} · ${nxt.reason.toUpperCase()}`;
    }

    function draw(data, anchor) {
        const svgNode = svg.node();
        const viewW = (svgNode && svgNode.clientWidth) || window.innerWidth;
        const viewH = (svgNode && svgNode.clientHeight) || window.innerHeight;
        const cw = Math.min(W, viewW - 24);
        const compact = cw < 560;

        const colUnit = compact ? 150 : COL_UNIT;
        const colStanding = compact ? cw - PAD : COL_STANDING;
        const standingChars = compact ? 18 : STANDING_CHARS;

        const load = data.load || {};
        const scheduler = data.scheduler || {};
        const source = data.source || {};
        const cpus = Array.isArray(data.cpus) ? data.cpus : [];
        const hasVerdict = !!source.available && scheduler.name === "EEVDF";

        const notes = [];
        if (!source.available) {
            notes.push(source.reason === "no-collector"
                ? "NAMING THE QUEUE NEEDS THE ROOT COLLECTOR — THE AVERAGES NEED NOTHING"
                : `THE SNAPSHOT IS ${String(source.reason || "").toUpperCase()}`);
        } else if (!hasVerdict) {
            notes.push("THIS KERNEL SCHEDULES WITH CFS — IT KEEPS NO PER-TASK DEADLINE");
        } else {
            notes.push("E = ELIGIBLE NOW · LAG IS VIRTUAL MS OWED · EEVDF TAKES THE NEAREST DEADLINE");
            notes.push("ONE FRAME OF A QUEUE THAT IS REBUILT THOUSANDS OF TIMES A SECOND");
        }

        const named = cpus.reduce((all, c) => all + c.queue.length, 0);
        const drifted = source.available
            && Number.isFinite(Number(load.running))
            && load.running !== named;

        // ── height ─────────────────────────────────────────────────────────
        let h = HEADER + 12 + 10;
        h += LINE;                                   // counts · scheduler
        h += LINE;                                   // what a load average is
        if (data.uninterruptible) h += LINE;
        if (drifted) h += LINE;
        cpus.forEach((cpu) => {
            h += 16 + LINE + LINE;                   // section + legend
            h += Math.max(1, cpu.queue.length) * ROW_STEP;
            if (cpu.hidden) h += LINE;
            if (nextLine(cpu)) h += 6 + LINE;
        });
        if (!cpus.length) h += 16 + LINE;
        h += 10 + notes.length * LINE;
        h += FOOTER;

        const from = anchor && Number.isFinite(anchor.x) ? anchor.x : 240;
        let x = from + 44;
        if (x + cw + 16 > viewW) x = Math.max(12, viewW - cw - 16);
        let y = (anchor && Number.isFinite(anchor.y) ? anchor.y : 120) - h + 40;
        y = Math.max(12, Math.min(viewH - h - 12, y));

        ensureDossierDefs();
        svg.append("rect")
            .attr("class", "runqueue-card-scrim")
            .attr("x", 0).attr("y", 0).attr("width", viewW).attr("height", viewH)
            .attr("fill", ensureFocusVeilGradient())
            .style("opacity", 0)
            .style("cursor", "pointer")
            .on("click", () => close())
            .transition().duration(200).style("opacity", 1);

        const layer = svg.append("g").attr("class", "runqueue-card-layer");
        if (!topKeeper) {
            topKeeper = createOverlayTopKeeper("runqueue-card-scrim", ["runqueue-card-layer"], () => isOpen);
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

        const body = panel.append("g").attr("class", "runqueue-card-body").style("opacity", 0);
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
        text("kcard-title", PAD + 12, HEADER / 2 + 3.5, "RUN QUEUE");
        const avgs = [load.avg1, load.avg5, load.avg15]
            .filter((v) => Number.isFinite(Number(v)))
            .map((v) => Number(v).toFixed(2)).join("  ");
        text("kcard-meta", cw - 13, HEADER / 2 + 3.5, avgs ? `LOAD ${avgs}` : "", true)
            .style("fill", "rgba(244, 244, 236, 0.5)");
        body.append("line")
            .attr("class", "kcard-divider")
            .attr("x1", 0).attr("y1", HEADER).attr("x2", cw).attr("y2", HEADER);

        let cy = HEADER + 12 + 10;

        // ── what the averages are counting ─────────────────────────────────
        const running = Number.isFinite(Number(load.running)) ? Number(load.running) : data.queued;
        const identity = [
            `${running} RUNNABLE NOW`,
            Number.isFinite(Number(load.total)) ? `${load.total} THREADS ALIVE` : null,
            scheduler.name ? (scheduler.slice_ms
                ? `${scheduler.name} · SLICE ${scheduler.slice_ms} MS`
                : scheduler.name) : null
        ].filter(Boolean).join("  ·  ");
        text("kcard-line", PAD, cy, identity);
        cy += LINE;

        text("kcard-summary", PAD, cy, compact
            ? "the load average is this queue's length, averaged"
            : "a load average is this queue's length, averaged over one, five and fifteen minutes");
        cy += LINE;

        if (data.uninterruptible) {
            const n = data.uninterruptible;
            text("kcard-summary", PAD, cy,
                `${n} more ${n === 1 ? "task waits" : "tasks wait"} uninterruptibly — counted by the load, not by the cpu`);
            cy += LINE;
        }

        // The count above is live and the rows below are a frame old, so when
        // they disagree the card says which is which instead of letting the
        // reader decide the arithmetic is broken.
        if (drifted) {
            text("kcard-summary", PAD, cy,
                `the kernel counts ${load.running} runnable this instant; these ${named} are the last frame`);
            cy += LINE;
        }

        // ── one section per runqueue ───────────────────────────────────────
        cpus.forEach((cpu) => {
            cy += 16;
            const many = (data.cpu_count || 1) > 1;
            const depth = Number.isFinite(Number(cpu.nr_running)) ? cpu.nr_running : cpu.queued;
            text("kcard-section", PAD, cy,
                many ? `CPU ${cpu.cpu} · ${depth} IN THE QUEUE` : `WHO IS COMPETING · ${depth} IN THE QUEUE`);
            cy += LINE;

            text("kcard-stage", PAD, cy, "TID");
            text("kcard-stage", COL_TASK, cy, "TASK");
            if (!compact) text("kcard-stage", colUnit, cy, "UNIT");
            text("kcard-stage", colStanding, cy, "WHY IT IS HERE", compact);
            if (hasVerdict && !compact) {
                text("kcard-stage", cw - PAD - VERDICT_INSET, cy, "EEVDF", true);
                text("kcard-stage", cw - PAD, cy, "DEADLINE", true);
            }
            cy += LINE;

            if (!cpu.queue.length) {
                text("kcard-faint", PAD, cy + 4, "NOTHING QUEUED AT THIS INSTANT");
                cy += ROW_STEP;
            }

            cpu.queue.forEach((row, i) => {
                const ty = cy + 4 + i * ROW_STEP;
                if (row.current) {
                    body.append("circle")
                        .attr("class", "kcard-glyph-dot")
                        .attr("cx", PAD - 6).attr("cy", ty - 3).attr("r", 1.5);
                }
                text(row.current ? "kcard-waiter" : "kcard-waiter-dim", PAD, ty, row.tid);
                text(row.current ? "kcard-waiter" : "kcard-waiter-dim",
                    COL_TASK, ty, clip(row.comm, TASK_CHARS));
                if (!compact) {
                    text("kcard-faint", colUnit, ty, clip(row.unit || "—", UNIT_CHARS));
                }
                text(row.observer ? "kcard-inferred" : (row.current ? "kcard-state is-run" : "kcard-waiter-dim"),
                    colStanding, ty, clip(standing(row), standingChars), compact);

                if (hasVerdict && !compact) {
                    const verdict = verdictLabel(row);
                    const due = verdict ? dueLabel(row) : null;
                    text(verdict ? (row.eligible ? "kcard-symbol is-sleep" : "kcard-waiter-dim") : "kcard-faint",
                        cw - PAD - VERDICT_INSET, ty, verdict || "—", true)
                        .style("font-size", "9px");
                    if (due) {
                        text("kcard-waiter-dim", cw - PAD, ty, due, true)
                            .style("font-size", "9px");
                    }
                }
            });
            cy += Math.max(1, cpu.queue.length) * ROW_STEP;

            if (cpu.hidden) {
                text("kcard-faint", PAD, cy + 4, `+${cpu.hidden} MORE WAITING`);
                cy += LINE;
            }

            const next = nextLine(cpu);
            if (next) {
                cy += 6;
                text(cpu.next && cpu.next.exact ? "kcard-section" : "kcard-faint", PAD, cy, next);
                cy += LINE;
            }
        });

        if (!cpus.length) {
            cy += 16;
            text("kcard-faint", PAD, cy, "NO RUNQUEUE IN THE SNAPSHOT");
            cy += LINE;
        }

        cy += 10;
        notes.forEach((note) => {
            text("kcard-faint", PAD, cy, note);
            cy += LINE;
        });

        body.append("line")
            .attr("class", "kcard-divider")
            .attr("x1", 0).attr("y1", h - FOOTER + 8).attr("x2", cw).attr("y2", h - FOOTER + 8);
        text("kcard-foot", PAD, h - 10, "ESC OR CLICK OUTSIDE TO CLOSE");
        text("kcard-foot", cw - PAD, h - 10,
            source.available && Number.isFinite(Number(source.age_s))
                ? `FRAME FROM ${Number(source.age_s).toFixed(1)} S AGO`
                : "/PROC/LOADAVG", true);

        d3.select("body").on("keydown.runqueuecard", (event) => {
            if (event.key === "Escape") close();
        });
    }

    return {
        open,
        close,
        isOpen: () => isOpen
    };
})();

window.RunqueueCard = RunqueueCard;
