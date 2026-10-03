const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { policy, snapshot, scanners, sha256 } = require('./guard.cjs');
const files = object => new Map(Object.entries(object).map(([k, v]) => [k, Buffer.from(v)]));
const rules = object => policy(files(object)).map(f => f.rule);

test('blocks concealed loader and ignored dropper path without executing them', () => {
  assert.ok(rules({ 'route.js': 'module.exports = {};' + ' '.repeat(997) + 'x'.repeat(25000) })
    .includes('concealed-whitespace'));
  assert.ok(rules({ 'dist/setup.js': '' }).includes('incident-dropper-path'));
  assert.ok(rules({ 'route.js': ['x-payload', '-b64'].join('') }).includes('incident-indicator'));
  assert.deepEqual(rules({ 'translation.js': 'const value = "' + 'x'.repeat(789) + '";' }), []);
});
test('blocks nested lifecycle hooks and secret material without disclosing it', () => {
  const found = policy(files({ 'nested/package.json': JSON.stringify({ scripts: { prepare: 'node bad.js' } }),
    'key.json': JSON.stringify({ private_key: ['-----BEGIN ', 'PRIVATE KEY-----'].join('') }) }));
  assert.ok(found.some(x => x.rule === 'automatic-lifecycle-script:prepare'));
  assert.ok(found.some(x => x.rule === 'private-key-material'));
  assert.ok(!JSON.stringify(found).includes('BEGIN'));
});
test('rejects weakened npm config and registry spoofing', () => {
  assert.ok(rules({ '.npmrc': 'ignore-scripts=true\nignore-scripts=false\n' }).includes('unsafe-script-suppression'));
  const lock = url => JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/pkg': {
    resolved: url, integrity: 'sha512-' + Buffer.alloc(64).toString('base64') } } });
  assert.ok(rules({ 'package-lock.json': lock('https://registry.npmjs.org.evil/pkg.tgz') }).includes('unapproved-registry-resolution'));
  assert.ok(rules({ 'package-lock.json': lock('https://credential@registry.npmjs.org/pkg.tgz') }).includes('unapproved-registry-resolution'));
  assert.deepEqual(rules({ 'package-lock.json': lock('https://registry.npmjs.org/pkg/-/pkg.tgz') }), []);
});
test('reads actual staged blobs and tracked ignored files, including unusual filenames', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gratis-index-test-'));
  const config = { git: '/usr/bin/git', emptyHooks: path.join(dir, 'empty'), home: dir };
  fs.mkdirSync(config.emptyHooks);
  const git = (...args) => execFileSync(config.git, ['-c', 'core.hooksPath=' + config.emptyHooks, ...args], { cwd: dir });
  try {
    git('init', '-q');
    const name = 'source with space\nand ñ.js';
    fs.writeFileSync(path.join(dir, name), 'const a = 1;' + ' '.repeat(50) + 'const b = 2;');
    git('add', '--', name);
    fs.writeFileSync(path.join(dir, name), 'const a = 1;');
    assert.ok(policy(snapshot(dir, 'index', null, config)).some(x => x.rule === 'concealed-whitespace'));
    assert.equal(policy(snapshot(dir, 'worktree', null, config)).length, 0);
    fs.writeFileSync(path.join(dir, '.gitignore'), name.split('\n')[0] + '*\n');
    assert.ok(snapshot(dir, 'worktree', null, config).has(name));
    const alternate = path.join(dir, 'alternate-index');
    execFileSync(config.git, ['read-tree', '--empty'], { cwd: dir, env: { ...process.env, GIT_INDEX_FILE: alternate } });
    const before = process.env.GIT_INDEX_FILE;
    process.env.GIT_INDEX_FILE = alternate;
    try { assert.equal(snapshot(dir, 'index', null, config).size, 0); }
    finally { if (before === undefined) delete process.env.GIT_INDEX_FILE; else process.env.GIT_INDEX_FILE = before; }
    fs.symlinkSync('/etc/passwd', path.join(dir, 'escape.js'));
    assert.throws(() => snapshot(dir, 'worktree', null, config), /Unsupported/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('independent AST scanner catches indirect evaluation despite suppression comments', () => {
  const configPath = process.env.SECURITY_TEST_CONFIG;
  assert.ok(configPath, 'Run through security:test after deliberate tool setup');
  const config = JSON.parse(fs.readFileSync(configPath));
  const code = ['(0, ', 'eval', ')("remote-code"); // nosemgrep\n'].join('');
  const findings = scanners(files({ 'tests/hidden.min.js': code }), config);
  assert.ok(findings.some(x => x.rule.endsWith('dynamic-code')));
  const loader = ['import { spawn } from "node:', 'child_process";'].join('');
  assert.ok(scanners(files({ 'worker.js': loader }), config).some(x => x.rule.endsWith('privileged-code-loader')));
  assert.deepEqual(scanners(files({ 'a.js': 'const text = "eval is a word"; // ordinary documentation\n' }), config), []);
  const missing = { ...config, semgrep: '/missing/scanner' };
  assert.throws(() => scanners(files({ 'a.js': 'const a = 1;' }), missing), /Missing/);
  assert.equal(sha256(Buffer.from('same')), sha256(Buffer.from('same')));
});

test('stored merge tree is scanned even when both parent trees are clean', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gratis-merge-test-'));
  const config = { git: '/usr/bin/git', emptyHooks: path.join(dir, 'empty'), home: dir };
  fs.mkdirSync(config.emptyHooks);
  const git = (...args) => execFileSync(config.git, ['-c', 'core.hooksPath=' + config.emptyHooks, ...args], {
    cwd: dir, env: { PATH: '/usr/bin:/bin', HOME: dir, GIT_AUTHOR_NAME: 'Fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' }
  }).toString().trim();
  try {
    git('init', '-q'); fs.writeFileSync(path.join(dir, 'route.js'), 'module.exports = {};');
    git('add', 'route.js'); const tree = git('write-tree');
    const left = git('commit-tree', tree, '-m', 'left');
    const right = git('commit-tree', tree, '-m', 'right');
    fs.writeFileSync(path.join(dir, 'route.js'), 'module.exports = {};' + ' '.repeat(997) + 'const hidden = 1;');
    git('add', 'route.js'); const badTree = git('write-tree');
    const merge = git('commit-tree', badTree, '-p', left, '-p', right, '-m', 'merge');
    assert.deepEqual(policy(snapshot(dir, 'revision', left, config)), []);
    assert.deepEqual(policy(snapshot(dir, 'revision', right, config)), []);
    assert.ok(policy(snapshot(dir, 'revision', merge, config)).some(x => x.rule === 'concealed-whitespace'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('actual incident blob is identified statically when present in this clone', t => {
  const oid = '4a68860fcbda600caf2e0fa174cbca873c5d25ee';
  let content;
  try { content = execFileSync('/usr/bin/git', ['cat-file', 'blob', oid], { stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { t.skip('Incident object belongs to the backend evidence only'); return; }
  const found = policy(new Map([['route.js', content]]));
  assert.ok(found.some(x => x.rule === 'known-loader-hash'));
  assert.ok(found.some(x => x.rule === 'concealed-whitespace'));
});

test('package command changes require an independent review', () => {
  const pkg = { scripts: { start: 'node index.js' } };
  const config = { packageScripts: { 'package.json': sha256(Buffer.from(JSON.stringify(pkg.scripts))) } };
  assert.ok(!policy(files({ 'package.json': JSON.stringify(pkg) }), config).some(f => f.rule === 'unreviewed-package-commands'));
  pkg.scripts.start = 'node other.js';
  assert.ok(policy(files({ 'package.json': JSON.stringify(pkg) }), config).some(f => f.rule === 'unreviewed-package-commands'));
});
test('push and incoming acceptance inspect intermediate history and reject malformed refs', () => {
  const original = JSON.parse(fs.readFileSync(process.env.SECURITY_TEST_CONFIG));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gratis-history-test-'));
  const env = { PATH: '/usr/bin:/bin', HOME: dir, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  const git = (...args) => execFileSync(original.git, ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: dir, env }).toString().trim();
  try {
    git('init', '-q');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', scripts: {} }));
    fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'fixture', version: '1.0.0' } } }));
    fs.writeFileSync(path.join(dir, '.npmrc'), 'ignore-scripts=true\nregistry=https://registry.npmjs.org/\n'.replaceAll('\\n','\n'));
    git('add', '.'); git('commit', '-qm', 'reviewed baseline'); const base = git('rev-parse', 'HEAD');
    const tools = path.join(dir, '.git/security-guard'); fs.mkdirSync(tools);
    for (const name of ['guard.cjs', 'rules.yml', 'gitleaks.toml']) fs.copyFileSync(path.join(__dirname, name), path.join(tools, name));
    const config = { ...original, emptyHooks: path.join(tools, 'empty'), historyBases: [base], reviewed: {}, packageScripts: { 'package.json': sha256(Buffer.from('{}')) } };
    fs.mkdirSync(config.emptyHooks);
    fs.writeFileSync(path.join(tools, 'installed.json'), JSON.stringify(config));
    const run = (args, input = '') => spawnSync(original.node, [path.join(tools, 'guard.cjs'), ...args], { cwd: dir, env, input, encoding: 'utf8' });
    const zero = '0'.repeat(40);
    git('tag', '-a', 'fixture-tag', '-m', 'fixture'); const tag = git('rev-parse', 'fixture-tag');
    const good = run(['--pre-push'], `refs/heads/main ${base} refs/heads/main ${zero}\nrefs/tags/fixture-tag ${tag} refs/tags/fixture-tag ${zero}\n(delete) ${zero} refs/heads/old ${base}\n`.replaceAll('\\n','\n'));
    assert.equal(good.status, 0, good.stderr);
    assert.notEqual(run(['--pre-push'], 'malformed').status, 0);
    assert.notEqual(run(['--pre-push'], `refs/heads/main ${base} refs/evidence/source ${zero}\n`).status, 0);
    assert.notEqual(run(['--revision=' + 'f'.repeat(40)]).status, 0);
    fs.writeFileSync(path.join(dir, 'route.js'), 'module.exports = {};' + ' '.repeat(997) + 'concealed();');
    git('add', '.'); git('commit', '-qm', 'concealed fixture');
    git('rm', '-q', 'route.js'); git('commit', '-qm', 'clean final tree'); const tip = git('rev-parse', 'HEAD');
    assert.notEqual(run(['--pre-push'], `refs/heads/main ${tip} refs/heads/main ${base}\n`).status, 0);
    git('reset', '--hard', base);
    assert.notEqual(run(['--accept=' + tip]).status, 0);
    assert.equal(git('rev-parse', 'HEAD'), base);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('script-free frozen installation never executes a lifecycle sentinel', () => {
  const config = JSON.parse(fs.readFileSync(process.env.SECURITY_TEST_CONFIG));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gratis-install-test-'));
  try {
    const script = `node -e "require('fs').writeFileSync('sentinel', 'ran')"`;
    const pkg = { name: 'fixture', version: '1.0.0', scripts: { preinstall: script } };
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
    fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({ ...pkg, lockfileVersion: 3, packages: { '': pkg } }));
    fs.writeFileSync(path.join(dir, 'user.npmrc'), ''); fs.writeFileSync(path.join(dir, 'global.npmrc'), '');
    const result = spawnSync(config.node, [config.npmCli, 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--offline'], {
      cwd: dir, encoding: 'utf8', env: { PATH: path.dirname(config.node) + ':/usr/bin:/bin', HOME: dir,
        NPM_CONFIG_USERCONFIG: path.join(dir, 'user.npmrc'), NPM_CONFIG_GLOBALCONFIG: path.join(dir, 'global.npmrc'), NPM_CONFIG_CACHE: path.join(dir, 'cache') }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!fs.existsSync(path.join(dir, 'sentinel')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
