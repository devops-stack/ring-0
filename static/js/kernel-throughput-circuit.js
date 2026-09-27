// The kernel's flow circuit, opened from the Ring-0 nucleus.
//
// A machine has no single speed, so this screen refuses to invent one. Each
// sector keeps its own unit, and a marker's position along its sector is that
// sector against its own recent peak — never against another sector's numbers.
// The peak is only what this page has watched since it loaded, which is said
// out loud on the screen rather than implied.
const KernelThroughputCircuit = (() => {
    const GAP = 0.055;
    // Markers stay inside their own window so two chips never meet.
    const TRAVEL_MIN = 0.1;
    const TRAVEL_MAX = 0.9;
    const STALE_MS = 8000;
    const REFRESH_MS = 2000;

    const AMBER = "#e2a33e";
    const CYAN = "#67c8e0";
    const LIGHT = "rgba(244,244,236,0.92)";
    const DIM = "rgba(244,244,236,0.46)";
    const FAINT = "rgba(244,244,236,0.22)";
    const RAIL = "rgba(244,244,236,0.58)";
    const CHIP_FILL = "rgba(244,244,236,0.94)";
    const CHIP_INK = "#14181c";
    const MONO = "Share Tech Mono, monospace";

    const SECTORS = [
        {
            id: "sched", code: "SCH", label: "SCHEDULER", floor: 6000,
            unit: "CONTEXT SWITCHES / S",
            value: (data) => finite(data.ctxt_per_sec),
            format: (value) => countRate(value),
            detail: (data) => `${countRate(finite(data.ctxt_per_sec))} SWITCHES`,
            focus: "process_scheduler", card: "WakeupsCard"
        },
        {
            id: "memory", code: "MEM", label: "MEMORY", floor: 50000,
            unit: "PAGE FAULTS / S",
            value: (data) => finite(data.pgfault_per_sec),
            format: (value) => countRate(value),
            detail: (data) => `${countRate(finite(data.pgmajfault_per_sec))} MAJOR · `
                + `${countRate(finite(data.pswpin_per_sec) + finite(data.pswpout_per_sec))} SWAP`,
            focus: "memory_management", card: "SlubCard"
        },
        {
            id: "block", code: "BLK", label: "BLOCK I/O", floor: 80,
            unit: "MEGABYTES / S",
            value: (data) => finite(data.disk_read_mb_s) + finite(data.disk_write_mb_s),
            format: (value) => byteRate(value),
            detail: (data) => `${countRate(finite(data.disk_read_iops) + finite(data.disk_write_iops))} IOPS`,
            focus: "file_system"
        },
        {
            id: "network", code: "NET", label: "NETWORK", floor: 50,
            unit: "MEGABYTES / S",
            value: (data) => finite(data.net_mb_s),
            format: (value) => byteRate(value),
            detail: () => "RX + TX ON EVERY INTERFACE",
            focus: "network_stack"
        },
        {
            id: "irq", code: "IRQ", label: "INTERRUPTS", floor: 25000,
            unit: "HARD IRQ / S",
            value: (data) => finite(data.intr_per_sec),
            format: (value) => countRate(value),
            detail: (data) => `${countRate(finite(data.intr_per_sec))} SERVICED`
        }
    ];

    const state = {
        open: false,
        // A tap-outside on the phone is a real dismiss: do not reopen the
        // default mobile screen until they open it again themselves.
        dismissed: false,
        autoOpened: false,
        data: null,
        observedAt: 0,
        peaks: Object.fromEntries(SECTORS.map((sector) => [sector.id, sector.floor])),
        history: [],
        timer: null,
        topKeeper: null
    };

    function finite(value) {
        const number = Number(value);
        return Number.isFinite(number) ? Math.max(0, number) : 0;
    }

    function reducedMotion() {
        return typeof window.matchMedia === "function"
            && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    function countRate(value) {
        const number = finite(value);
        if (number >= 1000000) return `${(number / 1000000).toFixed(1)}M/S`;
        if (number >= 10000) return `${Math.round(number / 1000)}K/S`;
        if (number >= 1000) return `${(number / 1000).toFixed(1)}K/S`;
        return `${Math.round(number)}/S`;
    }

    function byteRate(value) {
        const number = finite(value);
        if (number >= 10) return `${number.toFixed(0)}M/S`;
        if (number >= 1) return `${number.toFixed(1)}M/S`;
        if (number > 0) return `${Math.max(1, Math.round(number * 1024))}K/S`;
        return "0K/S";
    }

    function polar(cx, cy, radius, angle) {
        return {
            x: cx + Math.cos(angle) * radius,
            y: cy + Math.sin(angle) * radius
        };
    }

    function angles(index) {
        const step = Math.PI * 2 / SECTORS.length;
        const start = -Math.PI * 0.9 + index * step + GAP;
        const end = -Math.PI * 0.9 + (index + 1) * step - GAP;
        return { start, end, mid: (start + end) / 2 };
    }

    function travelAngle(sectorAngles, pressure) {
        const eased = TRAVEL_MIN + Math.min(1, Math.max(0, pressure)) * (TRAVEL_MAX - TRAVEL_MIN);
        return sectorAngles.start + (sectorAngles.end - sectorAngles.start) * eased;
    }

    function values(data, stale) {
        return SECTORS.map((sector) => {
            const value = data && !stale ? sector.value(data) : 0;
            const peak = Math.max(sector.floor, finite(state.peaks[sector.id]));
            return {
                ...sector,
                value,
                peak,
                known: !!data && !stale,
                share: value > 0 ? Math.min(1, value / peak) : 0,
                pressure: value > 0 ? Math.min(1, Math.sqrt(value / peak)) : 0
            };
        });
    }

    function emitFocus(sector, source) {
        if (!sector.focus) return;
        window.dispatchEvent(new CustomEvent("syscall-subsystem-focus", {
            detail: { subsystemKey: source === "leave" ? null : sector.focus, source: `flow-${source}` }
        }));
    }

    function drillDown(sector, at) {
        const card = sector.card && window[sector.card];
        if (!card || typeof card.open !== "function") {
            emitFocus(sector, "click");
            return;
        }
        close("user");
        card.open({ x: at.x, y: at.y, clearOf: at.x + 28 });
    }

    // The mobile composition frames the hero with a viewBox, so screen pixels
    // are not the coordinates this overlay is drawn in. Read the frame the svg
    // is actually using, or fall back to its box on desktop.
    function frame() {
        const node = d3.select("svg").node();
        const viewBox = node && node.getAttribute("viewBox");
        if (viewBox) {
            const [x, y, w, h] = viewBox.trim().split(/[\s,]+/).map(Number);
            if ([x, y, w, h].every(Number.isFinite) && w > 0 && h > 0) return { x, y, w, h };
        }
        return {
            x: 0,
            y: 0,
            w: (node && node.clientWidth) || window.innerWidth,
            h: (node && node.clientHeight) || window.innerHeight
        };
    }

    function layout() {
        const box = frame();
        const columns = box.w >= 1100;
        // The phone composition frames the hero inside a much taller viewBox;
        // there the ring is stacked from the top, everywhere else it is held on
        // the nucleus so the logo does not jump when the screen opens.
        const tall = box.h > box.w * 1.4;
        // What the layout needs under the ring: the caption, the sector rows
        // and the footnotes when they are stacked rather than in columns.
        const below = columns ? 70 : 226;
        const above = columns ? 70 : 28;
        const radius = Math.max(92, Math.min(
            250,
            box.w * 0.19,
            box.w / 2 - 124,
            (box.h - above - below - 60) / 2
        ));
        const band = Math.max(8, radius * 0.06);
        const halo = radius + band + 24;
        const minCy = box.y + above + halo;
        const maxCy = box.y + box.h - below - halo;
        const cy = tall || maxCy < minCy
            ? box.y + radius + 112
            : Math.min(Math.max(box.y + box.h / 2, minCy), maxCy);
        const rowsTop = cy + radius + band + 78;
        return {
            x: box.x,
            y: box.y,
            w: box.w,
            h: box.h,
            columns,
            radius,
            band,
            cx: box.x + box.w / 2,
            cy,
            rowsTop,
            // On a phone the fixed activity tape owns the bottom of the screen,
            // so the notes follow the rows instead of the frame's edge.
            notesTop: rowsTop + 6 + SECTORS.length * 22 + 28
        };
    }

    function close(reason) {
        if (!state.open) return;
        state.open = false;
        state.autoOpened = false;
        if (reason === "user") state.dismissed = true;
        if (state.timer) {
            window.clearInterval(state.timer);
            state.timer = null;
        }
        d3.select("svg").selectAll(".flow-circuit-scrim, .flow-circuit-layer").interrupt().remove();
        if (state.topKeeper) state.topKeeper.stop();
        d3.select("body").on("keydown.flowcircuit", null);
        window.dispatchEvent(new CustomEvent("kcard-closed"));
    }

    function show(options) {
        options = options || {};
        if (state.open) return;
        if (typeof closeOpenKernelCards === "function") closeOpenKernelCards();
        state.open = true;
        state.autoOpened = options.auto === true;
        if (!state.autoOpened) state.dismissed = false;
        mount();
        refresh();
        state.timer = window.setInterval(refresh, REFRESH_MS);
        d3.select("body").on("keydown.flowcircuit", (event) => {
            if (event.key === "Escape") close("user");
        });
    }

    function open() {
        if (state.open) {
            close("user");
            return;
        }
        show();
    }

    function isAtlasMode() {
        return Boolean(window.KernelAtlasPoc && typeof window.KernelAtlasPoc.isEnabled === "function"
            && window.KernelAtlasPoc.isEnabled());
    }

    function isMobileViewport() {
        return typeof isMobileLayout === "function" && isMobileLayout();
    }

    // Phone: the flow circuit is the home screen. Desktop still opens from
    // the nucleus. A user dismiss on the phone sticks until they open it.
    function syncToViewport() {
        if (isAtlasMode()) {
            if (state.autoOpened) close();
            else refit();
            return;
        }
        if (isMobileViewport() && !state.open && !state.dismissed) {
            show({ auto: true });
            return;
        }
        if (!isMobileViewport() && state.autoOpened) {
            close();
            return;
        }
        refit();
    }

    function refresh() {
        if (!state.open || document.hidden) return;
        const request = window.fetchJson
            ? window.fetchJson("/api/io-pulse", { cache: "no-store" },
                { timeoutMs: 5000, retries: 0, context: "flow-circuit" })
            : fetch("/api/io-pulse", { cache: "no-store" }).then((response) => response.json());
        Promise.resolve(request)
            .then((data) => {
                if (!data) return;
                ingest(data, Date.now());
            })
            .catch(() => {});
    }

    function mount() {
        const box = layout();
        const svgRoot = d3.select("svg");
        svgRoot.selectAll(".flow-circuit-scrim, .flow-circuit-layer").remove();

        svgRoot.append("rect")
            .attr("class", "flow-circuit-scrim")
            .attr("x", box.x - 80).attr("y", box.y - 80)
            .attr("width", box.w + 160).attr("height", box.h + 160)
            .attr("fill", "#0a0c0f")
            .style("cursor", "pointer")
            .style("opacity", 0)
            .on("click", () => close("user"))
            .transition().duration(reducedMotion() ? 0 : 200).style("opacity", 0.985);

        const layer = svgRoot.append("g")
            .attr("class", "flow-circuit-layer")
            .style("opacity", 0);
        layer.transition().delay(reducedMotion() ? 0 : 120).duration(reducedMotion() ? 0 : 200)
            .style("opacity", 1);

        if (!state.topKeeper && typeof createOverlayTopKeeper === "function") {
            state.topKeeper = createOverlayTopKeeper(
                "flow-circuit-scrim", ["flow-circuit-layer"], () => state.open
            );
        }
        if (state.topKeeper) state.topKeeper.start();

        drawChrome(layer, box);
        drawRing(layer, box);
        drawLoadRays(layer, box);
        if (box.columns) {
            drawSectorColumn(layer, box);
            drawPeakColumn(layer, box);
        } else {
            drawCompactRows(layer, box);
        }
        drawConnectionDoor(layer, box);
        paint();
    }

    function drawConnectionDoor(layer, box) {
        const pad = box.columns ? 34 : 22;
        const x = box.columns
            ? box.x + pad + 292
            : box.x + pad;
        const y = box.columns
            ? box.y + 40
            : box.cy + box.radius + box.band + 26;
        const door = layer.append("g")
            .attr("class", "flow-cdev-door")
            .style("cursor", "pointer")
            .on("click", (event) => {
                event.stopPropagation();
                if (window.ConnectionDevice) window.ConnectionDevice.open();
            });
        door.append("rect")
            .attr("x", x - 6).attr("y", y - 14)
            .attr("width", 118).attr("height", 20)
            .attr("fill", "rgba(255,255,255,0.001)");
        label(door, "flow-cdev-door-label", x, y, "CONNECTION", {
            size: box.columns ? 10 : 8.5, fill: CYAN, spacing: 1.2
        });
    }

    function label(parent, cls, x, y, text, options = {}) {
        return parent.append("text")
            .attr("class", cls)
            .attr("x", x).attr("y", y)
            .attr("text-anchor", options.anchor || "start")
            .attr("font-family", MONO)
            .attr("font-size", options.size || 10)
            .attr("letter-spacing", options.spacing === undefined ? 0.6 : options.spacing)
            .attr("fill", options.fill || LIGHT)
            .text(text);
    }

    function drawChrome(layer, box) {
        const pad = box.columns ? 34 : 22;
        const left = box.x + pad;
        const right = box.x + box.w - pad;
        const bottom = box.y + box.h;

        if (box.columns) {
            label(layer, "flow-circuit-title", left, box.y + 40, "KERNEL FLOW · SECTOR TIMING",
                { size: 13, spacing: 1.6 });
            label(layer, "flow-circuit-source", right, box.y + 40, "IO PULSE", {
                size: 10, anchor: "end", fill: DIM
            });
            layer.append("line")
                .attr("x1", left).attr("y1", box.y + 50).attr("x2", right).attr("y2", box.y + 50)
                .attr("stroke", FAINT).attr("stroke-width", 0.7);
        } else {
            // The top strip of a phone screen belongs to fixed HTML chrome (the
            // desktop notice), which this svg layer cannot draw above, so the
            // heading lives with the caption under the ring instead.
            label(layer, "flow-circuit-source", right,
                box.cy + box.radius + box.band + 26, "IO PULSE", {
                    size: 8.5, anchor: "end", fill: DIM
                });
        }

        if (box.columns) {
            label(layer, "flow-circuit-note", left, bottom - 34,
                "EACH SECTOR KEEPS ITS OWN UNIT · A MARKER IS THAT SECTOR AGAINST ITS OWN RECENT PEAK",
                { size: 9, fill: DIM });
            label(layer, "flow-circuit-note", left, bottom - 22,
                "THE PEAK IS WHAT THIS PAGE HAS WATCHED SINCE IT LOADED, NOT A HARDWARE LIMIT",
                { size: 9, fill: FAINT });
            label(layer, "flow-circuit-close", right, bottom - 22,
                "ESC OR CLICK OUTSIDE TO CLOSE", { size: 9, anchor: "end", fill: FAINT });
            return;
        }

        // Narrow frames cannot hold the long notes on one line, and the close
        // hint would land on top of them.
        const notes = Math.min(box.notesTop, box.y + box.h - 48);
        label(layer, "flow-circuit-note", left, notes,
            "EACH SECTOR KEEPS ITS OWN UNIT", { size: 8.5, fill: DIM });
        label(layer, "flow-circuit-note", left, notes + 11,
            "A MARKER IS THAT SECTOR AGAINST ITS OWN PEAK", { size: 8.5, fill: FAINT });
        label(layer, "flow-circuit-note", left, notes + 22,
            "THE PEAK IS WHAT THIS PAGE HAS SEEN, NOT A LIMIT", { size: 8.5, fill: FAINT });
        label(layer, "flow-circuit-close", left, notes + 36,
            "TAP OUTSIDE TO CLOSE", { size: 8.5, fill: FAINT });
    }

    function drawRing(layer, box) {
        const ring = layer.append("g").attr("class", "flow-circuit-ring");
        const railIn = box.radius;
        const railOut = box.radius + box.band;

        [railIn, railOut].forEach((radius, index) => {
            ring.append("circle")
                .attr("class", index === 0 ? "flow-rail flow-rail-inner" : "flow-rail flow-rail-outer")
                .attr("cx", box.cx).attr("cy", box.cy).attr("r", radius)
                .attr("fill", "none").attr("stroke", RAIL).attr("stroke-width", 1.1)
                .attr("pointer-events", "none");
        });

        ring.append("g").attr("class", "flow-circuit-trail").attr("pointer-events", "none");

        const splits = ring.append("g").attr("class", "flow-circuit-splits").attr("pointer-events", "none");
        SECTORS.forEach((sector, index) => {
            const sectorAngles = angles(index);
            const inner = polar(box.cx, box.cy, railIn - 5, sectorAngles.start);
            const outer = polar(box.cx, box.cy, railOut + 5, sectorAngles.start);
            const node = polar(box.cx, box.cy, (railIn + railOut) / 2, sectorAngles.start);
            splits.append("line")
                .attr("x1", inner.x).attr("y1", inner.y)
                .attr("x2", outer.x).attr("y2", outer.y)
                .attr("stroke", FAINT).attr("stroke-width", 0.8);
            splits.append("circle")
                .attr("cx", node.x).attr("cy", node.y).attr("r", 2.6)
                .attr("fill", "#0a0c0f").attr("stroke", RAIL).attr("stroke-width", 0.9);

            const indexAt = polar(box.cx, box.cy, railIn - 20, sectorAngles.mid);
            label(splits, "flow-sector-index", indexAt.x, indexAt.y + 3.4,
                `0${index + 1}`, { size: 10, anchor: "middle", fill: CYAN, spacing: 1 });
        });

        const sectors = ring.append("g").attr("class", "flow-circuit-sectors");
        SECTORS.forEach((sector, index) => {
            const sectorAngles = angles(index);
            const item = sectors.append("g")
                .attr("class", `flow-sector flow-sector-${sector.id}`)
                .attr("data-sector", sector.id);

            item.append("path")
                .attr("class", "flow-sector-hit")
                .attr("d", arcBand(box.cx, box.cy, railIn - 8, railOut + 8, sectorAngles.start, sectorAngles.end))
                .attr("fill", "rgba(255,255,255,0.001)")
                .style("cursor", sector.card ? "pointer" : "crosshair")
                .on("click", (event) => {
                    event.stopPropagation();
                    drillDown(sector, polar(box.cx, box.cy, railOut + 10, sectorAngles.mid));
                });

            item.append("line")
                .attr("class", "flow-sector-marker")
                .attr("stroke", CYAN).attr("stroke-width", 2.4)
                .attr("stroke-linecap", "round")
                .attr("pointer-events", "none");

            const chip = item.append("g")
                .attr("class", "flow-sector-chip")
                .style("cursor", sector.card ? "pointer" : "crosshair")
                .on("click", (event) => {
                    event.stopPropagation();
                    drillDown(sector, polar(box.cx, box.cy, railOut + 10, sectorAngles.mid));
                });
            chip.append("rect")
                .attr("class", "flow-chip-body")
                .attr("x", -19).attr("y", -8).attr("width", 38).attr("height", 16)
                .attr("rx", 8).attr("ry", 8)
                .attr("fill", CHIP_FILL);
            chip.append("path")
                .attr("class", "flow-chip-flag")
                .attr("d", "M-19,-8 L-9,-8 L-13.5,8 L-19,8 A8,8 0 0 1 -19,-8 Z")
                .attr("fill", CYAN);
            label(chip, "flow-chip-code", 4, 3.4, sector.code, {
                size: 9, anchor: "middle", fill: CHIP_INK, spacing: 0.9
            });
            label(chip, "flow-chip-value", 26, 3.4, "WARMING", { size: 9, fill: DIM });
            chip.append("title").text(`${sector.label} · ${sector.unit}`);
        });

        const core = ring.append("g")
            .attr("class", "flow-circuit-core")
            .attr("pointer-events", "none");
        const logo = box.columns ? 68 : 52;
        core.append("image")
            .attr("xlink:href", "static/images/009.png")
            .attr("x", box.cx - logo / 2)
            .attr("y", box.cy - logo / 2)
            .attr("width", logo).attr("height", logo)
            .attr("opacity", 0.9);

        // Desktop: the loadavg rays occupy the hole under the logo, so the
        // caption does not sit there. On a phone it stays under the ring.
        if (box.columns) return;
        const captionY = box.cy + box.radius + box.band + 26;
        label(core, "flow-core-title", box.cx, captionY, "MACHINE FLOW", {
            size: 10, anchor: "middle", spacing: 2.4
        });
        label(core, "flow-core-leader", box.cx, captionY + 14, "WARMING", {
            size: 8.5, anchor: "middle", fill: DIM, spacing: 1
        });
    }

    function loadRayFrame(box) {
        const scale = box.columns ? 1 : 0.78;
        const height = box.columns ? 118 : 92;
        // Desktop: keep the left dock, but sit at the old hole-under-logo
        // height so the rays are not parked on the footnote band.
        if (box.columns) {
            const pad = 40;
            const spread = Math.max(52 * scale, height * 0.95);
            const chip = 18 * scale;
            const logo = 68;
            const top = box.cy + logo / 2 + 18;
            return {
                cx: box.x + pad + spread + chip,
                top,
                bot: top + height,
                scale,
                inside: false
            };
        }
        // Phone: under the logo, in the empty middle of SECTORS · REAL UNITS
        // (codes on the left, values on the right).
        const head = 14 * scale;
        const tail = 38 * scale;
        const sectionTop = box.rowsTop - 16;
        const sectionBot = box.rowsTop + 6 + (SECTORS.length - 1) * 22;
        const node = d3.select("svg").node();
        const px = node && box.w > 0 ? node.clientWidth / box.w : 1;
        const top = (sectionTop + sectionBot) / 2 - (height + head + tail) / 2 + head + 5 / px;
        return {
            cx: box.cx,
            top,
            bot: top + height,
            scale,
            inside: false
        };
    }

    function fujiRay(cx, top, bot, index, scale) {
        // Official Atari: three stems together at the top, the outer two
        // horn out and finish vertical. Thin stroke, same weight as the rails.
        const height = Math.max(24, bot - top);
        const gap = 9 * scale;
        const spread = Math.max(52 * scale, height * 0.95);
        const stem = top + height * 0.5;
        const pull = (bot - stem) * 0.66;
        if (index === 1) {
            return { xTop: cx, xBot: cx, d: `M${cx.toFixed(2)},${top.toFixed(2)} L${cx.toFixed(2)},${bot.toFixed(2)}` };
        }
        const side = index === 0 ? -1 : 1;
        const x0 = cx + side * gap;
        const x1 = cx + side * spread;
        return {
            xTop: x0,
            xBot: x1,
            d: `M${x0.toFixed(2)},${top.toFixed(2)} L${x0.toFixed(2)},${stem.toFixed(2)} `
                + `C${x0.toFixed(2)},${(stem + pull).toFixed(2)} `
                + `${x1.toFixed(2)},${(bot - pull).toFixed(2)} `
                + `${x1.toFixed(2)},${bot.toFixed(2)}`
        };
    }

    function drawLoadChip(parent, cls, x, y, code, scale, valueSide) {
        const chip = parent.append("g")
            .attr("class", cls)
            .attr("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
        chip.append("rect")
            .attr("class", "flow-load-chip-body")
            .attr("x", -16 * scale).attr("y", -7 * scale)
            .attr("width", 32 * scale).attr("height", 14 * scale)
            .attr("rx", 7 * scale).attr("ry", 7 * scale)
            .attr("fill", CHIP_FILL);
        chip.append("path")
            .attr("class", "flow-load-chip-flag")
            .attr("d", `M${(-16 * scale).toFixed(2)},${(-7 * scale).toFixed(2)} `
                + `L${(-7 * scale).toFixed(2)},${(-7 * scale).toFixed(2)} `
                + `L${(-11 * scale).toFixed(2)},${(7 * scale).toFixed(2)} `
                + `L${(-16 * scale).toFixed(2)},${(7 * scale).toFixed(2)} `
                + `A${(7 * scale).toFixed(2)},${(7 * scale).toFixed(2)} 0 0 1 `
                + `${(-16 * scale).toFixed(2)},${(-7 * scale).toFixed(2)} Z`)
            .attr("fill", CYAN);
        label(chip, "flow-load-chip-code", 3 * scale, 3 * scale, code, {
            size: 8 * scale, anchor: "middle", fill: CHIP_INK, spacing: 0.7
        });
        const valueY = valueSide === "up" ? -12 * scale : 16.5 * scale;
        label(chip, "flow-load-chip-value", 0, valueY, "—", {
            size: 8 * scale, anchor: "middle", fill: DIM, spacing: 0.4
        });
        return chip;
    }

    function drawLoadRays(layer, box) {
        const frame = loadRayFrame(box);
        const group = layer.append("g")
            .attr("class", "flow-load-rays")
            .attr("pointer-events", "none");
        if (!frame.inside) {
            label(group, "flow-load-title", frame.cx, frame.top - 14 * frame.scale,
                "sched/loadavg.c · calc_load", {
                    size: 8 * frame.scale, anchor: "middle", fill: FAINT, spacing: 1.1
                });
        }

        // One sample, two addends: fans already know R and D from ps.
        const srcY = frame.top + 10 * frame.scale;
        drawLoadChip(group, "flow-load-src flow-load-src-run",
            frame.cx - 36 * frame.scale, srcY, "R", frame.scale, "up")
            .append("title").text("TASK_RUNNING · procs_running");
        label(group, "flow-load-plus", frame.cx, srcY + 3 * frame.scale, "+", {
            size: 10 * frame.scale, anchor: "middle", fill: FAINT, spacing: 0
        });
        drawLoadChip(group, "flow-load-src flow-load-src-d",
            frame.cx + 36 * frame.scale, srcY, "D", frame.scale, "up")
            .append("title").text("TASK_UNINTERRUPTIBLE · procs_blocked");
        group.select(".flow-load-src-d .flow-load-chip-flag").attr("fill", AMBER);

        label(group, "flow-load-active-name", frame.cx, srcY + 22 * frame.scale, "ACTIVE", {
            size: 8 * frame.scale, anchor: "middle", fill: DIM, spacing: 1.4
        });
        label(group, "flow-load-active-value", frame.cx, srcY + 34 * frame.scale, "—", {
            size: 11 * frame.scale, anchor: "middle", fill: LIGHT, spacing: 0.4
        }).append("title").text("nr_running + nr_uninterruptible · folded every LOAD_FREQ (5s)");

        const windows = [
            { id: "1", code: "1", exp: "EXP_1" },
            { id: "5", code: "5", exp: "EXP_5" },
            { id: "15", code: "15", exp: "EXP_15" }
        ];
        const rayTop = frame.top + 50 * frame.scale;
        windows.forEach((item, index) => {
            const stripe = fujiRay(frame.cx, rayTop, frame.bot, index, frame.scale);
            const ray = group.append("g")
                .attr("class", `flow-load-ray flow-load-ray-${item.id}`);
            ray.append("path")
                .attr("class", "flow-load-ray-edge")
                .attr("d", stripe.d)
                .attr("fill", "none")
                .attr("stroke", RAIL)
                .attr("stroke-width", 1.1)
                .attr("stroke-linecap", "round");
            drawLoadChip(ray, `flow-load-win flow-load-win-${item.id}`,
                stripe.xBot, frame.bot + 10 * frame.scale, item.code, frame.scale, "down")
                .append("title").text(`avenrun · ${item.exp} · ${item.id} minute window`);
            label(ray, "flow-load-win-rate", stripe.xBot, frame.bot + 38 * frame.scale, "—", {
                size: 6.5 * frame.scale, anchor: "middle", fill: FAINT, spacing: 0.4
            });
        });
    }

    function paintLoadRays(layer, data, stale) {
        const group = layer.select(".flow-load-rays");
        if (group.empty()) return;
        const known = !!data && !stale;
        const cpus = Math.max(1, finite(data && data.cpu_count) || 1);
        const running = finite(data && data.procs_running);
        const blocked = finite(data && data.procs_blocked);
        const active = running + blocked;
        group.select(".flow-load-src-run .flow-load-chip-value")
            .attr("fill", known ? LIGHT : DIM)
            .text(known ? String(running) : "—");
        group.select(".flow-load-src-d .flow-load-chip-value")
            .attr("fill", known ? LIGHT : DIM)
            .text(known ? String(blocked) : "—");
        group.select(".flow-load-active-value")
            .attr("fill", known ? LIGHT : DIM)
            .text(known ? String(active) : "—");

        [
            { id: "1", key: "load1" },
            { id: "5", key: "load5" },
            { id: "15", key: "load15" }
        ].forEach((item) => {
            const value = finite(data && data[item.key]);
            const share = known ? Math.min(1, value / cpus) : 0;
            const ray = group.select(`.flow-load-ray-${item.id}`);
            ray.select(".flow-load-ray-edge")
                .attr("stroke", known && share > 0.55 ? CYAN : RAIL)
                .attr("stroke-opacity", known ? (0.42 + share * 0.5).toFixed(3) : 0.28);
            ray.select(`.flow-load-win-${item.id} .flow-load-chip-value`)
                .attr("fill", known ? LIGHT : DIM)
                .text(known ? value.toFixed(2) : "—");
            ray.select(".flow-load-win-rate")
                .text(known ? `${(value / cpus).toFixed(2)} /CPU` : "—");
        });
    }

    function arcBand(cx, cy, inner, outer, start, end) {
        const a = polar(cx, cy, outer, start);
        const b = polar(cx, cy, outer, end);
        const c = polar(cx, cy, inner, end);
        const d = polar(cx, cy, inner, start);
        return [
            `M${a.x.toFixed(2)},${a.y.toFixed(2)}`,
            `A${outer},${outer} 0 0 1 ${b.x.toFixed(2)},${b.y.toFixed(2)}`,
            `L${c.x.toFixed(2)},${c.y.toFixed(2)}`,
            `A${inner},${inner} 0 0 0 ${d.x.toFixed(2)},${d.y.toFixed(2)}`,
            "Z"
        ].join(" ");
    }

    function drawSectorColumn(layer, box) {
        const column = layer.append("g").attr("class", "flow-circuit-column-sectors");
        const x = box.x + 34;
        const top = box.y + 84;
        label(column, "flow-column-title", x, top, "SECTORS · REAL UNITS", { size: 10, fill: DIM, spacing: 1.4 });

        SECTORS.forEach((sector, index) => {
            const y = top + 26 + index * 44;
            const row = column.append("g")
                .attr("class", `flow-row flow-row-${sector.id}`)
                .attr("data-sector", sector.id)
                .style("cursor", sector.card ? "pointer" : "default")
                .on("click", (event) => {
                    event.stopPropagation();
                    drillDown(sector, { x: x + 260, y });
                });
            row.append("rect")
                .attr("class", "flow-row-hit")
                .attr("x", x - 8).attr("y", y - 16).attr("width", 300).attr("height", 38)
                .attr("fill", "rgba(255,255,255,0.001)");
            row.append("line")
                .attr("class", "flow-row-rule")
                .attr("x1", x).attr("y1", y + 16).attr("x2", x + 268).attr("y2", y + 16)
                .attr("stroke", FAINT).attr("stroke-width", 0.6);
            label(row, "flow-row-index", x, y, `0${index + 1}`, { size: 10, fill: CYAN, spacing: 1 });
            label(row, "flow-row-code", x + 26, y, sector.code, { size: 11, spacing: 1.2 });
            label(row, "flow-row-value", x + 268, y, "—", { size: 12, anchor: "end", spacing: 0.8 });
            label(row, "flow-row-unit", x + 26, y + 11, sector.unit, { size: 8, fill: FAINT, spacing: 0.7 });
            label(row, "flow-row-detail", x + 268, y + 11, "", {
                size: 8, anchor: "end", fill: DIM, spacing: 0.7
            });
        });
    }

    function drawPeakColumn(layer, box) {
        const column = layer.append("g")
            .attr("class", "flow-circuit-column-peak")
            .attr("pointer-events", "none");
        const x = box.x + box.w - 150;
        const top = box.y + 110;
        const height = Math.min(360, box.h - 220);
        label(column, "flow-column-title", x - 18, top - 26, "AGAINST OWN PEAK", {
            size: 10, fill: DIM, spacing: 1.4
        });
        column.append("line")
            .attr("x1", x).attr("y1", top).attr("x2", x).attr("y2", top + height)
            .attr("stroke", FAINT).attr("stroke-width", 0.7);

        for (let share = 0; share <= 100; share += 20) {
            const y = top + (share / 100) * height;
            column.append("line")
                .attr("x1", x - 4).attr("y1", y).attr("x2", x).attr("y2", y)
                .attr("stroke", FAINT).attr("stroke-width", 0.7);
            label(column, "flow-peak-tick", x - 9, y + 3, `${100 - share}%`, {
                size: 8, anchor: "end", fill: FAINT, spacing: 0.5
            });
        }

        SECTORS.forEach((sector) => {
            const marker = column.append("g")
                .attr("class", `flow-peak-marker flow-peak-marker-${sector.id}`)
                .attr("data-sector", sector.id)
                .attr("data-top", top)
                .attr("data-height", height);
            marker.append("circle")
                .attr("class", "flow-peak-dot")
                .attr("cx", x).attr("cy", top + height).attr("r", 2.6)
                .attr("fill", CYAN);
            label(marker, "flow-peak-code", x + 10, top + height + 3, sector.code, { size: 9, spacing: 0.9 });
            label(marker, "flow-peak-share", x + 44, top + height + 3, "—", { size: 9, fill: DIM, spacing: 0.6 });
        });
    }

    function drawCompactRows(layer, box) {
        const column = layer.append("g").attr("class", "flow-circuit-column-sectors");
        const x = box.x + 22;
        const top = box.rowsTop;
        label(column, "flow-column-title", x, top - 16, "SECTORS · REAL UNITS", {
            size: 9, fill: DIM, spacing: 1.2
        });
        SECTORS.forEach((sector, index) => {
            const y = top + 6 + index * 22;
            const row = column.append("g")
                .attr("class", `flow-row flow-row-${sector.id}`)
                .attr("data-sector", sector.id)
                .style("cursor", sector.card ? "pointer" : "default")
                .on("click", (event) => {
                    event.stopPropagation();
                    drillDown(sector, { x: Math.min(box.x + box.w - 40, x + 200), y });
                });
            row.append("rect")
                .attr("class", "flow-row-hit")
                .attr("x", x - 6).attr("y", y - 12)
                .attr("width", box.w - 32).attr("height", 20)
                .attr("fill", "rgba(255,255,255,0.001)");
            label(row, "flow-row-index", x, y, `0${index + 1}`, { size: 9, fill: CYAN, spacing: 0.8 });
            label(row, "flow-row-code", x + 22, y, sector.code, { size: 10, spacing: 1 });
            label(row, "flow-row-value", box.x + box.w - 22, y, "—", {
                size: 10, anchor: "end", spacing: 0.6
            });
        });
    }

    function drawTrail(box) {
        const layer = d3.select("svg").select(".flow-circuit-trail");
        if (layer.empty()) return;
        layer.selectAll("*").remove();
        const mid = box.radius + box.band / 2;
        const frames = state.history.slice(0, -1).slice(-5);
        frames.forEach((frame, frameIndex) => {
            const opacity = 0.1 + (frameIndex + 1) / Math.max(1, frames.length) * 0.32;
            frame.forEach((value, index) => {
                if (!value.known) return;
                const at = polar(box.cx, box.cy, mid, travelAngle(angles(index), value.pressure));
                layer.append("circle")
                    .attr("class", "flow-trail-pip")
                    .attr("data-sector", value.id)
                    .attr("data-age", frames.length - frameIndex)
                    .attr("cx", at.x).attr("cy", at.y).attr("r", 1.5)
                    .attr("fill", LIGHT)
                    .attr("opacity", opacity.toFixed(3));
            });
        });
    }

    function paint() {
        if (!state.open) return;
        const layer = d3.select("svg").select(".flow-circuit-layer");
        if (layer.empty()) return;
        const box = layout();
        const stale = state.observedAt > 0 && Date.now() - state.observedAt > STALE_MS;
        const current = values(state.data, stale);
        const leader = current
            .filter((value) => value.known && value.value > 0)
            .sort((a, b) => b.pressure - a.pressure)[0];
        const duration = reducedMotion() ? 0 : 420;
        const railIn = box.radius;
        const railOut = box.radius + box.band;

        current.forEach((value, index) => {
            const sectorAngles = angles(index);
            const item = layer.select(`.flow-sector-${value.id}`);
            const hot = !!leader && leader.id === value.id;
            const accent = hot ? AMBER : CYAN;
            const angle = travelAngle(sectorAngles, value.pressure);
            const from = polar(box.cx, box.cy, railIn - 6, angle);
            const to = polar(box.cx, box.cy, railOut + 6, angle);
            const chipAt = polar(box.cx, box.cy, railOut + 24, angle);
            const readout = value.known ? value.format(value.value) : (stale ? "STALE" : "WARMING");

            item.select(".flow-sector-marker")
                .interrupt().transition().duration(duration)
                .attr("x1", from.x).attr("y1", from.y)
                .attr("x2", to.x).attr("y2", to.y)
                .attr("stroke", value.known ? accent : FAINT)
                .attr("stroke-width", hot ? 3 : 2.2);

            const chip = item.select(".flow-sector-chip");
            chip.interrupt().transition().duration(duration)
                .attr("transform", `translate(${chipAt.x.toFixed(2)} ${chipAt.y.toFixed(2)})`);
            chip.select(".flow-chip-flag").attr("fill", value.known ? accent : FAINT);
            chip.select(".flow-chip-body")
                .attr("fill", hot ? AMBER : CHIP_FILL);
            // On the left half the reading would run back over the track, so it
            // changes sides with the chip instead.
            const leftSide = Math.cos(angle) < 0;
            chip.select(".flow-chip-value")
                .attr("x", leftSide ? -26 : 26)
                .attr("text-anchor", leftSide ? "end" : "start")
                .attr("fill", hot ? AMBER : (value.known ? LIGHT : DIM))
                .text(readout);
            chip.select("title").text(`${value.label} · ${value.unit} · ${readout}`);

            const row = layer.select(`.flow-row-${value.id}`);
            if (!row.empty()) {
                row.select(".flow-row-value")
                    .attr("fill", hot ? AMBER : (value.known ? LIGHT : DIM))
                    .text(readout);
                row.select(".flow-row-detail")
                    .text(value.known ? value.detail(state.data) : "");
                row.select(".flow-row-code").attr("fill", hot ? AMBER : LIGHT);
            }

            const marker = layer.select(`.flow-peak-marker-${value.id}`);
            if (!marker.empty()) {
                const top = Number(marker.attr("data-top"));
                const height = Number(marker.attr("data-height"));
                const y = top + (1 - value.share) * height;
                marker.select(".flow-peak-dot")
                    .interrupt().transition().duration(duration)
                    .attr("cy", y)
                    .attr("r", hot ? 3.4 : 2.6)
                    .attr("fill", value.known ? (hot ? AMBER : CYAN) : FAINT);
                marker.select(".flow-peak-code")
                    .interrupt().transition().duration(duration)
                    .attr("y", y + 3)
                    .attr("fill", hot ? AMBER : LIGHT);
                marker.select(".flow-peak-share")
                    .interrupt().transition().duration(duration)
                    .attr("y", y + 3)
                    .text(value.known ? `${Math.round(value.share * 100)}%` : "—");
            }
        });

        layer.select(".flow-core-leader")
            .attr("fill", leader ? AMBER : DIM)
            .text(leader
                ? `${leader.code} LEADS ITS OWN ENVELOPE · ${leader.format(leader.value)}`
                : (stale ? "TELEMETRY STALE" : "WARMING"));

        const age = state.observedAt ? (Date.now() - state.observedAt) / 1000 : null;
        layer.select(".flow-circuit-source")
            .text(age === null
                ? "IO PULSE · WAITING"
                : `IO PULSE · SAMPLED ${age.toFixed(1)} S AGO`);

        paintLoadRays(layer, state.data, stale);
        drawTrail(box);
    }

    function ingest(data, observedAt) {
        if (!data) return;
        state.data = data;
        state.observedAt = Number(observedAt) || Date.now();
        SECTORS.forEach((sector) => {
            const value = sector.value(data);
            state.peaks[sector.id] = Math.max(
                sector.floor, value, finite(state.peaks[sector.id]) * 0.985
            );
        });
        state.history.push(values(data, false));
        if (state.history.length > 6) state.history.shift();
        paint();
    }

    function refit() {
        if (!state.open) return;
        mount();
    }

    // The bus already carries this payload for the I/O track, so peaks stay
    // warm while the screen is closed and open with real numbers.
    window.addEventListener("kernel-telemetry", (event) => {
        const detail = event.detail || {};
        if (detail.kind === "io" && detail.data) ingest(detail.data, detail.observedAt);
    });
    window.setInterval(() => {
        if (state.open && state.observedAt && Date.now() - state.observedAt > STALE_MS) paint();
    }, 2500);

    return {
        open,
        close,
        toggle: open,
        refit,
        syncToViewport,
        ingest,
        isOpen: () => state.open,
        values
    };
})();

window.KernelThroughputCircuit = KernelThroughputCircuit;
