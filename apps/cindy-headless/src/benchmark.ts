import { readFile, writeFile } from 'node:fs/promises';
import { sha256 } from './profile.js';

export interface BenchmarkManifest {
  schemaVersion: 1;
  board: 'same-model-harness' | 'default-model-product';
  dataset: { name: string; revision: string; taskIds: string[] };
  modelIds: string[];
  repetitions: number;
  variants: Array<{ id: string; supportedModelIds: string[] }>;
  seed: number;
}

export interface BenchmarkCell {
  variantId: string;
  modelId: string;
  taskId: string;
  repetition: number;
}

export interface PairedBenchmarkCell extends BenchmarkCell {
  pairId: string;
  armIndex: number;
}

export interface PairedRunResult {
  variantId: string;
  armIndex?: number;
  modelId: string;
  taskId: string;
  repetition: number;
  reward: number;
  status?: string;
  costUsd?: number;
  inputTokens?: number;
  cacheTokens?: number;
  outputTokens?: number;
}

export interface PairedSummary {
  pairCount: number;
  completePairCount: number;
  incompletePairCount: number;
  bothPass: number;
  bothFail: number;
  firstArmOnlyPass: number;
  secondArmOnlyPass: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalCacheTokens: number;
  totalOutputTokens: number;
}

export function validateManifest(value: unknown): BenchmarkManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('manifest must be an object');
  const manifest = value as Partial<BenchmarkManifest>;
  if (manifest.schemaVersion !== 1) throw new Error('manifest.schemaVersion must be 1');
  if (!['same-model-harness', 'default-model-product'].includes(manifest.board ?? '')) throw new Error('manifest.board is invalid');
  if (!manifest.dataset?.name || !manifest.dataset.revision || !Array.isArray(manifest.dataset.taskIds) || manifest.dataset.taskIds.length === 0) throw new Error('dataset name, revision and taskIds are required');
  if (new Set(manifest.dataset.taskIds).size !== manifest.dataset.taskIds.length) throw new Error('dataset.taskIds contains duplicates');
  if (!Number.isInteger(manifest.repetitions) || (manifest.repetitions ?? 0) < 1) throw new Error('repetitions must be a positive integer');
  if (!Array.isArray(manifest.modelIds) || manifest.modelIds.length === 0 || !Array.isArray(manifest.variants) || manifest.variants.length < 1) throw new Error('modelIds and variants must be non-empty');
  const variantIds = manifest.variants.map((variant) => variant.id);
  if (variantIds.some((id) => typeof id !== 'string' || id.trim() === '')) throw new Error('variant IDs must be non-empty');
  if (new Set(variantIds).size !== variantIds.length) throw new Error('variants contains duplicate IDs');
  if (manifest.board === 'same-model-harness') {
    for (const modelId of manifest.modelIds) {
      const unsupported = manifest.variants.filter((variant) => !variant.supportedModelIds.includes(modelId)).map((variant) => variant.id);
      if (unsupported.length) throw new Error(`same-model cell unsupported for ${modelId}: ${unsupported.join(', ')}`);
    }
  }
  return manifest as BenchmarkManifest;
}

export function validatePairedManifest(manifest: BenchmarkManifest): BenchmarkManifest {
  if (manifest.variants.length !== 2) throw new Error('paired runs require exactly two variants');
  if (manifest.board !== 'same-model-harness') throw new Error('paired runs require the same-model-harness board');
  return manifest;
}

export function expandPairedPlan(manifest: BenchmarkManifest): { schemaVersion: 1; manifestDigest: string; cells: PairedBenchmarkCell[] } {
  validatePairedManifest(manifest);
  const cells: PairedBenchmarkCell[] = [];
  for (const taskId of manifest.dataset.taskIds) for (const modelId of manifest.modelIds) for (let repetition = 1; repetition <= manifest.repetitions; repetition += 1) {
    manifest.variants.forEach((variant, armIndex) => {
      if (variant.supportedModelIds.includes(modelId)) cells.push({ pairId: `${taskId}:${modelId}:${repetition}`, armIndex, variantId: variant.id, modelId, taskId, repetition });
    });
  }
  return { schemaVersion: 1, manifestDigest: sha256(JSON.stringify(manifest)), cells };
}

function passed(result: PairedRunResult | undefined): boolean {
  return result?.reward === 1;
}

export function summarizePairedResults(results: PairedRunResult[]): PairedSummary {
  const pairs = new Map<string, PairedRunResult[]>();
  let totalCostUsd = 0;
  let totalInputTokens = 0;
  let totalCacheTokens = 0;
  let totalOutputTokens = 0;
  for (const result of results) {
    if (!Number.isFinite(result.reward)) throw new Error(`invalid reward for ${result.taskId}`);
    const key = `${result.taskId}:${result.modelId}:${result.repetition}`;
    const pair = pairs.get(key) ?? [];
    pair.push(result);
    pairs.set(key, pair);
    totalCostUsd += result.costUsd ?? 0;
    totalInputTokens += result.inputTokens ?? 0;
    totalCacheTokens += result.cacheTokens ?? 0;
    totalOutputTokens += result.outputTokens ?? 0;
  }
  let completePairCount = 0;
  let bothPass = 0;
  let bothFail = 0;
  let firstArmOnlyPass = 0;
  let secondArmOnlyPass = 0;
  for (const pair of pairs.values()) {
    const ordered = [...pair].sort((a, b) => (a.armIndex ?? Number.MAX_SAFE_INTEGER) - (b.armIndex ?? Number.MAX_SAFE_INTEGER) || a.variantId.localeCompare(b.variantId));
    if (ordered.length !== 2) continue;
    completePairCount += 1;
    const first = passed(ordered[0]);
    const second = passed(ordered[1]);
    if (first && second) bothPass += 1;
    else if (!first && !second) bothFail += 1;
    else if (first) firstArmOnlyPass += 1;
    else secondArmOnlyPass += 1;
  }
  return { pairCount: pairs.size, completePairCount, incompletePairCount: pairs.size - completePairCount, bothPass, bothFail, firstArmOnlyPass, secondArmOnlyPass, totalCostUsd, totalInputTokens, totalCacheTokens, totalOutputTokens };
}

export function expandPlan(manifest: BenchmarkManifest): { schemaVersion: 1; manifestDigest: string; cells: BenchmarkCell[] } {
  const cells: BenchmarkCell[] = [];
  for (const taskId of manifest.dataset.taskIds) for (const modelId of manifest.modelIds) for (let repetition = 1; repetition <= manifest.repetitions; repetition += 1) for (const variant of manifest.variants) {
    if (variant.supportedModelIds.includes(modelId)) cells.push({ variantId: variant.id, modelId, taskId, repetition });
  }
  return { schemaVersion: 1, manifestDigest: sha256(JSON.stringify(manifest)), cells };
}

export async function writePlan(manifestPath: string, outputPath: string): Promise<void> {
  const manifest = validateManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  await writeFile(outputPath, JSON.stringify(expandPlan(manifest), null, 2) + '\n', 'utf8');
}

export function validateOracleGate(taskIds: string[], results: Array<{ taskId: string; reward: number }>): { ok: true; taskIds: string[] } {
  const expected = [...taskIds].sort().slice(0, 5);
  if (expected.length !== 5) throw new Error('Oracle gate requires at least five frozen task IDs');
  const resultMap = new Map(results.map((result) => [result.taskId, result.reward]));
  const failed = expected.filter((taskId) => resultMap.get(taskId) !== 1);
  if (failed.length) throw new Error(`Oracle gate failed or missing: ${failed.join(', ')}`);
  return { ok: true, taskIds: expected };
}
