# Claude-to-Cursor Orchestrator

Zero-intervention multi-agent orchestration between **Cursor Composer** and **Claude Code** (the Cursor plugin), with both agents visible in their native UIs.

## What It Does

Two AI coding agents ping-pong work between themselves autonomously:

- **Cursor Composer** is the junior implementation agent
- **Claude Code** is the principal maintainer/reviewer
- **You (human)** only intervene when an agent escalates or a workflow requires explicit approval (build, commit, etc.)

The orchestration ships work via a small `AGENT_STATE.json` file. When ownership changes, the orchestrator deeplinks the next agent and the keystroke chain auto-submits — no clipboard pasting, no clicking.

**Validated end-to-end**: a 4-turn workflow runs with **1 Composer tab + 1 Claude tab** total, zero manual clicks.

## Architecture

```
┌─────────────────────┐                 ┌─────────────────────┐
│  Cursor Composer    │ ── stop hook ── │  Composer continues │
│  (one persistent    │   keeps thread  │   via followup_msg  │
│   chat thread)      │      alive      │                     │
└─────────────────────┘                 └─────────────────────┘
          │                                       ▲
          │ writes                                │
          ▼                                       │
   ┌─────────────────────────────┐                │
   │      AGENT_STATE.json       │                │
   │  (owner, status, action)    │                │
   └─────────────────────────────┘                │
          ▲                                       │
          │ writes                                │
          │                                       │
┌─────────────────────┐                           │
│   Claude Code       │ ◄──── orchestrator ──────┘
│  (one persistent    │    paste-submit via       
│   tab, UUID reused) │    URI handler            
└─────────────────────┘                           
```

### Per-agent mechanics

| Agent | Trigger | Continuity |
|---|---|---|
| **Cursor Composer** | `cursor://anysphere.cursor-deeplink/prompt?text=...` deeplink + aggressive keystroke (Return → wait 3s for URL modal to settle → Cmd+Return + Return) | `.cursor/hooks/composer-stop.sh` polls `AGENT_STATE.json` and emits `followup_message` JSON to keep the same Composer thread alive across handoffs |
| **Claude Code** | `vscode://anthropic.claude-code/open?session=<uuid>&prompt=...` URI handler | Session UUID is auto-discovered after first trigger by snapshotting `~/.claude/projects/<workspace>/*.jsonl`. Subsequent triggers focus the same tab and use **paste-submit** (Cmd+A → Delete → Cmd+V → Cmd+Return) because the URI handler ignores the prompt parameter when focusing an existing session |

### One-time macOS setup

- **Accessibility permission** for whichever app spawns `node` (typically Cursor for the integrated terminal)
- **Don't show again** on the macOS "Open URL in Cursor" dialog for `cursor://anthropic.claude-code/` (one-time prompt the first time)
- Cursor's Composer URL modal cannot be permanently dismissed — the orchestrator's aggressive sequence handles it on every Composer trigger

## Installation

### As a Git Submodule (Recommended)

```bash
git submodule add https://github.com/michaelandrewgamble/claude-to-cursor-orchestrator .agent-orchestrator
cd .agent-orchestrator && npm install
```

### Standalone

```bash
git clone https://github.com/michaelandrewgamble/claude-to-cursor-orchestrator
cd claude-to-cursor-orchestrator && npm install
```

## Setup in a Project

You need 4 files in your project:

### 1. `AGENT_STATE.json`

The coordination state (kept small — read every turn):

```json
{
  "status": "DONE",
  "owner": "None",
  "lastUpdatedBy": "Human",
  "nextAction": "No active task",
  "humanEscalation": false,
  "escalationReason": null,
  "currentTask": null,
  "updatedAt": "2026-05-26T20:00:00Z"
}
```

Valid `status` values: `WAITING_FOR_COMPOSER`, `WAITING_FOR_CLAUDE_REVIEW`, `APPROVED_FOR_BUILD`, `REQUEST_CHANGES`, `BLOCKED`, `ESCALATE_TO_HUMAN`, `DONE`.
Valid `owner` values: `Composer`, `Claude`, `Human`, `None`.

### 2. `.cursor/rules/agent-orchestration.mdc`

Tells Composer how to participate in the protocol. Example included in this repo's `examples/`.

### 3. `.cursor/hooks.json` + `.cursor/hooks/composer-stop.sh`

Cursor stop hook that keeps the Composer thread alive across handoffs:

```json
{
  "version": 1,
  "loop_limit": null,
  "hooks": {
    "stop": [
      { "command": "bash .cursor/hooks/composer-stop.sh", "timeout": 300 }
    ]
  }
}
```

The hook script polls `AGENT_STATE.json` and emits `{"followup_message": "..."}` when ownership returns to Composer. See `examples/composer-stop.sh`.

### 4. `.orchestrator.config.json` (optional)

```json
{
  "cursorAppName": "Cursor",
  "autoSubmit": true,
  "autoSubmitDelayMs": 800,
  "soundOnNotify": true,
  "claudeSessionId": null
}
```

Setting `claudeSessionId` explicitly skips auto-discovery (useful if you want to pin a specific tab).

## Running

From your project root:

```bash
node .agent-orchestrator/watch-handoff.js
```

Run it in Cursor's integrated terminal so macOS Accessibility applies to Cursor. Leave it running while you work.

To start a task, write the initial state:

```bash
# AGENT_STATE.json
{
  "status": "WAITING_FOR_COMPOSER",
  "owner": "Composer",
  "nextAction": "...detailed instructions...",
  ...
}
```

The orchestrator detects the change and fires Composer. From there it's hands-off.

## Operating Rules

The protocol assumes:

1. Only the current owner acts
2. Composer cannot approve its own work or make architectural decisions
3. Claude approves, requests changes, or escalates
4. Build/test/commit/push always requires human approval (Claude sets `APPROVED_FOR_BUILD`, you act)
5. Agents append to `AGENT_LOG.md`, never rewrite prior entries
6. Scope/version/release questions go up the chain: Composer → Claude → Human

## Troubleshooting

### Auto-submit doesn't actually send

- macOS Accessibility permission missing for the app running `node`. System Settings → Privacy & Security → Accessibility → enable that app.
- "Open URL in Cursor" modal blocking on first invocation. Check "Don't show again" the first time it appears (Claude Code URI scheme).

### New tab spawns each Composer turn

- Stop hook didn't fire or `.cursor/hooks.json` not loaded. Restart Cursor. Verify `bash .cursor/hooks/composer-stop.sh` runs successfully from your shell.
- `.composer-thread-active` flag stale. Delete it and let the next turn re-create.

### New tab spawns each Claude turn

- Session UUID auto-discovery failed (Claude didn't write `.jsonl` fast enough). Check `~/.claude/projects/<encoded-workspace>/` for the expected UUID file.
- Captured UUID points to a closed tab. Delete `.agent-orchestrator-state.json` and let next trigger re-capture.

### `.jsonl` flush latency

Claude Code occasionally doesn't flush session transcripts to disk immediately ([known issue](https://github.com/anthropics/claude-code/issues/20612)). Discovery has a 12s window. If it consistently misses, you can pin the session UUID manually in `.orchestrator.config.json`.

## Limitations

- **macOS only** (uses `osascript` for keystroke automation and URI handlers)
- **Composer URL modal recurs** every trigger (Cursor security policy, no permanent dismiss). Adds ~3s latency per Composer turn.
- **Auto-submission is technically a Cursor security bypass** via osascript keystrokes. Use at your own risk in shared environments.
- **Session token usage grows** with continuous Composer thread (no compaction across handoffs)

## License

MIT
