# 📁 Project File Organization Guide

## 🎯 Organization Principles

### 1. **Separation of Concerns**
- **Backend** - server logic and API
- **Frontend** - user interface
- **Static Files** - CSS, JS, images
- **Templates** - HTML files

### 2. **Modularity**
- Each component in separate file
- Reusable functions
- Clear interfaces between modules

### 3. **Scalability**
- Easy to add new features
- Simple testing
- Clear structure for team

## 📂 Standard Web Application Structure

```
project/
├── app.py                    # Main application
├── requirements.txt          # Python dependencies
├── README.md                # Documentation
├── config.py                # Configuration
├── static/                  # Static files
│   ├── css/                 # Styles
│   │   ├── main.css        # Main styles
│   │   ├── components.css  # Component styles
│   │   └── themes.css      # Themes
│   ├── js/                 # JavaScript
│   │   ├── main.js         # Main logic
│   │   ├── modules/        # Modules
│   │   └── utils.js        # Utilities
│   ├── images/             # Images
│   └── fonts/              # Fonts
├── templates/               # HTML templates
│   ├── base.html           # Base template
│   ├── index.html          # Main page
│   └── components/         # Components
├── api/                    # API modules
│   ├── __init__.py
│   ├── routes.py           # Routes
│   └── models.py           # Data models
├── utils/                  # Utilities
│   ├── __init__.py
│   └── helpers.py          # Helper functions
├── tests/                  # Tests
├── logs/                   # Logs
└── docs/                   # Documentation
```

## 🎨 CSS Organization

### CSS File Structure:
```css
/* main.css - Main styles */
/* 1. Reset and base styles */
/* 2. Typography */
/* 3. Layout and grid */
/* 4. Components */
/* 5. Utilities */
/* 6. Media queries */
```

### Organization Example:
```css
/* ===== RESET AND BASE STYLES ===== */
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Share Tech Mono', monospace;
    background-color: #f2f2f2;
}

/* ===== TYPOGRAPHY ===== */
h1, h2, h3 {
    font-weight: bold;
}

/* ===== COMPONENTS ===== */
.central-circle {
    fill: rgba(0, 0, 0, 0.05);
    stroke: #333;
}

/* ===== UTILITIES ===== */
.hidden {
    display: none;
}

/* ===== RESPONSIVENESS ===== */
@media (max-width: 768px) {
    /* Mobile styles */
}
```

## 🔧 JavaScript Organization

### JS File Structure:
```javascript
// main.js - Main logic
// 1. Initialization
// 2. Event handlers
// 3. Main functions
// 4. Utilities

// modules/ - Modules
// - syscalls.js - System calls
// - visualization.js - Visualization
// - api.js - API work
```

### Module Example:
```javascript
// syscalls.js
class SyscallsManager {
    constructor() {
        this.data = [];
        this.interval = null;
    }
    
    // Class methods
    async updateData() { /* ... */ }
    render() { /* ... */ }
    startAutoUpdate() { /* ... */ }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SyscallsManager;
}
```

## 🐍 Python (Flask) Organization

### Application Structure:
```python
# app.py - Main application
from flask import Flask, jsonify, render_template
from api.routes import api_bp
from utils.helpers import get_system_info

app = Flask(__name__)
app.register_blueprint(api_bp, url_prefix='/api')

# Routes
@app.route('/')
def index():
    return render_template('index.html')

# api/routes.py - API routes
from flask import Blueprint, jsonify

api_bp = Blueprint('api', __name__)

@api_bp.route('/syscalls-realtime')
def syscalls_realtime():
    return jsonify(get_syscalls_data())
```

## 📋 Best Practices

### 1. **File Naming**
- Use snake_case for Python
- Use kebab-case for HTML/CSS
- Use camelCase for JavaScript
- Make names descriptive

### 2. **Comments**
```python
# Python
def get_system_calls():
    """
    Gets system calls in real-time.
    
    Returns:
        list: List of system calls
    """
    pass
```

```javascript
// JavaScript
/**
 * Updates system calls data
 * @param {number} interval - Update interval in ms
 */
function updateSyscalls(interval) {
    // ...
}
```

```css
/* CSS */
/* ===== SYSTEM CALLS ===== */
.syscall-table {
    /* System calls table styles */
}
```

### 3. **Imports and Dependencies**
```python
# Python - group imports
# Standard library
import os
import sys
import json

# Third-party libraries
from flask import Flask, jsonify
import psutil

# Local modules
from utils.helpers import get_system_info
```

```javascript
// JavaScript - use ES6 modules
import { SyscallsManager } from './modules/syscalls.js';
import { Visualization } from './modules/visualization.js';
```

### 4. **Configuration**
```python
# config.py
class Config:
    DEBUG = True
    STATIC_FOLDER = 'static'
    API_PREFIX = '/api'
    
class ProductionConfig(Config):
    DEBUG = False
```

## 🚀 Deployment

### 1. **Production Structure**
```
/var/www/your-app/
├── app.py
├── static/
├── templates/
├── logs/
└── venv/
```

### 2. **Nginx Configuration**
```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    root /var/www/your-app;
    
    location /static/ {
        alias /var/www/your-app/static/;
        expires 1y;
    }
    
    location / {
        proxy_pass http://127.0.0.1:5001;
    }
}
```

### 3. **Systemd Service**
```ini
[Unit]
Description=Your Flask App
After=network.target

[Service]
User=www-data
WorkingDirectory=/var/www/your-app
ExecStart=/var/www/your-app/venv/bin/python app.py
Restart=always

[Install]
WantedBy=multi-user.target
```

## 📊 Monitoring and Logging

### 1. **Log Structure**
```
logs/
├── app.log          # Application logs
├── access.log       # Access logs
├── error.log        # Error logs
└── debug.log        # Debug logs
```

### 2. **Logging Configuration**
```python
import logging
from logging.handlers import RotatingFileHandler

# Logging setup
logging.basicConfig(
    filename='logs/app.log',
    level=logging.INFO,
    format='%(asctime)s %(levelname)s: %(message)s'
)
```

## 🧪 Testing

### 1. **Test Structure**
```
tests/
├── __init__.py
├── test_api.py      # API tests
├── test_models.py   # Model tests
└── test_utils.py    # Utility tests
```

### 2. **Test Example**
```python
import unittest
from app import app

class TestAPI(unittest.TestCase):
    def setUp(self):
        self.app = app.test_client()
    
    def test_syscalls_endpoint(self):
        response = self.app.get('/api/syscalls-realtime')
        self.assertEqual(response.status_code, 200)
```

## 📈 Scaling

### 1. **Microservices**
```
services/
├── api-service/     # API service
├── web-service/     # Web interface
├── data-service/    # Data service
└── monitoring/      # Monitoring
```

### 2. **Docker**
```dockerfile
FROM python:3.9-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
EXPOSE 5001
CMD ["python", "app.py"]
```

---

**Remember**: Good file organization makes projects more understandable, maintainable, and scalable! 🎯
