// Geometric Kernel Atlas PoC, enabled only by ?atlas=1 on the central page.
//
// The motion trail is an explicit projection of the last eight execution
// samples, never an instruction pointer. Syscall contours are eight snapshots
// of threads parked at subsystem gates. Both feeds are shared with the main UI.
(function initKernelAtlasPoc() {
    if (window.KernelAtlasPoc) return;

    const ENABLED = new URLSearchParams(window.location.search).get("atlas") === "1";
    const HISTORY_MAX = 8;
    const EXEC_STALE_MS = 3500;
    const SYSCALL_STALE_MS = 6500;
    const PAPER = "#e8e7de";
    const INK = "#171a1c";
    const GRAPHITE = "rgba(23,26,28,0.42)";
    const FAINT = "rgba(23,26,28,0.12)";
    const ACCENT = "#c77b12";
    const AMBER = "#e2a33e";
    const UNKNOWN = "#4b93a8";
    const GATES = [
        { id: "sched", label: "SCHEDULER", angle: -Math.PI / 2 },
        { id: "net", label: "NETWORK", angle: -Math.PI / 10 },
        { id: "fs", label: "VFS / FS", angle: Math.PI * 0.3 },
        { id: "mm", label: "MEMORY", angle: Math.PI * 0.7 },
        { id: "kernel", label: "KERNEL CORE", angle: Math.PI * 1.1 }
    ];
    const state = {
        mounted: false,
        width: 0,
        height: 0,
        executionHistory: [],
        syscallHistory: [],
        executionSamples: 0,
        executionObservedAt: 0,
        syscallObservedAt: 0,
        latestExecution: null,
        latestSyscalls: null,
        selected: "sched"
    };

    function finite(value, fallback) {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function clip(value, max) {
        const text = String(value === undefined || value === null || value === "" ? "NOT OBSERVED" : value);
        return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
    }

    function pushBounded(history, value) {
        history.push(value);
        while (history.length > HISTORY_MAX) history.shift();
    }

    function executionFrame(data) {
        if (!window.ExecutionContextDial || typeof window.ExecutionContextDial.derive !== "function") return [];
        return window.ExecutionContextDial.derive(data, state.executionSamples, false);
    }

    function syscallFrame(data) {
        if (!window.SystemCallGate || typeof window.SystemCallGate.derive !== "function") return [];
        return window.SystemCallGate.derive(data, false);
    }

    function ingestExecution(data, observedAt) {
        if (!ENABLED || !data) return;
        state.latestExecution = data;
        state.executionObservedAt = finite(observedAt, Date.now());
        state.executionSamples += 1;
        pushBounded(state.executionHistory, {
            at: state.executionObservedAt,
            values: executionFrame(data),
            mode: data.mode,
            syscall: data.syscall_name || null
        });
        render();
    }

    function ingestSyscalls(data, observedAt) {
        if (!ENABLED || !data) return;
        state.latestSyscalls = data;
        state.syscallObservedAt = finite(observedAt, Date.now());
        pushBounded(state.syscallHistory, {
            at: state.syscallObservedAt,
            partial: Boolean(data.sample && data.sample.scope === "self"),
            values: syscallFrame(data)
        });
        render();
    }

    function projectExecution(frame, cx, cy, radiusX, radiusY) {
        const values = frame && Array.isArray(frame.values) ? frame.values : [];
        let sx = 0;
        let sy = 0;
        let weightSum = 0;
        let dominant = null;
        values.forEach((value, index) => {
            if (!value.known || !value.active) return;
            const weight = finite(value.intensity, 0) * (value.inferred ? 0.45 : 1);
            const angle = -Math.PI / 2 + index * (Math.PI * 2 / 5);
            sx += Math.cos(angle) * weight;
            sy += Math.sin(angle) * weight;
            weightSum += weight;
            if (!dominant || weight > dominant.weight) dominant = { id: value.id, weight, inferred: value.inferred };
        });
        if (!weightSum) return { x: cx, y: cy, idle: true, dominant: null };
        const angle = Math.atan2(sy, sx);
        const magnitude = Math.min(1, weightSum / 2.5);
        return {
            x: cx + Math.cos(angle) * radiusX * (0.35 + magnitude * 0.65),
            y: cy + Math.sin(angle) * radiusY * (0.35 + magnitude * 0.65),
            idle: false,
            dominant
        };
    }

    function paperGrid(group, width, height, scale) {
        const step = Math.max(34, 44 * scale);
        const grid = group.append("g").attr("class", "kernel-atlas-grid").attr("pointer-events", "none");
        for (let x = step; x < width; x += step) {
            grid.append("line")
                .attr("x1", x).attr("y1", 0).attr("x2", x).attr("y2", height)
                .attr("stroke", FAINT).attr("stroke-width", 0.45).attr("stroke-dasharray", "1 7");
        }
        for (let y = step; y < height; y += step) {
            grid.append("line")
                .attr("x1", 0).attr("y1", y).attr("x2", width).attr("y2", y)
                .attr("stroke", FAINT).attr("stroke-width", 0.45).attr("stroke-dasharray", "1 7");
        }
    }

    function darkTab(group, x, y, width, height, label, onClick) {
        const tab = group.append("g")
            .attr("class", "kernel-atlas-tab")
            .style("cursor", "pointer")
            .on("click", (event) => {
                event.stopPropagation();
                onClick();
            });
        tab.append("path")
            .attr("d", `M${x + 7},${y} H${x + width - 7} L${x + width},${y + 7} V${y + height} H${x} V${y + 7} Z`)
            .attr("fill", INK).attr("stroke", "rgba(23,26,28,0.72)").attr("stroke-width", 0.7);
        tab.append("text")
            .attr("x", x + width / 2).attr("y", y + height / 2 + 3)
            .attr("text-anchor", "middle").attr("fill", PAPER)
            .attr("font-family", "Share Tech Mono, monospace").attr("font-size", 7)
            .attr("letter-spacing", 0.8).text(label);
    }

    function currentGateValue(id) {
        const frame = state.syscallHistory[state.syscallHistory.length - 1];
        return frame && frame.values ? frame.values.find((value) => value.id === id) : null;
    }

    function gateHistory(id) {
        return state.syscallHistory.map((frame) => ({
            partial: frame.partial,
            value: frame.values.find((entry) => entry.id === id)
        }));
    }

    function drawExecutionTrail(group, geometry, stale) {
        const { cx, cy, scale } = geometry;
        const radiusX = 58 * scale;
        const radiusY = 35 * scale;
        const axes = group.append("g").attr("class", "kernel-atlas-context-axes");
        ["USR", "SYS", "PROC", "SIRQ", "IRQ"].forEach((label, index) => {
            const angle = -Math.PI / 2 + index * Math.PI * 2 / 5;
            const x2 = cx + Math.cos(angle) * radiusX;
            const y2 = cy + Math.sin(angle) * radiusY;
            axes.append("line")
                .attr("x1", cx).attr("y1", cy).attr("x2", x2).attr("y2", y2)
                .attr("stroke", FAINT).attr("stroke-width", 0.7);
            axes.append("text")
                .attr("x", cx + Math.cos(angle) * radiusX * 1.22)
                .attr("y", cy + Math.sin(angle) * radiusY * 1.22 + 2)
                .attr("text-anchor", "middle").attr("fill", GRAPHITE)
                .attr("font-family", "Share Tech Mono, monospace")
                .attr("font-size", Math.max(5, 6 * scale)).text(label);
        });

        const points = state.executionHistory.map((frame) =>
            projectExecution(frame, cx, cy, radiusX, radiusY)
        );
        const trail = group.append("g")
            .attr("class", "kernel-atlas-execution-trail")
            .attr("aria-label", "Context projection from the last eight execution samples, not an instruction pointer");
        for (let index = 1; index < points.length; index += 1) {
            const opacity = 0.08 + index / Math.max(1, points.length - 1) * 0.54;
            trail.append("line")
                .attr("class", "kernel-atlas-execution-trace")
                .attr("data-age", points.length - index)
                .attr("x1", points[index - 1].x).attr("y1", points[index - 1].y)
                .attr("x2", points[index].x).attr("y2", points[index].y)
                .attr("stroke", stale ? UNKNOWN : ACCENT)
                .attr("stroke-width", 0.8 + index * 0.1)
                .attr("stroke-opacity", opacity)
                .attr("stroke-dasharray", stale ? "2 3" : null);
        }
        points.forEach((point, index) => {
            const newest = index === points.length - 1;
            const age = points.length - index;
            trail.append("circle")
                .attr("class", "kernel-atlas-execution-point")
                .attr("data-age", age)
                .attr("cx", point.x).attr("cy", point.y)
                .attr("r", newest ? 3.2 * scale : Math.max(2, (1.8 + age * 1.15) * scale))
                .attr("fill", newest && !stale ? AMBER : "none")
                .attr("stroke", stale ? UNKNOWN : ACCENT)
                .attr("stroke-width", newest ? 1.1 : 0.6)
                .attr("opacity", newest ? 1 : 0.1 + index / Math.max(1, points.length) * 0.38);
        });
        trail.append("title").text(
            stale
                ? "EXECUTION TELEMETRY STALE · HISTORY FROZEN"
                : "LAST 8 EXECUTION SAMPLES PROJECTED FROM USR, SYS, PROC, SIRQ AND IRQ ACTIVITY"
        );
    }

    function drawSector(group, gate, geometry, syscallStale) {
        const { cx, cy, rx, ry, scale, stationWidth, stationHeight } = geometry;
        const x = cx + Math.cos(gate.angle) * rx * 0.59;
        const y = cy + Math.sin(gate.angle) * ry * 0.63;
        const gateX = cx + Math.cos(gate.angle) * rx * 0.79;
        const gateY = cy + Math.sin(gate.angle) * ry * 0.79;
        const selected = state.selected === gate.id;
        const current = currentGateValue(gate.id);
        const active = Boolean(current && current.known && current.count > 0 && !syscallStale);
        const partial = Boolean(current && current.partial);

        const connection = group.append("g").attr("class", `kernel-atlas-sector-link atlas-${gate.id}`);
        connection.append("path")
            .attr("d", `M${cx},${cy} Q${cx + Math.cos(gate.angle) * rx * 0.28},${cy + Math.sin(gate.angle) * ry * 0.12} ${x},${y}`)
            .attr("fill", "none").attr("stroke", selected ? ACCENT : GRAPHITE)
            .attr("stroke-width", selected ? 1.35 : 0.7)
            .attr("stroke-dasharray", selected ? null : "2 5");

        gateHistory(gate.id).forEach((frame, index, frames) => {
            const value = frame.value;
            if (!value || !value.known || value.count <= 0) return;
            const intensity = Math.min(1, Math.log1p(value.count) / Math.log(16));
            const age = frames.length - index;
            group.append("ellipse")
                .attr("class", "kernel-atlas-syscall-afterimage")
                .attr("data-subsystem", gate.id).attr("data-age", age)
                .attr("cx", x).attr("cy", y)
                .attr("rx", stationWidth / 2 + (3 + intensity * 9 + age * 0.9) * scale)
                .attr("ry", stationHeight / 2 + (2 + intensity * 5 + age * 0.55) * scale)
                .attr("fill", "none")
                .attr("stroke", frame.partial ? UNKNOWN : ACCENT)
                .attr("stroke-width", 0.55)
                .attr("stroke-dasharray", frame.partial ? "2 2" : null)
                .attr("opacity", 0.07 + (index + 1) / Math.max(1, frames.length) * 0.23);
        });

        const gateGroup = group.append("g")
            .attr("class", `kernel-atlas-gate kernel-atlas-gate-${gate.id}`);
        const gateSize = 8 * scale;
        gateGroup.append("path")
            .attr("d", `M${gateX},${gateY - gateSize} L${gateX + gateSize},${gateY} L${gateX},${gateY + gateSize} L${gateX - gateSize},${gateY} Z`)
            .attr("fill", active ? AMBER : PAPER)
            .attr("stroke", syscallStale ? UNKNOWN : (active ? ACCENT : GRAPHITE))
            .attr("stroke-width", active ? 1.3 : 0.7)
            .attr("stroke-dasharray", syscallStale || partial ? "2 2" : null);
        const parkedDots = Math.min(5, current ? Math.max(0, finite(current.count, 0)) : 0);
        for (let index = 0; index < parkedDots; index += 1) {
            const tangentX = -Math.sin(gate.angle);
            const tangentY = Math.cos(gate.angle);
            gateGroup.append("rect")
                .attr("x", gateX + tangentX * (index - (parkedDots - 1) / 2) * 5 * scale - 1.2)
                .attr("y", gateY + tangentY * (index - (parkedDots - 1) / 2) * 5 * scale - 1.2)
                .attr("width", 2.4).attr("height", 2.4)
                .attr("fill", active ? ACCENT : GRAPHITE);
        }

        const sector = group.append("g")
            .attr("class", `kernel-atlas-sector kernel-atlas-sector-${gate.id}`)
            .attr("data-subsystem", gate.id)
            .attr("role", "button").attr("tabindex", 0)
            .style("cursor", "pointer")
            .on("click", (event) => {
                event.stopPropagation();
                state.selected = gate.id;
                render();
            })
            .on("keydown", (event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                state.selected = gate.id;
                render();
            });
        const left = x - stationWidth / 2;
        const top = y - stationHeight / 2;
        sector.append("path")
            .attr("class", "kernel-atlas-sector-shell")
            .attr("d", `M${left + 8 * scale},${top} H${left + stationWidth - 9 * scale} L${left + stationWidth},${top + 9 * scale} V${top + stationHeight} H${left} V${top + 8 * scale} Z`)
            .attr("fill", selected ? INK : "rgba(232,231,222,0.88)")
            .attr("stroke", selected || active ? ACCENT : GRAPHITE)
            .attr("stroke-width", selected ? 1.5 : 0.8);
        sector.append("text")
            .attr("x", x).attr("y", y - 8 * scale).attr("text-anchor", "middle")
            .attr("fill", selected ? AMBER : INK)
            .attr("font-family", "Share Tech Mono, monospace")
            .attr("font-size", Math.max(6, 7.2 * scale)).attr("letter-spacing", 0.6)
            .text(gate.label);
        sector.append("text")
            .attr("x", x).attr("y", y + 6 * scale).attr("text-anchor", "middle")
            .attr("fill", active ? (selected ? PAPER : ACCENT) : (syscallStale ? UNKNOWN : GRAPHITE))
            .attr("font-family", "Share Tech Mono, monospace")
            .attr("font-size", Math.max(6, 7.5 * scale))
            .text(active && current.syscall
                ? `${clip(current.syscall.name.toUpperCase(), 11)} · ${current.count}`
                : (syscallStale ? "STALE" : "0 PARKED"));
        sector.append("text")
            .attr("x", x).attr("y", y + 18 * scale).attr("text-anchor", "middle")
            .attr("fill", selected ? "rgba(232,231,222,0.62)" : GRAPHITE)
            .attr("font-family", "Share Tech Mono, monospace")
            .attr("font-size", Math.max(5, 5.5 * scale))
            .text(partial ? "BACKEND ONLY" : `${state.syscallHistory.length}/8 SNAPSHOTS`);
        sector.append("title").text(
            `${gate.label} · ${current ? current.count : 0} THREADS PARKED AT SNAPSHOT TIME`
        );
    }

    function drawSelectedReadout(group, geometry) {
        const { width, height, scale } = geometry;
        const gate = GATES.find((entry) => entry.id === state.selected) || GATES[0];
        const history = gateHistory(gate.id);
        const current = currentGateValue(gate.id);
        const counts = history.map((frame) => frame.value ? frame.value.count : 0);
        const panelWidth = Math.min(520 * scale, width - 40);
        const x = (width - panelWidth) / 2;
        const y = height - Math.max(66, 72 * scale);
        group.append("path")
            .attr("d", `M${x + 9},${y} H${x + panelWidth - 9} L${x + panelWidth},${y + 9} V${y + 48} H${x} V${y + 9} Z`)
            .attr("fill", "rgba(23,26,28,0.94)").attr("stroke", GRAPHITE).attr("stroke-width", 0.8);
        group.append("text")
            .attr("x", x + 14).attr("y", y + 17)
            .attr("fill", AMBER).attr("font-family", "Share Tech Mono, monospace")
            .attr("font-size", 7).attr("letter-spacing", 0.8)
            .text(`${gate.label} / PARKED-SYSCALL HISTORY`);
        group.append("text")
            .attr("x", x + 14).attr("y", y + 34)
            .attr("fill", PAPER).attr("font-family", "Share Tech Mono, monospace")
            .attr("font-size", 8)
            .text(`OLDEST  ${counts.length ? counts.join("  ·  ") : "WAITING FOR SNAPSHOTS"}  NEWEST`);
        group.append("text")
            .attr("x", x + panelWidth - 14).attr("y", y + 17).attr("text-anchor", "end")
            .attr("fill", "rgba(232,231,222,0.56)")
            .attr("font-family", "Share Tech Mono, monospace").attr("font-size", 6)
            .text(current && current.syscall ? clip(current.syscall.name.toUpperCase(), 18) : "NO PARKED CALL");
    }

    function render() {
        if (!ENABLED || !state.mounted || !state.width || !state.height) return;
        const root = d3.select("svg");
        root.selectAll(".kernel-atlas-poc").remove();
        const width = state.width;
        const height = state.height;
        const scale = Math.max(0.46, Math.min(1.15, (width - 48) / 850, (height - 70) / 650));
        const cx = width / 2;
        const cy = Math.max(210 * scale, height / 2 - 10);
        const rx = 310 * scale;
        const ry = 180 * scale;
        const geometry = {
            width, height, scale, cx, cy, rx, ry,
            stationWidth: 145 * scale,
            stationHeight: 62 * scale
        };
        const executionStale = state.executionObservedAt > 0 &&
            Date.now() - state.executionObservedAt > EXEC_STALE_MS;
        const syscallStale = state.syscallObservedAt > 0 &&
            Date.now() - state.syscallObservedAt > SYSCALL_STALE_MS;

        const group = root.append("g")
            .attr("class", "kernel-atlas-poc")
            .attr("aria-label", "Geometric Linux kernel atlas proof of concept");
        group.append("rect")
            .attr("width", width).attr("height", height).attr("fill", PAPER);
        paperGrid(group, width, height, scale);

        group.append("text")
            .attr("x", 24).attr("y", 31)
            .attr("fill", INK).attr("font-family", "Share Tech Mono, monospace")
            .attr("font-size", 14).attr("letter-spacing", 2)
            .text("KERNEL ATLAS / GEOMETRIC POC");
        group.append("text")
            .attr("x", 25).attr("y", 48)
            .attr("fill", GRAPHITE).attr("font-family", "Share Tech Mono, monospace")
            .attr("font-size", 7).attr("letter-spacing", 0.6)
            .text("RADIUS = PRIVILEGE DEPTH · ANGLE = SUBSYSTEM · TRAILS = LAST 8 TELEMETRY SNAPSHOTS");
        darkTab(group, width - 218, 18, 96, 25, "CLEAR TRAILS", () => {
            state.executionHistory = [];
            state.syscallHistory = [];
            render();
        });
        darkTab(group, width - 112, 18, 88, 25, "BACK / MAIN", () => {
            window.location.href = window.location.pathname;
        });

        const station = group.append("g").attr("class", "kernel-atlas-station");
        station.append("ellipse")
            .attr("cx", cx).attr("cy", cy + ry * 0.78)
            .attr("rx", rx * 0.88).attr("ry", ry * 0.34)
            .attr("fill", "none").attr("stroke", GRAPHITE)
            .attr("stroke-width", 0.7).attr("stroke-dasharray", "3 6");
        station.append("text")
            .attr("x", cx).attr("y", cy + ry * 1.08).attr("text-anchor", "middle")
            .attr("fill", GRAPHITE).attr("font-family", "Share Tech Mono, monospace")
            .attr("font-size", Math.max(6, 7 * scale)).attr("letter-spacing", 1)
            .text("DRIVERS / HARDWARE DOCKS");

        station.append("ellipse")
            .attr("cx", cx).attr("cy", cy).attr("rx", rx).attr("ry", ry)
            .attr("fill", "rgba(255,255,250,0.28)").attr("stroke", INK)
            .attr("stroke-width", 1.1);
        station.append("ellipse")
            .attr("cx", cx).attr("cy", cy).attr("rx", rx * 0.79).attr("ry", ry * 0.79)
            .attr("fill", "none").attr("stroke", ACCENT)
            .attr("stroke-width", 0.8).attr("stroke-dasharray", "2 5");
        station.append("text")
            .attr("x", cx).attr("y", cy - ry - 10 * scale).attr("text-anchor", "middle")
            .attr("fill", INK).attr("font-family", "Share Tech Mono, monospace")
            .attr("font-size", Math.max(6, 7 * scale)).attr("letter-spacing", 1)
            .text("RING 3 / PROCESS ORBIT");
        station.append("text")
            .attr("x", cx).attr("y", cy - ry * 0.79 - 7 * scale).attr("text-anchor", "middle")
            .attr("fill", ACCENT).attr("font-family", "Share Tech Mono, monospace")
            .attr("font-size", Math.max(5, 6 * scale)).attr("letter-spacing", 0.8)
            .text("SYSTEM CALL GATE");

        GATES.forEach((gate) => drawSector(station, gate, geometry, syscallStale));

        const core = station.append("g")
            .attr("class", "kernel-atlas-execution-well")
            .style("cursor", "pointer")
            .on("click", (event) => {
                event.stopPropagation();
                state.selected = "sched";
                render();
            });
        core.append("ellipse")
            .attr("cx", cx).attr("cy", cy).attr("rx", 86 * scale).attr("ry", 54 * scale)
            .attr("fill", INK).attr("stroke", executionStale ? UNKNOWN : ACCENT)
            .attr("stroke-width", 1.4)
            .attr("stroke-dasharray", executionStale ? "2 3" : null);
        core.append("ellipse")
            .attr("cx", cx).attr("cy", cy).attr("rx", 74 * scale).attr("ry", 44 * scale)
            .attr("fill", "none").attr("stroke", "rgba(232,231,222,0.2)")
            .attr("stroke-width", 0.7);
        drawExecutionTrail(core, geometry, executionStale);
        core.append("text")
            .attr("x", cx).attr("y", cy + 68 * scale).attr("text-anchor", "middle")
            .attr("fill", INK).attr("font-family", "Share Tech Mono, monospace")
            .attr("font-size", Math.max(6, 7 * scale)).attr("letter-spacing", 0.8)
            .text("CPU EXECUTION WELL");
        core.append("text")
            .attr("x", cx).attr("y", cy + 79 * scale).attr("text-anchor", "middle")
            .attr("fill", executionStale ? UNKNOWN : GRAPHITE)
            .attr("font-family", "Share Tech Mono, monospace")
            .attr("font-size", Math.max(5, 5.5 * scale))
            .text(`CONTEXT PROJECTION · ${state.executionHistory.length}/8 · NOT AN INSTRUCTION POINTER`);

        drawSelectedReadout(group, geometry);

        group.append("text")
            .attr("x", 25).attr("y", height - 23)
            .attr("fill", GRAPHITE).attr("font-family", "Share Tech Mono, monospace")
            .attr("font-size", 6.5)
            .text(
                `EXEC ${executionStale ? "STALE" : (state.executionHistory.length ? "LIVE" : "WAITING")} · ` +
                `SYSCALL ${syscallStale ? "STALE" : (state.syscallHistory.length ? "LIVE" : "WAITING")} · ` +
                "PARKED TASKS ARE SNAPSHOTS, NOT ENTRY EVENTS"
            );
    }

    function mount(width, height) {
        if (!ENABLED) return;
        state.width = finite(width, window.innerWidth);
        state.height = finite(height, window.innerHeight);
        state.mounted = true;
        d3.select("svg").attr("viewBox", null).attr("preserveAspectRatio", null);
        render();
    }

    function destroy() {
        state.mounted = false;
        d3.select("svg").selectAll(".kernel-atlas-poc").remove();
    }

    if (ENABLED) {
        document.body.classList.add("kernel-atlas-poc-mode");
        const style = document.createElement("style");
        style.id = "kernel-atlas-poc-style";
        style.textContent = `
            body.kernel-atlas-poc-mode #kernel-tape,
            body.kernel-atlas-poc-mode #kernel-tape-toggle,
            body.kernel-atlas-poc-mode #kernel-event-inspector,
            body.kernel-atlas-poc-mode #mobile-hud,
            body.kernel-atlas-poc-mode #mobile-notice { display: none !important; }
        `;
        document.head.appendChild(style);
        window.addEventListener("kernel-telemetry", (event) => {
            const detail = event.detail || {};
            if (detail.kind === "execution" && detail.data) ingestExecution(detail.data, detail.observedAt);
            if (detail.kind === "syscalls" && detail.data) ingestSyscalls(detail.data, detail.observedAt);
        });
        window.setInterval(() => {
            if (state.mounted) render();
        }, 1500);
    }

    window.KernelAtlasPoc = {
        isEnabled: () => ENABLED,
        mount,
        destroy,
        ingestExecution,
        ingestSyscalls,
        projectExecution,
        historySizes: () => ({
            execution: state.executionHistory.length,
            syscalls: state.syscallHistory.length
        })
    };
})();
