// The card the THREADS tile of the process dossier opens.
//
// A process owns the memory and the descriptors, but the thing Linux puts on a
// CPU is the thread. So the threads get a card of their own, in the same
// language as the syscall and interrupt cards: one row per task of the process,
// what it is doing, and what the scheduler has made of it.
//
// Each row carries two measurements that are easy to confuse and worth keeping
// apart. Time on the CPU is what the thread got. Time queued is what it spent
// runnable while the CPU was busy with something else — on a machine with one
// CPU that is usually the larger of the two, and it is the number that decides
// how the machine feels.
//
// The last column is the scheduler's own verdict, not our arithmetic: the
// kernel prints E or N for each task in debugfs, the lag beside it is how far
// that thread's virtual clock sits from the fair clock of its cgroup, and the
// deadline is what EEVDF actually compares when it picks. It is filled in only
// for the threads holding a place in the queue, which on an idle machine is one
// row out of twenty — a queue is the only thing those numbers describe.
//
// While the card is open it re-reads the same payload every couple of seconds
// and repaints the table. The frame stays put.
const ThreadsCard = (() => {
    const W = 640;
    const PAD = 14;
    const CUT = 15;
    const HEADER = 25;
    const LINE = 14;
    const ROW_STEP = 17;
    const FOOTER = 34;
    const MAX_ROWS = 16;

    // Column geometry of a row, at full width.
    const COL_NAME = 58;
    const NAME_CHARS = 15;
    const COL_STATE = 150;
    const COL_WHERE = 166;
    const WHERE_CHARS = 29;
    const BAR_X = 338;
    const BAR_W = 102;
    const COL_TIMES = 520;
    // Both scheduler columns are right-aligned, the verdict clear of the
    // deadline that follows it.
    const VERDICT_INSET = 52;
    const POLL_MS = 2000;

    let openPid = null;
    let topKeeper = null;
    let requestSeq = 0;
    let pollTimer = null;
    let lastAnchor = null;
    let layout = null;

    function clip(text, max) {
        const value = String(text || "");
        return value.length > max ? `${value.slice(0, max - 1)}…` : value;
    }

    // Durations here span microseconds to hours, so the unit moves with the
    // value rather than drowning the row in digits.
    function dur(ms) {
        const v = Number(ms);
        if (!Number.isFinite(v)) return "—";
        if (v >= 600000) return `${Math.round(v / 60000)}m`;
        if (v >= 60000) return `${(v / 60000).toFixed(1)}m`;
        if (v >= 1000) return `${(v / 1000).toFixed(1)}s`;
        if (v >= 1) return `${Math.round(v)}ms`;
        return v > 0 ? "<1ms" : "0";
    }

    function stopPoll() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    function close() {
        stopPoll();
        openPid = null;
        lastAnchor = null;
        layout = null;
        requestSeq += 1;
        svg.selectAll(".threads-card-scrim, .threads-card-layer").remove();
        if (topKeeper) topKeeper.stop();
        d3.select("body").on("keydown.threadscard", null);
        window.dispatchEvent(new CustomEvent("kcard-closed"));
    }

    function startPoll(pid) {
        stopPoll();
        pollTimer = setInterval(() => {
            if (openPid !== pid) {
                stopPoll();
                return;
            }
            if (document.hidden) return;
            const seq = requestSeq;
            fetch(`/api/process/${pid}/threads`, { cache: "no-store" })
                .then((r) => r.json())
                .then((data) => {
                    if (seq !== requestSeq || openPid !== pid) return;
                    if (!data || data.error) {
                        close();
                        return;
                    }
                    draw(data, lastAnchor, true);
                })
                .catch(() => {});
        }, POLL_MS);
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
        lastAnchor = anchor;
        const seq = ++requestSeq;

        fetch(`/api/process/${key}/threads`, { cache: "no-store" })
            .then((r) => r.json())
            .then((data) => {
                if (seq !== requestSeq) return;
                if (!data || data.error) {
                    openPid = null;
                    return;
                }
                draw(data, anchor, false);
                startPoll(key);
            })
            .catch(() => {
                if (seq !== requestSeq) return;
                openPid = null;
            });
    }

    // What the row says the thread is doing, preferring the call it is parked
    // in over the bare state letter, and never inventing one for the other.
    function whereLabel(thread, hasCollector) {
        if (thread.on_cpu) return "on the cpu now";
        // The state is read live and the parked call comes from a snapshot a
        // second or two old, so a thread that is running now outranks whatever
        // call it was last seen waiting in.
        if (thread.state === "R") return "runnable, queued";
        if (thread.parked_in) {
            return thread.wchan && thread.wchan !== "0"
                ? `${thread.parked_in} · ${thread.wchan}`
                : thread.parked_in;
        }
        if (!hasCollector) return thread.state_label || "";
        return thread.state === "S" ? "no call in flight" : (thread.state_label || "");
    }

    function stateClass(state) {
        if (state === "R") return "kcard-state is-run";
        if (state === "D") return "kcard-state is-block";
        return "kcard-state";
    }

    function verdictLabel(thread) {
        if (thread.eligible === undefined || thread.eligible === null) return null;
        const lag = Number(thread.vlag_ms);
        const mark = thread.eligible ? "E" : "N";
        if (!Number.isFinite(lag)) return mark;
        const sign = lag > 0 ? "+" : "";
        return `${mark} ${sign}${Math.abs(lag) >= 100 ? Math.round(lag) : lag.toFixed(1)}`;
    }

    // Virtual ms until this thread's turn must have happened; negative once the
    // deadline has passed, which is how a task gets picked next.
    function dueLabel(thread) {
        const due = Number(thread.due_ms);
        if (!Number.isFinite(due)) return null;
        return `due ${Math.abs(due) >= 100 ? Math.round(due) : due.toFixed(1)}`;
    }

    function draw(data, anchor, live) {
        const svgNode = svg.node();
        const viewW = (svgNode && svgNode.clientWidth) || window.innerWidth;
        const viewH = (svgNode && svgNode.clientHeight) || window.innerHeight;
        const cw = (live && layout) ? layout.cw : Math.min(W, viewW - 24);
        // Below this the table cannot hold every column, so the name and the
        // bar go and the row keeps what it cannot be read without.
        const compact = cw < 520;

        // Narrow, the name and the bar go and the remaining columns close up
        // rather than keeping the gaps they left behind.
        const colState = compact ? 52 : COL_STATE;
        const colWhere = compact ? 68 : COL_WHERE;
        const colTimes = compact ? cw - PAD : COL_TIMES;
        const whereChars = compact
            ? Math.max(10, Math.floor((colTimes - 82 - colWhere) / 5.4))
            : WHERE_CHARS;

        const all = Array.isArray(data.threads) ? data.threads : [];
        const rows = all.slice(0, MAX_ROWS);
        const totals = data.totals || {};
        const sources = data.sources || {};
        const hasCalls = !!(sources.parked_in && sources.parked_in.available);
        const schedulerName = (data.scheduler && data.scheduler.name) || null;
        const hasCollectorVerdict = !!(sources.scheduler && sources.scheduler.available);
        const hasVerdict = hasCollectorVerdict && schedulerName === "EEVDF";
        const hidden = Math.max(0, Number(data.thread_count || all.length) - rows.length);

        const notes = [];
        if (!hasCalls) notes.push("THE CALL EACH THREAD IS PARKED IN NEEDS THE ROOT COLLECTOR");
        else if (window.WaitsCard && !compact && rows.some((t) => t.parked_in)) {
            notes.push("CLICK WHAT A THREAD IS PARKED IN TO SEE WHAT IT IS WAITING FOR");
        }
        if (!hasCollectorVerdict) {
            notes.push("THE SCHEDULER VERDICT NEEDS THE ROOT COLLECTOR");
        } else if (!hasVerdict) {
            notes.push("THIS KERNEL SCHEDULES WITH CFS — IT KEEPS NO PER-THREAD DEADLINE");
        } else if (!compact) {
            notes.push("E = ELIGIBLE NOW · LAG IS VIRTUAL MS OWED · EEVDF TAKES THE NEAREST DEADLINE");
            notes.push("ONLY A QUEUED THREAD HAS EITHER — THE REST ARE ASLEEP AND HOLD NO PLACE");
        }

        let h = HEADER + 12;
        h += LINE;                              // count · cpus · scheduler
        h += LINE;                              // together on the cpu / queued
        h += 16 + LINE + LINE;                  // section, then the column legend
        h += rows.length * ROW_STEP;
        if (hidden) h += LINE;
        h += 10 + notes.length * LINE;
        h += FOOTER;

        // The card opens beside the dossier that spawned it, clear of the whole
        // stack rather than of the tile, so the two are read side by side.
        let x;
        let y;
        if (live && layout) {
            x = layout.x;
            y = Math.max(12, Math.min(viewH - h - 12, layout.y));
        } else {
            const from = anchor && Number.isFinite(anchor.x) ? anchor.x : 290;
            x = Number.isFinite(anchor && anchor.clearOf) ? anchor.clearOf : from + 44;
            if (x + cw + 16 > viewW) x = from - cw - 44;
            if (x < 12) x = Math.max(12, viewW - cw - 16);
            y = (anchor && anchor.y ? anchor.y : 90) - 40;
            y = Math.max(12, Math.min(viewH - h - 12, y));
        }
        layout = { x, y, cw, h };

        let layer;
        let panel;
        if (live) {
            layer = svg.select(".threads-card-layer");
            panel = layer.select(".threads-card-panel");
            if (layer.empty() || panel.empty()) return;
            panel.attr("transform", `translate(${x}, ${y})`);
            panel.select(".kcard-frame").attr("d", dossierCardPath(0, 0, cw, h, CUT));
            if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
                const connY = Math.max(y + 12, Math.min(y + h - 12, anchor.y));
                layer.select(".kcard-conn").attr("x2", x).attr("y2", connY);
            }
            panel.select(".threads-card-body").remove();
        } else {
            ensureDossierDefs();
            svg.append("rect")
                .attr("class", "threads-card-scrim")
                .attr("x", 0).attr("y", 0).attr("width", viewW).attr("height", viewH)
                .attr("fill", ensureFocusVeilGradient())
                .style("opacity", 0)
                .style("cursor", "pointer")
                .on("click", () => close())
                .transition().duration(200).style("opacity", 1);

            layer = svg.append("g").attr("class", "threads-card-layer");
            if (!topKeeper) {
                topKeeper = createOverlayTopKeeper("threads-card-scrim", ["threads-card-layer"], () => openPid !== null);
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
                .attr("class", "threads-card-panel")
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

        const body = panel.append("g").attr("class", "threads-card-body");
        if (!live) {
            body.style("opacity", 0);
            body.transition().delay(250).duration(180).style("opacity", 1);
        }

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
            `THREADS · ${String(data.comm || "process").toUpperCase()}`);
        text("kcard-meta", cw - 13, HEADER / 2 + 3.5, `PID ${data.pid}`, true)
            .style("fill", "rgba(244, 244, 236, 0.5)");
        body.append("line")
            .attr("class", "kcard-divider")
            .attr("x1", 0).attr("y1", HEADER).attr("x2", cw).attr("y2", HEADER);

        let cy = HEADER + 12 + 10;

        const count = Number(data.thread_count || all.length);
        const cpus = Number(data.cpus || 1);
        const scheduler = data.scheduler || {};
        const identity = [
            `${count} ${count === 1 ? "THREAD" : "THREADS"}`,
            `${cpus} ${cpus === 1 ? "CPU" : "CPUS"}`,
            scheduler.name ? `${scheduler.name} · SLICE ${scheduler.slice_ms} MS` : null
        ].filter(Boolean).join("  ·  ");
        text("kcard-line", PAD, cy, identity);
        cy += LINE;

        const ran = Number(totals.ran_ms || 0);
        const queued = Number(totals.waited_ms || 0);
        text("kcard-summary", PAD, cy, compact
            ? `${dur(ran)} on the cpu · ${dur(queued)} queued`
            : `together ${dur(ran)} on the cpu and ${dur(queued)} queued for it since they started`);
        cy += LINE;

        // ── the table ──────────────────────────────────────────────────────
        cy += 16;
        const parked = Number(totals.parked || 0);
        text("kcard-section", PAD, cy,
            parked ? `EACH THREAD · ${parked} PARKED IN A CALL` : "EACH THREAD");
        cy += LINE;

        text("kcard-stage", PAD, cy, "TID");
        if (!compact) text("kcard-stage", COL_NAME, cy, "NAME");
        text("kcard-stage", colWhere, cy, "WHERE IT IS");
        if (!compact) text("kcard-stage", BAR_X, cy, "ON CPU · QUEUED");
        text("kcard-stage", colTimes, cy, "TIME", true);
        if (hasVerdict && !compact) {
            text("kcard-stage", cw - PAD - VERDICT_INSET, cy, "EEVDF", true);
            text("kcard-stage", cw - PAD, cy, "DEADLINE", true);
        }
        cy += LINE;

        const spans = rows.map((t) => Number(t.ran_ms || 0) + Number(t.waited_ms || 0));
        const widest = Math.max(1, ...spans);

        rows.forEach((thread, i) => {
            const ty = cy + 4 + i * ROW_STEP;

            if (thread.leader) {
                body.append("circle")
                    .attr("class", "kcard-glyph-dot")
                    .attr("cx", PAD - 6).attr("cy", ty - 3).attr("r", 1.5);
            }
            text("kcard-waiter", PAD, ty, thread.tid);
            if (!compact) {
                text("kcard-waiter-dim", COL_NAME, ty, clip(thread.name, NAME_CHARS));
            }
            // Nearly every thread on a machine is asleep, and the next column
            // says what in. The letter is worth a glance only when it is not:
            // R is competing for the CPU, D is a wait nothing can interrupt.
            if (thread.state !== "S") {
                text(stateClass(thread.state), colState, ty, thread.state);
            }
            const where = text(thread.parked_in ? "kcard-waiter-dim" : "kcard-faint",
                colWhere, ty, clip(whereLabel(thread, hasCalls), whereChars));
            // A parked thread waits for something in particular, and that
            // something can often be named: the far end of a pipe, or the
            // other threads stuck on the same lock. The cell opens it.
            if (thread.parked_in && window.WaitsCard) {
                const box = where.node().getBBox();
                const rule = body.append("line")
                    .attr("x1", colWhere).attr("y1", ty + 2.5)
                    .attr("x2", colWhere + box.width).attr("y2", ty + 2.5)
                    .attr("stroke", "#e2a33e")
                    .attr("stroke-width", 1)
                    .attr("opacity", 0.35);
                body.append("rect")
                    .attr("x", colWhere - 3).attr("y", ty - 9)
                    .attr("width", box.width + 8).attr("height", 13)
                    .attr("fill", "transparent")
                    .style("cursor", "pointer")
                    .on("mouseenter", () => {
                        where.attr("fill", "#e2a33e");
                        rule.attr("opacity", 1);
                    })
                    .on("mouseleave", () => {
                        where.attr("fill", null);
                        rule.attr("opacity", 0.35);
                    })
                    .on("click", (event) => {
                        event.stopPropagation();
                        window.WaitsCard.open(data.pid, thread.tid, {
                            x: x + colWhere + box.width + 6,
                            y: y + ty - 3,
                            clearOf: x + cw + 26,
                            parent: { x: x, y: y, w: cw, h: h }
                        });
                    });
            }

            const span = spans[i];
            if (!compact && span > 0) {
                const width = Math.max(2, BAR_W * (span / widest));
                const onCpu = width * (Number(thread.ran_ms || 0) / span);
                body.append("rect")
                    .attr("class", "kcard-bar-bg")
                    .attr("x", BAR_X).attr("y", ty - 7)
                    .attr("width", BAR_W).attr("height", 6);
                body.append("rect")
                    .attr("class", "kcard-bar-fill")
                    .attr("x", BAR_X).attr("y", ty - 7)
                    .attr("width", width).attr("height", 6);
                if (onCpu > 0.5) {
                    body.append("rect")
                        .attr("class", "kcard-bar-fill is-top")
                        .attr("x", BAR_X).attr("y", ty - 7)
                        .attr("width", onCpu).attr("height", 6);
                }
            }

            text("kcard-waiter-dim", colTimes, ty,
                `${dur(thread.ran_ms)} · ${dur(thread.waited_ms)}`, true);

            if (hasVerdict && !compact) {
                const verdict = verdictLabel(thread);
                const due = verdict ? dueLabel(thread) : null;
                // A thread that holds no place in the queue has no lag and no
                // deadline, and the dash says so rather than leaving the row
                // looking like the collector missed it.
                text(verdict ? (thread.eligible ? "kcard-symbol is-sleep" : "kcard-waiter-dim")
                    : "kcard-faint",
                    cw - PAD - VERDICT_INSET, ty, verdict || "—", true)
                    .style("font-size", "9px");
                if (due) {
                    text("kcard-waiter-dim", cw - PAD, ty, due, true)
                        .style("font-size", "9px");
                }
            }
        });
        cy += rows.length * ROW_STEP;

        if (hidden) {
            text("kcard-faint", PAD, cy + 4, `+${hidden} MORE ${hidden === 1 ? "THREAD" : "THREADS"}`);
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
        text("kcard-foot", cw - PAD, h - 10, `/PROC/${data.pid}/TASK`, true);

        d3.select("body").on("keydown.threadscard", (event) => {
            if (event.key === "Escape") close();
        });
    }

    return {
        open,
        close,
        isOpen: () => openPid !== null,
        openedPid: () => openPid
    };
})();

window.ThreadsCard = ThreadsCard;
