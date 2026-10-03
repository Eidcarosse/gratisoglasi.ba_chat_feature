#!/usr/bin/env node
'use strict';
// Convenience only. For an untrusted checkout invoke the installed tool directly.
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const clean = { PATH: '/usr/bin:/bin', HOME: process.env.HOME };
for (const key of ['GIT_INDEX_FILE', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR']) {
  if (process.env[key]) clean[key] = process.env[key];
}
const git = spawnSync('/usr/bin/git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8', env: clean });
if (git.status !== 0) { console.error('Security setup requires a Git checkout.'); process.exit(1); }
const dir = path.resolve(git.stdout.trim(), 'security-guard');
let config;
try { config = JSON.parse(fs.readFileSync(path.join(dir, 'installed.json'))); }
catch { console.error('Independent security tools missing. Follow SECURITY.md before running code.'); process.exit(1); }
const result = spawnSync(config.node, [path.join(dir, 'guard.cjs'), ...process.argv.slice(2)],
  { stdio: 'inherit', env: clean });
process.exit(result.status ?? 1);
