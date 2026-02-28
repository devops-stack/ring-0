// Nginx Files Manager for Bezier Curves
class NginxFilesManager {
    constructor() {
        this.files = [];
        this.updateInterval = null;
    }

    // Initialize nginx files visualization
    init() {
        debugLog('🔧 Initializing NginxFilesManager...');
        this.updateFiles();
        this.startAutoUpdate(10000); // Update every 10 seconds
    }

    // Update files data
    async updateFiles() {
        try {
            debugLog('📁 Fetching nginx files...');
            const response = await fetch('/api/nginx-files');
            const data = await response.json();
            
            debugLog('📁 Received nginx files:', data);
            
            if (data.files && data.files.length > 0) {
                this.files = data.files;
                debugLog('🎨 Rendering files on curves...');
                this.renderFilesOnCurves();
            } else {
                debugLog('⚠️ No nginx files found');
            }
        } catch (error) {
            console.error('Error fetching nginx files:', error);
        }
    }

    // Render file names at the end of Bezier curves
    renderFilesOnCurves() {
        debugLog('🎨 Starting to render files on curves...');
        
        // Get SVG element
        const svg = d3.select('svg');
        if (svg.empty()) {
            console.error('❌ SVG element not found!');
            return;
        }
        
        // Clear existing file labels
        d3.selectAll('.file-label').remove();
        d3.selectAll('.file-label-bg').remove();
        d3.selectAll('.file-endpoint').remove();
        d3.selectAll('.file-icon').remove();
        d3.selectAll('[class^="file-group-"]').remove();
        
        const width = window.innerWidth;
        const height = window.innerHeight;
        const centerX = width / 2;
        
        // Get all Bezier curves
        const bezierCurves = d3.selectAll('.bezier-curve').nodes();
        const numCurves = bezierCurves.length;
        
        debugLog('📐 Screen dimensions:', { width, height, centerX });
        debugLog('📊 Available Bezier curves:', numCurves);
        
        // Calculate positions for file labels - attach to end points of curves
        const labelPositions = this.calculateLabelPositionsOnCurves(this.files.length, bezierCurves, height);
        
        debugLog('📍 Label positions:', labelPositions);
        
        this.files.forEach((file, index) => {
            if (index < labelPositions.length) {
                const pos = labelPositions[index];
                const fileName = this.getShortFileName(file.path);
                const fileType = file.type || 'other';
                
                debugLog(`📄 Rendering file ${index}: ${fileName} at (${pos.x}, ${pos.y}), type: ${fileType}`);
                
                // Create file group for better organization
                const fileGroup = svg.append("g")
                    .attr("class", `file-group-${index}`)
                    .attr("data-file-index", index)
                    .attr("data-file-type", fileType);
                
                // Add endpoint circle on the curve
                const endpoint = fileGroup.append("circle")
                    .attr("cx", pos.x)
                    .attr("cy", pos.y)
                    .attr("r", 4)
                    .attr("class", "file-endpoint")
                    .attr("fill", this.getFileTypeColor(fileType))
                    .attr("stroke", "#fff")
                    .attr("stroke-width", 1.5)
                    .attr("opacity", 0.9);
                
                // Add pulsing animation for active files using D3 transitions
                const pulse = () => {
                    endpoint.transition()
                        .duration(1000)
                        .attr("r", 6)
                        .transition()
                        .duration(1000)
                        .attr("r", 4)
                        .on("end", pulse);
                };
                pulse();
                
                // Only show circle, no labels, icons, or backgrounds
                
                // Only circles, no interactivity needed
            }
        });
    }
    
    // Get color based on file type
    getFileTypeColor(type) {
        const colors = {
            'config': '#4A90E2',  // Blue for config files
            'log': '#E24A4A',     // Red for log files
            'other': '#888'        // Gray for other files
        };
        return colors[type] || colors['other'];
    }
    
    // Get icon based on file type
    getFileTypeIcon(type) {
        const icons = {
            'config': '⚙',   // Gear for config
            'log': '📋',     // Clipboard for logs
            'other': '📄'    // Document for other
        };
        return icons[type] || icons['other'];
    }
    
    // Highlight associated Bezier curve
    highlightCurve(curveIndex) {
        if (curveIndex !== undefined) {
            const curves = d3.selectAll('.bezier-curve').nodes();
            if (curves[curveIndex]) {
                d3.select(curves[curveIndex])
                    .transition()
                    .duration(200)
                    .attr("stroke", "#4A90E2")
                    .attr("stroke-width", 2)
                    .attr("opacity", 0.8);
            }
        }
    }
    
    // Unhighlight Bezier curve
    unhighlightCurve(curveIndex) {
        if (curveIndex !== undefined) {
            const curves = d3.selectAll('.bezier-curve').nodes();
            if (curves[curveIndex]) {
                d3.select(curves[curveIndex])
                    .transition()
                    .duration(200)
                    .attr("stroke", "rgba(60, 60, 60, 0.3)")
                    .attr("stroke-width", 0.8)
                    .attr("opacity", 0.3);
            }
        }
    }

    // Calculate positions for file labels - attach to end points of Bezier curves
    calculateLabelPositionsOnCurves(numFiles, bezierCurves, height) {
        const positions = [];
        
        if (bezierCurves.length === 0) {
            // Fallback to old method if no curves available
            return this.calculateLabelPositions(numFiles, window.innerWidth / 2, height);
        }
        
        // Select curves from the center area (where files should be attached)
        const centerCurves = [];
        const width = window.innerWidth;
        const centerX = width / 2;
        
        bezierCurves.forEach((curve, index) => {
            const path = d3.select(curve);
            const pathData = path.attr('d');
            if (pathData) {
                // Extract START point from path (first coordinates after M)
                // Path format: M startX,startY C ...
                const startMatches = pathData.match(/M([\d.]+),([\d.]+)/);
                if (startMatches) {
                    const startX = parseFloat(startMatches[1]);
                    const startY = parseFloat(startMatches[2]);
                    
                    // Use curves that start near the bottom (where files should be)
                    // Files should be at the bottom (start of curves)
                    if (startY > height - 250 && startY < height - 150) {
                        centerCurves.push({ index, startX, startY });
                    }
                }
            }
        });
        
        // Sort by X position to distribute evenly
        centerCurves.sort((a, b) => a.endX - b.endX);
        
        // Select curves evenly distributed
        const selectedCurves = [];
        if (centerCurves.length > 0) {
            const step = Math.max(1, Math.floor(centerCurves.length / numFiles));
            for (let i = 0; i < numFiles && i * step < centerCurves.length; i++) {
                selectedCurves.push(centerCurves[i * step]);
            }
        }
        
        // Create positions from selected curves - use START points (bottom of curves)
        selectedCurves.forEach((curve, i) => {
            positions.push({
                x: curve.startX,
                y: curve.startY,
                curveIndex: curve.index
            });
        });
        
        // Fill remaining positions if needed (at bottom of screen)
        while (positions.length < numFiles) {
            const baseY = height - 200; // Bottom where curves start
            const spacing = 120;
            const offset = (positions.length - (numFiles - 1) / 2) * spacing;
            positions.push({
                x: centerX + offset,
                y: baseY + (positions.length % 2) * 15,
                curveIndex: undefined
            });
        }
        
        return positions.slice(0, numFiles);
    }
    
    // Fallback method for calculating positions
    calculateLabelPositions(numFiles, centerX, height) {
        const positions = [];
        const baseY = height - 140; // Above the curves
        const spacing = 120; // Space between labels
        
        for (let i = 0; i < numFiles; i++) {
            const offset = (i - (numFiles - 1) / 2) * spacing;
            positions.push({
                x: centerX + offset,
                y: baseY + (i % 2) * 15 // Slight vertical offset for better readability
            });
        }
        
        return positions;
    }

    // Get short file name for display
    getShortFileName(fullPath) {
        const parts = fullPath.split('/');
        if (parts.length <= 2) {
            return fullPath;
        }
        
        // Show last two parts of path
        const lastTwo = parts.slice(-2);
        return lastTwo.join('/');
    }

    // Show tooltip with file information
    showTooltip(file, x, y) {
        const tooltip = d3.select("body")
            .append("div")
            .attr("class", "tooltip")
            .style("position", "absolute")
            .style("background", "rgba(0,0,0,0.9)")
            .style("color", "white")
            .style("padding", "10px")
            .style("border-radius", "4px")
            .style("font-size", "12px")
            .style("pointer-events", "none")
            .style("z-index", "1000")
            .style("max-width", "300px")
            .style("font-family", "'Share Tech Mono', monospace")
            .style("border", `2px solid ${this.getFileTypeColor(file.type || 'other')}`);

        const fileType = file.type || 'other';
        const typeLabel = fileType.charAt(0).toUpperCase() + fileType.slice(1);
        
        tooltip.html(`
            <div style="margin-bottom: 5px;">
                <span style="color: ${this.getFileTypeColor(fileType)}; font-weight: bold;">${this.getFileTypeIcon(fileType)} ${typeLabel} File</span>
            </div>
            <div style="border-top: 1px solid rgba(255,255,255,0.2); padding-top: 5px; margin-top: 5px;">
                <strong>Path:</strong> ${file.path}<br>
                ${file.pid ? `<strong>PID:</strong> ${file.pid}<br>` : ''}
                ${file.fd ? `<strong>FD:</strong> ${file.fd}` : ''}
            </div>
        `);

        // Position tooltip near the file
        const tooltipNode = tooltip.node();
        const tooltipRect = tooltipNode.getBoundingClientRect();
        const left = Math.min(x + 15, window.innerWidth - tooltipRect.width - 10);
        const top = Math.max(y - tooltipRect.height - 10, 10);
        
        tooltip.style("left", left + "px")
               .style("top", top + "px");
    }

    // Hide tooltip
    hideTooltip() {
        d3.selectAll(".tooltip").remove();
    }

    // Start auto update
    startAutoUpdate(intervalMs = 10000) {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        this.updateInterval = setInterval(() => {
            this.updateFiles();
        }, intervalMs);
    }

    // Stop auto update
    stopAutoUpdate() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    // Cleanup
    destroy() {
        this.stopAutoUpdate();
        d3.selectAll('.file-label').remove();
        d3.selectAll('.file-label-bg').remove();
        d3.selectAll('.file-endpoint').remove();
        d3.selectAll('.file-icon').remove();
        d3.selectAll('[class^="file-group-"]').remove();
        d3.selectAll('.tooltip').remove();
    }
}

// Make it globally available for browser
if (typeof window !== 'undefined') {
    window.NginxFilesManager = NginxFilesManager;
}
