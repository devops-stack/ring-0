// Subsystem bars rendering + syscall focus highlighting.
(function initSubsystemFocus() {
    if (window.SubsystemFocus) return;

    const state = { focusedKey: null };

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

        const svg = d3.select('svg');
        svg.selectAll('.subsystem-indicator').remove();

        const subsystemNames = ['memory_management', 'process_scheduler', 'file_system', 'network_stack'];
        const subsystemLabels = {
            memory_management: 'Memory',
            process_scheduler: 'Scheduler',
            file_system: 'File System',
            network_stack: 'Network'
        };

        subsystemNames.forEach((name, i) => {
            const subsystem = subsystems[name];
            if (!subsystem) return;

            const usage = subsystem.usage || 0;
            const x = 30;
            const y = 380 + i * 25;
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

            rowGroup.append('text')
                .attr('x', x + barWidth - 5)
                .attr('y', y + 11)
                .text(`${usage}%`)
                .attr('class', 'feature-text subsystem-indicator subsystem-indicator-label')
                .attr('font-size', '10px')
                .attr('text-anchor', 'end')
                .attr('fill', '#222');
        });

        applyFocusStyles();
    }

    window.SubsystemFocus = {
        setFocus(key) {
            state.focusedKey = key || null;
            applyFocusStyles();
        },
        render
    };

    // Keep existing calls in main.js unchanged.
    window.updateSubsystemsVisualization = render;
})();
