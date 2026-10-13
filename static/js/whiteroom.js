/**
 * Whiteroom: the page's visual language. Dark instrument board.
 *
 * The density work of the previous version stays — a type scale with real gaps,
 * filled bars instead of outlines, dense name rows as texture — because it was
 * measured and it worked: dark mass went from 3.78% to 17.70% of the surface.
 * What changes here is the ground. The board is no longer paper, and it is no
 * longer trying to sit next to the home page.
 *
 * The colours are sampled, not invented. Modal values from the reference
 * frames, ignoring the photographic bloom:
 *
 *   ground      #0c0c0c / #141414 / #1c1c2c  — near-black, faintly cool
 *   accent body #780808 … #980808            — the filled red mass
 *   accent core #f86858                      — the same red blown out
 *   reversed    #f8f8f8 / #d8c8c8            — knocked out of the red
 *   lit share   17.85% of the frame
 *
 * That last number is the one that matters: the reference sits at 17.85% lit,
 * and the light board it replaces sat at 17.70% ink. The density target is
 * unchanged, only inverted, so the same harness measures both.
 *
 * Hue carries meaning rather than mood. Red is structure — frames, bars, rules,
 * the walls. Amber is the live trace: the one path drawn, the attach points,
 * the index that links a figure to its dossier. Cyan appears exactly where
 * something runs against the grain. Nothing is coloured to look technical.
 */

const WR_SVG = 'http://www.w3.org/2000/svg';

const WR_PALETTE = {
    ground: '#0b0e13',
    panel: '#10161d',

    // `ink` is still the primary structural colour, it is simply light now.
    // Every caller that drew a wall or a heading in ink keeps working.
    ink: '#e4ecf2',
    dim: 'rgba(228,236,242,0.58)',
    // 0.44, not the 0.30 this was on paper. Light-on-dark loses contrast far
    // faster than dark-on-light: at 0.30 the thirty-four faint labels measured
    // 2.45:1 against the panel, and 0.44 puts them at 3.5:1.
    faint: 'rgba(228,236,242,0.44)',
    dot: 'rgba(228,236,242,0.40)',

    // Structure. `instrument` keeps its name and its job; it is red here.
    instrument: '#e0353a',
    instrumentSoft: 'rgba(224,53,58,0.52)',
    hair: 'rgba(224,53,58,0.30)',
    hairSoft: 'rgba(224,53,58,0.16)',
    // Hover has to beat the resting funnel, which is 0.58 at the mouth. The
    // pale wash this replaces was carried over from paper and made the focused
    // waist the palest thing on the board — the focus ran backwards.
    washHot: 'rgba(224,53,58,0.82)',

    // Mass. A filled bar on a dark ground has to be the bright thing, so the
    // bar is saturated red and the type is knocked out of it in near-black —
    // which is the reference's status pill, at the size a header bar already is.
    bar: '#cf2129',
    barText: '#0a0d11',
    // Knocked-out type has almost no room to be dim: at 0.66 the ten meta
    // labels measured 2.73:1 on the bar. The hierarchy on a bar comes from
    // size — 11 against 7.5 — not from fading the darker colour further.
    barTextDim: 'rgba(10,13,17,0.86)',
    barKey: '#fff1ee',

    // A large field cannot be bright red without eating the page, so blocks
    // that are reversed whole get the deep body colour instead.
    mass: '#1d0a0e',
    massHair: 'rgba(224,53,58,0.34)',

    plate: '#131b24',
    plateLit: '#1d2935',
    cream: '#eef4f8',
    creamDim: 'rgba(238,244,248,0.56)',

    live: '#f0a63c',
    liveOnDark: '#f0a63c',

    cold: '#3fc9da',
    coldSoft: 'rgba(63,201,218,0.45)',

    // Six steps with real gaps between them, not eight crowded into 7–11.
    hero: 44,
    display: 34,
    lead: 18,
    header: 11,
    body: 9,
    micro: 7.5
};

const Whiteroom = {
    palette: WR_PALETTE,

    el(tag, attrs, parent) {
        const node = document.createElementNS(WR_SVG, tag);
        Object.keys(attrs || {}).forEach((k) => node.setAttribute(k, attrs[k]));
        if (parent) parent.appendChild(node);
        return node;
    },

    text(parent, x, y, str, opts) {
        const o = opts || {};
        const node = this.el('text', {
            x,
            y,
            fill: o.fill || WR_PALETTE.faint,
            'font-size': o.size == null ? WR_PALETTE.micro : o.size,
            'letter-spacing': o.spacing == null ? 0.8 : o.spacing,
            'text-anchor': o.anchor || 'start',
            'font-family': 'Share Tech Mono, monospace'
        }, parent);
        node.textContent = str;
        return node;
    },

    defs(svg) {
        const defs = this.el('defs', {}, svg);

        // Directional funnel tints, so a silhouette reads as a volume.
        //
        // 0.58 at the mouth, not the 0.20 this carried on paper. Every one of
        // the reference frames lands between 19% and 22% saturated pixels
        // however it was captured, while their brightness ranges from 18% to
        // 70% depending only on whether it was a grab or a photograph of a
        // screen. Saturation is therefore the measurable target, and the six
        // funnels are the largest thing on the board that has a right to be
        // the loudest: the repeated shape is the argument.
        [['wr-up', 1, 0], ['wr-down', 0, 1]].forEach(([id, a, b]) => {
            const grad = this.el('linearGradient', {
                id, x1: '0', y1: '0', x2: '0', y2: '1'
            }, defs);
            this.el('stop', { offset: '0', 'stop-color': WR_PALETTE.instrument, 'stop-opacity': String(a * 0.58) }, grad);
            this.el('stop', { offset: '1', 'stop-color': WR_PALETTE.instrument, 'stop-opacity': String(b * 0.58) }, grad);
        });

        // Bloom. Every lit edge in the reference frames has one, and without it
        // a saturated line on near-black reads as a sticker rather than as
        // something emitting. Applied to whole groups, never per element: a
        // filter on each of two hundred nodes is a different page to scroll.
        const glow = this.el('filter', {
            id: 'wr-glow', x: '-12%', y: '-12%', width: '124%', height: '124%'
        }, defs);
        this.el('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: '2.6', result: 'b' }, glow);
        const merge = this.el('feMerge', {}, glow);
        this.el('feMergeNode', { in: 'b' }, merge);
        this.el('feMergeNode', { in: 'SourceGraphic' }, merge);

        // Halftone for the large empty fields, so a panel body is a surface
        // with a texture rather than an absence.
        const dots = this.el('pattern', {
            id: 'wr-dots', width: 7, height: 7, patternUnits: 'userSpaceOnUse'
        }, defs);
        this.el('circle', { cx: 1, cy: 1, r: 0.6, fill: 'rgba(228,236,242,0.10)' }, dots);

        // Hatch marks a region that is one thing throughout — used for the
        // single address space, where a flat wash said nothing.
        const hatch = this.el('pattern', {
            id: 'wr-hatch', width: 11, height: 11, patternUnits: 'userSpaceOnUse',
            patternTransform: 'rotate(45)'
        }, defs);
        this.el('line', {
            x1: 0, y1: 0, x2: 0, y2: 11,
            stroke: 'rgba(224,53,58,0.30)', 'stroke-width': 1
        }, hatch);

        return defs;
    },

    /**
     * A block with a solid header bar. This is the workhorse of the layout and
     * the main source of lit mass: every block on the page starts with a filled
     * bar carrying knocked-out type, and a block may be filled whole.
     *
     * Returns the group plus the y where its body content may start.
     */
    block(parent, spec) {
        const s = spec;
        const barH = s.barH == null ? 19 : s.barH;
        const g = this.el('g', {}, parent);

        this.el('rect', {
            x: s.x, y: s.y + barH, width: s.w, height: s.h - barH,
            fill: s.dark ? WR_PALETTE.mass : WR_PALETTE.panel,
            stroke: s.dark ? WR_PALETTE.massHair : WR_PALETTE.hairSoft,
            'stroke-width': 1
        }, g);

        this.el('rect', {
            x: s.x, y: s.y, width: s.w, height: barH,
            fill: s.accent || WR_PALETTE.bar
        }, g);

        // Corner ticks. Two marks, not four: enough to register the panel as
        // machined, not so many that every block grows a frame again.
        const tick = 9;
        this.el('path', {
            d: `M ${s.x + s.w} ${s.y + barH + tick} L ${s.x + s.w} ${s.y + barH}`
                + ` M ${s.x} ${s.y + s.h} L ${s.x + tick} ${s.y + s.h}`,
            stroke: WR_PALETTE.instrument, 'stroke-width': 1.6, fill: 'none'
        }, g);

        let tx = s.x + 9;
        if (s.index != null) {
            this.text(g, tx, s.y + barH - 6, s.index, {
                size: WR_PALETTE.header, spacing: 1.4, fill: WR_PALETTE.barKey
            });
            tx += 28;
        }
        this.text(g, tx, s.y + barH - 6, s.title, {
            size: WR_PALETTE.header, spacing: 2, fill: WR_PALETTE.barText
        });
        if (s.meta) {
            this.text(g, s.x + s.w - 9, s.y + barH - 6, s.meta, {
                size: WR_PALETTE.micro, spacing: 1, anchor: 'end',
                fill: WR_PALETTE.barTextDim
            });
        }
        return { g, bodyY: s.y + barH };
    },

    /**
     * The status chip: a filled slab with the word knocked out of it. Small and
     * repeated, it is what makes a board look instrumented rather than drawn,
     * and it is the one place a single word is allowed to be loud.
     */
    pill(parent, x, y, str, opts) {
        const o = opts || {};
        const size = o.size == null ? WR_PALETTE.micro : o.size;
        const h = o.h == null ? 13 : o.h;
        const padX = o.padX == null ? 7 : o.padX;
        const w = o.w == null ? str.length * size * 0.62 + padX * 2 : o.w;
        const anchor = o.anchor === 'middle' ? x - w / 2 : (o.anchor === 'end' ? x - w : x);
        const g = this.el('g', {}, parent);
        this.el('rect', {
            x: anchor, y: y - h / 2, width: w, height: h,
            fill: o.fill || WR_PALETTE.bar
        }, g);
        this.text(g, anchor + w / 2, y + size * 0.36, str, {
            size, spacing: o.spacing == null ? 1 : o.spacing,
            anchor: 'middle', fill: o.color || WR_PALETTE.barText
        });
        return { g, w, h, x: anchor };
    },

    /**
     * Dense rows of names, wrapped to the given width. Used as texture: the
     * individual name is readable if you lean in, and from a step back the
     * block reads as a field with a measurable size. Returns the y after the
     * last row so callers can stack sections without magic numbers.
     */
    nameRows(parent, x, y, w, names, opts) {
        const o = opts || {};
        const size = o.size == null ? WR_PALETTE.micro : o.size;
        const lead = o.lead == null ? 12 : o.lead;
        const sep = o.sep == null ? ' · ' : o.sep;
        const perChar = size * 0.6 + (o.spacing == null ? 0.3 : o.spacing);
        const maxChars = Math.max(8, Math.floor(w / perChar));
        const lines = [];
        let line = '';
        names.forEach((n) => {
            const next = line ? `${line}${sep}${n}` : n;
            if (next.length > maxChars && line) {
                lines.push(line);
                line = n;
            } else {
                line = next;
            }
        });
        if (line) lines.push(line);

        let cursor = y;
        lines.forEach((str) => {
            this.text(parent, x, cursor, str, {
                size, spacing: o.spacing == null ? 0.3 : o.spacing,
                fill: o.fill || WR_PALETTE.dim
            });
            cursor += lead;
        });
        return cursor;
    },

    // Orthogonal routing with corner fillets. Without them a routed polyline
    // reads as a trace on a circuit board; with them it reads as a trajectory.
    polyline(pts, radius) {
        const r = radius == null ? 14 : radius;
        if (pts.length < 3) {
            return pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0]} ${p[1]}`).join(' ');
        }
        let d = `M ${pts[0][0]} ${pts[0][1]}`;
        for (let i = 1; i < pts.length - 1; i++) {
            const [px, py] = pts[i - 1];
            const [cx, cy] = pts[i];
            const [nx, ny] = pts[i + 1];
            const inLen = Math.hypot(cx - px, cy - py);
            const outLen = Math.hypot(nx - cx, ny - cy);
            // Never eat more than half of either leg, or short segments invert.
            const cut = Math.min(r, inLen / 2, outLen / 2);
            const a = [cx - ((cx - px) / inLen) * cut, cy - ((cy - py) / inLen) * cut];
            const b = [cx + ((nx - cx) / outLen) * cut, cy + ((ny - cy) / outLen) * cut];
            d += ` L ${a[0].toFixed(1)} ${a[1].toFixed(1)}`;
            d += ` Q ${cx} ${cy} ${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
        }
        const last = pts[pts.length - 1];
        d += ` L ${last[0]} ${last[1]}`;
        return d;
    }
};

window.Whiteroom = Whiteroom;
