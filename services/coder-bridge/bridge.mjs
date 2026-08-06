#!/usr/bin/env node
// Analytikul Coder — Local Bridge (outbound long-poll)
//
// Runs on the user's machine and lets the Analytikul (Hermes) Agent build here.
// Browsers block a public HTTPS site from calling localhost, so the bridge does
// the opposite: it dials OUT to the server, long-polls for the agent's file/terminal
// tool calls, executes them path-jailed under Analytikul_AI_Bin, and posts results back.
// Zero external dependencies — Node >= 20 (uses the built-in global fetch).
//
// Pair once from the Agent rail ("Pair this machine"), then run:
//   CODER_BRIDGE_PAIR=<code> node bridge.mjs        (macOS/Linux)
//   set CODER_BRIDGE_PAIR=<code> && node bridge.mjs (Windows)

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const VERSION = '0.2.1';
const SERVER = (process.env.CODER_BRIDGE_SERVER || 'https://analytikul.ai').replace(/\/$/, '');
const CONFIG_PATH = path.join(os.homedir(), '.analytikul-coder-bridge.json');
const LOG_PATH = path.join(os.homedir(), '.analytikul-coder-bridge.log');

// Mirror all console output to a log file, so a hidden/background bridge is observable.
const _origLog = console.log.bind(console);
const _origErr = console.error.bind(console);
const fileLog = (...a) => {
  try {
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${a.join(' ')}\n`);
  } catch {
    /* best effort */
  }
};
console.log = (...a) => {
  _origLog(...a);
  fileLog(...a);
};
console.error = (...a) => {
  _origErr(...a);
  fileLog(...a);
};

function readSavedPair() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')).pair || '';
  } catch {
    return '';
  }
}
function savePair(code) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ pair: code }), { mode: 0o600 });
  } catch {
    /* best effort */
  }
}

// Pairing precedence: env var / argv (a fresh pair) wins and is persisted; otherwise reuse
// the last saved pairing so a background auto-start needs no inline code.
let CODE = process.env.CODER_BRIDGE_PAIR || process.argv[2] || '';
if (CODE) {
  savePair(CODE);
} else {
  CODE = readSavedPair();
}
const BIN_NAME = 'Analytikul_AI_Bin';
const PROJECT_RE = /^[A-Za-z0-9._-]{1,64}$/;
const EXEC_TIMEOUT_MS = Number(process.env.CODER_BRIDGE_EXEC_TIMEOUT || 15 * 60 * 1000);
const MAX_OUTPUT = 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const err = (message) => JSON.stringify({ error: message });

// ---- first-run: locate the bin folder --------------------------------------------------

function candidateDrives() {
  if (process.platform !== 'win32') {
    return [path.join(os.homedir(), BIN_NAME)];
  }
  return ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'].map((l) => `${l}:\\${BIN_NAME}`);
}

function resolveBin() {
  const override = process.env.CODER_BRIDGE_BIN;
  if (override) {
    fs.mkdirSync(override, { recursive: true });
    return path.resolve(override);
  }
  for (const dir of candidateDrives()) {
    try {
      if (fs.statSync(dir).isDirectory()) return path.resolve(dir);
    } catch {
      /* keep looking */
    }
  }
  return null;
}

// ---- path jail --------------------------------------------------------------------------

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function projectDir(bin, project) {
  const name = PROJECT_RE.test(project || '') ? project : 'default';
  const dir = path.resolve(bin, name);
  if (!isInside(bin, dir)) throw new Error('project escapes workspace');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function resolveInProject(bin, project, rel) {
  const base = projectDir(bin, project);
  const full = path.resolve(base, rel || '.');
  if (!isInside(base, full)) throw new Error('path escapes project');
  return { base, full };
}

function runExec(cwd, command) {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, windowsHide: true, timeout: EXEC_TIMEOUT_MS });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += stdout.length < MAX_OUTPUT ? d.toString() : ''));
    child.stderr.on('data', (d) => (stderr += stderr.length < MAX_OUTPUT ? d.toString() : ''));
    child.on('error', (e) => resolve({ stdout, stderr: String(e), exitCode: -1 }));
    child.on('close', (code) => resolve({ stdout, stderr, exitCode: code == null ? -1 : code }));
  });
}

function pick(args, ...keys) {
  for (const k of keys) {
    const v = args?.[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

// ---- execute one dispatched tool call locally -------------------------------------------

async function executeTool(bin, tool, rawArgs, project, permissionMode) {
  const args = rawArgs || {};
  const isPlan = permissionMode === 'plan';
  try {
    if (tool === 'read_file') {
      const p = pick(args, 'path', 'file_path', 'filename');
      if (!p) return err('read_file: path required');
      const { full } = resolveInProject(bin, project, p);
      return fs.readFileSync(full, 'utf8');
    }
    if (tool === 'write_file') {
      const p = pick(args, 'path', 'file_path', 'filename');
      if (!p) return err('write_file: path required');
      const content = typeof args.content === 'string' ? args.content : '';
      if (isPlan) return `[plan] would write ${content.length} chars to ${p} (no changes made)`;
      const { full } = resolveInProject(bin, project, p);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
      return `Wrote ${Buffer.byteLength(content)} bytes to ${p}`;
    }
    if (tool === 'patch') {
      const p = pick(args, 'path', 'file_path', 'filename');
      const oldStr = typeof args.old_string === 'string' ? args.old_string : undefined;
      const newStr = typeof args.new_string === 'string' ? args.new_string : '';
      if (!p || oldStr == null) return err('patch: path, old_string, new_string required');
      if (isPlan) return `[plan] would patch ${p} (no changes made)`;
      const { full } = resolveInProject(bin, project, p);
      const current = fs.readFileSync(full, 'utf8');
      if (!current.includes(oldStr)) return err(`patch: old_string not found in ${p}`);
      const next = args.replace_all === true ? current.split(oldStr).join(newStr) : current.replace(oldStr, newStr);
      fs.writeFileSync(full, next);
      return `Applied patch to ${p}`;
    }
    if (tool === 'terminal') {
      const command = pick(args, 'command', 'cmd', 'input');
      if (!command) return err('terminal: command required');
      if (isPlan) return `[plan] would run: ${command} (no execution)`;
      const { base } = resolveInProject(bin, project, '.');
      const r = await runExec(base, command);
      let text = r.stdout;
      if (r.stderr) text += (text ? '\n' : '') + `[stderr]\n${r.stderr}`;
      if (r.exitCode !== 0) text += `\n[exit code ${r.exitCode}]`;
      return text || `[exit code ${r.exitCode}]`;
    }
    if (tool === 'search_files') {
      const pattern = pick(args, 'query', 'pattern', 'regex', 'search', 'q');
      const where = pick(args, 'path', 'dir') || '.';
      if (!pattern) return err('search_files: query/pattern required');
      const { base } = resolveInProject(bin, project, '.');
      const command =
        process.platform === 'win32'
          ? `findstr /s /n /i /c:"${pattern.replace(/"/g, '')}" "${where}\\*"`
          : `grep -rIn -- "${pattern.replace(/"/g, '\\"')}" "${where}"`;
      const r = await runExec(base, command);
      return r.stdout || '(no matches)';
    }
    return err(`tool ${tool} is not bridge-executable`);
  } catch (e) {
    return err(`bridge error running ${tool}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ---- filesystem queries (for the Files tab, over the same relay) ------------------------

function flatWalk(dir, base, out, depth) {
  if (depth < 0) return;
  const items = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.name !== '.git' && d.name !== 'node_modules')
    .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
  for (const it of items) {
    const full = path.join(dir, it.name);
    const rel = path.relative(base, full).split(path.sep).join('/');
    if (it.isDirectory()) {
      out.push({ path: rel, type: 'dir' });
      flatWalk(full, base, out, depth - 1);
    } else {
      out.push({ path: rel, type: 'file' });
    }
  }
}

function fsHandle(bin, op, project, relPath) {
  try {
    if (op === 'projects') {
      const list = fs
        .readdirSync(bin, { withFileTypes: true })
        .filter((d) => d.isDirectory() && PROJECT_RE.test(d.name))
        .map((d) => d.name)
        .sort();
      return JSON.stringify({ projects: list });
    }
    if (op === 'tree') {
      const { base } = resolveInProject(bin, project, '.');
      const entries = [];
      flatWalk(base, base, entries, 8);
      return JSON.stringify({ entries });
    }
    if (op === 'read') {
      const { full } = resolveInProject(bin, project, relPath);
      return JSON.stringify({ content: fs.readFileSync(full, 'utf8') });
    }
    return JSON.stringify({ error: `unknown fs op ${op}` });
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
  }
}

// ---- outbound long-poll loop ------------------------------------------------------------

async function pollOnce(bin) {
  const r = await fetch(`${SERVER}/api/analytikul/bridge/poll`, {
    headers: { Authorization: `Bearer ${CODE}` },
  });
  if (r.status === 204) return 'idle';
  if (r.status === 401 || r.status === 403) return 'unauthorized';
  if (!r.ok) return 'retry';
  const body = await r.json().catch(() => ({}));
  const dispatches = Array.isArray(body.dispatches) ? body.dispatches : [];
  for (const d of dispatches) {
    let result;
    if (d.kind === 'fs') {
      result = fsHandle(bin, d.op, d.project, d.path);
      console.log(`  ↳ fs:${d.op} (${d.project || '-'})`);
    } else {
      result = await executeTool(bin, d.tool, d.args, d.project, d.permissionMode);
      console.log(`  ↳ ${d.tool} (${d.project}) → returned ${String(result).length} chars`);
    }
    await fetch(`${SERVER}/api/analytikul/bridge/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CODE}` },
      body: JSON.stringify({ request_id: d.request_id, result }),
    }).catch(() => undefined);
  }
  return dispatches.length ? 'worked' : 'idle';
}

async function main() {
  const bin = resolveBin();
  if (!bin) {
    const drives = candidateDrives().map((d) => d.split('\\')[0]).join(', ');
    console.error(`\n[coder-bridge] No "${BIN_NAME}" folder found (checked ${drives}).`);
    console.error(`Create it (e.g. mkdir C:\\${BIN_NAME}) or set CODER_BRIDGE_BIN=<path>.\n`);
    process.exit(2);
  }
  if (!CODE) {
    console.error('\n[coder-bridge] No pairing code. In the Agent rail click "Pair this machine",');
    console.error('then run:  CODER_BRIDGE_PAIR=<code> node bridge.mjs\n');
    process.exit(2);
  }
  console.log(`\n  Analytikul Coder — Local Bridge v${VERSION}`);
  console.log(`  workspace : ${bin}`);
  console.log(`  server    : ${SERVER}`);
  console.log(`  paired    : ${CODE.slice(0, 6)}…  — waiting for agent tool calls\n`);

  let warned = false;
  for (;;) {
    try {
      const status = await pollOnce(bin);
      if (status === 'unauthorized') {
        if (!warned) {
          console.error('[coder-bridge] pairing rejected or expired — re-pair from the rail.');
          warned = true;
        }
        await sleep(5000);
      } else if (status === 'retry') {
        await sleep(3000);
      } else {
        warned = false;
      }
    } catch {
      await sleep(3000);
    }
  }
}

main();
