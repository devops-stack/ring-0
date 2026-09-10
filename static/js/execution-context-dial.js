// Execution Context Dial inside the central Ring-0 circle.
//
// The execution endpoint does not expose a CPU's current instruction pointer.
// It observes parked syscalls and machine-wide IRQ deltas, so the five segments
// are independent activity indicators rather than an invented single "current
// context".  The module consumes Ring-1 telemetry and adds no HTTP polling.
(function initExecutionContextDial() {
    if (window.ExecutionContextDial) return;

    const INNER = 42.5;
    const OUTER_MIN = 49;
    const OUTER_MAX = 54;
    const GAP = 0.055;
    const STALE_MS = 3500;
    const ACCENT = "#e2a33e";
    const UNKNOWN = "rgba(103,200,224,0.62)";
    const DIM = "rgba(244,244,236,0.18)";
    const LABEL_DIM = "rgba(244,244,236,0.32)";
    const SEGMENTS = [
        { id: "user", label: "USR" },
        { id: "syscall", label: "SYS" },
        { id: "process", label: "PROC" },
        { id: "softirq", label: "SIRQ" },
        { id: "hardirq", label: "IRQ" }
    ];

    const state = {
        centerX: null,
        centerY: null,
        data: null,
        observedAt: 0,
        rateSamples: 0
    };

    function finite(value, fallback) {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function polar(cx, cy, radius, angle) {
        return {
            x: cx + Math.cos(angle) * radius,
            y: cy + Math.sin(angle) * radius
        };
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

    function rateIntensity(rate) {
        const value = Math.max(0, finite(rate, 0));
        if (value === 0) return 0.08;
        return Math.min(1, 0.24 + Math.log1p(value) / Math.log(1001));
    }

    function derive(data, rateSamples, stale) {
        if (!data || stale) {
            return SEGMENTS.map((segment) => ({
                ...segment,
                known: false,
                active: false,
                intensity: 0.08,
                detail: stale ? "TELEMETRY STALE" : "WAITING FOR TELEMETRY"
            }));
        }
        const summary = (data.irq_stack && data.irq_stack.summary) || {};
        const syscallActive = data.syscall_active === true;
        const kernelMode = data.mode === "kernel";
        const ratesReady = rateSamples >= 2;
        const hardRate = Math.max(0, finite(summary.hard_total_per_sec, 0));
        const softRate = Math.max(0, finite(summary.soft_total_per_sec, 0));
        const activeCount = Array.isArray(data.active_syscalls) ? data.active_syscalls.length : 0;
        return [
            {
                id: "user", label: "USR", known: true,
                active: data.mode === "user" && !syscallActive,
                intensity: data.mode === "user" && !syscallActive ? 0.62 : 0.08,
                detail: data.mode === "user"
                    ? "NO PARKED SYSCALL IN THE SAMPLED PROCESS SET"
                    : "SAMPLED PROCESS SET IN KERNEL MODE",
                inferred: true
            },
            {
                id: "syscall", label: "SYS", known: true,
                active: syscallActive,
                intensity: syscallActive ? Math.min(1, 0.62 + activeCount * 0.05) : 0.08,
                detail: syscallActive
                    ? `${activeCount || 1} PARKED · ${String(data.syscall_name || "SYSCALL").toUpperCase()}`
                    : "NO PARKED SYSCALL OBSERVED"
            },
            {
                id: "process", label: "PROC", known: true,
                active: kernelMode,
                intensity: kernelMode ? 0.58 : 0.08,
                detail: kernelMode ? "PROCESS CONTEXT SAMPLED IN KERNEL" : "KERNEL PROCESS CONTEXT NOT SAMPLED",
                inferred: true
            },
            {
                id: "softirq", label: "SIRQ", known: ratesReady,
                active: ratesReady && softRate > 0,
                intensity: ratesReady ? rateIntensity(softRate) : 0.08,
                detail: ratesReady ? `${softRate.toFixed(1)} SOFTIRQ/S` : "RATE WARMING"
            },
            {
                id: "hardirq", label: "IRQ", known: ratesReady,
                active: ratesReady && hardRate > 0,
                intensity: ratesReady ? rateIntensity(hardRate) : 0.08,
                detail: ratesReady ? `${hardRate.toFixed(1)} HARD IRQ/S` : "RATE WARMING"
            }
        ];
    }

    function segmentAngles(index) {
        const step = (Math.PI * 2) / SEGMENTS.length;
        const start = -Math.PI / 2 + index * step + GAP;
        const end = -Math.PI / 2 + (index + 1) * step - GAP;
        return { start, end, mid: (start + end) / 2 };
    }

    function mount(centerX, centerY) {
        state.centerX = Number(centerX);
        state.centerY = Number(centerY);
        const root = d3.select("svg");
        root.selectAll(".execution-context-dial").remove();
        const group = root.append("g")
            .attr("class", "execution-context-dial")
            .attr("pointer-events", "none")
            .attr("aria-label", "Execution context activity dial");

        SEGMENTS.forEach((segment, index) => {
            const angles = segmentAngles(index);
            const item = group.append("g")
                .attr("class", `execution-context-segment execution-context-${segment.id}`)
                .attr("data-context", segment.id);
            item.append("path")
                .attr("class", "execution-context-wedge")
                .attr("d", arcPath(state.centerX, state.centerY, INNER, OUTER_MIN, angles.start, angles.end))
                .attr("fill", "rgba(103,200,224,0.025)")
                .attr("stroke", UNKNOWN)
                .attr("stroke-width", 0.6)
                .attr("stroke-dasharray", "1.5 2.5");

            const labelAt = polar(state.centerX, state.centerY, 47.2, angles.mid);
            const rotation = angles.mid * 180 / Math.PI + 90;
            item.append("text")
                .attr("class", "execution-context-label")
                .attr("x", labelAt.x)
                .attr("y", labelAt.y + 1.7)
                .attr("text-anchor", "middle")
                .attr("transform", `rotate(${rotation} ${labelAt.x} ${labelAt.y})`)
                .attr("fill", UNKNOWN)
                .attr("font-family", "Share Tech Mono, monospace")
                .attr("font-size", 4.6)
                .attr("letter-spacing", 0.45)
                .text(segment.label);

            const pinAt = polar(state.centerX, state.centerY, 40.3, angles.mid);
            item.append("circle")
                .attr("class", "execution-context-pin")
                .attr("cx", pinAt.x).attr("cy", pinAt.y).attr("r", 1.15)
                .attr("fill", UNKNOWN);
            item.append("title").text("WAITING FOR EXECUTION TELEMETRY");
        });
        paint();
    }

    function paint() {
        if (!Number.isFinite(state.centerX) || !Number.isFinite(state.centerY)) return;
        const stale = state.observedAt > 0 && Date.now() - state.observedAt > STALE_MS;
        const values = derive(state.data, state.rateSamples, stale);
        const root = d3.select("svg");
        const group = root.select(".execution-context-dial");
        if (group.empty()) return;

        values.forEach((value, index) => {
            const angles = segmentAngles(index);
            const item = group.select(`.execution-context-${value.id}`);
            const outer = value.known
                ? OUTER_MIN + (OUTER_MAX - OUTER_MIN) * value.intensity
                : OUTER_MIN;
            const fill = value.known && value.active
                ? `rgba(226,163,62,${(0.08 + value.intensity * 0.28).toFixed(3)})`
                : (value.known ? "rgba(244,244,236,0.018)" : "rgba(103,200,224,0.025)");
            const stroke = value.known && value.active ? ACCENT : (value.known ? DIM : UNKNOWN);
            item.select(".execution-context-wedge")
                .interrupt()
                .transition().duration(260)
                .attr("d", arcPath(state.centerX, state.centerY, INNER, outer, angles.start, angles.end))
                .attr("fill", fill)
                .attr("stroke", stroke)
                .attr("stroke-width", value.active ? 0.95 : 0.55)
                .attr("stroke-dasharray", value.known ? (value.inferred ? "1 2" : null) : "1.5 2.5");
            item.select(".execution-context-label")
                .attr("fill", value.known && value.active ? ACCENT : (value.known ? LABEL_DIM : UNKNOWN));
            item.select(".execution-context-pin")
                .attr("fill", value.known && value.active ? ACCENT : (value.known ? DIM : UNKNOWN))
                .attr("r", value.active ? 1.65 : 1.05);
            item.select("title").text(value.detail);
        });
    }

    function ingest(data, observedAt) {
        if (!data) return;
        state.data = data;
        state.observedAt = finite(observedAt, Date.now());
        state.rateSamples += 1;
        paint();
    }

    function destroy() {
        d3.select("svg").selectAll(".execution-context-dial").remove();
        state.centerX = null;
        state.centerY = null;
    }

    window.addEventListener("kernel-telemetry", (event) => {
        const detail = event.detail || {};
        if (detail.kind === "execution" && detail.data) ingest(detail.data, detail.observedAt);
    });
    window.setInterval(() => {
        if (state.observedAt && Date.now() - state.observedAt > STALE_MS) paint();
    }, 1500);

    window.ExecutionContextDial = {
        mount,
        ingest,
        destroy,
        derive,
        arcPath
    };
})();
