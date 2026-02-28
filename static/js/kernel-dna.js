// Kernel DNA Visualization - Double Helix Structure
// Represents Linux kernel execution paths as DNA strands
// Version: 19

debugLog('🧬 kernel-dna.js v19: Script loading...');
debugLog('🧬 kernel-dna.js v19: THREE available:', typeof THREE);
debugLog('🧬 kernel-dna.js v19: Browser:', navigator.userAgent);

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
        this.timelineData = []; // Process timeline events
        this.selectedPid = null; // Selected process PID for timeline
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
            // Reset currentView in kernelContextMenu before deactivating
            if (window.kernelContextMenu) {
                window.kernelContextMenu.currentView = null;
            }
            this.deactivate();
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
        
        // Mutation: "broken" appearance - distorted/irregular shape with yellow assessment marker
        // Use octahedron for "broken" geometric look instead of perfect sphere
        const geometry = new THREE.OctahedronGeometry(0.25, 0); // Irregular shape
        const material = new THREE.MeshBasicMaterial({
            color: this.colors.mutedText, // Muted text: #6B7076 - "broken" gray
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
        
        // Yellow assessment marker - small sphere
        const markerGeometry = new THREE.SphereGeometry(0.08, 8, 8);
        const markerMaterial = new THREE.MeshBasicMaterial({
            color: this.colors.signalYellow, // Signal yellow: #E6C15A
            side: THREE.DoubleSide
        });
        const yellowMarker = new THREE.Mesh(markerGeometry, markerMaterial);
        yellowMarker.position.copy(point);
        yellowMarker.position.y += 0.3; // Position above mutation
        
        // Store reference for cleanup and animation
        mutation.userData.isMutation = true;
        mutation.userData.mutationType = mutationData.type || 'anomaly';
        mutation.userData.description = mutationData.description || 'Anomaly detected';
        
        group.add(mutation);
        group.add(yellowMarker);
        return group;
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
        
        // Load data
        const data = await this.loadData();
        if (!data) return;
        
        // Create helix strands
        const leftHelix = this.createHelixStrand(true);
        const rightHelix = this.createHelixStrand(false);
        this.helixLeft = leftHelix.group;
        this.helixRight = rightHelix.group;
        
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
        
        // Add labels
        this.addLabels(data);
        
        // Start animation only if not already animating
        if (!this.isAnimating) {
            this.isAnimating = true;
            this.animate();
        }
    }

    async renderTimeline() {
        if (!this.selectedPid) {
            // Show process selector if no PID selected
            this.clear();
            this.addTimelineLabels(null);
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

        // Load timeline data
        try {
            const response = await fetch(`/api/proc-timeline?pid=${this.selectedPid}`);
            const data = await response.json();
            
            if (data.error) {
                console.error('❌ Timeline error:', data.error);
                return;
            }

            this.timelineData = data.timeline || [];
            
            // Set start time from first event
            if (this.timelineData.length > 0 && !this.timeStart) {
                this.timeStart = new Date(this.timelineData[0].timestamp).getTime();
            }

            // Calculate current timeline height based on time elapsed
            const now = Date.now();
            const elapsed = this.timeStart ? (now - this.timeStart) / 1000 : 0; // seconds
            this.currentTimelineHeight = Math.min(elapsed * 0.5, this.maxTimelineHeight); // Grow 0.5 units per second

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
            const eventToNucleotide = {
                'exec': { code: 'A', type: 'syscall' },
                'fork': { code: 'A', type: 'syscall' },
                'mmap': { code: 'A', type: 'syscall' },
                'read': { code: 'A', type: 'syscall' },
                'write': { code: 'A', type: 'syscall' },
                'connect': { code: 'A', type: 'syscall' },
                'accept': { code: 'A', type: 'syscall' },
                'exit': { code: 'C', type: 'context_switch' }
            };

            // Position events on helix based on timestamp
            this.timelineEvents = [];
            this.timelineData.forEach((event, i) => {
                const eventTime = new Date(event.timestamp).getTime();
                const timeProgress = this.timeStart ? (eventTime - this.timeStart) / (now - this.timeStart) : i / this.timelineData.length;
                const t = Math.min(timeProgress, 1.0); // Clamp to 0-1

                // Only show events that have occurred (within current timeline height)
                if (t <= this.currentTimelineHeight / this.maxTimelineHeight) {
                    const nucleotideData = eventToNucleotide[event.type] || { code: 'A', type: 'syscall' };
                    
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
            this.addTimelineLabels(data);

            // Start animation
            if (!this.isAnimating) {
                this.isAnimating = true;
                this.animate();
            }
        } catch (error) {
            console.error('❌ Error rendering timeline:', error);
        }
    }

    mapEventToSubsystem(eventType) {
        const subsystemMap = {
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

    addTimelineLabels(data) {
        // Remove old labels
        const oldLabels = this.container.querySelectorAll('.dna-title, .dna-legend, .dna-timeline-info, .dna-process-selector');
        oldLabels.forEach(label => label.remove());

        // Add title
        const titleDiv = document.createElement('div');
        titleDiv.className = 'dna-title';
        titleDiv.textContent = 'KERNEL DNA TIMELINE';
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

        // Add process selector
        this.addProcessSelector();

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
                <div style="margin-bottom: 5px;">Timeline: ${heightPercent}%</div>
                <div style="margin-top: 10px; font-size: 10px; color: #888;">
                    <div>Time → Y axis (growing upward)</div>
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
    }

    async addProcessSelector() {
        // Create process selector panel
        const selectorDiv = document.createElement('div');
        selectorDiv.className = 'dna-process-selector';
        selectorDiv.style.cssText = `
            position: absolute;
            top: 80px;
            right: 20px;
            width: 300px;
            max-height: 500px;
            background: rgba(12, 18, 28, 0.95);
            border: 1px solid rgba(160, 170, 190, 0.35);
            border-radius: 4px;
            padding: 15px;
            z-index: 1001;
            overflow-y: auto;
            font-family: 'Share Tech Mono', monospace;
        `;

        // Add header
        const header = document.createElement('div');
        header.textContent = 'SELECT PROCESS';
        header.style.cssText = `
            color: #c8ccd4;
            font-size: 12px;
            font-weight: bold;
            margin-bottom: 10px;
            padding-bottom: 8px;
            border-bottom: 1px solid rgba(160, 170, 190, 0.2);
        `;
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
                    procItem.onclick = () => {
                        this.selectedPid = proc.pid;
                        this.timeStart = null; // Reset timeline
                        this.currentTimelineHeight = 0;
                        this.renderTimeline();
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

    addLabels(data) {
        // Remove old labels first
        const oldLabels = this.container.querySelectorAll('.dna-title, .dna-legend');
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
            </div>
        `);
        legendDiv.style.cssText = `
            position: absolute;
            top: 20px;
            left: 20px;
            z-index: 1001;
        `;
        this.container.appendChild(legendDiv);
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
        if (this.helixLeft) {
            this.helixLeft.rotation.y += rotationSpeed * deltaTime;
        }
        if (this.helixRight) {
            this.helixRight.rotation.y -= rotationSpeed * deltaTime;
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
        
        // Rotate camera around helix - smooth camera movement
        // In timeline mode, camera looks from side to see growth
        if (this.timelineMode) {
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
        
        this.renderer.render(this.scene, this.camera);
    }

    clear() {
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
        this.helixLeft = null;
        this.helixRight = null;
        
        // Hide tooltip when clearing
        if (this.tooltip) {
            this.tooltip.style.display = 'none';
        }
        
        // Remove labels (but keep exit button)
        const labels = this.container.querySelectorAll('.dna-title, .dna-legend, .dna-timeline-info, .dna-process-selector');
        labels.forEach(label => label.remove());
    }

    async activate() {
        debugLog('🧬 Activating Kernel DNA Visualization');
        debugLog('🔍 Container exists:', !!this.container);
        debugLog('🔍 Container element:', this.container);
        
        this.isActive = true;
        
        // Ensure container exists and is visible
        if (!this.container) {
            console.error('❌ Container not found, reinitializing...');
            this.init();
        }
        
        if (this.container) {
            debugLog('✅ Setting container display to block');
            this.container.style.display = 'block';
            this.container.style.zIndex = '9999';
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
        
        // Auto-update every 5 seconds (less frequent to reduce jitter)
        this.updateInterval = setInterval(() => {
            if (this.isActive && !this.isUpdating) {
                this.isUpdating = true;
                // Use requestAnimationFrame to sync update with rendering
                requestAnimationFrame(async () => {
                    try {
                        if (this.timelineMode) {
                            await this.renderTimeline();
                        } else {
                            await this.render();
                        }
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
        
        if (this.container) {
            this.container.style.display = 'none';
        }
        
        this.clear();
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
                    if (current.userData && (current.userData.name || current.userData.code || current.userData.event || current.userData.isNucleotide)) {
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
                
                // Check if this is a timeline event
                if (userData.event && userData.timestamp) {
                    const subsystem = userData.subsystem || 'kernel';
                    const eventType = userData.event.type || 'event';
                    tooltipContent = `
                        <div style="font-weight: bold; color: #E6C15A; margin-bottom: 4px;">
                            ${eventType.toUpperCase()}
                        </div>
                        <div style="margin-bottom: 2px; color: #D0D3D6;">${userData.event.name || 'Event'}</div>
                        <div style="color: #6B7076; font-size: 10px;">Subsystem: ${subsystem}</div>
                        <div style="color: #8A8F95; font-size: 10px; margin-top: 4px;">
                            Time: ${new Date(userData.timestamp).toLocaleTimeString()}
                        </div>
                    `;
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
                } else if (userData.mutationType) {
                    // Mutation - yellow assessment, not red
                    tooltipContent = `
                        <div style="font-weight: bold; color: #E6C15A; margin-bottom: 4px;">
                            MUTATION: ${userData.mutationType}
                        </div>
                        <div style="margin-bottom: 2px; color: #D0D3D6;">${userData.description || 'Anomaly detected'}</div>
                        <div style="color: #6B7076; font-size: 10px; margin-top: 4px;">Assessment: Anomaly</div>
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
