import { describe, expect, it } from 'vitest';
import { classifyFailure, extractProviderUsage } from './host.js';

describe('Headless result classification', () => {
  it('classifies a terminal-free successful turn as completed', () => {
    expect(classifyFailure(undefined, undefined, false)).toBe('valid-completed');
  });

  it('keeps deadline and authentication failures distinct', () => {
    expect(classifyFailure('HEADLESS_DEADLINE_EXCEEDED', undefined, true)).toBe('valid-deadline-killed');
    expect(classifyFailure('401 unauthorized', undefined, false)).toBe('infra-invalid-auth');
  });

  it('normalizes provider usage without double-counting cache tokens', () => {
    const usage = extractProviderUsage([{ type: 'done', data: { usage: { input_tokens: 3, cache_read_input_tokens: 10, cache_creation_input_tokens: 5, output_tokens: 7 }, total_cost_usd: 0.25 } }]);
    expect(usage.normalizedUsage).toEqual({ inputTokens: 3, cacheReadTokens: 10, cacheCreationTokens: 5, outputTokens: 7, costUsd: 0.25 });
  });
});
