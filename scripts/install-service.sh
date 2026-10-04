#!/bin/bash
# Installs Focus Mode as a background service that starts at boot and restarts
# if it's killed. Run as your normal user: npm run service:install
set -euo pipefail

LABEL="com.focusmode.blocker"
APP_DIR="/usr/local/lib/focus-mode"
PLIST="/Library/LaunchDaemons/${LABEL}.plist"
LOG="/var/log/focus-mode.log"
PORT="${PORT:-7878}"
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="${NODE_BIN:-${npm_node_execpath:-$(command -v node || true)}}"

if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
    echo "Couldn't find node. Re-run with NODE_BIN=/path/to/node npm run service:install"
    exit 1
fi

if [ ! -d "$SRC_DIR/node_modules/express" ]; then
    echo "Installing dependencies..."
    (cd "$SRC_DIR" && npm install --omit=dev --no-audit --no-fund)
fi

echo "Focus Mode needs admin rights to install a system service and edit /etc/hosts."
sudo -v

echo "Copying app to $APP_DIR..."
sudo mkdir -p "$APP_DIR"
sudo rsync -a --delete --exclude data --exclude .git "$SRC_DIR/" "$APP_DIR/"

sudo tee "$PLIST" > /dev/null <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_BIN}</string>
        <string>${APP_DIR}/server.js</string>
    </array>
    <key>WorkingDirectory</key><string>${APP_DIR}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PORT</key><string>${PORT}</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>${LOG}</string>
    <key>StandardErrorPath</key><string>${LOG}</string>
</dict>
</plist>
PLIST
sudo chown root:wheel "$PLIST"
sudo chmod 644 "$PLIST"

sudo launchctl bootout "system/${LABEL}" 2>/dev/null || true
sudo launchctl bootstrap system "$PLIST"
sudo launchctl enable "system/${LABEL}"

for _ in $(seq 1 20); do
    curl -fs "http://localhost:${PORT}/api/state" > /dev/null 2>&1 && break
    sleep 0.25
done

if curl -fs "http://localhost:${PORT}/api/state" > /dev/null 2>&1; then
    echo ""
    echo "Focus Mode is running at http://localhost:${PORT}"
    echo "It starts automatically when your Mac boots. Logs: ${LOG}"
    open "http://localhost:${PORT}"
else
    echo "The service was installed but isn't responding yet. Check the log: sudo tail ${LOG}"
    exit 1
fi
