// UI chrome module extracted from main.js
(function initUiChrome(){
const svg = d3.select("svg");
let backendStatusNode = null;

function ensureBackendStatusNode() {
    if (backendStatusNode && backendStatusNode.parentNode) return backendStatusNode;
    const node = document.createElement('div');
    node.id = 'backend-status-chip';
    node.style.cssText = [
        'position: fixed',
        'left: 14px',
        'bottom: 14px',
        'padding: 5px 8px',
        'border-radius: 5px',
        'background: rgba(12, 18, 28, 0.88)',
        'border: 1px solid rgba(145, 180, 220, 0.4)',
        'color: #cfe2fa',
        'font-family: "Share Tech Mono", monospace',
        'font-size: 10px',
        'letter-spacing: 0.2px',
        'pointer-events: none',
        'z-index: 1100',
        'opacity: 0.85'
    ].join(';');
    node.textContent = 'backend: connecting...';
    document.body.appendChild(node);
    backendStatusNode = node;
    return node;
}

function setBackendStatus(online, details = '') {
    const node = ensureBackendStatusNode();
    if (online) {
        node.textContent = 'backend: online';
        node.style.background = 'rgba(8, 24, 18, 0.88)';
        node.style.borderColor = 'rgba(106, 210, 160, 0.58)';
        node.style.color = '#bbf1d9';
    } else {
        node.textContent = details ? `backend: degraded (${details})` : 'backend: degraded';
        node.style.background = 'rgba(34, 20, 10, 0.9)';
        node.style.borderColor = 'rgba(244, 201, 119, 0.62)';
        node.style.color = '#ffe7ba';
    }
}

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
            setBackendStatus(true);
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
            setBackendStatus(false, error && error.message ? error.message : 'request failed');
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
}

window.UiChrome = {
    updatePanelData,
    drawSocialIcons
};
})();
