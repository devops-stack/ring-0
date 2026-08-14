// Subsystem bars rendering + syscall focus highlighting.
(function initSubsystemFocus() {
    if (window.SubsystemFocus) return;

    const state = { focusedKey: null };

    // The bars follow the syscall panel above, whose height moves with the number
    // of waiting processes.
    const COLUMN_GAP = 30, FALLBACK_TOP = 350;

    let lastPayload = null;

    function formatBytes(bytes, suffix) {
        const value = Number(bytes) || 0;
        const units = [[1073741824, 'G'], [1048576, 'M'], [1024, 'K']];
        for (const [scale, tag] of units) {
            if (value >= scale) {
                const scaled = value / scale;
                return `${scaled >= 10 ? Math.round(scaled) : scaled.toFixed(1)}${tag}${suffix}`;
            }
        }
        return `${Math.round(value)}${suffix}`;
    }

    // Each bar states its own unit, because a level (memory in use) and a rate
    // (bytes on the wire) cannot honestly share one scale.
    function readings(data) {
        if (!data || data.warming || data.value === null || data.value === undefined) {
            return { value: '—', detail: 'warming' };
        }
        const detail = data.detail === null || data.detail === undefined ? '' : data.detail;
        if (data.unit === 'bytes_per_sec') {
            return { value: formatBytes(data.value, 'B/s'), detail: `${detail} sockets` };
        }
        const value = `${Number(data.value).toFixed(data.value < 10 ? 1 : 0)}%`;
        if (data.detail_unit === 'bytes') return { value, detail: `${formatBytes(detail, '')} used` };
        if (data.detail_unit === 'bytes_per_sec') return { value, detail: `${formatBytes(detail, 'B/s')} disk` };
        if (data.detail_unit === 'runnable') return { value, detail: `${detail} runnable` };
        return { value, detail: String(detail) };
    }

    function applyFocusStyles() {
        const focusedKey = state.focusedKey;
        const hasFocus = !!focusedKey;

        d3.selectAll('.subsystem-indicator-row').each(function () {
            const row = d3.select(this);
            const key = row.attr('data-subsystem-key');
            const isActive = hasFocus && key === focusedKey;
            const isDim = hasFocus && !isActive;

            row.select('.subsystem-indicator-bg')
                .attr('fill', isActive ? 'rgba(210, 220, 230, 0.28)' : 'rgba(200, 200, 200, 0.2)')
                .attr('stroke', isActive ? '#c7d8e8' : '#aaa')
                .attr('opacity', isDim ? 0.45 : 1);

            row.select('.subsystem-indicator-fill')
                .attr('opacity', isActive ? 0.92 : (isDim ? 0.3 : 0.7))
                .attr('fill', isActive ? '#9fb3c8' : '#888');

            row.selectAll('.subsystem-indicator-label')
                .attr('fill', isActive ? '#101316' : '#222')
                .attr('opacity', isDim ? 0.52 : 1);

            row.selectAll('.subsystem-indicator-detail')
                .attr('opacity', isDim ? 0.4 : 0.72);

            row.select('.subsystem-indicator-focus')
                .attr('opacity', isActive ? 0.95 : 0);
        });
    }

    function render(subsystems) {
        if (typeof isMobileLayout === 'function' && isMobileLayout()) {
            d3.selectAll('.subsystem-indicator').remove();
            return;
        }
        if (window.kernelContextMenu && window.kernelContextMenu.currentView === 'matrix') {
            debugLog('⏸️ Skipping subsystems visualization - Matrix View is active');
            return;
        }

        lastPayload = subsystems || lastPayload;

        const svg = d3.select('svg');
        svg.selectAll('.subsystem-indicator').remove();

        // A clickable strip that survives the redraw above.
        //
        // The panel is torn down and rebuilt every refresh, and a press that
        // begins on one instance of a rectangle and ends on its replacement is
        // not a click at all — the browser fires nothing, and the drill-down
        // silently does not happen. So these rectangles are created once,
        // outside the sweep, and afterwards only moved into place. They are
        // also invisible, and the layer they sit under is click-through, so
        // nothing about the map's own behaviour changes.
        const hitArea = (key, box) => {
            let hit = svg.select(`rect.kai-hit-${key}`);
            if (hit.empty()) {
                hit = svg.append('rect')
                    .attr('class', `kai-hit kai-hit-${key}`)
                    .attr('fill', 'transparent')
                    .style('pointer-events', 'all')
                    .style('cursor', 'pointer');
            }
            return hit.attr('x', box.x).attr('y', box.y)
                .attr('width', box.width).attr('height', box.height)
                .on('mouseenter', null).on('mouseleave', null).on('click', null)
                .raise();
        };

        const subsystemNames = ['memory_management', 'process_scheduler', 'file_system', 'network_stack'];
        const subsystemLabels = {
            memory_management: 'Memory',
            process_scheduler: 'Scheduler',
            file_system: 'IO wait',
            network_stack: 'Network'
        };

        const top = Math.round(window.__leftColumnCursor || FALLBACK_TOP) + COLUMN_GAP;

        subsystemNames.forEach((name, i) => {
            const subsystem = subsystems[name];
            if (!subsystem) return;

            const usage = subsystem.usage || 0;
            const shown = readings(subsystem);
            const x = 30;
            const y = top + i * 25;
            const barWidth = 200;
            const barHeight = 15;

            const rowGroup = svg.append('g')
                .attr('class', 'subsystem-indicator subsystem-indicator-row')
                .attr('data-subsystem-key', name);

            rowGroup.append('rect')
                .attr('x', x)
                .attr('y', y)
                .attr('width', barWidth)
                .attr('height', barHeight)
                .attr('fill', 'rgba(200, 200, 200, 0.2)')
                .attr('stroke', '#aaa')
                .attr('stroke-width', 0.5)
                .attr('class', 'subsystem-indicator subsystem-indicator-bg');

            rowGroup.append('rect')
                .attr('x', x)
                .attr('y', y)
                .attr('width', (usage / 100) * barWidth)
                .attr('height', barHeight)
                .attr('fill', '#888')
                .attr('opacity', 0.7)
                .attr('class', 'subsystem-indicator subsystem-indicator-fill');

            rowGroup.append('rect')
                .attr('x', x - 1.5)
                .attr('y', y - 1.5)
                .attr('width', barWidth + 3)
                .attr('height', barHeight + 3)
                .attr('fill', 'none')
                .attr('stroke', 'rgba(173, 196, 216, 0.95)')
                .attr('stroke-width', 0.9)
                .attr('opacity', 0)
                .attr('class', 'subsystem-indicator subsystem-indicator-focus');

            rowGroup.append('text')
                .attr('x', x + 5)
                .attr('y', y + 11)
                .text(subsystemLabels[name] || name)
                .attr('class', 'feature-text subsystem-indicator subsystem-indicator-label')
                .attr('font-size', '10px')
                .attr('fill', '#222');

            // What the bar is measuring, kept quieter than the reading itself.
            // 72px clears the longest label ("Scheduler") at 10px mono.
            rowGroup.append('text')
                .attr('x', x + 72)
                .attr('y', y + 11)
                .text(shown.detail)
                .attr('class', 'feature-text subsystem-indicator subsystem-indicator-detail')
                .attr('font-size', '8px')
                .attr('opacity', 0.72)
                .attr('fill', '#222');

            rowGroup.append('text')
                .attr('x', x + barWidth - 5)
                .attr('y', y + 11)
                .text(shown.value)
                .attr('class', 'feature-text subsystem-indicator subsystem-indicator-label')
                .attr('font-size', '10px')
                .attr('text-anchor', 'end')
                .attr('fill', '#222');

            // The scheduler bar measures how busy the scheduler is; a click on
            // it asks the other half of that question — what keeps making work
            // for it. The bars are click-through by default (the map lives
            // underneath), so this one rect has to ask for its events back.
            if (name === 'process_scheduler' && window.WakeupsCard) {
                const outline = rowGroup.append('rect')
                    .attr('x', x - 1.5).attr('y', y - 1.5)
                    .attr('width', barWidth + 3).attr('height', barHeight + 3)
                    .attr('fill', 'none')
                    .attr('stroke', '#e2a33e')
                    .attr('stroke-width', 0.9)
                    .attr('opacity', 0)
                    .attr('class', 'subsystem-indicator');
                hitArea('wakeups', { x: x, y: y, width: barWidth, height: barHeight })
                    .on('mouseenter', () => outline.attr('opacity', 0.9))
                    .on('mouseleave', () => outline.attr('opacity', 0))
                    .on('click', (event) => {
                        event.stopPropagation();
                        window.WakeupsCard.open({
                            x: x + barWidth + 6,
                            y: y + barHeight / 2,
                            clearOf: x + barWidth + 40
                        });
                    });
            }
        });

        const load = (subsystems.process_scheduler || {}).load;
        if (Array.isArray(load) && load.length === 3) {
            const loadY = top + subsystemNames.length * 25 + 9;
            const quiet = 'rgba(40, 44, 50, 0.6)';
            const lit = 'rgba(20, 24, 30, 0.95)';
            const loadText = svg.append('text')
                .attr('class', 'feature-text subsystem-indicator')
                .attr('x', 30)
                .attr('y', loadY)
                .attr('font-size', '8px')
                .attr('letter-spacing', '0.5px')
                .attr('fill', quiet)
                .text(`LOAD ${load.map((v) => v.toFixed(2)).join('  ')}`);

            // The three numbers are the runqueue's length averaged over time,
            // so the queue itself is what they drill into.
            if (window.RunqueueCard) {
                const box = loadText.node().getBBox();
                const rule = svg.append('line')
                    .attr('class', 'subsystem-indicator')
                    .attr('x1', 30).attr('x2', 30 + box.width)
                    .attr('y1', loadY + 2.5).attr('y2', loadY + 2.5)
                    .attr('stroke', quiet)
                    .attr('stroke-width', 0.5)
                    .attr('opacity', 0.35);
                const hit = hitArea('load', {
                    x: 28, y: loadY - 9, width: box.width + 12, height: 14
                });
                hit.on('mouseenter', () => {
                    loadText.attr('fill', lit);
                    rule.attr('opacity', 0.85);
                }).on('mouseleave', () => {
                    loadText.attr('fill', quiet);
                    rule.attr('opacity', 0.35);
                }).on('click', (event) => {
                    event.stopPropagation();
                    window.RunqueueCard.open({ x: 30 + box.width + 8, y: loadY - 3 });
                });
            }
        }

        applyFocusStyles();
    }

    window.SubsystemFocus = {
        setFocus(key) {
            state.focusedKey = key || null;
            applyFocusStyles();
        },
        // Called when the panel above changes height, so the two stay together.
        reflow() {
            if (lastPayload) render(lastPayload);
        },
        render
    };

    // Keep existing calls in main.js unchanged.
    window.updateSubsystemsVisualization = render;
})();
