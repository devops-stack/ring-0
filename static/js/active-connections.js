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
                this.currentConnections = data.connections.filter(conn => {
                    const localIP = conn.local.split(':')[0];
                    return true; // Temporarily show all connections
                });
                
                console.log("Filtered connections:", this.currentConnections.length);
                
                this.renderConnectionsTable();
                
                // Call callback if set
                if (this.updateCallback) {
                    this.updateCallback(data);
                }
            }
        } catch (error) {
            console.error('Error getting active connections:', error);
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
            {local: '198.51.100.0:3306', remote: '172.16.0.20:12345', state: '01', type: 'TCP'}
        ];
        this.renderConnectionsTable();
    }

    // Render active connections table below system calls
    renderConnectionsTable() {
        const svg = d3.select('svg');
        
        // Clear old elements
        svg.selectAll('.connection-box, .connection-text').remove();
        
        // Calculate starting Y position (below system calls)
        const startY = 35 + 10 * 30 + 20; // 10 system calls * 30px + 20px gap
        
        // Create new elements for active connections
        this.currentConnections.forEach((connection, i) => {
            const displayText = `${connection.local} → ${connection.remote}`;
            
            svg.append('rect')
                .attr('x', 30)
                .attr('y', startY + i * 30)
                .attr('width', 230)
                .attr('height', 22)
                .attr('class', 'item-box connection-box');

            svg.append('text')
                .attr('x', 38)
                .attr('y', startY + 15 + i * 30)
                .text(displayText)
                .attr('class', 'socket-text connection-text');
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
