# Agent Handoff

This file is the shared communication log between two coding agents working in this repo.

- **Claude Code** is the principal maintainer/reviewer.
- **Cursor Composer** is the junior implementation agent.
- **The human operator** makes final approval decisions.

## Coordination State

- **Status:** WAITING_FOR_COMPOSER
- **Current owner:** Composer
- **Last updated by:** Human
- **Next action:** [Describe the first task here]
- **Human escalation needed:** No
- **Human escalation reason:** None

## Operating Rules

1. Only the current owner should act.
2. Before acting, each agent must read `Coordination State`.
3. After acting, each agent must update `Coordination State`.
4. Composer may implement, summarize, and request review, but must not approve its own work.
5. Claude may approve, request changes, or escalate to the human.
6. Composer may continue automatically only when Claude assigns the next action to Composer.
7. The human should only be involved when Claude sets `Status: ESCALATE_TO_HUMAN` or when a build/test/commit/workflow run requires approval.
8. Long-running commands still require human approval unless Claude explicitly sets `APPROVED_FOR_BUILD`.
9. Agents should append entries to the log, not rewrite prior decisions.
10. If an agent is unsure whether a decision changes scope, shipped behavior, dependency/runtime versions, or build/release strategy, it must defer to Claude. If Claude is unsure, Claude escalates to the human.
11. Append new updates under `Latest Entry`, then move the previous latest entry into `Log`.
12. Do not rewrite or delete prior entries unless the human explicitly asks.
13. Cursor Composer must not make architectural decisions.
14. Claude Code must not broaden scope unless the current patch cannot solve the issue.
15. Every implementation pass must end with a diff summary.
16. Every review pass must end with a clear decision: `APPROVED`, `REQUEST CHANGES`, or `BLOCKED`.
17. Keep entries short, specific, and actionable.
18. Agents may update this file, but should not modify each other's prior entries.
19. Source code changes should be reviewed before builds, commits, or workflow runs.

---

## Current Decision

[Describe the problem you're solving and the approved approach]

---

## Latest Entry

### Pending

**Role:** Human operator

**Task:** Initialize agent handoff system

**Files touched:** `AGENT_HANDOFF.md`

**Summary:** Created coordination file for Claude Code and Cursor Composer collaboration.

**Diff summary:** New file only.

**Risks / questions:** None yet.

**Next requested action:** Begin first implementation task.

---

## Entry Template

### YYYY-MM-DD HH:mm — Agent Name

**Role:** Composer junior implementer / Claude principal reviewer / Human operator

**Decision:** APPROVED / REQUEST CHANGES / BLOCKED / INFO

**Task:**

**Files touched:**

**Summary:**

**Diff summary:**

**Risks / questions:**

**Next requested action:**

---

## Log
