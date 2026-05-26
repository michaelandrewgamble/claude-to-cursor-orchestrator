#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const chokidar = require('chokidar');

const STATE_FILE = 'AGENT_STATE.json';
const CONFIG_FILE = '.orchestrator.config.json';
const ORCH_STATE_FILE = '.agent-orchestrator-state.json';

let lastOwner = null;
let lastStatus = null;
let isProcessing = false;

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m'
};

function log(message, color = colors.reset) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`${color}[${timestamp}]${colors.reset} ${message}`);
}

function loadConfig() {
  const configPath = path.resolve(process.cwd(), CONFIG_FILE);
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
      log(`Could not parse ${CONFIG_FILE}: ${err.message}`, colors.yellow);
    }
  }
  return {
    cursorAppName: 'Cursor',
    autoSubmit: true,
    autoSubmitDelayMs: 800,
    soundOnNotify: true
  };
}

function readState(statePath) {
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (err) {
    log(`Could not read state: ${err.message}`, colors.red);
    return null;
  }
}

function readOrchState() {
  const p = path.resolve(process.cwd(), ORCH_STATE_FILE);
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

function writeOrchState(data) {
  const p = path.resolve(process.cwd(), ORCH_STATE_FILE);
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function claudeSessionDir(workspacePath) {
  const encoded = workspacePath.replace(/\//g, '-');
  return path.join(os.homedir(), '.claude/projects', encoded);
}

function listClaudeSessionUuids(workspacePath) {
  const dir = claudeSessionDir(workspacePath);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.jsonl') && !f.startsWith('agent-'))
    .map(f => f.replace(/\.jsonl$/, ''));
}

async function discoverNewClaudeSession(workspacePath, beforeUuids, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const current = listClaudeSessionUuids(workspacePath);
    const newOnes = current.filter(u => !beforeUuids.includes(u));
    if (newOnes.length > 0) return newOnes[0];
    await new Promise(r => setTimeout(r, 400));
  }
  return null;
}

function copyToClipboard(text) {
  try {
    const proc = spawn('pbcopy', [], { stdio: ['pipe', 'inherit', 'inherit'] });
    proc.stdin.write(text);
    proc.stdin.end();
    return true;
  } catch (err) {
    return false;
  }
}

function showNotification(title, message, sound = true) {
  try {
    const soundClause = sound ? ' sound name "Glass"' : '';
    const safeTitle = title.replace(/"/g, '\\"');
    const safeMsg = message.replace(/"/g, '\\"');
    const script = `display notification "${safeMsg}" with title "${safeTitle}"${soundClause}`;
    spawn('osascript', ['-e', script], { stdio: 'ignore' });
  } catch (err) {
  }
}

function openUri(uri) {
  return new Promise((resolve, reject) => {
    const proc = spawn('open', [uri], { stdio: 'ignore' });
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`open exited ${code}`)));
    proc.on('error', reject);
  });
}

function runOsascript(script) {
  return new Promise((resolve, reject) => {
    const proc = spawn('osascript', ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `osascript exited ${code}`)));
    proc.on('error', reject);
  });
}

function sendReturnKeystroke(delayMs, appName = 'Cursor', mode = 'simple') {
  // mode: 'simple'        -> just Cmd+Return + Return (for fresh tab with prompt loaded)
  //       'aggressive'    -> Return → wait 3s → Cmd+Return + Return (handle URL modal)
  //       'paste-submit'  -> clear input, paste clipboard, then Cmd+Return + Return (for focused existing tab)
  let body;
  if (mode === 'aggressive') {
    body = `
      tell application "System Events" to keystroke return
      delay 3.0
      tell application "${appName}" to activate
      delay 0.3
      tell application "System Events"
        keystroke return using command down
        delay 0.4
        keystroke return
      end tell
    `;
  } else if (mode === 'paste-submit') {
    body = `
      tell application "System Events"
        keystroke "a" using command down
        delay 0.1
        key code 51
        delay 0.1
        keystroke "v" using command down
        delay 0.3
        keystroke return using command down
        delay 0.3
        keystroke return
      end tell
    `;
  } else {
    body = `
      tell application "System Events"
        keystroke return using command down
        delay 0.3
        keystroke return
      end tell
    `;
  }

  const script = `
    delay ${(delayMs / 1000).toFixed(2)}
    tell application "${appName}" to activate
    delay 0.5
    ${body}
  `;
  return runOsascript(script);
}

async function triggerClaudeCode(prompt, config) {
  log('Triggering Claude Code via URI handler...', colors.cyan);
  copyToClipboard(prompt);

  const orchState = readOrchState();
  let sessionId = config.claudeSessionId || orchState.claudeSessionId || null;

  // Snapshot existing Claude session UUIDs so we can detect a brand-new one
  // (created by this trigger) without grabbing some other concurrent session.
  const beforeUuids = sessionId ? null : listClaudeSessionUuids(process.cwd());

  let uri = `cursor://anthropic.claude-code/open?prompt=${encodeURIComponent(prompt)}`;
  if (sessionId) uri += `&session=${encodeURIComponent(sessionId)}`;

  try {
    await openUri(uri);
    log(sessionId ? `Existing tab focused (session ${sessionId.slice(0, 8)}…)` : 'Tab opened with prompt pre-filled', colors.green);
  } catch (err) {
    log(`URI handler failed: ${err.message}. Fallback: paste from clipboard.`, colors.yellow);
    showNotification('Claude Code', 'Paste from clipboard', config.soundOnNotify);
    return;
  }

  // Discover and remember the new session UUID so future triggers reuse it.
  // Done after auto-submit so Claude has time to write to disk.
  const captureSession = async () => {
    if (sessionId || !beforeUuids) return;
    const newId = await discoverNewClaudeSession(process.cwd(), beforeUuids, 12000);
    if (newId) {
      const current = readOrchState();
      writeOrchState({ ...current, claudeSessionId: newId });
      log(`Captured Claude session UUID: ${newId.slice(0, 8)}… (will reuse next time)`, colors.cyan);
    } else {
      log('Could not discover new Claude session UUID (will retry next trigger)', colors.yellow);
    }
  };

  if (config.autoSubmit) {
    try {
      // If we reused an existing session, the URI handler focuses the tab but
      // does NOT load the new prompt - we must paste from clipboard instead.
      // If new tab, prompt was pre-filled by URI handler - just submit.
      const mode = sessionId ? 'paste-submit' : 'simple';
      await sendReturnKeystroke(config.autoSubmitDelayMs || 800, config.cursorAppName, mode);
      log(`Auto-submitted via ${mode} sequence`, colors.green);
    } catch (err) {
      log(`Auto-submit failed (grant Accessibility permission?): ${err.message}`, colors.yellow);
      showNotification('Claude Code', 'Press Enter to submit', config.soundOnNotify);
    }
  } else {
    log('Press Enter to submit', colors.yellow);
    showNotification('Claude Code', 'Press Enter to submit', config.soundOnNotify);
  }

  // Capture the session UUID (waits up to 12s for new .jsonl to appear)
  await captureSession();
}

async function triggerCursorComposer(prompt, config) {
  // If a Composer thread is currently alive (stop hook is polling), skip the
  // deeplink — the hook will deliver the prompt via followup_message and the
  // SAME thread continues. Firing a new deeplink would create a duplicate tab.
  const activeFlag = path.resolve(process.cwd(), '.composer-thread-active');
  if (fs.existsSync(activeFlag)) {
    log('Composer thread already alive (hook will handle via followup_message) — skipping deeplink', colors.magenta);
    return;
  }

  log('Triggering Cursor Composer via deeplink...', colors.magenta);
  copyToClipboard(prompt);

  const uri = `cursor://anysphere.cursor-deeplink/prompt?text=${encodeURIComponent(prompt)}`;
  try {
    await openUri(uri);
    log('Composer opened with prompt pre-filled', colors.green);
  } catch (err) {
    log(`Deeplink failed: ${err.message}. Fallback: paste from clipboard.`, colors.yellow);
    showNotification('Cursor Composer', 'Paste from clipboard', config.soundOnNotify);
    return;
  }

  if (config.autoSubmit) {
    try {
      // Cursor Composer's modal appears EVERY trigger (no permanent dismiss).
      // Always use aggressive sequence: Return → wait 3s → Cmd+Return + Return.
      await sendReturnKeystroke(config.autoSubmitDelayMs || 800, config.cursorAppName, 'aggressive');
      log('Auto-submitted via aggressive sequence (modal handling)', colors.green);
    } catch (err) {
      log(`Auto-submit failed (grant Accessibility permission?): ${err.message}`, colors.yellow);
      showNotification('Cursor Composer', 'Press Enter to submit', config.soundOnNotify);
    }
  } else {
    log('Press Enter / click Send to submit', colors.yellow);
    showNotification('Cursor Composer', 'Press Enter to submit', config.soundOnNotify);
  }
}

async function handleStateChange(state, config) {
  if (isProcessing) return;

  if (state.owner === lastOwner && state.status === lastStatus) return;

  log(`\n${'='.repeat(60)}`, colors.bright);
  log(`State: ${lastOwner || 'None'}/${lastStatus || 'None'} → ${state.owner}/${state.status}`, colors.bright);
  log(`${'='.repeat(60)}\n`, colors.bright);

  lastOwner = state.owner;
  lastStatus = state.status;
  isProcessing = true;

  try {
    if (state.humanEscalation || state.status === 'ESCALATE_TO_HUMAN' || state.status === 'BLOCKED') {
      log(`HUMAN ATTENTION: ${state.escalationReason || state.status}`, colors.red);
      showNotification('Agent Orchestrator', `Action needed: ${state.status}`, config.soundOnNotify);
      return;
    }

    if (state.status === 'DONE') {
      log('Workflow complete', colors.green);
      showNotification('Agent Orchestrator', 'Workflow complete', false);
      return;
    }

    if (state.status === 'APPROVED_FOR_BUILD') {
      log(`Build approved — awaiting human: ${state.nextAction}`, colors.yellow);
      showNotification('Agent Orchestrator', 'Build approved — your turn', config.soundOnNotify);
      return;
    }

    const prompt = `Read AGENT_STATE.json. You are owner=${state.owner}. ${state.nextAction || 'Act per nextAction.'}`;

    if (state.owner === 'Claude') {
      await triggerClaudeCode(prompt, config);
    } else if (state.owner === 'Composer') {
      triggerCursorComposer(prompt, config);
    } else if (state.owner === 'Human') {
      log('Human turn', colors.yellow);
      showNotification('Agent Orchestrator', `Your turn: ${state.nextAction || ''}`, config.soundOnNotify);
    }
  } finally {
    setTimeout(() => { isProcessing = false; }, 1500);
  }
}

function startWatching() {
  const statePath = path.resolve(process.cwd(), STATE_FILE);

  if (!fs.existsSync(statePath)) {
    log(`${STATE_FILE} not found in ${process.cwd()}`, colors.red);
    process.exit(1);
  }

  const config = loadConfig();

  log('Agent Orchestrator started', colors.green);
  log(`Watching: ${statePath}`, colors.cyan);
  log(`Config: autoSubmit=${config.autoSubmit} (delay=${config.autoSubmitDelayMs}ms), sound=${config.soundOnNotify}`, colors.cyan);
  log(`${'='.repeat(60)}`, colors.bright);

  const state = readState(statePath);
  if (state) {
    log(`Initial: owner=${state.owner}, status=${state.status}`, colors.cyan);
    lastOwner = state.owner;
    lastStatus = state.status;
  }

  const watcher = chokidar.watch(statePath, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 }
  });

  watcher.on('change', async () => {
    const newState = readState(statePath);
    if (newState) await handleStateChange(newState, config);
  });

  watcher.on('error', (err) => log(`Watcher error: ${err.message}`, colors.red));

  process.on('SIGINT', () => {
    log('Shutting down...', colors.yellow);
    watcher.close();
    process.exit(0);
  });
}

if (require.main === module) {
  startWatching();
}

module.exports = { startWatching, readState };
