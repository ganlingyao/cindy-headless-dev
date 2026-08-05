import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const harborDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const sourceRepoRoot = path.resolve(harborDir, '..', '..');
const distributionRoot = path.resolve(harborDir, '..');
const sourceLayout = await readFile(path.join(sourceRepoRoot, 'apps', 'cindy-headless', 'bundle', 'linux-x64', 'bundle-manifest.json'), 'utf8').then(() => true, () => false);
const repoRoot = sourceLayout ? sourceRepoRoot : distributionRoot;
const bundleDir = sourceLayout ? path.join(repoRoot, 'apps', 'cindy-headless', 'bundle', 'linux-x64') : distributionRoot;
const profileRoot = sourceLayout ? path.join(repoRoot, 'apps', 'cindy-headless', 'profiles') : path.join(distributionRoot, 'profiles');
const bundleManifest = JSON.parse(await readFile(path.join(bundleDir, 'bundle-manifest.json'), 'utf8'));
const args = process.argv.slice(2);
const flag = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const backend = flag('--backend', 'codex');
if (!['codex', 'claude'].includes(backend)) throw new Error('--backend must be codex or claude');
const runId = flag('--run-id', `cindy-headless-${backend}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const output = path.resolve(flag('--output', path.join(repoRoot, '.cindy-headless', 'generated', `${runId}.yaml`)));
const manifest = JSON.parse(await readFile(path.join(harborDir, 'manifest.example.json'), 'utf8'));
const manifestDigest = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
const slash = (value) => value.replace(/\\/g, '/');
const profile = backend === 'codex' ? 'cindy-production-codex' : 'cindy-production-claude';
const model = backend === 'codex' ? 'openai/gpt-5.4-mini' : 'anthropic/claude-sonnet-4-6';
const yaml = `job_name: ${runId}
jobs_dir: ${slash(path.resolve(flag('--jobs-dir', path.join(repoRoot, '.cindy-headless', 'jobs'))))}
debug: true
n_concurrent_trials: 1
agents:
  - import_path: ${sourceLayout ? 'benchmarks.harbor.cindy_headless_agent' : 'cindy_harbor.cindy_headless_agent'}:CindyHeadlessAgent
    model_name: ${model}
    kwargs:
      bundle_dir: ${slash(bundleDir)}
      profile_path: ${slash(path.join(profileRoot, profile, 'profile.example.json'))}
      version: ${bundleManifest.cindyHeadlessVersion}
      benchmark: harbor/hello-world
      benchmark_revision: local-v1
      run_id: ${runId}
      manifest_digest: ${manifestDigest}
      infra_retries: 1
      max_cost_usd: 5
      stop_after_failures: 2
    env:
      CINDY_HEADLESS_API_KEY: \${CINDY_HEADLESS_API_KEY}
      CINDY_HEADLESS_BASE_URL: \${CINDY_HEADLESS_BASE_URL}
    include_logs:
      - identity.json
      - config.json
      - trace.jsonl
      - stderr.log
      - usage.json
      - result.json
tasks:
  - path: ${slash(path.resolve(flag('--task-path', path.join(harborDir, 'tasks', 'hello-world'))))}
`;
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, yaml, 'utf8');
console.log(JSON.stringify({ ok: true, output, backend, runId, manifestDigest }));
