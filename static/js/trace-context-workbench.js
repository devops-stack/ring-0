// TRACE Context Workbench: a floating assessment dossier for one parked task.
//
// The visual language follows the layered operator cards in the design
// reference while every statement remains grounded in the current trace
// snapshot. It adds no polling.
(function initTraceContextWorkbench() {
    if (window.TraceContextWorkbench) return;

    const SCRIM = "trace-workbench-scrim";
    const LAYER = "trace-workbench-layer";
    const ACCENT = "#e2a33e";
    const PAPER = "rgba(244,244,236,0.86)";
    const INK = "rgba(244,244,236,0.74)";
    const DIM = "rgba(244,244,236,0.38)";
    const FAINT = "rgba(244,244,236,0.16)";
    const BLUE = "rgba(103,200,224,0.52)";
    const PANEL = "rgba(7,11,15,0.96)";
    const PANEL_SOFT = "rgba(10,15,20,0.92)";
    const FONT = "Share Tech Mono, monospace";
    const DESIGN = { width: 680, height: 430 };
    const NAV = [
        { id: "task", label: "TASK", glyph: "person" },
        { id: "syscall", label: "SYSCALL", glyph: "diamond" },
        { id: "subsystem", label: "SUBSYSTEM", glyph: "grid" },
        { id: "mechanism", label: "MECHANISM", glyph: "rotor" },
        { id: "evidence", label: "EVIDENCE", glyph: "document" }
    ];
    const state = {
        resolved: null,
        focus: "syscall",
        keeper: null
    };

    function finite(value, fallback) {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function clip(value, max) {
        const text = String(value === undefined || value === null || value === ""
            ? "NOT OBSERVED"
            : value);
        return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
    }

    function svgBounds(root) {
        const viewBox = String(root.attr("viewBox") || "").trim().split(/\s+/).map(Number);
        if (viewBox.length === 4 && viewBox.every(Number.isFinite)) {
            return { x: viewBox[0], y: viewBox[1], width: viewBox[2], height: viewBox[3] };
        }
        const node = root.node();
        return {
            x: 0,
            y: 0,
            width: finite(node && node.clientWidth, window.innerWidth),
            height: finite(node && node.clientHeight, window.innerHeight)
        };
    }

    function chamferPath(x, y, width, height, cut) {
        return [
            `M${x},${y}`,
            `H${x + width - cut}`,
            `L${x + width},${y + cut}`,
            `V${y + height}`,
            `H${x + cut}`,
            `L${x},${y + height - cut}`,
            "Z"
        ].join(" ");
    }

    function stopKeeper() {
        if (!state.keeper) return;
        state.keeper.stop();
        state.keeper = null;
    }

    function removeNodes() {
        d3.select("svg").selectAll(`.${SCRIM}, .${LAYER}`).remove();
    }

    function close() {
        const wasOpen = Boolean(state.resolved);
        stopKeeper();
        removeNodes();
        state.resolved = null;
        state.focus = "syscall";
        if (wasOpen && window.KernelTraceLens && typeof window.KernelTraceLens.clearPin === "function") {
            window.KernelTraceLens.clearPin();
        }
        if (wasOpen) {
            window.dispatchEvent(new CustomEvent("kcard-closed", {
                detail: { card: "trace-workbench" }
            }));
        }
    }

    function focus(id) {
        state.focus = id;
        render();
    }

    function openEvidence() {
        const model = state.resolved && state.resolved.model;
        if (!model || !window.KernelTape || typeof window.KernelTape.openInspector !== "function") return;
        state.focus = "evidence";
        window.KernelTape.openInspector(model);
        render();
    }

    function taskStateLabel(value) {
        const stateValue = String(value || "").trim().toUpperCase();
        if (stateValue === "S" || stateValue.includes("SLEEP")) return "TASK_INTERRUPTIBLE";
        if (stateValue === "D" || stateValue.includes("UNINTERRUPTIBLE")) return "TASK_UNINTERRUPTIBLE";
        if (stateValue === "R" || stateValue.includes("RUNNING")) return "TASK_RUNNING";
        if (stateValue === "T" || stateValue.includes("STOP")) return "__TASK_STOPPED";
        if (stateValue === "Z" || stateValue.includes("ZOMBIE")) return "EXIT_ZOMBIE";
        return stateValue || "TASK STATE NOT OBSERVED";
    }

    function wakeConditionFor(syscall, mechanism) {
        const value = `${syscall} ${mechanism}`.toLowerCase();
        if (/(epoll|poll|select)/.test(value)) return "FD READY · TIMEOUT · SIGNAL";
        if (/futex/.test(value)) return "FUTEX_WAKE · TIMEOUT · SIGNAL";
        if (/(nanosleep|hrtimer|clock_)/.test(value)) return "HRTIMER EXPIRY · SIGNAL";
        if (/(accept|listen)/.test(value)) return "INCOMING CONNECTION · SIGNAL";
        if (/(recv|read|socket)/.test(value)) return "DATA READY · EOF · SIGNAL";
        if (/(wait4|waitid|do_wait)/.test(value)) return "CHILD STATE CHANGE · SIGNAL";
        return "WAKE CONDITION NOT CAPTURED";
    }

    function kernelObjectFor(subsystem, mechanism, model) {
        const resource = model && model.resource;
        if (resource && resource.target) return String(resource.target).toUpperCase();
        const value = `${subsystem} ${mechanism}`.toLowerCase();
        if (/epoll/.test(value)) return "EVENTPOLL INSTANCE";
        if (/(net|socket|tcp|udp)/.test(value)) return "SOCKET / SK_BUFF";
        if (/(vfs|file|fs)/.test(value)) return "FILE / INODE";
        if (/(mm|memory|fault)/.test(value)) return "MM_STRUCT / VMA";
        if (/futex/.test(value)) return "FUTEX HASH BUCKET";
        if (/sched/.test(value)) return "SCHED ENTITY";
        return "KERNEL OBJECT NOT RESOLVED";
    }

    function valuesFor(resolved) {
        const trace = resolved.trace || {};
        const model = resolved.model || {};
        const process = resolved.process || {};
        const taskName = String(trace.comm || process.name || "PROCESS").toUpperCase();
        const pid = process.pid || trace.pid || "—";
        const syscall = String(trace.name || model.name || "SYSCALL").toUpperCase();
        const subsystem = String(
            resolved.subsystem ? resolved.subsystem.label : (model.subsystem || "UNKNOWN")
        ).toUpperCase();
        const mechanism = resolved.mechanism
            ? String(resolved.mechanism).replace(/-/g, " ").toUpperCase()
            : String(trace.wchan || "WAIT CHANNEL NOT OBSERVED").toUpperCase();
        const threadCount = Number(resolved.threadCount || 1);
        const scope = String(resolved.scope || model.scope || "UNKNOWN SCOPE").toUpperCase();
        const source = String(model.source || "/proc/PID/syscall").toUpperCase();
        const taskState = taskStateLabel(trace.state);
        const wakeCondition = wakeConditionFor(syscall, mechanism);
        const kernelObject = kernelObjectFor(subsystem, mechanism, model);
        return {
            taskName,
            pid,
            tid: trace.tid || "—",
            state: String(trace.state || "PARKED").toUpperCase(),
            taskState,
            syscall,
            syscallNumber: trace.nr === undefined || trace.nr === null ? "—" : trace.nr,
            subsystem,
            mechanism,
            wakeCondition,
            kernelObject,
            threadCount,
            scope,
            source,
            observedAt: model.observedAt || "TIME UNKNOWN",
            age: model.age === undefined ? "—" : `${Number(model.age).toFixed(1)} S`,
            detail: model.detail || `${taskName} is parked in ${syscall}().`,
            model
        };
    }

    function text(parent, value, x, y, size, color, options) {
        const opts = options || {};
        return parent.append("text")
            .attr("x", x).attr("y", y)
            .attr("fill", color || INK)
            .attr("font-family", FONT)
            .attr("font-size", size)
            .attr("font-weight", opts.weight || null)
            .attr("letter-spacing", opts.spacing === undefined ? 0.45 : opts.spacing)
            .attr("text-anchor", opts.anchor || "start")
            .attr("opacity", opts.opacity === undefined ? 1 : opts.opacity)
            .text(value);
    }

    function rule(parent, x1, y1, x2, y2, color, dash) {
        return parent.append("line")
            .attr("x1", x1).attr("y1", y1).attr("x2", x2).attr("y2", y2)
            .attr("stroke", color || FAINT).attr("stroke-width", 0.8)
            .attr("stroke-dasharray", dash || null);
    }

    function backdropDiagram(layer, values) {
        const map = layer.append("g")
            .attr("class", "trace-workbench-map")
            .attr("opacity", 0.44)
            .attr("pointer-events", "none");
        const cx = 558;
        const cy = 172;
        [48, 68, 92, 118].forEach((radius, index) => {
            map.append("path")
                .attr("d", d3.arc()({
                    innerRadius: radius,
                    outerRadius: radius + 0.7,
                    startAngle: -2.5,
                    endAngle: 0.9 + index * 0.08
                }))
                .attr("transform", `translate(${cx},${cy})`)
                .attr("fill", BLUE);
        });
        for (let index = 0; index < 12; index += 1) {
            const angle = -2.45 + index * 0.27;
            const inner = 44 + (index % 3) * 8;
            const outer = 118;
            rule(
                map,
                cx + Math.cos(angle) * inner,
                cy + Math.sin(angle) * inner,
                cx + Math.cos(angle) * outer,
                cy + Math.sin(angle) * outer,
                index % 3 === 0 ? ACCENT : BLUE,
                index % 2 ? "2 5" : null
            );
            map.append("circle")
                .attr("cx", cx + Math.cos(angle) * outer)
                .attr("cy", cy + Math.sin(angle) * outer)
                .attr("r", index % 3 === 0 ? 2.2 : 1.3)
                .attr("fill", index % 3 === 0 ? ACCENT : BLUE);
        }
        const domains = [
            { label: "SCHED", angle: -2.25 },
            { label: "VFS", angle: -1.63 },
            { label: "NET", angle: -1.01 },
            { label: "MM", angle: -0.39 }
        ];
        domains.forEach(domain => {
            const active = values.subsystem.includes(domain.label)
                || (domain.label === "VFS" && values.subsystem.includes("FS"));
            text(
                map,
                domain.label,
                cx + Math.cos(domain.angle) * 132,
                cy + Math.sin(domain.angle) * 132,
                5.5,
                active ? ACCENT : BLUE,
                { anchor: "middle", spacing: 0.65 }
            );
        });
    }

    function processPortrait(layer, x, y, width, height, values) {
        const portrait = layer.append("g").attr("class", "trace-workbench-portrait");
        portrait.append("rect")
            .attr("x", x).attr("y", y).attr("width", width).attr("height", height)
            .attr("fill", "rgba(103,200,224,0.055)")
            .attr("stroke", BLUE).attr("stroke-width", 0.75);
        text(portrait, "TASK_STRUCT", x + 6, y + 10, 5.2, ACCENT, { spacing: 0.55 });
        rule(portrait, x + 5, y + 15, x + width - 5, y + 15, BLUE);
        const fields = [
            ["PID", values.pid],
            ["TID", values.tid],
            ["STATE", clip(values.taskState.replace(/^TASK_/, ""), 10)],
            ["COMM", clip(values.taskName, 10)]
        ];
        fields.forEach((field, index) => {
            const top = y + 19 + index * 13;
            portrait.append("rect")
                .attr("x", x + 5).attr("y", top).attr("width", width - 10).attr("height", 10)
                .attr("fill", index === 2 ? "rgba(226,163,62,0.08)" : "rgba(244,244,236,0.025)")
                .attr("stroke", index === 2 ? "rgba(226,163,62,0.34)" : FAINT)
                .attr("stroke-width", 0.55);
            text(portrait, field[0], x + 8, top + 7, 4.5, DIM, { spacing: 0.3 });
            text(portrait, field[1], x + width - 8, top + 7, 4.8, index === 2 ? ACCENT : PAPER, {
                anchor: "end",
                spacing: 0.15
            });
        });
        rule(portrait, x + 5, y + 5, x + 15, y + 5, ACCENT);
        rule(portrait, x + 5, y + 5, x + 5, y + 15, ACCENT);
        rule(portrait, x + width - 5, y + height - 5, x + width - 15, y + height - 5, ACCENT);
        rule(portrait, x + width - 5, y + height - 5, x + width - 5, y + height - 15, ACCENT);
        text(portrait, "SCHEDULER-OWNED OBJECT", x + width / 2, y + height + 11, 5.2, DIM, {
            anchor: "middle",
            spacing: 0.35
        });
    }

    function subjectCard(layer, values) {
        const card = layer.append("g").attr("class", "trace-workbench-subject-card");
        card.append("path")
            .attr("d", chamferPath(66, 169, 424, 100, 10))
            .attr("transform", "translate(5,5)")
            .attr("fill", "rgba(0,0,0,0.32)");
        card.append("path")
            .attr("d", chamferPath(66, 169, 424, 100, 10))
            .attr("fill", PANEL_SOFT).attr("stroke", FAINT).attr("stroke-width", 0.8);
        text(card, "EXECUTION CONTEXT", 80, 187, 7, DIM, { spacing: 1.1 });
        text(card, `OBSERVED · ${values.scope} · AGE ${values.age}`, 476, 187, 6, DIM, {
            anchor: "end",
            spacing: 0.45
        });
        rule(card, 80, 194, 476, 194, FAINT);
        text(card, "CURRENT RING TRANSITION", 80, 210, 6.3, INK, { spacing: 0.55 });
        const stages = [
            { eyebrow: "USERSPACE · RING 3", label: values.taskName, width: 82, state: "done" },
            { eyebrow: "ENTRY GATE", label: "SYSCALL_64", width: 72, state: "done" },
            { eyebrow: "RING 0 DOMAIN", label: values.subsystem, width: 91, state: "done" },
            { eyebrow: "CURRENT", label: "WAIT_QUEUE", width: 91, state: "current" }
        ];
        let x = 80;
        const y = 218;
        stages.forEach((stage, index) => {
            const current = stage.state === "current";
            card.append("path")
                .attr("d", chamferPath(x, y, stage.width, 28, 5))
                .attr("fill", current ? "rgba(226,163,62,0.12)" : "rgba(103,200,224,0.035)")
                .attr("stroke", current ? ACCENT : BLUE).attr("stroke-width", current ? 0.9 : 0.6);
            text(card, stage.eyebrow, x + 6, y + 9, 3.8, current ? ACCENT : DIM, {
                spacing: 0.2
            });
            text(card, clip(stage.label, Math.max(8, Math.floor(stage.width / 5))), x + 6, y + 20, 5.5, current ? ACCENT : PAPER, {
                spacing: 0.2
            });
            if (index < stages.length - 1) {
                const nextX = x + stage.width + 13;
                rule(card, x + stage.width, y + 14, nextX, y + 14, index === 0 ? ACCENT : BLUE);
                card.append("path")
                    .attr("d", `M${nextX},${y + 14} L${nextX - 4},${y + 11} L${nextX - 4},${y + 17} Z`)
                    .attr("fill", index === 0 ? ACCENT : BLUE);
            }
            x += stage.width + 13;
        });
        text(card, `NEXT WAKE CONDITION · ${clip(values.wakeCondition, 50)}`, 80, 261, 6.1, DIM, {
            spacing: 0.3
        });
    }

    function assessmentCard(layer, values) {
        const card = layer.append("g").attr("class", "trace-workbench-assessment-card");
        card.append("path")
            .attr("d", chamferPath(92, 28, 444, 155, 12))
            .attr("transform", "translate(7,7)")
            .attr("fill", "rgba(0,0,0,0.42)");
        card.append("path")
            .attr("d", chamferPath(92, 28, 444, 155, 12))
            .attr("fill", PANEL).attr("stroke", BLUE).attr("stroke-width", 0.85);
        card.append("rect")
            .attr("x", 92).attr("y", 28).attr("width", 444).attr("height", 23)
            .attr("fill", "rgba(244,244,236,0.035)");
        rule(card, 92, 51, 536, 51, FAINT);
        card.append("circle")
            .attr("cx", 105).attr("cy", 39.5).attr("r", 3.7)
            .attr("fill", "none").attr("stroke", DIM).attr("stroke-width", 0.8);
        card.append("circle")
            .attr("cx", 105).attr("cy", 39.5).attr("r", 1.4)
            .attr("fill", ACCENT);
        text(card, "TASK_STRUCT ASSESSMENT", 116, 42, 7.2, PAPER, { spacing: 1.15 });
        text(card, values.observedAt, 524, 42, 5.5, DIM, { anchor: "end", spacing: 0.35 });

        processPortrait(card, 110, 65, 70, 77, values);
        text(card, clip(values.taskName, 24), 197, 77, 15.5, PAPER, {
            weight: 500,
            spacing: 0.4
        });
        text(card, `EXECUTION STATE [${clip(values.taskState, 24)}]`, 197, 93, 7.5, BLUE, {
            spacing: 0.8
        });
        rule(card, 197, 101, 516, 101, FAINT);
        text(card, "RING 3 → RING 0 TRANSITION:", 197, 115, 6.5, DIM, { spacing: 0.25 });
        text(card, `SYSCALL_64 → ${clip(values.syscall, 16)}()`, 197, 132, 9.5, PAPER, {
            spacing: 0.45
        });
        text(card, clip(`${values.subsystem} → WAIT ${values.mechanism}`, 47), 197, 148, 7, INK, {
            spacing: 0.3
        });
        text(card, `${values.threadCount} THREAD${values.threadCount === 1 ? "" : "S"} OBSERVED`, 516, 169, 5.8, ACCENT, {
            anchor: "end",
            spacing: 0.55
        });
    }

    function detailFor(values, id) {
        const details = {
            task: {
                eyebrow: "OBSERVED · TASK_STRUCT IDENTITY",
                value: `${values.taskName} · PID ${values.pid} · TID ${values.tid}`,
                detail: `${values.taskState} · ${values.threadCount} OBSERVED THREAD${values.threadCount === 1 ? "" : "S"}`
            },
            syscall: {
                eyebrow: "OBSERVED · PT_REGS / SYSCALL SNAPSHOT",
                value: `NR ${values.syscallNumber} · ${values.syscall}()`,
                detail: "TASK IS PARKED PAST ENTRY · THIS SNAPSHOT IS NOT AN INSTRUCTION TRACE"
            },
            subsystem: {
                eyebrow: "DERIVED · KERNEL OWNERSHIP DOMAIN",
                value: `${values.subsystem} · ${values.kernelObject}`,
                detail: "DOMAIN DERIVED FROM SYSCALL FAMILY AND OBSERVED WAIT CHANNEL"
            },
            mechanism: {
                eyebrow: "OBSERVED / RESOLVED · WAIT_QUEUE",
                value: values.mechanism,
                detail: `WAKE CONDITION · ${values.wakeCondition}`
            },
            evidence: {
                eyebrow: "OBSERVED · SOURCE EVIDENCE",
                value: values.source,
                detail: `${values.scope} · UNCAPTURED EDGES REMAIN EXPLICIT · OPEN INSPECTOR`
            }
        };
        return details[id] || details.syscall;
    }

    function causalThread(layer, values) {
        const deck = layer.append("g").attr("class", "trace-workbench-deck");
        deck.append("path")
            .attr("d", chamferPath(38, 280, 562, 118, 11))
            .attr("fill", "rgba(6,10,14,0.93)")
            .attr("stroke", "rgba(103,200,224,0.24)").attr("stroke-width", 0.75);
        const selected = detailFor(values, state.focus);
        text(deck, selected.eyebrow, 54, 299, 6.2, ACCENT, { spacing: 1 });
        text(deck, clip(selected.value, 62), 54, 317, 9.2, PAPER, { spacing: 0.4 });
        text(deck, clip(selected.detail, 82), 54, 332, 5.8, DIM, { spacing: 0.35 });
        rule(deck, 54, 340, 584, 340, FAINT);

        const entries = [
            ["TASK_STRUCT", `${values.taskName} · ${values.pid}`],
            ["PT_REGS", `SYSCALL NR ${values.syscallNumber}`],
            ["SYSCALL_TABLE", values.syscall],
            [values.subsystem, values.kernelObject],
            ["WAIT_QUEUE", values.mechanism],
            ["RUNQUEUE", values.wakeCondition]
        ];
        const boxWidth = 78;
        const gap = 9;
        const y = 349;
        const left = 54;
        entries.forEach((entry, index) => {
            const id = index === 0 ? "task"
                : index <= 2 ? "syscall"
                    : index === 3 ? "subsystem"
                        : index === 4 ? "mechanism"
                            : "evidence";
            const x = left + index * (boxWidth + gap);
            const active = id === state.focus;
            const item = deck.append("g")
                .attr("class", "trace-workbench-thread-step")
                .attr("data-focus", id)
                .attr("role", "button")
                .style("cursor", "pointer")
                .on("click", function (event) {
                    event.stopPropagation();
                    if (id === "evidence") openEvidence();
                    else focus(id);
                });
            item.append("path")
                .attr("d", chamferPath(x, y, boxWidth, 31, 4))
                .attr("fill", active ? "rgba(226,163,62,0.13)" : "rgba(103,200,224,0.025)")
                .attr("stroke", active ? ACCENT : BLUE)
                .attr("stroke-width", active ? 0.95 : 0.6);
            text(
                item,
                clip(String(entry[0] || "").replace(/^\d+\s*·\s*/, ""), 11),
                x + 6,
                y + 11,
                4.8,
                active ? ACCENT : DIM,
                { spacing: 0.25 }
            );
            text(item, clip(entry[1], 13), x + 6, y + 23, 5.2, active ? PAPER : INK, {
                spacing: 0.15
            });
            if (index < entries.length - 1) {
                const arrowStart = x + boxWidth;
                const arrowEnd = arrowStart + gap;
                rule(item, arrowStart, y + 15.5, arrowEnd, y + 15.5, active ? ACCENT : BLUE);
                item.append("path")
                    .attr("d", `M${arrowEnd},${y + 15.5} L${arrowEnd - 3},${y + 13} L${arrowEnd - 3},${y + 18} Z`)
                    .attr("fill", active ? ACCENT : BLUE);
            }
            item.append("title").text(`${entry[0] || "STEP"} · ${entry[1] || "NOT OBSERVED"}`);
        });
    }

    function railGlyph(group, glyph, cx, cy, selected) {
        const stroke = selected ? ACCENT : INK;
        if (glyph === "person") {
            group.append("circle").attr("cx", cx).attr("cy", cy - 4).attr("r", 3.2)
                .attr("fill", "none").attr("stroke", stroke).attr("stroke-width", 0.9);
            group.append("path").attr("d", `M${cx - 6},${cy + 6} Q${cx},${cy - 1} ${cx + 6},${cy + 6}`)
                .attr("fill", "none").attr("stroke", stroke).attr("stroke-width", 0.9);
            return;
        }
        if (glyph === "diamond") {
            group.append("path").attr("d", `M${cx},${cy - 7} L${cx + 7},${cy} L${cx},${cy + 7} L${cx - 7},${cy} Z`)
                .attr("fill", selected ? "rgba(226,163,62,0.18)" : "none")
                .attr("stroke", stroke).attr("stroke-width", 0.9);
            return;
        }
        if (glyph === "grid") {
            [-4, 3].forEach(dx => [-4, 3].forEach(dy => {
                group.append("rect").attr("x", cx + dx).attr("y", cy + dy)
                    .attr("width", 5).attr("height", 5)
                    .attr("fill", "none").attr("stroke", stroke).attr("stroke-width", 0.7);
            }));
            return;
        }
        if (glyph === "rotor") {
            group.append("circle").attr("cx", cx).attr("cy", cy).attr("r", 6.5)
                .attr("fill", "none").attr("stroke", stroke).attr("stroke-width", 0.8);
            group.append("circle").attr("cx", cx).attr("cy", cy).attr("r", 2.2)
                .attr("fill", selected ? ACCENT : "none").attr("stroke", stroke).attr("stroke-width", 0.8);
            [0, Math.PI / 2, Math.PI, Math.PI * 1.5].forEach(angle => {
                rule(group, cx + Math.cos(angle) * 3, cy + Math.sin(angle) * 3,
                    cx + Math.cos(angle) * 8, cy + Math.sin(angle) * 8, stroke);
            });
            return;
        }
        group.append("path")
            .attr("d", `M${cx - 5},${cy - 7} H${cx + 3} L${cx + 6},${cy - 4} V${cy + 7} H${cx - 5} Z`)
            .attr("fill", "none").attr("stroke", stroke).attr("stroke-width", 0.8);
        rule(group, cx - 2, cy - 1, cx + 3, cy - 1, stroke);
        rule(group, cx - 2, cy + 3, cx + 3, cy + 3, stroke);
    }

    function navigationRail(layer) {
        const rail = layer.append("g").attr("class", "trace-workbench-rail");
        rule(rail, 640, 80, 640, 326, "rgba(103,200,224,0.18)", "2 5");
        NAV.forEach((item, index) => {
            const cy = 92 + index * 54;
            const selected = item.id === state.focus;
            const control = rail.append("g")
                .attr("class", `trace-workbench-node trace-workbench-node-${item.id}`)
                .attr("data-focus", item.id)
                .attr("role", "button")
                .attr("tabindex", 0)
                .style("cursor", "pointer")
                .on("click", function (event) {
                    event.stopPropagation();
                    if (item.id === "evidence") openEvidence();
                    else focus(item.id);
                })
                .on("keydown", function (event) {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    if (item.id === "evidence") openEvidence();
                    else focus(item.id);
                });
            control.append("circle")
                .attr("class", "trace-workbench-node-shell")
                .attr("cx", 640).attr("cy", cy).attr("r", selected ? 17 : 15)
                .attr("fill", selected ? "rgba(226,163,62,0.13)" : "rgba(7,11,15,0.92)")
                .attr("stroke", selected ? ACCENT : BLUE)
                .attr("stroke-width", selected ? 1.2 : 0.75);
            railGlyph(control, item.glyph, 640, cy, selected);
            control.append("title").text(item.label);
        });
    }

    function closeControl(layer) {
        const control = layer.append("g")
            .attr("class", "trace-workbench-close")
            .attr("role", "button")
            .attr("tabindex", 0)
            .style("cursor", "pointer")
            .on("click", function (event) {
                event.stopPropagation();
                close();
            })
            .on("keydown", function (event) {
                if (event.key === "Enter" || event.key === " ") close();
            });
        control.append("circle")
            .attr("cx", 640).attr("cy", 35).attr("r", 12)
            .attr("fill", PANEL).attr("stroke", DIM).attr("stroke-width", 0.8);
        rule(control, 636, 31, 644, 39, INK);
        rule(control, 644, 31, 636, 39, INK);
        control.append("title").text("Close workbench");
    }

    function render() {
        if (!state.resolved || !state.resolved.model) return;
        stopKeeper();
        removeNodes();

        const root = d3.select("svg");
        const bounds = svgBounds(root);
        const margin = 12;
        const scale = Math.min(
            1,
            (bounds.width - margin * 2) / DESIGN.width,
            (bounds.height - margin * 2) / DESIGN.height
        );
        const originX = bounds.x + (bounds.width - DESIGN.width * scale) / 2;
        const originY = bounds.y + (bounds.height - DESIGN.height * scale) / 2;
        const values = valuesFor(state.resolved);

        root.append("rect")
            .attr("class", SCRIM)
            .attr("x", bounds.x - 2).attr("y", bounds.y - 2)
            .attr("width", bounds.width + 4).attr("height", bounds.height + 4)
            .attr("fill", "rgba(2,5,8,0.72)")
            .style("cursor", "zoom-out")
            .on("click", close);

        const layer = root.append("g")
            .attr("class", LAYER)
            .attr("aria-label", "Trace context assessment dossier")
            .attr("transform", `translate(${originX},${originY}) scale(${scale})`)
            .on("click", event => event.stopPropagation());

        backdropDiagram(layer, values);
        subjectCard(layer, values);
        assessmentCard(layer, values);
        causalThread(layer, values);
        navigationRail(layer);
        closeControl(layer);

        if (typeof window.createOverlayTopKeeper === "function") {
            state.keeper = window.createOverlayTopKeeper(
                SCRIM,
                [LAYER],
                () => Boolean(state.resolved)
            );
            state.keeper.start();
        }
    }

    function open(resolved) {
        if (!resolved || resolved.state !== "parked" || !resolved.model) return;
        if (window.KernelTape && typeof window.KernelTape.closeInspector === "function") {
            window.KernelTape.closeInspector();
        }
        if (typeof window.closeOpenKernelCards === "function") window.closeOpenKernelCards();
        state.resolved = resolved;
        state.focus = "syscall";
        render();
    }

    function refresh() {
        if (!state.resolved) return;
        const pid = state.resolved.process && state.resolved.process.pid;
        if (pid && window.KernelTraceLens && typeof window.KernelTraceLens.resolve === "function") {
            const latest = window.KernelTraceLens.resolve(pid);
            if (latest && latest.state === "parked") state.resolved = latest;
        }
        render();
    }

    window.addEventListener("keydown", event => {
        if (event.key === "Escape" && state.resolved) close();
    });

    window.TraceContextWorkbench = {
        open,
        close,
        refresh,
        isOpen: () => Boolean(state.resolved),
        openedPid: () => state.resolved && state.resolved.process
            ? state.resolved.process.pid
            : null
    };
})();
