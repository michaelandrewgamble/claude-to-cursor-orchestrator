#!/usr/bin/env bash
# composer-stop.sh
# Cursor "stop" hook for agent orchestration.
# Polls AGENT_STATE.json until ownership returns to Composer, then emits a
# followup_message so the SAME Composer thread continues (no new tab).
#
# Exits silently (lets Composer stop) when:
#   - AGENT_STATE.json doesn't exist (this project isn't orchestrating)
#   - status is DONE / BLOCKED / ESCALATE_TO_HUMAN
#   - polling times out
#
# Returns {"followup_message": "..."} when owner becomes Composer with actionable status.

set -uo pipefail

# Cursor passes the workspace root. Fall back to PWD.
WORKSPACE="${CURSOR_WORKSPACE_ROOT:-$PWD}"
STATE_FILE="$WORKSPACE/AGENT_STATE.json"

# No orchestration in this project - silently stop
[ -f "$STATE_FILE" ] || exit 0

# Need jq
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

POLL_INTERVAL=3
MAX_WAIT_SECONDS=270   # under the 300s hook timeout
elapsed=0

# Flag file: tells the orchestrator that this Composer thread is alive and
# will handle the next owner=Composer state via followup_message. The
# orchestrator MUST skip firing a new deeplink while this flag exists.
ACTIVE_FLAG="$WORKSPACE/.composer-thread-active"

# Always clean up the flag on exit, no matter how we exit
trap 'rm -f "$ACTIVE_FLAG"' EXIT INT TERM

# Mark thread active for the duration of polling
touch "$ACTIVE_FLAG"

while [ "$elapsed" -lt "$MAX_WAIT_SECONDS" ]; do
  owner=$(jq -r '.owner // ""' "$STATE_FILE" 2>/dev/null)
  status=$(jq -r '.status // ""' "$STATE_FILE" 2>/dev/null)

  case "$status" in
    DONE|BLOCKED|ESCALATE_TO_HUMAN)
      # Terminal state - let Composer stop. trap removes flag.
      exit 0
      ;;
  esac

  if [ "$owner" = "Composer" ]; then
    next_action=$(jq -r '.nextAction // "Act per AGENT_STATE.json"' "$STATE_FILE")
    # Keep flag in place — the followup_message keeps THIS thread alive and
    # the stop hook will fire again at the end of the next turn.
    jq -n --arg msg "Read AGENT_STATE.json. You are owner=Composer. $next_action" \
      '{followup_message: $msg}'
    # Don't trap-remove the flag here; the next iteration's stop hook will
    # touch it fresh. But to avoid orchestrator racing now, leave it until
    # composer actually finishes the next action.
    trap - EXIT INT TERM
    exit 0
  fi

  sleep "$POLL_INTERVAL"
  elapsed=$((elapsed + POLL_INTERVAL))
done

# Timed out - let Composer stop normally. trap removes flag.
exit 0
