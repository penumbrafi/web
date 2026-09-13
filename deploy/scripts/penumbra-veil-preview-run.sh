#!/bin/sh
# /usr/local/sbin/penumbra-veil-preview-run
#
# Root-owned launcher for penumbra-veil-preview@.service. Called with the PR
# number as $1 by ExecStart=. Validates, derives PORT, and execs node.
#
# This is called by PID 1 as root (before the User= drop), so `set` is picky
# and no untrusted input reaches a shell operator. The only value systemd
# will pass here is `%i`, which comes from the unit instance name and has
# already been escaped by systemd to a limited charset — but treat it as
# untrusted anyway.

set -eu

pr=${1-}

# Reject anything that is not a plain 1..9999 integer. No leading zeros
# (systemd unit names allow digits but we want the token to match the
# workflow's guard exactly), no signs, no whitespace.
case "$pr" in
    ""|*[!0-9]*) echo "preview-run: bad PR argv" >&2; exit 64 ;;
    0*) echo "preview-run: PR must not have a leading zero" >&2; exit 64 ;;
esac
if [ "$pr" -lt 1 ] || [ "$pr" -gt 9999 ]; then
    echo "preview-run: PR out of range" >&2
    exit 64
fi

port=$((30000 + pr))

# Refuse to start if the tree is not where we expect it. The CI flow builds
# and rsyncs into /opt/penumbra-veil-previews/<pr>/current/ before enabling
# this unit; a missing current/ means either a botched deploy or a stale
# unit that outlived the release directory.
server="/opt/penumbra-veil-previews/${pr}/current/apps/veil/server.js"
if [ ! -f "$server" ]; then
    echo "preview-run: no server.js at $server" >&2
    exit 66
fi

exec env PORT="$port" /usr/bin/node "$server"
