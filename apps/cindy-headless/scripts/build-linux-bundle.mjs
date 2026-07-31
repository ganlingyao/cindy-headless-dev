import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(appDir, 'bundle', 'linux-x64');
const binary = process.env.CINDY_CLAUDE_BINARY;
const execFileAsync = promisify(execFile);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
if (!binary) throw new Error('CINDY_CLAUDE_BINARY must point to the pinned Linux x64 Claude binary');

await rm(outputDir, { recursive: true, force: true });
await mkdir(path.join(outputDir, 'dist'), { recursive: true });
await mkdir(path.join(outputDir, 'bin'), { recursive: true });
await build({ entryPoints: [path.join(appDir, 'src', 'cli.ts')], outfile: path.join(outputDir, 'dist', 'cli.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', sourcemap: true, loader: { '.md': 'text' } });
await copyFile(binary, path.join(outputDir, 'bin', 'claude'));
const desktopPromptDir = path.resolve(appDir, '..', 'desktop', 'src', 'main', 'maker-host');
const desktopHost = await readFile(path.join(desktopPromptDir, 'host-system-prompt.md'), 'utf8');
const desktopClaude = await readFile(path.join(desktopPromptDir, 'claude-system-prompt.md'), 'utf8');
const productionPrompt = [desktopHost, desktopClaude].map((part) => part.trim()).filter(Boolean).join('\n\n') + '\n';
await writeFile(path.join(outputDir, 'prompt.md'), productionPrompt, 'utf8');
const latest = JSON.parse(await readFile(path.resolve(appDir, '..', '..', 'tools', 'claude', 'latest.json'), 'utf8'));
const repoRoot = path.resolve(appDir, '..', '..');
const [{ stdout: commit }, lockfile, binaryBytes] = await Promise.all([
  execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }),
  readFile(path.join(repoRoot, 'pnpm-lock.yaml')),
  readFile(binary),
]);
await writeFile(path.join(outputDir, 'bundle-manifest.json'), JSON.stringify({ schemaVersion: 1, cindyCommit: commit.trim(), lockfileDigest: sha256(lockfile), systemPromptDigest: sha256(productionPrompt), claudeBinaryDigest: sha256(binaryBytes), claudeCodeVersion: latest.version, platform: 'linux-x64', generatedAt: new Date().toISOString() }, null, 2) + '\n');
