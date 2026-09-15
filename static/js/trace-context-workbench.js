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
        const processThreads = Number(process.num_threads);
        const cpuPercent = Number(process.cpu_percent);
        const memoryMb = Number(process.memory_mb);
        const fileDescriptors = Number(process.num_fds);
        const scope = String(resolved.scope || model.scope || "UNKNOWN SCOPE").toUpperCase();
        const source = String(model.source || "/proc/PID/syscall").toUpperCase();
        return {
            taskName,
            pid,
            tid: trace.tid || "—",
            state: String(trace.state || "PARKED").toUpperCase(),
            syscall,
            syscallNumber: trace.nr === undefined || trace.nr === null ? "—" : trace.nr,
            subsystem,
            mechanism,
            threadCount,
            processStatus: String(process.status || trace.state || "NOT OBSERVED").toUpperCase(),
            processThreads: Number.isFinite(processThreads) ? processThreads : "—",
            cpuPercent: Number.isFinite(cpuPercent) ? `${cpuPercent.toFixed(1)}%` : "—",
            memory: Number.isFinite(memoryMb) ? `${memoryMb.toFixed(1)} MB` : "—",
            fileDescriptors: Number.isFinite(fileDescriptors) ? fileDescriptors : "—",
            command: String(process.cmdline || taskName),
            syscallArgs: Array.isArray(trace.args) ? trace.args : [],
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

    function backdropDiagram(layer) {
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
    }

    function processPortrait(layer, x, y, width, height, values) {
        const seedText = `${values.pid}:${values.taskName}:${values.syscall}:${values.subsystem}`;
        let seed = 2166136261;
        for (let index = 0; index < seedText.length; index += 1) {
            seed ^= seedText.charCodeAt(index);
            seed = Math.imul(seed, 16777619);
        }
        seed >>>= 0;

        const uid = `trace-portrait-${String(values.pid).replace(/\W/g, "")}-${seed}`;
        const centerX = x + width / 2;
        const faceWidth = 22 + (seed % 7);
        const eyeGap = 7 + ((seed >>> 3) % 4);
        const faceTop = y + 9;
        const jawY = y + 52;
        const isSleeping = /SLEEP|PARK|WAIT|IDLE/i.test(values.state);
        const subsystemCode = String(values.subsystem || "??").replace(/\s+/g, "").slice(0, 3);
        const syscallCode = Number(values.syscallNumber);
        const signal = Number.isFinite(syscallCode) ? Math.abs(syscallCode) % 100 : seed % 100;

        const portrait = layer.append("g")
            .attr("class", "trace-workbench-portrait")
            .attr("data-profile-seed", seed)
            .attr("data-process-state", values.state);
        const defs = portrait.append("defs");
        defs.append("clipPath")
            .attr("id", `${uid}-clip`)
            .append("rect")
            .attr("x", x + 1).attr("y", y + 1)
            .attr("width", width - 2).attr("height", height - 2);
        const backdrop = defs.append("linearGradient")
            .attr("id", `${uid}-backdrop`)
            .attr("x1", "0%").attr("y1", "0%")
            .attr("x2", "100%").attr("y2", "100%");
        backdrop.append("stop").attr("offset", "0%").attr("stop-color", "#9da6a4");
        backdrop.append("stop").attr("offset", "52%").attr("stop-color", "#626d6d");
        backdrop.append("stop").attr("offset", "100%").attr("stop-color", "#20292b");
        const skin = defs.append("linearGradient")
            .attr("id", `${uid}-skin`)
            .attr("x1", "15%").attr("y1", "15%")
            .attr("x2", "90%").attr("y2", "85%");
        skin.append("stop").attr("offset", "0%").attr("stop-color", "#c2c6c0");
        skin.append("stop").attr("offset", "58%").attr("stop-color", "#858c88");
        skin.append("stop").attr("offset", "100%").attr("stop-color", "#485052");
        const grain = defs.append("filter")
            .attr("id", `${uid}-grain`)
            .attr("x", "-10%").attr("y", "-10%")
            .attr("width", "120%").attr("height", "120%");
        grain.append("feTurbulence")
            .attr("type", "fractalNoise")
            .attr("baseFrequency", "0.82")
            .attr("numOctaves", 1)
            .attr("seed", seed % 97)
            .attr("result", "noise");
        grain.append("feColorMatrix")
            .attr("in", "noise")
            .attr("type", "matrix")
            .attr("values", "0 0 0 0 0.22  0 0 0 0 0.26  0 0 0 0 0.27  0 0 0 0.16 0")
            .attr("result", "grain");
        const merge = grain.append("feMerge");
        merge.append("feMergeNode").attr("in", "SourceGraphic");
        merge.append("feMergeNode").attr("in", "grain");

        portrait.append("rect")
            .attr("x", x).attr("y", y).attr("width", width).attr("height", height)
            .attr("fill", "rgba(103,200,224,0.04)")
            .attr("stroke", BLUE).attr("stroke-width", 0.75);

        const image = portrait.append("g")
            .attr("class", "trace-workbench-portrait-image")
            .attr("clip-path", `url(#${uid}-clip)`)
            .attr("filter", `url(#${uid}-grain)`);
        image.append("rect")
            .attr("x", x + 1).attr("y", y + 1)
            .attr("width", width - 2).attr("height", height - 2)
            .attr("fill", `url(#${uid}-backdrop)`);

        [10, 17, 24].forEach((radius, index) => {
            image.append("circle")
                .attr("cx", x + width - 8).attr("cy", y + 10)
                .attr("r", radius)
                .attr("fill", "none")
                .attr("stroke", index === signal % 3 ? "rgba(226,163,62,0.23)" : "rgba(210,226,224,0.12)")
                .attr("stroke-width", 0.55);
        });
        image.append("text")
            .attr("x", x + width - 4).attr("y", y + 8)
            .attr("text-anchor", "end")
            .attr("font-family", FONT).attr("font-size", 4.2)
            .attr("letter-spacing", 0.4)
            .attr("fill", "rgba(236,241,236,0.7)")
            .text(subsystemCode);

        image.append("path")
            .attr("class", "trace-workbench-portrait-shoulders")
            .attr("d", `M${x + 5},${y + height + 3} Q${x + 10},${y + 56} ${centerX - 8},${y + 52} H${centerX + 8} Q${x + width - 10},${y + 56} ${x + width - 5},${y + height + 3} Z`)
            .attr("fill", "#1f292b");
        image.append("path")
            .attr("d", `M${centerX - 7},${y + 45} L${centerX - 8},${y + 57} Q${centerX},${y + 63} ${centerX + 8},${y + 57} L${centerX + 7},${y + 45} Z`)
            .attr("fill", "#777f7c");

        image.append("ellipse")
            .attr("cx", centerX - faceWidth / 2).attr("cy", y + 31)
            .attr("rx", 3.2).attr("ry", 6).attr("fill", "#777f7c");
        image.append("ellipse")
            .attr("cx", centerX + faceWidth / 2).attr("cy", y + 31)
            .attr("rx", 3.2).attr("ry", 6).attr("fill", "#5b6463");
        image.append("path")
            .attr("class", "trace-workbench-portrait-face")
            .attr("d", `M${centerX},${faceTop} C${centerX - faceWidth * 0.62},${faceTop} ${centerX - faceWidth * 0.58},${y + 29} ${centerX - faceWidth * 0.4},${y + 41} Q${centerX - 7},${jawY} ${centerX},${jawY + 2} Q${centerX + 7},${jawY} ${centerX + faceWidth * 0.4},${y + 41} C${centerX + faceWidth * 0.58},${y + 29} ${centerX + faceWidth * 0.62},${faceTop} ${centerX},${faceTop} Z`)
            .attr("fill", `url(#${uid}-skin)`)
            .attr("stroke", "rgba(225,228,221,0.32)")
            .attr("stroke-width", 0.45);

        const browY = y + 25;
        const eyeY = y + 28;
        [-1, 1].forEach(side => {
            image.append("line")
                .attr("x1", centerX + side * (eyeGap - 4)).attr("x2", centerX + side * (eyeGap + 3))
                .attr("y1", browY + (side < 0 ? 0.5 : 0)).attr("y2", browY - 0.7)
                .attr("stroke", "#303738").attr("stroke-width", 1.2);
            image.append("ellipse")
                .attr("cx", centerX + side * eyeGap).attr("cy", eyeY)
                .attr("rx", 2.5).attr("ry", isSleeping ? 0.35 : 0.9)
                .attr("fill", "#252c2d");
        });
        image.append("path")
            .attr("d", `M${centerX + 1},${y + 29} L${centerX - 1},${y + 38} L${centerX + 3},${y + 39}`)
            .attr("fill", "none").attr("stroke", "rgba(43,49,49,0.74)")
            .attr("stroke-width", 0.8);
        image.append("path")
            .attr("d", `M${centerX - 5},${y + 45} Q${centerX},${y + 46 + (seed % 3)} ${centerX + 5},${y + 45}`)
            .attr("fill", "none").attr("stroke", "#303738").attr("stroke-width", 0.9);

        if ((seed >>> 7) % 3 !== 0) {
            image.append("path")
                .attr("d", `M${centerX - 9},${y + 39} Q${centerX},${y + 44} ${centerX + 9},${y + 39} Q${centerX + 8},${y + 52} ${centerX},${y + 54} Q${centerX - 8},${y + 52} ${centerX - 9},${y + 39} Z`)
                .attr("fill", "rgba(29,35,36,0.38)");
        }

        for (let offset = 5; offset < height; offset += 5) {
            rule(image, x + 1, y + offset, x + width - 1, y + offset, "rgba(225,238,234,0.055)");
        }
        const scanLine = image.append("line")
            .attr("class", "trace-workbench-portrait-scan")
            .attr("x1", x + 2).attr("x2", x + width - 2)
            .attr("y1", y + 4).attr("y2", y + 4)
            .attr("stroke", "rgba(226,163,62,0.42)")
            .attr("stroke-width", 0.65);
        if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            scanLine.append("animate")
                .attr("attributeName", "transform")
                .attr("values", `translate(0 0);translate(0 ${height - 8});translate(0 0)`)
                .attr("dur", `${3.2 + (seed % 7) * 0.13}s`)
                .attr("repeatCount", "indefinite");
        }

        rule(portrait, x + 5, y + 5, x + 15, y + 5, ACCENT);
        rule(portrait, x + 5, y + 5, x + 5, y + 15, ACCENT);
        rule(portrait, x + width - 5, y + height - 5, x + width - 15, y + height - 5, ACCENT);
        rule(portrait, x + width - 5, y + height - 5, x + width - 5, y + height - 15, ACCENT);
        text(portrait, `PID ${values.pid}`, x + width / 2, y + height + 11, 5.8, DIM, {
            anchor: "middle",
            spacing: 0.7
        });
        portrait.append("title").text(
            `Dynamic kernel portrait · PID ${values.pid} · ${values.taskName} · ${values.syscall}() · ${values.subsystem}`
        );
    }

    function subjectCard(layer, values) {
        const card = layer.append("g").attr("class", "trace-workbench-subject-card");
        card.append("path")
            .attr("d", chamferPath(66, 169, 424, 128, 10))
            .attr("transform", "translate(5,5)")
            .attr("fill", "rgba(0,0,0,0.32)");
        card.append("path")
            .attr("d", chamferPath(66, 169, 424, 128, 10))
            .attr("fill", PANEL_SOFT).attr("stroke", FAINT).attr("stroke-width", 0.8);
        text(card, "TASK STRUCTURE", 80, 187, 7, DIM, { spacing: 1.1 });
        text(card, `OBSERVED SNAPSHOT / ${values.scope}`, 476, 187, 6, DIM, {
            anchor: "end",
            spacing: 0.45
        });
        rule(card, 80, 194, 476, 194, FAINT);

        const columns = [80, 214, 348];
        const rows = [
            [
                ["PID / TGID", `${values.pid} / ${values.pid}`],
                ["TID", values.tid],
                ["COMM", clip(values.taskName, 17)]
            ],
            [
                ["TASK STATE", clip(values.processStatus, 16)],
                ["THREAD GROUP", values.processThreads],
                ["CPU SAMPLE", values.cpuPercent]
            ],
            [
                ["RSS", values.memory],
                ["FILES_STRUCT", `${values.fileDescriptors} FD`],
                ["SYSCALL NR", values.syscallNumber]
            ]
        ];
        rows.forEach((row, rowIndex) => {
            const top = 207 + rowIndex * 24;
            row.forEach((field, columnIndex) => {
                const left = columns[columnIndex];
                text(card, field[0], left, top, 5.2, DIM, { spacing: 0.6 });
                text(card, clip(field[1], 18), left, top + 11, 7.6, rowIndex === 1 && columnIndex === 0 ? ACCENT : PAPER, {
                    spacing: 0.25
                });
            });
            if (rowIndex < rows.length - 1) rule(card, 80, top + 16, 476, top + 16, "rgba(244,244,236,0.07)");
        });
        [201, 335].forEach(columnX => rule(card, columnX, 201, columnX, 271, "rgba(103,200,224,0.12)"));

        rule(card, 80, 274, 476, 274, FAINT);
        text(card, "WCHAN", 80, 288, 5.2, DIM, { spacing: 0.65 });
        text(card, clip(values.mechanism, 34), 122, 288, 6.5, ACCENT, { spacing: 0.25 });
        text(card, `AGE ${values.age}`, 476, 288, 5.4, DIM, { anchor: "end", spacing: 0.5 });
        card.append("title").text(
            `${values.command}\nargs: ${values.syscallArgs.length ? values.syscallArgs.join(", ") : "not observed"}`
        );
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
        text(card, "KERNEL ASSESSMENT", 116, 42, 7.2, PAPER, { spacing: 1.15 });
        text(card, values.observedAt, 524, 42, 5.5, DIM, { anchor: "end", spacing: 0.35 });

        processPortrait(card, 110, 65, 70, 77, values);
        text(card, clip(values.taskName, 24), 197, 77, 15.5, PAPER, {
            weight: 500,
            spacing: 0.4
        });
        text(card, `CLASSIFICATION [${clip(values.subsystem, 16)}]`, 197, 93, 7.5, BLUE, {
            spacing: 0.8
        });
        rule(card, 197, 101, 516, 101, FAINT);
        text(card, "Overall Assessment:", 197, 115, 6.5, DIM, { spacing: 0.25 });
        text(card, `PARKED · ${clip(values.syscall, 19)}()`, 197, 132, 9.5, PAPER, {
            spacing: 0.45
        });
        text(card, clip(`Waiting in ${values.mechanism}`, 47), 197, 148, 7, INK, {
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
                eyebrow: "TASK IDENTITY",
                value: `${values.taskName} · PID ${values.pid} · TID ${values.tid}`,
                detail: `STATE ${values.state} · ${values.threadCount} OBSERVED THREAD${values.threadCount === 1 ? "" : "S"}`
            },
            syscall: {
                eyebrow: "PARKED SYSTEM CALL",
                value: `${values.syscall}()`,
                detail: `SYSCALL NR ${values.syscallNumber} · CURRENT SNAPSHOT, NOT INSTRUCTION FLOW`
            },
            subsystem: {
                eyebrow: "KERNEL OWNERSHIP DOMAIN",
                value: values.subsystem,
                detail: "NEXT DOMAIN IN THE OBSERVED CAUSAL THREAD"
            },
            mechanism: {
                eyebrow: "WAIT MECHANISM",
                value: values.mechanism,
                detail: "KERNEL WAIT CHANNEL / RESOLVED MECHANISM"
            },
            evidence: {
                eyebrow: "SOURCE EVIDENCE",
                value: values.source,
                detail: `${values.scope} · CLICK AGAIN TO OPEN THE EVENT INSPECTOR`
            }
        };
        return details[id] || details.syscall;
    }

    function causalThread(layer, values) {
        const deck = layer.append("g").attr("class", "trace-workbench-deck");
        deck.append("path")
            .attr("d", chamferPath(38, 308, 562, 118, 11))
            .attr("fill", "rgba(6,10,14,0.93)")
            .attr("stroke", "rgba(103,200,224,0.24)").attr("stroke-width", 0.75);
        const selected = detailFor(values, state.focus);
        text(deck, selected.eyebrow, 54, 327, 6.2, ACCENT, { spacing: 1 });
        text(deck, clip(selected.value, 62), 54, 345, 9.2, PAPER, { spacing: 0.4 });
        text(deck, clip(selected.detail, 82), 54, 360, 5.8, DIM, { spacing: 0.35 });
        rule(deck, 54, 368, 584, 368, FAINT);

        const path = Array.isArray(values.model.path) ? values.model.path : [];
        const entries = path.length ? path.slice(0, 6) : [
            ["TASK", values.taskName],
            ["SYSCALL", values.syscall],
            ["SUBSYSTEM", values.subsystem],
            ["MECHANISM", values.mechanism],
            ["SAMPLE", values.source]
        ];
        const left = 58;
        const right = 580;
        const y = 393;
        const step = entries.length > 1 ? (right - left) / (entries.length - 1) : 0;
        rule(deck, left, y, right, y, "rgba(103,200,224,0.28)");
        entries.forEach((entry, index) => {
            const id = index === 0 ? "task"
                : index === 2 ? "syscall"
                    : index === 3 ? "subsystem"
                        : index === 4 ? "mechanism"
                            : index === entries.length - 1 ? "evidence"
                                : "task";
            const x = left + index * step;
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
            item.append("circle")
                .attr("cx", x).attr("cy", y).attr("r", active ? 5.2 : 4)
                .attr("fill", active ? ACCENT : PANEL)
                .attr("stroke", active ? ACCENT : BLUE).attr("stroke-width", 0.8);
            text(
                item,
                clip(String(entry[0] || "").replace(/^\d+\s*·\s*/, ""), 11),
                x,
                y + 18,
                5.2,
                active ? ACCENT : DIM,
                { anchor: "middle", spacing: 0.25 }
            );
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

        backdropDiagram(layer);
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
