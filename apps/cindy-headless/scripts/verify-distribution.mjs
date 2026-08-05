import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'cindy-headless-distribution-'));
try {
  const yamlPath = path.join(temporary, 'smoke.yaml');
  await execFileAsync('node', [path.join(repoRoot, 'benchmarks', 'harbor', 'generate-smoke-config.mjs'), '--backend', 'codex', '--run-id', 'portable-smoke', '--output', yamlPath, '--jobs-dir', path.join(temporary, 'jobs')]);
  const yaml = await readFile(yamlPath, 'utf8');
  const bundleManifest = JSON.parse(await readFile(path.join(repoRoot, 'apps', 'cindy-headless', 'bundle', 'linux-x64', 'bundle-manifest.json'), 'utf8'));
  assert.match(yaml, new RegExp(`version: ${bundleManifest.cindyHeadlessVersion.replaceAll('.', '\\.')}`));
  assert.match(yaml, /manifest_digest: [a-f0-9]{64}/);
  assert.doesNotMatch(yaml, /apiKey|sk-[A-Za-z0-9_-]{12,}/);
  assert.ok(yaml.includes(repoRoot.replace(/\\/g, '/')), 'generated config must resolve the current checkout path');
  assert.match(yaml, /tasks\/hello-world|tasks\\hello-world/);
  await execFileAsync('node', [path.join(repoRoot, 'apps', 'cindy-headless', 'scripts', 'package-release.mjs')], { env: { ...process.env, CINDY_HEADLESS_RELEASE_DIR: path.join(temporary, 'release') } });
  const release = JSON.parse(await readFile(path.join(temporary, 'release', 'release-manifest.json'), 'utf8'));
  assert.equal(release.product, 'cindy-headless');
  assert.equal(release.includesVendorBinaries, false);
  assert.equal(release.assets.length, 1);
  const sums = await readFile(path.join(temporary, 'release', 'SHA256SUMS'), 'utf8');
  assert.match(sums, /cindy-headless-linux-x64-runtime-/);
  assert.doesNotMatch(sums, /codex\.tar|bin\/claude/);
  const archive = path.join(temporary, 'release', release.assets[0]);
  await execFileAsync('tar', ['-xzf', path.relative(temporary, archive)], { cwd: temporary });
  const releaseRoot = path.join(temporary, 'cindy-headless');
  await readFile(path.join(releaseRoot, 'dist', 'cli.cjs'));
  await readFile(path.join(releaseRoot, 'cindy_harbor', 'cindy_headless_agent.py'));
  await assert.rejects(readFile(path.join(releaseRoot, 'harbor', '__init__.py')));
  await readFile(path.join(releaseRoot, 'prepare-binaries.sh'));
  await assert.rejects(readFile(path.join(releaseRoot, 'bin', 'claude')));
  const readme = await readFile(path.join(releaseRoot, 'README.md'), 'utf8');
  assert.doesNotMatch(readme, /sk-[A-Za-z0-9_-]{12,}|github_pat_|gho_/);
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
  await scan(releaseRoot);
  const releaseYaml = path.join(temporary, 'release-smoke.yaml');
  await execFileAsync('node', [path.join(releaseRoot, 'cindy_harbor', 'generate-smoke-config.mjs'), '--backend', 'codex', '--run-id', 'release-smoke', '--output', releaseYaml, '--jobs-dir', path.join(temporary, 'release-jobs')]);
  const releaseConfig = await readFile(releaseYaml, 'utf8');
  assert.ok(releaseConfig.includes(releaseRoot.replace(/\\/g, '/')));
  assert.match(releaseConfig, /import_path: cindy_harbor\.cindy_headless_agent:CindyHeadlessAgent/);
  assert.match(releaseConfig, new RegExp(`version: ${release.version.replaceAll('.', '\\.')}`));
  console.log(JSON.stringify({ ok: true }));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
