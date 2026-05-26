#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const chokidar = require('chokidar');

// Configuration
const HANDOFF_FILE = 'AGENT_HANDOFF.md';
const CHECK_INTERVAL = 1000; // ms between state checks

// State tracking
let lastOwner = null;
let isProcessing = false;

// ANSI color codes
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

function parseHandoffFile(content) {
  const statusMatch = content.match(/Status:\s*(\w+)/);
  const ownerMatch = content.match(/Current owner:\s*(\w+)/);
  const nextActionMatch = content.match(/Next action:\s*(.+?)(?=\n-|\n\n)/s);
  const escalationMatch = content.match(/Human escalation needed:\s*(\w+)/);

  return {
    status: statusMatch ? statusMatch[1] : null,
    owner: ownerMatch ? ownerMatch[1] : null,
    nextAction: nextActionMatch ? nextActionMatch[1].trim() : null,
    needsEscalation: escalationMatch ? escalationMatch[1].toLowerCase() === 'yes' : false
  };
}

function triggerClaudeCode(nextAction) {
  log('Triggering Claude Code...', colors.cyan);

  const prompt = `Read AGENT_HANDOFF.md. Check Coordination State. You are the current owner. ${nextAction}`;

  // Method 1: Try VSCode command (if extension supports it)
  const vscode = spawn('code', ['--command', 'claude.sendMessage', prompt], {
    stdio: 'inherit',
    shell: true
  });

  vscode.on('error', (err) => {
    log(`⚠️  Could not auto-trigger Claude Code: ${err.message}`, colors.yellow);
    log('📋 Please manually send to Claude Code:', colors.yellow);
    log(`   "${prompt}"`, colors.bright);
  });

  vscode.on('close', (code) => {
    if (code === 0) {
      log('✅ Claude Code triggered successfully', colors.green);
    }
  });
}

function triggerCursorComposer(nextAction) {
  log('Triggering Cursor Composer...', colors.magenta);

  const prompt = `Read AGENT_HANDOFF.md. Check Coordination State. You are the current owner. ${nextAction}`;

  // Method 1: Try Cursor CLI
  const cursor = spawn('cursor-agent', ['--prompt', prompt, '--cwd', process.cwd()], {
    stdio: 'inherit',
    shell: true
  });

  cursor.on('error', (err) => {
    log(`⚠️  Could not auto-trigger Cursor Composer: ${err.message}`, colors.yellow);
    log('📋 Please manually send to Cursor Composer:', colors.yellow);
    log(`   "${prompt}"`, colors.bright);
  });

  cursor.on('close', (code) => {
    if (code === 0) {
      log('✅ Cursor Composer triggered successfully', colors.green);
    }
  });
}

function handleStateChange(state) {
  if (isProcessing) {
    log('⏳ Already processing a state change, skipping...', colors.yellow);
    return;
  }

  // Check if owner changed
  if (state.owner === lastOwner) {
    return;
  }

  log(`\n${'='.repeat(60)}`, colors.bright);
  log(`Ownership changed: ${lastOwner || 'None'} → ${state.owner}`, colors.bright);
  log(`Status: ${state.status}`, colors.bright);
  log(`${'='.repeat(60)}\n`, colors.bright);

  lastOwner = state.owner;
  isProcessing = true;

  // Handle based on status
  if (state.needsEscalation) {
    log('🚨 HUMAN ESCALATION NEEDED', colors.red);
    log('Please review AGENT_HANDOFF.md and take action.', colors.red);
    isProcessing = false;
    return;
  }

  if (state.status === 'DONE') {
    log('✨ Agent workflow complete!', colors.green);
    isProcessing = false;
    return;
  }

  if (state.status === 'ESCALATE_TO_HUMAN') {
    log('🚨 ESCALATION TO HUMAN', colors.red);
    log('Please review AGENT_HANDOFF.md and take action.', colors.red);
    isProcessing = false;
    return;
  }

  // Trigger appropriate agent
  if (state.owner === 'Claude') {
    triggerClaudeCode(state.nextAction || 'Act according to Next action.');
  } else if (state.owner === 'Composer') {
    triggerCursorComposer(state.nextAction || 'Act according to Next action.');
  } else if (state.owner === 'Human') {
    log('👤 Human intervention required', colors.yellow);
    log('Please review AGENT_HANDOFF.md and take action.', colors.yellow);
  }

  // Reset processing flag after a delay
  setTimeout(() => {
    isProcessing = false;
  }, 2000);
}

function startWatching() {
  const handoffPath = path.resolve(process.cwd(), HANDOFF_FILE);

  if (!fs.existsSync(handoffPath)) {
    log(`❌ Error: ${HANDOFF_FILE} not found in current directory`, colors.red);
    log(`Current directory: ${process.cwd()}`, colors.red);
    log(`\nPlease run this from a directory containing ${HANDOFF_FILE}`, colors.yellow);
    process.exit(1);
  }

  log('🚀 Agent Orchestrator Started', colors.green);
  log(`👀 Watching: ${handoffPath}`, colors.cyan);
  log(`\n${'='.repeat(60)}\n`, colors.bright);

  // Initial read
  try {
    const content = fs.readFileSync(handoffPath, 'utf8');
    const state = parseHandoffFile(content);
    log(`Initial state: Owner=${state.owner}, Status=${state.status}`, colors.cyan);
    lastOwner = state.owner;
  } catch (err) {
    log(`⚠️  Could not read initial state: ${err.message}`, colors.yellow);
  }

  // Watch for changes
  const watcher = chokidar.watch(handoffPath, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100
    }
  });

  watcher.on('change', (filePath) => {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const state = parseHandoffFile(content);
      handleStateChange(state);
    } catch (err) {
      log(`❌ Error reading file: ${err.message}`, colors.red);
    }
  });

  watcher.on('error', (err) => {
    log(`❌ Watcher error: ${err.message}`, colors.red);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    log('\n👋 Shutting down orchestrator...', colors.yellow);
    watcher.close();
    process.exit(0);
  });
}

// Main
if (require.main === module) {
  startWatching();
}

module.exports = { startWatching, parseHandoffFile };
