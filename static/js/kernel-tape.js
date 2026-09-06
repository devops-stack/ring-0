// Kernel Activity Tape — a live, self-contained console drawer that streams
// real kernel activity (syscall concurrency deltas + network rates) as a
// scrolling event feed. Pure HTML overlay; does not touch the SVG layout.
(function initKernelTape() {
    if (window.KernelTape) return;

    const POLL_MS = 1400;
    const MOBILE_POLL_MS = 3200;
    // Below this the band cannot hold enough rows to be worth showing.
    const MOBILE_MIN_H = 116;
    const MAX_ROWS = 80;
    const MAX_NEW_PER_TICK = 6;

    // Mirrors the DOSSIER palette in main.js so the tape and the process cards
    // read as one instrument. Amber is reserved for live values.
    const D = {
        // The dossier cards float over empty map and can afford a hint of
        // translucency; this panel spans the full height over the bright HUD,
        // where the same 2.5% lets the status module ghost through.
        ink: '#090c10',
        edge: 'rgba(236, 236, 226, 0.17)',
        headerFill: 'rgba(244, 244, 236, 0.055)',
        text: '#f4f4ec',
        dim: 'rgba(244, 244, 236, 0.5)',
        faint: 'rgba(244, 244, 236, 0.26)',
        accent: '#e2a33e',
        mono: "'Share Tech Mono', monospace"
    };

    const CARD = { cut: 15, header: 25, width: 360 };

    const TAGS = {
        network_stack: { text: 'NET' },
        file_system: { text: 'FS' },
        process_scheduler: { text: 'SCHED' },
        memory_management: { text: 'MEM' }
    };
    const ERR_COLOR = 'rgba(226, 96, 88, 0.95)';
    const WARN_COLOR = D.accent;

    function tagForSyscall(name) {
        const n = String(name || '').toLowerCase();
        if (/(socket|connect|accept|recv|send|poll|epoll|select)/.test(n)) return TAGS.network_stack;
        if (/(open|close|read|write|stat|lseek|fsync|rename|unlink|mkdir|rmdir|getdents|chmod|chown|mount)/.test(n)) return TAGS.file_system;
        if (/(mmap|munmap|mprotect|brk|madvise|mlock|shm)/.test(n)) return TAGS.memory_management;
        return TAGS.process_scheduler;
    }

    function parseCount(value) {
        const digits = String(value === undefined || value === null ? '' : value).replace(/[^\d]/g, '');
        return digits ? parseInt(digits, 10) : 0;
    }

    function timeStamp() {
        const d = new Date();
        const p = (n, w = 2) => String(n).padStart(w, '0');
        return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
    }

    async function getJson(url) {
        if (typeof window.fetchJson === 'function') {
            return window.fetchJson(url, { cache: 'no-store' }, { timeoutMs: 5000, retries: 0, context: 'kernel-tape' });
        }
        const res = await fetch(url, { cache: 'no-store' });
        return res.json();
    }

    const state = {
        open: false,
        paused: false,
        prevSyscalls: new Map(),
        firstSyscallSample: true,
        prevConns: new Set(),
        firstConnSample: true,
        prevPids: new Map(),
        firstProcSample: true,
        tickIndex: 0,
        timer: null,
        tickInFlight: false,
        rowCount: 0,
        eventsSinceCore: 0,
        eventsThisSecond: 0,
        epsWindowStart: Date.now(),
        eps: 0,
        // While a socket is hovered the tape narrows to that socket: its owner's
        // calls and its own counters, instead of the machine-wide feeds.
        focus: null,
        focusPrev: null,
        focusSeq: 0,
        // Generic PID-scoped trace focus used by kernel-map objects such as a
        // namespace sector. This is separate from socket focus because a
        // socket has its own counters, while a namespace is resolved through
        // exact process membership and the system-wide syscall snapshot.
        pidFocus: null,
        pidFocusSeq: 0,
        pidSummaries: new Map(),
        // The pill is fixed HTML, so an SVG scrim cannot cover it: while a card
        // is berthed against the right edge the pill would float on top of it.
        pillHidden: false
    };

    // The pill is only offered when there is nothing in its way: the tape itself
    // is shut, no card holds the edge, and this is not the phone layout, where
    // the tape is always on and has no toggle at all.
    function applyPill() {
        if (!el.toggle) return;
        const show = !onMobile() && !state.open && !state.pillHidden;
        el.toggle.style.display = show ? 'inline-flex' : 'none';
    }

    const el = {};

    function injectStyles() {
        if (document.getElementById('kernel-tape-styles')) return;
        const style = document.createElement('style');
        style.id = 'kernel-tape-styles';
        style.textContent = `
@keyframes ktape-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
@keyframes ktape-rowin { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
@keyframes ktape-flash { 0% { background: rgba(226,96,88,0.22); } 100% { background: transparent; } }
#kernel-tape { font-family: ${D.mono}; }
#kernel-tape ::-webkit-scrollbar { width: 6px; }
#kernel-tape ::-webkit-scrollbar-thumb { background: rgba(244,244,236,0.16); }
#kernel-tape ::-webkit-scrollbar-track { background: transparent; }
.ktape-row { animation: ktape-rowin 180ms ease-out; }
.ktape-row.err { animation: ktape-rowin 180ms ease-out, ktape-flash 900ms ease-out; }
.ktape-row.is-inspectable { cursor: pointer; }
.ktape-row.is-inspectable:hover { background: rgba(226,163,62,0.07); }
.ktape-glyph-dot { animation: ktape-blink 1.6s infinite; }
.ktape-btn:hover { color: ${D.text}; }
#kernel-event-inspector { font-family: ${D.mono}; }
.kei-section { margin-top: 14px; }
.kei-label { color: ${D.faint}; font-size: 8px; letter-spacing: 1.4px; }
.kei-value { color: ${D.text}; font-size: 10px; line-height: 15px; overflow-wrap: anywhere; }
.kei-chip { border: 1px solid ${D.edge}; color: ${D.dim}; padding: 2px 5px; font-size: 8px; letter-spacing: .7px; }
.kei-chain { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 5px; margin-top: 6px; }
.kei-node { min-width: 0; border: 1px solid ${D.edge}; padding: 6px; }
.kei-node b { display: block; color: ${D.faint}; font-size: 7px; letter-spacing: 1px; font-weight: 400; }
.kei-node span { display: block; color: ${D.text}; font-size: 9px; margin-top: 4px; overflow-wrap: anywhere; }
.kei-node.is-known { border-color: rgba(226,163,62,.42); }
.kei-node.is-unknown span { color: rgba(244,244,236,.25); }
.kei-mechanism { position: relative; margin-top: 12px; border: 1px solid ${D.edge}; overflow: hidden; background: #080b0f; }
.kei-mechanism::before { content: ""; position: absolute; inset: 0; pointer-events: none; opacity: .12; background-image: linear-gradient(rgba(244,244,236,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(244,244,236,.07) 1px, transparent 1px); background-size: 16px 16px; }
.kei-mechanism svg { position: relative; display: block; width: 100%; height: auto; }
.kei-mech-rule { fill: none; stroke: rgba(244,244,236,.16); stroke-width: .8; vector-effect: non-scaling-stroke; }
.kei-mech-live { fill: none; stroke: ${D.accent}; stroke-width: 1.1; vector-effect: non-scaling-stroke; }
.kei-mech-faint { fill: rgba(9,12,16,.9); stroke: rgba(244,244,236,.25); stroke-width: .8; vector-effect: non-scaling-stroke; }
.kei-mech-amber { fill: rgba(226,163,62,.11); stroke: rgba(226,163,62,.78); stroke-width: 1; vector-effect: non-scaling-stroke; }
.kei-mech-kernel { fill: rgba(244,244,236,.018); stroke: rgba(244,244,236,.22); stroke-width: .8; vector-effect: non-scaling-stroke; }
.kei-mech-user { fill: rgba(244,244,236,.035); stroke: rgba(244,244,236,.22); stroke-width: .8; vector-effect: non-scaling-stroke; }
.kei-mech-boundary { fill: none; stroke: rgba(226,163,62,.34); stroke-width: .8; stroke-dasharray: 4 4; vector-effect: non-scaling-stroke; }
.kei-mech-port { fill: #080b0f; stroke: rgba(226,163,62,.8); stroke-width: 1; vector-effect: non-scaling-stroke; }
.kei-mech-block { fill: rgba(9,12,16,.94); stroke: rgba(244,244,236,.28); stroke-width: .8; vector-effect: non-scaling-stroke; }
.kei-mech-copy { fill: ${D.faint}; font: 6px ${D.mono}; letter-spacing: 1px; }
.kei-mech-value { fill: ${D.text}; font: 8px ${D.mono}; letter-spacing: .4px; }
.kei-mech-hot { fill: ${D.accent}; font: 8px ${D.mono}; letter-spacing: .5px; }
.kei-mech-rotor { transform-box: fill-box; transform-origin: center; animation: kei-rotor-seat 720ms cubic-bezier(.2,.8,.2,1) both; }
.kei-mech-wake { transform-box: fill-box; transform-origin: center; animation: kei-wake-turn 1.8s cubic-bezier(.2,.8,.2,1) both; }
.kei-mech-return.is-error { fill: ${ERR_COLOR}; }
@keyframes kei-rotor-seat { from { transform: rotate(-38deg); opacity: .25; } to { transform: rotate(0); opacity: 1; } }
@keyframes kei-wake-turn { from { transform: rotate(-90deg); } to { transform: rotate(0); } }
@media (prefers-reduced-motion: reduce) {
  .kei-mech-rotor, .kei-mech-wake { animation: none; }
}
`;
        document.head.appendChild(style);
    }

    // Same chamfered outline the dossier cards use, so both read as one system.
    // Docked to the right edge only the left and top sides are on screen, so the
    // floating variant closes the outline on all four.
    function cardPath(w, h, cut, floating) {
        return floating
            ? `M0.5,0.5 H${w - cut} L${w - 0.5},${cut} V${h - 0.5} H0.5 Z`
            : `M0.5,0 V${h} H${w} V${cut} L${w - cut},0.5 Z`;
    }

    function buildSkin(w, h, floating) {
        const cut = CARD.cut;
        const hd = CARD.header;
        const right = floating ? w - 0.5 : w;
        return `
<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMinYMin meet" style="display:block;pointer-events:none">
  <path d="${cardPath(w, h, cut, floating)}" fill="${D.ink}" stroke="${D.edge}" stroke-width="1"/>
  <path d="M0.5,0.5 H${w - cut} L${right},${cut} V${hd} H0.5 Z" fill="${D.headerFill}"/>
  <line x1="0.5" x2="${w - 0.5}" y1="${hd}" y2="${hd}" stroke="${D.edge}" stroke-width="0.9"/>
  <circle cx="14" cy="12.5" r="4.2" fill="none" stroke="${D.dim}" stroke-width="1.1"/>
  <circle class="ktape-glyph-dot" cx="14" cy="12.5" r="1.6" fill="${D.accent}"/>
</svg>`;
    }

    function buildInspectorDom() {
        const root = document.createElement('aside');
        root.id = 'kernel-event-inspector';
        Object.assign(root.style, {
            position: 'fixed', zIndex: '8999', display: 'none',
            width: '420px', maxWidth: 'calc(100vw - 24px)', maxHeight: 'calc(100vh - 24px)',
            overflow: 'auto', padding: '0 14px 16px',
            color: D.text, background: 'rgba(9,12,16,0.975)',
            border: `1px solid ${D.edge}`,
            clipPath: 'polygon(0 0, calc(100% - 15px) 0, 100% 15px, 100% 100%, 0 100%)',
            filter: 'drop-shadow(-8px 8px 14px rgba(7,9,12,0.35))'
        });
        const header = document.createElement('div');
        Object.assign(header.style, {
            height: `${CARD.header}px`, display: 'flex', alignItems: 'center',
            borderBottom: `1px solid ${D.edge}`
        });
        const title = document.createElement('span');
        title.textContent = 'KERNEL EVENT INSPECTOR';
        Object.assign(title.style, { fontSize: '9px', letterSpacing: '1.5px', flex: '1' });
        const close = document.createElement('button');
        close.className = 'ktape-btn';
        close.textContent = '×';
        Object.assign(close.style, {
            cursor: 'pointer', background: 'transparent', border: 'none',
            color: D.dim, font: `12px/1 ${D.mono}`
        });
        close.addEventListener('click', closeInspector);
        const body = document.createElement('div');
        header.append(title, close);
        root.append(header, body);
        document.body.append(root);
        el.inspector = root;
        el.inspectorBody = body;
        window.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && el.inspector.style.display !== 'none') {
                closeInspector();
            }
        });
    }

    function buildDom() {
        // Toggle pill (visible when the card is closed).
        const toggle = document.createElement('button');
        toggle.id = 'kernel-tape-toggle';
        Object.assign(toggle.style, {
            position: 'fixed', right: '16px', top: '150px', zIndex: '9001',
            display: 'none', alignItems: 'center', gap: '7px',
            padding: '6px 12px', cursor: 'pointer',
            background: 'rgba(12,16,20,0.86)', color: '#bcd3de',
            border: '1px solid rgba(103,190,224,0.4)', borderRadius: '6px',
            font: '600 10px/1 monospace', letterSpacing: '1.5px', textTransform: 'uppercase',
            backdropFilter: 'blur(4px)'
        });
        toggle.innerHTML = '<span style="width:7px;height:7px;border-radius:50%;background:#67c8e0;display:inline-block;animation:ktape-blink 1.4s infinite"></span> KERNEL';
        toggle.addEventListener('click', () => api.setOpen(true));

        // Card.
        const root = document.createElement('div');
        root.id = 'kernel-tape';
        Object.assign(root.style, {
            position: 'fixed', top: '0', right: '0', zIndex: '9000',
            display: 'flex', flexDirection: 'column',
            color: D.text, transition: 'transform 260ms ease',
            filter: 'drop-shadow(-8px 0 12px rgba(7,9,12,0.42))',
            overflow: 'hidden'
        });

        const skin = document.createElement('div');
        Object.assign(skin.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });

        // Header sits on top of the skin's header strip.
        const header = document.createElement('div');
        Object.assign(header.style, {
            position: 'relative', display: 'flex', alignItems: 'center', gap: '8px',
            height: `${CARD.header}px`, padding: '0 12px 0 26px', flex: '0 0 auto'
        });
        const title = document.createElement('span');
        title.textContent = 'KERNEL ACTIVITY';
        Object.assign(title.style, { font: `9px/1 ${D.mono}`, letterSpacing: '1.7px', color: D.text });
        el.title = title;
        const spacer = document.createElement('span');
        spacer.style.flex = '1';
        const eps = document.createElement('span');
        eps.textContent = '0 ev/s';
        Object.assign(eps.style, { font: `9px/1 ${D.mono}`, letterSpacing: '1px', color: D.faint });
        const pause = document.createElement('button');
        pause.className = 'ktape-btn';
        pause.textContent = 'PAUSE';
        Object.assign(pause.style, {
            cursor: 'pointer', background: 'transparent', border: `1px solid ${D.edge}`,
            color: D.dim, font: `9px/1 ${D.mono}`, letterSpacing: '1.2px', padding: '3px 6px'
        });
        pause.addEventListener('click', () => api.setPaused(!state.paused));
        const close = document.createElement('button');
        close.className = 'ktape-btn';
        close.textContent = '×';
        Object.assign(close.style, {
            cursor: 'pointer', background: 'transparent', border: 'none',
            color: D.dim, font: `12px/1 ${D.mono}`, padding: '0 0 0 2px'
        });
        close.addEventListener('click', () => api.setOpen(false));
        header.append(title, spacer, eps, pause, close);
        el.closeBtn = close;

        // Body (newest on top).
        const body = document.createElement('div');
        Object.assign(body.style, {
            position: 'relative', flex: '1', overflowY: 'auto', overflowX: 'hidden',
            padding: '5px 0 7px', minHeight: '0',
            maskImage: 'linear-gradient(to bottom, #000 calc(100% - 16px), transparent)',
            webkitMaskImage: 'linear-gradient(to bottom, #000 calc(100% - 16px), transparent)'
        });

        root.append(skin, header, body);
        document.body.append(toggle, root);
        buildInspectorDom();

        el.toggle = toggle;
        el.root = root;
        el.skin = skin;
        el.body = body;
        el.pauseBtn = pause;
        el.eps = eps;

        placeCard();
        // The hero re-renders a beat after a resize, so the band it leaves is
        // only measurable once that settles.
        let replace = null;
        window.addEventListener('resize', () => {
            placeCard();
            window.clearTimeout(replace);
            replace = window.setTimeout(placeCard, 320);
        });
        [260, 1100, 2600].forEach((d) => window.setTimeout(placeCard, d));
    }

    function onMobile() {
        return typeof isMobileLayout === 'function' && isMobileLayout();
    }

    // On a phone the hero is width-limited, so it leaves a band of dead space
    // under the caption. The tape fills that band instead of docking to an edge.
    function placeMobileCard() {
        const margin = 12;
        const hud = document.getElementById('mobile-hud');
        const hudTop = hud && hud.offsetHeight
            ? window.innerHeight - hud.offsetHeight
            : window.innerHeight;

        // The hero publishes where it ends; the tape starts a gap below that.
        const heroBottom = typeof window.__mobileHeroBottom === 'number'
            ? window.__mobileHeroBottom
            : window.innerHeight * 0.62;

        const top = Math.round(heroBottom + margin);
        const h = Math.round(hudTop - margin - top);
        const w = Math.round(window.innerWidth - margin * 2);

        // Landscape leaves no usable band; a stub of a feed is worse than none.
        if (h < MOBILE_MIN_H) {
            el.root.style.display = 'none';
            state.mobileGeom = 'hidden';
            return;
        }
        // The hero is drawn asynchronously, so placement is re-checked on every
        // poll. Skip the repaint unless the band actually moved.
        const key = `${top}:${w}:${h}`;
        if (state.mobileGeom === key) return;
        state.mobileGeom = key;

        el.root.style.display = 'flex';
        Object.assign(el.root.style, {
            top: `${top}px`, left: `${margin}px`, right: 'auto',
            width: `${w}px`, height: `${h}px`,
            filter: 'drop-shadow(0 6px 16px rgba(7,9,12,0.34))'
        });
        el.skin.innerHTML = buildSkin(w, h, true);
    }

    function placeCard() {
        if (!el.root) return;
        if (onMobile()) {
            placeMobileCard();
            placeInspector();
            return;
        }
        const w = Math.round(Math.min(CARD.width, window.innerWidth * 0.34));
        const h = window.innerHeight;
        Object.assign(el.root.style, {
            display: 'flex', top: '0', left: 'auto', right: '0',
            width: `${w}px`, height: `${h}px`,
            filter: 'drop-shadow(-8px 0 12px rgba(7,9,12,0.42))'
        });
        el.skin.innerHTML = buildSkin(w, h);
        placeInspector();
    }

    function placeInspector() {
        if (!el.inspector) return;
        const margin = 12;
        if (onMobile()) {
            Object.assign(el.inspector.style, {
                top: `${margin}px`, right: `${margin}px`, left: `${margin}px`,
                width: 'auto'
            });
            return;
        }
        const tapeWidth = state.open && el.root ? (el.root.offsetWidth || CARD.width) : 0;
        Object.assign(el.inspector.style, {
            top: `${margin}px`, right: `${tapeWidth + margin}px`, left: 'auto',
            width: '420px'
        });
    }

    function closeInspector() {
        if (!el.inspector) return;
        el.inspector.style.display = 'none';
        if (el.inspectorBody) el.inspectorBody.textContent = '';
    }

    function inspectorText(parent, className, value) {
        const node = document.createElement('div');
        node.className = className;
        node.textContent = value === undefined || value === null || value === '' ? 'UNKNOWN' : String(value);
        parent.appendChild(node);
        return node;
    }

    function inspectorSection(parent, label, value) {
        const section = document.createElement('section');
        section.className = 'kei-section';
        inspectorText(section, 'kei-label', label);
        inspectorText(section, 'kei-value', value);
        parent.appendChild(section);
    }

    function buildEventMechanism(model) {
        const section = document.createElement('section');
        section.className = 'kei-mechanism';
        section.setAttribute('aria-label', 'Observed Linux kernel syscall path');
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 390 190');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', 'A task crosses from userspace into the Linux kernel, is dispatched through the syscall table, touches a subsystem and returns');

        const add = (tag, attrs, parent, text) => {
            const node = document.createElementNS(ns, tag);
            Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, value));
            if (text !== undefined) node.textContent = text;
            (parent || svg).appendChild(node);
            return node;
        };
        const clip = (value, length) => {
            const text = String(value === undefined || value === null || value === '' ? 'UNKNOWN' : value);
            return text.length > length ? `${text.slice(0, length - 1)}…` : text;
        };

        const task = model.task || {};
        const call = model.syscall || {};
        const resource = model.resource || {};
        const kernel = model.kernel || {};
        const duration = Number.isFinite(Number(model.durationUs))
            ? `${Number(model.durationUs) >= 1000 ? (Number(model.durationUs) / 1000).toFixed(1) + 'ms' : Number(model.durationUs) + 'µs'}`
            : '—';
        const hasWakeup = Boolean(model.wakeup)
            && !['UNKNOWN', 'NOT OBSERVED', 'NOT COLLECTED', 'N/A'].includes(String(model.wakeup));
        const returnValue = call.ret === undefined || call.ret === null ? '—' : String(call.ret);
        const isError = Number(call.ret) < 0;
        const resourceValue = resource.target
            || (resource.fd !== undefined ? `FD ${resource.fd}` : 'NOT RESOLVED');
        const tracepoint = kernel.wchan || 'raw_syscalls:sys_exit';
        const args = Array.isArray(call.args) ? call.args : [];
        const block = (x, y, width, height, label, value, hot) => {
            const cut = 6;
            add('path', {
                d: `M${x} ${y} H${x + width - cut} L${x + width} ${y + cut} V${y + height} H${x} Z`,
                class: hot ? 'kei-mech-amber' : 'kei-mech-block'
            });
            add('text', { x: x + 7, y: y + 12, class: 'kei-mech-copy' }, svg, label);
            add('text', { x: x + 7, y: y + 25, class: hot ? 'kei-mech-hot' : 'kei-mech-value' }, svg, clip(value, Math.max(6, Math.floor(width / 5.3))));
        };

        add('text', { x: 12, y: 15, class: 'kei-mech-copy' }, svg, 'LINUX KERNEL SLICE · OBSERVED EVENT');
        add('text', { x: 378, y: 15, class: 'kei-mech-hot', 'text-anchor': 'end' }, svg, duration);
        add('path', { d: 'M12 23 H378', class: 'kei-mech-rule' });

        add('rect', { x: 12, y: 29, width: 366, height: 27, class: 'kei-mech-user' });
        add('text', { x: 19, y: 39, class: 'kei-mech-copy' }, svg, 'USERSPACE · RING 3');
        add('text', { x: 19, y: 50, class: 'kei-mech-value' }, svg, `${clip(task.comm, 17)} · PID ${task.pid || '—'}`);
        add('text', { x: 371, y: 45, class: 'kei-mech-copy', 'text-anchor': 'end' }, svg, 'SYSCALL INSTRUCTION');
        add('path', { d: 'M69 56 V70 M65 66 L69 70 L73 66', class: 'kei-mech-live' });
        add('path', { d: 'M12 62 H378', class: 'kei-mech-boundary' });

        add('path', {
            d: 'M12 70 H370 L378 78 V178 H20 L12 170 Z',
            class: 'kei-mech-kernel'
        });
        add('text', { x: 20, y: 83, class: 'kei-mech-hot' }, svg, 'KERNEL SPACE · RING 0');
        add('text', { x: 370, y: 83, class: 'kei-mech-copy', 'text-anchor': 'end' }, svg, 'SYSCALL CORE');

        block(22, 91, 78, 36, '01 · ENTRY', 'arch syscall gate', false);
        block(210, 91, 98, 36, `03 · ${String(model.subsystem || 'KERNEL').toUpperCase()}`, `${call.name || 'unknown'}()`, true);
        block(326, 91, 43, 36, '04 · EXIT', returnValue, false);

        const rotor = add('g', { class: 'kei-mech-rotor' });
        add('circle', { cx: 157, cy: 109, r: 24, class: 'kei-mech-faint' }, rotor);
        for (let index = 0; index < 12; index += 1) {
            const angle = index * Math.PI / 6;
            add('line', {
                x1: 157 + Math.cos(angle) * 18,
                y1: 109 + Math.sin(angle) * 18,
                x2: 157 + Math.cos(angle) * 22,
                y2: 109 + Math.sin(angle) * 22,
                class: index === Number(call.nr || 0) % 12 ? 'kei-mech-live' : 'kei-mech-rule'
            }, rotor);
        }
        add('circle', { cx: 157, cy: 109, r: 14, class: 'kei-mech-amber' }, rotor);
        add('text', { x: 157, y: 112, class: 'kei-mech-hot', 'text-anchor': 'middle' }, rotor, call.nr !== undefined ? call.nr : '—');
        add('text', { x: 157, y: 140, class: 'kei-mech-copy', 'text-anchor': 'middle' }, svg, '02 · SYS_CALL_TABLE');

        add('path', { d: 'M100 109 H133 M181 109 H210 M308 109 H326', class: 'kei-mech-live' });
        [100, 133, 181, 210, 308, 326].forEach((x) => {
            add('circle', { cx: x, cy: 109, r: 2, class: 'kei-mech-port' });
        });

        add('text', { x: 109, y: 91, class: 'kei-mech-copy' }, svg, 'ARGUMENTS');
        args.slice(0, 6).forEach((value, index) => {
            add('rect', {
                x: 110 + index * 7, y: 94, width: 4, height: 7,
                class: Number(value) === 0 ? 'kei-mech-faint' : 'kei-mech-amber'
            });
        });

        block(210, 142, 98, 28, 'RESOURCE / WAIT QUEUE', resourceValue, false);
        block(70, 142, 120, 28, 'SCHEDULER EDGE', hasWakeup ? model.wakeup : 'not observed', hasWakeup);
        add('path', { d: 'M259 127 V142', class: 'kei-mech-rule' });
        add('circle', { cx: 259, cy: 142, r: 2, class: 'kei-mech-port' });
        add('path', {
            d: 'M190 156 H200 Q210 156 210 146',
            class: hasWakeup ? 'kei-mech-live' : 'kei-mech-rule',
            'stroke-dasharray': hasWakeup ? 'none' : '3 4'
        });
        add('circle', {
            cx: 347, cy: 109, r: 3,
            class: `kei-mech-return kei-mech-amber${isError ? ' is-error' : ''}`
        });

        add('text', { x: 20, y: 185, class: 'kei-mech-copy' }, svg, `OBSERVED @ ${clip(tracepoint, 25)}`);
        add('text', { x: 370, y: 185, class: 'kei-mech-copy', 'text-anchor': 'end' }, svg, model.source || 'KERNEL TRACE');

        section.appendChild(svg);
        return section;
    }

    function defaultInspect(ev) {
        return {
            kind: 'DERIVED',
            source: 'KERNEL SNAPSHOT / COUNTER',
            scope: 'MACHINE',
            observedAt: ev.ts,
            name: ev.name,
            subsystem: ev.tagText,
            detail: ev.detail,
            task: null,
            syscall: null,
            resource: null,
            kernel: null
        };
    }

    function explainInspect(model) {
        const task = model.task || {};
        const call = model.syscall || {};
        const kernel = model.kernel || {};
        const resource = model.resource || {};
        if (model.kind === 'EVENT' && task.comm && call.name) {
            const duration = Number.isFinite(Number(model.durationUs))
                ? ` in ${(Number(model.durationUs) / 1000).toFixed(2)} ms`
                : '';
            const result = call.ret !== undefined ? ` and returned ${call.ret}` : '';
            const wakeup = model.wakeup && model.wakeup !== 'NOT OBSERVED'
                ? ` Wakeup correlation: ${model.wakeup}.`
                : ' No matching sched_wakeup was observed for this span.';
            return `${task.comm} (PID ${task.pid}, TID ${task.tid || task.pid}) completed ${call.name}()${duration}${result}.${wakeup}`;
        }
        if (task.comm && call.name) {
            const target = resource.target ? ` on ${resource.target}` : '';
            const wait = kernel.wchan ? `; the sampled thread is waiting in ${kernel.wchan}` : '';
            return `${task.comm} (PID ${task.pid}${task.tid ? `, TID ${task.tid}` : ''}) was observed in ${call.name}()${target}${wait}.`;
        }
        return model.detail || 'No finer relationship is present in this sample.';
    }

    function openInspector(input) {
        if (!el.inspector || !el.inspectorBody) return;
        const model = input || {};
        const body = el.inspectorBody;
        body.textContent = '';

        const heading = document.createElement('div');
        Object.assign(heading.style, { paddingTop: '12px', fontSize: '16px', letterSpacing: '.6px' });
        heading.textContent = String(model.name || 'KERNEL SIGNAL').toUpperCase();
        body.appendChild(heading);

        const chips = document.createElement('div');
        Object.assign(chips.style, { display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '8px' });
        [model.kind, model.source, model.scope, model.age !== undefined ? `AGE ${model.age}s` : null]
            .filter(Boolean)
            .forEach(value => inspectorText(chips, 'kei-chip', value));
        body.appendChild(chips);

        body.appendChild(buildEventMechanism(model));
        inspectorSection(body, 'WHAT THIS MEANS', explainInspect(model));

        const chainSection = document.createElement('section');
        chainSection.className = 'kei-section';
        inspectorText(chainSection, 'kei-label', 'KERNEL PATH');
        const chain = document.createElement('div');
        chain.className = 'kei-chain';
        const task = model.task || {};
        const call = model.syscall || {};
        const kernel = model.kernel || {};
        const resource = model.resource || {};
        [
            ['01 · TASK', task.comm ? `${task.comm} · ${task.pid}` : null],
            ['02 · SYSCALL', call.name ? `${call.name}()` : null],
            ['03 · KERNEL', kernel.wchan],
            ['04 · RESOURCE', resource.target || (resource.fd !== undefined ? `FD ${resource.fd}` : null)],
            ['05 · STATE', task.state],
            ['06 · WAKEUP', model.wakeup]
        ].forEach((nodeData) => {
            const node = document.createElement('div');
            const unavailable = !nodeData[1]
                || ['UNKNOWN', 'NOT OBSERVED', 'NOT COLLECTED', 'N/A'].includes(String(nodeData[1]));
            node.className = `kei-node ${unavailable ? 'is-unknown' : 'is-known'}`;
            const key = document.createElement('b');
            key.textContent = nodeData[0];
            const value = document.createElement('span');
            value.textContent = nodeData[1] || 'UNKNOWN';
            node.append(key, value);
            chain.appendChild(node);
        });
        chainSection.appendChild(chain);
        body.appendChild(chainSection);

        const args = Array.isArray(call.args) && call.args.length ? call.args.join(' · ') : 'UNKNOWN';
        inspectorSection(body, 'SYSCALL ARGUMENTS', args);
        inspectorSection(body, 'OBSERVED', `${model.observedAt || 'UNKNOWN'} · ${model.subsystem || 'UNKNOWN'} · ${model.detail || ''}`);

        placeInspector();
        el.inspector.style.display = 'block';
    }

    function pushRow(ev, options) {
        if (!el.body) return;
        const opts = options || {};
        const row = document.createElement('div');
        row.className = 'ktape-row' + (ev.level === 'err' ? ' err' : '');
        const idle = ev.level === 'dim';
        Object.assign(row.style, {
            display: 'flex', alignItems: 'baseline', gap: '7px',
            padding: '1px 12px', whiteSpace: 'nowrap', lineHeight: '15px',
            borderLeft: ev.level === 'err' ? `2px solid ${ERR_COLOR}` : '2px solid transparent'
        });

        const t = document.createElement('span');
        t.textContent = ev.ts;
        Object.assign(t.style, { color: D.faint, flex: '0 0 auto', fontSize: '9px' });

        const sym = document.createElement('span');
        sym.textContent = ev.sym || '·';
        Object.assign(sym.style, { color: ev.symColor || D.faint, flex: '0 0 auto', width: '9px', textAlign: 'center', fontSize: '11px' });

        const name = document.createElement('span');
        name.textContent = ev.name;
        Object.assign(name.style, {
            color: ev.level === 'err' ? ERR_COLOR : (idle ? D.dim : D.text),
            flex: '0 1 auto', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis'
        });

        const tag = document.createElement('span');
        tag.textContent = ev.tagText;
        Object.assign(tag.style, { color: D.faint, flex: '0 0 auto', fontSize: '9px', letterSpacing: '1px' });

        // Every row in a feed is an event, so amber cannot mean "an event
        // happened" — it is kept for the ones that are climbing or hurting.
        const detail = document.createElement('span');
        detail.textContent = ev.detail || '';
        Object.assign(detail.style, {
            color: ev.level === 'err' ? ERR_COLOR : (idle ? D.faint : (ev.live ? D.accent : D.dim)),
            flex: '1 0 auto', overflow: 'hidden', textOverflow: 'ellipsis',
            textAlign: 'right', fontSize: '9px'
        });

        row.append(t, sym, name, tag, detail);
        row._ktapeParts = { t, sym, name, tag, detail };
        row._ktapeInspect = ev.inspect || defaultInspect(ev);
        row.classList.add('is-inspectable');
        row.addEventListener('click', () => openInspector(row._ktapeInspect));
        (opts.container || el.body).prepend(row);
        if (opts.transient) return row;
        state.rowCount += 1;
        state.eventsThisSecond += 1;
        state.eventsSinceCore += 1;

        while (state.rowCount > MAX_ROWS && el.body.lastChild) {
            el.body.removeChild(el.body.lastChild);
            state.rowCount -= 1;
        }
        return row;
    }

    function updateEps() {
        const now = Date.now();
        const dt = now - state.epsWindowStart;
        if (dt >= 1000) {
            state.eps = Math.round((state.eventsThisSecond * 1000) / dt);
            state.eventsThisSecond = 0;
            state.epsWindowStart = now;
            if (el.eps) el.eps.textContent = `${state.eps} ev/s`;
        }
    }

    async function tickSyscalls() {
        let data;
        try {
            data = await getJson('/api/syscalls-realtime');
        } catch (e) {
            return;
        }
        const list = Array.isArray(data) ? data : (data && Array.isArray(data.syscalls) ? data.syscalls : []);
        if (!list.length) return;

        const current = new Map();
        const candidates = [];
        list.forEach((entry) => {
            const nm = entry && entry.name ? String(entry.name) : '';
            if (!nm) return;
            const c = parseCount(entry.count);
            current.set(nm, c);
            const prev = state.prevSyscalls.has(nm) ? state.prevSyscalls.get(nm) : null;
            const isNew = prev === null;
            const delta = isNew ? 0 : c - prev;
            if (!state.firstSyscallSample && (delta !== 0 || isNew)) {
                candidates.push({ nm, c, delta, isNew });
            }
        });

        if (state.firstSyscallSample) {
            state.prevSyscalls = current;
            state.firstSyscallSample = false;
            return;
        }
        state.prevSyscalls = current;

        candidates.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
        let emitted = candidates.slice(0, MAX_NEW_PER_TICK);

        // Heartbeat: never let the tape go fully silent.
        if (!emitted.length) {
            const top = [...current.entries()].sort((a, b) => b[1] - a[1])[0];
            if (top) emitted = [{ nm: top[0], c: top[1], delta: 0, isNew: false, heartbeat: true }];
        }

        emitted.forEach((c) => {
            const tag = tagForSyscall(c.nm);
            const up = c.delta > 0;
            const sym = c.isNew ? '✦' : (c.delta > 0 ? '▲' : (c.delta < 0 ? '▼' : '·'));
            const symColor = c.isNew ? D.accent : (up ? D.accent : (c.delta < 0 ? D.dim : D.faint));
            const detail = c.delta !== 0
                ? `${c.delta > 0 ? '+' : ''}${c.delta} → ${c.c} proc`
                : `${c.c} proc`;
            pushRow({
                ts: timeStamp(),
                sym, symColor,
                name: c.nm.toUpperCase(),
                tagText: tag.text,
                detail,
                live: c.delta > 0,
                level: c.heartbeat ? 'dim' : 'normal'
            });
        });
    }

    async function tickNetwork() {
        let data;
        try {
            data = await getJson('/api/network-stack-realtime');
        } catch (e) {
            return;
        }
        const m = data && data.layer_metrics ? data.layer_metrics : null;
        if (!m) return;

        const retrans = m.tcp_udp && m.tcp_udp.retrans_per_sec ? m.tcp_udp.retrans_per_sec : 0;
        const ipDrop = m.ip && m.ip.drop_per_sec ? m.ip.drop_per_sec : 0;
        const ifDrop = m.driver && m.driver.drops_per_sec ? m.driver.drops_per_sec : 0;
        const pktIn = m.ip && m.ip.in_packets_per_sec ? m.ip.in_packets_per_sec : 0;
        const pktOut = m.ip && m.ip.out_packets_per_sec ? m.ip.out_packets_per_sec : 0;
        const pkts = pktIn + pktOut;

        if (retrans > 0) {
            pushRow({ ts: timeStamp(), sym: '!', symColor: ERR_COLOR, name: 'TCP RETRANSMIT', tagText: 'NET', detail: `${retrans}/s`, level: 'err' });
        }
        if (ipDrop > 0) {
            pushRow({ ts: timeStamp(), sym: '!', symColor: ERR_COLOR, name: 'IP DROP', tagText: 'NET', detail: `${ipDrop}/s`, level: 'err' });
        }
        if (ifDrop > 0) {
            pushRow({ ts: timeStamp(), sym: '!', symColor: ERR_COLOR, name: 'NIC DROP', tagText: 'NET', detail: `${ifDrop}/s`, level: 'err' });
        }
        if (pkts > 0) {
            const fmt = pkts >= 1000 ? `${(pkts / 1000).toFixed(1)}k pkt/s` : `${Math.round(pkts)} pkt/s`;
            pushRow({ ts: timeStamp(), sym: '⇅', symColor: D.dim, name: 'ip flow', tagText: 'NET', detail: fmt, level: 'normal' });
        }
    }

    async function tickConnections() {
        let data;
        try {
            data = await getJson('/api/active-connections');
        } catch (e) {
            return;
        }
        const list = data && Array.isArray(data.connections) ? data.connections : [];
        const current = new Set();
        const fresh = [];
        list.forEach((c) => {
            if (!c || !c.remote) return;
            const remoteIp = String(c.remote).split(':')[0];
            // Only real, established remote peers (skip listen/loopback/wildcard).
            if (c.state && c.state !== '01') return;
            if (!remoteIp || remoteIp === '127.0.0.1' || remoteIp === '0.0.0.0') return;
            const key = `${c.local}>${c.remote}`;
            current.add(key);
            if (!state.firstConnSample && !state.prevConns.has(key)) {
                fresh.push(c);
            }
        });

        const closed = [];
        if (!state.firstConnSample) {
            state.prevConns.forEach((key) => {
                if (!current.has(key)) closed.push(key);
            });
        }

        state.prevConns = current;
        if (state.firstConnSample) {
            state.firstConnSample = false;
            return;
        }

        fresh.slice(0, 3).forEach((c) => {
            pushRow({
                ts: timeStamp(), sym: '→', symColor: D.accent,
                name: `${c.local} → ${c.remote}`, tagText: 'NET', 
                detail: 'ESTAB', live: true, level: 'normal'
            });
        });
        closed.slice(0, 2).forEach((key) => {
            pushRow({
                ts: timeStamp(), sym: '×', symColor: D.dim,
                name: key.replace('>', ' × '), tagText: 'NET', 
                detail: 'CLOSE', level: 'normal'
            });
        });
    }

    async function tickProcesses() {
        let data;
        try {
            data = await getJson('/api/processes-detailed');
        } catch (e) {
            return;
        }
        const list = data && Array.isArray(data.processes) ? data.processes : [];
        if (!list.length) return;

        const current = new Map();
        const spawned = [];
        list.forEach((p) => {
            if (!p || p.pid === undefined || p.pid === null) return;
            const pid = p.pid;
            const nm = p.name || 'process';
            current.set(pid, nm);
            if (!state.firstProcSample && !state.prevPids.has(pid)) {
                spawned.push({ pid, nm });
            }
        });

        const exited = [];
        if (!state.firstProcSample) {
            state.prevPids.forEach((nm, pid) => {
                if (!current.has(pid)) exited.push({ pid, nm });
            });
        }

        state.prevPids = current;
        if (state.firstProcSample) {
            state.firstProcSample = false;
            return;
        }

        spawned.slice(0, 4).forEach((p) => {
            pushRow({
                ts: timeStamp(), sym: '✦', symColor: D.accent,
                name: `exec ${p.nm}`, tagText: 'SCHED', 
                detail: `pid ${p.pid}`, live: true, level: 'normal'
            });
            pulseNode(p.pid, D.accent);
        });
        exited.slice(0, 3).forEach((p) => {
            pushRow({
                ts: timeStamp(), sym: '⊝', symColor: D.dim,
                name: `exit ${p.nm}`, tagText: 'SCHED', 
                detail: `pid ${p.pid}`, level: 'normal'
            });
            pulseNode(p.pid, D.dim);
        });
    }

    function fmtRate(n) {
        return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`;
    }

    async function tickIoPulse() {
        let d;
        try {
            d = await getJson('/api/io-pulse');
        } catch (e) {
            return;
        }
        if (!d) return;

        const pf = d.pgfault_per_sec || 0;
        const maj = d.pgmajfault_per_sec || 0;
        const swin = d.pswpin_per_sec || 0;
        const swout = d.pswpout_per_sec || 0;
        const rmb = d.disk_read_mb_s || 0;
        const wmb = d.disk_write_mb_s || 0;
        const riops = d.disk_read_iops || 0;
        const wiops = d.disk_write_iops || 0;

        if (pf > 50) {
            pushRow({ ts: timeStamp(), sym: '·', symColor: D.dim, name: 'page faults', tagText: 'MEM', detail: `${fmtRate(pf)}/s`, level: 'normal' });
        }
        if (maj > 0) {
            pushRow({ ts: timeStamp(), sym: '▲', symColor: WARN_COLOR, name: 'major fault', tagText: 'MEM', detail: `${maj}/s`, live: true, level: 'normal' });
        }
        if (swin > 0) {
            pushRow({ ts: timeStamp(), sym: '↧', symColor: WARN_COLOR, name: 'swap in', tagText: 'MEM', detail: `${fmtRate(swin)}/s`, live: true, level: 'normal' });
        }
        if (swout > 0) {
            pushRow({ ts: timeStamp(), sym: '↥', symColor: WARN_COLOR, name: 'swap out', tagText: 'MEM', detail: `${fmtRate(swout)}/s`, live: true, level: 'normal' });
        }
        if (rmb > 0.05) {
            pushRow({ ts: timeStamp(), sym: '◀', symColor: D.dim, name: 'block read', tagText: 'FS', detail: `${rmb.toFixed(2)} MB/s · ${riops} iops`, level: 'normal' });
        }
        if (wmb > 0.05) {
            pushRow({ ts: timeStamp(), sym: '▶', symColor: D.dim, name: 'block write', tagText: 'FS', detail: `${wmb.toFixed(2)} MB/s · ${wiops} iops`, level: 'normal' });
        }
    }

    // ---- Map linkage: transient ripples on the SVG kernel map (uses global d3) ----
    function pulseNode(pid, color) {
        if (typeof d3 === 'undefined' || pid === undefined || pid === null) return;
        const node = d3.select(`.process-node-group[data-pid="${pid}"] circle.process-node`);
        if (node.empty()) return;
        const cx = parseFloat(node.attr('cx'));
        const cy = parseFloat(node.attr('cy'));
        if (!isFinite(cx) || !isFinite(cy)) return;
        const ring = d3.select('svg').append('circle')
            .attr('cx', cx).attr('cy', cy).attr('r', 4)
            .attr('fill', 'none').attr('stroke', color).attr('stroke-width', 1.6)
            .attr('opacity', 0.9).style('pointer-events', 'none');
        ring.transition().duration(900).ease(d3.easeCubicOut)
            .attr('r', 26).attr('stroke-width', 0.3).attr('opacity', 0)
            .on('end', () => ring.remove());
    }

    function pulseCore(intensity) {
        if (typeof d3 === 'undefined' || intensity <= 0) return;
        const core = d3.select('.central-circle');
        if (core.empty()) return;
        const cx = parseFloat(core.attr('cx'));
        const cy = parseFloat(core.attr('cy'));
        if (!isFinite(cx) || !isFinite(cy)) return;
        const amp = Math.max(0, Math.min(1, intensity / 8));
        const ring = d3.select('svg').append('circle')
            .attr('cx', cx).attr('cy', cy).attr('r', 56)
            .attr('fill', 'none')
            .attr('stroke', `rgba(226, 163, 62, ${(0.14 + amp * 0.2).toFixed(2)})`)
            .attr('stroke-width', 1).style('pointer-events', 'none');
        ring.transition().duration(1100).ease(d3.easeCubicOut)
            .attr('r', 80 + amp * 60).attr('stroke-width', 0.2).attr('opacity', 0)
            .on('end', () => ring.remove());
    }

    function setTitle() {
        if (!el.title) return;
        const f = state.focus;
        if (f) {
            el.title.textContent = f.owner
                ? `SOCKET · ${String(f.owner).toUpperCase()}${f.pid ? ` ${f.pid}` : ''}`
                : 'SOCKET · RESOLVING';
            el.title.style.color = D.accent;
            return;
        }
        if (state.pidFocus) {
            const scope = state.pidFocus.scope ? ` · ${state.pidFocus.scope}` : '';
            el.title.textContent = `${state.pidFocus.eventSource || 'PROC'} TRACE${scope} · ${state.pidFocus.label}`;
            el.title.style.color = D.accent;
            return;
        }
        el.title.textContent = 'KERNEL ACTIVITY';
        el.title.style.color = D.text;
    }

    // One socket's own feed. The parked-call names need ptrace-level access and
    // are often closed to us; the read/write counters in /proc/<pid>/io and the
    // socket's byte and segment counters are not. When the names are missing the
    // tape says so once, rather than going quiet and looking idle.
    async function tickSocket() {
        const focus = state.focus;
        if (!focus) return;
        const seq = state.focusSeq;
        const params = new URLSearchParams({
            local: focus.local, remote: focus.remote, proto: focus.proto || 'TCP'
        });
        let data;
        try {
            data = await getJson(`/api/socket-activity?${params.toString()}`);
        } catch (e) {
            return;
        }
        if (seq !== state.focusSeq || !state.focus) return;

        const owner = data && data.owner;
        if (owner && owner.comm) {
            focus.owner = owner.comm;
            focus.pid = owner.pid;
            setTitle();
        }
        if (!data || !data.found) {
            pushRow({ ts: timeStamp(), sym: '·', name: 'socket gone', tagText: 'SOCK', detail: '', level: 'dim' });
            return;
        }

        const prev = state.focusPrev;
        const io = data.io || {};
        const sock = data.socket || {};
        state.focusPrev = { io, sock, reason: data.reason };

        if (!prev) {
            const who = owner && owner.comm ? `${owner.comm} pid ${owner.pid} fd ${owner.fd}` : (data.reason || 'owner not visible');
            pushRow({ ts: timeStamp(), sym: '⌖', symColor: D.accent, name: 'FOCUS', tagText: 'SOCK', detail: who, live: true });
            if (data.readable && !data.calls_readable && data.reason) {
                pushRow({ ts: timeStamp(), sym: '·', name: data.reason, tagText: 'SOCK', detail: 'counts only', level: 'dim' });
            }
            return;
        }

        const step = (now, before) => {
            const a = Number(now);
            const b = Number(before);
            if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
            return a - b;
        };

        const reads = step(io.syscr, prev.io && prev.io.syscr);
        const writes = step(io.syscw, prev.io && prev.io.syscw);
        if (reads > 0) {
            pushRow({ ts: timeStamp(), sym: '▲', symColor: D.accent, name: 'read()', tagText: 'FS', detail: `+${reads} calls`, live: true });
        }
        if (writes > 0) {
            pushRow({ ts: timeStamp(), sym: '▲', symColor: D.accent, name: 'write()', tagText: 'FS', detail: `+${writes} calls`, live: true });
        }

        const segsOut = step(sock.segs_out, prev.sock && prev.sock.segs_out);
        const segsIn = step(sock.segs_in, prev.sock && prev.sock.segs_in);
        const sent = step(sock.bytes_sent, prev.sock && prev.sock.bytes_sent);
        const recv = step(sock.bytes_received, prev.sock && prev.sock.bytes_received);
        if (segsOut > 0 || sent > 0) {
            pushRow({ ts: timeStamp(), sym: '↑', symColor: D.accent, name: 'segments out', tagText: 'NET', detail: `+${segsOut} · ${sent} B`, live: true });
        }
        if (segsIn > 0 || recv > 0) {
            pushRow({ ts: timeStamp(), sym: '↓', symColor: D.accent, name: 'segments in', tagText: 'NET', detail: `+${segsIn} · ${recv} B`, live: true });
        }
        const retrans = step(sock.retrans_total, prev.sock && prev.sock.retrans_total);
        if (retrans > 0) {
            pushRow({ ts: timeStamp(), sym: '!', symColor: ERR_COLOR, name: 'RETRANSMIT', tagText: 'NET', detail: `+${retrans} segs`, level: 'err' });
        }

        (data.calls || []).slice(0, MAX_NEW_PER_TICK).forEach((call) => {
            pushRow({
                ts: timeStamp(),
                sym: '·',
                name: String(call.name || '').toUpperCase(),
                tagText: tagForSyscall(call.name).text,
                detail: `tid ${call.tid} parked`,
                level: 'normal'
            });
        });

        const idle = !reads && !writes && !segsOut && !segsIn && !(data.calls || []).length;
        if (idle) {
            const rtt = Number.isFinite(Number(sock.rtt_ms)) ? `rtt ${Number(sock.rtt_ms).toFixed(1)} ms` : 'quiet';
            pushRow({ ts: timeStamp(), sym: '·', name: 'no calls this tick', tagText: 'SOCK', detail: rtt, level: 'dim' });
        }
    }

    function clearPidFocusBlock(focus) {
        if (focus && focus.block && focus.block.parentNode) focus.block.remove();
        if (focus) {
            focus.block = null;
            focus.rows = new Map();
        }
    }

    function retainPidFocusSummary(focus) {
        if (!focus || focus.retainSummary === false || !Array.isArray(focus.lastRows)) return;
        const duration = Math.max(1, Math.round((Date.now() - focus.startedAt) / 1000));
        const calls = [];
        focus.lastRows.forEach((row) => {
            const call = `${String(row.name || 'UNKNOWN').toUpperCase()}${row.wchan ? `→${row.wchan}` : ''}`;
            if (!calls.includes(call)) calls.push(call);
        });
        const trace = calls.length ? calls.slice(0, 2).join(' · ') : 'NO PARKED CALLS';
        const signature = `${focus.key}|${trace}`;
        const observedAt = timeStamp();
        const detail = `${focus.pids.size} PID · ${trace} · ${duration}s · ${focus.scope || 'UNKNOWN'}`;
        const first = focus.lastModels && focus.lastModels[0];
        const inspect = first
            ? { ...first, kind: 'TRACE SUMMARY', observedAt, detail }
            : {
                kind: 'TRACE SUMMARY',
                source: '/PROC',
                scope: focus.scope || 'UNKNOWN',
                observedAt,
                name: focus.label,
                subsystem: 'NS',
                detail
            };
        const ev = {
            ts: observedAt,
            sym: '◇',
            symColor: D.accent,
            name: focus.label,
            tagText: 'NS',
            detail,
            live: false,
            level: 'normal',
            inspect
        };
        const previous = state.pidSummaries.get(signature);
        if (previous && previous.row && previous.row.isConnected) {
            const parts = previous.row._ktapeParts;
            parts.t.textContent = ev.ts;
            parts.detail.textContent = ev.detail;
            previous.row._ktapeInspect = inspect;
            el.body.prepend(previous.row);
            return;
        }
        const row = pushRow(ev);
        state.pidSummaries.set(signature, { row });
    }

    function renderPidFocusCurrent(focus, rows, scope, sample) {
        if (!el.body || !focus) return;
        if (!focus.block) {
            focus.block = document.createElement('div');
            focus.block.className = 'ktape-focus-current';
            Object.assign(focus.block.style, {
                borderBottom: `1px solid ${D.edge}`,
                background: 'rgba(226,163,62,0.035)',
                padding: '3px 0'
            });
            el.body.prepend(focus.block);
        }

        const visible = rows.slice(0, MAX_NEW_PER_TICK);
        const items = visible.length ? visible : [{
            key: 'idle',
            name: 'NO PARKED CALLS',
            tagText: 'NS',
            detail: `${focus.pids.size} PID · ${scope}`,
            level: 'dim'
        }];
        const nextKeys = new Set();
        const models = [];
        items.forEach((item) => {
            const key = item.key || `${item.pid}:${item.tid || ''}:${item.name}`;
            nextKeys.add(key);
            const world = item.world ? ` · ${focus.nsId.toUpperCase()}-NS ${item.world}` : '';
            const wait = item.wchan ? ` · WAIT ${item.wchan}` : '';
            const observedAt = timeStamp();
            const ev = {
                ts: observedAt,
                sym: item.key === 'idle' ? '·' : '●',
                symColor: item.key === 'idle' ? D.faint : D.accent,
                name: String(item.name || '').toUpperCase(),
                tagText: item.tagText || tagForSyscall(item.name).text,
                detail: item.detail || `${item.comm} · PID ${item.pid}${world}${wait}`,
                live: item.key !== 'idle',
                level: item.level || 'normal',
                inspect: {
                    kind: 'SNAPSHOT',
                    source: '/PROC',
                    scope,
                    age: sample && sample.age,
                    observedAt,
                    name: item.name,
                    subsystem: item.tagText || tagForSyscall(item.name).text,
                    detail: item.detail || `${item.comm} · PID ${item.pid}${world}${wait}`,
                    task: item.key === 'idle' ? null : {
                        comm: item.comm,
                        pid: item.pid,
                        tid: item.tid,
                        state: item.state
                    },
                    syscall: item.key === 'idle' ? null : {
                        name: item.name,
                        nr: item.nr,
                        args: item.args
                    },
                    resource: item.key === 'idle' ? null : {
                        fd: item.fd,
                        target: item.fdTarget
                    },
                    kernel: item.key === 'idle' ? null : {
                        wchan: item.wchan
                    },
                    wakeup: 'NOT COLLECTED'
                }
            };
            models.push(ev.inspect);
            let row = focus.rows.get(key);
            if (!row) {
                row = pushRow(ev, { container: focus.block, transient: true });
                focus.rows.set(key, row);
                return;
            }
            const parts = row._ktapeParts;
            parts.t.textContent = ev.ts;
            parts.sym.textContent = ev.sym;
            parts.name.textContent = ev.name;
            parts.tag.textContent = ev.tagText;
            parts.detail.textContent = ev.detail;
            row._ktapeInspect = ev.inspect;
        });
        focus.rows.forEach((row, key) => {
            if (nextKeys.has(key)) return;
            row.remove();
            focus.rows.delete(key);
        });
        focus.lastRows = rows.slice(0, MAX_NEW_PER_TICK);
        focus.lastModels = models;
    }

    // A namespace is not itself an event source: every task belongs to one
    // world of every namespace type. The honest association is therefore made
    // through its exact PID membership and the collector's current parked-call
    // snapshot. Rows say what is observed now; they do not pretend that a
    // snapshot proves syscall entry or exit.
    function eventTimeStamp(epoch) {
        const value = Number(epoch);
        if (!Number.isFinite(value)) return timeStamp();
        const d = new Date(value * 1000);
        const p = (n, w = 2) => String(n).padStart(w, '0');
        return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
    }

    function eventResource(event) {
        if (event.fd_target) return { fd: event.fd, target: event.fd_target };
        if (event.fd !== undefined) return { fd: event.fd, target: `FD ${event.fd}` };
        const args = Array.isArray(event.args) ? event.args : [];
        if (event.syscall === 'futex' && args.length) {
            return { fd: undefined, target: `uaddr 0x${Number(args[0]).toString(16)}` };
        }
        if (event.syscall === 'nanosleep' || event.syscall === 'clock_nanosleep') {
            return { fd: undefined, target: 'timer' };
        }
        return { fd: undefined, target: 'N/A' };
    }

    function updateEventStatus(focus, payload, eventCount) {
        if (!focus.block) return;
        const threshold = Number(payload.source && payload.source.min_duration_us) || 0;
        const thresholdText = threshold >= 1000
            ? `${Math.round(threshold / 1000)} ms`
            : `${threshold} µs`;
        const observedAt = timeStamp();
        const detail = focus.eventCursor === null
            ? `ARMED · COMPLETED CALL ≥ ${thresholdText} · CURSOR ${payload.seq || 0}`
            : (eventCount
                ? `LIVE · ${eventCount} NEW EVENT${eventCount === 1 ? '' : 'S'} · CURSOR ${payload.seq || 0}`
                : `WAITING · NO MATCHING COMPLETION · ≥ ${thresholdText}`);
        const ev = {
            ts: observedAt,
            sym: eventCount ? '↯' : '◎',
            symColor: eventCount ? D.accent : D.dim,
            name: 'eBPF TRACE',
            tagText: 'EVENT',
            detail,
            live: eventCount > 0,
            level: eventCount ? 'normal' : 'dim',
            inspect: {
                kind: 'TRACE STATUS',
                source: 'eBPF · raw_syscalls + sched_wakeup',
                scope: 'MACHINE',
                age: payload.source && payload.source.age,
                observedAt,
                name: 'eBPF TRACE',
                subsystem: 'KERNEL',
                detail
            }
        };
        if (!focus.eventStatusRow) {
            focus.eventStatusRow = pushRow(ev, { container: focus.block, transient: true });
            return;
        }
        const parts = focus.eventStatusRow._ktapeParts;
        parts.t.textContent = ev.ts;
        parts.sym.textContent = ev.sym;
        parts.name.textContent = ev.name;
        parts.tag.textContent = ev.tagText;
        parts.detail.textContent = ev.detail;
        focus.eventStatusRow._ktapeInspect = ev.inspect;
    }

    function emitKernelEvents(focus, payload) {
        if (!payload || !payload.available) return;
        const latest = Number(payload.seq || 0);
        focus.eventSource = 'EBPF';
        if (focus.scope !== 'MACHINE') focus.scope = 'MACHINE';
        setTitle();
        // The first response establishes "now"; events completed before the
        // pointer arrived must not be presented as consequences of this hover.
        if (focus.eventCursor === null) {
            updateEventStatus(focus, payload, 0);
            focus.eventCursor = latest;
            return;
        }
        if (payload.cursor_lost && !focus.eventGapNoted) {
            pushRow({
                ts: timeStamp(), sym: '!', symColor: WARN_COLOR,
                name: 'TRACE GAP', tagText: 'eBPF',
                detail: 'client cursor fell outside bounded kernel ring',
                level: 'normal'
            });
            focus.eventGapNoted = true;
        }
        const events = Array.isArray(payload.events) ? payload.events.slice(-MAX_NEW_PER_TICK) : [];
        updateEventStatus(focus, payload, events.length);
        events.forEach((event) => {
            const pid = String(event.pid);
            if (!focus.pids.has(pid)) return;
            const durationUs = Number(event.duration_us || 0);
            const duration = durationUs >= 1000
                ? `${(durationUs / 1000).toFixed(durationUs >= 100000 ? 0 : 2)} ms`
                : `${durationUs} µs`;
            const result = Number(event.ret);
            const world = focus.worldByPid.get(pid);
            const ns = world ? ` · ${focus.nsId.toUpperCase()}-NS ${world}` : '';
            const wake = event.wakeup;
            const wakeText = wake
                ? `${wake.waker_comm || 'task'} · PID ${wake.waker_pid || '?'}`
                : 'NOT OBSERVED';
            const resource = eventResource(event);
            const name = String(event.syscall || `syscall_${event.nr}`);
            const observedAt = eventTimeStamp(event.exit_ts);
            const detail = `${event.comm || 'process'} · PID ${pid}${ns} · ${duration} · RET ${result}`;
            pushRow({
                ts: observedAt,
                sym: '↯',
                symColor: D.accent,
                name: name.toUpperCase(),
                tagText: tagForSyscall(name).text,
                detail,
                live: true,
                level: result < 0 ? 'err' : 'normal',
                inspect: {
                    kind: 'EVENT',
                    source: 'eBPF · raw_syscalls + sched_wakeup',
                    scope: 'MACHINE',
                    age: payload.source && payload.source.age,
                    observedAt,
                    name,
                    subsystem: event.subsystem || tagForSyscall(name).text,
                    detail,
                    durationUs,
                    task: {
                        comm: event.comm,
                        pid: event.pid,
                        tid: event.tid,
                        state: 'RETURNED'
                    },
                    syscall: {
                        name,
                        nr: event.nr,
                        args: event.args,
                        ret: event.ret
                    },
                    resource,
                    kernel: { wchan: 'raw_syscalls:sys_exit' },
                    wakeup: wakeText
                }
            });
            pulseNode(event.pid, D.accent);
        });
        focus.eventCursor = latest;
    }

    async function tickPidFocus() {
        const focus = state.pidFocus;
        if (!focus) return;
        const seq = state.pidFocusSeq;
        const pidQuery = encodeURIComponent([...focus.pids].join(','));
        const since = focus.eventCursor === null ? 0 : focus.eventCursor;
        const [data, eventData] = await Promise.all([
            getJson('/api/syscalls-realtime').catch(() => null),
            getJson(`/api/kernel-events?pids=${pidQuery}&since_seq=${since}&limit=80`).catch(() => null)
        ]);
        if (seq !== state.pidFocusSeq || state.pidFocus !== focus) return;
        if (data) {
            const list = Array.isArray(data.syscalls) ? data.syscalls : [];
            const rows = [];
            list.forEach((entry) => {
                const name = entry && entry.name ? String(entry.name) : '';
                if (!name || !Array.isArray(entry.waiters)) return;
                entry.waiters.forEach((waiter) => {
                    const pid = String(waiter && waiter.pid !== undefined ? waiter.pid : '');
                    if (!focus.pids.has(pid)) return;
                    rows.push({
                        name,
                        nr: entry.nr,
                        pid,
                        tid: waiter.tid,
                        comm: waiter.comm || 'process',
                        state: waiter.state,
                        wchan: waiter.wchan,
                        args: waiter.args,
                        fd: waiter.fd,
                        fdTarget: waiter.fd_target,
                        world: focus.worldByPid.get(pid) || ''
                    });
                });
            });
            rows.sort((a, b) => a.name.localeCompare(b.name) || Number(a.pid) - Number(b.pid));
            const sample = data.sample || {};
            const scope = sample.scope === 'machine' ? 'MACHINE' : 'SELF ONLY';
            if (focus.scope !== scope) {
                focus.scope = scope;
                setTitle();
            }
            renderPidFocusCurrent(focus, rows, scope, sample);
        }
        emitKernelEvents(focus, eventData);
    }

    async function tick() {
        if (state.paused || !state.open || state.tickInFlight) return;
        state.tickInFlight = true;
        try {
            if (onMobile()) placeCard();
            const i = state.tickIndex++;
            // Core "breath" reflects activity accumulated since the previous tick.
            pulseCore(state.eventsSinceCore);
            state.eventsSinceCore = 0;
            // A hovered socket owns the tape: mixing the machine-wide feeds back in
            // is exactly the false connection this feature exists to remove.
            if (state.focus) {
                await tickSocket();
                updateEps();
                return;
            }
            if (state.pidFocus) {
                await tickPidFocus();
                updateEps();
                return;
            }
            const polls = [tickSyscalls()];
            if (i % 2 === 0) polls.push(tickNetwork(), tickIoPulse());
            else polls.push(tickConnections());
            if (i % 3 === 2) polls.push(tickProcesses());
            await Promise.allSettled(polls);
            updateEps();
        } finally {
            state.tickInFlight = false;
        }
    }

    // Delta-based feeds need a baseline sample before they can say anything, so
    // opening primes them silently and the rate-based feeds fill the card at once.
    async function primeAndFill() {
        if (state.tickInFlight) return;
        state.tickInFlight = true;
        state.firstSyscallSample = true;
        state.firstConnSample = true;
        state.firstProcSample = true;
        try {
            await Promise.allSettled([
                tickSyscalls(),
                tickConnections(),
                tickProcesses(),
                tickNetwork(),
                tickIoPulse()
            ]);
            await new Promise(resolve => window.setTimeout(resolve, 700));
            if (state.open && !state.paused) await tickSyscalls();
        } finally {
            state.tickInFlight = false;
        }
    }

    const api = {
        setOpen(open) {
            // The phone layout has no toggle: the tape lives in the dead band
            // under the hero, so it is always on.
            const mobile = onMobile();
            const wasOpen = state.open;
            state.open = mobile ? true : !!open;
            if (el.root) {
                placeCard();
                el.root.style.transform = state.open ? 'translateX(0)' : 'translateX(100%)';
                el.root.style.pointerEvents = state.open ? 'auto' : 'none';
            }
            applyPill();
            if (el.closeBtn) el.closeBtn.style.display = mobile ? 'none' : 'inline-block';
            if (!state.open) {
                state.focus = null;
                state.focusPrev = null;
                state.pidFocusSeq += 1;
                clearPidFocusBlock(state.pidFocus);
                state.pidFocus = null;
                closeInspector();
                setTitle();
            }
            if (state.open && !wasOpen) primeAndFill();
        },
        setPaused(paused) {
            state.paused = !!paused;
            if (el.pauseBtn) {
                el.pauseBtn.textContent = paused ? 'RESUME' : 'PAUSE';
                el.pauseBtn.style.color = paused ? D.accent : D.dim;
            }
        },
        // Stand the pill down while something else owns the right edge.
        setPillHidden(hidden) {
            state.pillHidden = !!hidden;
            applyPill();
        },
        // How much of the right edge the open tape owns, so cards can berth
        // beside it instead of underneath it.
        reservedWidth() {
            if (!state.open || onMobile() || !el.root) return 0;
            return el.root.offsetWidth || 0;
        },
        // Right boundary available to cursor tooltips. A pinned Inspector owns
        // the strip immediately left of the tape as well.
        hoverRightEdge() {
            if (onMobile()) return window.innerWidth;
            if (el.inspector && el.inspector.style.display !== 'none') {
                return Math.max(0, el.inspector.offsetLeft);
            }
            return state.open && el.root
                ? Math.max(0, window.innerWidth - (el.root.offsetWidth || 0))
                : window.innerWidth;
        },
        setFocus(socket) {
            if (!state.open || !socket || !socket.local || !socket.remote) return;
            const key = `${socket.local}|${socket.remote}`;
            if (state.focus && state.focus.key === key) return;
            state.focusSeq += 1;
            state.focus = {
                key,
                local: String(socket.local),
                remote: String(socket.remote),
                proto: String(socket.proto || 'TCP').toUpperCase(),
                owner: null,
                pid: null
            };
            state.focusPrev = null;
            setTitle();
            // Sweeping the pointer down the list would otherwise fire a pair of
            // ss runs per row; only a hover that settles is worth a request.
            const seq = state.focusSeq;
            window.setTimeout(() => {
                if (seq !== state.focusSeq || state.paused) return;
                tick();
            }, 250);
        },
        clearFocus() {
            if (!state.focus) return;
            state.focusSeq += 1;
            state.focus = null;
            state.focusPrev = null;
            setTitle();
            state.firstSyscallSample = true;
        },
        setPidFocus(spec) {
            if (!state.open || !spec || !Array.isArray(spec.pids)) return;
            const pids = new Set(spec.pids.map(pid => String(pid)).filter(Boolean));
            if (!pids.size) return;
            const key = String(spec.key || spec.label || 'pid-focus');
            if (state.pidFocus && state.pidFocus.key === key) return;
            const worldByPid = new Map();
            Object.entries(spec.worldByPid || {}).forEach(([pid, inode]) => {
                worldByPid.set(String(pid), String(inode));
            });
            state.pidFocusSeq += 1;
            clearPidFocusBlock(state.pidFocus);
            state.pidFocus = {
                key,
                label: String(spec.label || 'PROCESS SET').toUpperCase(),
                nsId: String(spec.nsId || 'ns'),
                pids,
                worldByPid,
                scope: null,
                block: null,
                rows: new Map(),
                retainSummary: spec.retainSummary !== false,
                startedAt: Date.now(),
                lastRows: null,
                lastModels: null,
                eventCursor: null,
                eventSource: null,
                eventGapNoted: false,
                eventStatusRow: null
            };
            setTitle();
            const seq = state.pidFocusSeq;
            window.setTimeout(() => {
                if (seq !== state.pidFocusSeq || state.paused) return;
                tick();
            }, 180);
        },
        clearPidFocus(key) {
            if (!state.pidFocus) return;
            if (key && state.pidFocus.key !== String(key)) return;
            state.pidFocusSeq += 1;
            retainPidFocusSummary(state.pidFocus);
            clearPidFocusBlock(state.pidFocus);
            state.pidFocus = null;
            setTitle();
            state.firstSyscallSample = true;
        },
        isOpen() {
            return state.open;
        }
    };
    window.KernelTape = api;

    function start() {
        injectStyles();
        buildDom();
        // Desktop hides it behind the ACTIVITY pill; mobile shows it outright.
        api.setOpen(onMobile());
        // Slower cadence on a phone: four endpoints every 1.4s is not a fair
        // trade against a battery.
        state.timer = setInterval(tick, onMobile() ? MOBILE_POLL_MS : POLL_MS);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
