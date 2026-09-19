// What the scheduler bar opens: who woke whom, over one sampled window.
//
// Every other card in this project shows a state that was simply there to be
// read. This one shows events that no longer exist by the time they are drawn,
// caught by a tracepoint for a quarter of a second at a time. That difference
// is the card's main honesty problem, so the window, its length and the gap
// between windows are said plainly rather than dressed up as a live feed.
const WakeupsCard = (() => {
    const W = 620;
    const PAD = 14;
    const CUT = 15;
    const HEADER = 25;
    const LINE = 14;
    const ROW_STEP = 16;
    const FOOTER = 34;
    const MAX_ROWS = 10;

    const COL_WOKEN = 220;
    const TIMES_INSET = 62;

    let isOpen = false;
    let topKeeper = null;
    let requestSeq = 0;
    let selectedTaskTid = null;
    let wakeEvidenceExpanded = false;

    const CONTEXT_TAG = { task: "task", softirq: "softirq", hardirq: "irq" };

    function clip(text, max) {
        const value = String(text || "");
        return value.length > max ? `${value.slice(0, max - 1)}…` : value;
    }

    function close() {
        isOpen = false;
        requestSeq += 1;
        selectedTaskTid = null;
        wakeEvidenceExpanded = false;
        svg.selectAll(".wakeups-card-scrim, .wakeups-card-layer").remove();
        if (topKeeper) topKeeper.stop();
        d3.select("body").on("keydown.wakeupscard", null);
        window.dispatchEvent(new CustomEvent("kcard-closed"));
    }

    function open(anchor) {
        if (isOpen) {
            close();
            return;
        }
        isOpen = true;
        selectedTaskTid = null;
        wakeEvidenceExpanded = false;
        const seq = ++requestSeq;
        Promise.all([
            fetch("/api/wakeups", { cache: "no-store" })
                .then((r) => r.json())
                .catch(() => ({})),
            fetch("/api/runqueue", { cache: "no-store" })
                .then((r) => r.json())
                .catch(() => ({}))
        ])
            .then(([data, runqueue]) => {
                if (seq !== requestSeq) return;
                draw(data || {}, anchor, runqueue || {});
            })
            .catch((err) => {
                if (seq !== requestSeq) return;
                isOpen = false;
                if (window.frontendLogger) {
                    window.frontendLogger.error("wakeups card failed to draw", {
                        source: "wakeups-card", stack: String((err && err.stack) || err)
                    });
                }
            });
    }

    // The dominant context is the one sentence worth drawing from a window:
    // it says whether this machine is woken by its own software or by the world
    // outside it.
    function verdict(contexts, events) {
        const rows = Object.entries(contexts || {})
            .map(([name, item]) => [name, Number((item && item.count) || 0)])
            .sort((a, b) => b[1] - a[1]);
        if (!rows.length || !events) return null;
        const [name, count] = rows[0];
        const share = Math.round((count / events) * 100);
        if (name === "hardirq") {
            return `${share}% of it came from hardware interrupts — this machine is woken from outside`;
        }
        if (name === "softirq") {
            return `${share}% of it came from deferred kernel work — the network and timer path`;
        }
        return `${share}% of it was one task deciding another should run`;
    }

    function side(end) {
        if (!end) return "";
        if (end.idle) return "idle cpu";
        const tid = end.tid === null || end.tid === undefined ? "" : ` ${end.tid}`;
        return `${clip(end.comm, 16)}${tid}`;
    }

    function latency(value) {
        const microseconds = Number(value);
        if (!Number.isFinite(microseconds)) return "NOT OBSERVED";
        if (microseconds < 1000) return `${Math.round(microseconds)} µS`;
        if (microseconds < 1000000) {
            const milliseconds = microseconds / 1000;
            return `${milliseconds < 10 ? milliseconds.toFixed(2) : milliseconds.toFixed(1)} MS`;
        }
        return `${(microseconds / 1000000).toFixed(2)} S`;
    }

    function drawExecutionDistance(body, distance, events, cw, cy) {
        const samples = Number((distance && distance.samples) || 0);
        const migrations = Number((distance && distance.migrations) || 0);
        const observed = samples > 0;
        const compact = cw < 480;
        const left = PAD + 12;
        const right = cw - PAD - 12;
        const railY = cy + 37;
        const stages = [
            { label: "WAIT EVENT", value: "NOT PREDICTABLE", known: false },
            { label: "WAKEUP", value: `${events} SAMPLED`, known: events > 0 },
            { label: "RUNNABLE", value: observed ? `${latency(distance.median_us)} MEDIAN` : "NO PAIR", known: observed },
            { label: "ON CPU", value: observed ? `${latency(distance.p95_us)} P95` : "NOT OBSERVED", known: observed }
        ];
        const step = (right - left) / (stages.length - 1);

        body.append("text")
            .attr("class", "kcard-section execution-distance-title")
            .attr("x", PAD).attr("y", cy + 10)
            .text("EXECUTION DISTANCE · TASK TO CPU");
        body.append("text")
            .attr("class", observed ? "kcard-inferred" : "kcard-faint")
            .attr("x", cw - PAD).attr("y", cy + 10)
            .attr("text-anchor", "end")
            .text(observed
                ? (compact ? `${samples} MATCHED · SAMPLE` : `SAMPLED · ${samples} MATCHED WAKE → SWITCH`)
                : (compact ? "NO MATCHED PAIR" : "SAMPLED · WAITING FOR A PAIR"));

        stages.forEach((stage, index) => {
            const x = left + index * step;
            if (index < stages.length - 1) {
                body.append("line")
                    .attr("class", "execution-distance-segment")
                    .attr("x1", x).attr("x2", x + step)
                    .attr("y1", railY).attr("y2", railY)
                    .attr("stroke", index === 0 || !observed
                        ? "rgba(142,166,181,0.38)"
                        : "rgba(226,163,62,0.72)")
                    .attr("stroke-width", index === 2 && observed ? 1.6 : 0.8)
                    .attr("stroke-dasharray", index === 0 || !observed ? "3 4" : null);
            }
            body.append("circle")
                .attr("class", `execution-distance-station execution-distance-${index}`)
                .attr("cx", x).attr("cy", railY)
                .attr("r", index === 3 && observed ? 5 : 3.6)
                .attr("fill", index === 3 && observed ? "#e2a33e" : "rgba(9,12,16,0.96)")
                .attr("stroke", stage.known ? "#e2a33e" : "rgba(142,166,181,0.58)")
                .attr("stroke-width", index === 3 && observed ? 1.2 : 0.8);
            body.append("text")
                .attr("class", index === 3 && observed ? "kcard-section" : "kcard-stage")
                .attr("x", x).attr("y", railY - 10)
                .attr("text-anchor", "middle")
                .text(stage.label);
            body.append("text")
                .attr("class", stage.known ? "kcard-waiter" : "kcard-faint")
                .attr("x", x).attr("y", railY + 18)
                .attr("text-anchor", "middle")
                .text(stage.value);
        });

        body.append("text")
            .attr("class", "kcard-faint")
            .attr("x", PAD).attr("y", cy + 73)
            .text(observed
                ? `WAKE-TO-RUN IS MEASURED · ${migrations} CPU MIGRATION${migrations === 1 ? "" : "S"} IN THIS WINDOW`
                : "SLEEP-TO-WAKE REMAINS UNKNOWN · NO WAKE-TO-RUN LATENCY LANDED IN THIS WINDOW");
        return {
            nextY: cy + 84,
            target: { x: right, y: railY }
        };
    }

    function runtime(value) {
        const milliseconds = Number(value);
        if (!Number.isFinite(milliseconds)) return "RUNTIME UNKNOWN";
        if (milliseconds < 1000) return `${milliseconds.toFixed(milliseconds < 10 ? 2 : 1)} MS EXEC`;
        if (milliseconds < 60000) return `${(milliseconds / 1000).toFixed(1)} S EXEC`;
        return `${(milliseconds / 60000).toFixed(1)} MIN EXEC`;
    }

    function signedMs(value, label) {
        const milliseconds = Number(value);
        if (!Number.isFinite(milliseconds)) return null;
        const sign = milliseconds > 0 ? "+" : "";
        if (Math.abs(milliseconds) < 1) {
            return `${label} ${sign}${Math.round(milliseconds * 1000)} µS`;
        }
        return `${label} ${sign}${milliseconds.toFixed(2)} MS`;
    }

    function preemptionPairModel(runqueue, preferredTid) {
        const cpus = Array.isArray(runqueue && runqueue.cpus) ? runqueue.cpus : [];
        const pairs = cpus.map((cpu) => {
            const queue = Array.isArray(cpu.queue) ? cpu.queue : [];
            const current = queue.find((row) => row.current && !row.observer)
                || queue.find((row) => row.current)
                || null;
            const nextTid = cpu.next && Number.isFinite(Number(cpu.next.tid))
                ? Number(cpu.next.tid)
                : null;
            const named = nextTid === null
                ? null
                : queue.find((row) => !row.current && Number(row.tid) === nextTid);
            const preferred = Number.isFinite(Number(preferredTid))
                ? queue.find((row) => !row.current && Number(row.tid) === Number(preferredTid))
                : null;
            const fallback = queue.find((row) => !row.current && !row.observer && row.eligible === true)
                || queue.find((row) => !row.current && !row.observer)
                || null;
            const contender = preferred || named || fallback;
            if (!current || !contender) return null;
            return {
                cpu: cpu.cpu,
                current,
                contender,
                named: !!named,
                preferred: !!preferred,
                exact: !!(cpu.next && cpu.next.exact && nextTid === Number(contender.tid)),
                reason: cpu.next && cpu.next.reason ? String(cpu.next.reason) : null
            };
        }).filter(Boolean);
        return pairs.sort((a, b) => {
            if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
            if (a.exact !== b.exact) return a.exact ? -1 : 1;
            if (a.named !== b.named) return a.named ? -1 : 1;
            if (!!a.current.observer !== !!b.current.observer) return a.current.observer ? 1 : -1;
            return Number(a.cpu) - Number(b.cpu);
        })[0] || null;
    }

    function drawPreemptionPair(body, runqueue, cw, cy, preferredTid) {
        const pair = preemptionPairModel(runqueue, preferredTid);
        const compact = cw < 480;
        const left = PAD + 12;
        const right = cw - PAD - 12;
        const center = cw / 2;
        const gap = 34;
        const boxTop = cy + 19;
        const boxHeight = 31;
        const boxWidth = Math.max(116, (right - left - gap) / 2);

        body.append("text")
            .attr("class", "kcard-section preemption-pair-title")
            .attr("x", PAD).attr("y", cy + 10)
            .text(compact ? "TASK CONTEXT" : "TASK CONTEXT · CURRENT VS SELECTED");
        body.append("text")
            .attr("class", pair && pair.exact ? "kcard-inferred" : "kcard-faint")
            .attr("x", cw - PAD).attr("y", cy + 10)
            .attr("text-anchor", "end")
            .text(pair
                ? (pair.exact
                    ? (compact ? `CPU ${pair.cpu} · EXACT NEXT` : `RUNQUEUE SNAPSHOT · CPU ${pair.cpu} · EXACT NEXT`)
                    : (compact ? `CPU ${pair.cpu} · RANK UNKNOWN` : `RUNQUEUE SNAPSHOT · CPU ${pair.cpu} · RANK UNRESOLVED`))
                : (compact ? "NO PAIR" : "RUNQUEUE SNAPSHOT · NO PAIR"));

        if (!pair) {
            body.append("line")
                .attr("x1", left).attr("x2", right)
                .attr("y1", boxTop + boxHeight / 2).attr("y2", boxTop + boxHeight / 2)
                .attr("stroke", "rgba(142,166,181,0.24)").attr("stroke-dasharray", "3 5");
            body.append("text")
                .attr("class", "kcard-faint")
                .attr("x", center).attr("y", boxTop + boxHeight / 2 + 3)
                .attr("text-anchor", "middle")
                .text("WAITING FOR ONE CPU WITH BOTH SIDES OBSERVED");
            return cy + 67;
        }

        const sides = [
            {
                row: pair.current,
                x: left,
                label: "ON CPU",
                metric: runtime(pair.current.sum_exec_ms)
            },
            {
                row: pair.contender,
                x: right - boxWidth,
                label: pair.exact ? "NEXT AT SCHEDULE" : "RUNNABLE · RANK UNKNOWN",
                metric: [signedMs(pair.contender.due_ms, "DUE"), signedMs(pair.contender.vlag_ms, "VLAG")]
                    .filter(Boolean).join(" · ") || clip(pair.reason || "DECISION FIELDS NOT EXPOSED", 30)
            }
        ];
        sides.forEach((side, index) => {
            const highlighted = index === 1 && pair.exact;
            body.append("rect")
                .attr("class", `preemption-pair-side preemption-pair-${index === 0 ? "current" : "contender"}`)
                .attr("x", side.x).attr("y", boxTop)
                .attr("width", boxWidth).attr("height", boxHeight)
                .attr("fill", highlighted ? "rgba(226,163,62,0.12)" : "rgba(9,12,16,0.82)")
                .attr("stroke", highlighted ? "#e2a33e" : "rgba(142,166,181,0.42)")
                .attr("stroke-width", highlighted ? 0.9 : 0.6);
            body.append("text")
                .attr("class", highlighted ? "kcard-section" : "kcard-stage")
                .attr("x", side.x + 6).attr("y", boxTop + 10)
                .text(side.label);
            body.append("text")
                .attr("class", highlighted ? "kcard-section" : "kcard-waiter")
                .attr("x", side.x + 6).attr("y", boxTop + 21)
                .text(`${clip(side.row.comm || side.row.process || "TASK", 15).toUpperCase()} · ${side.row.tid}`);
            body.append("text")
                .attr("class", "kcard-faint")
                .attr("x", side.x + boxWidth - 6).attr("y", boxTop + 21)
                .attr("text-anchor", "end")
                .text(clip(side.metric, Math.max(13, Math.floor(boxWidth / 6.2))));
        });

        body.append("path")
            .attr("class", "preemption-pair-gate")
            .attr("d", `M${center},${boxTop + 7} L${center + 8},${boxTop + boxHeight / 2} L${center},${boxTop + boxHeight - 7} L${center - 8},${boxTop + boxHeight / 2} Z`)
            .attr("fill", pair.exact ? "rgba(226,163,62,0.22)" : "rgba(103,200,224,0.06)")
            .attr("stroke", pair.exact ? "#e2a33e" : "rgba(103,200,224,0.52)")
            .attr("stroke-width", pair.exact ? 1.05 : 0.7);
        body.append("text")
            .attr("class", pair.exact ? "kcard-section" : "kcard-faint")
            .attr("x", center).attr("y", boxTop + boxHeight / 2 + 2.5)
            .attr("text-anchor", "middle")
            .text(pair.exact ? "N" : "?");
        body.append("text")
            .attr("class", "kcard-faint")
            .attr("x", PAD).attr("y", cy + 62)
            .text(pair.exact
                ? "NEXT MEANS THE NEXT SCHEDULING DECISION · IT DOES NOT CLAIM AN IMMEDIATE INTERRUPT"
                : "CONTENDER IS REAL · PREEMPTION ORDER IS NOT EXPOSED BY THIS SNAPSHOT");
        return cy + 72;
    }

    function serviceName(unit) {
        const value = String(unit || "UNOWNED");
        if (value === "/") return "ROOT CGROUP";
        if (value === "user.slice") return "USER SESSION";
        if (value === "system.slice") return "SYSTEM";
        return value.replace(/\.service$/, "").replace(/^kernel-ai-/, "KAI · ").toUpperCase();
    }

    function servicePlaneModel(runqueue) {
        const cpus = Array.isArray(runqueue && runqueue.cpus) ? runqueue.cpus : [];
        const visibleCpus = cpus
            .map((cpu) => {
                const queue = Array.isArray(cpu.queue) ? cpu.queue : [];
                const current = queue.find((row) => row.current) || null;
                const candidateTid = cpu.next && Number.isFinite(Number(cpu.next.tid))
                    ? Number(cpu.next.tid)
                    : null;
                const nextExact = !!(cpu.next && cpu.next.exact && candidateTid !== null);
                const runnableTasks = queue
                    .filter((row) => !row.current && !row.observer)
                    .slice(0, 12)
                    .map((row) => ({
                        tid: Number(row.tid),
                        comm: String(row.comm || row.process || "task").toUpperCase(),
                        unit: serviceName(row.unit || row.cgroup || "unowned"),
                        eligible: row.eligible === true,
                        eligibilityKnown: row.eligible === true || row.eligible === false,
                        due_ms: Number.isFinite(Number(row.due_ms)) ? Number(row.due_ms) : null,
                        vlag_ms: Number.isFinite(Number(row.vlag_ms)) ? Number(row.vlag_ms) : null,
                        candidate: candidateTid !== null && Number(row.tid) === candidateTid,
                        exact: nextExact && Number(row.tid) === candidateTid,
                        rt: !!row.rt
                    }));
                const grouped = new Map();
                queue.filter((row) => !row.current && !row.observer).forEach((row) => {
                    const key = row.unit || row.cgroup || "unowned";
                    const item = grouped.get(key) || {
                        key,
                        unit: serviceName(key),
                        tasks: 0,
                        due_ms: null,
                        deadlines: [],
                        eligible: false,
                        exact: false
                    };
                    item.tasks += 1;
                    if (Number.isFinite(Number(row.due_ms))) {
                        const due = Number(row.due_ms);
                        item.due_ms = item.due_ms === null ? due : Math.min(item.due_ms, due);
                        item.deadlines.push(due);
                    }
                    item.eligible = item.eligible || row.eligible === true;
                    item.exact = item.exact || (nextExact && Number(row.tid) === candidateTid);
                    grouped.set(key, item);
                });
                const services = Array.from(grouped.values())
                    .sort((a, b) => {
                        // Deadlines from different cgroups use different virtual
                        // clocks. Never turn their numeric values into a global
                        // service order: that is not a comparison EEVDF makes.
                        if (a.exact !== b.exact) return a.exact ? -1 : 1;
                        if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
                        return b.tasks - a.tasks || a.unit.localeCompare(b.unit);
                    })
                    .slice(0, 4);
                return {
                    cpu: cpu.cpu,
                    current: current ? serviceName(current.unit || current.cgroup || current.comm) : "IDLE",
                    nextExact,
                    nextReason: cpu.next && cpu.next.reason ? String(cpu.next.reason) : null,
                    runnableTasks,
                    services,
                    hidden: Math.max(0, grouped.size - services.length)
                };
            })
            .filter((cpu) => cpu.services.length || cpu.current !== "IDLE")
            .sort((a, b) => b.services.length - a.services.length)
            .slice(0, 4);
        return {
            available: !!(runqueue && runqueue.source && runqueue.source.available),
            ordered: !!(runqueue && runqueue.scheduler && runqueue.scheduler.decision_fields),
            cpus: visibleCpus,
            total: visibleCpus.reduce((sum, cpu) =>
                sum + cpu.services.reduce((count, service) => count + service.tasks, 0), 0)
        };
    }

    function drawServicePlane(body, runqueue, cw, cy, executionTarget, selectedTid, onTaskSelect) {
        const model = servicePlaneModel(runqueue);
        const compact = cw < 480;
        const sourceAge = Number(runqueue && runqueue.source && runqueue.source.age_s);
        const freshness = Number.isFinite(sourceAge) ? `${sourceAge.toFixed(1)}S AGO` : "AGE UNKNOWN";
        const trajectoryLayer = body.insert("g", ":first-child")
            .attr("class", "service-plane-trajectories");
        const left = PAD + 34;
        const right = cw - PAD - 34;
        const horizonLeft = cw / 2 - Math.min(108, cw * 0.18);
        const horizonRight = cw / 2 + Math.min(108, cw * 0.18);
        const top = cy + 32;
        const bottom = cy + 140;
        const eligibilityY = top + 82;
        const eligibilityDepth = (eligibilityY - top) / (bottom - top);
        const eligibilityLeft = horizonLeft + (left - horizonLeft) * eligibilityDepth;
        const eligibilityRight = horizonRight + (right - horizonRight) * eligibilityDepth;

        body.append("text")
            .attr("class", "kcard-section service-plane-title")
            .attr("x", PAD).attr("y", cy + 10)
            .text(compact ? "RUNNABLE SERVICES" : "RUNNABLE SERVICES · EXECUTION PLANE");
        body.append("text")
            .attr("class", model.ordered ? "kcard-inferred" : "kcard-faint")
            .attr("x", cw - PAD).attr("y", cy + 10)
            .attr("text-anchor", "end")
            .text(model.ordered
                ? (compact ? `SNAPSHOT ${freshness}` : `RUNQUEUE ${freshness} · EEVDF`)
                : (compact ? `SNAPSHOT ${freshness}` : `RUNQUEUE ${freshness} · ORDER HIDDEN`));

        body.append("path")
            .attr("class", "service-plane-surface")
            .attr("d", `M${horizonLeft},${top} H${horizonRight} L${right},${bottom} H${left} Z`)
            .attr("fill", "rgba(103,200,224,0.025)")
            .attr("stroke", "rgba(142,166,181,0.28)")
            .attr("stroke-width", 0.7)
            .style("pointer-events", "none");
        [0.25, 0.5, 0.75].forEach((fraction) => {
            const y = top + (bottom - top) * fraction;
            const rowLeft = horizonLeft + (left - horizonLeft) * fraction;
            const rowRight = horizonRight + (right - horizonRight) * fraction;
            body.append("line")
                .attr("x1", rowLeft).attr("x2", rowRight).attr("y1", y).attr("y2", y)
                .attr("stroke", "rgba(142,166,181,0.15)").attr("stroke-width", 0.55);
        });
        body.append("line")
            .attr("class", "service-plane-eligibility")
            .attr("x1", eligibilityLeft).attr("x2", eligibilityRight)
            .attr("y1", eligibilityY).attr("y2", eligibilityY)
            .attr("stroke", model.ordered ? "rgba(226,163,62,0.58)" : "rgba(103,200,224,0.36)")
            .attr("stroke-width", model.ordered ? 1.05 : 0.75)
            .attr("stroke-dasharray", model.ordered ? "1 3" : "3 4");
        body.append("text")
            .attr("class", model.ordered ? "kcard-inferred" : "kcard-faint")
            .attr("x", eligibilityRight).attr("y", eligibilityY - 5)
            .attr("text-anchor", "end")
            .text(model.ordered ? "ELIGIBILITY · VIRTUAL LAG GATE" : "ELIGIBILITY NOT EXPOSED");

        if (!model.available || !model.cpus.length) {
            body.append("text")
                .attr("class", "kcard-faint")
                .attr("x", cw / 2).attr("y", top + 57)
                .attr("text-anchor", "middle")
                .text("RUNQUEUE SNAPSHOT NOT AVAILABLE");
            return cy + 154;
        }

        const cpuStep = (horizonRight - horizonLeft) / model.cpus.length;
        const laneStep = (right - left) / model.cpus.length;
        model.cpus.forEach((cpu, cpuIndex) => {
            const gateX = horizonLeft + cpuStep * (cpuIndex + 0.5);
            const laneX = left + laneStep * (cpuIndex + 0.5);
            body.append("line")
                .attr("class", "service-plane-lane")
                .attr("x1", gateX).attr("y1", top)
                .attr("x2", laneX).attr("y2", bottom)
                .attr("stroke", "rgba(103,200,224,0.22)")
                .attr("stroke-width", 0.65)
                .attr("stroke-dasharray", model.ordered ? null : "2 4");

            const tasks = cpu.runnableTasks || [];
            tasks.forEach((task, taskIndex) => {
                const depth = (taskIndex + 1) / (tasks.length + 1);
                const startY = eligibilityY + 7 + depth * (bottom - eligibilityY - 10);
                const spread = Math.min(44, laneStep * 0.28);
                const phase = ((Math.abs(task.tid || taskIndex) * 17) % 101) / 100;
                const startX = laneX + (phase - 0.5) * spread * 2;
                const bend = ((Math.abs(task.tid || taskIndex) * 29) % 23) - 11;
                const fan = taskIndex - (tasks.length - 1) / 2;
                const active = task.exact;
                const selected = selectedTid !== null && Number(task.tid) === Number(selectedTid);
                const target = executionTarget || { x: gateX, y: top + 8 };
                const eligibilityX = gateX + (laneX - gateX) * eligibilityDepth + fan * 1.8;
                const pickY = top + 21;
                const reachesPicker = !task.eligibilityKnown || task.eligible || task.rt;
                const approach = [
                    `M${startX},${startY}`,
                    `C${startX + bend * 1.2},${startY - 10 - Math.abs(fan)}`,
                    `${eligibilityX - bend * 0.55},${eligibilityY + 13 + fan}`,
                    `${eligibilityX},${eligibilityY}`
                ];
                const path = (reachesPicker ? approach.concat([
                    `C${eligibilityX + bend * 0.75},${eligibilityY - 19}`,
                    `${gateX - bend * 0.65},${pickY + 13 + fan}`,
                    `${gateX},${pickY}`,
                    `C${gateX + bend * 0.28},${pickY - 7}`,
                    `${gateX + bend * 0.18},${top + 13}`,
                    `${gateX},${top + 8}`,
                    `C${gateX + 32 + bend * 0.8 + fan * 3.2},${top - 35 - Math.abs(fan) * 2}`,
                    `${target.x - 102 + fan * 7},${target.y + 48 + fan * 3.5}`,
                    `${target.x},${target.y}`
                ]) : approach).join(" ");
                const selectablePath = (reachesPicker ? approach.concat([
                    `C${eligibilityX + bend * 0.75},${eligibilityY - 19}`,
                    `${gateX - bend * 0.65},${pickY + 13 + fan}`,
                    `${gateX},${pickY}`
                ]) : approach).join(" ");
                trajectoryLayer.append("path")
                    .attr("class", "service-plane-task-curve-echo")
                    .attr("d", path)
                    .attr("fill", "none")
                    .attr("stroke", active ? "rgba(226,163,62,0.13)"
                        : (selected ? "rgba(244,244,236,0.13)" : "rgba(103,200,224,0.075)"))
                    .attr("stroke-width", active || selected ? 3.2 : 2.1)
                    .attr("stroke-linecap", "round");
                const curve = trajectoryLayer.append("path")
                    .attr("class", `service-plane-task-curve${selected ? " is-selected" : ""}`)
                    .attr("data-tid", task.tid)
                    .attr("data-cpu", cpu.cpu)
                    .attr("d", path)
                    .attr("fill", "none")
                    .attr("stroke", active ? "#e2a33e" : (selected ? "rgba(244,244,236,0.90)"
                        : (task.rt ? "rgba(226,163,62,0.48)" : "rgba(103,200,224,0.34)")))
                    .attr("stroke-width", active ? 1.45 : (selected ? 1.2 : (task.rt ? 0.9 : 0.65)))
                    .attr("stroke-dasharray", active || selected ? null : "2 4")
                    .attr("stroke-linecap", "round");
                curve.append("title").text(
                    `${task.comm} · TID ${task.tid} · CPU ${cpu.cpu} · ${task.unit}`
                );
                trajectoryLayer.append("path")
                    .attr("class", "service-plane-task-hit")
                    .attr("data-tid", task.tid)
                    .attr("data-cpu", cpu.cpu)
                    .attr("d", selectablePath)
                    .attr("fill", "none")
                    .attr("stroke", "rgba(255,255,255,0.001)")
                    .attr("stroke-width", 10)
                    .attr("stroke-linecap", "round")
                    .style("pointer-events", "stroke")
                    .style("cursor", "pointer")
                    .on("click", (event) => {
                        event.stopPropagation();
                        if (onTaskSelect) onTaskSelect(task.tid);
                    })
                    .append("title")
                    .text(`${task.comm} · TID ${task.tid} · OPEN TASK CONTEXT`);
                trajectoryLayer.append("circle")
                    .attr("class", "service-plane-task-origin")
                    .attr("cx", startX).attr("cy", startY).attr("r", active ? 2.6 : 1.7)
                    .attr("fill", active ? "#e2a33e"
                        : (selected ? "rgba(244,244,236,0.92)" : "rgba(103,200,224,0.62)"))
                    .style("cursor", "pointer")
                    .on("click", (event) => {
                        event.stopPropagation();
                        if (onTaskSelect) onTaskSelect(task.tid);
                    });
                if (task.due_ms !== null) {
                    trajectoryLayer.append("line")
                        .attr("class", "service-plane-deadline-tick")
                        .attr("x1", startX - 4).attr("x2", startX + 4)
                        .attr("y1", startY).attr("y2", startY)
                        .attr("stroke", active ? "#e2a33e"
                            : (selected ? "rgba(244,244,236,0.82)" : "rgba(244,244,236,0.42)"))
                        .attr("stroke-width", active ? 1.2 : 0.7)
                        .append("title")
                        .text(`VIRTUAL DEADLINE · DUE ${task.due_ms.toFixed(3)} MS`);
                }
                trajectoryLayer.append("circle")
                    .attr("class", "service-plane-task-origin-hit")
                    .attr("data-tid", task.tid)
                    .attr("data-cpu", cpu.cpu)
                    .attr("cx", startX).attr("cy", startY).attr("r", 7)
                    .attr("fill", "rgba(255,255,255,0.001)")
                    .style("cursor", "pointer")
                    .on("click", (event) => {
                        event.stopPropagation();
                        if (onTaskSelect) onTaskSelect(task.tid);
                    })
                    .append("title")
                    .text(`${task.comm} · TID ${task.tid} · OPEN TASK CONTEXT`);
            });

            const pickerY = top + 21;
            const pickGate = body.append("path")
                .attr("class", "service-plane-pick-gate")
                .attr("data-cpu", cpu.cpu)
                .attr("d", `M${gateX},${pickerY - 6} L${gateX + 6},${pickerY} L${gateX},${pickerY + 6} L${gateX - 6},${pickerY} Z`)
                .attr("fill", cpu.nextExact ? "rgba(226,163,62,0.22)" : "rgba(103,200,224,0.055)")
                .attr("stroke", cpu.nextExact ? "#e2a33e" : "rgba(103,200,224,0.58)")
                .attr("stroke-width", cpu.nextExact ? 1.1 : 0.75);
            pickGate.append("title").text(cpu.nextExact
                ? "EXACT NEXT TASK · ELIGIBLE WITH THE EARLIEST VIRTUAL DEADLINE"
                : `NEXT TASK UNRESOLVED · ${cpu.nextReason || "DECISION FIELDS NOT EXPOSED"}`);
            body.append("text")
                .attr("class", cpu.nextExact ? "kcard-section" : "kcard-faint")
                .attr("x", gateX).attr("y", pickerY + 2.5)
                .attr("text-anchor", "middle")
                .text(cpu.nextExact ? "E" : "?");
            body.append("text")
                .attr("class", "kcard-stage")
                .attr("x", gateX + 10).attr("y", pickerY + 3)
                .text("PICK");

            body.append("path")
                .attr("d", `M${gateX - 25},${top - 8} H${gateX + 20} L${gateX + 25},${top - 3} V${top + 9} H${gateX - 25} Z`)
                .attr("fill", "rgba(226,163,62,0.10)")
                .attr("stroke", "rgba(226,163,62,0.72)")
                .attr("stroke-width", 0.7);
            body.append("text")
                .attr("class", "kcard-stage")
                .attr("x", gateX).attr("y", top - 12)
                .attr("text-anchor", "middle")
                .text(`CPU ${cpu.cpu}`);
            body.append("text")
                .attr("class", "kcard-section")
                .attr("x", gateX).attr("y", top + 3)
                .attr("text-anchor", "middle")
                .text(clip(cpu.current, 7));

            cpu.services.forEach((service, serviceIndex) => {
                const depth = (serviceIndex + 1) / (cpu.services.length + 1);
                const y = top + 23 + depth * (bottom - top - 28);
                const progress = (y - top) / (bottom - top);
                const x = gateX + (laneX - gateX) * progress;
                const tokenWidth = Math.min(112, Math.max(76, laneStep - 12));
                const active = service.exact;
                body.append("line")
                    .attr("x1", gateX).attr("y1", top + 9)
                    .attr("x2", x).attr("y2", y - 7)
                    .attr("stroke", active ? "rgba(226,163,62,0.56)" : "rgba(142,166,181,0.16)")
                    .attr("stroke-width", active ? 0.9 : 0.5);
                body.append("rect")
                    .attr("class", "service-plane-token")
                    .attr("data-service", service.key)
                    .attr("x", x - tokenWidth / 2).attr("y", y - 8)
                    .attr("width", tokenWidth).attr("height", 17)
                    .attr("fill", active ? "rgba(226,163,62,0.14)" : "rgba(9,12,16,0.94)")
                    .attr("stroke", active ? "#e2a33e" : "rgba(142,166,181,0.48)")
                    .attr("stroke-width", active ? 0.9 : 0.6);
                body.append("text")
                    .attr("class", active ? "kcard-section" : "kcard-waiter")
                    .attr("x", x - tokenWidth / 2 + 5).attr("y", y + 3)
                    .text(clip(service.unit, Math.max(9, Math.floor(tokenWidth / 6.2))));
                body.append("text")
                    .attr("class", "kcard-faint")
                    .attr("x", x + tokenWidth / 2 - 5).attr("y", y + 3)
                    .attr("text-anchor", "end")
                    .text(service.tasks);

                const deadlines = (service.deadlines || [])
                    .filter(Number.isFinite)
                    .sort((a, b) => a - b)
                    .slice(0, 8);
                if (deadlines.length) {
                    const combLeft = x - tokenWidth / 2 + 5;
                    const combRight = x + tokenWidth / 2 - 5;
                    const combY = y + 12;
                    const minDue = deadlines[0];
                    const maxDue = deadlines[deadlines.length - 1];
                    const deadlineX = (due, index) => {
                        if (maxDue === minDue) {
                            return deadlines.length === 1
                                ? (combLeft + combRight) / 2
                                : combLeft + (combRight - combLeft) * index / (deadlines.length - 1);
                        }
                        return combLeft + (combRight - combLeft) * (due - minDue) / (maxDue - minDue);
                    };
                    body.append("line")
                        .attr("class", "service-plane-deadline-comb")
                        .attr("x1", combLeft).attr("x2", combRight)
                        .attr("y1", combY).attr("y2", combY)
                        .attr("stroke", "rgba(142,166,181,0.24)")
                        .attr("stroke-width", 0.55);
                    deadlines.forEach((due, deadlineIndex) => {
                        body.append("line")
                            .attr("class", "service-plane-deadline-mark")
                            .attr("data-due-ms", due)
                            .attr("x1", deadlineX(due, deadlineIndex))
                            .attr("x2", deadlineX(due, deadlineIndex))
                            .attr("y1", combY - (deadlineIndex === 0 ? 4 : 2.5))
                            .attr("y2", combY + (deadlineIndex === 0 ? 4 : 2.5))
                            .attr("stroke", deadlineIndex === 0
                                ? (active ? "#e2a33e" : "rgba(244,244,236,0.72)")
                                : "rgba(103,200,224,0.52)")
                            .attr("stroke-width", deadlineIndex === 0 ? 1 : 0.65)
                            .append("title")
                            .text(`VIRTUAL DEADLINE · DUE ${due.toFixed(3)} MS · LOCAL TO ${service.unit}`);
                    });
                }
            });
        });

        body.append("text")
            .attr("class", "kcard-faint")
            .attr("x", PAD).attr("y", cy + 153)
            .text(model.ordered
                ? `${model.total} RUNNABLE TASKS · CLICK A CURVE · DEADLINES COMPARE ONLY INSIDE ITS SERVICE`
                : `${model.total} RUNNABLE TASKS · CLICK A CURVE · DEPTH IS LAYOUT, NOT QUEUE RANK`);
        return cy + 164;
    }

    function draw(data, anchor, runqueue) {
        const svgNode = svg.node();
        const viewW = (svgNode && svgNode.clientWidth) || window.innerWidth;
        const viewH = (svgNode && svgNode.clientHeight) || window.innerHeight;
        const cw = Math.min(W, viewW - 24);
        const compact = cw < 480;

        const available = !!data.available;
        const rowLimit = viewH < 720 ? 4 : (compact ? 6 : MAX_ROWS);
        const edges = (data.edges || []).slice(0, rowLimit);
        const events = Number(data.events || 0);
        const window_s = Number(data.window_s || 0);
        const lost = Number(data.lost || 0);
        const distance = data.execution_distance || {};
        const line = available ? verdict(data.contexts, events) : null;
        const hasObserver = edges.some((e) => (e.waker && e.waker.observer)
            || (e.woken && e.woken.observer));
        const selectedVisible = selectedTaskTid !== null
            && (runqueue.cpus || []).some((cpu) => (cpu.queue || [])
                .some((row) => !row.current && Number(row.tid) === Number(selectedTaskTid)));
        if (!selectedVisible) selectedTaskTid = null;
        const redraw = () => {
            if (!isOpen) return;
            svg.selectAll(".wakeups-card-scrim, .wakeups-card-layer").interrupt().remove();
            draw(data, anchor, runqueue);
        };
        const selectTask = (tid) => {
            selectedTaskTid = Number(selectedTaskTid) === Number(tid) ? null : Number(tid);
            redraw();
        };
        const toggleEvidence = () => {
            wakeEvidenceExpanded = !wakeEvidenceExpanded;
            redraw();
        };

        // A pair with a big count and a task with many partners are different
        // shapes of busy: one is a conversation, the other is a hub.
        const hub = (row, verb) => (row && row.count
            ? `${clip(row.comm, 16)} ${row.tid} ${verb} ${row.count} times across ${row.partners} ${row.partners === 1 ? "task" : "tasks"}`
            : null);
        const hubs = available
            ? [hub((data.wakers || [])[0], "woke"), hub((data.wakees || [])[0], "was woken")]
                .filter(Boolean)
            : [];

        const reason = ((data.source || {}).reason) || "";
        const missing = available ? null
            : (reason === "stale" ? "THE LAST WINDOW IS TOO OLD TO SHOW"
                : "SAMPLING WAKEUPS NEEDS THE ROOT COLLECTOR");

        const notes = [];
        if (available) {
            notes.push("A WINDOW IS A SAMPLE — BETWEEN WINDOWS THE MACHINE WAKES UNOBSERVED");
            if (hasObserver) notes.push("THE SAMPLER WAKES WHAT IT READS — ITS OWN ROWS ARE MARKED");
            if (lost) notes.push(`${lost} EVENTS OVERRAN THE BUFFER AND WERE LOST`);
        }

        // ── height ─────────────────────────────────────────────────────────
        let h = HEADER + 12 + 10;
        if (!available) {
            h += LINE;
        } else {
            h += 92;                         // wake-to-run execution distance
            if (selectedTaskTid !== null) h += 72; // selected task context
            h += 172;                        // runnable services on the CPU plane
            h += 16 + LINE;                  // collapsed wakeup evidence control
            if (wakeEvidenceExpanded) {
                h += LINE + LINE;            // sampled window and context split
                if (line) h += LINE;         // what that split means
                h += LINE + edges.length * ROW_STEP;
                if (hubs.length) h += 16 + LINE + hubs.length * LINE;
            }
        }
        if (wakeEvidenceExpanded && notes.length) h += 10 + notes.length * LINE;
        h += FOOTER;

        const from = anchor && Number.isFinite(anchor.x) ? anchor.x : 240;
        let x = Number.isFinite(anchor && anchor.clearOf) ? anchor.clearOf : from + 40;
        if (x + cw + 16 > viewW) x = Math.max(12, viewW - cw - 16);
        let y = (anchor && Number.isFinite(anchor.y) ? anchor.y : 120) - 24;
        y = Math.max(12, Math.min(viewH - h - 12, y));

        ensureDossierDefs();
        svg.append("rect")
            .attr("class", "wakeups-card-scrim")
            .attr("x", 0).attr("y", 0).attr("width", viewW).attr("height", viewH)
            .attr("fill", ensureFocusVeilGradient())
            .style("opacity", 0)
            .style("cursor", "pointer")
            .on("click", () => close())
            .transition().duration(200).style("opacity", 1);

        const layer = svg.append("g").attr("class", "wakeups-card-layer");
        if (!topKeeper) {
            topKeeper = createOverlayTopKeeper("wakeups-card-scrim", ["wakeups-card-layer"], () => isOpen);
        }
        topKeeper.start();

        if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
            const connY = Math.max(y + 12, Math.min(y + h - 12, anchor.y));
            layer.append("circle")
                .attr("class", "kcard-anchor")
                .attr("cx", anchor.x).attr("cy", anchor.y).attr("r", 3);
            layer.append("line")
                .attr("class", "kcard-conn")
                .attr("x1", anchor.x).attr("y1", anchor.y)
                .attr("x2", anchor.x).attr("y2", anchor.y)
                .transition().duration(220).ease(d3.easeCubicOut)
                .attr("x2", x).attr("y2", connY);
        }

        const panel = layer.append("g")
            .attr("transform", `translate(${x}, ${y})`)
            .on("click", (event) => event.stopPropagation());

        panel.append("path")
            .attr("class", "kcard-frame")
            .attr("d", dossierCardPath(0, 0, cw, h, CUT))
            .attr("filter", "url(#dossier-drop)")
            .style("pointer-events", "none")
            .attr("transform", `translate(0, ${h / 2}) scale(1, 0.02)`)
            .transition().delay(120).duration(200).ease(d3.easeCubicOut)
            .attr("transform", "translate(0,0) scale(1,1)");

        const body = panel.append("g").attr("class", "wakeups-card-body").style("opacity", 0);
        body.transition().delay(250).duration(180).style("opacity", 1);

        const text = (cls, tx, ty, value, anchorEnd) => body.append("text")
            .attr("class", cls)
            .attr("x", tx).attr("y", ty)
            .attr("text-anchor", anchorEnd ? "end" : "start")
            .text(value);

        body.append("path")
            .attr("class", "kcard-strip")
            .attr("d", `M0,0 H${cw - CUT} L${cw},${CUT} V${HEADER} H0 Z`);
        body.append("circle")
            .attr("class", "kcard-glyph-ring")
            .attr("cx", PAD).attr("cy", HEADER / 2).attr("r", 4.2);
        body.append("circle")
            .attr("class", "kcard-glyph-dot")
            .attr("cx", PAD).attr("cy", HEADER / 2).attr("r", 1.6);
        text("kcard-title", PAD + 12, HEADER / 2 + 3.5, "SCHEDULER · EXECUTION PATH");
        if (available) {
            text("kcard-meta", cw - 13, HEADER / 2 + 3.5, "SNAPSHOT + SAMPLE", true)
                .style("fill", "rgba(244, 244, 236, 0.5)");
        }
        body.append("line")
            .attr("class", "kcard-divider")
            .attr("x1", 0).attr("y1", HEADER).attr("x2", cw).attr("y2", HEADER);

        let cy = HEADER + 12 + 10;

        if (!available) {
            text("kcard-faint", PAD, cy, missing);
            cy += LINE;
        } else {
            const executionDistance = drawExecutionDistance(body, distance, events, cw, cy + 8);
            cy = executionDistance.nextY;
            if (selectedTaskTid !== null) {
                cy = drawPreemptionPair(body, runqueue, cw, cy + 8, selectedTaskTid);
            }
            cy = drawServicePlane(
                body, runqueue, cw, cy + 8, executionDistance.target, selectedTaskTid, selectTask
            );
            cy += 16;
            const ms = Math.round(window_s * 1000);
            const distinct = Number(data.distinct_edges || edges.length);
            text("kcard-section", PAD, cy,
                `WAKEUP EVIDENCE · ${events} EVENTS / ${ms} MS`);
            text(wakeEvidenceExpanded ? "kcard-section" : "kcard-inferred", cw - PAD, cy,
                wakeEvidenceExpanded ? "CLOSE −" : `OPEN + · ${distinct} PAIRS`, true)
                .style("cursor", "pointer")
                .on("click", (event) => {
                    event.stopPropagation();
                    toggleEvidence();
                });
            cy += LINE;

            if (wakeEvidenceExpanded) {
                text("kcard-line", PAD, cy,
                    `${events} wakeups in a sampled window of ${ms} ms${lost ? `, ${lost} lost` : ""}`);
                cy += LINE;
                const split = Object.entries(data.contexts || {})
                    .sort((a, b) => (b[1].count || 0) - (a[1].count || 0))
                    .map(([name, item]) => `${item.count} ${CONTEXT_TAG[name] || name}`);
                text("kcard-summary", PAD, cy, clip(split.join("  ·  "), compact ? 46 : 70));
                cy += LINE;
                if (line) {
                    text("kcard-summary", PAD, cy, clip(line, compact ? 52 : 80));
                    cy += LINE;
                }

                text("kcard-stage", PAD, cy, "WAKER");
                text("kcard-stage", COL_WOKEN, cy, "WOKEN");
                text("kcard-stage", cw - PAD - TIMES_INSET, cy, "TIMES", true);
                text("kcard-stage", cw - PAD, cy, "FROM", true);
                cy += LINE;

                edges.forEach((edge, i) => {
                    const ty = cy + 4 + i * ROW_STEP;
                    const waker = edge.waker || {};
                    const woken = edge.woken || {};
                    if (waker.observer || woken.observer) {
                        body.append("circle")
                            .attr("class", "kcard-glyph-dot")
                            .attr("cx", PAD - 6).attr("cy", ty - 3).attr("r", 1.5);
                    }
                    text(waker.idle ? "kcard-faint" : "kcard-waiter", PAD, ty, side(waker));
                    text("kcard-waiter-dim", COL_WOKEN, ty, side(woken));
                    text("kcard-waiter-dim", cw - PAD - TIMES_INSET, ty, edge.count, true);
                    const where = Object.entries(edge.contexts || {})
                        .sort((a, b) => b[1] - a[1])[0];
                    const tag = edge.new ? "first run" : (where ? (CONTEXT_TAG[where[0]] || where[0]) : "");
                    text(where && where[0] === "hardirq" ? "kcard-symbol is-sleep" : "kcard-faint",
                        cw - PAD, ty, tag, true);
                });
                cy += edges.length * ROW_STEP;

                if (hubs.length) {
                    cy += 16;
                    text("kcard-section", PAD, cy, "THE BUSIEST ENDS OF THE WINDOW");
                    cy += LINE;
                    hubs.forEach((hubLine) => {
                        text("kcard-summary", PAD, cy, clip(hubLine, compact ? 52 : 78));
                        cy += LINE;
                    });
                }
            }
        }

        if (wakeEvidenceExpanded && notes.length) {
            cy += 10;
            notes.forEach((note) => {
                text("kcard-faint", PAD, cy, note);
                cy += LINE;
            });
        }

        body.append("line")
            .attr("class", "kcard-divider")
            .attr("x1", 0).attr("y1", h - FOOTER + 8).attr("x2", cw).attr("y2", h - FOOTER + 8);
        text("kcard-foot", PAD, h - 10, "ESC OR CLICK OUTSIDE TO CLOSE");
        const age = Number((data.source || {}).age_s);
        if (Number.isFinite(age)) {
            text("kcard-foot", cw - PAD, h - 10, `WINDOW FROM ${age.toFixed(1)} S AGO`, true);
        }

        d3.select("body").on("keydown.wakeupscard", (event) => {
            if (event.key === "Escape") close();
        });
    }

    return {
        open,
        close,
        isOpen: () => isOpen
    };
})();

window.WakeupsCard = WakeupsCard;
