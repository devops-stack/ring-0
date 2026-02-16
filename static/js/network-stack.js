// Network Stack Visualization - vertical packet flow through Linux networking layers
// Version: 1

console.log('🌐 network-stack.js v1: Script loading...');

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

        const ambient = new THREE.AmbientLight(0xffffff, 0.8);
        const key = new THREE.DirectionalLight(0xffffff, 0.4);
        key.position.set(4, 10, 8);
        this.scene.add(ambient);
        this.scene.add(key);

        this.createLayerStack();
        this.createPacket();
        this.createOverlayUI();
        this.addExitButton();

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
                shininess: 60
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

            this.layers.push({ ...def, mesh, edge });
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
        layersPanel.innerHTML = [
            'Userspace',
            '-> Socket API',
            '-> TCP/UDP',
            '-> IP',
            '-> Netfilter',
            '-> Driver',
            '-> NIC'
        ].join('<br>');
        this.container.appendChild(layersPanel);
        this.overlayNodes.push(layersPanel);

        const statsPanel = document.createElement('div');
        statsPanel.style.cssText = `
            position: absolute;
            top: 110px;
            right: 24px;
            z-index: 1001;
            color: #c8ccd4;
            font-family: 'Share Tech Mono', monospace;
            font-size: 10px;
            line-height: 1.45;
            background: rgba(12, 18, 28, 0.82);
            border: 1px solid rgba(160, 170, 190, 0.25);
            border-radius: 6px;
            padding: 10px 12px;
            min-width: 250px;
        `;
        statsPanel.innerHTML = `
            <div style="color:#9aa2aa; margin-bottom:6px;">LIVE TELEMETRY</div>
            <div id="ns-userspace"></div>
            <div id="ns-socket"></div>
            <div id="ns-tcp"></div>
            <div id="ns-ip"></div>
            <div id="ns-netfilter"></div>
            <div id="ns-driver"></div>
            <div id="ns-nic"></div>
        `;
        this.container.appendChild(statsPanel);
        this.overlayNodes.push(statsPanel);

        this.layerStatNodes = {
            userspace: statsPanel.querySelector('#ns-userspace'),
            socket: statsPanel.querySelector('#ns-socket'),
            tcp: statsPanel.querySelector('#ns-tcp'),
            ip: statsPanel.querySelector('#ns-ip'),
            netfilter: statsPanel.querySelector('#ns-netfilter'),
            driver: statsPanel.querySelector('#ns-driver'),
            nic: statsPanel.querySelector('#ns-nic')
        };

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
        const flow = this.telemetryData.flow;

        if (this.flowNode) {
            if (flow) {
                this.flowNode.textContent = `process -> syscall -> socket -> ${flow.type || 'TCP'} ${flow.state_name || ''} -> IP -> NIC -> wire -> ${flow.remote || 'remote'}`;
            } else {
                this.flowNode.textContent = 'process -> syscall -> socket -> TCP -> IP -> NIC -> wire -> remote (no active flow)';
            }
        }

        const set = (key, text) => {
            if (this.layerStatNodes[key]) {
                this.layerStatNodes[key].textContent = text;
            }
        };
        set('userspace', `Userspace: procs ${m.userspace?.active_processes ?? 0}`);
        set('socket', `Socket API: sockets ${m.socket_api?.active_sockets ?? 0}`);
        set('tcp', `TCP/UDP: established ${m.tcp_udp?.established ?? 0}, retrans/s ${m.tcp_udp?.retrans_per_sec ?? 0}`);
        set('ip', `IP: in ${m.ip?.in_packets_per_sec ?? 0}/s, out ${m.ip?.out_packets_per_sec ?? 0}/s`);
        set('netfilter', `Netfilter: drop/s ${m.netfilter?.drop_per_sec ?? 0}, drop% ${((m.netfilter?.drop_ratio ?? 0) * 100).toFixed(2)}`);
        set('driver', `Driver: ${m.driver?.iface ?? 'n/a'} rx ${m.driver?.rx_mb_s ?? 0}MB/s tx ${m.driver?.tx_mb_s ?? 0}MB/s`);
        set('nic', `NIC: err rx ${m.nic?.rx_errors ?? 0} tx ${m.nic?.tx_errors ?? 0} | speed ${sig.packet_speed ?? this.packetSpeed}`);
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
        if (this.container) {
            this.container.style.display = 'none';
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
console.log('🌐 network-stack.js: NetworkStackVisualization exported to window');
