'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const clean = { PATH: '/usr/bin:/bin', HOME: '/tmp' };
const git = spawnSync('/usr/bin/git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8', env: clean });
if (git.status !== 0) process.exit(1);
const dir = path.resolve(git.stdout.trim(), 'security-guard');
const installed = path.join(dir, 'installed.json');
const config = JSON.parse(fs.readFileSync(installed));
const check = spawnSync(config.node, [path.join(dir, 'guard.cjs')], { stdio: 'inherit', env: clean });
if (check.status !== 0) process.exit(check.status ?? 1);
const result = spawnSync(config.node, ['--test', path.join(__dirname, 'guard.test.cjs')], {
  stdio: 'inherit', env: { ...clean, SECURITY_TEST_CONFIG: installed }
});
process.exit(result.status ?? 1);
