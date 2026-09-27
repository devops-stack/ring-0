// CONNECTION DEVICE: a short Hex on the kernel's pads.
//
// You are a syscall and need a chain from RING3 (left) to RING0 (right).
// The kernel is trying to run an IRQ path from the top of the board to the
// task at the bottom. One pad a turn. First continuous chain wins.
const ConnectionDevice = (() => {
    const N = 4;
    const YOU = 1;
    const KERNEL = 2;
    const AMBER = "#e2a33e";
    const CYAN = "#67c8e0";
    const MINT = "#3d8f7a";
    const LIGHT = "rgba(244,244,236,0.92)";
    const DIM = "rgba(244,244,236,0.46)";
    const FAINT = "rgba(244,244,236,0.22)";
    const RAIL = "rgba(61,143,122,0.55)";
    const INK = "#070a0c";
    const PLATE = "#0c1210";
    const MONO = "Share Tech Mono, monospace";

    const CELLS = [
        ["SCH", "MEM", "FS", "NET"],
        ["IRQ", "BIO", "SOCK", "PAGE"],
        ["LOCK", "SLAB", "PIPE", "DMA"],
        ["WAIT", "FILE", "FUTEX", "RCU"]
    ];

    const DIRS = [[0, 1], [0, -1], [1, 0], [-1, 0]];

    const state = {
        open: false,
        board: emptyBoard(),
        turn: YOU,
        over: null,
        path: [],
        busy: false,
        topKeeper: null
    };

    function emptyBoard() {
        return Array.from({ length: N }, () => Array(N).fill(0));
    }

    function reducedMotion() {
        return typeof window.matchMedia === "function"
            && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

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
        const node = d3.select("svg").node();
        const px = node && box.w > 0 ? node.clientWidth / box.w : 1;
        const floor = !columns && Number(window.__mobileHeroBottom) > 0
            ? box.y + Number(window.__mobileHeroBottom) / px
            : box.y + box.h;
        const top = box.y + (columns ? 92 : 100);
        const bot = columns ? box.y + box.h - 70 : floor - 12;
        const cx = box.x + box.w / 2;
        const cy = (top + bot) / 2;
        const budget = Math.min(columns ? 420 : 280, box.w * 0.62, bot - top - 8);
        const step = budget / N;
        const radius = step * 0.34;
        const originX = cx - (step * (N - 1)) / 2;
        const originY = cy - (step * (N - 1)) / 2;
        const at = [];
        for (let r = 0; r < N; r += 1) {
            at[r] = [];
            for (let c = 0; c < N; c += 1) {
                at[r][c] = { x: originX + c * step, y: originY + r * step };
            }
        }
        const plate = {
            x: originX - step * 0.62,
            y: originY - step * 0.62,
            w: step * (N - 1) + step * 1.24,
            h: step * (N - 1) + step * 1.24
        };
        return { box, columns, cx, cy, top, bot, step, radius, at, plate };
    }

    function inside(r, c) {
        return r >= 0 && r < N && c >= 0 && c < N;
    }

    function neighbors(r, c) {
        return DIRS.map(([dr, dc]) => [r + dr, c + dc]).filter(([nr, nc]) => inside(nr, nc));
    }

    function walk(who, board, wild) {
        const start = [];
        if (who === YOU) {
            for (let r = 0; r < N; r += 1) if (board[r][0] === who) start.push([r, 0]);
        } else {
            for (let c = 0; c < N; c += 1) if (board[0][c] === who) start.push([0, c]);
        }
        const seen = new Set();
        const prev = new Map();
        const queue = start.slice();
        start.forEach(([r, c]) => seen.add(`${r},${c}`));
        const isEnd = who === YOU
            ? (r, c) => c === N - 1
            : (r, c) => r === N - 1;
        while (queue.length) {
            const [r, c] = queue.shift();
            if (isEnd(r, c)) {
                const path = [[r, c]];
                let key = `${r},${c}`;
                while (prev.has(key)) {
                    const p = prev.get(key);
                    path.push(p);
                    key = `${p[0]},${p[1]}`;
                }
                return path.reverse();
            }
            neighbors(r, c).forEach(([nr, nc]) => {
                const key = `${nr},${nc}`;
                if (seen.has(key)) return;
                const cell = board[nr][nc];
                if (cell !== who && !(wild && cell === 0)) return;
                seen.add(key);
                prev.set(key, [r, c]);
                queue.push([nr, nc]);
            });
        }
        return null;
    }

    function approach(who, board) {
        const start = [];
        const dist = Array.from({ length: N }, () => Array(N).fill(Infinity));
        if (who === YOU) {
            for (let r = 0; r < N; r += 1) {
                if (board[r][0] === who || board[r][0] === 0) {
                    start.push([r, 0]);
                    dist[r][0] = board[r][0] === who ? 0 : 1;
                }
            }
        } else {
            for (let c = 0; c < N; c += 1) {
                if (board[0][c] === who || board[0][c] === 0) {
                    start.push([0, c]);
                    dist[0][c] = board[0][c] === who ? 0 : 1;
                }
            }
        }
        const queue = start.slice();
        while (queue.length) {
            const [r, c] = queue.shift();
            neighbors(r, c).forEach(([nr, nc]) => {
                const cell = board[nr][nc];
                if (cell !== who && cell !== 0) return;
                const next = dist[r][c] + (cell === 0 ? 1 : 0);
                if (next >= dist[nr][nc]) return;
                dist[nr][nc] = next;
                queue.push([nr, nc]);
            });
        }
        let best = Infinity;
        if (who === YOU) {
            for (let r = 0; r < N; r += 1) best = Math.min(best, dist[r][N - 1]);
        } else {
            for (let c = 0; c < N; c += 1) best = Math.min(best, dist[N - 1][c]);
        }
        return best;
    }

    function empties(board) {
        const list = [];
        for (let r = 0; r < N; r += 1) {
            for (let c = 0; c < N; c += 1) {
                if (board[r][c] === 0) list.push([r, c]);
            }
        }
        return list;
    }

    function kernelPick() {
        const open = empties(state.board);
        let best = null;
        let score = -Infinity;
        open.forEach(([r, c]) => {
            const mine = state.board.map((row) => row.slice());
            mine[r][c] = KERNEL;
            if (walk(KERNEL, mine, false)) {
                best = [r, c];
                score = 10000;
                return;
            }
            const theirs = state.board.map((row) => row.slice());
            theirs[r][c] = YOU;
            let value = 0;
            if (walk(YOU, theirs, false)) value += 4000;
            value += (8 - approach(KERNEL, mine)) * 20;
            value += approach(YOU, mine) * 8;
            value += (r === 1 || r === 2) && (c === 1 || c === 2) ? 3 : 0;
            if (value > score) {
                score = value;
                best = [r, c];
            }
        });
        return best;
    }

    function reset() {
        state.board = emptyBoard();
        state.turn = YOU;
        state.over = null;
        state.path = [];
        state.busy = false;
    }

    function finish(who, path) {
        state.over = who;
        state.path = path || [];
        state.turn = 0;
        state.busy = false;
        paint();
    }

    function lens(code) {
        if (!window.KernelTape || typeof window.KernelTape.setTagFilter !== "function") return;
        window.KernelTape.setTagFilter(code, { source: "game" });
    }

    function place(who, r, c) {
        if (state.over || state.board[r][c] !== 0) return;
        state.board[r][c] = who;
        lens(CELLS[r][c]);
        const path = walk(who, state.board, false);
        if (path) {
            finish(who, path);
            return;
        }
        if (!empties(state.board).length) {
            state.over = 0;
            state.turn = 0;
            state.busy = false;
            paint();
            return;
        }
        state.turn = who === YOU ? KERNEL : YOU;
        paint();
        if (state.turn === KERNEL) {
            state.busy = true;
            window.setTimeout(() => {
                if (!state.open || state.over) return;
                const pick = kernelPick();
                state.busy = false;
                if (pick) place(KERNEL, pick[0], pick[1]);
            }, reducedMotion() ? 0 : 260);
        }
    }

    function lineText() {
        if (state.over === YOU) return "SYSCALL CONNECTED · RING3 → RING0";
        if (state.over === KERNEL) return "IRQ CONNECTED · TOP → TASK";
        if (state.over === 0) return "BOARD FULL · NO PATH";
        return state.turn === YOU ? "YOUR MOVE · OCCUPY A PAD" : "KERNEL MOVES";
    }

    function label(parent, cls, x, y, text, options) {
        options = options || {};
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

    function octagon(cx, cy, radius) {
        const cut = radius * 0.42;
        return [
            [cx - radius + cut, cy - radius],
            [cx + radius - cut, cy - radius],
            [cx + radius, cy - radius + cut],
            [cx + radius, cy + radius - cut],
            [cx + radius - cut, cy + radius],
            [cx - radius + cut, cy + radius],
            [cx - radius, cy + radius - cut],
            [cx - radius, cy - radius + cut]
        ].map((p) => p.map((n) => n.toFixed(2)).join(",")).join(" ");
    }

    function ownerColor(who, empty) {
        if (who === YOU) return CYAN;
        if (who === KERNEL) return AMBER;
        return empty;
    }

    function onPath(r, c) {
        return state.path.some((p) => p[0] === r && p[1] === c);
    }

    function close() {
        if (!state.open) return;
        state.open = false;
        d3.select("svg").selectAll(".cdev-scrim, .cdev-layer").interrupt().remove();
        if (state.topKeeper) state.topKeeper.stop();
        d3.select("body").on("keydown.cdev", null);
        if (window.KernelTape && typeof window.KernelTape.clearTagFilter === "function") {
            window.KernelTape.clearTagFilter("game");
        }
        window.dispatchEvent(new CustomEvent("kcard-closed"));
    }

    function open() {
        if (state.open) {
            close();
            return;
        }
        state.open = true;
        reset();
        mount();
        d3.select("body").on("keydown.cdev", (event) => {
            if (event.key !== "Escape") return;
            event.stopImmediatePropagation();
            close();
        });
    }

    function mount() {
        const view = layout();
        const box = view.box;
        const svgRoot = d3.select("svg");
        svgRoot.selectAll(".cdev-scrim, .cdev-layer").remove();

        svgRoot.append("rect")
            .attr("class", "cdev-scrim")
            .attr("x", box.x - 80).attr("y", box.y - 80)
            .attr("width", box.w + 160).attr("height", box.h + 160)
            .attr("fill", INK)
            .style("cursor", "pointer")
            .style("opacity", 0)
            .on("click", close)
            .transition().duration(reducedMotion() ? 0 : 160).style("opacity", 0.985);

        const layer = svgRoot.append("g")
            .attr("class", "cdev-layer")
            .style("opacity", 0)
            .on("click", (event) => event.stopPropagation());
        layer.transition().delay(reducedMotion() ? 0 : 80).duration(reducedMotion() ? 0 : 160)
            .style("opacity", 1);

        if (!state.topKeeper && typeof createOverlayTopKeeper === "function") {
            state.topKeeper = createOverlayTopKeeper(
                "cdev-scrim", ["cdev-layer"], () => state.open
            );
        }
        if (state.topKeeper) state.topKeeper.start();

        const pad = view.columns ? 34 : 22;
        const left = box.x + pad;
        const right = box.x + box.w - pad;
        const headY = view.columns ? box.y + 40 : view.top - 6;
        label(layer, "cdev-title", left, headY, "CONNECTION DEVICE", {
            size: view.columns ? 13 : 10, spacing: 1.6
        });
        label(layer, "cdev-source", right, headY, "SYSCALL × IRQ", {
            size: view.columns ? 10 : 8, anchor: "end", fill: DIM
        });
        if (view.columns) {
            layer.append("line")
                .attr("x1", left).attr("y1", box.y + 50)
                .attr("x2", right).attr("y2", box.y + 50)
                .attr("stroke", FAINT).attr("stroke-width", 0.7);
        }

        const plate = view.plate;
        layer.append("rect")
            .attr("class", "cdev-plate")
            .attr("x", plate.x).attr("y", plate.y)
            .attr("width", plate.w).attr("height", plate.h)
            .attr("rx", 18).attr("ry", 18)
            .attr("fill", PLATE)
            .attr("stroke", MINT)
            .attr("stroke-opacity", 0.35)
            .attr("stroke-width", 1.1);

        label(layer, "cdev-port-left", plate.x - 10, view.cy + 3, "RING3", {
            size: view.columns ? 9 : 7.5, anchor: "end", fill: CYAN, spacing: 1.1
        });
        label(layer, "cdev-port-right", plate.x + plate.w + 10, view.cy + 3, "RING0", {
            size: view.columns ? 9 : 7.5, fill: CYAN, spacing: 1.1
        });
        label(layer, "cdev-port-top", view.cx, plate.y - 8, "IRQ", {
            size: view.columns ? 9 : 7.5, anchor: "middle", fill: AMBER, spacing: 1.1
        });
        label(layer, "cdev-port-bot", view.cx, plate.y + plate.h + 16, "TASK", {
            size: view.columns ? 9 : 7.5, anchor: "middle", fill: AMBER, spacing: 1.1
        });

        layer.append("g").attr("class", "cdev-rails");
        const pads = layer.append("g").attr("class", "cdev-pads");
        for (let r = 0; r < N; r += 1) {
            for (let c = 0; c < N; c += 1) {
                const at = view.at[r][c];
                const padG = pads.append("g")
                    .attr("class", `cdev-pad cdev-pad-${r}-${c}`)
                    .attr("transform", `translate(${at.x.toFixed(2)} ${at.y.toFixed(2)})`)
                    .style("cursor", "pointer")
                    .on("click", (event) => {
                        event.stopPropagation();
                        lens(CELLS[r][c]);
                        if (state.busy || state.over || state.turn !== YOU) return;
                        place(YOU, r, c);
                    });
                padG.append("polygon")
                    .attr("class", "cdev-pad-body")
                    .attr("points", octagon(0, 0, view.radius))
                    .attr("fill", PLATE)
                    .attr("stroke", RAIL)
                    .attr("stroke-width", 1.1);
                padG.append("circle")
                    .attr("class", "cdev-pad-core")
                    .attr("cy", -view.radius * 0.12)
                    .attr("r", view.radius * 0.22)
                    .attr("fill", "none")
                    .attr("stroke", RAIL)
                    .attr("stroke-width", 1.1);
                label(padG, "cdev-pad-code", 0, view.radius * 0.42,
                    CELLS[r][c], {
                        size: view.columns ? 7.5 : 6, anchor: "middle", fill: DIM, spacing: 0.4
                    });
            }
        }

        label(layer, "cdev-line", view.cx, view.top + (view.columns ? 4 : 10), lineText(), {
            size: view.columns ? 11 : 8.5, anchor: "middle", fill: DIM
        });

        const again = layer.append("g")
            .attr("class", "cdev-again")
            .style("cursor", "pointer")
            .style("display", "none")
            .on("click", (event) => {
                event.stopPropagation();
                reset();
                mount();
            });
        again.append("rect")
            .attr("x", right - 70).attr("y", view.bot - 20)
            .attr("width", 70).attr("height", 18)
            .attr("fill", "rgba(255,255,255,0.001)");
        label(again, "cdev-again-label", right, view.bot - 6, "AGAIN", {
            size: 9, anchor: "end", fill: CYAN
        });

        if (view.columns) {
            label(layer, "cdev-note", left, box.y + box.h - 22,
                "OCCUPY A PAD · SYSCALL JOINS LEFT TO RIGHT · IRQ JOINS TOP TO TASK", {
                    size: 9, fill: FAINT
                });
            label(layer, "cdev-connect", right, box.y + box.h - 22, "CONNECTING", {
                size: 9, anchor: "end", fill: MINT
            });
        } else {
            label(layer, "cdev-note", left, view.bot + 6,
                "LEFT→RIGHT SYSCALL · TOP→TASK IRQ", { size: 8, fill: FAINT });
        }

        paint();
    }

    function paint() {
        const layer = d3.select("svg").select(".cdev-layer");
        if (layer.empty()) return;
        const view = layout();
        const rails = layer.select(".cdev-rails");
        rails.selectAll("line").remove();

        for (let r = 0; r < N; r += 1) {
            for (let c = 0; c < N; c += 1) {
                const a = view.at[r][c];
                [[r, c + 1], [r + 1, c]].forEach(([nr, nc]) => {
                    if (!inside(nr, nc)) return;
                    const b = view.at[nr][nc];
                    const same = state.board[r][c]
                        && state.board[r][c] === state.board[nr][nc];
                    const lit = same && (
                        !state.path.length
                        || (onPath(r, c) && onPath(nr, nc))
                    );
                    const dx = b.x - a.x;
                    const dy = b.y - a.y;
                    const len = Math.hypot(dx, dy) || 1;
                    const ux = dx / len;
                    const uy = dy / len;
                    const gap = view.radius * 0.92;
                    rails.append("line")
                        .attr("x1", a.x + ux * gap).attr("y1", a.y + uy * gap)
                        .attr("x2", b.x - ux * gap).attr("y2", b.y - uy * gap)
                        .attr("stroke", ownerColor(same ? state.board[r][c] : 0, RAIL))
                        .attr("stroke-width", lit ? 2.2 : 1.1)
                        .attr("stroke-linecap", "round")
                        .attr("stroke-opacity", same ? 0.95 : 0.45);
                });
            }
        }

        for (let r = 0; r < N; r += 1) {
            for (let c = 0; c < N; c += 1) {
                const who = state.board[r][c];
                const hot = onPath(r, c);
                const pad = layer.select(`.cdev-pad-${r}-${c}`);
                pad.select(".cdev-pad-body")
                    .attr("stroke", ownerColor(who, RAIL))
                    .attr("stroke-width", who || hot ? 1.6 : 1.1)
                    .attr("fill", who === YOU
                        ? "rgba(103,200,224,0.12)"
                        : who === KERNEL ? "rgba(226,163,62,0.12)" : PLATE);
                pad.select(".cdev-pad-core")
                    .attr("stroke", ownerColor(who, RAIL))
                    .attr("fill", who ? ownerColor(who, RAIL) : "none");
                pad.select(".cdev-pad-code")
                    .attr("fill", who ? ownerColor(who, LIGHT) : DIM);
            }
        }

        layer.select(".cdev-line")
            .attr("fill", state.over === YOU ? CYAN : (state.over === KERNEL ? AMBER : DIM))
            .text(lineText());
        layer.select(".cdev-again")
            .style("display", state.over !== null ? "block" : "none");
    }

    function refit() {
        if (!state.open) return;
        mount();
    }

    window.addEventListener("resize", () => {
        if (state.open) refit();
    });

    return {
        open,
        close,
        toggle: open,
        refit,
        isOpen: () => state.open
    };
})();

window.ConnectionDevice = ConnectionDevice;
