import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(appDir, 'bundle', 'linux-x64');
const outputDir = path.join(appDir, 'bundle', 'development-linux-x64-claude');
const manifest = JSON.parse(await readFile(path.join(sourceDir, 'bundle-manifest.json'), 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

await rm(outputDir, { recursive: true, force: true });
await mkdir(path.join(outputDir, 'bin'), { recursive: true });
await mkdir(path.join(outputDir, 'dist'), { recursive: true });

for (const relative of ['bin/node', 'bin/claude', 'dist/cli.cjs', 'dist/cli.cjs.map', 'prompt.md']) {
  await cp(path.join(sourceDir, relative), path.join(outputDir, relative));
}

const developmentManifest = {
  schemaVersion: manifest.schemaVersion,
  headlessContractVersion: manifest.headlessContractVersion,
  cindyHeadlessVersion: manifest.cindyHeadlessVersion,
  cindyCommit: manifest.cindyCommit,
  lockfileDigest: manifest.lockfileDigest,
  bundleMode: 'development',
  agentBackend: 'claude-code',
  cliDigest: sha256(await readFile(path.join(outputDir, 'dist', 'cli.cjs'))),
  systemPromptDigest: sha256(await readFile(path.join(outputDir, 'prompt.md'))),
  nodeBinaryDigest: sha256(await readFile(path.join(outputDir, 'bin', 'node'))),
  nodeVersion: manifest.nodeVersion,
  claudeBinaryDigest: sha256(await readFile(path.join(outputDir, 'bin', 'claude'))),
  claudeCodeVersion: manifest.claudeCodeVersion,
  observedClaudeVersion: manifest.observedClaudeVersion,
  platform: manifest.platform,
  generatedAt: new Date().toISOString(),
};

await writeFile(
  path.join(outputDir, 'bundle-manifest.json'),
  JSON.stringify(developmentManifest, null, 2) + '\n',
);
