document.addEventListener('DOMContentLoaded', function() {
    // Static data for demonstration purposes
    const nginxData = {
        pid: '910275',
        name: 'nginx',
        cpu: '0.0',
        memory: '1675264', // Memory in bytes
        openFiles: '0',
        connections: '0'
    };

    // Function to format memory from bytes to a more readable format
    function formatMemory(bytes) {
        const kb = bytes / 1024;
        const mb = kb / 1024;
        if (mb > 1) {
            return `${mb.toFixed(2)} MB`;
        } else if (kb > 1) {
            return `${kb.toFixed(2)} KB`;
        } else {
            return `${bytes} bytes`;
        }
    }

    // Update the HTML with the nginx data
    document.getElementById('nginx-name').textContent = nginxData.name;
    document.getElementById('nginx-pid').textContent = nginxData.pid;
    document.getElementById('nginx-cpu').textContent = nginxData.cpu + '%';
    document.getElementById('nginx-memory').textContent = formatMemory(nginxData.memory);
    document.getElementById('nginx-files').textContent = nginxData.openFiles;
    document.getElementById('nginx-connections').textContent = nginxData.connections;
});

