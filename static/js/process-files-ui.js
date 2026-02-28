// Process files and connection markers UI extracted from main.js
(function initProcessFilesUI(){
// Show process files at the bottom of Bezier curves
function showProcessFilesOnCurves(pid, processName) {
    debugLog(`🔍 Showing files for process ${pid} (${processName})`);
    // Clear existing process files
    hideProcessFilesOnCurves();
    
    // Fetch process files
    fetch(`/api/process/${pid}/fds`)
        .then(res => {
            debugLog(`📡 Response status for PID ${pid}:`, res.status);
            return res.json();
        })
        .then(data => {
            debugLog(`📁 Data received for PID ${pid}:`, data);
            // API returns 'open_files' not 'files'
            const files = data.open_files || [];
            debugLog(`📄 Files found: ${files.length}`, files);
            if (files.length === 0) {
                debugLog(`⚠️ No files found for process ${pid} (${processName})`);
                // Don't show connections if no files - it's confusing
                // Connections are network sockets, not files
                debugLog(`ℹ️ Skipping connections display - no files available for this process`);
                return;
            }
            
            const svg = d3.select('svg');
            const width = window.innerWidth;
            const height = window.innerHeight;
            const centerX = width / 2;
            
            // Get all Bezier curves
            const bezierCurves = d3.selectAll('.bezier-curve').nodes();
            
            // Select curves from bottom (start points)
            const bottomCurves = [];
            bezierCurves.forEach((curve, index) => {
                const path = d3.select(curve);
                const pathData = path.attr('d');
                if (pathData) {
                    const startMatches = pathData.match(/M([\d.]+),([\d.]+)/);
                    if (startMatches) {
                        const startX = parseFloat(startMatches[1]);
                        const startY = parseFloat(startMatches[2]);
                        if (startY > height - 250 && startY < height - 150) {
                            bottomCurves.push({ index, startX, startY });
                        }
                    }
                }
            });
            
            // Sort and select curves evenly
            bottomCurves.sort((a, b) => a.startX - b.startX);
            
            // Display files (filter out IP addresses and invalid paths)
            const validFiles = files.filter(file => {
                if (!file.path) return false;
                const path = String(file.path).trim();
                
                // Filter out IP addresses (e.g., "0.0.0.0", "127.0.0.1") - check if entire path is an IP
                const ipPattern = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/;
                if (ipPattern.test(path)) {
                    debugLog(`🚫 Filtered out IP address: ${path}`);
                    return false;
                }
                
                // Filter out socket-like patterns
                if (path.includes('socket:') || path.includes('pipe:') || path.includes('anon_inode:')) {
                    debugLog(`🚫 Filtered out special file: ${path}`);
                    return false;
                }
                
                // Allow /dev files (like /dev/null, /dev/shm, etc.) - they are valid files
                if (path.startsWith('/dev/')) {
                    return true;
                }
                
                // Filter out paths that don't look like file paths (but allow /dev)
                if (!path.startsWith('/')) {
                    debugLog(`🚫 Filtered out non-absolute path: ${path}`);
                    return false;
                }
                
                // Additional check: if filename (last part) looks like an IP address, filter it
                const filename = path.split('/').pop();
                if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(filename)) {
                    debugLog(`🚫 Filtered out path with IP-like filename: ${path}`);
                    return false;
                }
                
                return true;
            });
            
            const numValidFiles = Math.min(validFiles.length, bottomCurves.length, 10); // Limit to 10 files
            const step = Math.max(1, Math.floor(bottomCurves.length / numValidFiles));
            
            // Display files
            debugLog(`✅ Filtered ${validFiles.length} valid files from ${files.length} total`);
            validFiles.slice(0, numValidFiles).forEach((file, i) => {
                if (i * step < bottomCurves.length) {
                    const curve = bottomCurves[i * step];
                    let fileName = file.path ? file.path.split('/').pop() : `FD ${file.fd}`;
                    // Additional safety check: if filename looks like an IP, skip it
                    const ipPattern = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/;
                    if (ipPattern.test(fileName)) {
                        debugLog(`⚠️ Skipping file with IP-like name: ${fileName} (from path: ${file.path})`);
                        return; // Skip this file
                    }
                    const fileType = file.path ? (file.path.includes('log') ? 'log' : file.path.includes('conf') ? 'config' : 'other') : 'other';
                    
                    // Create file group
                    const fileGroup = svg.append("g")
                        .attr("class", `process-file-${pid}`)
                        .attr("data-pid", pid);
                    
                    // Add endpoint circle
                    const endpoint = fileGroup.append("circle")
                        .attr("cx", curve.startX)
                        .attr("cy", curve.startY)
                        .attr("r", 4)
                        .attr("class", "process-file-endpoint")
                        .attr("fill", getFileTypeColor(fileType))
                        .attr("stroke", "#fff")
                        .attr("stroke-width", 1.5)
                        .attr("opacity", 0.9);
                    
                    // Add pulsing animation
                    const pulse = () => {
                        endpoint.transition()
                            .duration(1000)
                            .attr("r", 6)
                            .transition()
                            .duration(1000)
                            .attr("r", 4)
                            .on("end", pulse);
                    };
                    pulse();
                    
                    // Add file label
                    const label = fileGroup.append("text")
                        .attr("x", curve.startX)
                        .attr("y", curve.startY + 20)
                        .attr("class", "process-file-label")
                        .attr("text-anchor", "middle")
                        .attr("font-size", "9px")
                        .attr("fill", "#333")
                        .attr("opacity", 0.9)
                        .text(fileName);
                    
                    // Add background
                    const bbox = label.node().getBBox();
                    fileGroup.insert("rect", "text")
                        .attr("x", bbox.x - 3)
                        .attr("y", bbox.y - 2)
                        .attr("width", bbox.width + 6)
                        .attr("height", bbox.height + 4)
                        .attr("class", "process-file-label-bg")
                        .attr("fill", "rgba(255,255,255,0.95)")
                        .attr("stroke", getFileTypeColor(fileType))
                        .attr("stroke-width", 1)
                        .attr("rx", 2);
                    
                    // Highlight associated curve
                    const curveElement = bezierCurves[curve.index];
                    if (curveElement) {
                        d3.select(curveElement)
                            .transition()
                            .duration(200)
                            .attr("stroke", getFileTypeColor(fileType))
                            .attr("stroke-width", 1.5)
                            .attr("opacity", 0.6);
                    }
                }
            });
        })
        .catch(error => {
            console.error(`❌ Error fetching files for process ${pid}:`, error);
        });
}

// Show connections on curves (alternative to files)
function showConnectionsOnCurves(pid, connections) {
    const svg = d3.select('svg');
    const width = window.innerWidth;
    const height = window.innerHeight;
    const bezierCurves = d3.selectAll('.bezier-curve').nodes();
    
    const bottomCurves = [];
    bezierCurves.forEach((curve, index) => {
        const path = d3.select(curve);
        const pathData = path.attr('d');
        if (pathData) {
            const startMatches = pathData.match(/M([\d.]+),([\d.]+)/);
            if (startMatches) {
                const startX = parseFloat(startMatches[1]);
                const startY = parseFloat(startMatches[2]);
                if (startY > height - 250 && startY < height - 150) {
                    bottomCurves.push({ index, startX, startY });
                }
            }
        }
    });
    
    bottomCurves.sort((a, b) => a.startX - b.startX);
    const numConnections = Math.min(connections.length, bottomCurves.length, 10);
    const step = Math.max(1, Math.floor(bottomCurves.length / numConnections));
    
    // Filter out localhost connections (0.0.0.0, 127.0.0.1) - they're not interesting
    const interestingConnections = connections.filter(conn => {
        const local = conn.local_address || '';
        const remote = conn.remote_address || '';
        // Only show connections with remote addresses (active connections)
        if (!remote) return false;
        // Filter out localhost connections
        if (remote.startsWith('127.0.0.1:') || remote.startsWith('::1:')) {
            return false;
        }
        return true;
    });
    
    // If no interesting connections, don't show anything
    if (interestingConnections.length === 0) {
        debugLog(`ℹ️ No interesting connections to display for process ${pid}`);
        return;
    }
    
    const numInteresting = Math.min(interestingConnections.length, bottomCurves.length, 10);
    const stepConn = Math.max(1, Math.floor(bottomCurves.length / numInteresting));
    
    interestingConnections.slice(0, numInteresting).forEach((conn, i) => {
        if (i * stepConn < bottomCurves.length) {
            const curve = bottomCurves[i * stepConn];
            // Show remote address (more informative)
            let connLabel = conn.remote_address || `Connection ${i+1}`;
            // Extract IP and port for display
            const parts = connLabel.split(':');
            if (parts.length === 2) {
                const ip = parts[0];
                const port = parts[1];
                connLabel = `${ip}:${port}`;
            }
            
            const connGroup = svg.append("g")
                .attr("class", `process-file-${pid}`)
                .attr("data-pid", pid);
            
            const endpoint = connGroup.append("circle")
                .attr("cx", curve.startX)
                .attr("cy", curve.startY)
                .attr("r", 4)
                .attr("fill", "#4A90E2")
                .attr("stroke", "#fff")
                .attr("stroke-width", 1.5)
                .attr("opacity", 0.9);
            
            const pulse = () => {
                endpoint.transition()
                    .duration(1000)
                    .attr("r", 6)
                    .transition()
                    .duration(1000)
                    .attr("r", 4)
                    .on("end", pulse);
            };
            pulse();
            
            const label = connGroup.append("text")
                .attr("x", curve.startX)
                .attr("y", curve.startY + 20)
                .attr("text-anchor", "middle")
                .attr("font-size", "9px")
                .attr("fill", "#333")
                .text(connLabel);
            
            const bbox = label.node().getBBox();
            connGroup.insert("rect", "text")
                .attr("x", bbox.x - 3)
                .attr("y", bbox.y - 2)
                .attr("width", bbox.width + 6)
                .attr("height", bbox.height + 4)
                .attr("fill", "rgba(255,255,255,0.95)")
                .attr("stroke", "#4A90E2")
                .attr("stroke-width", 1)
                .attr("rx", 2);
            
            const curveElement = bezierCurves[curve.index];
            if (curveElement) {
                d3.select(curveElement)
                    .transition()
                    .duration(200)
                    .attr("stroke", "#4A90E2")
                    .attr("stroke-width", 1.5)
                    .attr("opacity", 0.6);
            }
        }
    });
}

// Hide process files
function hideProcessFilesOnCurves() {
    d3.selectAll('[class^="process-file-"]').remove();
    
    // Reset all curves to original style
    d3.selectAll('.bezier-curve')
        .transition()
        .duration(200)
        .attr("stroke", function() {
            return d3.select(this).attr("data-original-stroke") || "rgba(60, 60, 60, 0.3)";
        })
        .attr("stroke-width", function() {
            return d3.select(this).attr("data-original-stroke-width") || 0.8;
        })
        .attr("opacity", function() {
            return d3.select(this).attr("data-original-opacity") || 0.3;
        });
}

// Helper function for file type colors
function getFileTypeColor(type) {
    const colors = {
        'config': '#4A90E2',
        'log': '#E24A4A',
        'other': '#888'
    };
    return colors[type] || colors['other'];
}

window.ProcessFilesUI = {
    showProcessFilesOnCurves,
    showConnectionsOnCurves,
    hideProcessFilesOnCurves,
    getFileTypeColor
};
})();
