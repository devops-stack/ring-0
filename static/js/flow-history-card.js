// The card the HISTORY door of FLOW opens.
//
// FLOW is the now-picture of one 4-tuple: local, peer, the sock metro,
// traceroute. History is the biography of that session — bytes and segments
// it has moved, when it last spoke, the lowest RTT it has seen, whether it
// has had to retransmit. The kernel does not give a socket a birth clock
// the way it does a pid; these totals are the life it does keep.
//
// Not a second metro. Not another hop list.
const FlowHistoryCard = (() => {
    const W = 520;
    const PAD = 14;
    const CUT = 15;
    const HEADER = 25;
    const LINE = 16;
    const FOOTER = 34;
    const LABEL_W = 78;
    const POLL_MS = 2000;

    let openKey = null;
    let topKeeper = null;
    let requestSeq = 0;
    let pollTimer = null;
    let lastAnchor = null;
    let lastQuery = null;
    let layout = null;

    function clip(text, max) {
        const value = String(text || "");
        return value.length > max ? `${value.slice(0, max - 1)}…` : value;
    }

    function flowKey(query) {
        return [
            String((query && query.local) || ""),
            String((query && query.remote) || ""),
            String((query && query.proto) || "TCP").toUpperCase()
        ].join("|");
    }

    function formatBytes(value) {
        if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
        const v = Number(value);
        if (v < 1024) return `${Math.round(v)} B`;
        if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
        if (v < 1024 * 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1)} MB`;
        return `${(v / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }

    function formatCount(value) {
        if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
        const v = Number(value);
        if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
        if (v >= 10000) return `${Math.round(v / 1000)}k`;
        return String(Math.round(v));
    }

    function formatAgo(ms) {
        if (ms === null || ms === undefined || !Number.isFinite(Number(ms))) return "—";
        const s = Math.max(0, Number(ms) / 1000);
        if (s < 1) return `${Math.round(Number(ms))}ms ago`;
        if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s ago`;
        if (s < 3600) {
            const m = Math.floor(s / 60);
            const rem = Math.round(s % 60);
            return rem ? `${m}m ${rem}s ago` : `${m}m ago`;
        }
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        return m ? `${h}h ${m}m ago` : `${h}h ago`;
    }

    function formatBusy(ms) {
        if (ms === null || ms === undefined || !Number.isFinite(Number(ms))) return "—";
        const s = Number(ms) / 1000;
        if (s < 1) return `${Math.round(Number(ms))}ms on the wire`;
        if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s on the wire`;
        if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s on the wire`;
        return `${(s / 3600).toFixed(1)}h on the wire`;
    }

    function formatRtt(ms) {
        if (ms === null || ms === undefined || !Number.isFinite(Number(ms))) return "—";
        const v = Number(ms);
        if (v < 1) return `${v.toFixed(3)} ms`;
        if (v < 10) return `${v.toFixed(2)} ms`;
        return `${v.toFixed(1)} ms`;
    }

    function stopPoll() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    function close() {
        stopPoll();
        openKey = null;
        lastAnchor = null;
        lastQuery = null;
        layout = null;
        requestSeq += 1;
        svg.selectAll(".flow-history-scrim, .flow-history-layer").remove();
        if (topKeeper) topKeeper.stop();
        d3.select("body").on("keydown.flowhistory", null);
        window.dispatchEvent(new CustomEvent("kcard-closed"));
    }

    function load(query) {
        const params = new URLSearchParams();
        params.set("local", query.local);
        params.set("remote", query.remote);
        params.set("proto", query.proto || "TCP");
        return fetch(`/api/flow-history?${params.toString()}`, { cache: "no-store" })
            .then((r) => r.json());
    }

    function startPoll(query, key) {
        stopPoll();
        pollTimer = setInterval(() => {
            if (openKey !== key) {
                stopPoll();
                return;
            }
            if (document.hidden) return;
            const seq = requestSeq;
            load(query).then((data) => {
                if (seq !== requestSeq || openKey !== key) return;
                if (!data || data.found === false) {
                    close();
                    return;
                }
                draw(data, lastAnchor, true);
            }).catch(() => {});
        }, POLL_MS);
    }

    function open(connection, anchor) {
        if (!connection || !connection.local || !connection.remote) return;
        const query = {
            local: String(connection.local),
            remote: String(connection.remote),
            proto: String(connection.type || connection.proto || "TCP").toUpperCase()
        };
        const key = flowKey(query);
        if (openKey === key) {
            close();
            return;
        }
        close();
        openKey = key;
        lastAnchor = anchor;
        lastQuery = query;
        const seq = ++requestSeq;
        load(query).then((data) => {
            if (seq !== requestSeq) return;
            if (!data || data.found === false) {
                openKey = null;
                return;
            }
            draw(data, anchor, false);
            startPoll(query, key);
        }).catch((err) => {
            if (seq !== requestSeq) return;
            openKey = null;
            if (window.frontendLogger) {
                window.frontendLogger.error("flow history card failed to draw", {
                    source: "flow-history-card", stack: String((err && err.stack) || err)
                });
            }
        });
    }

    function cardHeight() {
        let h = HEADER + 12 + 10;
        h += LINE * 3;
        h += 16 + LINE;
        h += LINE * 4;
        h += 16 + LINE;
        h += LINE * 3;
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
            layer = svg.select(".flow-history-layer");
            panel = layer.select(".flow-history-panel");
            if (layer.empty() || panel.empty()) return;
            panel.attr("transform", `translate(${x}, ${y})`);
            panel.select(".kcard-frame").attr("d", dossierCardPath(0, 0, cw, h, CUT));
            if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
                const connY = Math.max(y + 12, Math.min(y + h - 12, anchor.y));
                layer.select(".kcard-conn").attr("x2", x).attr("y2", connY);
            }
            panel.select(".flow-history-body").remove();
        } else {
            ensureDossierDefs();
            svg.append("rect")
                .attr("class", "flow-history-scrim")
                .attr("x", 0).attr("y", 0).attr("width", viewW).attr("height", viewH)
                .attr("fill", ensureFocusVeilGradient())
                .style("opacity", 0)
                .style("cursor", "pointer")
                .on("click", () => close())
                .transition().duration(200).style("opacity", 1);

            layer = svg.append("g").attr("class", "flow-history-layer");
            if (!topKeeper) {
                topKeeper = createOverlayTopKeeper(
                    "flow-history-scrim",
                    ["flow-history-layer"],
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

            panel = layer.append("g")
                .attr("class", "flow-history-panel")
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

        const body = panel.append("g").attr("class", "flow-history-body");
        if (!live) {
            body.style("opacity", 0);
            body.transition().delay(250).duration(180).style("opacity", 1);
        }

        paintBody(body, data, cw, compact, h);
        d3.select("body").on("keydown.flowhistory", (event) => {
            if (event.key === "Escape") close();
        });
    }

    function paintBody(body, data, cw, compact, h) {
        const proto = String(data.proto || "TCP").toUpperCase();
        const state = String(data.state || "—").replace(/_/g, "-");
        const valueX = PAD + LABEL_W;
        const maxVal = compact ? 36 : 48;

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
        text("kcard-title", PAD + 12, HEADER / 2 + 3.5, "HISTORY · FLOW");
        text("kcard-meta", cw - 13, HEADER / 2 + 3.5,
            `${proto} · ${clip(state, 12)}`, true)
            .style("fill", "rgba(244, 244, 236, 0.5)");
        body.append("line")
            .attr("class", "kcard-divider")
            .attr("x1", 0).attr("y1", HEADER).attr("x2", cw).attr("y2", HEADER);

        let cy = HEADER + 12 + 10;

        function fact(label, value, accent) {
            text("kcard-section", PAD, cy, label);
            text(accent ? "kcard-signature" : "kcard-line", valueX, cy, clip(value || "—", maxVal));
            cy += LINE;
        }

        fact("LOCAL", data.local || "—");
        fact("PEER", data.remote || "—", true);
        fact("OWNER", data.owner || "—");

        cy += 16;
        text("kcard-section", PAD, cy, "LIFE");
        cy += LINE;

        fact("BYTES", `${formatBytes(data.bytes_sent)} sent  ·  ${formatBytes(data.bytes_received)} recv`);
        fact("SEGS", `${formatCount(data.segs_out)} out  ·  ${formatCount(data.segs_in)} in`);

        const retransBits = [];
        if (data.retrans_total != null) retransBits.push(`${formatCount(data.retrans_total)} segs`);
        if (data.bytes_retrans) retransBits.push(formatBytes(data.bytes_retrans));
        if (data.retrans_now) retransBits.push(`${data.retrans_now} in flight`);
        fact("RETRANS", retransBits.length ? retransBits.join("  ·  ") : "none");
        fact("BUSY", formatBusy(data.busy_ms));

        cy += 16;
        text("kcard-section", PAD, cy, "THE WIRE SINCE");
        cy += LINE;

        fact("LAST", `sent ${formatAgo(data.last_snd_ms)}  ·  recv ${formatAgo(data.last_rcv_ms)}`);
        const rttBits = [`now ${formatRtt(data.rtt_ms)}`];
        if (data.min_rtt_ms != null) rttBits.push(`min ${formatRtt(data.min_rtt_ms)}`);
        fact("RTT", rttBits.join("  ·  "));

        const pathBits = [];
        if (data.cc) pathBits.push(data.cc);
        if (data.cwnd != null) pathBits.push(`cwnd ${data.cwnd}`);
        if (data.timer && data.timer.kind) {
            pathBits.push(`${data.timer.kind} ${data.timer.left || ""}`.trim());
        }
        fact("PATH", pathBits.length ? pathBits.join("  ·  ") : "—");

        body.append("line")
            .attr("class", "kcard-divider")
            .attr("x1", 0).attr("y1", h - FOOTER + 8).attr("x2", cw).attr("y2", h - FOOTER + 8);
        text("kcard-foot", PAD, h - 10, "ESC OR CLICK OUTSIDE TO CLOSE");
        text("kcard-foot", cw - PAD, h - 10, (data.source || "SS").toUpperCase(), true);
    }

    return { open, close, isOpen: () => openKey !== null };
})();

window.FlowHistoryCard = FlowHistoryCard;
