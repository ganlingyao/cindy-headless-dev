import { describe, expect, it } from 'vitest';
import { createUsageArtifact, USAGE_SCHEMA_VERSION } from './usage.js';

describe('usage artifact schema', () => {
  it('keeps provider usage and session snapshot separate', () => {
    const artifact = createUsageArtifact({
      rawProviderUsage: { input_tokens: 3 },
      normalizedUsage: { inputTokens: 3, cacheReadTokens: 10, cacheCreationTokens: 5, outputTokens: 7, costUsd: 0.25 },
      sessionSnapshot: { tokenUsage: 20, contextTokens: 18, contextWindow: 1000, costUsd: 0.25 },
    });
    expect(artifact.schemaVersion).toBe(USAGE_SCHEMA_VERSION);
    expect(artifact.normalizedUsage).toEqual({ inputTokens: 3, cacheReadTokens: 10, cacheCreationTokens: 5, outputTokens: 7, costUsd: 0.25 });
    expect(artifact.sessionSnapshot.contextTokens).toBe(18);
  });
});
