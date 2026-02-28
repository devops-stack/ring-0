debugLog('RightSemicircleMenuManager script loaded');

class RightSemicircleMenuManager {
    constructor() {
        debugLog('RightSemicircleMenuManager constructor called');
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
        this.isClickingOverlay = false; // Track if we're in the process of clicking overlay views
    }

    getRenderedSelectors() {
        return '.right-semicircle-menu, .right-menu-night-sector, .right-menu-edge-shell, .right-menu-edge-shell-cutout, .right-menu-edge-shell-stroke, .right-menu-fg-ring, .right-menu-fg-top-half, .right-menu-fg-midline, .right-menu-clip-def, .right-menu-item-group, .right-menu-item, .right-menu-icon, .right-menu-line, .right-menu-label, .right-menu-label-bg';
    }

    clearRendered(svg) {
        svg.selectAll(this.getRenderedSelectors()).remove();
    }

    isOverlayItem(itemId) {
        return itemId === 'kernel' || itemId === 'network' || itemId === 'devices' || itemId === 'files';
    }

    activateOverlayView(itemId) {
        if (!window.kernelContextMenu) return;
        if (itemId === 'kernel') {
            window.kernelContextMenu.activateDNAView();
        } else if (itemId === 'network') {
            window.kernelContextMenu.activateNetworkView();
        } else if (itemId === 'devices') {
            window.kernelContextMenu.activateDevicesView();
        } else if (itemId === 'files') {
            window.kernelContextMenu.activateFilesView();
        }
    }

    renderRightSemicircleMenu() {
        debugLog('renderRightSemicircleMenu called');
        const svg = d3.select('svg');
        const width = window.innerWidth;
        const height = window.innerHeight;

        // Clear existing semicircle elements (but preserve kernel submenu)
        this.clearRendered(svg);

        // Semicircle parameters
        const menuRadius = height * 0.4;
        const menuX = width + 40;
        const menuY = height / 2;
        const hudStrokeHair = 0.6;
        const hudStrokeNormal = 0.95;
        const hudStrokeAccent = 1.6;

        // Create the large semicircle path
        const semicirclePath = this.createSemicirclePath(menuX, menuY, menuRadius, 'right');

        // Night-contrast sector backdrop.
        svg.append('path')
            .attr('class', 'right-menu-night-sector')
            .attr('d', semicirclePath)
            .style('fill', 'rgba(16, 20, 26, 0.22)')
            .style('stroke', 'none')
            .style('pointer-events', 'none');

        svg.append('path')
            .attr('class', 'right-semicircle-menu')
            .attr('d', semicirclePath)
            .style('fill', 'rgba(222, 222, 222, 0.11)')
            .style('stroke', 'rgba(150, 150, 150, 0.36)')
            .style('stroke-width', `${hudStrokeNormal}px`)
            .style('pointer-events', 'none');

        // Keep only the smallest-radius overlay ring.
        // Draw it before menu items so items stay visually above the circle layer.
        svg.append('circle')
            .attr('class', 'right-menu-fg-ring')
            .attr('cx', menuX)
            .attr('cy', menuY)
            .attr('r', menuRadius * 0.72)
            .style('fill', 'rgba(172, 172, 172, 0.18)')
            .style('stroke', 'rgba(122, 122, 122, 0.32)')
            .style('stroke-width', `${hudStrokeNormal}px`)
            .style('pointer-events', 'none');

        // Reference-like split: top half is darker + central horizontal line.
        const ringRadius = menuRadius * 0.72;
        const clipId = 'right-menu-top-half-clip';
        const defs = svg.append('defs')
            .attr('class', 'right-menu-clip-def');
        defs.append('clipPath')
            .attr('id', clipId)
            .append('rect')
            .attr('x', menuX - ringRadius)
            .attr('y', menuY - ringRadius)
            .attr('width', ringRadius * 2)
            .attr('height', ringRadius);

        svg.append('circle')
            .attr('class', 'right-menu-fg-top-half')
            .attr('cx', menuX)
            .attr('cy', menuY)
            .attr('r', ringRadius)
            .attr('clip-path', `url(#${clipId})`)
            .style('fill', 'rgba(138, 138, 138, 0.26)')
            .style('stroke', 'none')
            .style('pointer-events', 'none');

        svg.append('line')
            .attr('class', 'right-menu-fg-midline')
            .attr('x1', menuX - ringRadius)
            .attr('y1', menuY)
            .attr('x2', menuX + ringRadius)
            .attr('y2', menuY)
            .style('stroke', 'rgba(120, 120, 120, 0.42)')
            .style('stroke-width', `${hudStrokeHair}px`)
            .style('pointer-events', 'none');

        // Compact edge shell inside the menu circle (reference-like notch geometry).
        // Reuse ring radius below.
        // Push to/over viewport edge so diagonal lines visually touch screen border.
        const shellEdgeX = width + 2;
        const shellHalfHeight = ringRadius * 0.34;
        const shellWidth = ringRadius * 0.095; // 2x narrower than current shell body
        const shellTopY = menuY - shellHalfHeight - 7.5; // right side +15px total
        const shellBottomY = menuY + shellHalfHeight + 7.5; // right side +15px total
        const shellInnerTopX = shellEdgeX - shellWidth;
        const shellInnerTopY = menuY - shellHalfHeight * 0.45 - 32.5; // left side +65px total
        const shellInnerBottomX = shellEdgeX - shellWidth;
        const shellInnerBottomY = menuY + shellHalfHeight * 0.45 + 32.5; // left side +65px total
        const shellCutoutPath = `M ${shellEdgeX} ${shellTopY}
                                 L ${shellEdgeX} ${shellBottomY}
                                 L ${shellInnerBottomX} ${shellInnerBottomY}
                                 L ${shellInnerTopX} ${shellInnerTopY}
                                 Z`;
        // No right vertical side: left side + two slanted edges touching screen edge.
        const shellPath = `M ${shellInnerTopX} ${shellInnerTopY}
                           L ${shellEdgeX} ${shellTopY}
                           M ${shellInnerBottomX} ${shellInnerBottomY}
                           L ${shellEdgeX} ${shellBottomY}
                           M ${shellInnerTopX} ${shellInnerTopY}
                           L ${shellInnerBottomX} ${shellInnerBottomY}`;

        // Neutralize ring background under the shell so the figure has no inner fill tint.
        svg.append('path')
            .attr('class', 'right-menu-edge-shell-cutout')
            .attr('d', shellCutoutPath)
            .style('fill', '#e6e6e6')
            .style('stroke', 'none')
            .style('pointer-events', 'none');

        svg.append('path')
            .attr('class', 'right-menu-edge-shell-stroke')
            .attr('d', shellPath)
            .style('fill', 'none')
            .style('stroke', 'rgba(138, 138, 138, 0.28)')
            .style('stroke-width', `${hudStrokeNormal}px`)
            .style('stroke-linecap', 'round')
            .style('pointer-events', 'none');

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
            const isOverlay = this.isOverlayItem(item.id);
            
            // Wide horizontal line (rectangle) extending left from the circle
            // Draw the line FIRST so it appears behind the circle
            // Text will be inside this wide line, like in the example
            const labelText = item.label;
            const linePadding = 12; // Padding inside the line for text
            const lineHeight = 26; // Height of the wide line (should be visible and prominent)
            // Make the line longer than the text (extend it further left)
            const lineExtension = 40; // Extra width to make line longer than text
            // Line starts directly from the circle edge (no gap) - shift right to attach tightly
            // Add small overlap to ensure no visual gap
            const overlap = 2; // Small overlap to ensure tight connection
            const filesLabel = this.menuItems.find(menuItem => menuItem.id === 'files')?.label || 'Files';
            const filesEstimatedTextWidth = filesLabel.length * 7;
            const lineWidth = filesEstimatedTextWidth + linePadding * 2 + lineExtension;
            const leftSideTrimPx = 10; // Shorten menu bars from the left edge only
            const barLengthBoostPx = 10; // Extend bars by 10px
            const adjustedLineWidth = Math.max(0, lineWidth - leftSideTrimPx + barLengthBoostPx);
            const lineStartX = itemX - itemRadius + overlap; // Start slightly inside circle edge for tight fit
            const lineEndX = lineStartX - adjustedLineWidth;
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
            const hoverAreaWidth = adjustedLineWidth + itemRadius * 2 + hoverAreaPadding * 2;
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
                if (this.isClickingOverlay) {
                    return;
                }
                this.hoveredItemId = item.id;
                this.renderRightSemicircleMenu();
                
                // Show Matrix View submenu ONLY if hovering over Processes item
                if (item.id === 'processes' && window.kernelContextMenu) {
                    debugLog('🎯 Showing Processes submenu (Matrix View), lineEndX:', lineEndX, 'itemY:', itemY, 'angle:', angle);
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
                
                // Reset hover immediately to avoid perceived "stuck active" delay.
                if (this.hoveredItemId === item.id) {
                    // Keep hover only while pointer is over Processes submenu.
                    if (item.id === 'processes' && window.kernelContextMenu) {
                        const submenu = d3.select('.kernel-submenu').node();
                        if (submenu) {
                            const submenuRect = submenu.getBoundingClientRect();
                            const mouseX = event.clientX || 0;
                            const mouseY = event.clientY || 0;
                            if (mouseX >= submenuRect.left && mouseX <= submenuRect.right &&
                                mouseY >= submenuRect.top && mouseY <= submenuRect.bottom) {
                                return;
                            }
                        }
                    }

                    this.hoveredItemId = null;
                    this.renderRightSemicircleMenu();

                    if (item.id === 'processes' && window.kernelContextMenu) {
                        window.kernelContextMenu.hideSubmenu();
                    }
                }
            };
            
            // Функция для обработки клика
            const handleClick = (event) => {
                debugLog('🖱️ Click detected on item:', item.id, item.label);
                event.stopPropagation(); // Prevent event bubbling
                if (isOverlay) {
                    this.activateOverlayView(item.id);
                } else {
                    debugLog('⚠️ Click on kernel item but conditions not met:', {
                        itemId: item.id,
                        hasContextMenu: !!window.kernelContextMenu
                    });
                }
            };
            
            // Also handle mousedown for overlay items (since click might be interrupted)
            const handleMouseDown = (event) => {
                if (isOverlay) {
                    debugLog('🖱️ Mouse down on overlay item:', item.id);
                    event.preventDefault();
                    event.stopPropagation();
                    // Prevent re-rendering during click
                    this.isClickingOverlay = true;
                    this.activateOverlayView(item.id);
                    // Reset click lock quickly to avoid delayed hover cleanup.
                    setTimeout(() => {
                        this.isClickingOverlay = false;
                        if (this.hoveredItemId !== null) {
                            this.hoveredItemId = null;
                            this.renderRightSemicircleMenu();
                            if (window.kernelContextMenu) {
                                window.kernelContextMenu.hideSubmenu();
                            }
                        }
                    }, 16);
                }
            };
            
            // Добавляем обработчики на hover-прямоугольник
            hoverRect
                .on('mouseenter', handleMouseEnter)
                .on('mouseleave', handleMouseLeave)
                .on('click', (e) => {
                    debugLog('🖱️ Click on hoverRect:', item.id);
                    e.stopPropagation();
                    handleClick(e);
                })
                .on('mousedown', (e) => {
                    debugLog('🖱️ Mouse down on hoverRect:', item.id);
                    e.stopPropagation();
                    if (isOverlay) {
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
                .style('fill', isHovered ? '#ffffff' : '#2f3238') // White if hovered, darker HUD fill when idle
                .style('stroke', isHovered ? '#000000' : '#5f646d') // Keep black outline when bar becomes white
                .style('stroke-width', isHovered ? `${hudStrokeAccent}px` : `${hudStrokeNormal}px`)
                .style('filter', isHovered ? 'drop-shadow(0 0 5px rgba(200,210,225,0.4))' : 'none')
                .style('transition', 'all 0.3s ease')
                .style('pointer-events', 'none')
                .style('cursor', 'pointer')
                .on('mouseenter', null)
                .on('mouseleave', null);

            // Subtle HUD separators (hairline top highlight + bottom shade).
            itemGroup.append('line')
                .attr('x1', lineEndX + borderRadius + 2)
                .attr('y1', lineY + 1.3)
                .attr('x2', lineStartX - 2)
                .attr('y2', lineY + 1.3)
                .style('stroke', isHovered ? 'rgba(0,0,0,0.36)' : 'rgba(206, 212, 220, 0.22)')
                .style('stroke-width', `${hudStrokeHair}px`)
                .style('pointer-events', 'none');

            itemGroup.append('line')
                .attr('x1', lineEndX + borderRadius + 2)
                .attr('y1', lineY + lineHeight - 1.2)
                .attr('x2', lineStartX - 2)
                .attr('y2', lineY + lineHeight - 1.2)
                .style('stroke', isHovered ? 'rgba(0,0,0,0.32)' : 'rgba(12, 14, 18, 0.35)')
                .style('stroke-width', `${hudStrokeHair}px`)
                .style('pointer-events', 'none');

            // Label text centered in the visual body of the bar (excluding left rounded cap)
            const textX = (lineStartX + (lineEndX + borderRadius)) / 2;
            
            itemGroup.append('text')
                .attr('class', 'right-menu-label')
                .attr('data-item-id', item.id)
                .attr('x', textX)
                .attr('y', itemY)
                .attr('text-anchor', 'middle')
                .attr('dominant-baseline', 'central')
                .style('font-size', '12px')
                .style('fill', isHovered ? '#000000' : '#d6dce5') // Black text on white bg if hovered, muted white if not
                .style('font-family', 'Share Tech Mono', 'monospace')
                .style('font-weight', isHovered ? 'bold' : 'normal')
                .style('letter-spacing', isHovered ? '0.35px' : '0.2px')
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
                .style('stroke', isHovered ? '#000000' : '#5f646d')
                .style('stroke-width', isHovered ? `${hudStrokeAccent}px` : `${hudStrokeNormal}px`)
                .style('filter', isHovered ? 'drop-shadow(0 0 6px rgba(205, 214, 228, 0.45))' : 'none')
                .style('cursor', 'pointer')
                .style('pointer-events', 'none')
                .style('transition', 'all 0.3s ease');

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
        debugLog('Right semicircle menu rendered');
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
        debugLog(`Right menu clicked: ${itemId}`);
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
        this.clearRendered(svg);
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

debugLog('RightSemicircleMenuManager class defined:', typeof RightSemicircleMenuManager);
