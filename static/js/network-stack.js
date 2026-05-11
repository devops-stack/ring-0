// Network Stack Visualization - vertical packet flow through Linux networking layers
// Version: 1

debugLog('🌐 network-stack.js v1: Script loading...');

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
        this.lineParticles = [];
        this.microPackets = [];
        this.metricChips = {};
        this.kpiNodes = {};
        this.layersPanelNode = null;
        this.chipLayerNode = null;
        this.viewModeButton = null;
        this.puzzleModeButton = null;
        this.viewDensityMode = 'detailed';
        this.puzzleDetailMode = 'overview';
        this.galaxyPanelNode = null;
        this.galaxyNodes = {};
        this.galaxyExplainNode = null;
        this.selectedGalaxy = 'state';
        this.galaxyStateData = null;
        this.lifecyclePanelNode = null;
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

        this.resizeHandler = () => this.onResize();
        window.addEventListener('resize', this.resizeHandler);

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

        layerDefs.forEach(def => {
            const material = new THREE.MeshPhongMaterial({
                color: def.color,
                transparent: true,
                opacity: 0.28,
                shininess: 60,
                emissive: new THREE.Color(0x58b6d8),
                emissiveIntensity: 0.02
            });
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(layerWidth, layerHeight, layerDepth), material);
            mesh.position.set(0, def.y, 0);
            this.scene.add(mesh);

            const edge = new THREE.LineSegments(
                new THREE.EdgesGeometry(new THREE.BoxGeometry(layerWidth, layerHeight, layerDepth)),
                new THREE.LineBasicMaterial({ color: 0x9aa2aa, transparent: true, opacity: 0.35 })
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

            mesh.userData.layerId = def.id;
            this.layerMeshes.push(mesh);
            this.layers.push({ ...def, mesh, edge, strip });
            this.layerMap[def.id] = def.y;
        });

        const flowLine = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(0, 3.9, 0),
                new THREE.Vector3(0, -3.9, 0)
            ]),
            new THREE.LineBasicMaterial({ color: 0x58b6d8, transparent: true, opacity: 0.35 })
        );
        this.scene.add(flowLine);
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
            align-items: stretch;
            pointer-events: none;
        `;
        this.container.appendChild(kpiBar);
        this.overlayNodes.push(kpiBar);

        const kpiSpec = [
            { id: 'flow', label: 'FLOW' },
            { id: 'rtt', label: 'RTT' },
            { id: 'drop', label: 'DROPS' },
            { id: 'retrans', label: 'RETRANS' }
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
        });

        const layersPanel = document.createElement('div');
        layersPanel.style.cssText = `
            position: absolute;
            top: 148px;
            left: 24px;
            z-index: 1001;
            color: #d1d8e0;
            font-family: 'Share Tech Mono', monospace;
            font-size: 12px;
            line-height: 1.5;
            background: rgba(10, 15, 24, 0.84);
            border: 1px solid rgba(129, 145, 168, 0.32);
            border-radius: 6px;
            padding: 11px 13px;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.24);
            backdrop-filter: blur(1px);
        `;
        window.setSafeHtml(layersPanel, [
            '<span style="font-size:10px;color:#7f8fa2;letter-spacing:0.55px">LAYERS</span>',
            'Userspace',
            '&rarr; Socket API',
            '&rarr; TCP/UDP',
            '&rarr; IP',
            '&rarr; Netfilter',
            '&rarr; Driver',
            '&rarr; NIC'
        ].join('<br>'));
        this.container.appendChild(layersPanel);
        this.overlayNodes.push(layersPanel);
        this.layersPanelNode = layersPanel;

        // Layer metrics as subtle chips aligned with layers (not a table).
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
        const chipSpec = [
            { id: 'userspace', top: '22%' },
            { id: 'socket', top: '30%' },
            { id: 'tcp', top: '38%' },
            { id: 'ip', top: '46%' },
            { id: 'netfilter', top: '54%' },
            { id: 'driver', top: '62%' },
            { id: 'nic', top: '70%' }
        ];
        chipSpec.forEach(spec => {
            const chip = document.createElement('div');
            chip.style.cssText = `
                position: absolute;
                right: 2.4%;
                top: ${spec.top};
                transform: translateY(-50%);
                color: #bac4cf;
                font-family: 'Share Tech Mono', monospace;
                font-size: 11px;
                letter-spacing: 0.42px;
                background: rgba(16, 22, 32, 0.68);
                border: 1px solid rgba(115, 128, 145, 0.32);
                border-radius: 4px;
                padding: 4px 9px;
                white-space: nowrap;
                min-width: 196px;
                text-align: left;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.16);
            `;
            chip.textContent = '';
            chipLayer.appendChild(chip);
            this.metricChips[spec.id] = chip;
        });

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

        const viewModeBtn = document.createElement('button');
        viewModeBtn.textContent = 'MODE: DETAILED';
        viewModeBtn.style.cssText = `
            position: absolute;
            top: 58px;
            right: 20px;
            padding: 7px 10px;
            background: rgba(12, 18, 28, 0.88);
            border: 1px solid rgba(125, 138, 156, 0.34);
            color: #c6d0db;
            font-family: 'Share Tech Mono', monospace;
            font-size: 10px;
            letter-spacing: 0.5px;
            cursor: pointer;
            z-index: 1002;
            transition: all 0.2s ease;
        `;
        viewModeBtn.onmouseenter = () => {
            viewModeBtn.style.background = 'rgba(19, 28, 40, 0.95)';
            viewModeBtn.style.color = '#edf2f8';
        };
        viewModeBtn.onmouseleave = () => {
            viewModeBtn.style.background = 'rgba(12, 18, 28, 0.88)';
            viewModeBtn.style.color = '#c6d0db';
        };
        viewModeBtn.onclick = () => {
            this.toggleViewDensityMode();
        };
        this.container.appendChild(viewModeBtn);
        this.overlayNodes.push(viewModeBtn);
        this.viewModeButton = viewModeBtn;

        const puzzleModeBtn = document.createElement('button');
        puzzleModeBtn.textContent = 'PUZZLE: OVERVIEW';
        puzzleModeBtn.style.cssText = `
            position: absolute;
            top: 94px;
            right: 20px;
            padding: 7px 10px;
            background: rgba(12, 18, 28, 0.88);
            border: 1px solid rgba(125, 138, 156, 0.34);
            color: #c6d0db;
            font-family: 'Share Tech Mono', monospace;
            font-size: 10px;
            letter-spacing: 0.45px;
            cursor: pointer;
            z-index: 1002;
            transition: all 0.2s ease;
        `;
        puzzleModeBtn.onmouseenter = () => {
            puzzleModeBtn.style.background = 'rgba(19, 28, 40, 0.95)';
            puzzleModeBtn.style.color = '#edf2f8';
        };
        puzzleModeBtn.onmouseleave = () => {
            puzzleModeBtn.style.background = 'rgba(12, 18, 28, 0.88)';
            puzzleModeBtn.style.color = '#c6d0db';
        };
        puzzleModeBtn.onclick = () => {
            this.togglePuzzleDetailMode();
        };
        this.container.appendChild(puzzleModeBtn);
        this.overlayNodes.push(puzzleModeBtn);
        this.puzzleModeButton = puzzleModeBtn;
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
            return `
                <span style="
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
                ">
                    <span style="color:${text};font-size:9px">${node.label}</span>
                    <span style="display:block;color:#7f8fa2;font-size:8px">${node.tags}</span>
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
                this.deactivate();
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

    updatePacket(dt) {
        if (!this.packet) return;

        this.packet.position.y -= this.packetSpeed * dt;
        this.packetGlow.position.copy(this.packet.position);
        this.packetGlow.scale.setScalar(1 + Math.sin(performance.now() * 0.008) * 0.1);

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
                this.packet.position.y = this.layerMap.userspace + 0.5;
                this.dropCooldown = 1.8;
                return;
            }
        }

        // NIC -> wire -> remote reached; restart packet loop.
        if (this.packet.position.y < this.layerMap.nic - 0.75) {
            this.packet.position.y = this.layerMap.userspace + 0.5;
        }

        // Trail follows packet.
        for (let i = this.packetTrail.length - 1; i > 0; i--) {
            this.packetTrail[i].position.lerp(this.packetTrail[i - 1].position, 0.65);
        }
        this.packetTrail[0].position.lerp(this.packet.position, 0.65);
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
            return { bg: 'rgba(65, 20, 24, 0.74)', border: 'rgba(226, 106, 118, 0.65)', text: '#ffb8c0' };
        }
        if (level === 'warn') {
            return { bg: 'rgba(64, 52, 22, 0.72)', border: 'rgba(226, 193, 102, 0.64)', text: '#f2d89b' };
        }
        return { bg: 'rgba(16, 22, 32, 0.68)', border: 'rgba(115, 128, 145, 0.32)', text: '#bac4cf' };
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
        const chip = this.metricChips[id];
        if (!chip) return;
        const tone = this.getHealthTone(level);
        chip.textContent = `${label} ${value}`;
        chip.style.background = tone.bg;
        chip.style.borderColor = tone.border;
        chip.style.color = tone.text;
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
                this.flowNode.textContent = `process -> syscall -> socket -> ${flowType} ${flowState} -> IP -> NIC -> wire -> ${flow.remote || 'remote'}`;
            } else {
                this.flowNode.textContent = 'process -> syscall -> socket -> TCP -> IP -> NIC -> wire -> remote (no active flow)';
            }
        }

        this.updateKpiCard('flow', `${flowType}${flowState ? ` ${flowState}` : ''}`, flow ? 'normal' : 'warn');
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
                this.updatePacketColorByFlow();
                this.updateTelemetryUI();
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
            if (layer.mesh?.material) {
                layer.mesh.material.opacity = 0.2 + act * 0.28;
                layer.mesh.material.emissiveIntensity = 0.02 + act * 0.18;
            }
            if (layer.strip?.material) {
                layer.strip.scale.x = 0.14 + act * 0.86;
                layer.strip.material.opacity = 0.12 + act * 0.78;
            }
        });
    }

    getLayerTooltipContent(layerId) {
        const m = this.telemetryData?.layer_metrics || {};
        if (layerId === 'userspace') {
            return `<strong>Userspace</strong><br>active processes: ${m.userspace?.active_processes ?? 0}`;
        }
        if (layerId === 'socket') {
            return `<strong>Socket API</strong><br>established: ${m.socket_api?.established ?? 0}<br>retransmits/s: ${m.socket_api?.retransmits_per_sec ?? 0}`;
        }
        if (layerId === 'tcp') {
            return `<strong>TCP/UDP</strong><br>cwnd: ${m.tcp_udp?.cwnd ?? 0}<br>rtt: ${m.tcp_udp?.rtt_ms ?? 0} ms<br>retrans/s: ${m.tcp_udp?.retrans_per_sec ?? 0}`;
        }
        if (layerId === 'ip') {
            return `<strong>IP</strong><br>packets in: ${m.ip?.in_packets_per_sec ?? 0}/s<br>packets out: ${m.ip?.out_packets_per_sec ?? 0}/s`;
        }
        if (layerId === 'netfilter') {
            return `<strong>Netfilter</strong><br>drop/s: ${m.netfilter?.drop_per_sec ?? 0}<br>drop ratio: ${((m.netfilter?.drop_ratio ?? 0) * 100).toFixed(2)}%`;
        }
        if (layerId === 'driver') {
            return `<strong>Driver</strong><br>tx queue: ${m.driver?.tx_queue ?? 0}<br>drops/s: ${m.driver?.drops_per_sec ?? 0}`;
        }
        if (layerId === 'nic') {
            return `<strong>NIC</strong><br>iface: ${m.nic?.iface ?? 'n/a'}<br>errors rx/tx: ${m.nic?.rx_errors ?? 0}/${m.nic?.tx_errors ?? 0}`;
        }
        return `<strong>${layerId}</strong>`;
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

        this.updatePacket(dt);
        this.updateEffects(dt);
        this.updateFlowParticles(dt);
        this.updateLayerStrips(dt);
        this.updatePacketLifecycleUI();

        // Gentle camera drift for cinematic depth.
        const t = now * 0.00025;
        this.camera.position.x = Math.sin(t) * 0.9;
        this.camera.position.z = 13.2 + Math.cos(t) * 0.35;
        this.camera.lookAt(0, 0, 0);

        this.renderer.render(this.scene, this.camera);
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
        if (this.container) {
            this.container.style.display = 'none';
            this.container.style.visibility = 'hidden';
            this.container.style.pointerEvents = 'none';
        }
    }

    onResize() {
        if (!this.camera || !this.renderer) return;
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.updateBottomPanelsLayout();
    }
}

window.NetworkStackVisualization = NetworkStackVisualization;
debugLog('🌐 network-stack.js: NetworkStackVisualization exported to window');
