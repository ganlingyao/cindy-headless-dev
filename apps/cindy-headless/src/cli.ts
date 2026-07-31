#!/usr/bin/env node
import { capabilities, doctor, readProfile } from './profile.js';
import { runTask } from './host.js';
import { readFile } from 'node:fs/promises';
import { validateManifest, validateOracleGate, writePlan } from './benchmark.js';

const args = process.argv.slice(2);
const command = args[0] ?? 'help';
function flag(name: string): string | undefined { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; }
function requireFlag(name: string): string { const value = flag(name); if (!value) throw new Error(`${name} is required`); return value; }

async function main(): Promise<void> {
  if (command === 'version') { console.log(JSON.stringify({ name: 'cindy-headless', version: '0.1.0', phase: 0 })); return; }
  if (command === 'doctor' || command === 'capabilities' || command === 'profile') {
    if (command === 'profile' && args[1] !== 'validate') throw new Error('usage: profile validate --profile <file>');
    const resolved = await readProfile(requireFlag('--profile'));
    if (command === 'capabilities') console.log(JSON.stringify({ ...capabilities(resolved.profile), profileDigest: resolved.profileDigest, systemPromptDigest: resolved.systemPromptDigest }, null, 2));
    else if (command === 'doctor') console.log(JSON.stringify(await doctor(resolved, flag('--output-dir')), null, 2));
    else console.log(JSON.stringify({ ok: true, profileId: resolved.profile.id, profileDigest: resolved.profileDigest, systemPromptDigest: resolved.systemPromptDigest }, null, 2));
    return;
  }
  if (command === 'run') {
    const task = flag('--task') ?? process.env.CINDY_HEADLESS_TASK ?? '';
    if (!task) throw new Error('--task or CINDY_HEADLESS_TASK is required');
    const timeoutMs = Number(flag('--timeout-ms') ?? '900000');
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('--timeout-ms must be a positive number');
    const result = await runTask(await readProfile(requireFlag('--profile')), task, flag('--working-dir') ?? process.cwd(), flag('--output-dir') ?? './results', timeoutMs);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'plan') {
    await writePlan(requireFlag('--manifest'), requireFlag('--output'));
    console.log(JSON.stringify({ ok: true, output: requireFlag('--output') }));
    return;
  }
  if (command === 'oracle-gate') {
    const manifest = validateManifest(JSON.parse(await readFile(requireFlag('--manifest'), 'utf8')));
    const results = JSON.parse(await readFile(requireFlag('--results'), 'utf8')) as Array<{ taskId: string; reward: number }>;
    console.log(JSON.stringify(validateOracleGate(manifest.dataset.taskIds, results), null, 2));
    return;
  }
  console.error('cindy-headless commands: version, doctor, profile validate, capabilities, run, plan, oracle-gate');
  process.exitCode = 2;
}

main().catch((error) => { console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })); process.exitCode = 1; });
