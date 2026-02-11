console.log('RightSemicircleMenuManager script loaded');

class RightSemicircleMenuManager {
    constructor() {
        console.log('RightSemicircleMenuManager constructor called');
        this.menuItems = [
            { id: 'scheduler', icon: '/static/images/scheduler.svg', label: 'Scheduler' },
            { id: 'processes', icon: '/static/images/process-manager.svg', label: 'Processes' },
            { id: 'memory', icon: '/static/images/memory-manager.svg', label: 'Memory' },
            { id: 'files', icon: '/static/images/file-system.svg', label: 'Files' },
            { id: 'network', icon: '/static/images/network-stack.svg', label: 'Network' },
            { id: 'devices', icon: '/static/images/device-driver.svg', label: 'Devices' },
            { id: 'security', icon: '/static/images/security-module.svg', label: 'Security' },
            { id: 'kernel', icon: '/static/images/linux-kernel.svg', label: 'Kernel DNA' }
        ];
        this.isVisible = false;
        this.hoveredItemId = null; // Track hovered item (for hover-based selection)
        this.clickHandlerAttached = false; // Track if click handler is already attached
        this.isClickingKernel = false; // Track if we're in the process of clicking kernel
    }

    renderRightSemicircleMenu() {
        console.log('renderRightSemicircleMenu called');
        const svg = d3.select('svg');
        const width = window.innerWidth;
        const height = window.innerHeight;

        // Clear existing semicircle elements (but preserve kernel submenu)
        svg.selectAll('.right-semicircle-menu, .right-menu-item-group, .right-menu-item, .right-menu-icon, .right-menu-line, .right-menu-label, .right-menu-label-bg').remove();

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

            const isHovered = this.hoveredItemId === item.id;
            
            // Wide horizontal line (rectangle) extending left from the circle
            // Draw the line FIRST so it appears behind the circle
            // Text will be inside this wide line, like in the example
            const labelText = item.label;
            const estimatedTextWidth = labelText.length * 7;
            const linePadding = 12; // Padding inside the line for text
            const lineHeight = 26; // Height of the wide line (should be visible and prominent)
            // Make the line longer than the text (extend it further left)
            const lineExtension = 40; // Extra width to make line longer than text
            // Line starts directly from the circle edge (no gap) - shift right to attach tightly
            // Add small overlap to ensure no visual gap
            const overlap = 2; // Small overlap to ensure tight connection
            const lineWidth = estimatedTextWidth + linePadding * 2 + lineExtension;
            const lineStartX = itemX - itemRadius + overlap; // Start slightly inside circle edge for tight fit
            const lineEndX = lineStartX - lineWidth;
            const lineY = itemY - lineHeight / 2;
            const borderRadius = 15; // Radius for rounded left corners (increased for more rounded appearance like in example)
            
            // Create a group for the entire menu item to handle hover events
            const itemGroup = svg.append('g')
                .attr('class', 'right-menu-item-group')
                .attr('data-item-id', item.id);
            
            // Calculate bounds for hover area (circle + line) - расширенная область
            const hoverAreaPadding = 10; // Дополнительный отступ для лучшей чувствительности
            const hoverAreaX = lineEndX - hoverAreaPadding;
            const hoverAreaY = itemY - Math.max(itemRadius, lineHeight / 2) - hoverAreaPadding;
            const hoverAreaWidth = lineWidth + itemRadius * 2 + hoverAreaPadding * 2;
            const hoverAreaHeight = Math.max(itemRadius * 2, lineHeight) + hoverAreaPadding * 2;
            
            // Add invisible rectangle to cover entire menu item area for proper hover detection
            const hoverRect = itemGroup.append('rect')
                .attr('x', hoverAreaX)
                .attr('y', hoverAreaY)
                .attr('width', hoverAreaWidth)
                .attr('height', hoverAreaHeight)
                .style('fill', 'transparent')
                .style('pointer-events', 'all')
                .style('cursor', 'pointer');
            
            // Функция для обработки mouseenter
            const handleMouseEnter = () => {
                // Don't re-render if clicking on kernel (to prevent interrupting click event)
                if (this.isClickingKernel) {
                    return;
                }
                this.hoveredItemId = item.id;
                this.renderRightSemicircleMenu();
                
                // Show Matrix View submenu ONLY if hovering over Processes item
                if (item.id === 'processes' && window.kernelContextMenu) {
                    console.log('🎯 Showing Processes submenu (Matrix View), lineEndX:', lineEndX, 'itemY:', itemY, 'angle:', angle);
                    window.kernelContextMenu.showSubmenu(lineEndX, itemY, angle);
                } else {
                    // Hide submenu if hovering over any other menu item
                    if (window.kernelContextMenu) {
                        window.kernelContextMenu.hideSubmenu();
                    }
                }
            };
            
            // Функция для обработки mouseleave
            const handleMouseLeave = (event) => {
                // Проверяем, не перешли ли мы на другой элемент меню или подменю
                const relatedTarget = event.relatedTarget;
                
                // Если ушли на подменю Processes, не сбрасываем hover
                if (item.id === 'processes' && window.kernelContextMenu) {
                    const submenu = d3.select('.kernel-submenu').node();
                    if (submenu && (submenu.contains(relatedTarget) || submenu === relatedTarget)) {
                        return; // Не сбрасываем, если перешли на подменю
                    }
                }
                
                // Проверяем, не перешли ли на другой элемент этого же меню
                if (relatedTarget) {
                    const parentGroup = relatedTarget.closest ? relatedTarget.closest('.right-menu-item-group') : null;
                    if (parentGroup && parentGroup === itemGroup.node()) {
                        return; // Не сбрасываем, если все еще в пределах этого элемента меню
                    }
                }
                
                // Сбрасываем hover с небольшой задержкой для плавности
                setTimeout(() => {
                    // Дополнительная проверка: убеждаемся, что курсор действительно ушел
                    if (this.hoveredItemId === item.id) {
                        // Проверяем, не над ли подменю Processes
                        if (item.id === 'processes' && window.kernelContextMenu) {
                            const submenu = d3.select('.kernel-submenu').node();
                            if (submenu) {
                                const submenuRect = submenu.getBoundingClientRect();
                                const mouseX = event.clientX || 0;
                                const mouseY = event.clientY || 0;
                                if (mouseX >= submenuRect.left && mouseX <= submenuRect.right &&
                                    mouseY >= submenuRect.top && mouseY <= submenuRect.bottom) {
                                    return; // Курсор над подменю, не сбрасываем
                                }
                            }
                        }
                        
                        this.hoveredItemId = null;
                        this.renderRightSemicircleMenu();
                        
                        if (item.id === 'processes' && window.kernelContextMenu) {
                            window.kernelContextMenu.hideSubmenu();
                        }
                    }
                }, 100);
            };
            
            // Функция для обработки клика
            const handleClick = (event) => {
                console.log('🖱️ Click detected on item:', item.id, item.label);
                event.stopPropagation(); // Prevent event bubbling
                if (item.id === 'kernel' && window.kernelContextMenu) {
                    // Activate Kernel DNA view using existing method
                    console.log('🧬 Activating Kernel DNA view from menu');
                    // Use setTimeout to ensure this happens after any re-rendering
                    setTimeout(() => {
                        window.kernelContextMenu.activateDNAView();
                    }, 10);
                } else {
                    console.log('⚠️ Click on kernel item but conditions not met:', {
                        itemId: item.id,
                        hasContextMenu: !!window.kernelContextMenu
                    });
                }
            };
            
            // Also handle mousedown for kernel item (since click might be interrupted)
            const handleMouseDown = (event) => {
                if (item.id === 'kernel') {
                    console.log('🖱️ Mouse down on kernel item - activating DNA view');
                    event.stopPropagation();
                    // Prevent re-rendering during click
                    this.isClickingKernel = true;
                    // Use setTimeout to ensure this happens after any re-rendering
                    setTimeout(() => {
                        if (window.kernelContextMenu) {
                            console.log('🧬 Activating Kernel DNA view from mousedown');
                            window.kernelContextMenu.activateDNAView();
                        }
                        // Reset flag after a delay
                        setTimeout(() => {
                            this.isClickingKernel = false;
                        }, 100);
                    }, 50);
                }
            };
            
            // Добавляем обработчики на hover-прямоугольник
            hoverRect
                .on('mouseenter', handleMouseEnter)
                .on('mouseleave', handleMouseLeave)
                .on('click', (e) => {
                    console.log('🖱️ Click on hoverRect:', item.id);
                    e.stopPropagation();
                    handleClick(e);
                })
                .on('mousedown', (e) => {
                    console.log('🖱️ Mouse down on hoverRect:', item.id);
                    e.stopPropagation();
                    if (item.id === 'kernel') {
                        handleMouseDown(e);
                    }
                });
            
            // Также добавляем обработчики на всю группу элементов для полного покрытия
            itemGroup
                .style('pointer-events', 'all')
                .on('mouseenter', handleMouseEnter)
                .on('mouseleave', handleMouseLeave)
                .on('click', (e) => {
                    console.log('🖱️ Click on itemGroup:', item.id);
                    e.stopPropagation();
                    handleClick(e);
                })
                .on('mousedown', (e) => {
                    console.log('🖱️ Mouse down on itemGroup:', item.id);
                    e.stopPropagation();
                    if (item.id === 'kernel') {
                        handleMouseDown(e);
                    }
                });
            
            // Wide line as a rectangle with rounded left side (like in the example)
            // Since menu is on the right, we round the left side (opposite of example where menu is on left)
            const wideLine = itemGroup.append('path')
                .attr('class', 'right-menu-line')
                .attr('data-item-id', item.id)
                .attr('d', `M ${lineStartX} ${lineY} 
                           L ${lineEndX + borderRadius} ${lineY} 
                           Q ${lineEndX} ${lineY} ${lineEndX} ${lineY + borderRadius}
                           L ${lineEndX} ${lineY + lineHeight - borderRadius}
                           Q ${lineEndX} ${lineY + lineHeight} ${lineEndX + borderRadius} ${lineY + lineHeight}
                           L ${lineStartX} ${lineY + lineHeight}
                           Z`)
                .style('fill', isHovered ? '#ffffff' : '#333') // White if hovered, same color as circle if not
                .style('stroke', isHovered ? '#ffffff' : '#555') // White if hovered, same as circle stroke if not
                .style('stroke-width', isHovered ? '2px' : '1px')
                .style('transition', 'all 0.3s ease')
                .style('pointer-events', 'all') // Allow hover on line too
                .style('cursor', 'pointer')
                .on('mouseenter', handleMouseEnter)
                .on('mouseleave', handleMouseLeave)
                .on('click', (e) => {
                    console.log('🖱️ Click on wideLine:', item.id);
                    e.stopPropagation();
                    handleClick(e);
                })
                .on('mousedown', (e) => {
                    console.log('🖱️ Mouse down on wideLine:', item.id);
                    e.stopPropagation();
                    if (item.id === 'kernel') {
                        handleMouseDown(e);
                    }
                });

            // Label text inside the wide line (positioned closer to the circle, like in the example)
            // Text should be closer to the right side (circle side) of the line, not centered
            const textOffsetFromRight = 15; // Distance from the right edge of the line
            const textX = lineStartX - textOffsetFromRight;
            
            itemGroup.append('text')
                .attr('class', 'right-menu-label')
                .attr('data-item-id', item.id)
                .attr('x', textX) // Positioned closer to the circle (right side)
                .attr('y', itemY)
                .attr('text-anchor', 'end') // Right-aligned text
                .attr('dominant-baseline', 'central')
                .style('font-size', '12px')
                .style('fill', isHovered ? '#000000' : '#ffffff') // Black text on white bg if hovered, white if not
                .style('font-family', 'Share Tech Mono', 'monospace')
                .style('font-weight', isHovered ? 'bold' : 'normal')
                .style('transition', 'all 0.3s ease')
                .style('pointer-events', 'none')
                .text(item.label);

            // Circle for menu item - with hover state
            // Draw circle AFTER the line so it appears on top (higher z-index in SVG)
            const circle = itemGroup.append('circle')
                .attr('class', 'right-menu-item')
                .attr('data-item-id', item.id) // Store item ID for easy selection
                .attr('cx', itemX)
                .attr('cy', itemY)
                .attr('r', itemRadius)
                .style('fill', isHovered ? '#ffffff' : '#333') // White if hovered
                .style('stroke', isHovered ? '#ffffff' : '#555')
                .style('stroke-width', isHovered ? '2px' : '1px')
                .style('cursor', 'pointer')
                .style('pointer-events', 'all') // Allow hover on circle
                .style('transition', 'all 0.3s ease')
                .on('mouseenter', handleMouseEnter)
                .on('mouseleave', handleMouseLeave)
                .on('click', (e) => {
                    console.log('🖱️ Click on circle:', item.id);
                    e.stopPropagation();
                    handleClick(e);
                })
                .on('mousedown', (e) => {
                    console.log('🖱️ Mouse down on circle:', item.id);
                    e.stopPropagation();
                    if (item.id === 'kernel') {
                        handleMouseDown(e);
                    }
                });

            // SVG icon inside the circle
            // If hovered (white circle), add dark background for icon visibility
            const iconSize = itemRadius * 1.5;
            if (isHovered) {
                // Add dark circle behind icon for contrast on white background
                itemGroup.append('circle')
                    .attr('cx', itemX)
                    .attr('cy', itemY)
                    .attr('r', itemRadius * 0.7)
                    .style('fill', '#333')
                    .style('opacity', 0.8);
            }
            
            itemGroup.append('image')
                .attr('class', 'right-menu-icon')
                .attr('data-item-id', item.id)
                .attr('x', itemX - iconSize/2)
                .attr('y', itemY - iconSize/2)
                .attr('width', iconSize)
                .attr('height', iconSize)
                .attr('href', item.icon)
                .style('opacity', isHovered ? 1 : 0.8);
        });

        this.isVisible = true;
        console.log('Right semicircle menu rendered');
        
        // Attach event delegation on SVG (only once)
        if (!this.clickHandlerAttached) {
            const svg = d3.select('svg');
            svg.on('click', (event) => {
                const target = event.target;
                const itemId = target.getAttribute('data-item-id');
                
                if (itemId) {
                    console.log('🖱️ Click detected via delegation on item:', itemId);
                    const item = this.menuItems.find(i => i.id === itemId);
                    if (item && item.id === 'kernel' && window.kernelContextMenu) {
                        console.log('🧬 Activating Kernel DNA view from menu');
                        event.stopPropagation();
                        window.kernelContextMenu.activateDNAView();
                    }
                }
            });
            this.clickHandlerAttached = true;
            console.log('✅ Click handler attached via event delegation');
        }
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
        // Click functionality can be added here if needed
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
        svg.selectAll('.right-semicircle-menu, .right-menu-item-group, .right-menu-item, .right-menu-icon, .right-menu-line, .right-menu-label, .right-menu-label-bg').remove();
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
