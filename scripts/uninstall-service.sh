#!/bin/bash
# Stops the background service, removes it, and unblocks all sites.
set -euo pipefail

LABEL="com.focusmode.blocker"
APP_DIR="/usr/local/lib/focus-mode"
PLIST="/Library/LaunchDaemons/${LABEL}.plist"
NODE_BIN="${NODE_BIN:-${npm_node_execpath:-$(command -v node || true)}}"

sudo -v
sudo launchctl bootout "system/${LABEL}" 2>/dev/null || true
sudo rm -f "$PLIST"

if [ -f "$APP_DIR/server.js" ] && [ -x "$NODE_BIN" ]; then
    sudo "$NODE_BIN" "$APP_DIR/server.js" --unblock
fi

if [ "${1:-}" = "--purge" ]; then
    sudo rm -rf "$APP_DIR"
    echo "Removed $APP_DIR (including your history and settings)."
else
    sudo rm -rf "$APP_DIR/public" "$APP_DIR/node_modules" "$APP_DIR/server.js"
    echo "Your history and settings are kept in $APP_DIR/data. Use --purge to delete them."
fi

echo "Focus Mode has been uninstalled and all sites are unblocked."
