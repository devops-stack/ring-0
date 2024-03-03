function loadData(callback) {
  d3.csv("output.csv").then(function(data) {
    data.forEach(function(d) {
        d['%CPU'] = +d['%CPU'];
        d['%MEM'] = +d['%MEM'];
    });
    console.log(data);
    const processData = d3.rollups(data, v => v.length, d => d.COMMAND)
                          .map(([COMMAND, count]) => ({ COMMAND, count }));
    console.log(processData);
    callback(processData);
  });
}
