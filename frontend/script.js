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
    console.log("Сгенерированные узлы:", graph.nodes);
    console.log("Сгенерированные связи:", graph.links);
    updateGraph(graph);
};

function transformDataToGraph(data) {
    const nodes = [{ id: "kernel", label: "Linux Kernel", type: "kernel", x: kernelX, y: kernelY }];
    const links = [];
    const sockets = new Map();

    let processY = kernelY - (Object.keys(data.processes).length * 20) / 2;

    //Обавить процессы
    Object.entries(data.processes).forEach(([pid, proc]) => {
        const processId = `p${pid}`;
        nodes.push({ id: processId, label: proc.name, type: "process", x: kernelX + 100, y: processY });
        links.push({ source: "kernel", target: processId });
        processY += 40;
    });

    let socketY = kernelY - (data.network.length * 30) / 2;

    //Создать сокеты и внешние узлы ДО добавления связей
    data.network.forEach((conn) => {
        const processId = `p${conn.pid}`;
        const socketId = `s${conn.local_port}`;
        const statusId = `status_${conn.local_port}`;
        const externalId = `ext_${conn.remote_ip}_${conn.remote_port}`;

        if (!nodes.some(n => n.id === processId)) {
            console.warn(`Пропущено соединение: процесс ${processId} не найден!`);
            return;
        }

        if (!sockets.has(socketId)) {
            console.log(`Добавляем сокет ${socketId} для процесса ${processId}`);
            nodes.push(
                { id: socketId, label: conn.local_port, type: "socket", x: boundaryX - 150, y: socketY },
                { id: statusId, label: conn.status, type: "status", x: boundaryX - 100, y: socketY }
            );
            sockets.set(socketId, socketY);
            socketY += 50;
        }

        //Внешний узел (создаем ДО связей)
        if (!nodes.some(n => n.id === externalId)) {
            console.log(`Добавляем внешний узел ${externalId}`);
            nodes.push({ id: externalId, label: `${conn.remote_ip}:${conn.remote_port}`, type: "internet", x: boundaryX, y: sockets.get(socketId) });
        }
    });

    //Добавить связи
    data.network.forEach((conn) => {
        const processId = `p${conn.pid}`;
        const socketId = `s${conn.local_port}`;
        const statusId = `status_${conn.local_port}`;
        const externalId = `ext_${conn.remote_ip}_${conn.remote_port}`;

        if (!nodes.some(n => n.id === processId) || !nodes.some(n => n.id === socketId)) {
            console.warn(`Пропущена связь: ${processId} → ${socketId}`);
            return;
        }
        links.push({ source: processId, target: socketId });

        if (!nodes.some(n => n.id === statusId)) {
            console.warn(`Пропущена связь: ${socketId} → ${statusId}`);
            return;
        }
        links.push({ source: socketId, target: statusId });

        if (!nodes.some(n => n.id === externalId)) {
            console.warn(`Пропущена связь: ${statusId} → ${externalId}`);
            return;
        }
        links.push({ source: statusId, target: externalId });
    });

    return { nodes, links };
}

function updateGraph(graph) {
    svg.selectAll("*").remove();

    console.log("Отрисовка узлов...");
    console.log("Узлы:", graph.nodes);
    console.log("Связи:", graph.links);

    // Отрисовка связей (линий)
    const links = svg.selectAll(".link")
        .data(graph.links)
        .enter().append("line")
        .attr("class", "link")
        .attr("x1", d => {
            const sourceNode = graph.nodes.find(n => n.id === d.source);
            if (!sourceNode) {
                console.warn(`Ошибка: source ${d.source} не найден среди узлов!`);
                return boundaryX;
            }
            return sourceNode.x;
        })
        .attr("y1", d => {
            const sourceNode = graph.nodes.find(n => n.id === d.source);
            return sourceNode ? sourceNode.y : height / 2;
        })
        .attr("x2", d => {
            const targetNode = graph.nodes.find(n => n.id === d.target);
            if (!targetNode) {
                console.warn(`Ошибка: target ${d.target} не найден среди узлов!`);
                return boundaryX;
            }
            return targetNode.x;
        })
        .attr("y2", d => {
            const targetNode = graph.nodes.find(n => n.id === d.target);
            return targetNode ? targetNode.y : height / 2;
        })
        .style("stroke", "#777")
        .style("stroke-width", 2);

    // Отрисовка узлов
    svg.selectAll(".node")
        .data(graph.nodes)
        .enter().append("rect")
        .attr("class", "node")
        .attr("x", d => d.x - (d.type === "kernel" ? 20 : 10))
        .attr("y", d => d.y - 10)
        .attr("width", d => (d.type === "socket" || d.type === "status" ? 60 : 20))
        .attr("height", 20)
        .style("fill", d => colorMap[d.type]);

    // Отрисовка подписей узлов
    svg.selectAll(".label")
        .data(graph.nodes)
        .enter().append("text")
        .attr("class", "label")
        .attr("x", d => d.x + (d.type === "status" ? 35 : 15))
        .attr("y", d => d.y + 5)
        .attr("text-anchor", "middle")
        .style("font-size", "12px")
        .text(d => d.label);

    // Граница сети
    svg.append("line")
        .attr("x1", boundaryX)
        .attr("y1", 0)
        .attr("x2", boundaryX)
        .attr("y2", height)
        .style("stroke", "#333")
        .style("stroke-width", 2);
}