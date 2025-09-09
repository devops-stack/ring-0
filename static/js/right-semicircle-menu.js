/**
 * Right Semicircle Menu Manager
 * Implements a large semicircle menu on the right side of the screen
 * Based on the design example with 7-8 dark circles and horizontal lines
 */
class RightSemicircleMenuManager {
    constructor() {
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

    /**
     * Render the right semicircle menu
     */
    renderRightSemicircleMenu() {
        console.log('🎯 Rendering right semicircle menu...');
        const svg = d3.select('svg');
        const width = window.innerWidth;
        const height = window.innerHeight;
        console.log('📐 Screen dimensions:', { width, height });

        // Clear existing semicircle elements
        svg.selectAll('.right-semicircle-menu, .right-menu-item, .right-menu-icon, .right-menu-line, .right-menu-label').remove();

        // Semicircle parameters - attached to right edge with cut-off edges
        const menuRadius = height * 0.4; // Larger radius for better coverage
        const menuX = width + 40; // Position 40px to the right of screen edge
        const menuY = height / 2; // Vertically centered

        // Create the large semicircle path (right side)
        const semicirclePath = this.createSemicirclePath(menuX, menuY, menuRadius, 'right');
        console.log('🎯 Semicircle path:', semicirclePath);
        console.log('🎯 Semicircle position:', { menuX, menuY, menuRadius });
        
        svg.append('path')
            .attr('class', 'right-semicircle-menu')
            .attr('d', semicirclePath)
            .style('fill', '#ffffff') // White fill like the "Filter: Active" block
            .style('stroke', '#d0d0d0') // Light gray stroke for subtle border
            .style('stroke-width', '1px'); // Thin stroke

        // Create menu items (circles) along the semicircle with cut-off consideration
        this.menuItems.forEach((item, index) => {
            // Adjust angle range to account for cut-off edges (70% of full semicircle)
            const startAngle = Math.PI / 2 + Math.PI * 0.15; // Start 15% from top
            const endAngle = 3 * Math.PI / 2 - Math.PI * 0.15; // End 15% from bottom
            const angle = startAngle + (index * (endAngle - startAngle) / (this.menuItems.length - 1));
            
            const itemRadius = menuRadius * 0.06; // Smaller dark circles
            const itemDistance = menuRadius * 0.6; // Distance from center
            
            const itemX = menuX + Math.cos(angle) * itemDistance;
            const itemY = menuY + Math.sin(angle) * itemDistance;

            // Dark circle for menu item
            svg.append('circle')
                .attr('class', 'right-menu-item')
                .attr('cx', itemX)
                .attr('cy', itemY)
                .attr('r', itemRadius)
                .style('fill', '#333') // Dark color
                .style('stroke', '#555')
                .style('stroke-width', '1px')
                .style('cursor', 'pointer')
                .on('click', () => this.handleMenuClick(item.id))
                .on('mouseenter', function() {
                    d3.select(this).style('fill', '#444');
                })
                .on('mouseleave', function() {
                    d3.select(this).style('fill', '#333');
                });

            // SVG icon inside the circle
            const iconSize = itemRadius * 1.5; // Slightly larger than circle
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
                .style('stroke', '#333') // Dark gray like the icons
                .style('stroke-width', '1px');

            // Label at the end of the line
            svg.append('text')
                .attr('class', 'right-menu-label')
                .attr('x', lineEndX - 5)
                .attr('y', itemY)
                .attr('text-anchor', 'end')
                .attr('dominant-baseline', 'central')
                .style('font-size', '11px')
                .style('fill', '#333') // Dark gray like the icons
                .style('font-family', "'Share Tech Mono', monospace")
                .text(item.label);
        });

        this.isVisible = true;
    }

    /**
     * Create semicircle path for the right side with cut-off edges
     */
    createSemicirclePath(centerX, centerY, radius, side) {
        if (side === 'right') {
            // Calculate cut-off points (top and bottom edges)
            const cutOffTop = centerY - radius * 0.7; // Cut off top 30%
            const cutOffBottom = centerY + radius * 0.7; // Cut off bottom 30%
            
            // Calculate angles for cut-off points
            const topAngle = Math.asin((cutOffTop - centerY) / radius);
            const bottomAngle = Math.asin((cutOffBottom - centerY) / radius);
            
            // Calculate start and end points
            const startX = centerX + Math.cos(topAngle) * radius;
            const startY = cutOffTop;
            const endX = centerX + Math.cos(bottomAngle) * radius;
            const endY = cutOffBottom;
            
            // Create path with cut-off edges
            return `M ${startX} ${startY} A ${radius} ${radius} 0 0 1 ${endX} ${endY}`;
        }
        return '';
    }

    /**
     * Handle menu item click
     */
    handleMenuClick(itemId) {
        console.log(`Right menu clicked: ${itemId}`);
        // Add functionality for each menu item
        switch(itemId) {
            case 'kernel':
                // Show kernel view
                console.log('🔧 Kernel view selected');
                break;
            case 'processes':
                // Show processes view
                console.log('👤 Processes view selected');
                break;
            case 'memory':
                // Show memory view
                console.log('🧠 Memory view selected');
                break;
            case 'files':
                // Show files view
                console.log('📁 Files view selected');
                break;
            case 'network':
                // Show network view
                console.log('🌐 Network view selected');
                break;
            case 'devices':
                // Show devices view
                console.log('🔌 Devices view selected');
                break;
            case 'security':
                // Show security view
                console.log('🔒 Security view selected');
                break;
            case 'scheduler':
                // Show scheduler view
                console.log('⏰ Scheduler view selected');
                break;
        }
    }

    /**
     * Toggle menu visibility
     */
    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.renderRightSemicircleMenu();
        }
    }

    /**
     * Hide the menu
     */
    hide() {
        const svg = d3.select('svg');
        svg.selectAll('.right-semicircle-menu, .right-menu-item, .right-menu-icon, .right-menu-line, .right-menu-label').remove();
        this.isVisible = false;
    }
}
