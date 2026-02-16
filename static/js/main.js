// Main JavaScript file for Linux Kernel Visualization
// NginxFilesManager is now in nginx_files.js

// Global variables
const svg = d3.select("svg");
let syscallsManager;
let resizeTimeout;
let nginxFilesManager;
let rightSemicircleMenuManager;
let connectionsManager; // make available for cleanup handlers
let isolationContextCache = null;
let isolationContextCacheTs = 0;
let isolationRenderToken = 0;
const lowerFlowTypes = [
    { id: "disk-io", label: "DISK I/O", stroke: "rgba(58, 58, 58, 0.33)", widthMin: 0.8, widthMax: 1.15, opacityMin: 0.6, opacityMax: 0.85, weight: 0.34 },
    { id: "network-packets", label: "NETWORK PACKETS", stroke: "rgba(88, 182, 216, 0.28)", widthMin: 0.75, widthMax: 1.05, opacityMin: 0.58, opacityMax: 0.8, weight: 0.28 },
    { id: "page-faults", label: "PAGE FAULTS", stroke: "rgba(95, 95, 95, 0.28)", widthMin: 0.75, widthMax: 1.0, opacityMin: 0.55, opacityMax: 0.78, weight: 0.24 },
    { id: "memory-swaps", label: "MEMORY SWAPS", stroke: "rgba(126, 110, 170, 0.25)", widthMin: 0.7, widthMax: 0.95, opacityMin: 0.5, opacityMax: 0.72, weight: 0.14 }
];

// Application initialization
function initApp() {
    console.log('🚀 Initializing Linux Kernel Visualization');
    
    // Initialize system calls manager
    syscallsManager = new SyscallsManager();
    
    // Initialize active connections manager (store in global for cleanup)
    connectionsManager = new ActiveConnectionsManager();
    connectionsManager.startAutoUpdate(3000);
    // Expose to window so KernelContextMenu can pause/resume updates
    window.connectionsManager = connectionsManager;
    
    window.nginxFilesManager = new NginxFilesManager();
    
    // Initialize right semicircle menu manager
    console.log('🎯 RightSemicircleMenuManager class available:', typeof RightSemicircleMenuManager);
    if (typeof RightSemicircleMenuManager !== 'undefined') {
        window.rightSemicircleMenuManager = new RightSemicircleMenuManager();
        console.log('🎯 RightSemicircleMenuManager initialized:', window.rightSemicircleMenuManager);
    } else {
        console.error('❌ RightSemicircleMenuManager class not found!');
    }
    
    // Initialize Kernel Context Menu
    console.log('🎯 KernelContextMenu class available:', typeof KernelContextMenu);
    if (typeof KernelContextMenu !== 'undefined') {
        window.kernelContextMenu = new KernelContextMenu();
        window.kernelContextMenu.init();
        console.log('🎯 KernelContextMenu initialized:', window.kernelContextMenu);
    } else {
        console.error('❌ KernelContextMenu class not found!');
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
    // Skip drawing if Matrix View is active to prevent elements from appearing above it
    if (window.kernelContextMenu && window.kernelContextMenu.currentView === 'matrix') {
        console.log('⏸️ Skipping draw() - Matrix View is active');
        return;
    }
    
    // Skip drawing if Kernel DNA View is active to prevent style changes to process lines
    if (window.kernelContextMenu && (
        window.kernelContextMenu.currentView === 'dna' ||
        window.kernelContextMenu.currentView === 'dna-timeline' ||
        window.kernelContextMenu.currentView === 'network' ||
        window.kernelContextMenu.currentView === 'devices'
    )) {
        console.log('⏸️ Skipping draw() - overlay view is active');
        return;
    }
    
    // Clear all elements to prevent duplication, but preserve system calls
    // and Kernel analysis overlay (Matrix / Timeline submenu & elements)
    const preserveClasses = '.syscall-box, .syscall-text, .matrix-view-item, .matrix-header, .matrix-panel-bg, .matrix-backdrop, .kernel-exit-button, .kernel-dna-exit-button, .kernel-submenu';
    svg.selectAll(`*:not(${preserveClasses.split(', ').join('):not(')})`).remove();
    // Also remove system calls explicitly to ensure clean state
    svg.selectAll(".syscall-box, .syscall-text").remove();

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
    
    // Draw Ring-1 Execution Context
    drawRing1(centerX, centerY);
    
    // Draw tag icons
    drawTagIcons(centerX, centerY);
    
    // Draw panels
    drawPanels(width, height);
    
    // Draw social media icons
    drawSocialIcons(width, height);
    
    // Restore system calls - ensure they are re-rendered after draw() completes
    // Use setTimeout to ensure this happens after all other rendering
    // But skip if Matrix View is active
    setTimeout(() => {
        if (syscallsManager && (!window.kernelContextMenu || window.kernelContextMenu.currentView !== 'matrix')) {
            // Force update to ensure system calls are displayed
            syscallsManager.updateSyscallsTable();
        }
    }, 100);

    // Load processes and kernel subsystems
    loadProcessKernelMap(centerX, centerY);
    
    // Draw additional process lines
    drawProcessKernelMap2(centerX, centerY);
    
    // Draw curves at bottom
    drawLowerBezierGrid();

    // Draw namespaces + cgroups concept overlays
    drawIsolationConceptLayer(centerX, centerY, width, height);
    
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

// Ring-1 update interval (global to prevent multiple intervals)
let ring1UpdateInterval = null;

// Draw Ring-1 Execution Context
function drawRing1(centerX, centerY) {
    const ring1Radius = 85; // Between Ring-0 (55px) and tag icons (160px)
    const ring1StrokeWidth = 6; // Increased width for better visibility
    
    // Clear existing interval if any
    if (ring1UpdateInterval) {
        clearInterval(ring1UpdateInterval);
        ring1UpdateInterval = null;
    }
    
    // Create Ring-1 group
    const ring1Group = svg.append("g")
        .attr("class", "ring1-execution-context")
        .attr("id", "ring1-group");
    
    // Base ring (will be updated with data) - make it wider and more visible
    const ring1 = ring1Group.append("circle")
        .attr("cx", centerX)
        .attr("cy", centerY)
        .attr("r", ring1Radius)
        .attr("class", "ring1-circle")
        .attr("fill", "none")
        .attr("stroke", "#888")
        .attr("stroke-width", ring1StrokeWidth)
        .attr("opacity", 0.9)
        .style("filter", "drop-shadow(0 0 3px rgba(0,0,0,0.3))");
    
    // Start updating Ring-1 with real data immediately
    updateRing1(centerX, centerY, ring1Radius);
    
    // Update every 1000ms for debugging (was 150ms) - can be reduced later
    if (!ring1UpdateInterval) {
        ring1UpdateInterval = setInterval(() => {
            updateRing1(centerX, centerY, ring1Radius);
        }, 1000); // 1 second for debugging
    }
}

// Update Ring-1 with execution context data
function updateRing1(centerX, centerY, baseRadius) {
    // Use relative path like other API calls
    fetch('/api/execution-context')
        .then(res => res.json())
        .then(data => {
            // Debug logging
            console.log('🔄 Ring-1 Update:', {
                mode: data.mode,
                cpu_state: data.cpu_state,
                syscall_active: data.syscall_active,
                syscall_name: data.syscall_name,
                interrupts_count: data.interrupts ? data.interrupts.length : 0,
                preempted: data.preempted
            });
            
            const ring1Group = d3.select("#ring1-group");
            let ring1 = ring1Group.select(".ring1-circle");
            
            if (ring1.empty()) {
                console.warn('⚠️ Ring-1 circle not found!');
                return; // Ring not created yet
            }
            
            // Determine color based on mode
            // Always use gray color for the ring
            let ringColor = "#888"; // Default gray
            
            // Calculate pulse amplitude and speed based on state
            let pulseAmplitude = 3; // Default subtle pulse
            let pulseSpeed = 300; // Default pulse speed (ms)
            let strokeWidth = 6; // Default stroke width
            
            // Handle syscall active - stronger pulsing animation
            if (data.syscall_active) {
                console.log('✨ Syscall active:', data.syscall_name);
                ringColor = "#888"; // Gray for syscall (changed from gold)
                pulseAmplitude = 8; // Stronger pulse for syscall
                pulseSpeed = 200; // Faster pulse for syscall
                strokeWidth = 8; // Wider when pulsing
                
                // Add text label for syscall name
                let syscallLabel = ring1Group.select(".syscall-label");
                if (syscallLabel.empty()) {
                    syscallLabel = ring1Group.append("text")
                        .attr("class", "syscall-label")
                        .attr("x", centerX)
                        .attr("y", centerY - baseRadius - 20)
                        .attr("text-anchor", "middle")
                        .attr("font-size", "11px")
                        .attr("fill", "#000000") // Black font
                        .attr("font-family", "Share Tech Mono, monospace")
                        .attr("font-weight", "bold")
                        .style("opacity", 0);
                }
                syscallLabel
                    .text(data.syscall_name || "SYSCALL")
                    .transition()
                    .duration(200)
                    .style("opacity", 0.9);
            } else {
                // Normal state - subtle pulsing
                console.log('📊 Normal state, color:', ringColor, 'CPU state:', data.cpu_state);
                
                // Adjust pulse based on CPU state
                if (data.cpu_state === 'running') {
                    pulseAmplitude = 4; // More visible pulse when running
                    pulseSpeed = 400; // Moderate speed
                } else if (data.cpu_state === 'idle') {
                    pulseAmplitude = 2; // Subtle pulse when idle
                    pulseSpeed = 600; // Slower pulse when idle
                } else {
                    pulseAmplitude = 3; // Default pulse
                    pulseSpeed = 500; // Default speed
                }
                
                // Hide syscall label
                ring1Group.select(".syscall-label")
                    .transition()
                    .duration(200)
                    .style("opacity", 0);
            }
            
            // Apply pulsing animation - always animate radius
            const currentTime = Date.now();
            const pulseRadius = baseRadius + pulseAmplitude * Math.sin(currentTime / pulseSpeed);
            
            ring1.transition()
                .duration(100) // Smooth continuous animation
                .ease(d3.easeLinear)
                .attr("r", pulseRadius)
                .attr("stroke", ringColor)
                .attr("stroke-width", strokeWidth)
                .attr("opacity", data.cpu_state === 'idle' ? 0.5 : 0.9)
                .style("filter", data.syscall_active 
                    ? "drop-shadow(0 0 8px rgba(136,136,136,0.8))" 
                    : (data.cpu_state === 'idle' ? "none" : "drop-shadow(0 0 3px rgba(0,0,0,0.3))"));
            
            // Handle CPU state - dotted for idle, solid for running
            if (data.cpu_state === 'idle') {
                ring1.attr("stroke-dasharray", "8,4"); // More visible dashes
            } else if (data.cpu_state === 'sleeping') {
                ring1.attr("stroke-dasharray", "4,8"); // Longer gaps
            } else {
                ring1.attr("stroke-dasharray", "none"); // Solid for running
            }
            
            // Add mode label (User/Kernel)
            let modeLabel = ring1Group.select(".mode-label");
            if (modeLabel.empty()) {
                modeLabel = ring1Group.append("text")
                    .attr("class", "mode-label")
                    .attr("x", centerX)
                    .attr("y", centerY + baseRadius + 20)
                    .attr("text-anchor", "middle")
                    .attr("font-size", "10px")
                    .attr("fill", ringColor)
                    .attr("font-family", "Share Tech Mono, monospace")
                    .style("opacity", 0);
            }
            // Always show "KERNEL MODE" label
            const modeText = 'KERNEL MODE';
            modeLabel
                .text(modeText)
                .attr("fill", ringColor)
                .transition()
                .duration(300)
                .style("opacity", 0.7);
            
            // Clear old syscall labels before creating new ones
            svg.selectAll('.syscall-label-process').remove();
            
            // NOTE: Syscall labels on process lines are temporarily hidden
            // (previously showed syscall names where gold IRQ flashes were)
            
            // Handle preempted - show red segment
            if (data.preempted && data.preempted_pid) {
                // Create arc for preempted segment
                let preemptedArc = ring1Group.select(".preempted-segment");
                if (preemptedArc.empty()) {
                    const arc = d3.arc()
                        .innerRadius(baseRadius - 1)
                        .outerRadius(baseRadius + 1)
                        .startAngle(0)
                        .endAngle(Math.PI / 4); // 45 degree segment
                    
                    preemptedArc = ring1Group.append("path")
                        .attr("class", "preempted-segment")
                        .attr("d", arc)
                        .attr("transform", `translate(${centerX}, ${centerY})`)
                        .attr("fill", "#FF6B6B")
                        .attr("opacity", 0);
                }
                
                preemptedArc.transition()
                    .duration(200)
                    .attr("opacity", 0.8);
            } else {
                // Hide preempted segment
                ring1Group.select(".preempted-segment")
                    .transition()
                    .duration(200)
                    .attr("opacity", 0);
            }
        })
        .catch(error => {
            console.error('Error fetching execution context:', error);
        });
}

// Helper function to get point on SVG path at specific distance from start
function getPointOnPathAtDistance(pathData, targetDistance, centerX, centerY) {
    try {
        // Parse path to get end point (process position)
        // Try Bezier curve format: Mx,y Cx1,y1 x2,y2 x,y
        const pathMatch = pathData.match(/M([\d.]+),([\d.]+)\s+C[\d.]+,[\d.]+\s+[\d.]+,[\d.]+\s+([\d.]+),([\d.]+)/);
        if (pathMatch) {
            const startX = parseFloat(pathMatch[1]);
            const startY = parseFloat(pathMatch[2]);
            const endX = parseFloat(pathMatch[3]);
            const endY = parseFloat(pathMatch[4]);
            
            // Calculate direction vector from center to process
            const dx = endX - startX;
            const dy = endY - startY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance > 0) {
                // Calculate point at targetDistance along the line
                const ratio = targetDistance / distance;
                return {
                    x: startX + dx * ratio,
                    y: startY + dy * ratio
                };
            }
        }
        
        // Try straight line format: Lx,y or Mx,y Lx,y
        const lineMatch = pathData.match(/[ML]([\d.]+),([\d.]+)/g);
        if (lineMatch && lineMatch.length >= 2) {
            const start = lineMatch[0].match(/[ML]([\d.]+),([\d.]+)/);
            const end = lineMatch[lineMatch.length - 1].match(/[ML]([\d.]+),([\d.]+)/);
            if (start && end) {
                const startX = parseFloat(start[1]);
                const startY = parseFloat(start[2]);
                const endX = parseFloat(end[1]);
                const endY = parseFloat(end[2]);
                
                const dx = endX - startX;
                const dy = endY - startY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance > 0) {
                    const ratio = targetDistance / distance;
                    return {
                        x: startX + dx * ratio,
                        y: startY + dy * ratio
                    };
                }
            }
        }
        
        return null;
    } catch (error) {
        console.error('Error calculating point on path:', error);
        return null;
    }
}

// Draw tag icons
function drawTagIcons(centerX, centerY) {
    // Skip drawing tag icons if Matrix View is active
    if (window.kernelContextMenu && window.kernelContextMenu.currentView === 'matrix') {
        console.log('⏸️ Skipping tag icons render - Matrix View is active');
        return;
    }
    
    const tagIconUrl = 'static/images/Icon1.png';
    const numTags = 8;
    const radius = 150; // Slightly closer to center (was 160)
    const angleStep = (2 * Math.PI) / numTags;

    for (let i = 0; i < numTags; i++) {
        const angle = i * angleStep;
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);
        const rotationAngle = angle * (180 / Math.PI) + 90;

        svg.append("image")
            .attr("xlink:href", tagIconUrl)
            .attr("x", x - 24.64)
            .attr("y", y - 24.64)
            .attr("width", 49.28) // +12% from 44
            .attr("height", 49.28) // +12% from 44
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

    // Right panel - increased width to accommodate longer values
    // Positioned so right margin equals left margin (20px)
    const panelWidth = 170;
    const rightMargin = 20; // Same as left margin
    svg.append("rect")
        .attr("x", width - panelWidth - rightMargin)
        .attr("y", 20)
        .attr("width", panelWidth)
        .attr("height", 100)
        .attr("class", "feature-panel");

    // Text in right panel - will be updated with real data
    const panelData = [
        {label: "Protection ring", value: "Ring 0"},
        {label: "Kernel", value: "Active"},
        {label: "Processes", value: "Loading..."},
        {label: "Memory", value: "Loading..."}
    ];
    
    const leftPadding = 10; // Padding from left edge of panel
    const rightPadding = 10; // Padding from right edge of panel
    
    panelData.forEach((item, i) => {
        const textGroup = svg.append("g")
            .attr("class", `panel-item-${i}`);
        
        // Labels aligned to left with padding
        textGroup.append("text")
            .attr("x", width - panelWidth - rightMargin + leftPadding)
            .attr("y", 45 + i * 22)
            .text(item.label + ":")
            .attr("class", "feature-text");
        
        // Values aligned to right edge of panel with padding
        textGroup.append("text")
            .attr("x", width - rightMargin - rightPadding)
            .attr("y", 45 + i * 22)
            .text(item.value)
            .attr("class", "feature-text")
            .attr("id", `panel-value-${i}`)
            .attr("font-weight", "bold")
            .attr("text-anchor", "end"); // Right-align text to prevent overflow
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
    // Fetch all Linux processes with detailed information
    fetch('/api/processes-detailed')
        .then(res => res.json())
        .then(data => {
            const processes = data.processes || [];
            const numProcesses = processes.length;

            // Find min and max memory usage for scaling
            const memoryValues = processes.map(p => p.memory_mb || 0);
            const minMemory = Math.min(...memoryValues);
            const maxMemory = Math.max(...memoryValues);
            const memoryRange = maxMemory - minMemory;

            // Find a process to highlight by default
            // Priority: 1) nginx (exact match or starts with "nginx:") with accessible files, 
            //           2) nginx without file access check,
            //           3) python/python3 with accessible files, 
            //           4) python/python3 without file access check,
            //           5) process with most FDs (accessible, excluding browser processes),
            //           6) process with most memory (excluding browser processes)
            let highlightedProcess = null;
            
            // Helper function to check if process is a browser process (should be excluded from fallback)
            const isBrowserProcess = (name) => {
                if (!name) return false;
                const lowerName = name.toLowerCase();
                return lowerName.includes('firefox') || 
                       lowerName.includes('chrome') || 
                       lowerName.includes('chromium') ||
                       lowerName.includes('web content') ||
                       lowerName.includes('webcontent') ||
                       lowerName.includes('browser');
            };
            
            // First, try to find nginx master or worker process with accessible files
            // Look for exact "nginx" or processes that start with "nginx:" (like "nginx: master process" or "nginx: worker process")
            // Also check for variations like "nginx" in command line
            highlightedProcess = processes.find(p => {
                if (!p.name && !p.cmdline) return false;
                const name = (p.name || '').toLowerCase();
                const cmdline = (p.cmdline || '').toLowerCase();
                // Check if it's nginx by name or in command line
                const isNginx = name === 'nginx' || 
                               name.startsWith('nginx:') ||
                               (cmdline.includes('nginx') && !cmdline.includes('nginx-files')); // Exclude nginx-files.js
                return isNginx && p.num_fds > 0; // Prefer nginx with accessible files
            });
            
            if (highlightedProcess) {
                console.log('✅ Found nginx with files:', highlightedProcess.name, highlightedProcess.pid);
            }
            
            // If no nginx with accessible files, try any nginx process (including master process)
            if (!highlightedProcess) {
                // First try to find master process (usually has "master process" in name)
                highlightedProcess = processes.find(p => {
                    if (!p.name && !p.cmdline) return false;
                    const name = (p.name || '').toLowerCase();
                    const cmdline = (p.cmdline || '').toLowerCase();
                    const isNginx = name === 'nginx' || 
                                   name.startsWith('nginx:') ||
                                   (cmdline.includes('nginx') && !cmdline.includes('nginx-files'));
                    return isNginx && (name.includes('master') || cmdline.includes('master'));
                });
                
                // If no master, try any nginx process
                if (!highlightedProcess) {
                    highlightedProcess = processes.find(p => {
                        if (!p.name && !p.cmdline) return false;
                        const name = (p.name || '').toLowerCase();
                        const cmdline = (p.cmdline || '').toLowerCase();
                        return name === 'nginx' || 
                               name.startsWith('nginx:') ||
                               (cmdline.includes('nginx') && !cmdline.includes('nginx-files'));
                    });
                }
                
                if (highlightedProcess) {
                    console.log('✅ Found nginx (any):', highlightedProcess.name, highlightedProcess.pid);
                }
            }
            
            if (!highlightedProcess) {
                console.log('⚠️ Nginx not found in processes list');
                console.log('📋 Total processes:', processes.length);
                console.log('📋 Process names (first 30):', processes.map(p => p.name || p.cmdline || 'unnamed').filter(Boolean).slice(0, 30));
                // Check if there are any processes with "nginx" in cmdline but not in name
                const nginxInCmdline = processes.filter(p => {
                    const cmdline = (p.cmdline || '').toLowerCase();
                    return cmdline.includes('nginx') && !cmdline.includes('nginx-files');
                });
                if (nginxInCmdline.length > 0) {
                    console.log('🔍 Found processes with nginx in cmdline:', nginxInCmdline.map(p => ({
                        name: p.name,
                        pid: p.pid,
                        cmdline: p.cmdline
                    })));
                }
            }
            
            // If no nginx, try to find python/python3 with accessible files
            if (!highlightedProcess) {
                highlightedProcess = processes.find(p => {
                    if (!p.name) return false;
                    const name = p.name.toLowerCase();
                    const isPython = name.includes('python') || name === 'python3';
                    return isPython && p.num_fds > 0; // Prefer python with accessible files
                });
            }
            
            // If no python with accessible files, try any python process
            if (!highlightedProcess) {
                highlightedProcess = processes.find(p => 
                    p.name && (p.name.toLowerCase().includes('python') || p.name.toLowerCase() === 'python3')
                );
            }
            
            // If still no match, use process with most file descriptors (accessible, excluding browser processes)
            if (!highlightedProcess) {
                let maxFds = 0;
                processes.forEach(p => {
                    if (p.num_fds && p.num_fds > maxFds && !isBrowserProcess(p.name)) {
                        maxFds = p.num_fds;
                        highlightedProcess = p;
                    }
                });
                if (highlightedProcess) {
                    console.log('✅ Selected process with most FDs (non-browser):', highlightedProcess.name, highlightedProcess.pid);
                }
            }
            
            // Last resort: use process with most memory (excluding browser processes)
            if (!highlightedProcess) {
                processes.forEach(p => {
                    if (p.memory_mb && p.memory_mb > (highlightedProcess?.memory_mb || 0) && !isBrowserProcess(p.name)) {
                        highlightedProcess = p;
                    }
                });
                if (highlightedProcess) {
                    console.log('✅ Selected process with most memory (non-browser):', highlightedProcess.name, highlightedProcess.pid);
                }
            }
            
            // Final fallback: if still nothing, just use first non-browser process
            if (!highlightedProcess) {
                highlightedProcess = processes.find(p => p.name && !isBrowserProcess(p.name));
                if (highlightedProcess) {
                    console.log('✅ Selected first non-browser process:', highlightedProcess.name, highlightedProcess.pid);
                }
            }
            
            if (highlightedProcess) {
                console.log('🎯 Highlighted process:', highlightedProcess.name, 'PID:', highlightedProcess.pid);
            } else {
                console.warn('⚠️ No process selected for highlighting');
            }
            
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
                    .attr("data-pid", process.pid) // Store PID for highlighting
                    .attr("stroke", "url(#lineGradient)") // Use gradient for depth
                    .attr("stroke-width", 0.4) // Same thickness as Bezier curves
                    .attr("data-original-stroke-width", 0.4) // Store original stroke-width for restoration
                    .attr("data-original-opacity", 0.05 + Math.random() * 0.03) // Store original opacity
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

                // Determine if this is the highlighted process
                const isHighlighted = highlightedProcess && process.pid === highlightedProcess.pid;
                const baseRadius = isHighlighted ? 3 : 1; // Larger for highlighted process
                const hoverRadius = baseRadius * 2.5; // Radius when hovering
                const hitAreaRadius = 12; // Invisible hit area for easier clicking
                
                // Create group for process node
                const processGroup = svg.append("g")
                    .attr("class", "process-node-group")
                    .attr("data-pid", process.pid)
                    .datum(process); // Store process data in group
                
                // Add invisible hit area circle (larger for easier interaction)
                const hitArea = processGroup.append("circle")
                    .attr("cx", px)
                    .attr("cy", py)
                    .attr("r", hitAreaRadius)
                    .attr("fill", "transparent")
                    .attr("stroke", "none")
                    .style("pointer-events", "all");
                
                // Add visible circle at the end of the line with animation
                const circle = processGroup.append("circle")
                    .attr("cx", px)
                    .attr("cy", py)
                    .attr("r", 0) // Start with radius 0
                    .attr("fill", "#888")
                    .attr("stroke", "#555")
                    .attr("stroke-width", isHighlighted ? 1 : 0.5)
                    .attr("opacity", 0)
                    .attr("class", "process-node")
                    .style("pointer-events", "none"); // Don't interfere with hit area

                // Animate circle appearance
                circle.transition()
                    .duration(150)
                    .delay(i * 20 + 250) // Appear after line animation
                    .attr("r", baseRadius)
                    .attr("opacity", 1);
                
                // If highlighted, show files and highlight curves immediately
                if (isHighlighted) {
                    setTimeout(() => {
                        showProcessFilesOnCurves(process.pid, process.name);
                    }, 2000); // Show after initial animation
                }
                
                // Add hover effects on the entire group (both hit area and circle)
                processGroup
                    .style("cursor", "pointer")
                    .on("mouseover", function(event, d) {
                        // Get the actual process data from the datum
                        const processData = d || process;
                        
                        // If hovering over a non-highlighted process, shrink the highlighted one
                        if (highlightedProcess && processData.pid !== highlightedProcess.pid) {
                            const highlightedGroup = svg.select(`.process-node-group[data-pid="${highlightedProcess.pid}"]`);
                            const highlightedCircle = highlightedGroup.select("circle.process-node");
                            if (!highlightedCircle.empty()) {
                                highlightedCircle.transition()
                                    .duration(200)
                                    .attr("r", 1) // Shrink to normal size
                                    .attr("stroke-width", 0.5);
                                // Hide files of highlighted process
                                hideProcessFilesOnCurves();
                            }
                        }
                        
                        // Enlarge visible circle on hover (make it same size as highlighted process)
                        const targetRadius = isHighlighted ? hoverRadius : 7.5; // Same size as highlighted (3 * 2.5)
                        circle.transition()
                            .duration(200)
                            .attr("r", targetRadius)
                            .attr("stroke-width", 1.5);
                        
                        // Add pulsing animation on hover
                        const pulse = () => {
                            circle.transition()
                                .duration(800)
                                .attr("r", targetRadius * 1.2)
                                .transition()
                                .duration(800)
                                .attr("r", targetRadius)
                                .on("end", function() {
                                    // Continue pulsing only if still hovering
                                    if (d3.select(this.parentNode).classed("hovered")) {
                                        pulse();
                                    }
                                });
                        };
                        processGroup.classed("hovered", true);
                        pulse();
                        
                        // Show process files at bottom of Bezier curves
                        showProcessFilesOnCurves(processData.pid, processData.name);
                    
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
                        .style("opacity", 0)
                        .style("max-width", "300px");
                    
                        // Basic info first
                        tooltip.html(`
                            <strong>Process:</strong> ${processData.name}<br>
                            <strong>PID:</strong> ${processData.pid}<br>
                            <strong>Memory:</strong> ${processData.memory_mb} MB<br>
                            <strong>Status:</strong> ${processData.status}<br>
                            <em>Loading details...</em>
                        `);
                        
                        tooltip.transition()
                            .duration(200)
                            .style("opacity", 1);
                        
                        // Fetch detailed information
                        Promise.all([
                            fetch(`/api/process/${processData.pid}/threads`).then(r => r.json()).catch(() => null),
                            fetch(`/api/process/${processData.pid}/cpu`).then(r => r.json()).catch(() => null),
                            fetch(`/api/process/${processData.pid}/fds`).then(r => r.json()).catch(() => null)
                        ]).then(([threadsData, cpuData, fdsData]) => {
                            let detailsHtml = `
                                <strong>Process:</strong> ${processData.name}<br>
                                <strong>PID:</strong> ${processData.pid}<br>
                                <strong>Memory:</strong> ${processData.memory_mb} MB<br>
                                <strong>Status:</strong> ${processData.status}<br>
                                <hr style="margin: 5px 0; border-color: #555;">
                            `;
                        
                        // Threads info
                        if (threadsData && !threadsData.error) {
                            detailsHtml += `<strong>Threads:</strong> ${threadsData.thread_count || 'N/A'}<br>`;
                            if (threadsData.voluntary_ctxt_switches) {
                                detailsHtml += `<strong>Voluntary switches:</strong> ${threadsData.voluntary_ctxt_switches.toLocaleString()}<br>`;
                            }
                            if (threadsData.nonvoluntary_ctxt_switches) {
                                detailsHtml += `<strong>Non-voluntary switches:</strong> ${threadsData.nonvoluntary_ctxt_switches.toLocaleString()}<br>`;
                            }
                        }
                        
                        // CPU info
                        if (cpuData && !cpuData.error) {
                            if (cpuData.cpu_percent !== undefined) {
                                detailsHtml += `<strong>CPU:</strong> ${cpuData.cpu_percent}%<br>`;
                            }
                            if (cpuData.cpu_times) {
                                detailsHtml += `<strong>CPU Time:</strong> User: ${cpuData.cpu_times.user}s, System: ${cpuData.cpu_times.system}s<br>`;
                            }
                            if (cpuData.nice !== null && cpuData.nice !== undefined) {
                                detailsHtml += `<strong>Nice:</strong> ${cpuData.nice}<br>`;
                            }
                        }
                        
                        // File descriptors info
                        if (fdsData && !fdsData.error) {
                            detailsHtml += `<strong>File Descriptors:</strong> ${fdsData.num_fds || 0}<br>`;
                            if (fdsData.connections && fdsData.connections.length > 0) {
                                detailsHtml += `<strong>Connections:</strong> ${fdsData.connections.length}<br>`;
                            }
                            if (fdsData.open_files && fdsData.open_files.length > 0) {
                                detailsHtml += `<strong>Open Files:</strong> ${fdsData.open_files.length}<br>`;
                            }
                        }
                        
                        tooltip.html(detailsHtml);
                    });
                    
                    // Update tooltip position on mouse move
                    d3.select("svg").on("mousemove", function() {
                        tooltip
                            .style("left", (event.pageX + 10) + "px")
                            .style("top", (event.pageY - 10) + "px");
                    });
                })
                    .on("mouseout", function(event, d) {
                        // Get the actual process data from the datum
                        const processData = d || process;
                        // Stop pulsing animation
                        processGroup.classed("hovered", false);
                        circle.interrupt(); // Stop any ongoing transitions
                        
                        // Reset circle size on mouseout
                        const isHighlighted = highlightedProcess && processData.pid === highlightedProcess.pid;
                        if (!isHighlighted) {
                            // Return to normal size
                            circle.transition()
                                .duration(200)
                                .attr("r", baseRadius)
                                .attr("stroke-width", 0.5);
                            // Hide process files when mouse leaves
                            hideProcessFilesOnCurves();
                        } else {
                            // Return highlighted process to its default size
                            circle.transition()
                                .duration(200)
                                .attr("r", baseRadius)
                                .attr("stroke-width", 1);
                        }
                        
                        // Restore highlighted process to its default size if it was shrunk
                        if (highlightedProcess && processData.pid !== highlightedProcess.pid) {
                            const highlightedGroup = svg.select(`.process-node-group[data-pid="${highlightedProcess.pid}"]`);
                            const highlightedCircle = highlightedGroup.select("circle.process-node");
                            if (!highlightedCircle.empty()) {
                                highlightedCircle.transition()
                                    .duration(200)
                                    .attr("r", 3) // Restore to highlighted size
                                    .attr("stroke-width", 1);
                                // Show files of highlighted process again
                                setTimeout(() => {
                                    showProcessFilesOnCurves(highlightedProcess.pid, highlightedProcess.name);
                                }, 200);
                            }
                        }
                        
                        d3.selectAll(".tooltip").remove();
                        d3.select("svg").on("mousemove", null);
                    });
            });
        })
        .catch(error => {
            console.error('Error fetching processes:', error);
        });
}

function drawBezierDecor(width, height, yBase) {
    const centerX = width / 2;
    const railHalfWidth = Math.min(360, Math.max(240, width * 0.24));
    const railY = Math.min(height - 78, yBase + 96);
    const decorGroup = svg.append("g")
        .attr("class", "bezier-decor-layer")
        .attr("pointer-events", "none");

    // Subtle underlay to visually anchor the curve bundle.
    decorGroup.append("ellipse")
        .attr("cx", centerX)
        .attr("cy", railY + 8)
        .attr("rx", railHalfWidth + 72)
        .attr("ry", 20)
        .attr("fill", "rgba(45, 45, 45, 0.045)");

    // Primary and secondary rails (UI-like track under the bezier network).
    decorGroup.append("line")
        .attr("x1", centerX - railHalfWidth)
        .attr("y1", railY)
        .attr("x2", centerX + railHalfWidth)
        .attr("y2", railY)
        .attr("stroke", "rgba(45, 45, 45, 0.52)")
        .attr("stroke-width", 1.1)
        .attr("stroke-linecap", "round")
        .attr("opacity", 0.8);

    decorGroup.append("line")
        .attr("x1", centerX - railHalfWidth + 12)
        .attr("y1", railY + 8)
        .attr("x2", centerX + railHalfWidth - 12)
        .attr("y2", railY + 8)
        .attr("stroke", "rgba(45, 45, 45, 0.26)")
        .attr("stroke-width", 0.85)
        .attr("stroke-linecap", "round")
        .attr("opacity", 0.9);

    // Short cyan accent in the center, similar to reference UI treatment.
    decorGroup.append("line")
        .attr("x1", centerX - 52)
        .attr("y1", railY + 8)
        .attr("x2", centerX + 52)
        .attr("y2", railY + 8)
        .attr("stroke", "rgba(88, 182, 216, 0.5)")
        .attr("stroke-width", 0.9)
        .attr("stroke-linecap", "round");

    // Marker dots and tiny ticks (echoing the diegetic control language).
    const markers = 9;
    for (let i = 0; i < markers; i++) {
        const t = i / (markers - 1);
        const x = centerX - railHalfWidth + t * (railHalfWidth * 2);
        decorGroup.append("circle")
            .attr("cx", x)
            .attr("cy", railY)
            .attr("r", i === Math.floor(markers / 2) ? 1.8 : 1.2)
            .attr("fill", "rgba(45, 45, 45, 0.55)");

        if (i % 2 === 0) {
            decorGroup.append("line")
                .attr("x1", x)
                .attr("y1", railY - 6)
                .attr("x2", x)
                .attr("y2", railY - 2.5)
                .attr("stroke", "rgba(45, 45, 45, 0.32)")
                .attr("stroke-width", 0.7)
                .attr("stroke-linecap", "round");
        }
    }

    // Semantic label and compact legend for the lower flow layer.
    decorGroup.append("text")
        .attr("x", centerX)
        .attr("y", railY + 25)
        .attr("text-anchor", "middle")
        .style("font-family", "Share Tech Mono, monospace")
        .style("font-size", "9px")
        .style("letter-spacing", "1px")
        .style("fill", "rgba(55, 55, 55, 0.55)")
        .text("KERNEL I/O LAYER");

    const legendY = railY + 38;
    const legendSpacing = 120;
    const legendStartX = centerX - ((lowerFlowTypes.length - 1) * legendSpacing) / 2;
    lowerFlowTypes.forEach((flowType, idx) => {
        const lx = legendStartX + idx * legendSpacing;
        decorGroup.append("line")
            .attr("x1", lx - 24)
            .attr("y1", legendY - 4)
            .attr("x2", lx - 8)
            .attr("y2", legendY - 4)
            .attr("stroke", flowType.stroke)
            .attr("stroke-width", 1.2)
            .attr("stroke-linecap", "round");

        decorGroup.append("text")
            .attr("x", lx)
            .attr("y", legendY)
            .attr("text-anchor", "start")
            .style("font-family", "Share Tech Mono, monospace")
            .style("font-size", "7.5px")
            .style("letter-spacing", "0.6px")
            .style("fill", "rgba(60, 60, 60, 0.48)")
            .text(flowType.label);
    });
}

function drawBezierCoreBridge(width, height, yBase) {
    const centerX = width / 2;
    const centerY = height / 2;
    const bridgeGroup = svg.append("g")
        .attr("class", "bezier-core-bridge")
        .attr("pointer-events", "none");

    const anchorY = centerY + 90; // Just below process ring
    const targetY = yBase - 34;   // Just above lower bezier bundle
    const bridgeCount = 18;

    for (let i = 0; i < bridgeCount; i++) {
        const t = bridgeCount <= 1 ? 0 : i / (bridgeCount - 1);
        const spread = (t - 0.5) * 220;
        const startX = centerX + spread * 0.42;
        const endX = centerX + spread;

        const cp1X = centerX + spread * 0.18;
        const cp1Y = anchorY + 48 + Math.random() * 20;
        const cp2X = centerX + spread * 0.7;
        const cp2Y = targetY - 26 - Math.random() * 20;

        const bridgePath = `M${startX},${anchorY} C${cp1X},${cp1Y} ${cp2X},${cp2Y} ${endX},${targetY}`;
        const isCenter = Math.abs(t - 0.5) < 0.12;
        const stroke = isCenter ? "rgba(70, 70, 70, 0.2)" : "rgba(70, 70, 70, 0.14)";
        const widthPx = isCenter ? 0.9 : 0.65;
        const opacity = isCenter ? 0.55 : 0.42;

        bridgeGroup.append("path")
            .attr("d", bridgePath)
            .attr("fill", "none")
            .attr("stroke", stroke)
            .attr("stroke-width", widthPx)
            .attr("opacity", opacity)
            .attr("stroke-linecap", "round");
    }

    // Subtle joint nodes where bridge reaches the lower flow layer.
    const nodeCount = 7;
    for (let i = 0; i < nodeCount; i++) {
        const t = nodeCount <= 1 ? 0 : i / (nodeCount - 1);
        const x = centerX + (t - 0.5) * 180;
        bridgeGroup.append("circle")
            .attr("cx", x)
            .attr("cy", targetY)
            .attr("r", i === Math.floor(nodeCount / 2) ? 1.7 : 1.2)
            .attr("fill", "rgba(70, 70, 70, 0.38)");
    }
}

// Draw curves at bottom
function drawLowerBezierGrid(num = 90) {
    const width = window.innerWidth;
    console.log("🔧 drawLowerBezierGrid called");
    console.log("🔧 window.nginxFilesManager:", typeof window.nginxFilesManager);
    // Initialize nginx files manager - wait for curves to be drawn first
    // Curves need to be rendered before files can be attached to them
    setTimeout(() => {
        if (window.nginxFilesManager) {
            console.log("🔧 Initializing NginxFilesManager after curves are drawn...");
            window.nginxFilesManager.init();
        }
    }, 1500); // Wait 1.5 seconds for curves to finish animating
    const height = window.innerHeight;
    // Lift the whole lower flow construction without changing its geometry.
    const lowerFlowYOffset = -45;
    const yBase = height - 200 + lowerFlowYOffset;
    drawBezierDecor(width, height, yBase);

    for (let i = 0; i < num; i++) {
        const fromLeft = i < num / 2;

        const startX = fromLeft
            ? 300 + Math.random() * 100
            : width - 300 - Math.random() * 100;

        const endX = width / 2 + (Math.random() - 0.5) * 200;
        const endY = height - 160 - Math.random() * 40 + lowerFlowYOffset;

        const controlX1 = startX + (fromLeft ? 150 : -150) + (Math.random() - 0.5) * 80;
        const controlY1 = yBase - 60 - Math.random() * 40;

        const controlX2 = endX + (Math.random() - 0.5) * 60;
        const controlY2 = endY + 40 + Math.random() * 220;

        const path = `M${startX},${yBase} C${controlX1},${controlY1} ${controlX2},${controlY2} ${endX},${endY}`;

        const curveStroke = "rgba(60, 60, 60, 0.3)";
        const curveStrokeWidth = 0.8;
        const curveOpacity = 0.3;

        // Draw Bezier curves with layered intensity like in the reference.
        const bezierCurve = svg.append("path")
            .attr("d", path)
            .attr("class", "bezier-curve")
            .attr("data-curve-index", i) // Add index for file association
            .attr("stroke", curveStroke)
            .attr("stroke-width", curveStrokeWidth)
            .attr("opacity", 0) // Start invisible
            .attr("data-original-stroke", curveStroke)
            .attr("data-original-stroke-width", curveStrokeWidth)
            .attr("data-original-opacity", curveOpacity)
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
            .attr("opacity", curveOpacity)
            .attr("stroke-dashoffset", 0);
    }
}

function fetchIsolationContext(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && isolationContextCache && (now - isolationContextCacheTs < 8000)) {
        return Promise.resolve(isolationContextCache);
    }
    return fetch('/api/isolation-context')
        .then(res => res.json())
        .then(data => {
            if (!data || data.error) {
                throw new Error(data?.error || 'No isolation data');
            }
            isolationContextCache = data;
            isolationContextCacheTs = now;
            return data;
        })
        .catch(err => {
            console.warn('Isolation context unavailable:', err.message);
            return null;
        });
}

function drawIsolationConceptLayer(centerX, centerY, width, height) {
    // Skip overlay in Matrix/DNA modes to keep views clean.
    if (window.kernelContextMenu && ['matrix', 'dna', 'dna-timeline'].includes(window.kernelContextMenu.currentView)) {
        return;
    }

    const renderToken = ++isolationRenderToken;
    d3.selectAll('.namespace-shell-layer, .cgroup-card-layer').remove();
    fetchIsolationContext().then((data) => {
        if (renderToken !== isolationRenderToken) return;
        if (!data) return;
        if (window.kernelContextMenu && ['matrix', 'dna', 'dna-timeline'].includes(window.kernelContextMenu.currentView)) {
            return;
        }
        drawNamespaceShell(centerX, centerY, data.namespaces || []);
        drawCgroupConceptCard(width, height, data.top_cgroups || []);
    });
}

function drawNamespaceShell(centerX, centerY, namespaces) {
    const shellGroup = svg.selectAll('.tag-icon').empty()
        ? svg.append('g').attr('class', 'namespace-shell-layer')
        : svg.insert('g', '.tag-icon').attr('class', 'namespace-shell-layer');

    const preferredOrder = ['mnt', 'pid', 'net', 'ipc', 'uts', 'user'];
    const byId = {};
    namespaces.forEach(ns => { byId[ns.id] = ns; });
    const ordered = preferredOrder.map(id => byId[id]).filter(Boolean);
    const fallback = namespaces.filter(ns => !preferredOrder.includes(ns.id));
    const namespaceSlots = [...ordered, ...fallback].slice(0, 8);

    const numSlots = 8;
    const angleStep = (2 * Math.PI) / numSlots;
    const gap = 0.04;
    // Keep enlarged scale while restoring "circle slice" geometry.
    // Center namespace slices on Icon1 orbit (r=150).
    const ringInner = 110;
    const ringOuter = 190;

    for (let i = 0; i < numSlots; i++) {
        const ns = namespaceSlots[i];
        if (!ns) continue; // keep free slots empty

        const activity = Math.max(0, Math.min(1, Number(ns.activity || 0)));
        // Center each namespace slice on the corresponding Icon1 angle.
        const centerAngle = i * angleStep;
        const startAngle = centerAngle - angleStep / 2 + gap;
        const endAngle = centerAngle + angleStep / 2 - gap;
        const arcPath = d3.arc()
            .innerRadius(ringInner)
            .outerRadius(ringOuter)
            .startAngle(startAngle)
            .endAngle(endAngle);

        const segment = shellGroup.append('path')
            .attr('d', arcPath())
            .attr('transform', `translate(${centerX}, ${centerY})`)
            .attr('fill', `rgba(60, 60, 60, ${0.07 + activity * 0.16})`)
            .attr('stroke', `rgba(90, 90, 90, ${0.5 + activity * 0.32})`)
            .attr('stroke-width', 1 + activity * 1.4)
            .style('cursor', 'help');

        const mid = (startAngle + endAngle) / 2;
        const labelR = ringOuter - 12;
        const lx = centerX + Math.cos(mid - Math.PI / 2) * labelR;
        const ly = centerY + Math.sin(mid - Math.PI / 2) * labelR;
        shellGroup.append('text')
            .attr('x', lx)
            .attr('y', ly)
            .attr('text-anchor', 'middle')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '8px')
            .style('letter-spacing', '0.5px')
            .style('fill', '#d2d6de')
            .text(ns.label || String(ns.id || 'NS').toUpperCase());

        segment
            .on('mouseenter', (event) => {
                d3.selectAll('.ns-tooltip').remove();
                d3.select('body')
                    .append('div')
                    .attr('class', 'tooltip ns-tooltip')
                    .style('opacity', 0.95)
                    .style('left', `${event.pageX + 10}px`)
                    .style('top', `${event.pageY - 10}px`)
                    .html(`
                        <strong>Namespace ${ns.label || String(ns.id || '').toUpperCase()}</strong><br>
                        <strong>Unique:</strong> ${ns.unique_count || 0}<br>
                        <strong>Dominant:</strong> ${ns.dominant_count || 0} procs<br>
                        <strong>Inode:</strong> ${ns.dominant_inode || 'n/a'}
                    `);
            })
            .on('mousemove', (event) => {
                d3.selectAll('.ns-tooltip')
                    .style('left', `${event.pageX + 10}px`)
                    .style('top', `${event.pageY - 10}px`);
            })
            .on('mouseleave', () => d3.selectAll('.ns-tooltip').remove());
    }
}

function drawCgroupConceptCard(width, height, topCgroups) {
    if (!topCgroups || topCgroups.length === 0) return;
    const cgroup = topCgroups[0];
    const cardX = 20;
    const cardY = height - 230;
    const cardW = 260;
    const cardH = 145;
    const barW = 150;

    const group = svg.append('g')
        .attr('class', 'cgroup-card-layer');

    group.append('rect')
        .attr('x', cardX)
        .attr('y', cardY)
        .attr('width', cardW)
        .attr('height', cardH)
        .attr('rx', 8)
        .style('fill', '#333')
        .style('stroke', '#555')
        .style('stroke-width', '1px')
        .style('opacity', 0.92);

    group.append('text')
        .attr('x', cardX + 10)
        .attr('y', cardY + 18)
        .style('font-family', 'Share Tech Mono, monospace')
        .style('font-size', '10px')
        .style('fill', '#d9dde4')
        .style('letter-spacing', '0.7px')
        .text('CGROUP PROFILE');

    const shortPath = (cgroup.path || '/').length > 32 ? `${cgroup.path.slice(0, 29)}...` : (cgroup.path || '/');
    group.append('text')
        .attr('x', cardX + 10)
        .attr('y', cardY + 32)
        .style('font-family', 'Share Tech Mono, monospace')
        .style('font-size', '9px')
        .style('fill', '#c8ccd4')
        .text(shortPath);

    const drawMetricRow = (label, valueText, ratio, rowIndex) => {
        const y = cardY + 48 + rowIndex * 22;
        group.append('text')
            .attr('x', cardX + 10)
            .attr('y', y)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '8.5px')
            .style('fill', '#c8ccd4')
            .text(label);

        group.append('rect')
            .attr('x', cardX + 65)
            .attr('y', y - 8)
            .attr('width', barW)
            .attr('height', 8)
            .attr('rx', 2)
            .attr('fill', 'rgba(220, 220, 220, 0.2)');

        group.append('rect')
            .attr('x', cardX + 65)
            .attr('y', y - 8)
            .attr('width', Math.max(2, barW * Math.max(0, Math.min(1, ratio))))
            .attr('height', 8)
            .attr('rx', 2)
            .attr('fill', 'rgba(88, 182, 216, 0.68)');

        group.append('text')
            .attr('x', cardX + cardW - 8)
            .attr('y', y)
            .attr('text-anchor', 'end')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '8px')
            .style('fill', '#dde2ea')
            .text(valueText);
    };

    const procRatio = Math.min(1, (Number(cgroup.process_count || 0) / 120));
    const memCurrent = Number(cgroup.memory_current_mb || cgroup.memory_mb_sum || 0);
    const memMax = Number(cgroup.memory_max_mb || 0);
    const memRatio = memMax > 0 ? Math.min(1, memCurrent / memMax) : Math.min(1, memCurrent / 4096);
    const pidsCurrent = Number(cgroup.pids_current || cgroup.process_count || 0);
    const pidsMax = Number(cgroup.pids_max || 0);
    const pidsRatio = pidsMax > 0 ? Math.min(1, pidsCurrent / pidsMax) : Math.min(1, pidsCurrent / 256);
    const ioMb = Number(cgroup.io_total_mb || 0);
    const ioRatio = Math.min(1, ioMb / 1024);

    drawMetricRow('PROC', `${cgroup.process_count || 0}`, procRatio, 0);
    drawMetricRow('MEM', `${Math.round(memCurrent)}MB`, memRatio, 1);
    drawMetricRow('PIDS', pidsMax > 0 ? `${pidsCurrent}/${pidsMax}` : `${pidsCurrent}`, pidsRatio, 2);
    drawMetricRow('IO', `${Math.round(ioMb)}MB`, ioRatio, 3);
}

// Show process files at the bottom of Bezier curves
function showProcessFilesOnCurves(pid, processName) {
    console.log(`🔍 Showing files for process ${pid} (${processName})`);
    // Clear existing process files
    hideProcessFilesOnCurves();
    
    // Fetch process files
    fetch(`/api/process/${pid}/fds`)
        .then(res => {
            console.log(`📡 Response status for PID ${pid}:`, res.status);
            return res.json();
        })
        .then(data => {
            console.log(`📁 Data received for PID ${pid}:`, data);
            // API returns 'open_files' not 'files'
            const files = data.open_files || [];
            console.log(`📄 Files found: ${files.length}`, files);
            if (files.length === 0) {
                console.log(`⚠️ No files found for process ${pid} (${processName})`);
                // Don't show connections if no files - it's confusing
                // Connections are network sockets, not files
                console.log(`ℹ️ Skipping connections display - no files available for this process`);
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
                    console.log(`🚫 Filtered out IP address: ${path}`);
                    return false;
                }
                
                // Filter out socket-like patterns
                if (path.includes('socket:') || path.includes('pipe:') || path.includes('anon_inode:')) {
                    console.log(`🚫 Filtered out special file: ${path}`);
                    return false;
                }
                
                // Allow /dev files (like /dev/null, /dev/shm, etc.) - they are valid files
                if (path.startsWith('/dev/')) {
                    return true;
                }
                
                // Filter out paths that don't look like file paths (but allow /dev)
                if (!path.startsWith('/')) {
                    console.log(`🚫 Filtered out non-absolute path: ${path}`);
                    return false;
                }
                
                // Additional check: if filename (last part) looks like an IP address, filter it
                const filename = path.split('/').pop();
                if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(filename)) {
                    console.log(`🚫 Filtered out path with IP-like filename: ${path}`);
                    return false;
                }
                
                return true;
            });
            
            const numValidFiles = Math.min(validFiles.length, bottomCurves.length, 10); // Limit to 10 files
            const step = Math.max(1, Math.floor(bottomCurves.length / numValidFiles));
            
            // Display files
            console.log(`✅ Filtered ${validFiles.length} valid files from ${files.length} total`);
            validFiles.slice(0, numValidFiles).forEach((file, i) => {
                if (i * step < bottomCurves.length) {
                    const curve = bottomCurves[i * step];
                    let fileName = file.path ? file.path.split('/').pop() : `FD ${file.fd}`;
                    // Additional safety check: if filename looks like an IP, skip it
                    const ipPattern = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/;
                    if (ipPattern.test(fileName)) {
                        console.log(`⚠️ Skipping file with IP-like name: ${fileName} (from path: ${file.path})`);
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
        console.log(`ℹ️ No interesting connections to display for process ${pid}`);
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

// Update panel with real data from API
function updatePanelData() {
    // Skip updating if Matrix View is active
    if (window.kernelContextMenu && window.kernelContextMenu.currentView === 'matrix') {
        return;
    }
    
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
    // Skip rendering if Matrix View is active
    if (window.kernelContextMenu && window.kernelContextMenu.currentView === 'matrix') {
        console.log('⏸️ Skipping subsystems visualization - Matrix View is active');
        return;
    }
    
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
