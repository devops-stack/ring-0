// Bezier Curves Manager for Process-File Connections
class BezierCurvesManager {
    constructor() {
        this.curves = [];
        this.isActive = false;
        this.updateInterval = null;
    }

    // Initialize Bezier curves visualization
    init() {
        this.isActive = true;
        this.updateCurves();
        this.startAutoUpdate(5000); // Update every 5 seconds
    }

    // Update curves with real data
    async updateCurves() {
        try {
            const response = await fetch('/api/process-files');
            const data = await response.json();
            
            if (data.curves && data.curves.length > 0) {
                this.curves = data.curves;
                this.renderCurves();
            } else {
                this.renderDecorativeCurves();
            }
        } catch (error) {
            console.error('Error fetching process files:', error);
            this.renderDecorativeCurves();
        }
    }

    // Render functional curves with process-file data
    renderCurves() {
        // Clear existing curves
        d3.selectAll('.bezier-curve').remove();
        
        const svg = d3.select('svg');
        const width = window.innerWidth;
        const height = window.innerHeight;

        // Create curves for each process-file connection
        this.curves.forEach(curve => {
            const path = `M${curve.start_x},${curve.start_y} C${curve.control_x1},${curve.control_y1} ${curve.control_x2},${curve.control_y2} ${curve.end_x},${curve.end_y}`;
            
            // Create curve path
            svg.append("path")
                .attr("d", path)
                .attr("class", "bezier-curve")
                .attr("stroke", this.getCurveColor(curve.process))
                .attr("stroke-width", curve.stroke_width)
                .attr("opacity", curve.opacity)
                .attr("fill", "none")
                .on("mouseover", () => this.showTooltip(curve))
                .on("mouseout", () => this.hideTooltip());

            // Add file endpoint circle
            svg.append("circle")
                .attr("cx", curve.end_x)
                .attr("cy", curve.end_y)
                .attr("r", 2)
                .attr("class", "file-endpoint")
                .attr("fill", this.getCurveColor(curve.process))
                .attr("opacity", 0.7)
                .on("mouseover", () => this.showTooltip(curve))
                .on("mouseout", () => this.hideTooltip());
        });
    }

    // Render decorative curves (fallback)
    renderDecorativeCurves() {
        // Clear existing curves
        d3.selectAll('.bezier-curve').remove();
        
        const width = window.innerWidth;
        const height = window.innerHeight;
        const yBase = height - 20;
        const num = 90;

        for (let i = 0; i < num; i++) {
            const fromLeft = i < num / 2;
            const startX = fromLeft
                ? 300 + Math.random() * 100
                : width - 300 - Math.random() * 100;
            const endX = width / 2 + (Math.random() - 0.5) * 200;
            const endY = height - 160 - Math.random() * 40;
            const controlX1 = startX + (fromLeft ? 150 : -150) + (Math.random() - 0.5) * 80;
            const controlY1 = yBase - 60 - Math.random() * 40;
            const controlX2 = endX + (Math.random() - 0.5) * 60;
            const controlY2 = endY + 40 + Math.random() * 20;
            const path = `M${startX},${yBase} C${controlX1},${controlY1} ${controlX2},${controlY2} ${endX},${endY}`;

            d3.select("svg").append("path")
                .attr("d", path)
                .attr("class", "bezier-curve")
                .attr("stroke", "#222")
                .attr("stroke-width", 0.4)
                .attr("opacity", 0.05 + Math.random() * 0.03)
                .attr("fill", "none");
        }
    }

    // Get color for process
    getCurveColor(processName) {
        const colors = {
            'systemd': '#ff6b6b',
            'sshd': '#4ecdc4',
            'nginx': '#45b7d1',
            'python3': '#96ceb4',
            'bash': '#feca57',
            'cron': '#ff9ff3',
            'default': '#222'
        };
        return colors[processName] || colors['default'];
    }

    // Show tooltip with file information
    showTooltip(curve) {
        const tooltip = d3.select("body")
            .append("div")
            .attr("class", "tooltip")
            .style("position", "absolute")
            .style("background", "rgba(0,0,0,0.8)")
            .style("color", "white")
            .style("padding", "8px")
            .style("border-radius", "4px")
            .style("font-size", "12px")
            .style("pointer-events", "none")
            .style("z-index", "1000");

        tooltip.html(`
            <strong>${curve.process}</strong> (PID: ${curve.pid})<br>
            <strong>File:</strong> ${curve.file}<br>
            <strong>FD:</strong> ${curve.fd}
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
    startAutoUpdate(intervalMs = 5000) {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        this.updateInterval = setInterval(() => {
            if (this.isActive) {
                this.updateCurves();
            }
        }, intervalMs);
    }

    // Stop auto update
    stopAutoUpdate() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    // Toggle between functional and decorative curves
    toggleMode() {
        this.isActive = !this.isActive;
        if (this.isActive) {
            this.updateCurves();
        } else {
            this.renderDecorativeCurves();
        }
    }

    // Cleanup
    destroy() {
        this.stopAutoUpdate();
        d3.selectAll('.bezier-curve').remove();
        d3.selectAll('.file-endpoint').remove();
        d3.selectAll('.tooltip').remove();
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BezierCurvesManager;
}

// Make it globally available for browser
if (typeof window !== 'undefined') {
    window.BezierCurvesManager = BezierCurvesManager;
}
