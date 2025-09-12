console.log('RightSemicircleMenuManager script loaded');

class RightSemicircleMenuManager {
    constructor() {
        console.log('RightSemicircleMenuManager constructor called');
        this.menuItems = [
            { id: 'kernel', icon: '/static/images/linux-kernel.svg', label: 'Kernel' },
            { id: 'processes', icon: '/static/images/process-manager.svg', label: 'Processes' },
            { id: 'memory', icon: '/static/images/memory-manager.svg', label: 'Memory' },
            { id: 'files', icon: '/static/images/file-system.svg', label: 'Files' },
            { id: 'network', icon: '/static/images/network-stack.svg', label: 'Network' },
            { id: 'devices', icon: '/static/images/device-driver.svg', label: 'Devices' },
            { id: 'security', icon: '/static/images/security-module.svg', label: 'Security' },
            { id: 'scheduler', icon: '/static/images/scheduler.svg', label: 'Scheduler' }
        ];
        this.isVisible = false;
    }

    renderRightSemicircleMenu() {
        console.log('renderRightSemicircleMenu called');
        const svg = d3.select('svg');
        const width = window.innerWidth;
        const height = window.innerHeight;

        // Clear existing semicircle elements
        svg.selectAll('.right-semicircle-menu, .right-menu-item, .right-menu-icon, .right-menu-line, .right-menu-label').remove();

        // Semicircle parameters
        const menuRadius = height * 0.4;
        const menuX = width + 40;
        const menuY = height / 2;

        // Create the large semicircle path
        const semicirclePath = this.createSemicirclePath(menuX, menuY, menuRadius, 'right');
        
        svg.append('path')
            .attr('class', 'right-semicircle-menu')
            .attr('d', semicirclePath)
            .style('fill', '#ffffff')
            .style('stroke', '#d0d0d0')
            .style('stroke-width', '1px');

        // Create menu items
        this.menuItems.forEach((item, index) => {
            const startAngle = Math.PI / 2 + Math.PI * 0.15;
            const endAngle = 3 * Math.PI / 2 - Math.PI * 0.15;
            const angle = startAngle + (index * (endAngle - startAngle) / (this.menuItems.length - 1));
            
            const itemRadius = menuRadius * 0.06;
            const itemDistance = menuRadius * 0.6;
            
            const itemX = menuX + Math.cos(angle) * itemDistance;
            const itemY = menuY + Math.sin(angle) * itemDistance;

            // Dark circle for menu item
            svg.append('circle')
                .attr('class', 'right-menu-item')
                .attr('cx', itemX)
                .attr('cy', itemY)
                .attr('r', itemRadius)
                .style('fill', '#333')
                .style('stroke', '#555')
                .style('stroke-width', '1px')
                .style('cursor', 'pointer')
                .on('click', () => this.handleMenuClick(item.id))
                .on('mouseenter', function() {
                    d3.select(this).style('fill', '#444');
                    showTooltip('in development', itemX, itemY);
                })
                .on('mouseleave', function() {
                    d3.select(this).style('fill', '#333');
                    hideTooltip();
                });

            // SVG icon inside the circle
            const iconSize = itemRadius * 1.5;
            svg.append('image')
                .attr('class', 'right-menu-icon')
                .attr('x', itemX - iconSize/2)
                .attr('y', itemY - iconSize/2)
                .attr('width', iconSize)
                .attr('height', iconSize)
                .attr('href', item.icon);

            // Horizontal line extending left from the circle
            const lineLength = menuRadius * 0.2;
            const lineEndX = itemX - lineLength;
            
            svg.append('line')
                .attr('class', 'right-menu-line')
                .attr('x1', itemX - itemRadius)
                .attr('y1', itemY)
                .attr('x2', lineEndX)
                .attr('y2', itemY)
                .style('stroke', '#333')
                .style('stroke-width', '1px');

            // Label at the end of the line
            svg.append('text')
                .attr('class', 'right-menu-label')
                .attr('x', lineEndX - 5)
                .attr('y', itemY)
                .attr('text-anchor', 'end')
                .attr('dominant-baseline', 'central')
                .style('font-size', '11px')
                .style('fill', '#333')
                .style('font-family', 'Share Tech Mono', 'monospace')
                .text(item.label);
        });

        this.isVisible = true;
        console.log('Right semicircle menu rendered');
    }

    createSemicirclePath(centerX, centerY, radius, side) {
        if (side === 'right') {
            const cutOffTop = centerY - radius * 0.7;
            const cutOffBottom = centerY + radius * 0.7;
            
            const topAngle = Math.asin((cutOffTop - centerY) / radius);
            const bottomAngle = Math.asin((cutOffBottom - centerY) / radius);
            
            const startX = centerX + Math.cos(topAngle) * radius;
            const startY = cutOffTop;
            const endX = centerX + Math.cos(bottomAngle) * radius;
            const endY = cutOffBottom;
            
            return `M ${startX} ${startY} A ${radius} ${radius} 0 0 1 ${endX} ${endY}`;
        }
        return '';
    }

    handleMenuClick(itemId) {
        console.log(`Right menu clicked: ${itemId}`);
    }

    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.renderRightSemicircleMenu();
        }
    }

    hide() {
        const svg = d3.select('svg');
        svg.selectAll('.right-semicircle-menu, .right-menu-item, .right-menu-icon, .right-menu-line, .right-menu-label').remove();
        this.isVisible = false;
    }
}

function showTooltip(text, x, y) {
    d3.selectAll('.tooltip').remove();
    
    const tooltip = d3.select('body')
        .append('div')
        .attr('class', 'tooltip')
        .style('position', 'absolute')
        .style('background', 'rgba(0, 0, 0, 0.8)')
        .style('color', 'white')
        .style('padding', '6px 10px')
        .style('border-radius', '4px')
        .style('font-size', '12px')
        .style('font-family', 'Share Tech Mono', 'monospace')
        .style('pointer-events', 'none')
        .style('z-index', '1000')
        .style('opacity', 0)
        .text(text);
    
    const tooltipWidth = tooltip.node().offsetWidth;
    const tooltipHeight = tooltip.node().offsetHeight;
    const offsetX = 10;
    const offsetY = -tooltipHeight - 10;
    
    tooltip
        .style('left', (x + offsetX) + 'px')
        .style('top', (y + offsetY) + 'px')
        .transition()
        .duration(200)
        .style('opacity', 1);
}

function hideTooltip() {
    d3.selectAll('.tooltip')
        .transition()
        .duration(200)
        .style('opacity', 0)
        .remove();
}

console.log('RightSemicircleMenuManager class defined:', typeof RightSemicircleMenuManager);
