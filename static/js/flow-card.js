// The card a row in the main-page connection list opens.
//
// Same cascading stack as PROCESS DOSSIER: identity → the wire → the segment.
// The upper card keeps the amber sock metro on the right (socket → nic), with
// the 4-tuple on the left. HISTORY and PATH stay doors on that card.
//
// A cell is only filled in when ss measured it. What we cannot see stays an
// empty named box; what we reason out rather than read is drawn dashed.
const FlowCard = (() => {
    const ID_W = 620;
    const RAIL_W = 280;
    const WIRE_W = 280;
    const SEG_W = 640;
    const PAD = 14;
    const CUT = 15;
    const HEADER = 25;
    const LINE = 14;
    const ROW_STEP = 16;
    const FOOTER = 34;
    const MAX_HOPS = 6;
    const FIG_W = 604;
    const FIG_H = 262;
    const METRO_W = 300;
    const METRO_H = 232;
    const STAMP_H = 50;
    const OVERLAP = 14;
    const INSET = 26;

    let openKey = null;
    let topKeeper = null;
    let requestSeq = 0;
    let lastAnchor = null;
    let lastFlow = null;
    let lastTrace = null;
    let lastInfo = null;
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
        lastInfo = null;
        layout = null;
        requestSeq += 1;
        svg.selectAll(".flow-card-scrim, .flow-card-layer").remove();
        if (topKeeper) topKeeper.stop();
        d3.select("body").on("keydown.flowcard", null);
        if (window.FlowHistoryCard && typeof window.FlowHistoryCard.close === "function") {
            window.FlowHistoryCard.close();
        }
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
        lastInfo = null;
        const seq = ++requestSeq;
        draw(connection, anchor, false);
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
            draw(connection, lastAnchor, true);
        });

        const params = new URLSearchParams();
        params.set("local", String(connection.local || ""));
        params.set("remote", String(connection.remote || ""));
        params.set("proto", String(connection.type || "TCP").toUpperCase());
        fetch(`/api/flow-history?${params.toString()}`, { cache: "no-store" })
            .then((r) => r.json())
            .catch(() => null)
            .then((info) => {
                if (seq !== requestSeq || openKey !== key) return;
                lastInfo = (info && info.found !== false) ? info : null;
                draw(connection, lastAnchor, true);
            });
    }


    function hopCount() {
        const hops = Array.isArray(lastTrace && lastTrace.hops) ? lastTrace.hops.slice(0, MAX_HOPS) : [];
        if (lastTrace && lastTrace.note && !hops.length) return 1;
        if (!lastTrace) return 1;
        return Math.max(1, hops.length);
    }

    function stackMetrics(viewW, viewH, anchor) {
        const reserved = window.KernelTape
            && typeof window.KernelTape.reservedWidth === "function"
            ? window.KernelTape.reservedWidth()
            : 0;
        const idW = ID_W;
        const wireW = WIRE_W;
        const segAvail = viewW - reserved - 40;
        const segW = Math.max(320, Math.min(SEG_W, segAvail - INSET * 2));
        const showFigure = segW >= 520;
        // Upper card is rail + sock metro side by side, height set by the metro.
        const idH = HEADER + 10 + METRO_H + 18;
        const wireH = HEADER + 16 + hopCount() * ROW_STEP + 20;
        const segH = showFigure ? HEADER + 12 + FIG_H + 18 : HEADER + 36;

        const totalH = idH + (wireH - OVERLAP) + (segH - OVERLAP);
        // Beside the connection list, like the process dossier sits beside
        // its node — not berthed against the Activity pill on the right edge.
        const clearOf = Number.isFinite(anchor && anchor.clearOf) ? anchor.clearOf : 596;
        let stackX = clearOf + 12;
        const widest = Math.max(idW, wireW + INSET, segW + INSET * 2);
        if (stackX + widest + reserved + 16 > viewW) {
            stackX = Math.max(12, viewW - reserved - widest - 16);
        }
        let stackY = (anchor && Number.isFinite(anchor.y) ? anchor.y : 120) - 24;
        stackY = Math.max(12, Math.min(viewH - totalH - 12, stackY));
        return { idW, wireW, segW, showFigure, idH, wireH, segH, totalH, stackX, stackY, reserved };
    }

    function draw(connection, anchor, live) {
        const svgNode = svg.node();
        const viewW = (svgNode && svgNode.clientWidth) || window.innerWidth;
        const viewH = (svgNode && svgNode.clientHeight) || window.innerHeight;
        const m = stackMetrics(viewW, viewH, anchor);
        layout = {
            x: m.stackX, y: m.stackY, cw: m.segW + INSET * 2, h: m.totalH,
            ...m
        };

        let layer;
        if (live) {
            layer = svg.select(".flow-card-layer");
            if (layer.empty()) return;
            layer.select(".flow-card-stack").remove();
            if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
                const connY = Math.max(m.stackY + 12, Math.min(m.stackY + m.idH - 12, anchor.y));
                layer.select(".kcard-conn").attr("x2", m.stackX).attr("y2", connY);
            }
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
                const connY = Math.max(m.stackY + 12, Math.min(m.stackY + m.idH - 12, anchor.y));
                layer.append("circle")
                    .attr("class", "kcard-anchor")
                    .attr("cx", anchor.x).attr("cy", anchor.y).attr("r", 3);
                layer.append("line")
                    .attr("class", "kcard-conn")
                    .attr("x1", anchor.x).attr("y1", anchor.y)
                    .attr("x2", anchor.x).attr("y2", anchor.y)
                    .transition().duration(220).ease(d3.easeCubicOut)
                    .attr("x2", m.stackX).attr("y2", connY);
            }
        }

        const stack = layer.append("g")
            .attr("class", "flow-card-stack")
            .on("click", (event) => event.stopPropagation());

        paintIdentity(stack, connection, m);
        paintWire(stack, m);
        paintSegment(stack, connection, m);

        d3.select("body").on("keydown.flowcard", (event) => {
            if (event.key !== "Escape") return;
            if (window.FlowHistoryCard && FlowHistoryCard.isOpen()) return;
            close();
        });
    }

    function metroLeg(from, to) {
        const drop = Math.abs(to.y - from.y);
        if (!drop) return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
        const turn = to.x - drop;
        if (turn <= from.x + 4) {
            const midY = from.y + Math.sign(to.y - from.y) * Math.min(drop, Math.abs(to.x - from.x));
            return `M ${from.x} ${from.y} L ${to.x} ${midY} L ${to.x} ${to.y}`;
        }
        return `M ${from.x} ${from.y} L ${turn} ${from.y} L ${to.x} ${to.y}`;
    }

    // Official graph from include/linux/net.h + include/net/sock.h + sk_buff.
    // Trunk socket → sock → skc. Two queues hang off sock: rcv and snd.
    function drawSocketMetro(g, ox, oy, w) {
        const lanes = [oy + 38, oy + 92, oy + 146, oy + 200];
        lanes.forEach((ly) => {
            g.append("line")
                .attr("class", "flow-metro-rail")
                .attr("x1", ox + 6).attr("y1", ly)
                .attr("x2", ox + w - 6).attr("y2", ly);
        });

        const at = (lane, t) => ({
            x: ox + 22 + t * (w - 44),
            y: lanes[lane],
            up: lane % 2 === 0
        });

        const stations = {
            socket: { lane: 0, t: 0.00, title: "SOCKET", lines: ["state  type  file", "sk  ops"] },
            sock: { lane: 1, t: 0.28, title: "SOCK", lines: ["sk_socket", "__sk_common"] },
            skc: { lane: 1, t: 0.72, title: "SKC", lines: ["dport  num  state", "daddr  rcv_saddr"] },
            rcv: { lane: 2, t: 0.42, title: "RCV", lines: ["receive_queue", "next  prev"] },
            snd: { lane: 2, t: 0.78, title: "SND", lines: ["write_queue", "next  prev"] },
            dev: { lane: 3, t: 0.78, title: "NET_DEVICE", lines: ["name  ifindex"] }
        };

        const pos = {};
        Object.keys(stations).forEach((id) => {
            pos[id] = at(stations[id].lane, stations[id].t);
        });

        const trunk = [["socket", "sock"], ["sock", "skc"]];
        const branch = [["sock", "rcv"], ["sock", "snd"], ["snd", "dev"]];
        trunk.forEach(([a, b]) => {
            g.append("path")
                .attr("class", "flow-metro-track")
                .attr("d", metroLeg(pos[a], pos[b]));
        });
        branch.forEach(([a, b]) => {
            g.append("path")
                .attr("class", "flow-metro-track is-branch")
                .attr("d", metroLeg(pos[a], pos[b]));
        });

        Object.keys(stations).forEach((id) => {
            const station = stations[id];
            const p = pos[id];
            g.append("circle")
                .attr("class", "flow-metro-station")
                .attr("cx", p.x).attr("cy", p.y).attr("r", 3.1);
            const lines = station.lines;
            const end = station.t > 0.62;
            const lx = end ? p.x - 8 : p.x + 8;
            const ty = p.up
                ? p.y - 16 - Math.max(0, lines.length - 1) * 8
                : p.y + 14;
            g.append("text")
                .attr("class", "flow-metro-title")
                .attr("x", lx).attr("y", ty)
                .attr("text-anchor", end ? "end" : "start")
                .text(station.title);
            lines.forEach((line, i) => {
                g.append("text")
                    .attr("class", "flow-metro-line")
                    .attr("x", lx).attr("y", ty + 9 + i * 8)
                    .attr("text-anchor", end ? "end" : "start")
                    .text(line);
            });
        });
    }

    function paintIdentity(stack, connection, m) {
        const proto = String(connection.type || "TCP").toUpperCase();
        const state = stateName(connection.state, proto);
        const local = parseEndpoint(connection.local);
        const remote = parseEndpoint(connection.remote);
        const info = lastInfo;
        const box = { x: m.stackX, y: m.stackY, w: m.idW, h: m.idH };
        const meta = info && info.owner
            ? `${clip(String(info.owner).toUpperCase(), 14)} · ${proto}`
            : `${proto} · ${clip(state, 12)}`;
        const card = dossierCard(stack, box, "FLOW", meta);
        card.style("pointer-events", "all");

        if (window.FlowHistoryCard) {
            const histX = box.x + 58;
            const histW = 52;
            const histLabel = card.append("text")
                .attr("x", histX).attr("y", box.y + 16)
                .attr("font-family", "Share Tech Mono, monospace")
                .attr("font-size", "9px")
                .attr("letter-spacing", "1.2")
                .attr("fill", "#e2a33e")
                .text("HISTORY");
            const histRule = card.append("line")
                .attr("x1", histX).attr("x2", histX + histW)
                .attr("y1", box.y + 19).attr("y2", box.y + 19)
                .attr("stroke", "#e2a33e").attr("stroke-width", 1).attr("opacity", 0.35);
            card.append("rect")
                .attr("x", histX - 6).attr("y", box.y + 4)
                .attr("width", histW + 12).attr("height", 18)
                .attr("fill", "transparent")
                .style("cursor", "pointer")
                .on("mouseenter", () => histRule.attr("opacity", 1))
                .on("mouseleave", () => histRule.attr("opacity", 0.35))
                .on("click", (event) => {
                    event.stopPropagation();
                    FlowHistoryCard.open(connection, {
                        x: histX + 20,
                        y: box.y + 16,
                        clearOf: box.x + box.w + 16
                    });
                });
        }

        // Left rail: the 4-tuple. Right pane: the sock metro from the screenshot.
        const metroX = box.x + box.w - PAD - METRO_W;
        card.append("line")
            .attr("class", "kcard-divider")
            .attr("x1", metroX - 12).attr("y1", box.y + HEADER + 8)
            .attr("x2", metroX - 12).attr("y2", box.y + box.h - 16);
        const metro = card.append("g").attr("class", "flow-sock-metro");
        drawSocketMetro(metro, metroX, box.y + HEADER + 4, METRO_W);

        let cy = box.y + HEADER + 18;
        card.append("text").attr("class", "kcard-line")
            .attr("x", box.x + 16).attr("y", cy)
            .text("this 4-tuple, official sock body");
        cy += 18;
        card.append("text").attr("class", "kcard-section")
            .attr("x", box.x + 16).attr("y", cy).text("LOCAL");
        cy += LINE;
        card.append("text").attr("class", "kcard-waiter")
            .attr("x", box.x + 16).attr("y", cy)
            .text(clip(`${local.host}:${local.port}`, 32));
        cy += 18;
        card.append("text").attr("class", "kcard-section")
            .attr("x", box.x + 16).attr("y", cy).text("PEER");
        cy += LINE;
        card.append("text").attr("class", "kcard-waiter")
            .attr("x", box.x + 16).attr("y", cy)
            .text(clip(`${remote.host}:${remote.port}`, 32));

        cy += 22;
        card.append("text").attr("class", "kcard-section")
            .attr("x", box.x + 16).attr("y", cy).text("STATE");
        cy += 20;
        card.append("text").attr("class", "flow-stamp")
            .attr("x", box.x + 16).attr("y", cy)
            .text(clip(state, 14));
        cy += 12;
        const shape = [proto];
        if (info && info.cc) shape.push(String(info.cc).toUpperCase());
        if (info && info.cwnd) shape.push(`CWND ${info.cwnd}`);
        if (info && info.rtt_ms != null) shape.push(`RTT ${Number(info.rtt_ms).toFixed(1)} MS`);
        card.append("text").attr("class", "kcard-note")
            .attr("x", box.x + 16).attr("y", cy)
            .text(clip(shape.join("  ·  "), 36));
        cy += 8;
        card.append("line").attr("class", "flow-stamp-rule")
            .attr("x1", box.x + 16).attr("y1", cy)
            .attr("x2", box.x + Math.min(176, RAIL_W - 32)).attr("y2", cy);

        const pathLabel = card.append("text").attr("class", "kcard-signature")
            .attr("x", box.x + box.w - 14).attr("y", box.y + box.h - 12)
            .attr("text-anchor", "end")
            .attr("letter-spacing", 1.2)
            .text("PATH");
        card.append("text").attr("class", "kcard-foot")
            .attr("x", box.x + 16).attr("y", box.y + box.h - 12)
            .text("ESC TO CLOSE");
        try {
            const pb = pathLabel.node().getBBox();
            door(card, pathLabel, pb.x, box.y + box.h - 12, pb.width, followPath);
        } catch (e) {
            door(card, pathLabel, box.x + box.w - 48, box.y + box.h - 12, 34, followPath);
        }
    }

    function paintWire(stack, m) {
        const box = {
            x: m.stackX + INSET,
            y: m.stackY + m.idH - OVERLAP,
            w: m.wireW,
            h: m.wireH
        };
        const card = dossierCard(stack, box, "THE WIRE", "path");
        card.style("pointer-events", "all");
        const hops = Array.isArray(lastTrace && lastTrace.hops) ? lastTrace.hops.slice(0, MAX_HOPS) : [];
        let cy = box.y + HEADER + 16;
        if (!lastTrace) {
            card.append("text").attr("class", "kcard-faint")
                .attr("x", box.x + 14).attr("y", cy).text("TRACEROUTE · LOADING");
            return;
        }
        if (hops.length) {
            hops.forEach((hop) => {
                const rtt = hop.rtt_ms === null || hop.rtt_ms === undefined
                    ? "*"
                    : `${Number(hop.rtt_ms).toFixed(1)} ms`;
                card.append("text").attr("class", "kcard-waiter-dim")
                    .attr("x", box.x + 14).attr("y", cy)
                    .text(clip(`${hop.hop}. ${hop.target}  ${rtt}`, 36));
                cy += ROW_STEP;
            });
            return;
        }
        card.append("text").attr("class", "kcard-faint")
            .attr("x", box.x + 14).attr("y", cy)
            .text(clip((lastTrace && lastTrace.note) || "NO HOPS FROM HERE", 34));
    }

    function paintSegment(stack, connection, m) {
        const box = {
            x: m.stackX + INSET * 2,
            y: m.stackY + m.idH + m.wireH - OVERLAP * 2,
            w: m.segW,
            h: m.segH
        };
        const card = dossierCard(stack, box, "SEGMENT", m.showFigure ? "to scale" : "narrow");
        card.style("pointer-events", "all");
        if (!m.showFigure) {
            card.append("text").attr("class", "kcard-faint")
                .attr("x", box.x + 14).attr("y", box.y + HEADER + 18)
                .text("widen the window to read the frame");
            return;
        }
        const fig = card.append("g").attr("class", "flow-frame");
        drawFrameSection(fig, box.x + 12, box.y + HEADER + 4, box.w - 24, box.h - HEADER - 12, connection, lastInfo);
    }


    function ensureFrameDefs() {
        let defs = svg.select("defs");
        if (defs.empty()) defs = svg.append("defs");
        if (!svg.select("#flow-cargo-hatch").empty()) return;
        const pattern = defs.append("pattern")
            .attr("id", "flow-cargo-hatch")
            .attr("width", 6).attr("height", 6)
            .attr("patternUnits", "userSpaceOnUse")
            .attr("patternTransform", "rotate(45)");
        pattern.append("line")
            .attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 6)
            .attr("stroke", "rgba(244, 244, 236, 0.14)")
            .attr("stroke-width", 1);
    }

    function num(value) {
        const v = Number(value);
        return Number.isFinite(v) && v > 0 ? v : 0;
    }

    // What one full segment of this socket looks like on the wire. MSS is the
    // payload the peer agreed to accept, so a full segment carries exactly
    // that. The option bytes are reasoned, not read: Linux pads the timestamp
    // option to 12, and SACK blocks only cost bytes when there is a hole.
    function frameModel(info) {
        const mss = num(info && info.mss);
        const advmss = num(info && info.advmss);
        const ts = !!(info && info.opt_ts);
        const optionBytes = ts ? 12 : 0;
        const payload = mss || advmss || 1460;
        const tcp = 20 + optionBytes;
        return {
            eth: 14,
            ip: 20,
            tcp,
            optionBytes,
            payload,
            header: 14 + 20 + tcp,
            total: 14 + 20 + tcp + payload,
            measured: mss > 0,
            ts,
            sack: !!(info && info.opt_sack),
            pmtu: num(info && info.pmtu),
            wscale: info && Number.isFinite(Number(info.wscale_snd))
                ? Number(info.wscale_snd)
                : null,
            window: num(info && info.snd_wnd)
        };
    }

    // A 32-bit row of a header, laid out the way the RFC draws it. A cell with
    // a value was measured; a cell without one is a field we know is there and
    // cannot see; a derived cell is dashed.
    function headerRow(g, ox, y, w, rowH, cells) {
        let bit = 0;
        cells.forEach((cell) => {
            const cx = ox + (bit / 32) * w;
            const cwid = (cell.bits / 32) * w;
            bit += cell.bits;
            const state = cell.value ? (cell.derived ? "is-derived" : "is-live") : "";
            g.append("rect")
                .attr("class", `frame-cell ${state}`.trim())
                .attr("x", cx).attr("y", y)
                .attr("width", cwid).attr("height", rowH);
            const tight = cwid < 52;
            const name = tight && cell.short ? cell.short : cell.name;
            g.append("text")
                .attr("class", "frame-cell-name")
                .attr("x", cx + 4).attr("y", y + 7)
                .text(name);
            if (!cell.value) return;
            g.append("text")
                .attr("class", `frame-cell-value ${state}`.trim())
                .attr("x", cx + 4).attr("y", y + rowH - 4)
                .text(clip(cell.value, Math.max(2, Math.floor((cwid - 7) / 5.1))));
        });
    }

    function headerBlock(g, ox, oy, w, title, rows, rowH) {
        g.append("text")
            .attr("class", "frame-block-title")
            .attr("x", ox).attr("y", oy)
            .text(title);
        const rulerY = oy + 16;
        g.append("line")
            .attr("class", "frame-ruler")
            .attr("x1", ox).attr("y1", rulerY).attr("x2", ox + w).attr("y2", rulerY);
        [0, 8, 16, 24, 32].forEach((b) => {
            const bx = ox + (b / 32) * w;
            g.append("line")
                .attr("class", "frame-ruler")
                .attr("x1", bx).attr("y1", rulerY - 3).attr("x2", bx).attr("y2", rulerY);
            if (b === 32) return;
            g.append("text")
                .attr("class", "frame-bit")
                .attr("x", bx + 2).attr("y", rulerY - 4.5)
                .text(String(b));
        });
        rows.forEach((cells, i) => {
            headerRow(g, ox, rulerY + 3 + i * rowH, w, rowH, cells);
        });
        return rulerY + 3 + rows.length * rowH;
    }

    function drawFrameSection(g, ox, oy, w, availH, connection, info) {
        ensureFrameDefs();
        const model = frameModel(info);
        const local = parseEndpoint(connection.local);
        const remote = parseEndpoint(connection.remote);
        const scale = (bytes) => (bytes / model.total) * w;

        g.append("text")
            .attr("class", "kcard-section")
            .attr("x", ox).attr("y", oy + 8)
            .text("ONE FULL SEGMENT, TO SCALE");

        // The true-scale ribbon. The header slivers are meant to look small.
        const barY = oy + 22;
        const barH = 26;
        const dimY = barY - 5;
        g.append("line")
            .attr("class", "frame-dim")
            .attr("x1", ox).attr("y1", dimY).attr("x2", ox + w).attr("y2", dimY);
        [ox, ox + w].forEach((tx) => {
            g.append("line")
                .attr("class", "frame-dim")
                .attr("x1", tx).attr("y1", dimY - 3).attr("x2", tx).attr("y2", dimY + 3);
        });
        g.append("text")
            .attr("class", "frame-dim-label")
            .attr("x", ox + w).attr("y", dimY - 4)
            .attr("text-anchor", "end")
            .text(`${model.total} B ON THE WIRE`);

        const cargoX = ox + scale(model.header);
        g.append("rect")
            .attr("class", "frame-cargo")
            .attr("x", cargoX).attr("y", barY)
            .attr("width", ox + w - cargoX).attr("height", barH)
            .attr("fill", "url(#flow-cargo-hatch)");
        g.append("rect")
            .attr("class", "frame-cargo-edge")
            .attr("x", cargoX).attr("y", barY)
            .attr("width", ox + w - cargoX).attr("height", barH);
        g.append("text")
            .attr("class", "frame-cargo-label")
            .attr("x", cargoX + (ox + w - cargoX) / 2).attr("y", barY + barH / 2 + 3.5)
            .attr("text-anchor", "middle")
            .text(`PAYLOAD · ${model.payload} B`);

        let hx = ox;
        [
            { bytes: model.eth, name: "ETH" },
            { bytes: model.ip, name: "IP" },
            { bytes: model.tcp, name: "TCP" }
        ].forEach((part, i) => {
            const pw = scale(part.bytes);
            g.append("rect")
                .attr("class", `frame-band is-${i}`)
                .attr("x", hx).attr("y", barY)
                .attr("width", Math.max(1.2, pw)).attr("height", barH);
            hx += pw;
        });

        // The magnifier: the header sliver opens into the field grid below.
        const sliverEnd = ox + scale(model.header);
        const wedgeTop = barY + barH;
        const wedgeBottom = wedgeTop + 24;
        g.append("path")
            .attr("class", "frame-wedge-fill")
            .attr("d", `M${ox},${wedgeTop} L${sliverEnd},${wedgeTop} `
                + `L${ox + w},${wedgeBottom} L${ox},${wedgeBottom} Z`);
        g.append("line")
            .attr("class", "frame-wedge")
            .attr("x1", ox).attr("y1", wedgeTop).attr("x2", ox).attr("y2", wedgeBottom);
        g.append("line")
            .attr("class", "frame-wedge")
            .attr("x1", sliverEnd).attr("y1", wedgeTop)
            .attr("x2", ox + w).attr("y2", wedgeBottom);
        // Left-aligned so the caption stays clear of the wedge's diagonal.
        g.append("text")
            .attr("class", "frame-zoom")
            .attr("x", ox + 4).attr("y", wedgeBottom - 6)
            .text(`ETH ${model.eth} + IP ${model.ip} + TCP ${model.tcp} = ${model.header} B, `
                + `OPENED ${Math.round(w / scale(model.header))}×`);

        const totalLen = model.ip + model.tcp + model.payload;
        const ipRows = [
            [
                { bits: 4, name: "VER", value: "4" },
                { bits: 4, name: "IHL", value: "5" },
                { bits: 8, name: "DSCP/ECN", short: "TOS" },
                { bits: 16, name: "TOTAL LENGTH", short: "LEN", value: String(totalLen), derived: true }
            ],
            [
                { bits: 16, name: "IDENTIFICATION", short: "ID" },
                { bits: 3, name: "FLG" },
                { bits: 13, name: "FRAGMENT OFFSET", short: "FRAG" }
            ],
            [
                { bits: 8, name: "TTL" },
                { bits: 8, name: "PROTOCOL", short: "PROTO", value: "6 TCP" },
                { bits: 16, name: "HEADER CHECKSUM", short: "CKSUM" }
            ],
            [{ bits: 32, name: "SOURCE ADDRESS", value: local.host }],
            [{ bits: 32, name: "DESTINATION ADDRESS", value: remote.host }]
        ];
        const rawWindow = model.window && model.wscale !== null
            ? Math.round(model.window / Math.pow(2, model.wscale))
            : 0;
        const tcpRows = [
            [
                { bits: 16, name: "SOURCE PORT", short: "SPORT", value: local.port },
                { bits: 16, name: "DESTINATION PORT", short: "DPORT", value: remote.port }
            ],
            [{ bits: 32, name: "SEQUENCE NUMBER" }],
            [{ bits: 32, name: "ACKNOWLEDGMENT NUMBER" }],
            [
                { bits: 4, name: "OFF", value: String(model.tcp / 4), derived: true },
                { bits: 6, name: "RSVD" },
                { bits: 6, name: "FLAGS", value: "ACK", derived: true },
                {
                    bits: 16,
                    name: "WINDOW",
                    value: rawWindow ? String(rawWindow) : "",
                    derived: true
                }
            ],
            [
                { bits: 16, name: "CHECKSUM", short: "CKSUM" },
                { bits: 16, name: "URGENT POINTER", short: "URG" }
            ]
        ];
        if (model.optionBytes) {
            tcpRows.push([{
                bits: 32,
                name: `OPTIONS · ${model.optionBytes} B`,
                value: model.sack ? "NOP NOP TIMESTAMP · SACK OK" : "NOP NOP TIMESTAMP",
                derived: true
            }]);
        }

        const blockW = (w - 20) / 2;
        const rowH = 20;
        const blockY = wedgeBottom + 14;
        headerBlock(g, ox, blockY, blockW, "IPv4 · 20 B", ipRows, rowH);
        const tcpBottom = headerBlock(
            g, ox + blockW + 20, blockY, blockW, `TCP · ${model.tcp} B`, tcpRows, rowH
        );

        const notes = [];
        if (rawWindow && model.wscale) {
            notes.push(`WINDOW ${rawWindow} × 2^${model.wscale} = ${model.window} B`);
        } else if (model.wscale) {
            notes.push(`WINDOW SCALED × 2^${model.wscale}`);
        }
        if (model.pmtu) notes.push(`PMTU ${model.pmtu}`);
        if (!model.measured) notes.push("MSS NOT REPORTED · NOMINAL SEGMENT");
        // The punchline sits on the floor of the card, the way the reference
        // dossier keeps its log strip at the bottom.
        const verdictY = Math.max(tcpBottom + 26, oy + availH - 6);
        if (notes.length) {
            g.append("text")
                .attr("class", "kcard-note")
                .attr("x", ox).attr("y", verdictY - 14)
                .text(notes.join("  ·  "));
        }
        const overhead = (model.header / model.total) * 100;
        g.append("text")
            .attr("class", "frame-verdict")
            .attr("x", ox).attr("y", verdictY)
            .text(`${model.header} B OF CEREMONY CARRY ${model.payload} B OF CARGO`
                + `  ·  ${overhead.toFixed(1)}% OVERHEAD`);
    }

    return { open, close, isOpen: () => openKey !== null };
})();

window.FlowCard = FlowCard;
