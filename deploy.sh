#!/bin/bash

# Deploy script for Linux Kernel Visualization
# Usage: ./deploy.sh [pull|restart|status|logs]

set -e

PROJECT_DIR="/opt/ring0/kernel-ai"
SERVICE_NAME="kernel-ai"

function pull_code() {
    echo "🔄 Pulling latest code from GitHub..."
    cd "$PROJECT_DIR"
    git pull origin main
    echo "✅ Code updated successfully"
}

function restart_service() {
    echo "🔄 Restarting $SERVICE_NAME service..."
    sudo systemctl restart $SERVICE_NAME
    sudo systemctl reload nginx
    echo "✅ Service restarted successfully"
}

function show_status() {
    echo "📊 Service status:"
    sudo systemctl status $SERVICE_NAME --no-pager -l
    echo ""
    echo "🌐 Nginx status:"
    sudo systemctl status nginx --no-pager -l
}

function show_logs() {
    echo "📋 Recent logs for $SERVICE_NAME:"
    sudo journalctl -u $SERVICE_NAME -n 50 --no-pager
}

function full_deploy() {
    echo "🚀 Starting full deployment..."
    pull_code
    restart_service
    show_status
    echo "✅ Deployment completed!"
}

case "${1:-deploy}" in
    "pull")
        pull_code
        ;;
    "restart")
        restart_service
        ;;
    "status")
        show_status
        ;;
    "logs")
        show_logs
        ;;
    "deploy")
        full_deploy
        ;;
    *)
        echo "Usage: $0 [pull|restart|status|logs|deploy]"
        echo "  pull    - Pull latest code from GitHub"
        echo "  restart - Restart services"
        echo "  status  - Show service status"
        echo "  logs    - Show recent logs"
        echo "  deploy  - Full deployment (default)"
        exit 1
        ;;
esac
