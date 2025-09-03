// Nginx Files Manager for Bezier Curves
class NginxFilesManager {
    constructor() {
        this.files = [];
        this.updateInterval = null;
    }

    // Initialize nginx files visualization
    init() {
        console.log('🔧 Initializing NginxFilesManager...');
        this.updateFiles();
        this.startAutoUpdate(10000); // Update every 10 seconds
    }

    // Update files data
    async updateFiles() {
        try {
            console.log('📁 Fetching nginx files...');
            const response = await fetch('/api/nginx-files');
            const data = await response.json();
            
            console.log('📁 Received nginx files:', data);
            
            if (data.files && data.files.length > 0) {
                this.files = data.files;
                console.log('🎨 Rendering files on curves...');
                this.renderFilesOnCurves();
            } else {
                console.log('⚠️ No nginx files found');
            }
        } catch (error) {
            console.error('Error fetching nginx files:', error);
        }
    }

    // Render file names at the end of Bezier curves
    renderFilesOnCurves() {
        console.log('🎨 Starting to render files on curves...');
        
        // Clear existing file labels
        d3.selectAll('.file-label').remove();
        d3.selectAll('.file-label-bg').remove();
        
        const width = window.innerWidth;
        const height = window.innerHeight;
        const centerX = width / 2;
        
        console.log('📐 Screen dimensions:', { width, height, centerX });
        
        // Calculate positions for file labels
        const labelPositions = this.calculateLabelPositions(this.files.length, centerX, height);
        
        console.log('📍 Label positions:', labelPositions);
        
        this.files.forEach((file, index) => {
            if (index < labelPositions.length) {
                const pos = labelPositions[index];
                const fileName = this.getShortFileName(file.path);
                
                console.log(`📄 Rendering file ${index}: ${fileName} at (${pos.x}, ${pos.y})`);
                
                // Create file label
                const label = svg.append("text")
                    .attr("x", pos.x)
                    .attr("y", pos.y)
                    .attr("class", "file-label")
                    .attr("text-anchor", "middle")
                    .attr("font-size", "10px")
                    .attr("fill", "#333")
                    .attr("opacity", 0.8)
                    .text(fileName);
                
                // Add background rectangle for better readability
                const bbox = label.node().getBBox();
                svg.insert("rect", "text")
                    .attr("x", bbox.x - 2)
                    .attr("y", bbox.y - 1)
                    .attr("width", bbox.width + 4)
                    .attr("height", bbox.height + 2)
                    .attr("class", "file-label-bg")
                    .attr("fill", "rgba(255,255,255,0.9)")
                    .attr("stroke", "#ddd")
                    .attr("stroke-width", 0.5)
                    .attr("rx", 2);
                
                // Add tooltip
                label.on("mouseover", () => this.showTooltip(file, pos.x, pos.y))
                     .on("mouseout", () => this.hideTooltip());
            }
        });
    }

    // Calculate positions for file labels
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
            .style("padding", "8px")
            .style("border-radius", "4px")
            .style("font-size", "12px")
            .style("pointer-events", "none")
            .style("z-index", "1000")
            .style("max-width", "300px");

        tooltip.html(`
            <strong>Nginx Process</strong> (PID: ${file.pid})<br>
            <strong>File:</strong> ${file.path}<br>
            <strong>FD:</strong> ${file.fd}
        `);

        d3.select("svg").on("mousemove", () => {
            tooltip.style("left", (d3.event.pageX + 10) + "px")
                   .style("top", (d3.event.pageY - 10) + "px");
        });
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
        d3.selectAll('.tooltip').remove();
    }
}

// Make it globally available for browser
if (typeof window !== 'undefined') {
    window.NginxFilesManager = NginxFilesManager;
}
