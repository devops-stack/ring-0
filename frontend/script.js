const width = window.innerWidth;
const height = window.innerHeight;

const svg = d3.select("body").append("svg")
    .attr("width", width)
    .attr("height", height);

const colorMap = {
    "kernel": "#8AB4F8",
    "process": "#34A853",
    "socket": "#9E9E9E",
    "status": "#FBBC05",
    "internet": "#9E9E9E"
};

const kernelX = width * 0.2;
const kernelY = height / 2;
const boundaryX = width * 0.7;

const socket = new WebSocket("wss://ring-0.sh/ws");

socket.onopen = () => console.log("WebSocket подключен");
socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log("Получены данные:", data);
    const graph = transformDataToGraph(data);
    updateGraph(graph);
};

function transformDataToGraph(data) {
    const nodes = [{ id: "kernel", label: "Linux Kernel", type: "kernel", x: kernelX, y: kernelY }];
    const links = [];
    const sockets = new Map();

    let processY = kernelY - (Object.keys(data.processes).length * 20) / 2;
    let socketY = kernelY - (data.network.length * 30) / 2;

    Object.entries(data.processes).forEach(([pid, proc]) => {
        nodes.push({ id: `p${pid}`, label: proc.name, type: "process", x: kernelX + 100, y: processY });
        links.push({ source: "kernel", target: `p${pid}` });
        processY += 40;
    });

    data.network.forEach((conn) => {
        if (conn.status !== "ESTABLISHED" && conn.status !== "LISTEN") return;

        const processId = `p${conn.pid}`;
        const socketId = `s${conn.local_port}`;
        const externalId = `ext_${conn.remote_ip}_${conn.remote_port}`;

        if (!sockets.has(socketId)) {
            nodes.push(
                { id: socketId, label: conn.local_port, type: "socket", x: boundaryX - 120, y: socketY },
                { id: `status_${conn.local_port}`, label: conn.status, type: "status", x: boundaryX - 80, y: socketY }
            );
            sockets.set(socketId, socketY);
            socketY += 50;
        }

        links.push({ source: processId, target: socketId });
        links.push({ source: socketId, target: `status_${conn.local_port}` });

        if (!nodes.some(n => n.id === externalId)) {
            nodes.push({ id: externalId, label: `${conn.remote_ip}:${conn.remote_port}`, type: "internet", x: boundaryX, y: sockets.get(socketId) });
        }

        links.push({ source: `status_${conn.local_port}`, target: externalId });
    });

    return { nodes, links };
}

function updateGraph(graph) {
    svg.selectAll("*").remove();

    svg.selectAll(".link")
        .data(graph.links)
        .enter().append("line")
        .attr("class", "link")
        .attr("x1", d => graph.nodes.find(n => n.id === d.source).x)
        .attr("y1", d => graph.nodes.find(n => n.id === d.source).y)
        .attr("x2", d => graph.nodes.find(n => n.id === d.target).x)
        .attr("y2", d => graph.nodes.find(n => n.id === d.target).y)
        .style("stroke", "#777")
        .style("stroke-width", 2);

    svg.selectAll(".node")
        .data(graph.nodes)
        .enter().append("rect")
        .attr("class", "node")
        .attr("x", d => d.x - (d.type === "kernel" ? 20 : 10))
        .attr("y", d => d.y - 10)
        .attr("width", d => (d.type === "socket" || d.type === "status" ? 50 : 20))
        .attr("height", 20)
        .style("fill", d => colorMap[d.type]);

    svg.selectAll(".label")
        .data(graph.nodes)
        .enter().append("text")
        .attr("class", "label")
        .attr("x", d => d.x + (d.type === "status" ? 30 : 15))
        .attr("y", d => d.y + 5)
        .attr("text-anchor", "middle")
        .style("font-size", "12px")
        .text(d => d.label);

    svg.append("line")
        .attr("x1", boundaryX)
        .attr("y1", 0)
        .attr("x2", boundaryX)
        .attr("y2", height)
        .style("stroke", "#333")
        .style("stroke-width", 2);
}
