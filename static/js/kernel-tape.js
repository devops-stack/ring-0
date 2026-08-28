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
.ktape-glyph-dot { animation: ktape-blink 1.6s infinite; }
.ktape-btn:hover { color: ${D.text}; }
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
        toggle.innerHTML = '<span style="width:7px;height:7px;border-radius:50%;background:#67c8e0;display:inline-block;animation:ktape-blink 1.4s infinite"></span> ACTIVITY';
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
    }

    function pushRow(ev) {
        if (!el.body) return;
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
        el.body.prepend(row);
        state.rowCount += 1;
        state.eventsThisSecond += 1;
        state.eventsSinceCore += 1;

        while (state.rowCount > MAX_ROWS && el.body.lastChild) {
            el.body.removeChild(el.body.lastChild);
            state.rowCount -= 1;
        }
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
        if (!f) {
            el.title.textContent = 'KERNEL ACTIVITY';
            el.title.style.color = D.text;
            return;
        }
        el.title.textContent = f.owner
            ? `SOCKET · ${String(f.owner).toUpperCase()}${f.pid ? ` ${f.pid}` : ''}`
            : 'SOCKET · RESOLVING';
        el.title.style.color = D.accent;
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

    function tick() {
        if (state.paused || !state.open) return;
        if (onMobile()) placeCard();
        const i = state.tickIndex++;
        // Core "breath" reflects activity accumulated since the previous tick.
        pulseCore(state.eventsSinceCore);
        state.eventsSinceCore = 0;
        // A hovered socket owns the tape: mixing the machine-wide feeds back in
        // is exactly the false connection this feature exists to remove.
        if (state.focus) {
            tickSocket();
            updateEps();
            return;
        }
        tickSyscalls();
        if (i % 2 === 0) { tickNetwork(); tickIoPulse(); }
        else { tickConnections(); }
        if (i % 3 === 2) tickProcesses();
        updateEps();
    }

    // Delta-based feeds need a baseline sample before they can say anything, so
    // opening primes them silently and the rate-based feeds fill the card at once.
    function primeAndFill() {
        state.firstSyscallSample = true;
        state.firstConnSample = true;
        state.firstProcSample = true;
        tickSyscalls();
        tickConnections();
        tickProcesses();
        tickNetwork();
        tickIoPulse();
        window.setTimeout(() => {
            if (state.open && !state.paused) tickSyscalls();
        }, 700);
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
                tickSocket();
            }, 250);
        },
        clearFocus() {
            if (!state.focus) return;
            state.focusSeq += 1;
            state.focus = null;
            state.focusPrev = null;
            setTitle();
            state.firstSyscallSample = true;
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
