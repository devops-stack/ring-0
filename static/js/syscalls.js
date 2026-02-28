// Module for working with system calls
class SyscallsManager {
    constructor() {
        this.currentSyscalls = [];
        this.updateInterval = null;
        this.updateCallback = null;
        this.minVisibleRows = 10;
        this.warmupUntil = 0;
        this.isWarmup = false;
        this.pinnedSubsystemKey = null;
        this.defaultSyscalls = [
            { name: "read", count: "166 643218" },
            { name: "write", count: "964 016161" },
            { name: "open", count: "972 983879" },
            { name: "close", count: "989 612075" },
            { name: "mmap", count: "819 540732" },
            { name: "fork", count: "512 826219" },
            { name: "execve", count: "025 461491" },
            { name: "socket", count: "838 475394" },
            { name: "connect", count: "632 094939" },
            { name: "accept", count: "417 205788" }
        ];
    }

    getSubsystemKeyForSyscall(syscallName) {
        const name = String(syscallName || "").toLowerCase();
        if (!name) return "process_scheduler";

        if (
            name.includes("socket") || name.includes("connect") || name.includes("accept") ||
            name.includes("recv") || name.includes("send") || name.includes("poll") ||
            name.includes("epoll") || name.includes("select")
        ) {
            return "network_stack";
        }
        if (
            name.includes("open") || name.includes("close") || name.includes("read") ||
            name.includes("write") || name.includes("stat") || name.includes("lseek") ||
            name.includes("fsync") || name.includes("fdatasync") || name.includes("rename") ||
            name.includes("unlink") || name.includes("mkdir") || name.includes("rmdir") ||
            name.includes("getdents") || name.includes("chmod") || name.includes("chown") ||
            name.includes("mount")
        ) {
            return "file_system";
        }
        if (
            name.includes("mmap") || name.includes("munmap") || name.includes("mprotect") ||
            name.includes("brk") || name.includes("madvise") || name.includes("mlock") ||
            name.includes("shm")
        ) {
            return "memory_management";
        }
        if (
            name.includes("futex") || name.includes("clone") || name.includes("fork") ||
            name.includes("exec") || name.includes("wait") || name.includes("sched") ||
            name.includes("nanosleep") || name.includes("timer") || name.includes("kill") ||
            name.includes("signal")
        ) {
            return "process_scheduler";
        }
        return "process_scheduler";
    }

    getSubsystemTag(subsystemKey) {
        const tags = {
            network_stack: { text: "NET", color: "rgba(103, 190, 224, 0.92)" },
            file_system: { text: "FS", color: "rgba(188, 188, 188, 0.92)" },
            process_scheduler: { text: "SCHED", color: "rgba(167, 200, 120, 0.9)" },
            memory_management: { text: "MEM", color: "rgba(180, 160, 214, 0.9)" }
        };
        return tags[subsystemKey] || { text: "CORE", color: "rgba(176, 186, 198, 0.9)" };
    }

    emitSubsystemFocus(subsystemKey, source = "hover") {
        const activeKey = subsystemKey || this.pinnedSubsystemKey || null;
        window.dispatchEvent(
            new CustomEvent("syscall-subsystem-focus", {
                detail: {
                    subsystemKey: activeKey,
                    source,
                    pinnedSubsystemKey: this.pinnedSubsystemKey
                }
            })
        );
    }

    normalizeSyscalls(syscalls) {
        const input = Array.isArray(syscalls) ? syscalls : [];
        const normalized = [];
        const seen = new Set();
        let usedHistory = false;
        let usedDefaults = false;

        const addUnique = (entry) => {
            const rawName = entry && entry.name !== undefined ? String(entry.name).trim() : "";
            if (!rawName) return;
            const nameKey = rawName.toLowerCase();
            if (seen.has(nameKey)) return;
            const rawCount = entry && entry.count !== undefined ? String(entry.count).trim() : "";
            normalized.push({
                name: rawName,
                count: rawCount || "000 000000"
            });
            seen.add(nameKey);
        };

        input.forEach(addUnique);
        const fromApiCount = normalized.length;
        this.currentSyscalls.forEach((entry) => {
            const before = normalized.length;
            addUnique(entry);
            if (normalized.length > before) usedHistory = true;
        });
        this.defaultSyscalls.forEach((entry) => {
            const before = normalized.length;
            addUnique(entry);
            if (normalized.length > before) usedDefaults = true;
        });

        return {
            rows: normalized.slice(0, this.minVisibleRows),
            warmup: fromApiCount < this.minVisibleRows || usedHistory || usedDefaults
        };
    }

    // Update system calls data
    async updateSyscallsTable() {
        try {
            const response = await fetch("/api/syscalls-realtime");
            const data = await response.json();
            
            if (data.syscalls) {
                debugLog(`📊 System calls update: ${data.syscalls.length} syscalls received`);
                const normalized = this.normalizeSyscalls(data.syscalls);
                this.currentSyscalls = normalized.rows;
                this.isWarmup = normalized.warmup;
                if (this.isWarmup) {
                    this.warmupUntil = Date.now() + 2000;
                }
                this.renderSyscallsTable();
                debugLog(`✅ System calls rendered: ${this.currentSyscalls.length} items`);
                
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
        const normalized = this.normalizeSyscalls([]);
        this.currentSyscalls = normalized.rows;
        this.isWarmup = true;
        this.warmupUntil = Date.now() + 2200;
        this.renderSyscallsTable();
    }

    // Render system calls table
    renderSyscallsTable() {
        // Don't render if Matrix View is active
        if (window.kernelContextMenu && window.kernelContextMenu.currentView === 'matrix') {
            debugLog('⏸️ Skipping syscalls render - Matrix View is active');
            return;
        }
        
        const svg = d3.select("svg");
        
        // Clear old elements (including panel groups)
        svg.selectAll(".syscall-box, .syscall-text, .syscall-panel-group").remove();
        svg.selectAll(".syscall-warmup-indicator").remove();
        
        debugLog(`🎨 Rendering ${this.currentSyscalls.length} system calls`);
        const manager = this;
        
        // Create new elements for system calls with diegetic UI panel style
        this.currentSyscalls.forEach((syscall, i) => {
            const subsystemKey = this.getSubsystemKeyForSyscall(syscall.name);
            const subsystemTag = this.getSubsystemTag(subsystemKey);
            const isPinned = this.pinnedSubsystemKey && this.pinnedSubsystemKey === subsystemKey;
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
                .attr("rx", 8) // More rounded corners like in example
                .attr("class", "syscall-box")
                .style("fill", "#333") // Same base color as right menu panels
                .style("stroke", isPinned ? subsystemTag.color : "#555") // Same border color as right menu panels
                .style("stroke-width", "1px");
            
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

            panelGroup.append("text")
                .attr("x", panelX + panelWidth - 8)
                .attr("y", panelY + 15)
                .text(subsystemTag.text)
                .attr("class", "syscall-text syscall-subsystem-tag")
                .style("font-family", "Share Tech Mono, monospace")
                .style("font-size", "8px")
                .style("text-anchor", "end")
                .style("letter-spacing", "0.3px")
                .style("fill", subsystemTag.color);
            
            // Hover effects
            panel
                .on("mouseenter", function() {
                    this.__originalFill = d3.select(this).style("fill");
                    this.__originalStroke = d3.select(this).style("stroke");
                    this.__originalStrokeWidth = d3.select(this).style("stroke-width");
                    d3.select(this)
                        .style("fill", "#ffffff")
                        .style("stroke", "#ffffff")
                        .style("stroke-width", "2px");
                    text.style("fill", "#000000"); // Dark text on white panel
                    manager.emitSubsystemFocus(subsystemKey, "hover");
                })
                .on("mouseleave", function() {
                    d3.select(this)
                        .style("fill", this.__originalFill || "#333")
                        .style("stroke", this.__originalStroke || (isPinned ? subsystemTag.color : "#555"))
                        .style("stroke-width", this.__originalStrokeWidth || "1px");
                    text.style("fill", "#c8ccd4");
                    manager.emitSubsystemFocus(null, "hover-clear");
                })
                .on("click", () => {
                    this.pinnedSubsystemKey = this.pinnedSubsystemKey === subsystemKey ? null : subsystemKey;
                    this.renderSyscallsTable();
                    this.emitSubsystemFocus(this.pinnedSubsystemKey, "pin-toggle");
                });
        });

        const shouldShowWarmup = this.isWarmup && Date.now() < this.warmupUntil;
        if (shouldShowWarmup) {
            svg.append("text")
                .attr("class", "syscall-warmup-indicator")
                .attr("x", 252)
                .attr("y", 27)
                .text("WARMUP")
                .style("font-family", "Share Tech Mono, monospace")
                .style("font-size", "8px")
                .style("letter-spacing", "0.5px")
                .style("fill", "rgba(182, 196, 210, 0.85)");
        }
        
        debugLog(`✅ Rendered ${this.currentSyscalls.length} system call elements`);
        this.emitSubsystemFocus(this.pinnedSubsystemKey, "render-sync");
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
