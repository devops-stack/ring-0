"""Application configuration."""
import os
from pathlib import Path

# Project root (parent of ``kernel_ai`` package)
PROJECT_ROOT = Path(__file__).resolve().parent.parent


class Config:
    """Flask config loaded via app.config.from_object(Config)."""

    DEBUG = os.getenv("FLASK_DEBUG", "False").lower() == "true"
    ENV = os.getenv("FLASK_ENV", "production" if not DEBUG else "development")
    STATIC_FOLDER = "static"
    TEMPLATES_FOLDER = "templates"
    API_PREFIX = "/api"
    SEND_FILE_MAX_AGE_DEFAULT = 0 if not DEBUG else 31536000
    PROJECT_ROOT = PROJECT_ROOT
    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
    LOG_FORMAT = os.getenv("LOG_FORMAT", "json")
    LOG_SERVICE_NAME = os.getenv("LOG_SERVICE_NAME", "kernel-ai-backend")
