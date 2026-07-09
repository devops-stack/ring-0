// Nginx Files Manager for Bezier Curves
class NginxFilesManager {
    constructor() {
        this.files = [];
        this.updateInterval = null;
        this.highlightedPid = null;
        this.procFilesActive = false;
    }

    // Initialize nginx files visualization
    init() {
        debugLog('🔧 Initializing NginxFilesManager...');
        this.updateFiles();
        this.startAutoUpdate(10000); // Update every 10 seconds
    }

    // Update files data
    async updateFiles() {
        try {
            debugLog('📁 Fetching I/O open files...');
            const response = await fetch('/api/io-open-files?limit=40');
            const data = await response.json();
            
            debugLog('📁 Received nginx files:', data);
            
            if (data.files && data.files.length > 0) {
                this.files = data.files;
                debugLog('🎨 Rendering files on curves...');
                this.renderFilesOnCurves();
            } else {
                debugLog('⚠️ No nginx files found');
            }
        } catch (error) {
            console.error('Error fetching nginx files:', error);
        }
    }

    // Render open files as markers docked on the KERNEL I/O LAYER rail.
    // Files are placed by activity: busiest near the crest (left), decreasing
    // toward the right — mirroring the decaying whisker wave above the rail.
    renderFilesOnCurves() {
        const svg = d3.select('svg');
        if (svg.empty()) {
            console.error('❌ SVG element not found!');
            return;
        }

        // Clear previous markers/labels.
        d3.selectAll('.file-label').remove();
        d3.selectAll('.file-label-bg').remove();
        d3.selectAll('.file-endpoint').remove();
        d3.selectAll('.file-icon').remove();
        d3.selectAll('[class^="file-group-"]').remove();
        d3.selectAll('.io-file-layer').remove();

        const geom = window.__ioLayerGeometry;
        if (!geom) {
            debugLog('⚠️ I/O layer geometry not ready, skipping file markers');
            return;
        }

        const files = (this.files || []).slice(0, 18);
        if (!files.length) return;

        const layer = svg.append('g').attr('class', 'io-file-layer');
        const { surfaceY, railLeft, railRight } = geom;
        const margin = 34;
        const span = (railRight - railLeft) - margin * 2;
        const maxActivity = Math.max(...files.map(f => Number(f.activity) || 1), 1);
        const labelCount = Math.min(5, files.length);

        files.forEach((file, index) => {
            const t = files.length <= 1 ? 0 : index / (files.length - 1);
            const x = railLeft + margin + t * span;
            const fileType = file.type || 'other';
            const color = this.getFileTypeColor(fileType);
            const activity = Number(file.activity) || 1;
            const norm = activity / maxActivity;
            const r = 2.4 + norm * 4.6;

            const fileGroup = layer.append('g')
                .attr('class', `file-group-${index} io-file-marker`)
                .attr('data-file-index', index)
                .attr('data-file-type', fileType)
                .attr('data-pids', (file.pids || []).join(','))
                .style('cursor', 'pointer');

            // Short stem tying the file marker to the rail surface.
            fileGroup.append('line')
                .attr('x1', x)
                .attr('y1', surfaceY)
                .attr('x2', x)
                .attr('y2', surfaceY - (4 + norm * 10))
                .attr('stroke', color)
                .attr('stroke-width', 0.8)
                .attr('opacity', 0.55);

            // Refined sensor node (ring + core) with a radar ping on the busiest.
            this.appendFileNode(fileGroup, x, surfaceY, color, r, index < labelCount);

            // Label the top files (path tail + owning process) below the rail.
            if (index < labelCount) {
                const labelY = surfaceY + 14 + (index % 2) * 11;
                fileGroup.append('text')
                    .attr('class', 'file-label')
                    .attr('x', x)
                    .attr('y', labelY)
                    .attr('text-anchor', 'middle')
                    .style('font-family', 'Share Tech Mono, monospace')
                    .style('font-size', '7.5px')
                    .style('letter-spacing', '0.4px')
                    .style('fill', 'rgba(48, 48, 48, 0.78)')
                    .text(this.getShortFileName(file.path));

                if (file.process) {
                    fileGroup.append('text')
                        .attr('class', 'file-label')
                        .attr('x', x)
                        .attr('y', labelY + 8)
                        .attr('text-anchor', 'middle')
                        .style('font-family', 'Share Tech Mono, monospace')
                        .style('font-size', '6.5px')
                        .style('fill', color)
                        .text(`${file.process}${file.process_count > 1 ? ' ×' + file.process_count : ''}`);
                }
            }

            fileGroup
                .on('mouseover', () => this.showTooltip(file, x, surfaceY))
                .on('mouseout', () => this.hideTooltip());
        });

        // Re-apply selection state after a re-render (auto-update keeps it sticky).
        if (this.procFilesActive) {
            // Accurate process lane is drawn separately; just keep the base wave dim.
            d3.selectAll('.io-file-marker').interrupt().style('opacity', 0.1);
        } else if (this.highlightedPid !== null && this.highlightedPid !== undefined) {
            this.applyProcessHighlight();
        }
    }

    // Frontend mirror of the backend file-type classifier.
    classifyPath(path) {
        const low = String(path || '').toLowerCase();
        if (low.includes('/var/log/') || low.endsWith('.log')) return 'log';
        if (low.includes('/etc/') || /\.(conf|cfg|ini|ya?ml|json|toml)$/.test(low)) return 'config';
        if (low.endsWith('.so') || low.includes('.so.') || low.includes('/lib/') || low.includes('/lib64/')) return 'lib';
        if (low.includes('/dev/')) return 'device';
        if (/\.(db|sqlite3?)$/.test(low) || low.includes('/var/lib/')) return 'data';
        return 'other';
    }

    // A small instrument-style node: solid core + concentric ring that emits a
    // radar ping (expand + fade) instead of a plain swelling dot.
    appendFileNode(group, x, y, color, r, doPing) {
        if (doPing) {
            const ping = group.append('circle')
                .attr('cx', x).attr('cy', y).attr('r', r + 1.5)
                .attr('fill', 'none')
                .attr('stroke', color)
                .attr('stroke-width', 1)
                .attr('opacity', 0.7);
            const emit = () => {
                ping.attr('r', r + 1.5).attr('opacity', 0.7)
                    .transition().duration(1500).ease(d3.easeQuadOut)
                    .attr('r', r + 9).attr('opacity', 0)
                    .on('end', emit);
            };
            emit();
        }

        group.append('circle')
            .attr('cx', x).attr('cy', y).attr('r', r + 1.6)
            .attr('fill', 'none')
            .attr('stroke', color)
            .attr('stroke-width', 0.8)
            .attr('opacity', 0.55);

        const core = group.append('circle')
            .attr('cx', x).attr('cy', y).attr('r', r)
            .attr('class', 'file-endpoint')
            .attr('fill', color)
            .attr('stroke', 'rgba(247, 247, 240, 0.95)')
            .attr('stroke-width', 0.8)
            .attr('opacity', 0.96);

        return core;
    }

    // Highlight the open files held by a selected process; dim the rest.
    highlightProcessFiles(pid) {
        this.highlightedPid = (pid === undefined || pid === null) ? null : Number(pid);
        this.applyProcessHighlight();
    }

    clearProcessHighlight() {
        this.highlightedPid = null;
        this.procFilesActive = false;
        d3.selectAll('.io-proc-file-layer').remove();
        d3.selectAll('.io-file-marker')
            .interrupt()
            .transition().duration(200)
            .style('opacity', 1);
        d3.selectAll('.io-file-layer .file-endpoint')
            .transition().duration(200)
            .attr('stroke', 'rgba(245, 245, 238, 0.85)')
            .attr('stroke-width', 1);
        d3.selectAll('.io-file-selected-count').remove();
    }

    // Render the exact open files of a selected process as a bright lane on the
    // rail (from /api/process/<pid>/fds), dimming the system-wide base wave.
    // This is the accurate counterpart to the quick data-pids highlight.
    showProcessFiles(pid, fdsData) {
        const geom = window.__ioLayerGeometry;
        if (!geom || !fdsData) return;

        this.highlightedPid = Number(pid);
        this.procFilesActive = true;

        // Merge regular open files and file-type descriptors, de-duplicated by path.
        const files = [];
        const seen = new Set();
        (fdsData.open_files || []).forEach((f) => {
            if (f && f.path && !seen.has(f.path)) {
                seen.add(f.path);
                files.push({ path: f.path, fd: f.fd });
            }
        });
        (fdsData.descriptors || []).forEach((d) => {
            if (d && d.type === 'file' && d.target && !seen.has(d.target)) {
                seen.add(d.target);
                files.push({ path: d.target, fd: d.fd });
            }
        });

        const svg = d3.select('svg');
        // Dim the system-wide wave; the process lane takes focus.
        d3.selectAll('.io-file-marker').interrupt().transition().duration(220).style('opacity', 0.1);
        d3.selectAll('.io-proc-file-layer').remove();

        const layer = svg.append('g').attr('class', 'io-proc-file-layer');
        const { surfaceY, railLeft, railRight } = geom;
        const margin = 34;
        const span = (railRight - railLeft) - margin * 2;

        const list = files.slice(0, 22);
        const labelCount = Math.min(8, list.length);

        list.forEach((file, i) => {
            const t = list.length <= 1 ? 0.5 : i / (list.length - 1);
            const x = railLeft + margin + t * span;
            const type = this.classifyPath(file.path);
            const color = this.getFileTypeColor(type);

            const group = layer.append('g')
                .attr('class', 'io-proc-file-marker')
                .attr('data-file-type', type)
                .style('cursor', 'pointer');

            group.append('line')
                .attr('x1', x).attr('y1', surfaceY)
                .attr('x2', x).attr('y2', surfaceY - 10)
                .attr('stroke', color)
                .attr('stroke-width', 0.9)
                .attr('opacity', 0.72);

            // Refined sensor node (ring + core) with a radar ping on the labelled set.
            this.appendFileNode(group, x, surfaceY, color, 3.6, i < labelCount);

            if (i < labelCount) {
                const labelY = surfaceY + 14 + (i % 2) * 11;
                group.append('text')
                    .attr('class', 'file-label')
                    .attr('x', x).attr('y', labelY)
                    .attr('text-anchor', 'middle')
                    .style('font-family', 'Share Tech Mono, monospace')
                    .style('font-size', '7.5px')
                    .style('letter-spacing', '0.4px')
                    .style('fill', 'rgba(48, 48, 48, 0.82)')
                    .text(this.getShortFileName(file.path));

                if (file.fd !== undefined && file.fd !== null) {
                    group.append('text')
                        .attr('class', 'file-label')
                        .attr('x', x).attr('y', labelY + 8)
                        .attr('text-anchor', 'middle')
                        .style('font-family', 'Share Tech Mono, monospace')
                        .style('font-size', '6.5px')
                        .style('fill', color)
                        .text(`fd ${file.fd}`);
                }
            }

            group
                .on('mouseover', () => this.showTooltip({ ...file, type, pid }, x, surfaceY))
                .on('mouseout', () => this.hideTooltip());
        });

        layer.append('text')
            .attr('class', 'io-file-selected-count')
            .attr('x', railLeft)
            .attr('y', surfaceY - 16)
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '7.5px')
            .style('letter-spacing', '0.6px')
            .style('fill', 'rgba(48, 48, 48, 0.82)')
            .text(`PID ${pid} · ${list.length} OPEN FILE${list.length === 1 ? '' : 'S'}`);
    }

    applyProcessHighlight() {
        const pid = this.highlightedPid;
        d3.selectAll('.io-file-selected-count').remove();
        if (pid === null || pid === undefined) {
            this.clearProcessHighlight();
            return;
        }
        let matches = 0;
        d3.selectAll('.io-file-marker').each(function () {
            const group = d3.select(this);
            const pidsAttr = group.attr('data-pids') || '';
            const pids = pidsAttr ? pidsAttr.split(',').map(Number) : [];
            const isOwned = pids.includes(pid);
            if (isOwned) matches += 1;
            group.interrupt().transition().duration(220)
                .style('opacity', isOwned ? 1 : 0.16);
            group.select('.file-endpoint')
                .transition().duration(220)
                .attr('stroke', isOwned ? 'rgba(247, 247, 240, 0.98)' : 'rgba(245, 245, 238, 0.85)')
                .attr('stroke-width', isOwned ? 1.8 : 1);
        });

        // Compact readout near the rail showing how many top files this process holds.
        const geom = window.__ioLayerGeometry;
        if (geom) {
            d3.select('svg').select('.io-file-layer').append('text')
                .attr('class', 'io-file-selected-count')
                .attr('x', geom.railLeft)
                .attr('y', geom.surfaceY - 16)
                .style('font-family', 'Share Tech Mono, monospace')
                .style('font-size', '7.5px')
                .style('letter-spacing', '0.6px')
                .style('fill', 'rgba(48, 48, 48, 0.78)')
                .text(`PID ${pid} · ${matches} HOT FILE${matches === 1 ? '' : 'S'}`);
        }
    }

    // Get color based on file type (monochrome scene with subtle accents).
    getFileTypeColor(type) {
        const colors = {
            'config': 'rgba(88, 142, 196, 0.92)',   // cool blue — configuration
            'log': 'rgba(206, 96, 84, 0.92)',       // warm red — logs
            'lib': 'rgba(140, 120, 188, 0.9)',      // violet — shared libraries
            'data': 'rgba(96, 170, 132, 0.9)',      // green — databases/state
            'device': 'rgba(196, 158, 70, 0.9)',    // amber — device nodes
            'other': 'rgba(120, 120, 120, 0.9)'      // gray — regular files
        };
        return colors[type] || colors['other'];
    }
    
    // Highlight associated Bezier curve
    highlightCurve(curveIndex) {
        if (curveIndex !== undefined) {
            const curves = d3.selectAll('.bezier-curve').nodes();
            if (curves[curveIndex]) {
                d3.select(curves[curveIndex])
                    .transition()
                    .duration(200)
                    .attr("stroke", "#4A90E2")
                    .attr("stroke-width", 2)
                    .attr("opacity", 0.8);
            }
        }
    }
    
    // Unhighlight Bezier curve
    unhighlightCurve(curveIndex) {
        if (curveIndex !== undefined) {
            const curves = d3.selectAll('.bezier-curve').nodes();
            if (curves[curveIndex]) {
                d3.select(curves[curveIndex])
                    .transition()
                    .duration(200)
                    .attr("stroke", "rgba(60, 60, 60, 0.3)")
                    .attr("stroke-width", 0.8)
                    .attr("opacity", 0.3);
            }
        }
    }

    // Calculate positions for file labels - attach to end points of Bezier curves
    calculateLabelPositionsOnCurves(numFiles, bezierCurves, height) {
        const positions = [];
        
        if (bezierCurves.length === 0) {
            // Fallback to old method if no curves available
            return this.calculateLabelPositions(numFiles, window.innerWidth / 2, height);
        }
        
        // Select curves from the center area (where files should be attached)
        const centerCurves = [];
        const width = window.innerWidth;
        const centerX = width / 2;
        
        bezierCurves.forEach((curve, index) => {
            const path = d3.select(curve);
            const pathData = path.attr('d');
            if (pathData) {
                // Extract START point from path (first coordinates after M)
                // Path format: M startX,startY C ...
                const startMatches = pathData.match(/M([\d.]+),([\d.]+)/);
                if (startMatches) {
                    const startX = parseFloat(startMatches[1]);
                    const startY = parseFloat(startMatches[2]);
                    
                    // Use curves that start near the bottom (where files should be)
                    // Files should be at the bottom (start of curves)
                    if (startY > height - 250 && startY < height - 150) {
                        centerCurves.push({ index, startX, startY });
                    }
                }
            }
        });
        
        // Sort by X position to distribute evenly
        centerCurves.sort((a, b) => a.endX - b.endX);
        
        // Select curves evenly distributed
        const selectedCurves = [];
        if (centerCurves.length > 0) {
            const step = Math.max(1, Math.floor(centerCurves.length / numFiles));
            for (let i = 0; i < numFiles && i * step < centerCurves.length; i++) {
                selectedCurves.push(centerCurves[i * step]);
            }
        }
        
        // Create positions from selected curves - use START points (bottom of curves)
        selectedCurves.forEach((curve, i) => {
            positions.push({
                x: curve.startX,
                y: curve.startY,
                curveIndex: curve.index
            });
        });
        
        // Fill remaining positions if needed (at bottom of screen)
        while (positions.length < numFiles) {
            const baseY = height - 200; // Bottom where curves start
            const spacing = 120;
            const offset = (positions.length - (numFiles - 1) / 2) * spacing;
            positions.push({
                x: centerX + offset,
                y: baseY + (positions.length % 2) * 15,
                curveIndex: undefined
            });
        }
        
        return positions.slice(0, numFiles);
    }
    
    // Fallback method for calculating positions
    calculateLabelPositions(numFiles, centerX, height) {
        const positions = [];
        const baseY = height - 140; // Above the curves
        const spacing = 120; // Space between labels
        
        for (let i = 0; i < numFiles; i++) {
            const offset = (i - (numFiles - 1) / 2) * spacing;
            positions.push({
                x: centerX + offset,
                y: baseY + (i % 2) * 15 // Slight vertical offset for better readability
            });
        }
        
        return positions;
    }

    // Get short file name for display
    getShortFileName(fullPath) {
        const parts = fullPath.split('/');
        if (parts.length <= 2) {
            return fullPath;
        }
        
        // Show last two parts of path
        const lastTwo = parts.slice(-2);
        return lastTwo.join('/');
    }

    // Show tooltip with file information (styled to match the process hover).
    showTooltip(file, x, y) {
        d3.selectAll('.tooltip').remove();

        const tooltip = d3.select("body")
            .append("div")
            .attr("class", "tooltip")
            .style("position", "absolute")
            .style("background", "rgba(0, 0, 0, 0.9)")
            .style("color", "white")
            .style("padding", "10px")
            .style("border-radius", "4px")
            .style("font-size", "12px")
            .style("font-family", "Share Tech Mono, monospace")
            .style("pointer-events", "none")
            .style("z-index", "1000")
            .style("max-width", "320px")
            .style("opacity", 0);

        const fileType = file.type || this.classifyPath(file.path);
        const typeLabel = fileType.charAt(0).toUpperCase() + fileType.slice(1);

        let html = `
            <strong>File:</strong> ${this.getShortFileName(file.path)}<br>
            <strong>Type:</strong> ${typeLabel}<br>
            <strong>Path:</strong> ${file.path}<br>
        `;
        if (file.process) {
            html += `<strong>Process:</strong> ${file.process}${file.process_count > 1 ? ' \u00d7' + file.process_count : ''}<br>`;
        }
        if (file.pid !== undefined && file.pid !== null) {
            html += `<strong>PID:</strong> ${file.pid}<br>`;
        }
        if (file.fd !== undefined && file.fd !== null) {
            html += `<strong>FD:</strong> ${file.fd}<br>`;
        }
        if (file.activity !== undefined && file.activity !== null) {
            html += `<strong>Open handles:</strong> ${file.activity}<br>`;
        }
        tooltip.html(html);

        tooltip.transition().duration(200).style("opacity", 1);

        const tooltipRect = tooltip.node().getBoundingClientRect();
        const left = Math.min(x + 14, window.innerWidth - tooltipRect.width - 10);
        const top = Math.max(y - tooltipRect.height - 12, 10);
        tooltip.style("left", left + "px").style("top", top + "px");
    }

    // Hide tooltip
    hideTooltip() {
        d3.selectAll(".tooltip").remove();
    }

    // Start auto update
    startAutoUpdate(intervalMs = 10000) {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        this.updateInterval = setInterval(() => {
            this.updateFiles();
        }, intervalMs);
    }

    // Stop auto update
    stopAutoUpdate() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    // Cleanup
    destroy() {
        this.stopAutoUpdate();
        d3.selectAll('.file-label').remove();
        d3.selectAll('.file-label-bg').remove();
        d3.selectAll('.file-endpoint').remove();
        d3.selectAll('.file-icon').remove();
        d3.selectAll('[class^="file-group-"]').remove();
        d3.selectAll('.tooltip').remove();
    }
}

// Make it globally available for browser
if (typeof window !== 'undefined') {
    window.NginxFilesManager = NginxFilesManager;
}
