#!/bin/sh
# /usr/local/sbin/veil-swap
#
# Blue/green upstream swap for Veil. Root-owned wrapper the deploy user
# calls via sudo (see deploy/README.md for the sudoers entry).
#
# Usage:
#   veil-swap blue       # active traffic -> blue on :3001
#   veil-swap green      # active traffic -> green on :3002
#   veil-swap active     # print the currently active colour to stdout
#
# Writes both `veil` (prod) and `veil_staging` upstreams into
# /etc/nginx/veil-upstream.conf in one atomic rewrite. Staging always
# points at whichever colour is currently NOT receiving prod traffic
# (i.e. the target of the next promote), so `staging.penumbra.fi` is a
# stable name for "the build about to ship".

set -eu

NGINX_INCLUDE=/etc/nginx/veil-upstream.conf
ACTIVE_FILE=/etc/nginx/veil-active
# Where the backends actually listen. Kept in a single well-known file
# on the nginx host so this script is topology-agnostic — if the veil
# services ever move to a different container the operator edits one
# file and every subsequent swap picks it up. The file just defines
# VEIL_HOST=<ip-or-name>. If missing we default to loopback (which is
# right when nginx and veil live in the same container).
VEIL_HOST_FILE=/etc/nginx/veil-backend-host
VEIL_HOST=127.0.0.1
if [ -r "$VEIL_HOST_FILE" ]; then
    . "$VEIL_HOST_FILE"
fi

port_for() {
    case $1 in
        blue)  echo 3001 ;;
        green) echo 3002 ;;
        *)     echo "veil-swap: unknown colour: $1" >&2; exit 64 ;;
    esac
}

case ${1:-} in
    active)
        if [ -r "$ACTIVE_FILE" ]; then
            cat "$ACTIVE_FILE"
        else
            echo blue
        fi
        exit 0
        ;;
    blue|green)
        target=$1
        ;;
    *)
        echo "usage: veil-swap {blue|green|active}" >&2
        exit 64
        ;;
esac

new_port=$(port_for "$target")
if [ "$target" = blue ]; then
    old=green; old_port=3002
else
    old=blue; old_port=3001
fi

# Verify the target is actually serving. Refusing to swap onto a broken
# target is the whole point of blue/green.
if ! /usr/bin/curl -fsS -m 5 -o /dev/null "http://${VEIL_HOST}:${new_port}/"; then
    echo "veil-swap: ${target} on ${VEIL_HOST}:${new_port} did not answer / — refusing to swap" >&2
    exit 66
fi

tmp=$(/usr/bin/mktemp "${NGINX_INCLUDE}.XXXXXX")
cat > "$tmp" <<NGX
upstream veil {
    server ${VEIL_HOST}:${new_port};
    server ${VEIL_HOST}:${old_port} backup;
    keepalive 32;
}
upstream veil_staging {
    server ${VEIL_HOST}:${old_port};
    keepalive 8;
}
NGX
/bin/chmod 0644 "$tmp"
/bin/mv -f "$tmp" "$NGINX_INCLUDE"

if ! /usr/sbin/nginx -t 2>/dev/null; then
    echo "veil-swap: nginx -t failed after include rewrite — rolling back" >&2
    cat > "$NGINX_INCLUDE" <<NGX
upstream veil {
    server ${VEIL_HOST}:${old_port};
    keepalive 32;
}
upstream veil_staging {
    server ${VEIL_HOST}:${new_port};
    keepalive 8;
}
NGX
    exit 67
fi

/usr/sbin/nginx -s reload
echo "$target" > "$ACTIVE_FILE"
echo "veil-swap: prod = ${target}:${new_port}   staging = ${old}:${old_port}"
