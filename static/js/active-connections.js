// Module for working with active network connections
class ActiveConnectionsManager {
    constructor() {
        console.log("ActiveConnectionsManager: constructor called");
        this.currentConnections = [];
        this.updateInterval = null;
        this.updateCallback = null;
    }

    // Update active connections data
    async updateConnectionsTable() {
        try {
            console.log("ActiveConnectionsManager: updateConnectionsTable called");
            const response = await fetch('/api/active-connections');
            const data = await response.json();
            
            console.log("API response:", data);
            
            if (data.connections) {
                console.log("Total connections:", data.connections.length);
                
                // Filter out local connections (127.0.0.1, 0.0.0.0)
                const filteredConnections = data.connections.filter(conn => {
                    const localIP = conn.local.split(':')[0];
                    const remoteIP = conn.remote.split(':')[0];
                    // Show only external connections (not localhost)
                    return localIP !== "127.0.0.1" && localIP !== "0.0.0.0" && 
                           remoteIP !== "127.0.0.1" && remoteIP !== "0.0.0.0";
                });
                
                this.currentConnections = filteredConnections;
                
                console.log("Filtered connections:", this.currentConnections.length);
                console.log("Filtered out:", data.connections.length - this.currentConnections.length, "local connections");
                
                this.renderConnectionsTable();
                
                // Call callback if set
                if (this.updateCallback) {
                    this.updateCallback(data);
                }
            }
        } catch (error) {
            console.error('Error getting active connections:', error);
            console.log('Using fallback data...');
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
            console.log('⏸️ Skipping active connections render - Matrix View is active');
            return;
        }

        const svg = d3.select('svg');
        
        // Clear old elements
        svg.selectAll('.connection-box, .connection-text, .connection-details, .connection-header').remove();
        
        // Calculate starting Y position (same as system calls, but to the right)
        const startY = 35; // Same as system calls
        
        // Create new elements for active connections
        this.currentConnections.forEach((connection, i) => {
            const displayText = `${connection.local} → ${connection.remote}`;
            const detailsText = `${connection.type} (${connection.state})`;
            
            // Connection box (positioned to the right of system calls)
            svg.append('rect')
                .attr('x', 300) // To the right of system calls (30 + 230 + 40 gap)
                .attr('y', startY + i * 30) // Same spacing as system calls
                .attr('width', 280) // Wider box for more info
                .attr('height', 26) // Same height as system calls
                .attr('class', 'item-box connection-box')
                .attr('rx', 4); // Rounded corners

            // Main connection text
            svg.append('text')
                .attr('x', 308) // Adjusted for new position
                .attr('y', startY + 15 + i * 30)
                .text(displayText)
                .attr('class', 'socket-text connection-text')
                .attr('font-size', '11px');

            // Connection details (type and state)
            svg.append('text')
                .attr('x', 308) // Adjusted for new position
                .attr('y', startY + 23 + i * 30)
                .text(detailsText)
                .attr('class', 'connection-details')
                .attr('font-size', '9px')
                .attr('fill', '#666')
                .attr('font-family', 'monospace');
        });
    }

    // Start auto update
    startAutoUpdate(intervalMs = 3000) {
        console.log("ActiveConnectionsManager: startAutoUpdate called");
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
