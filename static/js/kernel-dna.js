// Kernel DNA Visualization - Double Helix Structure
// Represents Linux kernel execution paths as DNA strands

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
        
        // Nucleotide colors and shapes
        this.nucleotideConfig = {
            'A': { color: 0x58b6d8, type: 'syscall', shape: 'sphere' },      // Cyan - syscall
            'T': { color: 0xff6b9d, type: 'interrupt', shape: 'box' },        // Pink - interrupt
            'C': { color: 0x6bcf7f, type: 'context_switch', shape: 'cone' },  // Green - context switch
            'G': { color: 0xffa94d, type: 'lock', shape: 'octahedron' }       // Orange - lock
        };
        
        // Gene colors
        this.geneColors = {
            'sched': 0x58b6d8,
            'net': 0x4a9eff,
            'fs': 0x6bcf7f,
            'mm': 0xffa94d,
            'drivers': 0xff6b9d,
            'kernel': 0xc8ccd4
        };
    }

    init(containerId = 'kernel-dna-container') {
        console.log('🧬 Initializing Kernel DNA Visualization');
        
        // Create container
        const container = document.getElementById(containerId);
        if (!container) {
            // Create container if it doesn't exist
            this.container = document.createElement('div');
            this.container.id = containerId;
            this.container.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(5, 8, 12, 0.95);
                z-index: 1000;
                display: none;
            `;
            document.body.appendChild(this.container);
        } else {
            this.container = container;
        }
        
        // Scene setup
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x05080c);
        
        // Camera
        const width = window.innerWidth;
        const height = window.innerHeight;
        this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
        this.camera.position.set(0, 5, 15);
        this.camera.lookAt(0, 0, 0);
        
        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.container.appendChild(this.renderer.domElement);
        
        // Raycaster for mouse interaction
        this.raycaster = new THREE.Raycaster();
        
        // Create tooltip element
        this.tooltip = document.createElement('div');
        this.tooltip.style.cssText = `
            position: absolute;
            background: rgba(12, 18, 28, 0.95);
            border: 1px solid rgba(160, 170, 190, 0.35);
            color: #c8ccd4;
            font-family: 'Share Tech Mono', monospace;
            font-size: 11px;
            padding: 8px 12px;
            pointer-events: none;
            z-index: 1002;
            display: none;
            border-radius: 4px;
        `;
        this.container.appendChild(this.tooltip);
        
        // Mouse move handler for tooltips
        this.renderer.domElement.addEventListener('mousemove', (event) => this.onMouseMove(event));
        
        // Lighting
        const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
        this.scene.add(ambientLight);
        
        const directionalLight1 = new THREE.DirectionalLight(0x58b6d8, 0.8);
        directionalLight1.position.set(5, 10, 5);
        this.scene.add(directionalLight1);
        
        const directionalLight2 = new THREE.DirectionalLight(0x4a9eff, 0.6);
        directionalLight2.position.set(-5, -10, -5);
        this.scene.add(directionalLight2);
        
        // Add exit button
        this.addExitButton();
        
        // Handle window resize
        window.addEventListener('resize', () => this.onWindowResize());
        
        console.log('✅ Kernel DNA Visualization initialized');
    }

    addExitButton() {
        const exitBtn = document.createElement('button');
        exitBtn.textContent = 'EXIT VIEW';
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
        exitBtn.onclick = () => this.deactivate();
        this.container.appendChild(exitBtn);
    }

    createHelixStrand(isLeft = true, height = null, startY = null) {
        const group = new THREE.Group();
        const helixRadius = 2;
        const helixHeight = height !== null ? height : 20;
        const segments = 200;
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
        
        // Create tube geometry for the strand
        const tubeGeometry = new THREE.TubeGeometry(curve, segments, 0.05, 8, false);
        const material = new THREE.MeshPhongMaterial({
            color: isLeft ? 0x4a9eff : 0x58b6d8,
            emissive: isLeft ? 0x1a3a5a : 0x1a4a6a,
            emissiveIntensity: 0.2,
            transparent: true,
            opacity: 0.7
        });
        
        const tube = new THREE.Mesh(tubeGeometry, material);
        group.add(tube);
        
        return { group, curve };
    }

    createNucleotide(nucleotideData, position, isLeft) {
        const config = this.nucleotideConfig[nucleotideData.code];
        if (!config) return null;
        
        let geometry;
        switch (config.shape) {
            case 'box':
                geometry = new THREE.BoxGeometry(0.3, 0.3, 0.3);
                break;
            case 'cone':
                geometry = new THREE.ConeGeometry(0.15, 0.4, 8);
                break;
            case 'octahedron':
                geometry = new THREE.OctahedronGeometry(0.2);
                break;
            default: // sphere
                geometry = new THREE.SphereGeometry(0.2, 16, 16);
        }
        
        const material = new THREE.MeshPhongMaterial({
            color: config.color,
            emissive: config.color,
            emissiveIntensity: 0.3,
            transparent: true,
            opacity: 0.9
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(position);
        mesh.userData = {
            type: nucleotideData.type,
            code: nucleotideData.code,
            name: nucleotideData.name,
            count: nucleotideData.count,
            subsystem: nucleotideData.subsystem
        };
        
        // Add hover effect
        mesh.onBeforeRender = () => {
            const time = Date.now() * 0.001;
            mesh.rotation.y = time * 0.5;
        };
        
        return mesh;
    }

    createRung(position1, position2, color = 0x58b6d8) {
        const direction = new THREE.Vector3().subVectors(position2, position1);
        const length = direction.length();
        if (length < 0.01) return null; // Skip if too short
        
        const geometry = new THREE.CylinderGeometry(0.02, 0.02, length, 8);
        const material = new THREE.MeshPhongMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: 0.2,
            transparent: true,
            opacity: 0.6
        });
        
        const rung = new THREE.Mesh(geometry, material);
        const midPoint = position1.clone().add(position2).multiplyScalar(0.5);
        rung.position.copy(midPoint);
        
        // Orient cylinder along the direction
        const up = new THREE.Vector3(0, 1, 0);
        rung.lookAt(position2);
        rung.rotateX(Math.PI / 2);
        
        return rung;
    }

    createGeneSegment(geneData, helixCurve) {
        const group = new THREE.Group();
        const startT = geneData.start;
        const endT = geneData.end;
        const segments = 20;
        
        for (let i = 0; i < segments; i++) {
            const t = startT + (endT - startT) * (i / segments);
            const point = helixCurve.getPoint(t);
            
            // Create small marker for gene segment
            const geometry = new THREE.SphereGeometry(0.1, 8, 8);
            const material = new THREE.MeshPhongMaterial({
                color: this.geneColors[geneData.name] || 0xc8ccd4,
                emissive: this.geneColors[geneData.name] || 0xc8ccd4,
                emissiveIntensity: 0.5,
                transparent: true,
                opacity: 0.8
            });
            
            const marker = new THREE.Mesh(geometry, material);
            marker.position.copy(point);
            group.add(marker);
        }
        
        return group;
    }

    createMutation(mutationData, helixCurve) {
        const group = new THREE.Group();
        const t = mutationData.position;
        const point = helixCurve.getPoint(t);
        
        // Create visual distortion
        const geometry = new THREE.SphereGeometry(0.5, 16, 16);
        const material = new THREE.MeshPhongMaterial({
            color: 0xff0000,
            emissive: 0xff0000,
            emissiveIntensity: 0.8,
            transparent: true,
            opacity: 0.6
        });
        
        const mutation = new THREE.Mesh(geometry, material);
        mutation.position.copy(point);
        
        // Store reference for cleanup
        mutation.userData.isMutation = true;
        mutation.userData.geometry = geometry;
        mutation.userData.material = material;
        
        // Pulsing animation - controlled by main animate loop, not separate
        // Animation will be handled in main animate() method
        group.add(mutation);
        return group;
    }

    async loadData() {
        try {
            const response = await fetch('/api/kernel-dna');
            this.data = await response.json();
            console.log('🧬 Kernel DNA data loaded:', this.data);
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
            
            // Create rung (connection between strands)
            const rung = this.createRung(leftPos, rightPos, this.nucleotideConfig[nucleotide.code]?.color || 0x58b6d8);
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
            console.warn('🧬 Timeline mode requires selected PID');
            return;
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

                    // Create rung
                    const rung = this.createRung(leftPos, rightPos, this.nucleotideConfig[nucleotideData.code]?.color || 0x58b6d8);
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
        // Add time markers along the helix
        const markerGroup = new THREE.Group();
        const numMarkers = 10;
        
        for (let i = 0; i <= numMarkers; i++) {
            const t = i / numMarkers;
            const point = curve.getPoint(t);
            
            // Create time marker
            const geometry = new THREE.RingGeometry(0.15, 0.2, 8);
            const material = new THREE.MeshPhongMaterial({
                color: 0xc8ccd4,
                emissive: 0xc8ccd4,
                emissiveIntensity: 0.3,
                transparent: true,
                opacity: 0.6
            });
            
            const marker = new THREE.Mesh(geometry, material);
            marker.position.copy(point);
            marker.rotation.x = Math.PI / 2;
            markerGroup.add(marker);
        }
        
        this.helixLeft.add(markerGroup);
    }

    addTimelineLabels(data) {
        // Remove old labels
        const oldLabels = this.container.querySelectorAll('.dna-title, .dna-legend, .dna-timeline-info');
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

        // Add timeline info
        const infoDiv = document.createElement('div');
        infoDiv.className = 'dna-timeline-info';
        const processName = data.name || 'unknown';
        const eventCount = this.timelineData.length;
        const heightPercent = Math.round((this.currentTimelineHeight / this.maxTimelineHeight) * 100);
        infoDiv.innerHTML = `
            <div style="color: #c8ccd4; font-family: 'Share Tech Mono', monospace; font-size: 11px;">
                <div style="margin-bottom: 5px; color: #58b6d8;">Process: ${processName} (PID: ${this.selectedPid})</div>
                <div style="margin-bottom: 5px;">Events: ${eventCount}</div>
                <div style="margin-bottom: 5px;">Timeline: ${heightPercent}%</div>
                <div style="margin-top: 10px; font-size: 10px; color: #888;">
                    <div>Time → Y axis (growing upward)</div>
                </div>
            </div>
        `;
        infoDiv.style.cssText = `
            position: absolute;
            top: 20px;
            left: 20px;
            z-index: 1001;
        `;
        this.container.appendChild(infoDiv);
    }

    activateTimelineMode(pid) {
        console.log('🧬 Activating Kernel DNA Timeline Mode for PID:', pid);
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
        
        // Add legend
        const legendDiv = document.createElement('div');
        legendDiv.className = 'dna-legend';
        legendDiv.innerHTML = `
            <div style="color: #c8ccd4; font-family: 'Share Tech Mono', monospace; font-size: 12px; margin-top: 60px;">
                <div style="margin-bottom: 5px;">A (Cyan) = Syscall</div>
                <div style="margin-bottom: 5px;">T (Pink) = Interrupt</div>
                <div style="margin-bottom: 5px;">C (Green) = Context Switch</div>
                <div style="margin-bottom: 5px;">G (Orange) = Lock/Mutex</div>
            </div>
        `;
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
            return;
        }
        
        this.animationId = requestAnimationFrame(() => this.animate());
        
        // Rotate helix - use fixed rotation speed, not accumulating
        if (this.helixLeft) {
            this.helixLeft.rotation.y += 0.005;
        }
        if (this.helixRight) {
            this.helixRight.rotation.y -= 0.005;
        }
        
        // Animate mutations (pulsing effect)
        this.mutations.forEach(mutationGroup => {
            mutationGroup.children.forEach(child => {
                if (child.userData && child.userData.isMutation) {
                    const time = Date.now() * 0.003;
                    const scale = 1 + Math.sin(time) * 0.3;
                    child.scale.set(scale, scale, scale);
                }
            });
        });
        
        // Rotate camera around helix - use fixed time, not accumulating
        // In timeline mode, camera looks from side to see growth
        if (this.timelineMode) {
            // Side view for timeline (better to see growth along Y axis)
            this.camera.position.set(10, 0, 0);
            this.camera.lookAt(0, 0, 0);
        } else {
            const time = Date.now() * 0.0005;
            this.camera.position.x = Math.cos(time) * 15;
            this.camera.position.z = Math.sin(time) * 15;
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
        
        // Remove labels (but keep exit button)
        const labels = this.container.querySelectorAll('.dna-title, .dna-legend');
        labels.forEach(label => label.remove());
    }

    async activate() {
        console.log('🧬 Activating Kernel DNA Visualization');
        this.isActive = true;
        
        if (this.container) {
            this.container.style.display = 'block';
        }
        
        // Initial render
        await this.render();
        
        // Auto-update every 2 seconds
        this.updateInterval = setInterval(() => {
            if (this.isActive) {
                if (this.timelineMode) {
                    this.renderTimeline();
                } else {
                    this.render();
                }
            }
        }, 2000);
    }

    deactivate() {
        console.log('🧬 Deactivating Kernel DNA Visualization');
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
        if (!this.isActive || !this.raycaster) return;
        
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        // Check intersections with nucleotides
        const intersects = this.raycaster.intersectObjects(this.nucleotides, true);
        
        if (intersects.length > 0) {
            const nucleotide = intersects[0].object;
            const userData = nucleotide.userData;
            
            if (userData && userData.name) {
                // Show tooltip
                this.tooltip.style.display = 'block';
                this.tooltip.style.left = (event.clientX + 10) + 'px';
                this.tooltip.style.top = (event.clientY - 10) + 'px';
                
                // Format tooltip content
                const subsystem = userData.subsystem || 'kernel';
                const filePath = this.getFilePathForNucleotide(userData.type, userData.name);
                
                // Check if this is a timeline event
                const isTimelineEvent = userData.event && userData.timestamp;
                const eventInfo = isTimelineEvent ? `
                    <div style="color: #58b6d8; font-size: 10px; margin-top: 4px;">
                        Time: ${new Date(userData.timestamp).toLocaleTimeString()}
                    </div>
                ` : '';
                
                this.tooltip.innerHTML = `
                    <div style="font-weight: bold; color: #58b6d8; margin-bottom: 4px;">
                        ${userData.code} - ${userData.type.toUpperCase()}
                    </div>
                    <div style="margin-bottom: 2px;">${userData.name}</div>
                    <div style="color: #888; font-size: 10px;">Subsystem: ${subsystem}/</div>
                    ${filePath ? `<div style="color: #888; font-size: 10px;">${filePath}</div>` : ''}
                    ${userData.count ? `<div style="color: #888; font-size: 10px;">Count: ${userData.count}</div>` : ''}
                    ${eventInfo}
                `;
            }
        } else {
            // Hide tooltip
            this.tooltip.style.display = 'none';
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
window.KernelDNAVisualization = KernelDNAVisualization;
