export const USAGE_SCHEMA_VERSION = 1 as const;

export interface NormalizedUsage {
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface UsageArtifact {
  schemaVersion: typeof USAGE_SCHEMA_VERSION;
  rawProviderUsage: Record<string, unknown> | null;
  normalizedUsage: NormalizedUsage;
  sessionSnapshot: {
    tokenUsage: number;
    contextTokens: number;
    contextWindow: number;
    costUsd: number;
  };
}

export function createUsageArtifact(input: {
  rawProviderUsage: Record<string, unknown> | null;
  normalizedUsage: NormalizedUsage;
  sessionSnapshot: UsageArtifact['sessionSnapshot'];
}): UsageArtifact {
  return { schemaVersion: USAGE_SCHEMA_VERSION, ...input };
}
