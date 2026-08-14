// The card a parked thread opens when you ask what it is waiting for.
//
// Two kinds of answer live here, and they differ in how complete they can be.
//
// A pipe can be answered fully: it has no name, only an inode, so the other end
// is whoever else holds a descriptor on that inode — a fact, once someone has
// walked every descriptor on the machine.
//
// A futex cannot. The word a thread waits on is exact, and so is the set of
// threads waiting on the same word. The holder is not: userspace takes the lock
// without telling the kernel, and nothing in /proc records who won it. Rather
// than name a likely thread and call it the owner, the card says why the
// question has no answer here and lists the threads that are not waiting — on a
// contended lock that set is usually one thread long, and the reader can draw
// the conclusion the card refuses to assert.
const WaitsCard = (() => {
    const W = 580;
    const PAD = 14;
    const CUT = 15;
    const HEADER = 25;
    const LINE = 14;
    const ROW_STEP = 16;
    const FOOTER = 34;
    const MAX_ROWS = 8;

    const COL_NAME = 74;
    const COL_NOTE = 186;

    let openKey = null;
    let topKeeper = null;
    let requestSeq = 0;

    function clip(text, max) {
        const value = String(text || "");
        return value.length > max ? `${value.slice(0, max - 1)}…` : value;
    }

    // A sentence too long for the card is broken at a word, not cut off: these
    // lines carry the reason an answer is missing, and half of that is worse
    // than none.
    function wrap(text, max, lines) {
        const words = String(text || "").split(/\s+/).filter(Boolean);
        const out = [];
        let line = "";
        words.forEach((word) => {
            if (!line.length) line = word;
            else if (line.length + 1 + word.length <= max) line += ` ${word}`;
            else { out.push(line); line = word; }
        });
        if (line) out.push(line);
        if (out.length > lines) {
            return out.slice(0, lines - 1).concat(clip(out.slice(lines - 1).join(" "), max));
        }
        return out;
    }

    function close() {
        openKey = null;
        requestSeq += 1;
        svg.selectAll(".waits-card-scrim, .waits-card-layer").remove();
        if (topKeeper) topKeeper.stop();
        d3.select("body").on("keydown.waitscard", null);
        window.dispatchEvent(new CustomEvent("kcard-closed"));
    }

    function open(pid, tid, anchor) {
        const key = `${pid}:${tid}`;
        if (openKey === key) {
            close();
            return;
        }
        close();
        openKey = key;
        const seq = ++requestSeq;

        fetch(`/api/process/${pid}/thread/${tid}/wait`, { cache: "no-store" })
            .then((r) => r.json())
            .then((data) => {
                if (seq !== requestSeq) return;
                if (!data || data.error) {
                    openKey = null;
                    return;
                }
                draw(data, anchor);
            })
            .catch((err) => {
                if (seq !== requestSeq) return;
                openKey = null;
                if (window.frontendLogger) {
                    window.frontendLogger.error("waits card failed to draw", {
                        source: "waits-card", stack: String((err && err.stack) || err)
                    });
                }
            });
    }

    // The first line of the card: the call, and what kind of wait it is.
    function headline(data) {
        const on = data.waiting_on;
        if (on && on.kind === "futex" && on.op) {
            const flags = [on.op.name];
            if (on.op.private) flags.push("private");
            if (on.op.realtime) flags.push("realtime clock");
            return flags.join(" · ");
        }
        if (on && on.kind === "pipe") {
            return `${on.direction || "holding"} pipe:[${on.inode}]${on.fd === null || on.fd === undefined ? "" : ` on fd ${on.fd}`}`;
        }
        if (data.call) return data.wchan ? `${data.call} · ${data.wchan}` : data.call;
        return data.state_label || "not waiting in a call";
    }

    function draw(data, anchor) {
        const svgNode = svg.node();
        const viewW = (svgNode && svgNode.clientWidth) || window.innerWidth;
        const viewH = (svgNode && svgNode.clientHeight) || window.innerHeight;
        const cw = Math.min(W, viewW - 24);
        const compact = cw < 460;

        const on = data.waiting_on || null;
        const isFutex = !!on && on.kind === "futex";
        const isPipe = !!on && on.kind === "pipe";
        const isEpoll = !!on && on.kind === "epoll";
        const sources = data.sources || {};
        const parkedSrc = sources.parked_in || {};
        const endpointsSrc = sources.endpoints || {};

        const waiters = isFutex ? (on.waiters || []).slice(0, MAX_ROWS) : [];
        // A short list of siblings is an answer in itself; a long one is not,
        // and then only the threads that can be running are worth naming.
        const pool = isFutex ? (on.candidates || {}) : {};
        const poolTotal = Number(pool.total || 0);
        const listAll = poolTotal > 0 && poolTotal <= 6;
        const candidates = (listAll ? (pool.sample || []) : (pool.running || [])).slice(0, MAX_ROWS);
        const watched = isEpoll ? (on.watched || []).slice(0, MAX_ROWS) : [];
        const farEnd = isPipe ? (on.other_end || []).slice(0, MAX_ROWS) : [];
        const nearEnd = isPipe ? (on.same_end || []).slice(0, MAX_ROWS) : [];
        const seen = data.seen_waking || {};
        const seenWakers = (seen.wakers || []).slice(0, MAX_ROWS);
        const seenAvailable = !!seen.available;
        const locks = (data.locks || []).slice(0, 4);
        const ownerLines = isFutex
            ? wrap(`the kernel does not record it — ${(on.owner && on.owner.why) || ""}`,
                compact ? 52 : 76, 2)
            : [];

        const notes = [];
        if (!parkedSrc.available) notes.push("THE CALL A THREAD IS PARKED IN NEEDS THE ROOT COLLECTOR");
        else if (isPipe && !endpointsSrc.available) notes.push("PAIRING THE ENDS OF A PIPE NEEDS THE ROOT COLLECTOR");
        if (!seenAvailable) notes.push("WHO WAS SEEN WAKING IT NEEDS THE WAKEUP COLLECTOR");

        // ── height ─────────────────────────────────────────────────────────
        let h = HEADER + 12 + 10;
        h += LINE;                                   // headline
        if (isFutex && on.op) h += LINE;             // what that kind of wait means
        if (isPipe) h += LINE + LINE;                // what would end the wait, self-pipe note
        if (isFutex) h += 16 + LINE + LINE;          // the word
        if (isFutex) h += 16 + LINE + waiters.length * ROW_STEP;
        if (isFutex) h += 16 + LINE + ownerLines.length * LINE + LINE + candidates.length * ROW_STEP;
        if (isEpoll) h += 16 + LINE + LINE + watched.length * ROW_STEP + LINE;
        if (isPipe) h += 16 + LINE + Math.max(1, farEnd.length) * ROW_STEP;
        if (isPipe && nearEnd.length) h += 16 + LINE + nearEnd.length * ROW_STEP;
        if (!on) h += 16 + LINE;
        h += 16 + LINE + LINE + Math.max(1, seenWakers.length) * ROW_STEP;
        if (locks.length) h += 16 + LINE + locks.length * ROW_STEP;
        if (notes.length) h += 10 + notes.length * LINE;
        h += FOOTER;

        // This card is opened from inside another one, so where it lands says
        // whether the two are related. Beside its parent if the screen allows,
        // on either side; and when neither side fits, stacked over the parent
        // with a corner of it left showing, rather than dropped onto some
        // unrelated card across the map.
        const from = anchor && Number.isFinite(anchor.x) ? anchor.x : 300;
        const parent = (anchor && anchor.parent) || null;
        let x = Number.isFinite(anchor && anchor.clearOf) ? anchor.clearOf : from + 40;
        let y = (anchor && Number.isFinite(anchor.y) ? anchor.y : 120) - 30;
        let stacked = false;
        if (x + cw + 16 > viewW) {
            const beside = parent ? parent.x - cw - 26 : from - cw - 40;
            if (beside >= 12) {
                x = beside;
            } else if (parent) {
                x = Math.min(parent.x + 28, viewW - cw - 12);
                y = parent.y + 28;
                stacked = true;
            } else {
                x = Math.max(12, viewW - cw - 16);
            }
        }
        x = Math.max(12, x);
        y = Math.max(12, Math.min(viewH - h - 12, y));

        ensureDossierDefs();
        svg.append("rect")
            .attr("class", "waits-card-scrim")
            .attr("x", 0).attr("y", 0).attr("width", viewW).attr("height", viewH)
            .attr("fill", ensureFocusVeilGradient())
            .style("opacity", 0)
            .style("cursor", "pointer")
            .on("click", () => close())
            .transition().duration(200).style("opacity", 1);

        const layer = svg.append("g").attr("class", "waits-card-layer");
        if (!topKeeper) {
            topKeeper = createOverlayTopKeeper("waits-card-scrim", ["waits-card-layer"], () => openKey !== null);
        }
        topKeeper.start();

        if (!stacked && anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
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

        const body = panel.append("g").attr("class", "waits-card-body").style("opacity", 0);
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
            `WAITING · ${String(data.comm || data.process || "thread").toUpperCase()}`);
        text("kcard-meta", cw - 13, HEADER / 2 + 3.5, `TID ${data.tid}`, true)
            .style("fill", "rgba(244, 244, 236, 0.5)");
        body.append("line")
            .attr("class", "kcard-divider")
            .attr("x1", 0).attr("y1", HEADER).attr("x2", cw).attr("y2", HEADER);

        let cy = HEADER + 12 + 10;

        text("kcard-line", PAD, cy, clip(headline(data), compact ? 44 : 66));
        cy += LINE;
        if (isFutex && on.op) {
            text("kcard-summary", PAD, cy, clip(on.op.means, compact ? 52 : 74));
            cy += LINE;
        }
        if (isPipe) {
            text("kcard-summary", PAD, cy, clip(on.direction === "writing"
                ? "the write returns once a reader has taken what is in the pipe"
                : "the read returns when someone writes, or when the last writer closes it",
                compact ? 52 : 76));
            cy += LINE;
        }

        // ── the futex ──────────────────────────────────────────────────────
        if (isFutex) {
            cy += 16;
            text("kcard-section", PAD, cy, "THE WORD IT WAITS ON");
            cy += LINE;
            const bits = [on.word || "address unknown"];
            if (on.expected !== null && on.expected !== undefined) bits.push(`expected ${on.expected}`);
            bits.push(on.scope);
            text("kcard-waiter", PAD, cy, clip(bits.join("  ·  "), compact ? 44 : 66));
            cy += LINE;

            cy += 16;
            const n = Number(on.waiter_count || (on.waiters || []).length);
            text("kcard-section", PAD, cy,
                n === 1 ? "NO OTHER THREAD WAITS ON IT" : `WAITING ON IT TOGETHER · ${n} THREADS`);
            cy += LINE;
            waiters.forEach((w, i) => {
                const ty = cy + 4 + i * ROW_STEP;
                if (w.self) {
                    body.append("circle")
                        .attr("class", "kcard-glyph-dot")
                        .attr("cx", PAD - 6).attr("cy", ty - 3).attr("r", 1.5);
                }
                text(w.self ? "kcard-waiter" : "kcard-waiter-dim", PAD, ty, w.tid);
                text("kcard-waiter-dim", COL_NAME, ty, clip(w.comm, 14));
                if (w.self) text("kcard-inferred", COL_NOTE, ty, "this thread");
            });
            cy += waiters.length * ROW_STEP;

            cy += 16;
            text("kcard-section", PAD, cy, "WHO HOLDS IT");
            cy += LINE;
            ownerLines.forEach((line) => {
                text("kcard-summary", PAD, cy, line);
                cy += LINE;
            });
            let lead;
            if (!poolTotal) {
                lead = "EVERY THREAD OF THIS PROCESS WAITS ON IT — THE HOLDER IS ELSEWHERE";
            } else if (listAll) {
                lead = poolTotal === 1
                    ? "ONE THREAD OF THIS PROCESS IS NOT WAITING FOR IT"
                    : `THE ${poolTotal} THREADS OF THIS PROCESS THAT ARE NOT WAITING FOR IT`;
            } else if (candidates.length) {
                lead = `OF ${poolTotal} THREADS NOT WAITING FOR IT, THESE CAN BE RUNNING NOW`;
            } else {
                lead = `${poolTotal} THREADS ARE NOT WAITING FOR IT, AND NONE OF THEM IS RUNNING NOW`;
            }
            text("kcard-faint", PAD, cy, lead);
            cy += LINE;
            candidates.forEach((c, i) => {
                const ty = cy + 4 + i * ROW_STEP;
                text("kcard-waiter-dim", PAD, ty, c.tid);
                text("kcard-waiter-dim", COL_NAME, ty, clip(c.comm, 14));
                text(c.state === "R" ? "kcard-state is-run" : "kcard-faint", COL_NOTE, ty,
                    clip(c.state === "R" ? "on the cpu or queued" : (c.parked_in || c.state_label), 30));
            });
            cy += candidates.length * ROW_STEP;
        }

        // ── the epoll set ──────────────────────────────────────────────────
        if (isEpoll) {
            cy += 16;
            const total = Number(on.total || 0);
            text("kcard-section", PAD, cy,
                `WATCHING ${total} ${total === 1 ? "DESCRIPTOR" : "DESCRIPTORS"} · WAKES ON THE FIRST TO STIR`);
            cy += LINE;
            const kinds = Object.entries(on.kinds || {})
                .sort((a, b) => b[1] - a[1])
                .slice(0, compact ? 3 : 5)
                .map(([kind, n]) => `${n} ${kind}${n > 1 && !kind.endsWith("s") ? "s" : ""}`);
            text("kcard-summary", PAD, cy, clip(kinds.join("  ·  "), compact ? 52 : 74));
            cy += LINE;
            watched.forEach((w, i) => {
                const ty = cy + 4 + i * ROW_STEP;
                text("kcard-waiter-dim", PAD, ty, w.count > 1 ? `${w.count} ×` : `fd ${w.fd}`);
                text("kcard-waiter-dim", COL_NAME - 20, ty, clip(w.label || w.kind, compact ? 24 : 42));
                if (w.waiting_for) {
                    text("kcard-faint", cw - PAD, ty, `for ${w.waiting_for}`, true);
                }
            });
            cy += watched.length * ROW_STEP;
            const covered = watched.reduce((sum, w) => sum + (w.count || 1), 0);
            if (total > covered) {
                text("kcard-faint", PAD, cy + 4, `AND ${total - covered} MORE IN THE SET`);
                cy += LINE;
            }
        }

        // ── the pipe ───────────────────────────────────────────────────────
        if (isPipe) {
            cy += 16;
            text("kcard-section", PAD, cy, "THE OTHER END");
            cy += LINE;
            if (!farEnd.length) {
                text("kcard-faint", PAD, cy + 4,
                    "NO ONE HOLDS IT — A READ HERE RETURNS END OF FILE");
                cy += ROW_STEP;
            }
            farEnd.forEach((r, i) => {
                const ty = cy + 4 + i * ROW_STEP;
                text("kcard-waiter", PAD, ty, r.pid);
                text("kcard-waiter-dim", COL_NAME, ty, clip(r.comm, 16));
                text("kcard-faint", COL_NOTE, ty,
                    `fd ${r.fd} · ${on.direction === "reading" ? "writes into it" : "reads from it"}`);
            });
            if (farEnd.length) cy += farEnd.length * ROW_STEP;
            if (farEnd.length && farEnd.every((r) => r.pid === data.pid)) {
                text("kcard-faint", PAD, cy + 4,
                    "BOTH ENDS ARE HELD HERE — A PROCESS WAKING ITSELF");
                cy += LINE;
            }

            if (nearEnd.length) {
                cy += 16;
                text("kcard-section", PAD, cy, "SHARING THIS END");
                cy += LINE;
                nearEnd.forEach((r, i) => {
                    const ty = cy + 4 + i * ROW_STEP;
                    text("kcard-waiter-dim", PAD, ty, r.pid);
                    text("kcard-waiter-dim", COL_NAME, ty, clip(r.comm, 16));
                    text("kcard-faint", COL_NOTE, ty, `fd ${r.fd} · inherited copy`);
                });
                cy += nearEnd.length * ROW_STEP;
            }
        }

        if (!on) {
            cy += 16;
            text("kcard-faint", PAD, cy,
                data.call ? "THIS CALL WAITS ON NOTHING THAT CAN BE PAIRED FROM /PROC"
                    : "THIS THREAD IS NOT PARKED IN A CALL");
            cy += LINE;
        }

        // ── who was seen waking it ─────────────────────────────────────────
        cy += 16;
        text("kcard-section", PAD, cy, "WHO WAS SEEN WAKING IT");
        cy += LINE;
        const windowMs = Math.round(Number(seen.window_s || 0) * 1000);
        if (!seenAvailable) {
            text("kcard-faint", PAD, cy + 4, "NO WINDOW OF WAKEUPS IS AVAILABLE");
            cy += ROW_STEP;
        } else if (!seenWakers.length) {
            text("kcard-faint", PAD, cy + 4,
                windowMs
                    ? `NOBODY IN THE LAST ${windowMs} MS WINDOW — THAT IS A SAMPLE, NOT A CENSUS`
                    : "NOBODY IN THE LAST WINDOW — THAT IS A SAMPLE, NOT A CENSUS");
            cy += ROW_STEP;
        } else {
            text("kcard-summary", PAD, cy, clip(
                isFutex
                    ? `in the last ${windowMs} ms — not the holder now, the last one seen letting go`
                    : `in the last ${windowMs} ms window of sched_wakeup`,
                compact ? 52 : 76));
            cy += LINE;
            seenWakers.forEach((w, i) => {
                const ty = cy + 4 + i * ROW_STEP;
                const where = Object.entries(w.contexts || {}).sort((a, b) => b[1] - a[1])[0];
                const tag = w.idle ? "irq" : (where ? where[0] : "task");
                text(w.idle ? "kcard-faint" : "kcard-waiter", PAD, ty, w.tid === 0 ? "idle" : w.tid);
                text("kcard-waiter-dim", COL_NAME, ty, clip(w.comm, 14));
                text("kcard-faint", COL_NOTE, ty,
                    `${w.count}× · ${tag}${w.of && w.of.length > 1 ? ` · ${w.of.length} waiters` : ""}`);
            });
            cy += seenWakers.length * ROW_STEP;
        }

        if (locks.length) {
            cy += 16;
            text("kcard-section", PAD, cy, "FILE LOCKS HELD BY THIS PROCESS");
            cy += LINE;
            locks.forEach((row, i) => {
                const ty = cy + 4 + i * ROW_STEP;
                text("kcard-waiter-dim", PAD, ty, row.kind);
                text("kcard-waiter-dim", COL_NAME, ty, row.mode);
                text("kcard-faint", COL_NOTE, ty, clip(
                    `${row.path || row.inode}${row.waiting ? " · blocked on it" : ""}`,
                    compact ? 26 : 52));
            });
            cy += locks.length * ROW_STEP;
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
        text("kcard-foot", cw - PAD, h - 10, `/PROC/${data.pid}/TASK/${data.tid}`, true);

        d3.select("body").on("keydown.waitscard", (event) => {
            if (event.key === "Escape") close();
        });
    }

    return {
        open,
        close,
        isOpen: () => openKey !== null
    };
})();

window.WaitsCard = WaitsCard;
