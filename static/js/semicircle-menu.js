// Semicircle Menu Manager - Right Side (as per example)
class SemicircleMenuManager {
    constructor() {
        console.log("SemicircleMenuManager: constructor called");
        this.menuItems = [
            { id: 'processes', icon: '⚙️', label: 'Processes' },
            { id: 'network', icon: '🌐', label: 'Network' },
            { id: 'files', icon: '📁', label: 'Files' },
            { id: 'system', icon: '🔧', label: 'System' },
            { id: 'logs', icon: '📊', label: 'Logs' }
        ];
        this.isVisible = false;
    }

    renderSemicircleMenu() {
        const svg = d3.select('svg');
        
        // Remove existing menu elements
        svg.selectAll('.semicircle-menu, .menu-item, .menu-bar, .menu-icon, .menu-label, .individual-menu-bar, .individual-menu-label').remove();
        
        const width = window.innerWidth;
        const height = window.innerHeight;
        
        // Semicircle menu position (LEFT side, larger radius like example)
        const menuRadius = height * 0.4; // Larger radius - 40% of screen height
        const menuX = -menuRadius * 0.3; // Shifted left (negative X)
        const menuY = height / 2; // Centered vertically
        
        console.log(`Menu dimensions: radius=${menuRadius}, x=${menuX}, y=${menuY}`);
        
        // Create semicircle background - trimmed on right edge
        const trimRight = menuRadius * 0.2; // Trim 20% from right edge
        const semicirclePath = `M ${menuX} ${menuY - menuRadius} 
                               A ${menuRadius} ${menuRadius} 0 0 1 ${menuX + menuRadius - trimRight} ${menuY + menuRadius}
                               L ${menuX + menuRadius - trimRight} ${menuY + menuRadius}
                               L ${menuX} ${menuY - menuRadius}`;
        
        svg.append('path')
            .attr('d', semicirclePath)
            .attr('class', 'semicircle-menu')
            .style('fill', 'rgba(255, 255, 255, 0.04)') // Force CSS style
            .style('stroke', '#aaa')
            .style('stroke-width', '0.5px')
            .attr('opacity', 1);
        
        // Removed horizontal bar with "Menu" text
        
        // Create 5 menu items (circles) arranged in semicircle like original
        this.menuItems.forEach((item, index) => {
            // Spread across semicircle (180 degrees, left side) - like original positioning
            const angle = Math.PI + (index * Math.PI / 4); // Start from left, go to right
            const itemRadius = menuRadius * 0.12; // Restored to previous size
            const itemDistance = menuRadius * 0.75; // 75% from center
            
            const itemX = menuX + Math.cos(angle) * itemDistance;
            const itemY = menuY + Math.sin(angle) * itemDistance;
            
            console.log(`Menu item ${index}: angle=${angle}, x=${itemX}, y=${itemY}, radius=${itemRadius}`);
            
            // Menu item circle
            svg.append('circle')
                .attr('cx', itemX)
                .attr('cy', itemY)
                .attr('r', itemRadius)
                .attr('class', 'menu-item')
                .style('fill', 'rgba(255, 255, 255, 0.04)') // Force CSS style
                .style('stroke', '#aaa')
                .style('stroke-width', '0.5px')
                .attr('cursor', 'pointer')
                .on('mouseover', function() {
                    d3.select(this)
                        .attr('fill', '#888')
                        .attr('stroke', '#aaa')
                        .attr('r', itemRadius * 1.1); // Slight scale on hover
                })
                .on('mouseout', function() {
                    d3.select(this)
                        .style('fill', 'rgba(255, 255, 255, 0.04)') // Reset to original color
                        .style('stroke', '#aaa')
                        .attr('r', itemRadius);
                })
                .on('click', () => this.handleMenuClick(item.id));
            
            // Menu item icon
            svg.append('text')
                .attr('x', itemX)
                .attr('y', itemY + itemRadius * 0.3)
                .attr('class', 'menu-icon')
                .style('fill', '#444') // Force CSS style
                .style('font-family', "'Share Tech Mono', monospace")
                .attr('text-anchor', 'middle')
                .attr('font-size', `${itemRadius * 0.8}px`)
                .text(item.icon);
            
            // Individual menu bar for each circle (pointing to the right)
            const individualBarWidth = menuRadius * 0.3; // 30% of radius
            const individualBarHeight = menuRadius * 0.08; // 8% of radius
            
            svg.append('rect')
                .attr('x', itemX + itemRadius) // Start from right edge of circle
                .attr('y', itemY - individualBarHeight/2)
                .attr('width', individualBarWidth)
                .attr('height', individualBarHeight)
                .attr('class', 'individual-menu-bar')
                .style('fill', 'rgba(255, 255, 255, 0.04)') // Force CSS style
                .style('stroke', '#aaa')
                .style('stroke-width', '0.5px')
                .attr('opacity', 1)
                .attr('rx', individualBarHeight/4);
            
            // Individual menu label for each circle
            svg.append('text')
                .attr('x', itemX + itemRadius + individualBarWidth/2)
                .attr('y', itemY + individualBarHeight * 0.3)
                .attr('class', 'individual-menu-label')
                .style('fill', '#444') // Force CSS style
                .style('font-family', "'Share Tech Mono', monospace")
                .attr('text-anchor', 'middle')
                .attr('font-size', `${individualBarHeight * 0.6}px`)
                .text(item.label);
        });
        
        // Removed "Menu" label
        
        this.isVisible = true;
        console.log("SemicircleMenuManager: left-side large menu rendered");
    }

    handleMenuClick(itemId) {
        console.log(`SemicircleMenuManager: clicked ${itemId}`);
        
        // Add visual feedback
        const svg = d3.select('svg');
        svg.selectAll('.menu-item')
            .filter(function() {
                return d3.select(this).datum() === itemId;
            })
            .transition()
            .duration(200)
            .attr('fill', '#aaa')
            .transition()
            .duration(200)
            .attr('fill', '#666');
        
        // Handle different menu actions
        switch(itemId) {
            case 'processes':
                console.log('Switching to processes view');
                break;
            case 'network':
                console.log('Switching to network view');
                break;
            case 'files':
                console.log('Switching to files view');
                break;
            case 'system':
                console.log('Switching to system view');
                break;
            case 'logs':
                console.log('Switching to logs view');
                break;
        }
    }

    toggleMenu() {
        if (this.isVisible) {
            this.hideMenu();
        } else {
            this.renderSemicircleMenu();
        }
    }

    hideMenu() {
        const svg = d3.select('svg');
        svg.selectAll('.semicircle-menu, .menu-item, .menu-bar, .menu-icon, .menu-label, .individual-menu-bar, .individual-menu-label').remove();
        this.isVisible = false;
        console.log("SemicircleMenuManager: menu hidden");
    }
}
