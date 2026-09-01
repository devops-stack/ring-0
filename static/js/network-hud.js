// Packet path as a cinematic HUD.
//
// The layout follows the reference in three densities:
//   left    instruments — framed panels with grids, axes and a polar dial
//   centre  a plane in perspective, annotated with leader lines and rings
//   right   dense text groups under one large counter
//
// The one liberty taken with the reference: depth is not ground, it is kernel
// depth. USERSPACE sits nearest the viewer, NIC at the vanishing point, so a
// TX packet literally travels away from you into the hardware and an RX packet
// comes back out. Perspective does the foreshortening for free — packets move
// at a constant rate in depth, which is why they appear to slow down as they
// sink into the stack.
//
// The lights scattered on the plane are not decoration: one per established
// socket, so the "city" thins out when the host goes quiet.

const NetworkHud = (() => {
    const NS = "http://www.w3.org/2000/svg";

    const W = 1600;
    const H = 900;

    const RED = "#c8362b";
    const RED_HOT = "#e2503f";
    const RED_DIM = "rgba(200,54,43,0.42)";
    const RED_FAINT = "rgba(200,54,43,0.2)";
    const AMBER = "#e9a13c";
    const AMBER_HOT = "#f5c46a";
    const BONE = "#d8cfc6";

    // Left instrument column.
    const PANEL_X = 46;
    const PANEL_W = 250;
    const PANEL_H = 174;
    const PANEL_Y = [152, 348, 544];

    // Centre plane.
    const VPX = 762;
    const VPY = 264;
    const BOTTOM = 772;
    const PLANE_TOP = 302;
    const HALF_NEAR = 340;
    const DEPTH = 3.2;
    const TX_U = -0.46;
    const RX_U = 0.46;

    // Flip to true for the receding plane. Flat keeps every layer the same
    // width and spacing, so no layer is visually privileged by being nearer.
    const PERSPECTIVE = false;

    // Right readout column.
    const RIGHT_X = 1204;
    const RIGHT_W = 352;

    const LAYERS = [
        { id: "userspace", label: "USERSPACE", sub: "process context" },
        { id: "socket", label: "SOCKET API", sub: "process context" },
        { id: "tcp", label: "TCP / UDP", sub: "process context" },
        { id: "ip", label: "IP", sub: "route · fragment" },
        { id: "netfilter", label: "NETFILTER", sub: "hooks" },
        { id: "link", label: "LINK / TC", sub: "qdisc · neighbour" },
        { id: "driver", label: "DRIVER", sub: "softirq · NAPI" },
        { id: "nic", label: "NIC", sub: "hard IRQ · wire" },
    ];
    const T_OF = (i) => i / (LAYERS.length - 1);
    const T_NETFILTER = T_OF(4);
    const T_DRIVER = T_OF(6);
    // Allocation happens inside the driver, on the way up from the wire.
    const T_SKB = (T_DRIVER + 1) / 2;

    const STATE_COLOR = {
        active: AMBER_HOT,
        idle: AMBER,
        absent: "rgba(150,110,90,0.5)",
        unknown: "rgba(120,150,180,0.62)",
    };

    const HISTORY = 46;

    const state = {
        stack: null,
        mechanisms: [],
        byLayer: new Map(),
        iface: "",
        packets: [],
        lights: [],
        spawnTx: 0,
        spawnRx: 0,
        hist: { rx: [], tx: [], drop: [], retrans: [], qmax: [] },
    };

    let svg = null;
    let planeGroup = null;
    let packetGroup = null;
    let rightGroup = null;
    let lightGroup = null;
    const ui = {};
    let raf = null;
    let lastTs = 0;

    // ---- primitives -------------------------------------------------------

    function el(name, attrs = {}, parent = null) {
        const node = document.createElementNS(NS, name);
        Object.entries(attrs).forEach(([k, v]) => {
            if (v === null || v === undefined) return;
            node.setAttribute(k, String(v));
        });
        if (parent) parent.appendChild(node);
        return node;
    }

    function txt(parent, x, y, value, o = {}) {
        const node = el("text", {
            x,
            y,
            fill: o.fill || RED,
            "font-size": o.size || 8.5,
            "font-family": "'Share Tech Mono', monospace",
            "letter-spacing": o.spacing || "0.12em",
            "text-anchor": o.anchor || "start",
            opacity: o.opacity,
        }, parent);
        node.textContent = value;
        return node;
    }

    function clip(v, n) {
        const s = String(v === null || v === undefined ? "" : v);
        return s.length > n ? `${s.slice(0, n - 1)}…` : s;
    }

    function num(v, digits = 0) {
        const n = Number(v) || 0;
        return n.toFixed(digits);
    }

    // The kernel reports "no pacing limit" as an enormous rate; print it in a
    // width the panel can actually hold.
    function rateText(v) {
        const n = Number(v) || 0;
        if (n >= 1000) return `${(n / 1000).toFixed(1)} gbps`;
        return `${n.toFixed(2)} mbps`;
    }

    function ratio(a, b) {
        const x = Number(a) || 0;
        const y = Number(b) || 0;
        return y > 0 ? Math.max(0, Math.min(1, x / y)) : 0;
    }

    // Deterministic scatter so the "city" does not shimmer between frames.
    function rand(seed) {
        const x = Math.sin(seed * 12.9898) * 43758.5453;
        return x - Math.floor(x);
    }

    // ---- perspective ------------------------------------------------------

    const scaleAt = (t) => (PERSPECTIVE ? 1 / (1 + t * DEPTH) : 1);
    const yAt = (t) => (PERSPECTIVE
        ? VPY + (BOTTOM - VPY) * scaleAt(t)
        : BOTTOM + (PLANE_TOP - BOTTOM) * t);
    const halfAt = (t) => HALF_NEAR * scaleAt(t);
    const xAt = (t, u) => VPX + u * halfAt(t);

    // ---- chrome -----------------------------------------------------------

    function drawFrame(root) {
        [22, W - 22].forEach((x) => {
            el("line", { x1: x, y1: 120, x2: x, y2: H - 90, stroke: RED_FAINT, "stroke-width": 1 }, root);
            for (let y = 130; y < H - 90; y += 22) {
                const long = y % 88 < 22;
                el("line", {
                    x1: x,
                    y1: y,
                    x2: x + (x < W / 2 ? 1 : -1) * (long ? 10 : 5),
                    y2: y,
                    stroke: long ? RED_DIM : RED_FAINT,
                    "stroke-width": 1,
                }, root);
            }
            [0.22, 0.55, 0.78].forEach((f) => {
                el("rect", {
                    x: x - 2,
                    y: 120 + (H - 210) * f,
                    width: 4,
                    height: 26,
                    fill: RED,
                    opacity: 0.7,
                }, root);
            });
        });

        txt(root, PANEL_X, 78, "KERNEL NETWORK PATH", { size: 12, fill: RED_HOT, spacing: "0.3em" });
        ui.subtitle = txt(root, PANEL_X, 94, "scanning host…", { size: 8.5, fill: RED_DIM });
        ui.clock = txt(root, W - 46, 78, "", { size: 10, fill: RED_DIM, anchor: "end" });
    }

    function panel(root, index, title) {
        const y = PANEL_Y[index];
        const g = el("g", {}, root);
        txt(g, PANEL_X, y - 8, title, { size: 7.5, fill: RED_HOT, spacing: "0.18em" });
        el("rect", {
            x: PANEL_X,
            y,
            width: PANEL_W,
            height: PANEL_H,
            fill: "rgba(200,54,43,0.035)",
            stroke: RED_DIM,
            "stroke-width": 1,
        }, g);
        // Corner ticks, as on the reference panels.
        [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(([cx, cy]) => {
            const px = PANEL_X + cx * PANEL_W;
            const py = y + cy * PANEL_H;
            el("line", { x1: px, y1: py, x2: px + (cx ? -9 : 9), y2: py, stroke: RED_HOT, "stroke-width": 1.2 }, g);
            el("line", { x1: px, y1: py, x2: px, y2: py + (cy ? -9 : 9), stroke: RED_HOT, "stroke-width": 1.2 }, g);
        });
        return { g, x: PANEL_X, y, w: PANEL_W, h: PANEL_H };
    }

    // ---- left instruments -------------------------------------------------

    function buildThroughput(root) {
        const p = panel(root, 0, "INTERFACE THROUGHPUT · RX / TX  MB/S");
        const ix = p.x + 34;
        const iy = p.y + 16;
        const iw = p.w - 46;
        const ih = p.h - 40;

        for (let i = 0; i <= 4; i++) {
            const gy = iy + (ih * i) / 4;
            el("line", { x1: ix, y1: gy, x2: ix + iw, y2: gy, stroke: RED_FAINT, "stroke-width": 1 }, p.g);
        }
        for (let i = 0; i <= 6; i++) {
            const gx = ix + (iw * i) / 6;
            el("line", { x1: gx, y1: iy, x2: gx, y2: iy + ih, stroke: RED_FAINT, "stroke-width": 1 }, p.g);
        }
        ui.thrScale = [0, 1, 2, 3, 4].map((i) =>
            txt(p.g, ix - 6, iy + (ih * i) / 4 + 3, "", { size: 6.5, fill: RED_DIM, anchor: "end" })
        );
        txt(p.g, ix, iy + ih + 12, "-90s", { size: 6.5, fill: RED_DIM });
        txt(p.g, ix + iw, iy + ih + 12, "now", { size: 6.5, fill: RED_DIM, anchor: "end" });

        ui.thrRx = el("polyline", { fill: "none", stroke: AMBER, "stroke-width": 1.3, points: "" }, p.g);
        ui.thrTx = el("polyline", { fill: "none", stroke: RED_HOT, "stroke-width": 1.3, points: "" }, p.g);
        txt(p.g, ix + 6, iy + 12, "RX", { size: 7, fill: AMBER });
        txt(p.g, ix + 28, iy + 12, "TX", { size: 7, fill: RED_HOT });
        ui.thrBox = { ix, iy, iw, ih };
    }

    function buildCongestion(root) {
        const p = panel(root, 1, "CONGESTION CONTROL · CWND / RTT");
        const cx = p.x + 88;
        const cy = p.y + p.h / 2;
        const R = 62;

        [0.34, 0.62, 1].forEach((f) => {
            el("circle", { cx, cy, r: R * f, fill: "none", stroke: RED_FAINT, "stroke-width": 1 }, p.g);
        });
        for (let a = 0; a < 360; a += 30) {
            const rad = (a * Math.PI) / 180;
            el("line", {
                x1: cx + Math.cos(rad) * R * 0.9,
                y1: cy + Math.sin(rad) * R * 0.9,
                x2: cx + Math.cos(rad) * R,
                y2: cy + Math.sin(rad) * R,
                stroke: RED_DIM,
                "stroke-width": 1,
            }, p.g);
        }
        el("line", { x1: cx - R, y1: cy, x2: cx + R, y2: cy, stroke: RED_FAINT, "stroke-width": 1 }, p.g);
        el("line", { x1: cx, y1: cy - R, x2: cx, y2: cy + R, stroke: RED_FAINT, "stroke-width": 1 }, p.g);

        ui.ccArc = el("path", { fill: "none", stroke: AMBER, "stroke-width": 2.4, d: "" }, p.g);
        ui.ccNeedle = el("line", { x1: cx, y1: cy, x2: cx, y2: cy - R, stroke: RED_HOT, "stroke-width": 1.4 }, p.g);
        el("circle", { cx, cy, r: 2.6, fill: RED_HOT }, p.g);

        const tx = p.x + 168;
        ui.ccName = txt(p.g, tx, p.y + 34, "", { size: 8, fill: AMBER_HOT });
        ui.ccRtt = txt(p.g, tx, p.y + 52, "", { size: 7.5, fill: RED });
        ui.ccMin = txt(p.g, tx, p.y + 66, "", { size: 7.5, fill: RED_DIM });
        ui.ccCwnd = txt(p.g, tx, p.y + 88, "", { size: 7.5, fill: RED });
        ui.ccMss = txt(p.g, tx, p.y + 102, "", { size: 7.5, fill: RED_DIM });
        ui.ccPace = txt(p.g, tx, p.y + 124, "", { size: 7.5, fill: RED_DIM });
        ui.ccGeom = { cx, cy, R };
    }

    function buildQueues(root) {
        const p = panel(root, 2, "QUEUE OCCUPANCY · RETRANSMIT TREND");
        const ix = p.x + 34;
        const iy = p.y + 14;
        const iw = p.w - 46;
        const ih = 78;

        for (let i = 0; i <= 3; i++) {
            const gy = iy + (ih * i) / 3;
            el("line", { x1: ix, y1: gy, x2: ix + iw, y2: gy, stroke: RED_FAINT, "stroke-width": 1 }, p.g);
        }
        ui.qArea = el("polygon", { fill: "rgba(233,161,60,0.16)", stroke: "none", points: "" }, p.g);
        ui.qLine = el("polyline", { fill: "none", stroke: AMBER, "stroke-width": 1.2, points: "" }, p.g);
        ui.qPeak = txt(p.g, ix - 6, iy + 8, "", { size: 6.5, fill: RED_DIM, anchor: "end" });
        txt(p.g, ix - 6, iy + ih, "0", { size: 6.5, fill: RED_DIM, anchor: "end" });

        ui.bars = [];
        const labels = ["WMEM", "RMEM", "QDISC"];
        labels.forEach((label, i) => {
            const by = p.y + 110 + i * 18;
            txt(p.g, p.x + 10, by + 6, label, { size: 7, fill: RED_DIM });
            el("rect", { x: ix + 22, y: by, width: iw - 22, height: 7, fill: "rgba(200,54,43,0.14)" }, p.g);
            const fill = el("rect", { x: ix + 22, y: by, width: 0, height: 7, fill: AMBER }, p.g);
            const value = txt(p.g, p.x + p.w - 8, by + 6, "", { size: 6.5, fill: RED_DIM, anchor: "end" });
            ui.bars.push({ fill, value, max: iw - 22 });
        });
        ui.qBox = { ix, iy, iw, ih };
    }

    // ---- centre plane -----------------------------------------------------

    function buildPlane(root) {
        planeGroup = el("g", {}, root);
        lightGroup = el("g", {}, planeGroup);

        // Longitudinal rails converging on the vanishing point.
        [-1, TX_U, 0, RX_U, 1].forEach((u) => {
            el("line", {
                x1: xAt(0, u),
                y1: yAt(0),
                x2: xAt(1, u),
                y2: yAt(1),
                stroke: u === 0 ? RED_FAINT : "rgba(233,161,60,0.22)",
                "stroke-width": 1,
            }, planeGroup);
        });

        // One transverse line per kernel layer, labelled on both flanks.
        ui.layerRows = new Map();
        LAYERS.forEach((layer, i) => {
            const t = T_OF(i);
            const y = yAt(t);
            const half = halfAt(t);
            const s = scaleAt(t);
            const g = el("g", {}, planeGroup);

            el("line", {
                x1: VPX - half,
                y1: y,
                x2: VPX + half,
                y2: y,
                stroke: "rgba(233,161,60,0.3)",
                "stroke-width": 1,
            }, g);

            // Everything a layer says about itself lives on the left flank.
            // The right flank is kept clear as a corridor for the leader lines
            // that tie each layer to its block of mechanisms.
            const nameSize = Math.max(6, Math.min(11, 10 * s + 3));
            const tagSize = Math.max(5.5, Math.min(7.5, 8 * s + 2));
            const label = txt(g, VPX - half - 10, y + 3, layer.label, {
                size: nameSize,
                fill: AMBER,
                anchor: "end",
                opacity: 0.85,
            });
            const metric = txt(g, VPX - half - 10, y + 3 + nameSize + 1, "", {
                size: tagSize,
                fill: RED,
                anchor: "end",
            });
            const sub = txt(g, VPX - half - 10, y + 3 + nameSize + tagSize + 2, layer.sub, {
                size: tagSize,
                fill: RED_DIM,
                anchor: "end",
            });
            ui.layerRows.set(layer.id, { label, sub, metric, t, y, half });
        });

        // Focus rings — the layer carrying the most load right now.
        ui.ring1 = el("ellipse", {
            fill: "none",
            stroke: AMBER,
            "stroke-width": 1.2,
            "stroke-dasharray": "6 5",
            opacity: 0.85,
        }, planeGroup);
        ui.ring2 = el("ellipse", {
            fill: "none",
            stroke: "rgba(233,161,60,0.45)",
            "stroke-width": 1,
            "stroke-dasharray": "3 6",
        }, planeGroup);
        ui.leader = el("polyline", {
            fill: "none",
            stroke: "rgba(233,161,60,0.5)",
            "stroke-width": 1,
            points: "",
        }, planeGroup);
        ui.callout = txt(planeGroup, 0, 0, "", { size: 9, fill: AMBER_HOT, spacing: "0.18em" });
        ui.calloutSub = txt(planeGroup, 0, 0, "", { size: 6.5, fill: RED_DIM });

        // Where an sk_buff starts to exist on the way in.
        const ySkb = yAt(T_SKB);
        const hSkb = halfAt(T_SKB);
        el("line", {
            x1: VPX - hSkb,
            y1: ySkb,
            x2: VPX + hSkb,
            y2: ySkb,
            stroke: "rgba(120,200,160,0.4)",
            "stroke-width": 1,
            "stroke-dasharray": "4 4",
        }, planeGroup);
        txt(planeGroup, VPX, ySkb - 6, "SK_BUFF ALLOCATED", {
            size: 7,
            fill: "rgba(130,205,170,0.8)",
            anchor: "middle",
        });
        txt(planeGroup, VPX, ySkb + 11, "above: bare frame   ·   below: sk_buff", {
            size: 6,
            fill: "rgba(130,205,170,0.45)",
            anchor: "middle",
        });

        txt(planeGroup, xAt(0, TX_U), yAt(0) + 22, "TX  ↑ INTO KERNEL", { size: 8, fill: RED, anchor: "middle" });
        txt(planeGroup, xAt(0, RX_U), yAt(0) + 22, "RX  ↓ TO PROCESS", { size: 8, fill: AMBER, anchor: "middle" });

        packetGroup = el("g", {}, planeGroup);

        // Bottom-left boxed headline, as on the reference.
        // Sits clear below the plane: the flat projection keeps layer labels
        // running down the left flank all the way to the base.
        const bx = 336;
        const by = 848;
        el("path", {
            d: `M ${bx - 10} ${by - 20} L ${bx - 10} ${by + 26} M ${bx - 10} ${by - 20} L ${bx - 2} ${by - 20}`,
            stroke: RED_HOT,
            fill: "none",
            "stroke-width": 1.2,
        }, root);
        txt(root, bx, by - 8, "PREDICTED", { size: 11, fill: BONE, spacing: "0.2em" });
        txt(root, bx, by + 8, "PACKET DROP", { size: 11, fill: BONE, spacing: "0.2em" });
        ui.bigDrop = txt(root, bx + 132, by + 12, "0.00", { size: 30, fill: AMBER_HOT, spacing: "0.02em" });
        txt(root, bx + 132, by + 26, "% OF PACKETS CROSSING NETFILTER", { size: 6, fill: RED_DIM });
    }

    function refreshLights(count) {
        const want = Math.max(0, Math.min(240, count));
        if (state.lights.length === want) return;
        lightGroup.innerHTML = "";
        state.lights = [];
        for (let i = 0; i < want; i++) {
            const t = 0.04 + rand(i + 1) * 0.93;
            const u = (rand(i + 91) - 0.5) * 1.94;
            const s = scaleAt(t);
            const node = el("circle", {
                cx: xAt(t, u),
                cy: yAt(t) - rand(i + 17) * 3,
                r: Math.max(0.5, 1.9 * s + 0.35),
                fill: rand(i + 41) > 0.72 ? AMBER_HOT : AMBER,
                opacity: 0.2 + rand(i + 7) * 0.55,
            }, lightGroup);
            state.lights.push(node);
        }
    }

    // ---- right readouts ---------------------------------------------------

    function buildRightStatic(root) {
        el("rect", {
            x: RIGHT_X,
            y: 132,
            width: RIGHT_W,
            height: 20,
            fill: "rgba(200,54,43,0.18)",
            stroke: RED_DIM,
            "stroke-width": 1,
        }, root);
        txt(root, RIGHT_X + 8, 146, "THROUGHPUT:", { size: 8, fill: RED_HOT });
        txt(root, RIGHT_X + 78, 146, "PACKETS PER SECOND", { size: 8, fill: BONE, spacing: "0.16em" });

        el("rect", {
            x: RIGHT_X,
            y: 152,
            width: RIGHT_W,
            height: 52,
            fill: "rgba(200,54,43,0.05)",
            stroke: RED_DIM,
            "stroke-width": 1,
        }, root);
        ui.bigPps = txt(root, RIGHT_X + 12, 192, "0", { size: 36, fill: AMBER_HOT, spacing: "0.06em" });
        ui.bigDropRate = txt(root, RIGHT_X + RIGHT_W - 10, 170, "", { size: 9, fill: RED_HOT, anchor: "end" });
        ui.bigSplit = txt(root, RIGHT_X + RIGHT_W - 10, 196, "", { size: 7, fill: RED_DIM, anchor: "end" });

        rightGroup = el("g", {}, root);
    }

    const HEADER_H = 13;
    const ROW_H = 11;
    const BLOCK_GAP = 8;

    function renderRight() {
        if (!rightGroup) return;
        rightGroup.innerHTML = "";
        ui.blocks = new Map();
        let y = 232;

        LAYERS.forEach((layer) => {
            const items = state.byLayer.get(layer.id) || [];
            if (!items.length) return;

            const h = HEADER_H + items.length * ROW_H + 7;
            const g = el("g", { class: "blk" }, rightGroup);

            const bg = el("rect", {
                x: RIGHT_X,
                y,
                width: RIGHT_W,
                height: h,
                fill: "rgba(200,54,43,0.045)",
                stroke: RED_DIM,
                "stroke-width": 1,
                class: "blk-bg",
            }, g);
            const accent = el("rect", { x: RIGHT_X, y, width: 2.5, height: h, fill: RED_DIM }, g);
            const header = el("rect", {
                x: RIGHT_X + 2.5,
                y,
                width: RIGHT_W - 2.5,
                height: HEADER_H,
                fill: "rgba(200,54,43,0.18)",
            }, g);
            txt(g, RIGHT_X + 9, y + 9.5, layer.label, { size: 7.5, fill: BONE, spacing: "0.22em" });

            const live = items.filter((it) => it.state === "active" || it.state === "idle").length;
            txt(g, RIGHT_X + RIGHT_W - 8, y + 9.5, `${live}/${items.length} LIVE`, {
                size: 6.5,
                fill: RED_HOT,
                anchor: "end",
            });

            const ticks = [];
            [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(([cxf, cyf]) => {
                const px = RIGHT_X + cxf * RIGHT_W;
                const py = y + cyf * h;
                ticks.push(el("line", {
                    x1: px,
                    y1: py,
                    x2: px + (cxf ? -7 : 7),
                    y2: py,
                    stroke: RED_HOT,
                    "stroke-width": 1.2,
                }, g));
            });

            let ry = y + HEADER_H + 9;
            items.forEach((item) => {
                const color = STATE_COLOR[item.state] || STATE_COLOR.unknown;
                const rowG = el("g", {}, g);
                el("rect", {
                    x: RIGHT_X + 9,
                    y: ry - 4.5,
                    width: 3.5,
                    height: 3.5,
                    fill: item.state === "absent" || item.state === "unknown" ? "none" : color,
                    stroke: color,
                    "stroke-width": 0.8,
                }, rowG);
                txt(rowG, RIGHT_X + 19, ry, clip(item.label, 21), { size: 7, fill: RED, spacing: "0.08em" });
                txt(rowG, RIGHT_X + RIGHT_W - 8, ry, clip(item.detail, 38), {
                    size: 6.5,
                    fill: color,
                    anchor: "end",
                    spacing: "0.02em",
                });
                const title = document.createElementNS(NS, "title");
                title.textContent = `${item.label} · ${item.kind} · ${item.state}\n${item.detail}\nsource: ${item.source}`;
                rowG.appendChild(title);
                ry += ROW_H;
            });

            // The link back to the scene: which layer this block belongs to.
            const row = ui.layerRows.get(layer.id);
            let leader = null;
            let anchorDot = null;
            if (row) {
                const px = VPX + row.half + 8;
                const py = row.y;
                const by = y + h / 2;
                leader = el("polyline", {
                    fill: "none",
                    stroke: "rgba(200,54,43,0.34)",
                    "stroke-width": 1,
                    points: `${px},${py} ${px + 16},${py} ${RIGHT_X - 18},${by} ${RIGHT_X - 2},${by}`,
                }, g);
                anchorDot = el("rect", {
                    x: px - 2,
                    y: py - 2,
                    width: 4,
                    height: 4,
                    fill: "none",
                    stroke: "rgba(200,54,43,0.5)",
                    "stroke-width": 1,
                }, g);
            }

            ui.blocks.set(layer.id, { bg, accent, header, ticks, leader, anchorDot });
            y += h + BLOCK_GAP;
        });

        ui.rightBottom = y;
    }

    function highlightBlock(hotId) {
        if (!ui.blocks) return;
        ui.blocks.forEach((blk, id) => {
            const hot = id === hotId;
            blk.bg.setAttribute("fill", hot ? "rgba(233,161,60,0.07)" : "rgba(200,54,43,0.045)");
            blk.bg.setAttribute("stroke", hot ? "rgba(233,161,60,0.55)" : RED_DIM);
            blk.accent.setAttribute("fill", hot ? AMBER_HOT : RED_DIM);
            blk.header.setAttribute("fill", hot ? "rgba(233,161,60,0.22)" : "rgba(200,54,43,0.18)");
            blk.ticks.forEach((tick) => tick.setAttribute("stroke", hot ? AMBER_HOT : RED_HOT));
            if (blk.leader) {
                blk.leader.setAttribute("stroke", hot ? "rgba(233,161,60,0.7)" : "rgba(200,54,43,0.34)");
                blk.leader.setAttribute("stroke-width", hot ? "1.3" : "1");
            }
            if (blk.anchorDot) {
                blk.anchorDot.setAttribute("stroke", hot ? AMBER_HOT : "rgba(200,54,43,0.5)");
            }
        });
    }

    // ---- live values ------------------------------------------------------

    function pushHistory(stack) {
        const m = stack.layer_metrics || {};
        const drv = m.driver || {};
        const tcp = m.tcp_udp || {};
        const nf = m.netfilter || {};
        const h = state.hist;
        h.rx.push(Number(drv.rx_mb_s) || 0);
        h.tx.push(Number(drv.tx_mb_s) || 0);
        h.retrans.push(Number(tcp.retrans_per_sec) || 0);
        h.drop.push(Number(nf.drop_per_sec) || 0);
        h.qmax.push(Math.max(ratio(tcp.wmem, tcp.sndbuf), ratio(tcp.rmem, tcp.rcvbuf)));
        Object.values(h).forEach((arr) => {
            while (arr.length > HISTORY) arr.shift();
        });
    }

    function plot(series, box, scaleMax) {
        if (!series.length) return "";
        const max = Math.max(scaleMax, ...series) || 1;
        return series
            .map((v, i) => {
                const x = box.ix + (box.iw * i) / Math.max(1, HISTORY - 1);
                const y = box.iy + box.ih - (box.ih * v) / max;
                return `${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(" ");
    }

    function paintInstruments() {
        const stack = state.stack || {};
        const m = stack.layer_metrics || {};
        const tcp = m.tcp_udp || {};
        const bbr = stack.bbr || {};
        const h = state.hist;

        const thrMax = Math.max(0.5, ...h.rx, ...h.tx);
        ui.thrRx.setAttribute("points", plot(h.rx, ui.thrBox, thrMax));
        ui.thrTx.setAttribute("points", plot(h.tx, ui.thrBox, thrMax));
        ui.thrScale.forEach((node, i) => {
            node.textContent = (thrMax * (1 - i / 4)).toFixed(2);
        });

        const { cx, cy, R } = ui.ccGeom;
        const rtt = Number(tcp.rtt_ms) || 0;
        const angle = -Math.PI / 2 + Math.min(1, rtt / 200) * Math.PI * 1.5;
        ui.ccNeedle.setAttribute("x2", String(cx + Math.cos(angle) * R * 0.86));
        ui.ccNeedle.setAttribute("y2", String(cy + Math.sin(angle) * R * 0.86));

        const cwndFrac = Math.min(1, (Number(tcp.cwnd) || 0) / 100);
        const arcR = R * 0.7;
        const end = -Math.PI / 2 + cwndFrac * Math.PI * 1.98;
        const large = cwndFrac > 0.5 ? 1 : 0;
        ui.ccArc.setAttribute(
            "d",
            `M ${cx} ${cy - arcR} A ${arcR} ${arcR} 0 ${large} 1 ${cx + Math.cos(end) * arcR} ${cy + Math.sin(end) * arcR}`
        );

        ui.ccName.textContent = String(tcp.cc || bbr.cc || "unknown").toUpperCase();
        ui.ccRtt.textContent = `RTT      ${num(rtt, 2)} ms`;
        ui.ccMin.textContent = `MIN RTT  ${num(bbr.min_rtt_ms, 3)} ms`;
        ui.ccCwnd.textContent = `CWND     ${tcp.cwnd || 0} seg`;
        ui.ccMss.textContent = `MSS      ${bbr.mss || 0} b`;
        ui.ccPace.textContent = `PACING   ${rateText(bbr.pacing_rate_mbps)}`;

        const peak = Math.max(0.01, ...h.retrans, ...h.drop);
        const pts = plot(h.retrans, ui.qBox, peak);
        ui.qLine.setAttribute("points", pts);
        if (pts) {
            const b = ui.qBox;
            ui.qArea.setAttribute("points", `${b.ix},${b.iy + b.ih} ${pts} ${b.ix + b.iw},${b.iy + b.ih}`);
        }
        ui.qPeak.textContent = peak.toFixed(2);

        const drv = m.driver || {};
        const fills = [
            { r: ratio(tcp.wmem, tcp.sndbuf), label: `${Math.round(ratio(tcp.wmem, tcp.sndbuf) * 100)}%` },
            { r: ratio(tcp.rmem, tcp.rcvbuf), label: `${Math.round(ratio(tcp.rmem, tcp.rcvbuf) * 100)}%` },
            { r: Math.min(1, (Number(drv.tx_queue) || 0) / 100), label: `${drv.tx_queue || 0}p` },
        ];
        ui.bars.forEach((bar, i) => {
            bar.fill.setAttribute("width", String(bar.max * fills[i].r));
            bar.value.textContent = fills[i].label;
        });
    }

    function paintPlane() {
        const stack = state.stack || {};
        const m = stack.layer_metrics || {};
        const activity = stack.layer_activity || {};
        const socket = m.socket_api || {};
        const tcp = m.tcp_udp || {};
        const ip = m.ip || {};
        const nf = m.netfilter || {};
        const drv = m.driver || {};
        const nic = m.nic || {};

        const readouts = {
            userspace: `${(m.userspace || {}).active_processes || 0} proc`,
            socket: `${socket.active_sockets || 0} sock · ${socket.established || 0} est`,
            tcp: `cwnd ${tcp.cwnd || 0} · rtt ${num(tcp.rtt_ms, 1)}ms`,
            ip: `${num(ip.in_packets_per_sec)} in · ${num(ip.out_packets_per_sec)} out`,
            netfilter: `ct ${nf.conntrack_count || 0} · drop ${num(nf.drop_per_sec, 2)}/s`,
            link: `qdisc backlog ${drv.tx_queue || 0}`,
            driver: `${num(drv.rx_mb_s, 2)} / ${num(drv.tx_mb_s, 2)} MB/s`,
            nic: `err ${nic.rx_errors || 0}/${nic.tx_errors || 0} · drop ${nic.drops_total || 0}`,
        };

        // Userspace is scored by process count, which would win every round
        // without ever describing packet work. Rank only the layers a packet
        // is actually handled in.
        let hottest = "ip";
        let best = -1;
        ui.layerRows.forEach((row, id) => {
            row.metric.textContent = readouts[id] || "";
            const level = Number(activity[id === "link" ? "driver" : id]) || 0;
            row.label.setAttribute("opacity", String(0.55 + Math.min(0.45, level)));
            if (id !== "userspace" && level > best) {
                best = level;
                hottest = id;
            }
        });

        const row = ui.layerRows.get(hottest);
        if (row) {
            const rx = row.half * 1.06;
            const ry = PERSPECTIVE ? Math.max(7, row.half * 0.17) : 16;
            ui.ring1.setAttribute("cx", String(VPX));
            ui.ring1.setAttribute("cy", String(row.y));
            ui.ring1.setAttribute("rx", String(rx));
            ui.ring1.setAttribute("ry", String(ry));
            ui.ring2.setAttribute("cx", String(VPX));
            ui.ring2.setAttribute("cy", String(row.y));
            ui.ring2.setAttribute("rx", String(rx * 1.24));
            ui.ring2.setAttribute("ry", String(ry * 1.3));

            const lx = VPX + rx * 0.55;
            const ly = row.y - ry - 6;
            ui.leader.setAttribute("points", `${lx},${ly} ${lx + 40},${ly - 34} ${lx + 116},${ly - 34}`);
            ui.callout.setAttribute("x", String(lx + 40));
            ui.callout.setAttribute("y", String(ly - 40));
            ui.callout.textContent = `BUSIEST LAYER · ${(LAYERS.find((l) => l.id === hottest) || {}).label || ""}`;
            ui.calloutSub.setAttribute("x", String(lx + 40));
            ui.calloutSub.setAttribute("y", String(ly - 30));
            ui.calloutSub.textContent = `load ${Math.round(best * 100)}% · ${readouts[hottest] || ""}`;
        }
        highlightBlock(hottest);

        refreshLights(Number(socket.established) || 0);

        const pps = (Number(ip.in_packets_per_sec) || 0) + (Number(ip.out_packets_per_sec) || 0);
        ui.bigPps.textContent = pps >= 1000 ? `${(pps / 1000).toFixed(1)}K` : String(Math.round(pps));
        ui.bigDropRate.textContent = `-${num(nf.drop_per_sec, 2)}/s`;
        ui.bigSplit.textContent = `IN ${num(ip.in_packets_per_sec)} · OUT ${num(ip.out_packets_per_sec)}`;
        ui.bigDrop.textContent = num((Number(nf.drop_ratio) || 0) * 100, 2);

        ui.clock.textContent = String(stack.timestamp || "").replace("T", "  ").slice(0, 19);
    }

    // ---- packets ----------------------------------------------------------

    function tick(ts) {
        raf = requestAnimationFrame(tick);
        if (!packetGroup) return;
        const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0.016;
        lastTs = ts;

        const stack = state.stack || {};
        const ip = (stack.layer_metrics || {}).ip || {};
        const signals = stack.signals || {};
        const speed = 0.085 * (Number(signals.packet_speed) || 2);
        const dropProb = Number(signals.drop_probability) || 0;

        const rate = (pps) => Math.max(0.35, Math.min(8, Math.log10(1 + (Number(pps) || 0)) * 3));
        state.spawnTx += rate(ip.out_packets_per_sec) * dt;
        state.spawnRx += rate(ip.in_packets_per_sec) * dt;
        while (state.spawnTx >= 1 && state.packets.length < 56) {
            state.spawnTx -= 1;
            state.packets.push({ dir: "tx", t: 0, node: null });
        }
        while (state.spawnRx >= 1 && state.packets.length < 56) {
            state.spawnRx -= 1;
            state.packets.push({ dir: "rx", t: 1, node: null });
        }

        state.packets.forEach((p) => {
            const prev = p.t;
            p.t += (p.dir === "tx" ? 1 : -1) * speed * dt;

            if (!p.checked) {
                const crossed = p.dir === "tx"
                    ? prev < T_NETFILTER && p.t >= T_NETFILTER
                    : prev > T_NETFILTER && p.t <= T_NETFILTER;
                if (crossed) {
                    p.checked = true;
                    if (Math.random() < dropProb) {
                        p.dead = true;
                        flash(xAt(T_NETFILTER, p.dir === "tx" ? TX_U : RX_U), yAt(T_NETFILTER), scaleAt(T_NETFILTER));
                    }
                }
            }
            if (p.t > 1.01 || p.t < -0.01) p.dead = true;
            if (p.dead) {
                if (p.node) p.node.remove();
                return;
            }

            const u = p.dir === "tx" ? TX_U : RX_U;
            const s = scaleAt(p.t);
            const isSkb = p.dir === "tx" || p.t < T_SKB;
            if (!p.node) p.node = el("circle", {}, packetGroup);
            p.node.setAttribute("cx", String(xAt(p.t, u)));
            p.node.setAttribute("cy", String(yAt(p.t)));
            p.node.setAttribute("r", String(Math.max(0.8, 4.2 * s)));
            p.node.setAttribute("fill", isSkb ? (p.dir === "tx" ? RED_HOT : AMBER_HOT) : "none");
            p.node.setAttribute("stroke", isSkb ? "none" : AMBER);
            p.node.setAttribute("stroke-width", isSkb ? "0" : "1");
            p.node.setAttribute("opacity", String(0.45 + s * 0.55));
        });

        state.packets = state.packets.filter((p) => !p.dead);
    }

    function flash(x, y, s) {
        const ring = el("circle", { cx: x, cy: y, r: 2, fill: "none", stroke: RED_HOT, "stroke-width": 1.4 }, packetGroup);
        let r = 2;
        const grow = setInterval(() => {
            r += 1.4 * Math.max(0.4, s);
            ring.setAttribute("r", String(r));
            ring.setAttribute("opacity", String(Math.max(0, 1 - r / (14 * Math.max(0.4, s)))));
            if (r > 14 * Math.max(0.4, s)) {
                clearInterval(grow);
                ring.remove();
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
        const order = { active: 0, idle: 1, absent: 2, unknown: 3 };
        state.byLayer.forEach((list) => list.sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9)));

        const s = data.summary || {};
        if (ui.subtitle) {
            ui.subtitle.textContent =
                `IFACE ${state.iface}   ·   ${s.active || 0} ACTIVE   ·   ${s.absent || 0} NOT ATTACHED   ·   ${s.unknown || 0} NOT VISIBLE`;
        }
        renderRight();
    }

    async function loadMechanisms() {
        try {
            const res = await fetch("/api/network-mechanisms");
            const json = await res.json();
            ingestMechanisms(json.data || json);
        } catch (err) {
            if (ui.subtitle) ui.subtitle.textContent = "MECHANISM SCAN UNAVAILABLE";
        }
    }

    async function loadStack() {
        try {
            const res = await fetch("/api/network-stack-realtime");
            const json = await res.json();
            state.stack = json.data || json;
            pushHistory(state.stack);
            paintInstruments();
            paintPlane();
        } catch (err) {
            /* keep the last good frame */
        }
    }

    function build() {
        const host = document.getElementById("network-hud");
        if (!host) return;
        host.innerHTML = "";
        svg = el("svg", {
            viewBox: `0 0 ${W} ${H}`,
            class: "network-hud-svg",
            preserveAspectRatio: "xMidYMid meet",
        }, host);

        drawFrame(svg);
        buildThroughput(svg);
        buildCongestion(svg);
        buildQueues(svg);
        buildPlane(svg);
        buildRightStatic(svg);
    }

    async function start() {
        build();
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

document.addEventListener("DOMContentLoaded", () => NetworkHud.start());
