# Claude to Cursor Orchestrator

Autonomous multi-agent orchestration between Claude Code and Cursor Composer using a shared handoff file.

## Overview

This tool enables two AI coding agents to work together autonomously:
- **Claude Code** acts as principal maintainer/reviewer
- **Cursor Composer** acts as junior implementation agent
- **Human operator** only intervenes when needed

The orchestrator watches a shared `AGENT_HANDOFF.md` file and automatically triggers the next agent when ownership changes.

## Installation

### As a Git Submodule (Recommended)

Add to your project:

```bash
git submodule add https://github.com/yourusername/claude-to-cursor-orchestrator .agent-orchestrator
cd .agent-orchestrator
npm install
```

### Standalone Installation

Clone the repo:

```bash
git clone https://github.com/yourusername/claude-to-cursor-orchestrator
cd claude-to-cursor-orchestrator
npm install
```

## Usage

### 1. Create AGENT_HANDOFF.md

Create an `AGENT_HANDOFF.md` file in your project root. See [AGENT_HANDOFF.template.md](./AGENT_HANDOFF.template.md) for a starter template.

### 2. Start the Orchestrator

From your project directory:

```bash
# If installed as submodule
node .agent-orchestrator/watch-handoff.js

# If installed standalone
node /path/to/claude-to-cursor-orchestrator/watch-handoff.js
```

### 3. Trigger the First Agent

Paste the initial prompt into either Cursor Composer or Claude Code to start the workflow.

### 4. Watch the Agents Work

The orchestrator will automatically hand off between agents as they update the coordination state.

## How It Works

### Coordination State

The orchestrator monitors these fields in `AGENT_HANDOFF.md`:

```markdown
## Coordination State

- **Status:** WAITING_FOR_COMPOSER
- **Current owner:** Composer
- **Last updated by:** Claude
- **Next action:** [What the current owner should do]
- **Human escalation needed:** No
- **Human escalation reason:** None
```

### Ownership Transfer

When an agent updates the file and changes the `Current owner` field, the orchestrator:

1. Detects the change
2. Parses the new state
3. Automatically triggers the new owner agent with the appropriate prompt
4. Displays status in the terminal

### Status Values

- `WAITING_FOR_COMPOSER` - Composer should act
- `WAITING_FOR_CLAUDE_REVIEW` - Claude should review
- `APPROVED_FOR_BUILD` - Ready for build/test
- `REQUEST_CHANGES` - Changes needed
- `BLOCKED` - Cannot proceed
- `ESCALATE_TO_HUMAN` - Human intervention required
- `DONE` - Workflow complete

## Agent Integration

### Claude Code Integration

The orchestrator attempts to trigger Claude Code using:
- VSCode command: `code --command claude.sendMessage`

If auto-triggering fails, the orchestrator displays the prompt to manually copy-paste.

### Cursor Composer Integration

The orchestrator attempts to trigger Cursor Composer using:
- Cursor CLI: `cursor-agent --prompt "..." --cwd <dir>`

If auto-triggering fails, the orchestrator displays the prompt to manually copy-paste.

## Manual Fallback

If automatic triggering doesn't work (e.g., Cursor API credits exhausted), the orchestrator displays:

```
📋 Please manually send to Cursor Composer:
   "Read AGENT_HANDOFF.md. Check Coordination State. Act according to Next action."
```

Simply copy-paste this into the appropriate agent window.

## Requirements

- Node.js >= 16.0.0
- VSCode with Claude Code extension (for Claude Code integration)
- Cursor IDE (for Cursor Composer integration)
- An `AGENT_HANDOFF.md` file in your project root

## Troubleshooting

### "AGENT_HANDOFF.md not found"

Make sure you're running the orchestrator from a directory that contains `AGENT_HANDOFF.md`.

### Agents not triggering automatically

This is expected behavior if:
- Claude Code/Cursor don't support programmatic triggering yet
- The CLI commands aren't in your PATH
- Cursor API credits are exhausted

Use the manual fallback: copy the displayed prompt into the agent window.

### Multiple triggers

If you see agents triggering multiple times, the file may be updating too rapidly. The orchestrator has debouncing built in, but you can adjust `awaitWriteFinish` settings in `watch-handoff.js`.

## Configuration

Edit `watch-handoff.js` to customize:

- `HANDOFF_FILE` - Name of the coordination file (default: `AGENT_HANDOFF.md`)
- `CHECK_INTERVAL` - Polling interval in milliseconds
- Agent trigger commands

## License

MIT

## Contributing

PRs welcome! Please ensure:
- Changes work with both automatic and manual fallback modes
- Terminal output remains clear and actionable
- No dependencies on proprietary APIs
