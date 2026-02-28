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
    
    fetch('/api/kernel-data')
        .then(res => res.json())
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
}

window.UiChrome = {
    updatePanelData,
    drawSocialIcons
};
})();
