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
        
        // Clear old elements
        svg.selectAll(".syscall-box, .syscall-text").remove();
        
        console.log(`🎨 Rendering ${this.currentSyscalls.length} system calls`);
        
        // Create new elements for system calls
        this.currentSyscalls.forEach((syscall, i) => {
            const displayText = `${syscall.name.toUpperCase()} ${syscall.count}`;
            
            svg.append("rect")
                .attr("x", 30)
                .attr("y", 35 + i * 30)
                .attr("width", 230)
                .attr("height", 22)
                .attr("class", "item-box syscall-box");

            svg.append("text")
                .attr("x", 38)
                .attr("y", 50 + i * 30)
                .text(displayText)
                .attr("class", "socket-text syscall-text");
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
