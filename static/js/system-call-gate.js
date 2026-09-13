// System Call Gate between the central Ring-0 circle and Ring-1.
//
// The existing syscall feed is a snapshot of threads parked in syscalls, not a
// trace of entry instructions.  The fixed gates are architectural; amber means
// that a real parked call for that subsystem was present in the latest sample.
(function initSystemCallGate() {
    if (window.SystemCallGate) return;

    const INNER = 58.5;
    const OUTER = 65;
    const LABEL_RADIUS = 69;
    const STALE_MS = 6500;
    const ACCENT = "#e2a33e";
    const UNKNOWN = "rgba(103,200,224,0.62)";
    const DIM = "rgba(244,244,236,0.16)";
    const GATES = [
        { id: "sched", label: "SCHED" },
        { id: "net", label: "NET" },
        { id: "fs", label: "FS" },
        { id: "mm", label: "MM" },
        { id: "kernel", label: "CORE" }
    ];
    const state = { centerX: null, centerY: null, data: null, observedAt: 0 };

    function finite(value, fallback) {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function polar(cx, cy, radius, angle) {
        return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
    }

    function arcPath(cx, cy, inner, outer, start, end) {
        const a = polar(cx, cy, outer, start);
        const b = polar(cx, cy, outer, end);
        const c = polar(cx, cy, inner, end);
        const d = polar(cx, cy, inner, start);
        return [
            `M${a.x.toFixed(3)},${a.y.toFixed(3)}`,
            `A${outer},${outer} 0 0 1 ${b.x.toFixed(3)},${b.y.toFixed(3)}`,
            `L${c.x.toFixed(3)},${c.y.toFixed(3)}`,
            `A${inner},${inner} 0 0 0 ${d.x.toFixed(3)},${d.y.toFixed(3)}`,
            "Z"
        ].join(" ");
    }

    function normalizedSubsystem(value) {
        const key = String(value || "kernel").toLowerCase();
        if (["sched", "net", "fs", "mm"].includes(key)) return key;
        return "kernel";
    }

    function derive(data, stale) {
        const rowsGiven = Boolean(data && Array.isArray(data.syscalls));
        const partial = Boolean(data && data.sample && data.sample.scope === "self");
        const result = new Map(GATES.map((gate) => [gate.id, {
            ...gate,
            known: rowsGiven && !stale,
            partial,
            count: 0,
            syscall: null,
            listed: 0
        }]));
        if (!rowsGiven || stale) return [...result.values()];

        data.syscalls.forEach((row) => {
            const name = String((row && row.name) || "");
            if (!name || /^(vm|disk|net):/.test(name)) return;
            const key = normalizedSubsystem(row.subsystem);
            const gate = result.get(key);
            const count = Math.max(0, finite(row.count, 0));
            gate.count += count;
            gate.listed += Array.isArray(row.waiters) ? row.waiters.length : 0;
            if (!gate.syscall || count > gate.syscall.count) {
                gate.syscall = { name, count };
            }
        });
        return [...result.values()];
    }

    function gateAngles(index) {
        const step = (Math.PI * 2) / GATES.length;
        const mid = -Math.PI / 2 + index * step;
        return { start: mid - 0.22, end: mid + 0.22, mid };
    }

    function mount(centerX, centerY) {
        state.centerX = Number(centerX);
        state.centerY = Number(centerY);
        const root = d3.select("svg");
        root.selectAll(".system-call-gate").remove();
        const group = root.append("g")
            .attr("class", "system-call-gate")
            .attr("pointer-events", "none")
            .attr("aria-label", "System call subsystem gates");

        GATES.forEach((gate, index) => {
            const angles = gateAngles(index);
            const item = group.append("g")
                .attr("class", `system-call-gate-item system-call-gate-${gate.id}`);
            item.append("path")
                .attr("class", "system-call-gate-door")
                .attr("d", arcPath(state.centerX, state.centerY, INNER, OUTER, angles.start, angles.end))
                .attr("fill", "rgba(103,200,224,0.02)")
                .attr("stroke", UNKNOWN)
                .attr("stroke-width", 0.7)
                .attr("stroke-dasharray", "1.5 2.5");

            [angles.start, angles.end].forEach((angle) => {
                const inside = polar(state.centerX, state.centerY, INNER - 1.5, angle);
                const outside = polar(state.centerX, state.centerY, OUTER + 1.5, angle);
                item.append("line")
                    .attr("class", "system-call-gate-post")
                    .attr("x1", inside.x).attr("y1", inside.y)
                    .attr("x2", outside.x).attr("y2", outside.y)
                    .attr("stroke", UNKNOWN).attr("stroke-width", 0.55);
            });

            const axle = polar(state.centerX, state.centerY, INNER - 2.5, angles.mid);
            item.append("circle")
                .attr("class", "system-call-gate-axle")
                .attr("cx", axle.x).attr("cy", axle.y).attr("r", 1.25)
                .attr("fill", UNKNOWN);

            const labelAt = polar(state.centerX, state.centerY, LABEL_RADIUS, angles.mid);
            item.append("text")
                .attr("class", "system-call-gate-label")
                .attr("x", labelAt.x).attr("y", labelAt.y + 1.7)
                .attr("text-anchor", "middle")
                .attr("transform", `rotate(${angles.mid * 180 / Math.PI + 90} ${labelAt.x} ${labelAt.y})`)
                .attr("fill", UNKNOWN)
                .attr("font-family", "Share Tech Mono, monospace")
                .attr("font-size", 4.6)
                .attr("letter-spacing", 0.35)
                .text(gate.label);
            item.append("title").text("WAITING FOR PARKED SYSCALL SNAPSHOT");
        });
        paint();
    }

    function paint() {
        if (!Number.isFinite(state.centerX) || !Number.isFinite(state.centerY)) return;
        const stale = state.observedAt > 0 && Date.now() - state.observedAt > STALE_MS;
        const values = derive(state.data, stale);
        const group = d3.select("svg").select(".system-call-gate");
        if (group.empty()) return;

        values.forEach((value) => {
            const item = group.select(`.system-call-gate-${value.id}`);
            const active = value.known && value.count > 0;
            const stroke = active ? ACCENT : (value.known ? DIM : UNKNOWN);
            item.select(".system-call-gate-door")
                .interrupt().transition().duration(260)
                .attr("fill", active
                    ? `rgba(226,163,62,${Math.min(0.34, 0.08 + Math.log1p(value.count) * 0.055).toFixed(3)})`
                    : (value.known ? "rgba(244,244,236,0.012)" : "rgba(103,200,224,0.02)"))
                .attr("stroke", stroke)
                .attr("stroke-width", active ? 1.05 : 0.55)
                .attr("stroke-dasharray", value.known ? (value.partial ? "2 2" : null) : "1.5 2.5");
            item.selectAll(".system-call-gate-post")
                .attr("stroke", stroke)
                .attr("stroke-width", active ? 0.9 : 0.5);
            item.select(".system-call-gate-axle")
                .attr("fill", stroke).attr("r", active ? 1.75 : 1.05);
            item.select(".system-call-gate-label")
                .attr("fill", active ? ACCENT : (value.known ? "rgba(244,244,236,0.28)" : UNKNOWN))
                .text(active && value.syscall
                    ? String(value.syscall.name).toUpperCase().slice(0, 8)
                    : value.label);
            const coverage = value.partial ? " · BACKEND ONLY" : "";
            const hidden = Math.max(0, value.count - value.listed);
            item.select("title").text(active && value.syscall
                ? `${value.label} · ${value.count} PARKED · ${value.syscall.name}${hidden ? ` · ${hidden} NOT LISTED` : ""}${coverage}`
                : `${value.label} · ${value.known ? "0 PARKED" : (stale ? "STALE" : "WAITING")}${coverage}`);
        });
    }

    function ingest(data, observedAt) {
        if (!data) return;
        state.data = data;
        state.observedAt = finite(observedAt, Date.now());
        paint();
    }

    function destroy() {
        d3.select("svg").selectAll(".system-call-gate").remove();
        state.centerX = null;
        state.centerY = null;
    }

    window.addEventListener("kernel-telemetry", (event) => {
        const detail = event.detail || {};
        if (detail.kind === "syscalls" && detail.data) ingest(detail.data, detail.observedAt);
    });
    window.setInterval(() => {
        if (state.observedAt && Date.now() - state.observedAt > STALE_MS) paint();
    }, 2000);

    window.SystemCallGate = { mount, ingest, destroy, derive, arcPath };
})();
