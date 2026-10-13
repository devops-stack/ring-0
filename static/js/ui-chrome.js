// UI chrome module extracted from main.js
(function initUiChrome(){
const svg = d3.select("svg");

// Update panel with real data from API
function updatePanelData() {
    // Mobile mode keeps only central process composition.
    if (isMobileLayout()) {
        d3.selectAll('.subsystem-indicator').remove();
        return;
    }
    // Skip updating if Matrix View is active
    if (window.kernelContextMenu && window.kernelContextMenu.currentView === 'matrix') {
        return;
    }
    
    return window.fetchJson('/api/kernel-data', { cache: 'no-store' }, {
        timeoutMs: 6000,
        retries: 1,
        context: 'kernel-summary',
        toastMessage: 'Kernel summary is temporarily unavailable'
    })
        .then(data => {
            // Update processes count
            const processesText = d3.select('#panel-value-2');
            if (!processesText.empty() && data.processes) {
                processesText.text(data.processes);
            }
            
            // Update memory usage
            const memoryText = d3.select('#panel-value-3');
            if (!memoryText.empty() && data.system_stats) {
                const memPercent = Math.round(data.system_stats.memory_total / (1024 * 1024 * 1024)); // GB
                memoryText.text(`${memPercent} GB`);
            }
            
            // Update subsystems visualization if available
            if (data.subsystems) {
                updateSubsystemsVisualization(data.subsystems);
            }
        })
        .catch(error => {
            const processesText = d3.select('#panel-value-2');
            if (!processesText.empty()) {
                processesText.text('N/A');
            }
            const memoryText = d3.select('#panel-value-3');
            if (!memoryText.empty()) {
                memoryText.text('N/A');
            }
            console.error('Error updating panel data:', error);
        });
}

// Bottom-left links. All three glyphs are authored on a 24x24 canvas with the
// origin at its top-left corner, so each one has to be pulled back by half the
// canvas before it is scaled: without that the glyph lands down-and-right of
// the circle it is supposed to sit in, and the group's hit box — the union of
// circle and glyph — ends up a diagonal blob centred 12px off the button.
const SOCIAL_LINKS = [
    {
        id: "x",
        title: "@_telesis on X",
        href: "https://x.com/_telesis",
        hover: "#1DA1F2",
        d: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.114zm-1.161 17.52h1.833L7.084 4.126H5.117z"
    },
    {
        id: "github",
        title: "View source on GitHub",
        href: "https://github.com/devops-stack/ring-0",
        hover: "#ffffff",
        d: "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
    },
    {
        id: "install",
        title: "Install ring-0 on your Linux host",
        href: "https://github.com/devops-stack/ring-0/tree/main/install",
        hover: "#e2a33e",
        // A terminal with the prompt knocked out of it, rather than a download
        // arrow: the other two are solid brand silhouettes, and the install is
        // a shell command, not a file to download.
        rule: "evenodd",
        d: "M3.5 4.5 H20.5 A2.5 2.5 0 0 1 23 7 V17 A2.5 2.5 0 0 1 20.5 19.5"
            + " H3.5 A2.5 2.5 0 0 1 1 17 V7 A2.5 2.5 0 0 1 3.5 4.5 Z"
            + " M5.5 8.6 L6.9 7.2 L11.7 12 L6.9 16.8 L5.5 15.4 L8.9 12 Z"
            + " M12.5 15.4 H18.5 V16.8 H12.5 Z"
    }
];

const SOCIAL_GLYPH = 24;   // authoring canvas of every path above
const SOCIAL_DISC = 12;    // visible circle radius
const SOCIAL_HIT = 16;     // clickable radius, concentric with the circle
const SOCIAL_STEP = 40;

// Draw social media icons
function drawSocialIcons(width, height) {
    // Idempotent: draw() can run again on resize or after a view switch.
    svg.selectAll("g.social-icon").remove();

    // Where the glyphs actually sat before, kept deliberately: the old code
    // put the group at (30, height - 30) and then drew an untransformed 24x24
    // path, so what you saw was centred at (42, height - 18). Centring the
    // glyph on the group moved it up and left; this puts it back.
    const baseX = 42;
    const baseY = height - 18;
    const scale = 16 / SOCIAL_GLYPH;   // 16px glyph inside a 24px disc

    SOCIAL_LINKS.forEach((link, i) => {
        const group = svg.append("g")
            .attr("class", "social-icon")
            .attr("data-social", link.id)
            .attr("transform", `translate(${baseX + i * SOCIAL_STEP}, ${baseY})`)
            .style("cursor", "pointer")
            .on("click", () => {
                window.open(link.href, "_blank", "noopener");
            })
            .on("mouseenter", function() {
                d3.select(this).select("path.social-glyph")
                    .transition().duration(200).attr("fill", link.hover);
            })
            .on("mouseleave", function() {
                d3.select(this).select("path.social-glyph")
                    .transition().duration(200).attr("fill", "#666");
            });

        group.append("title").text(link.title);

        group.append("circle")
            .attr("cx", 0)
            .attr("cy", 0)
            .attr("r", SOCIAL_DISC)
            .attr("fill", "rgba(255, 255, 255, 0.1)")
            .attr("stroke", "rgba(102, 102, 102, 0.3)")
            .attr("stroke-width", "0.5");

        group.append("path")
            .attr("class", "social-glyph")
            .attr("transform",
                `scale(${scale}) translate(${-SOCIAL_GLYPH / 2}, ${-SOCIAL_GLYPH / 2})`)
            .attr("fill", "#666")
            .attr("fill-rule", link.rule || "nonzero")
            .attr("stroke", "none")
            .attr("d", link.d);

        // Last, so it sits on top and the whole disc reacts even where the
        // glyph has holes.
        group.append("circle")
            .attr("cx", 0)
            .attr("cy", 0)
            .attr("r", SOCIAL_HIT)
            .attr("fill", "transparent")
            .attr("stroke", "none");
    });
}

window.UiChrome = {
    updatePanelData,
    drawSocialIcons
};
})();
