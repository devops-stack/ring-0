// 3D Visualization of /proc filesystem as a graph inside a coordinate cube
// Integrated into the overall visualization style
class Proc3DVisualization {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.cube = null;
        this.nodes = [];
        this.edges = [];
        this.updateInterval = null;
        this.container = null;
        this.isVisible = false;
        this.cameraAngle = 0;
        this.cameraSpeed = 0.001; // Very slow drift
    }

    init(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.error('Container not found:', containerId);
            return;
        }

        // Compact size - bottom right corner
        const width = 400;
        const height = 400;

        // Create scene - match page background
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xf2f2f2); // Match body background

        // No fog - keep it clean and minimal

        // Isometric camera - less "3D", more schematic
        this.camera = new THREE.OrthographicCamera(
            -150, 150,  // left, right
            150, -150,  // top, bottom
            0.1, 1000   // near, far
        );
        
        // Isometric angle (classic isometric: 30° rotation)
        const angle = Math.PI / 6; // 30 degrees
        this.camera.position.set(200, 200, 200);
        this.camera.lookAt(0, 0, 0);

        // Create renderer - match page style
        this.renderer = new THREE.WebGLRenderer({ 
            antialias: true,
            alpha: false
        });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setClearColor(0xf2f2f2, 1); // Match body background
        this.container.appendChild(this.renderer.domElement);

        // Style the canvas to match overall design
        this.renderer.domElement.style.border = '1px solid rgba(170, 170, 170, 0.3)';
        this.renderer.domElement.style.borderRadius = '4px';
        this.renderer.domElement.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';

        // Create minimal cube wireframe
        this.createCube();

        // Subtle lighting - match overall style
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.3);
        directionalLight.position.set(50, 50, 50);
        this.scene.add(directionalLight);

        // Start animation loop
        this.animate();

        // Load initial data
        this.updateData();
    }

    createCube() {
        // Minimal cube wireframe - match overall line style
        const geometry = new THREE.BoxGeometry(200, 200, 200);
        const edges = new THREE.EdgesGeometry(geometry);
        // Match connection-line style: rgba(60, 60, 60, 0.3), stroke-width: 0.8
        const material = new THREE.LineBasicMaterial({ 
            color: 0x3c3c3c, // #3c3c3c = rgb(60, 60, 60)
            linewidth: 1,
            opacity: 0.3,
            transparent: true
        });
        this.cube = new THREE.LineSegments(edges, material);
        this.scene.add(this.cube);
    }

    updateCameraPosition() {
        // Very slow rotation - subtle movement
        this.cameraAngle += this.cameraSpeed;
        const radius = 250;
        const x = Math.cos(this.cameraAngle) * radius;
        const z = Math.sin(this.cameraAngle) * radius;
        const y = 200 + Math.sin(this.cameraAngle * 0.5) * 30;
        
        this.camera.position.set(x, y, z);
        this.camera.lookAt(0, 0, 0);
    }

    updateData() {
        fetch('/api/proc-graph')
            .then(res => res.json())
            .then(data => {
                if (data.error) {
                    console.error('Error fetching proc graph:', data.error);
                    return;
                }

                console.log('📊 Proc graph data:', data.nodes.length, 'nodes', data.edges.length, 'edges');
                
                this.renderGraph(data.nodes, data.edges);
            })
            .catch(error => {
                console.error('Error fetching proc graph:', error);
            });
    }

    renderGraph(nodes, edges) {
        // Clear existing nodes and edges
        const nodesToRemove = this.nodes.map(n => n.mesh);
        const edgesToRemove = this.edges.map(e => e.line);
        
        nodesToRemove.forEach(mesh => this.scene.remove(mesh));
        edgesToRemove.forEach(line => this.scene.remove(line));
        
        // Dispose geometries and materials
        nodesToRemove.forEach(mesh => {
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) mesh.material.dispose();
        });
        edgesToRemove.forEach(line => {
            if (line.geometry) line.geometry.dispose();
            if (line.material) line.material.dispose();
        });
        
        this.nodes = [];
        this.edges = [];

        // Color palette matching overall style:
        // - Dark grays (#333, #444, #555) for most elements
        // - Subtle accents for kernel
        // - Warm tones for processes (matching process nodes)

        const geometries = {
            kernel: new THREE.SphereGeometry(8, 12, 12),
            process: new THREE.SphereGeometry(3, 10, 10),
            cpu: new THREE.SphereGeometry(3.5, 10, 10),
            memory: new THREE.SphereGeometry(3.5, 10, 10),
            fd: new THREE.SphereGeometry(2, 8, 8),
            irq: new THREE.SphereGeometry(2.5, 8, 8),
            network: new THREE.SphereGeometry(3.5, 10, 10),
            cgroup: new THREE.SphereGeometry(2.5, 8, 8),
            namespace: new THREE.SphereGeometry(2.5, 8, 8),
            default: new THREE.SphereGeometry(2, 8, 8)
        };
        
        const materials = {
            // Kernel - subtle dark accent (like central circle)
            kernel: new THREE.MeshPhongMaterial({ 
                color: 0x333333,  // Match .node-circle fill: #555, stroke: #222
                emissive: 0x111111,
                emissiveIntensity: 0.2
            }),
            // Processes - warm gray (matching process nodes)
            process: new THREE.MeshPhongMaterial({ 
                color: 0x555555,  // Match .node-circle fill
                emissive: 0x333333,
                emissiveIntensity: 0.1
            }),
            // Resources - cool grays
            cpu: new THREE.MeshPhongMaterial({ 
                color: 0x444444,  // Match .socket-text fill
                emissive: 0x222222,
                emissiveIntensity: 0.1
            }),
            memory: new THREE.MeshPhongMaterial({ 
                color: 0x444444,
                emissive: 0x222222,
                emissiveIntensity: 0.1
            }),
            fd: new THREE.MeshPhongMaterial({ 
                color: 0x444444,
                emissive: 0x222222,
                emissiveIntensity: 0.1
            }),
            irq: new THREE.MeshPhongMaterial({ 
                color: 0x444444,
                emissive: 0x222222,
                emissiveIntensity: 0.1
            }),
            network: new THREE.MeshPhongMaterial({ 
                color: 0x444444,
                emissive: 0x222222,
                emissiveIntensity: 0.1
            }),
            cgroup: new THREE.MeshPhongMaterial({ 
                color: 0x444444,
                emissive: 0x222222,
                emissiveIntensity: 0.1
            }),
            namespace: new THREE.MeshPhongMaterial({ 
                color: 0x444444,
                emissive: 0x222222,
                emissiveIntensity: 0.1
            }),
            default: new THREE.MeshPhongMaterial({ 
                color: 0x444444,
                emissive: 0x222222,
                emissiveIntensity: 0.1
            })
        };
        
        nodes.forEach(nodeData => {
            const type = nodeData.type || 'default';
            const geometry = geometries[type] || geometries.default;
            const material = materials[type] || materials.default;
            
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(nodeData.x, nodeData.y, nodeData.z);
            mesh.userData = { label: nodeData.label || nodeData.id };
            
            this.scene.add(mesh);
            this.nodes.push({ mesh, data: nodeData });
        });

        // Create edge lines - match curve-path style
        edges.forEach(edgeData => {
            const fromNode = nodes.find(n => n.id === edgeData.from);
            const toNode = nodes.find(n => n.id === edgeData.to);
            
            if (fromNode && toNode) {
                const geometry = new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(fromNode.x, fromNode.y, fromNode.z),
                    new THREE.Vector3(toNode.x, toNode.y, toNode.z)
                ]);
                
                // Match .curve-path style: stroke: rgba(100, 100, 100, 0.2), stroke-width: 0.7
                const color = 0x646464; // #646464 = rgb(100, 100, 100)
                const opacity = 0.2;
                
                const material = new THREE.LineBasicMaterial({ 
                    color: color, 
                    opacity: opacity, 
                    transparent: true
                });
                const line = new THREE.Line(geometry, material);
                
                this.scene.add(line);
                this.edges.push({ line, data: edgeData });
            }
        });
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        
        if (this.isVisible && this.renderer) {
            // Very slow camera drift
            this.updateCameraPosition();
            
            this.renderer.render(this.scene, this.camera);
        }
    }

    show() {
        if (this.container) {
            this.container.style.display = 'block';
            this.isVisible = true;
            this.updateData(); // Refresh data when shown
        }
    }

    hide() {
        if (this.container) {
            this.container.style.display = 'none';
            this.isVisible = false;
        }
    }

    destroy() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        if (this.renderer) {
            this.renderer.dispose();
        }
        this.nodes = [];
        this.edges = [];
    }
}
