// Main JavaScript file for Linux Kernel Visualization
// Nginx Files Manager for Bezier Curves
class NginxFilesManager {
    constructor() {
        this.files = [];
        this.updateInterval = null;
    }

    // Initialize nginx files visualization
    init() {
        console.log("🔧 Initializing NginxFilesManager...");
        this.updateFiles();
        this.startAutoUpdate(10000);
    }

    // Update files data
    async updateFiles() {
        try {
            console.log("📁 Fetching nginx files...");
            const response = await fetch("/api/nginx-files");
            const data = await response.json();
            
            console.log("📁 Received nginx files:", data);
            
            if (data.files && data.files.length > 0) {
                this.files = data.files;
                console.log("🎨 Rendering files on curves...");
                this.renderFilesOnCurves();
            } else {
                console.log("⚠️ No nginx files found");
            }
        } catch (error) {
            console.error("Error fetching nginx files:", error);
        }
    }

    // Render file names at the end of Bezier curves
    renderFilesOnCurves() {
        console.log("🎨 Starting to render files on curves...");
        
        // Clear existing file labels
        d3.selectAll(".file-label").remove();
        d3.selectAll(".file-label-bg").remove();
        
        const width = window.innerWidth;
        const height = window.innerHeight;
        const centerX = width / 2;
        
        console.log("📐 Screen dimensions:", { width, height, centerX });
        
        // Calculate positions for file labels
        const labelPositions = this.calculateLabelPositions(this.files.length, centerX, height);
        
        console.log("📍 Label positions:", labelPositions);
        
        this.files.forEach((file, index) => {
            if (index < labelPositions.length) {
                const pos = labelPositions[index];
                const fileName = this.getShortFileName(file.path);
                
                console.log(`📄 Rendering file ${index}: ${fileName} at (${pos.x}, ${pos.y})`);
                
                // Create file label
                const label = svg.append("text")
                    .attr("x", pos.x)
                    .attr("y", pos.y)
                    .attr("class", "file-label")
                    .attr("text-anchor", "middle")
                    .attr("font-size", "11px")
                    .attr("fill", "#222")
                    .attr("opacity", 1)
                    .attr("transform", `rotate(90 ${pos.x} ${pos.y})`)
                    .text(fileName);
                
                
                // Add tooltip
                label.on("mouseover", () => this.showTooltip(file, pos.x, pos.y))
                     .on("mouseout", () => this.hideTooltip());
            }
        });
    }

    // Calculate positions for file labels
    calculateLabelPositions(numFiles, centerX, height) {
        const positions = [];
        const baseY = height - 160; // Синхронизируем с краем кривых Безье
        const spacing = 13; // Сокращаем расстояние между файлами на одну треть
        
        for (let i = 0; i < numFiles; i++) {
            const offset = (i - (numFiles - 1) / 2) * spacing;
            positions.push({
                x: centerX + 530 + offset, // Сдвигаем файлы вправо на 80px
                y: baseY + 20 // Опускаем файлы на 20px ниже
            });
        }
        
        return positions;
    }

    // Get short file name for display
    getShortFileName(fullPath) {
        const parts = fullPath.split("/");
        if (parts.length <= 2) {
            return fullPath;
        }
        
        const lastTwo = parts.slice(-2);
        return lastTwo.join("/");
    }

    // Show tooltip with file information
    showTooltip(file, x, y) {
        const tooltip = d3.select("body")
            .append("div")
            .attr("class", "tooltip")
            .style("position", "absolute")
            .style("background", "rgba(0,0,0,0.9)")
            .style("color", "white")
            .style("padding", "8px")
            .style("border-radius", "4px")
            .style("font-size", "12px")
            .style("pointer-events", "none")
            .style("z-index", "1000")
            .style("max-width", "300px");

        tooltip.html(`
            <strong>Nginx Process</strong> (PID: ${file.pid})<br>
            <strong>File:</strong> ${file.path}<br>
            <strong>FD:</strong> ${file.fd}
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
    startAutoUpdate(intervalMs = 10000) {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        this.updateInterval = setInterval(() => {
            this.updateFiles();
        }, intervalMs);
    }

    // Stop auto update
    stopAutoUpdate() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    // Cleanup
    destroy() {
        this.stopAutoUpdate();
        d3.selectAll('.file-label').remove();
        d3.selectAll('.file-label-bg').remove();
        d3.selectAll('.tooltip').remove();
    }
}
// Global variables
const svg = d3.select("svg");
let syscallsManager;
let resizeTimeout;
let nginxFilesManager;
let rightSemicircleMenuManager;

// Application initialization
function initApp() {
    console.log('🚀 Initializing Linux Kernel Visualization');
    
    // Initialize system calls manager
    syscallsManager = new SyscallsManager();
    
    // Initialize active connections manager
    const connectionsManager = new ActiveConnectionsManager();
    connectionsManager.startAutoUpdate(3000);
    
    window.nginxFilesManager = new NginxFilesManager();
    
    // Initialize right semicircle menu manager
    console.log('🎯 RightSemicircleMenuManager class available:', typeof RightSemicircleMenuManager);
    if (typeof RightSemicircleMenuManager !== 'undefined') {
        window.rightSemicircleMenuManager = new RightSemicircleMenuManager();
        console.log('🎯 RightSemicircleMenuManager initialized:', window.rightSemicircleMenuManager);
    } else {
        console.error('❌ RightSemicircleMenuManager class not found!');
    }
    
    // Draw main interface FIRST
    draw();
    
    // Then render semicircle AFTER draw() completes
    setTimeout(() => {
        if (window.rightSemicircleMenuManager) {
            console.log('🎯 Force rendering semicircle after draw()...');
            window.rightSemicircleMenuManager.renderRightSemicircleMenu();
        }
    }, 100);
    
    // Start updates
    syscallsManager.startAutoUpdate(3000);
    
    // Update panel data periodically
    updatePanelData();
    setInterval(updatePanelData, 5000); // Update every 5 seconds
    
    // Setup event handlers
    setupEventListeners();
}

// Setup event handlers
function setupEventListeners() {
    // Window resize handler
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            draw();
            // Render semicircle after draw() completes
            setTimeout(() => {
                if (window.rightSemicircleMenuManager) {
                    console.log('🎯 Force rendering semicircle after resize...');
                    window.rightSemicircleMenuManager.renderRightSemicircleMenu();
                }
            }, 50);
        }, 100);
    });

    // Cleanup on page close
    window.addEventListener('beforeunload', () => {
        if (syscallsManager) {
            syscallsManager.stopAutoUpdate();
        }
        if (connectionsManager) {
            connectionsManager.stopAutoUpdate();
        }
    });
}

// Main drawing function
function draw() {
    // Clear all elements to prevent duplication
    svg.selectAll("*").remove();

    const width = window.innerWidth;
    const height = window.innerHeight;
    const centerX = width / 2;
    const centerY = height / 2;

    // Define gradients for depth
    const defs = svg.append("defs");
    
    // Radial gradient for central circle
    const centralGradient = defs.append("radialGradient")
        .attr("id", "centralGradient")
        .attr("cx", "50%")
        .attr("cy", "50%")
        .attr("r", "50%");
    
    centralGradient.append("stop")
        .attr("offset", "0%")
        .attr("stop-color", "#444");
    
    centralGradient.append("stop")
        .attr("offset", "100%")
        .attr("stop-color", "#111");

    // Linear gradient for process lines
    const lineGradient = defs.append("linearGradient")
        .attr("id", "lineGradient")
        .attr("x1", "0%")
        .attr("y1", "0%")
        .attr("x2", "100%")
        .attr("y2", "100%");
    
    lineGradient.append("stop")
        .attr("offset", "0%")
        .attr("stop-color", "#333")
        .attr("stop-opacity", 0.8);
    
    lineGradient.append("stop")
        .attr("offset", "100%")
        .attr("stop-color", "#111")
        .attr("stop-opacity", 0.1);

    // Draw central circle
    drawCentralCircle(centerX, centerY);
    
    // Draw tag icons
    drawTagIcons(centerX, centerY);
    
    // Draw panels
    drawPanels(width, height);
    
    // Draw social media icons
    drawSocialIcons(width, height);
    
    // Restore system calls
    if (syscallsManager) {
        syscallsManager.restoreState();
    }

    // Load processes and kernel subsystems
    loadProcessKernelMap(centerX, centerY);
    
    // Draw additional process lines
    drawProcessKernelMap2(centerX, centerY);
    
    // Draw curves at bottom
    drawLowerBezierGrid();
    
    // Render right semicircle menu (after all other elements)
    if (window.rightSemicircleMenuManager) {
        window.rightSemicircleMenuManager.renderRightSemicircleMenu();
    }
}

// Draw central circle
function drawCentralCircle(centerX, centerY) {
    svg.append("circle")
        .attr("cx", centerX)
        .attr("cy", centerY)
        .attr("r", 55)
        .attr("class", "central-circle")
        .attr("fill", "url(#centralGradient)");

    svg.append("image")
        .attr("xlink:href", "static/images/009.png")
        .attr("x", centerX - 30)
        .attr("y", centerY - 30)
        .attr("width", 60)
        .attr("height", 60);
}

// Draw tag icons
function drawTagIcons(centerX, centerY) {
    const tagIconUrl = 'static/images/Icon1.png';
    const numTags = 8;
    const radius = 160;
    const angleStep = (2 * Math.PI) / numTags;

    for (let i = 0; i < numTags; i++) {
        const angle = i * angleStep;
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);
        const rotationAngle = angle * (180 / Math.PI) + 90;

        svg.append("image")
            .attr("xlink:href", tagIconUrl)
            .attr("x", x - 20)
            .attr("y", y - 20)
            .attr("width", 40)
            .attr("height", 40)
            .attr("class", "tag-icon")
            .attr("transform", `rotate(${rotationAngle}, ${x}, ${y})`);

        svg.append("line")
            .attr("x1", centerX)
            .attr("y1", centerY)
            .attr("x2", x)
            .attr("y2", y)
            .attr("class", "connection-line");
    }
}

// Draw panels
function drawPanels(width, height) {
    // Left panel
    svg.append("rect")
        .attr("x", 20)
        .attr("y", 20)
        .attr("width", 250)
        .attr("height", 330)
        .attr("class", "feature-panel");

    // Right panel
    svg.append("rect")
        .attr("x", width - 180)
        .attr("y", 20)
        .attr("width", 150)
        .attr("height", 100)
        .attr("class", "feature-panel");

    // Text in right panel - will be updated with real data
    const panelData = [
        {label: "Protection ring", value: "Ring 0"},
        {label: "Kernel", value: "Active"},
        {label: "Processes", value: "Loading..."},
        {label: "Memory", value: "Loading..."}
    ];
    
    panelData.forEach((item, i) => {
        const textGroup = svg.append("g")
            .attr("class", `panel-item-${i}`);
        
        textGroup.append("text")
            .attr("x", width - 170)
            .attr("y", 45 + i * 22)
            .text(item.label + ":")
            .attr("class", "feature-text");
        
        textGroup.append("text")
            .attr("x", width - 50)
            .attr("y", 45 + i * 22)
            .text(item.value)
            .attr("class", "feature-text")
            .attr("id", `panel-value-${i}`)
            .attr("font-weight", "bold");
    });
    
    // Update panel with real data
    updatePanelData();
}

// Load processes and kernel subsystems
function loadProcessKernelMap(centerX, centerY) {
    fetch('/api/process-kernel-map')
        .then(res => res.json())
        .then(data => {
            drawProcessKernelMap(data, centerX, centerY);
        })
        .catch(error => {
            console.error('Error fetching process-kernel-map:', error);
        });
}

// Draw processes and kernel subsystems
function drawProcessKernelMap(data, centerX, centerY) {
    const entries = Object.entries(data);
    const numProcesses = entries.length;

    entries.forEach(([name, kernel_files], i) => {
        const angle = i * 2 * Math.PI / numProcesses;
        const px = centerX + 200 * Math.cos(angle);
        const py = centerY + 200 * Math.sin(angle);

        // Curve to process
        const cx1 = centerX + (px - centerX) * 0.3 + (Math.random() - 0.5) * 40;
        const cy1 = centerY + (py - centerY) * 0.3 + (Math.random() - 0.5) * 40;
        const cx2 = centerX + (px - centerX) * 0.7 + (Math.random() - 0.5) * 40;
        const cy2 = centerY + (py - centerY) * 0.7 + (Math.random() - 0.5) * 40;

        const path = `M${centerX},${centerY} C${cx1},${cy1} ${cx2},${cy2} ${px},${py}`;

        // Draw main process line with animation
        const mainLine = svg.append("path")
            .attr("d", path)
            .attr("class", "curve-path")
            .attr("stroke", "url(#lineGradient)") // Use gradient for depth
            .attr("opacity", 0) // Start invisible
            .attr("stroke-dasharray", function() {
                const length = this.getTotalLength();
                return length + " " + length;
            })
            .attr("stroke-dashoffset", function() {
                return this.getTotalLength();
            });

        // Animate main line appearance
        mainLine.transition()
            .duration(400 + Math.random() * 200) // Random duration 400-600ms
            .delay(i * 30) // Staggered animation
            .attr("opacity", 1 + Math.random() * 0.07)
            .attr("stroke-dashoffset", 0);

        // Process circle with animation
        const processCircle = svg.append("circle")
            .attr("cx", px)
            .attr("cy", py)
            .attr("r", 0) // Start with radius 0
            .attr("class", "node-circle")
            .attr("opacity", 0); // Start invisible

        // Animate process circle appearance
        processCircle.transition()
            .duration(200)
            .delay(i * 30 + 300) // Appear after line animation
            .attr("r", 4)
            .attr("opacity", 1);

        // Process name with animation
        const processText = svg.append("text")
            .attr("x", px)
            .attr("y", py - 12)
            .attr("text-anchor", "middle")
            .attr("font-size", 11)
            .attr("fill", "#222")
            .attr("opacity", 0) // Start invisible
            .text(name);

        // Animate process text appearance
        processText.transition()
            .duration(150)
            .delay(i * 30 + 500) // Appear after circle animation
            .attr("opacity", 1);

        // Kernel subsystems
        kernel_files.forEach((subsystem, j) => {
            const subAngle = angle + (j - kernel_files.length/2 + 0.5) * 0.3;
            const subX = px + 25 * Math.cos(subAngle);
            const subY = py + 25 * Math.sin(subAngle);

            svg.append("circle")
                .attr("cx", subX)
                .attr("cy", subY)
                .attr("r", 3)
                .attr("fill", "#888")
                .attr("stroke", "#555")
                .attr("stroke-width", 0.5);

            svg.append("line")
                .attr("x1", px)
                .attr("y1", py)
                .attr("x2", subX)
                .attr("y2", subY)
                .attr("stroke", "rgba(100, 100, 100, 0.3)")
                .attr("stroke-width", 0.5);
        });
    });
}

// Draw additional process lines (without circles and names)
function drawProcessKernelMap2(centerX, centerY) {
    // Fetch all Linux processes
    fetch('/api/processes')
        .then(res => res.json())
        .then(data => {
            const processes = data.processes || [];
            const numProcesses = processes.length;

            // Find min and max memory usage for scaling
            const memoryValues = processes.map(p => p.memory_mb || 0);
            const minMemory = Math.min(...memoryValues);
            const maxMemory = Math.max(...memoryValues);
            const memoryRange = maxMemory - minMemory;

            processes.forEach((process, i) => {
                const angle = i * 2 * Math.PI / numProcesses;
                
                // Calculate line length based on memory usage
                const memoryMb = process.memory_mb || 0;
                const memoryRatio = memoryRange > 0 ? (memoryMb - minMemory) / memoryRange : 0;
                
                // Base distance: 250px (original), max additional: 100px based on memory
                const baseDistance = 250;
                const maxAdditionalDistance = 100;
                const distance = baseDistance + (memoryRatio * maxAdditionalDistance);
                
                const px = centerX + distance * Math.cos(angle);
                const py = centerY + distance * Math.sin(angle);

                // Curve to process (same style as original)
                const cx1 = centerX + (px - centerX) * 0.3 + (Math.random() - 0.5) * 40;
                const cy1 = centerY + (py - centerY) * 0.3 + (Math.random() - 0.5) * 40;
                const cx2 = centerX + (px - centerX) * 0.7 + (Math.random() - 0.5) * 40;
                const cy2 = centerY + (py - centerY) * 0.7 + (Math.random() - 0.5) * 40;

                const path = `M${centerX},${centerY} C${cx1},${cy1} ${cx2},${cy2} ${px},${py}`;

                // Draw the line with animation
                const line = svg.append("path")
                    .attr("d", path)
                    .attr("class", "process-line")
                    .attr("stroke", "url(#lineGradient)") // Use gradient for depth
                    .attr("stroke-width", 0.4) // Same thickness as Bezier curves
                    .attr("opacity", 0) // Start invisible
                    .attr("fill", "none")
                    .attr("stroke-dasharray", function() {
                        const length = this.getTotalLength();
                        return length + " " + length;
                    })
                    .attr("stroke-dashoffset", function() {
                        return this.getTotalLength();
                    });

                // Animate line appearance
                line.transition()
                    .duration(300 + Math.random() * 200) // Random duration 300-500ms
                    .delay(i * 20) // Staggered animation
                    .attr("opacity", 0.05 + Math.random() * 0.03)
                    .attr("stroke-dashoffset", 0);

                // Keep original gray color scheme
                const circleRadius = 1; // Original size
                
                // Add gray circle at the end of the line with animation
                const circle = svg.append("circle")
                    .attr("cx", px)
                    .attr("cy", py)
                    .attr("r", 0) // Start with radius 0
                    .attr("fill", "#888")
                    .attr("stroke", "#555")
                    .attr("stroke-width", 0.5)
                    .attr("opacity", 0)
                    .attr("class", "process-node")
                    .style("cursor", "pointer")
                    .datum(process); // Store process data

                // Animate circle appearance
                circle.transition()
                    .duration(150)
                    .delay(i * 20 + 250) // Appear after line animation
                    .attr("r", circleRadius)
                    .attr("opacity", 1);
                
                // Add tooltip on hover
                circle.on("mouseover", function(event, d) {
                    const tooltip = d3.select("body")
                        .append("div")
                        .attr("class", "tooltip")
                        .style("position", "absolute")
                        .style("background", "rgba(0, 0, 0, 0.9)")
                        .style("color", "white")
                        .style("padding", "10px")
                        .style("border-radius", "4px")
                        .style("font-size", "12px")
                        .style("font-family", "Share Tech Mono, monospace")
                        .style("pointer-events", "none")
                        .style("z-index", "1000")
                        .style("opacity", 0);
                    
                    tooltip.html(`
                        <strong>Process:</strong> ${d.name}<br>
                        <strong>PID:</strong> ${d.pid}<br>
                        <strong>Memory:</strong> ${d.memory_mb} MB<br>
                        <strong>Status:</strong> ${d.status}
                    `);
                    
                    tooltip.transition()
                        .duration(200)
                        .style("opacity", 1);
                    
                    // Update tooltip position on mouse move
                    d3.select("svg").on("mousemove", function() {
                        tooltip
                            .style("left", (event.pageX + 10) + "px")
                            .style("top", (event.pageY - 10) + "px");
                    });
                })
                .on("mouseout", function() {
                    d3.selectAll(".tooltip").remove();
                    d3.select("svg").on("mousemove", null);
                });
            });
        })
        .catch(error => {
            console.error('Error fetching processes:', error);
        });
}

// Draw curves at bottom
function drawLowerBezierGrid(num = 90) {
    const width = window.innerWidth;
    console.log("🔧 drawLowerBezierGrid called");
    console.log("🔧 window.nginxFilesManager:", typeof window.nginxFilesManager);
    // Initialize nginx files manager
    if (window.nginxFilesManager) {
        window.nginxFilesManager.init();
    }
    const height = window.innerHeight;
    const yBase = height - 200;

    for (let i = 0; i < num; i++) {
        const fromLeft = i < num / 2;

        const startX = fromLeft
            ? 300 + Math.random() * 100
            : width - 300 - Math.random() * 100;

        const endX = width / 2 + (Math.random() - 0.5) * 200;
        const endY = height - 160 - Math.random() * 40; // КРАЙ кривых Безье - здесь заканчиваются кривые

        const controlX1 = startX + (fromLeft ? 150 : -150) + (Math.random() - 0.5) * 80;
        const controlY1 = yBase - 60 - Math.random() * 40;

        const controlX2 = endX + (Math.random() - 0.5) * 60;
        const controlY2 = endY + 40 + Math.random() * 220;

        const path = `M${startX},${yBase} C${controlX1},${controlY1} ${controlX2},${controlY2} ${endX},${endY}`;

        // Draw Bezier curve with same parameters as connection lines
        const bezierCurve = svg.append("path")
            .attr("d", path)
            .attr("class", "bezier-curve")
            .attr("stroke", "rgba(60, 60, 60, 0.3)") // Same color as connection lines
            .attr("stroke-width", 0.8) // Same thickness as connection lines
            .attr("opacity", 0) // Start invisible
            .attr("fill", "none")
            .attr("stroke-dasharray", function() {
                const length = this.getTotalLength();
                return length + " " + length;
            })
            .attr("stroke-dashoffset", function() {
                return this.getTotalLength();
            });

        // Animate Bezier curve appearance
        bezierCurve.transition()
            .duration(400 + Math.random() * 300) // Random duration 400-700ms
            .delay(i * 10) // Staggered animation
            .attr("opacity", 0.3) // Same opacity as connection lines
            .attr("stroke-dashoffset", 0);
    }
}

// Update panel with real data from API
function updatePanelData() {
    fetch('/api/kernel-data')
        .then(res => res.json())
        .then(data => {
            // Update processes count
            const processesText = d3.select('#panel-value-2');
            if (!processesText.empty() && data.processes) {
                processesText.text(data.processes);
            }
            
            // Update memory usage
            const memoryText = d3.select('#panel-value-3');
            if (!memoryText.empty() && data.system_stats) {
                const memPercent = Math.round(data.system_stats.memory_total / (1024 * 1024 * 1024)); // GB
                memoryText.text(`${memPercent} GB`);
            }
            
            // Update subsystems visualization if available
            if (data.subsystems) {
                updateSubsystemsVisualization(data.subsystems);
            }
        })
        .catch(error => {
            console.error('Error updating panel data:', error);
        });
}

// Update subsystems visualization with color coding
function updateSubsystemsVisualization(subsystems) {
    const svg = d3.select('svg');
    const width = window.innerWidth;
    
    // Remove old subsystem indicators
    svg.selectAll('.subsystem-indicator').remove();
    
    // Draw subsystem indicators in left panel
    const subsystemNames = ['memory_management', 'process_scheduler', 'file_system', 'network_stack'];
    const subsystemLabels = {
        'memory_management': 'Memory',
        'process_scheduler': 'Scheduler',
        'file_system': 'File System',
        'network_stack': 'Network'
    };
    
    subsystemNames.forEach((name, i) => {
        const subsystem = subsystems[name];
        if (!subsystem) return;
        
        const usage = subsystem.usage || 0;
        const processes = subsystem.processes || 0;
        
        // Keep original gray color scheme
        const x = 30;
        const y = 380 + i * 25;
        const barWidth = 200;
        const barHeight = 15;
        
        // Background bar
        svg.append("rect")
            .attr("x", x)
            .attr("y", y)
            .attr("width", barWidth)
            .attr("height", barHeight)
            .attr("fill", "rgba(200, 200, 200, 0.2)")
            .attr("stroke", "#aaa")
            .attr("stroke-width", 0.5)
            .attr("class", "subsystem-indicator");
        
        // Usage bar - gray color scheme
        svg.append("rect")
            .attr("x", x)
            .attr("y", y)
            .attr("width", (usage / 100) * barWidth)
            .attr("height", barHeight)
            .attr("fill", "#888")
            .attr("opacity", 0.7)
            .attr("class", "subsystem-indicator");
        
        // Label
        svg.append("text")
            .attr("x", x + 5)
            .attr("y", y + 11)
            .text(subsystemLabels[name] || name)
            .attr("class", "feature-text subsystem-indicator")
            .attr("font-size", "10px")
            .attr("fill", "#222");
        
        // Usage percentage
        svg.append("text")
            .attr("x", x + barWidth - 5)
            .attr("y", y + 11)
            .text(`${usage}%`)
            .attr("class", "feature-text subsystem-indicator")
            .attr("font-size", "10px")
            .attr("text-anchor", "end")
            .attr("fill", "#222");
    });
}

// Draw social media icons
function drawSocialIcons(width, height) {
    // Twitter icon in bottom left corner
    const twitterX = 30;
    const twitterY = height - 30;
    const iconSize = 20;
    
    // Create Twitter icon group
    const twitterGroup = svg.append("g")
        .attr("class", "social-icon")
        .attr("transform", `translate(${twitterX}, ${twitterY})`)
        .style("cursor", "pointer")
        .on("click", () => {
            window.open("https://x.com/_telesis", "_blank");
        })
        .on("mouseenter", function() {
            d3.select(this).select("path").transition().duration(200).attr("fill", "#1DA1F2");
        })
        .on("mouseleave", function() {
            d3.select(this).select("path").transition().duration(200).attr("fill", "#666");
        });
    
    // Twitter bird icon (simplified SVG path)
    twitterGroup.append("path")
        .attr("d", "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.114zm-1.161 17.52h1.833L7.084 4.126H5.117z")
        .attr("fill", "#666")
        .attr("stroke", "none");
    
    // Add subtle background circle
    twitterGroup.insert("circle", "path")
        .attr("cx", 0)
        .attr("cy", 0)
        .attr("r", iconSize/2 + 2)
        .attr("fill", "rgba(255, 255, 255, 0.1)")
        .attr("stroke", "rgba(102, 102, 102, 0.3)")
        .attr("stroke-width", "0.5");
}

// Start application after DOM load
document.addEventListener('DOMContentLoaded', initApp);
