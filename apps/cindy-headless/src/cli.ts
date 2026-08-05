#!/usr/bin/env node
import { capabilities, doctor, readProfile } from './profile.js';
import { runTask } from './host.js';
import { readFile } from 'node:fs/promises';
import { createEvaluationReport, expandPairedPlan, expandPlan, expandScheduledPlan, freezeHard30, summarizePairedResults, validateManifest, validateOracleGate, validatePairedManifest, writePlan } from './benchmark.js';
import { compatibilityReport, CINDY_HEADLESS_VERSION } from './compatibility.js';
import { applyGatewayConfig, loadGatewayConfig } from './gateway-config.js';

const args = process.argv.slice(2);
const command = args[0] ?? 'help';
function flag(name: string): string | undefined { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; }
function requireFlag(name: string): string { const value = flag(name); if (!value) throw new Error(`${name} is required`); return value; }

async function main(): Promise<void> {
  if (command === 'doctor' || command === 'verify-agent' || command === 'run') {
    applyGatewayConfig(await loadGatewayConfig());
  }
  if (command === 'version') { console.log(JSON.stringify({ name: 'cindy-headless', version: CINDY_HEADLESS_VERSION, phase: 4, backends: ['claude-code', 'codex'] })); return; }
  if (command === 'doctor' || command === 'verify-agent' || command === 'compatibility-report' || command === 'capabilities' || command === 'profile') {
    if (command === 'profile' && args[1] !== 'validate') throw new Error('usage: profile validate --profile <file>');
    const resolved = await readProfile(requireFlag('--profile'));
    if (command === 'capabilities') console.log(JSON.stringify({ ...capabilities(resolved.profile), profileDigest: resolved.profileDigest, systemPromptDigest: resolved.systemPromptDigest }, null, 2));
    else if (command === 'compatibility-report') console.log(JSON.stringify({ ...compatibilityReport(resolved.profile), profileDigest: resolved.profileDigest, systemPromptDigest: resolved.systemPromptDigest }, null, 2));
    else if (command === 'doctor' || command === 'verify-agent') console.log(JSON.stringify(await doctor(resolved, flag('--output-dir')), null, 2));
    else console.log(JSON.stringify({ ok: true, profileId: resolved.profile.id, profileDigest: resolved.profileDigest, systemPromptDigest: resolved.systemPromptDigest }, null, 2));
    return;
  }
  if (command === 'run') {
    const task = flag('--task') ?? process.env.CINDY_HEADLESS_TASK ?? '';
    if (!task) throw new Error('--task or CINDY_HEADLESS_TASK is required');
    const turnsFile = flag('--turns-file');
    const turns = turnsFile ? JSON.parse(await readFile(turnsFile, 'utf8')) : [task];
    if (!Array.isArray(turns) || turns.some((turn) => typeof turn !== 'string' || turn.trim() === '')) throw new Error('--turns-file must contain a non-empty string array');
    const timeoutMs = Number(flag('--timeout-ms') ?? '900000');
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('--timeout-ms must be a positive number');
    const result = await runTask(await readProfile(requireFlag('--profile')), task, flag('--working-dir') ?? process.cwd(), flag('--output-dir') ?? './results', timeoutMs, turns);
    console.log(JSON.stringify(result, null, 2));
    if (String(result.status ?? '').startsWith('infra-invalid-')) process.exitCode = 1;
    return;
  }
  if (command === 'plan') {
    const manifestPath = requireFlag('--manifest');
    const outputPath = requireFlag('--output');
    if (args.includes('--paired')) {
      const manifest = validatePairedManifest(validateManifest(JSON.parse(await readFile(manifestPath, 'utf8'))));
      const { writeFile } = await import('node:fs/promises');
      await writeFile(outputPath, JSON.stringify(expandPairedPlan(manifest), null, 2) + '\n', 'utf8');
    } else {
      const manifest = validateManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
      const { writeFile } = await import('node:fs/promises');
      await writeFile(outputPath, JSON.stringify(args.includes('--scheduled') ? expandScheduledPlan(manifest) : expandPlan(manifest), null, 2) + '\n');
    }
    console.log(JSON.stringify({ ok: true, output: requireFlag('--output') }));
    return;
  }
  if (command === 'paired-summary') {
    const results = JSON.parse(await readFile(requireFlag('--results'), 'utf8'));
    console.log(JSON.stringify(summarizePairedResults(results), null, 2));
    return;
  }
  if (command === 'report') {
    const manifest = validateManifest(JSON.parse(await readFile(requireFlag('--manifest'), 'utf8')));
    const results = JSON.parse(await readFile(requireFlag('--results'), 'utf8'));
    console.log(JSON.stringify(createEvaluationReport(manifest, results), null, 2));
    return;
  }
  if (command === 'freeze-hard-30') {
    const historical = JSON.parse(await readFile(requireFlag('--historical'), 'utf8')) as Array<{ taskId: string; solveRate: number }>;
    console.log(JSON.stringify(freezeHard30(historical), null, 2));
    return;
  }
  if (command === 'oracle-gate') {
    const manifest = validateManifest(JSON.parse(await readFile(requireFlag('--manifest'), 'utf8')));
    const results = JSON.parse(await readFile(requireFlag('--results'), 'utf8')) as Array<{ taskId: string; reward: number }>;
    console.log(JSON.stringify(validateOracleGate(manifest.dataset.taskIds, results), null, 2));
    return;
  }
  console.error('cindy-headless commands: version, doctor, verify-agent, compatibility-report, profile validate, capabilities, run [--turns-file], plan [--paired|--scheduled], paired-summary, report, freeze-hard-30, oracle-gate');
  process.exitCode = 2;
}

main().catch((error) => { console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })); process.exitCode = 1; });
