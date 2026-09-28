#!/usr/bin/env bash
# ring-0 / kernel-ai visualization installer.
# Debian/Ubuntu (apt), Fedora/RHEL 8+/Rocky/Alma (dnf), Arch (pacman).
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

MIN_PY_MAJOR=3
MIN_PY_MINOR=9
PY=

usage() {
    cat <<'EOF'
Install ring-0 visualization on this Linux host (no ML).

Supported: Debian / Ubuntu / Mint (apt), Fedora / RHEL 8+ / Rocky / Alma (dnf),
Arch / Manjaro (pacman). Needs systemd and python >= 3.9.

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

# Supported set, deliberately narrow: Debian/Ubuntu/Mint, Fedora/RHEL 8+ and
# its rebuilds, Arch/Manjaro. yum-only hosts (CentOS 7, RHEL 7) and openSUSE
# were dropped rather than shipped untested -- openSUSE in particular needs a
# different interpreter package, since Leap 15.6 still ships python3 as 3.6.
detect_pm() {
    if command -v apt-get >/dev/null 2>&1; then
        echo apt
    elif command -v dnf >/dev/null 2>&1; then
        echo dnf
    elif command -v pacman >/dev/null 2>&1; then
        echo pacman
    else
        die "unsupported distribution: need apt (Debian/Ubuntu), dnf (Fedora/RHEL 8+/Rocky/Alma), or pacman (Arch)"
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
        pacman)
            # -Syu, never -Sy: refreshing the database without upgrading is
            # the documented way to break an Arch host with a partial upgrade.
            run pacman -Syu --noconfirm --needed python python-pip ca-certificates curl iproute2 tar
            if [ "$WITH_NGINX" = 1 ]; then
                run pacman -S --noconfirm --needed nginx
            fi
            ;;
    esac
}

# Newest interpreter that clears the floor. Distros disagree about what
# `python3` points at -- openSUSE Leap 15.6 still ships 3.6 -- so the version
# has to be asked for, not assumed.
pick_python() {
    local cand
    for cand in python3.13 python3.12 python3.11 python3.10 python3.9 python3; do
        command -v "$cand" >/dev/null 2>&1 || continue
        if "$cand" - "$MIN_PY_MAJOR" "$MIN_PY_MINOR" <<'PY'
import sys
need = (int(sys.argv[1]), int(sys.argv[2]))
raise SystemExit(0 if sys.version_info[:2] >= need else 1)
PY
        then
            PY=$(command -v "$cand")
            return 0
        fi
    done
    return 1
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
        run "$PY" -m venv "$PREFIX/venv"
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
    open_proxy_path
}

# On RHEL-family and openSUSE the reverse proxy fails in two ways that produce
# no error here and a 502 or a timeout later: SELinux forbids httpd from
# opening a socket to gunicorn, and firewalld does not have port 80 open. Both
# are best-effort -- a host without them is not a failure.
open_proxy_path() {
    if command -v getsebool >/dev/null 2>&1 && command -v setsebool >/dev/null 2>&1; then
        if getsebool httpd_can_network_connect 2>/dev/null | grep -q ' off$'; then
            log "SELinux: enabling httpd_can_network_connect (nginx -> 127.0.0.1:8000)"
            run setsebool -P httpd_can_network_connect 1 || \
                log "warning: setsebool failed; nginx will get 502 under enforcing SELinux"
        fi
    fi
    if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
        log "firewalld: opening http"
        run firewall-cmd --permanent --add-service=http >/dev/null || true
        run firewall-cmd --reload >/dev/null || true
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
    # Enable only when the unit actually exists: with --replace-unit withheld
    # and nothing previously installed, `enable` fails and set -e kills the run
    # after everything else has already been put in place.
    if [ -f /etc/systemd/system/kernel-ai.service ] || systemctl cat kernel-ai.service >/dev/null 2>&1; then
        run systemctl enable kernel-ai.service
        run systemctl restart kernel-ai.service
    else
        log "warning: no kernel-ai.service unit; nothing enabled or started"
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
pick_python || die "no python >= ${MIN_PY_MAJOR}.${MIN_PY_MINOR} found (tried python3.13 down to python3)"
log "python: $PY ($("$PY" -V 2>&1))"
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
# The installed tree, not $SRC: a tarball or checkout the user downloaded to
# /tmp may well be gone by the time they want to uninstall.
log "  uninstall: sudo $PREFIX/install/uninstall.sh --prefix $PREFIX"
