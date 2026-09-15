#!/bin/sh
# /usr/local/sbin/preview-ctl
#
# Root-owned wrapper the CI account is allowed to sudo. Exactly two
# operations, one target unit shape, PR number validated as 1..9999.
#
#   preview-ctl start   <pr>   enable + start (idempotent)
#   preview-ctl stop    <pr>   stop + disable + tear the release tree down
#
# `sudoers` grants only `/usr/local/sbin/preview-ctl start [0-9]*` and
# `/usr/local/sbin/preview-ctl stop  [0-9]*`, so the CI account cannot
# reach anything else via systemctl. The digit-glob in the sudoers pattern
# only matches the first argument's shape; this script does its own
# strict validation so a shell metacharacter can't slip through even if
# sudoers were widened.

set -eu

usage() {
    echo "usage: preview-ctl {start|stop} <pr>" >&2
    exit 64
}

[ $# -eq 2 ] || usage

op=$1
pr=$2

case "$op" in
    start|stop) ;;
    *) usage ;;
esac

case "$pr" in
    ""|*[!0-9]*) usage ;;
    0*) usage ;;
esac
if [ "$pr" -lt 1 ] || [ "$pr" -gt 9999 ]; then
    usage
fi

unit="penumbra-veil-preview@${pr}.service"
tree="/opt/penumbra-veil-previews/${pr}"

case "$op" in
    start)
        /usr/bin/systemctl enable --now  "$unit"
        /usr/bin/systemctl restart      "$unit"
        # Poll until active (or timeout) so callers can inspect exit.
        i=0
        while ! /usr/bin/systemctl is-active --quiet "$unit"; do
            i=$((i + 1))
            if [ "$i" -ge 20 ]; then
                /usr/bin/systemctl is-active "$unit" >&2 || true
                exit 1
            fi
            sleep 1
        done
        ;;
    stop)
        # `|| true` because either step may already be a no-op after a
        # failed earlier deploy.
        /usr/bin/systemctl disable --now "$unit" 2>/dev/null || true
        # rm only against a path we constructed ourselves from a validated
        # numeric PR. Never `rm` a bare $tree — sanity-check it is a
        # subdirectory of the expected root.
        case "$tree" in
            /opt/penumbra-veil-previews/[1-9]*)
                if [ -d "$tree" ]; then
                    /bin/rm -rf -- "$tree"
                fi
                ;;
            *) echo "preview-ctl: refusing to rm $tree" >&2; exit 66 ;;
        esac
        ;;
esac
