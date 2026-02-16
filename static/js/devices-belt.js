// Devices Belt Visualization - external magnetic belt around kernel ring
// Version: 1

console.log('🧲 devices-belt.js v1: Script loading...');

class DevicesBeltVisualization {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.container = null;
        this.isActive = false;
        this.animationId = null;
        this.lastFrameTime = null;
        this.exitButton = null;
        this.overlayNodes = [];
        this.resizeHandler = null;
        this.telemetryInterval = null;
        this.telemetryErrorNode = null;
        this.devices = [];
        this.deviceNodes = [];
        this.links = [];
        this.pulses = [];
        this.centralCore = null;
    }

    init(containerId = 'devices-belt-container') {
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
            alert('WebGL is required for Devices view.');
            return false;
        }

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0E1114);

        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 0, 16);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.container.appendChild(this.renderer.domElement);

        const ambient = new THREE.AmbientLight(0xffffff, 0.8);
        const key = new THREE.DirectionalLight(0xffffff, 0.45);
        key.position.set(4, 8, 8);
        this.scene.add(ambient);
        this.scene.add(key);

        this.createBaseScene();
        this.createOverlayUI();
        this.addExitButton();

        this.resizeHandler = () => this.onResize();
        window.addEventListener('resize', this.resizeHandler);

        return true;
    }

    createBaseScene() {
        const coreGeom = new THREE.RingGeometry(1.5, 2.1, 64);
        const coreMat = new THREE.MeshBasicMaterial({
            color: 0x6f7883,
            transparent: true,
            opacity: 0.55,
            side: THREE.DoubleSide
        });
        this.centralCore = new THREE.Mesh(coreGeom, coreMat);
        this.centralCore.rotation.x = Math.PI / 2;
        this.centralCore.position.set(0, 0, 0);
        this.scene.add(this.centralCore);

        const outerGuide = new THREE.LineLoop(
            new THREE.BufferGeometry().setFromPoints(
                Array.from({ length: 64 }, (_, i) => {
                    const a = (i / 64) * Math.PI * 2;
                    return new THREE.Vector3(Math.cos(a) * 6.8, Math.sin(a) * 6.8, 0);
                })
            ),
            new THREE.LineBasicMaterial({ color: 0x58636f, transparent: true, opacity: 0.18 })
        );
        this.scene.add(outerGuide);
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
        title.textContent = 'DEVICES BELT';
        this.container.appendChild(title);
        this.overlayNodes.push(title);

        const subtitle = document.createElement('div');
        subtitle.style.cssText = `
            position: absolute;
            top: 68px;
            left: 50%;
            transform: translateX(-50%);
            color: #9aa2aa;
            font-family: 'Share Tech Mono', monospace;
            font-size: 11px;
            z-index: 1001;
        `;
        subtitle.textContent = 'device port -> kernel subsystem (pulse speed=throughput, width=load)';
        this.container.appendChild(subtitle);
        this.overlayNodes.push(subtitle);

        const hint = document.createElement('div');
        hint.style.cssText = `
            position: absolute;
            top: 108px;
            right: 24px;
            color: #c8ccd4;
            font-family: 'Share Tech Mono', monospace;
            font-size: 10px;
            z-index: 1001;
            background: rgba(12, 18, 28, 0.82);
            border: 1px solid rgba(160, 170, 190, 0.25);
            border-radius: 6px;
            padding: 10px 12px;
            min-width: 240px;
        `;
        hint.innerHTML = `
            <div style="color:#9aa2aa; margin-bottom:6px;">SUBSYSTEM LINKS</div>
            block -> VFS<br>
            network -> NET stack<br>
            tty -> scheduler + signals<br>
            misc -> kernel core
        `;
        this.container.appendChild(hint);
        this.overlayNodes.push(hint);

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
        this.container.appendChild(err);
        this.overlayNodes.push(err);
        this.telemetryErrorNode = err;
    }

    addExitButton() {
        if (this.exitButton && this.exitButton.parentNode) {
            this.exitButton.parentNode.removeChild(this.exitButton);
        }
        const btn = document.createElement('button');
        btn.textContent = 'EXIT VIEW';
        btn.style.cssText = `
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
        btn.onmouseenter = () => {
            btn.style.background = 'rgba(20, 26, 36, 0.95)';
            btn.style.color = '#fff';
        };
        btn.onmouseleave = () => {
            btn.style.background = 'rgba(12, 18, 28, 0.9)';
            btn.style.color = '#c8ccd4';
        };
        btn.onclick = () => {
            if (window.kernelContextMenu) {
                window.kernelContextMenu.deactivateViews();
            } else {
                this.deactivate();
            }
        };
        this.container.appendChild(btn);
        this.exitButton = btn;
    }

    clearDynamicObjects() {
        [...this.deviceNodes, ...this.links, ...this.pulses].forEach(obj => {
            this.scene.remove(obj);
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                else obj.material.dispose();
            }
        });
        this.deviceNodes = [];
        this.links = [];
        this.pulses = [];
    }

    getColorByType(type) {
        const t = String(type || '').toLowerCase();
        if (t === 'network') return 0x58b6d8;
        if (t === 'block') return 0xe6c15a;
        if (t === 'tty') return 0xc28ee8;
        return 0xa0a8b2;
    }

    buildDeviceScene(devices) {
        this.clearDynamicObjects();
        this.devices = devices || [];
        const radius = 6.8;
        const n = Math.max(1, this.devices.length);
        const targetPoints = {
            vfs: new THREE.Vector3(-1.2, -0.6, 0),
            net: new THREE.Vector3(1.4, 0.6, 0),
            sched: new THREE.Vector3(-1.5, 1.0, 0),
            signals: new THREE.Vector3(-0.3, 1.3, 0),
            kernel: new THREE.Vector3(0, 0, 0)
        };

        this.devices.forEach((d, i) => {
            const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
            const pos = new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
            const baseColor = this.getColorByType(d.type);

            const node = new THREE.Mesh(
                new THREE.SphereGeometry(0.2 + d.load_norm * 0.1, 14, 14),
                new THREE.MeshBasicMaterial({ color: baseColor })
            );
            node.position.copy(pos);
            node.userData.device = d;
            this.scene.add(node);
            this.deviceNodes.push(node);

            const glow = new THREE.Mesh(
                new THREE.SphereGeometry(0.35 + d.load_norm * 0.12, 12, 12),
                new THREE.MeshBasicMaterial({ color: baseColor, transparent: true, opacity: 0.2 + d.load_norm * 0.18 })
            );
            glow.position.copy(pos);
            this.scene.add(glow);
            this.deviceNodes.push(glow);

            const targets = Array.isArray(d.targets) && d.targets.length > 0 ? d.targets : ['kernel'];
            targets.forEach(targetName => {
                const p2 = targetPoints[targetName] || targetPoints.kernel;
                const curve = new THREE.CubicBezierCurve3(
                    pos.clone(),
                    pos.clone().lerp(p2, 0.35).add(new THREE.Vector3(0, (targetName === 'net' ? 1 : -1) * 0.4, 0)),
                    pos.clone().lerp(p2, 0.7).add(new THREE.Vector3(0, 0.2, 0)),
                    p2.clone()
                );
                const pts = curve.getPoints(30);
                const geo = new THREE.BufferGeometry().setFromPoints(pts);
                const mat = new THREE.LineBasicMaterial({
                    color: baseColor,
                    transparent: true,
                    opacity: 0.25 + d.load_norm * 0.3
                });
                const line = new THREE.Line(geo, mat);
                line.userData = {
                    device: d,
                    curve,
                    pulseCooldown: 0.0
                };
                this.scene.add(line);
                this.links.push(line);
            });
        });
    }

    spawnPulse(line) {
        const d = line.userData.device;
        const t = Math.random() * 0.2;
        const point = line.userData.curve.getPoint(t);
        const pulse = new THREE.Mesh(
            new THREE.SphereGeometry(0.06 + d.load_norm * 0.08, 10, 10),
            new THREE.MeshBasicMaterial({
                color: this.getColorByType(d.type),
                transparent: true,
                opacity: 0.95
            })
        );
        pulse.position.copy(point);
        pulse.userData = {
            line,
            t,
            speed: 0.2 + Math.max(0.02, d.load_norm) * 1.5
        };
        this.scene.add(pulse);
        this.pulses.push(pulse);
    }

    updateLinksAndPulses(dt) {
        this.links.forEach(line => {
            const d = line.userData.device;
            line.userData.pulseCooldown -= dt;
            const pulseRate = 0.5 + d.load_norm * 4.5; // pulses/sec
            const cooldownBase = 1 / pulseRate;
            if (line.userData.pulseCooldown <= 0) {
                this.spawnPulse(line);
                line.userData.pulseCooldown = cooldownBase;
            }

            // Load controls line thickness/opacity.
            const w = 0.7 + d.load_norm * 2.2;
            line.material.opacity = 0.2 + d.load_norm * 0.5;
            line.material.linewidth = w;
        });

        this.pulses = this.pulses.filter(p => {
            p.userData.t += p.userData.speed * dt;
            if (p.userData.t >= 1) {
                this.scene.remove(p);
                if (p.geometry) p.geometry.dispose();
                if (p.material) p.material.dispose();
                return false;
            }
            const point = p.userData.line.userData.curve.getPoint(p.userData.t);
            p.position.copy(point);
            p.material.opacity = Math.max(0, 1 - p.userData.t);
            return true;
        });
    }

    fetchTelemetry() {
        return fetch('/api/devices-realtime')
            .then(res => res.json())
            .then(data => {
                if (!data || data.error) {
                    throw new Error(data?.error || 'No devices data');
                }
                this.buildDeviceScene(data.devices || []);
                if (this.telemetryErrorNode) {
                    this.telemetryErrorNode.textContent = `devices: ${data.meta?.count || 0}, max ${(data.meta?.max_throughput_bps || 0).toFixed(0)} B/s`;
                }
            })
            .catch(err => {
                if (this.telemetryErrorNode) {
                    this.telemetryErrorNode.textContent = `devices telemetry fallback: ${err.message}`;
                }
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

        this.updateLinksAndPulses(dt);
        if (this.centralCore) {
            this.centralCore.rotation.z += 0.08 * dt;
        }

        const t = now * 0.0002;
        this.camera.position.x = Math.sin(t) * 0.9;
        this.camera.position.z = 16 + Math.cos(t) * 0.3;
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
        this.fetchTelemetry();
        if (this.telemetryInterval) clearInterval(this.telemetryInterval);
        this.telemetryInterval = setInterval(() => {
            if (this.isActive) this.fetchTelemetry();
        }, 1500);
        this.lastFrameTime = null;
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

window.DevicesBeltVisualization = DevicesBeltVisualization;
console.log('🧲 devices-belt.js: DevicesBeltVisualization exported to window');
