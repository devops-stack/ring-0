// Flow UI module extracted from main.js
(function initFlowUI(){
const svg = d3.select("svg");
const lowerFlowTypes = [
    { id: "disk-io", label: "DISK I/O", stroke: "rgba(58, 58, 58, 0.33)", widthMin: 0.8, widthMax: 1.15, opacityMin: 0.6, opacityMax: 0.85, weight: 0.34 },
    { id: "network-packets", label: "NETWORK PACKETS", stroke: "rgba(88, 182, 216, 0.28)", widthMin: 0.75, widthMax: 1.05, opacityMin: 0.58, opacityMax: 0.8, weight: 0.28 },
    { id: "page-faults", label: "PAGE FAULTS", stroke: "rgba(95, 95, 95, 0.28)", widthMin: 0.75, widthMax: 1.0, opacityMin: 0.55, opacityMax: 0.78, weight: 0.24 },
    { id: "memory-swaps", label: "MEMORY SWAPS", stroke: "rgba(126, 110, 170, 0.25)", widthMin: 0.7, widthMax: 0.95, opacityMin: 0.5, opacityMax: 0.72, weight: 0.14 }
];

function drawBezierDecor(width, height, yBase) {
    const centerX = width / 2;
    const railHalfWidth = Math.min(540, Math.max(320, width * 0.32));
    const originalRailHalfWidth = Math.min(360, Math.max(240, width * 0.24));
    // Lift the whole I/O layer block so Bezier endpoints visually touch the rails.
    const railY = Math.min(height - 78, yBase + 8);
    // Keep lower rail/labels at their original vertical position.
    const lowerStructureDrop = 12;
    const lowerRailY = Math.min(height - 58, yBase + 104 + lowerStructureDrop);
    const labelY = Math.min(height - 36, yBase + 121 + lowerStructureDrop);
    const legendY = Math.min(height - 22, yBase + 134 + lowerStructureDrop);
    const decorGroup = svg.append("g")
        .attr("class", "bezier-decor-layer")
        .attr("pointer-events", "none");

    // Subtle underlay to visually anchor the curve bundle.
    decorGroup.append("ellipse")
        .attr("cx", centerX)
        .attr("cy", railY + 8)
        .attr("rx", railHalfWidth + 72)
        .attr("ry", 20)
        .attr("fill", "rgba(45, 45, 45, 0.045)");

    // Primary and secondary rails (UI-like track under the bezier network).
    decorGroup.append("line")
        .attr("x1", centerX - railHalfWidth)
        .attr("y1", railY)
        .attr("x2", centerX + railHalfWidth)
        .attr("y2", railY)
        .attr("stroke", "rgba(45, 45, 45, 0.52)")
        .attr("stroke-width", 1.1)
        .attr("stroke-linecap", "round")
        .attr("opacity", 0.8);

    decorGroup.append("line")
        .attr("x1", centerX - originalRailHalfWidth + 12)
        .attr("y1", lowerRailY)
        .attr("x2", centerX + originalRailHalfWidth - 12)
        .attr("y2", lowerRailY)
        .attr("stroke", "rgba(45, 45, 45, 0.26)")
        .attr("stroke-width", 0.85)
        .attr("stroke-linecap", "round")
        .attr("opacity", 0.9);

    // Short cyan accent in the center, similar to reference UI treatment.
    decorGroup.append("line")
        .attr("x1", centerX - 52)
        .attr("y1", lowerRailY)
        .attr("x2", centerX + 52)
        .attr("y2", lowerRailY)
        .attr("stroke", "rgba(88, 182, 216, 0.5)")
        .attr("stroke-width", 0.9)
        .attr("stroke-linecap", "round");

    // Data-track milestones along the lower rail (reference "genome/timeline"
    // read): named kernel I/O path stages with live throughput. Amber marks the
    // busiest layer(s), driven by /api/io-pulse.
    const AMBER = "198, 120, 28";
    const INK = "45, 45, 45";
    const trackHalf = originalRailHalfWidth - 24;

    const fmtRate = (v, unit) => {
        if (unit === "mb") {
            if (v >= 1) return v.toFixed(1) + " M/s";
            if (v > 0) return Math.max(1, Math.round(v * 1024)) + " K/s";
            return "idle";
        }
        if (v >= 10000) return (v / 1000).toFixed(0) + "k/s";
        if (v >= 1000) return (v / 1000).toFixed(1) + "k/s";
        if (v > 0) return v + "/s";
        return "idle";
    };

    const stages = [
        { label: "NET",   unit: "mb",  scaleMax: 50,    value: (m) => m.net_mb_s || 0 },
        { label: "BLOCK", unit: "mb",  scaleMax: 80,    value: (m) => (m.disk_read_mb_s || 0) + (m.disk_write_mb_s || 0) },
        { label: "MM",    unit: "cnt", scaleMax: 50000, value: (m) => m.pgfault_per_sec || 0 },
        { label: "SWAP",  unit: "cnt", scaleMax: 5000,  value: (m) => (m.pswpin_per_sec || 0) + (m.pswpout_per_sec || 0) },
        { label: "IRQ",   unit: "cnt", scaleMax: 25000, value: (m) => m.intr_per_sec || 0 }
    ];

    const trackNodes = stages.map((st, i) => {
        const t = stages.length === 1 ? 0.5 : i / (stages.length - 1);
        const x = centerX - trackHalf + t * (trackHalf * 2);

        const stem = decorGroup.append("line")
            .attr("x1", x).attr("y1", lowerRailY)
            .attr("x2", x).attr("y2", lowerRailY - 9)
            .attr("stroke", `rgba(${INK}, 0.3)`)
            .attr("stroke-width", 0.8)
            .attr("stroke-linecap", "round");

        const halo = decorGroup.append("circle")
            .attr("cx", x).attr("cy", lowerRailY).attr("r", 5)
            .attr("fill", "none")
            .attr("stroke", `rgba(${AMBER}, 0.35)`)
            .attr("stroke-width", 0.8)
            .attr("opacity", 0);

        const dot = decorGroup.append("circle")
            .attr("cx", x).attr("cy", lowerRailY).attr("r", 1.8)
            .attr("fill", `rgba(${INK}, 0.5)`);

        const value = decorGroup.append("text")
            .attr("x", x).attr("y", lowerRailY - 12)
            .attr("text-anchor", "middle")
            .style("font-family", "Share Tech Mono, monospace")
            .style("font-size", "6.5px")
            .style("letter-spacing", "0.3px")
            .style("fill", "rgba(60, 60, 60, 0.5)")
            .text("—");

        const label = decorGroup.append("text")
            .attr("x", x).attr("y", lowerRailY - 22)
            .attr("text-anchor", "middle")
            .style("font-family", "Share Tech Mono, monospace")
            .style("font-size", "7px")
            .style("letter-spacing", "1px")
            .style("fill", "rgba(55, 55, 55, 0.55)")
            .text(st.label);

        return { st, x, stem, halo, dot, value, label };
    });

    const refreshIoTrack = () => {
        const p = window.fetchJson
            ? window.fetchJson("/api/io-pulse", { cache: "no-store" }, { timeoutMs: 5000, retries: 0, context: "io-track" })
            : fetch("/api/io-pulse", { cache: "no-store" }).then((r) => r.json());
        Promise.resolve(p).then((metrics) => {
            if (!metrics) return;
            const rows = trackNodes.map((n) => {
                const raw = Math.max(0, Number(n.st.value(metrics)) || 0);
                return { n, raw, intensity: Math.min(1, raw / n.st.scaleMax) };
            });
            const maxI = rows.reduce((m, r) => Math.max(m, r.intensity), 0);
            rows.forEach((r) => {
                const hot = maxI > 0 && r.raw > 0 && r.intensity >= maxI * 0.7;
                r.n.dot.attr("r", hot ? 2.6 : 1.8).attr("fill", hot ? `rgb(${AMBER})` : `rgba(${INK}, 0.5)`);
                r.n.halo.attr("opacity", hot ? 1 : 0);
                r.n.stem.attr("stroke", hot ? `rgba(${AMBER}, 0.55)` : `rgba(${INK}, 0.3)`);
                r.n.label.style("fill", hot ? `rgba(${AMBER}, 0.95)` : "rgba(55, 55, 55, 0.55)");
                r.n.value
                    .style("fill", hot ? `rgba(${AMBER}, 0.95)` : "rgba(60, 60, 60, 0.5)")
                    .text(fmtRate(r.raw, r.n.st.unit));
            });
        }).catch(() => {});
    };

    if (window.__ioTrackTimer) clearInterval(window.__ioTrackTimer);
    refreshIoTrack();
    window.__ioTrackTimer = setInterval(refreshIoTrack, 3000);

    // Marker dots and tiny ticks (echoing the diegetic control language).
    const markers = 9;
    for (let i = 0; i < markers; i++) {
        const t = i / (markers - 1);
        const x = centerX - railHalfWidth + t * (railHalfWidth * 2);
        decorGroup.append("circle")
            .attr("cx", x)
            .attr("cy", railY)
            .attr("r", i === Math.floor(markers / 2) ? 1.8 : 1.2)
            .attr("fill", "rgba(45, 45, 45, 0.55)");

        if (i % 2 === 0) {
            decorGroup.append("line")
                .attr("x1", x)
                .attr("y1", railY - 6)
                .attr("x2", x)
                .attr("y2", railY - 2.5)
                .attr("stroke", "rgba(45, 45, 45, 0.32)")
                .attr("stroke-width", 0.7)
                .attr("stroke-linecap", "round");
        }
    }

    // Semantic label and compact legend for the lower flow layer.
    decorGroup.append("text")
        .attr("x", centerX)
        .attr("y", labelY)
        .attr("text-anchor", "middle")
        .style("font-family", "Share Tech Mono, monospace")
        .style("font-size", "9px")
        .style("letter-spacing", "1px")
        .style("fill", "rgba(55, 55, 55, 0.55)")
        .text("KERNEL I/O LAYER");

    const legendSpacing = 120;
    const legendStartX = centerX - ((lowerFlowTypes.length - 1) * legendSpacing) / 2;
    lowerFlowTypes.forEach((flowType, idx) => {
        const lx = legendStartX + idx * legendSpacing;
        decorGroup.append("line")
            .attr("x1", lx - 24)
            .attr("y1", legendY - 4)
            .attr("x2", lx - 8)
            .attr("y2", legendY - 4)
            .attr("stroke", flowType.stroke)
            .attr("stroke-width", 1.2)
            .attr("stroke-linecap", "round");

        decorGroup.append("text")
            .attr("x", lx)
            .attr("y", legendY)
            .attr("text-anchor", "start")
            .style("font-family", "Share Tech Mono, monospace")
            .style("font-size", "7.5px")
            .style("letter-spacing", "0.6px")
            .style("fill", "rgba(60, 60, 60, 0.48)")
            .text(flowType.label);
    });
}

function drawBezierCoreBridge(width, height, yBase) {
    const centerX = width / 2;
    const centerY = height / 2;
    const bridgeGroup = svg.append("g")
        .attr("class", "bezier-core-bridge")
        .attr("pointer-events", "none");

    const anchorY = centerY + 90; // Just below process ring
    const targetY = yBase - 34;   // Just above lower bezier bundle
    const bridgeCount = 18;

    for (let i = 0; i < bridgeCount; i++) {
        const t = bridgeCount <= 1 ? 0 : i / (bridgeCount - 1);
        const spread = (t - 0.5) * 220;
        const startX = centerX + spread * 0.42;
        const endX = centerX + spread;

        const cp1X = centerX + spread * 0.18;
        const cp1Y = anchorY + 48 + Math.random() * 20;
        const cp2X = centerX + spread * 0.7;
        const cp2Y = targetY - 26 - Math.random() * 20;

        const bridgePath = `M${startX},${anchorY} C${cp1X},${cp1Y} ${cp2X},${cp2Y} ${endX},${targetY}`;
        const isCenter = Math.abs(t - 0.5) < 0.12;
        const stroke = isCenter ? "rgba(70, 70, 70, 0.2)" : "rgba(70, 70, 70, 0.14)";
        const widthPx = isCenter ? 0.9 : 0.65;
        const opacity = isCenter ? 0.55 : 0.42;

        bridgeGroup.append("path")
            .attr("d", bridgePath)
            .attr("fill", "none")
            .attr("stroke", stroke)
            .attr("stroke-width", widthPx)
            .attr("opacity", opacity)
            .attr("stroke-linecap", "round");
    }

    // Subtle joint nodes where bridge reaches the lower flow layer.
    const nodeCount = 7;
    for (let i = 0; i < nodeCount; i++) {
        const t = nodeCount <= 1 ? 0 : i / (nodeCount - 1);
        const x = centerX + (t - 0.5) * 180;
        bridgeGroup.append("circle")
            .attr("cx", x)
            .attr("cy", targetY)
            .attr("r", i === Math.floor(nodeCount / 2) ? 1.7 : 1.2)
            .attr("fill", "rgba(70, 70, 70, 0.38)");
    }
}

// Draw curves at bottom
function drawLowerBezierGrid(num = 90) {
    const width = window.innerWidth;
    debugLog("🔧 drawLowerBezierGrid called");
    debugLog("🔧 window.nginxFilesManager:", typeof window.nginxFilesManager);
    // Initialize nginx files manager - wait for curves to be drawn first
    // Curves need to be rendered before files can be attached to them
    setTimeout(() => {
        if (window.nginxFilesManager) {
            debugLog("🔧 Initializing NginxFilesManager after curves are drawn...");
            window.nginxFilesManager.init();
        }
    }, 1500); // Wait 1.5 seconds for curves to finish animating
    const height = window.innerHeight;
    // Lift the whole lower flow construction without changing its geometry.
    const lowerFlowYOffset = -25;
    const yBase = height - 200 + lowerFlowYOffset;
    drawBezierDecor(width, height, yBase);

    // Surface line the whiskers should skim along (matches the primary rail in drawBezierDecor).
    const surfaceY = Math.min(height - 78, yBase + 8);
    const centerX = width / 2;
    // Rail span matches drawBezierDecor's primary rail so whiskers ride its length.
    const railHalf = Math.min(540, Math.max(320, width * 0.32));

    // Publish the I/O surface geometry so the open-files layer can dock file
    // markers onto the rail (crest = busiest file, left → right = decreasing).
    window.__ioLayerGeometry = {
        surfaceY,
        centerX,
        railHalf,
        crestX: centerX - railHalf,
        railLeft: centerX - railHalf,
        railRight: centerX + railHalf
    };

    for (let i = 0; i < num; i++) {
        const fromLeft = i < num / 2;

        const startX = fromLeft
            ? 300 + Math.random() * 100
            : width - 300 - Math.random() * 100;

        const endX = width / 2 + (Math.random() - 0.5) * 200;
        const endY = height - 160 - Math.random() * 40 + lowerFlowYOffset;

        const controlX1 = startX + (fromLeft ? 150 : -150) + (Math.random() - 0.5) * 80;
        const controlY1 = yBase - 60 - Math.random() * 40;

        const controlX2 = endX + (Math.random() - 0.5) * 60;
        const controlY2 = endY + 40 + Math.random() * 220;

        const path = `M${startX},${yBase} C${controlX1},${controlY1} ${controlX2},${controlY2} ${endX},${endY}`;

        const curveStroke = "rgba(60, 60, 60, 0.3)";
        const curveStrokeWidth = 0.8;
        const curveOpacity = 0.3;

        // Draw Bezier curves with layered intensity like in the reference.
        const bezierCurve = svg.append("path")
            .attr("d", path)
            .attr("class", "bezier-curve")
            .attr("data-curve-index", i) // Add index for file association
            .attr("stroke", curveStroke)
            .attr("stroke-width", curveStrokeWidth)
            .attr("opacity", 0) // Start invisible
            .attr("data-original-stroke", curveStroke)
            .attr("data-original-stroke-width", curveStrokeWidth)
            .attr("data-original-opacity", curveOpacity)
            .attr("fill", "none")
            .attr("stroke-dasharray", function() {
                const length = this.getTotalLength();
                return length + " " + length;
            })
            .attr("stroke-dashoffset", function() {
                return this.getTotalLength();
            });

        // Animate Bezier curve appearance
        bezierCurve.transition()
            .duration(400 + Math.random() * 300) // Random duration 400-700ms
            .delay(i * 10) // Staggered animation
            .attr("opacity", curveOpacity)
            .attr("stroke-dashoffset", 0);
    }
}

window.FlowUI = {
    drawBezierDecor,
    drawBezierCoreBridge,
    drawLowerBezierGrid
};
})();
