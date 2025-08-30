# Deployment Setup Guide

## GitHub Repository Setup

### 1. Add SSH Key to GitHub

1. Copy the SSH public key from the server:
```bash
ssh -i ~/.ssh/webserver ubuntu@3.70.234.196 "cat ~/.ssh/id_rsa.pub"
```

2. Go to your GitHub repository: https://github.com/devops-stack/ring-0/settings/keys

3. Click "Add deploy key"

4. Paste the SSH key and give it a name (e.g., "Ubuntu Server Deploy Key")

5. Check "Allow write access"

6. Click "Add key"

### 2. GitHub Secrets Setup

Add these secrets to your GitHub repository (Settings → Secrets and variables → Actions):

- `HOST`: `3.70.234.196`
- `USERNAME`: `ubuntu`
- `SSH_KEY`: Your private SSH key (the content of `~/.ssh/webserver`)
- `PORT`: `22`

### 3. Push Code to GitHub

After adding the SSH key, run:
```bash
ssh -i ~/.ssh/webserver ubuntu@3.70.234.196 "cd /opt/ring0/kernel-ai && git push -u origin main"
```

## Server Setup

### 1. Enable Systemd Service

```bash
ssh -i ~/.ssh/webserver ubuntu@3.70.234.196 "sudo systemctl enable kernel-ai"
```

### 2. Start the Service

```bash
ssh -i ~/.ssh/webserver ubuntu@3.70.234.196 "sudo systemctl start kernel-ai"
```

### 3. Check Status

```bash
ssh -i ~/.ssh/webserver ubuntu@3.70.234.196 "sudo systemctl status kernel-ai"
```

## Deployment Workflow

### Manual Deployment

Use the deployment script:
```bash
ssh -i ~/.ssh/webserver ubuntu@3.70.234.196 "cd /opt/ring0/kernel-ai && ./deploy.sh"
```

Options:
- `./deploy.sh pull` - Pull latest code
- `./deploy.sh restart` - Restart services
- `./deploy.sh status` - Show service status
- `./deploy.sh logs` - Show recent logs
- `./deploy.sh deploy` - Full deployment (default)

### Automatic Deployment

Once GitHub Actions is configured, every push to the `main` branch will automatically deploy to the server.

## Project Structure

```
/opt/ring0/kernel-ai/
├── app.py                 # Flask backend
├── requirements.txt       # Python dependencies
├── deploy.sh             # Deployment script
├── .github/workflows/    # GitHub Actions
├── static/               # Static files (CSS, JS, images)
├── templates/            # HTML templates
├── docs/                 # Documentation
├── tests/                # Test files
└── README.md            # Project documentation
```

## Troubleshooting

### Check Service Logs
```bash
ssh -i ~/.ssh/webserver ubuntu@3.70.234.196 "sudo journalctl -u kernel-ai -f"
```

### Check Nginx Logs
```bash
ssh -i ~/.ssh/webserver ubuntu@3.70.234.196 "sudo tail -f /var/log/nginx/error.log"
```

### Restart Everything
```bash
ssh -i ~/.ssh/webserver ubuntu@3.70.234.196 "sudo systemctl restart kernel-ai && sudo systemctl reload nginx"
```
