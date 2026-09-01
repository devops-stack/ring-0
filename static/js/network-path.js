// Packet path view: one vertical axis, two directions, honest machinery.
//
// Left    kernel layers as bands. Band height grows with how much machinery
//         actually lives there, so the shape of the column is already a fact.
// Center  two columns. TX walks down, RX walks up. An RX frame is drawn hollow
//         until it clears the driver band, because before that there is no
//         sk_buff yet — that is the whole reason XDP is cheap.
// Right   mechanisms anchored at the height of the layer they hook into,
//         split into path / hook / table, and greyed when not present.
//
// Nothing here invents state. "absent" and "unknown" are different colours on
// purpose: no XDP program attached is not the same as not being allowed to look.

const NetworkPath = (() => {
    const NS = "http://www.w3.org/2000/svg";

    const W = 1460;
    const LEFT_X = 26;
    const LEFT_W = 208;
    const CENTER_X = 258;
    const CENTER_W = 396;
    const RIGHT_X = 676;
    const RIGHT_W = 756;
    const TOP = 104;
    const BAND_GAP = 6;
    const CHIP_H = 34;
    const CHIP_GAP = 6;
    const CHIPS_PER_ROW = 2;

    const TX_X = CENTER_X + CENTER_W * 0.3;
    const RX_X = CENTER_X + CENTER_W * 0.72;

    // Top to bottom. TX descends this list, RX climbs it.
    const LAYERS = [
        { id: "userspace", label: "USERSPACE", sub: "process context" },
        { id: "socket", label: "SOCKET API", sub: "process context" },
        { id: "tcp", label: "TCP / UDP", sub: "process context" },
        { id: "ip", label: "IP", sub: "routing / fragment" },
        { id: "netfilter", label: "NETFILTER", sub: "hooks" },
        { id: "link", label: "LINK / TC", sub: "qdisc · neighbour" },
        { id: "driver", label: "DRIVER", sub: "softirq · NAPI" },
        { id: "nic", label: "NIC", sub: "hard IRQ · wire" },
    ];

    const STATE_STYLE = {
        active: { stroke: "#e2a33e", fill: "rgba(226,163,62,0.14)", text: "#f0c479", dash: null },
        idle: { stroke: "rgba(226,163,62,0.5)", fill: "rgba(226,163,62,0.05)", text: "rgba(226,163,62,0.75)", dash: null },
        absent: { stroke: "rgba(120,120,120,0.4)", fill: "transparent", text: "rgba(150,150,150,0.65)", dash: "4 3" },
        unknown: { stroke: "rgba(90,130,160,0.5)", fill: "transparent", text: "rgba(130,170,200,0.7)", dash: "1 3" },
    };

    const state = {
        mechanisms: [],
        byLayer: new Map(),
        bands: new Map(),
        stack: null,
        iface: "",
        packets: [],
        spawnTxAcc: 0,
        spawnRxAcc: 0,
        totalH: 900,
    };

    let svg = null;
    let layerGroup = null;
    let packetGroup = null;
    let metricNodes = new Map();
    let raf = null;
    let lastTs = 0;

    function el(name, attrs = {}, parent = null) {
        const node = document.createElementNS(NS, name);
        Object.entries(attrs).forEach(([key, value]) => {
            if (value === null || value === undefined) return;
            node.setAttribute(key, String(value));
        });
        if (parent) parent.appendChild(node);
        return node;
    }

    function text(parent, x, y, value, opts = {}) {
        const node = el("text", {
            x,
            y,
            fill: opts.fill || "#e2a33e",
            "font-size": opts.size || 11,
            "font-family": "'Share Tech Mono', monospace",
            "letter-spacing": opts.spacing || "0.06em",
            "text-anchor": opts.anchor || "start",
            opacity: opts.opacity,
        }, parent);
        node.textContent = value;
        return node;
    }

    function clip(value, max) {
        const raw = String(value === null || value === undefined ? "" : value);
        return raw.length > max ? `${raw.slice(0, max - 1)}…` : raw;
    }

    function ratio(part, whole) {
        const p = Number(part) || 0;
        const w = Number(whole) || 0;
        if (w <= 0) return 0;
        return Math.max(0, Math.min(1, p / w));
    }

    // ---- layout -----------------------------------------------------------

    function computeBands() {
        state.bands.clear();
        let y = TOP;
        LAYERS.forEach((layer) => {
            const items = state.byLayer.get(layer.id) || [];
            const rows = Math.ceil(items.length / CHIPS_PER_ROW);
            const height = Math.max(80, rows * (CHIP_H + CHIP_GAP) + 30);
            state.bands.set(layer.id, { ...layer, y, h: height, mid: y + height / 2, items });
            y += height + BAND_GAP;
        });
        state.totalH = y + 40;
    }

    // ---- drawing ----------------------------------------------------------

    function drawHeader(root) {
        text(root, LEFT_X, 34, "KERNEL LAYERS", { size: 11, opacity: 0.55, spacing: "0.22em" });
        text(root, CENTER_X + 6, 34, "PACKET PATH", { size: 11, opacity: 0.55, spacing: "0.22em" });
        text(root, RIGHT_X, 34, "MECHANISMS ON THIS HOST", { size: 11, opacity: 0.55, spacing: "0.22em" });

        text(root, TX_X, 66, "TX ↓", { size: 12, anchor: "middle", opacity: 0.85 });
        text(root, RX_X, 66, "RX ↑", { size: 12, anchor: "middle", opacity: 0.85 });

        const legend = el("g", {}, root);
        const entries = [
            ["path", "packet goes through", "active"],
            ["hook", "attached, optional", "absent"],
            ["table", "consulted, not traversed", "idle"],
            ["?", "not visible unprivileged", "unknown"],
        ];
        let lx = RIGHT_X;
        entries.forEach(([kind, note, style]) => {
            const st = STATE_STYLE[style];
            glyph(legend, lx + 6, 62, kind === "?" ? "hook" : kind, st);
            text(legend, lx + 18, 66, `${kind} — ${note}`, { size: 9, fill: st.text });
            lx += 186;
        });
    }

    function glyph(parent, cx, cy, kind, style) {
        const common = {
            stroke: style.stroke,
            fill: style.fill === "transparent" ? "none" : style.fill,
            "stroke-width": 1.2,
            "stroke-dasharray": style.dash,
        };
        if (kind === "path") {
            el("rect", { x: cx - 4, y: cy - 4, width: 8, height: 8, ...common }, parent);
        } else if (kind === "table") {
            el("circle", { cx, cy, r: 4.4, ...common }, parent);
        } else {
            el("path", { d: `M ${cx} ${cy - 5} L ${cx + 5} ${cy} L ${cx} ${cy + 5} L ${cx - 5} ${cy} Z`, ...common }, parent);
        }
    }

    function drawLayers(root) {
        layerGroup = el("g", {}, root);
        metricNodes = new Map();

        state.bands.forEach((band) => {
            const g = el("g", {}, layerGroup);

            el("rect", {
                x: LEFT_X,
                y: band.y,
                width: LEFT_W,
                height: band.h,
                fill: "rgba(226,163,62,0.04)",
                stroke: "rgba(226,163,62,0.22)",
                "stroke-width": 1,
            }, g);

            text(g, LEFT_X + 14, band.y + 26, band.label, { size: 13, spacing: "0.14em" });
            text(g, LEFT_X + 14, band.y + 42, band.sub, { size: 9, opacity: 0.45 });

            // Activity bar — how busy this layer is right now.
            el("rect", {
                x: LEFT_X + 14,
                y: band.y + band.h - 20,
                width: LEFT_W - 28,
                height: 4,
                fill: "rgba(226,163,62,0.12)",
            }, g);
            const bar = el("rect", {
                x: LEFT_X + 14,
                y: band.y + band.h - 20,
                width: 0,
                height: 4,
                fill: "#e2a33e",
            }, g);

            // Band guide across the centre so the two columns stay tied to layers.
            el("line", {
                x1: CENTER_X,
                y1: band.y + band.h,
                x2: CENTER_X + CENTER_W,
                y2: band.y + band.h,
                stroke: "rgba(226,163,62,0.1)",
                "stroke-width": 1,
            }, g);

            const txMetric = text(g, TX_X - 12, band.mid + 4, "", { size: 9, anchor: "end", opacity: 0.7 });
            const rxMetric = text(g, RX_X + 12, band.mid + 4, "", { size: 9, opacity: 0.7 });

            metricNodes.set(band.id, { bar, txMetric, rxMetric });
            drawChips(root, band);
        });
    }

    function drawChips(root, band) {
        if (!band.items.length) {
            text(root, RIGHT_X, band.mid + 4, "— no attachable mechanism at this layer", {
                size: 9,
                opacity: 0.28,
            });
            return;
        }
        const chipW = (RIGHT_W - CHIP_GAP * (CHIPS_PER_ROW - 1)) / CHIPS_PER_ROW;
        band.items.forEach((item, index) => {
            const row = Math.floor(index / CHIPS_PER_ROW);
            const col = index % CHIPS_PER_ROW;
            const x = RIGHT_X + col * (chipW + CHIP_GAP);
            const y = band.y + 14 + row * (CHIP_H + CHIP_GAP);
            const style = STATE_STYLE[item.state] || STATE_STYLE.unknown;
            const g = el("g", {}, layerGroup);

            el("rect", {
                x,
                y,
                width: chipW,
                height: CHIP_H,
                fill: style.fill,
                stroke: style.stroke,
                "stroke-width": 1,
                "stroke-dasharray": style.dash,
            }, g);

            glyph(g, x + 16, y + CHIP_H / 2, item.kind, style);

            const pathTag = item.path === "rx" ? "RX" : item.path === "tx" ? "TX" : "";
            text(g, x + 30, y + 14, clip(item.label, 26), { size: 10.5, fill: style.text });
            text(g, x + 30, y + 26, clip(item.detail, 46), { size: 8.5, fill: style.text, opacity: 0.62 });
            if (pathTag) {
                text(g, x + chipW - 8, y + 14, pathTag, { size: 8.5, anchor: "end", fill: style.text, opacity: 0.55 });
            }
            text(g, x + chipW - 8, y + 26, clip(item.source, 22), {
                size: 7.5,
                anchor: "end",
                fill: style.text,
                opacity: 0.35,
            });

            const title = document.createElementNS(NS, "title");
            title.textContent = `${item.label} · ${item.kind} · ${item.state}\n${item.detail}\nsource: ${item.source}`;
            g.appendChild(title);
        });
    }

    function drawColumns(root) {
        const top = TOP;
        const bottom = state.totalH - 40;

        [[TX_X, "tx"], [RX_X, "rx"]].forEach(([x, dir]) => {
            el("line", {
                x1: x,
                y1: top,
                x2: x,
                y2: bottom,
                stroke: "rgba(226,163,62,0.28)",
                "stroke-width": 1.5,
            }, root);
            const tipY = dir === "tx" ? bottom : top;
            const sign = dir === "tx" ? -1 : 1;
            el("path", {
                d: `M ${x - 5} ${tipY + sign * 10} L ${x} ${tipY} L ${x + 5} ${tipY + sign * 10}`,
                stroke: "rgba(226,163,62,0.6)",
                fill: "none",
                "stroke-width": 1.4,
            }, root);
        });

        // The line where an sk_buff starts to exist on the receive side.
        const driver = state.bands.get("driver");
        if (driver) {
            const y = driver.y + driver.h;
            el("line", {
                x1: RX_X - 46,
                y1: y,
                x2: RX_X + 60,
                y2: y,
                stroke: "rgba(120,200,160,0.55)",
                "stroke-width": 1,
                "stroke-dasharray": "5 3",
            }, root);
            text(root, RX_X + 64, y + 3, "sk_buff born", { size: 8.5, fill: "rgba(120,200,160,0.8)" });
        }

        packetGroup = el("g", {}, root);
    }

    function build() {
        const host = document.getElementById("network-path");
        if (!host) return;
        host.innerHTML = "";
        computeBands();

        svg = el("svg", {
            viewBox: `0 0 ${W} ${state.totalH}`,
            class: "network-path-svg",
            preserveAspectRatio: "xMidYMin meet",
        }, host);

        drawHeader(svg);
        drawLayers(svg);
        drawColumns(svg);
    }

    // ---- live metrics -----------------------------------------------------

    function fmtBytes(value) {
        const n = Number(value) || 0;
        if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}M`;
        if (n >= 1024) return `${(n / 1024).toFixed(0)}K`;
        return String(Math.round(n));
    }

    function layerReadouts(stack) {
        const m = (stack && stack.layer_metrics) || {};
        const socket = m.socket_api || {};
        const tcp = m.tcp_udp || {};
        const ip = m.ip || {};
        const nf = m.netfilter || {};
        const drv = m.driver || {};
        const nic = m.nic || {};
        const qdiscBacklog = drv.tx_queue || 0;

        return {
            userspace: {
                tx: `${(m.userspace || {}).active_processes || 0} proc`,
                rx: "",
            },
            socket: {
                tx: `wmem ${fmtBytes(tcp.wmem)}/${fmtBytes(tcp.sndbuf)}`,
                rx: `rmem ${fmtBytes(tcp.rmem)}/${fmtBytes(tcp.rcvbuf)}`,
                txFill: ratio(tcp.wmem, tcp.sndbuf),
                rxFill: ratio(tcp.rmem, tcp.rcvbuf),
            },
            tcp: {
                tx: `cwnd ${tcp.cwnd || 0} · rtx ${(tcp.retrans_per_sec || 0).toFixed(1)}/s`,
                rx: `rtt ${(tcp.rtt_ms || 0).toFixed(1)} ms · ${socket.established || 0} est`,
            },
            ip: {
                tx: `${(ip.out_packets_per_sec || 0).toFixed(0)} pps out`,
                rx: `${(ip.in_packets_per_sec || 0).toFixed(0)} pps in`,
            },
            netfilter: {
                tx: `drop ${(nf.drop_per_sec || 0).toFixed(2)}/s`,
                rx: `ct ${nf.conntrack_count || 0}/${nf.conntrack_max || 0}`,
            },
            link: {
                tx: `qdisc backlog ${qdiscBacklog}`,
                rx: "",
            },
            driver: {
                tx: `${(drv.tx_mb_s || 0).toFixed(2)} MB/s`,
                rx: `${(drv.rx_mb_s || 0).toFixed(2)} MB/s`,
            },
            nic: {
                tx: `err ${nic.tx_errors || 0}`,
                rx: `err ${nic.rx_errors || 0} · drop ${nic.drops_total || 0}`,
            },
        };
    }

    function paint() {
        if (!state.stack) return;
        const activity = state.stack.layer_activity || {};
        const readouts = layerReadouts(state.stack);

        state.bands.forEach((band) => {
            const nodes = metricNodes.get(band.id);
            if (!nodes) return;
            const key = band.id === "tcp" ? "tcp" : band.id === "socket" ? "socket" : band.id;
            const level = Math.max(0, Math.min(1, Number(activity[key === "link" ? "driver" : key]) || 0));
            nodes.bar.setAttribute("width", String((LEFT_W - 28) * level));
            const readout = readouts[band.id] || {};
            nodes.txMetric.textContent = readout.tx || "";
            nodes.rxMetric.textContent = readout.rx || "";
        });
    }

    // ---- packet animation -------------------------------------------------

    function spawn(dir) {
        const top = TOP;
        const bottom = state.totalH - 40;
        state.packets.push({
            dir,
            y: dir === "tx" ? top : bottom,
            node: null,
            dead: false,
        });
    }

    function packetLimit() {
        return 44;
    }

    function tick(ts) {
        raf = requestAnimationFrame(tick);
        if (!svg || !packetGroup) return;
        const dt = lastTs ? Math.min(0.12, (ts - lastTs) / 1000) : 0.016;
        lastTs = ts;

        const stack = state.stack || {};
        const ipm = (stack.layer_metrics || {}).ip || {};
        const signals = stack.signals || {};
        const speed = 34 * (Number(signals.packet_speed) || 2.0);
        const dropProb = Number(signals.drop_probability) || 0;

        // Spawn rate is a readable stand-in for pps, not a 1:1 packet count.
        const txRate = Math.max(0.4, Math.min(9, Math.log10(1 + (Number(ipm.out_packets_per_sec) || 0)) * 3.2));
        const rxRate = Math.max(0.4, Math.min(9, Math.log10(1 + (Number(ipm.in_packets_per_sec) || 0)) * 3.2));

        state.spawnTxAcc += txRate * dt;
        state.spawnRxAcc += rxRate * dt;
        while (state.spawnTxAcc >= 1 && state.packets.length < packetLimit()) {
            state.spawnTxAcc -= 1;
            spawn("tx");
        }
        while (state.spawnRxAcc >= 1 && state.packets.length < packetLimit()) {
            state.spawnRxAcc -= 1;
            spawn("rx");
        }

        const top = TOP;
        const bottom = state.totalH - 40;
        const nf = state.bands.get("netfilter");
        const driver = state.bands.get("driver");
        const skbLine = driver ? driver.y + driver.h : bottom;

        state.packets.forEach((p) => {
            const prevY = p.y;
            p.y += (p.dir === "tx" ? 1 : -1) * speed * dt;

            if (nf && !p.checked) {
                const crossed = p.dir === "tx"
                    ? prevY < nf.mid && p.y >= nf.mid
                    : prevY > nf.mid && p.y <= nf.mid;
                if (crossed) {
                    p.checked = true;
                    if (Math.random() < dropProb) {
                        p.dead = true;
                        flash(p.dir === "tx" ? TX_X : RX_X, nf.mid);
                    }
                }
            }

            if (p.y > bottom + 4 || p.y < top - 4) p.dead = true;

            if (p.dead) {
                if (p.node) p.node.remove();
                return;
            }

            // Before the driver band an RX frame is not yet an sk_buff.
            const isSkb = p.dir === "tx" || p.y < skbLine;
            if (!p.node) {
                p.node = el("rect", {
                    x: (p.dir === "tx" ? TX_X : RX_X) - 3.5,
                    y: p.y - 3.5,
                    width: 7,
                    height: 7,
                    rx: 1,
                }, packetGroup);
            }
            p.node.setAttribute("y", String(p.y - 3.5));
            p.node.setAttribute("fill", isSkb ? "#e2a33e" : "none");
            p.node.setAttribute("stroke", isSkb ? "none" : "rgba(226,163,62,0.55)");
            p.node.setAttribute("stroke-width", isSkb ? "0" : "1");
        });

        state.packets = state.packets.filter((p) => !p.dead);
    }

    function flash(x, y) {
        const mark = el("circle", {
            cx: x,
            cy: y,
            r: 3,
            fill: "none",
            stroke: "#d2555a",
            "stroke-width": 1.6,
        }, packetGroup);
        let r = 3;
        const grow = setInterval(() => {
            r += 1.6;
            mark.setAttribute("r", String(r));
            mark.setAttribute("opacity", String(Math.max(0, 1 - r / 16)));
            if (r > 16) {
                clearInterval(grow);
                mark.remove();
            }
        }, 40);
    }

    // ---- data -------------------------------------------------------------

    function ingestMechanisms(data) {
        state.mechanisms = Array.isArray(data.mechanisms) ? data.mechanisms : [];
        state.iface = data.iface || "";
        state.byLayer = new Map();
        state.mechanisms.forEach((item) => {
            const list = state.byLayer.get(item.layer) || [];
            list.push(item);
            state.byLayer.set(item.layer, list);
        });
        // Present machinery first, unavailable last — the eye should land on
        // what is actually running.
        const order = { active: 0, idle: 1, absent: 2, unknown: 3 };
        state.byLayer.forEach((list) => list.sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9)));

        const summary = data.summary || {};
        const label = document.getElementById("np-summary");
        if (label) {
            label.textContent = `${state.iface} · ${summary.active || 0} active · ${summary.absent || 0} not attached · ${summary.unknown || 0} not visible`;
        }
    }

    async function loadMechanisms() {
        try {
            const res = await fetch("/api/network-mechanisms");
            const json = await res.json();
            ingestMechanisms(json.data || json);
            build();
            paint();
        } catch (err) {
            const label = document.getElementById("np-summary");
            if (label) label.textContent = "mechanism scan unavailable";
        }
    }

    async function loadStack() {
        try {
            const res = await fetch("/api/network-stack-realtime");
            const json = await res.json();
            state.stack = json.data || json;
            paint();
        } catch (err) {
            /* keep the last good frame */
        }
    }

    async function start() {
        await loadMechanisms();
        await loadStack();
        setInterval(loadStack, 2000);
        setInterval(loadMechanisms, 15000);
        if (raf) cancelAnimationFrame(raf);
        lastTs = 0;
        raf = requestAnimationFrame(tick);
    }

    return { start };
})();

document.addEventListener("DOMContentLoaded", () => NetworkPath.start());
