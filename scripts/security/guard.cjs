#!/usr/bin/env node
'use strict';
// Inspect source as data. This tool never loads application modules or npm config.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const BAD_COMMIT = '55ff6583fb6d4e41ec059e9af45d2946e0d22e6f';
const BAD_HASH = 'f6d5aee0d54777b0ff9451000952faa62699673157ccb90f1ce3003a2a9df945';
const MARKERS = ['GSkqNNyuJw$_padNcYwam', 'WlysIxGuPMcViepbraDjp_wli',
  '0xa322E5f3D311D3080e6f0121063e9aDC2490Ef1a', 'x-payload-b64',
  'f9b1a8fafbfb8cfcaffa8dfaf8f88dfaf9f1f9acffaff9f8fbf8f9fffaacf0a88d8afbfdf0f98caff8a8'];
const DROPPERS = ['dist/setup.js', 'temp_auto_push.bat', 'temp_interactive_push.bat', 'branch_structure.json'];
const SOURCE = /\.(?:[cm]?js|jsx|ts|tsx|py|sh|bash|ps1|bat|cmd)$/i;
const JS = /\.(?:[cm]?js|jsx|ts|tsx)$/i;
const TEXT = /\.(?:[cm]?js|jsx|ts|tsx|json|ya?ml|toml|py|sh|bash|ps1|bat|cmd|txt|csv|pem|key|env|md)$/i;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const display = name => JSON.stringify(name); // Escape control characters in filenames.

function command(bin, args, options = {}) {
  const result = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    timeout: 120000, ...options });
  if (result.error || result.status !== 0) throw new Error(`Trusted command failed: ${path.basename(bin)}`);
  return result.stdout;
}

function gitEnvironment(config) {
  const env = { PATH: '/usr/bin:/bin', HOME: config.home || os.tmpdir() };
  for (const key of ['GIT_INDEX_FILE', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

function git(args, cwd, config) {
  // Preserve GIT_INDEX_FILE for commit --only and linked-worktree hooks.
  const env = gitEnvironment(config);
  return command(config.git, ['--no-pager', '-c', 'core.fsmonitor=false',
    '-c', 'core.hooksPath=' + config.emptyHooks, ...args], { cwd, env });
}

function safeName(name) {
  if (!name || path.isAbsolute(name) || name.split('/').some(x => x === '..' || x === '.')) {
    throw new Error('Unsafe snapshot path');
  }
}

function snapshot(cwd, mode, revision, config) {
  const files = new Map();
  if (mode === 'worktree') {
    const names = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd, config).split('\0');
    for (const name of new Set([...names.filter(Boolean), ...DROPPERS])) {
      safeName(name);
      const full = path.join(cwd, name);
      if (!fs.existsSync(full)) continue;
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Unsupported source path: ${display(name)}`);
      // Parent symlinks must not lead reads outside the repository.
      const relative = path.relative(fs.realpathSync(cwd), fs.realpathSync(full));
      if (relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Snapshot path escapes repository');
      files.set(name, fs.readFileSync(full));
    }
  } else {
    const args = mode === 'index' ? ['ls-files', '--stage', '-z'] : ['ls-tree', '-r', '-z', revision];
    for (const record of git(args, cwd, config).split('\0').filter(Boolean)) {
      const tab = record.indexOf('\t');
      const [permissions, second, third] = record.slice(0, tab).split(' ');
      const name = record.slice(tab + 1); safeName(name);
      if (!['100644', '100755'].includes(permissions)) throw new Error(`Unsupported Git entry: ${display(name)}`);
      if (mode === 'index' && third !== '0') throw new Error('Unresolved index conflict');
      const oid = mode === 'index' ? second : third;
      const content = command(config.git, ['cat-file', 'blob', oid], { cwd, encoding: null, env: gitEnvironment(config) });
      files.set(name, content);
    }
  }
  return files;
}

function policy(files, config = {}) {
  const findings = [];
  const add = (file, rule, line = 0) => findings.push({ file, rule, line });
  const reviewed = config.reviewed || {};
  for (const [file, bytes] of files) {
    const hash = sha256(bytes);
    if (reviewed[file] === hash) continue;
    if (DROPPERS.some(x => file === x || file.endsWith('/' + x))) add(file, 'incident-dropper-path');
    if (file === 'user_details.csv' || file.endsWith('/user_details.csv')) add(file, 'confidential-export');
    if (/\.(?:pem|key|p12|pfx)$/i.test(file) || /(?:^|\/)\.env(?:\..+)?$/.test(file) &&
        !/\.env\.(?:example|sample)$/.test(file)) add(file, 'tracked-credential-file');
    if (hash === BAD_HASH) add(file, 'known-loader-hash');
    if (bytes.includes(0)) continue;
    const text = bytes.toString('utf8');
    if (MARKERS.some(marker => text.includes(marker))) add(file, 'incident-indicator');
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) add(file, 'private-key-material');
    if (SOURCE.test(file)) {
      text.split(/\r?\n/).forEach((line, index) => {
        if (line.length > 1000) add(file, 'concealed-or-long-source', index + 1);
        if (/[;})][ \t]{40,}\S/.test(line)) add(file, 'concealed-whitespace', index + 1);
      });
    }
    if (path.basename(file) === 'package.json') {
      let pkg;
      try { pkg = JSON.parse(text); } catch { add(file, 'invalid-manifest'); continue; }
      if (config.packageScripts && config.packageScripts[file] !== sha256(Buffer.from(JSON.stringify(pkg.scripts || {})))) {
        add(file, 'unreviewed-package-commands');
      }
      for (const name of Object.keys(pkg.scripts || {})) {
        if (/^(?:pre|post).+/.test(name) || /^(?:install|prepare|publish|heroku-.+)$/.test(name)) {
          add(file, 'automatic-lifecycle-script:' + name);
        }
      }
      for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
        for (const spec of Object.values(pkg[section] || {})) {
          if (typeof spec !== 'string' || /(?:https?:|git|github:|file:|link:|workspace:|^npm:|\/)/i.test(spec)) {
            add(file, 'unapproved-dependency-source');
          }
        }
      }
      const prefix = file.slice(0, -'package.json'.length);
      if (!files.has(prefix + '.npmrc')) add(file, 'missing-script-suppression');
      const lock = files.get(prefix + 'package-lock.json');
      if (!lock) add(file, 'missing-lockfile');
      else {
        try {
          const root = JSON.parse(lock).packages?.[''];
          for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
            const a = Object.entries(pkg[section] || {}).sort();
            const b = Object.entries(root?.[section] || {}).sort();
            if (JSON.stringify(a) !== JSON.stringify(b)) add(file, 'manifest-lock-drift:' + section);
          }
        } catch { add(file, 'invalid-lockfile'); }
      }
    }
    if (path.basename(file) === '.npmrc') {
      const lines = text.split(/\r?\n/).map(x => x.trim()).filter(x => x && !/^[#;]/.test(x));
      const ignore = lines.filter(x => /^ignore-scripts\s*=/i.test(x));
      if (ignore.length !== 1 || !/^ignore-scripts\s*=\s*true$/i.test(ignore[0])) add(file, 'unsafe-script-suppression');
      if (lines.some(x => !/^ignore-scripts\s*=\s*true$|^registry\s*=\s*https:\/\/registry\.npmjs\.org\/$/i.test(x))) {
        add(file, 'unreviewed-npm-configuration');
      }
    }
    if (path.basename(file) === 'package-lock.json') {
      try {
        const lock = JSON.parse(text);
        if (lock.lockfileVersion !== 3 || !lock.packages) add(file, 'unsupported-lock-format');
        for (const [name, pkg] of Object.entries(lock.packages || {})) {
          if (!name) continue;
          let url;
          try { url = new URL(pkg.resolved); } catch { add(file, 'missing-registry-resolution'); continue; }
          if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' ||
              url.username || url.password || url.port || url.search || url.hash || pkg.link) add(file, 'unapproved-registry-resolution');
          if (!/^sha512-[A-Za-z0-9+/]{86}==$/.test(pkg.integrity || '')) add(file, 'missing-or-invalid-integrity');
          if (pkg.hasInstallScript && config.installScripts && config.installScripts[file + ':' + name] !== pkg.version) {
            add(file, 'unreviewed-dependency-install-script');
          }
        }
      } catch { add(file, 'invalid-lockfile'); }
    }
  }
  return findings;
}

function scanners(files, config) {
  if (!config.semgrep || !config.gitleaks) throw new Error('Independent scanners are not installed');
  for (const name of ['semgrep', 'gitleaks']) {
    if (!fs.existsSync(config[name])) throw new Error(`Missing trusted scanner: ${name}`);
    if (config.toolHashes?.[name] !== sha256(fs.readFileSync(config[name]))) throw new Error(`Scanner digest changed: ${name}`);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gratis-security-'));
  fs.chmodSync(dir, 0o700);
  const home = path.join(dir, '.scanner-home'); fs.mkdirSync(home);
  const env = { PATH: '/usr/bin:/bin', HOME: home, TMPDIR: dir,
    SEMGREP_SEND_METRICS: 'off', SEMGREP_ENABLE_VERSION_CHECK: '0', SSL_CERT_FILE: config.caFile };
  const expected = [];
  try {
    for (const [name, bytes] of files) {
      if (config.reviewed?.[name] === sha256(bytes) || bytes.includes(0)) continue;
      if (!TEXT.test(name) && !/^\.(?:npmrc|env.*)$/.test(path.basename(name))) continue;
      const target = path.join(dir, name);fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes, { mode: 0o600 });
      if (JS.test(name)) expected.push(name);
    }
    fs.writeFileSync(path.join(dir, '.semgrepignore'), '');
    const findings = [];
    if (expected.length) {
      const result = spawnSync(config.semgrep, ['scan', '--config', path.join(__dirname, 'rules.yml'),
        '--json', '--quiet', '--metrics=off', '--disable-version-check', '--disable-nosem',
        '--no-git-ignore', '--max-target-bytes=0',
        '--strict', '--error', '--jobs=2', '.'], { cwd: dir, env, encoding: 'utf8', timeout: 120000,
        maxBuffer: 32 * 1024 * 1024 });
      if (result.error || ![0, 1].includes(result.status)) throw new Error('AST scanner failed');
      let data; try { data = JSON.parse(result.stdout); } catch { throw new Error('Invalid AST scanner response'); }
      if (data.errors?.length) throw new Error('AST scanner reported parse/scan errors');
      const scanned = new Set((data.paths?.scanned || []).map(x => x.replace(/^\.\//, '')));
      if (expected.some(x => !scanned.has(x))) throw new Error('AST scanner skipped eligible source');
      for (const item of data.results || []) findings.push({ file: item.path.replace(/^\.\//, ''),
        rule: item.check_id, line: item.start.line });
    }
    const report = path.join(home, 'secrets.json');
    const result = spawnSync(config.gitleaks, ['dir', '.', '--config', path.join(__dirname, 'gitleaks.toml'),
      '--gitleaks-ignore-path', home, '--ignore-gitleaks-allow', '--redact=100', '--no-banner',
      '--report-format=json', '--report-path', report], { cwd: dir, env, encoding: 'utf8',
      timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
    if (result.error || ![0, 1].includes(result.status) || !fs.existsSync(report)) throw new Error('Secret scanner failed');
    for (const item of JSON.parse(fs.readFileSync(report))) findings.push({ file: item.File,
      rule: 'secret:' + item.RuleID, line: item.StartLine });
    return findings.filter(x => !(config.exceptions || []).some(e => e.file === x.file && e.rule === x.rule &&
      files.has(x.file) && e.sha256 === sha256(files.get(x.file))));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function verifyInstalled(config) {
  for (const [name, hash] of Object.entries(config.policyHashes || {})) {
    if (sha256(fs.readFileSync(path.join(__dirname, name))) !== hash) throw new Error('Installed security policy changed');
  }
}

function inspect(cwd, mode, revision, config, full = true) {
  if (revision) {
    if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Expected full commit ID');
    const r = spawnSync(config.git, ['merge-base', '--is-ancestor', BAD_COMMIT, revision], { cwd, encoding: 'utf8', env: gitEnvironment(config) });
    if (r.status === 0) return [{ file: '(history)', rule: 'known-malicious-ancestry', line: 0 }];
    if (![1, 128].includes(r.status)) throw new Error('Cannot verify commit ancestry');
  }
  const files = snapshot(cwd, mode, revision, config);
  if (!files.has('package.json') || !files.has('package-lock.json')) throw new Error('Root manifest/lock missing from snapshot');
  const findings = policy(files, config);
  if (full) findings.push(...scanners(files, config));
  return findings;
}

function introducedHistory(cwd, tip, bases, config) {
  if (!bases.length) throw new Error('History update needs a reviewed baseline');
  const commits = git(['rev-list', tip, ...bases.map(base => '^' + base)], cwd, config).trim().split('\n').filter(Boolean);
  if (commits.length > 100) throw new Error('Large history update needs explicit recovery review');
  return commits.filter(oid => oid !== tip).flatMap(oid => inspect(cwd, 'revision', oid, config));
}

function main() {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'installed.json')));
  verifyInstalled(config);
  const args = process.argv.slice(2);
  const cwd = git(['rev-parse', '--show-toplevel'], process.cwd(), config).trim();
  let findings = [];
  if (args[0] === '--pre-push') {
    for (const line of fs.readFileSync(0, 'utf8').trim().split('\n').filter(Boolean)) {
      const [localRef, localOid, remoteRef, remoteOid] = line.split(' ');
      if (!/^[a-f0-9]{40}$/.test(localOid || '') || !/^[a-f0-9]{40}$/.test(remoteOid || '')) throw new Error('Malformed push input');
      if (/^refs\/(?:recovered|recovery|evidence)\//.test(remoteRef) || /^refs\/(?:recovered|recovery|evidence)\//.test(localRef)) {
        throw new Error('Forensic refs must stay local');
      }
      if (/^0+$/.test(localOid)) continue;
      const tip = git(['rev-parse', localOid + '^{commit}'], cwd, config).trim();
      findings.push(...inspect(cwd, 'revision', tip, config));
      // Missing/new base: require an explicit reviewed historical baseline.
      const bases = [...(config.historyBases || [])];
      if (!/^0+$/.test(remoteOid)) bases.push(remoteOid);
      if (!bases.length) throw new Error('New ref needs a reviewed history baseline');
      findings.push(...introducedHistory(cwd, tip, bases, config));
    }
  } else if (args.length === 1 && args[0] === '--staged') findings = inspect(cwd, 'index', null, config);
  else if (args.length === 1 && args[0].startsWith('--revision=')) findings = inspect(cwd, 'revision', args[0].slice(11), config);
  else if (!args.length || args.length === 1 && /^--install(?:=FirebaseFunctions\/functions)?$/.test(args[0])) {
    const head = git(['rev-parse', 'HEAD'], cwd, config).trim();
    const ancestry = spawnSync(config.git, ['merge-base', '--is-ancestor', BAD_COMMIT, head], { cwd, env: gitEnvironment(config) });
    if (ancestry.status === 0) findings.push({ file: '(history)', rule: 'known-malicious-ancestry', line: 0 });
    findings.push(...inspect(cwd, 'worktree', null, config));
  } else if (args.length === 1 && args[0].startsWith('--accept=')) {
    const revision = args[0].slice(9);
    findings = inspect(cwd, 'revision', revision, config);
    findings.push(...introducedHistory(cwd, revision, config.historyBases || [], config));
    if (!findings.length) {
      if (git(['status', '--porcelain'], cwd, config)) throw new Error('Preserve local changes before accepting a revision');
      git(['merge', '--ff-only', revision], cwd, config);
    }
  } else throw new Error('Unsupported security check option');
  for (const f of findings) process.stderr.write(`${display(f.file)}:${f.line} ${f.rule}\n`);
  if (findings.length) process.exitCode = 1;
  else {
    process.stdout.write('Security checks passed (source policy, AST and secrets).\n');
    if (args[0]?.startsWith('--install')) {
      if (!config.npmCli || !fs.existsSync(config.npmCli)) throw new Error('Trusted npm CLI missing');
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gratis-npm-'));
      try {
        const empty = path.join(home, 'user.npmrc'); fs.writeFileSync(empty, '');
        const globalConfig = path.join(home, 'global.npmrc'); fs.writeFileSync(globalConfig, '');
        const project = args[0].includes('=') ? path.join(cwd, 'FirebaseFunctions/functions') : cwd;
        const result = spawnSync(config.node, [config.npmCli, 'ci', '--ignore-scripts', '--no-audit',
          '--registry=https://registry.npmjs.org/'], { cwd: project, stdio: 'inherit',
          env: { PATH: path.dirname(config.node) + ':/usr/bin:/bin', HOME: home,
            NPM_CONFIG_USERCONFIG: empty, NPM_CONFIG_GLOBALCONFIG: globalConfig,
            NPM_CONFIG_IGNORE_SCRIPTS: 'true', NPM_CONFIG_CACHE: path.join(home, 'cache') } });
        if (result.error || result.status !== 0) throw new Error('Script-free frozen installation failed');
      } finally { fs.rmSync(home, { recursive: true, force: true }); }
    }
  }
}

module.exports = { policy, snapshot, inspect, sha256, scanners };
if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`Security check failed: ${error.message}\n`); process.exitCode = 1; }
}
