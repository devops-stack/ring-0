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
                
                // Filter out local connections (127.0.0.1, 0.0.0.0, 1.0.0.127)
                const filteredConnections = data.connections.filter(conn => {
                    const localIP = conn.local.split(':')[0];
                    return localIP !== "127.0.0.1" && localIP !== "0.0.0.0" && localIP !== "1.0.0.127";
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
        const svg = d3.select('svg');
        
        // Clear old elements
        svg.selectAll('.connection-box, .connection-text, .connection-details, .connection-header').remove();
        
        // Calculate starting Y position (below system calls)
        const startY = 35 + 10 * 30 + 20; // 10 system calls * 30px + 20px gap
        
        // Add header for active connections
        svg.append('text')
            .attr('x', 30)
            .attr('y', startY - 5)
            .text('Active Network Connections')
            .attr('class', 'connection-header')
            .attr('font-size', '12px')
            .attr('font-weight', 'bold')
            .attr('fill', '#333');
        
        // Create new elements for active connections
        this.currentConnections.forEach((connection, i) => {
            const displayText = `${connection.local} → ${connection.remote}`;
            const detailsText = `${connection.type} (${connection.state})`;
            
            // Connection box
            svg.append('rect')
                .attr('x', 30)
                .attr('y', startY + i * 35) // Increased spacing
                .attr('width', 280) // Wider box for more info
                .attr('height', 28) // Taller box
                .attr('class', 'item-box connection-box')
                .attr('rx', 4); // Rounded corners

            // Main connection text
            svg.append('text')
                .attr('x', 38)
                .attr('y', startY + 15 + i * 35)
                .text(displayText)
                .attr('class', 'socket-text connection-text')
                .attr('font-size', '11px');

            // Connection details (type and state)
            svg.append('text')
                .attr('x', 38)
                .attr('y', startY + 28 + i * 35)
                .text(detailsText)
                .attr('class', 'connection-details')
                .attr('font-size', '9px')
                .attr('fill', '#666');
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
