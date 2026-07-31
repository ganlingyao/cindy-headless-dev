import { describe, expect, it } from 'vitest';
import { expandPairedPlan, expandPlan, summarizePairedResults, validateManifest, validateOracleGate, validatePairedManifest } from './benchmark.js';

const manifest = { schemaVersion: 1, board: 'same-model-harness', dataset: { name: 'terminal-bench/terminal-bench-2-1', revision: '6', taskIds: ['e', 'd', 'c', 'b', 'a'] }, modelIds: ['model-1'], repetitions: 2, variants: [{ id: 'raw', supportedModelIds: ['model-1'] }, { id: 'cindy', supportedModelIds: ['model-1'] }], seed: 127 } as const;

describe('benchmark plan', () => {
  it('expands the full variant x model x task x repetition matrix', () => expect(expandPlan(validateManifest(manifest)).cells).toHaveLength(20));
  it('rejects unsupported same-model cells', () => expect(() => validateManifest({ ...manifest, variants: [{ id: 'raw', supportedModelIds: [] }] })).toThrow(/unsupported/));
  it('requires all sorted first-five Oracle rewards to pass', () => {
    const results = ['a', 'b', 'c', 'd', 'e'].map((taskId) => ({ taskId, reward: 1 }));
    expect(validateOracleGate([...manifest.dataset.taskIds], results).ok).toBe(true);
    expect(() => validateOracleGate([...manifest.dataset.taskIds], results.slice(1))).toThrow(/a/);
  });
  it('expands paired cells with a stable pair id and two arms', () => {
    const plan = expandPairedPlan(validatePairedManifest(validateManifest(manifest)));
    expect(plan.cells).toHaveLength(20);
    expect(new Set(plan.cells.map((cell) => cell.pairId)).size).toBe(10);
    expect(plan.cells.filter((cell) => cell.pairId === 'a:model-1:1')).toHaveLength(2);
  });
  it('summarizes complete, incomplete and asymmetric pairs plus usage', () => {
    const summary = summarizePairedResults([
      { variantId: 'raw', armIndex: 0, modelId: 'model-1', taskId: 'a', repetition: 1, reward: 1, costUsd: 0.1, inputTokens: 10, cacheTokens: 2, outputTokens: 5 },
      { variantId: 'cindy', armIndex: 1, modelId: 'model-1', taskId: 'a', repetition: 1, reward: 1, costUsd: 0.2, inputTokens: 11, cacheTokens: 3, outputTokens: 6 },
      { variantId: 'raw', armIndex: 0, modelId: 'model-1', taskId: 'b', repetition: 1, reward: 1 },
      { variantId: 'cindy', armIndex: 1, modelId: 'model-1', taskId: 'b', repetition: 1, reward: 0 },
      { variantId: 'raw', armIndex: 0, modelId: 'model-1', taskId: 'c', repetition: 1, reward: 0 },
    ]);
    expect(summary).toMatchObject({ pairCount: 3, completePairCount: 2, incompletePairCount: 1, bothPass: 1, bothFail: 0, firstArmOnlyPass: 1, secondArmOnlyPass: 0, totalInputTokens: 21, totalCacheTokens: 5, totalOutputTokens: 11 });
    expect(summary.totalCostUsd).toBeCloseTo(0.3);
  });
  it('rejects manifests that do not define exactly two paired arms', () => expect(() => validatePairedManifest(validateManifest({ ...manifest, variants: [{ id: 'only', supportedModelIds: ['model-1'] }] }))).toThrow(/exactly two/));
});
