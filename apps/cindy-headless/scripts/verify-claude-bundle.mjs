import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundleDir = path.join(appDir, 'bundle', 'development-linux-x64-claude');
const manifest = JSON.parse(await readFile(path.join(bundleDir, 'bundle-manifest.json'), 'utf8'));
if (manifest.schemaVersion !== 4 || manifest.headlessContractVersion !== 1) {
  throw new Error('unsupported bundle manifest schema or contract');
}
if (manifest.agentBackend !== 'claude-code') {
  throw new Error('expected Claude-only bundle, got agentBackend: ' + manifest.agentBackend);
}

// Verify digest integrity of every file in the bundle.
const cliDigest = createHash('sha256').update(await readFile(path.join(bundleDir, 'dist', 'cli.cjs'))).digest('hex');
if (cliDigest !== manifest.cliDigest) throw new Error('cli bundle digest mismatch');

for (const [name, expected] of [['node', manifest.nodeBinaryDigest], ['claude', manifest.claudeBinaryDigest]]) {
  const bytes = await readFile(path.join(bundleDir, 'bin', name));
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) throw new Error(`${name} binary digest mismatch`);
}

const promptDigest = createHash('sha256').update(await readFile(path.join(bundleDir, 'prompt.md'))).digest('hex');
if (promptDigest !== manifest.systemPromptDigest) throw new Error('system prompt digest mismatch');

const runBundleBinary = async (name, args) => {
  if (process.platform !== 'win32') {
    return execFileAsync(path.join(bundleDir, 'bin', name), args, { timeout: 30_000 });
  }
  const verifyImage = process.env.CINDY_HEADLESS_LINUX_VERIFY_IMAGE;
  if (verifyImage) {
    const containerBundle = '/opt/cindy-headless-bundle';
    return execFileAsync('docker', [
      'run', '--rm', '--network', 'none',
      '-v', `${bundleDir}:${containerBundle}:ro`, '-w', containerBundle,
      '--entrypoint', `${containerBundle}/bin/${name}`,
      verifyImage, ...args,
    ], { timeout: 30_000 });
  }
  const { stdout: linuxBundle } = await execFileAsync('wsl.exe', ['-e', 'wslpath', '-a', bundleDir], { timeout: 30_000 });
  return execFileAsync('wsl.exe', ['-e', path.posix.join(linuxBundle.trim(), `bin/${name}`), ...args], { timeout: 30_000 });
};

// Smoke-test the CLI entry points.
const version = await runBundleBinary('node', ['dist/cli.cjs', 'version']);
if (!version.stdout.includes(manifest.cindyHeadlessVersion ?? '0.1.0')) {
  throw new Error('Cindy CLI version mismatch');
}
await runBundleBinary('node', ['dist/eval-cli.cjs']).catch((error) => {
  if (error.code !== 2 && error.status !== 2) throw error;
});

const claudeVersion = await runBundleBinary('claude', ['--version']);
if (!claudeVersion.stdout.includes(manifest.claudeCodeVersion)) {
  throw new Error('Claude bundle version mismatch');
}
const nodeVersion = await runBundleBinary('node', ['--version']);
if (!nodeVersion.stdout.includes(manifest.nodeVersion)) {
  throw new Error('Node bundle version mismatch');
}

console.log(JSON.stringify({
  ok: true,
  manifestSchema: manifest.schemaVersion,
  headlessContractVersion: manifest.headlessContractVersion,
  agentBackend: manifest.agentBackend,
  cindyHeadlessVersion: manifest.cindyHeadlessVersion ?? '0.1.0',
  cindyCommit: manifest.cindyCommit,
  nodeVersion: manifest.nodeVersion,
  claudeCodeVersion: manifest.claudeCodeVersion,
  observedClaudeVersion: manifest.observedClaudeVersion,
}, null, 2));
