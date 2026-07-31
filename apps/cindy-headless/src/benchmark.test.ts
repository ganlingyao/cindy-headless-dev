import { describe, expect, it } from 'vitest';
import { expandPlan, validateManifest, validateOracleGate } from './benchmark.js';

const manifest = { schemaVersion: 1, board: 'same-model-harness', dataset: { name: 'terminal-bench/terminal-bench-2-1', revision: '6', taskIds: ['e', 'd', 'c', 'b', 'a'] }, modelIds: ['model-1'], repetitions: 2, variants: [{ id: 'raw', supportedModelIds: ['model-1'] }, { id: 'cindy', supportedModelIds: ['model-1'] }], seed: 127 } as const;

describe('benchmark plan', () => {
  it('expands the full variant x model x task x repetition matrix', () => expect(expandPlan(validateManifest(manifest)).cells).toHaveLength(20));
  it('rejects unsupported same-model cells', () => expect(() => validateManifest({ ...manifest, variants: [{ id: 'raw', supportedModelIds: [] }] })).toThrow(/unsupported/));
  it('requires all sorted first-five Oracle rewards to pass', () => {
    const results = ['a', 'b', 'c', 'd', 'e'].map((taskId) => ({ taskId, reward: 1 }));
    expect(validateOracleGate([...manifest.dataset.taskIds], results).ok).toBe(true);
    expect(() => validateOracleGate([...manifest.dataset.taskIds], results.slice(1))).toThrow(/a/);
  });
});
