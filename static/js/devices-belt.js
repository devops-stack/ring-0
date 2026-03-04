// Orbital Device Ring Visualization
// Version: 8

debugLog('🧲 devices-belt.js v8: Script loading...');

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

        this.centralCore = null;
        this.ringGuides = [];
        this.subsystemNodes = [];
        this.deviceNodes = [];
        this.links = [];
        this.pulses = [];

        this.subsystemOrder = ['block', 'net', 'char', 'input', 'usb'];
        // For links/pulses only; circles stay black+white.
        this.subsystemColors = {
            block: 0xaab2bc,
            net: 0x8f99a6,
            char: 0x7f8894,
            input: 0x9aa3ad,
            usb: 0x6f7884
        };
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
            alert('WebGL is required for Devices view.');
            return false;
        }

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0E1114);

        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 0, 17.5);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.container.appendChild(this.renderer.domElement);

        // Intentionally no scene lights: flat HUD look (no 3D shading/highlights).

        this.createBaseScene();
        this.createOverlayUI();
        this.addExitButton();

        this.resizeHandler = () => this.onResize();
        window.addEventListener('resize', this.resizeHandler);

        return true;
    }

    createBaseScene() {
        const coreGeom = new THREE.CircleGeometry(1.08, 48);
        const coreMat = new THREE.MeshBasicMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0.95
        });
        this.centralCore = new THREE.Mesh(coreGeom, coreMat);
        this.scene.add(this.centralCore);
        const coreOutline = new THREE.LineLoop(
            new THREE.BufferGeometry().setFromPoints(
                Array.from({ length: 72 }, (_, i) => {
                    const a = (i / 72) * Math.PI * 2;
                    return new THREE.Vector3(Math.cos(a) * 1.08, Math.sin(a) * 1.08, 0.001);
                })
            ),
            new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.96 })
        );
        this.scene.add(coreOutline);
        this.ringGuides.push(coreOutline);

        const firstRing = new THREE.LineLoop(
            new THREE.BufferGeometry().setFromPoints(
                Array.from({ length: 90 }, (_, i) => {
                    const a = (i / 90) * Math.PI * 2;
                    return new THREE.Vector3(Math.cos(a) * 4.4, Math.sin(a) * 4.4, 0);
                })
            ),
            new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18 })
        );

        const secondRing = new THREE.LineLoop(
            new THREE.BufferGeometry().setFromPoints(
                Array.from({ length: 110 }, (_, i) => {
                    const a = (i / 110) * Math.PI * 2;
                    return new THREE.Vector3(Math.cos(a) * 7.5, Math.sin(a) * 7.5, 0);
                })
            ),
            new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12 })
        );

        this.scene.add(firstRing);
        this.scene.add(secondRing);
        this.ringGuides.push(firstRing, secondRing);

        const coreLabel = this.createLabelSprite('KERNEL CORE', '#ffffff', 260, 13, 1.38, 0.42, 0.3);
        coreLabel.position.set(0, 0, 0.002);
        this.scene.add(coreLabel);
        this.ringGuides.push(coreLabel);
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
        title.textContent = 'ORBITAL DEVICE RING (in development)';
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
        subtitle.textContent = 'subsystems orbit kernel core; devices orbit their subsystem (load/irq driven)';
        this.container.appendChild(subtitle);
        this.overlayNodes.push(subtitle);

        const layerHint = document.createElement('div');
        layerHint.style.cssText = `
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
            min-width: 290px;
            line-height: 1.45;
        `;
        window.setSafeHtml(layerHint, `
            <div style="color:#9aa2aa; margin-bottom:6px;">KERNEL DEVICE MODEL</div>
            Physical layer -> Driver layer -> Kernel subsystem -> User interaction<br>
            /sys registration, major/minor, IRQ and throughput drive node activity
        `);
        this.container.appendChild(layerHint);
        this.overlayNodes.push(layerHint);

        const err = document.createElement('div');
        err.style.cssText = `
            position: absolute;
            bottom: 18px;
            right: 20px;
            color: #a9aeb5;
            font-family: 'Share Tech Mono', monospace;
            font-size: 10px;
            z-index: 1001;
            opacity: 0.85;
            max-width: 48vw;
            text-align: right;
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

    createLabelSprite(text, color = '#c8ccd4', width = 220, fontSize = 28, scaleX = 1.8, scaleY = 0.52, letterSpacing = 0.3) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = 76;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = `${fontSize}px "Share Tech Mono", monospace`;
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const label = String(text || '').toUpperCase();
        const chars = Array.from(label);
        let totalWidth = 0;
        chars.forEach((ch, idx) => {
            totalWidth += ctx.measureText(ch).width;
            if (idx < chars.length - 1) totalWidth += letterSpacing;
        });
        let x = (canvas.width - totalWidth) / 2;
        const y = canvas.height / 2;
        chars.forEach((ch) => {
            ctx.fillText(ch, x, y);
            x += ctx.measureText(ch).width + letterSpacing;
        });

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(scaleX, scaleY, 1);
        return sprite;
    }

    clearDynamicObjects() {
        [...this.subsystemNodes, ...this.deviceNodes, ...this.links, ...this.pulses].forEach((obj) => {
            this.scene.remove(obj);
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
                else {
                    if (obj.material.map) obj.material.map.dispose();
                    obj.material.dispose();
                }
            }
        });
        this.subsystemNodes = [];
        this.deviceNodes = [];
        this.links = [];
        this.pulses = [];
    }

    normalizeCategory(category) {
        const c = String(category || '').toLowerCase();
        if (this.subsystemOrder.includes(c)) return c;
        if (c === 'misc' || c === 'gpu') return 'char';
        return 'char';
    }

    linkLine(from, to, color, opacity, deviceRef, loadNorm) {
        const curve = new THREE.CubicBezierCurve3(
            from.clone(),
            from.clone().lerp(to, 0.34).add(new THREE.Vector3(0, 0.45, 0)),
            from.clone().lerp(to, 0.66).add(new THREE.Vector3(0, -0.28, 0)),
            to.clone()
        );
        const pts = curve.getPoints(32);
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
        const line = new THREE.Line(geo, mat);
        line.userData = {
            curve,
            device: deviceRef || null,
            load_norm: loadNorm || 0,
            pulseCooldown: 0
        };
        this.scene.add(line);
        this.links.push(line);
        return line;
    }

    buildDeviceScene(devices) {
        this.clearDynamicObjects();
        const list = Array.isArray(devices) ? devices : [];

        const bySubsystem = {};
        this.subsystemOrder.forEach((k) => {
            bySubsystem[k] = [];
        });

        list.forEach((d) => {
            const sub = this.normalizeCategory(d.category);
            bySubsystem[sub].push(d);
        });

        const subsystemRadius = 4.4;
        const deviceRingBase = 2.15;
        const deviceMaxPerSubsystem = 8;

        const subsystemAnchors = {};

        this.subsystemOrder.forEach((sub, idx) => {
            const angle = (idx / this.subsystemOrder.length) * Math.PI * 2 - Math.PI / 2;
            const x = Math.cos(angle) * subsystemRadius;
            const y = Math.sin(angle) * subsystemRadius;
            const pos = new THREE.Vector3(x, y, 0);
            subsystemAnchors[sub] = { pos, angle };

            const devicesForSub = (bySubsystem[sub] || []).slice().sort((a, b) => {
                return (b.load_norm || 0) - (a.load_norm || 0);
            }).slice(0, deviceMaxPerSubsystem);

            const totalLoad = devicesForSub.reduce((acc, d) => acc + Number(d.load_norm || 0), 0);
            const avgLoad = devicesForSub.length ? totalLoad / devicesForSub.length : 0;
            const color = this.subsystemColors[sub] || 0x8a939f;
            const subNode = new THREE.Mesh(
                new THREE.CircleGeometry(0.44 + avgLoad * 0.16, 28),
                new THREE.MeshBasicMaterial({
                    color: 0x000000,
                    transparent: true,
                    opacity: 0.95
                })
            );
            subNode.position.copy(pos);
            this.scene.add(subNode);
            this.subsystemNodes.push(subNode);
            const subRadius = 0.44 + avgLoad * 0.16;
            const subOutline = new THREE.LineLoop(
                new THREE.BufferGeometry().setFromPoints(
                    Array.from({ length: 48 }, (_, i) => {
                        const a = (i / 48) * Math.PI * 2;
                        return new THREE.Vector3(
                            pos.x + Math.cos(a) * subRadius,
                            pos.y + Math.sin(a) * subRadius,
                            0.001
                        );
                    })
                ),
                new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.94 })
            );
            this.scene.add(subOutline);
            this.subsystemNodes.push(subOutline);

            const subLabel = this.createLabelSprite(sub.toUpperCase(), '#ffffff', 180, 11, 0.86, 0.24, 0.3);
            subLabel.position.set(pos.x, pos.y, 0.002);
            this.scene.add(subLabel);
            this.subsystemNodes.push(subLabel);

            this.linkLine(pos, new THREE.Vector3(0, 0, 0), color, 0.24 + avgLoad * 0.35, null, avgLoad);

            devicesForSub.forEach((d, j) => {
                const orbitRadius = deviceRingBase + (j % 3) * 0.42;
                const localAngle = (j / Math.max(1, devicesForSub.length)) * Math.PI * 2 + angle * 0.55;
                const dx = Math.cos(localAngle) * orbitRadius;
                const dy = Math.sin(localAngle) * orbitRadius;
                const devPos = new THREE.Vector3(pos.x + dx, pos.y + dy, 0);

                const load = Number(d.load_norm || 0);
                const devRadius = 0.16 + load * 0.08;
                const node = new THREE.Mesh(
                    new THREE.CircleGeometry(devRadius, 18),
                    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.95 })
                );
                node.position.copy(devPos);
                node.userData.device = d;
                this.scene.add(node);
                this.deviceNodes.push(node);
                const devOutline = new THREE.LineLoop(
                    new THREE.BufferGeometry().setFromPoints(
                        Array.from({ length: 24 }, (_, i) => {
                            const a = (i / 24) * Math.PI * 2;
                            return new THREE.Vector3(
                                devPos.x + Math.cos(a) * devRadius,
                                devPos.y + Math.sin(a) * devRadius,
                                0.001
                            );
                        })
                    ),
                    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
                );
                this.scene.add(devOutline);
                this.deviceNodes.push(devOutline);

                const shortName = String(d.name || '').slice(0, 10);
                const devLabel = this.createLabelSprite(shortName, '#ffffff', 140, 10, 0.42, 0.13, 0.3);
                devLabel.position.set(devPos.x, devPos.y, 0.002);
                this.scene.add(devLabel);
                this.deviceNodes.push(devLabel);

                this.linkLine(devPos, pos, color, 0.16 + load * 0.34, d, load);
            });
        });
    }

    spawnPulse(line) {
        const d = line.userData.device || {};
        const baseLoad = Number(line.userData.load_norm || d.load_norm || 0.12);
        const pulse = new THREE.Mesh(
            new THREE.SphereGeometry(0.05 + baseLoad * 0.07, 10, 10),
            new THREE.MeshBasicMaterial({
                color: 0xb0bac7,
                transparent: true,
                opacity: 0.88
            })
        );
        pulse.userData = {
            line,
            t: Math.random() * 0.2,
            speed: 0.25 + baseLoad * 1.6
        };
        pulse.position.copy(line.userData.curve.getPoint(pulse.userData.t));
        this.scene.add(pulse);
        this.pulses.push(pulse);
    }

    updateLinksAndPulses(dt) {
        this.links.forEach((line) => {
            const load = Number(line.userData.load_norm || 0.08);
            line.userData.pulseCooldown -= dt;
            const pulseRate = 0.35 + load * 3.8;
            if (line.userData.pulseCooldown <= 0) {
                this.spawnPulse(line);
                line.userData.pulseCooldown = 1 / Math.max(0.2, pulseRate);
            }
            line.material.opacity = Math.max(0.14, 0.2 + load * 0.45);
            line.material.needsUpdate = true;
        });

        this.pulses = this.pulses.filter((p) => {
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
            .then((res) => res.json())
            .then((data) => {
                if (!data || data.error) {
                    throw new Error(data?.error || 'No devices data');
                }
                this.buildDeviceScene(data.devices || []);

                if (this.telemetryErrorNode) {
                    const b = data.meta?.bus_counts || {};
                    const c = data.meta?.category_counts || {};
                    this.telemetryErrorNode.textContent =
                        `devices:${data.meta?.count || 0} | buses pcie:${b.pcie || 0} usb:${b.usb || 0} virtual:${b.virtual || 0} net:${b.net || 0} | ` +
                        `cat block:${c.block || 0} net:${c.net || 0} char:${c.char || 0} input:${c.input || 0} usb:${c.usb || 0}`;
                }
            })
            .catch((err) => {
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
            this.centralCore.rotation.y += 0.35 * dt;
        }

        const t = now * 0.00022;
        this.camera.position.x = Math.sin(t) * 0.9;
        this.camera.position.z = 17.5 + Math.cos(t) * 0.35;
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

window.DevicesBeltVisualization = DevicesBeltVisualization;
debugLog('🧲 devices-belt.js: DevicesBeltVisualization exported to window');
