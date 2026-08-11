import { describe, expect, it } from 'vitest';
import { classifyFailure, extractProviderUsage, parseOptionalTimeoutMs, usageMissingFields } from './host.js';

describe('Headless result classification', () => {
  it('classifies a terminal-free successful turn as completed', () => {
    expect(classifyFailure(undefined, undefined, false)).toBe('valid-completed');
  });

  it('keeps deadline and authentication failures distinct', () => {
    expect(classifyFailure('HEADLESS_DEADLINE_EXCEEDED', undefined, true)).toBe('valid-deadline-killed');
    expect(classifyFailure('401 unauthorized', undefined, false)).toBe('infra-invalid-auth');
    expect(classifyFailure('stream disconnected before completion', undefined, false)).toBe('infra-invalid-provider');
    expect(classifyFailure('HEADLESS_TERMINATED_SIGTERM', undefined, false)).toBe('infra-terminated-signal');
    expect(classifyFailure('spawn failed: cwd /app ENOENT', undefined, false)).toBe('infra-invalid-runtime');
    expect(classifyFailure('sdk_stream_crashed after HTTP 502', undefined, false)).toBe('infra-invalid-provider');
    expect(classifyFailure('HTTP 400 unsupported document block', undefined, false)).toBe('invalid-task-unsupported-capability');
  });

  it('has no internal deadline unless timeout-ms is explicit', () => {
    expect(parseOptionalTimeoutMs(undefined)).toBeNull();
    expect(parseOptionalTimeoutMs('1800')).toBe(1800);
    expect(() => parseOptionalTimeoutMs('0')).toThrow(/positive number/);
  });

  it('normalizes provider usage without double-counting cache tokens', () => {
    const usage = extractProviderUsage([{ type: 'done', data: { usage: { input_tokens: 3, cache_read_input_tokens: 10, cache_creation_input_tokens: 5, output_tokens: 7 }, total_cost_usd: 0.25 } }]);
    expect(usage.normalizedUsage).toEqual({ inputTokens: 3, cacheReadTokens: 10, cacheCreationTokens: 5, outputTokens: 7, costUsd: 0.25 });
  });

  it('does not treat an observed zero token component as missing', () => {
    expect(usageMissingFields({ cache_creation_input_tokens: 0, reconstructed_from: 'agentMeta+terminalStatus' }, 'PARTIAL')).toEqual([]);
    expect(usageMissingFields(null, 'MISSING')).toContain('inputTokens');
  });

  it('reconstructs current Claude usage from request metadata and terminal status', () => {
    const usage = extractProviderUsage([
      { type: 'thinking', data: {}, agentMeta: { requestId: 'request-1', usage: { inputTokens: 2, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 33054 } } },
      { type: 'text', data: {}, agentMeta: { requestId: 'request-1', usage: { inputTokens: 2, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 33054 } } },
      { type: 'text', data: {}, agentMeta: { requestId: 'request-2', usage: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 33054, cacheCreationInputTokens: 163 } } },
      { type: 'status', data: { status: 'Done', tokenUsage: 151, contextTokens: 33218, contextWindow: 1_000_000, costUsd: 0.138, isRunning: false } },
    ]);
    expect(usage.normalizedUsage).toEqual({ inputTokens: 3, cacheReadTokens: 33054, cacheCreationTokens: 33217, outputTokens: 148, costUsd: 0.138 });
    expect(usage.rawProviderUsage).toMatchObject({ reconstructed_from: 'agentMeta+terminalStatus' });
  });

  it('normalizes Codex per-turn usage', () => {
    const usage = extractProviderUsage([{ type: 'done', data: { usage: { promptTokens: 11, cachedTokens: 13, completionTokens: 17, reasoningTokens: 5 } } }], 'codex');
    expect(usage.normalizedUsage).toEqual({ inputTokens: 11, cacheReadTokens: 13, cacheCreationTokens: 0, outputTokens: 17, costUsd: 0 });
  });
});
