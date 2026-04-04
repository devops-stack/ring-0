"""Shared infrastructure utilities."""

from __future__ import annotations

import os
import shutil


def resolve_binary(cmd_name):
    """Resolve executable path when PATH may miss sbin dirs."""
    found = shutil.which(cmd_name)
    if found:
        return found
    for base in ("/usr/sbin", "/usr/bin", "/sbin", "/bin"):
        candidate = os.path.join(base, cmd_name)
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return None
