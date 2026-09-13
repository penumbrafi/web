#!/bin/sh
# /usr/local/sbin/veil-swap
#
# Blue/green upstream swap for Veil. Root-owned wrapper the deploy user
# calls via sudo (see deploy/README.md for the sudoers entry). Nothing
# else in the deploy path talks to nginx.
#
# Usage:
#   veil-swap blue       # active traffic -> blue on :3001
#   veil-swap green      # active traffic -> green on :3002
#   veil-swap active     # print the currently active colour to stdout
#
# The active colour is recorded in /opt/penumbra-veil/active so a fresh
# workflow run can read it without shell-out. The nginx include is
# rewritten atomically (write to .tmp, rename), then `nginx -t` gates
# the reload — if the config is somehow broken we never touch the live
# worker set.

set -eu

NGINX_INCLUDE=/etc/nginx/veil-upstream.conf
ACTIVE_FILE=/opt/penumbra-veil/active

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

# Verify the target unit is up and serving before we point nginx at it.
# Refusing to swap onto a broken target is the whole point of blue/green.
if ! /usr/bin/systemctl is-active --quiet "penumbra-veil@${target}.service"; then
    echo "veil-swap: penumbra-veil@${target}.service is not active — refusing to swap" >&2
    exit 65
fi
if ! /usr/bin/curl -fsS -m 5 -o /dev/null "http://127.0.0.1:${new_port}/"; then
    echo "veil-swap: ${target} on :${new_port} did not answer / — refusing to swap" >&2
    exit 66
fi

tmp=$(/usr/bin/mktemp "${NGINX_INCLUDE}.XXXXXX")
cat > "$tmp" <<NGX
upstream veil {
    server 127.0.0.1:${new_port};
    server 127.0.0.1:${old_port} backup;
    keepalive 32;
}
NGX
/bin/chmod 0644 "$tmp"
/bin/mv -f "$tmp" "$NGINX_INCLUDE"

if ! /usr/sbin/nginx -t 2>/dev/null; then
    echo "veil-swap: nginx -t failed after include rewrite — rolling back" >&2
    # Restore whatever was there before by pointing the include back at
    # $old (best-effort; the same rewrite that just landed is the culprit).
    cat > "$NGINX_INCLUDE" <<NGX
upstream veil {
    server 127.0.0.1:${old_port};
    keepalive 32;
}
NGX
    exit 67
fi

/usr/sbin/nginx -s reload
echo "$target" > "$ACTIVE_FILE"
echo "veil-swap: active colour is now ${target} on :${new_port} (backup: ${old}:${old_port})"
