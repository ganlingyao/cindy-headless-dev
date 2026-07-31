import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ClaudeCodeAgent, Maker, isTerminalTurnEvent, type AgentEvent, type AgentRuntimeConfig, type AuthAdapter, type Logger, type SessionMeta, type SessionStorage } from '@cindy/maker-core';
import type { ResolvedProfile } from './profile.js';
import { createUsageArtifact, type NormalizedUsage } from './usage.js';

class MemorySessionStorage implements SessionStorage {
  private readonly rows = new Map<string, SessionMeta>();
  async create(meta: Omit<SessionMeta, 'createdAt' | 'updatedAt'>): Promise<SessionMeta> { const now = Date.now(); const row: SessionMeta = { ...meta, createdAt: now, updatedAt: now }; this.rows.set(row.id, row); return row; }
  async get(id: string): Promise<SessionMeta | null> { return this.rows.get(id) ?? null; }
  async list(): Promise<SessionMeta[]> { return [...this.rows.values()]; }
  async update(id: string, patch: Partial<SessionMeta>): Promise<SessionMeta> { const old = this.rows.get(id); if (!old) throw new Error(`unknown session ${id}`); const row = { ...old, ...patch, updatedAt: Date.now() }; this.rows.set(id, row); return row; }
  async compareAndClearSdkSessionId(id: string, expected: string): Promise<boolean> { const row = this.rows.get(id); if (!row || row.sdkSessionId !== expected) return false; await this.update(id, { sdkSessionId: undefined }); return true; }
  async delete(id: string): Promise<void> { this.rows.delete(id); }
}

function envAuth(): AuthAdapter {
  return { async getState() { const key = process.env.CINDY_HEADLESS_API_KEY ?? process.env.ANTHROPIC_API_KEY; return { authenticated: Boolean(key), authSource: key ? 'api-key' : undefined }; }, async triggerLogin() { return this.getState(); }, async logout() {}, async getAuthEnv(): Promise<Record<string, string>> { const key = process.env.CINDY_HEADLESS_API_KEY ?? process.env.ANTHROPIC_API_KEY; return key ? { ANTHROPIC_API_KEY: key } : {}; } };
}

function jsonLogger(): Logger {
  const write = (level: string, message: string, context?: Record<string, unknown>) => process.stderr.write(`${JSON.stringify({ level, message, ...context })}\n`);
  const result: Logger = { trace: (m, c) => write('trace', m, c), debug: (m, c) => write('debug', m, c), info: (m, c) => write('info', m, c), warn: (m, c) => write('warn', m, c), error: (m, c) => write('error', m, c), fatal: (m, c) => write('fatal', m, c), child: () => result };
  return result;
}

function createHeadlessMaker(resolved: ResolvedProfile): Maker {
  const profile = resolved.profile;
  const runtimeConfig: AgentRuntimeConfig = { endpoint: profile.endpoint, systemPrompt: resolved.systemPrompt, memoryEnabled: false, makerMemoryEnabled: false, behaviorFlags: profile.containerSandbox ? { IS_SANDBOX: '1' } : undefined, autoCompactThresholdPct: profile.compaction?.enabled ? profile.compaction.thresholdPct : undefined };
  const agent = new ClaudeCodeAgent({ auth: envAuth(), runtimeConfig, binaryPath: profile.agentBinaryPath, logger: jsonLogger() });
  return new Maker({ agents: { 'claude-code': agent }, storage: new MemorySessionStorage(), logger: jsonLogger() });
}

export function classifyFailure(error: string | undefined, terminalError: AgentEvent | undefined, deadlineKilled: boolean): string {
  if (deadlineKilled) return 'valid-deadline-killed';
  if (!error && !terminalError) return 'valid-completed';
  const text = `${error ?? ''} ${terminalError ? JSON.stringify(terminalError.data) : ''}`.toLowerCase();
  if (/auth|api.?key|unauthorized|401/.test(text)) return 'infra-invalid-auth';
  if (/model.*(not found|unsupported)|route|requested.*effective/.test(text)) return 'infra-invalid-route';
  if (/rate.?limit|overload|provider|network|econn|timeout/.test(text)) return 'infra-invalid-provider';
  return 'valid-agent-error';
}

export function extractProviderUsage(events: AgentEvent[]): { rawProviderUsage: Record<string, unknown> | null; normalizedUsage: NormalizedUsage } {
  const done = [...events].reverse().find((event) => event.type === 'done');
  const data = done?.data && typeof done.data === 'object' ? done.data as Record<string, unknown> : undefined;
  const raw = data?.usage && typeof data.usage === 'object' ? data.usage as Record<string, unknown> : null;
  const number = (key: string): number => typeof raw?.[key] === 'number' ? raw[key] as number : 0;
  return {
    rawProviderUsage: raw,
    normalizedUsage: {
      inputTokens: number('input_tokens'),
      cacheReadTokens: number('cache_read_input_tokens'),
      cacheCreationTokens: number('cache_creation_input_tokens'),
      outputTokens: number('output_tokens'),
      costUsd: typeof data?.total_cost_usd === 'number' ? data.total_cost_usd : 0,
    },
  };
}

export async function runTask(resolved: ResolvedProfile, task: string, workingDir: string, outputDir: string, timeoutMs: number): Promise<Record<string, unknown>> {
  const profile = resolved.profile;
  const absoluteOutputDir = path.resolve(outputDir);
  const absoluteWorkingDir = path.resolve(workingDir);
  await mkdir(absoluteOutputDir, { recursive: true });
  const cleanHome = await mkdtemp(path.join(os.tmpdir(), 'cindy-headless-'));
  const previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };
  process.env.HOME = cleanHome;
  process.env.USERPROFILE = cleanHome;
  process.env.CLAUDE_CONFIG_DIR = path.join(cleanHome, '.claude');
  const events: AgentEvent[] = [];
  let session: Awaited<ReturnType<Maker['createSession']>> | undefined;
  const startedAt = Date.now();
  let error: string | undefined;
  let deadlineKilled = false;
  let terminalError: AgentEvent | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const maker = createHeadlessMaker(resolved);
    session = await maker.createSession({ agentKind: 'claude-code', workingDir: absoluteWorkingDir, model: profile.model.requestedId, providerId: profile.model.provider, permissionMode: profile.permissionMode, makerMemoryEnabled: false, vendorOptions: { onStderrLine: (line: string) => { void appendFile(path.join(absoluteOutputDir, 'stderr.log'), `${line}\n`, 'utf8'); } }, id: `headless-${Date.now()}` });
    let resolveTerminal!: () => void;
    const terminal = new Promise<void>((resolve) => { resolveTerminal = resolve; });
    session.onEvent((event) => { events.push(event); if (event.type === 'error' && isTerminalTurnEvent(event)) terminalError = event; if (isTerminalTurnEvent(event)) resolveTerminal(); });
    await session.send(task);
    await Promise.race([terminal, new Promise<void>((_, reject) => { timer = setTimeout(() => reject(new Error('HEADLESS_DEADLINE_EXCEEDED')), timeoutMs); })]);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
    deadlineKilled = error === 'HEADLESS_DEADLINE_EXCEEDED';
    if (deadlineKilled && session) await session.abort().catch(() => undefined);
  } finally {
    if (timer) clearTimeout(timer);
  }
  const usage = session?.getUsageSnapshot() ?? { tokenUsage: 0, contextTokens: 0, contextWindow: 0, costUsd: 0 };
  const providerUsage = extractProviderUsage(events);
  const identity = { schemaVersion: 1, profileId: profile.id, profileDigest: resolved.profileDigest, systemPromptDigest: resolved.systemPromptDigest, agentBackend: profile.agentBackend, agentBinaryVersion: profile.agentBinaryVersion, requestedModelId: profile.model.requestedId, provider: profile.model.provider, routeId: profile.model.routeId ?? null, containerSandbox: profile.containerSandbox ?? false, projectContext: false, makerMemory: false, nativeMemory: false };
  const status = classifyFailure(error, terminalError, deadlineKilled);
  const result = { schemaVersion: 1, status, sessionId: session?.id ?? null, durationMs: Date.now() - startedAt, error: error ?? null, terminalError: terminalError?.data ?? null, eventsCount: events.length };
  try { if (session) await session.close(); } finally {
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value;
    await rm(cleanHome, { recursive: true, force: true });
  }
  await Promise.all([
    writeFile(path.join(absoluteOutputDir, 'identity.json'), JSON.stringify(identity, null, 2) + '\n', 'utf8'),
    writeFile(path.join(absoluteOutputDir, 'config.json'), JSON.stringify({ profilePath: resolved.profilePath, workingDir: absoluteWorkingDir, timeoutMs }, null, 2) + '\n', 'utf8'),
    writeFile(path.join(absoluteOutputDir, 'trace.jsonl'), events.map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : ''), 'utf8'),
    writeFile(path.join(absoluteOutputDir, 'usage.json'), JSON.stringify(createUsageArtifact({ ...providerUsage, sessionSnapshot: usage }), null, 2) + '\n', 'utf8'),
    writeFile(path.join(absoluteOutputDir, 'result.json'), JSON.stringify(result, null, 2) + '\n', 'utf8'),
  ]);
  return { ...result, usage };
}
