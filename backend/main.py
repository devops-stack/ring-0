import psutil
import subprocess
import json
import asyncio
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

#CORS для всех источников
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_processes_with_connections():
    """
    Возвращает процессы, имеющие активные сетевые соединения с состояниями:
    - ESTABLISHED
    - LISTEN
    - FIN_WAIT1 / FIN_WAIT2 / CLOSE_WAIT
    """
    active_pids = set()
    connections = []
    allowed_states = {"ESTABLISHED", "LISTEN", "FIN_WAIT1", "FIN_WAIT2", "CLOSE_WAIT"}

    all_connections = psutil.net_connections(kind='inet')
    print(f"🔍 Всего найдено {len(all_connections)} сетевых соединений")

    for conn in all_connections:
        if conn.status in allowed_states and conn.pid:
            active_pids.add(conn.pid)
            connections.append({
                "pid": conn.pid,
                "local_ip": conn.laddr.ip,
                "local_port": conn.laddr.port,
                "remote_ip": conn.raddr.ip if conn.raddr else "0.0.0.0",
                "remote_port": conn.raddr.port if conn.raddr else 0,
                "status": conn.status
            })

    try:
        output = subprocess.check_output("sudo lsof -i -P -n | grep LISTEN", shell=True).decode()
        for line in output.strip().split("\n"):
            parts = line.split()
            if len(parts) > 1:
                pid = int(parts[1])
                active_pids.add(pid)
    except Exception as e:
        print(f"Ошибка при выполнении lsof: {e}")

    processes = {}
    for proc in psutil.process_iter(attrs=['pid', 'name']):
        if proc.info['pid'] in active_pids:
            processes[proc.info['pid']] = {"name": proc.info['name']}

    print(f"Найдено {len(processes)} процессов с активными соединениями:")
    for pid, proc in processes.items():
        print(f"  🔹 {pid}: {proc['name']}")

    return processes, connections

async def get_kernel_data():
    """
    Асинхронный генератор данных о процессах и соединениях.
    """
    while True:
        processes, connections = get_processes_with_connections()
        data = {
            "cpu": [psutil.cpu_percent()],
            "memory": psutil.virtual_memory().percent,
            "network": connections,
            "processes": processes
        }
        yield data
        await asyncio.sleep(1)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print(f"INFO:     {websocket.client} - WebSocket подключен")

    try:
        async for data in get_kernel_data():
            await websocket.send_text(json.dumps(data))
    except Exception as e:
        print(f"Ошибка WebSocket: {e}")
    finally:
        print("WebSocket-закрытие корректно обработано.")
        await websocket.close()