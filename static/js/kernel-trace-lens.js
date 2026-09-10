// Kernel Trace Lens: an ephemeral process -> parked syscall -> subsystem path.
//
// It consumes the syscall snapshot already fetched by SyscallsManager.  No
// extra polling is introduced.  /proc/PID/syscall only proves that a thread
// was parked in a call at sample time, so absence is drawn as unknown rather
// than replaced with a plausible fast syscall.
(function initKernelTraceLens() {
    if (window.KernelTraceLens) return;

    const state = {
        byPid: new Map(),
        sample: null,
        observedAt: 0,
        activePid: null,
        pinnedPid: null,
        hideTimer: null
    };
    const LAYER = "kernel-trace-lens-layer";
    const ACCENT = "#e2a33e";
    const UNKNOWN = "rgba(103,200,224,0.72)";

    function number(value) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function clip(value, max) {
        const text = String(value === undefined || value === null ? "UNKNOWN" : value);
        return text.length > max ? `${text.slice(0, max - 1)}…` : text;
    }

    function ingest(data, observedAt) {
        const byPid = new Map();
        const rows = data && Array.isArray(data.syscalls) ? data.syscalls : [];
        rows.forEach((row) => {
            const syscall = String((row && row.name) || "").toLowerCase();
            if (!syscall || /^(vm|disk|net):/.test(syscall)) return;
            const waiters = Array.isArray(row.waiters) ? row.waiters : [];
            waiters.forEach((waiter) => {
                const pid = number(waiter && waiter.pid);
                if (pid === null || pid <= 0) return;
                if (!byPid.has(pid)) byPid.set(pid, []);
                byPid.get(pid).push({
                    pid,
                    tid: number(waiter.tid),
                    comm: waiter.comm,
                    state: waiter.state,
                    wchan: waiter.wchan,
                    args: Array.isArray(waiter.args) ? waiter.args : [],
                    fd: waiter.fd,
                    fd_target: waiter.fd_target,
                    name: syscall,
                    nr: row.nr,
                    subsystem: row.subsystem
                });
            });
        });
        state.byPid = byPid;
        state.sample = (data && data.sample) || {};
        state.observedAt = number(observedAt) || Date.now();
        if (state.pinnedPid !== null) draw(state.pinnedPid, true);
        else if (state.activePid !== null) draw(state.activePid, false);
    }

    function subsystem(trace) {
        const raw = String((trace && trace.subsystem) || "kernel").toLowerCase();
        const labels = {
            fs: "FILESYSTEM",
            net: "NETWORK",
            mm: "MEMORY",
            sched: "SCHEDULER",
            kernel: "KERNEL CORE"
        };
        return { key: raw, label: labels[raw] || "KERNEL CORE" };
    }

    function mechanismFor(model) {
        if (!window.KernelMechanisms || typeof window.KernelMechanisms.kindFor !== "function") {
            return null;
        }
        return window.KernelMechanisms.kindFor(model);
    }

    function resourceFor(trace) {
        if (!trace) return { fd: undefined, target: null };
        if (trace.fd_target) return { fd: trace.fd, target: trace.fd_target };
        if (trace.fd !== undefined && trace.fd !== null) return { fd: trace.fd, target: `FD ${trace.fd}` };
        if (trace.name === "futex" && trace.args.length) {
            const address = number(trace.args[0]);
            return {
                fd: undefined,
                target: address === null ? "FUTEX WORD UNKNOWN" : `uaddr 0x${address.toString(16)}`
            };
        }
        return { fd: undefined, target: null };
    }

    function modelFor(pid) {
        const snapshotFresh = state.observedAt > 0 && Date.now() - state.observedAt <= 7000;
        const traces = snapshotFresh ? (state.byPid.get(Number(pid)) || []) : [];
        // Prefer the thread-group leader; otherwise keep the first observed
        // parked thread and state how many siblings were also visible.
        const trace = traces.find((row) => row.tid === Number(pid)) || traces[0] || null;
        const processIndex = window.__processIndex && window.__processIndex.byPid;
        const process = processIndex && processIndex.get(Number(pid));
        const scope = state.sample && state.sample.scope === "machine" ? "MACHINE" : "SELF ONLY";
        if (!trace) {
            return {
                state: "unknown",
                process: process || { pid: Number(pid), name: "process" },
                trace: null,
                model: null,
                threadCount: 0,
                scope
            };
        }
        const sub = subsystem(trace);
        const resource = resourceFor(trace);
        const model = {
            kind: "PARKED TASK SNAPSHOT",
            source: "/proc/PID/syscall",
            scope,
            observedAt: new Date(state.observedAt).toTimeString().slice(0, 12),
            name: String(trace.name || "syscall").toUpperCase(),
            subsystem: sub.label,
            detail: `${trace.comm || (process && process.name) || "Thread"} (PID ${pid}, TID ${trace.tid || pid}) was parked in ${trace.name} at snapshot time. This does not claim that a fast syscall is executing now.`,
            task: {
                comm: trace.comm || (process && process.name),
                pid: Number(pid),
                tid: trace.tid,
                state: trace.state || "PARKED"
            },
            syscall: {
                name: trace.name,
                nr: trace.nr,
                args: trace.args,
                ret: null
            },
            resource,
            kernel: { wchan: trace.wchan || "WAIT CHANNEL UNKNOWN" },
            wakeup: "NOT OBSERVED BY THIS SNAPSHOT",
            path: [
                ["01 · PROCESS", `${trace.comm || (process && process.name) || "task"} · ${pid}`],
                ["02 · THREAD", trace.tid ? `TID ${trace.tid} · PARKED` : null],
                ["03 · SYSCALL", trace.name || null],
                ["04 · SUBSYSTEM", sub.label],
                ["05 · MECHANISM", trace.wchan || null],
                ["06 · SAMPLE", `${scope} · ${Number(state.sample.age || 0).toFixed(1)} S OLD`]
            ]
        };
        model.mechanism = mechanismFor(model) || undefined;
        return {
            state: "parked",
            process: process || { pid: Number(pid), name: trace.comm || "process" },
            trace,
            model,
            threadCount: traces.length,
            scope,
            subsystem: sub,
            mechanism: model.mechanism
        };
    }

    function pathStart(path) {
        const match = String(path || "").match(/^M\s*(-?[\d.]+)[,\s]+(-?[\d.]+)/);
        return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
    }

    function station(group, x, y, width, title, value, known, shape) {
        if (shape === "diamond") {
            group.append("path")
                .attr("d", `M${x} ${y - 15} L${x + width / 2} ${y} L${x} ${y + 15} L${x - width / 2} ${y} Z`)
                .attr("fill", known ? "rgba(226,163,62,0.10)" : "rgba(103,200,224,0.025)")
                .attr("stroke", known ? ACCENT : UNKNOWN)
                .attr("stroke-width", 0.8)
                .attr("stroke-dasharray", known ? null : "2 3");
            group.append("text").attr("x", x).attr("y", y - 2)
                .attr("text-anchor", "middle").attr("fill", "rgba(244,244,236,0.52)")
                .attr("font-family", "Share Tech Mono, monospace").attr("font-size", 6)
                .attr("letter-spacing", "0.8px").text(title);
            group.append("text").attr("x", x).attr("y", y + 8)
                .attr("text-anchor", "middle").attr("fill", known ? ACCENT : UNKNOWN)
                .attr("font-family", "Share Tech Mono, monospace").attr("font-size", 7)
                .text(clip(value, 14));
            return;
        }
        const left = x - width / 2;
        const folder = shape === "folder";
        group.append("path")
            .attr("d", folder
                ? `M${left} ${y - 12} H${left + 20} L${left + 25} ${y - 17} H${left + width - 7} L${left + width} ${y - 10} V${y + 15} H${left} Z`
                : `M${left} ${y - 15} H${left + width - 7} L${left + width} ${y - 8} V${y + 15} H${left} Z`)
            .attr("fill", known ? "rgba(9,12,16,0.92)" : "rgba(103,200,224,0.025)")
            .attr("stroke", known ? ACCENT : UNKNOWN)
            .attr("stroke-width", 0.8)
            .attr("stroke-dasharray", known ? null : "2 3");
        group.append("text").attr("x", left + 7).attr("y", y - 2)
            .attr("fill", "rgba(244,244,236,0.48)")
            .attr("font-family", "Share Tech Mono, monospace").attr("font-size", 6)
            .attr("letter-spacing", "0.8px").text(title);
        group.append("text").attr("x", left + 7).attr("y", y + 10)
            .attr("fill", known ? ACCENT : UNKNOWN)
            .attr("font-family", "Share Tech Mono, monospace").attr("font-size", 7)
            .text(clip(value, Math.max(10, Math.floor(width / 6))));
    }

    function draw(pid, pinned) {
        const root = d3.select("svg");
        root.selectAll(`.${LAYER}`).remove();
        const node = root.select(`.process-node-group[data-pid="${Number(pid)}"] circle.process-node`);
        const processPath = root.select(`.process-line[data-pid="${Number(pid)}"]`);
        if (node.empty() || processPath.empty()) return;
        const px = number(node.attr("cx"));
        const py = number(node.attr("cy"));
        const center = pathStart(processPath.attr("d"));
        if (px === null || py === null || !center) return;

        const resolved = modelFor(pid);
        const known = resolved.state === "parked";
        const trace = resolved.trace;
        const layer = root.append("g")
            .attr("class", LAYER)
            .attr("data-pid", Number(pid))
            .style("pointer-events", "none");

        layer.append("path")
            .attr("d", processPath.attr("d"))
            .attr("fill", "none")
            .attr("stroke", known ? ACCENT : UNKNOWN)
            .attr("stroke-width", pinned ? 2 : 1.25)
            .attr("stroke-opacity", known ? 0.88 : 0.58)
            .attr("stroke-dasharray", known ? "1 5" : "2 5")
            .attr("stroke-linecap", "round");

        const dx = center.x - px;
        const dy = center.y - py;
        const length = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const ux = dx / length;
        const uy = dy / length;
        const nx = -uy;
        const ny = ux;
        const at = (fraction, offset) => ({
            x: px + dx * fraction + nx * offset,
            y: py + dy * fraction + ny * offset
        });
        const callAt = at(0.31, 13);
        const subsystemAt = at(0.58, -12);
        const mechanismAt = at(0.82, 13);
        const sub = resolved.subsystem || { label: "PATH UNKNOWN" };
        const mech = resolved.mechanism
            ? String(resolved.mechanism).replace("-", " ").toUpperCase()
            : (trace && trace.wchan ? String(trace.wchan).toUpperCase() : "NOT OBSERVED");

        station(layer, callAt.x, callAt.y, 92, "PARKED SYSCALL",
            trace ? String(trace.name).toUpperCase() : "NOT IN SNAPSHOT", known, "gate");
        station(layer, subsystemAt.x, subsystemAt.y, 78, "SUBSYSTEM",
            known ? sub.label : "UNKNOWN", known, "diamond");
        station(layer, mechanismAt.x, mechanismAt.y, 96, "MECHANISM",
            known ? mech : "FAST PATH UNKNOWN", known, "folder");

        layer.append("circle")
            .attr("cx", px).attr("cy", py).attr("r", pinned ? 8.5 : 6.5)
            .attr("fill", "rgba(9,12,16,0.96)")
            .attr("stroke", known ? ACCENT : UNKNOWN)
            .attr("stroke-width", pinned ? 1.6 : 1);

        const statusAt = at(0.08, -14);
        layer.append("text")
            .attr("x", statusAt.x).attr("y", statusAt.y)
            .attr("fill", known ? ACCENT : UNKNOWN)
            .attr("font-family", "Share Tech Mono, monospace").attr("font-size", 7)
            .attr("text-anchor", "middle").attr("letter-spacing", "0.7px")
            .text(known
                ? `${resolved.threadCount} PARKED THREAD${resolved.threadCount === 1 ? "" : "S"}`
                : "NO PARKED THREAD OBSERVED");

        if (known) drawAction(layer, resolved, px, py, ux, uy, pinned);
        layer.raise();
    }

    function drawAction(layer, resolved, px, py, ux, uy, pinned) {
        const x = px + ux * 22;
        const y = py + uy * 22;
        const action = layer.append("g")
            .attr("class", "kernel-trace-lens-action")
            .style("pointer-events", "all")
            .style("cursor", "pointer")
            .on("mouseenter", cancelHide)
            .on("mouseleave", scheduleHide)
            .on("click", function (event) {
                event.stopPropagation();
                state.pinnedPid = resolved.process.pid;
                state.activePid = resolved.process.pid;
                draw(resolved.process.pid, true);
                if (window.KernelTape && typeof window.KernelTape.openInspector === "function") {
                    window.KernelTape.openInspector(resolved.model);
                }
            });
        action.append("circle")
            .attr("cx", x).attr("cy", y).attr("r", 10)
            .attr("fill", "transparent");
        action.append("path")
            .attr("d", `M${x} ${y - 7} L${x + 7} ${y} L${x} ${y + 7} L${x - 7} ${y} Z`)
            .attr("fill", pinned ? "rgba(226,163,62,0.34)" : "rgba(226,163,62,0.16)")
            .attr("stroke", ACCENT).attr("stroke-width", 1);
        action.append("text")
            .attr("x", x + (ux >= 0 ? 12 : -12)).attr("y", y + 3)
            .attr("text-anchor", ux >= 0 ? "start" : "end")
            .attr("fill", ACCENT)
            .attr("font-family", "Share Tech Mono, monospace").attr("font-size", 7)
            .attr("letter-spacing", "0.8px")
            .text(pinned ? "PINNED" : "TRACE");
    }

    function cancelHide() {
        if (state.hideTimer) {
            clearTimeout(state.hideTimer);
            state.hideTimer = null;
        }
    }

    function show(process) {
        const pid = number(process && process.pid !== undefined ? process.pid : process);
        if (pid === null || pid <= 0) return;
        cancelHide();
        if (state.pinnedPid !== null && state.pinnedPid !== pid) return;
        state.activePid = pid;
        draw(pid, state.pinnedPid === pid);
    }

    function scheduleHide() {
        cancelHide();
        state.hideTimer = setTimeout(() => {
            state.hideTimer = null;
            if (state.pinnedPid !== null) return;
            state.activePid = null;
            d3.select("svg").selectAll(`.${LAYER}`).remove();
        }, 220);
    }

    function clearPin() {
        state.pinnedPid = null;
        state.activePid = null;
        cancelHide();
        d3.select("svg").selectAll(`.${LAYER}`).remove();
    }

    function refresh() {
        if (state.pinnedPid !== null) draw(state.pinnedPid, true);
    }

    window.addEventListener("kernel-telemetry", (event) => {
        const detail = event.detail || {};
        if (detail.kind === "syscalls" && detail.data) {
            ingest(detail.data, detail.observedAt);
        }
    });
    window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") clearPin();
    });

    window.KernelTraceLens = {
        ingest,
        show,
        scheduleHide,
        cancelHide,
        clearPin,
        refresh,
        resolve: modelFor,
        isPinned: () => state.pinnedPid !== null
    };
})();
