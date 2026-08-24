// The card the HISTORY door of the process dossier opens.
//
// The dossier is a now-picture: RSS, threads, sockets, a live activity tape,
// the spawn chain. History is the biography of this pid — when it started,
// who forked it, how long it has been alive, and the counters it has
// accumulated since then. It is not a second sparkline and not another
// lineage spine.
//
// Start time and parent come from /proc via lineage. Lifetime CPU, context
// switches, I/O, faults and the RSS high-water mark are the same class of
// counter ACTIVITY samples; here they stay totals, not rates.
const HistoryCard = (() => {
    const W = 520;
    const PAD = 14;
    const CUT = 15;
    const HEADER = 25;
    const LINE = 16;
    const FOOTER = 34;
    const LABEL_W = 78;
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

    function pad(n) {
        return String(n).padStart(2, "0");
    }

    function formatStamp(createTime) {
        const d = new Date(Number(createTime) * 1000);
        if (Number.isNaN(d.getTime())) return "—";
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}  ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    function formatAge(seconds) {
        const s = Math.max(0, Math.floor(Number(seconds)));
        if (!Number.isFinite(Number(seconds)) || Number(seconds) <= 0) return "—";
        if (s < 60) return `${s}s`;
        if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
        if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
        return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
    }

    function formatSpawnDelta(seconds) {
        const s = Number(seconds);
        if (!Number.isFinite(s)) return "";
        if (s < 1) return "+<1s after parent";
        if (s < 90) return `+${Math.round(s)}s after parent`;
        if (s < 5400) return `+${(s / 60).toFixed(1)}m after parent`;
        if (s < 172800) return `+${(s / 3600).toFixed(1)}h after parent`;
        return `+${(s / 86400).toFixed(1)}d after parent`;
    }

    function formatCpuSec(value) {
        if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
        const s = Number(value);
        if (s < 1) return `${s.toFixed(2)}s`;
        if (s < 60) return `${s.toFixed(1)}s`;
        if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
        return `${(s / 3600).toFixed(1)}h`;
    }

    function formatBytes(value) {
        if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
        const v = Number(value);
        if (v < 1024) return `${Math.round(v)} B`;
        if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
        if (v < 1024 * 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1)} MB`;
        return `${(v / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }

    function formatKb(value) {
        if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
        return formatBytes(Number(value) * 1024) || "—";
    }

    function formatCount(value) {
        if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
        const v = Number(value);
        if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
        if (v >= 10000) return `${Math.round(v / 1000)}k`;
        return String(Math.round(v));
    }

    function stateLabel(value) {
        const raw = String(value || "").toLowerCase().replace(/_/g, " ");
        if (!raw) return "—";
        if (raw === "disk sleep") return "disk-sleep";
        if (raw === "tracing stop") return "traced";
        if (raw === "wake kill") return "wake-kill";
        return raw;
    }

    function processHint(pid) {
        const index = window.__processIndex;
        if (!index || !index.byPid) return null;
        return index.byPid.get(Number(pid)) || null;
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
        svg.selectAll(".history-card-scrim, .history-card-layer").remove();
        if (topKeeper) topKeeper.stop();
        d3.select("body").on("keydown.historycard", null);
        window.dispatchEvent(new CustomEvent("kcard-closed"));
    }

    function load(pid) {
        return Promise.all([
            fetch(`/api/process/${pid}/lineage`, { cache: "no-store" }).then((r) => r.json()).catch(() => null),
            fetch(`/api/process/${pid}/activity`, { cache: "no-store" }).then((r) => r.json()).catch(() => null)
        ]).then(([lineage, activity]) => ({ lineage, activity }));
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
            load(pid).then((data) => {
                if (seq !== requestSeq || openPid !== pid) return;
                if (!data.lineage || data.lineage.error) {
                    close();
                    return;
                }
                draw(data, lastAnchor, true);
            }).catch(() => {});
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
        load(key).then((data) => {
            if (seq !== requestSeq) return;
            if (!data.lineage || data.lineage.error) {
                openPid = null;
                return;
            }
            draw(data, anchor, false);
            startPoll(key);
        }).catch((err) => {
            if (seq !== requestSeq) return;
            openPid = null;
            if (window.frontendLogger) {
                window.frontendLogger.error("history card failed to draw", {
                    source: "history-card", stack: String((err && err.stack) || err)
                });
            }
        });
    }

    function followProcess(pid, name) {
        close();
        if (typeof window.openProcessDossier === "function") {
            window.openProcessDossier({ pid, name });
        }
    }

    function door(body, label, x, y, width, onOpen) {
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
            .on("mouseenter", () => {
                label.attr("fill", "#e2a33e");
                rule.attr("opacity", 1);
            })
            .on("mouseleave", () => {
                label.attr("fill", null);
                rule.attr("opacity", 0.35);
            })
            .on("click", (event) => {
                event.stopPropagation();
                onOpen();
            });
    }

    function cardHeight() {
        let h = HEADER + 12 + 10;
        h += LINE * 4;
        h += 16 + LINE;
        h += LINE * 3;
        h += 16 + LINE;
        h += LINE * 6;
        h += FOOTER;
        return h;
    }

    function draw(data, anchor, live) {
        const svgNode = svg.node();
        const viewW = (svgNode && svgNode.clientWidth) || window.innerWidth;
        const viewH = (svgNode && svgNode.clientHeight) || window.innerHeight;
        const cw = (live && layout) ? layout.cw : Math.min(W, viewW - 24);
        const compact = cw < 440;
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
            layer = svg.select(".history-card-layer");
            panel = layer.select(".history-card-panel");
            if (layer.empty() || panel.empty()) return;
            panel.attr("transform", `translate(${x}, ${y})`);
            panel.select(".kcard-frame").attr("d", dossierCardPath(0, 0, cw, h, CUT));
            if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
                const connY = Math.max(y + 12, Math.min(y + h - 12, anchor.y));
                layer.select(".kcard-conn").attr("x2", x).attr("y2", connY);
            }
            panel.select(".history-card-body").remove();
        } else {
            ensureDossierDefs();
            svg.append("rect")
                .attr("class", "history-card-scrim")
                .attr("x", 0).attr("y", 0).attr("width", viewW).attr("height", viewH)
                .attr("fill", ensureFocusVeilGradient())
                .style("opacity", 0)
                .style("cursor", "pointer")
                .on("click", () => close())
                .transition().duration(200).style("opacity", 1);

            layer = svg.append("g").attr("class", "history-card-layer");
            if (!topKeeper) {
                topKeeper = createOverlayTopKeeper("history-card-scrim", ["history-card-layer"], () => openPid !== null);
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
                .attr("class", "history-card-panel")
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

        const body = panel.append("g").attr("class", "history-card-body");
        if (!live) {
            body.style("opacity", 0);
            body.transition().delay(250).duration(180).style("opacity", 1);
        }

        paintBody(body, data, cw, compact, h);
        d3.select("body").on("keydown.historycard", (event) => {
            if (event.key === "Escape") close();
        });
    }

    function paintBody(body, data, cw, compact, h) {
        const lineage = data.lineage || {};
        const activity = data.activity || {};
        const chain = Array.isArray(lineage.chain) ? lineage.chain : [];
        const self = chain.length ? chain[chain.length - 1] : null;
        const parent = chain.length > 1 ? chain[chain.length - 2] : null;
        const hint = processHint(lineage.pid);
        const comm = (self && self.name) || (hint && hint.name) || "process";
        const status = (self && self.status) || (hint && hint.status) || "";
        const username = (self && self.username) || "";
        const createTime = self && self.create_time;
        const age = self && self.age_s != null ? self.age_s : lineage.age_s;
        const forkDelta = parent && self && parent.create_time && self.create_time
            ? self.create_time - parent.create_time
            : null;
        const children = Array.isArray(lineage.children) ? lineage.children : [];
        const childCount = Number(lineage.child_count || children.length || 0);
        const ancestors = chain.slice(0, -1);
        const chainNames = ancestors.map((row) => clip(row.name || "?", 10));
        const shownChain = chainNames.length > (compact ? 3 : 5)
            ? [...chainNames.slice(0, 1), "…", ...chainNames.slice(-(compact ? 1 : 3))]
            : chainNames;

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
            `HISTORY · ${String(comm).toUpperCase()}`);
        text("kcard-meta", cw - 13, HEADER / 2 + 3.5, `PID ${lineage.pid}`, true)
            .style("fill", "rgba(244, 244, 236, 0.5)");
        body.append("line")
            .attr("class", "kcard-divider")
            .attr("x1", 0).attr("y1", HEADER).attr("x2", cw).attr("y2", HEADER);

        let cy = HEADER + 12 + 10;
        const valueX = PAD + LABEL_W;

        function fact(label, value, accent) {
            text("kcard-section", PAD, cy, label);
            text(accent ? "kcard-signature" : "kcard-line", valueX, cy, value || "—");
            cy += LINE;
        }

        fact("STARTED", createTime ? formatStamp(createTime) : "—", true);
        fact("AGE", formatAge(age));
        fact("STATE", stateLabel(status));
        fact("USER", username ? clip(username, compact ? 18 : 28) : "—");

        cy += 16;
        text("kcard-section", PAD, cy, "FORK");
        cy += LINE;

        text("kcard-section", PAD, cy, "PARENT");
        if (parent) {
            const parentName = clip(parent.name || "?", compact ? 12 : 16);
            const parentBits = [
                `pid ${parent.pid}`,
                formatSpawnDelta(forkDelta)
            ].filter(Boolean).join("  ·  ");
            const nameLabel = text("kcard-signature", valueX, cy, parentName);
            const nameW = parentName.length * 6.4;
            door(body, nameLabel, valueX, cy, nameW, () => followProcess(parent.pid, parent.name));
            text("kcard-faint", valueX + nameW + 10, cy, parentBits);
        } else {
            text("kcard-line", valueX, cy, Number(lineage.pid) === 1 ? "no parent · this is init" : "—");
        }
        cy += LINE;

        text("kcard-section", PAD, cy, "CHAIN");
        text("kcard-line", valueX, cy, shownChain.length
            ? `${shownChain.join(" → ")} → ${clip(comm, 12)}`
            : clip(comm, 20));
        cy += LINE;

        text("kcard-section", PAD, cy, "CHILDREN");
        if (childCount) {
            const names = children.slice(0, compact ? 2 : 4).map((c) => clip(c.name || "?", 10));
            const extra = childCount - names.length;
            text("kcard-line", valueX, cy,
                `${childCount}  ·  ${names.join("  ·  ")}${extra > 0 ? `  ·  +${extra}` : ""}`);
        } else {
            text("kcard-line", valueX, cy, "none");
        }
        cy += LINE;

        cy += 16;
        text("kcard-section", PAD, cy, "LIFETIME");
        cy += LINE;

        const userCpu = activity.cpu_user;
        const sysCpu = activity.cpu_system;
        text("kcard-section", PAD, cy, "CPU");
        text("kcard-line", valueX, cy, userCpu == null && sysCpu == null
            ? "cpu times denied"
            : `${formatCpuSec(userCpu)} user  ·  ${formatCpuSec(sysCpu)} system`);
        cy += LINE;

        text("kcard-section", PAD, cy, "CTXSW");
        text("kcard-line", valueX, cy,
            activity.ctx_voluntary == null && activity.ctx_nonvoluntary == null
                ? "counter not readable"
                : `${formatCount(activity.ctx_voluntary)} yielded  ·  ${formatCount(activity.ctx_nonvoluntary)} preempted`);
        cy += LINE;

        const readB = formatBytes(activity.read_bytes);
        const writeB = formatBytes(activity.write_bytes);
        text("kcard-section", PAD, cy, "IO");
        text("kcard-line", valueX, cy, activity.io_readable === false || (readB == null && writeB == null)
            ? "io counters denied"
            : `${readB || "—"} read  ·  ${writeB || "—"} write`);
        cy += LINE;

        const rss = activity.rss_kb;
        const peak = activity.rss_peak_kb;
        text("kcard-section", PAD, cy, "RSS");
        if (rss == null && peak == null) {
            text("kcard-line", valueX, cy, "resident size not readable");
        } else if (peak != null && rss != null && peak > rss) {
            text("kcard-line", valueX, cy, `${formatKb(rss)} now  ·  peak ${formatKb(peak)}`);
        } else {
            text("kcard-line", valueX, cy, `${formatKb(rss != null ? rss : peak)}  ·  at peak`);
        }
        cy += LINE;

        text("kcard-section", PAD, cy, "FAULTS");
        if (activity.minflt == null && activity.majflt == null) {
            text("kcard-line", valueX, cy, "fault counters not readable");
        } else {
            const major = Number(activity.majflt || 0);
            text("kcard-line", valueX, cy, major
                ? `${formatCount(activity.minflt)} minor  ·  ${formatCount(activity.majflt)} major`
                : `${formatCount(activity.minflt)} minor  ·  none major`);
        }
        cy += LINE;

        const kidsMin = Number(activity.cminflt || 0);
        const kidsMaj = Number(activity.cmajflt || 0);
        text("kcard-section", PAD, cy, "KIDS");
        if (activity.cminflt == null && activity.cmajflt == null) {
            text("kcard-line", valueX, cy, "—");
        } else if (!kidsMin && !kidsMaj) {
            text("kcard-line", valueX, cy, "no waited children");
        } else {
            text("kcard-line", valueX, cy, kidsMaj
                ? `${formatCount(kidsMin)} minor  ·  ${formatCount(kidsMaj)} major`
                : `${formatCount(kidsMin)} minor  ·  none major`);
        }
        cy += LINE;

        body.append("line")
            .attr("class", "kcard-divider")
            .attr("x1", 0).attr("y1", h - FOOTER + 8).attr("x2", cw).attr("y2", h - FOOTER + 8);
        text("kcard-foot", PAD, h - 10, "ESC OR CLICK OUTSIDE TO CLOSE");
        text("kcard-foot", cw - PAD, h - 10, `/PROC/${lineage.pid}/STAT`, true);
    }

    return { open, close, isOpen: () => openPid !== null };
})();

window.HistoryCard = HistoryCard;
