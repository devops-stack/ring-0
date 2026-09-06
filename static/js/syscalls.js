// Module for working with system calls
class SyscallsManager {
    constructor() {
        this.currentSyscalls = [];
        this.updateInterval = null;
        this.updateCallback = null;
        this.hiddenCount = 0;
        this.sampledAt = "";
        this.pinnedSubsystemKey = null;
        this.hoveredSubsystemKey = null;
        this.updateInFlight = false;
        // "loading" until the first answer arrives, then "ok" or "unavailable".
        this.feedState = "loading";
        // "machine" when the root collector answered, "self" when the backend
        // could only read its own processes. The footer says which.
        this.sampleScope = null;
    }

    // How many rows fit above the subsystem bars and the IRQ panel, which is
    // docked to the bottom of the window. The list used to stop at eight on
    // every screen; a tall window can hold the whole sample.
    maxVisibleRows() {
        const irqTop = Math.max(20, window.innerHeight - 230);
        // Below the frame: a 30px gap, four 25px bars, the load line, some air.
        const barsBlock = 30 + 4 * 25 + 14 + 8;
        const chrome = 20 + 30 + 14;
        return Math.max(4, Math.min(16, Math.floor((irqTop - barsBlock - chrome) / 30)));
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
            name.includes("mount") ||
            // Descriptor and path plumbing shows up constantly in real samples.
            name.includes("flock") || name.includes("fcntl") || name.includes("ioctl") ||
            name.includes("umask") || name.includes("dup") || name.includes("pipe") ||
            name.includes("access") || name.includes("truncate") || name.includes("sync") ||
            name.includes("link") || name.includes("xattr") || name.includes("chdir")
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
            name.includes("signal") || name.includes("sigreturn") || name.includes("rusage") ||
            name.includes("prctl") || name.includes("getpid") || name.includes("getppid") ||
            name.includes("exit")
        ) {
            return "process_scheduler";
        }
        // Anything unrecognised used to be filed under the scheduler, which put a
        // confident but wrong tag on real samples. Say "core" instead.
        return "kernel_core";
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

    // /proc/<pid>/syscall reports which processes are parked in a syscall at this
    // instant and nothing else, so the panel shows exactly that: no padding rows,
    // no counts carried over from the previous poll.
    normalizeSyscalls(syscalls) {
        const input = Array.isArray(syscalls) ? syscalls : [];
        const byName = new Map();

        input.forEach((entry) => {
            const name = entry && entry.name !== undefined ? String(entry.name).trim() : "";
            if (!name) return;
            const key = name.toLowerCase();
            const count = Number(entry.count) || 0;
            const known = byName.get(key);
            // Who is parked here. Counter-derived rows (vmstat, block, sockstat)
            // carry no processes, and those rows simply do not open.
            const waiters = (Array.isArray(entry.waiters) ? entry.waiters : [])
                .map((w) => ({ pid: Number(w && w.pid), comm: String((w && w.comm) || "") }))
                .filter((w) => Number.isFinite(w.pid) && w.pid > 0);
            byName.set(key, {
                name,
                count: (known ? known.count : 0) + count,
                waiters: (known ? known.waiters : []).concat(waiters)
            });
        });

        const limit = this.maxVisibleRows();
        const ordered = [...byName.values()].sort((a, b) => b.count - a.count);
        return {
            rows: ordered.slice(0, limit),
            hidden: Math.max(0, ordered.length - limit)
        };
    }

    // Nothing parked is a normal, frequent state — say so instead of padding.
    placeholderNote() {
        if (this.feedState === "loading") return "reading /proc …";
        if (this.feedState === "unavailable") return "collector unavailable";
        return "nothing parked in a syscall";
    }

    // Update system calls data
    async updateSyscallsTable() {
        // A slow host must not turn this interval into an unbounded request
        // queue. The next timer tick will collect the newest snapshot.
        if (this.updateInFlight) return;
        this.updateInFlight = true;
        try {
            const response = await fetch("/api/syscalls-realtime");
            const data = await response.json();
            const rowsGiven = Array.isArray(data.syscalls);
            const normalized = this.normalizeSyscalls(rowsGiven ? data.syscalls : []);

            this.currentSyscalls = normalized.rows;
            this.hiddenCount = normalized.hidden;
            this.feedState = rowsGiven ? "ok" : "unavailable";
            this.sampleScope = (data.sample && data.sample.scope) || null;
            this.sampledAt = this.formatSampleTime(data.timestamp);
            this.renderSyscallsTable();
            debugLog(`✅ System calls rendered: ${this.currentSyscalls.length} parked`);

            if (this.updateCallback) {
                this.updateCallback(data);
            }
        } catch (error) {
            console.error('❌ Error getting system calls:', error);
            this.markFeedUnavailable();
        } finally {
            this.updateInFlight = false;
        }
    }

    formatSampleTime(timestamp) {
        const when = timestamp ? new Date(timestamp) : new Date();
        if (Number.isNaN(when.getTime())) return "";
        return when.toTimeString().slice(0, 8);
    }

    markFeedUnavailable() {
        this.currentSyscalls = [];
        this.hiddenCount = 0;
        this.feedState = "unavailable";
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
        svg.selectAll(".syscall-frame, .syscall-foot").remove();

        debugLog(`🎨 Rendering ${this.currentSyscalls.length} system calls`);
        const manager = this;
        const rows = this.currentSyscalls;

        const panelX = 30;
        const panelWidth = 230;
        const panelHeight = 22;
        const rowStep = 30;
        const firstRowY = 35;
        const bodyCount = Math.max(1, rows.length);

        // The frame used to be a fixed 250x330 box sized for ten padded rows. It
        // keeps its old look but follows the number of real rows, so no empty
        // box is left hanging under a short list.
        const frameH = 30 + bodyCount * rowStep + 14;
        svg.append("rect")
            .attr("x", 20)
            .attr("y", 20)
            .attr("width", 250)
            .attr("height", frameH)
            .attr("class", "feature-panel syscall-frame syscall-box");

        const rowText = (parent, x, y, value, size, fill, anchor) => parent.append("text")
            .attr("x", x)
            .attr("y", y)
            .attr("class", "syscall-text")
            .style("font-family", "Share Tech Mono, monospace")
            .style("font-size", `${size}px`)
            .style("text-anchor", anchor || "start")
            .style("letter-spacing", "0.3px")
            .style("fill", fill)
            .text(value);

        // Nothing waiting is a normal state, so it gets a panel of its own rather
        // than padding rows out with numbers nobody measured.
        if (!rows.length) {
            const panelGroup = svg.append("g").attr("class", "syscall-panel-group");
            panelGroup.append("rect")
                .attr("x", panelX)
                .attr("y", firstRowY)
                .attr("width", panelWidth)
                .attr("height", panelHeight)
                .attr("rx", 8)
                .attr("class", "syscall-box")
                .style("fill", "#333")
                .style("stroke", "#555")
                .style("stroke-width", "1px");
            rowText(panelGroup, panelX + 8, firstRowY + 15,
                this.placeholderNote().toUpperCase(), 10, "rgba(200, 204, 212, 0.62)");
        }

        // Create new elements for system calls with diegetic UI panel style
        let cursorY = firstRowY;
        rows.forEach((syscall, i) => {
            const subsystemKey = this.getSubsystemKeyForSyscall(syscall.name);
            const subsystemTag = this.getSubsystemTag(subsystemKey);
            // Unmapped calls have no subsystem to light up, so they stay inert
            // instead of offering a link that leads nowhere.
            const linked = subsystemKey !== "kernel_core";
            const isPinned = linked && this.pinnedSubsystemKey === subsystemKey;
            // Counter-derived rows (vmstat, block, sockstat) are not calls and
            // have no anatomy to open.
            const openable = !/^(vm|disk|net):/.test(syscall.name);
            const displayText = `${syscall.name.toUpperCase()} ${syscall.count}`;
            const panelY = cursorY;
            cursorY += rowStep;

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
                .style("stroke-width", "1px")
                .style("cursor", linked ? "pointer" : "default");

            // Text inside panel
            const text = rowText(panelGroup, panelX + 8, panelY + 15, displayText, 11, "#c8ccd4");

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

            // A row that opens something says so; the caret is the only hint
            // the old style has room for.
            if (openable) {
                panelGroup.append("text")
                    // Clear of the widest tag ("SCHED" at 8px) sitting at -8.
                    .attr("x", panelX + panelWidth - 40)
                    .attr("y", panelY + 15)
                    .text("\u25b8")
                    .attr("class", "syscall-text syscall-caret")
                    .style("font-family", "Share Tech Mono, monospace")
                    .style("font-size", "9px")
                    .style("text-anchor", "end")
                    .style("fill", "rgba(200, 204, 212, 0.75)");
            }

            // A counter row that maps to no subsystem has nothing to offer.
            if (!linked && !openable) return;
            panel.style("cursor", "pointer");

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
                    // "core" is not a subsystem row, so focusing it would only dim
                    // every bar without lighting one.
                    if (linked) manager.emitSubsystemFocus(subsystemKey, "hover");
                })
                .on("mouseleave", function() {
                    d3.select(this)
                        .style("fill", this.__originalFill || "#333")
                        .style("stroke", this.__originalStroke || (isPinned ? subsystemTag.color : "#555"))
                        .style("stroke-width", this.__originalStrokeWidth || "1px");
                    text.style("fill", "#c8ccd4");
                    if (linked) manager.emitSubsystemFocus(null, "hover-clear");
                })
                .on("click", () => {
                    // The row opens the call itself: what it is in this kernel,
                    // the path it takes through it, and who is standing in it.
                    // The subsystem stays lit for as long as the card is open,
                    // so the bar below and the card tell the same story.
                    if (openable && window.SyscallCard) {
                        window.SyscallCard.open(
                            syscall, { x: panelX + panelWidth, y: panelY + 11 }, subsystemTag
                        );
                    }
                    if (linked) this.pinnedSubsystemKey = isPinned ? null : subsystemKey;
                    this.renderSyscallsTable();
                    this.emitSubsystemFocus(this.pinnedSubsystemKey, "pin-toggle");
                });
        });

        // When the sample was taken, and whether the list had to be cut short.
        const foot = [
            // Claiming a sample time would be wrong when nothing was sampled.
            this.feedState === "ok" && this.sampledAt ? `SAMPLED ${this.sampledAt}` : "",
            this.hiddenCount ? `+${this.hiddenCount} MORE` : "",
            // Without the root collector the backend can only read its own
            // processes. Saying so beats passing one row off as the machine.
            this.sampleScope === "self" ? "BACKEND ONLY" : ""
        ].filter(Boolean).join("  ");
        if (foot) {
            svg.append("text")
                .attr("x", panelX)
                .attr("y", 20 + frameH - 8)
                .attr("class", "syscall-text syscall-foot syscall-box")
                .style("font-family", "Share Tech Mono, monospace")
                .style("font-size", "8px")
                .style("letter-spacing", "0.5px")
                // Dark ink: this line sits on the light frame, not on a dark panel.
                .style("fill", "rgba(40, 44, 50, 0.6)")
                .text(foot);
        }

        // The subsystem bars sit under this panel, so tell them where it now ends:
        // its height moves with the number of waiters.
        const bottom = 20 + frameH;
        if (window.__leftColumnCursor !== bottom) {
            window.__leftColumnCursor = bottom;
            if (window.SubsystemFocus) window.SubsystemFocus.reflow();
        }

        debugLog(`✅ Rendered ${rows.length} system call rows`);
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
