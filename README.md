# Ring 0 - Linux Kernel Visualization

**Real-time Linux Kernel Visualization** - Interactive visualization of Linux kernel.

## Project Structure

```
/opt/ring0/kernel-ai/
├── app.py                          # Main Flask backend
├── requirements.txt                # Python dependencies
├── README.md                       # Documentation
├── static/                         # Static files
│   ├── css/
│   │   └── main.css               # Main styles
│   ├── js/
│   │   ├── main.js                # Main logic
│   │   └── syscalls.js            # System calls
│   └── images/
│       ├── 009.png                # Central icon
│       └── Icon1.png              # Tag icons
├── templates/                      # HTML templates
│   └── organized_index.html       # Main page
├── api/                           # API modules (planned)
├── utils/                         # Utilities (planned)
├── logs/                          # Logs (planned)
├── tests/                         # Tests (planned)
└── docs/                          # Documentation (planned)
```

### 1. Install dependencies
```bash
cd /opt/ring0/kernel-ai
pip3 install -r requirements.txt
```

### 2. Start backend
```bash
python3 app.py
```

### 3. Configure Nginx
```bash
sudo systemctl reload nginx
```

### 4. Access the application
Open your browser and navigate to: `http://your-server-ip/`

## API Endpoints

### Real-time System Calls
```
GET /api/syscalls-realtime
```
Returns:
- List of system calls
- CPU and memory usage
- System information

### Kernel Data
```
GET /api/kernel-data
```
Returns:
- Kernel subsystem status
- Process statistics
- System statistics

### Process Map
```
GET /api/process-kernel-map
```
Returns:
- Process to kernel subsystem connections
- Kernel files used by processes

## Configuration

### Environment Variables
```bash
# OpenAI API (optional)
export OPENAI_API_KEY="your-api-key"

# Flask configuration
export FLASK_ENV=development
export FLASK_DEBUG=1
```

### Nginx Configuration
```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    root /opt/ring0/kernel-ai;
    
    location / {
        try_files $uri @flask;
    }
    
    location @flask {
        proxy_pass http://127.0.0.1:5001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    
    location /api/ {
        proxy_pass http://127.0.0.1:5001/api/;
    }
}
```

## Monitoring

### Logs
- Flask logs: `app.py` (stdout/stderr)
- Nginx logs: `/var/log/nginx/`
- System logs: `journalctl -u nginx`

### Metrics
- CPU usage
- Memory
- Process count
- System calls

## Testing

### API Testing
```bash
# System calls
curl http://localhost:5001/api/syscalls-realtime

# Kernel data
curl http://localhost:5001/api/kernel-data

# Health check
curl http://localhost:5001/health
```

### Static Files Testing
```bash
# CSS
curl http://localhost:5001/static/css/main.css

# JavaScript
curl http://localhost:5001/static/js/main.js
```

## Development

### Code Structure
- **Modularity** - Each component in separate file
- **Reusability** - Common functions in utils
- **Configuration** - Settings in config.py
- **Documentation** - Comments in code

### Adding New Features
1. Create new module in appropriate folder
2. Add API endpoint in app.py
3. Update frontend in main.js
4. Add styles in main.css
5. Update documentation

## 🐛 Troubleshooting

### API Issues
- Check if Flask application is running
- Check logs: `tail -f /var/log/nginx/error.log`
- Check port: `netstat -tlnp | grep 5001`

### Display Issues
- Check browser console (F12)
- Check static files loading
- Check CORS settings

### Performance Issues
- Reduce update frequency
- Optimize API requests
- Use caching

## License

MIT License - see LICENSE file for details.

## Contributing

1. Fork the repository
2. Create feature branch
3. Make changes
4. Add tests
5. Create Pull Request


**Version**: 0.0.1  
**Last Updated**: August 2025