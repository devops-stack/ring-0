import psutil

def get_process_info():
    process_info = []
    for proc in psutil.process_iter(['pid', 'name', 'cpu_percent', 'memory_info', 'connections', 'open_files']):
        try:
            # PID, process name, CPU and memory usage
            pid = proc.info['pid']
            name = proc.info['name']
            cpu_usage = proc.info['cpu_percent']
            memory_usage = proc.info['memory_info'].rss  # Resident Set Size

            # Open files and connections (related to file systems and network stack)
            open_files = len(proc.info['open_files']) if proc.info['open_files'] else 0
            connections = len(proc.info['connections']) if proc.info['connections'] else 0

            process_info.append({
                'pid': pid,
                'name': name,
                'cpu_usage': cpu_usage,
                'memory_usage': memory_usage,
                'open_files': open_files,
                'connections': connections
            })

        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            pass  # Process has terminated or cannot be accessed

    return process_info

def main():
    info = get_process_info()
    for proc in info:
        print(f"PID: {proc['pid']}, Name: {proc['name']}, CPU%: {proc['cpu_usage']}, Memory: {proc['memory_usage']}, Open Files: {proc['open_files']}, Connections: {proc['connections']}")

if __name__ == "__main__":
    main()
