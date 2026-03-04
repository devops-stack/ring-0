// TCP/IP mini concepts layer (design placeholder)
(function initTcpIpUI() {
const svg = d3.select('svg');

function drawTcpIpMiniLayer(width, height) {
    d3.selectAll('.tcpip-mini-layer').remove();

    const root = svg.append('g')
        .attr('class', 'tcpip-mini-layer')
        .attr('pointer-events', 'none');

    const panelW = 300;
    const baseX = Math.max(40, width - panelW - 76);
    const baseY = Math.max(420, height - 184);
    const ringR = 24;
    const panelH = 126;

    root.append('text')
        .attr('x', baseX - 2)
        .attr('y', baseY - 14)
        .style('font-family', 'Share Tech Mono, monospace')
        .style('font-size', '9px')
        .style('letter-spacing', '0.65px')
        .style('fill', 'rgba(64, 74, 88, 0.84)')
        .text('TCP/IP PATH (CONCEPT)');

    const rxX = baseX + ringR;
    const txX = baseX + 78 + ringR;
    const ringY = baseY + 18;

    drawRing(root, rxX, ringY, ringR, 'RX', 'rgba(84, 186, 208, 0.82)');
    drawRing(root, txX, ringY, ringR, 'TX', 'rgba(214, 163, 88, 0.82)');

    root.append('line')
        .attr('x1', rxX + ringR + 6)
        .attr('y1', ringY)
        .attr('x2', txX - ringR - 6)
        .attr('y2', ringY)
        .style('stroke', 'rgba(88, 98, 112, 0.62)')
        .style('stroke-width', '1.1px');

    const pipelineX = baseX + 166;
    const pipelineY = baseY - 4;
    const stepW = 44;
    const stepH = 20;
    const stepGap = 8;
    const steps = ['NAPI', 'GRO', 'IP', 'TCP', 'SKB'];
    const stepStatuses = ['poll', 'merge', 'route', 'queue', 'ready'];
    const tone = [
        'rgba(94, 170, 186, 0.35)',
        'rgba(90, 160, 180, 0.3)',
        'rgba(122, 148, 178, 0.28)',
        'rgba(158, 142, 172, 0.3)',
        'rgba(180, 136, 160, 0.3)'
    ];

    steps.forEach((name, i) => {
        const x = pipelineX + i * (stepW + stepGap);
        const isLast = i === steps.length - 1;

        root.append('rect')
            .attr('x', x)
            .attr('y', pipelineY)
            .attr('width', stepW)
            .attr('height', stepH)
            .attr('rx', 4)
            .style('fill', tone[i % tone.length])
            .style('stroke', 'rgba(130, 138, 148, 0.42)')
            .style('stroke-width', '0.8px');

        root.append('text')
            .attr('x', x + stepW / 2)
            .attr('y', pipelineY + 13)
            .attr('text-anchor', 'middle')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '8px')
            .style('fill', 'rgba(212, 220, 230, 0.88)')
            .text(name);

        root.append('text')
            .attr('x', x + stepW / 2)
            .attr('y', pipelineY + stepH + 10)
            .attr('text-anchor', 'middle')
            .style('font-family', 'Share Tech Mono, monospace')
            .style('font-size', '6.8px')
            .style('letter-spacing', '0.3px')
            .style('fill', 'rgba(86, 98, 112, 0.82)')
            .text(stepStatuses[i] || 'state');

        if (!isLast) {
            const arrowX = x + stepW + 2;
            const midY = pipelineY + stepH / 2;
            root.append('line')
                .attr('x1', arrowX)
                .attr('y1', midY)
                .attr('x2', arrowX + stepGap - 2)
                .attr('y2', midY)
                .style('stroke', 'rgba(122, 132, 146, 0.64)')
                .style('stroke-width', '0.9px');
        }
    });

    root.append('text')
        .attr('x', pipelineX)
        .attr('y', pipelineY + 42)
        .style('font-family', 'Share Tech Mono, monospace')
        .style('font-size', '8px')
        .style('fill', 'rgba(74, 84, 96, 0.8)')
        .text('sk_buff pipeline: rx_handler -> protocol -> socket queue');
}

function drawRing(group, x, y, r, label, color) {
    group.append('circle')
        .attr('cx', x)
        .attr('cy', y)
        .attr('r', r)
        .style('fill', 'rgba(22, 24, 30, 0.46)')
        .style('stroke', 'rgba(114, 122, 136, 0.62)')
        .style('stroke-width', '1px');

    group.append('circle')
        .attr('cx', x)
        .attr('cy', y)
        .attr('r', r - 7)
        .style('fill', 'none')
        .style('stroke', color)
        .style('stroke-width', '1.5px')
        .style('stroke-dasharray', '2.6 3.2');

    group.append('text')
        .attr('x', x)
        .attr('y', y + 3)
        .attr('text-anchor', 'middle')
        .style('font-family', 'Share Tech Mono, monospace')
        .style('font-size', '10px')
        .style('fill', 'rgba(224, 231, 240, 0.9)')
        .text(label);
}

window.TcpIpUI = {
    drawTcpIpMiniLayer
};
})();
