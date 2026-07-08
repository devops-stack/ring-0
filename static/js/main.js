// Main JavaScript file for Linux Kernel Visualization


// Global variables
const svg = d3.select("svg");
let syscallsManager;
let resizeTimeout;
let nginxFilesManager;
let rightSemicircleMenuManager;
let connectionsManager; // make available for cleanup handlers
let pinnedProcessDossier = null;
const MOBILE_LAYOUT_BREAKPOINT = 900;
const MOBILE_TOUCH_SHORT_SIDE = 820;
function isMobileLayout() {
    // Primary signal: narrow viewport.
    if (window.innerWidth <= MOBILE_LAYOUT_BREAKPOINT) return true;

    // Fallback for touch devices that report a wide viewport (large phones,
    // phones in landscape, small tablets, in-app browsers). The desktop
    // composition is built for ~1400px and overflows these screens, leaving
    // only the central circle visible — so route them to the mobile layout too.
    const mm = typeof window.matchMedia === 'function' ? window.matchMedia.bind(window) : null;
    const isTouch = (mm && (mm('(pointer: coarse)').matches || mm('(hover: none)').matches))
        || (typeof navigator !== 'undefined' && Number(navigator.maxTouchPoints || 0) > 0);
    const shortSide = Math.min(window.innerWidth, window.innerHeight);
    if (isTouch && shortSide <= MOBILE_TOUCH_SHORT_SIDE) return true;

    return false;
}

function syncRealtimeFeedsForViewport() {
    const mobile = isMobileLayout();
    if (connectionsManager) {
        if (mobile) {
            connectionsManager.stopAutoUpdate();
            d3.selectAll('.connection-row, .connection-box, .connection-text, .connection-details, .connection-header').remove();
        } else {
            // Prevent duplicate timers on repeated resize transitions.
            connectionsManager.stopAutoUpdate();
            connectionsManager.startAutoUpdate(3000);
        }
    }
    if (syscallsManager) {
        if (mobile) {
            syscallsManager.stopAutoUpdate();
            d3.selectAll('.syscall-box, .syscall-text, .syscall-panel-group').remove();
        } else {
            syscallsManager.stopAutoUpdate();
            syscallsManager.startAutoUpdate(3000);
        }
    }
}

// Application initialization
function initApp() {
    debugLog('🚀 Initializing Linux Kernel Visualization');
    
    // Initialize system calls manager
    syscallsManager = new SyscallsManager();
    
    // Initialize active connections manager (store in global for cleanup)
    connectionsManager = new ActiveConnectionsManager();
    // Expose to window so KernelContextMenu can pause/resume updates
    window.connectionsManager = connectionsManager;
    
    window.nginxFilesManager = new NginxFilesManager();
    
    // Initialize right semicircle menu manager
    debugLog('🎯 RightSemicircleMenuManager class available:', typeof RightSemicircleMenuManager);
    if (typeof RightSemicircleMenuManager !== 'undefined') {
        window.rightSemicircleMenuManager = new RightSemicircleMenuManager();
        debugLog('🎯 RightSemicircleMenuManager initialized:', window.rightSemicircleMenuManager);
    } else {
        console.error('❌ RightSemicircleMenuManager class not found!');
    }
    
    // Initialize Kernel Context Menu
    debugLog('🎯 KernelContextMenu class available:', typeof KernelContextMenu);
    if (typeof KernelContextMenu !== 'undefined') {
        window.kernelContextMenu = new KernelContextMenu();
        window.kernelContextMenu.init();
        debugLog('🎯 KernelContextMenu initialized:', window.kernelContextMenu);
    } else {
        console.error('❌ KernelContextMenu class not found!');
    }
    
    // Draw main interface FIRST
    draw();
    
    // Then render semicircle AFTER draw() completes
    setTimeout(() => {
        if (window.rightSemicircleMenuManager && !isMobileLayout()) {
            debugLog('🎯 Force rendering semicircle after draw()...');
            window.rightSemicircleMenuManager.renderRightSemicircleMenu();
        } else if (window.rightSemicircleMenuManager && isMobileLayout()) {
            window.rightSemicircleMenuManager.hide();
        }
    }, 100);

    // Start/stop realtime side feeds according to viewport.
    syncRealtimeFeedsForViewport();
    
    // Update panel data periodically
    updatePanelData();
    setInterval(updatePanelData, 5000); // Update every 5 seconds
    
    // Setup event handlers
    setupEventListeners();

    // When nginx serves SPA fallback (/index.html) for subsystem route aliases,
    // open dedicated views automatically by route.
    const path = String(window.location.pathname || '').replace(/\/+$/, '') || '/';
    if ((path === '/crypto' || path === '/linux-crypto-subsystem')
        && window.kernelContextMenu
        && typeof window.kernelContextMenu.activateCryptoView === 'function') {
        setTimeout(() => {
            window.kernelContextMenu.activateCryptoView();
        }, 140);
    }
    if ((path === '/security' || path === '/linux-security-subsystem')
        && window.kernelContextMenu
        && typeof window.kernelContextMenu.activateSecurityView === 'function') {
        setTimeout(() => {
            window.kernelContextMenu.activateSecurityView();
        }, 160);
    }
}

// Setup event handlers
function setupEventListeners() {
    window.addEventListener('syscall-subsystem-focus', (event) => {
        const detail = (event && event.detail) || {};
        if (window.SubsystemFocus && typeof window.SubsystemFocus.setFocus === 'function') {
            window.SubsystemFocus.setFocus(detail.subsystemKey || null);
        }
    });

    // Window resize handler
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            syncRealtimeFeedsForViewport();
            draw();
            // Render semicircle after draw() completes
            setTimeout(() => {
                if (window.rightSemicircleMenuManager && !isMobileLayout()) {
                    debugLog('🎯 Force rendering semicircle after resize...');
                    window.rightSemicircleMenuManager.renderRightSemicircleMenu();
                } else if (window.rightSemicircleMenuManager && isMobileLayout()) {
                    window.rightSemicircleMenuManager.hide();
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
    const width = window.innerWidth;
    const height = window.innerHeight;
    const centerX = width / 2;
    const centerY = height / 2;
    const mobileLayout = isMobileLayout();

    // Skip drawing if Matrix View is active to prevent elements from appearing above it
    if (!mobileLayout && window.kernelContextMenu && (
        window.kernelContextMenu.currentView === 'matrix' ||
        window.kernelContextMenu.currentView === 'kernel-flow'
    )) {
        debugLog('⏸️ Skipping draw() - Matrix or Kernel Flow view is active');
        return;
    }
    
    // Skip drawing if Kernel DNA View is active to prevent style changes to process lines
    if (!mobileLayout && window.kernelContextMenu && (
        window.kernelContextMenu.currentView === 'dna' ||
        window.kernelContextMenu.currentView === 'dna-timeline' ||
        window.kernelContextMenu.currentView === 'network' ||
        window.kernelContextMenu.currentView === 'devices' ||
        window.kernelContextMenu.currentView === 'files' ||
        window.kernelContextMenu.currentView === 'security'
    )) {
        debugLog('⏸️ Skipping draw() - overlay view is active');
        return;
    }

    // Safety: ensure overlay containers never leak into the main view.
    ['kernel-dna-container', 'network-stack-container', 'devices-belt-container', 'filesystem-map-container', 'security-belt-container'].forEach((id) => {
        const node = document.getElementById(id);
        if (node) {
            node.style.display = 'none';
            node.style.visibility = 'hidden';
            node.style.pointerEvents = 'none';
        }
    });

    if (mobileLayout) {
        // Hard reset for mobile to avoid residual desktop layers.
        svg.selectAll('*').remove();
        d3.selectAll('.connection-row, .connection-box, .connection-text, .connection-details, .connection-header').remove();
        d3.selectAll('.syscall-box, .syscall-text, .syscall-panel-group').remove();
        d3.selectAll('.bezier-curve, .bezier-decor-layer, .bezier-core-bridge').remove();
        d3.selectAll('.namespace-shell-layer, .cgroup-card-layer, .subsystem-indicator').remove();
        d3.selectAll('.tooltip, .ipc-link-tooltip').remove();
        if (window.rightSemicircleMenuManager) {
            window.rightSemicircleMenuManager.hide();
        }
        // The desktop composition is authored in raw pixels for ~1400px. On a
        // phone that overflows and only the central rings stay on-screen. Frame
        // the hero with a viewBox so the whole composition scales to fit and
        // stays centered (pointer/tooltip math uses pageX/Y, so hit-testing is
        // unaffected by the coordinate scaling).
        const frameHalf = 255;
        svg.attr('viewBox', `${centerX - frameHalf} ${centerY - frameHalf} ${frameHalf * 2} ${frameHalf * 2}`)
            .attr('preserveAspectRatio', 'xMidYMid meet');
    } else {
        // Desktop renders 1:1 with the viewport — make sure no mobile viewBox lingers.
        svg.attr('viewBox', null).attr('preserveAspectRatio', null);
        hideMobileHud();
        hideMobileNotice();
        // Clear all elements to prevent duplication, but preserve system calls
        // and Kernel analysis overlay (Matrix / Timeline submenu & elements)
        const preserveClasses = '.syscall-box, .syscall-text, .matrix-view-item, .matrix-header, .matrix-panel-bg, .matrix-backdrop, .kernel-exit-button, .kernel-dna-exit-button, .kernel-submenu';
        svg.selectAll(`*:not(${preserveClasses.split(', ').join('):not(')})`).remove();
        // Also remove system calls explicitly to ensure clean state
        svg.selectAll(".syscall-box, .syscall-text").remove();
    }

    svg.on('click.processDossierClear', function(event) {
        const target = event.target;
        if (target && target.closest && target.closest('.process-node-group')) return;
        clearPinnedProcessDossier();
    });

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
    drawCentralPulseGridForeground(centerX, centerY);

    // Mobile mode: keep only the central process composition.
    if (mobileLayout) {
        // Keep Icon1 content in mobile center composition as requested.
        drawTagIcons(centerX, centerY);
        drawMobileFormulaAndCaption(centerX, centerY, width, height);
        // Draw process ring only (no side/bottom UI layers, no tag/menu shells).
        drawProcessKernelMap2(centerX, centerY);
        drawMobileDefaultProcessLabels(centerX, centerY);
        // Restore namespace shell segments in mobile mode.
        drawIsolationConceptLayer(centerX, centerY, width, height);
        // Live, readable kernel metrics at the bottom (HTML overlay).
        renderMobileHud();
        // Advise that the full experience is built for desktop.
        renderMobileNotice();
        return;
    }

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
        const cv = window.kernelContextMenu && window.kernelContextMenu.currentView;
        if (syscallsManager && cv !== 'matrix' && cv !== 'kernel-flow') {
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

function drawMobileFormulaAndCaption(centerX, centerY, width, height) {
    const group = svg.append('g')
        .attr('class', 'mobile-formula-layer')
        .attr('pointer-events', 'none');

    const formulaY = Math.max(34, centerY - 245);
    const captionY = Math.min(height - 22, centerY + 235);

    // Subtle text-only treatment to keep the mobile center clean.
    group.append('text')
        .attr('x', centerX)
        .attr('y', formulaY)
        .attr('text-anchor', 'middle')
        .style('font-family', 'JetBrains Mono, Share Tech Mono, monospace')
        .style('font-size', '13px')
        .style('letter-spacing', '-0.1px')
        .style('fill', 'rgba(52, 52, 52, 0.76)')
        .text('L_new=L_old*e^(-dt/tau)+N*(1-e^(-dt/tau))');

    group.append('text')
        .attr('x', centerX)
        .attr('y', captionY)
        .attr('text-anchor', 'middle')
        .style('font-family', 'Share Tech Mono, monospace')
        .style('font-size', '11px')
        .style('letter-spacing', '0.4px')
        .style('fill', 'rgba(62, 62, 62, 0.58)')
        .text('linux kernel · live process map');
}

function drawMobileDefaultProcessLabels(centerX, centerY) {
    if (!isMobileLayout()) return;
    const names = ['sshd', 'python3', 'nginx', 'cron', 'bash', 'systemd'];
    const radius = 95;
    const startAngle = -Math.PI / 2;
    const step = (2 * Math.PI) / names.length;

    const group = svg.append('g')
        .attr('class', 'mobile-default-process-labels')
        .attr('pointer-events', 'none');

    names.forEach((name, i) => {
        const angle = startAngle + i * step;
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;
        group.append('text')
            .attr('x', x)
            .attr('y', y)
            .attr('text-anchor', 'middle')
            .style('font-family', 'JetBrains Mono, Share Tech Mono, monospace')
            .style('font-size', '9px')
            .style('letter-spacing', '0.15px')
            .style('fill', 'rgba(96, 96, 96, 0.52)')
            .text(name);
    });
}

// ---- Mobile HUD: a compact, readable strip of live kernel metrics ----------
// The hero is decorative; on a phone we still want real, glanceable numbers.
// Pure HTML overlay (fixed), so the SVG viewBox scaling never touches it.
let mobileHudTimer = null;
const MOBILE_HUD_TILES = [
    { id: 'procs', label: 'PROCS' },
    { id: 'mem', label: 'MEM' },
    { id: 'disk', label: 'DISK' },
    { id: 'faults', label: 'FAULTS/s' }
];

function renderMobileHud() {
    let hud = document.getElementById('mobile-hud');
    if (!hud) {
        hud = document.createElement('div');
        hud.id = 'mobile-hud';
        Object.assign(hud.style, {
            position: 'fixed', left: '0', right: '0', bottom: '0', zIndex: '8000',
            display: 'flex', gap: '1px', justifyContent: 'center',
            padding: '8px 8px calc(8px + env(safe-area-inset-bottom))',
            background: 'linear-gradient(0deg, rgba(8,10,13,0.94) 0%, rgba(8,10,13,0.0) 100%)',
            fontFamily: "'JetBrains Mono','Share Tech Mono',monospace", pointerEvents: 'none'
        });
        MOBILE_HUD_TILES.forEach((tile) => {
            const cell = document.createElement('div');
            Object.assign(cell.style, {
                flex: '1 1 0', maxWidth: '120px', textAlign: 'center',
                background: 'rgba(16,20,27,0.9)', border: '1px solid rgba(103,190,224,0.22)',
                borderRadius: '8px', padding: '7px 4px 8px', margin: '0 3px'
            });
            const val = document.createElement('div');
            val.id = `mobile-hud-${tile.id}`;
            val.textContent = '--';
            Object.assign(val.style, { color: '#dbe6ef', fontSize: '15px', fontWeight: '600', lineHeight: '1.1' });
            const lab = document.createElement('div');
            lab.textContent = tile.label;
            Object.assign(lab.style, { color: '#6f8895', fontSize: '8.5px', letterSpacing: '1px', marginTop: '3px' });
            cell.append(val, lab);
            hud.appendChild(cell);
        });
        document.body.appendChild(hud);
    }
    hud.style.display = 'flex';
    if (!mobileHudTimer) {
        updateMobileHud();
        mobileHudTimer = setInterval(updateMobileHud, 5000);
    }
}

function hideMobileHud() {
    const hud = document.getElementById('mobile-hud');
    if (hud) hud.style.display = 'none';
    if (mobileHudTimer) {
        clearInterval(mobileHudTimer);
        mobileHudTimer = null;
    }
}

// Top banner advising that the experience is built for desktop. Dismissible,
// and once dismissed it stays hidden for the session.
function renderMobileNotice() {
    if (window.__mobileNoticeDismissed) return;
    let notice = document.getElementById('mobile-notice');
    if (!notice) {
        notice = document.createElement('div');
        notice.id = 'mobile-notice';
        Object.assign(notice.style, {
            position: 'fixed', left: '0', right: '0', top: '0', zIndex: '8200',
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '9px 12px', paddingTop: 'calc(9px + env(safe-area-inset-top))',
            background: 'rgba(12,16,22,0.92)', borderBottom: '1px solid rgba(103,190,224,0.25)',
            backdropFilter: 'blur(4px)',
            fontFamily: "'JetBrains Mono','Share Tech Mono',monospace", color: '#bcd3de'
        });
        const icon = document.createElement('span');
        icon.textContent = '🖥';
        Object.assign(icon.style, { fontSize: '13px', flex: '0 0 auto', opacity: '0.9' });
        const text = document.createElement('span');
        text.textContent = 'Best viewed on desktop — this dashboard is designed for a large screen.';
        Object.assign(text.style, { flex: '1 1 auto', fontSize: '11px', lineHeight: '1.35', letterSpacing: '0.2px' });
        const close = document.createElement('button');
        close.textContent = '×';
        Object.assign(close.style, {
            flex: '0 0 auto', cursor: 'pointer', background: 'transparent', border: 'none',
            color: '#7f97a4', fontSize: '18px', lineHeight: '1', padding: '0 2px'
        });
        close.addEventListener('click', () => {
            window.__mobileNoticeDismissed = true;
            notice.style.display = 'none';
        });
        notice.append(icon, text, close);
        document.body.appendChild(notice);
    }
    notice.style.display = 'flex';
}

function hideMobileNotice() {
    const notice = document.getElementById('mobile-notice');
    if (notice) notice.style.display = 'none';
}

function setHudTile(id, text) {
    const node = document.getElementById(`mobile-hud-${id}`);
    if (node) node.textContent = text;
}

function updateMobileHud() {
    if (!isMobileLayout()) { hideMobileHud(); return; }
    const fetchJson = window.fetchJson || ((url) => fetch(url, { cache: 'no-store' }).then((r) => r.json()));
    fetchJson('/api/kernel-data', { cache: 'no-store' }, { timeoutMs: 6000, retries: 0, context: 'mobile-hud' })
        .then((d) => {
            if (!d) return;
            if (d.processes !== undefined) setHudTile('procs', String(d.processes));
            const st = d.system_stats || {};
            if (st.memory_total) setHudTile('mem', `${Math.round(st.memory_total / (1024 ** 3))}G`);
            if (st.disk_usage !== undefined) setHudTile('disk', `${Math.round(st.disk_usage)}%`);
        })
        .catch(() => {});
    fetchJson('/api/io-pulse', { cache: 'no-store' }, { timeoutMs: 5000, retries: 0, context: 'mobile-hud' })
        .then((d) => {
            if (!d) return;
            const pf = Number(d.pgfault_per_sec || 0);
            setHudTile('faults', pf >= 1000 ? `${(pf / 1000).toFixed(1)}k` : String(Math.round(pf)));
        })
        .catch(() => {});
}

function formatProcessValue(value, fallback = 'n/a') {
    return value === null || value === undefined || value === '' ? fallback : value;
}

function processDossierRows(processData, details = {}) {
    const threadsData = details.threadsData || {};
    const cpuData = details.cpuData || {};
    const fdsData = details.fdsData || {};
    const cpuTimes = cpuData.cpu_times || {};
    return [
        ['identity', `${formatProcessValue(processData.name, 'process')} · pid ${formatProcessValue(processData.pid)}`],
        ['state', `${formatProcessValue(processData.status)} · mem ${formatProcessValue(processData.memory_mb, 0)} MB`],
        ['threads', formatProcessValue(threadsData.thread_count, 'loading')],
        ['vol ctx', threadsData.voluntary_ctxt_switches ? threadsData.voluntary_ctxt_switches.toLocaleString() : 'loading'],
        ['nonvol ctx', threadsData.nonvoluntary_ctxt_switches ? threadsData.nonvoluntary_ctxt_switches.toLocaleString() : 'loading'],
        ['cpu time', cpuTimes.user !== undefined ? `usr ${cpuTimes.user}s · sys ${cpuTimes.system}s` : 'loading'],
        ['nice', cpuData.nice !== undefined && cpuData.nice !== null ? cpuData.nice : 'loading'],
        ['fds', fdsData.num_fds !== undefined ? fdsData.num_fds : formatProcessValue(processData.num_fds, 'loading')],
        ['open files', Array.isArray(fdsData.open_files) ? fdsData.open_files.length : 'loading'],
        ['sockets', Array.isArray(fdsData.connections) ? fdsData.connections.length : 'loading']
    ];
}

function processIoSummary(processData, details = {}) {
    const fdsData = details.fdsData || {};
    return {
        fds: fdsData.num_fds !== undefined ? fdsData.num_fds : formatProcessValue(processData.num_fds, 0),
        files: Array.isArray(fdsData.open_files) ? fdsData.open_files.length : 0,
        sockets: Array.isArray(fdsData.connections) ? fdsData.connections.length : 0
    };
}

function descriptorTone(type) {
    const normalized = String(type || '').toLowerCase();
    if (normalized.includes('stdin') || normalized.includes('stdout') || normalized.includes('stderr')) return '#2f2f2f';
    if (normalized.includes('unix')) return '#1f1f1f';
    if (normalized.includes('tcp') || normalized.includes('inet') || normalized.includes('socket')) return '#17455a';
    if (normalized.includes('pipe')) return '#5a5a5a';
    if (normalized.includes('file')) return '#634a1f';
    return '#4a4a4a';
}

function descriptorTargetLabel(descriptor) {
    if (!descriptor) return '';
    if (descriptor.remote_address) return descriptor.remote_address;
    if (descriptor.local_address) return descriptor.local_address;
    return String(descriptor.target || '');
}

function processControlStrip(processData, details = {}) {
    const threadsData = details.threadsData || {};
    const cpuData = details.cpuData || {};
    const io = processIoSummary(processData, details);
    const cpuPercent = Number(cpuData.cpu_percent || processData.cpu_percent || 0);
    const memoryMb = Number(processData.memory_mb || 0);
    const threadCount = Number(threadsData.thread_count || processData.num_threads || 0);
    return [
        { id: 'SYSCALL', active: true, value: formatProcessValue(processData.status, 'state') },
        { id: 'VFS', active: io.files > 0, value: `${io.files} files` },
        { id: 'SOCKET', active: io.sockets > 0, value: `${io.sockets} conns` },
        { id: 'IRQ', active: threadCount > 8, value: `${threadCount} th` },
        { id: 'SCHED', active: cpuPercent > 0 || threadCount > 1, value: `${cpuPercent}% cpu` },
        { id: 'MEM', active: memoryMb > 1, value: `${memoryMb.toFixed ? memoryMb.toFixed(1) : memoryMb} MB` },
        { id: 'FD', active: Number(io.fds || 0) > 0, value: `${io.fds} fd` }
    ];
}

function processTraceMapSteps(processData, details = {}) {
    const threadsData = details.threadsData || {};
    const cpuData = details.cpuData || {};
    const io = processIoSummary(processData, details);
    const threadCount = Number(threadsData.thread_count || processData.num_threads || 0);
    const cpuPercent = Number(cpuData.cpu_percent || processData.cpu_percent || 0);
    return [
        {
            id: 'PROCESS',
            title: String(processData.name || 'process').slice(0, 14),
            value: `pid ${formatProcessValue(processData.pid)}`,
            active: true
        },
        {
            id: 'FD TABLE',
            title: 'FD TABLE',
            value: `${io.fds} fd`,
            active: Number(io.fds || 0) > 0
        },
        {
            id: 'VFS',
            title: 'VFS',
            value: `${io.files} files`,
            active: Number(io.files || 0) > 0
        },
        {
            id: 'SOCKET/PIPE',
            title: 'SOCKET/PIPE',
            value: `${io.sockets} sockets`,
            active: Number(io.sockets || 0) > 0
        },
        {
            id: 'SCHED',
            title: 'SCHED',
            value: `${threadCount} th · ${cpuPercent}%`,
            active: threadCount > 1 || cpuPercent > 0
        },
        {
            id: 'KERNEL',
            title: 'KERNEL',
            value: formatProcessValue(processData.status, 'state'),
            active: true
        }
    ];
}

function processInteractionNodes(processData, details = {}) {
    const threadsData = details.threadsData || {};
    const cpuData = details.cpuData || {};
    const io = processIoSummary(processData, details);
    const cpuPercent = Number(cpuData.cpu_percent || processData.cpu_percent || 0);
    const memoryMb = Number(processData.memory_mb || 0);
    const threadCount = Number(threadsData.thread_count || processData.num_threads || 0);
    return [
        { id: 'FD', label: 'FD', value: `${io.fds}`, active: Number(io.fds || 0) > 0 },
        { id: 'VFS', label: 'VFS', value: `${io.files}`, active: Number(io.files || 0) > 0 },
        { id: 'SOCK', label: 'SOCK', value: `${io.sockets}`, active: Number(io.sockets || 0) > 0 },
        { id: 'SCHED', label: 'SCHED', value: `${threadCount}`, active: threadCount > 1 || cpuPercent > 0 },
        { id: 'MEM', label: 'MEM', value: `${Math.round(memoryMb)}M`, active: memoryMb > 1 },
        { id: 'CPU', label: 'CPU', value: `${Math.round(cpuPercent)}%`, active: cpuPercent > 0 },
        { id: 'IPC', label: 'IPC', value: 'pipe', active: false },
        { id: 'IRQ', label: 'IRQ', value: 'ctx', active: threadCount > 8 }
    ];
}

function renderProcessInteractionModule(centerX, centerY, processData, anchor = null, details = {}) {
    d3.selectAll('.process-interaction-module').remove();
    if (!processData || isMobileLayout()) return;

    const moduleCx = Math.max(310, centerX - 265);
    const moduleCy = Math.max(190, centerY - 58);
    const moduleR = anchor ? 80 : 74;
    const nodes = processInteractionNodes(processData, details);
    const activeCount = nodes.filter(n => n.active).length;

    const group = svg.append('g')
        .attr('class', 'process-interaction-module')
        .attr('pointer-events', 'none');

    if (anchor) {
        group.append('path')
            .attr('d', `M${moduleCx + moduleR * 0.72},${moduleCy + moduleR * 0.58} C${moduleCx + 132},${moduleCy + 118} ${anchor.x - 74},${anchor.y + 22} ${anchor.x},${anchor.y}`)
            .attr('fill', 'none')
            .attr('stroke', 'rgba(12, 12, 12, 0.48)')
            .attr('stroke-width', 1.1)
            .attr('stroke-dasharray', '5 6');
    } else {
        group.append('path')
            .attr('d', `M${moduleCx + moduleR + 28},${moduleCy} C${moduleCx + moduleR + 90},${moduleCy - 36} ${centerX - 160},${centerY - 110} ${centerX - 80},${centerY - 76}`)
            .attr('fill', 'none')
            .attr('stroke', 'rgba(28, 28, 28, 0.22)')
            .attr('stroke-width', 0.8);
    }

    if (anchor) {
        const pimDefs = group.append('defs');
        const pimFilter = pimDefs.append('filter')
            .attr('id', 'pim-elevation')
            .attr('x', '-60%')
            .attr('y', '-60%')
            .attr('width', '220%')
            .attr('height', '220%');
        pimFilter.append('feDropShadow')
            .attr('dx', 0)
            .attr('dy', 3)
            .attr('stdDeviation', 8)
            .attr('flood-color', '#000')
            .attr('flood-opacity', 0.42);

        // Radial gradient gives the disc instrument-like volume: dark core, lighter rim.
        const pimGrad = pimDefs.append('radialGradient')
            .attr('id', 'pim-disc-grad')
            .attr('cx', '50%')
            .attr('cy', '42%')
            .attr('r', '62%');
        pimGrad.append('stop').attr('offset', '0%').attr('stop-color', '#0a0a0a');
        pimGrad.append('stop').attr('offset', '58%').attr('stop-color', '#141414');
        pimGrad.append('stop').attr('offset', '100%').attr('stop-color', '#2a2a28');

        // Soft light halo separates the module from the busy scene behind it.
        group.append('circle')
            .attr('cx', moduleCx)
            .attr('cy', moduleCy)
            .attr('r', moduleR + 34)
            .attr('fill', 'rgba(247, 247, 240, 0.62)')
            .attr('stroke', 'none')
            .style('filter', 'blur(3px)');

        group.append('circle')
            .attr('cx', moduleCx)
            .attr('cy', moduleCy)
            .attr('r', moduleR + 16)
            .attr('fill', 'none')
            .attr('stroke', 'rgba(20, 20, 20, 0.16)')
            .attr('stroke-width', 1)
            .attr('stroke-dasharray', '2 6');
    }

    group.append('circle')
        .attr('cx', moduleCx)
        .attr('cy', moduleCy)
        .attr('r', moduleR + (anchor ? 6 : 20))
        .attr('fill', anchor ? 'rgba(12, 12, 12, 0.10)' : 'rgba(240, 240, 232, 0.08)')
        .attr('stroke', anchor ? 'rgba(8, 8, 8, 0.36)' : 'none')
        .attr('stroke-width', anchor ? 1.2 : 1.1);

    group.append('circle')
        .attr('cx', moduleCx)
        .attr('cy', moduleCy)
        .attr('r', moduleR)
        .attr('fill', anchor ? 'url(#pim-disc-grad)' : 'rgba(240, 240, 232, 0.24)')
        .attr('stroke', anchor ? 'rgba(0, 0, 0, 0.92)' : 'rgba(28, 28, 28, 0.26)')
        .attr('stroke-width', anchor ? 1.8 : 1)
        .style('filter', anchor ? 'url(#pim-elevation)' : null);

    if (anchor) {
        group.append('circle')
            .attr('cx', moduleCx)
            .attr('cy', moduleCy)
            .attr('r', moduleR - 4)
            .attr('fill', 'none')
            .attr('stroke', 'rgba(247, 247, 240, 0.55)')
            .attr('stroke-width', 1.1);

        // Slowly rotating tick ring conveys live telemetry on the instrument rim.
        const tickRing = group.append('g');
        const tickR = moduleR - 9;
        const tickCount = 48;
        for (let t = 0; t < tickCount; t++) {
            const ta = (t / tickCount) * Math.PI * 2;
            const major = t % 6 === 0;
            const inner = tickR - (major ? 6 : 3);
            tickRing.append('line')
                .attr('x1', moduleCx + Math.cos(ta) * tickR)
                .attr('y1', moduleCy + Math.sin(ta) * tickR)
                .attr('x2', moduleCx + Math.cos(ta) * inner)
                .attr('y2', moduleCy + Math.sin(ta) * inner)
                .attr('stroke', `rgba(238, 238, 228, ${major ? 0.5 : 0.24})`)
                .attr('stroke-width', major ? 1.1 : 0.7);
        }
        tickRing.append('animateTransform')
            .attr('attributeName', 'transform')
            .attr('type', 'rotate')
            .attr('from', `0 ${moduleCx} ${moduleCy}`)
            .attr('to', `360 ${moduleCx} ${moduleCy}`)
            .attr('dur', '48s')
            .attr('repeatCount', 'indefinite');

        // Counter-rotating faint scan marker for extra liveliness.
        const scan = group.append('g');
        scan.append('line')
            .attr('x1', moduleCx)
            .attr('y1', moduleCy)
            .attr('x2', moduleCx)
            .attr('y2', moduleCy - (moduleR - 12))
            .attr('stroke', 'rgba(238, 238, 228, 0.16)')
            .attr('stroke-width', 1);
        scan.append('animateTransform')
            .attr('attributeName', 'transform')
            .attr('type', 'rotate')
            .attr('from', `360 ${moduleCx} ${moduleCy}`)
            .attr('to', `0 ${moduleCx} ${moduleCy}`)
            .attr('dur', '11s')
            .attr('repeatCount', 'indefinite');

        // Segmented activity arc: one segment per channel, aligned to its node.
        const arcR = moduleR + 11;
        const segGap = (Math.PI * 2 / nodes.length) * 0.22;
        const segSpan = (Math.PI * 2 / nodes.length) - segGap;
        const arcPoint = (a) => `${(moduleCx + Math.cos(a) * arcR).toFixed(2)},${(moduleCy + Math.sin(a) * arcR).toFixed(2)}`;
        nodes.forEach((node, idx) => {
            const center = -Math.PI / 2 + (idx / nodes.length) * Math.PI * 2;
            const a0 = center - segSpan / 2;
            const a1 = center + segSpan / 2;
            const seg = group.append('path')
                .attr('d', `M${arcPoint(a0)} A${arcR},${arcR} 0 0 1 ${arcPoint(a1)}`)
                .attr('fill', 'none')
                .attr('stroke', node.active ? 'rgba(238, 238, 228, 0.92)' : 'rgba(238, 238, 228, 0.16)')
                .attr('stroke-width', node.active ? 2.6 : 1.4)
                .attr('stroke-linecap', 'round');
            if (node.active) {
                seg.append('animate')
                    .attr('attributeName', 'stroke-opacity')
                    .attr('values', '0.55;0.95;0.55')
                    .attr('dur', '2.6s')
                    .attr('begin', `${(idx % 5) * 0.32}s`)
                    .attr('repeatCount', 'indefinite');
            }
        });

        // Activity gauge readout at the top gap of the arc.
        group.append('text')
            .attr('x', moduleCx)
            .attr('y', moduleCy - arcR - 5)
            .attr('text-anchor', 'middle')
            .attr('font-family', 'Share Tech Mono, monospace')
            .attr('font-size', '6px')
            .attr('fill', 'rgba(20, 20, 20, 0.6)')
            .text(`◆ ${activeCount}/${nodes.length}`);
    }

    group.append('circle')
        .attr('cx', moduleCx)
        .attr('cy', moduleCy)
        .attr('r', moduleR - 18)
        .attr('fill', 'none')
        .attr('stroke', anchor ? 'rgba(238, 238, 228, 0.22)' : 'rgba(28, 28, 28, 0.18)')
        .attr('stroke-width', anchor ? 1.05 : 0.8);

    group.append('circle')
        .attr('cx', moduleCx)
        .attr('cy', moduleCy)
        .attr('r', anchor ? 26 : 22)
        .attr('fill', anchor ? 'rgba(238, 238, 228, 0.92)' : 'rgba(32, 32, 32, 0.86)')
        .attr('stroke', anchor ? 'rgba(0, 0, 0, 0.86)' : 'rgba(20, 20, 20, 0.72)')
        .attr('stroke-width', 1.2);

    group.append('text')
        .attr('x', moduleCx)
        .attr('y', moduleCy - 2)
        .attr('text-anchor', 'middle')
        .attr('font-family', 'Share Tech Mono, monospace')
        .attr('font-size', '7.5px')
        .attr('font-weight', '700')
        .attr('fill', anchor ? '#161616' : '#f1f1ec')
        .text(String(processData.name || 'PROC').slice(0, 8).toUpperCase());

    group.append('text')
        .attr('x', moduleCx)
        .attr('y', moduleCy + 11)
        .attr('text-anchor', 'middle')
        .attr('font-family', 'Share Tech Mono, monospace')
        .attr('font-size', '6.5px')
        .attr('fill', anchor ? '#333' : '#c9c9c0')
        .text(`PID ${formatProcessValue(processData.pid)}`);

    group.append('text')
        .attr('x', moduleCx - moduleR)
        .attr('y', moduleCy - moduleR - 12)
        .attr('font-family', 'Share Tech Mono, monospace')
        .attr('font-size', '8px')
        .attr('font-weight', '700')
        .attr('fill', anchor ? 'rgba(20, 20, 20, 0.82)' : 'rgba(28, 28, 28, 0.72)')
        .text('PROCESS INTERACTION MODULE');

    group.append('text')
        .attr('x', moduleCx + moduleR - 2)
        .attr('y', moduleCy - moduleR - 12)
        .attr('text-anchor', 'end')
        .attr('font-family', 'Share Tech Mono, monospace')
        .attr('font-size', '7px')
        .attr('fill', anchor ? 'rgba(20, 20, 20, 0.58)' : 'rgba(28, 28, 28, 0.52)')
        .text(`ACTIVE ${activeCount}/${nodes.length}`);

    nodes.forEach((node, idx) => {
        const angle = -Math.PI / 2 + (idx / nodes.length) * Math.PI * 2;
        const nx = moduleCx + Math.cos(angle) * (moduleR + 8);
        const ny = moduleCy + Math.sin(angle) * (moduleR + 8);
        const labelOffset = Math.cos(angle) >= 0 ? 14 : -14;
        const labelX = nx + labelOffset;
        const labelAnchor = Math.cos(angle) >= 0 ? 'start' : 'end';
        const nodeFill = anchor
            ? (node.active ? 'rgba(238, 238, 228, 0.96)' : 'rgba(28, 28, 28, 0.92)')
            : (node.active ? 'rgba(28, 28, 28, 0.86)' : 'rgba(248, 248, 240, 0.72)');
        const nodeStroke = anchor
            ? (node.active ? 'rgba(238, 238, 228, 0.84)' : 'rgba(238, 238, 228, 0.18)')
            : 'rgba(28, 28, 28, 0.44)';
        const labelFill = anchor
            ? (node.active ? 'rgba(238, 238, 228, 0.95)' : '#222')
            : (node.active ? '#f1f1ec' : '#282828');
        const valueFill = anchor
            ? (node.active ? 'rgba(238, 238, 228, 0.72)' : 'rgba(42, 42, 42, 0.62)')
            : (node.active ? '#c9c9c0' : 'rgba(28, 28, 28, 0.55)');

        group.append('line')
            .attr('x1', moduleCx + Math.cos(angle) * 28)
            .attr('y1', moduleCy + Math.sin(angle) * 28)
            .attr('x2', nx)
            .attr('y2', ny)
            .attr('stroke', anchor
                ? (node.active ? 'rgba(238, 238, 228, 0.36)' : 'rgba(238, 238, 228, 0.11)')
                : (node.active ? 'rgba(28, 28, 28, 0.42)' : 'rgba(28, 28, 28, 0.16)'))
            .attr('stroke-width', node.active ? 1.05 : 0.65);

        if (anchor && node.active) {
            // Breathing pulse halo so active channels read as live telemetry.
            const pulse = group.append('circle')
                .attr('cx', nx)
                .attr('cy', ny)
                .attr('r', 7.8)
                .attr('fill', 'none')
                .attr('stroke', 'rgba(238, 238, 228, 0.5)')
                .attr('stroke-width', 1.1);
            const phase = `${(idx % 5) * 0.32}s`;
            pulse.append('animate')
                .attr('attributeName', 'r')
                .attr('values', '7.8;14;7.8')
                .attr('dur', '2.6s')
                .attr('begin', phase)
                .attr('repeatCount', 'indefinite');
            pulse.append('animate')
                .attr('attributeName', 'stroke-opacity')
                .attr('values', '0.55;0;0.55')
                .attr('dur', '2.6s')
                .attr('begin', phase)
                .attr('repeatCount', 'indefinite');
        }

        const nodeCircle = group.append('circle')
            .attr('cx', nx)
            .attr('cy', ny)
            .attr('r', node.active ? 7.8 : 6.2)
            .attr('fill', nodeFill)
            .attr('stroke', nodeStroke)
            .attr('stroke-width', anchor && node.active ? 1.2 : 0.8);

        if (anchor && node.active) {
            // Subtle core breathing keeps the node itself alive, not just its halo.
            const corePhase = `${(idx % 5) * 0.32}s`;
            nodeCircle.append('animate')
                .attr('attributeName', 'r')
                .attr('values', '7.2;8.4;7.2')
                .attr('dur', '2.6s')
                .attr('begin', corePhase)
                .attr('repeatCount', 'indefinite');
        }

        group.append('rect')
            .attr('x', Math.cos(angle) >= 0 ? nx + 10 : nx - 80)
            .attr('y', ny - 9)
            .attr('width', 70)
            .attr('height', 18)
            .attr('rx', 9)
            .attr('fill', anchor
                ? (node.active ? 'rgba(18, 18, 18, 0.92)' : 'rgba(238, 238, 228, 0.82)')
                : (node.active ? 'rgba(28, 28, 28, 0.86)' : 'rgba(248, 248, 240, 0.58)'))
            .attr('stroke', anchor ? 'rgba(238, 238, 228, 0.34)' : 'rgba(28, 28, 28, 0.22)')
            .attr('stroke-width', anchor ? 0.9 : 0.7);

        group.append('text')
            .attr('x', labelX)
            .attr('y', ny - 1)
            .attr('text-anchor', labelAnchor)
            .attr('font-family', 'Share Tech Mono, monospace')
            .attr('font-size', anchor ? '8px' : '7.5px')
            .attr('font-weight', '700')
            .attr('fill', labelFill)
            .text(node.label);

        group.append('text')
            .attr('x', labelX)
            .attr('y', ny + 8)
            .attr('text-anchor', labelAnchor)
            .attr('font-family', 'Share Tech Mono, monospace')
            .attr('font-size', anchor ? '6.4px' : '6px')
            .attr('fill', valueFill)
            .text(String(node.value).slice(0, 8));
    });
}

function renderProcessDossier() {
    d3.selectAll('.process-dossier-layer').remove();
    if (!pinnedProcessDossier || !pinnedProcessDossier.process || !pinnedProcessDossier.anchor) return;

    const width = window.innerWidth;
    const height = window.innerHeight;
    const processData = pinnedProcessDossier.process;
    const anchor = pinnedProcessDossier.anchor;
    const ioSummary = processIoSummary(processData, pinnedProcessDossier.details);
    const controlRows = processControlStrip(processData, pinnedProcessDossier.details);
    const threadsData = pinnedProcessDossier.details?.threadsData || {};
    const cpuData = pinnedProcessDossier.details?.cpuData || {};
    const menuW = Math.min(760, width - 220);
    const menuH = 118;
    const menuX = Math.max(120, width / 2 - menuW / 2);
    const menuY = Math.min(height - menuH - 34, Math.max(height * 0.68, anchor.y + 210));
    const cpuPercent = Number(cpuData.cpu_percent || processData.cpu_percent || 0);
    const threadCount = Number(threadsData.thread_count || processData.num_threads || 0);
    const actionRows = [
        { id: 'STATE', value: formatProcessValue(processData.status, 'state'), active: true },
        { id: 'CPU', value: `${cpuPercent}%`, active: cpuPercent > 0 },
        { id: 'FD TABLE', value: `${ioSummary.fds} fd`, active: Number(ioSummary.fds || 0) > 0 },
        { id: 'VFS', value: `${ioSummary.files} files`, active: Number(ioSummary.files || 0) > 0 },
        { id: 'SOCKET', value: `${ioSummary.sockets} conns`, active: Number(ioSummary.sockets || 0) > 0 },
        { id: 'SCHED', value: `${threadCount} th`, active: threadCount > 1 || cpuPercent > 0 },
        { id: 'MEM', value: `${formatProcessValue(processData.memory_mb, 0)} MB`, active: Number(processData.memory_mb || 0) > 1 },
        { id: 'KERNEL', value: 'CONTACT', active: true }
    ];

    const layer = svg.append('g')
        .attr('class', 'process-dossier-layer')
        .attr('pointer-events', 'none');

    layer.append('path')
        .attr('d', `M${anchor.x},${anchor.y} C${anchor.x + 34},${anchor.y + 96} ${menuX + 34},${menuY - 44} ${menuX + 54},${menuY + 52}`)
        .attr('fill', 'none')
        .attr('stroke', 'rgba(16, 16, 16, 0.36)')
        .attr('stroke-width', 1.05);

    layer.append('text')
        .attr('x', (anchor.x + menuX) / 2)
        .attr('y', (anchor.y + menuY) / 2)
        .attr('text-anchor', 'middle')
        .attr('font-family', 'Share Tech Mono, monospace')
        .attr('font-size', '8px')
        .attr('fill', 'rgba(24, 24, 24, 0.72)')
        .text('PROCESS LINK');

    layer.append('rect')
        .attr('x', menuX)
        .attr('y', menuY)
        .attr('width', menuW)
        .attr('height', menuH)
        .attr('rx', 6)
        .attr('fill', 'rgba(238, 238, 228, 0.68)')
        .attr('stroke', 'rgba(24, 24, 24, 0.2)')
        .attr('stroke-width', 0.9);

    layer.append('rect')
        .attr('x', menuX + 10)
        .attr('y', menuY + 10)
        .attr('width', menuW - 20)
        .attr('height', 26)
        .attr('rx', 3)
        .attr('fill', 'rgba(24, 24, 24, 0.86)');

    layer.append('text')
        .attr('x', menuX + 20)
        .attr('y', menuY + 28)
        .attr('font-family', 'Share Tech Mono, monospace')
        .attr('font-size', '10px')
        .attr('font-weight', '700')
        .attr('fill', '#f2f2ea')
        .text('PROCESS ACTION MENU');

    layer.append('text')
        .attr('x', menuX + menuW - 20)
        .attr('y', menuY + 28)
        .attr('text-anchor', 'end')
        .attr('font-family', 'Share Tech Mono, monospace')
        .attr('font-size', '8px')
        .attr('fill', '#cfcfc8')
        .text(`${String(processData.name || 'process').slice(0, 18)} · PID ${formatProcessValue(processData.pid)}`);

    layer.append('circle')
        .attr('cx', anchor.x)
        .attr('cy', anchor.y)
        .attr('r', 9)
        .attr('fill', 'none')
        .attr('stroke', 'rgba(16, 16, 16, 0.72)')
        .attr('stroke-width', 1.1);

    const itemW = (menuW - 44) / 4;
    actionRows.forEach((row, idx) => {
        const col = idx % 4;
        const r = Math.floor(idx / 4);
        const x = menuX + 14 + col * itemW;
        const y = menuY + 48 + r * 30;
        const w = itemW - 8;
        layer.append('rect')
            .attr('x', x)
            .attr('y', y)
            .attr('width', w)
            .attr('height', 22)
            .attr('rx', 11)
            .attr('fill', row.active ? 'rgba(24, 24, 24, 0.86)' : 'rgba(255, 255, 255, 0.44)')
            .attr('stroke', 'rgba(24, 24, 24, 0.18)')
            .attr('stroke-width', row.active ? 1 : 0.7);

        layer.append('circle')
            .attr('cx', x + 11)
            .attr('cy', y + 11)
            .attr('r', 2.2)
            .attr('fill', row.active ? '#f2f2ea' : 'rgba(24, 24, 24, 0.46)');

        layer.append('text')
            .attr('x', x + 20)
            .attr('y', y + 10)
            .attr('font-family', 'Share Tech Mono, monospace')
            .attr('font-size', '8px')
            .attr('font-weight', '700')
            .attr('fill', row.active ? '#f2f2ea' : '#2f2f2f')
            .text(row.id);

        layer.append('text')
            .attr('x', x + w - 8)
            .attr('y', y + 17)
            .attr('text-anchor', 'end')
            .attr('font-family', 'Share Tech Mono, monospace')
            .attr('font-size', '6.5px')
            .attr('fill', row.active ? '#cfcfc8' : '#666')
            .text(String(row.value).slice(0, 12));
    });

    renderFdDescriptorMap(layer, processData, pinnedProcessDossier.details, {
        x: menuX + menuW - 258,
        y: Math.max(88, menuY - 166),
        width: 258,
        height: 142,
        anchor: { x: menuX + menuW - 42, y: menuY + 12 }
    });

    renderNamespaceFingerprint(layer, processData, pinnedProcessDossier.details, {
        x: menuX,
        y: Math.max(88, menuY - 150),
        width: 226,
        height: 126,
        anchor: { x: menuX + 28, y: menuY + 12 }
    });

    const nsFingerprint = pinnedProcessDossier.details?.fdsData?.namespace_fingerprint;
    const containmentPeers = nsFingerprint && Array.isArray(nsFingerprint.peer_pids)
        ? nsFingerprint.peer_pids
        : [];
    if (containmentPeers.length) {
        drawContainmentHalo(layer, processData, containmentPeers);
    }
}

function renderFdDescriptorMap(layer, processData, details = {}, box) {
    const fdsData = details.fdsData || {};
    const descriptors = Array.isArray(fdsData.descriptors) ? fdsData.descriptors : [];
    const rows = descriptors.length
        ? descriptors.slice(0, 8)
        : [
            { fd: 0, type: 'stdin', target: 'loading' },
            { fd: 1, type: 'stdout', target: 'loading' },
            { fd: 2, type: 'stderr', target: 'loading' }
        ];

    layer.append('path')
        .attr('d', `M${box.anchor.x},${box.anchor.y} C${box.anchor.x - 18},${box.anchor.y - 42} ${box.x + box.width - 20},${box.y + box.height + 18} ${box.x + box.width - 32},${box.y + box.height - 4}`)
        .attr('fill', 'none')
        .attr('stroke', 'rgba(20, 20, 20, 0.22)')
        .attr('stroke-width', 0.8);

    layer.append('rect')
        .attr('x', box.x)
        .attr('y', box.y)
        .attr('width', box.width)
        .attr('height', box.height)
        .attr('rx', 6)
        .attr('fill', 'rgba(238, 238, 228, 0.76)')
        .attr('stroke', 'rgba(24, 24, 24, 0.18)')
        .attr('stroke-width', 0.85);

    layer.append('rect')
        .attr('x', box.x + 8)
        .attr('y', box.y + 8)
        .attr('width', box.width - 16)
        .attr('height', 22)
        .attr('rx', 3)
        .attr('fill', 'rgba(24, 24, 24, 0.84)');

    layer.append('text')
        .attr('x', box.x + 16)
        .attr('y', box.y + 23)
        .attr('font-family', 'Share Tech Mono, monospace')
        .attr('font-size', '8.5px')
        .attr('font-weight', '700')
        .attr('fill', '#f2f2ea')
        .text('FD DESCRIPTOR MAP');

    layer.append('text')
        .attr('x', box.x + box.width - 16)
        .attr('y', box.y + 23)
        .attr('text-anchor', 'end')
        .attr('font-family', 'Share Tech Mono, monospace')
        .attr('font-size', '6.5px')
        .attr('fill', '#cfcfc8')
        .text(`PID ${formatProcessValue(processData.pid)}`);

    rows.forEach((descriptor, idx) => {
        const y = box.y + 42 + idx * 12;
        const tone = descriptorTone(descriptor.type);
        const fdLabel = `fd ${formatProcessValue(descriptor.fd)}`;
        const typeLabel = String(descriptor.type || 'descriptor').toUpperCase().slice(0, 11);
        const targetLabel = descriptorTargetLabel(descriptor).replace(/^socket:\[/, 'socket[').slice(0, 22);

        layer.append('line')
            .attr('x1', box.x + 16)
            .attr('y1', y + 4)
            .attr('x2', box.x + box.width - 16)
            .attr('y2', y + 4)
            .attr('stroke', 'rgba(24, 24, 24, 0.08)')
            .attr('stroke-width', 0.6);

        layer.append('circle')
            .attr('cx', box.x + 18)
            .attr('cy', y)
            .attr('r', 2.2)
            .attr('fill', tone);

        layer.append('text')
            .attr('x', box.x + 28)
            .attr('y', y + 2.5)
            .attr('font-family', 'Share Tech Mono, monospace')
            .attr('font-size', '7px')
            .attr('font-weight', '700')
            .attr('fill', '#272727')
            .text(fdLabel);

        layer.append('text')
            .attr('x', box.x + 74)
            .attr('y', y + 2.5)
            .attr('font-family', 'Share Tech Mono, monospace')
            .attr('font-size', '7px')
            .attr('fill', tone)
            .text(typeLabel);

        layer.append('text')
            .attr('x', box.x + box.width - 16)
            .attr('y', y + 2.5)
            .attr('text-anchor', 'end')
            .attr('font-family', 'Share Tech Mono, monospace')
            .attr('font-size', '6.3px')
            .attr('fill', 'rgba(36, 36, 36, 0.62)')
            .text(targetLabel);
    });

    if (descriptors.length > rows.length) {
        layer.append('text')
            .attr('x', box.x + box.width - 16)
            .attr('y', box.y + box.height - 10)
            .attr('text-anchor', 'end')
            .attr('font-family', 'Share Tech Mono, monospace')
            .attr('font-size', '6.5px')
            .attr('fill', 'rgba(36, 36, 36, 0.56)')
            .text(`+${descriptors.length - rows.length} more descriptors`);
    }
}

const NS_FINGERPRINT_PLACEHOLDER = [
    { id: 'mnt', label: 'MNT', isolated: false },
    { id: 'pid', label: 'PID', isolated: false },
    { id: 'net', label: 'NET', isolated: false },
    { id: 'ipc', label: 'IPC', isolated: false },
    { id: 'uts', label: 'UTS', isolated: false },
    { id: 'user', label: 'USER', isolated: false }
];

function renderNamespaceFingerprint(layer, processData, details = {}, box) {
    const fdsData = details.fdsData || {};
    const fp = fdsData.namespace_fingerprint || null;
    const nsList = fp && Array.isArray(fp.namespaces) ? fp.namespaces : NS_FINGERPRINT_PLACEHOLDER;
    const isolatedCount = fp ? Number(fp.isolated_count || 0) : 0;
    const total = fp ? Number(fp.total || nsList.length) : nsList.length;
    const verdict = fp ? String(fp.verdict || '') : 'reading…';

    layer.append('path')
        .attr('d', `M${box.anchor.x},${box.anchor.y} C${box.anchor.x + 18},${box.anchor.y - 42} ${box.x + 24},${box.y + box.height + 18} ${box.x + 32},${box.y + box.height - 4}`)
        .attr('fill', 'none')
        .attr('stroke', 'rgba(20, 20, 20, 0.22)')
        .attr('stroke-width', 0.8);

    layer.append('rect')
        .attr('x', box.x)
        .attr('y', box.y)
        .attr('width', box.width)
        .attr('height', box.height)
        .attr('rx', 6)
        .attr('fill', 'rgba(238, 238, 228, 0.76)')
        .attr('stroke', 'rgba(24, 24, 24, 0.18)')
        .attr('stroke-width', 0.85);

    layer.append('rect')
        .attr('x', box.x + 8)
        .attr('y', box.y + 8)
        .attr('width', box.width - 16)
        .attr('height', 22)
        .attr('rx', 3)
        .attr('fill', 'rgba(24, 24, 24, 0.84)');

    layer.append('text')
        .attr('x', box.x + 16)
        .attr('y', box.y + 23)
        .attr('font-family', 'Share Tech Mono, monospace')
        .attr('font-size', '8.5px')
        .attr('font-weight', '700')
        .attr('fill', '#f2f2ea')
        .text('NAMESPACE ISOLATION');

    layer.append('text')
        .attr('x', box.x + box.width - 16)
        .attr('y', box.y + 23)
        .attr('text-anchor', 'end')
        .attr('font-family', 'Share Tech Mono, monospace')
        .attr('font-size', '7px')
        .attr('font-weight', '700')
        .attr('fill', isolatedCount > 0 ? '#9fe0c2' : '#cfcfc8')
        .text(`${isolatedCount}/${total}`);

    layer.append('text')
        .attr('x', box.x + 16)
        .attr('y', box.y + 42)
        .attr('font-family', 'Share Tech Mono, monospace')
        .attr('font-size', '6.8px')
        .attr('fill', isolatedCount > 0 ? 'rgba(20, 90, 64, 0.9)' : 'rgba(36, 36, 36, 0.6)')
        .text(verdict.toUpperCase());

    const cols = 3;
    const gap = 7;
    const cellW = (box.width - 32 - gap * (cols - 1)) / cols;
    const cellH = 24;
    const gridY = box.y + 52;

    nsList.slice(0, 6).forEach((ns, i) => {
        const c = i % cols;
        const r = Math.floor(i / cols);
        const x = box.x + 16 + c * (cellW + gap);
        const y = gridY + r * (cellH + 7);
        const isolated = !!ns.isolated;

        layer.append('rect')
            .attr('x', x)
            .attr('y', y)
            .attr('width', cellW)
            .attr('height', cellH)
            .attr('rx', 4)
            .attr('fill', isolated ? 'rgba(24, 24, 24, 0.86)' : 'rgba(255, 255, 255, 0.5)')
            .attr('stroke', isolated ? 'rgba(20, 90, 64, 0.55)' : 'rgba(24, 24, 24, 0.16)')
            .attr('stroke-width', isolated ? 1 : 0.7)
            .style('pointer-events', fp ? 'all' : 'none')
            .style('cursor', fp ? 'help' : 'default')
            .on('mouseenter', (event) => showNamespaceCellTooltip(event, ns))
            .on('mousemove', (event) => {
                d3.selectAll('.ns-fp-tooltip')
                    .style('left', `${event.pageX + 12}px`)
                    .style('top', `${event.pageY - 10}px`);
            })
            .on('mouseleave', () => d3.selectAll('.ns-fp-tooltip').remove());

        // Filled node = own (isolated) namespace; hollow ring = shares host's.
        layer.append('circle')
            .attr('cx', x + 9)
            .attr('cy', y + cellH / 2)
            .attr('r', 3)
            .attr('fill', isolated ? '#7fd6b0' : 'none')
            .attr('stroke', isolated ? 'none' : 'rgba(24, 24, 24, 0.42)')
            .attr('stroke-width', 0.9);

        layer.append('text')
            .attr('x', x + 18)
            .attr('y', y + cellH / 2 + 2.5)
            .attr('font-family', 'Share Tech Mono, monospace')
            .attr('font-size', '7.5px')
            .attr('font-weight', '700')
            .attr('fill', isolated ? '#f2f2ea' : '#2f2f2f')
            .text(ns.label || String(ns.id || '').toUpperCase());

        layer.append('text')
            .attr('x', x + cellW - 5)
            .attr('y', y + cellH / 2 + 2.5)
            .attr('text-anchor', 'end')
            .attr('font-family', 'Share Tech Mono, monospace')
            .attr('font-size', '5.5px')
            .attr('fill', isolated ? '#9fe0c2' : 'rgba(36, 36, 36, 0.45)')
            .text(isolated ? 'OWN' : 'host');
    });

    const peerCount = fp ? Number(fp.peer_count || 0) : 0;
    const footer = fp
        ? (isolatedCount > 0
            ? `CO-RESIDENT: ${peerCount} proc${peerCount === 1 ? '' : 's'}`
            : 'CO-RESIDENT: host namespace (shared)')
        : 'hover a cell for inode';
    layer.append('text')
        .attr('x', box.x + 16)
        .attr('y', box.y + box.height - 9)
        .attr('font-family', 'Share Tech Mono, monospace')
        .attr('font-size', '6.3px')
        .attr('fill', peerCount > 0 ? 'rgba(20, 90, 64, 0.85)' : 'rgba(36, 36, 36, 0.5)')
        .text(footer);
}

function showNamespaceCellTooltip(event, ns) {
    d3.selectAll('.ns-fp-tooltip').remove();
    const isolated = !!ns.isolated;
    const inode = ns.inode || 'n/a';
    const hostInode = ns.host_inode || 'n/a';
    const statusLine = isolated
        ? '<span style="color:#7fd6b0;">OWN namespace — isolated from host</span>'
        : '<span style="color:#cfcfc8;">shares the host namespace</span>';
    d3.select('body')
        .append('div')
        .attr('class', 'tooltip ns-fp-tooltip')
        .style('position', 'absolute')
        .style('background', 'rgba(0, 0, 0, 0.88)')
        .style('color', '#fff')
        .style('padding', '8px 10px')
        .style('border-radius', '4px')
        .style('font-size', '11px')
        .style('font-family', 'Share Tech Mono, monospace')
        .style('pointer-events', 'none')
        .style('z-index', '1300')
        .style('left', `${event.pageX + 12}px`)
        .style('top', `${event.pageY - 10}px`)
        .html(
            `<strong>${ns.label || String(ns.id || '').toUpperCase()} NAMESPACE</strong><br>` +
            `${ns.description || ''}<br>` +
            `<hr style="border-color:#555;margin:4px 0;">` +
            `${statusLine}<br>` +
            `<strong>inode:</strong> ${inode}<br>` +
            `<strong>host inode:</strong> ${hostInode}`
        );
}

// Containment halo: ring the selected process and its container/sandbox mates
// (processes sharing every isolated namespace inode) on the process map.
function drawContainmentHalo(layer, processData, peerPids) {
    const selfPid = processData.pid;
    const drawn = [{ pid: selfPid, self: true }]
        .concat(peerPids.slice(0, 120).map((pid) => ({ pid, self: false })));
    let visibleMates = 0;

    drawn.forEach(({ pid, self }) => {
        const group = svg.select(`.process-node-group[data-pid="${pid}"]`);
        if (group.empty()) return;
        const circle = group.select('circle.process-node');
        if (circle.empty()) return;
        const cx = Number(circle.attr('cx'));
        const cy = Number(circle.attr('cy'));
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
        if (!self) visibleMates += 1;

        const halo = layer.append('circle')
            .attr('cx', cx)
            .attr('cy', cy)
            .attr('r', self ? 9 : 6.5)
            .attr('fill', 'none')
            .attr('stroke', self ? 'rgba(36, 150, 104, 0.95)' : 'rgba(72, 174, 124, 0.7)')
            .attr('stroke-width', self ? 1.8 : 1.05)
            .attr('stroke-dasharray', self ? 'none' : '3 3')
            .style('pointer-events', 'none');

        if (self) {
            const pulse = () => {
                halo.attr('r', 9).attr('opacity', 0.95)
                    .transition().duration(1700).ease(d3.easeSinOut)
                    .attr('r', 15).attr('opacity', 0)
                    .on('end', function () { pulse(); });
            };
            pulse();
        }
    });

    if (visibleMates > 0) {
        const selfGroup = svg.select(`.process-node-group[data-pid="${selfPid}"]`);
        const selfCircle = selfGroup.empty() ? null : selfGroup.select('circle.process-node');
        if (selfCircle && !selfCircle.empty()) {
            layer.append('text')
                .attr('x', Number(selfCircle.attr('cx')) + 12)
                .attr('y', Number(selfCircle.attr('cy')) - 10)
                .attr('font-family', 'Share Tech Mono, monospace')
                .attr('font-size', '7px')
                .attr('font-weight', '700')
                .attr('fill', 'rgba(28, 120, 84, 0.92)')
                .text(`container · ${visibleMates} on map`);
        }
    }
}

function clearPinnedProcessDossier() {
    if (!pinnedProcessDossier) return;
    const pinnedPid = pinnedProcessDossier.process?.pid;
    const isHighlighted = window.__highlightedProcess && window.__highlightedProcess.pid === pinnedPid;
    pinnedProcessDossier = null;
    stopProcessModalTopKeeper();
    d3.selectAll('.process-modal-scrim').remove();
    d3.selectAll('.process-dossier-layer').remove();
    d3.selectAll('.process-interaction-module').remove();
    d3.selectAll('.process-node-group').classed('process-pinned', false);
    if (window.nginxFilesManager && typeof window.nginxFilesManager.clearProcessHighlight === 'function') {
        window.nginxFilesManager.clearProcessHighlight();
    }
    if (pinnedPid !== undefined && pinnedPid !== null) {
        const pinnedGroup = svg.select(`.process-node-group[data-pid="${pinnedPid}"]`);
        pinnedGroup.select('.process-node')
            .interrupt()
            .attr('r', isHighlighted ? 3 : 1)
            .attr('fill', '#888')
            .attr('stroke', '#555')
            .attr('stroke-width', isHighlighted ? 1 : 0.5);
        svg.select(`.process-line[data-pid="${pinnedPid}"]`)
            .attr('stroke', 'url(#lineGradient)')
            .attr('stroke-width', 0.9)
            .attr('opacity', isHighlighted ? 0.16 : 0.07);
    }
}

// Единый "модальный" скрим под панелями открытого меню процесса.
// Мягкая бумажная вуаль с лёгкой виньеткой к краям гасит плотную основную
// сцену, чтобы панели читались как сфокусированный слой, а не случайные окна.
function ensureProcessModalScrim() {
    if (isMobileLayout()) return;
    if (!svg.select('.process-modal-scrim').empty()) return;

    let defs = svg.select('defs');
    if (defs.empty()) defs = svg.append('defs');
    if (svg.select('#process-scrim-grad').empty()) {
        const grad = defs.append('radialGradient')
            .attr('id', 'process-scrim-grad')
            .attr('cx', '50%').attr('cy', '46%').attr('r', '65%');
        grad.append('stop').attr('offset', '0%').attr('stop-color', '#e4e4df').attr('stop-opacity', 0.34);
        grad.append('stop').attr('offset', '68%').attr('stop-color', '#deded8').attr('stop-opacity', 0.58);
        grad.append('stop').attr('offset', '100%').attr('stop-color', '#d3d3cc').attr('stop-opacity', 0.76);
    }

    const w = window.innerWidth;
    const h = window.innerHeight;
    svg.append('rect')
        .attr('class', 'process-modal-scrim')
        .attr('x', -80).attr('y', -80)
        .attr('width', w + 160).attr('height', h + 160)
        .attr('fill', 'url(#process-scrim-grad)')
        .style('pointer-events', 'all')
        .style('opacity', 0)
        .transition().duration(220).style('opacity', 1);
}

// Держим фокус-слой корректным по z-order: любые "живые" элементы (анимация
// syscalls и т.п.), дорисованные в svg ПОСЛЕ вуали, задвигаем ПОД неё. Панели
// меню (scrim/dossier/module) не трогаем — иначе рестартовали бы их анимации.
let processModalTopObserver = null;

function buryLiveLayersUnderScrim() {
    const svgNode = svg.node();
    if (!svgNode) return;
    const scrimNode = svgNode.querySelector('.process-modal-scrim');
    if (!scrimNode) return;
    const modalClasses = ['process-modal-scrim', 'process-dossier-layer', 'process-interaction-module'];
    const toMove = [];
    for (let sib = scrimNode.nextSibling; sib; sib = sib.nextSibling) {
        if (sib.nodeType !== 1) continue;
        const cl = sib.classList;
        if (cl && modalClasses.some(c => cl.contains(c))) continue;
        toMove.push(sib);
    }
    toMove.forEach(n => svgNode.insertBefore(n, scrimNode));
}

function startProcessModalTopKeeper() {
    const svgNode = svg.node();
    if (!svgNode || typeof MutationObserver === 'undefined') return;
    buryLiveLayersUnderScrim();
    if (processModalTopObserver) return;
    processModalTopObserver = new MutationObserver(() => {
        if (!pinnedProcessDossier) return;
        processModalTopObserver.disconnect();
        buryLiveLayersUnderScrim();
        processModalTopObserver.observe(svgNode, { childList: true });
    });
    processModalTopObserver.observe(svgNode, { childList: true });
}

function stopProcessModalTopKeeper() {
    if (processModalTopObserver) {
        processModalTopObserver.disconnect();
        processModalTopObserver = null;
    }
}

function pinProcessDossier(processData, anchor) {
    pinnedProcessDossier = {
        process: processData,
        anchor,
        details: pinnedProcessDossier && pinnedProcessDossier.process?.pid === processData.pid
            ? pinnedProcessDossier.details
            : {}
    };
    ensureProcessModalScrim();
    renderProcessDossier();
    renderProcessInteractionModule(window.innerWidth / 2, window.innerHeight / 2, processData, anchor, pinnedProcessDossier.details);
    startProcessModalTopKeeper();
    if (window.nginxFilesManager && typeof window.nginxFilesManager.highlightProcessFiles === 'function') {
        window.nginxFilesManager.highlightProcessFiles(processData.pid);
    }

    Promise.all([
        fetch(`/api/process/${processData.pid}/threads`).then(r => r.json()).catch(() => null),
        fetch(`/api/process/${processData.pid}/cpu`).then(r => r.json()).catch(() => null),
        fetch(`/api/process/${processData.pid}/fds`).then(r => r.json()).catch(() => null)
    ]).then(([threadsData, cpuData, fdsData]) => {
        if (!pinnedProcessDossier || pinnedProcessDossier.process?.pid !== processData.pid) return;
        pinnedProcessDossier.details = { threadsData, cpuData, fdsData };
        renderProcessDossier();
        renderProcessInteractionModule(window.innerWidth / 2, window.innerHeight / 2, processData, anchor, pinnedProcessDossier.details);
        if (window.nginxFilesManager && typeof window.nginxFilesManager.showProcessFiles === 'function' && fdsData && !fdsData.error) {
            window.nginxFilesManager.showProcessFiles(processData.pid, fdsData);
        }
    });
}

// Draw central circle
function drawCentralCircle(centerX, centerY) {
    drawCentralPulseGrid(centerX, centerY);

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

function drawCentralPulseGrid(centerX, centerY) {
    const grid = svg.append("g")
        .attr("class", "central-pulse-grid")
        .attr("pointer-events", "none");
    const radii = [74, 112, 156, 204];

    radii.forEach((radius, idx) => {
        grid.append("circle")
            .attr("cx", centerX)
            .attr("cy", centerY)
            .attr("r", radius)
            .attr("fill", "none")
            .attr("stroke", "rgba(38, 38, 38, 0.09)")
            .attr("stroke-width", idx === 0 ? 1 : 0.7)
            .attr("stroke-dasharray", idx % 2 === 0 ? "2 7" : "1 9");
    });

    for (let i = 0; i < 36; i += 1) {
        const angle = (i / 36) * Math.PI * 2;
        const inner = 78 + (i % 3) * 10;
        const outer = 218 - (i % 4) * 13;
        const x1 = centerX + Math.cos(angle) * inner;
        const y1 = centerY + Math.sin(angle) * inner;
        const x2 = centerX + Math.cos(angle) * outer;
        const y2 = centerY + Math.sin(angle) * outer;
        grid.append("line")
            .attr("x1", x1)
            .attr("y1", y1)
            .attr("x2", x2)
            .attr("y2", y2)
            .attr("stroke", "rgba(38, 38, 38, 0.045)")
            .attr("stroke-width", 0.55);
    }

    for (let i = 0; i < 72; i += 1) {
        const angle = (i / 72) * Math.PI * 2;
        const radius = i % 2 === 0 ? 186 : 196;
        grid.append("circle")
            .attr("cx", centerX + Math.cos(angle) * radius)
            .attr("cy", centerY + Math.sin(angle) * radius)
            .attr("r", i % 9 === 0 ? 1.7 : 1.05)
            .attr("fill", "rgba(38, 38, 38, 0.14)");
    }
}

function drawCentralPulseGridForeground(centerX, centerY) {
    const grid = svg.append("g")
        .attr("class", "central-pulse-grid central-pulse-grid-foreground")
        .attr("pointer-events", "none");
    const innerR = 66;
    const outerR = 148;

    [68, 92, 118, 144].forEach((radius, idx) => {
        const ring = grid.append("circle")
            .attr("cx", centerX)
            .attr("cy", centerY)
            .attr("r", radius)
            .attr("fill", "none")
            .attr("stroke", "rgba(24, 24, 24, 0.46)")
            .attr("stroke-width", idx === 1 ? 1.2 : 0.85)
            .attr("stroke-dasharray", idx % 2 === 0 ? "2 6" : "1 8")
            .attr("opacity", 0.82);

        ring.append("animate")
            .attr("attributeName", "opacity")
            .attr("values", "0.5;0.95;0.5")
            .attr("dur", `${3.2 + idx * 0.35}s`)
            .attr("repeatCount", "indefinite");
    });

    for (let i = 0; i < 64; i += 1) {
        const angle = (i / 64) * Math.PI * 2;
        const tickInner = innerR + (i % 4) * 5;
        const tickOuter = outerR - (i % 5) * 4;
        grid.append("line")
            .attr("x1", centerX + Math.cos(angle) * tickInner)
            .attr("y1", centerY + Math.sin(angle) * tickInner)
            .attr("x2", centerX + Math.cos(angle) * tickOuter)
            .attr("y2", centerY + Math.sin(angle) * tickOuter)
            .attr("stroke", "rgba(28, 28, 28, 0.18)")
            .attr("stroke-width", i % 8 === 0 ? 0.95 : 0.55)
            .attr("opacity", i % 3 === 0 ? 0.58 : 0.34);
    }

    for (let i = 0; i < 96; i += 1) {
        const angle = (i / 96) * Math.PI * 2;
        const radius = 128 + (i % 3) * 6;
        const dot = grid.append("circle")
            .attr("cx", centerX + Math.cos(angle) * radius)
            .attr("cy", centerY + Math.sin(angle) * radius)
            .attr("r", i % 12 === 0 ? 1.8 : 1)
            .attr("fill", "rgba(24, 24, 24, 0.46)")
            .attr("opacity", 0.68);

        if (i % 8 === 0) {
            dot.append("animate")
                .attr("attributeName", "opacity")
                .attr("values", "0.28;0.9;0.28")
                .attr("dur", "2.8s")
                .attr("begin", `${(i % 16) * 0.08}s`)
                .attr("repeatCount", "indefinite");
        }
    }
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
    window.fetchJson('/api/execution-context', { cache: 'no-store' }, {
        timeoutMs: 4500,
        suppressToast: true,
        context: 'execution-context'
    })
        .then(data => {
            if (!data || data.error) {
                throw new Error(data?.error || 'No execution context');
            }
            return data;
        })
        .then(data => {
            // Debug logging
            debugLog('🔄 Ring-1 Update:', {
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
                debugLog('✨ Syscall active:', data.syscall_name);
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
                debugLog('📊 Normal state, color:', ringColor, 'CPU state:', data.cpu_state);
                
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

            // Render compact IRQ/SoftIRQ stack near active connections.
            renderIrqStackPanel(data);
        })
        .catch(error => {
            debugLog('Error fetching execution context:', error && error.message ? error.message : error);
        });
}

function renderIrqStackPanel(executionData) {
    if (window.IrqUI && typeof window.IrqUI.renderIrqStackPanel === 'function') {
        return window.IrqUI.renderIrqStackPanel(executionData);
    }
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
    if (window.kernelContextMenu && (
        window.kernelContextMenu.currentView === 'matrix' ||
        window.kernelContextMenu.currentView === 'kernel-flow'
    )) {
        debugLog('⏸️ Skipping tag icons render - Matrix or Kernel Flow view is active');
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

    // Right top status module, styled as a compact HUD window.
    const panelWidth = 214;
    const panelHeight = 118;
    const rightMargin = 20;
    const panelX = width - panelWidth - rightMargin;
    const panelY = 20;
    svg.append("rect")
        .attr("x", panelX)
        .attr("y", panelY)
        .attr("width", panelWidth)
        .attr("height", panelHeight)
        .attr("rx", 4)
        .attr("fill", "rgba(232, 232, 222, 0.72)")
        .attr("stroke", "rgba(28, 28, 28, 0.34)")
        .attr("stroke-width", 1);

    svg.append("rect")
        .attr("x", panelX + 8)
        .attr("y", panelY + 8)
        .attr("width", panelWidth - 16)
        .attr("height", 24)
        .attr("rx", 2)
        .attr("fill", "rgba(24, 24, 24, 0.86)")
        .attr("stroke", "rgba(24, 24, 24, 0.9)");

    svg.append("text")
        .attr("x", panelX + 16)
        .attr("y", panelY + 24)
        .attr("font-family", "Share Tech Mono, monospace")
        .attr("font-size", "9px")
        .attr("font-weight", "700")
        .attr("fill", "#f1f1e8")
        .text("SYSTEM STATUS MODULE");

    svg.append("circle")
        .attr("cx", panelX + panelWidth - 20)
        .attr("cy", panelY + 20)
        .attr("r", 4)
        .attr("fill", "rgba(241, 241, 232, 0.9)");

    // Text in right panel - will be updated with real data
    const panelData = [
        {label: "Protection ring", value: "Ring 0"},
        {label: "Kernel", value: "Active"},
        {label: "Processes", value: "Loading..."},
        {label: "Memory", value: "Loading..."}
    ];
    
    panelData.forEach((item, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const boxW = 92;
        const boxH = 30;
        const boxX = panelX + 12 + col * 98;
        const boxY = panelY + 42 + row * 36;
        const textGroup = svg.append("g")
            .attr("class", `panel-item-${i}`);

        textGroup.append("rect")
            .attr("x", boxX)
            .attr("y", boxY)
            .attr("width", boxW)
            .attr("height", boxH)
            .attr("rx", 3)
            .attr("fill", i === 1 ? "rgba(24, 24, 24, 0.82)" : "rgba(255, 255, 255, 0.48)")
            .attr("stroke", "rgba(24, 24, 24, 0.18)")
            .attr("stroke-width", 0.7);

        textGroup.append("circle")
            .attr("cx", boxX + 9)
            .attr("cy", boxY + 10)
            .attr("r", 2.2)
            .attr("fill", i === 1 ? "#f1f1e8" : "rgba(24, 24, 24, 0.56)");

        textGroup.append("text")
            .attr("x", boxX + 16)
            .attr("y", boxY + 11)
            .text(item.label.toUpperCase())
            .attr("font-family", "Share Tech Mono, monospace")
            .attr("font-size", "6.8px")
            .attr("fill", i === 1 ? "#d8d8cf" : "rgba(40, 40, 40, 0.62)");

        textGroup.append("text")
            .attr("x", boxX + boxW - 8)
            .attr("y", boxY + 24)
            .text(item.value)
            .attr("font-family", "Share Tech Mono, monospace")
            .attr("font-size", "10px")
            .attr("fill", i === 1 ? "#f1f1e8" : "#222")
            .attr("id", `panel-value-${i}`)
            .attr("font-weight", "bold")
            .attr("text-anchor", "end");
    });
    
    // Update panel with real data
    updatePanelData();
}

// Load processes and kernel subsystems
function loadProcessKernelMap(centerX, centerY) {
    window.fetchJson('/api/process-kernel-map', { cache: 'no-store' }, {
        timeoutMs: 6500,
        retries: 1,
        context: 'process-kernel-map',
        toastMessage: 'Process graph is temporarily unavailable'
    })
        .then(data => {
            if (!data || data.error) {
                throw new Error(data?.error || 'No process map data');
            }
            return data;
        })
        .then(data => {
            drawProcessKernelMap(data, centerX, centerY);
        })
        .catch(error => {
            console.error('Error fetching process-kernel-map:', error);
            drawProcessKernelMap({}, centerX, centerY);
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
    window.fetchJson('/api/processes-detailed', { cache: 'no-store' }, {
        timeoutMs: 6500,
        retries: 1,
        context: 'processes-detailed',
        toastMessage: 'Process details are temporarily unavailable'
    })
        .then(data => {
            if (!data || data.error) {
                throw new Error(data?.error || 'No detailed processes data');
            }
            return data;
        })
        .then(data => {
            const processes = data.processes || [];
            const numProcesses = processes.length;
            const mobileLayout = isMobileLayout();
            const processAnchorsByName = new Map();

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
                debugLog('✅ Found nginx with files:', highlightedProcess.name, highlightedProcess.pid);
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
                    debugLog('✅ Found nginx (any):', highlightedProcess.name, highlightedProcess.pid);
                }
            }
            
            if (!highlightedProcess) {
                debugLog('⚠️ Nginx not found in processes list');
                debugLog('📋 Total processes:', processes.length);
                debugLog('📋 Process names (first 30):', processes.map(p => p.name || p.cmdline || 'unnamed').filter(Boolean).slice(0, 30));
                // Check if there are any processes with "nginx" in cmdline but not in name
                const nginxInCmdline = processes.filter(p => {
                    const cmdline = (p.cmdline || '').toLowerCase();
                    return cmdline.includes('nginx') && !cmdline.includes('nginx-files');
                });
                if (nginxInCmdline.length > 0) {
                    debugLog('🔍 Found processes with nginx in cmdline:', nginxInCmdline.map(p => ({
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
                    debugLog('✅ Selected process with most FDs (non-browser):', highlightedProcess.name, highlightedProcess.pid);
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
                    debugLog('✅ Selected process with most memory (non-browser):', highlightedProcess.name, highlightedProcess.pid);
                }
            }
            
            // Final fallback: if still nothing, just use first non-browser process
            if (!highlightedProcess) {
                highlightedProcess = processes.find(p => p.name && !isBrowserProcess(p.name));
                if (highlightedProcess) {
                    debugLog('✅ Selected first non-browser process:', highlightedProcess.name, highlightedProcess.pid);
                }
            }
            
            if (highlightedProcess) {
                debugLog('🎯 Highlighted process:', highlightedProcess.name, 'PID:', highlightedProcess.pid);
                window.__highlightedProcess = {
                    pid: highlightedProcess.pid,
                    name: highlightedProcess.name || 'userspace',
                    memory_mb: highlightedProcess.memory_mb ?? null,
                    num_fds: highlightedProcess.num_fds ?? null,
                    updatedAt: Date.now()
                };
                window.__highlightedProcessName = highlightedProcess.name || 'userspace';
            } else {
                console.warn('⚠️ No process selected for highlighting');
            }
            d3.selectAll('.process-interaction-module').remove();
            
            processes.forEach((process, i) => {
                const angle = i * 2 * Math.PI / numProcesses;
                
                // Calculate line length based on memory usage
                const memoryMb = process.memory_mb || 0;
                const memoryRatio = memoryRange > 0 ? (memoryMb - minMemory) / memoryRange : 0;
                
                // Keep mobile process circle compact so the full ring fits the viewport.
                const baseDistance = mobileLayout ? 150 : 250;
                const maxAdditionalDistance = mobileLayout ? 45 : 100;
                const distance = baseDistance + (memoryRatio * maxAdditionalDistance);
                
                const px = centerX + distance * Math.cos(angle);
                const py = centerY + distance * Math.sin(angle);
                const normalizedName = normalizeProcName(process.name || '');
                if (normalizedName) {
                    if (!processAnchorsByName.has(normalizedName)) {
                        processAnchorsByName.set(normalizedName, []);
                    }
                    processAnchorsByName.get(normalizedName).push({ x: px, y: py, pid: process.pid, name: process.name });
                }

                // Curve to process (same style as original)
                const cx1 = centerX + (px - centerX) * 0.3 + (Math.random() - 0.5) * 40;
                const cy1 = centerY + (py - centerY) * 0.3 + (Math.random() - 0.5) * 40;
                const cx2 = centerX + (px - centerX) * 0.7 + (Math.random() - 0.5) * 40;
                const cy2 = centerY + (py - centerY) * 0.7 + (Math.random() - 0.5) * 40;

                const path = `M${centerX},${centerY} C${cx1},${cy1} ${cx2},${cy2} ${px},${py}`;

                // On mobile the whole hero is scaled down by the viewBox, so the
                // near-invisible desktop links (opacity ~0.03) vanish entirely —
                // bump opacity and stroke so the radial fabric reads on a phone.
                const lineOpacity = mobileLayout ? (0.12 + Math.random() * 0.05) : (0.03 + Math.random() * 0.022);
                const lineWidth = mobileLayout ? 1.3 : 0.9;

                // Draw the line with animation
                const line = svg.append("path")
                    .attr("d", path)
                    .attr("class", "process-line")
                    .attr("data-pid", process.pid) // Store PID for highlighting
                    .attr("stroke", "url(#lineGradient)") // Use gradient for depth
                    .attr("stroke-width", lineWidth) // Thicker core/process links for stronger center hierarchy
                    .attr("data-original-stroke-width", lineWidth) // Store original stroke-width for restoration
                    .attr("data-original-opacity", lineOpacity) // Store original opacity
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
                    .attr("opacity", lineOpacity)
                    .attr("stroke-dashoffset", 0);

                // Determine if this is the highlighted process
                const isHighlighted = highlightedProcess && process.pid === highlightedProcess.pid;
                const isPinnedProcess = pinnedProcessDossier && pinnedProcessDossier.process?.pid === process.pid;
                const baseRadius = isPinnedProcess ? 4.8 : (isHighlighted ? 3 : (mobileLayout ? 2.3 : 1)); // Larger for highlighted/pinned process
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
                    .attr("fill", isPinnedProcess ? "#111" : "#888")
                    .attr("stroke", isPinnedProcess ? "#000" : "#555")
                    .attr("stroke-width", isPinnedProcess ? 2 : (isHighlighted ? 1 : 0.5))
                    .attr("opacity", 0)
                    .attr("class", "process-node")
                    .style("pointer-events", "none"); // Don't interfere with hit area

                if (isPinnedProcess) {
                    pinnedProcessDossier.anchor = { x: px, y: py };
                    line.attr("stroke", "#222")
                        .attr("stroke-width", 1.8)
                        .attr("opacity", 0.42)
                        .attr("data-original-opacity", 0.42);
                }

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
                    .on("click", function(event, d) {
                        event.stopPropagation();
                        const processData = d || process;
                        if (pinnedProcessDossier && pinnedProcessDossier.process?.pid !== processData.pid) {
                            clearPinnedProcessDossier();
                        }
                        pinProcessDossier(processData, { x: px, y: py });
                        svg.selectAll('.process-node-group').classed('process-pinned', false);
                        processGroup.classed('process-pinned', true);
                        svg.selectAll('.process-node')
                            .attr('stroke', '#555')
                            .attr('stroke-width', 0.5);
                        circle.interrupt()
                            .attr('r', 8)
                            .attr('fill', '#111')
                            .attr('stroke', '#000')
                            .attr('stroke-width', 2);
                    })
                    .on("mouseout", function(event, d) {
                        // Get the actual process data from the datum
                        const processData = d || process;
                        // Stop pulsing animation
                        processGroup.classed("hovered", false);
                        circle.interrupt(); // Stop any ongoing transitions
                        
                        // Reset circle size on mouseout
                        const isHighlighted = highlightedProcess && processData.pid === highlightedProcess.pid;
                        const isPinnedProcess = pinnedProcessDossier && pinnedProcessDossier.process?.pid === processData.pid;
                        if (!isHighlighted && !isPinnedProcess) {
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
                                .attr("r", isPinnedProcess ? 4.8 : baseRadius)
                                .attr("stroke-width", isPinnedProcess ? 2 : 1);
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

            // IPC outer ring is desktop-only; mobile mode keeps only central process composition.
            if (!mobileLayout) {
                drawIpcRelationshipRing(centerX, centerY, processAnchorsByName);
            } else {
                d3.selectAll('.ipc-ring-layer').remove();
            }
            renderProcessDossier();

            // Process lines radiate from the center and wash out the pulse grid;
            // lift it back above them so the central lattice stays visible.
            d3.selectAll('.central-pulse-grid-foreground').raise();
        })
        .catch(error => {
            console.error('Error fetching processes:', error);
        });
}

const missingModuleFunctionWarnings = new Set();

function callModuleFunction(moduleName, functionName, args = [], fallbackValue) {
    const mod = window[moduleName];
    const warningKey = `${moduleName}.${functionName}`;
    if (mod && typeof mod[functionName] === 'function') {
        return mod[functionName](...args);
    }
    if (!missingModuleFunctionWarnings.has(warningKey)) {
        const hasModule = Boolean(mod);
        const warningText = hasModule
            ? `[Main] Missing function "${functionName}" in module "${moduleName}", using fallback`
            : `[Main] Missing module "${moduleName}", using fallback for "${functionName}"`;
        if (typeof debugLog === 'function') {
            debugLog(warningText);
        } else {
            console.warn(warningText);
        }
        missingModuleFunctionWarnings.add(warningKey);
    }
    return fallbackValue;
}

function normalizeProcName(name) {
    return callModuleFunction('IpcUI', 'normalizeProcName', [name], '');
}

function getSharedChannelType(socketWeight, pipeWeight, shmWeight, nsWeight) {
    return callModuleFunction(
        'IpcUI',
        'getSharedChannelType',
        [socketWeight, pipeWeight, shmWeight, nsWeight],
        'UNKNOWN'
    );
}

function drawIpcRelationshipRing(centerX, centerY, processAnchorsByName) {
    return callModuleFunction('IpcUI', 'drawIpcRelationshipRing', [centerX, centerY, processAnchorsByName]);
}

function buildIpcRoutedPath(cx, cy, startX, startY, targetX, targetY, outerRingRadius, laneOffset = 0) {
    return callModuleFunction(
        'IpcUI',
        'buildIpcRoutedPath',
        [cx, cy, startX, startY, targetX, targetY, outerRingRadius, laneOffset],
        ''
    );
}

function drawBezierDecor(width, height, yBase) {
    return callModuleFunction('FlowUI', 'drawBezierDecor', [width, height, yBase]);
}

function drawBezierCoreBridge(width, height, yBase) {
    return callModuleFunction('FlowUI', 'drawBezierCoreBridge', [width, height, yBase]);
}

// Draw curves at bottom
function drawLowerBezierGrid(num = 90) {
    return callModuleFunction('FlowUI', 'drawLowerBezierGrid', [num]);
}

function fetchIsolationContext(forceRefresh = false) {
    return callModuleFunction('IsolationUI', 'fetchIsolationContext', [forceRefresh], Promise.resolve(null));
}

function drawIsolationConceptLayer(centerX, centerY, width, height) {
    return callModuleFunction('IsolationUI', 'drawIsolationConceptLayer', [centerX, centerY, width, height]);
}

function drawNamespaceShell(centerX, centerY, namespaces) {
    return callModuleFunction('IsolationUI', 'drawNamespaceShell', [centerX, centerY, namespaces]);
}

function drawCgroupConceptCard(width, height, topCgroups) {
    return callModuleFunction('IsolationUI', 'drawCgroupConceptCard', [width, height, topCgroups]);
}

// Show process files at the bottom of Bezier curves
function showProcessFilesOnCurves(pid, processName) {
    return callModuleFunction('ProcessFilesUI', 'showProcessFilesOnCurves', [pid, processName]);
}

// Show connections on curves (alternative to files)
function showConnectionsOnCurves(pid, connections) {
    return callModuleFunction('ProcessFilesUI', 'showConnectionsOnCurves', [pid, connections]);
}

// Hide process files
function hideProcessFilesOnCurves() {
    return callModuleFunction('ProcessFilesUI', 'hideProcessFilesOnCurves');
}

// Helper function for file type colors
function getFileTypeColor(type) {
    return callModuleFunction('ProcessFilesUI', 'getFileTypeColor', [type], '#888');
}

// Update panel with real data from API
function updatePanelData() {
    return callModuleFunction('UiChrome', 'updatePanelData');
}

// Draw social media icons
function drawSocialIcons(width, height) {
    return callModuleFunction('UiChrome', 'drawSocialIcons', [width, height]);
}

// Start application after DOM load
document.addEventListener('DOMContentLoaded', initApp);
