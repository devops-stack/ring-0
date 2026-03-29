// Kernel Context Menu - Submenu and View Modes
// Version: 15

debugLog('🔧 kernel-context-menu.js v13: Script loading...');

class KernelContextMenu {
    constructor() {
        this.isVisible = false;
        this.currentView = null; // 'matrix', 'timeline', 'dna', 'kernel-flow', or null
        this.selectedPid = null;
        this.matrixData = [];
        this.timelineData = [];
        this.updateInterval = null;
        this.submenuGroup = null;
        this.dnaVisualization = null;
        this.networkVisualization = null;
        this.cryptoVisualization = null;
        this.devicesVisualization = null;
        this.filesVisualization = null;
        this.securityVisualization = null;
    }

    init() {
        // Kernel submenu removed; DNA view includes process timeline UI.
    }

    hideSubmenu() {
        d3.selectAll('.kernel-submenu').remove();
        this.submenuGroup = null;
    }

    activateMatrixView() {
        debugLog('🎯 activateMatrixView called');
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
        
        // DNA view has its own internal EXIT button.
        
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

    /**
     * Full-screen diagram: how data moves userspace → socket → TCP → kernel net stack → NIC.
     * Educational / illustrative ordering (real paths vary by workload).
     */
    activateKernelFlowMode() {
        debugLog('🌊 activateKernelFlowMode');
        this.currentView = 'kernel-flow';
        this.hideSubmenu();

        d3.selectAll('.kernel-flow-layer, .kernel-flow-backdrop').remove();

        d3.selectAll('.process-line, .process-circle, .process-name')
            .transition()
            .duration(300)
            .style('opacity', 0.15);

        d3.selectAll('.syscall-box, .syscall-text')
            .transition()
            .duration(300)
            .style('opacity', 0)
            .style('pointer-events', 'none')
            .style('visibility', 'hidden');

        d3.selectAll('.connection-box, .connection-text, .connection-details')
            .transition()
            .duration(300)
            .style('opacity', 0)
            .style('pointer-events', 'none');

        d3.selectAll('.tag-icon, .connection-line')
            .transition()
            .duration(300)
            .style('opacity', 0)
            .style('pointer-events', 'none')
            .style('visibility', 'hidden');

        d3.selectAll('.subsystem-indicator')
            .transition()
            .duration(300)
            .style('opacity', 0)
            .style('pointer-events', 'none')
            .style('visibility', 'hidden');

        if (window.syscallsManager) {
            window.syscallsManager.stopAutoUpdate();
        }
        if (window.connectionsManager) {
            window.connectionsManager.stopAutoUpdate();
        }

        d3.selectAll('.bezier-curve')
            .transition()
            .duration(400)
            .attr('opacity', 0.12);

        this.renderKernelFlowDiagram();
        this.addExitButton();
    }

    renderKernelFlowDiagram() {
        const svg = d3.select('svg');
        const width = window.innerWidth;
        const height = window.innerHeight;

        const backdrop = svg.append('rect')
            .attr('class', 'kernel-flow-backdrop')
            .attr('x', 0)
            .attr('y', 0)
            .attr('width', width)
            .attr('height', height)
            .attr('fill', 'rgba(2, 3, 6, 0.72)')
            .style('pointer-events', 'all');

        const g = svg.append('g').attr('class', 'kernel-flow-layer');

        const defs = g.append('defs');
        defs.append('marker')
            .attr('id', 'kernel-flow-arrowhead')
            .attr('viewBox', '0 -5 10 10')
            .attr('refX', 8)
            .attr('refY', 0)
            .attr('markerWidth', 5)
            .attr('markerHeight', 5)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M0,-5L10,0L0,5')
            .attr('fill', 'rgba(88, 182, 216, 0.75)');

        const steps = [
            { main: 'nginx', sub: 'userspace' },
            { main: 'socket', sub: 'fd · buffers' },
            { main: 'TCP', sub: 'sk_buff' },
            { main: 'kernel', sub: 'net stack' },
            { main: 'NIC', sub: 'driver → DMA' }
        ];

        const nodeW = Math.min(118, Math.max(88, (width - 160) / 6.2));
        const gap = Math.min(32, Math.max(14, (width - 160 - steps.length * nodeW) / (steps.length - 1)));
        const totalW = steps.length * nodeW + (steps.length - 1) * gap;
        const startX = (width - totalW) / 2;
        const cy = height * 0.44;

        g.append('text')
            .attr('x', width / 2)
            .attr('y', cy - 72)
            .attr('text-anchor', 'middle')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '13px')
            .style('fill', 'rgba(200, 210, 225, 0.92)')
            .style('letter-spacing', '2px')
            .text('KERNEL FLOW MODE');

        g.append('text')
            .attr('x', width / 2)
            .attr('y', cy - 48)
            .attr('text-anchor', 'middle')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '9px')
            .style('fill', 'rgba(120, 140, 160, 0.75)')
            .text('nginx → socket → TCP → kernel → NIC  ·  illustrative TX/RX path');

        steps.forEach((step, i) => {
            const x = startX + i * (nodeW + gap);
            const node = g.append('g').attr('transform', `translate(${x},${cy})`);

            node.append('rect')
                .attr('width', nodeW)
                .attr('height', 52)
                .attr('rx', 6)
                .attr('fill', 'rgba(12, 18, 28, 0.92)')
                .attr('stroke', 'rgba(88, 182, 216, 0.45)')
                .attr('stroke-width', 1);

            node.append('text')
                .attr('x', nodeW / 2)
                .attr('y', 22)
                .attr('text-anchor', 'middle')
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '12px')
                .style('fill', '#e8eef8')
                .text(step.main);

            node.append('text')
                .attr('x', nodeW / 2)
                .attr('y', 40)
                .attr('text-anchor', 'middle')
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '8px')
                .style('fill', 'rgba(140, 160, 185, 0.85)')
                .text(step.sub);

            if (i < steps.length - 1) {
                const x1 = x + nodeW + 4;
                const x2 = x + nodeW + gap - 4;
                g.append('line')
                    .attr('x1', x1)
                    .attr('y1', cy + 26)
                    .attr('x2', x2)
                    .attr('y2', cy + 26)
                    .attr('stroke', 'rgba(88, 182, 216, 0.55)')
                    .attr('stroke-width', 1.2)
                    .attr('marker-end', 'url(#kernel-flow-arrowhead)');
            }
        });

        g.append('text')
            .attr('x', width / 2)
            .attr('y', cy + 88)
            .attr('text-anchor', 'middle')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '8px')
            .style('fill', 'rgba(90, 105, 125, 0.8)')
            .text('Ordering is simplified; buffers, softirq, and qdisc can reorder work in real kernels.');

        g.style('opacity', 0)
            .transition()
            .duration(350)
            .style('opacity', 1);

        backdrop.style('opacity', 0)
            .transition()
            .duration(300)
            .style('opacity', 1);
    }

    activateDNAView() {
        debugLog('🧬 Activating Kernel DNA View');
        debugLog('🔍 KernelDNAVisualization available:', typeof KernelDNAVisualization);
        debugLog('🔍 window.KernelDNAVisualization available:', typeof window.KernelDNAVisualization);
        debugLog('🔍 THREE available:', typeof THREE);
        debugLog('🔍 THREE.WebGLRenderer available:', typeof THREE?.WebGLRenderer);
        debugLog('🔍 Current dnaVisualization:', this.dnaVisualization);
        
        this.currentView = 'dna';
        this.hideSubmenu();
        
        // Initialize DNA visualization if not already done
        if (!this.dnaVisualization) {
            debugLog('🔍 Checking KernelDNAVisualization availability...');
            debugLog('🔍 typeof KernelDNAVisualization:', typeof KernelDNAVisualization);
            debugLog('🔍 window.KernelDNAVisualization:', typeof window.KernelDNAVisualization);
            
            if (typeof KernelDNAVisualization !== 'undefined') {
                debugLog('✅ Creating new KernelDNAVisualization instance');
                try {
                    this.dnaVisualization = new KernelDNAVisualization();
                    debugLog('✅ Instance created, calling init()...');
                    const initResult = this.dnaVisualization.init();
                    if (initResult === false) {
                        console.error('❌ init() returned false - initialization failed');
                        this.dnaVisualization = null;
                        return;
                    }
                    debugLog('✅ KernelDNAVisualization initialized');
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
                debugLog('✅ Using window.KernelDNAVisualization');
                try {
                    this.dnaVisualization = new window.KernelDNAVisualization();
                    const initResult = this.dnaVisualization.init();
                    if (initResult === false) {
                        console.error('❌ init() returned false - initialization failed');
                        this.dnaVisualization = null;
                        return;
                    }
                    debugLog('✅ KernelDNAVisualization initialized from window');
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
            debugLog('✅ Using existing dnaVisualization instance');
        }

        if (this.dnaVisualization) {
            this.dnaVisualization.timelineMode = false;
            this.dnaVisualization.selectedPid = null;
            this.dnaVisualization.timeStart = null;
            this.dnaVisualization.currentTimelineHeight = 0;
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
        debugLog('🎯 Calling dnaVisualization.activate()');
        try {
            this.dnaVisualization.activate();
            debugLog('✅ DNA visualization activated');
        } catch (error) {
            console.error('❌ Error activating DNA visualization:', error);
        }
        
        // Add exit button
        this.addExitButton();
    }

    activateNetworkView() {
        debugLog('🌐 Activating Network Stack View');
        this.currentView = 'network';
        this.hideSubmenu();

        if (!this.networkVisualization) {
            if (typeof NetworkStackVisualization !== 'undefined') {
                try {
                    this.networkVisualization = new NetworkStackVisualization();
                    const initResult = this.networkVisualization.init();
                    if (initResult === false) {
                        this.networkVisualization = null;
                        return;
                    }
                } catch (error) {
                    console.error('❌ Error initializing NetworkStackVisualization:', error);
                    alert('Network Stack initialization error: ' + error.message);
                    return;
                }
            } else if (typeof window.NetworkStackVisualization !== 'undefined') {
                try {
                    this.networkVisualization = new window.NetworkStackVisualization();
                    const initResult = this.networkVisualization.init();
                    if (initResult === false) {
                        this.networkVisualization = null;
                        return;
                    }
                } catch (error) {
                    console.error('❌ Error initializing window.NetworkStackVisualization:', error);
                    alert('Network Stack initialization error: ' + error.message);
                    return;
                }
            } else {
                console.error('❌ NetworkStackVisualization class not loaded');
                alert('Network Stack visualization is not loaded. Check console for details.');
                return;
            }
        }

        // Hide base UI while network view is active.
        d3.selectAll('.syscall-box, .syscall-text').style('opacity', 0).style('pointer-events', 'none').style('visibility', 'hidden');
        d3.selectAll('.tag-icon, .connection-line').style('opacity', 0).style('pointer-events', 'none').style('visibility', 'hidden');
        d3.selectAll('.connection-box, .connection-text, .connection-details').style('opacity', 0).style('pointer-events', 'none').style('visibility', 'hidden');
        d3.selectAll('.subsystem-indicator').style('opacity', 0).style('pointer-events', 'none').style('visibility', 'hidden');
        d3.selectAll('.namespace-shell-layer, .cgroup-card-layer').style('opacity', 0).style('pointer-events', 'none').style('visibility', 'hidden');

        if (window.syscallsManager) {
            window.syscallsManager.stopAutoUpdate();
        }
        if (window.connectionsManager) {
            window.connectionsManager.stopAutoUpdate();
        }

        try {
            this.networkVisualization.activate();
            debugLog('✅ Network Stack visualization activated');
        } catch (error) {
            console.error('❌ Error activating Network Stack visualization:', error);
        }
    }

    activateCryptoView() {
        debugLog('🔐 Activating Crypto Subsystem View');
        this.currentView = 'crypto';
        this.hideSubmenu();

        if (!this.cryptoVisualization) {
            if (typeof CryptoSubsystemVisualization !== 'undefined') {
                try {
                    this.cryptoVisualization = new CryptoSubsystemVisualization();
                    const initResult = this.cryptoVisualization.init();
                    if (initResult === false) {
                        this.cryptoVisualization = null;
                        return;
                    }
                } catch (error) {
                    console.error('❌ Error initializing CryptoSubsystemVisualization:', error);
                    alert('Crypto view initialization error: ' + error.message);
                    return;
                }
            } else if (typeof window.CryptoSubsystemVisualization !== 'undefined') {
                try {
                    this.cryptoVisualization = new window.CryptoSubsystemVisualization();
                    const initResult = this.cryptoVisualization.init();
                    if (initResult === false) {
                        this.cryptoVisualization = null;
                        return;
                    }
                } catch (error) {
                    console.error('❌ Error initializing window.CryptoSubsystemVisualization:', error);
                    alert('Crypto view initialization error: ' + error.message);
                    return;
                }
            } else {
                console.error('❌ CryptoSubsystemVisualization class not loaded');
                alert('Crypto visualization is not loaded. Check console for details.');
                return;
            }
        }

        // Hide base UI while crypto view is active.
        d3.selectAll('.syscall-box, .syscall-text').style('opacity', 0).style('pointer-events', 'none').style('visibility', 'hidden');
        d3.selectAll('.tag-icon, .connection-line').style('opacity', 0).style('pointer-events', 'none').style('visibility', 'hidden');
        d3.selectAll('.connection-box, .connection-text, .connection-details').style('opacity', 0).style('pointer-events', 'none').style('visibility', 'hidden');
        d3.selectAll('.subsystem-indicator').style('opacity', 0).style('pointer-events', 'none').style('visibility', 'hidden');
        d3.selectAll('.namespace-shell-layer, .cgroup-card-layer').style('opacity', 0).style('pointer-events', 'none').style('visibility', 'hidden');

        if (window.syscallsManager) {
            window.syscallsManager.stopAutoUpdate();
        }
        if (window.connectionsManager) {
            window.connectionsManager.stopAutoUpdate();
        }

        try {
            this.cryptoVisualization.activate();
            debugLog('✅ Crypto Subsystem visualization activated');
        } catch (error) {
            console.error('❌ Error activating Crypto Subsystem visualization:', error);
        }
    }

    activateDevicesView() {
        debugLog('🧲 Activating Devices Belt View');
        this.currentView = 'devices';
        this.hideSubmenu();

        if (!this.devicesVisualization) {
            if (typeof DevicesBeltVisualization !== 'undefined') {
                try {
                    this.devicesVisualization = new DevicesBeltVisualization();
                    const initResult = this.devicesVisualization.init();
                    if (initResult === false) {
                        this.devicesVisualization = null;
                        return;
                    }
                } catch (error) {
                    console.error('❌ Error initializing DevicesBeltVisualization:', error);
                    alert('Devices view initialization error: ' + error.message);
                    return;
                }
            } else if (typeof window.DevicesBeltVisualization !== 'undefined') {
                try {
                    this.devicesVisualization = new window.DevicesBeltVisualization();
                    const initResult = this.devicesVisualization.init();
                    if (initResult === false) {
                        this.devicesVisualization = null;
                        return;
                    }
                } catch (error) {
                    console.error('❌ Error initializing window.DevicesBeltVisualization:', error);
                    alert('Devices view initialization error: ' + error.message);
                    return;
                }
            } else {
                console.error('❌ DevicesBeltVisualization class not loaded');
                alert('Devices visualization is not loaded. Check console for details.');
                return;
            }
        }

        d3.selectAll('.syscall-box, .syscall-text').style('opacity', 0).style('pointer-events', 'none').style('visibility', 'hidden');
        d3.selectAll('.tag-icon, .connection-line').style('opacity', 0).style('pointer-events', 'none').style('visibility', 'hidden');
        d3.selectAll('.connection-box, .connection-text, .connection-details').style('opacity', 0).style('pointer-events', 'none').style('visibility', 'hidden');
        d3.selectAll('.subsystem-indicator').style('opacity', 0).style('pointer-events', 'none').style('visibility', 'hidden');
        d3.selectAll('.namespace-shell-layer, .cgroup-card-layer').style('opacity', 0).style('pointer-events', 'none').style('visibility', 'hidden');

        if (window.syscallsManager) {
            window.syscallsManager.stopAutoUpdate();
        }
        if (window.connectionsManager) {
            window.connectionsManager.stopAutoUpdate();
        }

        try {
            this.devicesVisualization.activate();
            debugLog('✅ Devices Belt visualization activated');
        } catch (error) {
            console.error('❌ Error activating Devices Belt visualization:', error);
        }
    }

    activateFilesView() {
        debugLog('🗂️ Activating Filesystem Map View');
        this.currentView = 'files';
        this.hideSubmenu();

        if (!this.filesVisualization) {
            if (typeof FilesystemMapVisualization !== 'undefined') {
                try {
                    this.filesVisualization = new FilesystemMapVisualization();
                    const initResult = this.filesVisualization.init();
                    if (initResult === false) {
                        this.filesVisualization = null;
                        return;
                    }
                } catch (error) {
                    console.error('❌ Error initializing FilesystemMapVisualization:', error);
                    alert('Files view initialization error: ' + error.message);
                    return;
                }
            } else if (typeof window.FilesystemMapVisualization !== 'undefined') {
                try {
                    this.filesVisualization = new window.FilesystemMapVisualization();
                    const initResult = this.filesVisualization.init();
                    if (initResult === false) {
                        this.filesVisualization = null;
                        return;
                    }
                } catch (error) {
                    console.error('❌ Error initializing window.FilesystemMapVisualization:', error);
                    alert('Files view initialization error: ' + error.message);
                    return;
                }
            } else {
                console.error('❌ FilesystemMapVisualization class not loaded');
                alert('Files visualization is not loaded. Check console for details.');
                return;
            }
        }

        d3.selectAll('.syscall-box, .syscall-text').style('opacity', 0).style('pointer-events', 'none').style('visibility', 'hidden');
        d3.selectAll('.tag-icon, .connection-line').style('opacity', 0).style('pointer-events', 'none').style('visibility', 'hidden');
        d3.selectAll('.connection-box, .connection-text, .connection-details').style('opacity', 0).style('pointer-events', 'none').style('visibility', 'hidden');
        d3.selectAll('.subsystem-indicator').style('opacity', 0).style('pointer-events', 'none').style('visibility', 'hidden');
        d3.selectAll('.namespace-shell-layer, .cgroup-card-layer').style('opacity', 0).style('pointer-events', 'none').style('visibility', 'hidden');

        if (window.syscallsManager) {
            window.syscallsManager.stopAutoUpdate();
        }
        if (window.connectionsManager) {
            window.connectionsManager.stopAutoUpdate();
        }

        try {
            this.filesVisualization.activate();
            debugLog('✅ Filesystem Map visualization activated');
        } catch (error) {
            console.error('❌ Error activating Filesystem Map visualization:', error);
        }
    }

    activateSecurityView() {
        debugLog('🛡️ Activating Security Subsystem View');
        this.currentView = 'security';
        this.hideSubmenu();

        if (!this.securityVisualization) {
            if (typeof SecuritySubsystemVisualization !== 'undefined') {
                try {
                    this.securityVisualization = new SecuritySubsystemVisualization();
                    const initResult = this.securityVisualization.init();
                    if (initResult === false) {
                        this.securityVisualization = null;
                        return;
                    }
                } catch (error) {
                    console.error('❌ Error initializing SecuritySubsystemVisualization:', error);
                    alert('Security view initialization error: ' + error.message);
                    return;
                }
            } else if (typeof window.SecuritySubsystemVisualization !== 'undefined') {
                try {
                    this.securityVisualization = new window.SecuritySubsystemVisualization();
                    const initResult = this.securityVisualization.init();
                    if (initResult === false) {
                        this.securityVisualization = null;
                        return;
                    }
                } catch (error) {
                    console.error('❌ Error initializing window.SecuritySubsystemVisualization:', error);
                    alert('Security view initialization error: ' + error.message);
                    return;
                }
            } else {
                console.error('❌ SecuritySubsystemVisualization class not loaded');
                alert('Security visualization is not loaded. Check console for details.');
                return;
            }
        }

        d3.selectAll('.syscall-box, .syscall-text').style('opacity', 0).style('pointer-events', 'none').style('visibility', 'hidden');
        d3.selectAll('.tag-icon, .connection-line').style('opacity', 0).style('pointer-events', 'none').style('visibility', 'hidden');
        d3.selectAll('.connection-box, .connection-text, .connection-details').style('opacity', 0).style('pointer-events', 'none').style('visibility', 'hidden');
        d3.selectAll('.subsystem-indicator').style('opacity', 0).style('pointer-events', 'none').style('visibility', 'hidden');
        d3.selectAll('.namespace-shell-layer, .cgroup-card-layer').style('opacity', 0).style('pointer-events', 'none').style('visibility', 'hidden');

        if (window.syscallsManager) {
            window.syscallsManager.stopAutoUpdate();
        }
        if (window.connectionsManager) {
            window.connectionsManager.stopAutoUpdate();
        }

        try {
            this.securityVisualization.activate();
            debugLog('✅ Security Subsystem visualization activated');
        } catch (error) {
            console.error('❌ Error activating Security Subsystem visualization:', error);
        }
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
        if (this.networkVisualization) {
            this.networkVisualization.deactivate();
        }
        if (this.cryptoVisualization) {
            this.cryptoVisualization.deactivate();
        }
        if (this.devicesVisualization) {
            this.devicesVisualization.deactivate();
        }
        if (this.filesVisualization) {
            this.filesVisualization.deactivate();
        }
        if (this.securityVisualization) {
            this.securityVisualization.deactivate();
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
            .style('pointer-events', 'all')
            .style('visibility', 'visible');

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

        d3.selectAll('.namespace-shell-layer, .cgroup-card-layer')
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

        d3.selectAll('.kernel-flow-layer, .kernel-flow-backdrop').remove();
        
        // Restore Bezier curves - ensure all curves are visible with original styles
        d3.selectAll('.bezier-curve')
            .transition()
            .duration(300)
            .attr('stroke', function() {
                return d3.select(this).attr('data-original-stroke') || 'rgba(60, 60, 60, 0.3)';
            })
            .attr('stroke-width', function() {
                return d3.select(this).attr('data-original-stroke-width') || 0.8;
            })
            .attr('opacity', function() {
                return d3.select(this).attr('data-original-opacity') || 0.3;
            })
            .style('visibility', 'visible'); // Ensure visibility is restored
        
        // Stop auto-update
        this.stopAutoUpdate();
    }
    
    // Public method to deactivate from outside
    exitView() {
        this.deactivateViews();
    }

    renderMatrixView() {
        debugLog('🎯 renderMatrixView called');
        // Clear only matrix rows; keep panel, backdrop and header to avoid full-screen flicker
        d3.selectAll('.matrix-view-item').remove();
        
        // Fetch matrix data
        fetch('/api/proc-matrix')
            .then(res => {
                debugLog('📡 Matrix API response status:', res.status);
                return res.json();
            })
            .then(data => {
                debugLog('📊 Matrix data received:', data);
                if (data.error) {
                    console.error('Matrix error:', data.error);
                    return;
                }
                
                this.matrixData = data.matrix || [];
                debugLog('📋 Matrix data array length:', this.matrixData.length);
                this.drawMatrixList();
            })
            .catch(error => {
                console.error('Error fetching matrix data:', error);
            });
    }

    drawMatrixList() {
        debugLog('🎯 drawMatrixList called, data length:', this.matrixData.length);
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
        debugLog('📝 Drawing', rowsData.length, 'process rows');
        
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
                debugLog('🖱️ Clicked on PID:', d.pid);
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
        
        debugLog('✅ Created', rowsUpdate.size(), 'row elements');
        
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
                debugLog('✅ Matrix row animation completed');
            });
        
        debugLog('✅ Matrix View rendering completed, rows:', rowsUpdate.size());
    }

    renderTimelineFlow() {
        if (!this.selectedPid) return;
        
        // Clear existing timeline events
        d3.selectAll('.timeline-event').remove();
        
        // Fetch timeline data
        fetch(`/api/proc-timeline?pid=${this.selectedPid}`)
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
