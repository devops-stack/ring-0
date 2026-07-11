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

// Draw social media icons
function drawSocialIcons(width, height) {
    // Twitter icon in bottom left corner
    const twitterX = 30;
    const twitterY = height - 30;
    const iconSize = 20;
    
    // Create Twitter icon group
    const twitterGroup = svg.append("g")
        .attr("class", "social-icon")
        .attr("transform", `translate(${twitterX}, ${twitterY})`)
        .style("cursor", "pointer")
        .on("click", () => {
            window.open("https://x.com/_telesis", "_blank");
        })
        .on("mouseenter", function() {
            d3.select(this).select("path").transition().duration(200).attr("fill", "#1DA1F2");
        })
        .on("mouseleave", function() {
            d3.select(this).select("path").transition().duration(200).attr("fill", "#666");
        });
    
    // Twitter bird icon (simplified SVG path)
    twitterGroup.append("path")
        .attr("d", "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.114zm-1.161 17.52h1.833L7.084 4.126H5.117z")
        .attr("fill", "#666")
        .attr("stroke", "none");
    
    // Add subtle background circle
    twitterGroup.insert("circle", "path")
        .attr("cx", 0)
        .attr("cy", 0)
        .attr("r", iconSize/2 + 2)
        .attr("fill", "rgba(255, 255, 255, 0.1)")
        .attr("stroke", "rgba(102, 102, 102, 0.3)")
        .attr("stroke-width", "0.5");

    // GitHub icon, right next to Twitter (same visual treatment).
    const githubX = twitterX + 40;
    const githubY = twitterY;

    const githubGroup = svg.append("g")
        .attr("class", "social-icon")
        .attr("transform", `translate(${githubX}, ${githubY})`)
        .style("cursor", "pointer")
        .on("click", () => {
            window.open("https://github.com/devops-stack/ring-0", "_blank", "noopener");
        })
        .on("mouseenter", function() {
            d3.select(this).select("path").transition().duration(200).attr("fill", "#ffffff");
        })
        .on("mouseleave", function() {
            d3.select(this).select("path").transition().duration(200).attr("fill", "#666");
        });

    githubGroup.append("title").text("View source on GitHub");

    // GitHub mark (24x24 path).
    githubGroup.append("path")
        .attr("d", "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12")
        .attr("fill", "#666")
        .attr("stroke", "none");

    // Add subtle background circle
    githubGroup.insert("circle", "path")
        .attr("cx", 0)
        .attr("cy", 0)
        .attr("r", iconSize/2 + 2)
        .attr("fill", "rgba(255, 255, 255, 0.1)")
        .attr("stroke", "rgba(102, 102, 102, 0.3)")
        .attr("stroke-width", "0.5");
}

window.UiChrome = {
    updatePanelData,
    drawSocialIcons
};
})();
