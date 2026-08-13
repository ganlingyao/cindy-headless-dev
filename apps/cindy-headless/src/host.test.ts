import { describe, expect, it } from 'vitest';
import { classifyFailure, deriveTurnStallMs, extractProviderUsage, modelCapabilityAdditions, normalizeTraceEvents } from './host.js';
import type { HeadlessProfile } from './profile.js';

describe('Headless result classification', () => {
  it('derives a watchdog below the outer deadline', () => {
    expect(deriveTurnStallMs(5_000_000)).toBe(4_000_000);
    expect(deriveTurnStallMs(1_800_000)).toBe(1_440_000);
    expect(deriveTurnStallMs(5_000)).toBe(1_000);
  });

  it('normalizes final snapshots without double-counting deltas', () => {
    const events = normalizeTraceEvents([
      { type: 'text', data: { text: 'hel', isFinal: false }, turnAttemptToken: 1 },
      { type: 'text', data: { text: 'hello', isFinal: true }, turnAttemptToken: 1 },
      { type: 'done', data: {}, turnAttemptToken: 1 },
    ]);
    expect(events).toHaveLength(2);
    expect(events[0].data).toMatchObject({ text: 'hello', isFinal: true });
  });

  it('classifies a terminal-free successful turn as completed', () => {
    expect(classifyFailure(undefined, undefined, false)).toBe('valid-completed');
  });

  it('keeps deadline and authentication failures distinct', () => {
    expect(classifyFailure('HEADLESS_DEADLINE_EXCEEDED', undefined, true)).toBe('valid-deadline-killed');
    expect(classifyFailure('401 unauthorized', undefined, false)).toBe('infra-invalid-auth');
    expect(classifyFailure('stream disconnected before completion', undefined, false)).toBe('infra-invalid-provider');
    expect(classifyFailure('Claude Code native binary not found at /opt/cindy-headless/bin/claude', undefined, false)).toBe('infra-agent-setup');
    expect(classifyFailure("Input tag 'document' does not match expected tags", undefined, false)).toBe('infra-invalid-request');
    expect(classifyFailure('Connection closed mid-response', undefined, false)).toBe('infra-invalid-provider');
    expect(classifyFailure('sdk_stream_crashed: upstream ended', undefined, false)).toBe('infra-invalid-provider');
    expect(classifyFailure('HTTP 502 from gateway', undefined, false)).toBe('infra-invalid-provider');
    expect(classifyFailure('killed by signal SIGKILL', undefined, false)).toBe('infra-invalid-provider');
    expect(classifyFailure('HEADLESS_TERMINATED_SIGTERM', undefined, false)).toBe('infra-terminated-signal');
  });

  it('normalizes provider usage without double-counting cache tokens', () => {
    const usage = extractProviderUsage([{ type: 'done', data: { usage: { input_tokens: 3, cache_read_input_tokens: 10, cache_creation_input_tokens: 5, output_tokens: 7 }, total_cost_usd: 0.25 } }]);
    expect(usage.normalizedUsage).toEqual({ inputTokens: 3, cacheReadTokens: 10, cacheCreationTokens: 5, outputTokens: 7, costUsd: 0.25 });
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

  it('injects an explicit context limit and preserves the agent default when omitted', () => {
    const profile = {
      model: { provider: 'moonshot', requestedId: 'moonshot/kimi-k3', contextLimit: 1_048_576 },
    } as HeadlessProfile;
    expect(modelCapabilityAdditions(profile)?.availableModels[0]).toMatchObject({
      id: 'moonshot/kimi-k3',
      contextWindow: 1_048_576,
    });
    expect(modelCapabilityAdditions({ ...profile, model: { ...profile.model, contextLimit: undefined } })).toBeUndefined();
  });
});
