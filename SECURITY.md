# Local security workflow

These checks address the October 2026 repository injection. They inspect source as data before application execution. GitHub enforcement, deployments, credential rotation and Fastify implementation changes are deferred. See the workspace incident plan and completion record in `../gratis-oglasi-system-docs/`.

## Tools and deliberate setup

Use Node 24 LTS, npm 11, Git, Semgrep CE 1.179.0 and Gitleaks 8.30.1. The checked-in `scripts/security/tool-versions.json` records versions and the verified macOS ARM64 Gitleaks archive digest. Install scanners into a private directory outside application source. Use a dedicated Python 3.13 virtual environment for Semgrep (`python3.13 -m venv /absolute/private/tools/semgrep-venv`, then its Python `-m pip install semgrep==1.179.0`). Download Gitleaks from its official versioned release and verify the selected platform archive against that release's checksum file before extracting; the macOS checksum in this repository is not a Linux checksum. Use official sources: [Semgrep installation](https://semgrep.dev/docs/getting-started/), [Gitleaks releases](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1).

Create a private local tool configuration, outside Git, with absolute paths:

```json
{
  "node": "/absolute/trusted/node",
  "git": "/usr/bin/git",
  "npmCli": "/absolute/trusted/npm/bin/npm-cli.js",
  "semgrep": "/absolute/private/tools/semgrep-venv/bin/semgrep",
  "gitleaks": "/absolute/private/tools/gitleaks",
  "caFile": "/absolute/private/tools/semgrep-venv/lib/python3.13/site-packages/certifi/cacert.pem"
}
```

Review `scripts/security/`, package commands, every locked dependency marked `hasInstallScript`, and the selected clean HEAD before setup. Use an allowlisted environment and the trusted Node binary to run:

```sh
/usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp /absolute/trusted/node scripts/security/install.cjs /absolute/private/tool-install.json
```

Setup deliberately records reviewed tool hashes, exact security-source hashes, package commands, installation-script versions and the reviewed HEAD as a historical boundary. It copies the guard/rules under the Git common directory and installs local `pre-commit`, `pre-merge-commit` and `pre-push` hooks. It refuses to overwrite existing custom hooks. It sets clone-local fast-forward pulls and fetch/transfer object checking. It never runs automatically on pull or npm installation. Linked worktrees share this installation; `.git` may be a file.

This workspace is already set up. Its independent scanners are under `../.security-private/tools/`; its tool-path configuration is `../.security-private/tools/install.json`. Do not publish that private directory: it also contains confidential incident evidence. To update rules/tools or approve package-command/dependency-script changes, review their full diff first and repeat deliberate setup. Repeating setup on an arbitrary checkout would approve that checkout; it is not an automatic repair command.

## Accepting incoming source

Fetch without installing, starting or building the fetched source. Inspect the full candidate commit ID with the **already installed** tool. Resolve the common directory using trusted Git, then invoke the guard by its absolute path with a clean environment:

```sh
/usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp /absolute/trusted/node /absolute/git-common-dir/security-guard/guard.cjs --revision=FULL_40_CHARACTER_COMMIT_ID
/usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp /absolute/trusted/node /absolute/git-common-dir/security-guard/guard.cjs --accept=FULL_40_CHARACTER_COMMIT_ID
```

The first command inspects the complete candidate tree and known malicious ancestry. Acceptance also scans introduced intermediate commits against the reviewed historical boundary, requires a clean worktree, and performs a fast-forward merge. More than 100 introduced commits, missing objects, scanner errors and unknown policy changes require deliberate review. A history boundary excludes pre-existing historical exposure; it never permits a secret in the candidate tip or a known malicious ancestor. Old secrets remain subject to revocation and later history handling.

For a trusted current checkout, convenience commands are `npm run security:check`, `npm run security:test` and `npm run security:install`. The last performs a frozen `npm ci --ignore-scripts` with isolated npm configuration/cache and the official registry. It replaces that checkout's `node_modules`; preserve anything needed first. Check source before deliberately running npm build/start/test. The convenience entry point and npm itself are incoming code/configuration surfaces; use the independent tool for untrusted updates.

## Installation and native compatibility

Every npm root has `ignore-scripts=true`. Keep explicit suppression in external build settings too. Registry origin, lock consistency and SHA-512 integrity are checked. An approved registry or valid integrity does not prove a package is harmless.

Script-free installation leaves some native modules unbuilt. Review exact packages and their installer dependencies before rebuilding, in an isolated build environment without live secrets, SSH agent, browser profile or write-capable Git credentials. For the current locked versions, the validated selective commands are:

```sh
# Express backend only:
npm rebuild bcrypt@5.1.1 --ignore-scripts=false --foreground-scripts --build-from-source
# Chat only:
npm rebuild bcrypt@5.1.1 --ignore-scripts=false --foreground-scripts --build-from-source
```

Use paths without spaces for these source builds: this workstation's node-gyp setup split include paths containing spaces. Keep Node's header cache in a path without spaces as well (`npm_config_devdir=/private/tmp/gratis-node-headers`). Source compilation needs a compiler and Node headers. Never use an unrestricted rebuild or permanently enable scripts. The patched Firebase SDK no longer requires farmhash, so it is absent from the updated lock. Sharp and esbuild passed runtime probes with their optional platform packages and suppressed install scripts. Validate Linux/native artifacts on the actual deployment architecture separately.

Chat tests use disposable MongoDB databases. Set `RUN_LIVE_CF=0` before invocation and keep live credentials absent; an `.env` alone cannot opt into the live test. Runtime binary downloads can be disabled with `MONGOMS_RUNTIME_DOWNLOAD=false` and an explicitly reviewed `MONGOMS_SYSTEM_BINARY`. The cached workstation binary is local test tooling, not verified deployment provenance.

## What is enforced and what remains

Checks cover complete staged blobs, tracked ignored files, relevant untracked source, explicit ignored incident droppers, complete commit/merge trees and outgoing intermediate commits. They reject the known malicious ancestor/blob, concealed loaders, selected dynamic execution/process/VM imports, automatic lifecycle hooks, unreviewed package commands/installers, weak npm config, lock drift, private keys and secret findings. Scanner suppression comments and incoming ignore rules cannot mute the independent scanners. Findings disclose paths/rules/locations only. Missing tools and incomplete AST coverage fail.

Local hooks can be bypassed and do not stop another account from pushing to GitHub. Static rules are not a proof of harmless code; runtime dependencies can still execute code. Same-user malware or a compromised OS can alter private tooling. Git object validation is not author authenticity. Direct application commands bypass local startup checks. Use mandatory independent release checks and remote policy in the deferred GitHub phase.

Default npm build/start/test commands require the local guard and a Git checkout. Production artifact runtimes normally have neither. After an independent build gate approves the exact artifact, configure reviewed direct runtime commands described in the external runbook; do not deploy these changed npm entry points without that setup. Keep runtime secrets out of build environments/artifacts. No hosting setting, production service, remote ref or credential was changed here.
