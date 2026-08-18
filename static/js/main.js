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
// Pixels-per-user-unit of the mobile hero frame; text divides by it to stay a
// constant size across screens. Set when the mobile viewBox is computed.
let mobileFrameScale = 1;
const MOBILE_HUD_FALLBACK_H = 72;
// Margin the mobile overlays keep from the screen edge and from each other.
const MOBILE_EDGE_GAP = 12;
const MOBILE_CHAMFER = 'polygon(0 0, calc(100% - 9px) 0, 100% 9px, 100% 100%, 0 100%)';
// Strip kept for the activity tape, and the height below which the hero stops
// giving it up because it would no longer read as the hero.
const MOBILE_TAPE_RESERVE = 150;
const MOBILE_HERO_MIN = 300;
const MOBILE_LABEL_MIN_SCALE = 0.64;
// Advance of Share Tech Mono at the 9px the ring labels render at.
const MOBILE_LABEL_CHAR_PX = 5.7;
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
        //
        // The notice above and the HUD below both cover the screen, so the hero
        // is fitted to the band between them rather than to the viewport: sizing
        // against the full height pushes it underneath one of them in landscape.
        renderMobileHud();
        const noticeEl = renderMobileNotice();
        const hudEl = document.getElementById('mobile-hud');
        const hudH = hudEl && hudEl.offsetHeight ? hudEl.offsetHeight : MOBILE_HUD_FALLBACK_H;
        const bandTop = noticeEl && noticeEl.offsetHeight
            ? MOBILE_EDGE_GAP + noticeEl.offsetHeight + MOBILE_EDGE_GAP
            : MOBILE_EDGE_GAP;
        const bandH = Math.max(180, height - hudH - bandTop);
        const frameHalf = 255;

        // A width-limited hero would otherwise take the whole band on a short
        // phone and squeeze the tape out of existence, so it gives up a strip
        // for the feed — but only while enough height is left to stay a hero.
        // What counts as "still a hero" scales with the screen: 300px is the
        // floor on a normal phone, less on a narrow one where the width caps it
        // anyway.
        const heroMin = Math.min(MOBILE_HERO_MIN, width * 0.8);
        const heroBand = bandH - MOBILE_TAPE_RESERVE >= heroMin
            ? bandH - MOBILE_TAPE_RESERVE
            : bandH;

        // Match the viewBox aspect to the viewport so `meet` yields exactly this
        // scale, which is the largest the hero can be in the space it is given.
        mobileFrameScale = Math.min(width, heroBand) / (frameHalf * 2);
        const vbW = width / mobileFrameScale;
        const vbH = height / mobileFrameScale;

        // On a narrow screen the hero is limited by width, so it can never fill
        // the height — centring it would strand that slack above and below.
        // Pinning it to the top of the band collects the slack into one band
        // underneath, which the activity tape then fills.
        const compH = frameHalf * 2 * mobileFrameScale;
        const vbY = centerY - frameHalf - bandTop / mobileFrameScale;
        svg.attr('viewBox', `${centerX - vbW / 2} ${vbY} ${vbW} ${vbH}`)
            .attr('preserveAspectRatio', 'xMidYMid meet');
        // The tape docks to whatever the hero leaves behind.
        window.__mobileHeroBottom = Math.round(bandTop + compH);
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
        drawMobileFormula(centerX, centerY);
        // Draw process ring only (no side/bottom UI layers, no tag/menu shells).
        // Ring labels are drawn once the process data lands, from real names.
        drawProcessKernelMap2(centerX, centerY);
        // Restore namespace shell segments in mobile mode.
        drawIsolationConceptLayer(centerX, centerY, width, height);
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

function drawMobileFormula(centerX, centerY) {
    const group = svg.append('g')
        .attr('class', 'mobile-formula-layer')
        .attr('pointer-events', 'none');

    // This lives in user units, which the frame scales. The size is divided by
    // that scale so the type lands at the same pixel size on a phone and on a
    // tablet instead of ballooning with the composition.
    const s = mobileFrameScale || 1;

    group.append('text')
        .attr('x', centerX)
        .attr('y', centerY - 246)
        .attr('text-anchor', 'middle')
        .style('font-family', 'Share Tech Mono, monospace')
        .style('font-size', `${(11 / s).toFixed(2)}px`)
        .style('letter-spacing', `${(0.4 / s).toFixed(2)}px`)
        .style('fill', 'rgba(52, 52, 52, 0.7)')
        .text('L_new = L_old·e^(-dt/tau) + N·(1-e^(-dt/tau))');
}

// Names the busiest processes around the hero. Drawn outside the node ring: the
// band inside it is already taken by the Ring-1 spokes and the KERNEL MODE
// label. Angles are offset by half a step so no name lands at the top or bottom,
// where the formula and the caption sit.
function drawMobileProcessLabels(centerX, centerY, names) {
    if (!isMobileLayout()) return;
    svg.selectAll('.mobile-process-labels').remove();
    if (!Array.isArray(names) || !names.length) return;
    // Names are held at a constant pixel size, so the smaller the composition
    // the more of it they take up. Past this point they crowd the ring instead
    // of annotating it, and the ring reads better bare.
    if ((mobileFrameScale || 1) < MOBILE_LABEL_MIN_SCALE) return;

    // Diagonals only. On the horizontal and vertical axes a name has nowhere to
    // grow — outward runs past the frame, inward crowds the ring — while on a
    // diagonal both the frame corner and the ring leave room.
    const radius = 226;
    const startAngle = -Math.PI / 4;
    const step = (2 * Math.PI) / names.length;

    const group = svg.append('g')
        .attr('class', 'mobile-process-labels')
        .attr('pointer-events', 'none');

    // How many characters fit between the anchor and the screen edge. All four
    // diagonals share the same horizontal offset, so one budget covers them.
    const s = mobileFrameScale || 1;
    const room = window.innerWidth / 2 - Math.abs(Math.cos(startAngle)) * radius * s - 8;
    const maxChars = Math.max(6, Math.floor(room / MOBILE_LABEL_CHAR_PX));

    names.forEach((name, i) => {
        const angle = startAngle + i * step;
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;
        // Grow outward, away from the ring, into the free frame corner.
        const anchor = Math.cos(angle) > 0 ? 'start' : 'end';
        group.append('text')
            .attr('x', x)
            .attr('y', y)
            .attr('text-anchor', anchor)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', `${(9 / (mobileFrameScale || 1)).toFixed(2)}px`)
            .style('letter-spacing', `${(0.6 / (mobileFrameScale || 1)).toFixed(2)}px`)
            .style('fill', 'rgba(96, 96, 96, 0.62)')
            .text(name.length > maxChars ? `${name.slice(0, maxChars - 1)}…` : name);
    });
}

// The busiest distinct process names, which is what the hero ring labels.
function topProcessNames(processes, limit) {
    const seen = new Set();
    const out = [];
    [...processes]
        .sort((a, b) => (b.memory_mb || 0) - (a.memory_mb || 0))
        .forEach((p) => {
            const name = (p.name || '').trim();
            if (!name || seen.has(name) || out.length >= limit) return;
            seen.add(name);
            out.push(name);
        });
    return out;
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
            display: 'flex', gap: '6px', justifyContent: 'center',
            padding: '8px 8px calc(8px + env(safe-area-inset-bottom))',
            background: 'linear-gradient(0deg, rgba(8,10,13,0.94) 0%, rgba(8,10,13,0.0) 100%)',
            fontFamily: DOSSIER.mono, pointerEvents: 'none'
        });
        // Chamfered like the dossier cards. clip-path drops the border, so the
        // edge is a second clipped layer showing through by one pixel.
        MOBILE_HUD_TILES.forEach((tile) => {
            const cell = document.createElement('div');
            Object.assign(cell.style, {
                flex: '1 1 0', maxWidth: '120px', background: DOSSIER.edge,
                clipPath: MOBILE_CHAMFER, padding: '1px'
            });
            const inner = document.createElement('div');
            Object.assign(inner.style, {
                textAlign: 'center', background: '#090c10', clipPath: MOBILE_CHAMFER,
                padding: '7px 4px 8px'
            });
            const val = document.createElement('div');
            val.id = `mobile-hud-${tile.id}`;
            val.textContent = '--';
            Object.assign(val.style, { color: DOSSIER.text, fontSize: '20px', lineHeight: '1.1' });
            const lab = document.createElement('div');
            lab.textContent = tile.label;
            Object.assign(lab.style, { color: DOSSIER.faint, fontSize: '9px', letterSpacing: '1.7px', marginTop: '4px' });
            inner.append(val, lab);
            cell.appendChild(inner);
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

// Says plainly that the full console is a desktop composition. Same card
// language as the HUD and the activity tape, and dismissible for the session.
function renderMobileNotice() {
    if (window.__mobileNoticeDismissed) return null;
    let notice = document.getElementById('mobile-notice');
    if (!notice) {
        notice = document.createElement('div');
        notice.id = 'mobile-notice';
        Object.assign(notice.style, {
            position: 'fixed', left: `${MOBILE_EDGE_GAP}px`, right: `${MOBILE_EDGE_GAP}px`,
            top: `calc(${MOBILE_EDGE_GAP}px + env(safe-area-inset-top))`, zIndex: '8200',
            background: DOSSIER.edge, clipPath: MOBILE_CHAMFER, padding: '1px',
            fontFamily: DOSSIER.mono
        });

        const inner = document.createElement('div');
        Object.assign(inner.style, {
            background: '#090c10', clipPath: MOBILE_CHAMFER, padding: '8px 10px 9px'
        });

        const head = document.createElement('div');
        Object.assign(head.style, { display: 'flex', alignItems: 'center', gap: '7px' });
        const glyph = document.createElement('span');
        glyph.textContent = '◉';
        Object.assign(glyph.style, { color: DOSSIER.dim, fontSize: '9px', flex: '0 0 auto' });
        const title = document.createElement('span');
        title.textContent = 'DESIGNED FOR DESKTOP';
        Object.assign(title.style, {
            color: DOSSIER.text, fontSize: '10px', letterSpacing: '1.7px', flex: '1 1 auto'
        });
        const close = document.createElement('button');
        close.textContent = '×';
        Object.assign(close.style, {
            flex: '0 0 auto', cursor: 'pointer', background: 'transparent', border: 'none',
            color: DOSSIER.faint, font: `13px/1 ${DOSSIER.mono}`, padding: '0 0 0 4px'
        });
        close.addEventListener('click', () => {
            window.__mobileNoticeDismissed = true;
            notice.style.display = 'none';
            // Reclaim the strip the notice was holding.
            if (typeof draw === 'function') draw();
        });
        head.append(glyph, title, close);

        const detail = document.createElement('div');
        detail.textContent = 'panels · dossier · kernel map need a large screen';
        Object.assign(detail.style, {
            color: DOSSIER.faint, fontSize: '9px', letterSpacing: '0.5px',
            lineHeight: '1.4', marginTop: '5px'
        });

        inner.append(head, detail);
        notice.appendChild(inner);
        document.body.appendChild(notice);
    }
    notice.style.display = 'block';
    return notice;
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

function processIoSummary(processData, details = {}) {
    const fdsData = details.fdsData || {};
    return {
        fds: fdsData.num_fds !== undefined ? fdsData.num_fds : formatProcessValue(processData.num_fds, 0),
        files: Array.isArray(fdsData.open_files) ? fdsData.open_files.length : 0,
        sockets: Array.isArray(fdsData.connections) ? fdsData.connections.length : 0
    };
}

function descriptorTargetLabel(descriptor) {
    if (!descriptor) return '';
    if (descriptor.remote_address) return descriptor.remote_address;
    if (descriptor.local_address) return descriptor.local_address;
    return String(descriptor.target || '');
}

// ── Process dossier ─────────────────────────────────────────────────────────
// Layered dark cards over the dimmed map: identity → vitals → descriptors.
// One cascading stack instead of scattered panels, so the eye reads top-down.
const DOSSIER = {
    ink: 'rgba(9, 12, 16, 0.975)',
    edge: 'rgba(236, 236, 226, 0.17)',
    rule: 'rgba(236, 236, 226, 0.1)',
    tint: 'rgba(244, 244, 236, 0.055)',
    text: '#f4f4ec',
    dim: 'rgba(244, 244, 236, 0.5)',
    faint: 'rgba(244, 244, 236, 0.26)',
    accent: '#e2a33e',
    mono: 'Share Tech Mono, monospace'
};

const KERNEL_THREAD_RE = /^(kworker|ksoftirqd|migration|rcu_|rcub|rcuc|kthreadd|kswapd|kcompactd|khugepaged|kdevtmpfs|kauditd|jbd2|ext4-|xfs-|watchdog|irq\/|idle_inject|cpuhp|netns|kblockd|blkcg|scsi_|nvme|kstrp|oom_reaper|writeback|kintegrityd|kthrotld|dmcrypt|edac-|devfreq|acpi_|ipv6_addrconf)/i;

// kthreadd (pid 2) fathers every kernel thread, so the ancestry settles this
// definitively. The name pattern is only a stand-in until lineage arrives.
function isKernelThreadProcess(processData, lineage) {
    const chain = lineage && Array.isArray(lineage.chain) ? lineage.chain : null;
    if (chain && chain.length) {
        return Number(processData.pid) === 2 || chain.some((row) => Number(row.pid) === 2);
    }
    return KERNEL_THREAD_RE.test(String(processData.name || ''))
        && Number(processData.memory_mb || 0) === 0;
}

function ensureDossierDefs() {
    let defs = svg.select('defs');
    if (defs.empty()) defs = svg.append('defs');
    if (svg.select('#dossier-drop').empty()) {
        defs.append('filter')
            .attr('id', 'dossier-drop')
            .attr('x', '-35%').attr('y', '-35%')
            .attr('width', '190%').attr('height', '200%')
            .append('feDropShadow')
            .attr('dx', 0).attr('dy', 7)
            .attr('stdDeviation', 10)
            .attr('flood-color', '#07090c')
            .attr('flood-opacity', 0.45);
    }
}

// Square card with the clipped top-right corner of the reference dossier.
function dossierCardPath(x, y, w, h, cut = 15) {
    return `M${x},${y} H${x + w - cut} L${x + w},${y + cut} V${y + h} H${x} Z`;
}

function dossierCard(layer, box, title, meta) {
    const g = layer.append('g');

    g.append('path')
        .attr('d', dossierCardPath(box.x, box.y, box.w, box.h))
        .attr('fill', DOSSIER.ink)
        .attr('stroke', DOSSIER.edge)
        .attr('stroke-width', 1)
        .attr('filter', 'url(#dossier-drop)');

    g.append('path')
        .attr('d', `M${box.x},${box.y} H${box.x + box.w - 15} L${box.x + box.w},${box.y + 15} V${box.y + 25} H${box.x} Z`)
        .attr('fill', DOSSIER.tint);

    g.append('line')
        .attr('x1', box.x).attr('x2', box.x + box.w)
        .attr('y1', box.y + 25).attr('y2', box.y + 25)
        .attr('stroke', DOSSIER.edge)
        .attr('stroke-width', 0.9);

    g.append('circle')
        .attr('cx', box.x + 14).attr('cy', box.y + 12.5).attr('r', 4.2)
        .attr('fill', 'none')
        .attr('stroke', DOSSIER.dim)
        .attr('stroke-width', 1.1);
    g.append('circle')
        .attr('cx', box.x + 14).attr('cy', box.y + 12.5).attr('r', 1.6)
        .attr('fill', DOSSIER.accent);

    g.append('text')
        .attr('x', box.x + 26).attr('y', box.y + 16)
        .attr('font-family', DOSSIER.mono)
        .attr('font-size', '9px')
        .attr('letter-spacing', '1.7')
        .attr('fill', DOSSIER.text)
        .text(title);

    if (meta) {
        g.append('text')
            .attr('x', box.x + box.w - 13).attr('y', box.y + 16)
            .attr('text-anchor', 'end')
            .attr('font-family', DOSSIER.mono)
            .attr('font-size', '9px')
            .attr('letter-spacing', '1')
            .attr('fill', DOSSIER.dim)
            .text(meta);
    }
    return g;
}

// Paths carry their meaning at the tail, so clip the front, not the end.
function elideDescriptorTarget(target, max) {
    const text = String(target || '');
    if (text.length <= max) return text;
    return text.includes('/') ? `…${text.slice(-(max - 1))}` : `${text.slice(0, max - 1)}…`;
}

function schedulingRows(processData, threadsData, cpuData, kernelThread, fdsData) {
    if (!fdsData) return [{ key: 'reading', value: `/proc/${processData.pid} …` }];

    const times = cpuData.cpu_times || {};
    const vol = threadsData.voluntary_ctxt_switches;
    const nonvol = threadsData.nonvoluntary_ctxt_switches;
    const affinity = Array.isArray(cpuData.cpu_affinity) ? cpuData.cpu_affinity : null;
    const rows = [];

    if (vol !== undefined || nonvol !== undefined) {
        rows.push({ key: 'ctx switches', value: `${Number(vol || 0).toLocaleString()} vol · ${Number(nonvol || 0).toLocaleString()} forced` });
    }
    if (times.user !== undefined) {
        rows.push({ key: 'cpu time', value: `usr ${times.user}s · sys ${times.system}s` });
    }
    if (affinity) {
        rows.push({ key: 'affinity', value: `cpu ${affinity.length > 4 ? `${affinity.length} cores` : affinity.join(',')}` });
    }
    rows.push({
        key: 'descriptors',
        value: kernelThread ? 'none — kernel task' : 'not readable at this privilege'
    });
    return rows;
}

function dossierVerdict(processData, fp, kernelThread) {
    if (kernelThread) {
        return 'Kernel thread — no userspace address space or file table.';
    }
    const isolated = fp ? Number(fp.isolated_count || 0) : 0;
    if (isolated > 0) {
        return `Containerized — ${isolated} of ${fp.total} namespaces isolated from host.`;
    }
    if (fp && Number(fp.readable || 0) === 0) {
        return 'Host process — namespace table not readable at this privilege.';
    }
    if (fp) {
        return `Host process — shares all ${fp.total} namespaces with the host.`;
    }
    return 'Reading namespace table…';
}

// ── live activity sampling ──────────────────────────────────────────────────
// The API only exposes cumulative counters, so rates come from differencing two
// samples client-side. Nothing is drawn until a second sample lands.
const DOSSIER_SAMPLE_INTERVAL_MS = 2000;
const DOSSIER_SAMPLE_LIMIT = 31;
const ACTIVITY_BAR_SLOTS = 22;
const ACTIVITY_METRICS = [
    {
        id: 'ctx',
        label: 'ctx rate',
        rate: (a, b, dt) => {
            const prev = numOrNull(a.ctx_voluntary, a.ctx_nonvoluntary);
            const next = numOrNull(b.ctx_voluntary, b.ctx_nonvoluntary);
            return prev === null || next === null ? null : (next - prev) / dt;
        },
        format: (v) => `${v < 10 ? v.toFixed(1) : Math.round(v)}/s`,
        unavailable: 'counter not readable'
    },
    {
        id: 'cpu',
        label: 'cpu burn',
        rate: (a, b, dt) => {
            const prev = numOrNull(a.cpu_user, a.cpu_system);
            const next = numOrNull(b.cpu_user, b.cpu_system);
            return prev === null || next === null ? null : ((next - prev) / dt) * 100;
        },
        format: (v) => `${v < 10 ? v.toFixed(1) : Math.round(v)}%`,
        unavailable: 'cpu times denied'
    },
    {
        id: 'io',
        label: 'disk i/o',
        rate: (a, b, dt) => {
            const prev = numOrNull(a.read_bytes, a.write_bytes);
            const next = numOrNull(b.read_bytes, b.write_bytes);
            return prev === null || next === null ? null : (next - prev) / dt;
        },
        format: (v) => formatByteRate(v),
        unavailable: 'io counters denied'
    }
];

// Sums the arguments, or reports null when any part is missing.
function numOrNull(...values) {
    let total = 0;
    for (const value of values) {
        if (value === null || value === undefined) return null;
        total += Number(value);
    }
    return total;
}

function formatByteRate(bytesPerSec) {
    const v = Math.max(0, Number(bytesPerSec) || 0);
    if (v < 1024) return `${Math.round(v)} B/s`;
    if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB/s`;
    return `${(v / (1024 * 1024)).toFixed(1)} MB/s`;
}

function activitySeries(metric, samples) {
    const series = [];
    for (let i = 1; i < samples.length; i += 1) {
        const dt = Math.max(0.2, Number(samples[i].ts) - Number(samples[i - 1].ts));
        const rate = metric.rate(samples[i - 1], samples[i], dt);
        // Counters only climb; a negative step means the pid was recycled.
        series.push(rate === null || rate < 0 ? null : rate);
    }
    return series.slice(-ACTIVITY_BAR_SLOTS);
}

let dossierActivityTimer = null;

function startDossierActivityPolling(pid) {
    stopDossierActivityPolling();
    const tick = () => {
        if (!pinnedProcessDossier || pinnedProcessDossier.process?.pid !== pid) {
            stopDossierActivityPolling();
            return;
        }
        if (document.hidden) return;
        fetch(`/api/process/${pid}/activity`)
            .then((r) => r.json())
            .then((sample) => {
                if (!pinnedProcessDossier || pinnedProcessDossier.process?.pid !== pid) return;
                if (!sample || sample.error) return;
                const samples = pinnedProcessDossier.samples || (pinnedProcessDossier.samples = []);
                samples.push(sample);
                if (samples.length > DOSSIER_SAMPLE_LIMIT) samples.shift();
                drawActivityRows();
            })
            .catch(() => {});
    };
    tick();
    dossierActivityTimer = setInterval(tick, DOSSIER_SAMPLE_INTERVAL_MS);
}

function stopDossierActivityPolling() {
    if (dossierActivityTimer) {
        clearInterval(dossierActivityTimer);
        dossierActivityTimer = null;
    }
}

// Redraws only the activity rows so polling never restarts the rest of the
// dossier (the containment halo animates, and a full redraw would reset it).
function drawActivityRows() {
    const host = d3.select('.process-dossier-layer').select('.dossier-activity-rows');
    if (host.empty() || !pinnedProcessDossier || !pinnedProcessDossier.activityBox) return;
    host.selectAll('*').remove();

    const box = pinnedProcessDossier.activityBox;
    const samples = pinnedProcessDossier.samples || [];

    // Drawn here rather than in the card header so the span stays current.
    const spanS = samples.length > 1
        ? Math.round(Number(samples[samples.length - 1].ts) - Number(samples[0].ts))
        : 0;
    host.append('text')
        .attr('x', box.x + box.w - 13).attr('y', box.y + 16)
        .attr('text-anchor', 'end')
        .attr('font-family', DOSSIER.mono)
        .attr('font-size', '9px')
        .attr('letter-spacing', '1')
        .attr('fill', DOSSIER.dim)
        .text(spanS > 0 ? `mean over ${spanS}s` : 'starting…');
    const barW = 4;
    const barGap = 1;
    const stripW = ACTIVITY_BAR_SLOTS * (barW + barGap);
    const stripX = box.x + box.w - 82 - stripW;
    const maxBarH = 11;

    ACTIVITY_METRICS.forEach((metric, idx) => {
        const y = box.y + 42 + idx * 18;

        host.append('text')
            .attr('x', box.x + 16).attr('y', y)
            .attr('font-family', DOSSIER.mono)
            .attr('font-size', '9px')
            .attr('fill', DOSSIER.dim)
            .text(metric.label);

        if (samples.length < 2) {
            host.append('text')
                .attr('x', box.x + box.w - 14).attr('y', y)
                .attr('text-anchor', 'end')
                .attr('font-family', DOSSIER.mono)
                .attr('font-size', '9px')
                .attr('fill', DOSSIER.faint)
                .text(samples.length ? 'sampling…' : 'waiting…');
            return;
        }

        const series = activitySeries(metric, samples);
        const known = series.filter((v) => v !== null);
        if (!known.length) {
            host.append('text')
                .attr('x', box.x + box.w - 14).attr('y', y)
                .attr('text-anchor', 'end')
                .attr('font-family', DOSSIER.mono)
                .attr('font-size', '9px')
                .attr('fill', DOSSIER.faint)
                .text(metric.unavailable);
            return;
        }

        // Each row scales to its own peak; absolute units live in the readout.
        const peak = Math.max(...known);
        series.forEach((value, i) => {
            const x = stripX + (ACTIVITY_BAR_SLOTS - series.length + i) * (barW + barGap);
            if (value === null) return;
            const h = peak > 0 ? Math.max(1, (value / peak) * maxBarH) : 1;
            host.append('rect')
                .attr('x', x).attr('y', y - 2 - h)
                .attr('width', barW).attr('height', h)
                .attr('fill', value > 0 ? DOSSIER.accent : 'rgba(244, 244, 236, 0.16)');
        });

        // Bursty processes read 0 on any single sample, so the readout is the
        // window mean and the bars carry the per-sample shape.
        const mean = known.reduce((sum, v) => sum + v, 0) / known.length;
        host.append('text')
            .attr('x', box.x + box.w - 14).attr('y', y)
            .attr('text-anchor', 'end')
            .attr('font-family', DOSSIER.mono)
            .attr('font-size', '11px')
            .attr('fill', mean > 0 ? DOSSIER.accent : DOSSIER.faint)
            .text(metric.format(mean));
    });
}

// Ancestry rows for the lineage card: init first, the process itself last.
// Each row carries the gap since its parent started, so the card reads as a
// spawn chronology rather than repeating the same age on every line.
// Long chains collapse in the middle so the card never outgrows the viewport.
function lineageRows(lineage, maxRows) {
    const chain = lineage && Array.isArray(lineage.chain) ? lineage.chain : [];
    if (!chain.length) return [];

    const withDelta = chain.map((row, i) => {
        const prev = i > 0 ? chain[i - 1] : null;
        const delta = prev && row.create_time && prev.create_time
            ? row.create_time - prev.create_time
            : null;
        return { row, delta };
    });

    if (withDelta.length <= maxRows) return withDelta;
    return [
        withDelta[0],
        { gap: withDelta.length - (maxRows - 1) },
        ...withDelta.slice(-(maxRows - 2))
    ];
}

function formatSpawnDelta(seconds) {
    const s = Number(seconds);
    if (!Number.isFinite(s)) return '';
    if (s < 1) return '+<1s';
    if (s < 90) return `+${Math.round(s)}s`;
    if (s < 5400) return `+${(s / 60).toFixed(1)}m`;
    if (s < 172800) return `+${(s / 3600).toFixed(1)}h`;
    return `+${(s / 86400).toFixed(1)}d`;
}

function formatProcessAge(seconds) {
    const s = Number(seconds || 0);
    if (!Number.isFinite(s) || s <= 0) return '—';
    if (s < 60) return `${Math.round(s)}s`;
    if (s < 3600) return `${Math.round(s / 60)}m`;
    if (s < 86400) return `${(s / 3600).toFixed(1)}h`;
    return `${(s / 86400).toFixed(1)}d`;
}

function formatStartClock(createTime) {
    if (!createTime) return '—';
    const d = new Date(Number(createTime) * 1000);
    if (Number.isNaN(d.getTime())) return '—';
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function renderProcessDossier() {
    d3.selectAll('.process-dossier-layer').remove();
    if (!pinnedProcessDossier || !pinnedProcessDossier.process || !pinnedProcessDossier.anchor) return;

    ensureDossierDefs();

    const width = window.innerWidth;
    const height = window.innerHeight;
    const processData = pinnedProcessDossier.process;
    const anchor = pinnedProcessDossier.anchor;
    const details = pinnedProcessDossier.details || {};
    const fdsData = details.fdsData || null;
    const threadsData = details.threadsData || {};
    const cpuData = details.cpuData || {};
    const lineage = details.lineage || null;
    const fp = fdsData ? (fdsData.namespace_fingerprint || null) : null;
    const io = processIoSummary(processData, details);
    const kernelThread = isKernelThreadProcess(processData, lineage);

    const cpuPercent = Number(cpuData.cpu_percent || processData.cpu_percent || 0);
    const memoryMb = Number(processData.memory_mb || 0);
    const threadCount = Number(threadsData.thread_count || processData.num_threads || 0);

    const cardW = 358;
    const stackX = Math.max(72, Math.min(width * 0.5 - 300, width - cardW - 380));
    const overlap = 6;

    // ── measure every card before placing the stack ────────────────────────
    const nsList = fp && Array.isArray(fp.namespaces) ? fp.namespaces : [];
    const showChips = nsList.some((ns) => ns.isolated);

    const heroName = String(processData.name || 'process').toUpperCase().slice(0, 20);
    const heroSize = heroName.length > 17 ? 17 : (heroName.length > 13 ? 21 : 26);
    const verdictLines = wrapDossierLines(dossierVerdict(processData, fp, kernelThread), 12, cardW - 32, 2);

    const heroRel = 39 + heroSize * 0.76;
    const classRel = heroRel + 19;
    const ruleRel = classRel + 14;
    const labelRel = ruleRel + 17;
    const verdictRel = labelRel + 16;
    const chipsRel = verdictRel + verdictLines.length * 13 + 4;
    const idH = (showChips ? chipsRel + 16 : chipsRel) + 14;

    const vitH = 84;

    const descriptors = fdsData && Array.isArray(fdsData.descriptors) ? fdsData.descriptors : [];
    const fdRows = descriptors.slice(0, 6);
    const bodyRows = fdRows.length
        ? fdRows.map((d) => ({
            key: `fd ${d.fd}`,
            mid: String(d.type || 'fd').toLowerCase().slice(0, 10),
            // Drop the prefixes the type column already states.
            value: elideDescriptorTarget(
                descriptorTargetLabel(d)
                    .replace(/^socket:\[/, 'socket[')
                    .replace(/^anon_inode:/, ''),
                20
            )
        }))
        : schedulingRows(processData, threadsData, cpuData, kernelThread, fdsData);
    const fdTotal = Math.max(Number(io.fds || 0), descriptors.length);
    const hasFooter = fdRows.length > 0 && fdTotal > fdRows.length;
    const fdH = 36 + bodyRows.length * 16 + 10 + (hasFooter ? 14 : 0);

    const actH = 34 + ACTIVITY_METRICS.length * 18 + 8;

    // Activity is live, so it keeps its slot; lineage takes what is left over.
    const fixedH = idH + (vitH - overlap) + (fdH - overlap) + (actH - overlap);
    const roomForLineage = height - 72 - fixedH - 36;
    const maxLineRows = Math.max(0, Math.min(6, Math.floor((roomForLineage - 52) / 20)));
    const lineRows = maxLineRows >= 3 ? lineageRows(lineage, maxLineRows) : [];
    const lineH = lineRows.length ? 34 + lineRows.length * 20 + 8 : 0;

    const totalH = fixedH + (lineH ? lineH - overlap : 0);
    const stackY = Math.max(64, Math.min(height * 0.17, height - totalH - 32));

    const layer = svg.append('g')
        .attr('class', 'process-dossier-layer')
        .attr('pointer-events', 'none');

    // ── link back to the selected node on the map ──────────────────────────
    const linkX = stackX + cardW;
    const linkY = stackY + 46;
    layer.append('path')
        .attr('d', `M${anchor.x},${anchor.y} C${anchor.x - 60},${anchor.y} ${linkX + 70},${linkY} ${linkX},${linkY}`)
        .attr('fill', 'none')
        .attr('stroke', 'rgba(20, 24, 30, 0.42)')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4 4');
    layer.append('circle')
        .attr('cx', anchor.x).attr('cy', anchor.y).attr('r', 8.5)
        .attr('fill', 'none')
        .attr('stroke', DOSSIER.accent)
        .attr('stroke-width', 1.6);
    layer.append('circle')
        .attr('cx', anchor.x).attr('cy', anchor.y).attr('r', 2.4)
        .attr('fill', DOSSIER.accent);

    // ── card 1 · identity ──────────────────────────────────────────────────
    const idBox = { x: stackX, y: stackY, w: cardW, h: idH };
    const idCard = dossierCard(layer, idBox, 'PROCESS DOSSIER', `PID ${formatProcessValue(processData.pid)}`);

    idCard.append('text')
        .attr('x', idBox.x + 16).attr('y', idBox.y + heroRel)
        .attr('font-family', DOSSIER.mono)
        .attr('font-size', `${heroSize}px`)
        .attr('letter-spacing', '1.2')
        .attr('fill', DOSSIER.text)
        .text(heroName);

    idCard.append('text')
        .attr('x', idBox.x + 16).attr('y', idBox.y + classRel)
        .attr('font-family', DOSSIER.mono)
        .attr('font-size', '11px')
        .attr('letter-spacing', '1.4')
        .attr('fill', DOSSIER.dim)
        .text(`${kernelThread ? 'KERNEL THREAD' : 'USER PROCESS'} [${String(processData.status || '?').slice(0, 1).toUpperCase()}]`);

    idCard.append('line')
        .attr('x1', idBox.x + 16).attr('x2', idBox.x + idBox.w - 16)
        .attr('y1', idBox.y + ruleRel).attr('y2', idBox.y + ruleRel)
        .attr('stroke', DOSSIER.rule)
        .attr('stroke-width', 1);

    idCard.append('text')
        .attr('x', idBox.x + 16).attr('y', idBox.y + labelRel)
        .attr('font-family', DOSSIER.mono)
        .attr('font-size', '9px')
        .attr('letter-spacing', '1.2')
        .attr('fill', DOSSIER.faint)
        .text('ASSESSMENT');

    verdictLines.forEach((line, i) => {
        idCard.append('text')
            .attr('x', idBox.x + 16).attr('y', idBox.y + verdictRel + i * 13)
            .attr('font-family', DOSSIER.mono)
            .attr('font-size', '12px')
            .attr('fill', DOSSIER.text)
            .text(line);
    });

    if (showChips) {
        const chipW = (idBox.w - 32 - 5 * 5) / 6;
        nsList.slice(0, 6).forEach((ns, i) => {
            const cx = idBox.x + 16 + i * (chipW + 5);
            const cy = idBox.y + chipsRel;
            const own = !!ns.isolated;
            idCard.append('rect')
                .attr('x', cx).attr('y', cy)
                .attr('width', chipW).attr('height', 16)
                .attr('rx', 3)
                .attr('fill', own ? 'rgba(226, 163, 62, 0.18)' : 'rgba(255, 255, 255, 0.04)')
                .attr('stroke', own ? DOSSIER.accent : DOSSIER.edge)
                .attr('stroke-width', own ? 1 : 0.8)
                .style('pointer-events', 'all')
                .style('cursor', 'help')
                .on('mouseenter', (event) => showNamespaceCellTooltip(event, ns))
                .on('mousemove', (event) => {
                    d3.selectAll('.ns-fp-tooltip')
                        .style('left', `${event.pageX + 12}px`)
                        .style('top', `${event.pageY - 10}px`);
                })
                .on('mouseleave', () => d3.selectAll('.ns-fp-tooltip').remove());

            idCard.append('text')
                .attr('x', cx + chipW / 2).attr('y', cy + 11)
                .attr('text-anchor', 'middle')
                .attr('font-family', DOSSIER.mono)
                .attr('font-size', '9px')
                .attr('fill', own ? DOSSIER.accent : DOSSIER.dim)
                .text(ns.label || String(ns.id || '').toUpperCase());
        });
    }

    // ── card 2 · vitals ────────────────────────────────────────────────────
    const vitBox = { x: stackX + 30, y: stackY + idH - overlap, w: cardW - 26, h: vitH };
    const vitCard = dossierCard(layer, vitBox, 'RESOURCES', kernelThread ? 'kernel space' : 'userspace');

    // Amber marks a live value, grey a zero — the row reads at a glance.
    const vitals = [
        { label: 'CPU', value: `${Math.round(cpuPercent)}`, unit: '%', live: cpuPercent > 0 },
        {
            label: 'MEMORY',
            value: memoryMb >= 100 ? `${Math.round(memoryMb)}` : memoryMb.toFixed(1),
            unit: 'MB',
            live: memoryMb > 0,
            open: window.MemoryCard ? MemoryCard.open : null
        },
        // The count is a door: the threads are what the kernel schedules, and
        // the card behind it says what each of them is doing.
        {
            label: 'THREADS',
            value: `${threadCount}`,
            unit: '',
            live: threadCount > 0,
            open: threadCount > 0 && window.ThreadsCard ? ThreadsCard.open : null
        },
        // Named for what it is: inet connections, not every socket fd.
        {
            label: 'NET CONNS',
            value: `${io.sockets}`,
            unit: '',
            live: Number(io.sockets || 0) > 0,
            open: Number(io.sockets || 0) > 0 && window.SocketsCard ? SocketsCard.open : null
        }
    ];
    const colW = (vitBox.w - 28) / vitals.length;
    vitals.forEach((v, i) => {
        const cx = vitBox.x + 14 + i * colW;
        vitCard.append('text')
            .attr('x', cx).attr('y', vitBox.y + 56)
            .attr('font-family', DOSSIER.mono)
            .attr('font-size', '20px')
            .attr('fill', v.live ? DOSSIER.accent : DOSSIER.faint)
            .text(v.value);
        if (v.unit) {
            vitCard.append('text')
                .attr('x', cx + String(v.value).length * 12 + 2).attr('y', vitBox.y + 56)
                .attr('font-family', DOSSIER.mono)
                .attr('font-size', '9px')
                .attr('fill', v.live ? 'rgba(226, 163, 62, 0.7)' : DOSSIER.faint)
                .text(v.unit);
        }
        const label = vitCard.append('text')
            .attr('x', cx).attr('y', vitBox.y + 72)
            .attr('font-family', DOSSIER.mono)
            .attr('font-size', '9px')
            .attr('letter-spacing', '1.2')
            .attr('fill', DOSSIER.dim)
            .text(v.label);

        if (!v.open) return;
        const labelW = v.label.length * 6.6;
        const rule = vitCard.append('line')
            .attr('x1', cx).attr('x2', cx + labelW)
            .attr('y1', vitBox.y + 76).attr('y2', vitBox.y + 76)
            .attr('stroke', DOSSIER.accent)
            .attr('stroke-width', 1)
            .attr('opacity', 0.35);
        vitCard.append('rect')
            .attr('x', cx - 8).attr('y', vitBox.y + 36)
            .attr('width', Math.max(46, colW - 6)).attr('height', 44)
            .attr('fill', 'transparent')
            .style('pointer-events', 'all')
            .style('cursor', 'pointer')
            .on('mouseenter', () => {
                rule.attr('opacity', 1);
                label.attr('fill', DOSSIER.accent);
            })
            .on('mouseleave', () => {
                rule.attr('opacity', 0.35);
                label.attr('fill', DOSSIER.dim);
            })
            .on('click', (event) => {
                event.stopPropagation();
                v.open(processData.pid, {
                    x: cx + 20,
                    y: vitBox.y + 56,
                    // Each card of the stack is inset further right than the
                    // one above it; clear the widest of them.
                    clearOf: stackX + cardW + 34
                });
            });
    });

    // ── card 3 · descriptors when readable, otherwise scheduling ───────────
    // /proc/<pid>/fd is unreadable for foreign processes at our privilege, so
    // rather than a permanently empty table we fall back to data we do have.
    const fdBox = { x: stackX + 60, y: vitBox.y + vitBox.h - overlap, w: cardW - 52, h: fdH };
    const fdCard = dossierCard(
        layer,
        fdBox,
        fdRows.length ? 'DESCRIPTOR TABLE' : 'SCHEDULING',
        fdRows.length
            ? `${formatProcessValue(io.fds, 0)} fd`
            : (kernelThread ? 'kernel task' : `nice ${formatProcessValue(cpuData.nice, '—')}`)
    );

    bodyRows.forEach((row, idx) => {
        const y = fdBox.y + 42 + idx * 16;
        fdCard.append('text')
            .attr('x', fdBox.x + 16).attr('y', y)
            .attr('font-family', DOSSIER.mono)
            .attr('font-size', '11px')
            .attr('fill', DOSSIER.dim)
            .text(row.key);

        if (row.mid) {
            fdCard.append('text')
                .attr('x', fdBox.x + 74).attr('y', y)
                .attr('font-family', DOSSIER.mono)
                .attr('font-size', '11px')
                .attr('fill', DOSSIER.text)
                .text(row.mid);
        }

        fdCard.append('text')
            .attr('x', fdBox.x + fdBox.w - 14).attr('y', y)
            .attr('text-anchor', 'end')
            .attr('font-family', DOSSIER.mono)
            .attr('font-size', '11px')
            .attr('fill', row.mid ? DOSSIER.faint : DOSSIER.text)
            .text(row.value);
    });

    if (hasFooter) {
        fdCard.append('text')
            .attr('x', fdBox.x + fdBox.w - 14).attr('y', fdBox.y + fdBox.h - 9)
            .attr('text-anchor', 'end')
            .attr('font-family', DOSSIER.mono)
            .attr('font-size', '9px')
            .attr('fill', DOSSIER.faint)
            .text(`showing ${fdRows.length} of ${fdTotal}`);
    }

    // ── card 4 · live activity ─────────────────────────────────────────────
    const actBox = { x: stackX + 90, y: fdBox.y + fdBox.h - overlap, w: cardW - 78, h: actH };
    pinnedProcessDossier.activityBox = actBox;
    dossierCard(layer, actBox, 'ACTIVITY', null);
    layer.append('g').attr('class', 'dossier-activity-rows');
    drawActivityRows();

    // ── card 5 · lineage ───────────────────────────────────────────────────
    // Real kernel start times walked up the parent chain, oldest at the top.
    if (lineRows.length) {
        const lineBox = { x: stackX + 90, y: actBox.y + actBox.h - overlap, w: cardW - 78, h: lineH };
        const childMeta = lineage.child_count
            ? `${lineage.child_count} child${lineage.child_count === 1 ? '' : 'ren'}`
            : `age ${formatProcessAge(lineage.age_s)}`;
        const lineCard = dossierCard(layer, lineBox, 'LINEAGE', childMeta);

        const spineX = lineBox.x + 22;
        const firstY = lineBox.y + 44;
        const lastY = firstY + (lineRows.length - 1) * 20;
        lineCard.append('line')
            .attr('x1', spineX).attr('x2', spineX)
            .attr('y1', firstY - 4).attr('y2', lastY - 4)
            .attr('stroke', DOSSIER.edge)
            .attr('stroke-width', 1);

        lineRows.forEach((entry, idx) => {
            const y = firstY + idx * 20;

            if (entry.gap) {
                lineCard.append('text')
                    .attr('x', spineX - 4).attr('y', y - 1)
                    .attr('text-anchor', 'middle')
                    .attr('font-family', DOSSIER.mono)
                    .attr('font-size', '11px')
                    .attr('fill', DOSSIER.faint)
                    .text('⋮');
                lineCard.append('text')
                    .attr('x', spineX + 18).attr('y', y - 1)
                    .attr('font-family', DOSSIER.mono)
                    .attr('font-size', '9px')
                    .attr('fill', DOSSIER.faint)
                    .text(`${entry.gap} more ancestors`);
                return;
            }

            const row = entry.row;
            const isSelf = Number(row.pid) === Number(processData.pid);

            lineCard.append('line')
                .attr('x1', spineX).attr('x2', spineX + 10)
                .attr('y1', y - 4).attr('y2', y - 4)
                .attr('stroke', DOSSIER.edge)
                .attr('stroke-width', 1);

            lineCard.append('circle')
                .attr('cx', spineX).attr('cy', y - 4).attr('r', isSelf ? 3.4 : 2.4)
                .attr('fill', isSelf ? DOSSIER.accent : DOSSIER.ink)
                .attr('stroke', isSelf ? DOSSIER.accent : DOSSIER.dim)
                .attr('stroke-width', 1.1);

            lineCard.append('text')
                .attr('x', spineX + 16).attr('y', y)
                .attr('font-family', DOSSIER.mono)
                .attr('font-size', '11px')
                .attr('fill', isSelf ? DOSSIER.accent : DOSSIER.text)
                .text(elideDescriptorTarget(String(row.name || '?'), 15));

            lineCard.append('text')
                .attr('x', lineBox.x + lineBox.w - 76).attr('y', y)
                .attr('text-anchor', 'end')
                .attr('font-family', DOSSIER.mono)
                .attr('font-size', '9px')
                .attr('fill', DOSSIER.faint)
                .text(`pid ${row.pid}`);

            // Root shows its wall clock start; the rest show the spawn gap.
            lineCard.append('text')
                .attr('x', lineBox.x + lineBox.w - 14).attr('y', y)
                .attr('text-anchor', 'end')
                .attr('font-family', DOSSIER.mono)
                .attr('font-size', '9px')
                .attr('fill', isSelf ? 'rgba(226, 163, 62, 0.75)' : DOSSIER.dim)
                .text(entry.delta === null || entry.delta === undefined
                    ? formatStartClock(row.create_time)
                    : formatSpawnDelta(entry.delta));
        });
    }

    const containmentPeers = fp && Array.isArray(fp.peer_pids) ? fp.peer_pids : [];
    if (containmentPeers.length) {
        drawContainmentHalo(layer, processData, containmentPeers);
    }
}

// Naive greedy wrap for the assessment line; SVG has no flow text.
function wrapDossierLines(text, fontSize, maxWidth, maxLines) {
    const maxChars = Math.max(12, Math.floor(maxWidth / (fontSize * 0.6)));
    const lines = [];
    let current = '';
    String(text).split(/\s+/).forEach((word) => {
        const candidate = current ? `${current} ${word}` : word;
        if (candidate.length > maxChars && current) {
            lines.push(current);
            current = word;
        } else {
            current = candidate;
        }
    });
    if (current) lines.push(current);

    if (lines.length > maxLines) {
        const kept = lines.slice(0, maxLines);
        kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, maxChars - 1)}…`;
        return kept;
    }
    return lines;
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
    processModalTopKeeper.stop();
    stopDossierActivityPolling();
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
// Общая вуаль для всех накладок (досье, namespace), чтобы фокус читался одинаково.
function ensureFocusVeilGradient() {
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
    return 'url(#process-scrim-grad)';
}

function ensureProcessModalScrim() {
    if (isMobileLayout()) return;
    if (!svg.select('.process-modal-scrim').empty()) return;

    ensureFocusVeilGradient();

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
function buryLiveLayersUnderScrim(scrimClass, overlayClasses) {
    const svgNode = svg.node();
    if (!svgNode) return;
    const scrimNode = svgNode.querySelector(`.${scrimClass}`);
    if (!scrimNode) return;
    const keepAbove = [scrimClass, ...overlayClasses];
    const toMove = [];
    for (let sib = scrimNode.nextSibling; sib; sib = sib.nextSibling) {
        if (sib.nodeType !== 1) continue;
        const cl = sib.classList;
        if (cl && keepAbove.some(c => cl.contains(c))) continue;
        toMove.push(sib);
    }
    toMove.forEach(n => svgNode.insertBefore(n, scrimNode));
}

// Накладки, открытые сейчас: самая старая первой.
//
// A keeper must not drag another overlay's nodes across its scrim, or two of
// them will exchange the same nodes forever and wedge the tab — which is what
// a card opened over a pinned dossier used to do. So an overlay buries the live
// layers of the page and the overlays opened before it, and leaves anything
// opened after it alone: the newest overlay stays on top, and the exchange has
// nowhere to start.
const openOverlays = [];

// Один сторож на накладку: пока она открыта, живые слои остаются под вуалью.
function createOverlayTopKeeper(scrimClass, overlayClasses, isOpen) {
    let observer = null;
    const entry = { classes: [scrimClass, ...overlayClasses] };
    const bury = () => {
        const mine = openOverlays.indexOf(entry);
        const newer = mine === -1
            ? []
            : openOverlays.slice(mine + 1).reduce((all, o) => all.concat(o.classes), []);
        buryLiveLayersUnderScrim(scrimClass, overlayClasses.concat(newer));
    };
    return {
        start() {
            const svgNode = svg.node();
            if (!svgNode || typeof MutationObserver === 'undefined') return;
            if (!openOverlays.includes(entry)) openOverlays.push(entry);
            bury();
            if (observer) return;
            observer = new MutationObserver(() => {
                if (!isOpen()) return;
                observer.disconnect();
                bury();
                observer.observe(svgNode, { childList: true });
            });
            observer.observe(svgNode, { childList: true });
        },
        stop() {
            const mine = openOverlays.indexOf(entry);
            if (mine !== -1) openOverlays.splice(mine, 1);
            if (observer) {
                observer.disconnect();
                observer = null;
            }
        }
    };
}

const processModalTopKeeper = createOverlayTopKeeper(
    'process-modal-scrim',
    ['process-dossier-layer', 'process-interaction-module'],
    () => !!pinnedProcessDossier
);

function closeOpenKernelCards() {
    ["MemoryCard", "ThreadsCard", "WaitsCard", "WakeupsCard", "SocketsCard",
        "FlowCard", "NamespaceCard", "SyscallCard", "IrqCard", "RunqueueCard"].forEach((name) => {
        const card = window[name];
        if (card && typeof card.close === "function") card.close();
    });
}

function openProcessDossier(hint) {
    const index = window.__processIndex || { byPid: new Map(), byName: new Map(), atPid: new Map() };
    const pid = Number(hint && hint.pid);
    let processData = Number.isFinite(pid) && pid > 0 ? index.byPid.get(pid) : null;
    if (!processData && hint && hint.name) {
        const list = index.byName.get(normalizeProcName(hint.name)) || [];
        processData = list[0] || null;
    }
    if (!processData) {
        if (!Number.isFinite(pid) || pid <= 0) return;
        processData = {
            pid,
            name: (hint && hint.name) || "process",
            memory_mb: 0,
            status: ""
        };
    }
    closeOpenKernelCards();
    const pos = index.atPid.get(processData.pid);
    const anchor = pos || { x: window.innerWidth * 0.42, y: window.innerHeight * 0.42 };
    if (pinnedProcessDossier && pinnedProcessDossier.process?.pid !== processData.pid) {
        clearPinnedProcessDossier();
    }
    pinProcessDossier(processData, anchor);
    svg.selectAll(".process-node-group").classed("process-pinned", false);
    const group = svg.select(`.process-node-group[data-pid="${processData.pid}"]`);
    if (!group.empty()) {
        group.classed("process-pinned", true);
        group.select(".process-node")
            .interrupt()
            .attr("r", 8)
            .attr("fill", "#111")
            .attr("stroke", "#000")
            .attr("stroke-width", 2);
    }
}
window.openProcessDossier = openProcessDossier;

function pinProcessDossier(processData, anchor) {
    const samePid = pinnedProcessDossier && pinnedProcessDossier.process?.pid === processData.pid;
    pinnedProcessDossier = {
        process: processData,
        anchor,
        details: samePid ? pinnedProcessDossier.details : {},
        // Counter history is only comparable within one pid.
        samples: samePid ? pinnedProcessDossier.samples : []
    };
    ensureProcessModalScrim();
    renderProcessDossier();
    processModalTopKeeper.start();
    startDossierActivityPolling(processData.pid);
    if (window.nginxFilesManager && typeof window.nginxFilesManager.highlightProcessFiles === 'function') {
        window.nginxFilesManager.highlightProcessFiles(processData.pid);
    }

    Promise.all([
        fetch(`/api/process/${processData.pid}/threads`).then(r => r.json()).catch(() => null),
        fetch(`/api/process/${processData.pid}/cpu`).then(r => r.json()).catch(() => null),
        fetch(`/api/process/${processData.pid}/fds`).then(r => r.json()).catch(() => null),
        fetch(`/api/process/${processData.pid}/lineage`).then(r => r.json()).catch(() => null)
    ]).then(([threadsData, cpuData, fdsData, lineage]) => {
        if (!pinnedProcessDossier || pinnedProcessDossier.process?.pid !== processData.pid) return;
        pinnedProcessDossier.details = { threadsData, cpuData, fdsData, lineage };
        renderProcessDossier();
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
    // The left frame is drawn by the syscall readout instead: its height has to
    // follow the number of waiting processes, which changes between polls.

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
            const processByPid = new Map();
            const processByName = new Map();
            const processAtPid = new Map();
            processes.forEach((process) => {
                if (!process || process.pid == null) return;
                processByPid.set(process.pid, process);
                const nm = normalizeProcName(process.name || '');
                if (!nm) return;
                if (!processByName.has(nm)) processByName.set(nm, []);
                processByName.get(nm).push(process);
            });
            window.__processIndex = { byPid: processByPid, byName: processByName, atPid: processAtPid };

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
                processAtPid.set(process.pid, { x: px, y: py });

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
                stopIpcOrbit();
                d3.selectAll('.ipc-ring-layer').remove();
                drawMobileProcessLabels(centerX, centerY, topProcessNames(processes, 4));
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

function stopIpcOrbit() {
    return callModuleFunction('IpcUI', 'stopIpcOrbit', []);
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
