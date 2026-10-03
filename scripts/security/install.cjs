#!/usr/bin/env node
'use strict';
// Deliberate setup only: never run this automatically during npm install/pull.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const quote = s => "'" + s.replaceAll("'", "'\\''") + "'";
const args = process.argv.slice(2);
if (args.length !== 1) throw new Error('Usage: trusted-node install.cjs /absolute/path/to/tool-install.json');
const tool = JSON.parse(fs.readFileSync(args[0]));
for (const key of ['node', 'git', 'semgrep', 'gitleaks', 'caFile']) {
  if (!path.isAbsolute(tool[key] || '') || !fs.existsSync(tool[key])) throw new Error('Missing absolute trusted tool: ' + key);
}
const env = { PATH: '/usr/bin:/bin', HOME: os.tmpdir() };
const git = (...a) => execFileSync(tool.git, a, { encoding: 'utf8', env }).trim();
const cwd = process.cwd();
const common = path.resolve(git('rev-parse', '--git-common-dir'));
const dir = path.join(common, 'security-guard');
const hooks = path.join(common, 'security-hooks');
const existing = (() => { try { return git('config', '--local', '--get', 'core.hooksPath'); } catch { return ''; } })();
if (existing && path.resolve(existing) !== hooks) throw new Error('Existing custom hooks need explicit integration.');
const originalHooks = path.join(common, 'hooks');
if (fs.existsSync(originalHooks) && fs.readdirSync(originalHooks).some(n => !n.endsWith('.sample') && !n.startsWith('.'))) {
  throw new Error('Existing hooks need explicit integration.');
}
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
fs.mkdirSync(hooks, { recursive: true, mode: 0o700 });
const empty = path.join(dir, 'empty-hooks'); fs.mkdirSync(empty, { recursive: true });
const files = ['guard.cjs', 'rules.yml', 'gitleaks.toml'];
const policyHashes = {};
for (const name of files) {
  const bytes = fs.readFileSync(path.join(__dirname, name));
  fs.writeFileSync(path.join(dir, name), bytes, { mode: 0o600 }); policyHashes[name] = digest(bytes);
}
const reviewed = {};
for (const name of fs.readdirSync(__dirname)) {
  if (!fs.statSync(path.join(__dirname, name)).isFile()) continue;
  reviewed['scripts/security/' + name] = digest(fs.readFileSync(path.join(__dirname, name)));
}
const installScripts = {};
const packageScripts = {};
// Inventory was manually reviewed before this setup; installation remains disabled.
for (const file of ['package-lock.json', 'FirebaseFunctions/functions/package-lock.json']) {
  if (!fs.existsSync(file)) continue;
  const manifest = file.replace('package-lock.json', 'package.json');
  packageScripts[manifest] = digest(Buffer.from(JSON.stringify(JSON.parse(fs.readFileSync(manifest)).scripts || {})));
  for (const [name, pkg] of Object.entries(JSON.parse(fs.readFileSync(file)).packages || {})) {
    if (pkg.hasInstallScript) installScripts[file + ':' + name] = pkg.version;
  }
}
const baseline = git('rev-parse', 'HEAD');
const config = { ...tool, emptyHooks: empty, reviewed, installScripts, packageScripts, policyHashes,
  historyBases: [baseline], exceptions: tool.exceptions || [],
  toolHashes: Object.fromEntries(['semgrep', 'gitleaks'].map(n => [n, digest(fs.readFileSync(tool[n]))])) };
if (tool.additionalHistoryBases) config.historyBases.push(...tool.additionalHistoryBases);
fs.writeFileSync(path.join(dir, 'installed.json'), JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
const environment = '/usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp ' +
  'GIT_INDEX_FILE="${GIT_INDEX_FILE-}" GIT_DIR="${GIT_DIR-}" ' +
  'GIT_WORK_TREE="${GIT_WORK_TREE-}" GIT_COMMON_DIR="${GIT_COMMON_DIR-}" ';
for (const [name, option] of [['pre-commit', '--staged'], ['pre-merge-commit', '--staged'], ['pre-push', '--pre-push']]) {
  const text = '#!/bin/sh\nexec ' + environment + quote(tool.node) + ' ' + quote(path.join(dir, 'guard.cjs')) + ' ' + option + '\n';
  fs.writeFileSync(path.join(hooks, name), text, { mode: 0o700 }); fs.chmodSync(path.join(hooks, name), 0o700);
}
git('config', '--local', 'core.hooksPath', hooks);
git('config', '--local', 'pull.ff', 'only');
git('config', '--local', 'fetch.fsckObjects', 'true');
git('config', '--local', 'transfer.fsckObjects', 'true');
console.log('Installed independent guard and local hooks:', dir);

