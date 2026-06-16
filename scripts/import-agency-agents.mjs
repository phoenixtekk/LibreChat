#!/usr/bin/env node
/**
 * Import the Agency Agents catalog (.claude/agents/*.md) into Analytikul as
 * agents via the LibreChat agents API. Each file's frontmatter -> name/
 * description; the markdown body -> the agent's system instructions.
 *
 * Env:
 *   BASE   (default https://analytikul.ai)
 *   EMAIL, PASSWORD   (admin creds, to obtain a JWT) — or TOKEN to skip login
 *   MODEL  (default claude-sonnet-4-6), PROVIDER (default anthropic)
 *   LIMIT  (optional, import only first N — for a test batch)
 *   DRY    (set to 1 to parse + print without creating)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE || 'https://analytikul.ai';
const PROVIDER = process.env.PROVIDER || 'anthropic';
const MODEL = process.env.MODEL || 'claude-sonnet-4-6';
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : Infinity;
const DRY = process.env.DRY === '1';
const AGENTS_DIR = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../.claude/agents');

async function login() {
  if (process.env.TOKEN) {
    return process.env.TOKEN;
  }
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.EMAIL, password: process.env.PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`login failed (${res.status})`);
  }
  const body = await res.json();
  if (!body.token) {
    throw new Error('login returned no token');
  }
  return body.token;
}

function parseAgent(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) {
    return null;
  }
  const fm = m[1];
  const body = m[2].trim();
  const name = (fm.match(/^name:\s*(.+)$/m) || [])[1]?.trim();
  const description = (fm.match(/^description:\s*(.+)$/m) || [])[1]?.trim();
  if (!name || !body) {
    return null;
  }
  // Cap instructions to a safe length.
  const instructions = body.length > 12000 ? `${body.slice(0, 12000)}\n…` : body;
  return {
    name,
    description: (description || '').slice(0, 480) || null,
    instructions,
    provider: PROVIDER,
    model: MODEL,
    model_parameters: {},
    category: 'general',
  };
}

async function createAgent(token, payload) {
  const res = await fetch(`${BASE}/api/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
}

async function main() {
  const files = fs
    .readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .slice(0, LIMIT);
  console.log(`Found ${files.length} agent file(s) to import (LIMIT=${LIMIT}).`);

  const token = DRY ? 'dry' : await login();
  let ok = 0;
  let fail = 0;
  for (const file of files) {
    const payload = parseAgent(path.join(AGENTS_DIR, file));
    if (!payload) {
      console.log(`  SKIP  ${file} (unparseable)`);
      continue;
    }
    if (DRY) {
      console.log(`  DRY   ${payload.name} (${payload.instructions.length} chars)`);
      ok++;
      continue;
    }
    try {
      const agent = await createAgent(token, payload);
      console.log(`  OK    ${payload.name} -> ${agent.id}`);
      ok++;
    } catch (err) {
      console.log(`  FAIL  ${payload.name}: ${err.message}`);
      fail++;
    }
  }
  console.log(`\nDone. created=${ok} failed=${fail}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
