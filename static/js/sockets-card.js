// The card the NET CONNS tile of the process dossier opens.
//
// The tile counts inet connections. The card is the sockets themselves: state,
// the local end, the peer. If the other end is a process we can name, that
// name is a door into its dossier — the same gesture as parked_in.
//
// /proc/<pid>/fd plus /proc/net name a socket when ptrace will not. A missing
// table is said, not filled in.
//
// While the card is open it re-reads the same payload every couple of seconds
// and repaints the body. The frame stays put.
const SocketsCard = (() => {
    const W = 600;
    const PAD = 14;
    const CUT = 15;
    const HEADER = 25;
    const LINE = 14;
    const ROW_STEP = 16;
    const FOOTER = 34;
    const MAX_ROWS = 12;
    const POLL_MS = 2000;
    const COL_STATE = PAD;
    const COL_LOCAL = 78;
    const COL_PEER = 280;

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

    function stateLabel(value) {
        const raw = String(value || "").toUpperCase();
        if (raw === "ESTABLISHED") return "ESTAB";
        if (raw === "TIME_WAIT") return "TIMEW";
        if (raw === "CLOSE_WAIT") return "CWAIT";
        if (raw === "FIN_WAIT1" || raw === "FIN_WAIT2") return "FINW";
        return raw ? raw.slice(0, 6) : "—";
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
        svg.selectAll(".sockets-card-scrim, .sockets-card-layer").remove();
        if (topKeeper) topKeeper.stop();
        d3.select("body").on("keydown.socketscard", null);
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
            fetch(`/api/process/${pid}/fds`, { cache: "no-store" })
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
        fetch(`/api/process/${key}/fds`, { cache: "no-store" })
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
            .catch((err) => {
                if (seq !== requestSeq) return;
                openPid = null;
                if (window.frontendLogger) {
                    window.frontendLogger.error("sockets card failed to draw", {
                        source: "sockets-card", stack: String((err && err.stack) || err)
                    });
                }
            });
    }

    function socketRows(data) {
        return (data.connections || []).slice(0, MAX_ROWS);
    }

    function cardHeight(data, compact) {
        const rows = socketRows(data);
        let h = HEADER + 12 + 10;
        h += LINE;
        h += 16 + LINE;
        if (!rows.length) h += LINE + LINE;
        else h += LINE + rows.length * ROW_STEP;
        h += FOOTER;
        return h;
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

    function draw(data, anchor, live) {
        const svgNode = svg.node();
        const viewW = (svgNode && svgNode.clientWidth) || window.innerWidth;
        const viewH = (svgNode && svgNode.clientHeight) || window.innerHeight;
        const cw = (live && layout) ? layout.cw : Math.min(W, viewW - 24);
        const compact = cw < 460;
        const h = cardHeight(data, compact);

        let x;
        let y;
        if (live && layout) {
            x = layout.x;
            y = Math.max(12, Math.min(viewH - h - 12, layout.y));
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
            layer = svg.select(".sockets-card-layer");
            panel = layer.select(".sockets-card-panel");
            if (layer.empty() || panel.empty()) return;
            panel.attr("transform", `translate(${x}, ${y})`);
            panel.select(".kcard-frame").attr("d", dossierCardPath(0, 0, cw, h, CUT));
            if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
                const connY = Math.max(y + 12, Math.min(y + h - 12, anchor.y));
                layer.select(".kcard-conn").attr("x2", x).attr("y2", connY);
            }
            panel.select(".sockets-card-body").remove();
        } else {
            ensureDossierDefs();
            svg.append("rect")
                .attr("class", "sockets-card-scrim")
                .attr("x", 0).attr("y", 0).attr("width", viewW).attr("height", viewH)
                .attr("fill", ensureFocusVeilGradient())
                .style("opacity", 0)
                .style("cursor", "pointer")
                .on("click", () => close())
                .transition().duration(200).style("opacity", 1);

            layer = svg.append("g").attr("class", "sockets-card-layer");
            if (!topKeeper) {
                topKeeper = createOverlayTopKeeper("sockets-card-scrim", ["sockets-card-layer"], () => openPid !== null);
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
                .attr("class", "sockets-card-panel")
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

        const body = panel.append("g").attr("class", "sockets-card-body");
        if (!live) {
            body.style("opacity", 0);
            body.transition().delay(250).duration(180).style("opacity", 1);
        }

        paintBody(body, data, cw, compact, h);
        d3.select("body").on("keydown.socketscard", (event) => {
            if (event.key === "Escape") close();
        });
    }

    function paintBody(body, data, cw, compact, h) {
        const rows = socketRows(data);
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
        text("kcard-title", PAD + 12, HEADER / 2 + 3.5, "SOCKETS");
        text("kcard-meta", cw - 13, HEADER / 2 + 3.5,
            `PID ${data.pid} · ${rows.length} LIVE`, true)
            .style("fill", "rgba(244, 244, 236, 0.5)");
        body.append("line")
            .attr("class", "kcard-divider")
            .attr("x1", 0).attr("y1", HEADER).attr("x2", cw).attr("y2", HEADER);

        let cy = HEADER + 12 + 10;
        text("kcard-line", PAD, cy, compact
            ? "state, local end, and the peer"
            : "a 5-tuple plus state is the picture");
        cy += LINE;

        cy += 16;
        text("kcard-section", PAD, cy, "STATE     LOCAL                 PEER");
        cy += LINE;

        if (!rows.length) {
            text("kcard-faint", PAD, cy, "NO SOCKETS ARE VISIBLE FOR THIS PROCESS");
            cy += LINE;
            text("kcard-faint", PAD, cy, "THE TILE COUNTED WHAT /PROC WOULD SHOW WHEN IT COULD");
            cy += LINE;
        }

        const localChars = compact ? 18 : 24;
        const peerChars = compact ? 16 : 22;
        rows.forEach((row) => {
            const ty = cy + 4;
            const family = String(row.family || "").toLowerCase();
            const local = clip(row.local_address || "—", localChars);
            const remote = row.remote_address ? clip(row.remote_address, peerChars) : "—";
            const peerName = row.peer_name ? clip(row.peer_name, 12) : "";
            const peerText = peerName || remote;
            text("kcard-waiter", COL_STATE, ty, stateLabel(row.status));
            text("kcard-waiter-dim", COL_LOCAL, ty, local);
            const peer = text("kcard-faint", compact ? COL_LOCAL + 160 : COL_PEER, ty,
                family === "unix" && !row.remote_address
                    ? `unix${peerName ? ` · ${peerName}` : ""}`
                    : peerText);
            const peerPid = Number(row.peer_pid);
            const canFollow = Number.isFinite(peerPid) && peerPid > 0 && peerPid !== Number(data.pid);
            if (canFollow) {
                const box = peer.node().getBBox();
                door(body, peer, box.x, ty, box.width, () => {
                    followProcess(peerPid, row.peer_name);
                });
            }
            cy += ROW_STEP;
        });

        body.append("line")
            .attr("class", "kcard-divider")
            .attr("x1", 0).attr("y1", h - FOOTER + 8).attr("x2", cw).attr("y2", h - FOOTER + 8);
        text("kcard-foot", PAD, h - 10, "ESC OR CLICK OUTSIDE TO CLOSE");
        text("kcard-foot", cw - PAD, h - 10, `/PROC/${data.pid}/NET`, true);
    }

    return { open, close, isOpen: () => openPid !== null };
})();

window.SocketsCard = SocketsCard;
