// Module for working with system calls
class SyscallsManager {
    constructor() {
        this.currentSyscalls = [];
        this.updateInterval = null;
        this.updateCallback = null;
    }

    // Update system calls data
    async updateSyscallsTable() {
        try {
            const response = await fetch("/api/syscalls-realtime");
            const data = await response.json();
            
            if (data.syscalls) {
                console.log(`📊 System calls update: ${data.syscalls.length} syscalls received`);
                this.currentSyscalls = data.syscalls;
                this.renderSyscallsTable();
                console.log(`✅ System calls rendered: ${this.currentSyscalls.length} items`);
                
                // Call callback if set
                if (this.updateCallback) {
                    this.updateCallback(data);
                }
            } else {
                console.warn('⚠️ No syscalls in API response, using fallback');
                this.useFallbackData();
            }
        } catch (error) {
            console.error('❌ Error getting system calls:', error);
            this.useFallbackData();
        }
    }

    // Fallback data
    useFallbackData() {
        this.currentSyscalls = [
            {name: "FT9", count: "166 643218"},
            {name: "FT9", count: "964 016161"},
            {name: "FT9", count: "972 983879"},
            {name: "FT9", count: "989 612075"},
            {name: "FT9", count: "819 540732"},
            {name: "FT9", count: "512 826219"},
            {name: "FT9", count: "025 461491"},
            {name: "FT9", count: "838 475394"},
            {name: "FT9", count: "632 094939"},
            {name: "FT9", count: "417 205788"}
        ];
        this.renderSyscallsTable();
    }

    // Render system calls table
    renderSyscallsTable() {
        // Don't render if Matrix View is active
        if (window.kernelContextMenu && window.kernelContextMenu.currentView === 'matrix') {
            console.log('⏸️ Skipping syscalls render - Matrix View is active');
            return;
        }
        
        const svg = d3.select("svg");
        
        // Clear old elements (including panel groups)
        svg.selectAll(".syscall-box, .syscall-text, .syscall-panel-group").remove();
        
        console.log(`🎨 Rendering ${this.currentSyscalls.length} system calls`);
        
        // Create new elements for system calls with diegetic UI panel style
        this.currentSyscalls.forEach((syscall, i) => {
            const displayText = `${syscall.name.toUpperCase()} ${syscall.count}`;
            const panelX = 30;
            const panelY = 35 + i * 30;
            const panelWidth = 230;
            const panelHeight = 22;
            
            // Create panel group for each syscall
            const panelGroup = svg.append("g")
                .attr("class", "syscall-panel-group")
                .attr("data-syscall-index", i);
            
            // Panel background - diegetic UI style (like "SUBJECT U454.1")
            const panel = panelGroup.append("rect")
                .attr("x", panelX)
                .attr("y", panelY)
                .attr("width", panelWidth)
                .attr("height", panelHeight)
                .attr("rx", 1)
                .attr("class", "syscall-box")
                .style("fill", "rgba(10, 15, 20, 0.6)") // Dark panel background
                .style("stroke", "rgba(180, 190, 210, 0.2)") // Subtle border
                .style("stroke-width", "0.5px")
                .style("opacity", 0.7)
                .style("filter", "drop-shadow(0 0 1px rgba(200, 200, 200, 0.05))"); // Subtle glow
            
            // Text inside panel
            const text = panelGroup.append("text")
                .attr("x", panelX + 8)
                .attr("y", panelY + 15)
                .text(displayText)
                .attr("class", "syscall-text")
                .style("font-family", "Share Tech Mono, monospace")
                .style("font-size", "11px")
                .style("fill", "#c8ccd4") // Milk-gray text color
                .style("letter-spacing", "0.3px"); // Slight letter spacing
            
            // Hover effects
            panel
                .on("mouseenter", function() {
                    d3.select(this)
                        .style("fill", "rgba(15, 22, 30, 0.8)")
                        .style("stroke", "rgba(200, 200, 200, 0.3)")
                        .style("opacity", 1);
                    text.style("fill", "#dde2ea"); // Lighter on hover
                })
                .on("mouseleave", function() {
                    d3.select(this)
                        .style("fill", "rgba(10, 15, 20, 0.6)")
                        .style("stroke", "rgba(180, 190, 210, 0.2)")
                        .style("opacity", 0.7);
                    text.style("fill", "#c8ccd4");
                });
        });
        
        console.log(`✅ Rendered ${this.currentSyscalls.length} system call elements`);
        // Display active connections below system calls
        // this.displayActiveConnections();
    }

    // Start auto update
    startAutoUpdate(intervalMs = 3000) {
        this.updateSyscallsTable();
        this.updateInterval = setInterval(() => {
            this.updateSyscallsTable();
        }, intervalMs);
    }

    // Stop auto update
    stopAutoUpdate() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    // Set update callback
    setUpdateCallback(callback) {
        this.updateCallback = callback;
    }

    // Get current data
    getCurrentSyscalls() {
        return this.currentSyscalls;
    }

    // Restore state
    restoreState() {
        if (this.currentSyscalls.length > 0) {
            this.renderSyscallsTable();
        } else {
            this.updateSyscallsTable();
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SyscallsManager;
}
