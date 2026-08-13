import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundleDir = path.join(appDir, 'bundle', 'linux-x64');
const manifest = JSON.parse(await readFile(path.join(bundleDir, 'bundle-manifest.json'), 'utf8'));
if (manifest.schemaVersion !== 4 || manifest.headlessContractVersion !== 1) throw new Error('unsupported bundle manifest schema or contract');
if (manifest.agentBackend !== 'claude-code' && manifest.agentBackend !== 'codex') throw new Error('bundle manifest must declare agentBackend');
for (const [name, expected] of [['node', manifest.nodeBinaryDigest], ['claude', manifest.claudeBinaryDigest], ['codex', manifest.codexBinaryDigest]]) {
  const bytes = await readFile(path.join(bundleDir, 'bin', name));
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) throw new Error(`${name} binary digest mismatch`);
}
const run = async (command, args) => execFileAsync(command, args, { cwd: bundleDir, timeout: 30_000 });
const runBundleBinary = async (name, args) => {
  if (process.platform !== 'win32') return execFileAsync(path.join(bundleDir, 'bin', name), args, { timeout: 30_000 });
  const { stdout: linuxBundle } = await execFileAsync('wsl.exe', ['-e', 'wslpath', '-a', bundleDir], { timeout: 30_000 });
  return execFileAsync('wsl.exe', ['-e', path.posix.join(linuxBundle.trim(), `bin/${name}`), ...args], { timeout: 30_000 });
};
const version = await runBundleBinary('node', ['dist/cli.cjs', 'version']);
if (!version.stdout.includes(manifest.cindyHeadlessVersion ?? '0.1.0')) throw new Error('Cindy CLI version mismatch');
await runBundleBinary('node', ['dist/eval-cli.cjs']).catch((error) => {
  if (error.code !== 2 && error.status !== 2) throw error;
});
const claudeVersion = await runBundleBinary('claude', ['--version']);
if (!claudeVersion.stdout.includes(manifest.claudeCodeVersion)) throw new Error('Claude bundle version mismatch');
const codexVersion = await runBundleBinary('codex', ['--version']);
if (!codexVersion.stdout.includes(manifest.codexVersion)) throw new Error('Codex bundle version mismatch');
await runBundleBinary('codex', ['app-server', '--help']);
const nodeVersion = await runBundleBinary('node', ['--version']);
if (!nodeVersion.stdout.includes(manifest.nodeVersion)) throw new Error('Node bundle version mismatch');
console.log(JSON.stringify({ ok: true, manifestSchema: manifest.schemaVersion, headlessContractVersion: manifest.headlessContractVersion, cindyHeadlessVersion: manifest.cindyHeadlessVersion ?? '0.1.0', nodeVersion: manifest.nodeVersion, claudeCodeVersion: manifest.claudeCodeVersion, codexVersion: manifest.codexVersion }, null, 2));
