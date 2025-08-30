// Main JavaScript file for Linux Kernel Visualization

// Global variables
const svg = d3.select("svg");
let syscallsManager;
let resizeTimeout;

// Application initialization
function initApp() {
    console.log('🚀 Initializing Linux Kernel Visualization');
    
    // Initialize system calls manager
    syscallsManager = new SyscallsManager();
    
    // Draw main interface
    draw();
    
    // Start updates
    syscallsManager.startAutoUpdate(3000);
    
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
        }, 100);
    });

    // Cleanup on page close
    window.addEventListener('beforeunload', () => {
        if (syscallsManager) {
            syscallsManager.stopAutoUpdate();
        }
    });
}

// Main drawing function
function draw() {
    svg.selectAll("*").remove();

    const width = window.innerWidth;
    const height = window.innerHeight;
    const centerX = width / 2;
    const centerY = height / 2;

    // Draw central circle
    drawCentralCircle(centerX, centerY);
    
    // Draw tag icons
    drawTagIcons(centerX, centerY);
    
    // Draw panels
    drawPanels(width, height);
    
    // Restore system calls
    if (syscallsManager) {
        syscallsManager.restoreState();
    }

    // Load processes and kernel subsystems
    loadProcessKernelMap(centerX, centerY);
    
    // Draw curves at bottom
    drawLowerBezierGrid();
}

// Draw central circle
function drawCentralCircle(centerX, centerY) {
    svg.append("circle")
        .attr("cx", centerX)
        .attr("cy", centerY)
        .attr("r", 55)
        .attr("class", "central-circle");

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

    // Text in right panel
    ["Filter: Active", "Mode: Analysis", "Nodes: 15"].forEach((f, i) => {
        svg.append("text")
            .attr("x", width - 170)
            .attr("y", 45 + i * 22)
            .text(f)
            .attr("class", "feature-text");
    });
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

        svg.append("path")
            .attr("d", path)
            .attr("class", "curve-path")
            .attr("opacity", 1 + Math.random() * 0.07);

        // Process circle
        svg.append("circle")
            .attr("cx", px)
            .attr("cy", py)
            .attr("r", 4)
            .attr("class", "node-circle");

        // Process name
        svg.append("text")
            .attr("x", px)
            .attr("y", py - 12)
            .attr("text-anchor", "middle")
            .attr("font-size", 11)
            .attr("fill", "#222")
            .text(name);

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

// Draw curves at bottom
function drawLowerBezierGrid(num = 90) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const yBase = height - 20;

    for (let i = 0; i < num; i++) {
        const fromLeft = i < num / 2;

        const startX = fromLeft
            ? 300 + Math.random() * 100
            : width - 300 - Math.random() * 100;

        const endX = width / 2 + (Math.random() - 0.5) * 200;
        const endY = height - 160 - Math.random() * 40;

        const controlX1 = startX + (fromLeft ? 150 : -150) + (Math.random() - 0.5) * 80;
        const controlY1 = yBase - 60 - Math.random() * 40;

        const controlX2 = endX + (Math.random() - 0.5) * 60;
        const controlY2 = endY + 40 + Math.random() * 20;

        const path = `M${startX},${yBase} C${controlX1},${controlY1} ${controlX2},${controlY2} ${endX},${endY}`;

        svg.append("path")
            .attr("d", path)
            .attr("stroke", "#222")
            .attr("stroke-width", 0.4)
            .attr("opacity", 0.05 + Math.random() * 0.03)
            .attr("fill", "none");
    }
}

// Start application after DOM load
document.addEventListener('DOMContentLoaded', initApp);
