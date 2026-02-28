// Module for working with active network connections
class ActiveConnectionsManager {
    constructor() {
        debugLog("ActiveConnectionsManager: constructor called");
        this.currentConnections = [];
        this.updateInterval = null;
        this.updateCallback = null;
        this.tracerouteCache = new Map();
        this.pendingTraceroutes = new Map();
    }

    // Update active connections data
    async updateConnectionsTable() {
        try {
            debugLog("ActiveConnectionsManager: updateConnectionsTable called");
            const response = await fetch('/api/active-connections');
            const data = await response.json();
            
            debugLog("API response:", data);
            
            if (data.connections) {
                debugLog("Total connections:", data.connections.length);
                
                // Filter out local connections (127.0.0.1, 0.0.0.0)
                const filteredConnections = data.connections.filter(conn => {
                    const localIP = conn.local.split(':')[0];
                    const remoteIP = conn.remote.split(':')[0];
                    // Show only external connections (not localhost)
                    return localIP !== "127.0.0.1" && localIP !== "0.0.0.0" && 
                           remoteIP !== "127.0.0.1" && remoteIP !== "0.0.0.0";
                });
                
                this.currentConnections = filteredConnections;
                
                debugLog("Filtered connections:", this.currentConnections.length);
                debugLog("Filtered out:", data.connections.length - this.currentConnections.length, "local connections");
                
                this.renderConnectionsTable();
                
                // Call callback if set
                if (this.updateCallback) {
                    this.updateCallback(data);
                }
            }
        } catch (error) {
            console.error('Error getting active connections:', error);
            debugLog('Using fallback data...');
            this.useFallbackData();
        }
    }

    // Fallback data
    useFallbackData() {
        this.currentConnections = [
            {local: '192.168.1.100:22', remote: '10.0.0.50:54321', state: '01', type: 'TCP'},
            {local: '203.0.113.0:80', remote: '172.16.0.10:12345', state: '01', type: 'TCP'},
            {local: '198.51.100.0:443', remote: '192.168.1.101:65432', state: '01', type: 'TCP'},
            {local: '203.0.113.0:8080', remote: '10.0.0.100:54321', state: '01', type: 'TCP'},
            {local: '198.51.100.0:3306', remote: '172.16.0.20:12345', state: '01', type: 'TCP'},
            {local: '192.168.1.200:53', remote: '8.8.8.8:53', state: '01', type: 'UDP'},
            {local: '10.0.0.100:123', remote: 'pool.ntp.org:123', state: '01', type: 'UDP'}
        ];
        this.renderConnectionsTable();
    }

    // Render active connections table below system calls
    renderConnectionsTable() {
        // Do not render connections if Kernel Matrix View is active
        if (window.kernelContextMenu && window.kernelContextMenu.currentView === 'matrix') {
            debugLog('⏸️ Skipping active connections render - Matrix View is active');
            return;
        }

        const svg = d3.select('svg');
        
        // Clear old elements
        svg.selectAll('.connection-row, .connection-box, .connection-text, .connection-details, .connection-header').remove();
        
        // Calculate starting Y position (same as system calls, but to the right)
        const startY = 35; // Same as system calls
        
        // Create new elements for active connections
        this.currentConnections.forEach((connection, i) => {
            const displayText = `${connection.local} → ${connection.remote}`;
            const protocol = String(connection.type || 'N/A').toUpperCase();
            const stateName = this.getSocketStateName(connection.state, protocol);
            const detailsText = `${protocol} (${stateName})`;
            const row = svg.append('g')
                .attr('class', 'connection-row')
                .style('cursor', 'pointer');

            // Connection box (positioned to the right of system calls)
            row.append('rect')
                .attr('x', 300) // To the right of system calls (30 + 230 + 40 gap)
                .attr('y', startY + i * 30) // Same spacing as system calls
                .attr('width', 280) // Wider box for more info
                .attr('height', 26) // Same height as system calls
                .attr('class', 'item-box connection-box')
                .attr('rx', 4); // Rounded corners

            // Main connection text
            row.append('text')
                .attr('x', 308) // Adjusted for new position
                .attr('y', startY + 15 + i * 30)
                .text(displayText)
                .attr('class', 'socket-text connection-text')
                .attr('font-size', '11px');

            // Connection details (type and state)
            row.append('text')
                .attr('x', 308) // Adjusted for new position
                .attr('y', startY + 23 + i * 30)
                .text(detailsText)
                .attr('class', 'connection-details')
                .attr('font-size', '9px')
                .attr('fill', '#666')
                .attr('font-family', 'monospace');

            this.attachSocketTooltipHandlers(row, connection);
        });
    }

    parseEndpoint(endpoint) {
        if (!endpoint) return { host: "N/A", port: "N/A" };
        const value = String(endpoint);
        const separator = value.lastIndexOf(':');
        if (separator === -1) return { host: value, port: "N/A" };
        return {
            host: value.substring(0, separator),
            port: value.substring(separator + 1) || "N/A"
        };
    }

    getSocketStateName(stateCode, protocol) {
        if (!stateCode) return "UNKNOWN";
        const tcpStates = {
            "01": "ESTABLISHED",
            "02": "SYN_SENT",
            "03": "SYN_RECV",
            "04": "FIN_WAIT1",
            "05": "FIN_WAIT2",
            "06": "TIME_WAIT",
            "07": "CLOSE",
            "08": "CLOSE_WAIT",
            "09": "LAST_ACK",
            "0A": "LISTEN",
            "0B": "CLOSING"
        };
        const normalizedProtocol = String(protocol || "").toUpperCase();
        const normalizedState = String(stateCode).toUpperCase();
        if (normalizedProtocol.includes("UDP")) return "DATAGRAM";
        return tcpStates[normalizedState] || normalizedState;
    }

    buildSocketTooltipHtml(connection) {
        const local = this.parseEndpoint(connection.local);
        const remote = this.parseEndpoint(connection.remote);
        const protocol = String(connection.type || "N/A").toUpperCase();
        const stateCode = String(connection.state || "N/A").toUpperCase();
        const stateName = this.getSocketStateName(stateCode, protocol);
        return `
            <strong>Socket Flow</strong><br>
            <strong>Protocol:</strong> ${protocol}<br>
            <strong>State:</strong> ${stateName} (${stateCode})<br>
            <strong>Local:</strong> ${local.host}:${local.port}<br>
            <strong>Remote:</strong> ${remote.host}:${remote.port}<br>
            <strong>Traceroute:</strong> loading...
        `;
    }

    buildTracerouteHtml(traceData) {
        if (!traceData) return "<strong>Traceroute:</strong> no data";
        if (traceData.note) return `<strong>Traceroute:</strong> ${traceData.note}`;
        const hops = Array.isArray(traceData.hops) ? traceData.hops.slice(0, 6) : [];
        if (hops.length === 0) return "<strong>Traceroute:</strong> no hops";
        const hopsText = hops.map(h => {
            const rtt = h.rtt_ms === null || h.rtt_ms === undefined ? "*" : `${h.rtt_ms.toFixed(1)}ms`;
            return `${h.hop}. ${h.target} (${rtt})`;
        }).join("<br>");
        const reachMark = traceData.reached ? "reached" : "partial";
        return `<strong>Traceroute:</strong> ${traceData.tool || "n/a"} (${reachMark})<br>${hopsText}`;
    }

    async fetchTraceroute(remoteIp) {
        if (!remoteIp || remoteIp === "N/A") {
            return { note: "remote IP unavailable", hops: [] };
        }
        if (this.tracerouteCache.has(remoteIp)) {
            return this.tracerouteCache.get(remoteIp);
        }
        if (this.pendingTraceroutes.has(remoteIp)) {
            return this.pendingTraceroutes.get(remoteIp);
        }

        const requestPromise = fetch(`/api/traceroute?ip=${encodeURIComponent(remoteIp)}`)
            .then(async (res) => {
                if (!res.ok) {
                    const errorPayload = await res.json().catch(() => ({}));
                    throw new Error(errorPayload.error || `HTTP ${res.status}`);
                }
                return res.json();
            })
            .then((payload) => {
                this.tracerouteCache.set(remoteIp, payload);
                return payload;
            })
            .catch((err) => ({ note: `traceroute unavailable: ${err.message}`, hops: [] }))
            .finally(() => {
                this.pendingTraceroutes.delete(remoteIp);
            });

        this.pendingTraceroutes.set(remoteIp, requestPromise);
        return requestPromise;
    }

    attachSocketTooltipHandlers(selection, connection) {
        selection
            .on("mouseover", (event) => {
                d3.selectAll(".socket-tooltip").remove();
                const tooltip = d3.select("body")
                    .append("div")
                    .attr("class", "tooltip socket-tooltip")
                    .attr("data-remote-ip", this.parseEndpoint(connection.remote).host)
                    .style("opacity", 0);

                tooltip.html(this.buildSocketTooltipHtml(connection))
                    .style("left", `${event.pageX + 10}px`)
                    .style("top", `${event.pageY - 10}px`)
                    .transition()
                    .duration(120)
                    .style("opacity", 1);

                const remoteIp = this.parseEndpoint(connection.remote).host;
                this.fetchTraceroute(remoteIp).then((traceData) => {
                    const activeTooltip = d3.select(`.socket-tooltip[data-remote-ip="${remoteIp}"]`);
                    if (activeTooltip.empty()) return;
                    const local = this.parseEndpoint(connection.local);
                    const remote = this.parseEndpoint(connection.remote);
                    const protocol = String(connection.type || "N/A").toUpperCase();
                    const stateCode = String(connection.state || "N/A").toUpperCase();
                    const stateName = this.getSocketStateName(stateCode, protocol);
                    activeTooltip.html(`
                        <strong>Socket Flow</strong><br>
                        <strong>Protocol:</strong> ${protocol}<br>
                        <strong>State:</strong> ${stateName} (${stateCode})<br>
                        <strong>Local:</strong> ${local.host}:${local.port}<br>
                        <strong>Remote:</strong> ${remote.host}:${remote.port}<br>
                        ${this.buildTracerouteHtml(traceData)}
                    `);
                });
            })
            .on("mousemove", (event) => {
                d3.select(".socket-tooltip")
                    .style("left", `${event.pageX + 10}px`)
                    .style("top", `${event.pageY - 10}px`);
            })
            .on("mouseout", () => {
                d3.selectAll(".socket-tooltip")
                    .transition()
                    .duration(100)
                    .style("opacity", 0)
                    .remove();
            });
    }

    // Start auto update
    startAutoUpdate(intervalMs = 3000) {
        debugLog("ActiveConnectionsManager: startAutoUpdate called");
        this.updateConnectionsTable();
        this.updateInterval = setInterval(() => {
            this.updateConnectionsTable();
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
    getCurrentConnections() {
        return this.currentConnections;
    }

    // Restore state
    restoreState() {
        if (this.currentConnections.length > 0) {
            this.renderConnectionsTable();
        } else {
            this.updateConnectionsTable();
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ActiveConnectionsManager;
}
