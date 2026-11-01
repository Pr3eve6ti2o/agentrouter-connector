#!/bin/bash
# Relaunch the AgentRouter job worker if it is not running.
# Intended to be run by cron every few minutes and/or at boot, because
# the worker itself does NOT survive VM replacement: only its job state
# (in the workspace jobs directory) survives. This script does not
# regenerate any job; it only restarts the worker, which marks stale
# running jobs as interrupted (auto-resubmit stays off unless
# AGENTROUTER_JOB_AUTO_RESUBMIT=1 is set explicitly).
#
# Keys are read from ~/workspace/.agentrouter-keys the same way
# mcp-chat.mjs reads them: programmatically, never printed, never
# written to a log. Do NOT run this script with keys on its command
# line, and do NOT enable it silently: enabling a recurring guard is a
# separate decision from building the worker.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JOBS_DIR="${AGENTROUTER_JOBS_PATH:-$ROOT/jobs}"
mkdir -p "$JOBS_DIR"

# Bracket pattern so pgrep does not match its own command line.
if pgrep -f "[d]ist/src/worker.js" > /dev/null; then
  exit 0
fi

# Load ONLY AGENTROUTER_KEY_1 / AGENTROUTER_KEY_2, without printing
# them and without sourcing the whole keys file (which also contains
# other values the worker does not need).
while IFS='=' read -r name value; do
  case "$name" in
    AGENTROUTER_KEY_1|AGENTROUTER_KEY_2) export "$name=$value" ;;
  esac
done < "$HOME/workspace/.agentrouter-keys"
export AGENTROUTER_JOBS_PATH="$JOBS_DIR"
cd "$ROOT" || exit 1
setsid nohup node dist/src/worker.js >> "$JOBS_DIR/worker.log" 2>&1 < /dev/null &
echo "worker relaunched pid $!"
