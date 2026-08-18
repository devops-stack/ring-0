// The card a row in the main-page connection list opens.
//
// The list is the index: who is talking to whom. The card is one 4-tuple —
// protocol, state, local end, peer. Traceroute hops sit as lines, not a
// second picture. PATH is the door into the network stack for this flow.
//
// The map chrome stays. This card uses the kcard frame, same as SOCKETS.
const FlowCard = (() => {
    const W = 520;
    const PAD = 14;
    const CUT = 15;
    const HEADER = 25;
    const LINE = 14;
    const ROW_STEP = 16;
    const FOOTER = 34;
    const MAX_HOPS = 6;

    let openKey = null;
    let topKeeper = null;
    let requestSeq = 0;
    let lastAnchor = null;
    let lastFlow = null;
    let lastTrace = null;
    let layout = null;

    function clip(text, max) {
        const value = String(text || "");
        return value.length > max ? `${value.slice(0, max - 1)}…` : value;
    }

    function parseEndpoint(endpoint) {
        if (!endpoint) return { host: "—", port: "—" };
        const value = String(endpoint);
        const separator = value.lastIndexOf(":");
        if (separator === -1) return { host: value, port: "—" };
        return {
            host: value.substring(0, separator) || "—",
            port: value.substring(separator + 1) || "—"
        };
    }

    function stateName(stateCode, protocol) {
        if (window.connectionsManager
            && typeof window.connectionsManager.getSocketStateName === "function") {
            return window.connectionsManager.getSocketStateName(stateCode, protocol);
        }
        return String(stateCode || "UNKNOWN").toUpperCase();
    }

    function flowKey(connection) {
        return [
            String(connection.local || ""),
            String(connection.remote || ""),
            String(connection.type || "TCP").toUpperCase()
        ].join("|");
    }

    function close() {
        openKey = null;
        lastAnchor = null;
        lastFlow = null;
        lastTrace = null;
        layout = null;
        requestSeq += 1;
        svg.selectAll(".flow-card-scrim, .flow-card-layer").remove();
        if (topKeeper) topKeeper.stop();
        d3.select("body").on("keydown.flowcard", null);
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
            .on("mouseenter", () => {
                rule.attr("opacity", 1);
            })
            .on("mouseleave", () => {
                rule.attr("opacity", 0.35);
            })
            .on("click", (event) => {
                event.stopPropagation();
                onOpen();
            });
    }

    function followPath() {
        const flow = lastFlow;
        if (!flow) return;
        const remote = String(flow.remote || "").trim();
        if (!remote) return;
        const local = String(flow.local || "").trim();
        const proto = String(flow.type || "TCP").toUpperCase();
        const parsed = parseEndpoint(remote);
        const spec = {
            remote,
            local,
            proto,
            ip: parsed.host,
            port: Number(parsed.port) || 443
        };
        close();
        window.__flowFollow = spec;
        const menu = window.kernelContextMenu;
        if (menu && typeof menu.activateNetworkView === "function") {
            menu.activateNetworkView();
            const viz = menu.networkVisualization;
            if (viz) {
                viz.flowFollow = spec;
                viz._flowFollowApplied = false;
            }
            return;
        }
        const params = new URLSearchParams();
        params.set("remote", remote);
        if (local) params.set("local", local);
        params.set("proto", proto);
        window.location.assign(`/linux-network-subsystem?${params.toString()}`);
    }

    function open(connection, anchor) {
        if (!connection || !connection.remote) return;
        const key = flowKey(connection);
        if (openKey === key) {
            close();
            return;
        }
        if (typeof window.closeOpenKernelCards === "function") {
            window.closeOpenKernelCards();
        } else {
            close();
        }
        openKey = key;
        lastAnchor = anchor;
        lastFlow = connection;
        lastTrace = null;
        const seq = ++requestSeq;
        draw(connection, null, anchor, false);
        const remoteIp = parseEndpoint(connection.remote).host;
        const fetchTrace = window.connectionsManager
            && typeof window.connectionsManager.fetchTraceroute === "function"
            ? window.connectionsManager.fetchTraceroute(remoteIp)
            : fetch(`/api/traceroute?ip=${encodeURIComponent(remoteIp)}`)
                .then((r) => r.json())
                .catch(() => ({ note: "traceroute unavailable", hops: [] }));
        Promise.resolve(fetchTrace).then((trace) => {
            if (seq !== requestSeq || openKey !== key) return;
            lastTrace = trace;
            draw(connection, trace, lastAnchor, true);
        });
    }

    function cardHeight(trace) {
        let h = HEADER + 12 + 10;
        h += LINE;
        h += 16 + LINE + LINE;
        h += 16 + LINE + LINE;
        h += 16 + LINE;
        const hops = Array.isArray(trace && trace.hops) ? trace.hops.slice(0, MAX_HOPS) : [];
        if (trace && trace.note && !hops.length) h += LINE;
        else if (!trace) h += LINE;
        else h += Math.max(1, hops.length) * ROW_STEP;
        h += FOOTER;
        return h;
    }

    function draw(connection, trace, anchor, live) {
        const svgNode = svg.node();
        const viewW = (svgNode && svgNode.clientWidth) || window.innerWidth;
        const viewH = (svgNode && svgNode.clientHeight) || window.innerHeight;
        const cw = (live && layout) ? layout.cw : Math.min(W, viewW - 24);
        const compact = cw < 420;
        const h = cardHeight(trace);

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
            y = (anchor && Number.isFinite(anchor.y) ? anchor.y : 120) - 20;
            y = Math.max(12, Math.min(viewH - h - 12, y));
        }
        layout = { x, y, cw, h };

        let layer;
        let panel;
        if (live) {
            layer = svg.select(".flow-card-layer");
            panel = layer.select(".flow-card-panel");
            if (layer.empty() || panel.empty()) return;
            panel.attr("transform", `translate(${x}, ${y})`);
            panel.select(".kcard-frame").attr("d", dossierCardPath(0, 0, cw, h, CUT));
            if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
                const connY = Math.max(y + 12, Math.min(y + h - 12, anchor.y));
                layer.select(".kcard-conn").attr("x2", x).attr("y2", connY);
            }
            panel.select(".flow-card-body").remove();
        } else {
            ensureDossierDefs();
            svg.append("rect")
                .attr("class", "flow-card-scrim")
                .attr("x", 0).attr("y", 0).attr("width", viewW).attr("height", viewH)
                .attr("fill", ensureFocusVeilGradient())
                .style("opacity", 0)
                .style("cursor", "pointer")
                .on("click", () => close())
                .transition().duration(200).style("opacity", 1);

            layer = svg.append("g").attr("class", "flow-card-layer");
            if (!topKeeper) {
                topKeeper = createOverlayTopKeeper("flow-card-scrim", ["flow-card-layer"], () => openKey !== null);
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
                .attr("class", "flow-card-panel")
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

        const body = panel.append("g").attr("class", "flow-card-body");
        if (!live) {
            body.style("opacity", 0);
            body.transition().delay(250).duration(180).style("opacity", 1);
        }

        paintBody(body, connection, trace, cw, compact, h);
        d3.select("body").on("keydown.flowcard", (event) => {
            if (event.key === "Escape") close();
        });
    }

    function paintBody(body, connection, trace, cw, compact, h) {
        const proto = String(connection.type || "TCP").toUpperCase();
        const state = stateName(connection.state, proto);
        const local = parseEndpoint(connection.local);
        const remote = parseEndpoint(connection.remote);
        const hops = Array.isArray(trace && trace.hops) ? trace.hops.slice(0, MAX_HOPS) : [];

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
        text("kcard-title", PAD + 12, HEADER / 2 + 3.5, "FLOW");
        text("kcard-meta", cw - 13, HEADER / 2 + 3.5,
            `${proto} · ${clip(state, 10)}`, true)
            .style("fill", "rgba(244, 244, 236, 0.5)");
        body.append("line")
            .attr("class", "kcard-divider")
            .attr("x1", 0).attr("y1", HEADER).attr("x2", cw).attr("y2", HEADER);

        let cy = HEADER + 12 + 10;
        text("kcard-line", PAD, cy, compact
            ? "one 4-tuple is the picture"
            : "one 4-tuple is the picture — not the whole stack");
        cy += LINE;

        cy += 16;
        text("kcard-section", PAD, cy, "LOCAL");
        cy += LINE;
        text("kcard-waiter", PAD, cy, clip(`${local.host}:${local.port}`, compact ? 36 : 52));
        cy += LINE;

        cy += 16;
        text("kcard-section", PAD, cy, "PEER");
        cy += LINE;
        text("kcard-waiter", PAD, cy, clip(`${remote.host}:${remote.port}`, compact ? 36 : 52));
        cy += LINE;

        cy += 16;
        text("kcard-section", PAD, cy, "THE WIRE");
        cy += LINE;
        if (!trace) {
            text("kcard-faint", PAD, cy, "TRACEROUTE · LOADING");
            cy += LINE;
        } else if (hops.length) {
            hops.forEach((hop) => {
                const rtt = hop.rtt_ms === null || hop.rtt_ms === undefined
                    ? "*"
                    : `${Number(hop.rtt_ms).toFixed(1)} ms`;
                text("kcard-waiter-dim", PAD, cy + 4,
                    clip(`${hop.hop}. ${hop.target}  ${rtt}`, compact ? 40 : 56));
                cy += ROW_STEP;
            });
        } else {
            text("kcard-faint", PAD, cy, clip(
                (trace && trace.note) || "NO HOPS FROM HERE",
                compact ? 40 : 56
            ));
            cy += LINE;
        }

        body.append("line")
            .attr("class", "kcard-divider")
            .attr("x1", 0).attr("y1", h - FOOTER + 8).attr("x2", cw).attr("y2", h - FOOTER + 8);
        text("kcard-foot", PAD, h - 10, "ESC OR CLICK OUTSIDE TO CLOSE");
        const pathLabel = text("kcard-signature", cw - PAD, h - 10, "PATH", true)
            .attr("letter-spacing", 1.2);
        const pathBox = pathLabel.node().getBBox();
        door(body, pathLabel, pathBox.x, h - 10, pathBox.width, followPath);
    }

    return { open, close, isOpen: () => openKey !== null };
})();

window.FlowCard = FlowCard;
