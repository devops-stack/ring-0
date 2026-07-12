// Device Control Surface Visualization
// Version: 24

debugLog('🧲 devices-belt.js v24: Script loading...');

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
        this.deviceHudNode = null;
        this.deviceDetailNode = null;
        this.raycaster = null;
        this.mouse = null;
        this.pointerMoveHandler = null;
        this.pointerClickHandler = null;
        this.interactiveDeviceNodes = [];
        this.selectedDeviceKey = null;
        this.deviceLookup = {};

        this.centralCore = null;
        this.ringGuides = [];
        this.subsystemNodes = [];
        this.deviceNodes = [];
        this.links = [];
        this.pulses = [];

        this.subsystemOrder = ['block', 'net', 'char', 'input', 'usb'];
        this.busOrder = ['pcie', 'usb', 'virtual', 'net'];
        this.busLabels = {
            pcie: 'PCIe BUS',
            usb: 'USB BUS',
            virtual: 'VIRTUAL BUS',
            net: 'NET IFACE'
        };
        this.subsystemColors = {
            block: 0xb8c7da,
            net: 0x7fd8ff,
            char: 0xbfc8d8,
            input: 0xc9a6ff,
            usb: 0x8ff0d2
        };
        this.busColors = {
            pcie: 0xb8c7da,
            usb: 0x8ff0d2,
            virtual: 0xbfc8d8,
            net: 0x7fd8ff
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
                background: radial-gradient(circle at 48% 42%, #111b1f 0%, #081014 62%, #030608 100%);
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
        this.scene.background = new THREE.Color(0x070c10);

        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 0.15, 13.2);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.container.appendChild(this.renderer.domElement);
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.pointerMoveHandler = (event) => this.onPointerMove(event);
        this.pointerClickHandler = (event) => this.onPointerClick(event);
        this.renderer.domElement.addEventListener('pointermove', this.pointerMoveHandler);
        this.renderer.domElement.addEventListener('click', this.pointerClickHandler);

        // Intentionally no scene lights: flat HUD look (no 3D shading/highlights).

        this.createBaseScene();
        this.createOverlayUI();
        this.addExitButton();

        this.resizeHandler = () => this.onResize();
        window.addEventListener('resize', this.resizeHandler);

        this.keyHandler = (event) => {
            if (event.key === 'Escape') this.closeDrill();
        };
        window.addEventListener('keydown', this.keyHandler);

        return true;
    }

    createBaseScene() {
        const gridMat = new THREE.LineBasicMaterial({ color: 0x54d8e8, transparent: true, opacity: 0.06 });
        for (let x = -8.8; x <= 8.8; x += 0.72) {
            const geo = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(x, -5.4, -0.6),
                new THREE.Vector3(x, 5.4, -0.6)
            ]);
            const line = new THREE.Line(geo, gridMat.clone());
            this.scene.add(line);
            this.ringGuides.push(line);
        }
        for (let y = -5.2; y <= 5.2; y += 0.58) {
            const geo = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(-8.8, y, -0.6),
                new THREE.Vector3(8.8, y, -0.6)
            ]);
            const line = new THREE.Line(geo, gridMat.clone());
            this.scene.add(line);
            this.ringGuides.push(line);
        }

        const membraneGeo = new THREE.PlaneGeometry(14.2, 7.4);
        const membraneMat = new THREE.MeshBasicMaterial({
            color: 0x041014,
            transparent: true,
            opacity: 0.16,
            depthWrite: false
        });
        this.centralCore = new THREE.Mesh(membraneGeo, membraneMat);
        this.centralCore.position.set(0, -0.1, -0.22);
        this.scene.add(this.centralCore);
        const membraneEdge = new THREE.LineSegments(
            new THREE.EdgesGeometry(membraneGeo),
            new THREE.LineBasicMaterial({ color: 0x54d8e8, transparent: true, opacity: 0.28 })
        );
        membraneEdge.position.copy(this.centralCore.position);
        this.scene.add(membraneEdge);
        this.ringGuides.push(membraneEdge);

        const sectionLines = [
            { y: 2.46, opacity: 0.28 },
            { y: 0.64, opacity: 0.18 },
            { y: -1.72, opacity: 0.28 },
            { y: -3.42, opacity: 0.22 }
        ];
        sectionLines.forEach((item) => {
            const line = new THREE.Line(
                new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(-7.6, item.y, -0.02),
                    new THREE.Vector3(7.6, item.y, -0.02)
                ]),
                new THREE.LineBasicMaterial({ color: 0x54d8e8, transparent: true, opacity: item.opacity })
            );
            this.scene.add(line);
            this.ringGuides.push(line);
        });

        const coreLabel = this.createLabelSprite('LINUX DEVICE CONTROL SURFACE', '#bff9ff', 560, 15, 3.45, 0.42, 0.42);
        coreLabel.position.set(-3.75, 3.72, 0.002);
        this.scene.add(coreLabel);
        this.ringGuides.push(coreLabel);

        const lowerLabel = this.createLabelSprite('DEVICE BLOCK LAYER', '#9ff7ff', 380, 14, 2.35, 0.42, 0.35);
        lowerLabel.position.set(-5.95, -3.82, 0.002);
        this.scene.add(lowerLabel);
        this.ringGuides.push(lowerLabel);
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
        title.textContent = 'DEVICE CONTROL SURFACE (in development)';
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
        subtitle.textContent = 'devices below -> linux kernel interaction matrix -> live system information above';
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
            <div style="color:#54d8e8; margin-bottom:6px;">SURFACE LAYERS</div>
            bottom: live devices from /sys and /dev<br>
            middle: Linux kernel parts touching hardware<br>
            top: current IRQ, DMA, driver and bus telemetry
        `);
        this.container.appendChild(layerHint);
        this.overlayNodes.push(layerHint);

        const hud = document.createElement('div');
        hud.style.cssText = `
            position: absolute;
            top: 230px;
            right: 24px;
            color: #aeb8c6;
            font-family: 'Share Tech Mono', monospace;
            font-size: 10px;
            z-index: 1001;
            background: rgba(6, 11, 17, 0.74);
            border: 1px solid rgba(150, 170, 200, 0.24);
            border-radius: 6px;
            padding: 10px 12px;
            width: 318px;
            line-height: 1.52;
        `;
        window.setSafeHtml(hud, `
            <div style="color:#dbe7f4; margin-bottom:6px;">SYSTEM ECHO RESULT</div>
            waiting for /api/devices-realtime
        `);
        this.container.appendChild(hud);
        this.overlayNodes.push(hud);
        this.deviceHudNode = hud;

        const detail = document.createElement('div');
        detail.style.cssText = `
            position: absolute;
            left: 24px;
            bottom: 26px;
            width: 360px;
            color: #bff9ff;
            font-family: 'Share Tech Mono', monospace;
            font-size: 10px;
            z-index: 1001;
            background: rgba(3, 9, 12, 0.76);
            border: 1px solid rgba(84, 216, 232, 0.36);
            box-shadow: 0 0 18px rgba(84, 216, 232, 0.08);
            border-radius: 4px;
            padding: 10px 12px;
            line-height: 1.5;
            pointer-events: none;
        `;
        window.setSafeHtml(detail, `
            <div style="color:#54d8e8; margin-bottom:6px;">DEVICE SIGNATURE</div>
            hover a device block to inspect sysfs, driver and IRQ/DMA path
        `);
        this.container.appendChild(detail);
        this.overlayNodes.push(detail);
        this.deviceDetailNode = detail;

        this.createDrillOverlay();

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
                // Standalone page (e.g. /linux-devices-subsystem): go home like
                // the other subsystem pages instead of leaving a blank view.
                window.location.assign('/');
            }
        };
        this.container.appendChild(btn);
        this.exitButton = btn;
    }

    createLabelSprite(text, color = '#c8ccd4', width = 220, fontSize = 28, scaleX = 1.8, scaleY = 0.52, letterSpacing = 0.3) {
        const canvas = document.createElement('canvas');
        const textureScale = 3;
        const logicalWidth = width;
        const logicalHeight = 96;
        canvas.width = logicalWidth * textureScale;
        canvas.height = logicalHeight * textureScale;
        canvas.style.width = `${logicalWidth}px`;
        canvas.style.height = `${logicalHeight}px`;
        const ctx = canvas.getContext('2d');
        ctx.scale(textureScale, textureScale);
        ctx.clearRect(0, 0, logicalWidth, logicalHeight);
        ctx.font = `700 ${fontSize}px "Share Tech Mono", monospace`;
        ctx.fillStyle = color;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.92)';
        ctx.lineWidth = Math.max(2, Math.floor(fontSize * 0.18));
        ctx.shadowColor = 'rgba(84, 216, 232, 0.42)';
        ctx.shadowBlur = Math.max(3, Math.floor(fontSize * 0.35));
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const lines = String(text || '').toUpperCase().split('\n');
        const lineHeight = fontSize * 1.25;
        const startY = logicalHeight / 2 - ((lines.length - 1) * lineHeight) / 2;
        lines.forEach((line, lineIdx) => {
            const chars = Array.from(line);
            let totalWidth = 0;
            chars.forEach((ch, idx) => {
                totalWidth += ctx.measureText(ch).width;
                if (idx < chars.length - 1) totalWidth += letterSpacing;
            });
            let x = (logicalWidth - totalWidth) / 2;
            const y = startY + lineIdx * lineHeight;
            chars.forEach((ch) => {
                ctx.strokeText(ch, x, y);
                ctx.fillText(ch, x, y);
                x += ctx.measureText(ch).width + letterSpacing;
            });
        });

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthWrite: false,
            depthTest: false
        });
        const sprite = new THREE.Sprite(material);
        const sceneTextScale = 1.72;
        sprite.scale.set(scaleX * sceneTextScale, scaleY * sceneTextScale, 1);
        return sprite;
    }

    circlePoints(radius, segments = 72, center = new THREE.Vector3(0, 0, 0), z = 0) {
        return Array.from({ length: segments }, (_, i) => {
            const a = (i / segments) * Math.PI * 2;
            return new THREE.Vector3(center.x + Math.cos(a) * radius, center.y + Math.sin(a) * radius, z);
        });
    }

    createTopologyNode(label, position, radius, color, options = {}) {
        const fill = new THREE.Mesh(
            new THREE.CircleGeometry(radius, options.segments || 28),
            new THREE.MeshBasicMaterial({
                color: options.fillColor || 0x000000,
                transparent: true,
                opacity: options.fillOpacity ?? 0.93,
                depthWrite: false
            })
        );
        fill.position.copy(position);
        this.scene.add(fill);

        const outline = new THREE.LineLoop(
            new THREE.BufferGeometry().setFromPoints(this.circlePoints(radius, options.segments || 36, position, 0.002)),
            new THREE.LineBasicMaterial({ color, transparent: true, opacity: options.opacity ?? 0.9 })
        );
        this.scene.add(outline);

        const text = this.createLabelSprite(
            label,
            options.labelColor || '#f2f5fa',
            options.labelWidth || 220,
            options.fontSize || 11,
            options.scaleX || 1.2,
            options.scaleY || 0.28,
            0.25
        );
        text.position.set(position.x, position.y + (options.labelOffsetY ?? 0), 0.006);
        this.scene.add(text);

        const target = options.target || this.deviceNodes;
        target.push(fill, outline, text);
        return { fill, outline, label: text };
    }

    createBoxNode(label, position, size, color, options = {}) {
        const geom = new THREE.BoxGeometry(size.x, size.y, size.z || 0.08);
        const fill = new THREE.Mesh(
            geom,
            new THREE.MeshBasicMaterial({
                color: options.fillColor || 0x05080c,
                transparent: true,
                opacity: options.fillOpacity ?? 0.74,
                depthWrite: false
            })
        );
        fill.position.copy(position);
        this.scene.add(fill);

        const edge = new THREE.LineSegments(
            new THREE.EdgesGeometry(geom),
            new THREE.LineBasicMaterial({ color, transparent: true, opacity: options.opacity ?? 0.62 })
        );
        edge.position.copy(position);
        this.scene.add(edge);

        const text = this.createLabelSprite(
            label,
            options.labelColor || '#dbe7f4',
            options.labelWidth || 280,
            options.fontSize || 9,
            options.scaleX || 1.28,
            options.scaleY || 0.24,
            0.24
        );
        text.position.set(position.x, position.y + (options.labelOffsetY ?? 0), position.z + 0.08);
        this.scene.add(text);

        const target = options.target || this.deviceNodes;
        target.push(fill, edge, text);
        return { fill, edge, label: text };
    }

    createStaticLine(points, color = 0x54d8e8, opacity = 0.35, target = this.deviceNodes) {
        const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(points),
            new THREE.LineBasicMaterial({ color, transparent: true, opacity })
        );
        this.scene.add(line);
        target.push(line);
        return line;
    }

    createTinyGrid(origin, cols, rows, cellSize, gap, color, activeCount, target = this.deviceNodes) {
        const total = cols * rows;
        for (let i = 0; i < total; i += 1) {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const active = i < activeCount || (i + row) % 5 === 0;
            this.createBoxNode('', new THREE.Vector3(origin.x + col * (cellSize + gap), origin.y - row * (cellSize + gap), origin.z), new THREE.Vector3(cellSize, cellSize, 0.035), color, {
                target,
                fillOpacity: active ? 0.34 : 0.035,
                opacity: active ? 0.78 : 0.18,
                scaleX: 0.05,
                scaleY: 0.05
            });
        }
    }

    lifecycleValue(stage, device, bus, category) {
        const load = Number(device.load_norm || 0);
        const irq = Number(device.irq_per_sec || 0);
        const throughput = Number(device.throughput_mb_s || 0);
        const majorMinor = device.major != null && device.minor != null ? `${device.major}:${device.minor}` : 'hotplug';
        const driver = String(device.driver || 'driver-core').slice(0, 12);
        const name = String(device.name || 'dev').slice(0, 12);
        const interaction = String(device.user_interaction || 'syscall/ioctl').slice(0, 18);
        const values = {
            detect: `${bus.toUpperCase()} ${name}`,
            init: `${category.toUpperCase()} probe`,
            bind: driver,
            irq: irq > 0 ? `${irq.toFixed(1)}/s` : 'quiet',
            dma: throughput > 0 ? `${throughput.toFixed(2)} MB/s` : `${Math.round(load * 100)}% path`,
            devnode: majorMinor,
            process: interaction
        };
        return values[stage] || name;
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
        this.interactiveDeviceNodes = [];
        this.deviceLookup = {};
    }

    normalizeCategory(category) {
        const c = String(category || '').toLowerCase();
        if (this.subsystemOrder.includes(c)) return c;
        if (c === 'misc' || c === 'gpu') return 'char';
        return 'char';
    }

    normalizeBus(bus, category) {
        const b = String(bus || '').toLowerCase();
        if (this.busOrder.includes(b)) return b;
        const c = this.normalizeCategory(category);
        if (c === 'net') return 'net';
        if (c === 'usb') return 'usb';
        if (c === 'char' || c === 'input') return 'virtual';
        return 'pcie';
    }

    deviceKey(device) {
        return `${this.normalizeCategory(device?.category)}::${String(device?.name || 'unknown')}`;
    }

    escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[ch]));
    }

    formatDeviceDetail(device) {
        if (!device) {
            return `
                <div style="color:#54d8e8; margin-bottom:6px;">DEVICE SIGNATURE</div>
                hover a device block to inspect sysfs, driver and IRQ/DMA path<br>
                <span style="color:#7fd8ff">click</span> a device to open the full inspector
            `;
        }
        const category = this.normalizeCategory(device.category);
        const bus = this.normalizeBus(device.bus, device.category);
        const majorMinor = device.major != null && device.minor != null ? `${device.major}:${device.minor}` : 'hotplug';
        const loadPct = Math.round(Number(device.load_norm || 0) * 100);
        const rows = [
            ['device', device.name || 'unknown'],
            ['bus/category', `${bus} / ${category}`],
            ['driver', device.driver || 'n/a'],
            ['major:minor', majorMinor],
            ['irq/sec', Number(device.irq_per_sec || 0).toFixed(2)],
            ['dma/throughput', `${Number(device.throughput_mb_s || 0).toFixed(3)} MB/s`],
            ['process path', device.user_interaction || 'syscall/ioctl'],
            ['sysfs', device.sys_path || '/sys']
        ];
        return `
            <div style="color:#54d8e8; margin-bottom:6px;">DEVICE SIGNATURE :: ${this.escapeHtml(String(device.name || 'unknown').toUpperCase())}</div>
            <div style="color:#dffcff; margin-bottom:6px;">kernel contact: ${this.escapeHtml(bus.toUpperCase())} -> ${this.escapeHtml(category.toUpperCase())} -> ${this.escapeHtml(majorMinor)} | load ${loadPct}%</div>
            ${rows.map(([k, v]) => `<div><span style="color:#7fd8ff">${this.escapeHtml(k)}</span> ${this.escapeHtml(v)}</div>`).join('')}
        `;
    }

    updateDeviceDetail(device) {
        if (!this.deviceDetailNode) return;
        window.setSafeHtml(this.deviceDetailNode, this.formatDeviceDetail(device));
    }

    subsystemLinkFor(device) {
        const sub = String(device.subsystem || '').toLowerCase();
        const cat = this.normalizeCategory(device.category);
        if (sub === 'file-system' || cat === 'block') {
            return { href: '/linux-filesystem-subsystem', label: 'OPEN FILESYSTEM SUBSYSTEM' };
        }
        if (sub === 'network-stack' || cat === 'net') {
            return { href: '/linux-network-subsystem', label: 'OPEN NETWORK SUBSYSTEM' };
        }
        return null;
    }

    createDrillOverlay() {
        const scrim = document.createElement('div');
        scrim.style.cssText = `
            position: absolute;
            inset: 0;
            background: radial-gradient(circle at 50% 42%, rgba(6, 12, 18, 0.68), rgba(2, 5, 9, 0.9));
            z-index: 2000;
            display: none;
        `;
        scrim.addEventListener('click', (event) => { if (event.target === scrim) this.closeDrill(); });

        const panel = document.createElement('div');
        panel.style.cssText = `
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            width: min(720px, 92vw);
            max-height: 84vh;
            overflow: auto;
            background: rgba(6, 11, 17, 0.97);
            border: 1px solid rgba(84, 216, 232, 0.42);
            border-radius: 10px;
            box-shadow: 0 0 44px rgba(84, 216, 232, 0.14);
            padding: 22px 26px 24px;
            font-family: 'Share Tech Mono', monospace;
            color: #cfe8f2;
        `;

        const closeBtn = document.createElement('div');
        closeBtn.textContent = '×';
        closeBtn.style.cssText = `
            position: absolute;
            top: 12px;
            right: 16px;
            color: #7fd8ff;
            font-size: 22px;
            line-height: 1;
            cursor: pointer;
            opacity: 0.8;
        `;
        closeBtn.onmouseenter = () => { closeBtn.style.opacity = '1'; };
        closeBtn.onmouseleave = () => { closeBtn.style.opacity = '0.8'; };
        closeBtn.onclick = () => this.closeDrill();

        const content = document.createElement('div');

        const linkBtn = document.createElement('button');
        linkBtn.style.cssText = `
            margin-top: 16px;
            padding: 8px 14px;
            background: rgba(12, 22, 30, 0.9);
            border: 1px solid rgba(127, 216, 255, 0.5);
            color: #bff0ff;
            font-family: 'Share Tech Mono', monospace;
            font-size: 11px;
            letter-spacing: 0.4px;
            cursor: pointer;
            display: none;
        `;
        linkBtn.onmouseenter = () => { linkBtn.style.background = 'rgba(20, 34, 44, 0.95)'; linkBtn.style.color = '#ffffff'; };
        linkBtn.onmouseleave = () => { linkBtn.style.background = 'rgba(12, 22, 30, 0.9)'; linkBtn.style.color = '#bff0ff'; };
        linkBtn.onclick = () => { if (this.drillLinkHref) window.location.assign(this.drillLinkHref); };

        panel.appendChild(closeBtn);
        panel.appendChild(content);
        panel.appendChild(linkBtn);
        scrim.appendChild(panel);
        this.container.appendChild(scrim);
        this.overlayNodes.push(scrim);

        this.drillScrim = scrim;
        this.drillContent = content;
        this.drillLinkBtn = linkBtn;
        this.drillLinkHref = null;
    }

    drillFlowHtml(device) {
        const cat = this.normalizeCategory(device.category);
        const bus = this.normalizeBus(device.bus, device.category);
        const stages = [
            ['BUS', bus.toUpperCase(), '#8ff0d2'],
            ['DEVICE', String(device.name || '?').toUpperCase(), '#dffcff'],
            ['DRIVER', String(device.driver || 'n/a').toUpperCase(), '#c9a6ff'],
            ['KERNEL', String(device.subsystem || cat || 'core').toUpperCase(), '#7fd8ff'],
            ['USERSPACE', String(device.user_interaction || 'syscall').toUpperCase(), '#b8c7da']
        ];
        const node = (label, value, col) => `
            <div style="display:inline-block; text-align:center; vertical-align:middle;">
                <div style="font-size:8px; color:#6d8398; letter-spacing:1px; margin-bottom:3px;">${this.escapeHtml(label)}</div>
                <div style="border:1px solid ${col}; color:${col}; border-radius:4px; padding:5px 8px; font-size:10px; min-width:64px;">${this.escapeHtml(value)}</div>
            </div>`;
        const arrow = '<span style="color:#4b6377; margin:0 6px; font-size:12px; vertical-align:middle;">&rarr;</span>';
        return `<div style="margin:14px 0 4px; white-space:nowrap; overflow-x:auto;">${stages.map(([l, v, c]) => node(l, v, c)).join(arrow)}</div>`;
    }

    formatDrillContent(device) {
        const category = this.normalizeCategory(device.category);
        const bus = this.normalizeBus(device.bus, device.category);
        const majorMinor = device.major != null && device.minor != null ? `${device.major}:${device.minor}` : 'hotplug (dynamic)';
        const loadPct = Math.round(Number(device.load_norm || 0) * 100);
        const rows = [
            ['bus / category', `${bus} / ${category}`],
            ['driver', device.driver || 'n/a (no bound driver)'],
            ['major:minor', majorMinor],
            ['irq / sec', Number(device.irq_per_sec || 0).toFixed(2)],
            ['irq total', Number(device.irq_total || 0).toLocaleString()],
            ['throughput', `${Number(device.throughput_mb_s || 0).toFixed(3)} MB/s`],
            ['user interaction', device.user_interaction || 'syscall / ioctl'],
            ['sysfs path', device.sys_path || '/sys']
        ];
        if (device.category === 'net' || device.drops != null || device.errors != null) {
            rows.push(['net drops / errors', `${Number(device.drops || 0)} / ${Number(device.errors || 0)}`]);
        }
        const header = `
            <div style="color:#54d8e8; font-size:15px; letter-spacing:1px; margin-bottom:2px;">DEVICE :: ${this.escapeHtml(String(device.name || 'unknown').toUpperCase())}</div>
            <div style="color:#8aa0b4; font-size:10px; margin-bottom:6px;">${this.escapeHtml(bus.toUpperCase())} bus &middot; ${this.escapeHtml(category)} class &middot; load ${loadPct}%</div>`;
        const flow = this.drillFlowHtml(device);
        const flowCaption = '<div style="font-size:9px; color:#6d8398; margin-bottom:10px;">enumeration path: how this device is reached from the bus down to userspace</div>';
        const table = `<div style="font-size:11px; line-height:1.7;">${rows.map(([k, v]) => `
            <div><span style="display:inline-block; width:150px; color:#7fd8ff;">${this.escapeHtml(k)}</span>${this.escapeHtml(v)}</div>`).join('')}</div>`;
        return `${header}${flow}${flowCaption}${table}`;
    }

    openDrill(device) {
        if (!this.drillScrim || !device) return;
        window.setSafeHtml(this.drillContent, this.formatDrillContent(device));
        const link = this.subsystemLinkFor(device);
        if (link) {
            this.drillLinkHref = link.href;
            this.drillLinkBtn.textContent = `${link.label} \u2192`;
            this.drillLinkBtn.style.display = 'inline-block';
        } else {
            this.drillLinkHref = null;
            this.drillLinkBtn.style.display = 'none';
        }
        this.drillScrim.style.display = 'block';
    }

    closeDrill() {
        if (this.drillScrim) this.drillScrim.style.display = 'none';
        this.drillLinkHref = null;
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

    setPointerFromEvent(event) {
        if (!this.renderer || !this.mouse) return false;
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        return true;
    }

    pickDevice(event) {
        if (!this.raycaster || !this.camera || !this.interactiveDeviceNodes.length) return null;
        if (!this.setPointerFromEvent(event)) return null;
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const hits = this.raycaster.intersectObjects(this.interactiveDeviceNodes, false);
        return hits.length ? hits[0].object.userData.device : null;
    }

    onPointerMove(event) {
        const device = this.pickDevice(event);
        if (device) {
            this.updateDeviceDetail(device);
            this.renderer.domElement.style.cursor = 'crosshair';
        } else {
            const selected = this.selectedDeviceKey ? this.deviceLookup[this.selectedDeviceKey] : null;
            this.updateDeviceDetail(selected || null);
            this.renderer.domElement.style.cursor = 'default';
        }
    }

    onPointerClick(event) {
        const device = this.pickDevice(event);
        if (!device) return;
        this.selectedDeviceKey = this.deviceKey(device);
        this.updateDeviceDetail(device);
        this.openDrill(device);
    }

    buildDeviceScene(devices) {
        this.clearDynamicObjects();
        const list = Array.isArray(devices) ? devices : [];
        const hotDevices = list.slice().sort((a, b) => {
            const aScore = Number(a.load_norm || 0) + Number(a.irq_per_sec || 0) * 0.01 + Number(a.throughput_mb_s || 0) * 0.05;
            const bScore = Number(b.load_norm || 0) + Number(b.irq_per_sec || 0) * 0.01 + Number(b.throughput_mb_s || 0) * 0.05;
            return bScore - aScore;
        }).slice(0, 18);

        const totalIrq = list.reduce((acc, d) => acc + Number(d.irq_per_sec || 0), 0);
        const totalDma = list.reduce((acc, d) => acc + Number(d.throughput_mb_s || 0), 0);
        const activeDrivers = new Set(list.map((d) => String(d.driver || '').trim()).filter((d) => d && d !== 'n/a')).size;
        const busCounts = this.busOrder.reduce((acc, bus) => {
            acc[bus] = list.filter((d) => this.normalizeBus(d.bus, d.category) === bus).length;
            return acc;
        }, {});

        this.createStaticLine([new THREE.Vector3(-7.25, 3.38, 0.08), new THREE.Vector3(7.2, 3.38, 0.08)], 0x54d8e8, 0.42, this.subsystemNodes);
        this.createStaticLine([new THREE.Vector3(-6.2, 2.1, 0.08), new THREE.Vector3(-3.35, 2.1, 0.08), new THREE.Vector3(-2.95, 1.78, 0.08)], 0x54d8e8, 0.34, this.subsystemNodes);
        this.createStaticLine([new THREE.Vector3(2.45, 2.04, 0.08), new THREE.Vector3(5.15, 2.04, 0.08), new THREE.Vector3(5.75, 1.72, 0.08)], 0x54d8e8, 0.34, this.subsystemNodes);

        const trackingPanels = [
            { text: `TRACKING CODE 0200A32  ${String(list.length).padStart(2, '0')}/32`, x: -5.05 },
            { text: `TRACKING CODE 0200B58  ${String(activeDrivers).padStart(2, '0')}/26`, x: -1.65 },
            { text: `IRQ HOT PATH ${totalIrq.toFixed(1)}`, x: 1.7 },
            { text: `DMA VECTOR ${totalDma.toFixed(2)}MB`, x: 4.95 }
        ];
        trackingPanels.forEach((panel) => {
            this.createBoxNode(panel.text, new THREE.Vector3(panel.x, 3.02, 0.12), new THREE.Vector3(2.55, 0.28, 0.08), 0x54d8e8, {
                target: this.subsystemNodes,
                fillOpacity: 0.06,
                opacity: 0.72,
                fontSize: 10,
                scaleX: 2.15,
                scaleY: 0.26,
                labelWidth: 470,
                labelColor: '#dffcff'
            });
        });

        const leftPanel = new THREE.Vector3(-4.78, 1.62, 0.14);
        this.createBoxNode('', leftPanel, new THREE.Vector3(4.25, 2.38, 0.08), 0x54d8e8, {
            target: this.subsystemNodes,
            fillOpacity: 0.035,
            opacity: 0.22,
            scaleX: 0.1,
            scaleY: 0.1
        });
        const utilityTitle = this.createLabelSprite('UTILITY UNIT KIT', '#ffffff', 480, 19, 2.72, 0.52, 0.36);
        utilityTitle.position.set(-5.25, 2.43, 0.18);
        this.scene.add(utilityTitle);
        this.subsystemNodes.push(utilityTitle);
        const leftRows = [
            ['CONTROLLING UNIT', `${String(busCounts.pcie || 0).padStart(2, '0')}39`],
            ['DATA PAD', `${String(busCounts.usb || 0).padStart(2, '0')}78`],
            ['CODER-SCRAMBLER', `${String(busCounts.virtual || 0).padStart(2, '0')}5-B`]
        ];
        leftRows.forEach((row, idx) => {
            const y = 1.88 - idx * 0.26;
            const label = this.createLabelSprite(row[0], '#dffcff', 340, 12, 1.78, 0.28, 0.18);
            label.position.set(-5.2, y, 0.18);
            this.scene.add(label);
            this.subsystemNodes.push(label);
            this.createBoxNode(row[1], new THREE.Vector3(-3.88, y, 0.16), new THREE.Vector3(0.72, 0.18, 0.06), 0x54d8e8, {
                target: this.subsystemNodes,
                fillOpacity: 0.42,
                opacity: 0.64,
                fontSize: 10,
                scaleX: 0.78,
                scaleY: 0.24,
                labelWidth: 170,
                labelColor: '#061014'
            });
        });
        this.createTinyGrid(new THREE.Vector3(-5.92, 1.12, 0.16), 5, 4, 0.24, 0.07, 0x54d8e8, Math.min(20, 5 + list.length), this.subsystemNodes);

        const rightPanel = new THREE.Vector3(3.76, 1.62, 0.14);
        this.createBoxNode('', rightPanel, new THREE.Vector3(4.15, 2.42, 0.08), 0x54d8e8, {
            target: this.subsystemNodes,
            fillOpacity: 0.035,
            opacity: 0.22,
            scaleX: 0.1,
            scaleY: 0.1
        });
        const radioTitle = this.createLabelSprite('RADIO ECHO RESULT', '#ffffff', 500, 18, 2.65, 0.48, 0.36);
        radioTitle.position.set(3.33, 2.42, 0.18);
        this.scene.add(radioTitle);
        this.subsystemNodes.push(radioTitle);
        const echoRows = [
            ['GEN ROOT LINK', list.length],
            ['SPIN LINK', busCounts.pcie || 0],
            ['RX-SC LOCKER', activeDrivers],
            ['READY POINT', busCounts.usb || 0],
            ['STATIC CONVERT', busCounts.virtual || 0],
            ['SPRING MESSAGE', totalIrq.toFixed(1)],
            ['DIRECT X-FLOW', totalDma.toFixed(2)]
        ];
        echoRows.forEach((row, idx) => {
            const y = 2.02 - idx * 0.22;
            const name = this.createLabelSprite(row[0], '#dffcff', 330, 11, 1.62, 0.24, 0.16);
            name.position.set(2.95, y, 0.18);
            this.scene.add(name);
            this.subsystemNodes.push(name);
            const value = this.createLabelSprite(String(row[1]), '#ffffff', 130, 11, 0.72, 0.24, 0.16);
            value.position.set(4.48, y, 0.18);
            this.scene.add(value);
            this.subsystemNodes.push(value);
        });

        const kernelLabel = this.createLabelSprite('LINUX KERNEL CONTACT GRID', '#dffcff', 560, 13, 2.95, 0.38, 0.26);
        kernelLabel.position.set(-1.25, 0.82, 0.16);
        this.scene.add(kernelLabel);
        this.subsystemNodes.push(kernelLabel);
        this.createTinyGrid(new THREE.Vector3(-3.75, 0.38, 0.14), 22, 4, 0.17, 0.08, 0x54d8e8, Math.min(88, 16 + list.length * 2), this.subsystemNodes);
        const kernelParts = [
            ['BUS', -3.75], ['DRV', -2.55], ['PROBE', -1.35], ['IRQ', -0.15], ['DMA', 1.05], ['UDEV', 2.25], ['VFS', 3.45]
        ];
        kernelParts.forEach(([label, x]) => {
            const sprite = this.createLabelSprite(label, '#dffcff', 190, 11, 0.9, 0.24, 0.16);
            sprite.position.set(x, -0.42, 0.16);
            this.scene.add(sprite);
            this.subsystemNodes.push(sprite);
        });

        const devicesByCategory = {};
        this.subsystemOrder.forEach((category) => {
            devicesByCategory[category] = [];
        });
        hotDevices.forEach((device) => {
            const category = this.normalizeCategory(device.category);
            devicesByCategory[category].push(device);
        });

        const groupLayout = [
            { category: 'block', label: 'BLOCK I/O', x: -6.4, y: -2.52, cols: 3, max: 6 },
            { category: 'net', label: 'NETDEV', x: -3.35, y: -2.52, cols: 2, max: 4 },
            { category: 'char', label: 'CHARDEV', x: -1.02, y: -2.52, cols: 2, max: 4 },
            { category: 'input', label: 'INPUT', x: 1.18, y: -2.52, cols: 2, max: 4 },
            { category: 'usb', label: 'USB/HOTPLUG', x: 3.48, y: -2.52, cols: 3, max: 6 }
        ];
        const selectedCandidates = [];

        groupLayout.forEach((group) => {
            const categoryDevices = (devicesByCategory[group.category] || []).slice(0, group.max);
            const color = this.subsystemColors[group.category] || 0x54d8e8;
            const panelWidth = group.cols === 3 ? 2.55 : 1.78;
            const panelHeight = 1.08;
            this.createBoxNode('', new THREE.Vector3(group.x + panelWidth / 2 - 0.55, group.y - 0.25, 0.09), new THREE.Vector3(panelWidth, panelHeight, 0.06), color, {
                target: this.deviceNodes,
                fillOpacity: 0.025,
                opacity: 0.18,
                scaleX: 0.05,
                scaleY: 0.05
            });

            const groupLabel = this.createLabelSprite(group.label, '#dffcff', 300, 11, 1.22, 0.28, 0.18);
            groupLabel.position.set(group.x + panelWidth / 2 - 0.55, group.y + 0.38, 0.15);
            this.scene.add(groupLabel);
            this.deviceNodes.push(groupLabel);

            categoryDevices.forEach((device, localIdx) => {
                const load = Number(device.load_norm || 0);
                const col = localIdx % group.cols;
                const row = Math.floor(localIdx / group.cols);
                const x = group.x + col * 0.74;
                const y = group.y - row * 0.42;
                const bus = this.normalizeBus(device.bus, device.category);
                const name = String(device.name || 'dev').slice(0, 8);
                const mm = device.major != null && device.minor != null ? `${device.major}:${device.minor}` : 'hot';
                const key = this.deviceKey(device);
                const isSelected = this.selectedDeviceKey === key;
                this.deviceLookup[key] = device;

                const node = this.createBoxNode(
                    name,
                    new THREE.Vector3(x, y, 0.16),
                    new THREE.Vector3(0.62, 0.27, 0.1),
                    color,
                    {
                        target: this.deviceNodes,
                        fillOpacity: (isSelected ? 0.42 : 0.1) + load * 0.24,
                        opacity: (isSelected ? 0.92 : 0.48) + load * 0.28,
                        fontSize: 12,
                        scaleX: 0.9,
                        scaleY: 0.28,
                        labelWidth: 260,
                        labelColor: isSelected ? '#ffffff' : '#dffcff'
                    }
                );
                node.fill.userData.device = device;
                this.interactiveDeviceNodes.push(node.fill);
                selectedCandidates.push(device);

                const detail = this.createLabelSprite(`${bus.toUpperCase()} ${mm}`, '#bff9ff', 250, 10, 0.94, 0.24, 0.14);
                detail.position.set(x, y - 0.27, 0.16);
                this.scene.add(detail);
                this.deviceNodes.push(detail);

                if (selectedCandidates.length <= 14) {
                    const targetX = -3.75 + (selectedCandidates.length % 22) * 0.25;
                    const targetY = 0.38 - (selectedCandidates.length % 4) * 0.25;
                    this.createStaticLine([
                        new THREE.Vector3(x, y + 0.15, 0.12),
                        new THREE.Vector3(targetX, targetY, 0.12)
                    ], color, isSelected ? 0.34 : 0.08 + load * 0.2, this.deviceNodes);
                }
            });
        });

        const selectedDevice = selectedCandidates.find((device) => this.deviceKey(device) === this.selectedDeviceKey)
            || selectedCandidates[0]
            || null;
        if (selectedDevice) {
            this.selectedDeviceKey = this.selectedDeviceKey || this.deviceKey(selectedDevice);
        }
        this.updateDeviceDetail(selectedDevice);

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
                if (this.deviceHudNode) {
                    const b = data.meta?.bus_counts || {};
                    const top = (data.devices || []).slice(0, 5)
                        .map((d) => {
                            const load = Math.round(Number(d.load_norm || 0) * 100);
                            const mm = d.major != null && d.minor != null ? `${d.major}:${d.minor}` : 'hotplug';
                            return `<div>${String(d.name || '?').slice(0, 13)} :: detect/${String(d.bus || 'bus').toUpperCase()} -> bind/${String(d.driver || 'driver-core').slice(0, 11)} -> node/<span style="color:#dbe7f4">${mm}</span> ${load}%</div>`;
                        })
                        .join('');
                    window.setSafeHtml(this.deviceHudNode, `
                        <div style="color:#dbe7f4; margin-bottom:6px;">SYSTEM ECHO RESULT</div>
                        bus pcie:${b.pcie || 0} usb:${b.usb || 0} virtual:${b.virtual || 0} net:${b.net || 0}<br>
                        <div style="margin-top:8px; color:#54d8e8;">ACTIVE DEVICE BLOCKS</div>
                        ${top || '<div>waiting for active devices</div>'}
                    `);
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

        this.camera.position.x = 0;
        this.camera.position.z = 13.2;
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
        this.closeDrill();
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
