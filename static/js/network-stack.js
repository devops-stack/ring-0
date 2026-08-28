// Network Stack Visualization - vertical packet flow through Linux networking layers
// Version: 11 — Netfilter morph (syntax-safe) + hooks/conntrack/verdict

debugLog('🌐 network-stack.js v18: Script loading...');

class NetworkStackVisualization {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.container = null;
        this.isActive = false;
        this.animationId = null;
        this.lastFrameTime = null;
        this.layers = [];
        this.layerMap = {};
        this.packet = null;
        this.packetGlow = null;
        this.packetTrail = [];
        this.fxBursts = [];
        this.retransmitCooldown = 0;
        this.dropCooldown = 0;
        this.exitButton = null;
        this.overlayNodes = [];
        this.resizeHandler = null;
        this.packetSpeed = 2.2;
        this.dropProbability = 0.2;
        this.retransmitProbability = 0.28;
        this.telemetryInterval = null;
        this.telemetryData = null;
        this.flowNode = null;
        this.layerStatNodes = {};
        this.telemetryErrorNode = null;
        this.layerActivity = {
            userspace: 0.2,
            socket: 0.2,
            tcp: 0.2,
            ip: 0.2,
            netfilter: 0.2,
            driver: 0.2,
            nic: 0.2
        };
        this.layerActivityTarget = { ...this.layerActivity };
        this.layerSemanticNoiseTarget = {
            userspace: { stress: 0.2, jitter: 0.2, branch: 0.2 },
            socket: { stress: 0.2, jitter: 0.2, branch: 0.2 },
            tcp: { stress: 0.2, jitter: 0.2, branch: 0.2 },
            ip: { stress: 0.2, jitter: 0.2, branch: 0.2 },
            netfilter: { stress: 0.2, jitter: 0.2, branch: 0.2 },
            driver: { stress: 0.2, jitter: 0.2, branch: 0.2 },
            nic: { stress: 0.2, jitter: 0.2, branch: 0.2 }
        };
        this.layerSemanticNoise = {
            userspace: { stress: 0.2, jitter: 0.2, branch: 0.2 },
            socket: { stress: 0.2, jitter: 0.2, branch: 0.2 },
            tcp: { stress: 0.2, jitter: 0.2, branch: 0.2 },
            ip: { stress: 0.2, jitter: 0.2, branch: 0.2 },
            netfilter: { stress: 0.2, jitter: 0.2, branch: 0.2 },
            driver: { stress: 0.2, jitter: 0.2, branch: 0.2 },
            nic: { stress: 0.2, jitter: 0.2, branch: 0.2 }
        };
        this.layerBranchSignalTarget = {};
        this.layerBranchSignalCurrent = {};
        this.layerBranchMetricTarget = {};
        this.layerBranchMetricCurrent = {};
        this.layerBranchMetricDelta = {};
        this.layerBranchMetricHistory = {};
        this.branchDeltaWindowMs = 6000;
        this.layerSignalLabels = {
            userspace: ['proc', 'wakeup', 'syscall'],
            socket: ['accept', 'queue', 'retrans'],
            tcp: ['cwnd', 'rtt', 'retrans'],
            ip: ['in/out', 'route', 'ttl'],
            netfilter: ['preroute', 'drop', 'conntrack'],
            driver: ['txq', 'drops', 'irq'],
            nic: ['rx err', 'tx err', 'dma']
        };
        this.lineParticles = [];
        this.microPackets = [];
        this.metricChips = {};
        this.kpiNodes = {};
        this.layersPanelNode = null;
        this.chipLayerNode = null;
        this.viewModeButton = null;
        this.puzzleModeButton = null;
        this.noiseModeButton = null;
        this.readModeButton = null;
        this.viewDensityMode = 'detailed';
        this.puzzleDetailMode = 'overview';
        this.noiseDetailMode = 'dense';
        this.readMode = 'forensics';
        this.galaxyPanelNode = null;
        this.galaxyNodes = {};
        this.galaxyExplainNode = null;
        this.selectedGalaxy = 'state';
        this.galaxyStateData = null;
        this.lifecyclePanelNode = null;
        this.ipMapPinned = false;
        this.ipMorphTarget = null; // { kind:'route'|'neigh'|'flow', ... }
        this.ipMapFrozen = null;   // snapshot while morph/IP drill is being read
        this.tcpMapPinned = false;
        this.tcpMorphTarget = null; // { focus:'flow'|'cwnd'|'rtt'|'cc'|... }
        this.tcpFrozen = null;      // { tcp_udp, bbr, flow }
        this.nfMapPinned = false;
        this.nfMorphTarget = null;  // { focus:'hook'|'ct'|'verdict'|... }
        this.nfFrozen = null;       // { netfilter, flow }
        this.sockMapPinned = false;
        this.sockMorphTarget = null; // { focus:'fd'|'inode'|'sk'|'queue'|... }
        this.sockFrozen = null;      // { socket_api, flow }
        this.flowFollow = null;      // { remote, local, proto, ip, port } from ?remote=
        this._flowFollowApplied = false;
        // Path-distance ray: same plane as layer noise arms, but hops → peer.
        this.pathHopRig = null;
        this.pathHopRemote = null;
        this.pathHopData = null;
        this.pathHopCache = new Map();
        this.pathHopPending = null;
        this.pathHopNode = null;
        this._ghostPending = false;
        this._ghostEl = null;
        this._ghostTimer = null;
        this._ghostFadeTimer = null;
        this.hideOsiTiles = true;
        // Keep the particle swarm and hero packet off — morph stays as panel ribbons.
        this.hideVerticalOrbs = true;
        this.packetMorphEnabled = false;
        this.packetMorphPhase = -1;
        this.packetMorphCtx = null;
        this.packetMorphTag = null;
        this.packetMorphPulse = 0;
        this.packetLifecycleStages = [
            'NIC RX',
            'IRQ',
            'NAPI',
            'SKB',
            'XDP/TC',
            'PREROUTING',
            'CONNTRACK',
            'ROUTING',
            'TCP/UDP',
            'SOCKET',
            'PROCESS'
        ];
        this.txLifecycleStages = [
            'PROCESS',
            'SOCKET',
            'TCP/UDP',
            'ROUTING',
            'CONNTRACK',
            'POSTROUTING',
            'TC EGRESS',
            'NIC TX'
        ];
        this.puzzleCoreNodes = [
            { id: 'hardware', label: 'Hardware', tags: 'NIC/RXTX/DMA/PHY' },
            { id: 'interrupt', label: 'Interrupt', tags: 'hardirq/softirq' },
            { id: 'napi', label: 'NAPI', tags: 'net_rx_action/poll' },
            { id: 'skb', label: 'sk_buff', tags: 'packet+metadata' },
            { id: 'xdp', label: 'XDP', tags: 'AF_XDP/eBPF fast path' },
            { id: 'tc', label: 'TC', tags: 'qdisc/classifier' },
            { id: 'netfilter', label: 'Netfilter', tags: 'PREROUTING..POSTROUTING' },
            { id: 'conntrack', label: 'nf_conntrack', tags: 'NEW/ESTABLISHED' },
            { id: 'routing', label: 'Routing', tags: 'FIB/policy/ECMP' },
            { id: 'ip', label: 'IP', tags: 'IPv4/IPv6/ICMP' },
            { id: 'transport', label: 'TCP/UDP', tags: 'cwnd/rtt/retrans' },
            { id: 'socket', label: 'Socket', tags: 'sock/socket lookup' },
            { id: 'process', label: 'Process', tags: 'epoll/fd/wakeup' }
        ];
        this.puzzleSideNodes = [
            { id: 'l2', label: 'Bridge/VLAN/Neighbor', tags: 'bridge/FDB/ARP/NDP' },
            { id: 'tunnel', label: 'Tunnel', tags: 'VXLAN/GRE/GENEVE/WG' },
            { id: 'namespace', label: 'Namespace', tags: 'netns/veth/CNI' },
            { id: 'cgroup', label: 'cgroups net', tags: 'limits/accounting' },
            { id: 'ebpf', label: 'eBPF', tags: 'XDP/TC/socket/tracing' },
            { id: 'security', label: 'Security', tags: 'SELinux/AppArmor/seccomp' },
            { id: 'crypto', label: 'Crypto', tags: 'TLS/IPsec/WireGuard' },
            { id: 'observability', label: 'Observability', tags: 'tracepoints/perf/netlink' },
            { id: 'userspace', label: 'Userspace Interfaces', tags: 'netlink/sysctl/procfs/sysfs' }
        ];
        this.lifecycleStageToNode = {
            'NIC RX': 'hardware',
            'IRQ': 'interrupt',
            'NAPI': 'napi',
            'SKB': 'skb',
            'XDP/TC': 'xdp',
            'PREROUTING': 'netfilter',
            'CONNTRACK': 'conntrack',
            'ROUTING': 'routing',
            'TCP/UDP': 'transport',
            'SOCKET': 'socket',
            'PROCESS': 'process'
        };
        this.coreToSideLinks = {
            hardware: ['l2', 'observability'],
            interrupt: ['ebpf', 'observability'],
            napi: ['ebpf', 'observability'],
            skb: ['l2', 'tunnel', 'namespace'],
            xdp: ['ebpf', 'security'],
            tc: ['ebpf', 'cgroup', 'security'],
            netfilter: ['security', 'crypto', 'userspace'],
            conntrack: ['security', 'userspace', 'observability'],
            routing: ['namespace', 'tunnel', 'userspace'],
            ip: ['l2', 'tunnel', 'crypto'],
            transport: ['cgroup', 'security', 'observability'],
            socket: ['namespace', 'cgroup', 'userspace'],
            process: ['userspace', 'security', 'observability']
        };
        this.sideClusters = [
            { id: 'data', label: 'Data plane', nodes: ['l2', 'tunnel', 'namespace', 'cgroup'] },
            { id: 'policy', label: 'Policy plane', nodes: ['security', 'crypto', 'ebpf'] },
            { id: 'control', label: 'Control/Insight', nodes: ['observability', 'userspace'] }
        ];
        this.raycaster = null;
        this.mouse = new THREE.Vector2();
        this.mouseMoveHandler = null;
        this.hoveredLayerId = null;
        this.layerTooltipNode = null;
        this.layerMeshes = [];
    }

    init(containerId = 'network-stack-container') {
        const existing = document.getElementById(containerId);
        if (existing) {
            this.container = existing;
        } else {
            this.container = document.createElement('div');
            this.container.id = containerId;
            this.container.style.cssText = `
                position: fixed;
                inset: 0;
                width: 100%;
                height: 100%;
                background: #0E1114;
                z-index: 9999;
                display: none;
                visibility: hidden;
                pointer-events: none;
                overflow: hidden;
            `;
            document.body.appendChild(this.container);
        }

        let webglSupported = false;
        try {
            const canvas = document.createElement('canvas');
            webglSupported = !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
        } catch (e) {
            webglSupported = false;
        }
        if (!webglSupported) {
            alert('WebGL is required for Network Stack view.');
            return false;
        }

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0E1114);

        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 1.2, 13.5);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.container.appendChild(this.renderer.domElement);
        this.raycaster = new THREE.Raycaster();

        const ambient = new THREE.AmbientLight(0xffffff, 0.8);
        const key = new THREE.DirectionalLight(0xffffff, 0.4);
        key.position.set(4, 10, 8);
        this.scene.add(ambient);
        this.scene.add(key);

        this.createLayerStack();
        this.createPacket();
        this.createFlowParticles();
        this.createOverlayUI();
        this.addExitButton();

        this.mouseMoveHandler = (event) => this.onMouseMove(event);
        this.renderer.domElement.addEventListener('mousemove', this.mouseMoveHandler);
        this.clickHandler = (event) => this.onCanvasClick(event);
        this.renderer.domElement.addEventListener('click', this.clickHandler);
        this.keyHandler = (event) => {
            if (event.key !== 'Escape') return;
            if (this.bbrOpen) this.closeBbrOverlay();
            else if (this.drillLayerId) this.closeLayerDrilldown();
        };
        window.addEventListener('keydown', this.keyHandler);

        this.resizeHandler = () => this.onResize();
        window.addEventListener('resize', this.resizeHandler);
        // ResizeObserver catches viewport changes the window 'resize' event can
        // miss (e.g. docking/undocking DevTools), keeping the canvas in sync.
        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => {
                if (this.isActive) this.onResize();
            });
            this.resizeObserver.observe(this.container);
        }

        return true;
    }

    createLayerStack() {
        const layerDefs = [
            { id: 'userspace', label: 'Userspace', y: 3.5, color: 0x78838f },
            { id: 'socket', label: 'Socket API', y: 2.35, color: 0x6f7d8a },
            { id: 'tcp', label: 'TCP/UDP', y: 1.2, color: 0x6d7a88 },
            { id: 'ip', label: 'IP', y: 0.05, color: 0x6a7583 },
            { id: 'netfilter', label: 'Netfilter', y: -1.1, color: 0x68717e },
            { id: 'driver', label: 'Driver', y: -2.25, color: 0x646c78 },
            { id: 'nic', label: 'NIC', y: -3.4, color: 0x606772 }
        ];

        const layerWidth = 8.6;
        const layerDepth = 3.8;
        const layerHeight = 0.16;

        // Reference-style silhouette: peak width in the upper third (socket/tcp),
        // then a gentle taper that stays a "column" — the lower plates remain
        // substantial (no needle/spike at the bottom).
        const towerProfile = [0.96, 1.36, 1.5, 1.34, 1.14, 0.96, 0.82];
        const plateHeight = 0.44;
        const plateFacets = 16;

        layerDefs.forEach((def, i) => {
            const material = new THREE.MeshPhongMaterial({
                color: def.color,
                transparent: true,
                opacity: 0.06,
                shininess: 60,
                emissive: new THREE.Color(0x58b6d8),
                emissiveIntensity: 0.02
            });
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(layerWidth, layerHeight, layerDepth), material);
            mesh.position.set(0, def.y, 0);
            this.scene.add(mesh);

            const edge = new THREE.LineSegments(
                new THREE.EdgesGeometry(new THREE.BoxGeometry(layerWidth, layerHeight, layerDepth)),
                new THREE.LineBasicMaterial({ color: 0x9aa2aa, transparent: true, opacity: 0.22 })
            );
            edge.position.copy(mesh.position);
            this.scene.add(edge);

            // Thin activity strip inside the layer (glow strength from load).
            const strip = new THREE.Mesh(
                new THREE.BoxGeometry(layerWidth * 0.86, 0.02, 0.06),
                new THREE.MeshBasicMaterial({
                    color: 0x58b6d8,
                    transparent: true,
                    opacity: 0.18
                })
            );
            strip.position.set(0, def.y, layerDepth * 0.34);
            this.scene.add(strip);

            const noiseRig = this.createLayerNoiseRig(def, layerDepth);

            // Central stack tower: a faceted plate per layer (the "figure").
            const plateRadius = towerProfile[i] || 0.8;
            const plateGroup = new THREE.Group();
            plateGroup.position.set(0, def.y, 0);

            const plateGeom = new THREE.CylinderGeometry(plateRadius, plateRadius, plateHeight, plateFacets, 1, false);
            const plateFill = new THREE.Mesh(
                plateGeom,
                new THREE.MeshPhongMaterial({
                    color: 0x244154,
                    transparent: true,
                    opacity: 0.22,
                    shininess: 80,
                    emissive: new THREE.Color(0x58b6d8),
                    emissiveIntensity: 0.12
                })
            );
            plateGroup.add(plateFill);

            const plateEdge = new THREE.LineSegments(
                new THREE.EdgesGeometry(plateGeom),
                new THREE.LineBasicMaterial({ color: 0xbfe6f2, transparent: true, opacity: 0.85 })
            );
            plateGroup.add(plateEdge);

            // Inner drum (double-rim turbine detail).
            const innerGeom = new THREE.CylinderGeometry(plateRadius * 0.6, plateRadius * 0.6, plateHeight * 1.18, plateFacets, 1, false);
            const innerEdge = new THREE.LineSegments(
                new THREE.EdgesGeometry(innerGeom),
                new THREE.LineBasicMaterial({ color: 0x6fb6cf, transparent: true, opacity: 0.45 })
            );
            plateGroup.add(innerEdge);

            this.scene.add(plateGroup);

            mesh.userData.layerId = def.id;
            this.layerMeshes.push(mesh);
            this.layers.push({ ...def, mesh, edge, strip, noiseRig, plateGroup, plateFill, plateEdge, plateRadius });
            this.layerMap[def.id] = def.y;

            if (this.hideOsiTiles) {
                mesh.visible = false;
                edge.visible = false;
                strip.visible = false;
            }
        });

        const flowLine = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(0, 3.9, 0),
                new THREE.Vector3(0, -3.9, 0)
            ]),
            new THREE.LineBasicMaterial({ color: 0x58b6d8, transparent: true, opacity: 0.35 })
        );
        this.scene.add(flowLine);

        this.buildTowerFrame(plateHeight, plateFacets);
    }

    // Clean ordered polygon ring (LineLoop) at a given radius/height.
    makeRingLoop(radius, y, facets, color, opacity) {
        const pts = [];
        for (let k = 0; k < facets; k++) {
            const a = (k / facets) * Math.PI * 2;
            pts.push(new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius));
        }
        const loop = new THREE.LineLoop(
            new THREE.BufferGeometry().setFromPoints(pts),
            new THREE.LineBasicMaterial({ color, transparent: true, opacity })
        );
        return loop;
    }

    // Vertical cage struts, intermediate sub-rings, top capsule + bottom tip.
    buildTowerFrame(plateHeight, plateFacets) {
        const STRUT_FACETS = 8;
        const octagon = (radius, y) => {
            const pts = [];
            for (let k = 0; k < STRUT_FACETS; k++) {
                const a = (k / STRUT_FACETS) * Math.PI * 2;
                pts.push(new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius));
            }
            return pts;
        };

        const strutPts = [];
        for (let i = 0; i < this.layers.length - 1; i++) {
            const top = this.layers[i];
            const bottom = this.layers[i + 1];
            const topRing = octagon(top.plateRadius, top.y - plateHeight / 2);
            const botRing = octagon(bottom.plateRadius, bottom.y + plateHeight / 2);
            for (let k = 0; k < STRUT_FACETS; k++) {
                strutPts.push(topRing[k], botRing[k]);
            }

            // Intermediate thin sub-plates densify the stack into the reference's
            // "stacked discs" silhouette (thin filled disc + bright rim + ring).
            for (let s = 1; s <= 2; s++) {
                const t = s / 3;
                const r = top.plateRadius + (bottom.plateRadius - top.plateRadius) * t;
                const y = top.y + (bottom.y - top.y) * t;
                this.scene.add(this.makeRingLoop(r * 1.02, y, plateFacets, 0x7fc4da, 0.3));

                const subGeom = new THREE.CylinderGeometry(r * 0.9, r * 0.9, 0.1, plateFacets, 1, false);
                const subPlate = new THREE.Mesh(
                    subGeom,
                    new THREE.MeshPhongMaterial({
                        color: 0x244154,
                        transparent: true,
                        opacity: 0.16,
                        shininess: 80,
                        emissive: new THREE.Color(0x58b6d8),
                        emissiveIntensity: 0.08
                    })
                );
                subPlate.position.set(0, y, 0);
                this.scene.add(subPlate);

                const subEdge = new THREE.LineSegments(
                    new THREE.EdgesGeometry(subGeom),
                    new THREE.LineBasicMaterial({ color: 0x8fd0e6, transparent: true, opacity: 0.42 })
                );
                subEdge.position.set(0, y, 0);
                this.scene.add(subEdge);
            }
        }
        const struts = new THREE.LineSegments(
            new THREE.BufferGeometry().setFromPoints(strutPts),
            new THREE.LineBasicMaterial({ color: 0x6fb6cf, transparent: true, opacity: 0.32 })
        );
        this.scene.add(struts);
        this.towerStruts = struts;

        const first = this.layers[0];
        const last = this.layers[this.layers.length - 1];

        // Top capsule: stacked decreasing dome rings + a faceted pod tip.
        const capTopY = first.y + plateHeight / 2;
        const podRadii = [first.plateRadius * 0.78, first.plateRadius * 0.6, first.plateRadius * 0.4, first.plateRadius * 0.22];
        podRadii.forEach((r, idx) => {
            this.scene.add(this.makeRingLoop(r, capTopY + 0.28 + idx * 0.26, plateFacets, 0x9fd2e4, 0.6));
        });
        const pod = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.SphereGeometry(first.plateRadius * 0.34, 12, 6)),
            new THREE.LineBasicMaterial({ color: 0xbfe6f2, transparent: true, opacity: 0.6 })
        );
        pod.position.set(0, capTopY + 0.28 + podRadii.length * 0.26 + 0.12, 0);
        this.scene.add(pod);

        // Bottom: a SHORT BLUNT cap (no needle) — a couple of decreasing rings
        // and a small base drum, so the column ends solidly like the reference.
        const botPlateY = last.y - plateHeight / 2;
        [0.86, 0.68, 0.52].forEach((f, idx) => {
            this.scene.add(this.makeRingLoop(last.plateRadius * f, botPlateY - 0.16 - idx * 0.17, plateFacets, 0x9fd2e4, 0.5));
        });
        const baseDrumY = botPlateY - 0.16 - 3 * 0.17;
        const baseDrum = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.CylinderGeometry(last.plateRadius * 0.5, last.plateRadius * 0.4, 0.18, plateFacets, 1, false)),
            new THREE.LineBasicMaterial({ color: 0x9fd2e4, transparent: true, opacity: 0.55 })
        );
        baseDrum.position.set(0, baseDrumY, 0);
        this.scene.add(baseDrum);

        // Central spindle: a thin rod running through the whole stack (visible
        // turbine axis), plus a faint antenna line extending past both caps.
        this.createRodBetween(
            new THREE.Vector3(0, first.y + plateHeight / 2 + 0.15, 0),
            new THREE.Vector3(0, baseDrumY - 0.1, 0),
            0.03, 0x67c8e0, 0.55
        );
        const axis = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(0, pod.position.y + 0.5, 0),
                new THREE.Vector3(0, baseDrumY - 0.55, 0)
            ]),
            new THREE.LineBasicMaterial({ color: 0x67c8e0, transparent: true, opacity: 0.45 })
        );
        this.scene.add(axis);
    }

    createRodBetween(start, end, radius = 0.018, color = 0x8d97a3, opacity = 0.32) {
        const dir = new THREE.Vector3().subVectors(end, start);
        const len = dir.length();
        if (len <= 0.001) return null;
        const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
        const geom = new THREE.CylinderGeometry(radius, radius, len, 8, 1, false);
        const mat = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity
        });
        const rod = new THREE.Mesh(geom, mat);
        rod.position.copy(midpoint);
        rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
        this.scene.add(rod);
        return rod;
    }

    createSignalTagSprite(initialText = 'sig --') {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        canvas.width = 292;
        canvas.height = 76;
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
            depthWrite: false
        });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(1.2, 0.29, 1);
        sprite.renderOrder = 2;
        const tag = { sprite, canvas, ctx, texture, lastText: '', lastIntensity: -1 };
        this.updateSignalTagSprite(tag, initialText, 0.2, 0.0);
        this.scene.add(sprite);
        return tag;
    }

    updateSignalTagSprite(tag, text, intensity = 0.2, jitter = 0) {
        if (!tag || !tag.ctx || !tag.canvas) return;
        const safeText = String(text || 'sig --');
        const safeIntensity = Math.max(0, Math.min(1, Number(intensity) || 0));
        const safeJitter = Math.max(0, Math.min(1, Number(jitter) || 0));
        const changed = Math.abs(safeIntensity - (tag.lastIntensity ?? -1)) > 0.04 || safeText !== tag.lastText;
        if (!changed) return;

        const ctx = tag.ctx;
        const w = tag.canvas.width;
        const h = tag.canvas.height;
        ctx.clearRect(0, 0, w, h);

        const bgAlpha = 0.46 + safeIntensity * 0.34;
        const strokeAlpha = 0.5 + safeIntensity * 0.44;
        ctx.fillStyle = `rgba(8, 13, 20, ${bgAlpha})`;
        ctx.strokeStyle = `rgba(176, 228, 255, ${strokeAlpha})`;
        ctx.lineWidth = 1.35;
        if (typeof ctx.roundRect === 'function') {
            ctx.beginPath();
            ctx.roundRect(0.5, 0.5, w - 1, h - 1, 6);
            ctx.fill();
            ctx.stroke();
        } else {
            ctx.fillRect(0, 0, w, h);
            ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
        }

        const lines = safeText.split('\n').slice(0, 2);
        ctx.font = '14px "Share Tech Mono", monospace';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = `rgba(228, 246, 255, ${0.9 + safeIntensity * 0.1})`;
        ctx.strokeStyle = `rgba(12, 18, 26, ${0.75 + safeIntensity * 0.2})`;
        ctx.lineWidth = 2.6;
        ctx.shadowColor = `rgba(120, 210, 255, ${0.2 + safeIntensity * 0.4})`;
        ctx.shadowBlur = 6;
        if (lines.length === 1) {
            ctx.strokeText(lines[0], 14, h / 2);
            ctx.fillText(lines[0], 14, h / 2);
        } else {
            ctx.strokeText(lines[0], 14, h * 0.35);
            ctx.fillText(lines[0], 14, h * 0.35);
            ctx.strokeText(lines[1], 14, h * 0.74);
            ctx.fillText(lines[1], 14, h * 0.74);
        }
        ctx.shadowBlur = 0;

        if (safeJitter > 0.02) {
            const speckCount = Math.floor(4 + safeJitter * 11);
            for (let i = 0; i < speckCount; i++) {
                const x = Math.random() * w;
                const y = Math.random() * h;
                const a = 0.05 + Math.random() * 0.14 * safeJitter;
                ctx.fillStyle = `rgba(230, 193, 90, ${a})`;
                ctx.fillRect(x, y, 1, 1);
            }
        }

        tag.texture.needsUpdate = true;
        tag.lastText = safeText;
        tag.lastIntensity = safeIntensity;
    }

    formatBranchMetric(layerId, signalIdx, value, deltaValue = null, withDelta = false) {
        const v = Number(value);
        const safe = Number.isFinite(v) ? v : 0;
        const dRaw = Number(deltaValue);
        const hasDelta = Number.isFinite(dRaw);
        const d = hasDelta ? dRaw : 0;
        const dSign = d > 0 ? '+' : '';
        if (layerId === 'userspace') {
            if (signalIdx === 0) return withDelta && hasDelta ? `proc ${Math.round(safe)}\nΔ ${dSign}${Math.round(d)}` : `proc ${Math.round(safe)}`;
            if (signalIdx === 1) return withDelta && hasDelta ? `wake ${Math.round(safe)}%\nΔ ${dSign}${Math.round(d)}%` : `wake ${Math.round(safe)}%`;
            return withDelta && hasDelta ? `sys ${Math.round(safe)}/s\nΔ ${dSign}${Math.round(d)}/s` : `sys ${Math.round(safe)}/s`;
        }
        if (layerId === 'socket') {
            if (signalIdx === 0) return withDelta && hasDelta ? `est ${Math.round(safe)}\nΔ ${dSign}${Math.round(d)}` : `est ${Math.round(safe)}`;
            if (signalIdx === 1) return withDelta && hasDelta ? `q ${Math.round(safe)}\nΔ ${dSign}${Math.round(d)}` : `q ${Math.round(safe)}`;
            return withDelta && hasDelta ? `rtx ${safe.toFixed(1)}/s\nΔ ${dSign}${d.toFixed(1)}/s` : `rtx ${safe.toFixed(1)}/s`;
        }
        if (layerId === 'tcp') {
            if (signalIdx === 0) return withDelta && hasDelta ? `cwnd ${Math.round(safe)}\nΔ ${dSign}${Math.round(d)}` : `cwnd ${Math.round(safe)}`;
            if (signalIdx === 1) return withDelta && hasDelta ? `rtt ${safe.toFixed(1)}ms\nΔ ${dSign}${d.toFixed(1)}ms` : `rtt ${safe.toFixed(1)}ms`;
            return withDelta && hasDelta ? `rtx ${safe.toFixed(1)}/s\nΔ ${dSign}${d.toFixed(1)}/s` : `rtx ${safe.toFixed(1)}/s`;
        }
        if (layerId === 'ip') {
            if (signalIdx === 0) return withDelta && hasDelta ? `in ${safe.toFixed(1)}/s\nΔ ${dSign}${d.toFixed(1)}/s` : `in ${safe.toFixed(1)}/s`;
            if (signalIdx === 1) return withDelta && hasDelta ? `out ${safe.toFixed(1)}/s\nΔ ${dSign}${d.toFixed(1)}/s` : `out ${safe.toFixed(1)}/s`;
            return withDelta && hasDelta ? `asym ${(safe * 100).toFixed(0)}%\nΔ ${dSign}${(d * 100).toFixed(0)}%` : `asym ${(safe * 100).toFixed(0)}%`;
        }
        if (layerId === 'netfilter') {
            if (signalIdx === 0) return withDelta && hasDelta ? `drop ${(safe * 100).toFixed(1)}%\nΔ ${dSign}${(d * 100).toFixed(1)}%` : `drop ${(safe * 100).toFixed(1)}%`;
            if (signalIdx === 1) return withDelta && hasDelta ? `drop ${safe.toFixed(1)}/s\nΔ ${dSign}${d.toFixed(1)}/s` : `drop ${safe.toFixed(1)}/s`;
            return withDelta && hasDelta ? `ct ${Math.round(safe)}%\nΔ ${dSign}${Math.round(d)}%` : `ct ${Math.round(safe)}%`;
        }
        if (layerId === 'driver') {
            if (signalIdx === 0) return withDelta && hasDelta ? `txq ${Math.round(safe)}\nΔ ${dSign}${Math.round(d)}` : `txq ${Math.round(safe)}`;
            if (signalIdx === 1) return withDelta && hasDelta ? `drop ${safe.toFixed(1)}/s\nΔ ${dSign}${d.toFixed(1)}/s` : `drop ${safe.toFixed(1)}/s`;
            return withDelta && hasDelta ? `irq ${Math.round(safe)}\nΔ ${dSign}${Math.round(d)}` : `irq ${Math.round(safe)}`;
        }
        if (layerId === 'nic') {
            if (signalIdx === 0) return withDelta && hasDelta ? `rx err ${Math.round(safe)}\nΔ ${dSign}${Math.round(d)}` : `rx err ${Math.round(safe)}`;
            if (signalIdx === 1) return withDelta && hasDelta ? `tx err ${Math.round(safe)}\nΔ ${dSign}${Math.round(d)}` : `tx err ${Math.round(safe)}`;
            return withDelta && hasDelta ? `dma ${Math.round(safe)}%\nΔ ${dSign}${Math.round(d)}%` : `dma ${Math.round(safe)}%`;
        }
        return `${Math.round(safe)}`;
    }

    updateBranchMetricHistory(tsMs) {
        const now = Number(tsMs) || Date.now();
        const windowMs = Math.max(1000, Number(this.branchDeltaWindowMs) || 6000);
        const cutoff = now - windowMs;
        const nextDelta = {};
        Object.entries(this.layerBranchMetricTarget || {}).forEach(([layerId, values]) => {
            if (!Array.isArray(values)) return;
            const history = this.layerBranchMetricHistory[layerId] || [];
            history.push({ ts: now, values: values.slice() });
            while (history.length > 0 && history[0].ts < cutoff) {
                history.shift();
            }
            this.layerBranchMetricHistory[layerId] = history;
            const baseline = history[0]?.values || values;
            const delta = values.map((v, idx) => (Number(v) || 0) - (Number(baseline[idx]) || 0));
            nextDelta[layerId] = delta;
        });
        this.layerBranchMetricDelta = nextDelta;
    }

    createLayerNoiseRig(def, layerDepth) {
        const controlHeavy = new Set(['userspace', 'socket', 'tcp', 'ip']);
        const hardwareHeavy = new Set(['driver', 'nic']);
        const isControl = controlHeavy.has(def.id);
        const isHardware = hardwareHeavy.has(def.id);
        const profile = {
            type: isControl ? 'control' : (isHardware ? 'hardware' : 'mixed'),
            hubRadius: isControl ? 0.088 : (isHardware ? 0.122 : 0.104),
            ringRadius: isControl ? 0.21 : (isHardware ? 0.17 : 0.19),
            armCount: isControl ? 6 : (isHardware ? 3 : 4),
            armRadius: isControl ? 0.013 : (isHardware ? 0.022 : 0.017),
            armOpacity: isControl ? 0.24 : (isHardware ? 0.38 : 0.3),
            branchMin: isControl ? 2 : (isHardware ? 1 : 2),
            branchMax: isControl ? 4 : (isHardware ? 2 : 3),
            branchRadius: isControl ? 0.009 : (isHardware ? 0.015 : 0.011),
            ringRotateSpeed: isControl ? 0.25 : (isHardware ? 0.07 : 0.14),
            pulseAmp: isControl ? 0.11 : (isHardware ? 0.06 : 0.08),
            xSpread: isControl ? 2.7 : (isHardware ? 1.95 : 2.3)
        };

        const hubXOffset = isControl
            ? ((def.id === 'userspace' || def.id === 'tcp') ? -0.16 : 0.16)
            : (isHardware ? ((def.id === 'nic') ? 0.2 : -0.2) : 0);
        const hubPos = new THREE.Vector3(hubXOffset, def.y, -0.08);
        const hub = new THREE.Mesh(
            new THREE.SphereGeometry(profile.hubRadius, 14, 14),
            new THREE.MeshBasicMaterial({
                color: 0xa8b2bd,
                transparent: true,
                opacity: isHardware ? 0.48 : 0.4
            })
        );
        hub.position.copy(hubPos);
        this.scene.add(hub);

        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(profile.ringRadius, isHardware ? 0.014 : 0.012, 8, 22),
            new THREE.MeshBasicMaterial({
                color: 0x657383,
                transparent: true,
                opacity: isControl ? 0.22 : 0.3
            })
        );
        ring.position.copy(hubPos);
        ring.rotation.x = Math.PI / 2;
        this.scene.add(ring);

        const arms = [];
        const supportRods = [];
        const satellites = [];
        const armCount = profile.armCount;
        for (let i = 0; i < armCount; i++) {
            const side = i % 2 === 0 ? -1 : 1;
            const lane = Math.floor(i / 2);
            const x = hubXOffset + side * (1.1 + lane * (isControl ? 0.64 : 0.82) + Math.random() * profile.xSpread * 0.16);
            const z = (Math.random() - 0.5) * (layerDepth * 0.72);
            const end = new THREE.Vector3(x, def.y + (Math.random() - 0.5) * (isControl ? 0.14 : 0.06), z);
            const armRod = this.createRodBetween(hubPos, end, profile.armRadius, 0x7d8a97, profile.armOpacity);
            const armEntry = {
                rod: armRod,
                start: hubPos.clone(),
                end: end.clone(),
                phase: Math.random(),
                signal: 0.2,
                beads: [],
                signalIdx: i,
                signalLabel: '',
                signalTag: null,
                signalTagOffset: new THREE.Vector3(
                    (Math.random() - 0.5) * 0.16,
                    0.08 + Math.random() * 0.07,
                    (Math.random() - 0.5) * 0.16
                )
            };

            const satellite = new THREE.Mesh(
                new THREE.SphereGeometry(
                    (isControl ? 0.058 : 0.078) + Math.random() * (isControl ? 0.016 : 0.024),
                    10,
                    10
                ),
                new THREE.MeshBasicMaterial({
                    color: 0xb5bdc6,
                    transparent: true,
                    opacity: isControl ? 0.3 : 0.4
                })
            );
            satellite.position.copy(end);
            this.scene.add(satellite);
            satellites.push(satellite);

            const beadCount = isControl ? 4 : 3;
            for (let b = 0; b < beadCount; b++) {
                const bead = new THREE.Mesh(
                    new THREE.SphereGeometry(0.016 + Math.random() * 0.008, 8, 8),
                    new THREE.MeshBasicMaterial({
                        color: 0x95b8cf,
                        transparent: true,
                        opacity: 0.26
                    })
                );
                bead.position.copy(hubPos.clone().lerp(end, (b + 1) / (beadCount + 1)));
                this.scene.add(bead);
                armEntry.beads.push(bead);
            }
            const labels = this.layerSignalLabels[def.id] || ['sig'];
            armEntry.signalIdx = i % Math.max(1, labels.length);
            armEntry.signalLabel = labels[armEntry.signalIdx] || `sig${armEntry.signalIdx}`;
            armEntry.signalTag = this.createSignalTagSprite(`${armEntry.signalLabel} --`);
            if (armEntry.signalTag?.sprite) {
                const tagPos = hubPos.clone().lerp(end, 0.56).add(armEntry.signalTagOffset);
                armEntry.signalTag.sprite.position.copy(tagPos);
            }
            arms.push(armEntry);

            const miniCount = profile.branchMin + Math.floor(Math.random() * (profile.branchMax - profile.branchMin + 1));
            for (let j = 0; j < miniCount; j++) {
                const miniEnd = end.clone().add(new THREE.Vector3(
                    side * (0.24 + Math.random() * (isControl ? 0.56 : 0.38)),
                    (Math.random() - 0.5) * (isControl ? 0.18 : 0.08),
                    (Math.random() - 0.5) * (isControl ? 0.72 : 0.42)
                ));
                const miniRod = this.createRodBetween(
                    end,
                    miniEnd,
                    profile.branchRadius,
                    0x74808d,
                    isControl ? 0.2 : 0.26
                );
                if (miniRod) {
                    supportRods.push(miniRod);
                }
                const miniDot = new THREE.Mesh(
                    new THREE.SphereGeometry((isControl ? 0.022 : 0.03) + Math.random() * 0.01, 8, 8),
                    new THREE.MeshBasicMaterial({
                        color: 0x90a0b0,
                        transparent: true,
                        opacity: isControl ? 0.2 : 0.28
                    })
                );
                miniDot.position.copy(miniEnd);
                this.scene.add(miniDot);
                satellites.push(miniDot);
            }
        }

        return { hub, ring, arms, supportRods, satellites, profile };
    }

    disposeSceneObject(obj) {
        if (!obj) return;
        this.scene.remove(obj);
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
            if (obj.material.map) obj.material.map.dispose();
            obj.material.dispose();
        }
    }

    disposePathHopRig() {
        const rig = this.pathHopRig;
        if (!rig) return;
        this.disposeSceneObject(rig.hub);
        this.disposeSceneObject(rig.ring);
        this.disposeSceneObject(rig.arm);
        this.disposeSceneObject(rig.tip);
        (rig.beads || []).forEach((b) => this.disposeSceneObject(b));
        (rig.segments || []).forEach((s) => this.disposeSceneObject(s));
        (rig.tags || []).forEach((tag) => {
            if (tag?.sprite) this.disposeSceneObject(tag.sprite);
        });
        this.pathHopRig = null;
    }

    getActivePeerIp() {
        if (this.flowFollow?.ip) return String(this.flowFollow.ip).trim();
        const remote = this.telemetryData?.flow?.remote;
        const { ip } = this.parseEndpoint(remote);
        return String(ip || '').trim();
    }

    syncPathHopDistance() {
        if (!this.scene) return;
        const peerIp = this.getActivePeerIp();
        if (!peerIp || peerIp === '0.0.0.0' || peerIp === '::' || peerIp === 'N/A') {
            this.disposePathHopRig();
            this.pathHopRemote = null;
            this.pathHopData = null;
            this.updatePathHopHud(null);
            return;
        }
        if (this.pathHopRemote === peerIp && this.pathHopRig) {
            this.updatePathHopHud(this.pathHopData);
            return;
        }
        if (this.pathHopPending === peerIp && this.pathHopRig) return;

        this.pathHopRemote = peerIp;
        this.pathHopPending = peerIp;
        this.updatePathHopHud({ remote_ip: peerIp, hop_count: null, status: 'probe' });

        this.rebuildPathHopRig({
            remote_ip: peerIp,
            hop_count: 0,
            hops: [],
            reached: false,
            note: 'probing path…',
            status: 'probe'
        });

        const cached = this.pathHopCache.get(peerIp);
        const fetchPromise = cached
            ? Promise.resolve(cached)
            : window.fetchJson(`/api/traceroute?ip=${encodeURIComponent(peerIp)}`, { cache: 'no-store' }, {
                timeoutMs: 9000,
                suppressToast: true,
                context: 'network-stack-path-hops'
            }).then((payload) => {
                if (payload && Array.isArray(payload.hops)) {
                    this.pathHopCache.set(peerIp, payload);
                }
                return payload;
            }).catch((err) => ({
                remote_ip: peerIp,
                tool: null,
                reached: false,
                hop_count: 0,
                hops: [],
                note: `path unavailable: ${err.message || err}`,
                status: 'error'
            }));

        fetchPromise.then((payload) => {
            if (this.pathHopRemote !== peerIp) return;
            this.pathHopPending = null;
            this.pathHopData = payload || { remote_ip: peerIp, hops: [], hop_count: 0 };
            this.rebuildPathHopRig(this.pathHopData);
            this.updatePathHopHud(this.pathHopData);
        });
    }

    rebuildPathHopRig(trace) {
        if (!this.scene) return;
        this.disposePathHopRig();

        const peerIp = String(trace?.remote_ip || this.pathHopRemote || '').trim();
        const hops = Array.isArray(trace?.hops) ? trace.hops.filter((h) => h && h.target != null) : [];
        const hopCount = hops.length || Number(trace?.hop_count) || 0;
        const probing = trace?.status === 'probe' || (hopCount === 0 && !trace?.note);
        const errored = Boolean(trace?.note) && hopCount === 0 && !probing;

        // Same horizontal plane language as layer noise arms (IP = routing plane).
        const ipY = this.layerMap?.ip ?? 0.05;
        const hubPos = new THREE.Vector3(0.14, ipY, -0.08);
        const visualHops = Math.max(1, Math.min(12, hopCount || (probing || errored ? 3 : 1)));
        const armLen = 1.55 + visualHops * 0.42;
        const end = new THREE.Vector3(
            hubPos.x + armLen,
            ipY + 0.02,
            hubPos.z + 0.35
        );

        // High-contrast red so the path ray reads against the cyan tower noise.
        const pathRed = 0xe0564e;
        const pathRedHot = 0xff6a5c;
        const pathRedDim = 0xa04038;

        const hub = new THREE.Mesh(
            new THREE.SphereGeometry(0.09, 14, 14),
            new THREE.MeshBasicMaterial({
                color: pathRedHot,
                transparent: true,
                opacity: 0.92
            })
        );
        hub.position.copy(hubPos);
        this.scene.add(hub);

        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(0.2, 0.016, 8, 28),
            new THREE.MeshBasicMaterial({
                color: pathRed,
                transparent: true,
                opacity: 0.75
            })
        );
        ring.position.copy(hubPos);
        ring.rotation.x = Math.PI / 2;
        this.scene.add(ring);

        const arm = this.createRodBetween(hubPos, end, 0.028, pathRed, probing ? 0.55 : 0.88);

        const tip = new THREE.Mesh(
            new THREE.SphereGeometry(0.11, 12, 12),
            new THREE.MeshBasicMaterial({
                color: errored ? 0xff3030 : (probing ? pathRedDim : pathRedHot),
                transparent: true,
                opacity: 0.95
            })
        );
        tip.position.copy(end);
        this.scene.add(tip);

        const beads = [];
        const segments = [];
        const tags = [];
        const hopNodes = hops.length
            ? hops
            : Array.from({ length: visualHops }, (_, i) => ({
                hop: i + 1,
                target: probing ? '…' : (errored ? '?' : peerIp),
                rtt_ms: null,
                provisional: true
            }));

        hopNodes.forEach((hop, idx) => {
            const t = (idx + 1) / (hopNodes.length + 1);
            const pos = hubPos.clone().lerp(end, t);
            const unknown = hop.target === '*' || hop.target === '?' || hop.target === '…';
            const bead = new THREE.Mesh(
                new THREE.SphereGeometry(unknown ? 0.036 : 0.052, 10, 10),
                new THREE.MeshBasicMaterial({
                    color: unknown ? pathRedDim : pathRedHot,
                    transparent: true,
                    opacity: unknown ? 0.45 : 0.95
                })
            );
            bead.position.copy(pos);
            bead.userData = { hop, t };
            this.scene.add(bead);
            beads.push(bead);

            // Tiny lateral stub — same "ray with point" grammar as layer noise.
            const stubEnd = pos.clone().add(new THREE.Vector3(
                0.08 + (idx % 2) * 0.06,
                (idx % 2 === 0 ? 0.12 : -0.1),
                (idx % 2 === 0 ? 0.22 : -0.18)
            ));
            const stub = this.createRodBetween(pos, stubEnd, 0.01, pathRed, 0.55);
            if (stub) segments.push(stub);
            const stubDot = new THREE.Mesh(
                new THREE.SphereGeometry(0.028, 8, 8),
                new THREE.MeshBasicMaterial({
                    color: pathRed,
                    transparent: true,
                    opacity: 0.7
                })
            );
            stubDot.position.copy(stubEnd);
            this.scene.add(stubDot);
            beads.push(stubDot);

            const showTag = !hop.provisional && (idx === 0 || idx === hopNodes.length - 1 || hopNodes.length <= 5);
            if (showTag) {
                const rtt = hop.rtt_ms != null ? `${Number(hop.rtt_ms).toFixed(1)}ms` : '—';
                const tag = this.createSignalTagSprite(`h${hop.hop} ${hop.target}\n${rtt}`);
                if (tag?.sprite) {
                    tag.sprite.position.copy(pos.clone().add(new THREE.Vector3(0.05, 0.16, 0.05)));
                    tag.sprite.scale.set(1.05, 0.26, 1);
                    tags.push(tag);
                }
            }
        });

        const tipLabel = probing
            ? `path → ${peerIp}\nprobing…`
            : (errored
                ? `path → ${peerIp}\n${String(trace?.note || 'unavailable').slice(0, 28)}`
                : `peer ${peerIp}\n${hopCount} hop${hopCount === 1 ? '' : 's'}`);
        const tipTag = this.createSignalTagSprite(tipLabel);
        if (tipTag?.sprite) {
            tipTag.sprite.position.copy(end.clone().add(new THREE.Vector3(0.12, 0.22, 0.08)));
            tipTag.sprite.scale.set(1.25, 0.3, 1);
            tags.push(tipTag);
        }

        this.pathHopRig = {
            hub,
            ring,
            arm,
            tip,
            beads,
            segments,
            tags,
            hubPos: hubPos.clone(),
            end: end.clone(),
            hopCount,
            peerIp,
            probing,
            errored,
            phase: 0
        };
    }

    updatePathHopHud(trace) {
        if (!this.pathHopNode) return;
        const { value, card, label } = this.pathHopNode;
        card.style.borderColor = 'rgba(224, 86, 78, 0.85)';
        card.style.boxShadow = '0 0 14px rgba(224, 86, 78, 0.28)';
        if (label) label.style.color = '#e0564e';
        if (value) value.style.color = '#ff8a7a';
        if (!trace) {
            value.textContent = '—';
            return;
        }
        const hops = Number(trace.hop_count ?? (Array.isArray(trace.hops) ? trace.hops.length : 0));
        if (trace.status === 'probe' || hops == null || Number.isNaN(hops)) {
            value.textContent = 'probe…';
            return;
        }
        if (trace.note && hops === 0) {
            value.textContent = 'n/a';
            return;
        }
        const reached = trace.reached ? '✓' : '~';
        value.textContent = `${hops} hops ${reached}`;
    }

    updatePathHopRig(dt) {
        const rig = this.pathHopRig;
        if (!rig) return;
        rig.phase += dt;
        if (rig.ring) rig.ring.rotation.z += dt * 0.45;
        if (rig.hub?.material) {
            rig.hub.material.opacity = 0.78 + 0.18 * Math.sin(rig.phase * 2.8);
        }
        if (rig.tip?.material) {
            rig.tip.material.opacity = 0.82 + 0.16 * Math.sin(rig.phase * 3.4);
            const s = 1 + 0.12 * Math.sin(rig.phase * 2.4);
            rig.tip.scale.setScalar(s);
        }
        if (rig.arm?.material) {
            rig.arm.material.opacity = rig.probing
                ? 0.45 + 0.25 * (0.5 + 0.5 * Math.sin(rig.phase * 4.2))
                : 0.75 + 0.15 * (0.5 + 0.5 * Math.sin(rig.phase * 1.8));
            rig.arm.material.color?.setHex?.(0xe0564e);
        }
        (rig.beads || []).forEach((bead, idx) => {
            if (!bead?.material) return;
            const pulse = 0.5 + 0.5 * Math.sin(rig.phase * 3.0 + idx * 0.55);
            bead.material.opacity = 0.55 + pulse * 0.4;
        });
    }

    createFlowParticles() {
        // Thin particles flowing along the vertical spine.
        for (let i = 0; i < 36; i++) {
            const p = new THREE.Mesh(
                new THREE.SphereGeometry(0.03 + Math.random() * 0.015, 8, 8),
                new THREE.MeshBasicMaterial({
                    color: 0x58b6d8,
                    transparent: true,
                    opacity: 0.25 + Math.random() * 0.25
                })
            );
            p.position.set((Math.random() - 0.5) * 0.18, -3.9 + Math.random() * 7.8, (Math.random() - 0.5) * 0.12);
            p.userData = {
                dir: Math.random() < 0.68 ? -1 : 1, // bidirectional, mostly downwards
                speed: 0.9 + Math.random() * 2.4,
                drift: (Math.random() - 0.5) * 0.1
            };
            this.scene.add(p);
            this.lineParticles.push(p);
            if (this.hideVerticalOrbs) {
                p.visible = false;
            }
        }

        // Micro-packets falling through layers (plus occasional upward control packets).
        for (let i = 0; i < 20; i++) {
            const dir = Math.random() < 0.8 ? -1 : 1;
            const m = new THREE.Mesh(
                new THREE.SphereGeometry(0.055, 10, 10),
                new THREE.MeshBasicMaterial({
                    color: dir < 0 ? 0xE6C15A : 0x58b6d8,
                    transparent: true,
                    opacity: 0.55
                })
            );
            m.position.set((Math.random() - 0.5) * 2.0, dir < 0 ? (3.7 + Math.random() * 1.2) : (-3.7 - Math.random() * 1.2), (Math.random() - 0.5) * 0.3);
            m.userData = {
                dir,
                speed: 0.9 + Math.random() * 1.8,
                xDrift: (Math.random() - 0.5) * 0.35
            };
            this.scene.add(m);
            this.microPackets.push(m);
            if (this.hideVerticalOrbs) {
                m.visible = false;
            }
        }
    }

    createPacket() {
        const packetMat = new THREE.MeshBasicMaterial({ color: 0xE6C15A });
        this.packet = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 16), packetMat);
        this.packet.position.set(0, this.layerMap.userspace + 0.5, 0);
        this.scene.add(this.packet);

        const glowMat = new THREE.MeshBasicMaterial({ color: 0xE6C15A, transparent: true, opacity: 0.25 });
        this.packetGlow = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 16), glowMat);
        this.packetGlow.position.copy(this.packet.position);
        this.scene.add(this.packetGlow);

        for (let i = 0; i < 6; i++) {
            const trailMat = new THREE.MeshBasicMaterial({
                color: 0xE6C15A,
                transparent: true,
                opacity: 0.12 - i * 0.015
            });
            const trail = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 10), trailMat);
            trail.position.copy(this.packet.position);
            this.scene.add(trail);
            this.packetTrail.push(trail);
        }
        if (this.hideVerticalOrbs && !this.packetMorphEnabled) {
            this.packet.visible = false;
            this.packetGlow.visible = false;
            this.packetTrail.forEach((trail) => {
                if (trail) trail.visible = false;
            });
        } else if (this.packetMorphEnabled) {
            this.packet.visible = true;
            this.packetGlow.visible = true;
            this.packetTrail.forEach((trail) => {
                if (trail) trail.visible = true;
            });
            this.ensurePacketMorphTag();
        }
    }

    ensurePacketMorphTag() {
        if (this.packetMorphTag || !this.scene) return;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.width = 380;
        canvas.height = 88;
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            opacity: 0,
        });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(1.85, 0.42, 1);
        sprite.renderOrder = 4;
        sprite.visible = false;
        this.scene.add(sprite);
        this.packetMorphTag = {
            sprite,
            canvas,
            ctx,
            texture,
            lastText: '',
            lastIntensity: -1,
        };
    }

    paintPacketMorphTag(text, intensity = 0.75) {
        const tag = this.packetMorphTag;
        if (!tag || !tag.ctx) return;
        const safeText = String(text || '');
        const safeIntensity = Math.max(0, Math.min(1, Number(intensity) || 0));
        if (safeText === tag.lastText && Math.abs(safeIntensity - (tag.lastIntensity ?? -1)) < 0.04) return;
        tag.lastText = safeText;
        tag.lastIntensity = safeIntensity;

        const ctx = tag.ctx;
        const w = tag.canvas.width;
        const h = tag.canvas.height;
        ctx.clearRect(0, 0, w, h);

        ctx.fillStyle = `rgba(8, 12, 20, ${0.55 + safeIntensity * 0.28})`;
        ctx.strokeStyle = `rgba(230, 193, 90, ${0.35 + safeIntensity * 0.45})`;
        ctx.lineWidth = 1.4;
        if (typeof ctx.roundRect === 'function') {
            ctx.beginPath();
            ctx.roundRect(0.5, 0.5, w - 1, h - 1, 7);
            ctx.fill();
            ctx.stroke();
        } else {
            ctx.fillRect(0, 0, w, h);
            ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
        }

        const lines = safeText.split('\n').slice(0, 2);
        ctx.textBaseline = 'middle';
        ctx.shadowColor = `rgba(230, 193, 90, ${0.18 + safeIntensity * 0.35})`;
        ctx.shadowBlur = 7;
        if (lines[0]) {
            ctx.font = '15px "Share Tech Mono", monospace';
            ctx.fillStyle = `rgba(236, 244, 250, ${0.92 + safeIntensity * 0.08})`;
            ctx.strokeStyle = 'rgba(10, 14, 20, 0.85)';
            ctx.lineWidth = 2.4;
            ctx.strokeText(lines[0], 14, h * 0.34);
            ctx.fillText(lines[0], 14, h * 0.34);
        }
        if (lines[1]) {
            ctx.font = '13px "Share Tech Mono", monospace';
            ctx.fillStyle = `rgba(169, 212, 232, ${0.88 + safeIntensity * 0.1})`;
            ctx.strokeStyle = 'rgba(10, 14, 20, 0.8)';
            ctx.lineWidth = 2.2;
            ctx.strokeText(lines[1], 14, h * 0.72);
            ctx.fillText(lines[1], 14, h * 0.72);
        }
        ctx.shadowBlur = 0;
        tag.texture.needsUpdate = true;
    }

    resolvePacketMorphPhase(y) {
        if (!this.layerMap) return -1;
        const top = (this.layerMap.tcp + this.layerMap.ip) / 2;
        const bot = (this.layerMap.ip + this.layerMap.netfilter) / 2;
        if (!(y <= top && y >= bot)) return -1;
        const span = Math.max(0.001, top - bot);
        const t = (top - y) / span;
        return Math.min(3, Math.floor(t * 4));
    }

    refreshPacketMorphContext() {
        // Snapshot into packetMorphCtx only — do not touch ipMapFrozen (panel freeze).
        this.packetMorphCtx = this.resolveMorphContext({ kind: 'flow' });
        return this.packetMorphCtx;
    }

    buildPacketMorphCaption(phase, ctx) {
        const c = ctx || {};
        const addr = this.ipv4ToBe32(c.ip);
        const port = this.portToBe16(c.port);
        const route = c.route || {};
        const ha = this.macToHa(c.hop?.mac);
        const ttl = Number(this.getIpMapData()?.ip?.default_ttl) || 64;
        const dest = route.default ? 'default' : (route.destination || c.ip || '?');
        const gw = route.gateway && route.gateway !== '*' ? route.gateway : 'on-link';
        const iface = c.iface || '?';
        const nh = c.nexthopIp || gw;
        const macShort = (ha.mac && ha.mac !== '??') ? ha.mac : 'ha[] unfinished';

        if (phase === 0) {
            return 'IP hdr  ' + (c.ip || '?') + ':' + port.port + '  ttl ' + ttl + '\nip_queue_xmit';
        }
        if (phase === 1) {
            return 'route  ' + dest + ' → ' + gw + '  oif ' + iface + '\nfib_table_lookup';
        }
        if (phase === 2) {
            return 'neigh  ' + nh + '  ' + macShort + '\nneigh_resolve_output';
        }
        return 'eth hdr  → ' + iface + '  ' + (addr?.hex || 'be32') + '\ndev_queue_xmit';
    }

    applyPacketMorphPhase(phase) {
        if (!this.packet) return;
        const colors = [0xE6C15A, 0xE6C15A, 0x96FFBE, 0x67BEE0];
        const scales = [1.0, 0.92, 0.86, 1.08];
        const color = colors[phase] != null ? colors[phase] : 0xE6C15A;
        const scale = scales[phase] != null ? scales[phase] : 1;
        this.packet.material.color.setHex(color);
        if (this.packetGlow?.material) this.packetGlow.material.color.setHex(color);
        this.packet.scale.setScalar(scale);
        if (this.packetGlow) this.packetGlow.scale.setScalar(scale * (1.15 + this.packetMorphPulse * 0.2));
        this.packetTrail.forEach((trail, i) => {
            if (trail?.material?.color) trail.material.color.setHex(color);
            if (trail) trail.scale.setScalar(Math.max(0.55, scale * (1 - i * 0.08)));
        });
    }

    setPacketMorphVisible(on) {
        const tag = this.packetMorphTag;
        if (!tag?.sprite) return;
        tag.sprite.visible = !!on;
        if (tag.sprite.material) {
            tag.sprite.material.opacity = on ? 1 : 0;
        }
    }

    updatePacketMorph() {
        if (!this.packetMorphEnabled || !this.packet) return;
        this.ensurePacketMorphTag();
        const y = this.packet.position.y;
        const phase = this.resolvePacketMorphPhase(y);

        if (phase < 0) {
            if (this.packetMorphPhase !== -1) {
                this.packetMorphPhase = -1;
                this.packetMorphCtx = null;
                this.setPacketMorphVisible(false);
                this.packet.scale.setScalar(1);
                if (this.packetGlow) this.packetGlow.scale.setScalar(1);
                this.updatePacketColorByFlow();
            }
            return;
        }

        if (this.packetMorphPhase < 0 || !this.packetMorphCtx) {
            this.refreshPacketMorphContext();
        }
        if (phase !== this.packetMorphPhase) {
            this.packetMorphPhase = phase;
            this.packetMorphPulse = 1;
            const caption = this.buildPacketMorphCaption(phase, this.packetMorphCtx);
            this.paintPacketMorphTag(caption, 0.9);
            this.applyPacketMorphPhase(phase);
            this.setPacketMorphVisible(true);
        } else if (this.packetMorphPulse > 0) {
            this.packetMorphPulse = Math.max(0, this.packetMorphPulse - 0.04);
            this.applyPacketMorphPhase(phase);
        }

        const tag = this.packetMorphTag;
        if (tag?.sprite) {
            tag.sprite.position.set(
                this.packet.position.x + 1.55,
                this.packet.position.y + 0.18,
                this.packet.position.z
            );
        }
    }

    createOverlayUI() {
        const title = document.createElement('div');
        title.style.cssText = `
            position: absolute;
            top: 18px;
            left: 50%;
            transform: translateX(-50%);
            color: #d3d9e0;
            font-family: 'Share Tech Mono', monospace;
            font-size: 22px;
            letter-spacing: 1.2px;
            text-shadow: 0 0 10px rgba(88, 182, 216, 0.22);
            z-index: 1001;
        `;
        title.textContent = 'NETWORK STACK';
        this.container.appendChild(title);
        this.overlayNodes.push(title);

        const flow = document.createElement('div');
        flow.style.cssText = `
            position: absolute;
            top: 58px;
            left: 50%;
            transform: translateX(-50%);
            color: #a7b3be;
            font-family: 'Share Tech Mono', monospace;
            font-size: 11px;
            letter-spacing: 0.45px;
            background: rgba(11, 16, 24, 0.62);
            border: 1px solid rgba(90, 104, 120, 0.32);
            border-radius: 14px;
            padding: 4px 12px;
            z-index: 1001;
        `;
        flow.textContent = 'process -> syscall -> socket -> TCP -> IP -> NIC -> wire -> remote';
        this.container.appendChild(flow);
        this.overlayNodes.push(flow);
        this.flowNode = flow;

        const kpiBar = document.createElement('div');
        kpiBar.style.cssText = `
            position: absolute;
            top: 90px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 1001;
            display: flex;
            gap: 8px;
            align-items: flex-start;
            pointer-events: none;
        `;
        this.container.appendChild(kpiBar);
        this.overlayNodes.push(kpiBar);

        const kpiSpec = [
            { id: 'flow', label: 'FLOW' },
            { id: 'rtt', label: 'RTT' },
            { id: 'drop', label: 'DROPS' },
            { id: 'retrans', label: 'RETRANS' },
            { id: 'path', label: 'PATH' }
        ];
        kpiSpec.forEach((spec) => {
            const card = document.createElement('div');
            card.style.cssText = `
                min-width: 116px;
                background: rgba(13, 18, 28, 0.88);
                border: 1px solid rgba(108, 122, 142, 0.32);
                border-radius: 6px;
                padding: 6px 9px 7px;
                color: #c8d0da;
                box-shadow: 0 3px 10px rgba(0, 0, 0, 0.22);
            `;
            const label = document.createElement('div');
            label.style.cssText = `
                font-family: 'Share Tech Mono', monospace;
                font-size: 9px;
                letter-spacing: 0.7px;
                color: #8391a1;
                margin-bottom: 3px;
            `;
            label.textContent = spec.label;
            const value = document.createElement('div');
            value.style.cssText = `
                font-family: 'Share Tech Mono', monospace;
                font-size: 12px;
                color: #d8e0ea;
                line-height: 1.2;
            `;
            value.textContent = '--';
            card.appendChild(label);
            card.appendChild(value);
            kpiBar.appendChild(card);
            this.kpiNodes[spec.id] = { card, label, value };
            if (spec.id === 'path') {
                card.style.borderColor = 'rgba(224, 86, 78, 0.85)';
                card.style.boxShadow = '0 0 14px rgba(224, 86, 78, 0.28)';
                label.style.color = '#e0564e';
                value.style.color = '#ff8a7a';
                this.pathHopNode = { card, label, value };
            }
        });

        // ARRAY OUTPUT block: a compact reference-style pattern matrix that is
        // actually a live "stack activity" heatmap — 7 layer rows × N time cols,
        // each cell colored by that layer's activity at that moment (built from
        // <div>s on purpose; an <svg> would be blown up by the global svg rule).
        const MATRIX_COLS = 20;
        const matrixOrder = ['userspace', 'socket', 'tcp', 'ip', 'netfilter', 'driver', 'nic'];
        const arrayCard = document.createElement('div');
        arrayCard.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 4px;
            background: rgba(13, 18, 28, 0.88);
            border: 1px solid rgba(108, 122, 142, 0.32);
            border-radius: 6px;
            padding: 6px 9px 7px;
            box-shadow: 0 3px 10px rgba(0, 0, 0, 0.22);
            font-family: 'Share Tech Mono', monospace;
        `;
        const arrayHead = document.createElement('div');
        arrayHead.style.cssText = 'display:flex; align-items:baseline; gap:6px;';
        const arrayLabel = document.createElement('div');
        arrayLabel.style.cssText = 'font-size:9px; letter-spacing:0.7px; color:#8391a1;';
        arrayLabel.textContent = 'NS-ARRAY · STACK ACTIVITY';
        const arrayDesig = document.createElement('div');
        arrayDesig.style.cssText = 'font-size:11px; letter-spacing:0.5px; color:#9bd4f2;';
        arrayDesig.textContent = 'TCP';
        arrayHead.appendChild(arrayLabel);
        arrayHead.appendChild(arrayDesig);
        this.arrayDesignator = arrayDesig;

        const matrix = document.createElement('div');
        matrix.style.cssText = `display:grid; grid-template-columns: repeat(${MATRIX_COLS}, 4px); grid-template-rows: repeat(${matrixOrder.length}, 4px); gap:1px;`;
        this.matrixCells = [];
        this.matrixData = [];
        this.matrixOrder = matrixOrder;
        for (let r = 0; r < matrixOrder.length; r++) {
            this.matrixCells[r] = [];
            this.matrixData[r] = new Array(MATRIX_COLS).fill(0);
            for (let c = 0; c < MATRIX_COLS; c++) {
                const cell = document.createElement('div');
                cell.style.cssText = 'width:4px; height:4px; background:rgba(40,52,64,0.5);';
                matrix.appendChild(cell);
                this.matrixCells[r][c] = cell;
            }
        }
        arrayCard.appendChild(arrayHead);
        arrayCard.appendChild(matrix);
        kpiBar.appendChild(arrayCard);

        // NOTE: the old top-left "ARRAY OUTPUT PATTERN BIAS" panel was removed —
        // it rendered synthetic code tiles (not real telemetry) and only added
        // visual noise. References are nulled so updatePatternMatrix() no-ops.
        this.patternHeaderNode = null;
        this.patternTiles = [];

        // One aligned stack axis: each layer is a single row spanning the scene —
        // [health dot + name] on the left, the live lane in the middle, and the
        // live metric chip on the right, all sharing the same vertical position.
        const layerRows = [
            { id: 'userspace', name: 'USERSPACE', top: '22%' },
            { id: 'socket', name: 'SOCKET API', top: '30%' },
            { id: 'tcp', name: 'TCP / UDP', top: '38%' },
            { id: 'ip', name: 'IP', top: '46%' },
            { id: 'netfilter', name: 'NETFILTER', top: '54%' },
            { id: 'driver', name: 'DRIVER', top: '62%' },
            { id: 'nic', name: 'NIC', top: '70%' }
        ];

        // Transparent full-bleed container for the left row labels. Kept as
        // layersPanelNode so existing view/read-mode toggles still show/hide it.
        const layersPanel = document.createElement('div');
        layersPanel.style.cssText = `
            position: absolute;
            inset: 0;
            z-index: 1001;
            pointer-events: none;
        `;
        this.container.appendChild(layersPanel);
        this.overlayNodes.push(layersPanel);
        this.layersPanelNode = layersPanel;

        // Section caption sitting above the first row.
        const stackCaption = document.createElement('div');
        stackCaption.style.cssText = `
            position: absolute;
            left: 120px;
            top: 16%;
            transform: translateY(-50%);
            color: #7f8fa2;
            font-family: 'Share Tech Mono', monospace;
            font-size: 10px;
            letter-spacing: 1.1px;
        `;
        stackCaption.textContent = 'STACK  ·  userspace → wire';
        layersPanel.appendChild(stackCaption);

        this.layerRows = {};
        this.layerConnectors = {};

        // Reference-style channel list cells (one per stack layer).
        layerRows.forEach((spec, i) => {
            const level = 7 - i;
            const row = document.createElement('div');
            row.style.cssText = `
                position: absolute;
                left: 120px;
                top: ${spec.top};
                transform: translateY(-50%);
                display: flex;
                flex-direction: column;
                gap: 2px;
                min-width: 150px;
                padding: 4px 9px;
                background: rgba(13, 18, 28, 0.72);
                border: 1px solid rgba(108, 122, 142, 0.3);
                border-left: 2px solid rgba(103, 190, 224, 0.7);
                border-radius: 3px;
                font-family: 'Share Tech Mono', monospace;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
            `;
            const code = document.createElement('div');
            code.style.cssText = `font-size: 8px; letter-spacing: 1px; color: #6f8597;`;
            code.textContent = `NS-STACK-L${String(level).padStart(2, '0')}`;
            const mainline = document.createElement('div');
            mainline.style.cssText = `display: flex; align-items: center; gap: 7px;`;
            const dot = document.createElement('span');
            dot.style.cssText = `
                width: 8px;
                height: 8px;
                border-radius: 50%;
                flex: 0 0 auto;
                background: rgba(122, 150, 168, 0.6);
                transition: background 220ms ease, box-shadow 220ms ease;
            `;
            const name = document.createElement('span');
            name.style.cssText = `
                color: #cdd6e0;
                font-size: 11.5px;
                letter-spacing: 0.5px;
            `;
            name.textContent = spec.name;
            mainline.appendChild(dot);
            mainline.appendChild(name);
            row.appendChild(code);
            row.appendChild(mainline);
            row.style.pointerEvents = 'auto';
            row.style.cursor = 'pointer';
            row.title = 'Click to inspect layer';
            row.addEventListener('click', () => this.openLayerDrilldown(spec.id));
            layersPanel.appendChild(row);
            this.layerRows[spec.id] = { row, dot, name };
        });

        // Connector overlay: leader lines from the channel list to the tower
        // segments (projected from 3D each frame in updateConnectors()).
        const svgNS = 'http://www.w3.org/2000/svg';
        const connectorSvg = document.createElementNS(svgNS, 'svg');
        connectorSvg.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; z-index:1000; pointer-events:none;';
        this.container.appendChild(connectorSvg);
        this.overlayNodes.push(connectorSvg);
        this.connectorSvg = connectorSvg;

        const rail = document.createElementNS(svgNS, 'path');
        rail.setAttribute('fill', 'none');
        rail.setAttribute('stroke', 'rgba(103, 190, 224, 0.28)');
        rail.setAttribute('stroke-width', '1');
        connectorSvg.appendChild(rail);
        this.connectorRail = rail;

        layerRows.forEach((spec) => {
            const path = document.createElementNS(svgNS, 'path');
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', 'rgba(103, 190, 224, 0.5)');
            path.setAttribute('stroke-width', '1');
            connectorSvg.appendChild(path);
            const node = document.createElementNS(svgNS, 'circle');
            node.setAttribute('r', '2.6');
            node.setAttribute('fill', '#67c8e0');
            connectorSvg.appendChild(node);
            this.layerConnectors[spec.id] = { path, node, frac: parseFloat(spec.top) / 100 };
        });

        // Right connectors: tower right edge -> right metric chips (mirror of left).
        this.layerConnectorsRight = {};
        const railRight = document.createElementNS(svgNS, 'path');
        railRight.setAttribute('fill', 'none');
        railRight.setAttribute('stroke', 'rgba(103, 190, 224, 0.28)');
        railRight.setAttribute('stroke-width', '1');
        connectorSvg.appendChild(railRight);
        this.connectorRailRight = railRight;

        layerRows.forEach((spec) => {
            const path = document.createElementNS(svgNS, 'path');
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', 'rgba(103, 190, 224, 0.5)');
            path.setAttribute('stroke-width', '1');
            connectorSvg.appendChild(path);
            const node = document.createElementNS(svgNS, 'circle');
            node.setAttribute('r', '2.6');
            node.setAttribute('fill', '#67c8e0');
            connectorSvg.appendChild(node);
            this.layerConnectorsRight[spec.id] = { path, node, frac: parseFloat(spec.top) / 100 };
        });

        // Right-aligned live metric chips, sharing each row's vertical position.
        const chipLayer = document.createElement('div');
        chipLayer.style.cssText = `
            position: absolute;
            inset: 0;
            z-index: 1001;
            pointer-events: none;
        `;
        this.container.appendChild(chipLayer);
        this.overlayNodes.push(chipLayer);
        this.chipLayerNode = chipLayer;
        // Right side = a per-layer horizontal "signal chain" (reference style):
        //   [number] › [EQ + spectrogram] › [INTENSITY dial] › [LF BIAS]×2 › [INDUCTION RESPONSE]
        // The leader beam from the tower lands on the [number] block, then the
        // chain flows to the right. Fixed total width + fixed right offset keep
        // the number block at a deterministic X so the beam can terminate on it.
        this.layerSpectra = {};
        this.chainModules = {};
        this.layerHeadline = {};
        this.chainWidth = 158;
        this.chainRight = 22;

        // Small cyan "›" connector glyph placed between chain modules.
        const makeSep = () => {
            const s = document.createElement('div');
            s.style.cssText = 'flex:none; color:rgba(103,190,224,0.7); font-size:11px; line-height:1; align-self:center;';
            s.textContent = '›';
            return s;
        };
        const makeHeader = (text) => {
            const h = document.createElement('div');
            h.style.cssText = 'font-size:6.5px; letter-spacing:0.55px; color:#6f8597; white-space:nowrap; margin-bottom:2px;';
            h.textContent = text;
            return h;
        };

        layerRows.forEach((spec, idx) => {
            const chain = document.createElement('div');
            chain.style.cssText = `
                position: absolute;
                right: ${this.chainRight}px;
                top: ${spec.top};
                transform: translateY(-50%);
                width: ${this.chainWidth}px;
                display: flex;
                align-items: center;
                gap: 7px;
                font-family: 'Share Tech Mono', monospace;
            `;

            // 1) NUMBER block — the beam target. Caption (array slot) + big
            // headline + a small metric label so the units stay legible.
            const metricCaption = {
                userspace: 'active procs',
                socket: 'established',
                tcp: 'rtt ms',
                ip: 'packets/s i+o',
                netfilter: 'drops/s',
                driver: 'tx queue',
                nic: 'rx+tx errors'
            };
            const numBlock = document.createElement('div');
            numBlock.style.cssText = 'flex:none; width:96px; display:flex; flex-direction:column; gap:1px;';
            const numCap = document.createElement('div');
            numCap.style.cssText = 'font-size:7px; letter-spacing:0.6px; color:#6f8597; white-space:nowrap;';
            numCap.textContent = spec.name;
            const numVal = document.createElement('div');
            numVal.style.cssText = 'font-size:19px; line-height:1.05; letter-spacing:0.3px; color:#cfe6f2; white-space:nowrap;';
            numVal.textContent = '--';
            const numSub = document.createElement('div');
            numSub.style.cssText = 'font-size:8px; letter-spacing:0.3px; color:#8ba0b2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;';
            numSub.textContent = metricCaption[spec.id] || '';
            numBlock.appendChild(numCap);
            numBlock.appendChild(numVal);
            numBlock.appendChild(numSub);

            // 2) INTENSITY — big number on a circular dial (real layer activity).
            const intBlock = document.createElement('div');
            intBlock.style.cssText = 'flex:none; display:flex; flex-direction:column; align-items:center;';
            intBlock.appendChild(makeHeader('ACTIVITY'));
            const dial = document.createElement('div');
            dial.style.cssText = 'position:relative; width:38px; height:38px; border-radius:50%; background:conic-gradient(rgba(103,190,224,0.85) 40deg, rgba(34,44,56,0.7) 0); box-shadow:0 0 0 1px rgba(96,110,128,0.4) inset; display:flex; align-items:center; justify-content:center;';
            const dialNum = document.createElement('div');
            dialNum.style.cssText = 'font-size:13px; color:#dbe7f0; letter-spacing:0.3px;';
            dialNum.textContent = '0';
            dial.appendChild(dialNum);
            intBlock.appendChild(dial);

            // Clean per-layer readout: real metric number + one activity dial.
            chain.style.pointerEvents = 'auto';
            chain.style.cursor = 'pointer';
            chain.title = 'Click to inspect layer';
            chain.addEventListener('click', () => this.openLayerDrilldown(spec.id));
            chain.appendChild(numBlock);
            chain.appendChild(makeSep());
            chain.appendChild(intBlock);
            chipLayer.appendChild(chain);

            this.metricChips[spec.id] = null;
            this.chainModules[spec.id] = { numCap, numVal, dialArc: dial, dialNum };
        });

        // Left operation-mode rail (reference style). The active cell follows the
        // current read mode so it stays meaningful, not decorative.
        const modePanel = document.createElement('div');
        modePanel.style.cssText = `
            position: absolute;
            left: 14px;
            top: 15%;
            z-index: 1001;
            pointer-events: none;
            display: flex;
            flex-direction: column;
            gap: 4px;
            width: 96px;
            font-family: 'Share Tech Mono', monospace;
        `;
        this.container.appendChild(modePanel);
        this.overlayNodes.push(modePanel);
        this.modePanelNode = modePanel;

        const modeStat = document.createElement('div');
        modeStat.style.cssText = `
            background: rgba(16, 22, 32, 0.7);
            border: 1px solid rgba(115, 128, 145, 0.32);
            border-radius: 3px;
            padding: 5px 7px;
            margin-bottom: 3px;
        `;
        const modeStatCap = document.createElement('div');
        modeStatCap.style.cssText = `font-size: 7.5px; letter-spacing: 1.1px; color: #6f8597;`;
        modeStatCap.textContent = 'STREAM · ACTIVE';
        const modeStatVal = document.createElement('div');
        modeStatVal.style.cssText = `font-size: 14px; letter-spacing: 0.5px; color: #9bd4f2; line-height: 1.1;`;
        modeStatVal.textContent = '--';
        modeStat.appendChild(modeStatCap);
        modeStat.appendChild(modeStatVal);
        modePanel.appendChild(modeStat);
        this.modeStatValue = modeStatVal;

        const modeDefs = [
            { id: 'active', label: 'ACTIVE' },
            { id: 'setup', label: 'SETUP' },
            { id: 'system', label: 'SYSTEM' },
            { id: 'monitor', label: 'MONITOR' },
            { id: 'diagnostic', label: 'DIAGNOSTIC' },
            { id: 'log', label: 'LOG' }
        ];
        this.modeCells = {};
        modeDefs.forEach((m) => {
            const cell = document.createElement('div');
            cell.style.cssText = `
                background: rgba(14, 19, 28, 0.66);
                border: 1px solid rgba(96, 110, 128, 0.28);
                border-left: 2px solid rgba(96, 110, 128, 0.4);
                border-radius: 2px;
                padding: 4px 7px;
                line-height: 1.15;
            `;
            const cap = document.createElement('div');
            cap.style.cssText = `font-size: 7px; letter-spacing: 1px; color: #5d7286;`;
            cap.textContent = 'MODE';
            const name = document.createElement('div');
            name.style.cssText = `font-size: 11px; letter-spacing: 0.5px; color: #8190a0;`;
            name.textContent = m.label;
            cell.appendChild(cap);
            cell.appendChild(name);
            modePanel.appendChild(cell);
            this.modeCells[m.id] = { cell, name };
        });
        this.updateModePanel();

        const err = document.createElement('div');
        err.style.cssText = `
            position: absolute;
            bottom: 18px;
            right: 20px;
            color: #a9aeb5;
            font-family: 'Share Tech Mono', monospace;
            font-size: 10px;
            z-index: 1001;
            opacity: 0.8;
        `;
        err.textContent = '';
        this.container.appendChild(err);
        this.overlayNodes.push(err);
        this.telemetryErrorNode = err;

        const galaxyPanel = document.createElement('div');
        galaxyPanel.style.cssText = `
            position: absolute;
            left: 24px;
            bottom: 18px;
            z-index: 1001;
            width: 360px;
            max-width: 30vw;
            background: rgba(10, 15, 24, 0.84);
            border: 1px solid rgba(129, 145, 168, 0.32);
            border-radius: 6px;
            padding: 10px 12px;
            color: #c7d0da;
            font-family: 'Share Tech Mono', monospace;
            font-size: 10px;
            line-height: 1.45;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.24);
            overflow: hidden;
        `;
        this.container.appendChild(galaxyPanel);
        this.overlayNodes.push(galaxyPanel);
        this.galaxyPanelNode = galaxyPanel;
        const galaxyTitle = document.createElement('div');
        galaxyTitle.style.cssText = `
            font-size: 10px;
            color: #7f8fa2;
            letter-spacing: 0.6px;
            margin-bottom: 6px;
        `;
        galaxyTitle.textContent = 'NETWORK GALAXIES (METABOLISM VIEW)';
        galaxyPanel.appendChild(galaxyTitle);

        const galaxyButtonRow = document.createElement('div');
        galaxyButtonRow.style.cssText = `
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-bottom: 7px;
        `;
        galaxyPanel.appendChild(galaxyButtonRow);

        const galaxyDefs = [
            { id: 'physical', label: 'Physical' },
            { id: 'packet', label: 'Packet' },
            { id: 'state', label: 'State' },
            { id: 'security', label: 'Security' },
            { id: 'observability', label: 'Observability' }
        ];
        galaxyDefs.forEach((def) => {
            const chip = document.createElement('button');
            chip.style.cssText = `
                border-radius: 4px;
                border: 1px solid rgba(115, 128, 145, 0.32);
                background: rgba(16, 22, 32, 0.68);
                color: #bac4cf;
                font-family: 'Share Tech Mono', monospace;
                font-size: 10px;
                padding: 3px 8px;
                cursor: pointer;
                transition: all 0.2s ease;
            `;
            chip.textContent = `${def.label}: --`;
            chip.onclick = () => this.selectGalaxy(def.id);
            galaxyButtonRow.appendChild(chip);
            this.galaxyNodes[def.id] = chip;
        });

        const galaxyExplain = document.createElement('div');
        galaxyExplain.style.cssText = `
            color: #aeb8c3;
            font-size: 10px;
            line-height: 1.45;
            min-height: 34px;
            border-top: 1px solid rgba(115, 128, 145, 0.24);
            padding-top: 6px;
        `;
        galaxyExplain.textContent = 'Select a galaxy to inspect subsystem health.';
        galaxyPanel.appendChild(galaxyExplain);
        this.galaxyExplainNode = galaxyExplain;

        const lifecyclePanel = document.createElement('div');
        lifecyclePanel.style.cssText = `
            position: absolute;
            right: 20px;
            bottom: 18px;
            left: auto;
            transform: none;
            z-index: 1001;
            width: 760px;
            max-width: calc(100vw - 430px);
            min-width: 520px;
            max-height: 36vh;
            background: rgba(10, 15, 24, 0.84);
            border: 1px solid rgba(129, 145, 168, 0.32);
            border-radius: 6px;
            padding: 10px 12px;
            color: #c7d0da;
            font-family: 'Share Tech Mono', monospace;
            font-size: 9px;
            line-height: 1.5;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.24);
            pointer-events: auto;
            overflow: auto;
        `;
        this.container.appendChild(lifecyclePanel);
        this.overlayNodes.push(lifecyclePanel);
        this.lifecyclePanelNode = lifecyclePanel;
        lifecyclePanel.addEventListener('click', (event) => {
            const nav = event.target && event.target.closest
                ? event.target.closest('[data-ns-nav]')
                : null;
            if (!nav) return;
            const href = nav.getAttribute('data-ns-nav');
            if (!href) return;
            event.preventDefault();
            event.stopPropagation();
            window.location.assign(href);
        });

        const layerTip = document.createElement('div');
        layerTip.style.cssText = `
            position: absolute;
            z-index: 1002;
            pointer-events: none;
            display: none;
            background: rgba(12, 18, 28, 0.94);
            border: 1px solid rgba(160, 170, 190, 0.35);
            color: #c8ccd4;
            font-family: 'Share Tech Mono', monospace;
            font-size: 10px;
            line-height: 1.45;
            border-radius: 4px;
            padding: 7px 9px;
            max-width: 300px;
            white-space: nowrap;
        `;
        this.container.appendChild(layerTip);
        this.overlayNodes.push(layerTip);
        this.layerTooltipNode = layerTip;

        // ---- Per-layer drill-down overlay (click a layer to inspect) ----------
        // A centered modal with a scrim: real metrics for the layer + a short
        // "what this layer does" explainer, mirroring the crypto/scheduler
        // overlays so the whole site reads consistently.
        const drillScrim = document.createElement('div');
        drillScrim.style.cssText = `
            position: absolute;
            inset: 0;
            z-index: 1200;
            display: none;
            pointer-events: auto;
            background: radial-gradient(ellipse at 50% 46%, rgba(8,12,20,0.62) 0%, rgba(6,9,15,0.86) 62%, rgba(4,6,11,0.94) 100%);
            backdrop-filter: blur(1.5px);
            font-family: 'Share Tech Mono', monospace;
        `;
        const drillPanel = document.createElement('div');
        drillPanel.style.cssText = `
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            width: min(680px, 78vw);
            background: rgba(11, 16, 26, 0.96);
            border: 1px solid rgba(103, 190, 224, 0.4);
            border-radius: 8px;
            box-shadow: 0 18px 60px rgba(0, 0, 0, 0.6);
            color: #cdd6e0;
            padding: 0;
            overflow: hidden;
        `;
        drillScrim.appendChild(drillPanel);
        this.container.appendChild(drillScrim);
        this.overlayNodes.push(drillScrim);
        this.drillScrim = drillScrim;
        this.drillPanel = drillPanel;
        // Click on the scrim (outside the panel) closes the overlay.
        drillScrim.addEventListener('click', (e) => {
            if (e.target === drillScrim) this.closeLayerDrilldown();
        });

        // ---- TCP BBR path-model overlay --------------------------------------
        const bbrScrim = document.createElement('div');
        bbrScrim.style.cssText = drillScrim.style.cssText;
        bbrScrim.style.display = 'none';
        const bbrPanel = document.createElement('div');
        bbrPanel.style.cssText = drillPanel.style.cssText;
        bbrPanel.style.width = 'min(880px, 88vw)';
        bbrScrim.appendChild(bbrPanel);
        this.container.appendChild(bbrScrim);
        this.overlayNodes.push(bbrScrim);
        this.bbrScrim = bbrScrim;
        this.bbrPanel = bbrPanel;
        bbrScrim.addEventListener('click', (e) => {
            if (e.target === bbrScrim) this.closeBbrOverlay();
        });

        // Entry pill for the BBR model, sitting under the flow header.
        const bbrPill = document.createElement('div');
        bbrPill.style.cssText = `
            position: absolute;
            left: 50%;
            top: 138px;
            transform: translateX(-50%);
            z-index: 1002;
            cursor: pointer;
            pointer-events: auto;
            font-family: 'Share Tech Mono', monospace;
            font-size: 10px;
            letter-spacing: 1px;
            color: #a9d4e8;
            background: rgba(103,190,224,0.12);
            border: 1px solid rgba(103,190,224,0.45);
            border-radius: 14px;
            padding: 4px 14px;
            white-space: nowrap;
            transition: background 160ms ease;
        `;
        bbrPill.textContent = '▸ TCP BBR · PATH MODEL';
        bbrPill.title = 'Open the BBR bottleneck-bandwidth + min-RTT model';
        bbrPill.addEventListener('mouseenter', () => { bbrPill.style.background = 'rgba(103,190,224,0.22)'; });
        bbrPill.addEventListener('mouseleave', () => { bbrPill.style.background = 'rgba(103,190,224,0.12)'; });
        bbrPill.addEventListener('click', () => this.openBbrOverlay());
        this.container.appendChild(bbrPill);
        this.overlayNodes.push(bbrPill);
        this.bbrPillNode = bbrPill;

        // Grouped "VIEW" control rail: the four view toggles live in one compact
        // card (clearly a control surface, distinct from the read-only metric
        // chips) instead of four separate floating pills stacked down the edge.
        const controlCard = document.createElement('div');
        controlCard.style.cssText = `
            position: absolute;
            top: 60px;
            right: 20px;
            z-index: 1002;
            display: flex;
            flex-direction: column;
            gap: 5px;
            padding: 7px 7px 8px;
            background: rgba(10, 15, 24, 0.62);
            border: 1px solid rgba(115, 128, 145, 0.26);
            border-radius: 7px;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.22);
            pointer-events: auto;
        `;
        this.container.appendChild(controlCard);
        this.overlayNodes.push(controlCard);
        this.controlCardNode = controlCard;

        const controlHeader = document.createElement('div');
        controlHeader.style.cssText = `
            font-family: 'Share Tech Mono', monospace;
            font-size: 8.5px;
            letter-spacing: 1.1px;
            color: #6f7d8e;
            padding: 1px 2px 4px;
            border-bottom: 1px solid rgba(115, 128, 145, 0.2);
        `;
        controlHeader.textContent = 'VIEW';
        controlCard.appendChild(controlHeader);

        const baseBtnCss = `
            display: block;
            width: 132px;
            text-align: left;
            padding: 5px 9px;
            background: rgba(12, 18, 28, 0.88);
            border: 1px solid rgba(125, 138, 156, 0.34);
            color: #c6d0db;
            font-family: 'Share Tech Mono', monospace;
            font-size: 9.5px;
            letter-spacing: 0.4px;
            cursor: pointer;
            border-radius: 4px;
            transition: all 0.2s ease;
        `;

        const viewModeBtn = document.createElement('button');
        viewModeBtn.textContent = 'MODE: DETAILED';
        viewModeBtn.style.cssText = baseBtnCss;
        viewModeBtn.onmouseenter = () => {
            viewModeBtn.style.background = 'rgba(19, 28, 40, 0.95)';
            viewModeBtn.style.color = '#edf2f8';
        };
        viewModeBtn.onmouseleave = () => {
            viewModeBtn.style.background = 'rgba(12, 18, 28, 0.88)';
            viewModeBtn.style.color = this.viewDensityMode === 'minimal' ? '#f0dca2' : '#c6d0db';
        };
        viewModeBtn.onclick = () => {
            this.toggleViewDensityMode();
        };
        controlCard.appendChild(viewModeBtn);
        this.overlayNodes.push(viewModeBtn);
        this.viewModeButton = viewModeBtn;

        const puzzleModeBtn = document.createElement('button');
        puzzleModeBtn.textContent = 'PUZZLE: OVERVIEW';
        puzzleModeBtn.style.cssText = baseBtnCss;
        puzzleModeBtn.onmouseenter = () => {
            puzzleModeBtn.style.background = 'rgba(19, 28, 40, 0.95)';
            puzzleModeBtn.style.color = '#edf2f8';
        };
        puzzleModeBtn.onmouseleave = () => {
            puzzleModeBtn.style.background = 'rgba(12, 18, 28, 0.88)';
            puzzleModeBtn.style.color = this.puzzleDetailMode === 'overview' ? '#c6d0db' : '#f0dca2';
        };
        puzzleModeBtn.onclick = () => {
            this.togglePuzzleDetailMode();
        };
        controlCard.appendChild(puzzleModeBtn);
        this.overlayNodes.push(puzzleModeBtn);
        this.puzzleModeButton = puzzleModeBtn;

        const noiseModeBtn = document.createElement('button');
        noiseModeBtn.textContent = 'NOISE: DENSE';
        noiseModeBtn.style.cssText = baseBtnCss;
        // Default state is dense → start in the active (amber) styling.
        noiseModeBtn.style.borderColor = 'rgba(230, 193, 90, 0.58)';
        noiseModeBtn.style.color = '#f0dca2';
        noiseModeBtn.onmouseenter = () => {
            noiseModeBtn.style.background = 'rgba(19, 28, 40, 0.95)';
            noiseModeBtn.style.color = '#edf2f8';
        };
        noiseModeBtn.onmouseleave = () => {
            noiseModeBtn.style.background = 'rgba(12, 18, 28, 0.88)';
            noiseModeBtn.style.color = this.noiseDetailMode === 'dense' ? '#f0dca2' : '#c6d0db';
        };
        noiseModeBtn.onclick = () => {
            this.toggleNoiseDetailMode();
        };
        controlCard.appendChild(noiseModeBtn);
        this.overlayNodes.push(noiseModeBtn);
        this.noiseModeButton = noiseModeBtn;

        const readModeBtn = document.createElement('button');
        readModeBtn.textContent = 'READ: FORENSICS';
        readModeBtn.style.cssText = baseBtnCss;
        readModeBtn.onmouseenter = () => {
            readModeBtn.style.background = 'rgba(19, 28, 40, 0.95)';
            readModeBtn.style.color = '#edf2f8';
        };
        readModeBtn.onmouseleave = () => {
            readModeBtn.style.background = 'rgba(12, 18, 28, 0.88)';
            if (this.readMode === 'scene') readModeBtn.style.color = '#9bd4f2';
            else if (this.readMode === 'ops') readModeBtn.style.color = '#f0dca2';
            else readModeBtn.style.color = '#c6d0db';
        };
        readModeBtn.onclick = () => {
            this.toggleReadMode();
        };
        controlCard.appendChild(readModeBtn);
        this.overlayNodes.push(readModeBtn);
        this.readModeButton = readModeBtn;
        this.updateBottomPanelsLayout();
        this.updatePacketLifecycleUI();
        this.applyViewDensityMode();
    }

    updateBottomPanelsLayout() {
        const w = window.innerWidth || 1280;
        if (this.galaxyPanelNode) {
            if (w <= 1180) {
                this.galaxyPanelNode.style.width = '300px';
                this.galaxyPanelNode.style.maxWidth = '34vw';
            } else if (w <= 1440) {
                this.galaxyPanelNode.style.width = '330px';
                this.galaxyPanelNode.style.maxWidth = '31vw';
            } else {
                this.galaxyPanelNode.style.width = '360px';
                this.galaxyPanelNode.style.maxWidth = '30vw';
            }
        }
        if (this.lifecyclePanelNode) {
            if (w <= 1180) {
                this.lifecyclePanelNode.style.minWidth = '420px';
                this.lifecyclePanelNode.style.width = 'calc(100vw - 360px)';
                this.lifecyclePanelNode.style.maxWidth = 'calc(100vw - 340px)';
                this.lifecyclePanelNode.style.maxHeight = '30vh';
            } else if (w <= 1440) {
                this.lifecyclePanelNode.style.minWidth = '520px';
                this.lifecyclePanelNode.style.width = 'calc(100vw - 430px)';
                this.lifecyclePanelNode.style.maxWidth = 'calc(100vw - 410px)';
                this.lifecyclePanelNode.style.maxHeight = '31vh';
            } else {
                this.lifecyclePanelNode.style.minWidth = '620px';
                this.lifecyclePanelNode.style.width = '760px';
                this.lifecyclePanelNode.style.maxWidth = 'calc(100vw - 430px)';
                this.lifecyclePanelNode.style.maxHeight = '32vh';
            }
        }
    }

    applyViewDensityMode() {
        const minimal = this.viewDensityMode === 'minimal';
        if (this.layersPanelNode) {
            this.layersPanelNode.style.display = minimal ? 'none' : 'block';
        }
        if (this.chipLayerNode) {
            this.chipLayerNode.style.display = minimal ? 'none' : 'block';
        }
        if (this.galaxyPanelNode) {
            this.galaxyPanelNode.style.display = minimal ? 'none' : 'block';
        }
        if (this.lifecyclePanelNode) {
            this.lifecyclePanelNode.style.display = minimal ? 'none' : 'block';
        }
        if (this.layerTooltipNode) {
            this.layerTooltipNode.style.display = 'none';
        }
        if (this.viewModeButton) {
            this.viewModeButton.textContent = minimal ? 'MODE: MINIMAL' : 'MODE: DETAILED';
            this.viewModeButton.style.borderColor = minimal
                ? 'rgba(230, 193, 90, 0.58)'
                : 'rgba(125, 138, 156, 0.34)';
            this.viewModeButton.style.color = minimal ? '#f0dca2' : '#c6d0db';
        }
        if (this.puzzleModeButton) {
            this.puzzleModeButton.style.display = minimal ? 'none' : 'block';
        }
        if (this.noiseModeButton) {
            this.noiseModeButton.style.display = minimal ? 'none' : 'block';
        }
        if (this.readModeButton) {
            this.readModeButton.style.display = minimal ? 'none' : 'block';
        }
        this.applyReadModeVisibility();
    }

    toggleViewDensityMode() {
        this.viewDensityMode = this.viewDensityMode === 'minimal' ? 'detailed' : 'minimal';
        this.applyViewDensityMode();
    }

    togglePuzzleDetailMode() {
        this.puzzleDetailMode = this.puzzleDetailMode === 'overview' ? 'deep-dive' : 'overview';
        if (this.puzzleModeButton) {
            const isOverview = this.puzzleDetailMode === 'overview';
            this.puzzleModeButton.textContent = isOverview ? 'PUZZLE: OVERVIEW' : 'PUZZLE: DEEP DIVE';
            this.puzzleModeButton.style.borderColor = isOverview
                ? 'rgba(125, 138, 156, 0.34)'
                : 'rgba(230, 193, 90, 0.58)';
            this.puzzleModeButton.style.color = isOverview ? '#c6d0db' : '#f0dca2';
        }
        this.updatePacketLifecycleUI();
    }

    toggleNoiseDetailMode() {
        this.noiseDetailMode = this.noiseDetailMode === 'dense' ? 'normal' : 'dense';
        if (this.noiseModeButton) {
            const dense = this.noiseDetailMode === 'dense';
            this.noiseModeButton.textContent = dense ? 'NOISE: DENSE' : 'NOISE: NORMAL';
            this.noiseModeButton.style.borderColor = dense
                ? 'rgba(230, 193, 90, 0.58)'
                : 'rgba(125, 138, 156, 0.34)';
            this.noiseModeButton.style.color = dense ? '#f0dca2' : '#c6d0db';
        }
        Object.keys(this.layerBranchMetricDelta || {}).forEach((layerId) => {
            const deltas = this.layerBranchMetricDelta[layerId];
            if (Array.isArray(deltas)) {
                this.layerBranchMetricDelta[layerId] = deltas.map((v) => Number(v) || 0);
            }
        });
    }

    applyReadModeVisibility() {
        if (this.viewDensityMode === 'minimal') return;
        const mode = this.readMode;
        const showLayers = mode !== 'scene';
        const showChips = mode !== 'scene';
        const showGalaxy = mode !== 'scene';
        const showLifecycle = mode === 'forensics';

        if (this.layersPanelNode) this.layersPanelNode.style.display = showLayers ? 'block' : 'none';
        if (this.chipLayerNode) this.chipLayerNode.style.display = showChips ? 'block' : 'none';
        if (this.galaxyPanelNode) this.galaxyPanelNode.style.display = showGalaxy ? 'block' : 'none';
        if (this.lifecyclePanelNode) this.lifecyclePanelNode.style.display = showLifecycle ? 'block' : 'none';

        if (this.noiseModeButton) this.noiseModeButton.style.display = mode === 'forensics' ? 'block' : 'none';
        if (this.puzzleModeButton) this.puzzleModeButton.style.display = mode === 'forensics' ? 'block' : 'none';
    }

    toggleReadMode() {
        const order = ['scene', 'ops', 'forensics'];
        const idx = order.indexOf(this.readMode);
        this.readMode = order[(idx + 1) % order.length];
        if (this.readModeButton) {
            if (this.readMode === 'scene') {
                this.readModeButton.textContent = 'READ: SCENE';
                this.readModeButton.style.borderColor = 'rgba(130, 204, 240, 0.58)';
                this.readModeButton.style.color = '#9bd4f2';
            } else if (this.readMode === 'ops') {
                this.readModeButton.textContent = 'READ: OPS';
                this.readModeButton.style.borderColor = 'rgba(230, 193, 90, 0.58)';
                this.readModeButton.style.color = '#f0dca2';
            } else {
                this.readModeButton.textContent = 'READ: FORENSICS';
                this.readModeButton.style.borderColor = 'rgba(125, 138, 156, 0.34)';
                this.readModeButton.style.color = '#c6d0db';
            }
        }
        this.applyReadModeVisibility();
        this.updatePacketLifecycleUI();
        this.updateModePanel();
    }

    // Reflect read mode + live load on the left operation-mode rail.
    updateModePanel() {
        if (!this.modeCells) return;
        const readToMode = { scene: 'monitor', ops: 'system', forensics: 'diagnostic' };
        const lit = new Set(['active', readToMode[this.readMode] || 'monitor']);
        Object.keys(this.modeCells).forEach((id) => {
            const c = this.modeCells[id];
            if (!c) return;
            const on = lit.has(id);
            c.cell.style.background = on ? 'rgba(20, 46, 60, 0.8)' : 'rgba(14, 19, 28, 0.66)';
            c.cell.style.borderColor = on ? 'rgba(103, 190, 224, 0.55)' : 'rgba(96, 110, 128, 0.28)';
            c.cell.style.borderLeftColor = on ? 'rgba(103, 190, 224, 0.95)' : 'rgba(96, 110, 128, 0.4)';
            c.name.style.color = on ? '#dff1fa' : '#8190a0';
        });
    }

    selectGalaxy(id) {
        if (!id || !this.galaxyNodes[id]) return;
        this.selectedGalaxy = id;
        this.refreshGalaxySelectionUI();
    }

    refreshGalaxySelectionUI() {
        const data = this.galaxyStateData || {};
        Object.entries(this.galaxyNodes).forEach(([id, node]) => {
            const item = data[id];
            if (!item) return;
            const tone = this.getHealthTone(item.level || 'normal');
            const selected = this.selectedGalaxy === id;
            node.style.background = selected ? tone.bg.replace('0.68', '0.9') : tone.bg;
            node.style.borderColor = selected ? '#d9e4f0' : tone.border;
            node.style.color = tone.text;
            node.style.boxShadow = selected ? '0 0 0 1px rgba(170, 188, 206, 0.45)' : 'none';
            node.textContent = `${item.label}: ${item.value}`;
        });

        if (this.galaxyExplainNode) {
            const active = data[this.selectedGalaxy];
            if (active) {
                window.setSafeHtml(this.galaxyExplainNode, `
                    <span style="color:#d4dde7">${active.label}</span>:
                    <span style="color:#aeb8c3">${active.explain}</span>
                `);
            } else {
                this.galaxyExplainNode.textContent = 'Select a galaxy to inspect subsystem health.';
            }
        }
    }

    getPacketLifecycleIndex() {
        if (!this.packet || !this.layerMap || !Number.isFinite(this.packet.position.y)) return 0;
        const yTop = Number(this.layerMap.userspace ?? 3.5) + 0.5;
        const yBottom = Number(this.layerMap.nic ?? -3.4) - 0.75;
        const range = Math.max(0.001, yTop - yBottom);
        const progress = (yTop - this.packet.position.y) / range;
        const clamped = Math.max(0, Math.min(0.999, progress));
        return Math.floor(clamped * this.packetLifecycleStages.length);
    }

    updatePacketLifecycleUI() {
        if (!this.lifecyclePanelNode) return;
        // While IP/TCP map or morph is open, keep the right panel frozen — no live rewrites.
        if (
            this.ipMapPinned || this.tcpMapPinned || this.nfMapPinned || this.sockMapPinned
            || this.drillLayerId === 'ip' || this.drillLayerId === 'tcp' || this.drillLayerId === 'netfilter'
            || this.drillLayerId === 'socket'
            || this.ipMorphTarget || this.tcpMorphTarget || this.nfMorphTarget || this.sockMorphTarget
        ) {
            return;
        }
        const idx = this.getPacketLifecycleIndex();
        const stage = this.packetLifecycleStages[Math.max(0, Math.min(this.packetLifecycleStages.length - 1, idx))] || 'NIC RX';
        const activeCoreNode = this.lifecycleStageToNode[stage] || 'skb';
        const focusByGalaxy = {
            physical: new Set(['hardware', 'interrupt', 'napi']),
            packet: new Set(['skb', 'xdp', 'tc', 'netfilter']),
            state: new Set(['conntrack', 'routing', 'transport', 'socket']),
            security: new Set(['netfilter', 'conntrack', 'security', 'crypto']),
            observability: new Set(['observability', 'ebpf', 'userspace'])
        };
        const focused = focusByGalaxy[this.selectedGalaxy] || new Set(['conntrack', 'routing', 'transport']);
        const activeLinkedSide = new Set(this.coreToSideLinks[activeCoreNode] || []);
        const sideNodeById = this.puzzleSideNodes.reduce((acc, node) => {
            acc[node.id] = node;
            return acc;
        }, {});
        const coreNodeById = this.puzzleCoreNodes.reduce((acc, node) => {
            acc[node.id] = node;
            return acc;
        }, {});

        const renderPuzzleNode = (node, active = false, softActive = false, emphasized = false) => {
            const bg = active
                ? 'rgba(88, 182, 216, 0.34)'
                : (softActive ? 'rgba(230, 193, 90, 0.14)' : 'rgba(16, 22, 32, 0.72)');
            const border = active
                ? 'rgba(159, 233, 255, 0.88)'
                : (softActive ? 'rgba(230, 193, 90, 0.5)' : 'rgba(115, 128, 145, 0.34)');
            const text = active ? '#ecfbff' : (softActive ? '#f2e2b5' : '#bac4cf');
            const navHref = node.id === 'crypto'
                ? '/linux-crypto-subsystem'
                : (node.id === 'security' ? '/linux-security-subsystem' : '');
            const navAttrs = navHref
                ? ` data-ns-nav="${navHref}" title="Open ${node.label} subsystem" role="link"`
                : '';
            const navStyle = navHref
                ? 'cursor:pointer; text-decoration:none;'
                : '';
            const tagLine = navHref
                ? `${node.tags} · open →`
                : node.tags;
            return `
                <span${navAttrs} style="
                    display:inline-block;
                    margin:2px 3px 3px 0;
                    padding:4px 8px;
                    border-radius:6px;
                    border:${active ? '2px' : '1px'} solid ${border};
                    background:${bg};
                    color:${text};
                    font-size:9px;
                    line-height:1.25;
                    white-space:nowrap;
                    box-shadow:${emphasized ? '0 0 0 1px rgba(230,193,90,0.35), 0 0 14px rgba(126,220,246,0.3)' : 'none'};
                    ${navStyle}
                ">
                    <span style="color:${text};font-size:9px">${node.label}</span>
                    <span style="display:block;color:#7f8fa2;font-size:8px">${tagLine}</span>
                </span>
            `;
        };

        const rxPath = this.packetLifecycleStages.map((item, i) => (
            i === idx ? `<span style="color:#f0dca2">${item}</span>` : `<span style="color:#8d99a7">${item}</span>`
        )).join(' &rarr; ');
        const txPath = this.txLifecycleStages.map((item) => `<span style="color:#8d99a7">${item}</span>`).join(' &rarr; ');
        const renderCoreRow = (nodes) => nodes.map((node, i) => {
            const next = i < nodes.length - 1 ? '<span style="color:#556273">→</span>' : '';
            const isActive = node.id === activeCoreNode;
            const soft = focused.has(node.id) && !isActive;
            return `${renderPuzzleNode(node, isActive, soft, isActive)}${next}`;
        }).join('');
        const coreTop = renderCoreRow(this.puzzleCoreNodes.slice(0, 7));
        const coreBottom = renderCoreRow(this.puzzleCoreNodes.slice(7));

        const renderCluster = (cluster) => {
            const items = cluster.nodes.map((id) => {
                const node = sideNodeById[id];
                if (!node) return '';
                const linked = activeLinkedSide.has(id);
                const soft = focused.has(id) || linked;
                return renderPuzzleNode(node, false, soft, linked);
            }).join('');
            return `
                <div style="margin-bottom:4px;">
                    <span style="color:#6f7f92;margin-right:6px;">${cluster.label}</span>${items}
                </div>
            `;
        };
        const clusteredSidePuzzle = this.sideClusters.map((cluster) => renderCluster(cluster)).join('');

        const interactionLinks = (this.coreToSideLinks[activeCoreNode] || [])
            .map((sideId) => {
                const side = sideNodeById[sideId];
                const core = coreNodeById[activeCoreNode];
                if (!side || !core) return '';
                return `<span style="color:#aeb8c3">${core.label}</span> <span style="color:#5f6f82">↔</span> <span style="color:#f0dca2">${side.label}</span>`;
            })
            .filter(Boolean)
            .join(' <span style="color:#5f6f82">|</span> ');
        const selectedLinks = [...focused]
            .map((id) => sideNodeById[id] || coreNodeById[id])
            .filter(Boolean)
            .map((node) => `<span style="color:#8d99a7">${node.label}</span>`)
            .join(', ');

        const isOverview = this.puzzleDetailMode === 'overview';
        const summarySide = (this.coreToSideLinks[activeCoreNode] || [])
            .map((id) => sideNodeById[id]?.label || '')
            .filter(Boolean)
            .join(', ');

        if (isOverview) {
            window.setSafeHtml(this.lifecyclePanelNode, `
                <div style="font-size:10px;color:#7f8fa2;letter-spacing:0.6px;margin-bottom:5px;">
                    LINUX NETWORKING PUZZLE ARCHITECTURE
                </div>
                <div style="margin-bottom:5px;line-height:1.4;">
                    ${coreTop}
                </div>
                <div style="margin-bottom:6px;line-height:1.4;">
                    ${coreBottom}
                </div>
                <div style="margin-bottom:5px;color:#7f8fa2;">
                    Active interactions: ${interactionLinks || '<span style="color:#8d99a7">none</span>'}
                </div>
                <div style="margin-bottom:4px;color:#7f8fa2;">
                    Linked subsystems: <span style="color:#aeb8c3">${summarySide || 'none'}</span>
                </div>
                <div style="margin-bottom:3px;">RX: ${rxPath}</div>
                <div style="margin-bottom:3px;">TX: ${txPath}</div>
                <div style="color:#aeb8c3;font-size:10px;">
                    Active puzzle: <span style="color:#f0dca2">${stage}</span>
                </div>
            `);
            return;
        }

        window.setSafeHtml(this.lifecyclePanelNode, `
            <div style="font-size:10px;color:#7f8fa2;letter-spacing:0.6px;margin-bottom:5px;">
                LINUX NETWORKING PUZZLE ARCHITECTURE
            </div>
            <div style="margin-bottom:5px;line-height:1.4;">
                ${coreTop}
            </div>
            <div style="margin-bottom:6px;line-height:1.4;">
                ${coreBottom}
            </div>
            <div style="margin-bottom:6px;line-height:1.4;">
                ${clusteredSidePuzzle}
            </div>
            <div style="margin-bottom:5px;color:#7f8fa2;">
                Active interactions: ${interactionLinks || '<span style="color:#8d99a7">none</span>'}
            </div>
            <div style="margin-bottom:4px;color:#7f8fa2;">
                Galaxy focus: ${selectedLinks || '<span style="color:#8d99a7">none</span>'}
            </div>
            <div style="margin-bottom:3px;">RX flow: ${rxPath}</div>
            <div style="margin-bottom:3px;">TX flow: ${txPath}</div>
            <div style="color:#aeb8c3;font-size:10px;">
                Current active puzzle: <span style="color:#f0dca2">${stage}</span>
            </div>
        `);
    }

    updateGalaxyPanel(m, flow) {
        if (!this.galaxyPanelNode) return;
        const safeNum = (value) => {
            const n = Number(value);
            return Number.isFinite(n) ? n : 0;
        };
        const nicErr = safeNum(m.nic?.rx_errors) + safeNum(m.nic?.tx_errors);
        const txq = safeNum(m.driver?.tx_queue);
        const drops = safeNum(m.netfilter?.drop_per_sec);
        const dropRatio = safeNum(m.netfilter?.drop_ratio);
        const rtt = safeNum(m.tcp_udp?.rtt_ms);
        const retrans = safeNum(m.tcp_udp?.retrans_per_sec ?? m.socket_api?.retransmits_per_sec);
        const established = safeNum(m.socket_api?.established);
        const flowType = String(flow?.type || 'TCP').toUpperCase();
        const flowState = String(flow?.state_name || 'NO_FLOW');

        const health = (warn, crit, value) => (value >= crit ? 'critical' : (value >= warn ? 'warn' : 'normal'));

        const physicalLevel = health(120, 300, txq + nicErr * 8);
        const packetLevel = (dropRatio > 0.2 || drops > 20) ? 'critical' : ((dropRatio > 0.05 || drops > 7) ? 'warn' : 'normal');
        const stateLevel = health(8, 25, retrans + rtt / 20);
        const securityLevel = packetLevel;
        const observabilityLevel = flow ? 'normal' : 'warn';
        this.galaxyStateData = {
            physical: {
                label: 'Physical',
                value: `txq ${txq} err ${nicErr}`,
                level: physicalLevel,
                explain: `NIC/driver pressure. High txq or NIC errors means hardware queues are saturated or unstable.`
            },
            packet: {
                label: 'Packet',
                value: `drop ${drops.toFixed(1)}/s`,
                level: packetLevel,
                explain: `Packet metabolism quality. Drop rate shows where the flow is being lost before delivery.`
            },
            state: {
                label: 'State',
                value: `rtt ${rtt.toFixed(1)}ms rt ${retrans.toFixed(1)}/s`,
                level: stateLevel,
                explain: `Transport/conntrack dynamics. RTT and retransmits indicate congestion and connection stress.`
            },
            security: {
                label: 'Security',
                value: `ratio ${(dropRatio * 100).toFixed(1)}%`,
                level: securityLevel,
                explain: `Netfilter behavior. Higher drop ratio may be policy enforcement, attack filtering, or misconfiguration.`
            },
            observability: {
                label: 'Observability',
                value: `${flowType} ${flowState} est ${established}`,
                level: observabilityLevel,
                explain: `Current flow visibility. Shows active connection state and whether telemetry sees stable sessions.`
            }
        };

        if (!this.galaxyStateData[this.selectedGalaxy]) {
            this.selectedGalaxy = 'state';
        }
        this.refreshGalaxySelectionUI();
    }

    addExitButton() {
        if (this.exitButton && this.exitButton.parentNode) {
            this.exitButton.parentNode.removeChild(this.exitButton);
        }
        const exitBtn = document.createElement('button');
        exitBtn.textContent = 'EXIT VIEW';
        exitBtn.className = 'network-stack-exit-button';
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
            transition: all 0.25s ease;
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
            if (window.kernelContextMenu) {
                window.kernelContextMenu.deactivateViews();
            } else {
                // Standalone page (e.g. /linux-network-subsystem): go home like
                // the other subsystem pages instead of leaving a blank view.
                window.location.assign('/');
            }
        };
        this.container.appendChild(exitBtn);
        this.exitButton = exitBtn;
    }

    triggerDrop() {
        const y = this.layerMap.netfilter;
        const burst = new THREE.Mesh(
            new THREE.SphereGeometry(0.36, 12, 12),
            new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.7 })
        );
        burst.position.set(this.packet.position.x, y, this.packet.position.z);
        burst.userData = { ttl: 0.55, kind: 'drop' };
        this.scene.add(burst);
        this.fxBursts.push(burst);
    }

    triggerRetransmit() {
        const y = this.layerMap.tcp;
        const offsets = [-0.45, 0.45];
        offsets.forEach(offset => {
            const ghost = new THREE.Mesh(
                new THREE.SphereGeometry(0.14, 10, 10),
                new THREE.MeshBasicMaterial({ color: 0x58b6d8, transparent: true, opacity: 0.65 })
            );
            ghost.position.set(offset * 0.4, y, 0);
            ghost.userData = { ttl: 0.65, vx: offset * 0.9 };
            this.scene.add(ghost);
            this.fxBursts.push(ghost);
        });
    }

    resetPacketLoop() {
        if (!this.packet || !this.layerMap) return;
        this.packet.position.y = this.layerMap.userspace + 0.5;
        this.packetMorphPhase = -1;
        this.packetMorphCtx = null;
        this.packetMorphPulse = 0;
        this.setPacketMorphVisible(false);
        this.packet.scale.setScalar(1);
        if (this.packetGlow) this.packetGlow.scale.setScalar(1);
        this.updatePacketColorByFlow();
    }

    updatePacket(dt) {
        if (!this.packet) return;

        this.packet.position.y -= this.packetSpeed * dt;
        if (this.packetGlow) {
            this.packetGlow.position.copy(this.packet.position);
            if (this.packetMorphPhase < 0) {
                this.packetGlow.scale.setScalar(1 + Math.sin(performance.now() * 0.008) * 0.1);
            }
        }

        // Retransmit visual on TCP/UDP layer.
        this.retransmitCooldown -= dt;
        if (this.retransmitCooldown <= 0 && Math.abs(this.packet.position.y - this.layerMap.tcp) < 0.08) {
            if (Math.random() < this.retransmitProbability) {
                this.triggerRetransmit();
                this.retransmitCooldown = 1.4;
            }
        }

        // Drop visual on Netfilter.
        this.dropCooldown -= dt;
        if (this.dropCooldown <= 0 && Math.abs(this.packet.position.y - this.layerMap.netfilter) < 0.08) {
            if (Math.random() < this.dropProbability) {
                this.triggerDrop();
                this.resetPacketLoop();
                this.dropCooldown = 1.8;
                return;
            }
        }

        // NIC -> wire -> remote reached; restart packet loop.
        if (this.packet.position.y < this.layerMap.nic - 0.75) {
            this.resetPacketLoop();
        }

        // Trail follows packet.
        for (let i = this.packetTrail.length - 1; i > 0; i--) {
            this.packetTrail[i].position.lerp(this.packetTrail[i - 1].position, 0.65);
        }
        if (this.packetTrail[0]) {
            this.packetTrail[0].position.lerp(this.packet.position, 0.65);
        }

        this.updatePacketMorph();
    }

    updatePacketColorByFlow() {
        if (!this.packet || !this.packet.material || !this.telemetryData?.flow) return;
        const flowType = String(this.telemetryData.flow.type || '').toUpperCase();
        const color = flowType.includes('UDP') ? 0x58b6d8 : 0xE6C15A;
        this.packet.material.color.setHex(color);
        if (this.packetGlow?.material) {
            this.packetGlow.material.color.setHex(color);
        }
    }

    getHealthTone(level) {
        if (level === 'critical') {
            return { bg: 'rgba(65, 20, 24, 0.74)', border: 'rgba(226, 106, 118, 0.65)', text: '#ffb8c0', dot: 'rgba(232, 96, 104, 0.95)', glow: 'rgba(232, 96, 104, 0.55)' };
        }
        if (level === 'warn') {
            return { bg: 'rgba(64, 52, 22, 0.72)', border: 'rgba(226, 193, 102, 0.64)', text: '#f2d89b', dot: 'rgba(230, 193, 90, 0.95)', glow: 'rgba(230, 193, 90, 0.5)' };
        }
        // Idle/healthy stays calm: muted neutral dot so only warn/critical pop.
        return { bg: 'rgba(16, 22, 32, 0.68)', border: 'rgba(115, 128, 145, 0.32)', text: '#bac4cf', dot: 'rgba(122, 150, 168, 0.6)', glow: 'rgba(0, 0, 0, 0)' };
    }

    updateKpiCard(id, value, level = 'normal') {
        const node = this.kpiNodes[id];
        if (!node) return;
        const tone = this.getHealthTone(level);
        node.value.textContent = String(value ?? '--');
        node.card.style.background = tone.bg;
        node.card.style.borderColor = tone.border;
        node.value.style.color = tone.text;
    }

    setMetricChip(id, label, value, level = 'normal') {
        const tone = this.getHealthTone(level);
        const chip = this.metricChips[id];
        if (chip) {
            chip.textContent = `${label} ${value}`;
            chip.style.background = tone.bg;
            chip.style.borderColor = tone.border;
            chip.style.color = tone.text;
        }
        // Mirror health onto the left row's status dot so the whole row reads as
        // one unit (name · lane · metric) with a single health signal.
        const row = this.layerRows && this.layerRows[id];
        if (row && row.dot) {
            row.dot.style.background = tone.dot;
            row.dot.style.boxShadow = level === 'normal' ? 'none' : `0 0 8px ${tone.glow}`;
            if (row.name) row.name.style.color = level === 'normal' ? '#cdd6e0' : tone.text;
        }
    }

    updateTelemetryUI() {
        if (!this.telemetryData) return;
        const m = this.telemetryData.layer_metrics || {};
        const a = this.telemetryData.layer_activity || {};
        const flow = this.telemetryData.flow;
        const flowType = String(flow?.type || 'TCP').toUpperCase();
        const flowState = String(flow?.state_name || '');
        const safeNum = (value) => {
            const n = Number(value);
            return Number.isFinite(n) ? n : 0;
        };

        const rttMs = safeNum(m.tcp_udp?.rtt_ms ?? 0);
        const retransPerSec = safeNum(m.tcp_udp?.retrans_per_sec ?? m.socket_api?.retransmits_per_sec ?? 0);
        const dropPerSec = safeNum(m.netfilter?.drop_per_sec ?? 0);
        const dropRatio = safeNum(m.netfilter?.drop_ratio ?? 0);
        const driverTxQ = safeNum(m.driver?.tx_queue ?? 0);
        const nicErrRx = safeNum(m.nic?.rx_errors ?? 0);
        const nicErrTx = safeNum(m.nic?.tx_errors ?? 0);
        const nicErrTotal = nicErrRx + nicErrTx;

        const classify = (value, warnThreshold, critThreshold) => {
            if (value >= critThreshold) return 'critical';
            if (value >= warnThreshold) return 'warn';
            return 'normal';
        };
        const dropLevel = (dropRatio >= 0.2 || dropPerSec >= 25)
            ? 'critical'
            : ((dropRatio >= 0.05 || dropPerSec >= 8) ? 'warn' : 'normal');
        const retransLevel = classify(retransPerSec, 8, 25);
        const rttLevel = classify(rttMs, 90, 200);
        const driverLevel = classify(driverTxQ, 120, 300);
        const nicLevel = classify(nicErrTotal, 5, 20);

        if (this.flowNode) {
            if (flow) {
                const remote = flow.remote || 'remote';
                this.flowNode.innerHTML = '';
                const prefix = document.createTextNode(
                    `process -> syscall -> socket -> ${flowType} ${flowState} -> IP -> NIC -> wire -> `
                );
                const remoteSpan = document.createElement('span');
                remoteSpan.textContent = remote;
                if (this.flowFollow?.remote) {
                    remoteSpan.style.color = '#e6c15a';
                    remoteSpan.style.textShadow = '0 0 8px rgba(230,193,90,0.35)';
                    this.flowNode.style.borderColor = 'rgba(230,193,90,0.55)';
                    this.flowNode.style.boxShadow = '0 0 14px rgba(230,193,90,0.12)';
                } else {
                    remoteSpan.style.color = '';
                    this.flowNode.style.borderColor = 'rgba(90, 104, 120, 0.32)';
                    this.flowNode.style.boxShadow = 'none';
                }
                this.flowNode.appendChild(prefix);
                this.flowNode.appendChild(remoteSpan);
            } else {
                this.flowNode.textContent = 'process -> syscall -> socket -> TCP -> IP -> NIC -> wire -> remote (no active flow)';
            }
        }

        this.updateKpiCard('flow', `${flowType}${flowState ? ` ${flowState}` : ''}`, flow ? 'normal' : 'warn');
        if (this.arrayDesignator) this.arrayDesignator.textContent = flowType || 'TCP';
        this.updateKpiCard('rtt', `${rttMs.toFixed(1)} ms`, rttLevel);
        this.updateKpiCard('drop', `${dropPerSec.toFixed(1)}/s`, dropLevel);
        this.updateKpiCard('retrans', `${retransPerSec.toFixed(1)}/s`, retransLevel);

        this.setMetricChip('userspace', 'USERSPACE', `procs ${m.userspace?.active_processes ?? 0}`);
        this.setMetricChip(
            'socket',
            'SOCKET',
            `est ${m.socket_api?.established ?? 0} retrans ${safeNum(m.socket_api?.retransmits_per_sec ?? 0).toFixed(1)}/s`,
            retransLevel
        );
        this.setMetricChip(
            'tcp',
            'TCP',
            `cwnd ${m.tcp_udp?.cwnd ?? 0} rtt ${rttMs.toFixed(1)}ms retrans ${retransPerSec.toFixed(1)}/s`,
            rttLevel === 'critical' || retransLevel === 'critical'
                ? 'critical'
                : (rttLevel === 'warn' || retransLevel === 'warn' ? 'warn' : 'normal')
        );
        this.setMetricChip(
            'ip',
            'IP',
            `in ${safeNum(m.ip?.in_packets_per_sec ?? 0).toFixed(1)}/s out ${safeNum(m.ip?.out_packets_per_sec ?? 0).toFixed(1)}/s`
        );
        this.setMetricChip(
            'netfilter',
            'NETFILTER',
            `drop ${dropPerSec.toFixed(1)}/s ratio ${(dropRatio * 100).toFixed(1)}%`,
            dropLevel
        );
        this.setMetricChip(
            'driver',
            'DRIVER',
            `txq ${driverTxQ} drops ${safeNum(m.driver?.drops_per_sec ?? 0).toFixed(1)}/s`,
            driverLevel
        );
        this.setMetricChip(
            'nic',
            'NIC',
            `${m.nic?.iface ?? 'n/a'} err ${nicErrRx}/${nicErrTx}`,
            nicLevel
        );

        // Headline numbers shown on each chain's NUMBER block (the beam target):
        // the single most representative live figure for that layer.
        this.layerHeadline = {
            userspace: `${m.userspace?.active_processes ?? 0}`,
            socket: `${m.socket_api?.established ?? 0}`,
            tcp: `${rttMs.toFixed(1)} ms`,
            ip: `${(safeNum(m.ip?.in_packets_per_sec ?? 0) + safeNum(m.ip?.out_packets_per_sec ?? 0)).toFixed(0)}/s`,
            netfilter: `${dropPerSec.toFixed(0)}/s`,
            driver: `${driverTxQ}`,
            nic: `${nicErrTotal}`
        };

        if (this.modeStatValue) {
            const procs = safeNum(m.userspace?.active_processes ?? 0);
            const est = safeNum(m.socket_api?.established ?? 0);
            this.modeStatValue.textContent = `${procs} · ${est}`;
        }
        this.updateModePanel();

        this.updateGalaxyPanel(m, flow);

        this.layerActivityTarget = {
            userspace: Number(a.userspace ?? this.layerActivityTarget.userspace),
            socket: Number(a.socket ?? this.layerActivityTarget.socket),
            tcp: Number(a.tcp ?? this.layerActivityTarget.tcp),
            ip: Number(a.ip ?? this.layerActivityTarget.ip),
            netfilter: Number(a.netfilter ?? this.layerActivityTarget.netfilter),
            driver: Number(a.driver ?? this.layerActivityTarget.driver),
            nic: Number(a.nic ?? this.layerActivityTarget.nic)
        };

        const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
        const userspaceProcs = safeNum(m.userspace?.active_processes ?? 0);
        const socketEst = safeNum(m.socket_api?.established ?? 0);
        const ipIn = safeNum(m.ip?.in_packets_per_sec ?? 0);
        const ipOut = safeNum(m.ip?.out_packets_per_sec ?? 0);
        const driverDrops = safeNum(m.driver?.drops_per_sec ?? 0);
        const flowIntensity = safeNum(this.packetSpeed || 0) / 5.2;
        const ipAsym = Math.abs(ipIn - ipOut) / Math.max(1, ipIn + ipOut);

        this.layerSemanticNoiseTarget = {
            userspace: {
                stress: clamp01(userspaceProcs / 320),
                jitter: clamp01(flowIntensity * 0.55 + userspaceProcs / 540),
                branch: clamp01(0.2 + userspaceProcs / 500)
            },
            socket: {
                stress: clamp01(socketEst / 180 + retransPerSec / 44),
                jitter: clamp01(retransPerSec / 34 + flowIntensity * 0.25),
                branch: clamp01(0.24 + socketEst / 260)
            },
            tcp: {
                stress: clamp01(rttMs / 260 + retransPerSec / 34),
                jitter: clamp01(retransPerSec / 24 + rttMs / 420),
                branch: clamp01(0.25 + retransPerSec / 30)
            },
            ip: {
                stress: clamp01((ipIn + ipOut) / 9000 + ipAsym * 0.7),
                jitter: clamp01(ipAsym + flowIntensity * 0.2),
                branch: clamp01(0.2 + (ipIn + ipOut) / 13000)
            },
            netfilter: {
                stress: clamp01(dropRatio * 2.6 + dropPerSec / 24),
                jitter: clamp01(dropPerSec / 16 + dropRatio * 1.6),
                branch: clamp01(0.22 + dropRatio * 2.1)
            },
            driver: {
                stress: clamp01(driverTxQ / 360 + driverDrops / 22),
                jitter: clamp01(driverTxQ / 470 + driverDrops / 15),
                branch: clamp01(0.22 + driverTxQ / 500)
            },
            nic: {
                stress: clamp01(nicErrTotal / 30 + driverTxQ / 650),
                jitter: clamp01(nicErrTotal / 18 + flowIntensity * 0.2),
                branch: clamp01(0.2 + nicErrTotal / 28)
            }
        };

        this.layerBranchSignalTarget = {
            userspace: [
                clamp01(userspaceProcs / 320),
                clamp01(flowIntensity),
                clamp01((userspaceProcs * 0.08 + socketEst * 0.25) / 120)
            ],
            socket: [
                clamp01(socketEst / 180),
                clamp01((socketEst * 0.18 + retransPerSec * 4) / 60),
                clamp01(retransPerSec / 26)
            ],
            tcp: [
                clamp01(safeNum(m.tcp_udp?.cwnd ?? 0) / 240),
                clamp01(rttMs / 260),
                clamp01(retransPerSec / 20)
            ],
            ip: [
                clamp01(ipIn / 5500),
                clamp01(ipOut / 5500),
                clamp01(ipAsym)
            ],
            netfilter: [
                clamp01(dropRatio * 2.4),
                clamp01(dropPerSec / 20),
                clamp01((dropRatio * 120 + dropPerSec) / 30)
            ],
            driver: [
                clamp01(driverTxQ / 360),
                clamp01(driverDrops / 18),
                clamp01((driverTxQ + driverDrops * 8) / 520)
            ],
            nic: [
                clamp01(nicErrRx / 14),
                clamp01(nicErrTx / 14),
                clamp01(nicErrTotal / 22 + flowIntensity * 0.25)
            ]
        };

        this.layerBranchMetricTarget = {
            userspace: [
                userspaceProcs,
                flowIntensity * 100,
                userspaceProcs * 0.08 + socketEst * 0.25
            ],
            socket: [
                socketEst,
                socketEst * 0.18 + retransPerSec * 4,
                retransPerSec
            ],
            tcp: [
                safeNum(m.tcp_udp?.cwnd ?? 0),
                rttMs,
                retransPerSec
            ],
            ip: [
                ipIn,
                ipOut,
                ipAsym
            ],
            netfilter: [
                dropRatio,
                dropPerSec,
                dropRatio * 100 + dropPerSec
            ],
            driver: [
                driverTxQ,
                driverDrops,
                driverTxQ * 0.6 + driverDrops * 3.5
            ],
            nic: [
                nicErrRx,
                nicErrTx,
                nicErrTotal * 4 + flowIntensity * 40
            ]
        };
        this.updateBranchMetricHistory(Date.now());
    }

    fetchTelemetry() {
        return window.fetchJson('/api/network-stack-realtime', { cache: 'no-store' }, {
            timeoutMs: 6000,
            suppressToast: true,
            context: 'network-stack-realtime'
        })
            .then(data => {
                if (!data || data.error) {
                    throw new Error(data?.error || 'No telemetry data');
                }
                this.telemetryData = data;
                this.dropProbability = Math.max(0.03, Math.min(0.75, Number(data.signals?.drop_probability ?? 0.2)));
                this.retransmitProbability = Math.max(0.04, Math.min(0.75, Number(data.signals?.retransmit_probability ?? 0.28)));
                this.packetSpeed = Math.max(1.1, Math.min(5.2, Number(data.signals?.packet_speed ?? 2.2)));
                this.applyFlowFollowOverride();
                this.updatePacketColorByFlow();
                this.updateTelemetryUI();
                this.syncPathHopDistance();
                this.recordBbrSample();
                // Do not rebuild drill/morph overlays on every poll — user needs time to read.
                const freezeDrill = (
                    this.drillLayerId === 'ip' || this.drillLayerId === 'tcp' || this.drillLayerId === 'netfilter'
                    || this.drillLayerId === 'socket'
                    || this.ipMorphTarget || this.tcpMorphTarget || this.nfMorphTarget || this.sockMorphTarget
                );
                if (freezeDrill) {
                    // freeze: keep current overlay DOM + frozen snapshots
                } else if (this.drillLayerId) {
                    this.openLayerDrilldown(this.drillLayerId);
                }
                if (this.bbrOpen && !freezeDrill) {
                    this.openBbrOverlay();
                }
                this.maybeApplyFlowFollowDeepLink();
                if (this.telemetryErrorNode) {
                    this.telemetryErrorNode.textContent = '';
                }
            })
            .catch(err => {
                if (this.telemetryErrorNode) {
                    this.telemetryErrorNode.textContent = `telemetry fallback: ${err.message}`;
                }
            });
    }

    updateEffects(dt) {
        this.fxBursts = this.fxBursts.filter(obj => {
            const ttl = (obj.userData?.ttl || 0) - dt;
            obj.userData.ttl = ttl;
            if (obj.userData?.kind === 'drop') {
                obj.scale.setScalar(1 + (0.55 - Math.max(0, ttl)) * 2.1);
            } else if (obj.userData?.vx) {
                obj.position.x += obj.userData.vx * dt;
                obj.position.y -= 0.25 * dt;
            }
            if (obj.material && obj.material.opacity !== undefined) {
                obj.material.opacity = Math.max(0, ttl * 1.2);
            }
            if (ttl <= 0) {
                this.scene.remove(obj);
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) obj.material.dispose();
                return false;
            }
            return true;
        });
    }

    updateFlowParticles(dt) {
        const yMin = this.layerMap.nic - 0.9;
        const yMax = this.layerMap.userspace + 0.9;

        this.lineParticles.forEach(p => {
            p.position.y += p.userData.dir * p.userData.speed * dt;
            p.position.x += p.userData.drift * dt;
            if (p.position.y < yMin) p.position.y = yMax;
            if (p.position.y > yMax) p.position.y = yMin;
            if (Math.abs(p.position.x) > 0.18) p.userData.drift *= -1;
        });

        this.microPackets.forEach(m => {
            m.position.y += m.userData.dir * m.userData.speed * dt;
            m.position.x += m.userData.xDrift * dt;
            if (m.position.y < yMin - 0.4 || m.position.y > yMax + 0.4) {
                const dir = Math.random() < 0.8 ? -1 : 1;
                m.userData.dir = dir;
                m.userData.speed = 0.9 + Math.random() * (1.4 + this.packetSpeed * 0.3);
                m.userData.xDrift = (Math.random() - 0.5) * 0.35;
                m.position.y = dir < 0 ? yMax + Math.random() * 0.5 : yMin - Math.random() * 0.5;
                m.position.x = (Math.random() - 0.5) * 2.2;
                m.material.color.setHex(dir < 0 ? 0xE6C15A : 0x58b6d8);
            }
            m.material.opacity = 0.25 + Math.random() * 0.45;
        });
    }

    updateLayerStrips(dt) {
        const smooth = Math.min(1, dt * 4.2);
        this.layers.forEach(layer => {
            const id = layer.id;
            const current = Number(this.layerActivity[id] ?? 0.2);
            const target = Number(this.layerActivityTarget[id] ?? current);
            const blended = current + (target - current) * smooth;
            this.layerActivity[id] = blended;
            const actRaw = blended;
            const act = Math.max(0, Math.min(1, actRaw));
            const currentSemantic = this.layerSemanticNoise[id] || { stress: 0.2, jitter: 0.2, branch: 0.2 };
            const targetSemantic = this.layerSemanticNoiseTarget[id] || currentSemantic;
            const semanticBlend = Math.min(1, dt * 3.1);
            currentSemantic.stress += (targetSemantic.stress - currentSemantic.stress) * semanticBlend;
            currentSemantic.jitter += (targetSemantic.jitter - currentSemantic.jitter) * semanticBlend;
            currentSemantic.branch += (targetSemantic.branch - currentSemantic.branch) * semanticBlend;
            this.layerSemanticNoise[id] = currentSemantic;
            const semanticStress = Math.max(0, Math.min(1, currentSemantic.stress));
            const semanticJitter = Math.max(0, Math.min(1, currentSemantic.jitter));
            const semanticBranch = Math.max(0, Math.min(1, currentSemantic.branch));
            const targetSignals = this.layerBranchSignalTarget[id] || [];
            if (!this.layerBranchSignalCurrent[id]) {
                this.layerBranchSignalCurrent[id] = targetSignals.slice();
            } else {
                const currentSignals = this.layerBranchSignalCurrent[id];
                const signalCount = Math.max(currentSignals.length, targetSignals.length);
                for (let i = 0; i < signalCount; i++) {
                    const cur = Number(currentSignals[i] ?? 0.2);
                    const tgt = Number(targetSignals[i] ?? targetSignals[targetSignals.length - 1] ?? 0.2);
                    currentSignals[i] = cur + (tgt - cur) * Math.min(1, dt * 3.6);
                }
            }
            const targetMetrics = this.layerBranchMetricTarget[id] || [];
            if (!this.layerBranchMetricCurrent[id]) {
                this.layerBranchMetricCurrent[id] = targetMetrics.slice();
            } else {
                const currentMetrics = this.layerBranchMetricCurrent[id];
                const metricCount = Math.max(currentMetrics.length, targetMetrics.length);
                for (let i = 0; i < metricCount; i++) {
                    const cur = Number(currentMetrics[i] ?? 0);
                    const tgt = Number(targetMetrics[i] ?? targetMetrics[targetMetrics.length - 1] ?? 0);
                    currentMetrics[i] = cur + (tgt - cur) * Math.min(1, dt * 3.4);
                }
            }

            if (layer.mesh?.material) {
                layer.mesh.material.opacity = 0.03 + act * 0.09;
                layer.mesh.material.emissiveIntensity = 0.02 + act * 0.18;
            }
            if (layer.strip?.material) {
                layer.strip.scale.x = 0.14 + act * 0.86 + semanticStress * 0.14;
                layer.strip.material.opacity = 0.12 + act * 0.78 + semanticBranch * 0.06;
            }
            if (this.hideOsiTiles) {
                if (layer.mesh) layer.mesh.visible = false;
                if (layer.edge) layer.edge.visible = false;
                if (layer.strip) layer.strip.visible = false;
            }
            if (layer.noiseRig) {
                const rig = layer.noiseRig;
                const profile = rig.profile || {};
                const ringSpeed = Number(profile.ringRotateSpeed || 0.14);
                const pulseAmp = Number(profile.pulseAmp || 0.08);
                if (rig.hub?.material) {
                    rig.hub.material.opacity = 0.2 + act * 0.42 + semanticStress * 0.22;
                }
                if (rig.hub?.scale) {
                    const hubPulse = 1 + (0.02 + semanticJitter * 0.08) * Math.sin((performance.now() * 0.0032) + (layer.id.length * 0.7));
                    rig.hub.scale.setScalar(hubPulse);
                }
                if (rig.ring?.material) {
                    rig.ring.material.opacity = 0.12 + act * 0.26 + semanticBranch * 0.24;
                    rig.ring.rotation.z += (ringSpeed + act * 0.15 + semanticJitter * 0.38) * dt;
                }
                if (Array.isArray(rig.supportRods)) {
                    rig.supportRods.forEach((rod, idx) => {
                        if (rod?.material) {
                            const pulse = 0.5 + 0.5 * Math.sin((performance.now() * 0.0018) + idx * 0.37);
                            rod.material.opacity = 0.06 + act * 0.12 + semanticBranch * 0.1 + pulse * 0.05;
                        }
                    });
                }
                if (Array.isArray(rig.arms)) {
                    const signals = this.layerBranchSignalCurrent[id] || [];
                    const metricValues = this.layerBranchMetricCurrent[id] || [];
                    const metricDeltas = this.layerBranchMetricDelta[id] || [];
                    rig.arms.forEach((armEntry, idx) => {
                        const arm = armEntry?.rod;
                        const signal = Number(signals[armEntry.signalIdx % Math.max(1, signals.length)] ?? semanticBranch);
                        armEntry.signal += (signal - armEntry.signal) * Math.min(1, dt * 4.5);
                        const armSignal = Math.max(0, Math.min(1, armEntry.signal));
                        if (arm?.material) {
                            const idxPulse = 0.5 + 0.5 * Math.sin((performance.now() * 0.0015) + idx * 0.42);
                            arm.material.opacity = 0.08
                                + act * (0.12 + (idx % 3) * 0.025)
                                + semanticBranch * 0.16
                                + armSignal * 0.22
                                + semanticJitter * idxPulse * 0.09;
                            const hue = 0.56 - armSignal * 0.34;
                            arm.material.color.setHSL(hue, 0.55, 0.54);
                        }
                        if (armEntry.signalTag?.sprite) {
                            const posPulse = Math.sin((performance.now() * 0.0021) + idx * 0.7) * (0.02 + semanticJitter * 0.04);
                            const tagPos = armEntry.start
                                .clone()
                                .lerp(armEntry.end, 0.56 + posPulse)
                                .add(armEntry.signalTagOffset);
                            armEntry.signalTag.sprite.position.copy(tagPos);
                            const metricValue = Number(metricValues[armEntry.signalIdx % Math.max(1, metricValues.length)] ?? armSignal * 100);
                            const metricDelta = Number(metricDeltas[armEntry.signalIdx % Math.max(1, metricDeltas.length)] ?? 0);
                            const denseTags = this.noiseDetailMode === 'dense' && this.readMode === 'forensics';
                            const signalText = this.formatBranchMetric(
                                id,
                                armEntry.signalIdx,
                                metricValue,
                                metricDelta,
                                denseTags
                            );
                            this.updateSignalTagSprite(armEntry.signalTag, signalText, armSignal, semanticJitter);
                            const modeOpacity = this.readMode === 'scene' ? 0.35 : (this.readMode === 'ops' ? 0.65 : 1);
                            armEntry.signalTag.sprite.material.opacity = (0.25 + armSignal * 0.7) * modeOpacity;
                            armEntry.signalTag.sprite.scale.set(
                                (1.2 + armSignal * 0.2) * (this.readMode === 'scene' ? 0.78 : 1),
                                (0.29 + armSignal * 0.05) * (this.readMode === 'scene' ? 0.78 : 1),
                                1
                            );
                        }
                        if (Array.isArray(armEntry?.beads)) {
                            armEntry.phase += dt * (0.22 + armSignal * 1.45 + semanticJitter * 0.55);
                            armEntry.beads.forEach((bead, bIdx) => {
                                if (!bead) return;
                                const t = (armEntry.phase + bIdx * 0.27) % 1;
                                const pos = armEntry.start.clone().lerp(armEntry.end, t);
                                bead.position.copy(pos);
                                if (bead.material) {
                                    bead.material.opacity = 0.14 + armSignal * 0.45 + semanticBranch * 0.16;
                                    const beadHue = 0.58 - armSignal * 0.4;
                                    bead.material.color.setHSL(beadHue, 0.62, 0.6);
                                }
                                const scale = 0.85 + armSignal * 0.9;
                                bead.scale.setScalar(scale);
                            });
                        }
                    });
                }
                if (Array.isArray(rig.satellites)) {
                    rig.satellites.forEach((dot, idx) => {
                        if (dot?.material) {
                            const pulse = 0.5 + 0.5 * Math.sin((performance.now() * 0.0025) + idx * 0.65);
                            dot.material.opacity = 0.1 + act * 0.2 + semanticBranch * 0.2 + pulse * (pulseAmp + semanticJitter * 0.12);
                        }
                    });
                }
            }
        });
    }

    getLayerTooltipContent(layerId) {
        const m = this.telemetryData?.layer_metrics || {};
        const safeNum = (value) => {
            const n = Number(value);
            return Number.isFinite(n) ? n : 0;
        };
        const labels = this.layerSignalLabels[layerId] || [];
        const metrics = this.layerBranchMetricCurrent[layerId] || [];
        const deltas = this.layerBranchMetricDelta[layerId] || [];
        const signalLine = labels.length
            ? labels.map((_, idx) => this.formatBranchMetric(
                layerId,
                idx,
                safeNum(metrics[idx] ?? 0),
                safeNum(deltas[idx] ?? 0),
                this.noiseDetailMode === 'dense' && this.readMode === 'forensics'
            ).replace('\n', ' ')).join(' | ')
            : '';
        const appendSignals = (body) => (
            `${body}${signalLine ? `<br><span style="color:#90a8bc">branches: ${signalLine}</span>` : ''}<br><span style="color:#6f8597; font-size:9px; letter-spacing:0.5px;">click to inspect →</span>`
        );

        if (layerId === 'userspace') {
            return appendSignals(`<strong>Userspace</strong><br>active processes: ${m.userspace?.active_processes ?? 0}`);
        }
        if (layerId === 'socket') {
            return appendSignals(`<strong>Socket API</strong><br>established: ${m.socket_api?.established ?? 0}<br>retransmits/s: ${m.socket_api?.retransmits_per_sec ?? 0}`);
        }
        if (layerId === 'tcp') {
            return appendSignals(`<strong>TCP/UDP</strong><br>cwnd: ${m.tcp_udp?.cwnd ?? 0}<br>rtt: ${m.tcp_udp?.rtt_ms ?? 0} ms<br>retrans/s: ${m.tcp_udp?.retrans_per_sec ?? 0}`);
        }
        if (layerId === 'ip') {
            return appendSignals(`<strong>IP</strong><br>packets in: ${m.ip?.in_packets_per_sec ?? 0}/s<br>packets out: ${m.ip?.out_packets_per_sec ?? 0}/s`);
        }
        if (layerId === 'netfilter') {
            return appendSignals(`<strong>Netfilter</strong><br>drop/s: ${m.netfilter?.drop_per_sec ?? 0}<br>drop ratio: ${((m.netfilter?.drop_ratio ?? 0) * 100).toFixed(2)}%`);
        }
        if (layerId === 'driver') {
            return appendSignals(`<strong>Driver</strong><br>tx queue: ${m.driver?.tx_queue ?? 0}<br>drops/s: ${m.driver?.drops_per_sec ?? 0}`);
        }
        if (layerId === 'nic') {
            return appendSignals(`<strong>NIC</strong><br>iface: ${m.nic?.iface ?? 'n/a'}<br>errors rx/tx: ${m.nic?.rx_errors ?? 0}/${m.nic?.tx_errors ?? 0}`);
        }
        return appendSignals(`<strong>${layerId}</strong>`);
    }

    // Static, teachable explainer for each stack layer (English).
    getLayerDrillInfo(layerId) {
        const info = {
            userspace: {
                title: 'USERSPACE',
                role: 'process → syscall',
                what: 'Applications talk to the network through socket syscalls (send/recv, sendmsg, epoll/poll). The kernel copies bytes between user-space buffers and the socket queues, then wakes the process when data is ready.',
                watch: 'Many processes with rising downstream RTT usually means apps are blocked on the network, not the CPU.',
                subsystems: ['socket() / connect()', 'epoll / poll', 'sendmsg / recvmsg', 'SO_* options']
            },
            socket: {
                title: 'SOCKET API',
                role: 'socket layer',
                what: 'The socket layer maps a file descriptor to a protocol socket (struct sock). It owns the accept queue for listeners and the send/receive buffers, applying backpressure when buffers fill.',
                watch: 'Accept-queue overflow and buffer exhaustion surface as connection resets and retransmits.',
                subsystems: ['struct sock / sk_buff', 'accept backlog', 'sndbuf / rcvbuf', 'SO_REUSEPORT']
            },
            tcp: {
                title: 'TCP / UDP',
                role: 'transport',
                what: 'TCP keeps a congestion window (cwnd) and estimates RTT to pace how fast it sends; lost or reordered segments trigger retransmission and window reduction. UDP is stateless — no cwnd, no retransmit.',
                watch: 'cwnd collapsing while RTT and retrans/s climb is the classic signature of congestion or loss on the path — see the BBR model view.',
                subsystems: ['cwnd / ssthresh', 'RTT / RTO estimator', 'SACK / reordering', 'congestion control']
            },
            ip: {
                title: 'IP',
                role: 'network layer',
                what: 'The IP layer makes the routing decision (FIB lookup), handles fragmentation/reassembly and TTL for every datagram before passing it up or down the stack.',
                watch: 'in/out packets per second is the raw forwarding load; InDiscards point at routing or buffer problems.',
                subsystems: ['FIB / routing table', 'fragmentation / TTL', 'ICMP', 'IPv4 / IPv6']
            },
            netfilter: {
                title: 'NETFILTER',
                role: 'firewall / NAT',
                what: 'Netfilter hooks run at PREROUTING…POSTROUTING to filter (firewall), rewrite (NAT) and track connections (conntrack). Stateful policy decisions and drops happen here.',
                watch: 'Rising drop/s and drop-ratio means packets are being filtered or conntrack is saturating.',
                subsystems: ['iptables / nftables', 'conntrack (NEW/ESTABLISHED)', 'NAT / masquerade', 'hook chains']
            },
            driver: {
                title: 'DRIVER',
                role: 'device driver',
                what: 'The NIC driver moves packets between the kernel and hardware over DMA ring buffers and TX queues. Incoming frames raise an IRQ, then NAPI/softirq polls the ring to drain them in batches.',
                watch: 'A growing TX queue or driver drops means the hardware / qdisc can’t keep up with the send rate.',
                subsystems: ['DMA rings', 'NAPI / softirq', 'TX queue / qdisc', 'GRO / GSO offload']
            },
            nic: {
                title: 'NIC',
                role: 'wire / PHY',
                what: 'The physical (or virtio) interface serializes frames onto the wire and receives them back. Hardware-level CRC / RX / TX errors and drops are counted here.',
                watch: 'Non-zero rx/tx errors point at cabling, duplex mismatch or a struggling virtual NIC — below the software stack.',
                subsystems: ['PHY / MAC', 'link speed / duplex', 'RX/TX error counters', 'virtio-net (cloud)']
            }
        };
        return info[layerId] || null;
    }

    // Real live metrics for the layer, pulled from the latest telemetry frame.
    getLayerDrillMetrics(layerId) {
        const m = this.telemetryData?.layer_metrics || {};
        const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
        const rows = {
            userspace: () => [['active processes', n(m.userspace?.active_processes)]],
            socket: () => [
                ['established', n(m.socket_api?.established)],
                ['active sockets', n(m.socket_api?.active_sockets)],
                ['retransmits/s', n(m.socket_api?.retransmits_per_sec)]
            ],
            tcp: () => [
                ['cwnd (segments)', n(m.tcp_udp?.cwnd)],
                ['rtt', `${n(m.tcp_udp?.rtt_ms).toFixed(1)} ms`],
                ['retrans/s', n(m.tcp_udp?.retrans_per_sec)],
                ['tx queue', n(m.tcp_udp?.tx_queue)]
            ],
            ip: () => [
                ['packets in/s', n(m.ip?.in_packets_per_sec).toFixed(0)],
                ['packets out/s', n(m.ip?.out_packets_per_sec).toFixed(0)],
                ['drop/s', n(m.ip?.drop_per_sec)],
                ['drop ratio', `${(n(m.ip?.drop_ratio) * 100).toFixed(2)}%`]
            ],
            netfilter: () => [
                ['drop/s', n(m.netfilter?.drop_per_sec)],
                ['drop ratio', `${(n(m.netfilter?.drop_ratio) * 100).toFixed(2)}%`],
                ['conntrack', `${n(m.netfilter?.conntrack_count)} / ${n(m.netfilter?.conntrack_max) || '—'}`],
                ['ct usage', `${(n(m.netfilter?.conntrack_usage) * 100).toFixed(2)}%`]
            ],
            driver: () => [
                ['iface', m.driver?.iface ?? 'n/a'],
                ['tx queue', n(m.driver?.tx_queue)],
                ['drops/s', n(m.driver?.drops_per_sec)],
                ['rx', `${n(m.driver?.rx_mb_s).toFixed(2)} MB/s`],
                ['tx', `${n(m.driver?.tx_mb_s).toFixed(2)} MB/s`]
            ],
            nic: () => [
                ['iface', m.nic?.iface ?? 'n/a'],
                ['rx errors', n(m.nic?.rx_errors)],
                ['tx errors', n(m.nic?.tx_errors)],
                ['drops total', n(m.nic?.drops_total)]
            ]
        };
        return (rows[layerId] || (() => []))();
    }

    getIpMapData() {
        if (this.ipMapFrozen) return this.ipMapFrozen;
        return this.telemetryData?.ip_map || { routes: [], neigh: [], icmp: {}, ip: {} };
    }

    freezeIpMapSnapshot() {
        const live = this.telemetryData?.ip_map || { routes: [], neigh: [], icmp: {}, ip: {} };
        try {
            this.ipMapFrozen = JSON.parse(JSON.stringify(live));
        } catch (_) {
            this.ipMapFrozen = live;
        }
    }

    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    ipv4ToBe32(ip) {
        const parts = String(ip || '').split('.').map((x) => Number(x));
        if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) {
            return null;
        }
        const host = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
        // Network byte order (big-endian) as stored in __be32 / sockaddr_in.
        const be = host;
        return {
            dotted: parts.join('.'),
            host,
            be,
            hex: `0x${be.toString(16).padStart(8, '0')}`,
            bytes: parts.map((n) => `0x${n.toString(16).padStart(2, '0')}`).join(' '),
        };
    }

    portToBe16(port) {
        const p = Number(port);
        if (!Number.isFinite(p) || p < 0 || p > 65535) return { port: 0, hex: '0x0000' };
        return { port: p, hex: `0x${p.toString(16).padStart(4, '0')}` };
    }

    macToHa(mac) {
        const parts = String(mac || '').toLowerCase().split(':').filter(Boolean);
        if (parts.length !== 6) return { mac: String(mac || '??'), ha: 'ha[] unfinished', bytes: [] };
        const bytes = parts.map((b) => `0x${b.padStart(2, '0')}`);
        return { mac: parts.join(':'), ha: `{ ${bytes.join(', ')} }`, bytes };
    }

    parseEndpoint(endpoint) {
        const value = String(endpoint || '').trim();
        if (!value) return { ip: '', port: null };
        const sep = value.lastIndexOf(':');
        if (sep <= 0) return { ip: value, port: null };
        const ip = value.slice(0, sep);
        const portNum = Number(value.slice(sep + 1));
        return { ip, port: Number.isFinite(portNum) ? portNum : null };
    }

    parseFlowFollowFromUrl() {
        try {
            const handed = window.__flowFollow;
            if (handed && handed.remote) {
                const { ip, port } = this.parseEndpoint(handed.remote);
                if (ip) {
                    return {
                        remote: handed.remote,
                        local: handed.local || '',
                        proto: String(handed.proto || 'TCP').toUpperCase(),
                        ip: handed.ip || ip,
                        port: handed.port != null ? handed.port : (port != null ? port : 443)
                    };
                }
            }
            const params = new URLSearchParams(window.location.search || '');
            const remote = String(params.get('remote') || '').trim();
            if (!remote) return null;
            const local = String(params.get('local') || '').trim();
            const proto = String(params.get('proto') || 'TCP').toUpperCase();
            const { ip, port } = this.parseEndpoint(remote);
            if (!ip) return null;
            return { remote, local, proto, ip, port: port != null ? port : 443 };
        } catch (_) {
            return null;
        }
    }

    applyFlowFollowOverride() {
        if (!this.flowFollow) {
            this.flowFollow = this.parseFlowFollowFromUrl();
        }
        if (!this.flowFollow || !this.telemetryData) return;
        const ff = this.flowFollow;
        const prev = this.telemetryData.flow || {};
        this.telemetryData.flow = {
            ...prev,
            remote: ff.remote,
            local: ff.local || prev.local || null,
            type: ff.proto || prev.type || 'TCP',
            state_name: prev.state_name || 'ESTABLISHED',
            state_code: prev.state_code || '01',
        };
    }

    maybeApplyFlowFollowDeepLink() {
        if (this._flowFollowApplied) return;
        if (!this.flowFollow) this.flowFollow = this.parseFlowFollowFromUrl();
        if (!this.flowFollow || !this.telemetryData?.ip_map) return;
        this._flowFollowApplied = true;
        this.applyFlowFollowOverride();
        this.updateTelemetryUI();

        const map = this.getIpMapData();
        const routes = Array.isArray(map.routes) ? map.routes : [];
        const neigh = Array.isArray(map.neigh) ? map.neigh : [];
        const routeIndex = routes.findIndex((r) => r.default);
        const resolvedRoute = routeIndex >= 0 ? routes[routeIndex] : (routes[0] || null);
        const nexthop = (resolvedRoute?.gateway && resolvedRoute.gateway !== '*')
            ? resolvedRoute.gateway
            : this.flowFollow.ip;
        let neighIndex = neigh.findIndex((n) => n.ip === this.flowFollow.ip);
        if (neighIndex < 0) neighIndex = neigh.findIndex((n) => n.ip === nexthop);

        const target = {
            kind: 'flow',
            ip: this.flowFollow.ip,
            port: this.flowFollow.port,
            routeIndex: routeIndex >= 0 ? routeIndex : (routes.length ? 0 : -1),
            neighIndex,
            follow: true,
        };
        // Defer one frame so overlay UI nodes exist after activate/init.
        requestAnimationFrame(() => this.openIpKernelMorph(target));
    }

    resolveMorphContext(target) {
        const map = this.getIpMapData();
        const routes = Array.isArray(map.routes) ? map.routes : [];
        const neigh = Array.isArray(map.neigh) ? map.neigh : [];
        const flow = this.telemetryData?.flow || {};
        const flowRemote = String(flow.remote || '');
        const parsedFlow = this.parseEndpoint(flowRemote);
        const flowIp = parsedFlow.ip;
        const flowPortRaw = parsedFlow.port;

        let kind = target?.kind || 'route';
        let ip = target?.ip || '';
        let port = target?.port != null ? target.port : (Number(flowPortRaw) || 443);
        let route = null;
        let hop = null;

        if (kind === 'route' && Number.isFinite(Number(target?.index))) {
            route = routes[Number(target.index)] || null;
        } else if (kind === 'neigh' && Number.isFinite(Number(target?.index))) {
            hop = neigh[Number(target.index)] || null;
            ip = hop?.ip || ip;
        } else if (kind === 'flow') {
            ip = ip || flowIp;
        }

        if (Number.isFinite(Number(target?.routeIndex)) && Number(target.routeIndex) >= 0) {
            route = routes[Number(target.routeIndex)] || route;
        }
        if (Number.isFinite(Number(target?.neighIndex)) && Number(target.neighIndex) >= 0) {
            hop = neigh[Number(target.neighIndex)] || hop;
        }

        if (!route && ip) {
            // Prefer default route for remote destinations; else first matching iface route.
            route = routes.find((r) => r.default) || routes[0] || null;
        }
        if (!ip) {
            if (route?.gateway && route.gateway !== '*') ip = route.gateway;
            else if (hop?.ip) ip = hop.ip;
            else if (flowIp) ip = flowIp;
        }
        if (!hop && ip) {
            hop = neigh.find((n) => n.ip === ip) || null;
        }
        // For gateway routes, neigh is usually the gateway, not the remote.
        const nexthopIp = (route?.gateway && route.gateway !== '*') ? route.gateway : ip;
        if (!hop && nexthopIp) {
            hop = neigh.find((n) => n.ip === nexthopIp) || null;
        }

        const routeIndex = route ? routes.indexOf(route) : -1;
        const neighIndex = hop ? neigh.indexOf(hop) : -1;

        return {
            kind,
            ip: ip || nexthopIp || '0.0.0.0',
            port,
            route,
            hop,
            nexthopIp: nexthopIp || ip || '0.0.0.0',
            iface: hop?.iface || route?.iface || '?',
            flow,
            routeIndex,
            neighIndex,
        };
    }

    buildIpKernelMorphHtml(target) {
        const ctx = this.resolveMorphContext(target);
        const addr = this.ipv4ToBe32(ctx.ip);
        const nhAddr = this.ipv4ToBe32(ctx.nexthopIp);
        const port = this.portToBe16(ctx.port);
        const ha = this.macToHa(ctx.hop?.mac);
        const route = ctx.route || {};
        const ttl = Number(this.getIpMapData()?.ip?.default_ttl) || 64;
        const destLabel = route.default
            ? 'default'
            : (route.destination || ctx.ip);
        const gwLabel = route.gateway && route.gateway !== '*' ? route.gateway : 'on-link';
        const fibType = route.default ? 'RTN_UNICAST (default)' : 'RTN_UNICAST';
        const neighState = ctx.hop?.state || 'INCOMPLETE';
        const esc = (v) => this.escapeHtml(v);

        const step = (sym, title, body, accent) => `
            <div class="ns-ip-morph-step" style="opacity:0; transform:translateY(6px); transition:opacity 320ms ease, transform 320ms ease; flex:1 1 140px; min-width:132px; background:rgba(8,12,20,0.78); border:1px solid ${accent}; border-radius:6px; padding:8px 9px;">
                <div style="font-size:8px; letter-spacing:0.7px; color:#7f93a6; margin-bottom:3px;">${esc(title)}</div>
                <div style="font-size:11px; color:#e8f2f9; line-height:1.35; word-break:break-word;">${body}</div>
                <div style="margin-top:6px; font-size:8.5px; letter-spacing:0.4px; color:#a9d4e8;">${esc(sym)}</div>
            </div>`;

        const arrow = `<div class="ns-ip-morph-arrow" style="opacity:0; transition:opacity 280ms ease; color:#556273; font-size:14px; padding:0 2px;">↓</div>`;

        return `
            <div class="ns-ip-morph" data-morph="1" style="margin:0 0 12px; padding:10px 12px; border:1px solid rgba(230,193,90,0.35); border-radius:8px; background:linear-gradient(180deg, rgba(230,193,90,0.08), rgba(8,12,20,0.35));">
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
                    <div style="flex:1;">
                        <div style="font-size:9px; letter-spacing:1px; color:#e6c15a;">IP → KERNEL TRANSLATION</div>
                        <div style="font-size:10px; color:#8d99a7; margin-top:2px;">address is not a string in the kernel — it becomes integers, fib_result, neighbour, dst</div>
                    </div>
                    <button type="button" class="ns-ip-morph-close" style="cursor:pointer; font:inherit; font-size:9px; letter-spacing:0.5px; color:#c8ccd4; background:transparent; border:1px solid rgba(160,170,190,0.35); border-radius:12px; padding:4px 10px;">CLOSE</button>
                </div>
                <div style="display:flex; flex-direction:column; gap:6px; align-items:stretch;">
                    ${step('inet_pton / sockaddr_in', '1 · SOCKET ADDR', `
                        <span style="color:#d4dde7">${esc(ctx.ip)}:${esc(port.port)}</span><br>
                        <span style="color:#8d99a7;font-size:10px;">sin_addr / sin_port</span>
                    `, 'rgba(212,221,231,0.28)')}
                    ${arrow}
                    ${step('__be32 / htons', '2 · WIRE INTEGERS', `
                        <span style="color:#a9d4e8">${esc(addr?.hex || '0x????????')}</span>
                        <span style="color:#6f8597;"> :</span>
                        <span style="color:#a9d4e8">${esc(port.hex)}</span><br>
                        <span style="color:#8d99a7;font-size:10px;">${esc(addr?.bytes || '')} · port be16</span>
                    `, 'rgba(103,190,224,0.4)')}
                    ${arrow}
                    ${step('fib_table_lookup', '3 · fib_result', `
                        dest <span style="color:#e6c15a">${esc(destLabel)}</span><br>
                        nh/gw <span style="color:#a9d4e8">${esc(gwLabel)}</span>
                        · oif <span style="color:#96ffbe">${esc(ctx.iface)}</span><br>
                        <span style="color:#8d99a7;font-size:10px;">${esc(fibType)} · metric ${esc(route.metric ?? '—')} · nh ${esc(nhAddr?.hex || '—')}</span>
                    `, 'rgba(230,193,90,0.45)')}
                    ${arrow}
                    ${step('neigh_resolve_output', '4 · neighbour / dst', `
                        nexthop <span style="color:#a9d4e8">${esc(ctx.nexthopIp)}</span><br>
                        ha[] <span style="color:#96ffbe">${esc(ha.ha)}</span><br>
                        <span style="color:#8d99a7;font-size:10px;">nud=${esc(neighState)} · dst_entry → ha</span>
                    `, 'rgba(150,255,190,0.35)')}
                    ${arrow}
                    ${step('dev_queue_xmit', '5 · sk_buff → NIC', `
                        skb → dev <span style="color:#96ffbe">${esc(ctx.iface)}</span> ring<br>
                        <span style="color:#8d99a7;font-size:10px;">eth hdr · TTL ${esc(ttl)} · qdisc / NAPI path</span>
                    `, 'rgba(103,190,224,0.35)')}
                </div>
                <div style="margin-top:8px; font-size:8.5px; color:#556273; letter-spacing:0.4px;">
                    symbols: ip_route_output_key → fib_table_lookup → neigh_lookup → neigh_resolve_output → dev_queue_xmit
                </div>
            </div>`;
    }

    animateIpMorph(root) {
        if (!root) return;
        const steps = [...root.querySelectorAll('.ns-ip-morph-step')];
        const arrows = [...root.querySelectorAll('.ns-ip-morph-arrow')];
        steps.forEach((el, i) => {
            setTimeout(() => {
                el.style.opacity = '1';
                el.style.transform = 'translateY(0)';
                if (arrows[i]) arrows[i].style.opacity = '1';
            }, 90 + i * 160);
        });
    }

    clearKernelGhost() {
        if (this._ghostTimer) {
            clearTimeout(this._ghostTimer);
            this._ghostTimer = null;
        }
        if (this._ghostFadeTimer) {
            clearTimeout(this._ghostFadeTimer);
            this._ghostFadeTimer = null;
        }
        if (this._ghostEl) {
            this._ghostEl.remove();
            this._ghostEl = null;
        }
    }

    flashKernelGhost(anchorEl, code = 'fib_lookup(fl4)') {
        if (!anchorEl || typeof anchorEl.getBoundingClientRect !== 'function') return;
        this.clearKernelGhost();
        const rect = anchorEl.getBoundingClientRect();
        if (!rect || rect.width < 2) return;

        const el = document.createElement('div');
        el.className = 'ns-kernel-ghost';
        el.textContent = String(code || 'fib_lookup(fl4)');
        const preferLeft = rect.right > window.innerWidth - 220;
        const left = preferLeft
            ? Math.max(8, rect.left - 12)
            : Math.min(window.innerWidth - 12, rect.right + 10);
        const top = Math.max(8, rect.top + rect.height / 2 - 12);
        el.style.cssText = [
            'position:fixed',
            `left:${left}px`,
            `top:${top}px`,
            preferLeft ? 'transform:translate(-100%,0) translateX(6px)' : 'transform:translateX(-6px)',
            'opacity:0',
            'pointer-events:none',
            'z-index:10050',
            'font:12px "Share Tech Mono", monospace',
            'letter-spacing:0.4px',
            'color:rgba(230,193,90,0.88)',
            'text-shadow:0 0 10px rgba(230,193,90,0.35)',
            'background:rgba(8,12,20,0.55)',
            'border:1px solid rgba(230,193,90,0.28)',
            'border-radius:4px',
            'padding:3px 8px',
            'white-space:nowrap',
            'transition:opacity 220ms ease, transform 220ms ease',
        ].join(';');
        document.body.appendChild(el);
        this._ghostEl = el;

        const reveal = () => {
            if (this._ghostEl !== el) return;
            el.style.opacity = '1';
            el.style.transform = preferLeft ? 'translate(-100%,0) translateX(0)' : 'translateX(0)';
        };
        requestAnimationFrame(reveal);
        setTimeout(reveal, 32);

        this._ghostTimer = setTimeout(() => {
            if (this._ghostEl !== el) return;
            el.style.opacity = '0';
            el.style.transform = preferLeft
                ? 'translate(-100%,0) translateX(-8px)'
                : 'translateX(8px)';
            this._ghostFadeTimer = setTimeout(() => {
                if (this._ghostEl === el) {
                    el.remove();
                    this._ghostEl = null;
                }
            }, 260);
        }, 1700);
    }

    kernelGhostCodeForIpTarget(target) {
        const t = target || this.ipMorphTarget || {};
        if (t.kind === 'neigh') return 'neigh_lookup(&key)';
        if (t.kind === 'route') return 'fib_lookup(fl4)';
        if (t.kind === 'flow') return 'ip_route_output_key()';
        return 'fib_lookup(fl4)';
    }

    flashKernelGhostForIpTarget(root) {
        const t = this.ipMorphTarget;
        if (!t || !root) return;
        let anchor = null;
        if (t.kind === 'route' && Number.isFinite(Number(t.index))) {
            anchor = root.querySelector(`.ns-ip-route-row[data-route-index="${Number(t.index)}"]`);
        } else if (t.kind === 'neigh' && Number.isFinite(Number(t.index))) {
            anchor = root.querySelector(`.ns-ip-neigh-row[data-neigh-index="${Number(t.index)}"]`);
        } else if (t.kind === 'flow') {
            if (Number.isFinite(Number(t.neighIndex)) && Number(t.neighIndex) >= 0) {
                anchor = root.querySelector(`.ns-ip-neigh-row[data-neigh-index="${Number(t.neighIndex)}"]`);
            }
            if (!anchor && Number.isFinite(Number(t.routeIndex)) && Number(t.routeIndex) >= 0) {
                anchor = root.querySelector(`.ns-ip-route-row[data-route-index="${Number(t.routeIndex)}"]`);
            }
        }
        if (!anchor) {
            anchor = root.querySelector('.ns-ip-route-row, .ns-ip-neigh-row, .ns-ip-morph');
        }
        this.flashKernelGhost(anchor, this.kernelGhostCodeForIpTarget(t));
    }

    bindIpMapInteractions(root) {
        if (!root) return;
        root.querySelectorAll('.ns-ip-route-row').forEach((el) => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = Number(el.getAttribute('data-route-index'));
                this.openIpKernelMorph({ kind: 'route', index });
            });
        });
        root.querySelectorAll('.ns-ip-neigh-row').forEach((el) => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = Number(el.getAttribute('data-neigh-index'));
                this.openIpKernelMorph({ kind: 'neigh', index });
            });
        });
        const back = root.querySelector('.ns-ip-back-puzzle');
        if (back) {
            back.addEventListener('click', () => {
                this.ipMapPinned = false;
                this.ipMorphTarget = null;
                this.ipMapFrozen = null;
                this._ipMapPanelSig = null;
                if (this.drillLayerId === 'ip') this.closeLayerDrilldown();
                else this.updatePacketLifecycleUI();
            });
        }
        const morphClose = root.querySelector('.ns-ip-morph-close');
        if (morphClose) {
            morphClose.addEventListener('click', (e) => {
                e.stopPropagation();
                // Close ribbon only: restore right panel to pre-morph IP map (no ribbon).
                this.ipMorphTarget = null;
                this._ipMapPanelSig = null;
                this.renderIpLayerMapPanel();
                this.refreshIpMapViews({ drillOnly: true });
            });
        }
        const morphRoot = root.querySelector('.ns-ip-morph');
        if (morphRoot) this.animateIpMorph(morphRoot);
    }

    refreshIpMapViews({ drillOnly = false } = {}) {
        if (!drillOnly && this.lifecyclePanelNode && (this.ipMapPinned || this.drillLayerId === 'ip')) {
            this.renderIpLayerMapPanel();
        }
        if (this.drillLayerId === 'ip' && this.drillScrim?.style.display === 'block') {
            // Rebuild drill body map section without collapsing overlay.
            const info = this.getLayerDrillInfo('ip');
            if (!info || !this.drillPanel) return;
            const act = Math.round(Math.max(0, Math.min(1, Number(this.layerActivity.ip ?? 0))) * 100);
            const actCol = act > 80 ? 'rgba(232,96,104,0.95)' : (act > 55 ? 'rgba(230,193,90,0.95)' : 'rgba(103,190,224,0.95)');
            const metrics = this.getLayerDrillMetrics('ip');
            const metricCells = metrics.map(([k, v]) => `
                <div style="background:rgba(8,12,20,0.7); border:1px solid rgba(96,110,128,0.32); border-radius:4px; padding:8px 10px;">
                    <div style="font-size:8.5px; letter-spacing:0.6px; color:#7f93a6; text-transform:uppercase;">${k}</div>
                    <div style="font-size:18px; color:#e2edf5; line-height:1.15; margin-top:2px;">${v}</div>
                </div>`).join('');
            const morph = this.ipMorphTarget ? this.buildIpKernelMorphHtml(this.ipMorphTarget) : `
                <div style="margin:0 0 10px; font-size:10px; color:#6f8597; letter-spacing:0.4px;">
                    tip: click a <span style="color:#e6c15a">route</span> or <span style="color:#a9d4e8">neigh</span> row to watch IP → kernel translation
                </div>`;
            const html = `
                <div style="display:flex; align-items:center; gap:12px; padding:14px 18px; border-bottom:1px solid rgba(230,193,90,0.35); background:linear-gradient(90deg, rgba(230,193,90,0.12), rgba(103,190,224,0.05));">
                    <div style="flex:1 1 auto;">
                        <div style="font-size:8px; letter-spacing:1.4px; color:#6f8597;">STACK LAYER · NETWORK · L04</div>
                        <div style="font-size:20px; letter-spacing:1.2px; color:#e8f2f9;">IP · FIB / ROUTE / NEIGH / ICMP</div>
                    </div>
                    <div style="flex:none; text-align:right;">
                        <div style="font-size:8px; letter-spacing:1px; color:#6f8597;">LIVE ACTIVITY</div>
                        <div style="font-size:22px; color:${actCol};">${act}<span style="font-size:11px; color:#7f93a6;">%</span></div>
                    </div>
                    <div class="ns-ov-close" style="flex:none; cursor:pointer; width:26px; height:26px; border:1px solid rgba(160,170,190,0.4); border-radius:4px; display:flex; align-items:center; justify-content:center; color:#c8ccd4; font-size:14px;">✕</div>
                </div>
                <div style="padding:14px 18px 16px; max-height:78vh; overflow:auto;">
                    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:8px; margin-bottom:12px;">${metricCells}</div>
                    <div style="font-size:11.5px; line-height:1.6; color:#c2cede; margin-bottom:10px;">${info.what}</div>
                    <div style="margin-bottom:8px; font-size:10.5px; line-height:1.55; color:#9db6c8; border-left:2px solid rgba(230,193,90,0.6); padding-left:9px;"><span style="color:#e6c15a; letter-spacing:0.5px;">WATCH · </span>${info.watch}</div>
                    ${morph}
                    ${this.buildIpLayerMapHtml({ compact: false })}
                </div>`;
            window.setSafeHtml(this.drillPanel, html);
            const closeBtn = this.drillPanel.querySelector('.ns-ov-close');
            if (closeBtn) closeBtn.addEventListener('click', () => this.closeLayerDrilldown());
            this.bindIpMapInteractions(this.drillPanel);
            if (this._ghostPending) {
                this._ghostPending = false;
                requestAnimationFrame(() => this.flashKernelGhostForIpTarget(this.drillPanel));
            }
        }
    }

    openIpKernelMorph(target) {
        this.freezeIpMapSnapshot();
        const next = target || { kind: 'flow' };
        // For flow follow, attach route/neigh indexes so the map rows light up.
        if (next.kind === 'flow' && (next.routeIndex == null || next.neighIndex == null)) {
            const ctx = this.resolveMorphContext(next);
            if (next.routeIndex == null) next.routeIndex = ctx.routeIndex;
            if (next.neighIndex == null) next.neighIndex = ctx.neighIndex;
            if (!next.ip) next.ip = ctx.ip;
            if (next.port == null) next.port = ctx.port;
        }
        this.ipMorphTarget = next;
        this.ipMapPinned = true;
        this._ipMapPanelSig = null;
        this._ghostPending = true;
        // Morph lives only in the center overlay — keep the right panel as the
        // compact IP map (pre-ribbon layout) so it still fits.
        if (this.lifecyclePanelNode) this.renderIpLayerMapPanel();
        if (this.drillLayerId !== 'ip') {
            this.openLayerDrilldown('ip');
            return;
        }
        this.refreshIpMapViews({ drillOnly: true });
    }

    buildIpLayerMapHtml({ compact = false } = {}) {
        const map = this.getIpMapData();
        const routes = Array.isArray(map.routes) ? map.routes : [];
        const neigh = Array.isArray(map.neigh) ? map.neigh : [];
        const icmp = map.icmp || {};
        const ip = map.ip || {};
        const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
        const fwd = n(ip.forwarding) === 1 ? 'forwarding ON' : 'host (no forward)';
        let selectedRoute = this.ipMorphTarget?.kind === 'route' ? Number(this.ipMorphTarget.index) : -1;
        let selectedNeigh = this.ipMorphTarget?.kind === 'neigh' ? Number(this.ipMorphTarget.index) : -1;
        if (this.ipMorphTarget?.kind === 'flow') {
            if (Number.isFinite(Number(this.ipMorphTarget.routeIndex))) {
                selectedRoute = Number(this.ipMorphTarget.routeIndex);
            }
            if (Number.isFinite(Number(this.ipMorphTarget.neighIndex))) {
                selectedNeigh = Number(this.ipMorphTarget.neighIndex);
            }
        }
        const routeRows = routes.length
            ? routes.map((r, idx) => {
                const dest = r.default
                    ? '<span style="color:#e6c15a">default</span>'
                    : `<span style="color:#d4dde7">${this.escapeHtml(r.destination)}</span>`;
                const via = r.gateway && r.gateway !== '*'
                    ? `via <span style="color:#a9d4e8">${this.escapeHtml(r.gateway)}</span>`
                    : 'on-link';
                const active = idx === selectedRoute;
                return `<div class="ns-ip-route-row" data-route-index="${idx}" title="Translate this route into kernel objects" style="display:flex; gap:8px; flex-wrap:wrap; padding:4px 4px; margin:0 -4px; border-bottom:1px solid rgba(70,82,98,0.25); cursor:pointer; border-radius:4px; background:${active ? 'rgba(230,193,90,0.12)' : 'transparent'};">
                    <span style="min-width:118px;">${dest}</span>
                    <span style="color:#8d99a7;">${via}</span>
                    <span style="color:#6f8597;">dev ${this.escapeHtml(r.iface)}</span>
                    <span style="color:#556273;margin-left:auto;">metric ${r.metric ?? 0}</span>
                </div>`;
            }).join('')
            : '<div style="color:#6f8597;">no routes in /proc/net/route</div>';
        const neighRows = neigh.length
            ? neigh.map((h, idx) => {
                const st = String(h.state || 'STALE');
                const stCol = st === 'REACHABLE' ? '#96ffbe' : (st === 'INCOMPLETE' ? '#e69696' : '#e6c15a');
                const active = idx === selectedNeigh;
                return `<div class="ns-ip-neigh-row" data-neigh-index="${idx}" title="Translate this neighbour into dst/ha[]" style="display:flex; gap:8px; flex-wrap:wrap; padding:4px 4px; margin:0 -4px; border-bottom:1px solid rgba(70,82,98,0.25); cursor:pointer; border-radius:4px; background:${active ? 'rgba(103,190,224,0.12)' : 'transparent'};">
                    <span style="color:#a9d4e8;min-width:110px;">${this.escapeHtml(h.ip)}</span>
                    <span style="color:#c2cede;">${this.escapeHtml(h.mac)}</span>
                    <span style="color:#6f8597;">dev ${this.escapeHtml(h.iface)}</span>
                    <span style="color:${stCol};margin-left:auto;letter-spacing:0.5px;">${this.escapeHtml(st)}</span>
                </div>`;
            }).join('')
            : '<div style="color:#6f8597;">no ARP/neigh entries</div>';
        const chip = (label, value, hot = false) => `
            <div style="background:rgba(8,12,20,0.7); border:1px solid ${hot ? 'rgba(230,193,90,0.45)' : 'rgba(96,110,128,0.32)'}; border-radius:4px; padding:7px 9px; min-width:88px;">
                <div style="font-size:8px; letter-spacing:0.6px; color:#7f93a6; text-transform:uppercase;">${label}</div>
                <div style="font-size:${compact ? '14px' : '16px'}; color:#e2edf5; margin-top:2px;">${value}</div>
            </div>`;
        const icmpHot = n(icmp.in_errors) + n(icmp.out_errors) + n(icmp.in_dest_unreach) > 0;
        // Morph ribbon is center-overlay only — never inject into the right panel.
        const tip = compact
            ? '<div style="font-size:8.5px;color:#556273;margin:0 0 6px;">click route/neigh → IP→kernel morph (center)</div>'
            : '';
        const flowDiagram = `
            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin:8px 0 10px; font-size:9px; letter-spacing:0.4px;">
                <span style="color:#6f8597;">LOOKUP</span>
                <span style="padding:3px 8px; border:1px solid rgba(230,193,90,0.45); border-radius:12px; color:#e6c15a;">FIB</span>
                <span style="color:#556273;">→</span>
                <span style="padding:3px 8px; border:1px solid rgba(103,190,224,0.45); border-radius:12px; color:#a9d4e8;">NEIGH</span>
                <span style="color:#556273;">→</span>
                <span style="padding:3px 8px; border:1px solid rgba(150,255,190,0.35); border-radius:12px; color:#96ffbe;">L2 / NIC</span>
                <span style="color:#556273; margin:0 4px;">|</span>
                <span style="padding:3px 8px; border:1px solid rgba(232,96,104,0.4); border-radius:12px; color:#e69696;">ICMP</span>
                <span style="color:#6f8597;">control / errors</span>
            </div>`;
        return `
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
                <div style="flex:1;">
                    <div style="font-size:10px;color:#7f8fa2;letter-spacing:0.6px;">IP LAYER MAP · L04 · ${fwd}</div>
                    <div style="font-size:9px;color:#556273;margin-top:2px;">/proc/net/route · /proc/net/arp · /proc/net/snmp</div>
                </div>
                ${compact ? `<button type="button" class="ns-ip-back-puzzle" style="cursor:pointer; font:inherit; font-size:9px; letter-spacing:0.6px; color:#a9d4e8; background:rgba(103,190,224,0.1); border:1px solid rgba(103,190,224,0.4); border-radius:12px; padding:4px 10px;">← PUZZLE</button>` : ''}
            </div>
            ${tip}
            ${flowDiagram}
            <div style="display:grid; grid-template-columns:${compact ? '1.2fr 1fr 0.9fr' : '1.15fr 1fr 0.95fr'}; gap:10px;">
                <div>
                    <div style="font-size:8px; letter-spacing:1px; color:#e6c15a; margin-bottom:4px;">FIB / ROUTES <span style="color:#556273;letter-spacing:0.3px;">· click</span></div>
                    <div style="max-height:${compact ? '12vh' : '28vh'}; overflow:auto; font-size:9.5px; line-height:1.45;">${routeRows}</div>
                </div>
                <div>
                    <div style="font-size:8px; letter-spacing:1px; color:#a9d4e8; margin-bottom:4px;">NEIGH / ARP <span style="color:#556273;letter-spacing:0.3px;">· click</span></div>
                    <div style="max-height:${compact ? '12vh' : '28vh'}; overflow:auto; font-size:9.5px; line-height:1.45;">${neighRows}</div>
                </div>
                <div>
                    <div style="font-size:8px; letter-spacing:1px; color:#e69696; margin-bottom:4px;">ICMP · IP COUNTERS</div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
                        ${chip('ICMP in', n(icmp.in_msgs))}
                        ${chip('ICMP out', n(icmp.out_msgs))}
                        ${chip('errors', n(icmp.in_errors) + n(icmp.out_errors), icmpHot)}
                        ${chip('unreach', n(icmp.in_dest_unreach) + n(icmp.out_dest_unreach), n(icmp.in_dest_unreach) > 0)}
                        ${chip('TTL / echo', `${n(ip.default_ttl) || '—'} / ${n(icmp.out_echos)}`)}
                        ${chip('IP discards', n(ip.in_discards) + n(ip.out_discards), n(ip.in_discards) + n(ip.out_discards) > 0)}
                    </div>
                </div>
            </div>`;
    }

    renderIpLayerMapPanel() {
        if (!this.lifecyclePanelNode) return;
        window.setSafeHtml(this.lifecyclePanelNode, this.buildIpLayerMapHtml({ compact: true }));
        this.bindIpMapInteractions(this.lifecyclePanelNode);
    }

    getTcpSnap() {
        if (this.tcpFrozen) return this.tcpFrozen;
        const m = this.telemetryData?.layer_metrics?.tcp_udp || {};
        const b = this.telemetryData?.bbr || {};
        const flow = this.telemetryData?.flow || {};
        return { tcp_udp: m, bbr: b, flow };
    }

    freezeTcpSnapshot() {
        const snap = {
            tcp_udp: { ...(this.telemetryData?.layer_metrics?.tcp_udp || {}) },
            bbr: { ...(this.telemetryData?.bbr || {}) },
            flow: { ...(this.telemetryData?.flow || {}) },
        };
        try {
            this.tcpFrozen = JSON.parse(JSON.stringify(snap));
        } catch (_) {
            this.tcpFrozen = snap;
        }
    }

    buildTcpKernelMorphHtml(target = {}) {
        const snap = this.getTcpSnap();
        const t = snap.tcp_udp || {};
        const b = snap.bbr || {};
        const flow = snap.flow || {};
        const n = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
        const esc = (v) => this.escapeHtml(v);
        const cwnd = n(t.cwnd ?? b.cwnd);
        const mss = n(b.mss, 1448);
        const rtt = n(t.rtt_ms ?? b.rtt_ms);
        const minRtt = n(t.min_rtt_ms ?? b.min_rtt_ms, rtt);
        const retrans = n(t.retrans_per_sec);
        const cc = String(t.cc || b.cc || 'unknown');
        const pacing = n(b.pacing_rate_mbps ?? t.delivery_rate_mbps);
        const delivery = n(t.delivery_rate_mbps ?? b.delivery_rate_mbps);
        const inflightBytes = cwnd * mss;
        const inflightKb = inflightBytes >= 1024 ? `${(inflightBytes / 1024).toFixed(1)} KiB` : `${inflightBytes} B`;
        const local = flow.local || 'local';
        const remote = flow.remote || 'remote';
        const state = flow.state_name || 'ESTABLISHED';
        const focus = target.focus || 'flow';
        const hi = (key, accent) => (focus === key ? accent : 'rgba(96,110,128,0.32)');

        const step = (sym, title, body, accent) => `
            <div class="ns-tcp-morph-step" style="opacity:0; transform:translateY(6px); transition:opacity 320ms ease, transform 320ms ease; flex:1 1 140px; min-width:132px; background:rgba(8,12,20,0.78); border:1px solid ${accent}; border-radius:6px; padding:8px 9px;">
                <div style="font-size:8px; letter-spacing:0.7px; color:#7f93a6; margin-bottom:3px;">${esc(title)}</div>
                <div style="font-size:11px; color:#e8f2f9; line-height:1.35; word-break:break-word;">${body}</div>
                <div style="margin-top:6px; font-size:8.5px; letter-spacing:0.4px; color:#a9d4e8;">${esc(sym)}</div>
            </div>`;
        const arrow = `<div class="ns-tcp-morph-arrow" style="opacity:0; transition:opacity 280ms ease; color:#556273; font-size:14px; padding:0 2px;">↓</div>`;

        return `
            <div class="ns-tcp-morph" data-morph="1" style="margin:0 0 12px; padding:10px 12px; border:1px solid rgba(103,190,224,0.4); border-radius:8px; background:linear-gradient(180deg, rgba(103,190,224,0.10), rgba(8,12,20,0.35));">
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
                    <div style="flex:1;">
                        <div style="font-size:9px; letter-spacing:1px; color:#a9d4e8;">TCP → KERNEL TRANSLATION</div>
                        <div style="font-size:10px; color:#8d99a7; margin-top:2px;">a flow is not just “connected” — it is tcp_sock fields deciding what may leave the stack</div>
                    </div>
                    <button type="button" class="ns-tcp-morph-close" style="cursor:pointer; font:inherit; font-size:9px; letter-spacing:0.5px; color:#c8ccd4; background:transparent; border:1px solid rgba(160,170,190,0.35); border-radius:12px; padding:4px 10px;">CLOSE</button>
                </div>
                <div style="display:flex; flex-direction:column; gap:6px; align-items:stretch;">
                    ${step('tcp_v4_connect / tcp_rcv_established', '1 · FLOW', `
                        <span style="color:#d4dde7">${esc(local)}</span>
                        <span style="color:#556273;"> → </span>
                        <span style="color:#a9d4e8">${esc(remote)}</span><br>
                        <span style="color:#8d99a7;font-size:10px;">state ${esc(state)} · sk → tcp_sock</span>
                    `, hi('flow', 'rgba(212,221,231,0.4)'))}
                    ${arrow}
                    ${step('tcp_ack / tcp_rtt_estimator', '2 · tcp_sock', `
                        snd_cwnd <span style="color:#e6c15a">${esc(cwnd)}</span>
                        · srtt ≈ <span style="color:#a9d4e8">${esc(rtt.toFixed(1))} ms</span><br>
                        <span style="color:#8d99a7;font-size:10px;">minrtt ${esc(minRtt.toFixed(2))} · retrans/s ${esc(retrans)}</span>
                    `, focus === 'rtt'
                        ? 'rgba(103,190,224,0.5)'
                        : (focus === 'cwnd' || focus === 'retrans' ? 'rgba(230,193,90,0.5)' : 'rgba(96,110,128,0.32)'))}
                    ${arrow}
                    ${step('tcp_snd_wnd / tcp_tso_should_defer', '3 · SEND BUDGET', `
                        cwnd×MSS = <span style="color:#96ffbe">${esc(inflightKb)}</span>
                        <span style="color:#8d99a7;"> (${esc(cwnd)} × ${esc(mss)})</span><br>
                        <span style="color:#8d99a7;font-size:10px;">bytes allowed in flight before ACK</span>
                    `, hi('budget', 'rgba(150,255,190,0.4)'))}
                    ${arrow}
                    ${step('tcp_cong_control / ca_ops', '4 · CONGESTION CTL', `
                        cc <span style="color:#e6c15a">${esc(cc)}</span>
                        · pace <span style="color:#a9d4e8">${esc(pacing.toFixed(3))} Mbps</span><br>
                        <span style="color:#8d99a7;font-size:10px;">delivery ${esc(delivery.toFixed(3))} Mbps · tp-&gt;ca_ops</span>
                    `, hi('cc', 'rgba(230,193,90,0.45)'))}
                    ${arrow}
                    ${step('tcp_transmit_skb → ip_queue_xmit', '5 · sk_buff → IP', `
                        skb leaves TCP → IP output<br>
                        <span style="color:#8d99a7;font-size:10px;">then FIB / neigh morph on L04</span>
                    `, hi('skb', 'rgba(103,190,224,0.4)'))}
                </div>
                <div style="margin-top:8px; font-size:8.5px; color:#556273; letter-spacing:0.4px;">
                    symbols: tcp_rcv_established → tcp_ack → tcp_cong_control → tcp_write_xmit → tcp_transmit_skb
                </div>
            </div>`;
    }

    animateTcpMorph(root) {
        if (!root) return;
        const steps = [...root.querySelectorAll('.ns-tcp-morph-step')];
        const arrows = [...root.querySelectorAll('.ns-tcp-morph-arrow')];
        steps.forEach((el, i) => {
            setTimeout(() => {
                el.style.opacity = '1';
                el.style.transform = 'translateY(0)';
                if (arrows[i]) arrows[i].style.opacity = '1';
            }, 90 + i * 160);
        });
    }

    buildTcpLayerMapHtml({ compact = false } = {}) {
        const snap = this.getTcpSnap();
        const t = snap.tcp_udp || {};
        const b = snap.bbr || {};
        const flow = snap.flow || {};
        const n = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
        const esc = (v) => this.escapeHtml(v);
        const cwnd = n(t.cwnd ?? b.cwnd);
        const rtt = n(t.rtt_ms ?? b.rtt_ms);
        const retrans = n(t.retrans_per_sec);
        const cc = String(t.cc || b.cc || 'unknown');
        const focus = this.tcpMorphTarget?.focus || '';
        const row = (key, label, value, color) => {
            const active = focus === key;
            return `<div class="ns-tcp-row" data-tcp-focus="${key}" title="Translate into tcp_sock / ca_ops" style="display:flex; gap:8px; align-items:baseline; padding:5px 6px; margin:0 -4px 3px; border-radius:4px; cursor:pointer; border:1px solid ${active ? color : 'rgba(70,82,98,0.35)'}; background:${active ? 'rgba(103,190,224,0.10)' : 'rgba(8,12,20,0.35)'};">
                <span style="min-width:${compact ? '64px' : '88px'}; font-size:8px; letter-spacing:0.6px; color:#7f93a6;">${label}</span>
                <span style="color:${color}; font-size:${compact ? '12px' : '14px'};">${esc(value)}</span>
            </div>`;
        };
        return `
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
                <div style="flex:1;">
                    <div style="font-size:10px;color:#7f8fa2;letter-spacing:0.6px;">TCP LAYER MAP · L05 · ${esc(cc)}</div>
                    <div style="font-size:9px;color:#556273;margin-top:2px;">ss -tin · tcp_sock · ca_ops</div>
                </div>
                ${compact ? `<button type="button" class="ns-tcp-back-puzzle" style="cursor:pointer; font:inherit; font-size:9px; letter-spacing:0.6px; color:#a9d4e8; background:rgba(103,190,224,0.1); border:1px solid rgba(103,190,224,0.4); border-radius:12px; padding:4px 10px;">← PUZZLE</button>` : ''}
            </div>
            ${compact ? '<div style="font-size:8.5px;color:#556273;margin:0 0 6px;">click a field → TCP→kernel morph (center)</div>' : ''}
            <div style="display:grid; grid-template-columns:${compact ? '1fr' : '1.1fr 0.9fr'}; gap:10px;">
                <div>
                    ${row('flow', 'FLOW', `${flow.local || '—'} → ${flow.remote || '—'}`, '#d4dde7')}
                    ${row('cwnd', 'CWND', `${cwnd} segments`, '#e6c15a')}
                    ${row('rtt', 'RTT', `${rtt.toFixed(1)} ms`, '#a9d4e8')}
                    ${row('cc', 'CC', cc, '#96ffbe')}
                    ${row('retrans', 'RETRANS', `${retrans}/s`, retrans > 0 ? '#e69696' : '#8d99a7')}
                </div>
                <div style="font-size:9.5px; line-height:1.55; color:#8d99a7;">
                    <div style="font-size:8px; letter-spacing:1px; color:#6f8597; margin-bottom:4px;">PATH</div>
                    <div>userspace send → <span style="color:#a9d4e8">tcp_sendmsg</span></div>
                    <div>→ window / cwnd check → <span style="color:#e6c15a">tcp_write_xmit</span></div>
                    <div>→ skb build → <span style="color:#96ffbe">tcp_transmit_skb</span></div>
                    <div>→ <span style="color:#d4dde7">ip_queue_xmit</span> (L04)</div>
                    ${!compact ? `<div style="margin-top:10px;">
                        <button type="button" class="ns-tcp-open-morph" style="cursor:pointer; font:inherit; font-size:10px; letter-spacing:0.7px; color:#a9d4e8; background:rgba(103,190,224,0.12); border:1px solid rgba(103,190,224,0.45); border-radius:14px; padding:5px 12px;">▸ TCP → KERNEL TRANSLATION</button>
                        <button type="button" class="ns-drill-bbr" style="cursor:pointer; font:inherit; font-size:10px; letter-spacing:0.7px; color:#e6c15a; background:rgba(230,193,90,0.10); border:1px solid rgba(230,193,90,0.4); border-radius:14px; padding:5px 12px; margin-left:6px;">▸ BBR PATH MODEL</button>
                    </div>` : ''}
                </div>
            </div>`;
    }

    bindTcpMapInteractions(root) {
        if (!root) return;
        root.querySelectorAll('.ns-tcp-row').forEach((el) => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const focus = el.getAttribute('data-tcp-focus') || 'flow';
                this.openTcpKernelMorph({ focus });
            });
        });
        const openMorph = root.querySelector('.ns-tcp-open-morph');
        if (openMorph) {
            openMorph.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openTcpKernelMorph({ focus: 'flow' });
            });
        }
        const back = root.querySelector('.ns-tcp-back-puzzle');
        if (back) {
            back.addEventListener('click', () => {
                this.tcpMapPinned = false;
                this.tcpMorphTarget = null;
                this.tcpFrozen = null;
                if (this.drillLayerId === 'tcp') this.closeLayerDrilldown();
                else this.updatePacketLifecycleUI();
            });
        }
        const morphClose = root.querySelector('.ns-tcp-morph-close');
        if (morphClose) {
            morphClose.addEventListener('click', (e) => {
                e.stopPropagation();
                this.tcpMorphTarget = null;
                this.renderTcpLayerMapPanel();
                this.refreshTcpMapViews({ drillOnly: true });
            });
        }
        const bbrBtn = root.querySelector('.ns-drill-bbr');
        if (bbrBtn) {
            bbrBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeLayerDrilldown();
                this.openBbrOverlay();
            });
        }
        const morphRoot = root.querySelector('.ns-tcp-morph');
        if (morphRoot) this.animateTcpMorph(morphRoot);
    }

    renderTcpLayerMapPanel() {
        if (!this.lifecyclePanelNode) return;
        window.setSafeHtml(this.lifecyclePanelNode, this.buildTcpLayerMapHtml({ compact: true }));
        this.bindTcpMapInteractions(this.lifecyclePanelNode);
    }

    refreshTcpMapViews({ drillOnly = false } = {}) {
        if (!drillOnly && this.lifecyclePanelNode && (this.tcpMapPinned || this.drillLayerId === 'tcp')) {
            this.renderTcpLayerMapPanel();
        }
        if (this.drillLayerId === 'tcp' && this.drillScrim?.style.display === 'block') {
            const info = this.getLayerDrillInfo('tcp');
            if (!info || !this.drillPanel) return;
            const act = Math.round(Math.max(0, Math.min(1, Number(this.layerActivity.tcp ?? 0))) * 100);
            const actCol = act > 80 ? 'rgba(232,96,104,0.95)' : (act > 55 ? 'rgba(230,193,90,0.95)' : 'rgba(103,190,224,0.95)');
            const metrics = this.getLayerDrillMetrics('tcp');
            const metricCells = metrics.map(([k, v]) => `
                <div style="background:rgba(8,12,20,0.7); border:1px solid rgba(96,110,128,0.32); border-radius:4px; padding:8px 10px;">
                    <div style="font-size:8.5px; letter-spacing:0.6px; color:#7f93a6; text-transform:uppercase;">${k}</div>
                    <div style="font-size:18px; color:#e2edf5; line-height:1.15; margin-top:2px;">${v}</div>
                </div>`).join('');
            const morph = this.tcpMorphTarget
                ? this.buildTcpKernelMorphHtml(this.tcpMorphTarget)
                : `<div style="margin:0 0 10px; font-size:10px; color:#6f8597; letter-spacing:0.4px;">
                    tip: click <span style="color:#e6c15a">cwnd</span> / <span style="color:#a9d4e8">rtt</span> / <span style="color:#96ffbe">cc</span> — or open the translation ribbon
                   </div>`;
            const html = `
                <div style="display:flex; align-items:center; gap:12px; padding:14px 18px; border-bottom:1px solid rgba(103,190,224,0.35); background:linear-gradient(90deg, rgba(103,190,224,0.12), rgba(230,193,90,0.05));">
                    <div style="flex:1 1 auto;">
                        <div style="font-size:8px; letter-spacing:1.4px; color:#6f8597;">STACK LAYER · TRANSPORT · L05</div>
                        <div style="font-size:20px; letter-spacing:1.2px; color:#e8f2f9;">TCP · SOCK / CWND / CC / SKB</div>
                    </div>
                    <div style="flex:none; text-align:right;">
                        <div style="font-size:8px; letter-spacing:1px; color:#6f8597;">LIVE ACTIVITY</div>
                        <div style="font-size:22px; color:${actCol};">${act}<span style="font-size:11px; color:#7f93a6;">%</span></div>
                    </div>
                    <div class="ns-ov-close" style="flex:none; cursor:pointer; width:26px; height:26px; border:1px solid rgba(160,170,190,0.4); border-radius:4px; display:flex; align-items:center; justify-content:center; color:#c8ccd4; font-size:14px;">✕</div>
                </div>
                <div style="padding:14px 18px 16px; max-height:78vh; overflow:auto;">
                    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:8px; margin-bottom:12px;">${metricCells}</div>
                    <div style="font-size:11.5px; line-height:1.6; color:#c2cede; margin-bottom:10px;">${info.what}</div>
                    <div style="margin-bottom:8px; font-size:10.5px; line-height:1.55; color:#9db6c8; border-left:2px solid rgba(103,190,224,0.6); padding-left:9px;"><span style="color:#a9d4e8; letter-spacing:0.5px;">WATCH · </span>${info.watch}</div>
                    ${morph}
                    ${this.buildTcpLayerMapHtml({ compact: false })}
                </div>`;
            window.setSafeHtml(this.drillPanel, html);
            const closeBtn = this.drillPanel.querySelector('.ns-ov-close');
            if (closeBtn) closeBtn.addEventListener('click', () => this.closeLayerDrilldown());
            this.bindTcpMapInteractions(this.drillPanel);
        }
    }

    openTcpKernelMorph(target) {
        this.freezeTcpSnapshot();
        this.tcpMorphTarget = target || { focus: 'flow' };
        this.tcpMapPinned = true;
        // Clear other pins so the right panel shows TCP map only.
        this.ipMapPinned = false;
        this.ipMorphTarget = null;
        this.nfMapPinned = false;
        this.nfMorphTarget = null;
        this.sockMapPinned = false;
        this.sockMorphTarget = null;
        if (this.lifecyclePanelNode) this.renderTcpLayerMapPanel();
        if (this.drillLayerId !== 'tcp') {
            this.openLayerDrilldown('tcp');
            return;
        }
        this.refreshTcpMapViews({ drillOnly: true });
    }

    getNfSnap() {
        if (this.nfFrozen) return this.nfFrozen;
        return {
            netfilter: { ...(this.telemetryData?.layer_metrics?.netfilter || {}) },
            flow: { ...(this.telemetryData?.flow || {}) },
        };
    }

    freezeNfSnapshot() {
        const snap = this.getNfSnap();
        try {
            this.nfFrozen = JSON.parse(JSON.stringify(snap));
        } catch (_) {
            this.nfFrozen = snap;
        }
    }

    buildNfKernelMorphHtml(target = {}) {
        const snap = this.getNfSnap();
        const nf = snap.netfilter || {};
        const flow = snap.flow || {};
        const n = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
        const esc = (v) => this.escapeHtml(v);
        const drops = n(nf.drop_per_sec);
        const ratio = n(nf.drop_ratio);
        const ct = n(nf.conntrack_count);
        const ctMax = n(nf.conntrack_max);
        const ctUsage = n(nf.conntrack_usage);
        const engine = nf.nft ? 'nftables' : (nf.nf_conntrack ? 'iptables+ct' : 'netfilter');
        const verdict = drops > 0.5 || ratio > 0.01 ? 'NF_DROP pressure' : 'NF_ACCEPT path';
        const verdictCol = drops > 0.5 || ratio > 0.01 ? '#e69696' : '#96ffbe';
        const focus = target.focus || 'hook';
        const hi = (key, accent) => (focus === key ? accent : 'rgba(96,110,128,0.32)');
        const step = (sym, title, body, accent) => (
            '<div class="ns-nf-morph-step" style="opacity:0; transform:translateY(6px); transition:opacity 320ms ease, transform 320ms ease; flex:1 1 140px; min-width:132px; background:rgba(8,12,20,0.78); border:1px solid '
            + accent + '; border-radius:6px; padding:8px 9px;">'
            + '<div style="font-size:8px; letter-spacing:0.7px; color:#7f93a6; margin-bottom:3px;">' + esc(title) + '</div>'
            + '<div style="font-size:11px; color:#e8f2f9; line-height:1.35; word-break:break-word;">' + body + '</div>'
            + '<div style="margin-top:6px; font-size:8.5px; letter-spacing:0.4px; color:#a9d4e8;">' + esc(sym) + '</div>'
            + '</div>'
        );
        const arrow = '<div class="ns-nf-morph-arrow" style="opacity:0; transition:opacity 280ms ease; color:#556273; font-size:14px; padding:0 2px;">↓</div>';
        const flowName = esc(flow.state_name || '-');
        const stepsHtml = [
            step(
                'NF_HOOK / nf_hook_slow',
                '1 · HOOK',
                '<span style="color:#e69696">PREROUTING → LOCAL_IN / FORWARD → POSTROUTING</span><br>'
                + '<span style="color:#8d99a7;font-size:10px;">engine ' + esc(engine) + ' · flow ' + flowName + '</span>',
                hi('hook', 'rgba(232,96,104,0.45)')
            ),
            arrow,
            step(
                'nf_conntrack_in',
                '2 · CONNTRACK',
                'ct entries <span style="color:#a9d4e8">' + esc(ct) + '</span>'
                + ' / <span style="color:#8d99a7">' + esc(ctMax || '-') + '</span>'
                + ' · <span style="color:#e6c15a">' + esc((ctUsage * 100).toFixed(2)) + '%</span><br>'
                + '<span style="color:#8d99a7;font-size:10px;">tuple → nf_conn · NEW / ESTABLISHED</span>',
                hi('ct', 'rgba(103,190,224,0.45)')
            ),
            arrow,
            step(
                'nft_do_chain / iptable_*',
                '3 · CHAIN',
                'rules walk the skb at the active hook<br>'
                + '<span style="color:#8d99a7;font-size:10px;">match → target (filter / nat / mangle)</span>',
                hi('chain', 'rgba(230,193,90,0.45)')
            ),
            arrow,
            step(
                'nft_verdict / NF_DROP',
                '4 · VERDICT',
                '<span style="color:' + verdictCol + '">' + esc(verdict) + '</span><br>'
                + '<span style="color:#8d99a7;font-size:10px;">drop/s ' + esc(drops) + ' · ratio ' + (ratio * 100).toFixed(2) + '%</span>',
                hi('verdict', 'rgba(232,96,104,0.5)')
            ),
            arrow,
            step(
                'okfn / skb continue',
                '5 · CONTINUE',
                'ACCEPT → stack continues · DROP → kfree_skb<br>'
                + '<span style="color:#8d99a7;font-size:10px;">surviving skb → TCP/IP path</span>',
                hi('continue', 'rgba(150,255,190,0.35)')
            ),
        ].join('');

        return (
            '<div class="ns-nf-morph" data-morph="1" style="margin:0 0 12px; padding:10px 12px; border:1px solid rgba(232,96,104,0.4); border-radius:8px; background:linear-gradient(180deg, rgba(232,96,104,0.10), rgba(8,12,20,0.35));">'
            + '<div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">'
            + '<div style="flex:1;">'
            + '<div style="font-size:9px; letter-spacing:1px; color:#e69696;">NETFILTER → KERNEL TRANSLATION</div>'
            + '<div style="font-size:10px; color:#8d99a7; margin-top:2px;">policy is not a black box — hooks, conntrack tuples, then a verdict on the skb</div>'
            + '</div>'
            + '<button type="button" class="ns-nf-morph-close" style="cursor:pointer; font:inherit; font-size:9px; letter-spacing:0.5px; color:#c8ccd4; background:transparent; border:1px solid rgba(160,170,190,0.35); border-radius:12px; padding:4px 10px;">CLOSE</button>'
            + '</div>'
            + '<div style="display:flex; flex-direction:column; gap:6px; align-items:stretch;">'
            + stepsHtml
            + '</div>'
            + '<div style="margin-top:8px; font-size:8.5px; color:#556273; letter-spacing:0.4px;">'
            + 'symbols: nf_hook_slow → nf_conntrack_in → nft_do_chain → nft_verdict → okfn'
            + '</div></div>'
        );
    }

    animateNfMorph(root) {
        if (!root) return;
        const steps = [...root.querySelectorAll('.ns-nf-morph-step')];
        const arrows = [...root.querySelectorAll('.ns-nf-morph-arrow')];
        steps.forEach((el, i) => {
            setTimeout(() => {
                el.style.opacity = '1';
                el.style.transform = 'translateY(0)';
                if (arrows[i]) arrows[i].style.opacity = '1';
            }, 90 + i * 160);
        });
    }

    buildNfLayerMapHtml({ compact = false } = {}) {
        const snap = this.getNfSnap();
        const nf = snap.netfilter || {};
        const n = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
        const esc = (v) => this.escapeHtml(v);
        const drops = n(nf.drop_per_sec);
        const ratio = n(nf.drop_ratio);
        const ct = n(nf.conntrack_count);
        const ctMax = n(nf.conntrack_max);
        const engine = nf.nft ? 'nftables' : (nf.nf_conntrack ? 'iptables+ct' : 'netfilter');
        const focus = this.nfMorphTarget?.focus || '';
        const row = (key, label, value, color) => {
            const active = focus === key;
            return `<div class="ns-nf-row" data-nf-focus="${key}" title="Translate into hooks / conntrack / verdict" style="display:flex; gap:8px; align-items:baseline; padding:5px 6px; margin:0 -4px 3px; border-radius:4px; cursor:pointer; border:1px solid ${active ? color : 'rgba(70,82,98,0.35)'}; background:${active ? 'rgba(232,96,104,0.10)' : 'rgba(8,12,20,0.35)'};">
                <span style="min-width:${compact ? '64px' : '88px'}; font-size:8px; letter-spacing:0.6px; color:#7f93a6;">${label}</span>
                <span style="color:${color}; font-size:${compact ? '12px' : '14px'};">${esc(value)}</span>
            </div>`;
        };
        return `
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
                <div style="flex:1;">
                    <div style="font-size:10px;color:#7f8fa2;letter-spacing:0.6px;">NETFILTER MAP · L03 · ${esc(engine)}</div>
                    <div style="font-size:9px;color:#556273;margin-top:2px;">hooks · nf_conntrack · verdict</div>
                </div>
                ${compact ? `<button type="button" class="ns-nf-back-puzzle" style="cursor:pointer; font:inherit; font-size:9px; letter-spacing:0.6px; color:#a9d4e8; background:rgba(103,190,224,0.1); border:1px solid rgba(103,190,224,0.4); border-radius:12px; padding:4px 10px;">← PUZZLE</button>` : ''}
            </div>
            ${compact ? '<div style="font-size:8.5px;color:#556273;margin:0 0 6px;">click a field → Netfilter→kernel morph (center)</div>' : ''}
            <div style="display:grid; grid-template-columns:${compact ? '1fr' : '1.1fr 0.9fr'}; gap:10px;">
                <div>
                    ${row('hook', 'HOOKS', 'PREROUTING…POSTROUTING', '#e69696')}
                    ${row('ct', 'CONNTRACK', `${ct} / ${ctMax || '—'}`, '#a9d4e8')}
                    ${row('verdict', 'DROPS', `${drops}/s · ${(ratio * 100).toFixed(2)}%`, drops > 0 ? '#e69696' : '#8d99a7')}
                    ${row('chain', 'ENGINE', engine, '#e6c15a')}
                </div>
                <div style="font-size:9.5px; line-height:1.55; color:#8d99a7;">
                    <div style="font-size:8px; letter-spacing:1px; color:#6f8597; margin-bottom:4px;">RX PATH</div>
                    <div>NIC → <span style="color:#e69696">PREROUTING</span></div>
                    <div>→ <span style="color:#a9d4e8">nf_conntrack_in</span></div>
                    <div>→ <span style="color:#e6c15a">nft_do_chain</span></div>
                    <div>→ verdict → TCP/IP or drop</div>
                    ${!compact ? `<div style="margin-top:10px;">
                        <button type="button" class="ns-nf-open-morph" style="cursor:pointer; font:inherit; font-size:10px; letter-spacing:0.7px; color:#e69696; background:rgba(232,96,104,0.12); border:1px solid rgba(232,96,104,0.45); border-radius:14px; padding:5px 12px;">▸ NETFILTER → KERNEL TRANSLATION</button>
                    </div>` : ''}
                </div>
            </div>`;
    }

    bindNfMapInteractions(root) {
        if (!root) return;
        root.querySelectorAll('.ns-nf-row').forEach((el) => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openNfKernelMorph({ focus: el.getAttribute('data-nf-focus') || 'hook' });
            });
        });
        const openMorph = root.querySelector('.ns-nf-open-morph');
        if (openMorph) {
            openMorph.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openNfKernelMorph({ focus: 'hook' });
            });
        }
        const back = root.querySelector('.ns-nf-back-puzzle');
        if (back) {
            back.addEventListener('click', () => {
                this.nfMapPinned = false;
                this.nfMorphTarget = null;
                this.nfFrozen = null;
                if (this.drillLayerId === 'netfilter') this.closeLayerDrilldown();
                else this.updatePacketLifecycleUI();
            });
        }
        const morphClose = root.querySelector('.ns-nf-morph-close');
        if (morphClose) {
            morphClose.addEventListener('click', (e) => {
                e.stopPropagation();
                this.nfMorphTarget = null;
                this.renderNfLayerMapPanel();
                this.refreshNfMapViews({ drillOnly: true });
            });
        }
        const morphRoot = root.querySelector('.ns-nf-morph');
        if (morphRoot) this.animateNfMorph(morphRoot);
    }

    renderNfLayerMapPanel() {
        if (!this.lifecyclePanelNode) return;
        window.setSafeHtml(this.lifecyclePanelNode, this.buildNfLayerMapHtml({ compact: true }));
        this.bindNfMapInteractions(this.lifecyclePanelNode);
    }

    refreshNfMapViews({ drillOnly = false } = {}) {
        if (!drillOnly && this.lifecyclePanelNode && (this.nfMapPinned || this.drillLayerId === 'netfilter')) {
            this.renderNfLayerMapPanel();
        }
        if (this.drillLayerId === 'netfilter' && this.drillScrim?.style.display === 'block') {
            const info = this.getLayerDrillInfo('netfilter');
            if (!info || !this.drillPanel) return;
            const act = Math.round(Math.max(0, Math.min(1, Number(this.layerActivity.netfilter ?? 0))) * 100);
            const actCol = act > 80 ? 'rgba(232,96,104,0.95)' : (act > 55 ? 'rgba(230,193,90,0.95)' : 'rgba(103,190,224,0.95)');
            const metrics = this.getLayerDrillMetrics('netfilter');
            const metricCells = metrics.map(([k, v]) => `
                <div style="background:rgba(8,12,20,0.7); border:1px solid rgba(96,110,128,0.32); border-radius:4px; padding:8px 10px;">
                    <div style="font-size:8.5px; letter-spacing:0.6px; color:#7f93a6; text-transform:uppercase;">${k}</div>
                    <div style="font-size:18px; color:#e2edf5; line-height:1.15; margin-top:2px;">${v}</div>
                </div>`).join('');
            const morph = this.nfMorphTarget
                ? this.buildNfKernelMorphHtml(this.nfMorphTarget)
                : `<div style="margin:0 0 10px; font-size:10px; color:#6f8597; letter-spacing:0.4px;">
                    tip: click <span style="color:#e69696">hooks</span> / <span style="color:#a9d4e8">conntrack</span> / <span style="color:#e6c15a">verdict</span>
                   </div>`;
            const html = `
                <div style="display:flex; align-items:center; gap:12px; padding:14px 18px; border-bottom:1px solid rgba(232,96,104,0.35); background:linear-gradient(90deg, rgba(232,96,104,0.12), rgba(103,190,224,0.05));">
                    <div style="flex:1 1 auto;">
                        <div style="font-size:8px; letter-spacing:1.4px; color:#6f8597;">STACK LAYER · FIREWALL · L03</div>
                        <div style="font-size:20px; letter-spacing:1.2px; color:#e8f2f9;">NETFILTER · HOOK / CT / VERDICT</div>
                    </div>
                    <div style="flex:none; text-align:right;">
                        <div style="font-size:8px; letter-spacing:1px; color:#6f8597;">LIVE ACTIVITY</div>
                        <div style="font-size:22px; color:${actCol};">${act}<span style="font-size:11px; color:#7f93a6;">%</span></div>
                    </div>
                    <div class="ns-ov-close" style="flex:none; cursor:pointer; width:26px; height:26px; border:1px solid rgba(160,170,190,0.4); border-radius:4px; display:flex; align-items:center; justify-content:center; color:#c8ccd4; font-size:14px;">✕</div>
                </div>
                <div style="padding:14px 18px 16px; max-height:78vh; overflow:auto;">
                    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:8px; margin-bottom:12px;">${metricCells}</div>
                    <div style="font-size:11.5px; line-height:1.6; color:#c2cede; margin-bottom:10px;">${info.what}</div>
                    <div style="margin-bottom:8px; font-size:10.5px; line-height:1.55; color:#9db6c8; border-left:2px solid rgba(232,96,104,0.6); padding-left:9px;"><span style="color:#e69696; letter-spacing:0.5px;">WATCH · </span>${info.watch}</div>
                    ${morph}
                    ${this.buildNfLayerMapHtml({ compact: false })}
                </div>`;
            window.setSafeHtml(this.drillPanel, html);
            const closeBtn = this.drillPanel.querySelector('.ns-ov-close');
            if (closeBtn) closeBtn.addEventListener('click', () => this.closeLayerDrilldown());
            this.bindNfMapInteractions(this.drillPanel);
        }
    }

    openNfKernelMorph(target) {
        this.freezeNfSnapshot();
        this.nfMorphTarget = target || { focus: 'hook' };
        this.nfMapPinned = true;
        this.ipMapPinned = false;
        this.ipMorphTarget = null;
        this.tcpMapPinned = false;
        this.tcpMorphTarget = null;
        this.sockMapPinned = false;
        this.sockMorphTarget = null;
        if (this.lifecyclePanelNode) this.renderNfLayerMapPanel();
        if (this.drillLayerId !== 'netfilter') {
            this.openLayerDrilldown('netfilter');
            return;
        }
        this.refreshNfMapViews({ drillOnly: true });
    }

    getSockSnap() {
        if (this.sockFrozen) return this.sockFrozen;
        return {
            socket_api: { ...(this.telemetryData?.layer_metrics?.socket_api || {}) },
            flow: { ...(this.telemetryData?.flow || {}) },
        };
    }

    freezeSockSnapshot() {
        const snap = this.getSockSnap();
        try {
            this.sockFrozen = JSON.parse(JSON.stringify(snap));
        } catch (_) {
            this.sockFrozen = snap;
        }
    }

    buildSockKernelMorphHtml(target = {}) {
        const snap = this.getSockSnap();
        const sa = snap.socket_api || {};
        const flow = snap.flow || {};
        const ex = sa.example || {};
        const n = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
        const esc = (v) => this.escapeHtml(v);
        const fd = ex.fd != null ? ex.fd : (flow.fd != null ? flow.fd : null);
        const inode = n(ex.inode != null ? ex.inode : flow.inode);
        const pid = ex.pid != null ? ex.pid : (flow.pid != null ? flow.pid : null);
        const proc = ex.process || flow.process || 'process';
        const local = ex.local || flow.local || 'local';
        const remote = ex.remote || flow.remote || 'remote';
        const state = ex.state_name || flow.state_name || 'ESTABLISHED';
        const est = n(sa.established);
        const active = n(sa.active_sockets);
        const focus = target.focus || 'fd';
        const hi = (key, accent) => (focus === key ? accent : 'rgba(96,110,128,0.32)');
        const fdLabel = fd != null ? String(fd) : 'fd?';
        const inodeLabel = inode > 0 ? String(inode) : 'inode?';
        const pidLabel = pid != null ? String(pid) : 'pid?';
        const skHint = inode > 0 ? ('sk@inode:' + inode) : 'struct sock *';

        const step = (sym, title, body, accent) => (
            '<div class="ns-sock-morph-step" style="opacity:0; transform:translateY(6px); transition:opacity 320ms ease, transform 320ms ease; flex:1 1 140px; min-width:132px; background:rgba(8,12,20,0.78); border:1px solid '
            + accent + '; border-radius:6px; padding:8px 9px;">'
            + '<div style="font-size:8px; letter-spacing:0.7px; color:#7f93a6; margin-bottom:3px;">' + esc(title) + '</div>'
            + '<div style="font-size:11px; color:#e8f2f9; line-height:1.35; word-break:break-word;">' + body + '</div>'
            + '<div style="margin-top:6px; font-size:8.5px; letter-spacing:0.4px; color:#a9d4e8;">' + esc(sym) + '</div>'
            + '</div>'
        );
        const arrow = '<div class="ns-sock-morph-arrow" style="opacity:0; transition:opacity 280ms ease; color:#556273; font-size:14px; padding:0 2px;">↓</div>';
        const stepsHtml = [
            step(
                'fget / fdtable',
                '1 · FILE DESCRIPTOR',
                'fd <span style="color:#96ffbe">' + esc(fdLabel) + '</span>'
                + ' · pid <span style="color:#a9d4e8">' + esc(pidLabel) + '</span>'
                + ' <span style="color:#8d99a7;">(' + esc(proc) + ')</span><br>'
                + '<span style="color:#8d99a7;font-size:10px;">userspace handle → files_struct</span>',
                hi('fd', 'rgba(150,255,190,0.45)')
            ),
            arrow,
            step(
                'SOCKET_I(inode)',
                '2 · INODE → socket',
                'inode <span style="color:#e6c15a">' + esc(inodeLabel) + '</span>'
                + ' · uid <span style="color:#8d99a7">' + esc(ex.uid != null ? ex.uid : (flow.uid || 0)) + '</span><br>'
                + '<span style="color:#8d99a7;font-size:10px;">file → dentry → inode → struct socket</span>',
                hi('inode', 'rgba(230,193,90,0.45)')
            ),
            arrow,
            step(
                'sock_alloc / socket->sk',
                '3 · struct sock *',
                '<span style="color:#a9d4e8">' + esc(skHint) + '</span><br>'
                + '<span style="color:#d4dde7">' + esc(local) + '</span>'
                + '<span style="color:#556273;"> → </span>'
                + '<span style="color:#a9d4e8">' + esc(remote) + '</span><br>'
                + '<span style="color:#8d99a7;font-size:10px;">state ' + esc(state) + ' · protocol socket object</span>',
                hi('sk', 'rgba(103,190,224,0.5)')
            ),
            arrow,
            step(
                'sk_receive_queue / sk_write_queue',
                '4 · QUEUES',
                'active <span style="color:#a9d4e8">' + esc(active) + '</span>'
                + ' · established <span style="color:#96ffbe">' + esc(est) + '</span><br>'
                + '<span style="color:#8d99a7;font-size:10px;">recv/send buffers · accept backlog · wakeups</span>',
                hi('queue', 'rgba(150,255,190,0.35)')
            ),
            arrow,
            step(
                'sock_sendmsg / sock_recvmsg',
                '5 · SYSCALL PATH',
                'sendmsg / recvmsg copy between user pages and sk_buff<br>'
                + '<span style="color:#8d99a7;font-size:10px;">fd stays the only handle the process ever sees</span>',
                hi('syscall', 'rgba(212,221,231,0.35)')
            ),
        ].join('');

        return (
            '<div class="ns-sock-morph" data-morph="1" style="margin:0 0 12px; padding:10px 12px; border:1px solid rgba(150,255,190,0.4); border-radius:8px; background:linear-gradient(180deg, rgba(150,255,190,0.10), rgba(8,12,20,0.35));">'
            + '<div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">'
            + '<div style="flex:1;">'
            + '<div style="font-size:9px; letter-spacing:1px; color:#96ffbe;">SOCKET → KERNEL TRANSLATION</div>'
            + '<div style="font-size:10px; color:#8d99a7; margin-top:2px;">an fd is not the socket — it is a path: fd → file → inode → socket → sock*</div>'
            + '</div>'
            + '<button type="button" class="ns-sock-morph-close" style="cursor:pointer; font:inherit; font-size:9px; letter-spacing:0.5px; color:#c8ccd4; background:transparent; border:1px solid rgba(160,170,190,0.35); border-radius:12px; padding:4px 10px;">CLOSE</button>'
            + '</div>'
            + '<div style="display:flex; flex-direction:column; gap:6px; align-items:stretch;">'
            + stepsHtml
            + '</div>'
            + '<div style="margin-top:8px; font-size:8.5px; color:#556273; letter-spacing:0.4px;">'
            + 'symbols: fget → SOCKET_I → socket-&gt;sk → sk_*_queue → sock_sendmsg/recvmsg'
            + '</div></div>'
        );
    }

    animateSockMorph(root) {
        if (!root) return;
        const steps = [...root.querySelectorAll('.ns-sock-morph-step')];
        const arrows = [...root.querySelectorAll('.ns-sock-morph-arrow')];
        steps.forEach((el, i) => {
            setTimeout(() => {
                el.style.opacity = '1';
                el.style.transform = 'translateY(0)';
                if (arrows[i]) arrows[i].style.opacity = '1';
            }, 90 + i * 160);
        });
    }

    buildSockLayerMapHtml({ compact = false } = {}) {
        const snap = this.getSockSnap();
        const sa = snap.socket_api || {};
        const flow = snap.flow || {};
        const ex = sa.example || {};
        const n = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
        const esc = (v) => this.escapeHtml(v);
        const fd = ex.fd != null ? ex.fd : flow.fd;
        const inode = n(ex.inode != null ? ex.inode : flow.inode);
        const pid = ex.pid != null ? ex.pid : flow.pid;
        const proc = ex.process || flow.process || '—';
        const local = ex.local || flow.local || '—';
        const remote = ex.remote || flow.remote || '—';
        const state = ex.state_name || flow.state_name || '—';
        const focus = this.sockMorphTarget?.focus || '';
        const row = (key, label, value, color) => {
            const active = focus === key;
            return (
                '<div class="ns-sock-row" data-sock-focus="' + key + '" title="Translate into fd → sock*" style="display:flex; gap:8px; align-items:baseline; padding:5px 6px; margin:0 -4px 3px; border-radius:4px; cursor:pointer; border:1px solid '
                + (active ? color : 'rgba(70,82,98,0.35)') + '; background:'
                + (active ? 'rgba(150,255,190,0.10)' : 'rgba(8,12,20,0.35)') + ';">'
                + '<span style="min-width:' + (compact ? '64px' : '88px') + '; font-size:8px; letter-spacing:0.6px; color:#7f93a6;">' + label + '</span>'
                + '<span style="color:' + color + '; font-size:' + (compact ? '12px' : '14px') + ';">' + esc(value) + '</span>'
                + '</div>'
            );
        };
        return (
            '<div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">'
            + '<div style="flex:1;">'
            + '<div style="font-size:10px;color:#7f8fa2;letter-spacing:0.6px;">SOCKET MAP · L06 · fd → sock*</div>'
            + '<div style="font-size:9px;color:#556273;margin-top:2px;">files_struct · inode · struct sock</div>'
            + '</div>'
            + (compact
                ? '<button type="button" class="ns-sock-back-puzzle" style="cursor:pointer; font:inherit; font-size:9px; letter-spacing:0.6px; color:#a9d4e8; background:rgba(103,190,224,0.1); border:1px solid rgba(103,190,224,0.4); border-radius:12px; padding:4px 10px;">← PUZZLE</button>'
                : '')
            + '</div>'
            + (compact ? '<div style="font-size:8.5px;color:#556273;margin:0 0 6px;">click a field → Socket→kernel morph (center)</div>' : '')
            + '<div style="display:grid; grid-template-columns:' + (compact ? '1fr' : '1.1fr 0.9fr') + '; gap:10px;">'
            + '<div>'
            + row('fd', 'FD', fd != null ? (fd + ' · pid ' + (pid != null ? pid : '?')) : 'n/a (no process match)', '#96ffbe')
            + row('inode', 'INODE', inode > 0 ? String(inode) : 'n/a', '#e6c15a')
            + row('sk', 'SOCK*', local + ' → ' + remote, '#a9d4e8')
            + row('queue', 'QUEUES', 'est ' + n(sa.established) + ' / active ' + n(sa.active_sockets), '#96ffbe')
            + row('syscall', 'STATE', state + ' · ' + proc, '#d4dde7')
            + '</div>'
            + '<div style="font-size:9.5px; line-height:1.55; color:#8d99a7;">'
            + '<div style="font-size:8px; letter-spacing:1px; color:#6f8597; margin-bottom:4px;">LOOKUP PATH</div>'
            + '<div>userspace <span style="color:#96ffbe">fd</span></div>'
            + '<div>→ <span style="color:#e6c15a">inode / SOCKET_I</span></div>'
            + '<div>→ <span style="color:#a9d4e8">struct sock *</span></div>'
            + '<div>→ queues → TCP/UDP</div>'
            + (!compact
                ? '<div style="margin-top:10px;">'
                  + '<button type="button" class="ns-sock-open-morph" style="cursor:pointer; font:inherit; font-size:10px; letter-spacing:0.7px; color:#96ffbe; background:rgba(150,255,190,0.12); border:1px solid rgba(150,255,190,0.45); border-radius:14px; padding:5px 12px;">▸ SOCKET → KERNEL TRANSLATION</button>'
                  + '</div>'
                : '')
            + '</div></div>'
        );
    }

    bindSockMapInteractions(root) {
        if (!root) return;
        root.querySelectorAll('.ns-sock-row').forEach((el) => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openSockKernelMorph({ focus: el.getAttribute('data-sock-focus') || 'fd' });
            });
        });
        const openMorph = root.querySelector('.ns-sock-open-morph');
        if (openMorph) {
            openMorph.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openSockKernelMorph({ focus: 'fd' });
            });
        }
        const back = root.querySelector('.ns-sock-back-puzzle');
        if (back) {
            back.addEventListener('click', () => {
                this.sockMapPinned = false;
                this.sockMorphTarget = null;
                this.sockFrozen = null;
                if (this.drillLayerId === 'socket') this.closeLayerDrilldown();
                else this.updatePacketLifecycleUI();
            });
        }
        const morphClose = root.querySelector('.ns-sock-morph-close');
        if (morphClose) {
            morphClose.addEventListener('click', (e) => {
                e.stopPropagation();
                this.sockMorphTarget = null;
                this.renderSockLayerMapPanel();
                this.refreshSockMapViews({ drillOnly: true });
            });
        }
        const morphRoot = root.querySelector('.ns-sock-morph');
        if (morphRoot) this.animateSockMorph(morphRoot);
    }

    renderSockLayerMapPanel() {
        if (!this.lifecyclePanelNode) return;
        window.setSafeHtml(this.lifecyclePanelNode, this.buildSockLayerMapHtml({ compact: true }));
        this.bindSockMapInteractions(this.lifecyclePanelNode);
    }

    refreshSockMapViews({ drillOnly = false } = {}) {
        if (!drillOnly && this.lifecyclePanelNode && (this.sockMapPinned || this.drillLayerId === 'socket')) {
            this.renderSockLayerMapPanel();
        }
        if (this.drillLayerId === 'socket' && this.drillScrim?.style.display === 'block') {
            const info = this.getLayerDrillInfo('socket');
            if (!info || !this.drillPanel) return;
            const act = Math.round(Math.max(0, Math.min(1, Number(this.layerActivity.socket ?? 0))) * 100);
            const actCol = act > 80 ? 'rgba(232,96,104,0.95)' : (act > 55 ? 'rgba(230,193,90,0.95)' : 'rgba(103,190,224,0.95)');
            const metrics = this.getLayerDrillMetrics('socket');
            const metricCells = metrics.map(([k, v]) => (
                '<div style="background:rgba(8,12,20,0.7); border:1px solid rgba(96,110,128,0.32); border-radius:4px; padding:8px 10px;">'
                + '<div style="font-size:8.5px; letter-spacing:0.6px; color:#7f93a6; text-transform:uppercase;">' + this.escapeHtml(k) + '</div>'
                + '<div style="font-size:18px; color:#e2edf5; line-height:1.15; margin-top:2px;">' + this.escapeHtml(v) + '</div>'
                + '</div>'
            )).join('');
            const morph = this.sockMorphTarget
                ? this.buildSockKernelMorphHtml(this.sockMorphTarget)
                : '<div style="margin:0 0 10px; font-size:10px; color:#6f8597; letter-spacing:0.4px;">'
                  + 'tip: click <span style="color:#96ffbe">fd</span> / <span style="color:#e6c15a">inode</span> / <span style="color:#a9d4e8">sock*</span>'
                  + '</div>';
            const html = (
                '<div style="display:flex; align-items:center; gap:12px; padding:14px 18px; border-bottom:1px solid rgba(150,255,190,0.35); background:linear-gradient(90deg, rgba(150,255,190,0.12), rgba(103,190,224,0.05));">'
                + '<div style="flex:1 1 auto;">'
                + '<div style="font-size:8px; letter-spacing:1.4px; color:#6f8597;">STACK LAYER · SOCKET API · L06</div>'
                + '<div style="font-size:20px; letter-spacing:1.2px; color:#e8f2f9;">SOCKET · FD / INODE / SOCK*</div>'
                + '</div>'
                + '<div style="flex:none; text-align:right;">'
                + '<div style="font-size:8px; letter-spacing:1px; color:#6f8597;">LIVE ACTIVITY</div>'
                + '<div style="font-size:22px; color:' + actCol + ';">' + act + '<span style="font-size:11px; color:#7f93a6;">%</span></div>'
                + '</div>'
                + '<div class="ns-ov-close" style="flex:none; cursor:pointer; width:26px; height:26px; border:1px solid rgba(160,170,190,0.4); border-radius:4px; display:flex; align-items:center; justify-content:center; color:#c8ccd4; font-size:14px;">✕</div>'
                + '</div>'
                + '<div style="padding:14px 18px 16px; max-height:78vh; overflow:auto;">'
                + '<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:8px; margin-bottom:12px;">' + metricCells + '</div>'
                + '<div style="font-size:11.5px; line-height:1.6; color:#c2cede; margin-bottom:10px;">' + info.what + '</div>'
                + '<div style="margin-bottom:8px; font-size:10.5px; line-height:1.55; color:#9db6c8; border-left:2px solid rgba(150,255,190,0.6); padding-left:9px;"><span style="color:#96ffbe; letter-spacing:0.5px;">WATCH · </span>' + info.watch + '</div>'
                + morph
                + this.buildSockLayerMapHtml({ compact: false })
                + '</div>'
            );
            window.setSafeHtml(this.drillPanel, html);
            const closeBtn = this.drillPanel.querySelector('.ns-ov-close');
            if (closeBtn) closeBtn.addEventListener('click', () => this.closeLayerDrilldown());
            this.bindSockMapInteractions(this.drillPanel);
        }
    }

    openSockKernelMorph(target) {
        this.freezeSockSnapshot();
        this.sockMorphTarget = target || { focus: 'fd' };
        this.sockMapPinned = true;
        this.ipMapPinned = false;
        this.ipMorphTarget = null;
        this.tcpMapPinned = false;
        this.tcpMorphTarget = null;
        this.nfMapPinned = false;
        this.nfMorphTarget = null;
        if (this.lifecyclePanelNode) this.renderSockLayerMapPanel();
        if (this.drillLayerId !== 'socket') {
            this.openLayerDrilldown('socket');
            return;
        }
        this.refreshSockMapViews({ drillOnly: true });
    }

    clearLayerPinsExcept(keep) {
        if (keep !== 'ip') {
            this.ipMapPinned = false;
            this.ipMorphTarget = null;
            this.ipMapFrozen = null;
        }
        if (keep !== 'tcp') {
            this.tcpMapPinned = false;
            this.tcpMorphTarget = null;
            this.tcpFrozen = null;
        }
        if (keep !== 'netfilter') {
            this.nfMapPinned = false;
            this.nfMorphTarget = null;
            this.nfFrozen = null;
        }
        if (keep !== 'socket') {
            this.sockMapPinned = false;
            this.sockMorphTarget = null;
            this.sockFrozen = null;
        }
    }

    openLayerDrilldown(layerId) {
        if (!this.drillScrim || !this.drillPanel) return;
        const info = this.getLayerDrillInfo(layerId);
        if (!info) return;
        this.drillLayerId = layerId;

        if (layerId === 'ip') {
            this.clearLayerPinsExcept('ip');
            this.ipMapPinned = true;
            if (!this.ipMapFrozen) this.freezeIpMapSnapshot();
            this.drillPanel.style.width = 'min(980px, 92vw)';
            this.drillScrim.style.display = 'block';
            if (this.layerTooltipNode) this.layerTooltipNode.style.display = 'none';
            this.refreshIpMapViews();
            return;
        }

        if (layerId === 'tcp') {
            this.clearLayerPinsExcept('tcp');
            this.tcpMapPinned = true;
            if (!this.tcpFrozen) this.freezeTcpSnapshot();
            this.drillPanel.style.width = 'min(980px, 92vw)';
            this.drillScrim.style.display = 'block';
            if (this.layerTooltipNode) this.layerTooltipNode.style.display = 'none';
            this.refreshTcpMapViews();
            return;
        }

        if (layerId === 'netfilter') {
            this.clearLayerPinsExcept('netfilter');
            this.nfMapPinned = true;
            if (!this.nfFrozen) this.freezeNfSnapshot();
            this.drillPanel.style.width = 'min(980px, 92vw)';
            this.drillScrim.style.display = 'block';
            if (this.layerTooltipNode) this.layerTooltipNode.style.display = 'none';
            this.refreshNfMapViews();
            return;
        }

        if (layerId === 'socket') {
            this.clearLayerPinsExcept('socket');
            this.sockMapPinned = true;
            if (!this.sockFrozen) this.freezeSockSnapshot();
            this.drillPanel.style.width = 'min(980px, 92vw)';
            this.drillScrim.style.display = 'block';
            if (this.layerTooltipNode) this.layerTooltipNode.style.display = 'none';
            this.refreshSockMapViews();
            return;
        }

        this.clearLayerPinsExcept(null);
        this.drillPanel.style.width = 'min(680px, 78vw)';
        const act = Math.round(Math.max(0, Math.min(1, Number(this.layerActivity[layerId] ?? 0))) * 100);
        const actCol = act > 80 ? 'rgba(232,96,104,0.95)' : (act > 55 ? 'rgba(230,193,90,0.95)' : 'rgba(103,190,224,0.95)');
        const metrics = this.getLayerDrillMetrics(layerId);
        const metricCells = metrics.map(([k, v]) => `
            <div style="background:rgba(8,12,20,0.7); border:1px solid rgba(96,110,128,0.32); border-radius:4px; padding:8px 10px;">
                <div style="font-size:8.5px; letter-spacing:0.6px; color:#7f93a6; text-transform:uppercase;">${k}</div>
                <div style="font-size:20px; color:#e2edf5; line-height:1.15; margin-top:2px;">${v}</div>
            </div>`).join('');
        const subs = info.subsystems.map(s =>
            `<span style="display:inline-block; margin:2px 4px 2px 0; padding:2px 7px; background:rgba(103,190,224,0.12); border:1px solid rgba(103,190,224,0.34); border-radius:10px; font-size:9px; color:#a9d4e8;">${s}</span>`
        ).join('');
        const html = `
            <div style="display:flex; align-items:center; gap:12px; padding:14px 18px; border-bottom:1px solid rgba(103,190,224,0.25); background:linear-gradient(90deg, rgba(103,190,224,0.10), rgba(103,190,224,0));">
                <div style="flex:1 1 auto;">
                    <div style="font-size:8px; letter-spacing:1.4px; color:#6f8597;">STACK LAYER · ${info.role.toUpperCase()}</div>
                    <div style="font-size:20px; letter-spacing:1.2px; color:#e8f2f9;">${info.title}</div>
                </div>
                <div style="flex:none; text-align:right;">
                    <div style="font-size:8px; letter-spacing:1px; color:#6f8597;">LIVE ACTIVITY</div>
                    <div style="font-size:22px; color:${actCol};">${act}<span style="font-size:11px; color:#7f93a6;">%</span></div>
                </div>
                <div class="ns-ov-close" style="flex:none; cursor:pointer; width:26px; height:26px; border:1px solid rgba(160,170,190,0.4); border-radius:4px; display:flex; align-items:center; justify-content:center; color:#c8ccd4; font-size:14px;">✕</div>
            </div>
            <div style="padding:14px 18px 16px;">
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:8px; margin-bottom:14px;">${metricCells}</div>
                <div style="font-size:11.5px; line-height:1.6; color:#c2cede;">${info.what}</div>
                <div style="margin-top:10px; font-size:10.5px; line-height:1.55; color:#9db6c8; border-left:2px solid rgba(230,193,90,0.6); padding-left:9px;"><span style="color:#e6c15a; letter-spacing:0.5px;">WATCH · </span>${info.watch}</div>
                <div style="margin-top:12px;">
                    <div style="font-size:8px; letter-spacing:1px; color:#6f8597; margin-bottom:4px;">KEY SUBSYSTEMS</div>
                    ${subs}
                </div>
            </div>`;
        window.setSafeHtml(this.drillPanel, html);
        const closeBtn = this.drillPanel.querySelector('.ns-ov-close');
        if (closeBtn) closeBtn.addEventListener('click', () => this.closeLayerDrilldown());
        this.drillScrim.style.display = 'block';
        if (this.layerTooltipNode) this.layerTooltipNode.style.display = 'none';
    }

    closeLayerDrilldown() {
        const wasIp = this.drillLayerId === 'ip';
        const wasTcp = this.drillLayerId === 'tcp';
        const wasNf = this.drillLayerId === 'netfilter';
        const wasSock = this.drillLayerId === 'socket';
        this.clearKernelGhost();
        this._ghostPending = false;
        this.drillLayerId = null;
        this.ipMorphTarget = null;
        this.ipMapFrozen = null;
        this.tcpMorphTarget = null;
        this.tcpFrozen = null;
        this.nfMorphTarget = null;
        this.nfFrozen = null;
        this.sockMorphTarget = null;
        this.sockFrozen = null;
        if (this.drillScrim) this.drillScrim.style.display = 'none';
        if (this.drillPanel) this.drillPanel.style.width = 'min(680px, 78vw)';
        // After closing center overlay: keep compact layer map on the right
        // (pre-ribbon layout). ← PUZZLE restores the puzzle architecture.
        if (wasIp) {
            this.ipMapPinned = true;
            this.tcpMapPinned = false;
            this.nfMapPinned = false;
            this.sockMapPinned = false;
            this.renderIpLayerMapPanel();
        } else if (wasTcp) {
            this.tcpMapPinned = true;
            this.ipMapPinned = false;
            this.nfMapPinned = false;
            this.sockMapPinned = false;
            this.renderTcpLayerMapPanel();
        } else if (wasNf) {
            this.nfMapPinned = true;
            this.ipMapPinned = false;
            this.tcpMapPinned = false;
            this.sockMapPinned = false;
            this.renderNfLayerMapPanel();
        } else if (wasSock) {
            this.sockMapPinned = true;
            this.ipMapPinned = false;
            this.tcpMapPinned = false;
            this.nfMapPinned = false;
            this.renderSockLayerMapPanel();
        }
    }

    // Push the latest BBR sample into a rolling window (used to estimate the
    // max-bandwidth and min-RTT filters when the CC isn't BBR itself).
    recordBbrSample() {
        const b = this.telemetryData?.bbr;
        if (!b) return;
        if (!this.bbrHist) this.bbrHist = [];
        this.bbrHist.push({
            t: Date.now(),
            rtt: Number(b.rtt_ms) || 0,
            dr: Number(b.delivery_rate_mbps) || 0
        });
        if (this.bbrHist.length > 160) this.bbrHist.shift();
    }

    // Build the BBR path model: RTprop (min RTT), BtlBw (max delivery rate),
    // BDP and inflight. Uses the kernel's real minrtt + a windowed max of the
    // observed delivery rate (or BBR's own bw/mrtt when BBR is the CC).
    computeBbrModel() {
        const b = this.telemetryData?.bbr || {};
        const hist = this.bbrHist || [];
        const now = Date.now();
        // RTprop over a ~10s window (BBR's min-RTT filter horizon).
        const recentR = hist.filter(s => now - s.t <= 10000).map(s => s.rtt).filter(v => v > 0);
        const histMinRtt = recentR.length ? Math.min(...recentR) : 0;
        // BtlBw over a shorter window (BBR's max-bw filter ≈ 10 RTTs).
        const recentD = hist.slice(-40).map(s => s.dr).filter(v => v > 0);
        const histMaxBw = recentD.length ? Math.max(...recentD) : 0;
        const active = !!b.bbr_active;
        const rtprop = active ? (Number(b.bbr_mrtt_ms) || 0)
            : Math.min(...[Number(b.min_rtt_ms) || Infinity, histMinRtt || Infinity].filter(isFinite)) || (Number(b.rtt_ms) || 0);
        const btlbw = active ? (Number(b.bbr_bw_mbps) || 0)
            : Math.max(Number(b.delivery_rate_mbps) || 0, histMaxBw);
        const mss = Number(b.mss) || 1448;
        const cwnd = Number(b.cwnd) || 0;
        const inflightBytes = cwnd * mss;
        const bdpBytes = btlbw * rtprop * 125; // Mbps × ms × 125 = bytes
        return {
            cc: b.cc || 'unknown',
            active,
            rtprop,
            btlbw,
            curRtt: Number(b.rtt_ms) || 0,
            curDr: Number(b.delivery_rate_mbps) || 0,
            cwnd,
            mss,
            inflightBytes,
            bdpBytes
        };
    }

    bbrPlaneSvg(model) {
        const W = 480;
        const H = 300;
        const padL = 46;
        const padR = 18;
        const padT = 22;
        const padB = 34;
        const plotW = W - padL - padR;
        const plotH = H - padT - padB;
        const xMax = Math.max(model.curRtt * 1.35, model.rtprop * 3.2, 4);
        const yMax = Math.max(model.btlbw * 1.35, model.curDr * 1.3, 0.001);
        const px = (rtt) => padL + Math.min(1, rtt / xMax) * plotW;
        const py = (dr) => padT + plotH - Math.min(1, dr / yMax) * plotH;
        const kneeX = px(model.rtprop);
        const kneeY = py(model.btlbw);

        let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="display:block;width:${W}px;height:${H}px;max-width:100%;background:rgba(6,10,16,0.6);border:1px solid rgba(96,110,128,0.3);border-radius:4px;">`;
        // Buffer-filling zone (right of RTprop): where loss-based CC bloats RTT.
        s += `<rect x="${kneeX.toFixed(1)}" y="${padT}" width="${(padL + plotW - kneeX).toFixed(1)}" height="${plotH}" fill="rgba(232,96,104,0.06)"/>`;
        // Axes.
        s += `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="rgba(140,160,180,0.5)" stroke-width="1"/>`;
        s += `<line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="rgba(140,160,180,0.5)" stroke-width="1"/>`;
        // BtlBw ceiling (max bandwidth).
        s += `<line x1="${padL}" y1="${kneeY.toFixed(1)}" x2="${padL + plotW}" y2="${kneeY.toFixed(1)}" stroke="rgba(230,193,90,0.85)" stroke-width="1.2" stroke-dasharray="5 3"/>`;
        s += `<text x="${padL + 4}" y="${(kneeY - 5).toFixed(1)}" fill="rgba(230,193,90,0.95)" font-size="9" font-family="'Share Tech Mono',monospace">BtlBw · max bandwidth</text>`;
        // RTprop vertical (min RTT).
        s += `<line x1="${kneeX.toFixed(1)}" y1="${padT}" x2="${kneeX.toFixed(1)}" y2="${padT + plotH}" stroke="rgba(103,190,224,0.85)" stroke-width="1.2" stroke-dasharray="5 3"/>`;
        s += `<text x="${(kneeX + 4).toFixed(1)}" y="${padT + 10}" fill="rgba(150,200,230,0.95)" font-size="9" font-family="'Share Tech Mono',monospace">RTprop · min RTT</text>`;
        // History trail.
        const hist = (this.bbrHist || []).slice(-40).filter(s2 => s2.rtt > 0);
        if (hist.length >= 2) {
            let d = '';
            hist.forEach((pt, i) => { d += `${i === 0 ? 'M' : 'L'} ${px(pt.rtt).toFixed(1)} ${py(pt.dr).toFixed(1)} `; });
            s += `<path d="${d}" fill="none" stroke="rgba(168,200,214,0.35)" stroke-width="1"/>`;
            hist.forEach((pt) => { s += `<circle cx="${px(pt.rtt).toFixed(1)}" cy="${py(pt.dr).toFixed(1)}" r="1.5" fill="rgba(168,200,214,0.45)"/>`; });
        }
        // Optimal operating point (the BDP knee).
        s += `<circle cx="${kneeX.toFixed(1)}" cy="${kneeY.toFixed(1)}" r="7" fill="none" stroke="rgba(150,255,190,0.9)" stroke-width="1.5"/>`;
        s += `<circle cx="${kneeX.toFixed(1)}" cy="${kneeY.toFixed(1)}" r="2.5" fill="rgba(150,255,190,0.95)"/>`;
        s += `<text x="${(kneeX + 9).toFixed(1)}" y="${(kneeY + 13).toFixed(1)}" fill="rgba(150,255,190,0.9)" font-size="8.5" font-family="'Share Tech Mono',monospace">optimal (BDP)</text>`;
        // Current operating point.
        const cx = px(model.curRtt);
        const cy = py(model.curDr);
        s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="9" fill="rgba(232,96,104,0.14)"/>`;
        s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3.5" fill="rgba(232,96,104,0.95)"/>`;
        s += `<text x="${(cx + 8).toFixed(1)}" y="${(cy - 6).toFixed(1)}" fill="rgba(240,150,155,0.95)" font-size="8.5" font-family="'Share Tech Mono',monospace">now (${model.cc})</text>`;
        // Axis captions.
        s += `<text x="${padL + plotW}" y="${padT + plotH + 22}" text-anchor="end" fill="rgba(140,160,180,0.7)" font-size="8.5" font-family="'Share Tech Mono',monospace">round-trip time (ms) →</text>`;
        s += `<text x="${padL - 4}" y="${padT - 8}" fill="rgba(140,160,180,0.7)" font-size="8.5" font-family="'Share Tech Mono',monospace">delivery rate (Mbps) ↑</text>`;
        s += `</svg>`;
        return s;
    }

    openBbrOverlay() {
        if (!this.bbrScrim || !this.bbrPanel) return;
        const m = this.computeBbrModel();
        this.bbrOpen = true;
        const fmtBytes = (b) => (b >= 1024 * 1024 ? `${(b / 1048576).toFixed(2)} MB` : `${(b / 1024).toFixed(1)} KB`);
        const ratio = m.bdpBytes > 0 ? (m.inflightBytes / m.bdpBytes) : 0;
        const ratioPct = Math.round(ratio * 100);
        const ratioCol = ratio > 1.25 ? 'rgba(232,96,104,0.95)' : (ratio < 0.6 ? 'rgba(230,193,90,0.95)' : 'rgba(150,255,190,0.95)');
        const card = (k, v, sub) => `
            <div style="background:rgba(8,12,20,0.7); border:1px solid rgba(96,110,128,0.32); border-radius:4px; padding:8px 10px;">
                <div style="font-size:8.5px; letter-spacing:0.6px; color:#7f93a6; text-transform:uppercase;">${k}</div>
                <div style="font-size:18px; color:#e2edf5; line-height:1.15; margin-top:2px;">${v}</div>
                ${sub ? `<div style="font-size:8px; color:#728697; margin-top:1px;">${sub}</div>` : ''}
            </div>`;
        const modeNote = m.active
            ? `This connection runs <b style="color:#a9d4e8">BBR</b> — the values below are the kernel's own BtlBw / RTprop estimates.`
            : `This connection runs <b style="color:#e6c15a">${m.cc}</b> (loss-based). BtlBw / RTprop below are the same model BBR would build, estimated from the observed delivery rate (max) and min RTT.`;
        const html = `
            <div style="display:flex; align-items:center; gap:12px; padding:14px 18px; border-bottom:1px solid rgba(103,190,224,0.25); background:linear-gradient(90deg, rgba(103,190,224,0.10), rgba(103,190,224,0));">
                <div style="flex:1 1 auto;">
                    <div style="font-size:8px; letter-spacing:1.4px; color:#6f8597;">CONGESTION CONTROL · LEARNED PATH MODEL</div>
                    <div style="font-size:20px; letter-spacing:1.2px; color:#e8f2f9;">TCP BBR — BOTTLENECK BW × MIN RTT</div>
                </div>
                <div class="ns-ov-close" style="flex:none; cursor:pointer; width:26px; height:26px; border:1px solid rgba(160,170,190,0.4); border-radius:4px; display:flex; align-items:center; justify-content:center; color:#c8ccd4; font-size:14px;">✕</div>
            </div>
            <div style="display:flex; gap:16px; padding:14px 18px 16px; flex-wrap:wrap;">
                <div class="ns-bbr-plane" style="flex:1 1 420px; min-width:320px;"></div>
                <div style="flex:1 1 300px; min-width:260px; display:flex; flex-direction:column; gap:8px;">
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                        ${card('RTprop', `${m.rtprop.toFixed(2)} <span style="font-size:10px;color:#7f93a6">ms</span>`, 'min RTT · propagation')}
                        ${card('BtlBw', `${m.btlbw.toFixed(2)} <span style="font-size:10px;color:#7f93a6">Mbps</span>`, 'max delivery rate')}
                        ${card('BDP', fmtBytes(m.bdpBytes), 'BtlBw × RTprop')}
                        ${card('inflight', fmtBytes(m.inflightBytes), `cwnd ${m.cwnd} × mss ${m.mss}`)}
                    </div>
                    <div style="background:rgba(8,12,20,0.7); border:1px solid rgba(96,110,128,0.32); border-radius:4px; padding:8px 10px;">
                        <div style="display:flex; justify-content:space-between; font-size:8.5px; letter-spacing:0.6px; color:#7f93a6;"><span>INFLIGHT vs BDP</span><span style="color:${ratioCol}">${ratioPct}%</span></div>
                        <div style="position:relative; height:8px; margin-top:5px; background:rgba(40,52,64,0.6); border-radius:4px; overflow:hidden;">
                            <div style="position:absolute; left:0; top:0; bottom:0; width:${Math.min(100, ratioPct)}%; background:${ratioCol};"></div>
                            <div style="position:absolute; left:100%; top:-2px; bottom:-2px; width:1px; background:rgba(150,255,190,0.9);"></div>
                        </div>
                        <div style="font-size:8px; color:#728697; margin-top:3px;">green line = BDP target · over 100% = queueing (bufferbloat)</div>
                    </div>
                    <div style="font-size:8.5px; letter-spacing:0.6px; color:#7f93a6;">CC ALGORITHM: <span style="color:#cfe6f2">${m.cc}</span> ${m.active ? '· <span style="color:#96ffbe">BBR live</span>' : '· <span style="color:#e6c15a">modeled</span>'}</div>
                </div>
            </div>
            <div style="padding:0 18px 16px;">
                <div style="font-size:11.5px; line-height:1.6; color:#c2cede;">BBR continuously measures two things about the path: the maximum delivery rate it has seen (<b style="color:#e6c15a">BtlBw</b>) and the minimum round-trip time (<b style="color:#a9d4e8">RTprop</b>). Their product is the bandwidth-delay product (<b style="color:#96ffbe">BDP</b>) — the amount of data in flight that keeps the pipe exactly full without queueing. BBR paces sending at BtlBw and caps inflight near BDP, avoiding the bufferbloat that loss-based CUBIC causes by filling router buffers until packets drop.</div>
                <div style="margin-top:9px; font-size:10.5px; line-height:1.55; color:#9db6c8; border-left:2px solid rgba(230,193,90,0.6); padding-left:9px;"><span style="color:#e6c15a;">MODEL · </span>${modeNote} It's control theory, not machine learning — but it's a model of the environment learned online from the traffic itself (the same EWMA-style filtering used in Kernel DNA).</div>
            </div>`;
        window.setSafeHtml(this.bbrPanel, html);
        // The SVG plane must be mounted directly (the HTML sanitizer strips SVG
        // shape elements), so parse + import it into its placeholder host.
        const planeHost = this.bbrPanel.querySelector('.ns-bbr-plane');
        if (planeHost) {
            try {
                const doc = new DOMParser().parseFromString(this.bbrPlaneSvg(m), 'image/svg+xml');
                if (doc.documentElement && doc.documentElement.nodeName.toLowerCase() === 'svg') {
                    planeHost.appendChild(document.importNode(doc.documentElement, true));
                }
            } catch (e) { /* plane is decorative; ignore parse failures */ }
        }
        const closeBtn = this.bbrPanel.querySelector('.ns-ov-close');
        if (closeBtn) closeBtn.addEventListener('click', () => this.closeBbrOverlay());
        this.bbrScrim.style.display = 'block';
        if (this.layerTooltipNode) this.layerTooltipNode.style.display = 'none';
    }

    closeBbrOverlay() {
        this.bbrOpen = false;
        if (this.bbrScrim) this.bbrScrim.style.display = 'none';
    }

    // Resolve which layer sits under the pointer via the tower raycast.
    layerIdAtPointer(event) {
        if (!this.raycaster || !this.camera || !this.renderer) return null;
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const hits = this.raycaster.intersectObjects(this.layerMeshes, false);
        return hits.length ? (hits[0].object?.userData?.layerId || null) : null;
    }

    onCanvasClick(event) {
        if (!this.isActive) return;
        const layerId = this.hoveredLayerId || this.layerIdAtPointer(event);
        if (layerId) this.openLayerDrilldown(layerId);
    }

    onMouseMove(event) {
        if (!this.isActive || !this.raycaster || !this.camera || !this.renderer) return;
        if (this.viewDensityMode === 'minimal') {
            if (this.layerTooltipNode) {
                this.layerTooltipNode.style.display = 'none';
            }
            return;
        }
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);

        const intersections = this.raycaster.intersectObjects(this.layerMeshes, false);
        if (!intersections.length) {
            this.hoveredLayerId = null;
            if (this.layerTooltipNode) {
                this.layerTooltipNode.style.display = 'none';
            }
            return;
        }

        const layerId = intersections[0].object?.userData?.layerId;
        if (!layerId) return;
        this.hoveredLayerId = layerId;

        if (this.layerTooltipNode) {
            this.layerTooltipNode.style.display = 'block';
            window.setSafeHtml(this.layerTooltipNode, this.getLayerTooltipContent(layerId));
            this.layerTooltipNode.style.left = `${event.clientX + 12}px`;
            this.layerTooltipNode.style.top = `${event.clientY - 8}px`;
        }
    }

    animate() {
        if (!this.isActive) {
            this.lastFrameTime = null;
            return;
        }
        this.animationId = requestAnimationFrame(() => this.animate());
        if (!this.lastFrameTime) this.lastFrameTime = performance.now();
        const now = performance.now();
        const dt = Math.min(0.04, (now - this.lastFrameTime) / 1000);
        this.lastFrameTime = now;

        if (!this.hideVerticalOrbs || this.packetMorphEnabled) {
            this.updatePacket(dt);
        }
        this.updateEffects(dt);
        if (!this.hideVerticalOrbs) {
            this.updateFlowParticles(dt);
        }
        this.updateLayerStrips(dt);
        this.updatePathHopRig(dt);
        this.updatePacketLifecycleUI();

        // Gentle camera drift for cinematic depth.
        const t = now * 0.00025;
        this.camera.position.x = Math.sin(t) * 0.9;
        this.camera.position.z = 13.2 + Math.cos(t) * 0.35;
        this.camera.lookAt(0, 0, 0);

        // Overlay updates must never block the 3D render: a bug in connector
        // projection should at worst drop the leader lines, not blank the scene.
        try {
            this.updateConnectors();
            this.updateRightInstruments();
            this.updateActivityMatrix();
            this.updatePatternMatrix();
        } catch (e) {
            if (!this._connWarned) {
                console.warn('overlay update failed:', e);
                this._connWarned = true;
            }
        }

        this.renderer.render(this.scene, this.camera);
    }

    // Scroll the stack-activity matrix: each tick pushes the current per-layer
    // activity as a new right-hand column (throttled into a slow waterfall).
    updateActivityMatrix() {
        if (!this.matrixCells) return;
        const now = performance.now();
        if (this._lastMatrix && now - this._lastMatrix < 200) return;
        this._lastMatrix = now;
        for (let r = 0; r < this.matrixOrder.length; r++) {
            const id = this.matrixOrder[r];
            const a = Math.max(0, Math.min(1, Number((this.layerActivity && this.layerActivity[id]) ?? 0.2)));
            const row = this.matrixData[r];
            row.push(a);
            row.shift();
            for (let c = 0; c < row.length; c++) {
                const v = row[c];
                this.matrixCells[r][c].style.background = v > 0.8
                    ? 'rgba(232, 96, 104, 0.9)'
                    : (v > 0.55 ? 'rgba(230, 193, 90, 0.9)'
                        : (v > 0.25 ? 'rgba(103, 190, 224, 0.8)' : `rgba(60, 80, 96, ${(0.28 + v).toFixed(2)})`));
            }
        }
    }

    // Light up the top header pattern matrix: a scan column sweeps left->right
    // while activity-locked tiles glow proportionally to mean stack activity.
    updatePatternMatrix() {
        if (!this.patternTiles || !this.patternTiles.length) return;
        const now = performance.now();
        if (this._lastPattern && now - this._lastPattern < 180) return;
        this._lastPattern = now;
        const ids = Object.keys(this.layerActivity || {});
        let mean = 0;
        ids.forEach((id) => { mean += Math.max(0, Math.min(1, Number(this.layerActivity[id]) || 0)); });
        mean = ids.length ? mean / ids.length : 0.2;
        const cols = 12;
        this._patternScan = ((this._patternScan || 0) + 1) % cols;
        const tile = (v, base) => (v > 0.8
            ? ['rgba(232,96,104,0.85)', '#0b0f16']
            : (v > 0.55 ? ['rgba(230,193,90,0.85)', '#0b0f16']
                : (v > base ? ['rgba(103,190,224,0.8)', '#0b0f16'] : ['rgba(34,44,56,0.6)', '#7b8a9a'])));
        this.patternTiles.forEach((t, i) => {
            const col = i % cols;
            const onScan = col === this._patternScan;
            const locked = ((i * 7 + 3) % 11) / 11 < mean;
            const v = onScan ? Math.max(mean, 0.6) : (locked ? mean : 0.0);
            const [bg, fg] = tile(v, 0.25);
            t.style.background = bg;
            t.style.color = fg;
        });
    }

    // Project each tower plate's left edge to screen and draw leader lines
    // from the channel-list rail into the central figure.
    updateConnectors() {
        if (!this.connectorSvg || !this.camera || !this.renderer) return;
        const hidden = this.layersPanelNode && this.layersPanelNode.style.display === 'none';
        this.connectorSvg.style.display = hidden ? 'none' : 'block';
        if (hidden) return;

        const el = this.renderer.domElement;
        const W = el.clientWidth || el.width;
        const H = el.clientHeight || el.height;
        const RAIL = 300;
        let minY = Infinity;
        let maxY = -Infinity;

        this.layers.forEach((layer) => {
            const conn = this.layerConnectors[layer.id];
            if (!conn) return;
            const startY = conn.frac * H;
            const v = new THREE.Vector3(-(layer.plateRadius || 0.8) - 0.05, layer.y, 0).project(this.camera);
            const endX = (v.x * 0.5 + 0.5) * W;
            const endY = (-v.y * 0.5 + 0.5) * H;
            const bendX = Math.max(RAIL + 18, endX - 26);
            conn.path.setAttribute('d', `M ${RAIL} ${startY.toFixed(1)} L ${bendX.toFixed(1)} ${startY.toFixed(1)} L ${endX.toFixed(1)} ${endY.toFixed(1)}`);
            conn.node.setAttribute('cx', endX.toFixed(1));
            conn.node.setAttribute('cy', endY.toFixed(1));
            if (startY < minY) minY = startY;
            if (startY > maxY) maxY = startY;
        });

        if (this.connectorRail && isFinite(minY) && isFinite(maxY)) {
            this.connectorRail.setAttribute('d', `M ${RAIL} ${minY.toFixed(1)} L ${RAIL} ${maxY.toFixed(1)}`);
        }

        // Right side: tower right edge -> a vertical rail -> drops onto each
        // chain's NUMBER block (reference: short stub, vertical rail, leader in).
        if (this.layerConnectorsRight) {
            const numX = W - (this.chainRight || 20) - (this.chainWidth || 452);
            // First pass: project each tower tap point to find the rail position.
            const taps = [];
            let maxTapX = -Infinity;
            this.layers.forEach((layer) => {
                const conn = this.layerConnectorsRight[layer.id];
                if (!conn) return;
                const v = new THREE.Vector3((layer.plateRadius || 0.8) + 0.05, layer.y, 0).project(this.camera);
                const tapX = (v.x * 0.5 + 0.5) * W;
                const tapY = (-v.y * 0.5 + 0.5) * H;
                taps.push({ conn, tapX, tapY });
                if (tapX > maxTapX) maxTapX = tapX;
            });
            const railX = Math.min(numX - 26, maxTapX + 26);
            let rMinY = Infinity;
            let rMaxY = -Infinity;
            taps.forEach(({ conn, tapX, tapY }) => {
                const cardY = conn.frac * H;
                // tower tap -> rail (at tap height) -> down/up rail -> into number.
                conn.path.setAttribute('d', `M ${tapX.toFixed(1)} ${tapY.toFixed(1)} L ${railX.toFixed(1)} ${tapY.toFixed(1)} L ${railX.toFixed(1)} ${cardY.toFixed(1)} L ${numX.toFixed(1)} ${cardY.toFixed(1)}`);
                conn.node.setAttribute('cx', numX.toFixed(1));
                conn.node.setAttribute('cy', cardY.toFixed(1));
                if (cardY < rMinY) rMinY = cardY;
                if (cardY > rMaxY) rMaxY = cardY;
            });
            if (this.connectorRailRight && isFinite(rMinY) && isFinite(rMaxY)) {
                this.connectorRailRight.setAttribute('d', `M ${railX.toFixed(1)} ${rMinY.toFixed(1)} L ${railX.toFixed(1)} ${rMaxY.toFixed(1)}`);
            }
        }
    }

    // Right-row signal chain: drive INTENSITY dial, LF BIAS Lissajous patterns,
    // INDUCTION RESPONSE bars and the EQ spectrogram from each layer's live
    // activity + semantic noise. Spectrogram/pattern morph is throttled into a
    // slow waterfall instead of per-frame noise.
    updateRightInstruments() {
        if (!this.chainModules) return;
        const now = performance.now();
        const advance = !this._lastSpectro || (now - this._lastSpectro) > 150;
        if (advance) this._lastSpectro = now;
        const toneFill = (v) => (v > 0.8
            ? 'rgba(232, 96, 104, 0.8)'
            : (v > 0.55 ? 'rgba(230, 193, 90, 0.8)' : 'rgba(103, 190, 224, 0.7)'));
        Object.keys(this.chainModules).forEach((id) => {
            const mod = this.chainModules[id];
            if (!mod) return;
            const act = Math.max(0, Math.min(1, Number(this.layerActivity[id] ?? 0.2)));
            const noise = (this.layerSemanticNoise && this.layerSemanticNoise[id]) || { stress: 0.2, jitter: 0.2, branch: 0.2 };

            // Headline number on the NUMBER block (beam target).
            if (mod.numVal && this.layerHeadline && this.layerHeadline[id] != null) {
                mod.numVal.textContent = this.layerHeadline[id];
            }

            // INTENSITY dial: 0..99 + arc fill proportional to activity.
            if (mod.dialNum) mod.dialNum.textContent = String(Math.round(act * 99));
            if (mod.dialArc) {
                const deg = Math.round(act * 360);
                const col = act > 0.8 ? 'rgba(232,96,104,0.9)' : (act > 0.55 ? 'rgba(230,193,90,0.9)' : 'rgba(103,190,224,0.85)');
                mod.dialArc.style.background = `conic-gradient(${col} ${deg}deg, rgba(34,44,56,0.7) 0)`;
            }

            // INDUCTION RESPONSE bars: activity / jitter / stress / branch.
            if (mod.respBars && mod.respBars.length === 4) {
                const vals = [act, noise.jitter, noise.stress, noise.branch];
                mod.respBars.forEach((fill, i) => {
                    const v = Math.max(0, Math.min(1, Number(vals[i]) || 0));
                    fill.style.width = `${(8 + v * 92).toFixed(0)}%`;
                    fill.style.background = toneFill(v);
                });
            }

            if (!advance) return;

            // LF BIAS Lissajous: phase advances over time, amplitude tracks load.
            if (mod.biasPaths && mod.biasPaths.length) {
                const t0 = now / 1000;
                mod.biasPaths.forEach((p, k) => {
                    const a = 3 + k;
                    const b = 2 + k;
                    const phase = t0 * (0.6 + act * 1.4) + k * 1.3;
                    const amp = 9 + act * 4;
                    let d = '';
                    for (let s = 0; s <= 48; s++) {
                        const u = (s / 48) * Math.PI * 2;
                        const x = 16 + amp * Math.sin(a * u + phase);
                        const y = 16 + amp * Math.sin(b * u);
                        d += `${s === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)} `;
                    }
                    p.setAttribute('d', d);
                    p.setAttribute('stroke', act > 0.8 ? 'rgba(232,96,104,0.75)' : (act > 0.55 ? 'rgba(230,193,90,0.75)' : 'rgba(168,200,214,0.7)'));
                });
            }

            // EQ spectrogram waterfall.
            const sp = this.layerSpectra && this.layerSpectra[id];
            if (!sp) return;
            sp.hist.push(act * (0.55 + Math.random() * 0.45));
            sp.hist.shift();
            for (let i = 0; i < sp.bars.length; i++) {
                const val = sp.hist[i] || 0;
                const h = Math.max(1, val * (sp.h - 2));
                sp.bars[i].setAttribute('y', (sp.h - h).toFixed(2));
                sp.bars[i].setAttribute('height', h.toFixed(2));
                sp.bars[i].setAttribute('fill', val > 0.8
                    ? 'rgba(232, 96, 104, 0.7)'
                    : (val > 0.55 ? 'rgba(230, 193, 90, 0.7)' : 'rgba(103, 190, 224, 0.55)'));
            }
        });
    }

    activate() {
        if (!this.container) {
            const ok = this.init();
            if (ok === false) return;
        }
        this.isActive = true;
        this.container.style.display = 'block';
        this.container.style.visibility = 'visible';
        this.container.style.pointerEvents = 'auto';
        // Sync the renderer to the current viewport now that the container is
        // visible. Without this the canvas can keep a stale size from init time
        // (e.g. if DevTools/window changed since), pushing the tower out of the
        // clipped (overflow:hidden) container until the next resize event.
        this.onResize();
        requestAnimationFrame(() => { if (this.isActive) this.onResize(); });
        if (this.renderer?.domElement && !this.mouseMoveHandler) {
            this.mouseMoveHandler = (event) => this.onMouseMove(event);
            this.renderer.domElement.addEventListener('mousemove', this.mouseMoveHandler);
        }
        this.lastFrameTime = null;
        this.fetchTelemetry();
        if (this.telemetryInterval) {
            clearInterval(this.telemetryInterval);
        }
        this.telemetryInterval = setInterval(() => {
            if (this.isActive) {
                this.fetchTelemetry();
            }
        }, 1500);
        this.animate();
    }

    deactivate() {
        this.isActive = false;
        this.pathHopPending = null;
        this.disposePathHopRig();
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        if (this.telemetryInterval) {
            clearInterval(this.telemetryInterval);
            this.telemetryInterval = null;
        }
        if (this.renderer?.domElement && this.mouseMoveHandler) {
            this.renderer.domElement.removeEventListener('mousemove', this.mouseMoveHandler);
            this.mouseMoveHandler = null;
        }
        if (this.layerTooltipNode) {
            this.layerTooltipNode.style.display = 'none';
        }
        this.closeLayerDrilldown();
        this.closeBbrOverlay();
        if (this.container) {
            this.container.style.display = 'none';
            this.container.style.visibility = 'hidden';
            this.container.style.pointerEvents = 'none';
        }
    }

    onResize() {
        if (!this.camera || !this.renderer) return;
        // Prefer the actual container box; fall back to the window. The container
        // is fixed/inset:0 so this equals the visible viewport even when DevTools
        // is docked.
        const w = (this.container && this.container.clientWidth) || window.innerWidth;
        const h = (this.container && this.container.clientHeight) || window.innerHeight;
        if (w < 2 || h < 2) return;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
        this.updateBottomPanelsLayout();
        if (this.scene) {
            this.renderer.render(this.scene, this.camera);
        }
    }
}

window.NetworkStackVisualization = NetworkStackVisualization;
debugLog('🌐 network-stack.js: NetworkStackVisualization exported to window');
