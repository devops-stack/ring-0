function createVisualization(processData) {
    const width = 960, height = 500;
    const radius = Math.min(width, height) / 2;

    const color = d3.scaleOrdinal(d3.schemeCategory10);

    const svg = d3.select("svg")
        .attr("width", width)
        .attr("height", height)
        .append("g")
        .attr("transform", `translate(${width / 2}, ${height / 2})`);

    // Generate the pie
    const pie = d3.pie().value(d => d.count);

    // Generate the arcs
    const arc = d3.arc().innerRadius(radius * 0.4).outerRadius(radius * 0.8);

    // Append tooltip container to the body
    const tooltip = d3.select('body').append('div')
        .attr('class', 'tooltip');

    // Generate groups
    const arcs = svg.selectAll(".arc")
        .data(pie(processData))
        .enter().append("g")
        .attr("class", "arc");

    // Draw arc paths with hover effects
    arcs.append("path")
        .attr("d", arc)
        .attr("fill", (d, i) => color(i))
        .on("mouseover", function(event, d) {
            tooltip.html(`Command: ${d.data.COMMAND}<br>Count: ${d.data.count}`)
                .style("display", "block")
                .style("left", `${event.pageX}px`)
                .style("top", `${event.pageY}px`);
            d3.select(this).transition()
                .duration('50')
                .attr('opacity', '.85');
        })
        .on("mouseout", function() {
            tooltip.style("display", "none");
            d3.select(this).transition()
                .duration('50')
                .attr('opacity', '1');
        });

    // Draw "activity hairs" from the arcs and place command names at the end
    arcs.each(function(d, i) {
        const centroid = arc.centroid(d);
        const x = centroid[0];
        const y = centroid[1];
        const length = radius * 0.8; // Extended length of the "hair"
        const angle = Math.atan2(y, x); // Calculate the angle
        const lineX = x + Math.cos(angle) * length;
        const lineY = y + Math.sin(angle) * length;

        // Create lines extending outward from each slice
        svg.append("line")
            .attr("x1", x)
            .attr("y1", y)
            .attr("x2", lineX)
            .attr("y2", lineY)
            .attr("stroke", "rgba(255, 255, 255, 0.5)")
            .attr("stroke-width", 1);

        // Adjust the position for command names to ensure they don't touch the "hairs"
        // Increase the dx and dy values to move the text further from the line end
        const textPadding = 10; // Adjust padding as needed
        const textX = lineX + Math.cos(angle) * textPadding;
        const textY = lineY + Math.sin(angle) * textPadding;

        // Determine the anchor point based on the position
        const textAnchor = x > 0 ? "start" : "end";
        // Determine the alignment of text based on its quadrant
        const alignmentBaseline = y > 0 ? "hanging" : "baseline";

        // Place command names at the adjusted position
        svg.append("text")
            .attr("x", textX)
            .attr("y", textY)
            .attr("dy", alignmentBaseline)
            .style("text-anchor", textAnchor)
            .style("fill", "#fff")
            .style("font-size", "10px")
            .text(d.data.COMMAND);
    });
}

loadData(createVisualization);
