// Kernel Cutaway — rendering probe. No live data on purpose.
//
// The point of this page is to prove the drawing technique before any
// telemetry is wired to it. Three things have to hold up:
//
//   1. volume from three flat faces — isometric solids shaded top / left /
//      right against a fixed light, which is far cheaper than real 3D and
//      reads just as solid at this scale
//   2. the section convention — 45° hatching on a cut face is the universal
//      engineering signal for "this is where the body was opened"
//   3. the cutaway itself — half the shell stays sealed. Without the sealed
//      half the viewer cannot tell what was removed and the effect collapses
//      into "two unrelated drawings side by side"
//
// The machinery inside the disc is procedural filler with a fixed seed. It is
// deliberately meaningless here: once the technique is accepted it gets
// replaced by real structures (runqueues per CPU, slab caches, mounted
// filesystems, detected network hooks), so that density means something.

const KernelCutaway = (() => {
    const NS = "http://www.w3.org/2000/svg";

    const W = 1420;
    const H = 900;

    // Isometric basis. x grows to screen right-down, y to left-down, z up.
    const KX = Math.cos(Math.PI / 6);
    const KY = 0.5;

    const DCX = 930;
    const DCY = 480;
    const R = 300;
    const HUB_R = 66;
    const WALL = 20;
    const COVER_T = 13;

    const SECTORS = [
        { label: "SCHED", sub: "scheduler" },
        { label: "NET", sub: "network" },
        { label: "IRQ", sub: "interrupts" },
        { label: "VFS", sub: "fs" },
        { label: "IPC", sub: "ipc" },
        { label: "MM", sub: "memory" },
    ];

    let svg = null;
    let sealedClip = null;
    let openClip = null;
    let raf = null;

    const state = { span: 180 };

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
            class: o.cls || "ink",
            "font-size": o.size || 9,
            "letter-spacing": o.spacing || "0.14em",
            "text-anchor": o.anchor || "start",
        }, parent);
        node.textContent = value;
        return node;
    }

    function seeded(n) {
        const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
        return x - Math.floor(x);
    }

    // Project a model point onto the plate.
    function pt(ox, oy, x, y, z) {
        return [ox + (x - y) * KX, oy + (x + y) * KY - z];
    }

    function poly(parent, cls, points) {
        return el("polygon", {
            class: cls,
            points: points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" "),
        }, parent);
    }

    // A solid, as three visible faces. Light sits upper-left, so the top is
    // brightest, the y+d flank medium, the x+w flank darkest.
    function box(parent, ox, oy, x, y, z, w, d, h) {
        const P = (a, b, c) => pt(ox, oy, a, b, c);
        const g = el("g", {}, parent);
        poly(g, "fr", [P(x + w, y, z + h), P(x + w, y + d, z + h), P(x + w, y + d, z), P(x + w, y, z)]);
        poly(g, "fl", [P(x, y + d, z + h), P(x + w, y + d, z + h), P(x + w, y + d, z), P(x, y + d, z)]);
        poly(g, "ft", [P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)]);
        return g;
    }

    function plates(parent, ox, oy, count, w, d, h, gap) {
        const g = el("g", {}, parent);
        for (let i = 0; i < count; i++) box(g, ox, oy, 0, 0, i * (h + gap), w, d, h);
        return g;
    }

    // A circle in the model plane projects to an axis-aligned ellipse.
    function drum(parent, ox, oy, r, h) {
        const g = el("g", {}, parent);
        const [cx, cyTop] = pt(ox, oy, 0, 0, h);
        const rx = r * KX * Math.SQRT2;
        const ry = r * KY * Math.SQRT2;
        el("path", {
            class: "fl",
            d: `M ${cx - rx} ${cyTop} A ${rx} ${ry} 0 0 1 ${cx + rx} ${cyTop}`
                + ` L ${cx + rx} ${cyTop + h} A ${rx} ${ry} 0 0 0 ${cx - rx} ${cyTop + h} Z`,
        }, g);
        el("ellipse", { class: "ft", cx, cy: cyTop, rx, ry }, g);
        return g;
    }

    function rail(parent, ox, oy, len, teeth) {
        const g = el("g", {}, parent);
        box(g, ox, oy, 0, 0, 0, len, 12, 7);
        for (let i = 0; i < teeth; i++) {
            box(g, ox, oy, 3 + i * (len - 6) / teeth, 2, 7, (len - 6) / teeth - 3, 8, 9);
        }
        return g;
    }

    function hexNode(parent, cx, cy, r) {
        const points = [];
        for (let i = 0; i < 6; i++) {
            const a = (Math.PI / 3) * i - Math.PI / 6;
            points.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        }
        return poly(parent, "node", points);
    }

    // ---- plate 01: primitives --------------------------------------------

    function frame(parent, x, y, w, h, index, title, sub) {
        const g = el("g", {}, parent);
        el("rect", { class: "panel", x, y, width: w, height: h }, g);
        el("rect", { class: "tag", x, y: y - 17, width: 15, height: 13 }, g);
        txt(g, x + 4, y - 7, index, { cls: "tagtext", size: 8 });
        txt(g, x + 22, y - 7, title, { size: 9.5 });
        if (sub) txt(g, x + w, y - 7, sub, { cls: "dim", size: 7.5, anchor: "end" });
        return g;
    }

    function buildPrimitives(root) {
        const x = 44;
        const y = 118;
        const w = 388;
        const h = 232;
        const g = frame(root, x, y, w, h, "01", "PRIMITIVES", "three faces, fixed light");

        const base = y + 150;
        const items = [
            ["BLOCK", "struct", (gx) => box(g, gx, base, 0, 0, 0, 30, 30, 34)],
            ["PLATES", "layers", (gx) => plates(g, gx, base, 5, 30, 30, 6, 3)],
            ["DRUM", "ring buf", (gx) => drum(g, gx, base - 6, 17, 34)],
            ["RAIL", "queue", (gx) => rail(g, gx - 24, base - 4, 54, 4)],
        ];
        items.forEach(([label, sub, draw], i) => {
            const gx = x + 74 + i * 88;
            draw(gx);
            txt(g, gx, y + h - 34, label, { size: 8, anchor: "middle" });
            txt(g, gx, y + h - 23, sub, { cls: "dim", size: 7, anchor: "middle" });
        });

        // Light-direction glyph, so the shading reads as a decision.
        const lx = x + w - 44;
        const ly = y + 30;
        el("line", { class: "hair", x1: lx - 16, y1: ly - 16, x2: lx - 4, y2: ly - 4 }, g);
        el("path", { class: "hair", d: `M ${lx - 8} ${lx > 0 ? ly - 4 : ly} L ${lx - 4} ${ly - 4} L ${lx - 4} ${ly - 8}` }, g);
        el("circle", { class: "hair", cx: lx - 18, cy: ly - 18, r: 4 }, g);
        txt(g, lx + 4, ly - 2, "LIGHT", { cls: "dim", size: 7 });
    }

    // ---- plate 02: the section convention --------------------------------

    function buildSection(root) {
        const x = 44;
        const y = 400;
        const w = 388;
        const h = 250;
        const g = frame(root, x, y, w, h, "02", "SECTION", "45° hatch = cut face");

        const base = y + 168;

        // Intact body.
        const ax = x + 96;
        box(g, ax, base, 0, 0, 0, 44, 44, 40);
        txt(g, ax, y + h - 40, "CLOSED", { size: 8, anchor: "middle" });
        txt(g, ax, y + h - 29, "shell intact", { cls: "dim", size: 7, anchor: "middle" });

        // Same body with the near corner removed.
        const bx = x + 258;
        const s = 44;
        const hh = 40;
        const m = s / 2;
        const P = (a, b, c) => pt(bx, base, a, b, c);

        // Outer flanks that survive the cut.
        poly(g, "fr", [P(s, 0, hh), P(s, m, hh), P(s, m, 0), P(s, 0, 0)]);
        poly(g, "fl", [P(0, s, hh), P(m, s, hh), P(m, s, 0), P(0, s, 0)]);
        // L-shaped top.
        poly(g, "ft", [P(0, 0, hh), P(s, 0, hh), P(s, m, hh), P(m, m, hh), P(m, s, hh), P(0, s, hh)]);
        // The two exposed internal walls — these are the cut faces.
        poly(g, "cut", [P(m, m, hh), P(m, s, hh), P(m, s, 0), P(m, m, 0)]);
        poly(g, "cut", [P(m, m, hh), P(s, m, hh), P(s, m, 0), P(m, m, 0)]);
        // Notch floor.
        poly(g, "floor", [P(m, m, 0), P(s, m, 0), P(s, s, 0), P(m, s, 0)]);

        txt(g, bx, y + h - 40, "SECTIONED", { size: 8, anchor: "middle" });
        txt(g, bx, y + h - 29, "hatched faces are cut", { cls: "dim", size: 7, anchor: "middle" });

        const [lx, ly] = P(m, m, hh);
        el("polyline", {
            class: "leader",
            points: `${lx + 4},${ly - 4} ${lx + 34},${ly - 30} ${lx + 66},${ly - 30}`,
        }, g);
        txt(g, lx + 70, ly - 27, "CUT PLANE", { cls: "accent", size: 7 });
    }

    // ---- plate 03: the kernel disc ---------------------------------------

    function wedgePath(a0, a1, r) {
        const rad = (a) => (a * Math.PI) / 180;
        const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
        return `M ${DCX} ${DCY}`
            + ` L ${DCX + Math.cos(rad(a0)) * r} ${DCY + Math.sin(rad(a0)) * r}`
            + ` A ${r} ${r} 0 ${large} 1 ${DCX + Math.cos(rad(a1)) * r} ${DCY + Math.sin(rad(a1)) * r} Z`;
    }

    function machinery(parent) {
        // Packed along arcs so the fill follows the body of the disc rather
        // than a rectangle that happens to be clipped by it.
        const rings = [0.36, 0.55, 0.73, 0.89];
        let n = 0;
        rings.forEach((rf, ri) => {
            const rr = HUB_R + (R - WALL - HUB_R) * rf;
            const step = 15 - ri * 2;
            for (let a = -88; a <= 88; a += step) {
                n += 1;
                const s1 = seeded(n);
                const s2 = seeded(n + 97);
                const rad = (a * Math.PI) / 180;
                const px = DCX + Math.cos(rad) * rr;
                const py = DCY + Math.sin(rad) * rr;
                const kind = s1 * 4;
                if (kind < 1.1) {
                    box(parent, px, py, 0, 0, 0, 12 + s2 * 12, 10 + s2 * 8, 8 + s1 * 22);
                } else if (kind < 2.2) {
                    plates(parent, px, py, 3 + Math.floor(s2 * 3), 16, 13, 3, 2);
                } else if (kind < 3.1) {
                    drum(parent, px, py, 6 + s2 * 5, 10 + s1 * 14);
                } else {
                    rail(parent, px, py, 26 + s2 * 18, 3);
                }
            }
        });
    }

    function buildDisc(root) {
        const g = frame(root, 470, 118, 906, 732, "03", "KERNEL CUTAWAY", "cover removed from one half");

        const defs = el("defs", {}, root);
        sealedClip = el("clipPath", { id: "clip-sealed" }, defs);
        const sealedShape = el("path", {}, sealedClip);
        openClip = el("clipPath", { id: "clip-open" }, defs);
        const openShape = el("path", {}, openClip);
        sealedClip._shape = sealedShape;
        openClip._shape = openShape;

        // --- open half: floor, wall, machinery -----------------------------
        const openG = el("g", { "clip-path": "url(#clip-open)" }, g);
        el("circle", { class: "floor", cx: DCX, cy: DCY, r: R - WALL }, openG);
        el("circle", { class: "wall", cx: DCX, cy: DCY, r: R - WALL / 2, "stroke-width": WALL }, openG);

        const mach = el("g", {}, openG);
        machinery(mach);

        // Inner shadow: the body should feel deeper than its floor.
        const grad = el("radialGradient", { id: "wellShade" }, defs);
        el("stop", { offset: "0.45", "stop-color": "#000", "stop-opacity": "0.22" }, grad);
        el("stop", { offset: "1", "stop-color": "#000", "stop-opacity": "0" }, grad);
        el("circle", {
            cx: DCX,
            cy: DCY,
            r: R - WALL,
            fill: "url(#wellShade)",
            "pointer-events": "none",
        }, openG);

        // --- sealed half: flat plates, fasteners ---------------------------
        const sealedG = el("g", { "clip-path": "url(#clip-sealed)" }, g);
        el("circle", { class: "plate", cx: DCX, cy: DCY, r: R }, sealedG);
        for (let i = 0; i < 12; i++) {
            const a0 = -90 + i * 30 + 2;
            const a1 = -90 + (i + 1) * 30 - 2;
            const rad = (a) => (a * Math.PI) / 180;
            const inner = HUB_R + 14;
            const outer = R - 12;
            el("path", {
                class: "sector",
                d: `M ${DCX + Math.cos(rad(a0)) * inner} ${DCY + Math.sin(rad(a0)) * inner}`
                    + ` L ${DCX + Math.cos(rad(a0)) * outer} ${DCY + Math.sin(rad(a0)) * outer}`
                    + ` A ${outer} ${outer} 0 0 1 ${DCX + Math.cos(rad(a1)) * outer} ${DCY + Math.sin(rad(a1)) * outer}`
                    + ` L ${DCX + Math.cos(rad(a1)) * inner} ${DCY + Math.sin(rad(a1)) * inner}`
                    + ` A ${inner} ${inner} 0 0 0 ${DCX + Math.cos(rad(a0)) * inner} ${DCY + Math.sin(rad(a0)) * inner} Z`,
            }, sealedG);
            const am = rad(-90 + i * 30 + 15);
            hexNode(sealedG, DCX + Math.cos(am) * (R - 62), DCY + Math.sin(am) * (R - 62), 9);
        }

        // --- the cut: cover edge, sectioned --------------------------------
        // Drawn as a band on the sealed side of the diameter. Strictly a plan
        // view would show this edge-on; technical illustration cheats it into
        // visibility, and that cheat is what makes the slice legible.
        const cutG = el("g", {}, g);
        state.cutBand = el("rect", {
            class: "cut",
            x: DCX - COVER_T,
            y: DCY - R,
            width: COVER_T,
            height: R * 2,
        }, cutG);
        state.cutEdge = el("line", { class: "cutedge", x1: DCX, y1: DCY - R, x2: DCX, y2: DCY + R }, cutG);

        // --- hub -----------------------------------------------------------
        el("circle", { class: "hub", cx: DCX, cy: DCY, r: HUB_R }, g);
        el("circle", { class: "hair", cx: DCX, cy: DCY, r: HUB_R - 7 }, g);
        txt(g, DCX, DCY - 3, "LINUX", { size: 12, anchor: "middle", spacing: "0.24em" });
        txt(g, DCX, DCY + 13, "KERNEL", { size: 12, anchor: "middle", spacing: "0.24em" });

        el("circle", { class: "hair", cx: DCX, cy: DCY, r: R }, g);
        el("circle", { class: "hairdot", cx: DCX, cy: DCY, r: R + 22 }, g);

        // --- sector labels around the rim ----------------------------------
        SECTORS.forEach((sector, i) => {
            const a = (-90 + i * 60 + 30) * (Math.PI / 180);
            const lx = DCX + Math.cos(a) * (R + 34);
            const ly = DCY + Math.sin(a) * (R + 34);
            const right = Math.cos(a) > 0.05;
            const middle = Math.abs(Math.cos(a)) <= 0.05;
            el("line", {
                class: "hair",
                x1: DCX + Math.cos(a) * (R + 4),
                y1: DCY + Math.sin(a) * (R + 4),
                x2: DCX + Math.cos(a) * (R + 20),
                y2: DCY + Math.sin(a) * (R + 20),
            }, g);
            el("rect", { class: "pip", x: lx - 2, y: ly - 2, width: 4, height: 4 }, g);
            const anchor = middle ? "middle" : right ? "start" : "end";
            const off = middle ? 0 : right ? 10 : -10;
            txt(g, lx + off, ly - 2, sector.label, { size: 9, anchor });
            txt(g, lx + off, ly + 9, sector.sub, { cls: "dim", size: 7, anchor });
        });

        setSpan(state.span);
    }

    // ---- reveal -----------------------------------------------------------

    function setSpan(span) {
        state.span = Math.max(0, Math.min(360, span));
        const a0 = -90;
        const a1 = a0 + state.span;
        const big = R + 60;

        // Degenerate arcs would blank the whole group, so clamp the ends.
        openClip._shape.setAttribute("d", state.span <= 0.2 ? "M 0 0 Z" : wedgePath(a0, a1, big));
        sealedClip._shape.setAttribute(
            "d",
            state.span >= 359.8 ? "M 0 0 Z" : wedgePath(a1, a0 + 360, big)
        );

        // The cut band follows the leading edge of the remaining cover.
        const rad = (a1 * Math.PI) / 180;
        const ex = DCX + Math.cos(rad) * R;
        const ey = DCY + Math.sin(rad) * R;
        state.cutEdge.setAttribute("x1", DCX);
        state.cutEdge.setAttribute("y1", DCY);
        state.cutEdge.setAttribute("x2", ex);
        state.cutEdge.setAttribute("y2", ey);
        const angle = a1 + 90;
        state.cutBand.setAttribute("transform", `rotate(${angle} ${DCX} ${DCY})`);
        state.cutBand.setAttribute("x", DCX - COVER_T);
        state.cutBand.setAttribute("y", DCY - R);
        state.cutBand.setAttribute("height", R);
        state.cutBand.setAttribute("opacity", state.span <= 0.5 || state.span >= 359.5 ? 0 : 1);
    }

    function reveal() {
        if (raf) cancelAnimationFrame(raf);
        const from = 0;
        const to = 180;
        const dur = 1100;
        const t0 = performance.now();
        const step = (now) => {
            const k = Math.min(1, (now - t0) / dur);
            // ease-out cubic: the cover lets go quickly then settles
            const e = 1 - Math.pow(1 - k, 3);
            setSpan(from + (to - from) * e);
            if (k < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
    }

    // ---- shell ------------------------------------------------------------

    function buildChrome(root) {
        txt(root, 44, 58, "LINUX KERNEL — INTERNAL VIEW", { size: 13, spacing: "0.2em" });
        txt(root, 44, 74, "cutaway: rendering probe · no live data", { cls: "dim", size: 8.5 });
        txt(root, W - 44, 58, "PLATE 1 / 1", { cls: "dim", size: 8.5, anchor: "end" });
        txt(root, W - 44, 74, "MODE  technique validation", { cls: "dim", size: 8.5, anchor: "end" });
        el("line", { class: "hair", x1: 44, y1: 88, x2: W - 44, y2: 88 }, root);
        el("line", { class: "hair", x1: 44, y1: H - 46, x2: W - 44, y2: H - 46 }, root);
        txt(root, 44, H - 30, "ISOMETRIC · 3 FACES · 45° SECTION HATCH", { cls: "dim", size: 8 });
        txt(root, W - 44, H - 30, "SECTOR VIEW", { cls: "accent", size: 8, anchor: "end" });
    }

    function build() {
        const host = document.getElementById("kernel-cutaway");
        if (!host) return;
        host.innerHTML = "";
        svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "cutaway-svg" }, host);

        const defs = el("defs", {}, svg);
        const pattern = el("pattern", {
            id: "hatch",
            width: 6,
            height: 6,
            patternUnits: "userSpaceOnUse",
            patternTransform: "rotate(45)",
        }, defs);
        el("line", { class: "hatchline", x1: 0, y1: 0, x2: 0, y2: 6 }, pattern);

        el("rect", { class: "paper", x: 0, y: 0, width: W, height: H }, svg);
        buildChrome(svg);
        buildPrimitives(svg);
        buildSection(svg);
        buildDisc(svg);
    }

    function start() {
        build();
        const themeBtn = document.getElementById("btn-theme");
        const revealBtn = document.getElementById("btn-reveal");
        if (themeBtn) {
            themeBtn.addEventListener("click", () => {
                document.body.classList.toggle("dark");
                themeBtn.textContent = document.body.classList.contains("dark")
                    ? "THEME · DARK"
                    : "THEME · PAPER";
            });
        }
        if (revealBtn) revealBtn.addEventListener("click", reveal);
        reveal();
    }

    return { start, reveal, setSpan };
})();

document.addEventListener("DOMContentLoaded", () => KernelCutaway.start());
