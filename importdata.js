function loadData(callback) {
  d3.csv("output.csv")
    .then(data => processCSVData(data))
    .then(processedData => callback(processedData))
    .catch(error => console.error("Error loading and processing data:", error));
}

function processCSVData(data) {
  data.forEach(d => {
    d['%CPU'] = +d['%CPU'];
    d['%MEM'] = +d['%MEM'];
    d['VSZ'] = +d['VSZ'];
  });
  
  return d3.rollups(data, v => ({
      count: v.length,
      vsz: d3.sum(v, d => d['VSZ'])
  }), d => d.COMMAND)
  .map(([COMMAND, data]) => ({ COMMAND, count: data.count, vsz: data.vsz }));
}
