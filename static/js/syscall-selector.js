// Small amber-on-black schematic: elevator selector as sys_call_table.
// Wireframe / robot-blueprint style — sits beside a menu as a visual decode.
const SyscallSelector = (() => {
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
        { nr: 281, name: "epoll_pwait" },
        { nr: 318, name: "getrandom" },
    ];

    // Compact schematic — drone-icon scale, not a full machine plate.
    const SCH = { x: 28, y: 56, w: 120, h: 320 };
    const MENU_X = 180;
    const W = 560;
    const H = 420;
    const AMBER = "#e2a33e";
    const AMBER_DIM = "rgba(226,163,62,0.28)";
    const AMBER_MID = "rgba(226,163,62,0.55)";
    const AMBER_HOT = "#f0c56a";

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
        return Math.max(0.4, Math.min(1, 0.4 + live.count / 10));
    }

    function pegY(i) {
        const top = SCH.y + 36;
        const bot = SCH.y + SCH.h - 28;
        return top + (i / Math.max(1, SLOTS.length - 1)) * (bot - top);
    }

    function build() {
        const host = d3.select("#syscall-selector");
        host.selectAll("*").remove();
        svg = host
            .append("svg")
            .attr("viewBox", `0 0 ${W} ${H}`)
            .attr("class", "syscall-selector-svg");

        // Title strip
        svg.append("text")
            .attr("x", 28)
            .attr("y", 28)
            .attr("fill", AMBER)
            .attr("font-size", 11)
            .attr("font-family", "Share Tech Mono, monospace")
            .attr("letter-spacing", "0.18em")
            .text("SYS_CALL_TABLE");

        svg.append("text")
            .attr("x", 28)
            .attr("y", 44)
            .attr("fill", AMBER_MID)
            .attr("font-size", 9)
            .attr("font-family", "Share Tech Mono, monospace")
            .text("SELECTOR  ·  VISUAL DECODE");

        // --- Schematic (left): vertical spine + side pegs, robot wireframe ---
        const sch = svg.append("g").attr("class", "schematic");

        // Soft frame, thin — like HUD glass
        sch.append("rect")
            .attr("x", SCH.x)
            .attr("y", SCH.y)
            .attr("width", SCH.w)
            .attr("height", SCH.h)
            .attr("fill", "none")
            .attr("stroke", AMBER_DIM)
            .attr("stroke-width", 1);

        // Corner ticks
        const tick = 8;
        [
            [SCH.x, SCH.y],
            [SCH.x + SCH.w, SCH.y],
            [SCH.x, SCH.y + SCH.h],
            [SCH.x + SCH.w, SCH.y + SCH.h],
        ].forEach(([cx, cy], idx) => {
            const dx = idx % 2 === 0 ? tick : -tick;
            const dy = idx < 2 ? tick : -tick;
            sch.append("path")
                .attr("d", `M${cx} ${cy + dy} V${cy} H${cx + dx}`)
                .attr("fill", "none")
                .attr("stroke", AMBER_MID)
                .attr("stroke-width", 1);
        });

        // Spine (table axis) — vertical rod like the cylinder selector
        const spineX = SCH.x + SCH.w / 2;
        sch.append("line")
            .attr("class", "spine")
            .attr("x1", spineX)
            .attr("x2", spineX)
            .attr("y1", SCH.y + 22)
            .attr("y2", SCH.y + SCH.h - 16)
            .attr("stroke", AMBER)
            .attr("stroke-width", 1.4);

        // Caps on spine (robot joint style)
        [SCH.y + 22, SCH.y + SCH.h - 16].forEach((yy) => {
            sch.append("circle")
                .attr("cx", spineX)
                .attr("cy", yy)
                .attr("r", 3)
                .attr("fill", "none")
                .attr("stroke", AMBER)
                .attr("stroke-width", 1);
        });

        // Contact bus on the right edge of schematic (handlers)
        sch.append("line")
            .attr("x1", SCH.x + SCH.w - 14)
            .attr("x2", SCH.x + SCH.w - 14)
            .attr("y1", SCH.y + 28)
            .attr("y2", SCH.y + SCH.h - 22)
            .attr("stroke", AMBER_DIM)
            .attr("stroke-width", 1)
            .attr("stroke-dasharray", "2 3");

        sch.append("text")
            .attr("x", spineX)
            .attr("y", SCH.y + 14)
            .attr("text-anchor", "middle")
            .attr("fill", AMBER_MID)
            .attr("font-size", 7)
            .attr("font-family", "Share Tech Mono, monospace")
            .attr("letter-spacing", "0.12em")
            .text("TABLE");

        const pegs = sch.append("g").attr("class", "pegs");
        const pegEnter = pegs.selectAll("g.peg").data(SLOTS).enter().append("g")
            .attr("class", (d, i) => `peg peg-${i}`)
            .style("cursor", "pointer")
            .on("click", (event, d) => {
                const i = SLOTS.indexOf(d);
                state.focus = state.focus === i ? null : i;
                paint();
                renderMenu();
            });

        pegEnter.append("line").attr("class", "peg-arm");
        pegEnter.append("circle").attr("class", "peg-joint").attr("r", 2.2).attr("fill", "none");
        pegEnter.append("circle").attr("class", "peg-tip").attr("r", 2.4).attr("fill", "none");
        pegEnter.append("line").attr("class", "peg-contact"); // tip → bus when hot

        // --- Menu (right): Westworld-style stacked bars ---
        svg.append("g").attr("class", "menu");

        svg.append("text")
            .attr("x", MENU_X)
            .attr("y", SCH.y + 12)
            .attr("fill", AMBER_MID)
            .attr("font-size", 8)
            .attr("font-family", "Share Tech Mono, monospace")
            .attr("letter-spacing", "0.14em")
            .text("DISPATCH ENTRIES");

        // Footer decode key
        svg.append("text")
            .attr("x", 28)
            .attr("y", H - 18)
            .attr("fill", AMBER_DIM)
            .attr("font-size", 9)
            .attr("font-family", "Share Tech Mono, monospace")
            .attr("class", "footer-live")
            .text("");

        svg.append("text")
            .attr("x", 28)
            .attr("y", H - 4)
            .attr("fill", AMBER_DIM)
            .attr("font-size", 8)
            .attr("font-family", "Share Tech Mono, monospace")
            .text("SPINE = table[]   ·   PEG = nr   ·   TILT + CONTACT = active dispatch");

        paint();
        renderMenu();
    }

    function paint() {
        if (!svg) return;
        const spineX = SCH.x + SCH.w / 2;
        const busX = SCH.x + SCH.w - 14;

        svg.selectAll("g.peg").each(function (slot, i) {
            const g = d3.select(this);
            const y = pegY(i);
            const hot = hotness(slot);
            const focused = state.focus === i;
            const active = hot > 0 || focused;

            // Idle: short peg to the right. Active: longer arm tilted up toward bus.
            const idleLen = 22;
            const hotLen = 42;
            const len = idleLen + (hotLen - idleLen) * (focused ? Math.max(hot, 0.85) : hot);
            // Tilt sideways-up when engaged (degrees from horizontal)
            const tilt = active ? -28 * (focused ? Math.max(hot, 0.7) : hot) : 0;
            const rad = (tilt * Math.PI) / 180;
            const tipX = spineX + Math.cos(rad) * len;
            const tipY = y + Math.sin(rad) * len;

            const stroke = active ? AMBER_HOT : AMBER_MID;
            const width = active ? 1.35 : 1;

            g.select(".peg-arm")
                .attr("x1", spineX)
                .attr("y1", y)
                .attr("x2", tipX)
                .attr("y2", tipY)
                .attr("stroke", stroke)
                .attr("stroke-width", width);

            g.select(".peg-joint")
                .attr("cx", spineX)
                .attr("cy", y)
                .attr("stroke", stroke)
                .attr("stroke-width", 1);

            g.select(".peg-tip")
                .attr("cx", tipX)
                .attr("cy", tipY)
                .attr("stroke", active ? AMBER_HOT : AMBER_DIM)
                .attr("stroke-width", 1)
                .attr("fill", active ? AMBER : "none")
                .attr("fill-opacity", active ? 0.85 : 0);

            // Contact line to bus only when engaged
            g.select(".peg-contact")
                .attr("x1", tipX)
                .attr("y1", tipY)
                .attr("x2", busX)
                .attr("y2", tipY)
                .attr("stroke", active ? AMBER : "transparent")
                .attr("stroke-width", 0.8)
                .attr("stroke-dasharray", active ? "1.5 2" : null)
                .attr("opacity", active ? 0.7 : 0);
        });
    }

    function renderMenu() {
        if (!svg) return;
        const menu = svg.select("g.menu");
        const rowH = 24;
        const startY = SCH.y + 28;

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
                .attr("x", 0)
                .attr("y", 0)
                .attr("width", 340)
                .attr("height", rowH - 4)
                .attr("fill", on ? "rgba(226,163,62,0.08)" : "rgba(226,163,62,0.03)")
                .attr("stroke", on ? AMBER_MID : AMBER_DIM)
                .attr("stroke-width", focused ? 1.2 : 0.6);

            g.select(".menu-dot")
                .attr("cx", 14)
                .attr("cy", 10)
                .attr("r", 3.5)
                .attr("fill", hot ? AMBER : "none")
                .attr("stroke", AMBER)
                .attr("stroke-width", 1);

            g.select(".menu-nr")
                .attr("x", 28)
                .attr("y", 13)
                .attr("fill", AMBER_MID)
                .attr("font-size", 9)
                .attr("font-family", "Share Tech Mono, monospace")
                .text(String(slot.nr).padStart(3, "0"));

            g.select(".menu-name")
                .attr("x", 58)
                .attr("y", 13)
                .attr("fill", on ? AMBER_HOT : AMBER)
                .attr("font-size", 10)
                .attr("font-family", "Share Tech Mono, monospace")
                .attr("letter-spacing", "0.06em")
                .text(slot.name.toUpperCase());

            g.select(".menu-meta")
                .attr("x", 328)
                .attr("y", 13)
                .attr("text-anchor", "end")
                .attr("fill", AMBER_MID)
                .attr("font-size", 8)
                .attr("font-family", "Share Tech Mono, monospace")
                .text(live ? `×${live.count}` : "—");
        });

        rows.exit().remove();

        const liveNames = [...new Set([...state.live.keys()].filter((k) => k === k.toLowerCase() || !state.live.has(k.toLowerCase())))]
            .slice(0, 5)
            .join(" · ");
        svg.select(".footer-live").text(
            state.ts
                ? `SAMPLE ${state.ts}${liveNames ? `   ${clip(liveNames.toUpperCase(), 48)}` : "   NO PARKED"}`
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
