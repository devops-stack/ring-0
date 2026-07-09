// Kernel Activity Tape — a live, self-contained console drawer that streams
// real kernel activity (syscall concurrency deltas + network rates) as a
// scrolling event feed. Pure HTML overlay; does not touch the SVG layout.
(function initKernelTape() {
    if (window.KernelTape) return;

    const POLL_MS = 1400;
    const MAX_ROWS = 80;
    const MAX_NEW_PER_TICK = 6;

    const TAGS = {
        network_stack: { text: 'NET', color: 'rgba(103, 190, 224, 0.95)' },
        file_system: { text: 'FS', color: 'rgba(200, 206, 214, 0.95)' },
        process_scheduler: { text: 'SCHED', color: 'rgba(167, 200, 120, 0.95)' },
        memory_management: { text: 'MEM', color: 'rgba(186, 166, 220, 0.95)' }
    };
    const ERR_COLOR = 'rgba(232, 96, 104, 0.98)';
    const WARN_COLOR = 'rgba(230, 193, 90, 0.95)';

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
        eps: 0
    };

    const el = {};

    function injectStyles() {
        if (document.getElementById('kernel-tape-styles')) return;
        const style = document.createElement('style');
        style.id = 'kernel-tape-styles';
        style.textContent = `
@keyframes ktape-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }
@keyframes ktape-rowin { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
@keyframes ktape-flash { 0% { background: rgba(232,96,104,0.28); } 100% { background: transparent; } }
#kernel-tape { font-family: 'JetBrains Mono','SFMono-Regular',Menlo,Consolas,monospace; }
#kernel-tape ::-webkit-scrollbar { width: 7px; }
#kernel-tape ::-webkit-scrollbar-thumb { background: rgba(120,150,170,0.35); border-radius: 4px; }
.ktape-row { animation: ktape-rowin 180ms ease-out; }
.ktape-row.err { animation: ktape-rowin 180ms ease-out, ktape-flash 900ms ease-out; }
`;
        document.head.appendChild(style);
    }

    function buildDom() {
        // Toggle pill (visible when drawer is closed).
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

        // Drawer.
        const root = document.createElement('div');
        root.id = 'kernel-tape';
        Object.assign(root.style, {
            position: 'fixed', top: '0', right: '0', bottom: '0', width: '330px',
            zIndex: '9000', display: 'flex', flexDirection: 'column',
            background: 'linear-gradient(180deg, rgba(10,12,16,0.95) 0%, rgba(9,11,15,0.93) 100%)',
            borderLeft: '1px solid rgba(103,190,224,0.28)',
            boxShadow: '-8px 0 28px rgba(0,0,0,0.35)',
            color: '#c5d0da', backdropFilter: 'blur(6px)',
            transform: 'translateX(0)', transition: 'transform 260ms ease',
            overflow: 'hidden'
        });

        // Header.
        const header = document.createElement('div');
        Object.assign(header.style, {
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '11px 12px 9px', borderBottom: '1px solid rgba(120,150,170,0.16)'
        });
        const dot = document.createElement('span');
        Object.assign(dot.style, { width: '7px', height: '7px', borderRadius: '50%', background: '#67c8e0', boxShadow: '0 0 6px rgba(103,200,224,0.8)', animation: 'ktape-blink 1.4s infinite' });
        const title = document.createElement('span');
        title.textContent = 'KERNEL ACTIVITY';
        Object.assign(title.style, { font: '700 11px/1 monospace', letterSpacing: '2px', color: '#9fd2e4' });
        const live = document.createElement('span');
        live.textContent = 'live';
        Object.assign(live.style, { font: '10px/1 monospace', letterSpacing: '1px', color: '#5d7886' });
        const spacer = document.createElement('span');
        spacer.style.flex = '1';
        const close = document.createElement('button');
        close.textContent = '×';
        Object.assign(close.style, { cursor: 'pointer', background: 'transparent', border: 'none', color: '#7f97a4', font: '16px/1 monospace', padding: '0 2px' });
        close.addEventListener('click', () => api.setOpen(false));
        header.append(dot, title, live, spacer, close);

        // Controls strip.
        const controls = document.createElement('div');
        Object.assign(controls.style, {
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '6px 12px', borderBottom: '1px solid rgba(120,150,170,0.1)',
            font: '9.5px/1 monospace', letterSpacing: '0.5px', color: '#6f8895'
        });
        const pause = document.createElement('button');
        pause.textContent = 'PAUSE';
        Object.assign(pause.style, { cursor: 'pointer', background: 'rgba(120,150,170,0.12)', border: '1px solid rgba(120,150,170,0.25)', color: '#9fb3bf', font: '600 9px/1 monospace', letterSpacing: '1px', padding: '4px 8px', borderRadius: '4px' });
        pause.addEventListener('click', () => api.setPaused(!state.paused));
        const eps = document.createElement('span');
        eps.textContent = '0 ev/s';
        const ctrlSpacer = document.createElement('span');
        ctrlSpacer.style.flex = '1';
        const legend = document.createElement('span');
        legend.innerHTML = '<span style="color:rgba(103,190,224,0.95)">NET</span> <span style="color:rgba(200,206,214,0.95)">FS</span> <span style="color:rgba(186,166,220,0.95)">MEM</span> <span style="color:rgba(167,200,120,0.95)">SCHED</span>';
        controls.append(pause, ctrlSpacer, eps, legend);

        // Body (newest on top).
        const body = document.createElement('div');
        Object.assign(body.style, { flex: '1', overflowY: 'auto', overflowX: 'hidden', padding: '4px 0 10px' });

        root.append(header, controls, body);
        document.body.append(toggle, root);

        el.toggle = toggle;
        el.root = root;
        el.body = body;
        el.pauseBtn = pause;
        el.eps = eps;
    }

    function pushRow(ev) {
        if (!el.body) return;
        const row = document.createElement('div');
        row.className = 'ktape-row' + (ev.level === 'err' ? ' err' : '');
        Object.assign(row.style, {
            display: 'flex', alignItems: 'baseline', gap: '8px',
            padding: '2px 12px', whiteSpace: 'nowrap', fontSize: '11px', lineHeight: '15px',
            borderLeft: ev.level === 'err' ? `2px solid ${ERR_COLOR}` : '2px solid transparent'
        });

        const t = document.createElement('span');
        t.textContent = ev.ts;
        Object.assign(t.style, { color: '#5a7280', flex: '0 0 auto', fontSize: '10px' });

        const sym = document.createElement('span');
        sym.textContent = ev.sym || '·';
        Object.assign(sym.style, { color: ev.symColor || '#6f8895', flex: '0 0 auto', width: '10px', textAlign: 'center' });

        const name = document.createElement('span');
        name.textContent = ev.name;
        Object.assign(name.style, { color: ev.level === 'err' ? ERR_COLOR : '#d6e0e8', flex: '0 0 auto', fontWeight: ev.level === 'err' ? '700' : '500' });

        const tag = document.createElement('span');
        tag.textContent = ev.tagText;
        Object.assign(tag.style, { color: ev.tagColor, flex: '0 0 auto', fontSize: '9px', letterSpacing: '0.5px' });

        const detail = document.createElement('span');
        detail.textContent = ev.detail || '';
        Object.assign(detail.style, { color: '#6f8895', flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'right', fontSize: '10px' });

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
            const symColor = c.isNew ? '#9fd2e4' : (up ? 'rgba(167,200,120,0.95)' : (c.delta < 0 ? '#7f97a4' : '#566a76'));
            const detail = c.delta !== 0
                ? `${c.delta > 0 ? '+' : ''}${c.delta} → ${c.c} proc`
                : `${c.c} proc`;
            pushRow({
                ts: timeStamp(),
                sym, symColor,
                name: c.nm.toUpperCase(),
                tagText: tag.text, tagColor: tag.color,
                detail,
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
            pushRow({ ts: timeStamp(), sym: '!', symColor: ERR_COLOR, name: 'TCP RETRANSMIT', tagText: 'NET', tagColor: TAGS.network_stack.color, detail: `${retrans}/s`, level: 'err' });
        }
        if (ipDrop > 0) {
            pushRow({ ts: timeStamp(), sym: '!', symColor: ERR_COLOR, name: 'IP DROP', tagText: 'NET', tagColor: TAGS.network_stack.color, detail: `${ipDrop}/s`, level: 'err' });
        }
        if (ifDrop > 0) {
            pushRow({ ts: timeStamp(), sym: '!', symColor: ERR_COLOR, name: 'NIC DROP', tagText: 'NET', tagColor: TAGS.network_stack.color, detail: `${ifDrop}/s`, level: 'err' });
        }
        if (pkts > 0) {
            const fmt = pkts >= 1000 ? `${(pkts / 1000).toFixed(1)}k pkt/s` : `${Math.round(pkts)} pkt/s`;
            pushRow({ ts: timeStamp(), sym: '⇅', symColor: TAGS.network_stack.color, name: 'ip flow', tagText: 'NET', tagColor: TAGS.network_stack.color, detail: fmt, level: 'normal' });
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
                ts: timeStamp(), sym: '→', symColor: 'rgba(167,200,120,0.95)',
                name: `${c.local} → ${c.remote}`, tagText: 'NET', tagColor: TAGS.network_stack.color,
                detail: 'ESTAB', level: 'normal'
            });
        });
        closed.slice(0, 2).forEach((key) => {
            pushRow({
                ts: timeStamp(), sym: '×', symColor: '#7f97a4',
                name: key.replace('>', ' × '), tagText: 'NET', tagColor: TAGS.network_stack.color,
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
                ts: timeStamp(), sym: '✦', symColor: 'rgba(167,200,120,0.95)',
                name: `exec ${p.nm}`, tagText: 'SCHED', tagColor: TAGS.process_scheduler.color,
                detail: `pid ${p.pid}`, level: 'normal'
            });
            pulseNode(p.pid, 'rgba(167, 200, 120, 0.95)');
        });
        exited.slice(0, 3).forEach((p) => {
            pushRow({
                ts: timeStamp(), sym: '⊝', symColor: '#7f97a4',
                name: `exit ${p.nm}`, tagText: 'SCHED', tagColor: TAGS.process_scheduler.color,
                detail: `pid ${p.pid}`, level: 'normal'
            });
            pulseNode(p.pid, 'rgba(127, 151, 164, 0.9)');
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
            pushRow({ ts: timeStamp(), sym: '·', symColor: TAGS.memory_management.color, name: 'page faults', tagText: 'MEM', tagColor: TAGS.memory_management.color, detail: `${fmtRate(pf)}/s`, level: 'normal' });
        }
        if (maj > 0) {
            pushRow({ ts: timeStamp(), sym: '▲', symColor: WARN_COLOR, name: 'major fault', tagText: 'MEM', tagColor: TAGS.memory_management.color, detail: `${maj}/s`, level: 'normal' });
        }
        if (swin > 0) {
            pushRow({ ts: timeStamp(), sym: '↧', symColor: WARN_COLOR, name: 'swap in', tagText: 'MEM', tagColor: TAGS.memory_management.color, detail: `${fmtRate(swin)}/s`, level: 'normal' });
        }
        if (swout > 0) {
            pushRow({ ts: timeStamp(), sym: '↥', symColor: WARN_COLOR, name: 'swap out', tagText: 'MEM', tagColor: TAGS.memory_management.color, detail: `${fmtRate(swout)}/s`, level: 'normal' });
        }
        if (rmb > 0.05) {
            pushRow({ ts: timeStamp(), sym: '◀', symColor: TAGS.file_system.color, name: 'block read', tagText: 'FS', tagColor: TAGS.file_system.color, detail: `${rmb.toFixed(2)} MB/s · ${riops} iops`, level: 'normal' });
        }
        if (wmb > 0.05) {
            pushRow({ ts: timeStamp(), sym: '▶', symColor: TAGS.file_system.color, name: 'block write', tagText: 'FS', tagColor: TAGS.file_system.color, detail: `${wmb.toFixed(2)} MB/s · ${wiops} iops`, level: 'normal' });
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
            .attr('stroke', `rgba(103, 190, 224, ${(0.16 + amp * 0.24).toFixed(2)})`)
            .attr('stroke-width', 1).style('pointer-events', 'none');
        ring.transition().duration(1100).ease(d3.easeCubicOut)
            .attr('r', 80 + amp * 60).attr('stroke-width', 0.2).attr('opacity', 0)
            .on('end', () => ring.remove());
    }

    function tick() {
        if (state.paused || !state.open) return;
        const i = state.tickIndex++;
        // Core "breath" reflects activity accumulated since the previous tick.
        pulseCore(state.eventsSinceCore);
        state.eventsSinceCore = 0;
        tickSyscalls();
        if (i % 2 === 0) { tickNetwork(); tickIoPulse(); }
        else { tickConnections(); }
        if (i % 3 === 2) tickProcesses();
        updateEps();
    }

    const api = {
        setOpen(open) {
            state.open = !!open;
            if (el.root) el.root.style.transform = open ? 'translateX(0)' : 'translateX(100%)';
            if (el.toggle) el.toggle.style.display = open ? 'none' : 'inline-flex';
        },
        setPaused(paused) {
            state.paused = !!paused;
            if (el.pauseBtn) {
                el.pauseBtn.textContent = paused ? 'RESUME' : 'PAUSE';
                el.pauseBtn.style.color = paused ? '#e8c15a' : '#9fb3bf';
            }
        }
    };
    window.KernelTape = api;

    function start() {
        if (typeof isMobileLayout === 'function' && isMobileLayout()) return;
        injectStyles();
        buildDom();
        // Hidden by default: only the ACTIVITY pill shows until the user opens it.
        api.setOpen(false);
        state.timer = setInterval(tick, POLL_MS);
        // Prime quickly so the feed comes alive without waiting a full interval
        // once it's opened (tick() is a no-op while the drawer is closed).
        setTimeout(tick, 250);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
