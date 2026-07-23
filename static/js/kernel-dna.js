// Kernel DNA Visualization - Double Helix Structure
// Represents Linux kernel execution paths as DNA strands
// Version: 42 — feed group badge always-visible + limit 300

debugLog('🧬 kernel-dna.js v39: Script loading...');
debugLog('🧬 kernel-dna.js v39: THREE available:', typeof THREE);
debugLog('🧬 kernel-dna.js v39: Browser:', navigator.userAgent);

class KernelDNAVisualization {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.helixLeft = null;  // Userspace strand
        this.helixRight = null; // Kernel space strand
        this.nucleotides = [];  // Array of nucleotide objects
        this.genes = [];        // Gene segments
        this.mutations = [];    // Anomalies
        this.animationId = null;
        this.data = null;
        this.container = null;
        this.isActive = false;
        this.updateInterval = null;
        this.mutationAnimations = []; // Track mutation animations to stop them
        this.isAnimating = false; // Prevent multiple animation loops
        this.timelineMode = false; // Timeline mode: growing helix over time
        this.timelineBranchMode = false; // Multi-process branch timeline mode
        this.timelineData = []; // Process timeline events
        this.timelineBranches = []; // Multi-branch process timelines
        this.selectedPid = null; // Selected process PID for timeline
        this.timelineWindowS = 30; // Timeline zoom window in seconds
        this.timelineWindowOptions = [5, 30, 120];
        this.timeStart = null; // Start time for timeline
        this.maxTimelineHeight = 30; // Maximum height for timeline helix
        this.raycaster = null;
        this.mouse = new THREE.Vector2();
        this.tooltip = null;
        this.lastFrameTime = null; // For smooth animation
        this.cameraAngle = 0; // For smooth camera rotation
        this.isUpdating = false; // Prevent concurrent updates
        this.mouseMoveHandler = null; // Store mouse move handler reference
        this.hoveredNucleotide = null; // Track hovered nucleotide for yellow highlight
        this.exitButton = null; // Store exit button reference
        this._loadingOverlay = null;
        this._uxStylesInjected = false;
        this.pinnedTimelineLabels = [];
        this.pinnedLabelLayer = null;

        // SIEM attack "scars": real Elastic detection alerts rendered as
        // lesions on the helix, plus a live threat feed HUD.
        this.siemScars = [];        // [{group, shard, core, halo, severity, id, phase, focusUntil}]
        this.siemLayer = null;      // THREE.Group child of helixLeft
        this.siemInterval = null;   // polling timer
        this.siemAlerts = [];       // last normalized alert list
        this.leftHelixCurve = null; // cached curve for placing scars
        this.scarById = {};         // id -> scar record
        this.hoveredScarId = null;
        this._haloTextures = {};     // color -> CanvasTexture cache
        
        // Color palette - New design system
        this.colors = {
            // Background
            bgPrimary: 0x0E1114,
            bgSecondary: 0x13171B,
            bgDeep: 0x0A0C0F,
            // Structure / lines / neutral
            linePrimary: 0xD0D3D6,
            lineSecondary: 0x8A8F95,
            mutedText: 0x6B7076,
            // Yellow accent (signal)
            signalYellow: 0xE6C15A,
            signalDim: 0xB89E4A,
            signalGlow: [230, 193, 90, 0.15] // rgba
        };
        
        // Nucleotide config - all neutral gray, yellow only on hover/active
        this.nucleotideConfig = {
            'A': { type: 'syscall', shape: 'sphere' },
            'T': { type: 'interrupt', shape: 'sphere' },
            'C': { type: 'context_switch', shape: 'sphere' },
            'G': { type: 'lock', shape: 'sphere' }
        };
        
        // Gene colors - neutral gray, yellow only when active/focused
        this.geneColors = {
            'sched': this.colors.lineSecondary,
            'net': this.colors.lineSecondary,
            'fs': this.colors.lineSecondary,
            'mm': this.colors.lineSecondary,
            'drivers': this.colors.lineSecondary,
            'kernel': this.colors.lineSecondary
        };
    }

    init(containerId = 'kernel-dna-container') {
        debugLog('🧬 Initializing Kernel DNA Visualization');
        debugLog('🔍 Container ID:', containerId);
        
        // Create container
        const container = document.getElementById(containerId);
        if (!container) {
            // Create container if it doesn't exist
            debugLog('📦 Creating new container element');
            this.container = document.createElement('div');
            this.container.id = containerId;
            this.container.style.cssText = `
                position: fixed !important;
                top: 0 !important;
                left: 0 !important;
                width: 100% !important;
                height: 100% !important;
                background: #0E1114 !important;
                z-index: 9999 !important;
                display: none;
            `;
            document.body.appendChild(this.container);
            debugLog('✅ Container created and appended to body');
            debugLog('✅ Container element:', this.container);
        } else {
            debugLog('✅ Using existing container');
            this.container = container;
        }
        
        // Scene setup - New palette background
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(this.colors.bgPrimary);
        
        // Camera
        const width = window.innerWidth;
        const height = window.innerHeight;
        this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
        this.camera.position.set(0, 5, 15);
        this.camera.lookAt(0, 0, 0);
        
        // Renderer - High quality settings for smooth graphics
        // Check WebGL support first
        let webglSupported = false;
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            webglSupported = !!gl;
            debugLog('🔍 WebGL support check:', webglSupported ? '✅ Supported' : '❌ Not supported');
        } catch (e) {
            console.error('❌ WebGL check error:', e);
            webglSupported = false;
        }
        
        if (!webglSupported) {
            console.error('❌ WebGL is not supported in this browser');
            console.error('❌ Browser:', navigator.userAgent);
            console.error('❌ Canvas context test failed');
            alert('WebGL не поддерживается в этом браузере. Kernel DNA view требует WebGL для работы.\n\nПроверьте:\n1. Включено ли аппаратное ускорение в настройках браузера\n2. Обновлены ли драйверы видеокарты\n3. Поддерживает ли ваша видеокарта WebGL');
            this.container.style.display = 'none';
            return false; // Return false to indicate failure
        }
        
        try {
            this.renderer = new THREE.WebGLRenderer({ 
                antialias: true, 
                alpha: true,
                powerPreference: "high-performance",
                stencil: false,
                depth: true,
                failIfMajorPerformanceCaveat: false // Allow fallback for slower devices
            });
            
            if (!this.renderer) {
                throw new Error('Failed to create WebGLRenderer');
            }
            
            this.renderer.setSize(width, height);
            // Use higher pixel ratio for smoother graphics (max 2 for performance)
            const pixelRatio = Math.min(window.devicePixelRatio, 2);
            this.renderer.setPixelRatio(pixelRatio);
            // Enable shadow maps and other quality features
            this.renderer.shadowMap.enabled = false; // Disabled for performance, but can enable if needed
            if (this.renderer.outputEncoding !== undefined) {
                this.renderer.outputEncoding = THREE.sRGBEncoding;
            }
            
            const canvas = this.renderer.domElement;
            if (!canvas) {
                throw new Error('Renderer canvas is null');
            }
            
            this.container.appendChild(canvas);
            debugLog('✅ WebGL Renderer created and appended');
        } catch (error) {
            console.error('❌ Error creating WebGL renderer:', error);
            console.error('❌ Error details:', {
                message: error.message,
                stack: error.stack,
                THREE: typeof THREE,
                WebGLRenderer: typeof THREE?.WebGLRenderer,
                browser: navigator.userAgent
            });
            alert('Ошибка создания WebGL рендерера: ' + error.message + '\nПроверьте консоль для деталей.');
            this.container.style.display = 'none';
            return false; // Return false to indicate failure
        }
        
        // Raycaster for mouse interaction
        this.raycaster = new THREE.Raycaster();
        
        // Create tooltip element - New palette styling
        this.tooltip = document.createElement('div');
        this.tooltip.style.cssText = `
            position: absolute;
            background: #13171B;
            border: 1px solid #8A8F95;
            color: #D0D3D6;
            font-family: 'Share Tech Mono', monospace;
            font-size: 11px;
            padding: 8px 12px;
            pointer-events: none;
            z-index: 1002;
            display: none;
            border-radius: 4px;
        `;
        this.container.appendChild(this.tooltip);
        
        // Mouse move handler for tooltips - remove old handler if exists
        if (this.mouseMoveHandler && this.renderer && this.renderer.domElement) {
            this.renderer.domElement.removeEventListener('mousemove', this.mouseMoveHandler);
        }
        this.mouseMoveHandler = (event) => this.onMouseMove(event);
        this.renderer.domElement.addEventListener('mousemove', this.mouseMoveHandler);
        
        // Minimal lighting (not needed for MeshBasicMaterial, but kept for compatibility)
        const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
        this.scene.add(ambientLight);
        
        // Add exit button
        this.addExitButton();
        
        this.container.classList.add('kernel-dna-ux');
        this._ensureUxStyles();
        
        // Handle window resize
        window.addEventListener('resize', () => this.onWindowResize());
        
        debugLog('✅ Kernel DNA Visualization initialized successfully');
        return true; // Return true to indicate successful initialization
    }

    addExitButton() {
        // Remove existing exit button if it exists
        if (this.exitButton && this.exitButton.parentNode) {
            this.exitButton.parentNode.removeChild(this.exitButton);
        }
        
        const exitBtn = document.createElement('button');
        exitBtn.textContent = 'EXIT VIEW';
        exitBtn.className = 'kernel-dna-exit-button'; // Add class for easier removal
        exitBtn.style.cssText = `
            position: absolute;
            top: 20px;
            right: 20px;
            padding: 10px 20px;
            background: rgba(12, 18, 28, 0.9);
            border: 1px solid rgba(160, 170, 190, 0.35);
            color: #c8ccd4;
            font-family: 'Share Tech Mono', monospace;
            font-size: 12px;
            cursor: pointer;
            z-index: 1001;
            transition: all 0.3s ease;
        `;
        exitBtn.onmouseenter = () => {
            exitBtn.style.background = 'rgba(20, 26, 36, 0.95)';
            exitBtn.style.color = '#ffffff';
        };
        exitBtn.onmouseleave = () => {
            exitBtn.style.background = 'rgba(12, 18, 28, 0.9)';
            exitBtn.style.color = '#c8ccd4';
        };
        exitBtn.onclick = () => {
            // Route exit through global view deactivation so no legacy exit buttons remain.
            if (window.kernelContextMenu && typeof window.kernelContextMenu.deactivateViews === 'function') {
                window.kernelContextMenu.deactivateViews();
            } else {
                // Standalone page (e.g. /kernel-dna): go home like the other
                // subsystem pages instead of leaving a blank view.
                window.location.assign('/');
            }
        };
        this.container.appendChild(exitBtn);
        this.exitButton = exitBtn; // Store reference
    }

    createHelixStrand(isLeft = true, height = null, startY = null) {
        const group = new THREE.Group();
        const helixRadius = 2;
        const helixHeight = height !== null ? height : 20;
        const segments = 600; // Increased from 400 for even smoother lines
        const turns = 3;
        const baseY = startY !== null ? startY : -helixHeight / 2;
        
        // Create smooth helix curve points
        const points = Array.from({ length: segments + 1 }, (_, i) => {
            const t = i / segments;
            const angle = t * Math.PI * 2 * turns;
            const radius = helixRadius;
            const y = baseY + t * helixHeight; // Start from baseY and grow upward
            const x = isLeft ? -radius * Math.cos(angle) : radius * Math.cos(angle);
            const z = radius * Math.sin(angle);
            return new THREE.Vector3(x, y, z);
        });
        
        // Create curve from points
        const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
        
        // Simple line geometry - just a smooth curve
        const linePoints = curve.getPoints(segments);
        const geometry = new THREE.BufferGeometry().setFromPoints(linePoints);
        
        // Simple line material - Line secondary for DNA skeleton
        const material = new THREE.LineBasicMaterial({
            color: this.colors.lineSecondary, // Line secondary: #8A8F95
            linewidth: 1
        });
        
        const line = new THREE.Line(geometry, material);
        group.add(line);
        
        return { group, curve };
    }

    createNucleotide(nucleotideData, position, isLeft) {
        const config = this.nucleotideConfig[nucleotideData.code];
        if (!config) return null;
        
        // Simple sphere (bead) for all nucleotides - neutral gray, yellow only on hover
        const geometry = new THREE.SphereGeometry(0.1, 12, 12); // Smaller bead, less visible pixels
        
        // Neutral gray material - all nucleotides same color
        const material = new THREE.MeshBasicMaterial({
            color: this.colors.lineSecondary, // Line secondary: #8A8F95 - neutral gray
            side: THREE.DoubleSide
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(position);
        
        // Add yellow ring for hover (will be shown/hidden on hover)
        const ringGeometry = new THREE.RingGeometry(0.12, 0.15, 16);
        const ringMaterial = new THREE.MeshBasicMaterial({
            color: this.colors.signalYellow, // Signal yellow: #E6C15A
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.8
        });
        const ring = new THREE.Mesh(ringGeometry, ringMaterial);
        ring.rotation.x = Math.PI / 2;
        ring.visible = false; // Hidden by default, shown on hover
        mesh.add(ring);
        
        mesh.userData = {
            type: nucleotideData.type,
            code: nucleotideData.code,
            name: nucleotideData.name,
            count: nucleotideData.count,
            subsystem: nucleotideData.subsystem,
            isNucleotide: true,
            ring: ring // Store ring reference for hover
        };
        
        return mesh;
    }

    createRung(position1, position2, isActive = false) {
        // Simple line between two positions - Line secondary by default, Signal dim when active
        const geometry = new THREE.BufferGeometry().setFromPoints([position1, position2]);
        const material = new THREE.LineBasicMaterial({
            color: isActive ? this.colors.signalDim : this.colors.lineSecondary, // Signal dim when active, Line secondary otherwise
            linewidth: 1
        });
        
        const line = new THREE.Line(geometry, material);
        line.userData.isActive = isActive;
        return line;
    }

    createGeneSegment(geneData, helixCurve) {
        const group = new THREE.Group();
        const startT = geneData.start;
        const endT = geneData.end;
        const segments = 20;
        
        for (let i = 0; i < segments; i++) {
            const t = startT + (endT - startT) * (i / segments);
            const point = helixCurve.getPoint(t);
            
            // Simple bead (sphere) for gene segment - neutral gray
            const geometry = new THREE.SphereGeometry(0.08, 10, 10); // Smaller bead
            const material = new THREE.MeshBasicMaterial({
                color: this.colors.lineSecondary, // Line secondary - neutral gray
                side: THREE.DoubleSide
            });
            
            const marker = new THREE.Mesh(geometry, material);
            marker.position.copy(point);
            marker.userData.geneName = geneData.name;
            marker.userData.subsystem = geneData.subsystem || 'kernel';
            
            group.add(marker);
        }
        
        // Add yellow line indicator for active gene (will be shown when gene is focused)
        const startPoint = helixCurve.getPoint(startT);
        const endPoint = helixCurve.getPoint(endT);
        const yellowLineGeometry = new THREE.BufferGeometry().setFromPoints([startPoint, endPoint]);
        const yellowLineMaterial = new THREE.LineBasicMaterial({
            color: this.colors.signalYellow, // Signal yellow for active gene
            linewidth: 2,
            transparent: true,
            opacity: 0.6
        });
        const yellowLine = new THREE.Line(yellowLineGeometry, yellowLineMaterial);
        yellowLine.visible = false; // Hidden by default, shown when gene is active
        group.add(yellowLine);
        
        group.userData.geneName = geneData.name;
        group.userData.yellowLine = yellowLine; // Store reference for activation
        return group;
    }

    createMutation(mutationData, helixCurve) {
        const group = new THREE.Group();
        const t = mutationData.position;
        const point = helixCurve.getPoint(t);

        // Two sources of mutations, rendered side by side but distinguishable:
        //   rule  -> threshold rules (gray "broken" wireframe)
        //   ml    -> statistical baseline detector (cyan wireframe)
        // Severity drives the assessment marker colour (high = red, else yellow).
        const isML = mutationData.source === 'ml';
        const isHigh = String(mutationData.severity || '').toLowerCase() === 'high';
        const attack = mutationData.attack || null;
        const attackColorCss = (attack && attack.color) ? String(attack.color) : null;
        const wireColor = isML
            ? (attackColorCss ? parseInt(attackColorCss.replace('#', ''), 16) : 0x67C8E0)
            : this.colors.mutedText;
        const markerColor = isHigh ? 0xE0564E : this.colors.signalYellow;
        const accentCss = isML
            ? (attackColorCss ? attackColorCss : 'rgba(103, 200, 224, 0.9)')
            : 'rgba(230, 193, 90, 0.7)';
        const accentText = isML ? (attackColorCss || '#67C8E0') : '#E6C15A';

        // Mutation: "broken" appearance - distorted/irregular shape.
        const geometry = new THREE.OctahedronGeometry(0.25, 0); // Irregular shape
        const material = new THREE.MeshBasicMaterial({
            color: wireColor,
            side: THREE.DoubleSide,
            wireframe: true // Wireframe for "broken" appearance
        });
        
        const mutation = new THREE.Mesh(geometry, material);
        mutation.position.copy(point);
        mutation.rotation.set(
            Math.random() * Math.PI,
            Math.random() * Math.PI,
            Math.random() * Math.PI
        ); // Random rotation for "broken" look
        
        // Assessment marker - small sphere (red when severity is high).
        const markerGeometry = new THREE.SphereGeometry(0.08, 8, 8);
        const markerMaterial = new THREE.MeshBasicMaterial({
            color: markerColor,
            side: THREE.DoubleSide
        });
        const yellowMarker = new THREE.Mesh(markerGeometry, markerMaterial);
        yellowMarker.position.copy(point);
        yellowMarker.position.y += 0.3; // Position above mutation

        const mitreTag = attack && attack.mitre ? String(attack.mitre) : '';
        const baseLabel = (mitreTag
            ? mitreTag
            : String(mutationData.type || 'anomaly').replace(/_/g, ' ')
        ).toUpperCase().slice(0, 22);
        const tag = isML ? (mitreTag ? 'ATT' : 'ML') : 'RULE';
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 48;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(14, 17, 20, 0.72)';
        ctx.fillRect(0, 6, canvas.width, 30);
        ctx.strokeStyle = accentCss;
        ctx.strokeRect(0.5, 6.5, canvas.width - 1, 29);
        // Source tag chip on the left edge.
        ctx.fillStyle = accentText;
        ctx.font = 'bold 11px "Share Tech Mono", monospace';
        ctx.fillText(tag, 8, 24);
        ctx.font = '18px "Share Tech Mono", monospace';
        ctx.fillText(baseLabel, 42, 27);
        const labelTexture = new THREE.CanvasTexture(canvas);
        const labelMaterial = new THREE.SpriteMaterial({
            map: labelTexture,
            transparent: true,
            depthTest: false,
            depthWrite: false
        });
        const label = new THREE.Sprite(labelMaterial);
        label.position.copy(point);
        label.position.y += 0.56;
        label.position.x += 0.38;
        label.scale.set(1.35, 0.25, 1);
        
        // Store reference for cleanup and animation
        mutation.userData.isMutation = true;
        mutation.userData.mutationType = mutationData.type || 'anomaly';
        mutation.userData.mutationSource = isML ? 'ml' : 'rule';
        mutation.userData.mutationSeverity = mutationData.severity || 'medium';
        mutation.userData.mutationScore = mutationData.score;
        mutation.userData.description = mutationData.description || mutationData.message || 'Anomaly detected';
        mutation.userData.mutationAttack = attack;
        
        group.add(mutation);
        group.add(yellowMarker);
        group.add(label);
        return group;
    }

    // ---- SIEM attack scars -------------------------------------------------

    _sevRank(sev) {
        return { critical: 4, high: 3, medium: 2, low: 1 }[String(sev || '').toLowerCase()] || 2;
    }

    _sevColorNum(sev) {
        return {
            critical: 0xFF4530,
            high: 0xE0564E,
            medium: 0xE6C15A,
            low: 0x8A8F95
        }[String(sev || '').toLowerCase()] || 0xE6C15A;
    }

    _sevColorHex(sev) {
        return {
            critical: '#ff4530',
            high: '#e0564e',
            medium: '#e6c15a',
            low: '#8a8f95'
        }[String(sev || '').toLowerCase()] || '#e6c15a';
    }

    _haloTexture(colorHex) {
        if (this._haloTextures[colorHex]) return this._haloTextures[colorHex];
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const ctx = c.getContext('2d');
        const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, colorHex);
        g.addColorStop(0.35, colorHex);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(32, 32, 32, 0, Math.PI * 2);
        ctx.fill();
        const tex = new THREE.CanvasTexture(c);
        tex.needsUpdate = true;
        this._haloTextures[colorHex] = tex;
        return tex;
    }

    // Crisp, non-glowing dot (hard edge) — line-art look, no bloom.
    _dotTexture(colorHex) {
        const key = 'dot:' + colorHex;
        if (this._haloTextures[key]) return this._haloTextures[key];
        const c = document.createElement('canvas');
        c.width = c.height = 32;
        const ctx = c.getContext('2d');
        ctx.fillStyle = colorHex;
        ctx.beginPath();
        ctx.arc(16, 16, 11, 0, Math.PI * 2);
        ctx.fill();
        const tex = new THREE.CanvasTexture(c);
        tex.needsUpdate = true;
        this._haloTextures[key] = tex;
        return tex;
    }

    _hashStr(s) {
        let h = 2166136261 >>> 0;
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
        return h;
    }

    // Ghost-in-the-Shell style attack orbits: each MITRE tactic becomes a tilted,
    // glowing dotted ring encircling the helix at the tactic's height, with a
    // green micro-label riding the orbit. Radius/brightness scale with volume &
    // severity.
    _ATTACK_GREEN = 0x39E67A;

    _accentForRank(rank) {
        if (rank >= 4) return { num: 0xFF5A45, hex: '#ff5a45' };   // critical
        if (rank >= 3) return { num: 0xFFCF5A, hex: '#ffcf5a' };   // high
        return { num: this._ATTACK_GREEN, hex: '#39e67a' };        // med/low → green
    }

    // Thin finely-dashed orbit ring (reference look) in the local XY plane.
    // headStrength > 0 bakes a per-vertex brightness gradient: a bright "head"
    // near frac 0 fading into a dim tail, so the spinning ring reads as a
    // travelling comet of light along the orbit.
    _makeOrbitLine(R, colorNum, opacity, headStrength = 0) {
        const seg = 220;
        const pts = [];
        const colors = new Float32Array((seg + 1) * 3);
        const base = new THREE.Color(colorNum);
        for (let i = 0; i <= seg; i++) {
            const a = (i / seg) * Math.PI * 2;
            pts.push(new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, 0));
            const frac = i / seg;
            let d = Math.abs(frac);           // distance from the head at frac 0
            d = Math.min(d, 1 - d);           // wrap around the loop -> 0..0.5
            const intensity = Math.pow(Math.max(0, 1 - d * 2), 1.6);
            const mul = (1 - headStrength) + headStrength * (0.18 + 0.82 * intensity);
            colors[i * 3] = base.r * mul;
            colors[i * 3 + 1] = base.g * mul;
            colors[i * 3 + 2] = base.b * mul;
        }
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        const line = new THREE.Line(geo, new THREE.LineDashedMaterial({
            vertexColors: true, transparent: true, opacity,
            dashSize: 0.13, gapSize: 0.11
        }));
        line.computeLineDistances();
        return line;
    }

    _makeLabelSprite(text, colorHex) {
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 40;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(6,14,10,0.62)';
        ctx.fillRect(0, 8, canvas.width, 24);
        ctx.strokeStyle = colorHex; ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 8.5, canvas.width - 1, 23);
        ctx.fillStyle = colorHex;
        ctx.font = 'bold 15px "Share Tech Mono", monospace';
        ctx.shadowColor = colorHex; ctx.shadowBlur = 6;
        ctx.fillText(String(text).slice(0, 26), 8, 26);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false, depthWrite: false
        }));
        sprite.scale.set(2.6, 0.4, 1);
        return sprite;
    }

    // Small stacked "telemetry" readout that rides the orbit (GITS micro-text).
    _makeMicroCluster(lines, colorHex) {
        const canvas = document.createElement('canvas');
        canvas.width = 128; canvas.height = 96;
        const ctx = canvas.getContext('2d');
        const texture = new THREE.CanvasTexture(canvas);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: texture, transparent: true, depthTest: false, depthWrite: false,
            opacity: 0.85
        }));
        sprite.scale.set(1.05, 0.8, 1);
        const rec = {
            sprite, canvas, ctx, texture,
            lines: lines.slice(), colorHex,
            seed: (Math.random() * 0xFFFF) | 0, nextUpdate: 0
        };
        this._drawCluster(rec, 0);
        return rec;
    }

    // Redraw a cluster with a live-ticking hex telemetry line at the bottom.
    _drawCluster(rec, tMs) {
        const ctx = rec.ctx;
        ctx.clearRect(0, 0, rec.canvas.width, rec.canvas.height);
        ctx.font = '10px "Share Tech Mono", monospace';
        ctx.textBaseline = 'top';
        const live = '0x' + (((rec.seed ^ ((tMs / 110) | 0)) & 0xFFFF) >>> 0)
            .toString(16).toUpperCase().padStart(4, '0');
        const display = [rec.lines[0], rec.lines[1], rec.lines[2], live];
        display.forEach((ln, i) => {
            if (ln == null) return;
            const y = 6 + i * 14;
            ctx.fillStyle = rec.colorHex;
            ctx.globalAlpha = 0.85;
            ctx.fillRect(2, y + 5, 7, 1.5); // small leading tick, like the reference dashes
            ctx.globalAlpha = i === 3 ? 0.7 : 1;   // live line slightly dimmer
            ctx.fillText(String(ln).slice(0, 14), 12, y);
        });
        rec.texture.needsUpdate = true;
    }

    createAttackOrbit(info, index, total) {
        const group = new THREE.Group();
        const rank = info.maxRank;
        const accent = this._accentForRank(rank);

        const h = this._hashStr(String(info.tactic || 'unmapped') + index);
        // concentric bundle: nested radii around a shared centre
        const R = 2.6 + index * 0.62;

        // thin finely-dashed orbit line (no beads) — matches the reference's
        // dashed arcs; severity tints the line colour, and a baked brightness
        // head gives it a comet-like fade that sweeps as the ring spins
        const ring = this._makeOrbitLine(R, accent.num, 0.85, 1);
        group.add(ring);

        // micro-text "telemetry" clusters riding the orbit (reference-style)
        const clusters = [];
        const samples = info.alerts.slice(0, 3);
        const clusterCount = Math.min(3, Math.max(2, samples.length));
        for (let i = 0; i < clusterCount; i++) {
            const a = samples[i] || info.alerts[0] || {};
            const ipTail = a.source_ip ? String(a.source_ip).split('.').slice(-2).join('.') : '--';
            const lines = [
                (a.technique || info.topTechnique || (info.tactic || 'ATK')),
                ipTail,
                `x${info.count}`
            ];
            const cl = this._makeMicroCluster(lines, accent.hex);
            const ca = ((h + i * 137) % 360) * Math.PI / 180;
            cl.sprite.position.set(Math.cos(ca) * R, Math.sin(ca) * R, 0);
            group.add(cl.sprite);
            clusters.push(cl);
        }

        // invisible torus = reliable raycast target for the whole ring
        const hit = new THREE.Mesh(
            new THREE.TorusGeometry(R, 0.4, 6, 48),
            new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
        );
        hit.userData.isSiemRing = true;
        hit.userData.siemGroup = info;
        group.add(hit);

        // concentric bundle: all rings share a centre, packed into a narrow
        // height band; horizontal plane, spin about the vertical axis.
        const n = Math.max(1, total || 1);
        const centreY = 1.0;
        const yPos = centreY + (index - (n - 1) / 2) * 0.5;
        group.position.set(0, yPos, 0);
        group.rotation.x = Math.PI / 2;              // normal → world +Y (horizontal ring)
        group.rotation.z = (h % 360) * Math.PI / 180; // start phase offset

        const spin = (0.14 + ((h % 7) / 7) * 0.16) * ((index % 2) ? 1 : -1);

        return {
            group, ring, clusters, hit,
            key: info.tactic || 'unmapped',
            rank, R, spin, focusUntil: 0,
            phase: (h % 100) / 100 * Math.PI * 2
        };
    }

    _ensureSiemLayer() {
        if (!this.scene) return null;
        if (this.siemLayer && this.siemLayer.parent === this.scene) return this.siemLayer;
        this.siemLayer = new THREE.Group();
        this.scene.add(this.siemLayer);
        return this.siemLayer;
    }

    _disposeSiemScars() {
        if (this.siemLayer) {
            const dispose = (o) => {
                if (o.geometry) o.geometry.dispose();
                if (o.material) {
                    const mats = Array.isArray(o.material) ? o.material : [o.material];
                    mats.forEach(m => {
                        // per-cluster canvas textures are unique -> free them; shared
                        // dot textures are cached and reused, so leave those.
                        if (m.map && m.map.image && m.map.image.width === 128 && m.map.image.height === 96) {
                            m.map.dispose();
                        }
                        m.dispose();
                    });
                }
                (o.children || []).forEach(dispose);
            };
            while (this.siemLayer.children.length) {
                const c = this.siemLayer.children[0];
                dispose(c);
                this.siemLayer.remove(c);
            }
        }
        this.siemScars = [];
        this.scarById = {};
    }

    _groupAlertsByTactic(alerts) {
        const groups = {};
        alerts.forEach(a => {
            const key = (a.tactic || 'unmapped');
            if (!groups[key]) {
                groups[key] = {
                    tactic: a.tactic || null, count: 0, posSum: 0,
                    maxRank: 0, sev: { critical: 0, high: 0, medium: 0, low: 0 },
                    techniques: {}, alerts: [], topRule: null
                };
            }
            const g = groups[key];
            g.count++;
            g.posSum += (Number(a.position) || 0.5);
            const rk = this._sevRank(a.severity);
            if (rk > g.maxRank) g.maxRank = rk;
            const sk = String(a.severity || 'medium').toLowerCase();
            if (g.sev[sk] != null) g.sev[sk]++;
            if (a.technique) g.techniques[a.technique] = (g.techniques[a.technique] || 0) + 1;
            if (!g.topRule) g.topRule = a.rule;
            g.alerts.push(a);
        });
        return Object.keys(groups).map(key => {
            const g = groups[key];
            const topTechnique = Object.keys(g.techniques).sort((x, y) => g.techniques[y] - g.techniques[x])[0] || null;
            return {
                tactic: g.tactic, count: g.count, position: g.posSum / g.count,
                maxRank: g.maxRank, sev: g.sev, topTechnique, topRule: g.topRule,
                alerts: g.alerts
            };
        });
    }

    renderSiemScars(payload) {
        const alerts = (payload && Array.isArray(payload.alerts)) ? payload.alerts : this.siemAlerts;
        if (!this.scene) return;
        const layer = this._ensureSiemLayer();
        if (!layer) return;
        this._disposeSiemScars();
        if (!alerts || !alerts.length) return;

        const groups = this._groupAlertsByTactic(alerts)
            .sort((a, b) => b.maxRank - a.maxRank || b.count - a.count);

        groups.forEach((info, i) => {
            const rec = this.createAttackOrbit(info, i, groups.length);
            layer.add(rec.group);
            this.siemScars.push(rec);
            info.alerts.forEach(a => { if (a.id) this.scarById[a.id] = rec; });
        });

        // Decorative concentric echo-arcs: when there are few real orbits, pad
        // the bundle with faint unlabelled rings so it reads like the reference's
        // gyroscope of orbits (ambient structure, no data / no interaction).
        const decorCount = Math.max(0, 6 - groups.length);
        const outerR = 2.6 + groups.length * 0.62;
        // teal-shifted green so the real (pure-green / severity) orbits pop
        // against the ambient structure
        const decorTint = 0x2f9f86;
        for (let k = 0; k < decorCount; k++) {
            const R = outerR + 0.55 * (k + 1);
            // stagger base brightness for depth: some arcs sit "closer", some fade back
            const baseOpacity = 0.09 + (k % 3) * 0.045;
            const g = new THREE.Group();
            const line = this._makeOrbitLine(R, decorTint, baseOpacity, 0);
            g.add(line);
            g.position.set(0, 1.0 + (k - decorCount / 2) * 0.45, 0);
            // slight per-arc tilt off the horizontal plane -> volumetric gyroscope
            const tilt = 0.12 * Math.sin(k * 1.7);
            g.rotation.x = Math.PI / 2 + tilt;
            g.rotation.y = 0.10 * Math.cos(k * 2.3);
            g.rotation.z = k * 1.13;
            layer.add(g);
            this.siemScars.push({
                group: g, ring: line, clusters: [], hit: null,
                key: 'decor' + k, decor: true, rank: 0, R, baseOpacity,
                spin: (0.07 + k * 0.015) * (k % 2 ? 1 : -1),
                focusUntil: 0, phase: k * 0.9
            });
        }
    }

    _focusScar(id) {
        const rec = this.scarById[id];
        if (!rec) return;
        rec.focusUntil = performance.now() + 2600;
    }

    async loadData() {
        try {
            const response = await fetch('/api/kernel-dna');
            this.data = await response.json();
            debugLog('🧬 Kernel DNA data loaded:', this.data);
            return this.data;
        } catch (error) {
            console.error('❌ Error loading Kernel DNA data:', error);
            return null;
        }
    }

    _ensureUxStyles() {
        if (this._uxStylesInjected || typeof document === 'undefined') return;
        const style = document.createElement('style');
        style.id = 'kernel-dna-ux-styles';
        style.textContent = `
            #kernel-dna-container.kernel-dna-ux {
                transition: opacity 0.42s cubic-bezier(0.22, 1, 0.36, 1),
                    transform 0.42s cubic-bezier(0.22, 1, 0.36, 1);
            }
            #kernel-dna-container .dna-loading-overlay {
                position: absolute;
                inset: 0;
                z-index: 10050;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 20px;
                background: rgba(14, 17, 20, 0.92);
                backdrop-filter: blur(6px);
                pointer-events: none;
                transition: opacity 0.32s ease;
            }
            #kernel-dna-container .dna-loading-overlay.dna-loading-out {
                opacity: 0;
            }
            #kernel-dna-container .dna-loading-label {
                font-family: 'Share Tech Mono', monospace;
                font-size: 11px;
                letter-spacing: 0.35px;
                color: rgba(200, 204, 212, 0.75);
            }
            #kernel-dna-container .dna-skeleton-wrap {
                width: min(280px, 70vw);
                display: flex;
                flex-direction: column;
                gap: 10px;
            }
            #kernel-dna-container .dna-skeleton-bar {
                height: 8px;
                border-radius: 4px;
                background: linear-gradient(90deg,
                    rgba(90, 98, 108, 0.25) 0%,
                    rgba(130, 140, 155, 0.45) 50%,
                    rgba(90, 98, 108, 0.25) 100%);
                background-size: 200% 100%;
                animation: kernel-dna-skel 1.1s ease-in-out infinite;
            }
            #kernel-dna-container .dna-skeleton-bar:nth-child(2) { width: 88%; }
            #kernel-dna-container .dna-skeleton-bar:nth-child(3) { width: 72%; }
            @keyframes kernel-dna-skel {
                0% { background-position: 200% 0; }
                100% { background-position: -200% 0; }
            }
        `;
        document.head.appendChild(style);
        this._uxStylesInjected = true;
    }

    _showLoadingOverlay(labelText = 'Loading kernel view') {
        if (!this.container) return;
        this._hideLoadingOverlayImmediate();
        const ov = document.createElement('div');
        ov.className = 'dna-loading-overlay';
        ov.setAttribute('aria-busy', 'true');
        ov.setAttribute('aria-label', labelText);
        window.setSafeHtml(ov, `
            <div class="dna-skeleton-wrap">
                <div class="dna-skeleton-bar"></div>
                <div class="dna-skeleton-bar"></div>
                <div class="dna-skeleton-bar"></div>
            </div>
            <div class="dna-loading-label">${labelText}</div>
        `);
        this.container.appendChild(ov);
        this._loadingOverlay = ov;
    }

    _hideLoadingOverlayImmediate() {
        if (this._loadingOverlay && this._loadingOverlay.parentNode) {
            this._loadingOverlay.parentNode.removeChild(this._loadingOverlay);
        }
        this._loadingOverlay = null;
    }

    _hideLoadingOverlay() {
        return new Promise((resolve) => {
            const ov = this._loadingOverlay;
            if (!ov) {
                resolve();
                return;
            }
            const done = () => {
                this._hideLoadingOverlayImmediate();
                resolve();
            };
            ov.classList.add('dna-loading-out');
            const t = window.setTimeout(done, 340);
            ov.addEventListener('transitionend', () => {
                window.clearTimeout(t);
                done();
            }, { once: true });
        });
    }

    _applyStaggeredReveal(nodes) {
        const valid = nodes.filter(Boolean);
        if (valid.length === 0) return;
        const step = 88;
        const ease = '0.42s cubic-bezier(0.22, 1, 0.36, 1)';
        valid.forEach((el) => {
            el.style.transition = `opacity ${ease}, transform ${ease}`;
            el.style.opacity = '0';
            if (el.classList.contains('dna-title') || el.classList.contains('dna-timeline-subtitle') || el.classList.contains('dna-dev-label')) {
                el.style.transform = 'translate(-50%, 12px)';
            } else {
                el.style.transform = 'translateY(12px)';
            }
        });
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                valid.forEach((el, i) => {
                    window.setTimeout(() => {
                        el.style.opacity = '1';
                        if (el.classList.contains('dna-title') || el.classList.contains('dna-timeline-subtitle') || el.classList.contains('dna-dev-label')) {
                            el.style.transform = 'translate(-50%, 0)';
                        } else {
                            el.style.transform = 'translateY(0)';
                        }
                    }, i * step);
                });
            });
        });
    }

    async render() {
        if (!this.isActive) return;
        
        // Check if in timeline mode
        if (this.timelineMode) {
            await this.renderTimeline();
            return;
        }
        
        // Save current rotation state to prevent jitter during update
        let savedLeftRotation = 0;
        let savedRightRotation = 0;
        if (this.helixLeft) {
            savedLeftRotation = this.helixLeft.rotation.y;
        }
        if (this.helixRight) {
            savedRightRotation = this.helixRight.rotation.y;
        }
        
        // Clear previous visualization
        this.clear();
        this._showLoadingOverlay('Loading kernel DNA');
        
        // Load data
        const data = await this.loadData();
        if (!data) {
            await this._hideLoadingOverlay();
            return;
        }
        
        // Create helix strands
        const leftHelix = this.createHelixStrand(true);
        const rightHelix = this.createHelixStrand(false);
        this.helixLeft = leftHelix.group;
        this.helixRight = rightHelix.group;
        this.leftHelixCurve = leftHelix.curve;
        this.siemLayer = null; // recreated lazily; old one was disposed by clear()
        
        // Restore rotation state to prevent jitter
        this.helixLeft.rotation.y = savedLeftRotation;
        this.helixRight.rotation.y = savedRightRotation;
        
        this.scene.add(this.helixLeft);
        this.scene.add(this.helixRight);
        
        // Add nucleotides and rungs
        const nucleotides = data.nucleotides || [];
        const maxNucleotides = 30; // Limit for performance
        const step = Math.max(1, Math.floor(nucleotides.length / maxNucleotides));
        
        for (let i = 0; i < nucleotides.length; i += step) {
            const nucleotide = nucleotides[i];
            const t = i / nucleotides.length;
            
            // Position on left helix (userspace)
            const leftPos = leftHelix.curve.getPoint(t);
            const leftNuc = this.createNucleotide(nucleotide, leftPos, true);
            if (leftNuc) {
                this.helixLeft.add(leftNuc);
                this.nucleotides.push(leftNuc);
            }
            
            // Position on right helix (kernel space)
            const rightPos = rightHelix.curve.getPoint(t);
            const rightNuc = this.createNucleotide(nucleotide, rightPos, false);
            if (rightNuc) {
                this.helixRight.add(rightNuc);
                this.nucleotides.push(rightNuc);
            }
            
            // Create rung (connection between strands) - simple line
            const rung = this.createRung(leftPos, rightPos, false);
            if (rung) {
                this.helixLeft.add(rung);
            }
        }
        
        // Add gene segments
        if (data.genes) {
            data.genes.forEach(gene => {
                const geneSegment = this.createGeneSegment(gene, leftHelix.curve);
                this.helixLeft.add(geneSegment);
                this.genes.push(geneSegment);
            });
        }
        
        // Add mutations
        if (data.mutations) {
            data.mutations.forEach(mutation => {
                const mutationMesh = this.createMutation(mutation, leftHelix.curve);
                this.helixLeft.add(mutationMesh);
                this.mutations.push(mutationMesh);
            });
        }

        // Re-attach SIEM attack scars from the last poll (helix was rebuilt).
        if (this.siemAlerts && this.siemAlerts.length) {
            this.renderSiemScars({ alerts: this.siemAlerts });
        }
        
        await this._hideLoadingOverlay();
        
        // Add labels + SELECT PROCESS (same panel as former DNA Timeline mode)
        await this.addLabels(data);
        
        // Start animation only if not already animating
        if (!this.isAnimating) {
            this.isAnimating = true;
            this.animate();
        }
    }

    isProcessSelectorActive() {
        const active = document.activeElement;
        return !!(active && active.closest && active.closest('.dna-process-selector'));
    }

    async renderTimeline() {
        if (!this.selectedPid) {
            this._showLoadingOverlay('Loading process branches');
            try {
                const response = await fetch(`/api/proc-timeline-branches?limit=6&events=10&window_s=${this.timelineWindowS}`);
                const data = await response.json();
                if (data.error) {
                    console.error('❌ Branch timeline error:', data.error);
                    this.clear();
                    await this.addTimelineLabels(null);
                    return;
                }
                this.timelineBranches = data.branches || [];
                this.clear();
                this.renderTimelineBranches(this.timelineBranches);
                await this.addTimelineBranchLabels(data);
                if (!this.isAnimating) {
                    this.isAnimating = true;
                    this.animate();
                }
            } finally {
                await this._hideLoadingOverlay();
            }
            return;
        }
        this.timelineBranchMode = false;

        // Save current rotation state to prevent jitter during update
        let savedLeftRotation = 0;
        let savedRightRotation = 0;
        if (this.helixLeft) {
            savedLeftRotation = this.helixLeft.rotation.y;
        }
        if (this.helixRight) {
            savedRightRotation = this.helixRight.rotation.y;
        }

        this._showLoadingOverlay('Loading timeline');
        // Load timeline data
        try {
            const response = await fetch(`/api/proc-timeline?pid=${this.selectedPid}&window_s=${this.timelineWindowS}`);
            const data = await response.json();
            
            if (data.error) {
                console.error('❌ Timeline error:', data.error);
                return;
            }

            this.timelineData = data.timeline || [];
            this.timelineWindowS = Number(data.window_s || this.timelineWindowS || 30);
            
            // In focused timeline mode we render full selected window.
            this.currentTimelineHeight = this.maxTimelineHeight;

            // Clear previous visualization
            this.clear();

            // Create growing helix strands
            const leftHelix = this.createHelixStrand(true, this.currentTimelineHeight, -this.maxTimelineHeight / 2);
            const rightHelix = this.createHelixStrand(false, this.currentTimelineHeight, -this.maxTimelineHeight / 2);
            this.helixLeft = leftHelix.group;
            this.helixRight = rightHelix.group;
            
            // Restore rotation state to prevent jitter
            this.helixLeft.rotation.y = savedLeftRotation;
            this.helixRight.rotation.y = savedRightRotation;
            
            this.scene.add(this.helixLeft);
            this.scene.add(this.helixRight);

            // Map timeline events to nucleotides
            // Position events on helix based on timestamp
            this.timelineEvents = [];
            this.timelineData.forEach((event, i) => {
                const rel = Number(event.relative_s);
                let t = Number.isFinite(rel)
                    ? (rel / Math.max(1, Number(this.timelineWindowS)))
                    : (i / Math.max(1, this.timelineData.length - 1));
                t = Math.max(0, Math.min(1, t));

                // Only show events that have occurred (within current timeline height)
                if (t <= this.currentTimelineHeight / this.maxTimelineHeight) {
                    const nucleotideData = this.getTimelineNucleotideForEvent(event.type);
                    
                    // Position on left helix (userspace)
                    const leftPos = leftHelix.curve.getPoint(t);
                    const leftNuc = this.createNucleotide({
                        ...nucleotideData,
                        name: event.type,
                        count: event.count || event.bytes || 0,
                        subsystem: this.mapEventToSubsystem(event.type)
                    }, leftPos, true);
                    
                    if (leftNuc) {
                        leftNuc.userData.event = event;
                        leftNuc.userData.timestamp = event.timestamp;
                        this.helixLeft.add(leftNuc);
                        this.nucleotides.push(leftNuc);
                        this.timelineEvents.push(leftNuc);
                        this.addPinnedTimelineLabel(leftNuc);
                    }

                    // Position on right helix (kernel space)
                    const rightPos = rightHelix.curve.getPoint(t);
                    const rightNuc = this.createNucleotide({
                        ...nucleotideData,
                        name: event.type,
                        count: event.count || event.bytes || 0,
                        subsystem: this.mapEventToSubsystem(event.type)
                    }, rightPos, false);
                    
                    if (rightNuc) {
                        rightNuc.userData.event = event;
                        rightNuc.userData.timestamp = event.timestamp;
                        this.helixRight.add(rightNuc);
                        this.nucleotides.push(rightNuc);
                        this.timelineEvents.push(rightNuc);
                    }

                    // Create rung - simple line
                    const rung = this.createRung(leftPos, rightPos, false);
                    if (rung) {
                        this.helixLeft.add(rung);
                    }
                }
            });

            // Add time markers
            this.addTimelineMarkers(leftHelix.curve);

            // Update labels for timeline mode
            await this.addTimelineLabels(data);

            // Start animation
            if (!this.isAnimating) {
                this.isAnimating = true;
                this.animate();
            }
        } catch (error) {
            console.error('❌ Error rendering timeline:', error);
        } finally {
            await this._hideLoadingOverlay();
        }
    }

    mapEventToSubsystem(eventType) {
        const subsystemMap = {
            'syscall': 'sched',
            'context switch': 'sched',
            'interrupt': 'kernel',
            'scheduler tick': 'sched',
            'i/o': 'fs',
            'network packet': 'net',
            'lock/unlock': 'kernel',
            'exec': 'sched',
            'fork': 'sched',
            'mmap': 'mm',
            'read': 'fs',
            'write': 'fs',
            'connect': 'net',
            'accept': 'net',
            'exit': 'sched'
        };
        return subsystemMap[eventType] || 'kernel';
    }

    getTimelineNucleotideForEvent(eventType) {
        const eventToNucleotide = {
            'syscall': { code: 'A', type: 'syscall' },
            'context switch': { code: 'C', type: 'context_switch' },
            'interrupt': { code: 'T', type: 'interrupt' },
            'scheduler tick': { code: 'C', type: 'context_switch' },
            'i/o': { code: 'G', type: 'lock' },
            'network packet': { code: 'T', type: 'interrupt' },
            'lock/unlock': { code: 'G', type: 'lock' },
            // Backward compatibility with older timeline event naming.
            'exec': { code: 'A', type: 'syscall' },
            'fork': { code: 'A', type: 'syscall' },
            'mmap': { code: 'A', type: 'syscall' },
            'read': { code: 'A', type: 'syscall' },
            'write': { code: 'A', type: 'syscall' },
            'connect': { code: 'A', type: 'syscall' },
            'accept': { code: 'A', type: 'syscall' },
            'exit': { code: 'C', type: 'context_switch' }
        };
        return eventToNucleotide[eventType] || { code: 'A', type: 'syscall' };
    }

    buildEventTooltipHtml(userData) {
        const subsystem = userData?.subsystem || 'kernel';
        const eventType = userData?.event?.type || userData?.type || 'event';
        const processLabel = userData?.process_name
            ? `${userData.process_name}${userData.pid ? ` (PID: ${userData.pid})` : ''}`
            : '';
        return `
            <div style="font-weight: bold; color: #E6C15A; margin-bottom: 4px;">
                ${String(eventType).toUpperCase()}
            </div>
            <div style="margin-bottom: 2px; color: #D0D3D6;">${userData?.event?.name || userData?.name || 'Event'}</div>
            ${processLabel ? `<div style="color: #8A8F95; font-size: 10px;">Process: ${processLabel}</div>` : ''}
            <div style="color: #6B7076; font-size: 10px;">Subsystem: ${subsystem}</div>
            <div style="color: #8A8F95; font-size: 10px; margin-top: 4px;">
                Time: ${userData?.timestamp ? new Date(userData.timestamp).toLocaleTimeString() : 'n/a'}
            </div>
        `;
    }

    ensurePinnedLabelLayer() {
        if (this.pinnedLabelLayer && this.pinnedLabelLayer.parentNode) return this.pinnedLabelLayer;
        const layer = document.createElement('div');
        layer.className = 'dna-pinned-label-layer';
        layer.style.cssText = `
            position: absolute;
            inset: 0;
            pointer-events: none;
            z-index: 1001;
        `;
        this.container.appendChild(layer);
        this.pinnedLabelLayer = layer;
        return layer;
    }

    clearPinnedTimelineLabels() {
        this.pinnedTimelineLabels.forEach((item) => {
            if (item.node && item.node.parentNode) {
                item.node.parentNode.removeChild(item.node);
            }
        });
        this.pinnedTimelineLabels = [];
    }

    addPinnedTimelineLabel(targetObject) {
        if (!targetObject || !targetObject.userData || !targetObject.userData.event) return;
        const layer = this.ensurePinnedLabelLayer();
        const node = document.createElement('div');
        node.style.cssText = `
            position: absolute;
            background: #13171B;
            border: 1px solid #8A8F95;
            color: #D0D3D6;
            font-family: 'Share Tech Mono', monospace;
            font-size: 10px;
            padding: 6px 8px;
            border-radius: 4px;
            white-space: nowrap;
            transform: translate(-9999px, -9999px);
            opacity: 0.92;
        `;
        window.setSafeHtml(node, this.buildEventTooltipHtml(targetObject.userData));
        layer.appendChild(node);
        this.pinnedTimelineLabels.push({ object: targetObject, node });
    }

    updatePinnedTimelineLabels() {
        if (!this.isActive || !this.camera || !this.renderer || !this.pinnedTimelineLabels.length) return;
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.pinnedTimelineLabels.forEach((entry) => {
            const obj = entry.object;
            const node = entry.node;
            if (!obj || !node) return;
            const worldPos = new THREE.Vector3();
            obj.getWorldPosition(worldPos);
            const screenPos = worldPos.clone().project(this.camera);
            if (screenPos.z < -1 || screenPos.z > 1) {
                node.style.display = 'none';
                return;
            }
            node.style.display = 'block';
            const x = (screenPos.x * 0.5 + 0.5) * rect.width;
            const y = (-screenPos.y * 0.5 + 0.5) * rect.height;
            node.style.transform = `translate(${Math.round(x + 12)}px, ${Math.round(y - 10)}px)`;
        });
    }

    renderTimelineBranches(branches) {
        if (!Array.isArray(branches) || branches.length === 0) {
            return;
        }
        this.timelineBranchMode = true;
        this.helixLeft = null;
        this.helixRight = null;

        const group = new THREE.Group();
        const branchCount = branches.length;
        const xStart = -7;
        const xEnd = 7;
        const yTop = 4;
        const yBottom = -4;
        const yStep = branchCount > 1 ? (yTop - yBottom) / (branchCount - 1) : 0;

        branches.forEach((branch, idx) => {
            const y = yTop - (idx * yStep);
            const start = new THREE.Vector3(xStart, y, 0);
            const end = new THREE.Vector3(xEnd, y, 0);
            const lineGeom = new THREE.BufferGeometry().setFromPoints([start, end]);
            const lineMat = new THREE.LineBasicMaterial({
                color: this.colors.lineSecondary,
                transparent: true,
                opacity: 0.5
            });
            const branchLine = new THREE.Line(lineGeom, lineMat);
            group.add(branchLine);

            const events = Array.isArray(branch.timeline) ? branch.timeline : [];
            const evCount = Math.max(events.length, 1);
            events.forEach((ev, evIdx) => {
                const rel = Number(ev.relative_s);
                let t = Number.isFinite(rel)
                    ? (rel / Math.max(1, Number(this.timelineWindowS)))
                    : (evCount === 1 ? 0.5 : (evIdx / (evCount - 1)));
                t = Math.max(0, Math.min(1, t));
                const x = xStart + (xEnd - xStart) * t;
                const z = ((evIdx % 2 === 0) ? 1 : -1) * 0.12; // tiny depth jitter for readability
                const nuc = this.getTimelineNucleotideForEvent(ev.type);
                const point = this.createNucleotide(
                    {
                        ...nuc,
                        name: ev.name || ev.type || 'event',
                        count: ev.count || ev.bytes || 0,
                        subsystem: this.mapEventToSubsystem(ev.type || '')
                    },
                    new THREE.Vector3(x, y, z),
                    true
                );
                if (!point) return;
                point.userData.event = ev;
                point.userData.timestamp = ev.timestamp;
                point.userData.pid = branch.pid;
                point.userData.process_name = branch.name;
                this.nucleotides.push(point);
                group.add(point);
            });
        });

        this.scene.add(group);
    }

    addTimelineMarkers(curve) {
        // Add simple time markers (beads) along the helix - neutral gray
        const markerGroup = new THREE.Group();
        const numMarkers = 10;
        
        for (let i = 0; i <= numMarkers; i++) {
            const t = i / numMarkers;
            const point = curve.getPoint(t);
            
            // Simple bead (sphere) for time marker - Line secondary
            const geometry = new THREE.SphereGeometry(0.07, 10, 10); // Smaller timeline marker
            const material = new THREE.MeshBasicMaterial({
                color: this.colors.lineSecondary, // Line secondary: #8A8F95
                side: THREE.DoubleSide
            });
            
            const marker = new THREE.Mesh(geometry, material);
            marker.position.copy(point);
            marker.userData.isTimelineMarker = true;
            
            markerGroup.add(marker);
        }
        
        this.helixLeft.add(markerGroup);
    }

    async addTimelineLabels(data) {
        // Remove old labels
        const oldLabels = this.container.querySelectorAll('.dna-title, .dna-timeline-subtitle, .dna-legend, .dna-dev-label, .dna-timeline-info, .dna-process-selector, .dna-window-selector');
        oldLabels.forEach(label => label.remove());

        // Add title
        const titleDiv = document.createElement('div');
        titleDiv.className = 'dna-title';
        titleDiv.textContent = 'KERNEL DNA';
        titleDiv.style.cssText = `
            position: absolute;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            color: #c8ccd4;
            font-family: 'Share Tech Mono', monospace;
            font-size: 24px;
            z-index: 1001;
        `;
        this.container.appendChild(titleDiv);
        const sub = document.createElement('div');
        sub.className = 'dna-timeline-subtitle';
        sub.textContent = 'process branch timeline';
        sub.style.cssText = `
            position: absolute;
            top: 72px;
            left: 50%;
            transform: translateX(-50%);
            color: rgba(88, 182, 216, 0.85);
            font-family: 'Share Tech Mono', monospace;
            font-size: 11px;
            letter-spacing: 0.4px;
            z-index: 1001;
        `;
        this.container.appendChild(sub);
        const devLabel = this.appendInDevelopmentLabel(52);

        // Add timeline info
        const infoDiv = document.createElement('div');
        infoDiv.className = 'dna-timeline-info';
        const processName = data ? (data.name || 'unknown') : 'No process selected';
        const eventCount = this.timelineData.length;
        const heightPercent = Math.round((this.currentTimelineHeight / this.maxTimelineHeight) * 100);
        window.setSafeHtml(infoDiv, `
            <div style="color: #c8ccd4; font-family: 'Share Tech Mono', monospace; font-size: 11px;">
                <div style="margin-bottom: 5px; color: #58b6d8;">Process: ${processName} ${this.selectedPid ? `(PID: ${this.selectedPid})` : ''}</div>
                <div style="margin-bottom: 5px;">Events: ${eventCount}</div>
                <div style="margin-bottom: 5px;">Window: ${this.timelineWindowS}s</div>
                <div style="margin-bottom: 5px;">Timeline: ${heightPercent}%</div>
                <div style="margin-top: 10px; font-size: 10px; color: #888;">
                    <div>1 branch = selected process</div>
                    <div>points = kernel/runtime events</div>
                </div>
            </div>
        `);
        infoDiv.style.cssText = `
            position: absolute;
            top: 20px;
            left: 20px;
            z-index: 1001;
        `;
        this.container.appendChild(infoDiv);

        const legendDiv = document.createElement('div');
        legendDiv.className = 'dna-legend';
        window.setSafeHtml(legendDiv, `
            <div style="color: #c8ccd4; font-family: 'Share Tech Mono', monospace; font-size: 11px; margin-top: 160px; opacity: 0.8;">
                <div style="margin-bottom: 5px;">A = syscall</div>
                <div style="margin-bottom: 5px;">C = context switch / scheduler tick</div>
                <div style="margin-bottom: 5px;">T = interrupt / network packet</div>
                <div style="margin-bottom: 5px;">G = I/O / lock-unlock</div>
            </div>
        `);
        legendDiv.style.cssText = `
            position: absolute;
            top: 20px;
            left: 20px;
            z-index: 1001;
        `;
        this.container.appendChild(legendDiv);

        this.addTimelineWindowSelector([sub, infoDiv]);
        await this.addProcessSelector();
        const selectorEl = this.container.querySelector('.dna-process-selector');
        const windowEl = this.container.querySelector('.dna-window-selector');

        this._applyStaggeredReveal([titleDiv, sub, devLabel, selectorEl, windowEl, infoDiv, legendDiv]);
    }

    async addTimelineBranchLabels(data) {
        const oldLabels = this.container.querySelectorAll('.dna-title, .dna-timeline-subtitle, .dna-legend, .dna-dev-label, .dna-timeline-info, .dna-process-selector, .dna-window-selector');
        oldLabels.forEach(label => label.remove());

        const titleDiv = document.createElement('div');
        titleDiv.className = 'dna-title';
        titleDiv.textContent = 'KERNEL DNA';
        titleDiv.style.cssText = `
            position: absolute;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            color: #c8ccd4;
            font-family: 'Share Tech Mono', monospace;
            font-size: 24px;
            z-index: 1001;
        `;
        this.container.appendChild(titleDiv);

        const sub = document.createElement('div');
        sub.className = 'dna-timeline-subtitle';
        sub.textContent = 'process branches timeline';
        sub.style.cssText = `
            position: absolute;
            top: 72px;
            left: 50%;
            transform: translateX(-50%);
            color: rgba(88, 182, 216, 0.85);
            font-family: 'Share Tech Mono', monospace;
            font-size: 11px;
            letter-spacing: 0.4px;
            z-index: 1001;
        `;
        this.container.appendChild(sub);
        const devLabel = this.appendInDevelopmentLabel(52);

        const branchCount = Number(data?.meta?.branch_count || (this.timelineBranches || []).length || 0);
        const totalEvents = (this.timelineBranches || []).reduce((acc, row) => acc + Number(row?.event_count || 0), 0);

        const infoDiv = document.createElement('div');
        infoDiv.className = 'dna-timeline-info';
        window.setSafeHtml(infoDiv, `
            <div style="color: #c8ccd4; font-family: 'Share Tech Mono', monospace; font-size: 11px;">
                <div style="margin-bottom: 5px; color: #58b6d8;">Branches: ${branchCount}</div>
                <div style="margin-bottom: 5px;">Events: ${totalEvents}</div>
                <div style="margin-bottom: 5px;">Window: ${this.timelineWindowS}s</div>
                <div style="margin-top: 10px; font-size: 10px; color: #888;">
                    <div>1 branch = process timeline</div>
                    <div>X axis = relative time within window</div>
                    <div>click process on right to focus helix view</div>
                </div>
            </div>
        `);
        infoDiv.style.cssText = `
            position: absolute;
            top: 20px;
            left: 20px;
            z-index: 1001;
        `;
        this.container.appendChild(infoDiv);

        const legendDiv = document.createElement('div');
        legendDiv.className = 'dna-legend';
        window.setSafeHtml(legendDiv, `
            <div style="color: #c8ccd4; font-family: 'Share Tech Mono', monospace; font-size: 11px; margin-top: 160px; opacity: 0.8;">
                <div style="margin-bottom: 5px;">A = syscall</div>
                <div style="margin-bottom: 5px;">C = context switch / scheduler tick</div>
                <div style="margin-bottom: 5px;">T = interrupt / network packet</div>
                <div style="margin-bottom: 5px;">G = I/O / lock-unlock</div>
            </div>
        `);
        legendDiv.style.cssText = `
            position: absolute;
            top: 20px;
            left: 20px;
            z-index: 1001;
        `;
        this.container.appendChild(legendDiv);

        this.addTimelineWindowSelector([sub, infoDiv]);
        await this.addProcessSelector();
        const selectorEl = this.container.querySelector('.dna-process-selector');
        const windowEl = this.container.querySelector('.dna-window-selector');
        this._applyStaggeredReveal([titleDiv, sub, devLabel, infoDiv, legendDiv, windowEl, selectorEl]);
    }

    addTimelineWindowSelector(anchorNodes = []) {
        const existing = this.container.querySelectorAll('.dna-window-selector');
        existing.forEach((node) => node.remove());

        const containerRect = this.container ? this.container.getBoundingClientRect() : { top: 0 };
        let topPx = 124;
        anchorNodes.forEach((node) => {
            if (!node || typeof node.getBoundingClientRect !== 'function') return;
            const rect = node.getBoundingClientRect();
            if (!rect || !Number.isFinite(rect.bottom)) return;
            const candidate = Math.round(rect.bottom - containerRect.top + 10);
            topPx = Math.max(topPx, candidate);
        });

        const panel = document.createElement('div');
        panel.className = 'dna-window-selector';
        panel.style.cssText = `
            position: absolute;
            top: ${topPx}px;
            left: 20px;
            display: flex;
            align-items: center;
            gap: 6px;
            z-index: 1001;
            font-family: 'Share Tech Mono', monospace;
        `;

        const label = document.createElement('span');
        label.textContent = 'window';
        label.style.cssText = `
            color: #9aa2aa;
            font-size: 10px;
            letter-spacing: 0.3px;
            margin-right: 4px;
        `;
        panel.appendChild(label);

        this.timelineWindowOptions.forEach((sec) => {
            const active = Number(sec) === Number(this.timelineWindowS);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = `${sec}s`;
            btn.style.cssText = `
                padding: 3px 8px;
                background: ${active ? 'rgba(37, 58, 92, 0.72)' : 'rgba(12, 18, 28, 0.88)'};
                border: 1px solid ${active ? 'rgba(120, 170, 245, 0.72)' : 'rgba(150, 164, 188, 0.35)'};
                color: ${active ? '#e1eeff' : '#bcc8db'};
                border-radius: 3px;
                font-family: 'Share Tech Mono', monospace;
                font-size: 10px;
                cursor: pointer;
            `;
            btn.onclick = async () => {
                if (Number(this.timelineWindowS) === Number(sec)) return;
                this.timelineWindowS = Number(sec);
                await this.renderTimeline();
            };
            panel.appendChild(btn);
        });

        this.container.appendChild(panel);
    }

    async addProcessSelector() {
        // Create process selector panel
        const selectorDiv = document.createElement('div');
        selectorDiv.className = 'dna-process-selector';
        selectorDiv.style.cssText = `
            position: absolute;
            top: 80px;
            right: 20px;
            width: 262px;
            max-height: 500px;
            background: rgba(12, 18, 28, 0.95);
            border: 1px solid rgba(160, 170, 190, 0.35);
            border-radius: 4px;
            padding: 15px;
            z-index: 1001;
            overflow-y: auto;
            font-family: 'Share Tech Mono', monospace;
        `;

        // Add header + optional clear (back to full kernel DNA view)
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 10px;
            color: #c8ccd4;
            font-size: 12px;
            font-weight: bold;
            margin-bottom: 10px;
            padding-bottom: 8px;
            border-bottom: 1px solid rgba(160, 170, 190, 0.2);
        `;
        const headerTitle = document.createElement('span');
        headerTitle.textContent = 'SELECT PROCESS';
        header.appendChild(headerTitle);
        if (this.selectedPid) {
            const clearBtn = document.createElement('button');
            clearBtn.type = 'button';
            clearBtn.textContent = 'Show all kernel';
            clearBtn.style.cssText = `
                background: rgba(5, 8, 12, 0.8);
                border: 1px solid rgba(88, 182, 216, 0.45);
                color: #58b6d8;
                font-family: 'Share Tech Mono', monospace;
                font-size: 10px;
                padding: 4px 8px;
                border-radius: 3px;
                cursor: pointer;
            `;
            clearBtn.onclick = async () => {
                this.timelineMode = false;
                this.selectedPid = null;
                this.timeStart = null;
                this.currentTimelineHeight = 0;
                await this.render();
            };
            header.appendChild(clearBtn);
        }
        selectorDiv.appendChild(header);

        // Add search input
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Search process...';
        searchInput.style.cssText = `
            width: 100%;
            padding: 6px 8px;
            margin-bottom: 10px;
            background: rgba(5, 8, 12, 0.8);
            border: 1px solid rgba(160, 170, 190, 0.25);
            border-radius: 3px;
            color: #c8ccd4;
            font-family: 'Share Tech Mono', monospace;
            font-size: 11px;
        `;
        selectorDiv.appendChild(searchInput);

        // Add process list container
        const processList = document.createElement('div');
        processList.className = 'dna-process-list';
        processList.style.cssText = `
            max-height: 400px;
            overflow-y: auto;
        `;
        selectorDiv.appendChild(processList);

        // Load and display processes
        try {
            const response = await fetch('/api/processes-detailed');
            const data = await response.json();
            const processes = data.processes || [];

            // Sort by PID
            processes.sort((a, b) => a.pid - b.pid);

            // Filter function
            const filterProcesses = (searchTerm) => {
                processList.innerHTML = '';
                const filtered = processes.filter(p => 
                    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    p.pid.toString().includes(searchTerm)
                );

                filtered.slice(0, 100).forEach(proc => { // Limit to 100 for performance
                    const procItem = document.createElement('div');
                    procItem.style.cssText = `
                        padding: 8px;
                        margin-bottom: 4px;
                        background: ${this.selectedPid === proc.pid ? 'rgba(88, 182, 216, 0.2)' : 'rgba(5, 8, 12, 0.6)'};
                        border: 1px solid ${this.selectedPid === proc.pid ? 'rgba(88, 182, 216, 0.5)' : 'rgba(160, 170, 190, 0.15)'};
                        border-radius: 3px;
                        cursor: pointer;
                        transition: all 0.2s ease;
                    `;
                    window.setSafeHtml(procItem, `
                        <div style="color: #c8ccd4; font-size: 11px; font-weight: ${this.selectedPid === proc.pid ? 'bold' : 'normal'};">
                            <div style="color: #58b6d8;">${proc.name}</div>
                            <div style="color: #888; font-size: 10px; margin-top: 2px;">
                                PID: ${proc.pid} | CPU: ${proc.cpu_percent}% | MEM: ${proc.memory_mb}MB
                            </div>
                        </div>
                    `);

                    procItem.onmouseenter = () => {
                        if (this.selectedPid !== proc.pid) {
                            procItem.style.background = 'rgba(20, 26, 36, 0.8)';
                            procItem.style.borderColor = 'rgba(160, 170, 190, 0.3)';
                        }
                    };
                    procItem.onmouseleave = () => {
                        if (this.selectedPid !== proc.pid) {
                            procItem.style.background = 'rgba(5, 8, 12, 0.6)';
                            procItem.style.borderColor = 'rgba(160, 170, 190, 0.15)';
                        }
                    };
                    procItem.onclick = async () => {
                        this.selectedPid = proc.pid;
                        this.timelineMode = true;
                        this.timeStart = null;
                        this.currentTimelineHeight = 0;
                        await this.renderTimeline();
                    };

                    processList.appendChild(procItem);
                });
            };

            // Initial render
            filterProcesses('');

            // Search functionality
            searchInput.addEventListener('input', (e) => {
                filterProcesses(e.target.value);
            });

        } catch (error) {
            console.error('❌ Error loading processes:', error);
            window.setSafeHtml(processList, `
                <div style="color: #888; font-size: 11px; padding: 10px; text-align: center;">
                    Error loading processes
                </div>
            `);
        }

        this.container.appendChild(selectorDiv);
    }

    activateTimelineMode(pid = null) {
        debugLog('🧬 Activating Kernel DNA Timeline Mode', pid ? `for PID: ${pid}` : '(no PID)');
        this.timelineMode = true;
        this.selectedPid = pid;
        this.timeStart = null; // Reset start time
        this.currentTimelineHeight = 0;
        
        if (!this.isActive) {
            this.activate();
        } else {
            this.renderTimeline();
        }
    }

    async addLabels(data) {
        // Remove old labels first
        const oldLabels = this.container.querySelectorAll('.dna-title, .dna-legend, .dna-dev-label, .dna-process-selector, .dna-window-selector');
        oldLabels.forEach(label => label.remove());
        
        // Add title
        const titleDiv = document.createElement('div');
        titleDiv.className = 'dna-title';
        titleDiv.textContent = 'KERNEL DNA';
        titleDiv.style.cssText = `
            position: absolute;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            color: #c8ccd4;
            font-family: 'Share Tech Mono', monospace;
            font-size: 24px;
            z-index: 1001;
        `;
        this.container.appendChild(titleDiv);
        const devLabel = this.appendInDevelopmentLabel(52);
        
        // Add legend - Diegetic UI style
        const legendDiv = document.createElement('div');
        legendDiv.className = 'dna-legend';
        window.setSafeHtml(legendDiv, `
            <div style="color: #c8ccd4; font-family: 'Share Tech Mono', monospace; font-size: 11px; margin-top: 60px; opacity: 0.8;">
                <div style="margin-bottom: 5px;">A (●) = Syscall</div>
                <div style="margin-bottom: 5px;">T (■) = Interrupt</div>
                <div style="margin-bottom: 5px;">C (▲) = Context Switch</div>
                <div style="margin-bottom: 5px;">G (◆) = Lock/Mutex</div>
                <div style="margin-top: 10px; color: #cc4444;">⚠ Mutations = Anomalies</div>
                <div style="margin-top: 4px; color: #E6C15A;">◇ RULE = threshold</div>
                <div style="margin-bottom: 2px; color: #67C8E0;">◇ ML = baseline z-score</div>
                <div style="margin-top: 4px; color: #39E67A;">◯ ORBIT = SIEM attack (by tactic)</div>
            </div>
        `);
        legendDiv.style.cssText = `
            position: absolute;
            top: 20px;
            left: 20px;
            z-index: 1001;
        `;
        this.container.appendChild(legendDiv);

        const driftEl = this._ensureDriftIndicator();
        const threatEl = this._ensureThreatFeed();

        await this.addProcessSelector();
        const selectorEl = this.container.querySelector('.dna-process-selector');
        this._applyStaggeredReveal([titleDiv, devLabel, legendDiv, driftEl, threatEl, selectorEl]);
    }

    /**
     * Model-freshness indicator: shows whether the ML baseline is "fresh" or has
     * "drifted", current flag-rate vs the expected contamination, feature drift,
     * model artifact age, and a small flag-rate history sparkline. Reads from the
     * read-only /api/ml-drift endpoint that the drift monitor / retrain job feeds.
     */
    _ensureDriftStyles() {
        if (this._driftStylesInjected || typeof document === 'undefined') return;
        const style = document.createElement('style');
        style.id = 'kernel-dna-drift-styles';
        style.textContent = `
            .dna-drift-indicator {
                position: absolute;
                bottom: 26px;
                left: 20px;
                z-index: 1001;
                width: 262px;
                padding: 15px;
                font-family: 'Share Tech Mono', monospace;
                color: #c8ccd4;
                cursor: default;
                background: rgba(12, 18, 28, 0.95);
                border: 1px solid rgba(160, 170, 190, 0.35);
                border-radius: 4px;
                overflow: hidden;
            }
            /* unified with SELECT PROCESS: drop cut-corner ticks + scanline */
            .dna-drift-indicator::before,
            .dna-drift-indicator::after { content: none; }
            .dna-drift-scan { display: none; }
            .dna-drift-head { display:flex; align-items:center; gap:7px; margin-bottom:8px; }
            .dna-drift-led {
                width:7px; height:7px; border-radius:50%;
                background:#9aa3ad; box-shadow:0 0 6px rgba(154,163,173,0.8);
                animation: dna-drift-led 1.8s ease-in-out infinite;
            }
            @keyframes dna-drift-led { 0%,100%{opacity:0.45;} 50%{opacity:1;} }
            .dna-drift-title {
                font-size:10px; letter-spacing:1.2px; opacity:0.82; flex:1;
                text-shadow: 0 0 8px rgba(103,200,224,0.25);
            }
            .dna-drift-pill {
                font-size:8.5px; letter-spacing:0.6px; padding:2px 7px;
                border:1px solid rgba(120,128,138,0.5); color:#9aa3ad;
                clip-path: polygon(0 0, calc(100% - 5px) 0, 100% 5px, 100% 100%, 5px 100%, 0 calc(100% - 5px));
            }
            .dna-drift-metrics { font-size:10px; line-height:1.6; opacity:0.9; }
            .dna-drift-metrics .k { opacity:0.5; }
        `;
        document.head.appendChild(style);
        this._driftStylesInjected = true;
    }

    _ensureDriftIndicator() {
        let panel = this.container.querySelector('.dna-drift-indicator');
        if (panel) return panel;
        this._ensureDriftStyles();

        panel = document.createElement('div');
        panel.className = 'dna-drift-indicator';
        window.setSafeHtml(panel, `
            <div class="dna-drift-scan"></div>
            <div class="dna-drift-head">
                <span class="dna-drift-led"></span>
                <span class="dna-drift-title">ML MODEL</span>
                <span class="dna-drift-pill">…</span>
            </div>
            <svg class="dna-drift-spark" width="170" height="30" style="display:block; width:170px; height:30px; overflow:visible; margin-bottom:8px;"></svg>
            <div class="dna-drift-metrics">
                <div>flags <span class="dna-drift-flag">–</span> <span class="k">/ exp <span class="dna-drift-exp">–</span></span></div>
                <div>feat drift <span class="dna-drift-feat">–</span></div>
                <div class="k">model <span class="dna-drift-age">–</span></div>
            </div>
        `);
        this.container.appendChild(panel);
        this._startDriftPolling();
        return panel;
    }

    _startDriftPolling() {
        if (this.driftInterval) return;
        const poll = async () => {
            if (!this.isActive) return;
            try {
                const resp = await fetch('/api/ml-drift?history=40');
                const payload = await resp.json();
                this._renderDriftIndicator(payload);
            } catch (e) {
                this._renderDriftIndicator({ available: false });
            }
        };
        poll();
        this.driftInterval = setInterval(poll, 15000);
    }

    _fmtAge(sec) {
        if (sec == null || !isFinite(sec)) return 'n/a';
        if (sec < 90) return `${Math.round(sec)}s ago`;
        if (sec < 5400) return `${Math.round(sec / 60)}m ago`;
        if (sec < 172800) return `${Math.round(sec / 3600)}h ago`;
        return `${Math.round(sec / 86400)}d ago`;
    }

    // ---- Live threat feed HUD (Elastic SIEM) -------------------------------

    _ensureThreatStyles() {
        if (this._threatStylesInjected || typeof document === 'undefined') return;
        const style = document.createElement('style');
        style.id = 'kernel-dna-threat-styles';
        style.textContent = `
            .dna-threat-feed {
                position: absolute; top: 262px; left: 20px; z-index: 1001;
                width: 292px; max-height: 46vh; display: flex; flex-direction: column;
                font-family: 'Share Tech Mono', monospace; color: #c8ccd4;
                background: rgba(12, 18, 28, 0.95);
                border: 1px solid rgba(160, 170, 190, 0.35);
                border-radius: 4px; overflow: hidden;
            }
            /* unified with SELECT PROCESS: no cut-corner / tick brackets */
            .dna-threat-feed::before, .dna-threat-feed::after { content: none; }
            .dna-threat-head { display:flex; align-items:center; gap:7px; padding:11px 13px 8px; }
            .dna-threat-led {
                width:7px; height:7px; border-radius:50%; background:#E0564E;
                box-shadow:0 0 7px rgba(224,86,78,0.9); animation: dna-threat-led 1.5s ease-in-out infinite;
            }
            @keyframes dna-threat-led { 0%,100%{opacity:0.45;} 50%{opacity:1;} }
            .dna-threat-title { font-size:10px; letter-spacing:1.2px; opacity:0.9; flex:1;
                text-shadow:0 0 8px rgba(224,86,78,0.25); }
            .dna-threat-counts { font-size:9px; opacity:0.85; padding:0 13px 8px; letter-spacing:0.4px; }
            .dna-threat-counts b { color:#ff6a5c; }
            .dna-threat-list { overflow-y:auto; padding:0 8px 10px; }
            .dna-threat-list::-webkit-scrollbar { width:5px; }
            .dna-threat-list::-webkit-scrollbar-thumb { background:rgba(224,86,78,0.3); border-radius:3px; }
            .dna-threat-row {
                display:flex; gap:7px; padding:6px 6px; margin:3px 0; cursor:pointer;
                border-left:2px solid transparent; align-items:flex-start;
                transition: background 0.15s, border-color 0.15s;
            }
            .dna-threat-row:hover, .dna-threat-row.active {
                background: rgba(224,86,78,0.10); border-left-color:#e0564e;
            }
            .dna-threat-dot { width:8px; height:8px; border-radius:50%; margin-top:3px; flex:0 0 auto; }
            .dna-threat-body { flex:1; min-width:0; }
            .dna-threat-rule { font-size:10.5px; line-height:1.25; color:#dbe0e6;
                white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .dna-threat-meta { font-size:9px; opacity:0.7; margin-top:2px;
                white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .dna-threat-meta .tech { color:#e6c15a; }
            .dna-threat-count {
                flex:0 0 auto; align-self:center; margin-left:4px; padding:0 5px;
                font-size:9px; line-height:15px; border-radius:8px; color:#0c121c;
                font-weight:700; background:#e0564e;
            }
            .dna-threat-caret { flex:0 0 auto; align-self:center; font-size:9px; opacity:0.55;
                transition: transform 0.15s; margin-left:2px; }
            .dna-threat-row.expanded .dna-threat-caret { transform: rotate(90deg); opacity:0.9; }
            .dna-threat-sub { display:none; margin:0 0 4px 17px;
                border-left:1px solid rgba(160,170,190,0.18); padding-left:8px; }
            .dna-threat-subrow {
                display:flex; justify-content:space-between; gap:8px; padding:3px 4px;
                font-size:9px; cursor:pointer; border-radius:2px;
            }
            .dna-threat-subrow:hover { background: rgba(224,86,78,0.10); }
            .dna-threat-subrow .p { color:#c3c9d2; white-space:nowrap; overflow:hidden;
                text-overflow:ellipsis; font-family:"Share Tech Mono", monospace; }
            .dna-threat-subrow .t { opacity:0.55; flex:0 0 auto; }
            .dna-threat-empty { font-size:10px; opacity:0.6; padding:12px 14px; }
        `;
        document.head.appendChild(style);
        this._threatStylesInjected = true;
    }

    _ensureThreatFeed() {
        let panel = this.container.querySelector('.dna-threat-feed');
        if (panel) return panel;
        this._ensureThreatStyles();
        panel = document.createElement('div');
        panel.className = 'dna-threat-feed';
        window.setSafeHtml(panel, `
            <div class="dna-threat-head">
                <span class="dna-threat-led"></span>
                <span class="dna-threat-title">LIVE THREAT FEED</span>
            </div>
            <div class="dna-threat-counts">…</div>
            <div class="dna-threat-list"><div class="dna-threat-empty">connecting to SIEM…</div></div>
        `);
        this.container.appendChild(panel);
        this._startSiemPolling();
        return panel;
    }

    _startSiemPolling() {
        if (this.siemInterval) return;
        const poll = async () => {
            if (!this.isActive) return;
            try {
                const resp = await fetch('/api/siem-alerts?hours=24&limit=300');
                const payload = await resp.json();
                this.siemAlerts = (payload && Array.isArray(payload.alerts)) ? payload.alerts : [];
                this._renderThreatFeed(payload);
                this.renderSiemScars(payload);
            } catch (e) {
                this._renderThreatFeed({ available: false });
            }
        };
        poll();
        this.siemInterval = setInterval(poll, 20000);
    }

    _relTime(iso) {
        if (!iso) return '';
        const then = Date.parse(iso);
        if (isNaN(then)) return '';
        const sec = Math.max(0, (Date.now() - then) / 1000);
        return this._fmtAge(sec);
    }

    _renderThreatFeed(payload) {
        const panel = this.container && this.container.querySelector('.dna-threat-feed');
        if (!panel) return;
        const counts = panel.querySelector('.dna-threat-counts');
        const list = panel.querySelector('.dna-threat-list');
        if (!list) return;

        if (!payload || payload.available === false) {
            if (counts) counts.textContent = 'SIEM offline';
            while (list.firstChild) list.removeChild(list.firstChild);
            const empty = document.createElement('div');
            empty.className = 'dna-threat-empty';
            empty.textContent = 'SIEM unreachable';
            list.appendChild(empty);
            return;
        }

        const bysev = payload.by_severity || {};
        if (counts) {
            const total = payload.total != null ? payload.total : (payload.count || 0);
            window.setSafeHtml(counts,
                `24h: <b>${total}</b> alerts · ${bysev.critical || 0} crit · ${bysev.high || 0} high · ${bysev.medium || 0} med`);
        }

        const alerts = Array.isArray(payload.alerts) ? payload.alerts : [];
        while (list.firstChild) list.removeChild(list.firstChild);
        if (!alerts.length) {
            const empty = document.createElement('div');
            empty.className = 'dna-threat-empty';
            empty.textContent = 'no attacks in window';
            list.appendChild(empty);
            return;
        }

        // Group by (source_ip + rule): a single scanner hitting 130 dotfile
        // variants collapses into one line with an ×N count, expandable to show
        // the individual paths that differ.
        const groups = this._groupFeed(alerts);

        groups.forEach(g => {
            const row = document.createElement('div');
            row.className = 'dna-threat-row';
            row.dataset.id = g.repId || '';

            const dot = document.createElement('div');
            dot.className = 'dna-threat-dot';
            dot.style.background = this._sevColorHex(g.severity);
            dot.style.boxShadow = `0 0 6px ${this._sevColorHex(g.severity)}`;

            const body = document.createElement('div');
            body.className = 'dna-threat-body';

            const rule = document.createElement('div');
            rule.className = 'dna-threat-rule';
            rule.textContent = g.rule;

            const meta = document.createElement('div');
            meta.className = 'dna-threat-meta';
            const tech = g.technique ? `<span class="tech">${g.technique}</span> · ` : '';
            const rel = this._relTime(g.latest);
            const np = g.paths ? g.paths.size : 0;
            const paths = np > 1 ? ` · ${np} paths` : '';
            window.setSafeHtml(meta, `${tech}${g.ip}${rel ? ' · ' + rel : ''}${paths}`);

            body.appendChild(rule);
            body.appendChild(meta);
            row.appendChild(dot);
            row.appendChild(body);

            if (g.count > 1) {
                const badge = document.createElement('span');
                badge.className = 'dna-threat-count';
                badge.textContent = `×${g.count}`;
                badge.style.background = this._sevColorHex(g.severity);
                row.appendChild(badge);
                const caret = document.createElement('span');
                caret.className = 'dna-threat-caret';
                caret.textContent = '▸';
                row.appendChild(caret);
            }
            list.appendChild(row);

            // expandable sublist of the individual (differing) paths / hits
            let sub = null;
            if (g.count > 1) {
                sub = document.createElement('div');
                sub.className = 'dna-threat-sub';
                g.items.forEach(a => {
                    const sr = document.createElement('div');
                    sr.className = 'dna-threat-subrow';
                    sr.dataset.id = a.id || '';
                    const path = a.url_path || a.url_query || '(no path)';
                    const srel = this._relTime(a.time);
                    window.setSafeHtml(sr,
                        `<span class="p">${String(path).slice(0, 42)}</span>${srel ? ' <span class="t">' + srel + '</span>' : ''}`);
                    sr.addEventListener('click', ev => {
                        ev.stopPropagation();
                        this._focusScar(a.id);
                    });
                    sr.addEventListener('mouseenter', () => { this.hoveredScarId = a.id; });
                    sr.addEventListener('mouseleave', () => { if (this.hoveredScarId === a.id) this.hoveredScarId = null; });
                    sub.appendChild(sr);
                });
                list.appendChild(sub);
            }

            row.addEventListener('click', () => {
                this._focusScar(g.repId);
                panel.querySelectorAll('.dna-threat-row.active').forEach(r => r.classList.remove('active'));
                row.classList.add('active');
                if (sub) {
                    const open = row.classList.toggle('expanded');
                    sub.style.display = open ? 'block' : 'none';
                }
            });
            row.addEventListener('mouseenter', () => { this.hoveredScarId = g.repId; });
            row.addEventListener('mouseleave', () => { if (this.hoveredScarId === g.repId) this.hoveredScarId = null; });
        });
    }

    // Collapse alerts by (source_ip + rule) into ranked groups for the feed.
    _groupFeed(alerts) {
        const map = new Map();
        alerts.forEach(a => {
            const key = `${a.source_ip || '—'}||${a.rule || 'web attack'}`;
            let g = map.get(key);
            if (!g) {
                g = {
                    key, rule: a.rule || 'web attack', ip: a.source_ip || '—',
                    technique: a.technique || null, severity: a.severity || 'medium',
                    maxRank: this._sevRank(a.severity), count: 0, latest: a.time,
                    repId: a.id || '', items: [], paths: new Set()
                };
                map.set(key, g);
            }
            g.count += 1;
            g.items.push(a);
            if (a.url_path) g.paths.add(a.url_path);
            if (!g.technique && a.technique) g.technique = a.technique;
            const rk = this._sevRank(a.severity);
            if (rk > g.maxRank) { g.maxRank = rk; g.severity = a.severity; g.repId = a.id || g.repId; }
            if (a.time && (!g.latest || Date.parse(a.time) > Date.parse(g.latest))) g.latest = a.time;
        });

        const groups = Array.from(map.values());
        groups.forEach(g => {
            g.distinctPaths = g.paths.size || g.count;
            g.items.sort((x, y) => Date.parse(y.time || 0) - Date.parse(x.time || 0));
        });
        groups.sort((a, b) =>
            b.maxRank - a.maxRank ||
            b.count - a.count ||
            Date.parse(b.latest || 0) - Date.parse(a.latest || 0));
        return groups;
    }

    _renderDriftIndicator(payload) {
        const panel = this.container && this.container.querySelector('.dna-drift-indicator');
        if (!panel) return;
        const pill = panel.querySelector('.dna-drift-pill');
        const led = panel.querySelector('.dna-drift-led');
        const setText = (sel, txt) => { const el = panel.querySelector(sel); if (el) el.textContent = txt; };
        const setState = (label, color, border) => {
            pill.textContent = label;
            pill.style.color = color;
            pill.style.borderColor = border;
            if (led) { led.style.background = color; led.style.boxShadow = `0 0 7px ${color}`; }
        };

        if (!payload || payload.available === false) {
            setState('OFFLINE', '#6b7076', 'rgba(107,112,118,0.5)');
            setText('.dna-drift-flag', '–'); setText('.dna-drift-exp', '–');
            setText('.dna-drift-feat', '–'); setText('.dna-drift-age', '–');
            this._drawDriftSparkline([], 0.02);
            return;
        }

        const latest = payload.latest;
        const history = Array.isArray(payload.history) ? payload.history : [];
        const exp = latest && latest.expected_rate != null ? latest.expected_rate : 0.02;

        if (!latest) {
            setState('WARMING', '#9aa3ad', 'rgba(120,128,138,0.5)');
        } else if (latest.drifted) {
            setState('DRIFTED', '#E0564E', 'rgba(224,86,78,0.6)');
        } else {
            setState('FRESH', '#5BD6A0', 'rgba(91,214,160,0.5)');
        }

        if (latest) {
            const fr = latest.flag_rate != null ? latest.flag_rate : 0;
            const fd = latest.feature_drift != null ? latest.feature_drift : 0;
            setText('.dna-drift-flag', `${(fr * 100).toFixed(1)}%`);
            setText('.dna-drift-exp', `${(exp * 100).toFixed(1)}%`);
            setText('.dna-drift-feat', fd > 99 ? '>99σ' : `${fd.toFixed(2)}σ`);
        }
        setText('.dna-drift-age', this._fmtAge(payload.model_age_sec));
        this._drawDriftSparkline(history, exp);
    }

    _drawDriftSparkline(history, expected) {
        const svg = this.container && this.container.querySelector('.dna-drift-spark');
        if (!svg) return;
        const NS = 'http://www.w3.org/2000/svg';
        while (svg.firstChild) svg.removeChild(svg.firstChild);
        const W = 170, H = 30;
        const vals = history.map(h => Math.max(0, Math.min(1, h && h.flag_rate != null ? h.flag_rate : 0)));
        // Scale so the expected line and the data are both visible.
        const peak = Math.max(0.04, expected * 2, ...vals);
        const y = (v) => H - 2 - (v / peak) * (H - 4);
        const x = (i, n) => n <= 1 ? 0 : (i / (n - 1)) * W;

        // expected (baseline) reference line
        const base = document.createElementNS(NS, 'line');
        base.setAttribute('x1', 0); base.setAttribute('x2', W);
        base.setAttribute('y1', y(expected)); base.setAttribute('y2', y(expected));
        base.setAttribute('stroke', 'rgba(150,160,170,0.35)');
        base.setAttribute('stroke-dasharray', '3 3');
        base.setAttribute('stroke-width', '1');
        svg.appendChild(base);

        if (vals.length >= 2) {
            const pts = vals.map((v, i) => `${x(i, vals.length).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
            const line = document.createElementNS(NS, 'polyline');
            line.setAttribute('points', pts);
            line.setAttribute('fill', 'none');
            line.setAttribute('stroke', '#67C8E0');
            line.setAttribute('stroke-width', '1.4');
            line.setAttribute('stroke-linejoin', 'round');
            svg.appendChild(line);
            // highlight the newest point
            const last = vals[vals.length - 1];
            const dot = document.createElementNS(NS, 'circle');
            dot.setAttribute('cx', W); dot.setAttribute('cy', y(last)); dot.setAttribute('r', '2.4');
            dot.setAttribute('fill', last > expected * 3 ? '#E0564E' : '#67C8E0');
            svg.appendChild(dot);
        }
    }

    appendInDevelopmentLabel(topPx = 52) {
        const existing = this.container.querySelectorAll('.dna-dev-label');
        existing.forEach((node) => node.remove());

        const devLabel = document.createElement('div');
        devLabel.className = 'dna-dev-label';
        devLabel.textContent = '(in development)';
        devLabel.style.cssText = `
            position: absolute;
            top: ${topPx}px;
            left: 50%;
            transform: translateX(-50%);
            color: rgba(200, 204, 212, 0.68);
            font-family: 'Share Tech Mono', monospace;
            font-size: 11px;
            letter-spacing: 0.55px;
            z-index: 1001;
            pointer-events: none;
            text-transform: lowercase;
        `;
        this.container.appendChild(devLabel);
        return devLabel;
    }

    animate() {
        if (!this.isActive || !this.isAnimating) {
            this.isAnimating = false;
            this.lastFrameTime = null; // Reset when stopping
            return;
        }
        
        this.animationId = requestAnimationFrame(() => this.animate());
        
        // Use delta time for smooth rotation (frame-rate independent)
        if (!this.lastFrameTime) {
            this.lastFrameTime = performance.now();
        }
        const currentTime = performance.now();
        const deltaTime = (currentTime - this.lastFrameTime) / 1000; // Convert to seconds
        this.lastFrameTime = currentTime;
        
        // Rotate helix - smooth, frame-rate independent rotation
        const rotationSpeed = 0.5; // radians per second
        if (!this.timelineBranchMode) {
            if (this.helixLeft) {
                this.helixLeft.rotation.y += rotationSpeed * deltaTime;
            }
            if (this.helixRight) {
                this.helixRight.rotation.y -= rotationSpeed * deltaTime;
            }
        }
        
        // Animate mutations (pulsing effect) - smooth animation
        this.mutations.forEach(mutationGroup => {
            mutationGroup.children.forEach(child => {
                if (child.userData && child.userData.isMutation) {
                    const time = currentTime * 0.001; // Use currentTime for consistency
                    const scale = 1 + Math.sin(time * 2) * 0.2; // Slower, smoother pulse
                    child.scale.set(scale, scale, scale);
                }
            });
        });

        // Animate SIEM attack orbits: rings spin (gyroscope), the line gently
        // breathes, and the focused/hovered orbit brightens.
        if (this.siemScars && this.siemScars.length) {
            const now = currentTime * 0.001;
            this.siemScars.forEach(rec => {
                if (rec.group) rec.group.rotation.z += rec.spin * deltaTime;
                const focused = (rec.focusUntil && currentTime < rec.focusUntil)
                    || (this.hoveredScarId && (this.hoveredScarId === rec.key || this.scarById[this.hoveredScarId] === rec));
                if (rec.ring) {
                    if (rec.decor) {
                        // faint ambient arcs: breathe around their staggered depth level
                        const b = rec.baseOpacity != null ? rec.baseOpacity : 0.11;
                        rec.ring.material.opacity = b + Math.sin(now * 0.8 + rec.phase) * 0.03;
                    } else {
                        // real orbits: brightness scales with severity, loud ones pulse
                        let base = 0.60 + rec.rank * 0.07;          // low..crit -> ~.67/.74/.81/.88
                        if (rec.rank >= 3) base += Math.sin(now * 3 + rec.phase) * 0.12;
                        else base += Math.sin(now * 1.4 + rec.phase) * 0.08;
                        rec.ring.material.opacity = focused ? 1 : Math.max(0.4, Math.min(1, base));
                    }
                }
                if (rec.clusters && rec.clusters.length) {
                    const co = focused ? 1 : 0.82 + Math.sin(now * 1.2 + rec.phase) * 0.1;
                    rec.clusters.forEach(cl => {
                        if (currentTime > cl.nextUpdate) {
                            this._drawCluster(cl, currentTime);
                            cl.nextUpdate = currentTime + 300 + Math.random() * 260;
                        }
                        cl.sprite.material.opacity = co;
                    });
                }
            });
        }
        
        // Rotate camera around helix - smooth camera movement
        // In timeline mode, camera looks from side to see growth
        if (this.timelineBranchMode) {
            this.camera.position.set(0, 0.5, 16);
            this.camera.lookAt(0, 0, 0);
        } else if (this.timelineMode) {
            // Side view for timeline (better to see growth along Y axis)
            this.camera.position.set(10, 5, 0);
            this.camera.lookAt(0, 0, 0);
        } else {
            // Smooth camera rotation
            const cameraSpeed = 0.2; // radians per second
            this.cameraAngle += cameraSpeed * deltaTime;
            this.camera.position.x = Math.cos(this.cameraAngle) * 15;
            this.camera.position.z = Math.sin(this.cameraAngle) * 15;
            this.camera.position.y = 5;
            this.camera.lookAt(0, 0, 0);
        }

        this.updatePinnedTimelineLabels();
        this.renderer.render(this.scene, this.camera);
    }

    clear() {
        this.clearPinnedTimelineLabels();

        // Properly dispose of geometries and materials to prevent memory leaks
        const disposeObject = (obj) => {
            if (obj.geometry) {
                obj.geometry.dispose();
            }
            if (obj.material) {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(mat => mat.dispose());
                } else {
                    obj.material.dispose();
                }
            }
            if (obj.children) {
                obj.children.forEach(child => disposeObject(child));
            }
        };
        
        // Dispose all objects before removing
        this.scene.children.forEach(child => {
            disposeObject(child);
        });
        
        // Remove all objects from scene
        while (this.scene.children.length > 0) {
            this.scene.remove(this.scene.children[0]);
        }
        
        // Clear arrays
        this.nucleotides = [];
        this.genes = [];
        this.mutations = [];
        this.mutationAnimations = [];
        // Scars live under helixLeft and were disposed above; drop stale refs.
        this.siemScars = [];
        this.scarById = {};
        this.siemLayer = null;
        this.helixLeft = null;
        this.helixRight = null;
        
        // Hide tooltip when clearing
        if (this.tooltip) {
            this.tooltip.style.display = 'none';
        }
        
        // Remove labels (but keep exit button)
        const labels = this.container.querySelectorAll('.dna-title, .dna-timeline-subtitle, .dna-legend, .dna-dev-label, .dna-timeline-info, .dna-process-selector, .dna-window-selector');
        labels.forEach(label => label.remove());
    }

    async activate() {
        debugLog('🧬 Activating Kernel DNA Visualization');
        debugLog('🔍 Container exists:', !!this.container);
        debugLog('🔍 Container element:', this.container);
        
        this.isActive = true;
        this._ensureUxStyles();
        
        // Ensure container exists and is visible
        if (!this.container) {
            console.error('❌ Container not found, reinitializing...');
            this.init();
        }
        
        if (this.container) {
            debugLog('✅ Setting container display to block');
            this.container.style.display = 'block';
            this.container.style.zIndex = '9999';
            this.container.style.opacity = '0';
            this.container.style.transform = 'translateY(14px)';
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    if (!this.container || !this.isActive) return;
                    this.container.style.opacity = '1';
                    this.container.style.transform = 'translateY(0)';
                });
            });
            debugLog('✅ Container display:', this.container.style.display);
            debugLog('✅ Container z-index:', this.container.style.zIndex);
            const computed = window.getComputedStyle(this.container);
            debugLog('✅ Container computed display:', computed.display);
            debugLog('✅ Container computed z-index:', computed.zIndex);
            debugLog('✅ Container in DOM:', document.body.contains(this.container));
        } else {
            console.error('❌ Container still not found after init!');
            return;
        }
        
        // Initial render
        debugLog('🎯 Starting initial render...');
        try {
            await this.render();
            debugLog('✅ Initial render completed');
        } catch (error) {
            console.error('❌ Error during initial render:', error);
        }
        
        // Auto-update only timeline data. Full Kernel DNA rebuild recreates UI controls
        // and interrupts typing in the process selector.
        this.updateInterval = setInterval(() => {
            if (this.isActive && !this.isUpdating) {
                if (!this.timelineMode) return;
                if (this.isProcessSelectorActive()) return;
                this.isUpdating = true;
                // Use requestAnimationFrame to sync update with rendering
                requestAnimationFrame(async () => {
                    try {
                        await this.renderTimeline();
                    } catch (error) {
                        console.error('❌ Error during update:', error);
                    } finally {
                        this.isUpdating = false;
                    }
                });
            }
        }, 5000); // Increased from 2 to 5 seconds
    }

    deactivate() {
        debugLog('🧬 Deactivating Kernel DNA Visualization');
        this.isActive = false;
        this.isAnimating = false; // Stop animation loop
        this.timelineMode = false; // Reset timeline mode
        this.timelineBranchMode = false;
        this.selectedPid = null;
        this.timeStart = null;
        this.currentTimelineHeight = 0;
        
        // Stop all mutation animations
        this.mutationAnimations.forEach(animId => {
            cancelAnimationFrame(animId);
        });
        this.mutationAnimations = [];
        
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }

        if (this.driftInterval) {
            clearInterval(this.driftInterval);
            this.driftInterval = null;
        }
        const driftPanel = this.container && this.container.querySelector('.dna-drift-indicator');
        if (driftPanel && driftPanel.parentNode) driftPanel.parentNode.removeChild(driftPanel);

        if (this.siemInterval) {
            clearInterval(this.siemInterval);
            this.siemInterval = null;
        }
        const threatPanel = this.container && this.container.querySelector('.dna-threat-feed');
        if (threatPanel && threatPanel.parentNode) threatPanel.parentNode.removeChild(threatPanel);
        this.siemScars = [];
        this.scarById = {};
        this.hoveredScarId = null;
        
        // Explicitly remove exit button before hiding container
        if (this.exitButton && this.exitButton.parentNode) {
            this.exitButton.parentNode.removeChild(this.exitButton);
            this.exitButton = null;
        }
        
        // Also remove by class name (in case reference is lost)
        const exitButtons = document.querySelectorAll('.kernel-dna-exit-button');
        exitButtons.forEach(btn => {
            if (btn.parentNode) {
                btn.parentNode.removeChild(btn);
            }
        });
        
        const finalizeHide = () => {
            this._hideLoadingOverlayImmediate();
            if (this.container) {
                this.container.style.display = 'none';
                this.container.style.pointerEvents = '';
                this.container.style.opacity = '';
                this.container.style.transform = '';
            }
            this.clear();
        };

        if (this.container && this.container.style.display !== 'none') {
            this.container.style.pointerEvents = 'none';
            let finalized = false;
            const runFinalize = () => {
                if (finalized) return;
                finalized = true;
                window.clearTimeout(fallbackTimer);
                if (this.container) {
                    this.container.removeEventListener('transitionend', onEnd);
                }
                finalizeHide();
            };
            const onEnd = (e) => {
                if (e && e.propertyName && e.propertyName !== 'opacity' && e.propertyName !== 'transform') return;
                runFinalize();
            };
            this.container.addEventListener('transitionend', onEnd);
            this.container.style.opacity = '0';
            this.container.style.transform = 'translateY(12px)';
            const fallbackTimer = window.setTimeout(runFinalize, 480);
        } else {
            finalizeHide();
        }
    }

    onWindowResize() {
        if (!this.camera || !this.renderer) return;
        
        const width = window.innerWidth;
        const height = window.innerHeight;
        
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    onMouseMove(event) {
        if (!this.isActive || !this.raycaster || !this.tooltip) return;
        
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        // Collect all interactive objects (nucleotides, genes, mutations, rungs, helix strands)
        const allInteractiveObjects = [];
        
        // Add nucleotides
        if (this.nucleotides && this.nucleotides.length > 0) {
            allInteractiveObjects.push(...this.nucleotides);
        }
        
        // Add genes
        if (this.genes && this.genes.length > 0) {
            this.genes.forEach(gene => {
                if (gene.children) {
                    allInteractiveObjects.push(...gene.children);
                }
                allInteractiveObjects.push(gene);
            });
        }
        
        // Add mutations
        if (this.mutations && this.mutations.length > 0) {
            this.mutations.forEach(mutation => {
                if (mutation.children) {
                    allInteractiveObjects.push(...mutation.children);
                }
                allInteractiveObjects.push(mutation);
            });
        }

        // Add SIEM attack orbits (invisible torus carries the tooltip payload)
        if (this.siemScars && this.siemScars.length > 0) {
            this.siemScars.forEach(rec => {
                if (rec.hit) allInteractiveObjects.push(rec.hit);
            });
        }
        
        // Add helix strands (for timeline markers, etc.)
        if (this.helixLeft && this.helixLeft.children) {
            this.helixLeft.children.forEach(child => {
                if (child.userData && (child.userData.isTimelineMarker || child.userData.isNucleotide)) {
                    allInteractiveObjects.push(child);
                }
            });
        }
        if (this.helixRight && this.helixRight.children) {
            this.helixRight.children.forEach(child => {
                if (child.userData && (child.userData.isTimelineMarker || child.userData.isNucleotide)) {
                    allInteractiveObjects.push(child);
                }
            });
        }
        
        // Hide previous hover effects
        if (this.hoveredNucleotide && this.hoveredNucleotide.userData && this.hoveredNucleotide.userData.ring) {
            this.hoveredNucleotide.userData.ring.visible = false;
        }
        this.hoveredNucleotide = null;
        
        // Check intersections with all objects
        const intersects = this.raycaster.intersectObjects(allInteractiveObjects, true);
        
        if (intersects.length > 0) {
            // Find the first object with userData
            let targetObject = null;
            for (let i = 0; i < intersects.length; i++) {
                const obj = intersects[i].object;
                // Traverse up the parent chain to find object with userData
                let current = obj;
                while (current) {
                    if (current.userData && (current.userData.name || current.userData.code || current.userData.event || current.userData.isNucleotide || current.userData.isSiemScar || current.userData.isSiemRing || current.userData.mutationType)) {
                        targetObject = current;
                        break;
                    }
                    current = current.parent;
                }
                if (targetObject) break;
            }
            
            if (targetObject && targetObject.userData) {
                const userData = targetObject.userData;
                
                // Show yellow ring on hover for nucleotides
                if (userData.isNucleotide && targetObject.userData.ring) {
                    targetObject.userData.ring.visible = true;
                    this.hoveredNucleotide = targetObject;
                }
                
                // Show tooltip
                this.tooltip.style.display = 'block';
                this.tooltip.style.left = (event.clientX + 10) + 'px';
                this.tooltip.style.top = (event.clientY - 10) + 'px';
                
                // Format tooltip content based on object type
                let tooltipContent = '';
                this.hoveredScarId = null; // re-set below only when a scar is hovered
                
                // Check if this is a timeline event
                if (userData.event && userData.timestamp) {
                    tooltipContent = this.buildEventTooltipHtml(userData);
                } else if (userData.code && userData.type) {
                    // Regular nucleotide - yellow accent on hover
                    const subsystem = userData.subsystem || 'kernel';
                    const filePath = this.getFilePathForNucleotide(userData.type, userData.name);
                    tooltipContent = `
                        <div style="font-weight: bold; color: #E6C15A; margin-bottom: 4px;">
                            ${userData.code} - ${userData.type.toUpperCase()}
                        </div>
                        <div style="margin-bottom: 2px; color: #D0D3D6;">${userData.name || 'Nucleotide'}</div>
                        <div style="color: #6B7076; font-size: 10px;">Subsystem: ${subsystem}/</div>
                        ${filePath ? `<div style="color: #6B7076; font-size: 10px;">${filePath}</div>` : ''}
                        ${userData.count ? `<div style="color: #8A8F95; font-size: 10px;">Count: ${userData.count}</div>` : ''}
                    `;
                } else if (userData.geneName) {
                    // Gene segment - yellow accent when active
                    tooltipContent = `
                        <div style="font-weight: bold; color: #E6C15A; margin-bottom: 4px;">
                            GENE: ${userData.geneName}
                        </div>
                        <div style="color: #6B7076; font-size: 10px;">Subsystem: ${userData.subsystem || 'kernel'}</div>
                    `;
                } else if (userData.isSiemRing && userData.siemGroup) {
                    // Attack orbit = one MITRE tactic. Summary; per-alert detail in feed.
                    const g = userData.siemGroup;
                    const acc = this._accentForRank(g.maxRank);
                    this.hoveredScarId = g.tactic || 'unmapped';
                    const feedPanel = this.container.querySelector('.dna-threat-feed');
                    if (feedPanel) feedPanel.querySelectorAll('.dna-threat-row.active').forEach(r => r.classList.remove('active'));
                    const sevParts = ['critical', 'high', 'medium', 'low']
                        .filter(k => g.sev[k]).map(k => `${g.sev[k]} ${k}`).join(' · ');
                    const tech = g.topTechnique ? `<div style="color:#8A8F95;font-size:10px;">technique: ${g.topTechnique}</div>` : '';
                    tooltipContent = `
                        <div style="font-weight:bold;color:${acc.hex};margin-bottom:4px;">⦿ ${(g.tactic || 'UNMAPPED').toUpperCase()}</div>
                        <div style="margin-bottom:2px;color:#D0D3D6;">${g.count} attack${g.count > 1 ? 's' : ''} on this orbit</div>
                        <div style="color:#8A8F95;font-size:10px;">${sevParts || '—'}</div>
                        ${tech}
                        <div style="color:#6B7076;font-size:10px;margin-top:3px;">e.g. ${g.topRule || 'web attack'}</div>
                        <div style="color:#6B7076;font-size:9px;margin-top:5px;opacity:0.7;">Elastic SIEM · see feed for detail</div>
                    `;
                } else if (userData.mutationSource === 'siem' && userData.siem) {
                    // Real Elastic SIEM detection alert (attack "scar").
                    const a = userData.siem;
                    const headColor = this._sevColorHex(a.severity);
                    const sev = String(a.severity || 'medium').toUpperCase();
                    this.hoveredScarId = a.id;
                    const feedPanel = this.container.querySelector('.dna-threat-feed');
                    if (feedPanel) {
                        feedPanel.querySelectorAll('.dna-threat-row.active').forEach(r => r.classList.remove('active'));
                        const r = feedPanel.querySelector(`.dna-threat-row[data-id="${(a.id || '').replace(/"/g, '')}"]`);
                        if (r) r.classList.add('active');
                    }
                    const tactic = a.tactic ? `<div style="color:#8A8F95;font-size:10px;">ATT&CK: ${a.tactic}${a.technique ? ' · ' + a.technique : ''}</div>` : '';
                    const req = (a.method || a.url_path)
                        ? `<div style="color:#6B7076;font-size:10px;margin-top:4px;word-break:break-all;">${a.method || ''} ${a.url_path || ''}</div>` : '';
                    const q = a.url_query
                        ? `<div style="color:#e6c15a;font-size:10px;word-break:break-all;">?${a.url_query}</div>` : '';
                    const rel = this._relTime(a.time);
                    tooltipContent = `
                        <div style="font-weight:bold;color:${headColor};margin-bottom:4px;">⚠ ATTACK — ${sev}</div>
                        <div style="margin-bottom:2px;color:#D0D3D6;">${a.rule || 'web attack'}</div>
                        <div style="color:#8A8F95;font-size:10px;">src ${a.source_ip || '—'}${rel ? ' · ' + rel : ''}</div>
                        ${tactic}${req}${q}
                        <div style="color:#6B7076;font-size:9px;margin-top:5px;opacity:0.7;">Elastic SIEM detection</div>
                    `;
                } else if (userData.mutationType) {
                    // Mutation - source-coloured header (ML cyan, rule yellow).
                    const isML = userData.mutationSource === 'ml';
                    const atk = userData.mutationAttack || null;
                    const headColor = (atk && atk.color) ? atk.color : (isML ? '#67C8E0' : '#E6C15A');
                    const sourceLabel = isML ? 'ML detector' : 'Threshold rule';
                    const sev = String(userData.mutationSeverity || 'medium').toUpperCase();
                    const scoreLine = (userData.mutationScore != null)
                        ? `<div style="color: #8A8F95; font-size: 10px;">score: ${userData.mutationScore}</div>`
                        : '';
                    const attackLine = atk
                        ? `<div style="color:#8A8F95;font-size:10px;margin-top:4px;">ATT&amp;CK: ${atk.mitre || '?'}${atk.family ? ' · ' + atk.family : ''}${atk.label_confidence != null ? ' · conf ' + atk.label_confidence : ''}</div>
                           <div style="color:#6B7076;font-size:9px;">${atk.why || atk.name || ''}${atk.source ? ' [' + atk.source + ']' : ''}</div>
                           ${(atk.cve && atk.cve.length) ? `<div style="color:#e6c15a;font-size:9px;">CVE: ${atk.cve.join(', ')}</div>` : ''}`
                        : '';
                    tooltipContent = `
                        <div style="font-weight: bold; color: ${headColor}; margin-bottom: 4px;">
                            MUTATION: ${userData.mutationType}
                        </div>
                        <div style="margin-bottom: 2px; color: #D0D3D6;">${userData.description || 'Anomaly detected'}</div>
                        ${attackLine}
                        <div style="color: #6B7076; font-size: 10px; margin-top: 4px;">Source: ${sourceLabel}</div>
                        <div style="color: #6B7076; font-size: 10px;">Severity: ${sev}</div>
                        ${scoreLine}
                    `;
                } else {
                    // Generic tooltip
                    tooltipContent = `
                        <div style="font-weight: bold; color: #E6C15A; margin-bottom: 4px;">
                            ${userData.name || 'Object'}
                        </div>
                    `;
                }
                
                window.setSafeHtml(this.tooltip, tooltipContent);
            } else {
                // Hide tooltip if no valid userData found
                this.tooltip.style.display = 'none';
            }
        } else {
            // Hide tooltip and hover effects
            this.tooltip.style.display = 'none';
            if (this.hoveredNucleotide && this.hoveredNucleotide.userData && this.hoveredNucleotide.userData.ring) {
                this.hoveredNucleotide.userData.ring.visible = false;
            }
            this.hoveredNucleotide = null;
            this.hoveredScarId = null;
        }
    }

    getFilePathForNucleotide(type, name) {
        // Map nucleotide types to kernel source files
        const fileMap = {
            'syscall': {
                'read': 'fs/read_write.c',
                'write': 'fs/read_write.c',
                'open': 'fs/open.c',
                'close': 'fs/open.c',
                'socket': 'net/socket.c',
                'connect': 'net/socket.c',
                'mmap': 'mm/mmap.c',
                'clone': 'kernel/fork.c',
                'execve': 'fs/exec.c'
            },
            'interrupt': {
                'timer': 'kernel/time/timer.c',
                'keyboard': 'drivers/input/keyboard/',
                'network': 'net/core/dev.c'
            },
            'context_switch': {
                'context_switch': 'kernel/sched/core.c'
            },
            'lock': {
                'mutex/lock': 'kernel/locking/mutex.c'
            }
        };
        
        if (fileMap[type] && fileMap[type][name]) {
            return fileMap[type][name];
        }
        
        // Generic mappings
        if (type === 'syscall') {
            return 'kernel/sys.c';
        } else if (type === 'interrupt') {
            return 'kernel/irq/';
        }
        
        return null;
    }
}

// Make it globally available
// Export to window for global access
window.KernelDNAVisualization = KernelDNAVisualization;
debugLog('🧬 kernel-dna.js: KernelDNAVisualization class exported to window');
debugLog('🧬 kernel-dna.js: window.KernelDNAVisualization:', typeof window.KernelDNAVisualization);
