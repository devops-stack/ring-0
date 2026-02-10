// Kernel Context Menu - Submenu and View Modes
// Version: 12

console.log('🔧 kernel-context-menu.js v12: Script loading...');

class KernelContextMenu {
    constructor() {
        this.isVisible = false;
        this.currentView = null; // 'matrix', 'timeline', 'dna', or null
        this.selectedPid = null;
        this.matrixData = [];
        this.timelineData = [];
        this.updateInterval = null;
        this.submenuGroup = null;
        this.dnaVisualization = null;
    }

    init() {
        // Submenu will be created dynamically in right-semicircle-menu.js
    }

    showSubmenu(x, y, angle) {
        const svg = d3.select('svg');
        
        // Remove existing submenu
        this.hideSubmenu();
        
        // Calculate submenu position (to the left of Kernel item)
        const submenuX = x - 150;
        const submenuY = y;
        
        // Create submenu group
        this.submenuGroup = svg.append('g')
            .attr('class', 'kernel-submenu')
            .style('opacity', 0)
            .style('pointer-events', 'all');
        
        console.log('✅ Submenu group created');
        
        // Background - diegetic UI style panel (like "SUBJECT U454.1" from example)
        const bg = this.submenuGroup.append('rect')
            .attr('x', submenuX - 10)
            .attr('y', submenuY - 80)
            .attr('width', 140)
            .attr('height', 110)
            .attr('rx', 2)
            .style('fill', 'rgba(5, 8, 12, 0.85)') // Very dark background, slightly transparent
            .style('stroke', 'rgba(200, 200, 200, 0.15)') // Subtle light gray border
            .style('stroke-width', '0.5px')
            .style('pointer-events', 'all')
            .style('filter', 'drop-shadow(0 0 2px rgba(200, 200, 200, 0.1))'); // Subtle glow
        
        console.log('✅ Background rect created at:', submenuX - 10, submenuY - 60);
        
        // Menu items
        const items = [
            { id: 'matrix', label: 'Matrix View' },
            { id: 'timeline', label: 'Timeline / Flow' },
            { id: 'filters', label: 'Filters / Settings' }
        ];
        
        items.forEach((item, i) => {
            const itemY = submenuY - 65 + (i * 25);
            const isActive = item.id === this.currentView;
            const baseColor = '#c8ccd4';       // milk-gray
            const accentColor = '#58b6d8';     // cold cyan accent
            const itemGroup = this.submenuGroup.append('g')
                .attr('class', `submenu-item submenu-${item.id}`)
                .style('cursor', 'pointer');
            
            // Create individual panel for each item (like "SUBJECT U454.1" style)
            const itemPanel = itemGroup.append('rect')
                .attr('x', submenuX - 8)
                .attr('y', itemY - 9)
                .attr('width', 136)
                .attr('height', 20)
                .attr('rx', 1)
                .style('fill', 'rgba(10, 15, 20, 0.6)') // Dark panel background
                .style('stroke', 'rgba(180, 190, 210, 0.2)') // Subtle border
                .style('stroke-width', '0.5px')
                .style('pointer-events', 'all')
                .style('opacity', 0.7);
            
            // Text - positioned inside the panel
            const text = itemGroup.append('text')
                .attr('x', submenuX)
                .attr('y', itemY + 2)
                .text(item.label.toUpperCase())
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '10px')
                .style('fill', isActive ? accentColor : baseColor)
                .style('pointer-events', 'none')
                .style('letter-spacing', '0.5px'); // Slight letter spacing for clarity
            
            // Hover handlers for the panel
            const handleMouseEnter = () => {
                itemPanel
                    .style('fill', 'rgba(15, 22, 30, 0.8)')
                    .style('stroke', 'rgba(200, 200, 200, 0.3)')
                    .style('opacity', 1);
                text.style('fill', isActive ? accentColor : '#dde2ea');
            };
            
            const handleMouseLeave = () => {
                itemPanel
                    .style('fill', 'rgba(10, 15, 20, 0.6)')
                    .style('stroke', 'rgba(180, 190, 200, 0.2)')
                    .style('opacity', 0.7);
                text.style('fill', isActive ? accentColor : baseColor);
            };
            
            // Click handler function
            const handleClick = () => {
                if (item.id === 'matrix') {
                    this.activateMatrixView();
                } else if (item.id === 'timeline') {
                    // Activate DNA Timeline mode (with or without PID)
                    if (this.dnaVisualization) {
                        this.dnaVisualization.activateTimelineMode(this.selectedPid || null);
                        this.currentView = 'dna-timeline';
                        this.hideSubmenu();
                        
                        // Hide other UI elements
                        d3.selectAll('.syscall-box, .syscall-text').style('opacity', 0).style('pointer-events', 'none').style('visibility', 'hidden');
                        d3.selectAll('.tag-icon, .connection-line').style('opacity', 0).style('pointer-events', 'none').style('visibility', 'hidden');
                        d3.selectAll('.connection-box, .connection-text, .connection-details').style('opacity', 0).style('pointer-events', 'none').style('visibility', 'hidden');
                        d3.selectAll('.subsystem-indicator').style('opacity', 0).style('pointer-events', 'none').style('visibility', 'hidden');
                        
                        // Stop auto-updates
                        if (window.syscallsManager) {
                            window.syscallsManager.stopAutoUpdate();
                        }
                        if (window.connectionsManager) {
                            window.connectionsManager.stopAutoUpdate();
                        }
                        
                        this.addExitButton();
                    } else {
                        // Fallback to regular timeline if DNA visualization not available
                        if (this.selectedPid) {
                            this.activateTimelineView();
                        } else {
                            alert('Please select a PID from Matrix View first');
                        }
                    }
                } else if (item.id === 'filters') {
                    // Placeholder for future
                    console.log('Filters/Settings - coming soon');
                }
            };
            
            // Add hover and click handlers to panel
            itemPanel
                .on('mouseenter', handleMouseEnter)
                .on('mouseleave', handleMouseLeave)
                .on('click', handleClick);
            
            // Also add hover and click handlers to text area for better UX
            const textHoverArea = itemGroup.append('rect')
                .attr('x', submenuX - 8)
                .attr('y', itemY - 9)
                .attr('width', 136)
                .attr('height', 20)
                .style('fill', 'transparent')
                .style('pointer-events', 'all')
                .on('mouseenter', handleMouseEnter)
                .on('mouseleave', handleMouseLeave)
                .on('click', handleClick);
        });
        
        // Animate appearance
        this.submenuGroup.transition()
            .duration(200)
            .style('opacity', 1)
            .on('end', () => {
                console.log('✅ Submenu animation completed');
            });
        
        console.log('✅ Submenu created and animated');
    }

    hideSubmenu() {
        console.log('🔒 hideSubmenu called');
        if (this.submenuGroup) {
            this.submenuGroup.remove();
            this.submenuGroup = null;
        }
        // Also remove by class in case group reference is lost
        d3.selectAll('.kernel-submenu').remove();
    }

    activateMatrixView() {
        console.log('🎯 activateMatrixView called');
        this.currentView = 'matrix';
        this.hideSubmenu();
        
        // Dim radial visualization - don't change stroke-width, only opacity
        d3.selectAll('.process-line, .process-circle, .process-name')
            .transition()
            .duration(300)
            .style('opacity', 0.2);
        
        // Hide system calls and tag icons (menu) - они будут под Matrix View
        // (процессные линии .curve-path не трогаем, чтобы не менять стиль)
        
        // Hide system calls and tag icons (menu) - they should be behind Matrix View
        d3.selectAll('.syscall-box, .syscall-text')
            .transition()
            .duration(300)
            .style('opacity', 0)
            .style('pointer-events', 'none');

        // Hide active connections blocks
        d3.selectAll('.connection-box, .connection-text, .connection-details')
            .transition()
            .duration(300)
            .style('opacity', 0)
            .style('pointer-events', 'none');

        // Hide tag icons (memory, scheduler, file system, network) and their connection lines
        d3.selectAll('.tag-icon, .connection-line')
            .transition()
            .duration(300)
            .style('opacity', 0)
            .style('pointer-events', 'none')
            .style('visibility', 'hidden'); // Also hide them completely
        
        // Hide subsystem indicators (Memory, Scheduler, File System, Network bars in left panel)
        d3.selectAll('.subsystem-indicator')
            .transition()
            .duration(300)
            .style('opacity', 0)
            .style('pointer-events', 'none')
            .style('visibility', 'hidden');
        
        // Stop system calls auto-update to prevent re-rendering
        if (window.syscallsManager) {
            window.syscallsManager.stopAutoUpdate();
        }

        // Stop active connections auto-update to prevent re-rendering
        if (window.connectionsManager) {
            window.connectionsManager.stopAutoUpdate();
        }
        
        // Add exit button
        this.addExitButton();
        
        // Show Matrix View
        this.renderMatrixView();
        
        // Start auto-update
        this.startAutoUpdate();
    }

    activateTimelineView() {
        if (!this.selectedPid) return;
        
        this.currentView = 'timeline';
        this.hideSubmenu();
        
        // Dim radial visualization even more - don't change stroke-width
        d3.selectAll('.process-line, .process-circle, .process-name')
            .transition()
            .duration(300)
            .style('opacity', 0.1);
        
        // Add exit button
        this.addExitButton();
        
        // Activate lower flow layer
        this.renderTimelineFlow();
        
        // Start auto-update
        this.startAutoUpdate();
    }

    activateDNAView() {
        console.log('🧬 Activating Kernel DNA View');
        console.log('🔍 KernelDNAVisualization available:', typeof KernelDNAVisualization);
        console.log('🔍 window.KernelDNAVisualization available:', typeof window.KernelDNAVisualization);
        console.log('🔍 THREE available:', typeof THREE);
        console.log('🔍 THREE.WebGLRenderer available:', typeof THREE?.WebGLRenderer);
        console.log('🔍 Current dnaVisualization:', this.dnaVisualization);
        
        this.currentView = 'dna';
        this.hideSubmenu();
        
        // Initialize DNA visualization if not already done
        if (!this.dnaVisualization) {
            console.log('🔍 Checking KernelDNAVisualization availability...');
            console.log('🔍 typeof KernelDNAVisualization:', typeof KernelDNAVisualization);
            console.log('🔍 window.KernelDNAVisualization:', typeof window.KernelDNAVisualization);
            
            if (typeof KernelDNAVisualization !== 'undefined') {
                console.log('✅ Creating new KernelDNAVisualization instance');
                try {
                    this.dnaVisualization = new KernelDNAVisualization();
                    console.log('✅ Instance created, calling init()...');
                    const initResult = this.dnaVisualization.init();
                    if (initResult === false) {
                        console.error('❌ init() returned false - initialization failed');
                        this.dnaVisualization = null;
                        return;
                    }
                    console.log('✅ KernelDNAVisualization initialized');
                } catch (error) {
                    console.error('❌ Error initializing KernelDNAVisualization:', error);
                    console.error('❌ Error details:', {
                        message: error.message,
                        stack: error.stack,
                        name: error.name
                    });
                    alert('Ошибка инициализации Kernel DNA: ' + error.message + '\nПроверьте консоль для деталей.');
                    return;
                }
            } else if (typeof window.KernelDNAVisualization !== 'undefined') {
                console.log('✅ Using window.KernelDNAVisualization');
                try {
                    this.dnaVisualization = new window.KernelDNAVisualization();
                    const initResult = this.dnaVisualization.init();
                    if (initResult === false) {
                        console.error('❌ init() returned false - initialization failed');
                        this.dnaVisualization = null;
                        return;
                    }
                    console.log('✅ KernelDNAVisualization initialized from window');
                } catch (error) {
                    console.error('❌ Error initializing KernelDNAVisualization from window:', error);
                    alert('Ошибка инициализации Kernel DNA: ' + error.message);
                    return;
                }
            } else {
                console.error('❌ KernelDNAVisualization class not loaded');
                console.error('❌ Available window objects:', Object.keys(window).filter(k => k.includes('DNA') || k.includes('Kernel') || k.includes('Visualization')));
                console.error('❌ THREE available:', typeof THREE);
                console.error('❌ THREE.WebGLRenderer available:', typeof THREE?.WebGLRenderer);
                alert('Kernel DNA Visualization не загружен. Проверьте:\n1. Загружен ли Three.js\n2. Загружен ли kernel-dna.js\n3. Консоль браузера для ошибок');
                return;
            }
        } else {
            console.log('✅ Using existing dnaVisualization instance');
        }
        
        // Hide other UI elements
        d3.selectAll('.syscall-box, .syscall-text').style('opacity', 0).style('pointer-events', 'none').style('visibility', 'hidden');
        d3.selectAll('.tag-icon, .connection-line').style('opacity', 0).style('pointer-events', 'none').style('visibility', 'hidden');
        d3.selectAll('.connection-box, .connection-text, .connection-details').style('opacity', 0).style('pointer-events', 'none').style('visibility', 'hidden');
        d3.selectAll('.subsystem-indicator').style('opacity', 0).style('pointer-events', 'none').style('visibility', 'hidden');
        
        // Stop auto-updates
        if (window.syscallsManager) {
            window.syscallsManager.stopAutoUpdate();
        }
        if (window.connectionsManager) {
            window.connectionsManager.stopAutoUpdate();
        }
        
        // Activate DNA visualization
        console.log('🎯 Calling dnaVisualization.activate()');
        try {
            this.dnaVisualization.activate();
            console.log('✅ DNA visualization activated');
        } catch (error) {
            console.error('❌ Error activating DNA visualization:', error);
        }
        
        // Add exit button
        this.addExitButton();
    }
    
    addExitButton() {
        // Remove existing exit button
        d3.selectAll('.kernel-exit-button').remove();
        
        const svg = d3.select('svg');
        const width = window.innerWidth;
        
        // Create group first
        const exitGroup = svg.append('g')
            .attr('class', 'kernel-exit-button')
            .attr('transform', `translate(${width - 100}, 30)`)
            .style('cursor', 'pointer')
            .style('opacity', 0);
        
        // Background - same color as tooltip/process info
        exitGroup.append('rect')
            .attr('x', -40)
            .attr('y', -12)
            .attr('width', 80)
            .attr('height', 24)
            .attr('rx', 4)
            .style('fill', 'rgba(0, 0, 0, 0.9)')
            .style('stroke', 'rgba(200, 200, 200, 0.3)')
            .style('stroke-width', '0.5px');
        
        // Text - white text
        exitGroup.append('text')
            .attr('x', 0)
            .attr('y', 0)
            .text('Exit View')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '11px')
            .style('fill', '#e0e0e0')
            .style('text-anchor', 'middle')
            .style('dominant-baseline', 'middle')
            .style('pointer-events', 'none');
        
        // Click handler
        exitGroup.on('click', () => {
            this.deactivateViews();
            d3.selectAll('.kernel-exit-button').remove();
        });
        
        // Hover effect - slightly lighter on hover
        exitGroup.on('mouseenter', function() {
            d3.select(this).select('rect').style('fill', 'rgba(30, 30, 30, 0.95)');
            d3.select(this).select('text').style('fill', '#ffffff');
        }).on('mouseleave', function() {
            d3.select(this).select('rect').style('fill', 'rgba(0, 0, 0, 0.9)');
            d3.select(this).select('text').style('fill', '#e0e0e0');
        });
        
        // Animate appearance after elements are added
        exitGroup.transition()
            .duration(300)
            .style('opacity', 1);
    }

    deactivateViews() {
        // Reset current view FIRST to prevent draw() from running during cleanup
        this.currentView = null;
        this.selectedPid = null;
        
        // Deactivate DNA visualization FIRST (before any other cleanup)
        if (this.dnaVisualization) {
            this.dnaVisualization.deactivate();
        }
        
        // Clear exit button immediately (both old class and new class)
        d3.selectAll('.kernel-exit-button, .kernel-dna-exit-button').remove();
        const exitButtons = document.querySelectorAll('.kernel-dna-exit-button');
        exitButtons.forEach(btn => {
            if (btn.parentNode) {
                btn.parentNode.removeChild(btn);
            }
        });
        
        // Restore radial visualization - restore original styles, don't change stroke-width
        // IMPORTANT: Don't modify stroke-width, only opacity
        d3.selectAll('.process-line')
            .transition()
            .duration(300)
            .style('opacity', function() {
                // Restore original opacity without changing stroke-width
                return d3.select(this).attr('data-original-opacity') || '0.05';
            })
            .attr('stroke-width', function() {
                // Preserve original stroke-width (0.4)
                return d3.select(this).attr('data-original-stroke-width') || '0.4';
            });
        
        d3.selectAll('.process-circle, .process-name')
            .transition()
            .duration(300)
            .style('opacity', 1);
        
        // Restore system calls and tag icons
        d3.selectAll('.syscall-box, .syscall-text')
            .transition()
            .duration(300)
            .style('opacity', 1)
            .style('pointer-events', 'all');

        // Restore active connections blocks
        d3.selectAll('.connection-box, .connection-text, .connection-details')
            .transition()
            .duration(300)
            .style('opacity', 1)
            .style('pointer-events', 'all');

        d3.selectAll('.tag-icon, .connection-line')
            .transition()
            .duration(300)
            .style('opacity', 0.9)
            .style('pointer-events', 'all')
            .style('visibility', 'visible'); // Make them visible again
        
        // Restore subsystem indicators (Memory, Scheduler, File System, Network bars)
        d3.selectAll('.subsystem-indicator')
            .transition()
            .duration(300)
            .style('opacity', 1)
            .style('pointer-events', 'all')
            .style('visibility', 'visible');
        
        // Restart system calls auto-update
        if (window.syscallsManager) {
            window.syscallsManager.startAutoUpdate(3000);
        }

        // Restart active connections auto-update
        if (window.connectionsManager) {
            window.connectionsManager.startAutoUpdate(3000);
        }
        
        // Clear Matrix View (including panel and backdrop)
        d3.selectAll('.matrix-view-item, .matrix-header, .matrix-panel-bg, .matrix-backdrop').remove();
        
        // Clear Timeline events
        d3.selectAll('.timeline-event').remove();
        
        // Restore Bezier curves - ensure all curves are visible with original styles
        d3.selectAll('.bezier-curve')
            .transition()
            .duration(300)
            .attr('stroke', 'rgba(60, 60, 60, 0.3)')
            .attr('stroke-width', 0.8)
            .attr('opacity', 0.3)
            .style('visibility', 'visible'); // Ensure visibility is restored
        
        // Stop auto-update
        this.stopAutoUpdate();
    }
    
    // Public method to deactivate from outside
    exitView() {
        this.deactivateViews();
    }

    renderMatrixView() {
        console.log('🎯 renderMatrixView called');
        // Clear only matrix rows; keep panel, backdrop and header to avoid full-screen flicker
        d3.selectAll('.matrix-view-item').remove();
        
        // Fetch matrix data
        fetch('/api/proc-matrix')
            .then(res => {
                console.log('📡 Matrix API response status:', res.status);
                return res.json();
            })
            .then(data => {
                console.log('📊 Matrix data received:', data);
                if (data.error) {
                    console.error('Matrix error:', data.error);
                    return;
                }
                
                this.matrixData = data.matrix || [];
                console.log('📋 Matrix data array length:', this.matrixData.length);
                this.drawMatrixList();
            })
            .catch(error => {
                console.error('Error fetching matrix data:', error);
            });
    }

    drawMatrixList() {
        console.log('🎯 drawMatrixList called, data length:', this.matrixData.length);
        const svg = d3.select('svg');
        const width = window.innerWidth;
        const height = window.innerHeight;
        
        // Position: left side, vertical list
        const startX = 50;
        const startY = 100;
        const rowHeight = 30;
        const pidWidth = 80;
        const resourceStartX = startX + pidWidth + 20;
        const resourceWidth = 400;
        const resourceSpacing = 80;
        
        // Ensure backdrop exists once to avoid flicker - always on top layer
        let backdrop = d3.select('.matrix-backdrop');
        if (backdrop.empty()) {
            backdrop = svg.append('rect')
                .attr('class', 'matrix-backdrop')
                .attr('x', 0)
                .attr('y', 0)
                .attr('width', width)
                .attr('height', height)
                .style('fill', 'rgba(5, 8, 12, 0.6)')
                .style('pointer-events', 'none')
                .style('opacity', 1)
                .raise(); // Ensure it's on top
        } else {
            // Ensure backdrop stays on top even if it exists
            backdrop.raise();
        }
        
        // Ensure panel exists once; keep it between updates - always on top of backdrop
        let panelBg = d3.select('.matrix-panel-bg');
        if (panelBg.empty()) {
            const numRows = Math.min(this.matrixData.length, 15);
            const panelPadding = 20;
            const panelX = startX - panelPadding;
            const panelY = startY - 60;
            const panelWidth = resourceStartX + resourceSpacing * 5 - startX + panelPadding * 2;
            const panelHeight = numRows * rowHeight + 80;
            
            panelBg = svg.append('rect')
                .attr('class', 'matrix-panel-bg')
                .attr('x', panelX)
                .attr('y', panelY)
                .attr('width', panelWidth)
                .attr('height', panelHeight)
                .attr('rx', 6)
                .style('fill', 'rgba(12, 18, 28, 0.95)')
                .style('stroke', 'rgba(160, 170, 190, 0.35)')
                .style('stroke-width', 0.6)
                .style('opacity', 1)
                .raise(); // Ensure it's on top of backdrop
        } else {
            // Ensure panel stays on top even if it exists
            panelBg.raise();
        }
        
        if (!this.matrixData || this.matrixData.length === 0) {
            console.warn('⚠️ No matrix data to display');
            return;
        }
        
        // Diegetic UI: muted cold tones for resources
        const resources = [
            { key: 'cpu', label: 'CPU', color: '#5a7a9a' },  // Muted blue-gray
            { key: 'mem', label: 'MEM', color: '#6a8a8a' },  // Muted teal-gray
            { key: 'io', label: 'IO', color: '#7a6a8a' },     // Muted purple-gray
            { key: 'net', label: 'NET', color: '#6a7a9a' },   // Muted blue-gray
            { key: 'fd', label: 'FD', color: '#7a8a8a' }     // Muted gray
        ];
        
        // Calculate max values for normalization
        const maxValues = {};
        resources.forEach(r => {
            maxValues[r.key] = Math.max(...this.matrixData.map(d => d[r.key] || 0), 1);
        });
        
        // Clear existing header
        d3.selectAll('.matrix-header').remove();
        
        // Draw header - on top of panel background
        const headerGroup = svg.append('g')
            .attr('class', 'matrix-header')
            .style('opacity', 0)
            .raise(); // Place on top
        
        // Title "MATRIX VIEW" - Diegetic UI style
        headerGroup.append('text')
            .attr('x', startX)
            .attr('y', startY - 30)
            .text('MATRIX VIEW')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '13px')
            .style('font-weight', 'bold')
            .style('fill', '#c8ccd4') // Milk-gray text
            .style('letter-spacing', '1px')
            .style('opacity', 0.9);
        
        // Column headers - Diegetic UI style
        headerGroup.append('text')
            .attr('x', startX)
            .attr('y', startY - 10)
            .text('PID')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '11px')
            .style('font-weight', 'bold')
            .style('fill', '#c8ccd4') // Milk-gray text
            .style('opacity', 0.8);
        
        // Animate appearance after elements are added
        headerGroup.transition()
            .duration(300)
            .style('opacity', 1);
        
        // Resource headers - Diegetic UI: muted colors
        resources.forEach((r, i) => {
            headerGroup.append('text')
                .attr('x', resourceStartX + i * resourceSpacing)
                .attr('y', startY - 10)
                .text(r.label)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '11px')
                .style('font-weight', 'bold')
                .style('fill', r.color) // Muted colors
                .style('opacity', 0.8);
        });
        
        // Draw process rows
        const rowsData = this.matrixData.slice(0, 15); // Limit to 15 processes
        console.log('📝 Drawing', rowsData.length, 'process rows');
        
        const rows = svg.selectAll('.matrix-view-item')
            .data(rowsData, d => d.pid) // Use pid as key
        
        // Remove old rows
        rows.exit().remove();
        
        // Enter new rows - on top of panel background
        const rowsEnter = rows.enter()
            .append('g')
            .attr('class', 'matrix-view-item')
            .style('cursor', 'pointer')
            .raise(); // Place on top
        
        // Ensure rows stay on top
        rowsEnter.raise();
        
        // Update existing + new rows
        const rowsUpdate = rowsEnter.merge(rows)
            .attr('transform', (d, i) => `translate(0, ${startY + i * rowHeight})`)
            .style('opacity', 0)
            .on('click', (event, d) => {
                console.log('🖱️ Clicked on PID:', d.pid);
                this.selectedPid = d.pid;
                this.activateTimelineView();
            })
            .on('mouseenter', function() {
                // Diegetic UI: subtle highlight on hover
                d3.select(this).style('opacity', 1);
                // Slightly brighten text on hover
                d3.select(this).select('text.pid-text')
                    .style('fill', '#dde2ea') // Slightly brighter on hover
                    .style('opacity', 1);
            })
            .on('mouseleave', function() {
                d3.select(this).style('opacity', 0.85);
                // Restore original text color
                d3.select(this).select('text.pid-text')
                    .style('fill', '#c8ccd4') // Back to milk-gray
                    .style('opacity', 0.9);
            });
        
        // Ensure rows stay on top after all handlers are attached
        rowsUpdate.raise();
        
        console.log('✅ Created', rowsUpdate.size(), 'row elements');
        
        // PID - Diegetic UI style
        rowsUpdate.selectAll('text.pid-text').remove();
        rowsUpdate.append('text')
            .attr('class', 'pid-text')
            .attr('x', startX)
            .attr('y', 0)
            .text(d => d.pid)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '11px')
            .style('fill', '#c8ccd4') // Milk-gray text
            .style('font-weight', 'bold')
            .style('opacity', 0.9);
        
        // Resource bars
        resources.forEach((r, resIndex) => {
            rowsUpdate.selectAll(`g.resource-${r.key}`).remove();
            const resourceGroup = rowsUpdate.append('g')
                .attr('class', `resource-${r.key}`)
                .attr('transform', `translate(${resourceStartX + resIndex * resourceSpacing}, 0)`);
            
            // Background bar - Diegetic UI: darker, more subtle
            resourceGroup.append('rect')
                .attr('x', 0)
                .attr('y', -8)
                .attr('width', 60)
                .attr('height', 16)
                .style('fill', 'rgba(20, 26, 36, 0.6)') // Darker background
                .style('stroke', 'rgba(160, 170, 190, 0.2)') // Subtle border
                .style('stroke-width', '0.5px')
                .style('rx', 2);
            
            // Value bar - Diegetic UI: muted colors with subtle glow
            resourceGroup.append('rect')
                .attr('x', 0)
                .attr('y', -8)
                .attr('width', d => {
                    const value = d[r.key] || 0;
                    const normalized = Math.min(value / maxValues[r.key], 1);
                    return normalized * 60;
                })
                .attr('height', 16)
                .style('fill', r.color) // Muted color
                .style('opacity', 0.6) // More transparent
                .style('rx', 2);
            
            // Tooltip - Diegetic UI style
            resourceGroup.on('mouseenter', function(event, d) {
                const value = d[r.key] || 0;
                const tooltip = d3.select('body')
                    .append('div')
                    .attr('class', 'matrix-tooltip')
                    .style('position', 'absolute')
                    .style('background', 'rgba(12, 18, 28, 0.95)') // Diegetic UI background
                    .style('border', '1px solid rgba(160, 170, 190, 0.35)') // Subtle border
                    .style('color', '#c8ccd4') // Milk-gray text
                    .style('padding', '6px 10px')
                    .style('border-radius', '4px')
                    .style('font-size', '11px')
                    .style('pointer-events', 'none')
                    .style('z-index', '1001')
                    .style('font-family', 'Share Tech Mono, monospace')
                    .text(`${r.label}: ${value.toFixed(2)}`);
                
                const [x, y] = d3.pointer(event);
                tooltip
                    .style('left', (x + 10) + 'px')
                    .style('top', (y - 10) + 'px');
            })
            .on('mouseleave', function() {
                d3.selectAll('.matrix-tooltip').remove();
            });
        });
        
        // Animate appearance - Diegetic UI: subtle opacity
        rowsUpdate.transition()
            .duration(300)
            .delay((d, i) => i * 20)
            .style('opacity', 0.85) // Slightly more visible
            .on('end', function() {
                console.log('✅ Matrix row animation completed');
            });
        
        console.log('✅ Matrix View rendering completed, rows:', rowsUpdate.size());
    }

    renderTimelineFlow() {
        if (!this.selectedPid) return;
        
        // Clear existing timeline events
        d3.selectAll('.timeline-event').remove();
        
        // Fetch timeline data
        fetch(`http://localhost:5001/api/proc-timeline?pid=${this.selectedPid}`)
            .then(res => res.json())
            .then(data => {
                if (data.error) {
                    console.error('Timeline error:', data.error);
                    return;
                }
                
                this.timelineData = data.timeline || [];
                this.drawTimelineOnCurves();
            })
            .catch(error => {
                console.error('Error fetching timeline data:', error);
            });
    }

    drawTimelineOnCurves() {
        const svg = d3.select('svg');
        const bezierCurves = d3.selectAll('.bezier-curve').nodes();
        
        if (bezierCurves.length === 0 || this.timelineData.length === 0) return;
        
        const eventTypes = {
            'fork': { color: '#4a90e2', symbol: 'F' },
            'exec': { color: '#4ae24a', symbol: 'E' },
            'mmap': { color: '#e24a4a', symbol: 'M' },
            'read': { color: '#e2e24a', symbol: 'R' },
            'write': { color: '#e2e24a', symbol: 'W' },
            'connect': { color: '#9a4ae2', symbol: 'C' },
            'accept': { color: '#9a4ae2', symbol: 'A' },
            'exit': { color: '#666', symbol: 'X' }
        };
        
        // Distribute events across curves
        const eventsPerCurve = Math.ceil(this.timelineData.length / Math.min(bezierCurves.length, 10));
        let curveIndex = 0;
        
        this.timelineData.forEach((event, i) => {
            if (curveIndex >= bezierCurves.length) return;
            
            const curve = bezierCurves[curveIndex];
            const path = d3.select(curve);
            const pathElement = curve;
            
            // Calculate position along curve (distribute events)
            const totalLength = pathElement.getTotalLength();
            const offset = (i % eventsPerCurve) / eventsPerCurve;
            const point = pathElement.getPointAtLength(totalLength * offset);
            
            const eventType = eventTypes[event.type] || { color: '#888', symbol: '?' };
            
            // Create event marker
            const eventGroup = svg.append('g')
                .attr('class', 'timeline-event')
                .attr('transform', `translate(${point.x}, ${point.y})`)
                .style('opacity', 0);
            
            // Circle - darker, more subtle
            eventGroup.append('circle')
                .attr('r', 5)
                .style('fill', eventType.color)
                .style('fill-opacity', 0.8)
                .style('stroke', '#e0e0e0')
                .style('stroke-width', '1px');
            
            // Symbol - white text
            eventGroup.append('text')
                .text(eventType.symbol)
                .style('fill', '#ffffff')
                .style('font-size', '8px')
                .style('font-weight', 'bold')
                .style('text-anchor', 'middle')
                .style('dominant-baseline', 'middle')
                .attr('dy', '0.35em');
            
            // Highlight curve
            path
                .transition()
                .duration(200)
                .attr('stroke', eventType.color)
                .attr('stroke-width', 1.5)
                .attr('opacity', 0.6);
            
            // Animate appearance
            eventGroup.transition()
                .duration(300)
                .delay(i * 50)
                .style('opacity', 1);
            
            // Move to next curve every eventsPerCurve events
            if ((i + 1) % eventsPerCurve === 0) {
                curveIndex++;
            }
        });
    }

    startAutoUpdate() {
        this.stopAutoUpdate();
        this.updateInterval = setInterval(() => {
            if (this.currentView === 'matrix') {
                this.renderMatrixView();
            } else if (this.currentView === 'timeline') {
                this.renderTimelineFlow();
            }
        }, 2000); // Update every 2 seconds
    }

    stopAutoUpdate() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }
}
