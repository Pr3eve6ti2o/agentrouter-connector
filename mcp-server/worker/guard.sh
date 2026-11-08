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
SCRIPT_DIR="$(dirname -- "$0")" || exit 1
CDPATH= cd -- "$SCRIPT_DIR/.." || exit 1
ROOT="$(pwd)" || exit 1
JOBS_DIR="${AGENTROUTER_JOBS_PATH:-$ROOT/jobs}"
mkdir -p -- "$JOBS_DIR" || exit 1

worker_pid_file="${JOBS_DIR}/worker.pid"
if [[ -e "$worker_pid_file" ]]; then
  worker_pid="$(cat -- "$worker_pid_file" 2>/dev/null)" || worker_pid=""
  if [[ "$worker_pid" =~ ^[1-9][0-9]*$ ]] &&
     kill -0 -- "$worker_pid" 2>/dev/null &&
     worker_cwd="$(readlink -f -- "/proc/${worker_pid}/cwd" 2>/dev/null)" &&
     [[ "$worker_cwd" == "$ROOT" ]] &&
     grep -aFq -- 'dist/src/worker.js' "/proc/${worker_pid}/cmdline" 2>/dev/null; then
    exit 0
  fi
  printf 'guard: stale pid file %s; removing\n' "$worker_pid_file" >&2
  rm -f -- "$worker_pid_file"
fi

# Missing executables would otherwise fail only in the background.
for cmd in setsid nohup node; do
  if ! type -P "$cmd" > /dev/null; then
    printf 'guard: required executable not found in PATH: %s\n' "$cmd" >&2
    exit 127
  fi
done

# Load ONLY AGENTROUTER_KEY_1 / AGENTROUTER_KEY_2, without printing
# them and without sourcing the whole keys file (which also contains
# other values the worker does not need).
# Disable tracing before key exports, including tracing from bash -x.
set +x
while IFS='=' read -r name value || [[ -n "$name" || -n "$value" ]]; do
  case "$name" in
    AGENTROUTER_KEY_1|AGENTROUTER_KEY_2) export "$name=$value" || exit 1 ;;
  esac
done < "$HOME/workspace/.agentrouter-keys" || exit 1
export AGENTROUTER_JOBS_PATH="$JOBS_DIR" || exit 1

# Open redirections in the foreground so failures are not hidden by '&'.
{
  setsid nohup node dist/src/worker.js 2>&1 &
  launcher_pid=$!
} >> "$JOBS_DIR/worker.log" < /dev/null || exit 1
printf 'worker launch requested (launcher pid %s)\n' "$launcher_pid"
