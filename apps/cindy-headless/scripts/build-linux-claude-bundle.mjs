import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appDir, '..', '..');
const sourceDir = path.join(appDir, 'bundle', 'linux-x64');
const outputDir = path.join(appDir, 'bundle', 'development-linux-x64-claude');
const manifest = JSON.parse(await readFile(path.join(sourceDir, 'bundle-manifest.json'), 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const execFileAsync = promisify(execFile);

await rm(outputDir, { recursive: true, force: true });
await mkdir(path.join(outputDir, 'bin'), { recursive: true });
await mkdir(path.join(outputDir, 'dist'), { recursive: true });

for (const relative of ['bin/node', 'bin/claude', 'dist/cli.cjs', 'dist/cli.cjs.map', 'dist/eval-cli.cjs', 'prompt.md']) {
  await cp(path.join(sourceDir, relative), path.join(outputDir, relative));
}

// Recompute provenance from the actual build tree instead of inheriting from
// the source manifest, so the Claude bundle attests to its own commit.
const [{ stdout: commit }, lockfile, cliBytes, promptBytes, nodeBinaryBytes, claudeBinaryBytes] = await Promise.all([
  execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }),
  readFile(path.join(repoRoot, 'pnpm-lock.yaml')),
  readFile(path.join(outputDir, 'dist', 'cli.cjs')),
  readFile(path.join(outputDir, 'prompt.md')),
  readFile(path.join(outputDir, 'bin', 'node')),
  readFile(path.join(outputDir, 'bin', 'claude')),
]);

// Smoke-verify that the binary is the expected version.
const { stdout: versionOut, stderr: versionErr } = await execFileAsync(
  path.join(outputDir, 'bin', 'claude'),
  ['--version'],
  { timeout: 30_000 },
);
const observedClaudeVersion = `${versionOut} ${versionErr}`.trim();
if (!observedClaudeVersion.includes(manifest.claudeCodeVersion)) {
  throw new Error(
    `Claude binary version mismatch: expected ${manifest.claudeCodeVersion}, observed ${observedClaudeVersion}`,
  );
}

const developmentManifest = {
  schemaVersion: 4,
  headlessContractVersion: manifest.headlessContractVersion,
  cindyHeadlessVersion: manifest.cindyHeadlessVersion,
  cindyCommit: commit.trim(),
  lockfileDigest: sha256(lockfile),
  bundleMode: 'development',
  agentBackend: 'claude-code',
  cliDigest: sha256(cliBytes),
  systemPromptDigest: sha256(promptBytes),
  nodeBinaryDigest: sha256(nodeBinaryBytes),
  nodeVersion: manifest.nodeVersion,
  claudeBinaryDigest: sha256(claudeBinaryBytes),
  claudeCodeVersion: manifest.claudeCodeVersion,
  observedClaudeVersion,
  platform: manifest.platform,
};

await writeFile(
  path.join(outputDir, 'bundle-manifest.json'),
  JSON.stringify(developmentManifest, null, 2) + '\n',
);
