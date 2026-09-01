// Amber-on-black sys_call_table decode: volumetric schematic of the
// elevator floor-selector — computer/CAD rocker arms on a horizontal shaft,
// beside a dispatch menu (same scale as a HUD side icon).
const SyscallSelector = (() => {
    // Fewer slots so each arm reads as a solid part, not a hairline.
    const SLOTS = [
        { nr: 0, name: "read" },
        { nr: 1, name: "write" },
        { nr: 3, name: "close" },
        { nr: 7, name: "poll" },
        { nr: 9, name: "mmap" },
        { nr: 56, name: "clone" },
        { nr: 73, name: "ppoll" },
        { nr: 202, name: "futex" },
        { nr: 257, name: "openat" },
        { nr: 270, name: "epoll_wait" },
    ];

    const W = 620;
    const H = 430;
    // Schematic plate (left)
    const SCH = { x: 24, y: 52, w: 248, h: 300 };
    const MENU_X = 292;
    const SHAFT_Y = SCH.y + 168;
    const RAIL_Y = SCH.y + 48;
    const ARM_LEN = 86;

    const AMBER = "#e2a33e";
    const AMBER_DIM = "rgba(226,163,62,0.22)";
    const AMBER_MID = "rgba(226,163,62,0.55)";
    const AMBER_HOT = "#f0c56a";
    const AMBER_FILL = "rgba(226,163,62,0.14)";
    const AMBER_FILL_HOT = "rgba(226,163,62,0.32)";
    const AMBER_SHADE = "rgba(226,163,62,0.08)";

    const state = {
        live: new Map(),
        focus: null,
        ts: "",
    };

    let svg = null;

    function clip(text, n) {
        const s = String(text || "");
        return s.length > n ? `${s.slice(0, n - 1)}…` : s;
    }

    function liveFor(slot) {
        const byName = state.live.get(slot.name) || state.live.get(String(slot.name).toLowerCase());
        if (byName) return byName;
        for (const v of state.live.values()) {
            if (Number(v.nr) === Number(slot.nr)) return v;
        }
        return null;
    }

    function hotness(slot) {
        const live = liveFor(slot);
        if (!live) return 0;
        return Math.max(0.45, Math.min(1, 0.45 + live.count / 10));
    }

    function armX(i) {
        const left = SCH.x + 28;
        const right = SCH.x + SCH.w - 28;
        return left + (i / Math.max(1, SLOTS.length - 1)) * (right - left);
    }

    // Idle hangs down (~115° from +X). Engaged rises into the rail (~-85°).
    function armAngle(slot, i) {
        const hot = hotness(slot);
        const focused = state.focus === i;
        const t = focused ? Math.max(hot, 0.85) : hot;
        const idle = 118;
        const engaged = -82;
        return idle + (engaged - idle) * t;
    }

    function build() {
        const host = d3.select("#syscall-selector");
        host.selectAll("*").remove();
        svg = host
            .append("svg")
            .attr("viewBox", `0 0 ${W} ${H}`)
            .attr("class", "syscall-selector-svg");

        // defs: soft glow for engaged rollers
        const defs = svg.append("defs");
        const glow = defs.append("filter").attr("id", "amber-glow");
        glow.append("feGaussianBlur").attr("stdDeviation", 1.6).attr("result", "b");
        const merge = glow.append("feMerge");
        merge.append("feMergeNode").attr("in", "b");
        merge.append("feMergeNode").attr("in", "SourceGraphic");

        svg.append("text")
            .attr("x", 24)
            .attr("y", 26)
            .attr("fill", AMBER)
            .attr("font-size", 11)
            .attr("font-family", "Share Tech Mono, monospace")
            .attr("letter-spacing", "0.18em")
            .text("SYS_CALL_TABLE");

        svg.append("text")
            .attr("x", 24)
            .attr("y", 42)
            .attr("fill", AMBER_MID)
            .attr("font-size", 9)
            .attr("font-family", "Share Tech Mono, monospace")
            .text("SELECTOR UNIT  ·  VOLUMETRIC SCHEMATIC");

        const sch = svg.append("g").attr("class", "schematic");

        // Volumetric frame: front face + depth offset (CAD box)
        const depth = 8;
        sch.append("path")
            .attr("d", [
                `M${SCH.x + depth},${SCH.y}`,
                `H${SCH.x + SCH.w}`,
                `L${SCH.x + SCH.w - depth},${SCH.y + depth}`,
                `H${SCH.x}`,
                "Z",
            ].join(" "))
            .attr("fill", AMBER_SHADE)
            .attr("stroke", AMBER_DIM)
            .attr("stroke-width", 1);

        sch.append("path")
            .attr("d", [
                `M${SCH.x + SCH.w},${SCH.y}`,
                `V${SCH.y + SCH.h}`,
                `L${SCH.x + SCH.w - depth},${SCH.y + SCH.h - depth}`,
                `V${SCH.y + depth}`,
                "Z",
            ].join(" "))
            .attr("fill", AMBER_SHADE)
            .attr("stroke", AMBER_DIM)
            .attr("stroke-width", 1);

        sch.append("rect")
            .attr("x", SCH.x)
            .attr("y", SCH.y + depth)
            .attr("width", SCH.w - depth)
            .attr("height", SCH.h - depth)
            .attr("fill", "rgba(0,0,0,0.35)")
            .attr("stroke", AMBER_MID)
            .attr("stroke-width", 1.2);

        // Corner bolts (computer/machine plate)
        [
            [SCH.x + 10, SCH.y + depth + 10],
            [SCH.x + SCH.w - depth - 10, SCH.y + depth + 10],
            [SCH.x + 10, SCH.y + SCH.h - 10],
            [SCH.x + SCH.w - depth - 10, SCH.y + SCH.h - 10],
        ].forEach(([bx, by]) => {
            sch.append("circle")
                .attr("cx", bx).attr("cy", by).attr("r", 3.2)
                .attr("fill", "none").attr("stroke", AMBER_MID).attr("stroke-width", 1);
            sch.append("circle")
                .attr("cx", bx).attr("cy", by).attr("r", 1.1)
                .attr("fill", AMBER_DIM);
        });

        // Contact rail — blocky handler bank (top), volumetric bricks
        const railG = sch.append("g").attr("class", "rail");
        railG.append("rect")
            .attr("x", SCH.x + 18)
            .attr("y", RAIL_Y - 10)
            .attr("width", SCH.w - depth - 36)
            .attr("height", 16)
            .attr("fill", AMBER_FILL)
            .attr("stroke", AMBER)
            .attr("stroke-width", 1);
        // depth lip on rail
        railG.append("path")
            .attr("d", [
                `M${SCH.x + 18},${RAIL_Y - 10}`,
                `l4,-4`,
                `h${SCH.w - depth - 36}`,
                `l-4,4`,
                "Z",
            ].join(""))
            .attr("fill", AMBER_SHADE)
            .attr("stroke", AMBER_DIM)
            .attr("stroke-width", 0.8);

        railG.append("text")
            .attr("x", SCH.x + 22)
            .attr("y", RAIL_Y - 16)
            .attr("fill", AMBER_MID)
            .attr("font-size", 7)
            .attr("font-family", "Share Tech Mono, monospace")
            .attr("letter-spacing", "0.1em")
            .text("HANDLER BUS");

        // Per-slot contact blocks on the rail
        SLOTS.forEach((slot, i) => {
            const x = armX(i);
            railG.append("rect")
                .attr("class", `contact contact-${i}`)
                .attr("x", x - 5)
                .attr("y", RAIL_Y - 7)
                .attr("width", 10)
                .attr("height", 10)
                .attr("fill", "#050505")
                .attr("stroke", AMBER_MID)
                .attr("stroke-width", 1);
        });

        // Horizontal shaft — thick tube with end caps (the real selector axle)
        const shaftG = sch.append("g").attr("class", "shaft");
        const sx0 = SCH.x + 16;
        const sx1 = SCH.x + SCH.w - depth - 16;
        // underside shade
        shaftG.append("rect")
            .attr("x", sx0)
            .attr("y", SHAFT_Y - 2)
            .attr("width", sx1 - sx0)
            .attr("height", 8)
            .attr("rx", 3)
            .attr("fill", AMBER_SHADE)
            .attr("stroke", "none");
        shaftG.append("rect")
            .attr("x", sx0)
            .attr("y", SHAFT_Y - 5)
            .attr("width", sx1 - sx0)
            .attr("height", 8)
            .attr("rx", 3)
            .attr("fill", AMBER_FILL)
            .attr("stroke", AMBER)
            .attr("stroke-width", 1.2);
        // highlight line on shaft
        shaftG.append("line")
            .attr("x1", sx0 + 6)
            .attr("x2", sx1 - 6)
            .attr("y1", SHAFT_Y - 3)
            .attr("y2", SHAFT_Y - 3)
            .attr("stroke", AMBER_HOT)
            .attr("stroke-width", 0.7)
            .attr("opacity", 0.5);
        // end collars
        [sx0, sx1].forEach((ex) => {
            shaftG.append("rect")
                .attr("x", ex - 4)
                .attr("y", SHAFT_Y - 8)
                .attr("width", 8)
                .attr("height", 14)
                .attr("rx", 1)
                .attr("fill", AMBER_FILL)
                .attr("stroke", AMBER)
                .attr("stroke-width", 1);
        });

        shaftG.append("text")
            .attr("x", (sx0 + sx1) / 2)
            .attr("y", SCH.y + SCH.h - 14)
            .attr("text-anchor", "middle")
            .attr("fill", AMBER_DIM)
            .attr("font-size", 7)
            .attr("font-family", "Share Tech Mono, monospace")
            .attr("letter-spacing", "0.12em")
            .text("SHAFT = sys_call_table[]");

        // Arms
        const arms = sch.append("g").attr("class", "arms");
        const enter = arms.selectAll("g.arm").data(SLOTS).enter().append("g")
            .attr("class", (d, i) => `arm arm-${i}`)
            .style("cursor", "pointer")
            .on("click", (event, d) => {
                const i = SLOTS.indexOf(d);
                state.focus = state.focus === i ? null : i;
                paint();
                renderMenu();
            });

        // Build volumetric rocker once; paint() only rotates + restyles.
        enter.each(function () {
            const g = d3.select(this);
            // shadow face of arm body (depth)
            g.append("path").attr("class", "arm-shade");
            // main arm body (connecting-rod silhouette)
            g.append("path").attr("class", "arm-body");
            // hub boss on shaft
            g.append("circle").attr("class", "arm-hub-outer").attr("r", 7);
            g.append("circle").attr("class", "arm-hub-inner").attr("r", 3.2);
            g.append("circle").attr("class", "arm-hub-pin").attr("r", 1.2);
            // tip yoke
            g.append("path").attr("class", "arm-yoke");
            // roller
            g.append("circle").attr("class", "arm-roller-outer").attr("r", 5.5);
            g.append("circle").attr("class", "arm-roller-inner").attr("r", 2.2);
            // nr stamp near hub
            g.append("text")
                .attr("class", "arm-nr")
                .attr("text-anchor", "middle")
                .attr("font-size", 6)
                .attr("font-family", "Share Tech Mono, monospace");
        });

        // Menu
        svg.append("g").attr("class", "menu");
        svg.append("text")
            .attr("x", MENU_X)
            .attr("y", SCH.y + 8)
            .attr("fill", AMBER_MID)
            .attr("font-size", 8)
            .attr("font-family", "Share Tech Mono, monospace")
            .attr("letter-spacing", "0.14em")
            .text("DISPATCH ENTRIES");

        svg.append("text")
            .attr("x", 24)
            .attr("y", H - 16)
            .attr("fill", AMBER_DIM)
            .attr("font-size", 9)
            .attr("font-family", "Share Tech Mono, monospace")
            .attr("class", "footer-live");

        svg.append("text")
            .attr("x", 24)
            .attr("y", H - 2)
            .attr("fill", AMBER_DIM)
            .attr("font-size", 8)
            .attr("font-family", "Share Tech Mono, monospace")
            .text("UP = active slot   ·   DOWN = idle   ·   ROLLER → handler contact");

        paint();
        renderMenu();
    }

    // Connecting-rod outline in local coords: hub at 0,0, tip along +Y (we rotate the group).
    // Local +Y points toward the tip so rotate(angle) with SVG convention works from shaft.
    function rodBodyPath() {
        const half = 4.2;
        const tip = ARM_LEN - 10;
        // tapered bar with shoulder near hub
        return [
            `M${-half - 1},6`,
            `L${-half},14`,
            `L${-half + 0.8},${tip}`,
            `L${half - 0.8},${tip}`,
            `L${half},14`,
            `L${half + 1},6`,
            "Z",
        ].join(" ");
    }

    function rodShadePath() {
        const tip = ARM_LEN - 10;
        return [
            `M4.2,14`,
            `L${4.2 + 3},11`,
            `L${4.2 + 2.2},${tip - 2}`,
            `L${4.2 - 0.8},${tip}`,
            "Z",
        ].join(" ");
    }

    function yokePath() {
        const y = ARM_LEN - 10;
        return [
            `M-5.5,${y}`,
            `L-5.5,${y + 7}`,
            `L-2.2,${y + 7}`,
            `L-2.2,${y + 3}`,
            `L2.2,${y + 3}`,
            `L2.2,${y + 7}`,
            `L5.5,${y + 7}`,
            `L5.5,${y}`,
            "Z",
        ].join(" ");
    }

    function paint() {
        if (!svg) return;

        svg.selectAll("g.arm").each(function (slot, i) {
            const g = d3.select(this);
            const x = armX(i);
            const ang = armAngle(slot, i);
            const hot = hotness(slot);
            const focused = state.focus === i;
            const active = hot > 0 || focused;

            // Local arm is drawn along +Y; SVG rotate(0) points right — offset so
            // angle -90 ≈ straight up toward the rail.
            g.attr("transform", `translate(${x},${SHAFT_Y}) rotate(${ang + 90})`);

            const stroke = active ? AMBER_HOT : AMBER_MID;
            const fill = active ? AMBER_FILL_HOT : AMBER_FILL;

            g.select(".arm-shade")
                .attr("d", rodShadePath())
                .attr("fill", AMBER_SHADE)
                .attr("stroke", "none");

            g.select(".arm-body")
                .attr("d", rodBodyPath())
                .attr("fill", fill)
                .attr("stroke", stroke)
                .attr("stroke-width", active ? 1.35 : 1.05);

            g.select(".arm-hub-outer")
                .attr("cx", 0).attr("cy", 0)
                .attr("fill", fill)
                .attr("stroke", stroke)
                .attr("stroke-width", 1.2);

            g.select(".arm-hub-inner")
                .attr("cx", 0).attr("cy", 0)
                .attr("fill", "#050505")
                .attr("stroke", stroke)
                .attr("stroke-width", 1);

            g.select(".arm-hub-pin")
                .attr("cx", 0).attr("cy", 0)
                .attr("fill", active ? AMBER_HOT : AMBER_DIM)
                .attr("stroke", "none");

            g.select(".arm-yoke")
                .attr("d", yokePath())
                .attr("fill", fill)
                .attr("stroke", stroke)
                .attr("stroke-width", 1);

            const ry = ARM_LEN - 2;
            g.select(".arm-roller-outer")
                .attr("cx", 0).attr("cy", ry)
                .attr("fill", active ? AMBER : "#050505")
                .attr("fill-opacity", active ? 0.9 : 1)
                .attr("stroke", stroke)
                .attr("stroke-width", 1.2)
                .attr("filter", active ? "url(#amber-glow)" : null);

            g.select(".arm-roller-inner")
                .attr("cx", 0).attr("cy", ry)
                .attr("fill", "none")
                .attr("stroke", active ? "#050505" : AMBER_DIM)
                .attr("stroke-width", 1);

            g.select(".arm-nr")
                .attr("x", 0)
                .attr("y", 22)
                .attr("fill", active ? AMBER_HOT : AMBER_DIM)
                .attr("transform", `rotate(${-(ang + 90)})`) // keep nr upright-ish
                .text(String(slot.nr));

            svg.select(`.contact-${i}`)
                .attr("fill", active ? AMBER : "#050505")
                .attr("stroke", active ? AMBER_HOT : AMBER_MID)
                .attr("stroke-width", active ? 1.4 : 1);
        });
    }

    function renderMenu() {
        if (!svg) return;
        const menu = svg.select("g.menu");
        const rowH = 26;
        const startY = SCH.y + 22;

        const rows = menu.selectAll("g.menu-row").data(SLOTS, (d) => d.nr);
        const enter = rows.enter().append("g")
            .attr("class", "menu-row")
            .style("cursor", "pointer")
            .on("click", (event, d) => {
                const i = SLOTS.indexOf(d);
                state.focus = state.focus === i ? null : i;
                paint();
                renderMenu();
            });

        enter.append("rect").attr("class", "menu-bar");
        enter.append("circle").attr("class", "menu-dot");
        enter.append("text").attr("class", "menu-nr");
        enter.append("text").attr("class", "menu-name");
        enter.append("text").attr("class", "menu-meta");

        const all = enter.merge(rows);
        all.attr("transform", (d, i) => `translate(${MENU_X},${startY + i * rowH})`);

        all.each(function (slot, i) {
            const g = d3.select(this);
            const live = liveFor(slot);
            const hot = hotness(slot) > 0;
            const focused = state.focus === i;
            const on = hot || focused;

            g.select(".menu-bar")
                .attr("x", 0).attr("y", 0)
                .attr("width", 300).attr("height", rowH - 5)
                .attr("fill", on ? "rgba(226,163,62,0.09)" : "rgba(226,163,62,0.03)")
                .attr("stroke", on ? AMBER_MID : AMBER_DIM)
                .attr("stroke-width", focused ? 1.2 : 0.6);

            g.select(".menu-dot")
                .attr("cx", 14).attr("cy", 10).attr("r", 3.5)
                .attr("fill", hot ? AMBER : "none")
                .attr("stroke", AMBER).attr("stroke-width", 1);

            g.select(".menu-nr")
                .attr("x", 28).attr("y", 13)
                .attr("fill", AMBER_MID)
                .attr("font-size", 9)
                .attr("font-family", "Share Tech Mono, monospace")
                .text(String(slot.nr).padStart(3, "0"));

            g.select(".menu-name")
                .attr("x", 58).attr("y", 13)
                .attr("fill", on ? AMBER_HOT : AMBER)
                .attr("font-size", 10)
                .attr("font-family", "Share Tech Mono, monospace")
                .attr("letter-spacing", "0.06em")
                .text(slot.name.toUpperCase());

            g.select(".menu-meta")
                .attr("x", 288).attr("y", 13)
                .attr("text-anchor", "end")
                .attr("fill", AMBER_MID)
                .attr("font-size", 8)
                .attr("font-family", "Share Tech Mono, monospace")
                .text(live ? `×${live.count}` : "—");
        });

        rows.exit().remove();

        const names = [];
        state.live.forEach((v, k) => {
            if (k === v.name) names.push(k);
        });
        svg.select(".footer-live").text(
            state.ts
                ? `SAMPLE ${state.ts}${names.length ? `   ${clip(names.join(" · ").toUpperCase(), 52)}` : "   NO PARKED"}`
                : "WAITING FOR /PROC SAMPLE…"
        );
    }

    function ingest(data) {
        const map = new Map();
        const rows = data && Array.isArray(data.syscalls) ? data.syscalls : [];
        rows.forEach((row) => {
            const name = String((row && row.name) || "").trim();
            if (!name) return;
            const entry = {
                name,
                nr: row.nr,
                count: Number(row.count) || 0,
                waiters: Array.isArray(row.waiters) ? row.waiters : [],
            };
            map.set(name, entry);
            map.set(name.toLowerCase(), entry);
        });
        state.live = map;
        state.ts = data && data.timestamp
            ? new Date(data.timestamp).toTimeString().slice(0, 8)
            : "";
        paint();
        renderMenu();
    }

    function poll() {
        fetch("/api/syscalls-realtime", { cache: "no-store" })
            .then((r) => r.json())
            .then(ingest)
            .catch(() => {});
    }

    function start() {
        build();
        poll();
        setInterval(poll, 1500);
    }

    return { start };
})();

document.addEventListener("DOMContentLoaded", () => SyscallSelector.start());
