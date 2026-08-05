import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.resolve(process.env.CINDY_HEADLESS_RELEASE_DIR ?? path.join(appDir, 'release'));

async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

const release = JSON.parse(await readFile(path.join(releaseDir, 'release-manifest.json'), 'utf8'));
assert.equal(release.product, 'cindy-headless');
assert.equal(release.includesVendorBinaries, true, 'release manifest must identify the vendor binaries');
const fullAsset = release.assets.find((asset) => /-full-/.test(asset));
assert.ok(fullAsset, 'release manifest does not list a full package');

const sums = new Map();
for (const line of (await readFile(path.join(releaseDir, 'SHA256SUMS'), 'utf8')).trim().split('\n')) {
  const match = line.match(/^([a-f0-9]{64})\s+(.+)$/);
  assert.ok(match, `invalid SHA256SUMS line: ${line}`);
  sums.set(match[2], match[1]);
}
for (const asset of [...release.assets, 'bundle-manifest.json']) {
  assert.equal(await digest(path.join(releaseDir, asset)), sums.get(asset), `${asset} checksum mismatch`);
}

const temporary = await mkdtemp(path.join(releaseDir, '.verify-full-'));
try {
  await execFileAsync('tar', ['-xzf', fullAsset, '-C', path.basename(temporary)], { cwd: releaseDir });
  const root = path.join(temporary, 'cindy-headless');
  const bundle = JSON.parse(await readFile(path.join(root, 'bundle-manifest.json'), 'utf8'));
  assert.equal(await digest(path.join(root, 'bin', 'claude')), bundle.claudeBinaryDigest, 'Claude binary digest mismatch');
  assert.equal(await digest(path.join(root, 'bin', 'codex')), bundle.codexBinaryDigest, 'Codex binary digest mismatch');
  assert.ok((await stat(path.join(root, 'bin', 'claude'))).size > 0);
  assert.ok((await stat(path.join(root, 'bin', 'codex'))).size > 0);
  await readFile(path.join(root, 'VENDOR-BINARIES-NOTICE.txt'));
  await readFile(path.join(root, 'prepare-binaries.sh'));
  const { stdout } = await execFileAsync('node', [path.join(root, 'dist', 'cli.cjs'), 'version']);
  const version = JSON.parse(stdout);
  assert.equal(version.name, 'cindy-headless');
  assert.equal(version.version, release.version);
  const runBinary = async (name, args) => {
    if (process.platform !== 'win32') return execFileAsync(path.join(root, 'bin', name), args, { timeout: 30_000 });
    const { stdout: linuxRoot } = await execFileAsync('wsl.exe', ['-e', 'wslpath', '-a', root], { timeout: 30_000 });
    return execFileAsync('wsl.exe', ['-e', path.posix.join(linuxRoot.trim(), `bin/${name}`), ...args], { timeout: 30_000 });
  };
  const claudeVersion = await runBinary('claude', ['--version']);
  const codexVersion = await runBinary('codex', ['--version']);
  assert.match(`${claudeVersion.stdout} ${claudeVersion.stderr}`, new RegExp(bundle.claudeCodeVersion.replaceAll('.', '\\.')));
  assert.match(`${codexVersion.stdout} ${codexVersion.stderr}`, new RegExp(bundle.codexVersion.replaceAll('.', '\\.')));
  await runBinary('codex', ['app-server', '--help']);

  async function scan(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { await scan(file); continue; }
      assert.doesNotMatch(entry.name, /auth\.json|config\.local\.json/i);
      if (/\.(?:json|md|mjs|py|ps1|sh|toml|txt)$/.test(entry.name)) {
        assert.doesNotMatch(await readFile(file, 'utf8'), /sk-[A-Za-z0-9_-]{12,}|github_pat_|gho_/);
      }
    }
  }
  await scan(root);
  console.log(JSON.stringify({ ok: true, version: release.version, asset: fullAsset, claudeCodeVersion: bundle.claudeCodeVersion, codexVersion: bundle.codexVersion }));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
