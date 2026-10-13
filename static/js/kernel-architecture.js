/**
 * Kernel architecture board.
 *
 * The argument: Linux is not a layer cake, it is the same trick repeated — a
 * narrow waist with many callers above, one contract struct in the middle, many
 * implementations below.
 *
 * The layout is a single composed panel on a 12-column grid. Three things are
 * deliberate, because the previous version failed on all three and it was
 * measurable: 76 of 100 labels sat in 7–8.5px, 203 of 225 strokes sat in
 * 0.8–1.4px, and dark mass covered 3.78% of the surface. So here the type scale
 * has six steps with gaps in it, every block opens with a filled bar, one block
 * is reversed whole, and the caller/implementation names have moved off the
 * figure into dense dossiers where they work as texture.
 *
 * Honesty rule for the geometry: a mouth is exactly as wide as the number of
 * names behind it, one tick per name, and every one of those names is printed
 * in the dossier for that channel. Nothing here is a count of the source tree,
 * and the footnote says so.
 */

const KA_SVG = 'http://www.w3.org/2000/svg';

const KA_WR = window.Whiteroom;
const KA_PAPER = KA_WR ? KA_WR.palette : null;

// 12 columns, 119 wide, 16 gutter, 56 margin. Every x on the page is gx()/gw().
const KA_GRID = {
    W: 1720,
    H: 1120,
    m: 56,
    col: 119,
    gut: 16,
    headX: 326,      // col 3: the fixed BACK TO MAIN pill owns cols 1–2
    bodyTop: 170,
    bodyBot: 1060,
    pitch: 20        // one tick per named thing, same pitch everywhere
};

// Heights in the left column are set by what each block actually contains, not
// by thirds: the ladder is four rungs, the knob table is seven rows.
const KA_LEFT = {
    context: { y: 170, h: 210 },
    rcu: { y: 394, h: 300 },
    policy: { y: 708, h: KA_GRID.bodyBot - 708 }
};

const gx = (i) => KA_GRID.m + i * (KA_GRID.col + KA_GRID.gut);
const gw = (n) => n * KA_GRID.col + (n - 1) * KA_GRID.gut;

// The figure block's interior.
const KA_FIG = {
    x0: 469, x1: 1247,
    wallY: 244,
    memTop: 258, memBot: 1000,
    hwY: 1020,
    cxA: 669, cxB: 1047,
    rows: [350, 620, 890],
    h: 170,
    neck: 26
};

// Gaps in the userspace wall. These are the only real boundary crossings; every
// other line in the figure is internal to one address space.
const KA_GATES = [
    { x: 560, label: 'syscall' },
    { x: 690, label: 'fd' },
    { x: 820, label: 'procfs / sysfs' },
    { x: 950, label: 'bpf()' },
    { x: 1080, label: 'FUSE' },
    { x: 1190, label: 'vfio' }
];

// `callers` and `impls` are the names actually printed in the dossiers, and the
// mouth widths are derived from their counts, so the figure cannot claim more
// than the page shows. `slot` is [column, row] in the figure.
const KA_WAISTS = [
    {
        id: 'file',
        big: 'file_operations',
        small: 'struct file',
        subsystem: 'VFS',
        slot: ['A', 0],
        callers: ['read', 'write', 'mmap', 'ioctl', 'poll', 'splice'],
        // `socket` belongs here: a socket fd carries socket_file_ops, which is
        // why the sendmsg() path can leave this waist through it.
        impls: ['ext4', 'xfs', 'btrfs', 'f2fs', 'overlayfs', 'tmpfs',
            'procfs', 'sysfs', 'nfs', 'fuse', 'socket'],
        note: 'One interface between every file syscall and every filesystem. '
            + 'The waist is what makes procfs and ext4 interchangeable to read().'
    },
    {
        id: 'skb',
        big: 'net_device_ops',
        small: 'sk_buff',
        subsystem: 'NET',
        slot: ['B', 0],
        callers: ['tcp', 'udp', 'icmp', 'bridge', 'xdp'],
        // virtio-net is last because the drawn path leaves through it, and the
        // path has to leave through the tick that belongs to the driver it
        // names. Same reason `socket` is last in file's list.
        impls: ['e1000e', 'ixgbe', 'mlx5', 'r8169', 'veth', 'tun', 'bridge', 'virtio-net'],
        note: 'The packet buffer is the contract. Protocols above never name a '
            + 'driver, drivers below never name a protocol.'
    },
    {
        id: 'sched',
        big: 'sched_class',
        small: 'struct rq',
        subsystem: 'SCHED',
        slot: ['A', 1],
        callers: ['fork', 'wakeup', 'tick', 'load_balance'],
        impls: ['stop', 'deadline', 'rt', 'fair', 'idle', 'ext'],
        note: 'Mechanism in the core, policy in the class. sched_ext moves the '
            + 'policy out to a BPF program entirely.'
    },
    {
        id: 'bio',
        big: 'request_queue',
        small: 'struct bio',
        subsystem: 'BLOCK',
        slot: ['B', 1],
        callers: ['writeback', 'direct I/O', 'swap', 'journal'],
        impls: ['nvme', 'virtio-blk', 'sd', 'mmc', 'loop', 'dm', 'md'],
        note: 'A bio is a request for bytes on a device. Stacking dm and md on '
            + 'top of nvme works because they all speak the same waist.'
    },
    {
        id: 'cc',
        big: 'tcp_congestion_ops',
        small: 'icsk_ca_ops',
        subsystem: 'NET',
        slot: ['A', 2],
        callers: ['ack', 'loss', 'rtt sample'],
        impls: ['cubic', 'bbr', 'reno', 'vegas', 'dctcp', 'htcp',
            'illinois', 'westwood', 'bic', 'yeah'],
        note: 'A waist inside a waist: this one hangs off sk_buff. Swapping '
            + 'cubic for bbr is a sysctl, not a rebuild.'
    },
    {
        id: 'lsm',
        big: 'security_hook_heads',
        small: 'LSM hooks',
        subsystem: 'LSM',
        slot: ['B', 2],
        callers: ['exec', 'open', 'socket', 'ptrace', 'bpf'],
        impls: ['selinux', 'apparmor', 'smack', 'tomoyo', 'yama', 'landlock', 'bpf', 'ima'],
        note: 'Hooks are placed by the subsystem, decisions are made by the '
            + 'module. Landlock lets unprivileged userspace supply the policy.'
    }
];

// Attach points are deliberately unordered: the kernel was not designed around
// them, they were added wherever they were useful.
const KA_STUDS = [
    { x: 510, y: 320, label: 'kprobe' },
    { x: 776, y: 400, label: 'tracepoint' },
    { x: 1215, y: 300, label: 'fentry', anchor: 'end' },
    { x: 510, y: 700, label: null },
    { x: 836, y: 960, label: null },
    { x: 920, y: 470, label: null },
    { x: 920, y: 745, label: null },
    { x: 1215, y: 660, label: null }
];

class KernelArchitectureVisualization {
    constructor() {
        this.container = null;
        this.svg = null;
        this.tooltip = null;
        this.waists = [];
        this.legs = [];
        this.dossiers = {};
    }

    el(tag, attrs = {}, parent = null) {
        const node = document.createElementNS(KA_SVG, tag);
        Object.keys(attrs).forEach((k) => node.setAttribute(k, attrs[k]));
        if (parent) parent.appendChild(node);
        return node;
    }

    text(parent, x, y, str, opts = {}) {
        return KA_WR.text(parent, x, y, str, opts);
    }

    // A solid plate with reversed type. The only heavy mass inside the figure,
    // so it is reserved for the contract structs themselves.
    plate(parent, cx, cy, label, opts = {}) {
        const size = opts.size == null ? KA_PAPER.lead : opts.size;
        const padX = opts.padX == null ? 14 : opts.padX;
        const w = opts.w == null ? label.length * size * 0.63 + padX * 2 : opts.w;
        const h = opts.h == null ? 30 : opts.h;
        const g = this.el('g', {}, parent);
        const rect = this.el('rect', {
            x: cx - w / 2, y: cy - h / 2, width: w, height: h,
            fill: opts.fill || KA_PAPER.plate
        }, g);
        const t = this.text(g, cx, cy + size * 0.36, label, {
            size, spacing: opts.spacing == null ? 1.2 : opts.spacing,
            anchor: 'middle', fill: opts.color || KA_PAPER.cream
        });
        return { g, rect, text: t, w, h };
    }

    // The nameplate of a waist, built to be the same object as the header bar
    // of its dossier: amber key, contract name, struct name. Reading across
    // from figure to dossier is then a matter of matching two identical bars,
    // which is why the names could leave the figure at all.
    namePlate(parent, cx, cy, waist, index) {
        const big = KA_PAPER.lead;
        const small = KA_PAPER.body;
        const keyW = 28;
        const bigW = waist.big.length * big * 0.63;
        const smallW = waist.small.length * small * 0.62;
        const w = keyW + bigW + 14 + smallW + 28;
        const h = 32;
        const x = cx - w / 2;
        const g = this.el('g', {}, parent);
        const rect = this.el('rect', {
            x, y: cy - h / 2, width: w, height: h, fill: KA_PAPER.plate
        }, g);
        this.text(g, x + 14, cy + big * 0.36, index, {
            size: KA_PAPER.header, spacing: 1.4, fill: KA_PAPER.liveOnDark
        });
        this.text(g, x + 14 + keyW, cy + big * 0.36, waist.big, {
            size: big, spacing: 1.2, fill: KA_PAPER.cream
        });
        this.text(g, x + w - 14, cy + big * 0.36, waist.small, {
            size: small, spacing: 0.8, anchor: 'end', fill: KA_PAPER.creamDim
        });
        return { g, rect, w, h };
    }

    init(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.error('kernel-architecture: container not found');
            return false;
        }
        if (!KA_WR) {
            console.error('kernel-architecture: whiteroom.js must load first');
            return false;
        }

        const svg = this.el('svg', {
            viewBox: `0 0 ${KA_GRID.W} ${KA_GRID.H}`,
            preserveAspectRatio: 'xMidYMid meet'
        });
        svg.style.cssText = 'position:absolute; inset:0; width:100%; height:100%;'
            + ` display:block; background:${KA_PAPER.ground};`;
        this.container.appendChild(svg);
        this.svg = svg;
        KA_WR.defs(svg);

        const g = (name) => this.el('g', { 'data-ka': name }, svg);
        this.buildHead(g('head'));
        this.buildFigureBlock(g('figure'));
        this.buildContextBlock(g('context'));
        this.buildRcuBlock(g('rcu'));
        this.buildPolicyBlock(g('policy'));
        this.buildDossiers(g('dossiers'));
        this.buildFootnote(g('footnote'));
        this.buildTooltip();
        return true;
    }

    activate() {
        // Static page: nothing to start, nothing to poll.
    }

    // ---- header -----------------------------------------------------------

    buildHead(g) {
        const x = KA_GRID.headX;
        this.text(g, x, 66, 'RING-0 · KERNEL SURVEY', {
            size: KA_PAPER.micro, spacing: 3.4, fill: KA_PAPER.instrument
        });
        this.text(g, x, 104, 'KERNEL ARCHITECTURE', {
            size: KA_PAPER.display, spacing: 5, fill: KA_PAPER.ink
        });
        this.text(g, x, 130, 'NOT A LAYER CAKE — THE SAME TRICK, SIX TIMES OVER', {
            size: 10, spacing: 2.4, fill: KA_PAPER.dim
        });
        this.el('line', {
            x1: x - 22, y1: 46, x2: x - 22, y2: 136,
            stroke: KA_PAPER.instrument, 'stroke-width': 3
        }, g);

        // Counted from the data, never typed in, so the headline figures cannot
        // drift away from the number of names the page actually prints.
        const callers = KA_WAISTS.reduce((s, w) => s + w.callers.length, 0);
        const impls = KA_WAISTS.reduce((s, w) => s + w.impls.length, 0);
        const sx = gx(8);
        const sw = gx(11) + KA_GRID.col - sx;
        // A readout, not a slab: dark body, lit strip, large light numerals.
        // Filled bright at 96 tall this ate a sixth of the head on its own.
        this.el('rect', {
            x: sx, y: 44, width: sw, height: 96,
            fill: KA_PAPER.panel, stroke: KA_PAPER.hair, 'stroke-width': 1
        }, g);
        this.el('rect', { x: sx, y: 44, width: sw, height: 4, fill: KA_PAPER.instrument }, g);
        [
            [String(KA_WAISTS.length).padStart(2, '0'), 'WAISTS'],
            [String(callers), 'CALLERS NAMED'],
            [String(impls), 'IMPLEMENTATIONS NAMED']
        ].forEach(([value, label], i) => {
            const cx = sx + 20 + (sw - 40) / 6 + i * ((sw - 40) / 3);
            if (i) {
                const dx = sx + 20 + i * ((sw - 40) / 3);
                this.el('line', {
                    x1: dx, y1: 62, x2: dx, y2: 130,
                    stroke: KA_PAPER.hairSoft, 'stroke-width': 1
                }, g);
            }
            this.text(g, cx, 106, value, {
                size: KA_PAPER.hero, spacing: 2, anchor: 'middle', fill: KA_PAPER.cream
            });
            this.text(g, cx, 126, label, {
                size: KA_PAPER.micro, spacing: 1, anchor: 'middle', fill: KA_PAPER.dim
            });
        });
    }

    // ---- the figure -------------------------------------------------------

    buildFigureBlock(g) {
        const x = gx(3);
        const w = gw(6);
        const { bodyY } = KA_WR.block(g, {
            x, y: KA_GRID.bodyTop, w, h: KA_GRID.bodyBot - KA_GRID.bodyTop - 2,
            index: '00', title: 'THE FIGURE', meta: 'one path · three waists · eBPF marked'
        });
        // The largest empty field on the page. A halftone gives it a surface;
        // flat near-black at this size reads as a hole cut in the board.
        this.el('rect', {
            x: x + 1, y: bodyY + 1, width: w - 2,
            height: KA_GRID.bodyBot - KA_GRID.bodyTop - 3 - (bodyY - KA_GRID.bodyTop),
            fill: 'url(#wr-dots)'
        }, g);
        this.buildWall(g);
        this.buildPath(g);
        this.buildWaists(g);
        this.buildStuds(g);
        this.buildHardware(g);
    }

    // The wall is the only hard boundary in the figure, drawn as segments so
    // the gates are literal gaps rather than labelled arrows.
    buildWall(g) {
        const { x0, x1, wallY } = KA_FIG;
        const half = 26;
        let cursor = x0;

        // The one cold thing on the board, and it earns the hue: everything
        // above this wall is not the kernel. The page's whole claim is that
        // this is the only real boundary, so it is the only place where the
        // colour changes side rather than changing loudness.
        this.el('rect', {
            x: x0, y: KA_GRID.bodyTop + 19, width: x1 - x0,
            height: wallY - KA_GRID.bodyTop - 19,
            fill: 'rgba(63,201,218,0.045)'
        }, g);
        this.el('line', {
            x1: x0, y1: KA_GRID.bodyTop + 19, x2: x1, y2: KA_GRID.bodyTop + 19,
            stroke: KA_PAPER.coldSoft, 'stroke-width': 1
        }, g);
        this.text(g, x0, wallY - 32, 'USERSPACE', {
            size: KA_PAPER.body, spacing: 2, fill: KA_PAPER.cold
        });
        this.text(g, x1, wallY - 32, 'stable ABI · never broken', {
            size: KA_PAPER.micro, spacing: 0.6, anchor: 'end',
            fill: 'rgba(63,201,218,0.78)'
        });
        KA_GATES.forEach((gate) => {
            this.el('line', {
                x1: cursor, y1: wallY, x2: gate.x - half, y2: wallY,
                stroke: KA_PAPER.ink, 'stroke-width': 3
            }, g);
            [-half, half].forEach((dx) => {
                this.el('line', {
                    x1: gate.x + dx, y1: wallY - 6, x2: gate.x + dx, y2: wallY + 6,
                    stroke: KA_PAPER.ink, 'stroke-width': 1.6
                }, g);
            });
            // A gate is the only place work legitimately crosses, so it gets
            // the one loud object on the board: a chip with the word knocked
            // out of it. The six of them are the doors this page is about.
            KA_WR.pill(g, gate.x, wallY - 15, gate.label, { anchor: 'middle' });
            cursor = gate.x + half;
        });
        this.el('line', {
            x1: cursor, y1: wallY, x2: x1, y2: wallY,
            stroke: KA_PAPER.ink, 'stroke-width': 3
        }, g);

        // Flooded, then hatched. The claim this region makes is that it is one
        // continuous thing, and a tint at five percent said "dim" instead.
        // Oxblood is chosen for a measured reason: it is saturated enough to
        // register as colour but its mean channel is 32 of 255, so cream type,
        // the amber path and the funnels all keep their separation on top.
        this.el('rect', {
            x: x0, y: KA_FIG.memTop, width: x1 - x0,
            height: KA_FIG.memBot - KA_FIG.memTop,
            fill: '#4e0d12', stroke: KA_PAPER.hair, 'stroke-width': 1
        }, g);
        this.el('rect', {
            x: x0, y: KA_FIG.memTop, width: x1 - x0,
            height: KA_FIG.memBot - KA_FIG.memTop,
            fill: 'url(#wr-hatch)'
        }, g);
        this.text(g, x0 + 10, KA_FIG.memBot - 9,
            'one address space · one failure domain · no internal walls', {
                size: KA_PAPER.micro, spacing: 0.8, fill: KA_PAPER.dim
            });
    }

    waistGeometry(w) {
        const [col, row] = w.slot;
        const cx = col === 'A' ? KA_FIG.cxA : KA_FIG.cxB;
        const wy = KA_FIG.rows[row];
        return {
            cx,
            wy,
            topY: wy - KA_FIG.h / 2,
            botY: wy + KA_FIG.h / 2,
            topW: w.callers.length * KA_GRID.pitch,
            botW: w.impls.length * KA_GRID.pitch
        };
    }

    buildWaists(g) {
        KA_WAISTS.forEach((w, idx) => {
            const geo = this.waistGeometry(w);
            const cell = this.el('g', { 'data-waist': w.id }, g);
            cell.style.cursor = 'help';
            cell.style.transition = 'opacity 160ms linear';
            const n = KA_FIG.neck;

            // The silhouette, closed and tinted: repeating one shape is the
            // whole argument, and a funnel with a surface reads as a volume the
            // work passes through instead of as four hairlines.
            const funnels = [
                this.el('path', {
                    d: `M ${geo.cx - geo.topW / 2} ${geo.topY} L ${geo.cx - n / 2} ${geo.wy - 16}`
                        + ` L ${geo.cx + n / 2} ${geo.wy - 16} L ${geo.cx + geo.topW / 2} ${geo.topY} Z`,
                    fill: 'url(#wr-up)', stroke: KA_PAPER.hair, 'stroke-width': 1
                }, cell),
                this.el('path', {
                    d: `M ${geo.cx - geo.botW / 2} ${geo.botY} L ${geo.cx - n / 2} ${geo.wy + 16}`
                        + ` L ${geo.cx + n / 2} ${geo.wy + 16} L ${geo.cx + geo.botW / 2} ${geo.botY} Z`,
                    fill: 'url(#wr-down)', stroke: KA_PAPER.hair, 'stroke-width': 1
                }, cell)
            ];

            this.mouth(cell, geo.cx, geo.topY, geo.topW, w.callers.length, 'up', 'callers');
            this.mouth(cell, geo.cx, geo.botY, geo.botW, w.impls.length, 'down', 'impls');

            const plate = this.namePlate(cell, geo.cx, geo.wy, w,
                String(idx + 1).padStart(2, '0'));

            const entry = { id: w.id, cell, plate, funnels };
            this.waists.push(entry);

            cell.addEventListener('mouseenter', (e) => {
                this.focusWaist(w.id);
                this.showTooltip(`${w.big} — ${w.note}`, e);
            });
            cell.addEventListener('mousemove', (e) => this.moveTooltip(e));
            cell.addEventListener('mouseleave', () => {
                this.focusWaist(null);
                this.hideTooltip();
            });
        });
    }

    // One tick per name. The names themselves live in the dossier for this
    // channel, so the mouth carries the count instead of the list.
    mouth(parent, cx, y, width, count, dir, word) {
        const sign = dir === 'up' ? -1 : 1;
        this.el('line', {
            x1: cx - width / 2, y1: y, x2: cx + width / 2, y2: y,
            stroke: KA_PAPER.instrumentSoft, 'stroke-width': 1.6
        }, parent);
        for (let i = 0; i < count; i++) {
            const x = cx - width / 2 + KA_GRID.pitch * (i + 0.5);
            this.el('line', {
                x1: x, y1: y, x2: x, y2: y + sign * 7,
                stroke: KA_PAPER.dot, 'stroke-width': 1
            }, parent);
        }
        this.text(parent, cx - width / 2 - 7, y + 3, `${count} ${word}`, {
            size: KA_PAPER.micro, spacing: 0.4, anchor: 'end', fill: KA_PAPER.faint
        });
    }

    // Hover is the only motion on the page, so it does real work: the hovered
    // waist gains a tier of weight, the other five give one up, and the dossier
    // holding its names comes forward with it.
    focusWaist(id) {
        this.waists.forEach((e) => {
            const hot = id !== null && e.id === id;
            e.cell.style.opacity = id === null || hot ? '1' : '0.24';
            e.funnels.forEach((f, i) => {
                f.setAttribute('fill', hot ? KA_PAPER.washHot : `url(#${i ? 'wr-down' : 'wr-up'})`);
                f.setAttribute('stroke', hot ? KA_PAPER.ink : KA_PAPER.hair);
                f.setAttribute('stroke-width', hot ? 1.6 : 1);
            });
            e.plate.rect.setAttribute('fill', hot ? KA_PAPER.plateLit : KA_PAPER.plate);
        });
        Object.keys(this.dossiers).forEach((key) => {
            this.dossiers[key].style.opacity = id === null || key === id ? '1' : '0.28';
        });
    }

    buildStuds(g) {
        const lit = this.el('g', { filter: 'url(#wr-glow)' }, g);
        KA_STUDS.forEach((s) => {
            this.el('circle', {
                cx: s.x, cy: s.y, r: 3.6, fill: 'none',
                stroke: KA_PAPER.live, 'stroke-width': 1.6
            }, lit);
            this.el('circle', { cx: s.x, cy: s.y, r: 1.2, fill: KA_PAPER.live }, lit);
            if (s.label) {
                const end = s.anchor === 'end';
                this.text(g, s.x + (end ? -8 : 8), s.y + 3, s.label, {
                    size: KA_PAPER.micro, spacing: 0.5,
                    anchor: end ? 'end' : 'start', fill: KA_PAPER.dim
                });
            }
        });
    }

    // One real path. It goes down, up, then down again — which is the point:
    // layer diagrams promise monotonic descent and no real path obeys it.
    buildPath(g) {
        const file = this.waistGeometry(KA_WAISTS[0]);
        const skb = this.waistGeometry(KA_WAISTS[1]);
        const cc = this.waistGeometry(KA_WAISTS[4]);
        // The path has to leave a waist through the tick of the implementation
        // it names, so both exits are computed from the list, not placed.
        const tick = (i, name) => {
            const geo = this.waistGeometry(KA_WAISTS[i]);
            return geo.cx - geo.botW / 2
                + KA_GRID.pitch * (KA_WAISTS[i].impls.indexOf(name) + 0.5);
        };
        const socketX = tick(0, 'socket');
        const virtioX = tick(1, 'virtio-net');

        // Riser x values are set by the nameplates either side, not chosen: 812
        // clears sched at 791 and bio at 911, 858 clears cc at 837 and lsm at
        // 880. The descent to hardware goes outside the columns entirely at
        // 1232 — inside them it passed behind the lsm plate and read as if the
        // path went through a contract it never touches.
        const riserB = 812;
        const riserC = 858;
        const riserD = 1232;

        const legs = [
            {
                pts: [[560, KA_FIG.wallY], [560, 300], [file.cx, 300], [file.cx, file.wy]],
                labels: [[552, 290, 'sendmsg()', KA_PAPER.body, 'end']]
            },
            {
                // The approach runs 18 above cc's top mouth, not along it:
                // level with the mouth line the amber merged into the tick row.
                pts: [[file.cx, file.wy], [socketX, file.botY], [riserB, 470],
                    [riserB, cc.topY - 18], [cc.cx, cc.topY - 18], [cc.cx, cc.wy]],
                labels: [[riserB + 8, 500, 'socket_file_ops', KA_PAPER.micro]]
            },
            {
                // Congestion control is consulted, not traversed, so this leg
                // leaves the way it came in — up through the top mouth, offset
                // 14 from the arrival so both lines stay visible. Sideways out
                // of the plate would have claimed a route that does not exist.
                pts: [[cc.cx + 14, cc.wy], [cc.cx + 14, cc.topY - 36],
                    [riserC, cc.topY - 36], [riserC, 310],
                    [skb.cx, 310], [skb.cx, skb.wy]],
                labels: [[riserC + 8, 566, 'up, not down', KA_PAPER.micro]]
            },
            {
                pts: [[skb.cx, skb.wy], [virtioX, skb.botY], [riserD, 500],
                    [riserD, KA_FIG.hwY]],
                labels: [[riserD - 8, 580, 'ndo_start_xmit()', KA_PAPER.micro, 'end']]
            }
        ];

        legs.forEach((leg) => {
            const d = KA_WR.polyline(leg.pts, 16);
            const cell = this.el('g', {}, g);
            cell.style.cursor = 'pointer';
            cell.style.transition = 'opacity 160ms linear';
            // Invisible fat stroke: the visible line is 1.6px, which is not a
            // hit target anybody can reasonably find.
            this.el('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': 14 }, cell);
            // The bloom goes on a subgroup, never on the cell: a filter makes
            // Chrome hit-test against the filtered result, and the invisible
            // fat stroke above stops being a target the moment it is blurred.
            const lit = this.el('g', { filter: 'url(#wr-glow)' }, cell);
            const line = this.el('path', {
                d, fill: 'none', stroke: KA_PAPER.live, 'stroke-width': 1.6,
                'stroke-linecap': 'round', opacity: 0.85
            }, lit);
            line.style.transition = 'stroke-width 160ms ease-out, opacity 160ms linear';
            leg.labels.forEach(([lx, ly, str, size, anchor]) => {
                this.text(cell, lx, ly, str, {
                    size, spacing: 0.5, anchor: anchor || 'start', fill: KA_PAPER.live
                });
            });

            const entry = { cell, line };
            this.legs.push(entry);
            cell.addEventListener('mouseenter', () => this.focusLeg(entry));
            cell.addEventListener('mouseleave', () => this.focusLeg(null));
        });
    }

    focusLeg(entry) {
        this.legs.forEach((e) => {
            const hot = entry !== null && e === entry;
            e.cell.style.opacity = entry === null || hot ? '1' : '0.22';
            e.line.setAttribute('stroke-width', hot ? 3 : 1.6);
            e.line.setAttribute('opacity', hot ? 1 : 0.85);
        });
    }

    buildHardware(g) {
        this.el('line', {
            x1: KA_FIG.x0, y1: KA_FIG.hwY, x2: KA_FIG.x1, y2: KA_FIG.hwY,
            stroke: KA_PAPER.ink, 'stroke-width': 3
        }, g);
        this.text(g, KA_FIG.x0, KA_FIG.hwY + 16, 'HARDWARE', {
            size: KA_PAPER.body, spacing: 2, fill: KA_PAPER.ink
        });
        this.text(g, KA_FIG.x1, KA_FIG.hwY + 16,
            'described as data, not code — Device Tree · ACPI', {
                size: KA_PAPER.micro, spacing: 0.6, anchor: 'end', fill: KA_PAPER.dim
            });
    }

    // ---- left column ------------------------------------------------------

    // Context is a permission, not a place. The two rungs that cannot sleep are
    // reversed out, so the rule is carried by figure and ground rather than by
    // a caption nobody reads.
    buildContextBlock(g) {
        const x = gx(0);
        const w = gw(3);
        const { bodyY } = KA_WR.block(g, {
            x, y: KA_LEFT.context.y, w, h: KA_LEFT.context.h,
            index: '01', title: 'CONTEXT', meta: 'what may sleep'
        });
        this.text(g, x + 12, bodyY + 18,
            'deferring work is moving down this ladder · past the line you may block', {
                size: KA_PAPER.micro, spacing: 0.4, fill: KA_PAPER.dim
            });

        const rungs = [
            ['hardirq', false],
            ['softirq / tasklet', false],
            ['workqueue / kthread', true],
            ['process context', true]
        ];
        rungs.forEach(([label, maySleep], i) => {
            const y = bodyY + 44 + i * 38;
            if (maySleep) {
                this.el('rect', {
                    x: x + 12, y: y - 13, width: 186, height: 26,
                    fill: 'none', stroke: KA_PAPER.hair, 'stroke-width': 1
                }, g);
                this.text(g, x + 20, y + 4, label, {
                    size: KA_PAPER.header, spacing: 1, fill: KA_PAPER.ink
                });
            } else {
                this.el('rect', {
                    x: x + 12, y: y - 13, width: 186, height: 26, fill: KA_PAPER.bar
                }, g);
                this.text(g, x + 20, y + 4, label, {
                    size: KA_PAPER.header, spacing: 1, fill: KA_PAPER.barText
                });
            }
            this.text(g, x + w - 12, y + 4, maySleep ? 'may sleep' : 'cannot sleep', {
                size: KA_PAPER.micro, spacing: 0.5, anchor: 'end',
                fill: maySleep ? KA_PAPER.dim : KA_PAPER.ink
            });
        });

        const lineY = bodyY + 44 + 1.5 * 38;
        this.el('line', {
            x1: x + 12, y1: lineY, x2: x + w - 12, y2: lineY,
            stroke: KA_PAPER.instrument, 'stroke-width': 1.6, 'stroke-dasharray': '5 4'
        }, g);
    }

    // RCU is the one mechanism that cannot be drawn with arrows: two versions of
    // the same object are live at once, so the figure needs time as an axis.
    buildRcuBlock(g) {
        const x = gx(0);
        const w = gw(3);
        const { bodyY } = KA_WR.block(g, {
            x, y: KA_LEFT.rcu.y, w, h: KA_LEFT.rcu.h,
            index: '02', title: 'RCU', meta: 'two versions at once'
        });
        this.text(g, x + 12, bodyY + 18, 'readers take no lock; the writer publishes a copy', {
            size: KA_PAPER.micro, spacing: 0.4, fill: KA_PAPER.dim
        });

        const oldY = bodyY + 66;
        const newY = bodyY + 146;
        const v1x = x + 172;
        const v2x = x + w - 60;

        // Three readers arriving at the old version. The arrowheads stop at the
        // plate's edge: a reader that has already entered is exactly what the
        // writer is not allowed to disturb.
        [-18, 0, 18].forEach((dy) => {
            const y = oldY + dy;
            this.el('path', {
                d: `M ${x + 12} ${y} L ${v1x - 33} ${y} L ${v1x - 39} ${y - 3}`
                    + ` M ${v1x - 33} ${y} L ${v1x - 39} ${y + 3}`,
                fill: 'none', stroke: KA_PAPER.dot, 'stroke-width': 1
            }, g);
        });
        this.text(g, x + 12, oldY - 28, 'readers in flight', {
            size: KA_PAPER.micro, spacing: 0.5, fill: KA_PAPER.dim
        });
        this.plate(g, v1x, oldY, 'v1', { size: KA_PAPER.header, w: 54, h: 24 });
        this.plate(g, v2x, newY, 'v2', { size: KA_PAPER.header, w: 54, h: 24 });

        this.el('path', {
            d: `M ${v1x + 30} ${oldY + 6} C ${v1x + 74} ${oldY + 30}, ${v2x - 78} ${newY - 34},`
                + ` ${v2x - 32} ${newY - 4}`,
            fill: 'none', stroke: KA_PAPER.live, 'stroke-width': 1.6
        }, g);
        this.text(g, x + 12, newY - 6, 'rcu_assign_pointer', {
            size: KA_PAPER.micro, spacing: 0.4, fill: KA_PAPER.live
        });
        this.text(g, x + 12, newY + 8, 'one store, no barrier for readers', {
            size: KA_PAPER.micro, spacing: 0.4, fill: KA_PAPER.faint
        });

        // The grace period is a solid band: it is a span of time in which the
        // old version must survive, and an outlined box says nothing about that.
        const bandTop = newY + 26;
        this.el('rect', {
            x: x + 12, y: bandTop, width: w - 24, height: 30,
            fill: KA_PAPER.mass, stroke: KA_PAPER.massHair, 'stroke-width': 1
        }, g);
        for (let i = 1; i < 22; i++) {
            this.el('line', {
                x1: x + 12 + i * ((w - 24) / 22), y1: bandTop + 4,
                x2: x + 12 + i * ((w - 24) / 22), y2: bandTop + 26,
                stroke: KA_PAPER.hair, 'stroke-width': 1
            }, g);
        }
        this.text(g, x + w / 2, bandTop + 19, 'grace period', {
            size: KA_PAPER.header, spacing: 2, anchor: 'middle', fill: KA_PAPER.cream
        });
        KA_WR.nameRows(g, x + 12, bandTop + 48, w - 24,
            ['v1 is freed only after the last reader leaves',
                'no shared writable state is the scaling strategy',
                'RCU · seqlock · per-CPU data'],
            { lead: 13, sep: ' ' });
    }

    // Mechanism versus policy is a list of knobs, so it is the one block that is
    // pure type — which makes it the right one to reverse whole.
    buildPolicyBlock(g) {
        const x = gx(0);
        const w = gw(3);
        const { bodyY } = KA_WR.block(g, {
            x, y: KA_LEFT.policy.y, w, h: KA_LEFT.policy.h,
            index: '03', title: 'MECHANISM · POLICY', dark: true,
            accent: KA_PAPER.instrument
        });
        this.text(g, x + 12, bodyY + 18, 'the kernel keeps the mechanism, you swap the policy', {
            size: KA_PAPER.micro, spacing: 0.4, fill: KA_PAPER.creamDim
        });

        // Every row is a knob a user can actually turn on a running system, and
        // the right-hand name is the ops table it selects between.
        [
            ['net.ipv4.tcp_congestion_control', 'tcp_congestion_ops'],
            ['net.core.default_qdisc', 'Qdisc_ops'],
            ['/sys/block/*/queue/scheduler', 'elevator_type'],
            ['sched_setscheduler(2)', 'sched_class'],
            ['mount -t ext4 | xfs | btrfs', 'file_system_type'],
            ['/sys/devices/system/cpu/*/cpufreq', 'cpufreq_governor'],
            ['lsm= boot parameter', 'security_hook_heads']
        ].forEach(([knob, ops], i) => {
            const y = bodyY + 46 + i * 44;
            this.el('line', {
                x1: x + 12, y1: y - 13, x2: x + w - 12, y2: y - 13,
                stroke: KA_PAPER.massHair, 'stroke-width': 1
            }, g);
            this.text(g, x + 12, y, knob, {
                size: KA_PAPER.body, spacing: 0.4, fill: KA_PAPER.cream
            });
            this.text(g, x + w - 12, y + 15, `→ ${ops}`, {
                size: KA_PAPER.micro, spacing: 0.4, anchor: 'end', fill: KA_PAPER.liveOnDark
            });
        });
    }

    // ---- right column -----------------------------------------------------

    // The names that used to hang off the mouths. Six dossiers of dense rows:
    // readable close up, a measurable grey field from a step back.
    buildDossiers(g) {
        const x = gx(9);
        const w = gw(3);
        // 128 is the measured height of the fullest dossier, not a guess: at
        // 145 every block carried 40 units of dead space at the bottom, and the
        // slack is worth more as air between blocks than inside them.
        const h = 128;
        const gap = 24;
        KA_WAISTS.forEach((waist, idx) => {
            const y = KA_GRID.bodyTop + idx * (h + gap);
            const cell = this.el('g', { 'data-dossier': waist.id }, g);
            cell.style.transition = 'opacity 160ms linear';
            this.dossiers[waist.id] = cell;

            const { bodyY } = KA_WR.block(cell, {
                x, y, w, h,
                index: String(idx + 1).padStart(2, '0'),
                title: waist.big,
                meta: waist.subsystem
            });

            let cursor = bodyY + 16;
            this.text(cell, x + 10, cursor, `CALLERS · ${waist.callers.length}`, {
                size: KA_PAPER.micro, spacing: 1.4, fill: KA_PAPER.instrument
            });
            cursor = KA_WR.nameRows(cell, x + 10, cursor + 13, w - 20, waist.callers, {
                fill: KA_PAPER.ink
            });
            this.text(cell, x + 10, cursor + 3, `IMPLEMENTATIONS · ${waist.impls.length}`, {
                size: KA_PAPER.micro, spacing: 1.4, fill: KA_PAPER.instrument
            });
            cursor = KA_WR.nameRows(cell, x + 10, cursor + 16, w - 20, waist.impls, {
                fill: KA_PAPER.dim
            });
            KA_WR.nameRows(cell, x + 10, cursor + 4, w - 20, waist.note.split(' '), {
                sep: ' ', lead: 11, fill: KA_PAPER.faint
            });
        });
    }

    // ---- footer -----------------------------------------------------------

    buildFootnote(g) {
        const x = gx(0);
        const w = gx(11) + KA_GRID.col - x;
        this.el('line', {
            x1: x, y1: 1072, x2: x + w, y2: 1072,
            stroke: KA_PAPER.instrument, 'stroke-width': 1.6
        }, g);
        // Three columns across the whole grid. As one long line each of these
        // used a third of the available width and the footer read as an
        // afterthought instead of the legend it is.
        const colW = (w - 2 * 28) / 3;
        [
            ['HOW TO READ THE FIGURE',
                'An hourglass is a narrow waist: many callers above, one contract '
                + 'struct in the middle, many implementations below. The same shape '
                + 'six times is the argument.'],
            ['WHAT THE GEOMETRY CLAIMS',
                'A mouth is one tick per name, and every one of those names is '
                + 'printed in the dossier for that channel. Nothing on this page '
                + 'is a count of the source tree.'],
            ['WHY THE INTERNALS MOVE',
                'The userspace ABI is never broken; the in-kernel API deliberately '
                + 'is not stable. Escape hatches carry policy out of the monolith: '
                + 'FUSE, vfio, io_uring, BPF.']
        ].forEach(([head, body], i) => {
            const cx = x + i * (colW + 28);
            this.el('rect', { x: cx, y: 1080, width: 16, height: 3, fill: KA_PAPER.instrument }, g);
            this.text(g, cx + 24, 1084, head, {
                size: KA_PAPER.micro, spacing: 1.8, fill: KA_PAPER.ink
            });
            KA_WR.nameRows(g, cx + 24, 1097, colW - 24, body.split(' '), {
                sep: ' ', size: 8, lead: 11, fill: KA_PAPER.dim
            });
        });
    }

    // ---- tooltip ----------------------------------------------------------

    buildTooltip() {
        const tip = document.createElement('div');
        tip.style.cssText = `
            position: absolute;
            z-index: 20;
            pointer-events: none;
            display: none;
            max-width: 330px;
            padding: 9px 11px;
            background: ${KA_PAPER.plate};
            border-top: 2px solid ${KA_PAPER.instrument};
            box-shadow: 0 0 0 1px ${KA_PAPER.hair};
            color: ${KA_PAPER.cream};
            font-family: 'Share Tech Mono', monospace;
            font-size: 10px;
            line-height: 1.55;
        `;
        this.container.appendChild(tip);
        this.tooltip = tip;
    }

    showTooltip(str, event) {
        if (!this.tooltip) return;
        this.tooltip.textContent = str;
        this.tooltip.style.display = 'block';
        this.moveTooltip(event);
    }

    moveTooltip(event) {
        if (!this.tooltip || this.tooltip.style.display === 'none') return;
        this.tooltip.style.left = `${event.clientX + 14}px`;
        this.tooltip.style.top = `${event.clientY + 12}px`;
    }

    hideTooltip() {
        if (this.tooltip) this.tooltip.style.display = 'none';
    }
}

window.KernelArchitectureVisualization = KernelArchitectureVisualization;
