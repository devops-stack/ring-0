// Prototype: vintage elevator floor-selector as Linux block I/O elevator.
// Floors ≈ LBA bands. Car ≈ disk head. Latched calls ≈ pending bio requests.
// Direction stickiness ≈ classic elevator / SCAN / mq-deadline spirit.
const IoElevator = (() => {
    const FLOORS = 12;
    const W = 920;
    const H = 640;
    const SHAFT_X = 210;
    const SHAFT_W = 168;
    const FLOOR_H = 42;
    const SHAFT_TOP = 88;
    const BTN_X = 470;
    const PAD = 28;

    const state = {
        floor: 3,
        target: null,
        dir: 0, // -1 down (toward higher LBA / lower floor index visually bottom), +1 up
        moving: false,
        queue: [], // { id, floor, kind: 'R'|'W', latched: true }
        seq: 1,
        pulse: null,
        scheduler: "elevator · SCAN",
    };

    let svgRoot = null;
    let carG = null;
    let raf = null;
    let lastTs = 0;

    function floorY(floor) {
        // Floor 0 at bottom of shaft (low LBA), high floor at top — like a building.
        const idx = FLOORS - 1 - floor;
        return SHAFT_TOP + idx * FLOOR_H + FLOOR_H / 2;
    }

    function lbaLabel(floor) {
        const band = Math.floor((floor / FLOORS) * 100);
        const next = Math.floor(((floor + 1) / FLOORS) * 100);
        return `${String(band).padStart(2, "0")}–${String(next).padStart(2, "0")}% LBA`;
    }

    function enqueue(floor, kind) {
        floor = Math.max(0, Math.min(FLOORS - 1, floor | 0));
        if (state.queue.some((q) => q.floor === floor && q.kind === kind)) return;
        state.queue.push({
            id: state.seq++,
            floor,
            kind: kind === "W" ? "W" : "R",
            latched: true,
            born: performance.now(),
        });
        pickNext();
        renderButtons();
        renderLegend();
    }

    function pickNext() {
        if (state.moving || !state.queue.length) {
            if (!state.queue.length) {
                state.target = null;
                state.dir = 0;
            }
            return;
        }
        const here = state.floor;
        let dir = state.dir || 1;

        const ahead = state.queue.filter((q) =>
            dir > 0 ? q.floor > here : q.floor < here
        );
        const same = state.queue.filter((q) => q.floor === here);
        if (same.length) {
            serveFloor(here);
            return;
        }
        if (!ahead.length) {
            dir = -dir;
            state.dir = dir;
            const other = state.queue.filter((q) =>
                dir > 0 ? q.floor > here : q.floor < here
            );
            if (!other.length) {
                // Only opposite same-side leftovers — go to nearest
                state.queue.sort((a, b) => Math.abs(a.floor - here) - Math.abs(b.floor - here));
                state.target = state.queue[0].floor;
                state.dir = state.target > here ? 1 : state.target < here ? -1 : 0;
                startMove();
                return;
            }
            state.target = dir > 0
                ? Math.min(...other.map((q) => q.floor))
                : Math.max(...other.map((q) => q.floor));
            startMove();
            return;
        }
        state.dir = dir;
        state.target = dir > 0
            ? Math.min(...ahead.map((q) => q.floor))
            : Math.max(...ahead.map((q) => q.floor));
        startMove();
    }

    function startMove() {
        if (state.target == null || state.target === state.floor) {
            serveFloor(state.floor);
            return;
        }
        state.moving = true;
        state.dir = state.target > state.floor ? 1 : -1;
        renderChrome();
    }

    function serveFloor(floor) {
        const served = state.queue.filter((q) => q.floor === floor);
        state.queue = state.queue.filter((q) => q.floor !== floor);
        state.moving = false;
        state.target = null;
        renderButtons();
        renderChrome();
        flashServed(floor, served);
        // Brief dwell, then continue
        setTimeout(() => pickNext(), 280);
    }

    function flashServed(floor, served) {
        if (!svgRoot || !served.length) return;
        const y = floorY(floor);
        const kinds = served.map((s) => s.kind).join("+");
        const g = svgRoot.append("g").attr("class", "io-el-flash");
        g.append("rect")
            .attr("x", SHAFT_X + 8)
            .attr("y", y - 14)
            .attr("width", SHAFT_W - 16)
            .attr("height", 28)
            .attr("rx", 2)
            .attr("fill", "#e2a33e")
            .attr("opacity", 0.55);
        g.append("text")
            .attr("x", SHAFT_X + SHAFT_W / 2)
            .attr("y", y + 4)
            .attr("text-anchor", "middle")
            .attr("fill", "#1a1a1a")
            .attr("font-size", 11)
            .attr("font-family", "Share Tech Mono, monospace")
            .text(`SERVE ${kinds}`);
        g.transition().duration(420).attr("opacity", 0).remove();
    }

    function tick(ts) {
        raf = requestAnimationFrame(tick);
        if (!lastTs) lastTs = ts;
        const dt = Math.min(0.05, (ts - lastTs) / 1000);
        lastTs = ts;

        if (state.moving && state.target != null) {
            const speed = 3.2; // floors per second
            const step = state.dir * speed * dt;
            const next = state.floor + step;
            if ((state.dir > 0 && next >= state.target) || (state.dir < 0 && next <= state.target)) {
                state.floor = state.target;
                placeCar(true);
                serveFloor(state.floor);
            } else {
                state.floor = next;
                placeCar(false);
            }
        }

        // Soft ambient calls when disk is busy
        maybeAmbient(ts);
    }

    let lastAmbient = 0;
    function maybeAmbient(ts) {
        if (ts - lastAmbient < 900) return;
        const p = state.pulse || {};
        const iops = (p.disk_read_iops || 0) + (p.disk_write_iops || 0);
        const mb = (p.disk_read_mb_s || 0) + (p.disk_write_mb_s || 0);
        const busy = iops > 2 || mb > 0.05;
        if (!busy && state.queue.length >= 2) return;
        if (state.queue.length >= 7) return;
        lastAmbient = ts;
        if (Math.random() > (busy ? 0.35 : 0.08)) return;
        const floor = Math.floor(Math.random() * FLOORS);
        const kind = (p.disk_write_iops || 0) > (p.disk_read_iops || 0) ? "W" : "R";
        if (Math.random() < 0.45) enqueue(floor, kind === "W" ? "W" : "R");
        else enqueue(floor, Math.random() < 0.5 ? "R" : "W");
    }

    function placeCar(snap) {
        if (!carG) return;
        const y = floorY(state.floor);
        if (snap) {
            carG.attr("transform", `translate(0,${y})`);
        } else {
            carG.attr("transform", `translate(0,${y})`);
        }
        renderChrome();
    }

    function renderChrome() {
        if (!svgRoot) return;
        const dirEl = svgRoot.select(".io-el-dir");
        const posEl = svgRoot.select(".io-el-pos");
        const tgtEl = svgRoot.select(".io-el-tgt");
        const qEl = svgRoot.select(".io-el-q");
        const arrow = state.dir > 0 ? "▲ UP" : state.dir < 0 ? "▼ DOWN" : "◆ IDLE";
        dirEl.text(arrow);
        posEl.text(`CAR  floor ${Math.round(state.floor)} · head @ ${lbaLabel(Math.round(state.floor))}`);
        tgtEl.text(state.target == null ? "NEXT  —" : `NEXT  floor ${state.target}`);
        qEl.text(`QUEUE  ${state.queue.length} latched`);

        svgRoot.selectAll(".io-el-floor-mark").attr("opacity", (d) => {
            const f = Math.round(state.floor);
            return d === f ? 1 : 0.35;
        });
        svgRoot.selectAll(".io-el-floor-fill").attr("fill", (d) => {
            const f = Math.round(state.floor);
            if (d === f) return "rgba(226,163,62,0.22)";
            if (state.queue.some((q) => q.floor === d)) return "rgba(90,110,130,0.12)";
            return "transparent";
        });
    }

    function renderButtons() {
        if (!svgRoot) return;
        const rows = [];
        for (let f = FLOORS - 1; f >= 0; f -= 1) {
            rows.push({ floor: f, R: state.queue.find((q) => q.floor === f && q.kind === "R"), W: state.queue.find((q) => q.floor === f && q.kind === "W") });
        }
        const g = svgRoot.select(".io-el-buttons");
        const sel = g.selectAll(".io-el-btn-row").data(rows, (d) => d.floor);
        const enter = sel.enter().append("g").attr("class", "io-el-btn-row");
        enter.append("text").attr("class", "io-el-btn-lab");
        enter.append("g").attr("class", "io-el-btn-r");
        enter.append("g").attr("class", "io-el-btn-w");
        const all = enter.merge(sel);
        all.attr("transform", (d, i) => `translate(${BTN_X},${SHAFT_TOP + i * FLOOR_H + 8})`);
        all.select(".io-el-btn-lab")
            .attr("x", 0)
            .attr("y", 16)
            .attr("fill", "#3a3a3a")
            .attr("font-size", 12)
            .attr("font-family", "Share Tech Mono, monospace")
            .text((d) => String(d.floor).padStart(2, "0"));

        drawLatch(all.select(".io-el-btn-r"), 36, "R", (d) => !!d.R, (d) => enqueue(d.floor, "R"));
        drawLatch(all.select(".io-el-btn-w"), 92, "W", (d) => !!d.W, (d) => enqueue(d.floor, "W"));
        sel.exit().remove();
    }

    function drawLatch(sel, x, label, isOn, onClick) {
        sel.each(function (d) {
            const node = d3.select(this);
            node.selectAll("*").remove();
            const on = isOn(d);
            node.append("circle")
                .attr("cx", x + 14)
                .attr("cy", 12)
                .attr("r", 11)
                .attr("fill", on ? (label === "W" ? "#c45c3a" : "#e2a33e") : "#cfcac0")
                .attr("stroke", on ? "#1a1a1a" : "#8a8578")
                .attr("stroke-width", on ? 1.6 : 1)
                .style("cursor", "pointer")
                .on("click", (event) => {
                    event.stopPropagation();
                    onClick(d);
                });
            node.append("text")
                .attr("x", x + 14)
                .attr("y", 16)
                .attr("text-anchor", "middle")
                .attr("fill", on ? "#1a1a1a" : "#5a564c")
                .attr("font-size", 10)
                .attr("font-family", "Share Tech Mono, monospace")
                .attr("pointer-events", "none")
                .text(label);
            // mechanical latch tab
            if (on) {
                node.append("rect")
                    .attr("x", x + 26)
                    .attr("y", 8)
                    .attr("width", 6)
                    .attr("height", 8)
                    .attr("fill", "#1a1a1a")
                    .attr("opacity", 0.55);
            }
        });
    }

    function renderLegend() {
        if (!svgRoot) return;
        const p = state.pulse || {};
        const line = [
            `live disk  R ${Number(p.disk_read_mb_s || 0).toFixed(2)} MB/s · W ${Number(p.disk_write_mb_s || 0).toFixed(2)} MB/s`,
            `iops  ${p.disk_read_iops || 0}r / ${p.disk_write_iops || 0}w`,
            state.scheduler,
        ].join("   ·   ");
        svgRoot.select(".io-el-live").text(line);
    }

    function build() {
        const host = d3.select("#io-elevator");
        host.selectAll("*").remove();
        svgRoot = host
            .append("svg")
            .attr("viewBox", `0 0 ${W} ${H}`)
            .attr("class", "io-elevator-svg");

        // Panel plate
        svgRoot.append("rect")
            .attr("x", PAD)
            .attr("y", PAD)
            .attr("width", W - PAD * 2)
            .attr("height", H - PAD * 2)
            .attr("rx", 6)
            .attr("fill", "#ebe6dc")
            .attr("stroke", "#2a2a2a")
            .attr("stroke-width", 1.4);

        // Inner bevel
        svgRoot.append("rect")
            .attr("x", PAD + 8)
            .attr("y", PAD + 8)
            .attr("width", W - PAD * 2 - 16)
            .attr("height", H - PAD * 2 - 16)
            .attr("rx", 3)
            .attr("fill", "none")
            .attr("stroke", "rgba(0,0,0,0.12)");

        // Title plate
        svgRoot.append("text")
            .attr("x", PAD + 22)
            .attr("y", 58)
            .attr("fill", "#1a1a1a")
            .attr("font-size", 18)
            .attr("font-family", "Share Tech Mono, monospace")
            .attr("letter-spacing", "0.08em")
            .text("BLOCK I/O  ·  FLOOR SELECTOR");

        svgRoot.append("text")
            .attr("x", PAD + 22)
            .attr("y", 76)
            .attr("fill", "#6a655c")
            .attr("font-size", 11)
            .attr("font-family", "Share Tech Mono, monospace")
            .text("prototype — elevator algorithm as pre-computer lift selector");

        // Direction / status
        svgRoot.append("text").attr("class", "io-el-dir")
            .attr("x", W - PAD - 24)
            .attr("y", 58)
            .attr("text-anchor", "end")
            .attr("fill", "#c49a3c")
            .attr("font-size", 16)
            .attr("font-family", "Share Tech Mono, monospace")
            .text("◆ IDLE");

        svgRoot.append("text").attr("class", "io-el-pos")
            .attr("x", PAD + 22)
            .attr("y", H - 52)
            .attr("fill", "#3a3a3a")
            .attr("font-size", 12)
            .attr("font-family", "Share Tech Mono, monospace");

        svgRoot.append("text").attr("class", "io-el-tgt")
            .attr("x", PAD + 22)
            .attr("y", H - 34)
            .attr("fill", "#6a655c")
            .attr("font-size", 12)
            .attr("font-family", "Share Tech Mono, monospace");

        svgRoot.append("text").attr("class", "io-el-q")
            .attr("x", BTN_X)
            .attr("y", H - 34)
            .attr("fill", "#6a655c")
            .attr("font-size", 12)
            .attr("font-family", "Share Tech Mono, monospace");

        svgRoot.append("text").attr("class", "io-el-live")
            .attr("x", PAD + 22)
            .attr("y", H - 14)
            .attr("fill", "#8a8578")
            .attr("font-size", 10)
            .attr("font-family", "Share Tech Mono, monospace");

        // Metaphor column (left)
        const myth = svgRoot.append("g").attr("transform", `translate(${PAD + 22},140)`);
        const lines = [
            ["SHAFT", "address space / LBA"],
            ["FLOOR", "sector band"],
            ["CAR", "disk head"],
            ["LATCH", "pending bio"],
            ["R / W", "read / write"],
            ["▲▼", "SCAN direction"],
        ];
        lines.forEach((row, i) => {
            myth.append("text")
                .attr("y", i * 28)
                .attr("fill", "#c49a3c")
                .attr("font-size", 11)
                .attr("font-family", "Share Tech Mono, monospace")
                .text(row[0]);
            myth.append("text")
                .attr("y", i * 28 + 12)
                .attr("fill", "#6a655c")
                .attr("font-size", 10)
                .attr("font-family", "Share Tech Mono, monospace")
                .text(row[1]);
        });

        // Shaft
        const shaftH = FLOORS * FLOOR_H;
        svgRoot.append("rect")
            .attr("x", SHAFT_X)
            .attr("y", SHAFT_TOP)
            .attr("width", SHAFT_W)
            .attr("height", shaftH)
            .attr("fill", "#2c3038")
            .attr("stroke", "#1a1a1a")
            .attr("stroke-width", 1.5);

        // Floor marks
        const floors = d3.range(FLOORS);
        const marks = svgRoot.append("g").attr("class", "io-el-floors");
        const fg = marks.selectAll("g").data(floors).enter().append("g");
        fg.append("rect")
            .attr("class", "io-el-floor-fill")
            .attr("x", SHAFT_X + 1)
            .attr("y", (d) => floorY(d) - FLOOR_H / 2 + 1)
            .attr("width", SHAFT_W - 2)
            .attr("height", FLOOR_H - 2)
            .attr("fill", "transparent");
        fg.append("line")
            .attr("x1", SHAFT_X)
            .attr("x2", SHAFT_X + SHAFT_W)
            .attr("y1", (d) => floorY(d) + FLOOR_H / 2)
            .attr("y2", (d) => floorY(d) + FLOOR_H / 2)
            .attr("stroke", "rgba(255,255,255,0.08)");
        fg.append("text")
            .attr("class", "io-el-floor-mark")
            .attr("x", SHAFT_X + 14)
            .attr("y", (d) => floorY(d) + 4)
            .attr("fill", "#e2a33e")
            .attr("font-size", 13)
            .attr("font-family", "Share Tech Mono, monospace")
            .attr("opacity", 0.35)
            .text((d) => String(d).padStart(2, "0"));
        fg.append("text")
            .attr("x", SHAFT_X + SHAFT_W - 10)
            .attr("y", (d) => floorY(d) + 4)
            .attr("text-anchor", "end")
            .attr("fill", "rgba(255,255,255,0.28)")
            .attr("font-size", 9)
            .attr("font-family", "Share Tech Mono, monospace")
            .text((d) => lbaLabel(d).replace(" LBA", ""));

        // Guide rail
        svgRoot.append("line")
            .attr("x1", SHAFT_X + SHAFT_W / 2)
            .attr("x2", SHAFT_X + SHAFT_W / 2)
            .attr("y1", SHAFT_TOP + 4)
            .attr("y2", SHAFT_TOP + shaftH - 4)
            .attr("stroke", "rgba(226,163,62,0.25)")
            .attr("stroke-width", 2)
            .attr("stroke-dasharray", "3 7");

        // Car / traveling contact
        carG = svgRoot.append("g").attr("class", "io-el-car");
        carG.append("rect")
            .attr("x", SHAFT_X + 28)
            .attr("y", -16)
            .attr("width", SHAFT_W - 56)
            .attr("height", 32)
            .attr("rx", 2)
            .attr("fill", "#d8b15a")
            .attr("stroke", "#1a1a1a")
            .attr("stroke-width", 1.4);
        carG.append("rect")
            .attr("x", SHAFT_X + 36)
            .attr("y", -8)
            .attr("width", SHAFT_W - 72)
            .attr("height", 16)
            .attr("fill", "#2c3038");
        // Brush contacts left/right
        carG.append("rect")
            .attr("x", SHAFT_X + 18)
            .attr("y", -5)
            .attr("width", 8)
            .attr("height", 10)
            .attr("fill", "#8a8578");
        carG.append("rect")
            .attr("x", SHAFT_X + SHAFT_W - 26)
            .attr("y", -5)
            .attr("width", 8)
            .attr("height", 10)
            .attr("fill", "#8a8578");
        carG.append("text")
            .attr("x", SHAFT_X + SHAFT_W / 2)
            .attr("y", 4)
            .attr("text-anchor", "middle")
            .attr("fill", "#f2e6c4")
            .attr("font-size", 10)
            .attr("font-family", "Share Tech Mono, monospace")
            .text("HEAD");

        // Call bank header
        svgRoot.append("text")
            .attr("x", BTN_X)
            .attr("y", SHAFT_TOP - 18)
            .attr("fill", "#1a1a1a")
            .attr("font-size", 12)
            .attr("font-family", "Share Tech Mono, monospace")
            .text("CALL BANK  ·  click to latch");
        svgRoot.append("text")
            .attr("x", BTN_X + 36)
            .attr("y", SHAFT_TOP - 4)
            .attr("fill", "#8a8578")
            .attr("font-size", 10)
            .attr("font-family", "Share Tech Mono, monospace")
            .text("R");
        svgRoot.append("text")
            .attr("x", BTN_X + 92)
            .attr("y", SHAFT_TOP - 4)
            .attr("fill", "#8a8578")
            .attr("font-size", 10)
            .attr("font-family", "Share Tech Mono, monospace")
            .text("W");

        svgRoot.append("g").attr("class", "io-el-buttons");

        // Side note
        svgRoot.append("text")
            .attr("x", 680)
            .attr("y", 140)
            .attr("fill", "#1a1a1a")
            .attr("font-size", 12)
            .attr("font-family", "Share Tech Mono, monospace")
            .text("HOW TO READ");
        const how = [
            "Buttons latch like old lift calls.",
            "Car keeps direction until the",
            "shaft is empty ahead, then turns.",
            "",
            "That is the elevator idea inside",
            "Linux block scheduling: serve the",
            "disk in sweeps, not as a random",
            "scatter of seeks.",
            "",
            "Later: real request queue, device,",
            "mq-deadline / BFQ labels.",
        ];
        how.forEach((t, i) => {
            svgRoot.append("text")
                .attr("x", 680)
                .attr("y", 162 + i * 16)
                .attr("fill", "#6a655c")
                .attr("font-size", 11)
                .attr("font-family", "Share Tech Mono, monospace")
                .text(t);
        });

        placeCar(true);
        renderButtons();
        renderChrome();
        renderLegend();

        // Seed a few calls so the machine is alive on first look
        enqueue(8, "R");
        enqueue(2, "W");
        enqueue(5, "R");
    }

    function pollPulse() {
        fetch("/api/io-pulse", { cache: "no-store" })
            .then((r) => r.json())
            .then((d) => {
                state.pulse = d;
                renderLegend();
            })
            .catch(() => {});
    }

    function start() {
        build();
        lastTs = 0;
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(tick);
        pollPulse();
        setInterval(pollPulse, 2000);
    }

    return { start, enqueue };
})();

document.addEventListener("DOMContentLoaded", () => IoElevator.start());
