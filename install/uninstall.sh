#!/usr/bin/env bash
# Reverse install/install.sh. Does not remove the kernel-ai system user.
# Does not delete a git checkout (in-place install).
set -euo pipefail

PREFIX=/opt/ring0/kernel-ai
PURGE=0
SRC=$(cd "$(dirname "$0")/.." && pwd)
STAMP_NAME=.ring0-viz-install

usage() {
    cat <<'EOF'
Usage: sudo ./install/uninstall.sh [--prefix DIR] [--purge]

  --prefix DIR   tree that was installed (default /opt/ring0/kernel-ai)
  --purge        also delete PREFIX when the stamp says the tree was copied
                 (never deletes a git checkout)

Stops kernel-ai.service. Removes the nginx snippet only if the stamp says
nginx was installed by this installer. Leaves kernel-ai-ml* alone.
EOF
}

log() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
    case "$1" in
        --prefix) PREFIX=${2:?}; shift 2 ;;
        --purge) PURGE=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) die "unknown option: $1" ;;
    esac
done

[ "$(id -u)" -eq 0 ] || die "run as root"

STAMP=$PREFIX/$STAMP_NAME
NGINX=0
COPIED=0
UNIT_WROTE=0
if [ -f "$STAMP" ]; then
    # shellcheck disable=SC1090
    . "$STAMP"
fi

if command -v systemctl >/dev/null 2>&1; then
    systemctl disable --now kernel-ai.service 2>/dev/null || true
fi

if [ "${UNIT_WROTE:-0}" = 1 ] && [ -f /etc/systemd/system/kernel-ai.service ]; then
    rm -f /etc/systemd/system/kernel-ai.service
    systemctl daemon-reload 2>/dev/null || true
    log "removed /etc/systemd/system/kernel-ai.service"
else
    log "left systemd unit in place (not written by this installer, or no stamp)"
fi

if [ "${NGINX:-0}" = 1 ]; then
    rm -f /etc/nginx/sites-enabled/ring-0.conf \
        /etc/nginx/sites-available/ring-0.conf \
        /etc/nginx/conf.d/ring-0.conf
    if command -v nginx >/dev/null 2>&1 && systemctl is-active --quiet nginx; then
        nginx -t && systemctl reload nginx || true
    fi
    log "removed nginx ring-0 site"
fi

if [ "$PURGE" = 1 ]; then
    if [ "${COPIED:-0}" != 1 ]; then
        die "refusing --purge on an in-place / git tree (stamp COPIED!=1)"
    fi
    if [ -d "$PREFIX/.git" ]; then
        die "refusing --purge: $PREFIX looks like a git checkout"
    fi
    case "$PREFIX" in
        /|/usr|/usr/local|/etc|/var|/opt) die "refusing to purge $PREFIX" ;;
    esac
    rm -rf "$PREFIX"
    log "removed $PREFIX"
else
    rm -f "$STAMP"
    log "left $PREFIX (stamp removed). --purge deletes a copied tree."
fi

log "uninstall done. system user 'kernel-ai' was kept."
