// The card a FIB row or an ARP row in the Network IP map opens.
//
// The map is the index. The card is one object: this route, or this neighbour.
// HISTORY on the header is the NUD / next-hop life the kernel still keeps.
// Morph stays. The card draws on a host SVG inside the Network container
// because the main-page svg sits under z-index 9999.
const IpEntryCard = (() => {
    const W = 500;
    const PAD = 14;
    const CUT = 15;
    const HEADER = 25;
    const LINE = 16;
    const FOOTER = 34;
    const LABEL_W = 86;
    const POLL_MS = 2000;

    let openKey = null;
    let requestSeq = 0;
    let pollTimer = null;
    let lastAnchor = null;
    let lastQuery = null;
    let layout = null;
    let hostSel = null;

    function clip(text, max) {
        const value = String(text || "");
        return value.length > max ? `${value.slice(0, max - 1)}…` : value;
    }

    function entryKey(query) {
        if (!query) return "";
        if (query.kind === "neigh") {
            return `neigh|${query.ip || ""}|${query.iface || ""}`;
        }
        return `route|${query.destination || ""}|${query.gateway || ""}|${query.iface || ""}`;
    }

    function queryFromRow(kind, row) {
        if (kind === "neigh") {
            return { kind: "neigh", ip: row.ip, iface: row.iface || "" };
        }
        return {
            kind: "route",
            destination: row.destination,
            gateway: row.gateway || "",
            iface: row.iface || ""
        };
    }

    function formatAgo(seconds) {
        if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) return "—";
        const s = Math.max(0, Number(seconds));
        if (s < 1) return "<1s ago";
        if (s < 60) return `${Math.round(s)}s ago`;
        if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s ago`;
        return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
    }

    function routeFlags(bits) {
        const n = Number(bits) || 0;
        const names = [];
        if (n & 0x1) names.push("UP");
        if (n & 0x2) names.push("GATEWAY");
        if (n & 0x4) names.push("HOST");
        if (n & 0x10) names.push("DYNAMIC");
        if (n & 0x20) names.push("MODIFIED");
        return names.length ? names.join(" · ") : "—";
    }

    function hostSvg() {
        const net = document.getElementById("network-stack-container");
        const parent = net && getComputedStyle(net).display !== "none" ? net : document.body;
        let node = document.getElementById("ip-entry-kcard-host");
        if (!node) {
            node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            node.id = "ip-entry-kcard-host";
            node.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        }
        node.style.cssText = parent === document.body
            ? "position:fixed;inset:0;width:100%;height:100%;z-index:10050;pointer-events:none;"
            : "position:absolute;inset:0;width:100%;height:100%;z-index:1300;pointer-events:none;";
        if (node.parentNode !== parent) parent.appendChild(node);
        const sel = d3.select(node);
        if (sel.select("defs").empty()) {
            const defs = sel.append("defs");
            defs.append("filter")
                .attr("id", "ip-entry-drop")
                .attr("x", "-35%").attr("y", "-35%")
                .attr("width", "190%").attr("height", "200%")
                .append("feDropShadow")
                .attr("dx", 0).attr("dy", 7)
                .attr("stdDeviation", 10)
                .attr("flood-color", "#07090c")
                .attr("flood-opacity", 0.45);
        }
        hostSel = sel;
        return sel;
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
        if (hostSel) {
            hostSel.selectAll(".ip-entry-scrim, .ip-entry-layer, .ip-hist-scrim, .ip-hist-layer").remove();
        }
        const host = document.getElementById("ip-entry-kcard-host");
        if (host && !host.querySelector(".ip-entry-layer, .ip-hist-layer")) {
            host.remove();
            hostSel = null;
        }
        d3.select("body").on("keydown.ipentry", null);
        d3.select("body").on("keydown.iphist", null);
        window.dispatchEvent(new CustomEvent("kcard-closed"));
    }

    function load(query) {
        const params = new URLSearchParams();
        params.set("kind", query.kind);
        if (query.kind === "neigh") {
            params.set("ip", query.ip || "");
            if (query.iface) params.set("iface", query.iface);
        } else {
            params.set("destination", query.destination || "");
            if (query.gateway) params.set("gateway", query.gateway);
            if (query.iface) params.set("iface", query.iface);
        }
        return fetch(`/api/ip-entry?${params.toString()}`, { cache: "no-store" })
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

    function open(kind, row, anchor) {
        if (!row || (kind !== "neigh" && kind !== "route")) return;
        const query = queryFromRow(kind, row);
        const key = entryKey(query);
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
                window.frontendLogger.error("ip entry card failed to draw", {
                    source: "ip-entry-card", stack: String((err && err.stack) || err)
                });
            }
        });
    }

    function cardHeight(data) {
        let h = HEADER + 12 + 10;
        h += LINE * (data.kind === "neigh" ? 4 : 5);
        h += 16 + LINE;
        h += LINE * 3;
        h += FOOTER;
        return h;
    }

    function draw(data, anchor, live) {
        const svgHost = hostSvg();
        const viewW = window.innerWidth;
        const viewH = window.innerHeight;
        const cw = (live && layout) ? layout.cw : Math.min(W, viewW - 24);
        const compact = cw < 420;
        const h = cardHeight(data);

        let x;
        let y;
        if (live && layout) {
            x = layout.x;
            y = layout.y;
        } else {
            const from = anchor && Number.isFinite(anchor.x) ? anchor.x : viewW * 0.55;
            x = Number.isFinite(anchor && anchor.clearOf) ? anchor.clearOf : from + 28;
            if (x + cw + 16 > viewW) x = Math.max(12, from - cw - 28);
            if (x < 12) x = Math.max(12, viewW - cw - 16);
            y = (anchor && Number.isFinite(anchor.y) ? anchor.y : 160) - 24;
            y = Math.max(12, Math.min(viewH - h - 12, y));
        }
        layout = { x, y, cw, h };

        let layer;
        let panel;
        if (live) {
            layer = svgHost.select(".ip-entry-layer");
            panel = layer.select(".ip-entry-panel");
            if (layer.empty() || panel.empty()) return;
            panel.attr("transform", `translate(${x}, ${y})`);
            panel.select(".kcard-frame").attr("d", dossierCardPath(0, 0, cw, h, CUT));
            panel.select(".ip-entry-body").remove();
        } else {
            svgHost.selectAll(".ip-entry-scrim, .ip-entry-layer").remove();
            svgHost.append("rect")
                .attr("class", "ip-entry-scrim")
                .attr("x", 0).attr("y", 0).attr("width", viewW).attr("height", viewH)
                .attr("fill", "rgba(6, 9, 14, 0.42)")
                .style("pointer-events", "all")
                .style("cursor", "pointer")
                .style("opacity", 0)
                .on("click", () => close())
                .transition().duration(200).style("opacity", 1);

            layer = svgHost.append("g")
                .attr("class", "ip-entry-layer")
                .style("pointer-events", "all");

            if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
                const connY = Math.max(y + 12, Math.min(y + h - 12, anchor.y));
                layer.append("circle")
                    .attr("class", "kcard-anchor")
                    .attr("cx", anchor.x).attr("cy", anchor.y).attr("r", 3);
                layer.append("line")
                    .attr("class", "kcard-conn")
                    .attr("x1", anchor.x).attr("y1", anchor.y)
                    .attr("x2", x).attr("y2", connY);
            }

            panel = layer.append("g")
                .attr("class", "ip-entry-panel")
                .attr("transform", `translate(${x}, ${y})`)
                .on("click", (event) => event.stopPropagation());

            panel.append("path")
                .attr("class", "kcard-frame")
                .attr("d", dossierCardPath(0, 0, cw, h, CUT))
                .attr("filter", "url(#ip-entry-drop)")
                .attr("transform", `translate(0, ${h / 2}) scale(1, 0.02)`)
                .transition().delay(120).duration(200).ease(d3.easeCubicOut)
                .attr("transform", "translate(0,0) scale(1,1)");
        }

        const body = panel.append("g").attr("class", "ip-entry-body");
        if (!live) {
            body.style("opacity", 0);
            body.transition().delay(250).duration(180).style("opacity", 1);
        }
        paintBody(body, data, cw, compact, h);
        d3.select("body").on("keydown.ipentry", (event) => {
            if (event.key !== "Escape") return;
            if (svgHost.select(".ip-hist-layer").empty() === false) return;
            close();
        });
    }

    function paintBody(body, data, cw, compact, h) {
        const neigh = data.kind === "neigh";
        const title = neigh ? "NEIGH" : "ROUTE";
        const meta = neigh
            ? (data.nud || data.state || "—")
            : (data.default ? "DEFAULT" : "FIB");
        const valueX = PAD + LABEL_W;
        const maxVal = compact ? 34 : 46;

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
        text("kcard-title", PAD + 12, HEADER / 2 + 3.5, title);
        const histX = PAD + (neigh ? 62 : 68);
        const histLabel = text("kcard-meta", histX, HEADER / 2 + 3.5, "HISTORY")
            .style("fill", "rgba(244, 244, 236, 0.5)")
            .attr("letter-spacing", 1.2);
        const histRule = body.append("line")
            .attr("x1", histX).attr("x2", histX + 52)
            .attr("y1", HEADER / 2 + 6.5).attr("y2", HEADER / 2 + 6.5)
            .attr("stroke", "#e2a33e")
            .attr("stroke-width", 1)
            .attr("opacity", 0.35);
        body.append("rect")
            .attr("x", histX - 6).attr("y", 4)
            .attr("width", 64).attr("height", 18)
            .attr("fill", "transparent")
            .style("cursor", "pointer")
            .on("mouseenter", () => {
                histRule.attr("opacity", 1);
                histLabel.style("fill", "#e2a33e");
            })
            .on("mouseleave", () => {
                histRule.attr("opacity", 0.35);
                histLabel.style("fill", "rgba(244, 244, 236, 0.5)");
            })
            .on("click", (event) => {
                event.stopPropagation();
                drawHistory(data);
            });
        text("kcard-meta", cw - 13, HEADER / 2 + 3.5, meta, true)
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

        if (neigh) {
            fact("IP", data.ip || "—", true);
            fact("MAC", data.mac || "—");
            fact("IFACE", data.iface || "—");
            fact("NUD", data.nud || data.state || "—");
        } else {
            fact("DEST", data.destination || "—", true);
            fact("VIA", data.gateway && data.gateway !== "*" ? data.gateway : "on-link");
            fact("IFACE", data.iface || "—");
            fact("METRIC", data.metric == null ? "—" : String(data.metric));
            fact("FLAGS", routeFlags(data.flags));
        }

        cy += 16;
        text("kcard-section", PAD, cy, neigh ? "THIS NEIGHBOUR" : "THIS ROUTE");
        cy += LINE;
        if (neigh) {
            fact("STATE", data.nud || data.state || "from /proc/net/arp");
            fact("CONFIRM", data.confirmed_s != null
                ? formatAgo(data.confirmed_s)
                : "arp flags only · no NUD clock");
            fact("PROBES", data.probes != null ? String(data.probes) : "—");
        } else {
            const hop = data.nexthop;
            fact("NEXTHOP", hop
                ? `${hop.ip}  ·  ${hop.nud || hop.state || "—"}`
                : (data.gateway && data.gateway !== "*" ? "no ARP for gateway" : "on-link · no nh"));
            fact("HOP MAC", hop && hop.mac ? hop.mac : "—");
            fact("LOOKUP", data.default ? "fib default" : "fib prefix");
        }

        body.append("line")
            .attr("class", "kcard-divider")
            .attr("x1", 0).attr("y1", h - FOOTER + 8).attr("x2", cw).attr("y2", h - FOOTER + 8);
        text("kcard-foot", PAD, h - 10, "ESC OR CLICK OUTSIDE TO CLOSE");
        text("kcard-foot", cw - PAD, h - 10,
            neigh ? "/PROC/NET/ARP" : "/PROC/NET/ROUTE", true);
    }

    function historyHeight() {
        return HEADER + 12 + 10 + LINE * 6 + FOOTER;
    }

    function drawHistory(data) {
        const svgHost = hostSvg();
        if (!svgHost.select(".ip-hist-layer").empty()) {
            svgHost.selectAll(".ip-hist-scrim, .ip-hist-layer").remove();
            d3.select("body").on("keydown.iphist", null);
            return;
        }
        const viewW = window.innerWidth;
        const viewH = window.innerHeight;
        const cw = Math.min(460, viewW - 24);
        const h = historyHeight();
        let x = layout ? layout.x + layout.cw + 16 : 40;
        if (x + cw + 12 > viewW) x = Math.max(12, (layout ? layout.x : viewW) - cw - 16);
        let y = layout ? layout.y : 80;
        y = Math.max(12, Math.min(viewH - h - 12, y));

        svgHost.append("rect")
            .attr("class", "ip-hist-scrim")
            .attr("x", 0).attr("y", 0).attr("width", viewW).attr("height", viewH)
            .attr("fill", "transparent")
            .style("pointer-events", "all")
            .on("click", () => {
                svgHost.selectAll(".ip-hist-scrim, .ip-hist-layer").remove();
                d3.select("body").on("keydown.iphist", null);
            });

        const layer = svgHost.append("g")
            .attr("class", "ip-hist-layer")
            .style("pointer-events", "all");
        const panel = layer.append("g")
            .attr("transform", `translate(${x}, ${y})`)
            .on("click", (event) => event.stopPropagation());
        panel.append("path")
            .attr("class", "kcard-frame")
            .attr("d", dossierCardPath(0, 0, cw, h, CUT))
            .attr("filter", "url(#ip-entry-drop)");

        const body = panel.append("g");
        const text = (cls, tx, ty, value, anchorEnd) => body.append("text")
            .attr("class", cls)
            .attr("x", tx).attr("y", ty)
            .attr("text-anchor", anchorEnd ? "end" : "start")
            .text(value);
        const valueX = PAD + LABEL_W;
        let cy = HEADER + 12 + 10;
        function fact(label, value, accent) {
            text("kcard-section", PAD, cy, label);
            text(accent ? "kcard-signature" : "kcard-line", valueX, cy, clip(value || "—", 42));
            cy += LINE;
        }

        body.append("path")
            .attr("class", "kcard-strip")
            .attr("d", `M0,0 H${cw - CUT} L${cw},${CUT} V${HEADER} H0 Z`);
        body.append("circle").attr("class", "kcard-glyph-ring")
            .attr("cx", PAD).attr("cy", HEADER / 2).attr("r", 4.2);
        body.append("circle").attr("class", "kcard-glyph-dot")
            .attr("cx", PAD).attr("cy", HEADER / 2).attr("r", 1.6);
        text("kcard-title", PAD + 12, HEADER / 2 + 3.5,
            data.kind === "neigh" ? "HISTORY · NEIGH" : "HISTORY · ROUTE");
        body.append("line").attr("class", "kcard-divider")
            .attr("x1", 0).attr("y1", HEADER).attr("x2", cw).attr("y2", HEADER);

        if (data.kind === "neigh") {
            fact("NUD", data.nud || data.state || "—", true);
            fact("USED", data.used_s != null ? formatAgo(data.used_s) : "not exported");
            fact("CONFIRM", data.confirmed_s != null ? formatAgo(data.confirmed_s) : "not exported");
            fact("UPDATED", data.updated_s != null ? formatAgo(data.updated_s) : "not exported");
            fact("PROBES", data.probes != null ? String(data.probes) : "—");
            fact("REF", data.ref != null ? String(data.ref) : "—");
        } else {
            const hop = data.nexthop;
            fact("DEST", data.destination || "—", true);
            fact("VIA", data.gateway && data.gateway !== "*" ? data.gateway : "on-link");
            fact("NH NUD", hop ? (hop.nud || hop.state || "—") : "no neighbour yet");
            fact("CONFIRM", hop && hop.confirmed_s != null ? formatAgo(hop.confirmed_s) : "—");
            fact("PROBES", hop && hop.probes != null ? String(hop.probes) : "—");
            fact("NOTE", "kernel has no birth clock for a fib row");
        }

        body.append("line").attr("class", "kcard-divider")
            .attr("x1", 0).attr("y1", h - FOOTER + 8).attr("x2", cw).attr("y2", h - FOOTER + 8);
        text("kcard-foot", PAD, h - 10, "ESC CLOSES HISTORY");
        text("kcard-foot", cw - PAD, h - 10, "IP -S NEIGH", true);

        d3.select("body").on("keydown.iphist", (event) => {
            if (event.key !== "Escape") return;
            svgHost.selectAll(".ip-hist-scrim, .ip-hist-layer").remove();
            d3.select("body").on("keydown.iphist", null);
        });
    }

    return { open, close, isOpen: () => openKey !== null };
})();

window.IpEntryCard = IpEntryCard;
