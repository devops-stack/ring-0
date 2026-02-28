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
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            color: #c8ccd4;
            font-family: 'Share Tech Mono', monospace;
            font-size: 24px;
            letter-spacing: 1px;
            z-index: 1001;
        `;
        title.textContent = 'NETWORK STACK';
        this.container.appendChild(title);
        this.overlayNodes.push(title);

        const flow = document.createElement('div');
        flow.style.cssText = `
            position: absolute;
            top: 68px;
            left: 50%;
            transform: translateX(-50%);
            color: #9aa2aa;
            font-family: 'Share Tech Mono', monospace;
            font-size: 11px;
            z-index: 1001;
        `;
        flow.textContent = 'process -> syscall -> socket -> TCP -> IP -> NIC -> wire -> remote';
        this.container.appendChild(flow);
        this.overlayNodes.push(flow);
        this.flowNode = flow;

        const layersPanel = document.createElement('div');
        layersPanel.style.cssText = `
            position: absolute;
            top: 110px;
            left: 24px;
            z-index: 1001;
            color: #c8ccd4;
            font-family: 'Share Tech Mono', monospace;
            font-size: 11px;
            line-height: 1.5;
            background: rgba(12, 18, 28, 0.82);
            border: 1px solid rgba(160, 170, 190, 0.25);
            border-radius: 6px;
            padding: 10px 12px;
        `;
        window.setSafeHtml(layersPanel, [
            'Userspace',
            '-> Socket API',
            '-> TCP/UDP',
            '-> IP',
            '-> Netfilter',
            '-> Driver',
            '-> NIC'
        ].join('<br>'));
        this.container.appendChild(layersPanel);
        this.overlayNodes.push(layersPanel);

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
        const chipSpec = [
            { id: 'userspace', top: '24%' },
            { id: 'socket', top: '34%' },
            { id: 'tcp', top: '44%' },
            { id: 'ip', top: '54%' },
            { id: 'netfilter', top: '64%' },
            { id: 'driver', top: '74%' },
            { id: 'nic', top: '84%' }
        ];
        chipSpec.forEach(spec => {
            const chip = document.createElement('div');
            chip.style.cssText = `
                position: absolute;
                right: 2.4%;
                top: ${spec.top};
                transform: translateY(-50%);
                color: #aeb4bc;
                font-family: 'Share Tech Mono', monospace;
                font-size: 10px;
                letter-spacing: 0.4px;
                background: rgba(20, 26, 36, 0.38);
                border: 1px solid rgba(120, 130, 145, 0.18);
                border-radius: 4px;
                padding: 2px 7px;
                white-space: nowrap;
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

    updateTelemetryUI() {
        if (!this.telemetryData) return;
        const m = this.telemetryData.layer_metrics || {};
        const sig = this.telemetryData.signals || {};
        const a = this.telemetryData.layer_activity || {};
        const flow = this.telemetryData.flow;

        if (this.flowNode) {
            if (flow) {
                this.flowNode.textContent = `process -> syscall -> socket -> ${flow.type || 'TCP'} ${flow.state_name || ''} -> IP -> NIC -> wire -> ${flow.remote || 'remote'}`;
            } else {
                this.flowNode.textContent = 'process -> syscall -> socket -> TCP -> IP -> NIC -> wire -> remote (no active flow)';
            }
        }

        const set = (key, text) => {
            if (this.metricChips[key]) {
                this.metricChips[key].textContent = text;
            }
        };
        set('userspace', `Userspace procs ${m.userspace?.active_processes ?? 0}`);
        set('socket', `Socket est ${m.socket_api?.established ?? 0} retrans ${m.socket_api?.retransmits_per_sec ?? 0}/s`);
        set('tcp', `TCP cwnd ${m.tcp_udp?.cwnd ?? 0} rtt ${m.tcp_udp?.rtt_ms ?? 0}ms retrans ${m.tcp_udp?.retrans_per_sec ?? 0}/s`);
        set('ip', `IP in ${m.ip?.in_packets_per_sec ?? 0}/s out ${m.ip?.out_packets_per_sec ?? 0}/s`);
        set('netfilter', `Netfilter drop ${(m.netfilter?.drop_per_sec ?? 0)}/s`);
        set('driver', `Driver txq ${m.driver?.tx_queue ?? 0} drops ${(m.driver?.drops_per_sec ?? 0)}/s`);
        set('nic', `NIC ${m.nic?.iface ?? 'n/a'} err ${m.nic?.rx_errors ?? 0}/${m.nic?.tx_errors ?? 0}`);

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
        return fetch('/api/network-stack-realtime')
            .then(res => res.json())
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
    }
}

window.NetworkStackVisualization = NetworkStackVisualization;
debugLog('🌐 network-stack.js: NetworkStackVisualization exported to window');
