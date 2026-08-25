#!/usr/bin/env bash
# Start Handy (hidden to tray) if it is not already running.
# Safe to call repeatedly, e.g. from a login item, launchd, or a hotkey daemon.
set -euo pipefail

APP="/Applications/Handy.app"

if pgrep -xq handy; then
  echo "Handy is already running."
  exit 0
fi

if [ ! -d "$APP" ]; then
  echo "error: $APP not found" >&2
  exit 1
fi

# -g: do not bring it to the foreground; --start-hidden: tray icon only,
# no main window (runtime flag, does not change persisted settings).
open -g -a "$APP" --args --start-hidden
echo "Handy started."
