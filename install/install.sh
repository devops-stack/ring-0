#!/usr/bin/env bash
# ring-0 / kernel-ai visualization installer.
# No ML (sklearn/mlflow/Postgres). No eBPF sensor.
#
#   sudo ./install/install.sh
#   sudo ./install/install.sh --prefix /opt/ring0/kernel-ai --with-nginx
#   sudo ./install/install.sh --bind 0.0.0.0:8000
#
set -euo pipefail

PREFIX=/opt/ring0/kernel-ai
BIND=127.0.0.1:8000
WITH_NGINX=0
REPLACE_UNIT=0
NO_START=0
DRY_RUN=0
SERVICE_USER=kernel-ai
UNIT_WROTE=0

SRC=$(cd "$(dirname "$0")/.." && pwd)
STAMP_NAME=.ring0-viz-install
EXCLUDE_FILE=

usage() {
    cat <<'EOF'
Install ring-0 visualization on this Linux host (no ML).

Usage: sudo ./install/install.sh [options]

  --prefix DIR        install tree (default /opt/ring0/kernel-ai)
  --bind ADDR         gunicorn bind (default 127.0.0.1:8000)
  --with-nginx        install nginx and a site that proxies to 127.0.0.1:8000
  --replace-unit      overwrite /etc/systemd/system/kernel-ai.service if it exists
  --no-start          install but do not enable/start the unit
  --dry-run           print actions only
  -h, --help          this help

Does not install kernel-ai-ml* or the eBPF sensor.
Uninstall: sudo ./install/uninstall.sh
EOF
}

log() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
run() {
    if [ "$DRY_RUN" = 1 ]; then
        printf '+ %s\n' "$*"
        return 0
    fi
    "$@"
}

while [ $# -gt 0 ]; do
    case "$1" in
        --prefix) PREFIX=${2:?}; shift 2 ;;
        --bind) BIND=${2:?}; shift 2 ;;
        --with-nginx) WITH_NGINX=1; shift ;;
        --replace-unit) REPLACE_UNIT=1; shift ;;
        --no-start) NO_START=1; shift ;;
        --dry-run) DRY_RUN=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) die "unknown option: $1" ;;
    esac
done

[ "$(id -u)" -eq 0 ] || die "run as root (sudo $0)"
case "$PREFIX" in
    /*) ;;
    *) die "--prefix must be absolute, got $PREFIX" ;;
esac
case "$PREFIX" in
    /|/usr|/usr/local|/etc|/var|/opt) die "refusing unsafe --prefix $PREFIX" ;;
esac
[ -f "$SRC/kernel_ai/webapp.py" ] || die "source tree missing kernel_ai/webapp.py ($SRC)"
[ -f "$SRC/requirements-viz.txt" ] || die "missing $SRC/requirements-viz.txt"
[ -f "$SRC/install/kernel-ai.service.tmpl" ] || die "missing service template"

detect_pm() {
    if command -v apt-get >/dev/null 2>&1; then
        echo apt
    elif command -v dnf >/dev/null 2>&1; then
        echo dnf
    elif command -v yum >/dev/null 2>&1; then
        echo yum
    elif command -v pacman >/dev/null 2>&1; then
        echo pacman
    elif command -v zypper >/dev/null 2>&1; then
        echo zypper
    else
        die "no supported package manager (need apt, dnf, yum, pacman, or zypper)"
    fi
}

install_os_packages() {
    local pm=$1
    case "$pm" in
        apt)
            run apt-get update -qq
            run apt-get install -y --no-install-recommends \
                python3 python3-venv python3-pip ca-certificates curl iproute2 tar
            if [ "$WITH_NGINX" = 1 ]; then
                run apt-get install -y --no-install-recommends nginx
            fi
            ;;
        dnf)
            run dnf install -y python3 python3-pip ca-certificates curl iproute tar
            if [ "$WITH_NGINX" = 1 ]; then
                run dnf install -y nginx
            fi
            ;;
        yum)
            run yum install -y python3 python3-pip ca-certificates curl iproute tar
            if [ "$WITH_NGINX" = 1 ]; then
                run yum install -y nginx
            fi
            ;;
        pacman)
            run pacman -Sy --noconfirm --needed python python-pip ca-certificates curl iproute2 tar
            if [ "$WITH_NGINX" = 1 ]; then
                run pacman -Sy --noconfirm --needed nginx
            fi
            ;;
        zypper)
            run zypper --non-interactive install \
                python3 python3-pip python3-venv ca-certificates curl iproute2 tar
            if [ "$WITH_NGINX" = 1 ]; then
                run zypper --non-interactive install nginx
            fi
            ;;
    esac
}

py_ok() {
    python3 - <<'PY'
import sys
need = (3, 9)
raise SystemExit(0 if sys.version_info[:2] >= need else 1)
PY
}

ensure_user() {
    if getent passwd "$SERVICE_USER" >/dev/null; then
        return 0
    fi
    local shell=/usr/sbin/nologin
    for s in /usr/sbin/nologin /sbin/nologin /usr/bin/nologin /bin/false; do
        if [ -x "$s" ]; then
            shell=$s
            break
        fi
    done
    if command -v useradd >/dev/null 2>&1; then
        run useradd --system --no-create-home --shell "$shell" --user-group "$SERVICE_USER"
    else
        die "useradd not found"
    fi
}

write_excludes() {
    EXCLUDE_FILE=$(mktemp)
    cat >"$EXCLUDE_FILE" <<'EOF'
venv
.venv
.git
backups
.design-backups
mldata
models
mlruns
mlartifacts
mlflow.db
logs
.pytest_cache
.mypy_cache
.coverage
htmlcov
node_modules
.cursor
__pycache__
*.pyc
.env
EOF
}

sync_tree() {
    mkdir -p "$PREFIX"
    if [ "$SRC" = "$PREFIX" ]; then
        log "in-place install at $PREFIX (tree not copied)"
        return 0
    fi
    write_excludes
    if command -v rsync >/dev/null 2>&1; then
        run rsync -a --delete --exclude-from="$EXCLUDE_FILE" "$SRC"/ "$PREFIX"/
    else
        local tmp
        tmp=$(mktemp -d)
        tar -C "$SRC" -cf - \
            --exclude=venv --exclude=.venv --exclude=.git --exclude=backups \
            --exclude=.design-backups --exclude=mldata --exclude=models \
            --exclude=mlruns --exclude=mlartifacts --exclude=logs \
            --exclude=.pytest_cache --exclude=.cursor --exclude=node_modules \
            --exclude=__pycache__ --exclude=.env \
            . | tar -C "$tmp" -xf -
        if [ "$DRY_RUN" = 1 ]; then
            rm -rf "$tmp"
        else
            # Replace prefix contents except venv/logs we manage separately.
            find "$PREFIX" -mindepth 1 -maxdepth 1 \
                ! -name venv ! -name logs ! -name "$STAMP_NAME" \
                -exec rm -rf {} +
            tar -C "$tmp" -cf - . | tar -C "$PREFIX" -xf -
            rm -rf "$tmp"
        fi
    fi
    rm -f "$EXCLUDE_FILE"
}

setup_venv() {
    if [ ! -x "$PREFIX/venv/bin/python" ]; then
        run python3 -m venv "$PREFIX/venv"
    fi
    run "$PREFIX/venv/bin/python" -m pip install --upgrade pip
    run "$PREFIX/venv/bin/python" -m pip install -r "$PREFIX/requirements-viz.txt"
}

write_unit() {
    local dest=/etc/systemd/system/kernel-ai.service
    if [ -f "$dest" ] && [ "$REPLACE_UNIT" != 1 ]; then
        log "systemd unit exists ($dest); leaving it. Pass --replace-unit to overwrite."
        return 0
    fi
    local tmp
    tmp=$(mktemp)
    sed -e "s|__PREFIX__|$PREFIX|g" -e "s|__BIND__|$BIND|g" \
        "$SRC/install/kernel-ai.service.tmpl" >"$tmp"
    run install -m 0644 "$tmp" "$dest"
    rm -f "$tmp"
    UNIT_WROTE=1
}

install_nginx_site() {
    [ "$WITH_NGINX" = 1 ] || return 0
    local src=$PREFIX/deploy/nginx/ring-0.conf
    [ -f "$src" ] || src=$SRC/deploy/nginx/ring-0.conf
    [ -f "$src" ] || die "nginx site missing: deploy/nginx/ring-0.conf"
    if [ -d /etc/nginx/sites-available ]; then
        run install -m 0644 "$src" /etc/nginx/sites-available/ring-0.conf
        run ln -sfn /etc/nginx/sites-available/ring-0.conf /etc/nginx/sites-enabled/ring-0.conf
        if [ -L /etc/nginx/sites-enabled/default ]; then
            run rm -f /etc/nginx/sites-enabled/default
        fi
    elif [ -d /etc/nginx/conf.d ]; then
        run install -m 0644 "$src" /etc/nginx/conf.d/ring-0.conf
    else
        die "nginx installed but neither sites-available nor conf.d exists"
    fi
    if command -v nginx >/dev/null 2>&1; then
        run nginx -t
    fi
}

fix_perms() {
    run mkdir -p "$PREFIX/logs"
    if [ ! -f "$PREFIX/logs/frontend-events.jsonl" ]; then
        if [ "$DRY_RUN" = 1 ]; then
            log "+ touch $PREFIX/logs/frontend-events.jsonl"
        else
            : >"$PREFIX/logs/frontend-events.jsonl"
        fi
    fi
    if [ "$SRC" = "$PREFIX" ]; then
        run chgrp "$SERVICE_USER" "$PREFIX/logs" "$PREFIX/logs/frontend-events.jsonl" || true
        run chmod 2775 "$PREFIX/logs"
        run chmod 664 "$PREFIX/logs/frontend-events.jsonl"
        return 0
    fi
    run chown -R "root:$SERVICE_USER" "$PREFIX"
    run chmod 0755 "$PREFIX"
    run chmod 2775 "$PREFIX/logs"
    run chmod 664 "$PREFIX/logs/frontend-events.jsonl"
}

write_stamp() {
    local copied=0
    [ "$SRC" != "$PREFIX" ] && copied=1
    if [ "$DRY_RUN" = 1 ]; then
        log "+ write $PREFIX/$STAMP_NAME"
        return 0
    fi
    cat >"$PREFIX/$STAMP_NAME" <<EOF
PREFIX=$PREFIX
BIND=$BIND
NGINX=$WITH_NGINX
COPIED=$copied
UNIT_WROTE=$UNIT_WROTE
SOURCE=$SRC
INSTALLED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
}

start_units() {
    [ "$NO_START" = 1 ] && return 0
    command -v systemctl >/dev/null 2>&1 || die "systemd is required"
    run systemctl daemon-reload
    run systemctl enable kernel-ai.service
    if [ -f /etc/systemd/system/kernel-ai.service ] || systemctl cat kernel-ai.service >/dev/null 2>&1; then
        run systemctl restart kernel-ai.service
    fi
    if [ "$WITH_NGINX" = 1 ]; then
        run systemctl enable nginx
        run systemctl restart nginx
    fi
}

verify() {
    [ "$NO_START" = 1 ] && return 0
    [ "$DRY_RUN" = 1 ] && return 0
    local url="http://${BIND}/"
    case "$BIND" in
        0.0.0.0:*) url="http://127.0.0.1:${BIND##*:}/" ;;
        \[::\]:*) url="http://127.0.0.1:${BIND##*:}/" ;;
    esac
    sleep 1
    if command -v curl >/dev/null 2>&1; then
        local code
        code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" || true)
        log "GET $url -> $code"
        [ "$code" = 200 ] || log "warning: expected 200 (service may still be starting)"
    fi
}

PM=$(detect_pm)
log "package manager: $PM"
log "source: $SRC"
log "prefix: $PREFIX"
log "bind: $BIND"
log "nginx: $WITH_NGINX"

install_os_packages "$PM"
py_ok || die "python3 >= ${MIN_PY[0]}.${MIN_PY[1]} required"
ensure_user
sync_tree
setup_venv
write_unit
install_nginx_site
fix_perms
write_stamp
start_units
verify

log ""
log "viz install done. ML units were not installed."
log "  bind: $BIND"
if [ "$WITH_NGINX" = 1 ]; then
    log "  proxy: nginx :80 -> 127.0.0.1:8000"
fi
log "  logs: $PREFIX/logs"
log "  uninstall: sudo $SRC/install/uninstall.sh"
