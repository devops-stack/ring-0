// Lockdep as a small game: two tasks, one held-before graph.
//
// A real lockdep warning is not "you are deadlocked now". It is "these
// observed orders can be interleaved into a wait cycle". Unlocking a task
// clears that task's chain and leaves every edge it taught the graph.
const LockdepGame = (() => {
    const AMBER = "#e2a33e";
    const CYAN = "#67c8e0";
    const LIGHT = "rgba(244,244,236,0.92)";
    const DIM = "rgba(244,244,236,0.46)";
    const FAINT = "rgba(244,244,236,0.22)";
    const RAIL = "rgba(244,244,236,0.58)";
    const INK = "#0a0c0f";
    const MONO = "Share Tech Mono, monospace";

    const LOCKS = [
        { id: "mmap", code: "mmap", name: "mmap_lock" },
        { id: "inode", code: "inode", name: "i_rwsem" },
        { id: "rq", code: "rq", name: "rq_lock" },
        { id: "sig", code: "sig", name: "siglock" },
        { id: "dentry", code: "dentry", name: "dentry->d_lock" },
        { id: "jrnl", code: "jrnl", name: "jbd2" }
    ];

    const state = {
        open: false,
        edges: [],
        edgeSet: new Set(),
        held: { you: [], k: [] },
        over: null,
        line: "ACQUIRE A LOCK",
        topKeeper: null
    };

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
        const top = box.y + (columns ? 88 : 96);
        const bot = columns ? box.y + box.h - 64 : floor - 10;
        const cx = box.x + box.w / 2;
        const cy = (top + bot) / 2 + (columns ? 6 : 0);
        const radius = Math.max(72, Math.min(
            columns ? 168 : 104,
            box.w * (columns ? 0.2 : 0.28),
            (bot - top) * 0.34
        ));
        const at = {};
        LOCKS.forEach((lock, index) => {
            const angle = -Math.PI / 2 + (index * 2 * Math.PI) / LOCKS.length;
            at[lock.id] = {
                x: cx + Math.cos(angle) * radius,
                y: cy + Math.sin(angle) * radius
            };
        });
        return { box, columns, cx, cy, radius, at, top, bot };
    }

    function reset() {
        state.edges = [];
        state.edgeSet = new Set();
        state.held = { you: [], k: [] };
        state.over = null;
        state.line = "ACQUIRE A LOCK";
    }

    function close() {
        if (!state.open) return;
        state.open = false;
        d3.select("svg").selectAll(".lockdep-scrim, .lockdep-layer").interrupt().remove();
        if (state.topKeeper) state.topKeeper.stop();
        d3.select("body").on("keydown.lockdep", null);
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
        d3.select("body").on("keydown.lockdep", (event) => {
            if (event.key !== "Escape") return;
            event.stopImmediatePropagation();
            close();
        });
    }

    function whoName(who) {
        return who === "you" ? "T1" : "T2";
    }

    function adj(edges) {
        const map = Object.fromEntries(LOCKS.map((lock) => [lock.id, []]));
        edges.forEach(([from, to]) => map[from].push(to));
        return map;
    }

    function findCycle(edges) {
        const graph = adj(edges);
        const mark = {};
        let cycle = null;
        function walk(node, stack) {
            mark[node] = 1;
            stack.push(node);
            for (let i = 0; i < graph[node].length; i += 1) {
                const next = graph[node][i];
                if (mark[next] === 1) {
                    cycle = stack.slice(stack.indexOf(next)).concat(next);
                    return true;
                }
                if (!mark[next] && walk(next, stack)) return true;
            }
            stack.pop();
            mark[node] = 2;
            return false;
        }
        for (let i = 0; i < LOCKS.length; i += 1) {
            const id = LOCKS[i].id;
            if (!mark[id] && walk(id, [])) return cycle;
        }
        return null;
    }

    function wouldCycle(held, id) {
        const edges = state.edges.slice();
        held.forEach((lock) => {
            if (!state.edgeSet.has(`${lock}>${id}`)) edges.push([lock, id]);
        });
        return !!findCycle(edges);
    }

    function acquire(who, id) {
        if (state.over) return;
        const held = state.held[who];
        const other = who === "you" ? "k" : "you";
        if (held.indexOf(id) !== -1) {
            state.line = `${whoName(who)} already holds ${id}`;
            paint();
            return;
        }
        if (state.held[other].indexOf(id) !== -1) {
            state.line = `${whoName(who)} blocked on ${id}`;
            paint();
            return;
        }
        held.forEach((lock) => {
            const key = `${lock}>${id}`;
            if (state.edgeSet.has(key)) return;
            state.edgeSet.add(key);
            state.edges.push([lock, id]);
        });
        held.push(id);
        const cycle = findCycle(state.edges);
        state.line = `${whoName(who)} acquire ${id}`;
        if (cycle) {
            state.over = { by: who, cycle };
            state.line = who === "you"
                ? "WARNING: possible circular locking dependency"
                : "T2 · lockdep fired";
        }
        paint();
        if (!state.over && who === "you") {
            window.setTimeout(kernelMove, reducedMotion() ? 0 : 240);
        }
    }

    function unlock(who) {
        if (state.over) return;
        if (!state.held[who].length) return;
        state.held[who] = [];
        state.line = `${whoName(who)} unlock`;
        paint();
    }

    function kernelMove() {
        if (!state.open || state.over) return;
        const held = state.held.k;
        const options = LOCKS.map((lock) => lock.id).filter((id) => {
            if (held.indexOf(id) !== -1) return false;
            if (state.held.you.indexOf(id) !== -1) return false;
            return !wouldCycle(held, id);
        });
        if (held.length && (options.length === 0 || Math.random() < 0.34)) {
            unlock("k");
            return;
        }
        if (!options.length) return;
        acquire("k", options[Math.floor(Math.random() * options.length)]);
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

    function chainText(who) {
        const held = state.held[who];
        return held.length ? `${whoName(who)}  ${held.join(" → ")}` : `${whoName(who)}  —`;
    }

    function mount() {
        const view = layout();
        const box = view.box;
        const svgRoot = d3.select("svg");
        svgRoot.selectAll(".lockdep-scrim, .lockdep-layer").remove();

        svgRoot.append("rect")
            .attr("class", "lockdep-scrim")
            .attr("x", box.x - 80).attr("y", box.y - 80)
            .attr("width", box.w + 160).attr("height", box.h + 160)
            .attr("fill", INK)
            .style("cursor", "pointer")
            .style("opacity", 0)
            .on("click", close)
            .transition().duration(reducedMotion() ? 0 : 160).style("opacity", 0.985);

        const layer = svgRoot.append("g")
            .attr("class", "lockdep-layer")
            .style("opacity", 0)
            .on("click", (event) => event.stopPropagation());
        layer.transition().delay(reducedMotion() ? 0 : 80).duration(reducedMotion() ? 0 : 160)
            .style("opacity", 1);

        if (!state.topKeeper && typeof createOverlayTopKeeper === "function") {
            state.topKeeper = createOverlayTopKeeper(
                "lockdep-scrim", ["lockdep-layer"], () => state.open
            );
        }
        if (state.topKeeper) state.topKeeper.start();

        const pad = view.columns ? 34 : 22;
        const left = box.x + pad;
        const right = box.x + box.w - pad;
        const headY = view.columns ? box.y + 40 : view.top - 4;
        label(layer, "lockdep-title", left, headY,
            "LOCKDEP · HELD-BEFORE", { size: view.columns ? 13 : 10, spacing: 1.4 });
        label(layer, "lockdep-source", right, headY,
            "TWO TASKS · ONE GRAPH", {
                size: view.columns ? 10 : 8, anchor: "end", fill: DIM
            });
        if (view.columns) {
            layer.append("line")
                .attr("x1", left).attr("y1", box.y + 50)
                .attr("x2", right).attr("y2", box.y + 50)
                .attr("stroke", FAINT).attr("stroke-width", 0.7);
        }

        layer.append("g").attr("class", "lockdep-edges");
        const nodes = layer.append("g").attr("class", "lockdep-nodes");
        LOCKS.forEach((lock) => {
            const at = view.at[lock.id];
            const node = nodes.append("g")
                .attr("class", `lockdep-node lockdep-node-${lock.id}`)
                .attr("transform", `translate(${at.x.toFixed(2)} ${at.y.toFixed(2)})`)
                .style("cursor", "pointer")
                .on("click", (event) => {
                    event.stopPropagation();
                    acquire("you", lock.id);
                });
            node.append("circle")
                .attr("class", "lockdep-node-hit")
                .attr("r", view.columns ? 20 : 16)
                .attr("fill", "rgba(255,255,255,0.001)");
            node.append("circle")
                .attr("class", "lockdep-node-body")
                .attr("r", view.columns ? 15 : 13)
                .attr("fill", INK)
                .attr("stroke", RAIL)
                .attr("stroke-width", 1.1);
            label(node, "lockdep-node-code", 0, 3.5, lock.code, {
                size: view.columns ? 9 : 8, anchor: "middle", spacing: 0.6
            });
            node.append("title").text(lock.name);
        });

        label(layer, "lockdep-chain-you", left, view.bot - (view.columns ? 28 : 36),
            chainText("you"), { size: view.columns ? 10 : 8.5, fill: CYAN });
        label(layer, "lockdep-chain-k", left, view.bot - (view.columns ? 12 : 22),
            chainText("k"), { size: view.columns ? 10 : 8.5, fill: AMBER });
        label(layer, "lockdep-line", view.cx, view.top - 8, state.line, {
            size: view.columns ? 11 : 8.5, anchor: "middle", fill: DIM
        });

        const actions = layer.append("g")
            .attr("class", "lockdep-actions")
            .style("cursor", "pointer");
        const unlockHit = actions.append("g")
            .on("click", (event) => {
                event.stopPropagation();
                unlock("you");
            });
        unlockHit.append("rect")
            .attr("x", right - 86).attr("y", view.bot - 40)
            .attr("width", 86).attr("height", 18)
            .attr("fill", "rgba(255,255,255,0.001)");
        label(unlockHit, "lockdep-unlock", right, view.bot - 26, "UNLOCK T1", {
            size: 9, anchor: "end", fill: DIM
        });
        const againHit = actions.append("g")
            .attr("class", "lockdep-again")
            .style("display", "none")
            .on("click", (event) => {
                event.stopPropagation();
                reset();
                mount();
            });
        againHit.append("rect")
            .attr("x", right - 86).attr("y", view.bot - 22)
            .attr("width", 86).attr("height", 18)
            .attr("fill", "rgba(255,255,255,0.001)");
        label(againHit, "lockdep-again-label", right, view.bot - 8, "AGAIN", {
            size: 9, anchor: "end", fill: CYAN
        });

        if (view.columns) {
            label(layer, "lockdep-note", left, box.y + box.h - 22,
                "AN EDGE IS AN OBSERVED ORDER · UNLOCK CLEARS THE CHAIN, NOT THE GRAPH", {
                    size: 9, fill: FAINT
                });
        } else {
            label(layer, "lockdep-note", left, view.bot + 8,
                "UNLOCK CLEARS THE CHAIN, NOT THE GRAPH", { size: 8, fill: FAINT });
        }

        paint();
    }

    function paint() {
        const layer = d3.select("svg").select(".lockdep-layer");
        if (layer.empty()) return;
        const view = layout();
        const cycleSet = new Set();
        if (state.over && state.over.cycle) {
            for (let i = 0; i < state.over.cycle.length - 1; i += 1) {
                cycleSet.add(`${state.over.cycle[i]}>${state.over.cycle[i + 1]}`);
            }
        }

        const edges = layer.select(".lockdep-edges");
        edges.selectAll("g.lockdep-edge").remove();
        state.edges.forEach(([from, to]) => {
            const a = view.at[from];
            const b = view.at[to];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1;
            const ux = dx / len;
            const uy = dy / len;
            const pad = view.columns ? 18 : 15;
            const shift = 4.5;
            const x1 = a.x + ux * pad - uy * shift;
            const y1 = a.y + uy * pad + ux * shift;
            const x2 = b.x - ux * (pad + 3) - uy * shift;
            const y2 = b.y - uy * (pad + 3) + ux * shift;
            const hot = cycleSet.has(`${from}>${to}`);
            const edge = edges.append("g").attr("class", "lockdep-edge");
            edge.append("line")
                .attr("x1", x1).attr("y1", y1).attr("x2", x2).attr("y2", y2)
                .attr("stroke", hot ? AMBER : RAIL)
                .attr("stroke-width", 1.1)
                .attr("stroke-linecap", "round");
            edge.append("path")
                .attr("d", `M${x2.toFixed(2)},${y2.toFixed(2)} `
                    + `L${(x2 - ux * 7 + uy * 3.2).toFixed(2)},${(y2 - uy * 7 - ux * 3.2).toFixed(2)} `
                    + `L${(x2 - ux * 7 - uy * 3.2).toFixed(2)},${(y2 - uy * 7 + ux * 3.2).toFixed(2)} Z`)
                .attr("fill", hot ? AMBER : RAIL);
        });

        LOCKS.forEach((lock) => {
            const mine = state.held.you.indexOf(lock.id) !== -1;
            const theirs = state.held.k.indexOf(lock.id) !== -1;
            const onCycle = state.over && state.over.cycle
                && state.over.cycle.indexOf(lock.id) !== -1;
            const node = layer.select(`.lockdep-node-${lock.id}`);
            node.select(".lockdep-node-body")
                .attr("stroke", onCycle ? AMBER : (mine ? CYAN : (theirs ? AMBER : RAIL)))
                .attr("stroke-width", mine || theirs || onCycle ? 1.6 : 1.1);
            node.select(".lockdep-node-code")
                .attr("fill", onCycle ? AMBER : LIGHT);
        });

        layer.select(".lockdep-chain-you").text(chainText("you"));
        layer.select(".lockdep-chain-k").text(chainText("k"));
        layer.select(".lockdep-line")
            .attr("fill", state.over ? AMBER : DIM)
            .text(state.line);
        layer.select(".lockdep-again")
            .style("display", state.over ? "block" : "none");
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

window.LockdepGame = LockdepGame;
