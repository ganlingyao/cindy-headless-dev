import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMemoryMcpProvider } from '@cindy/mcps/memory';
import { ClaudeCodeAgent, CodexAgent, Maker, MakerMemoryManager, isTerminalTurnEvent, type AgentEvent, type AgentKind, type AgentRuntimeConfig, type AuthAdapter, type BaseAgent, type Logger, type SessionMeta, type SessionStorage } from '@cindy/maker-core';
import { startCodexMemoryBridge, type CodexMemoryBridge } from './codex-memory-bridge.js';
import { sha256, type ResolvedProfile } from './profile.js';
import { readProjectContext } from './project-context.js';
import { openHeadlessSqlite } from './sqlite.js';
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

function claudeAuth(): AuthAdapter {
  return { async getState() { const key = process.env.CINDY_HEADLESS_API_KEY ?? process.env.ANTHROPIC_API_KEY; return { authenticated: Boolean(key), authSource: key ? 'api-key' : undefined }; }, async triggerLogin() { return this.getState(); }, async logout() {}, async getAuthEnv(): Promise<Record<string, string>> { const key = process.env.CINDY_HEADLESS_API_KEY ?? process.env.ANTHROPIC_API_KEY; return key ? { ANTHROPIC_API_KEY: key } : {}; } };
}

function codexAuth(): AuthAdapter {
  const configuredHome = process.env.CINDY_HEADLESS_CODEX_HOME ?? process.env.CODEX_HOME;
  const codexHome = configuredHome ? path.resolve(configuredHome) : undefined;
  return {
    async getState() { return { authenticated: Boolean(codexHome), authSource: codexHome ? 'oauth' : undefined, errorReason: codexHome ? undefined : 'missing_codex_home' }; },
    async triggerLogin() { return this.getState(); },
    async logout() {},
    async getAuthEnv(): Promise<Record<string, string>> { return codexHome ? { CODEX_HOME: codexHome } : {}; },
  };
}

function jsonLogger(): Logger {
  const write = (level: string, message: string, context?: Record<string, unknown>) => process.stderr.write(`${JSON.stringify({ level, message, ...context })}\n`);
  const result: Logger = { trace: (m, c) => write('trace', m, c), debug: (m, c) => write('debug', m, c), info: (m, c) => write('info', m, c), warn: (m, c) => write('warn', m, c), error: (m, c) => write('error', m, c), fatal: (m, c) => write('fatal', m, c), child: () => result };
  return result;
}

function createHeadlessMaker(resolved: ResolvedProfile, stateDir: string, workingDir: string): { maker: Maker; makerMemory: MakerMemoryManager; shutdownBridge(): Promise<void> } {
  const profile = resolved.profile;
  const logger = jsonLogger();
  const makerMemory = new MakerMemoryManager({
    basePath: stateDir,
    sqliteFactory: (filePath) => {
      const db = openHeadlessSqlite(filePath);
      db.pragma('journal_mode = WAL');
      db.pragma('busy_timeout = 5000');
      return db;
    },
    agents: {},
    logger: logger.child('maker-memory'),
    initialEnabled: profile.makerMemory,
    reviewAgent: profile.agentBackend,
  });
  const runtimeConfig: AgentRuntimeConfig = { endpoint: profile.endpoint, systemPrompt: resolved.systemPrompt, userDataPath: stateDir, memoryEnabled: profile.nativeMemory, makerMemoryEnabled: profile.makerMemory, behaviorFlags: profile.containerSandbox ? { IS_SANDBOX: '1' } : undefined, autoCompactThresholdPct: profile.compaction?.enabled ? profile.compaction.thresholdPct : undefined };
  const memoryProvider = createMemoryMcpProvider({ getManager: () => makerMemory, logger: logger.child('cindy-memory-mcp') });
  const memoryProviders = profile.makerMemory ? [memoryProvider] : [];
  let bridge: CodexMemoryBridge | undefined;
  let bridgePromise: Promise<CodexMemoryBridge> | undefined;
  let agent: BaseAgent;
  if (profile.agentBackend === 'claude-code') {
    agent = new ClaudeCodeAgent({ auth: claudeAuth(), runtimeConfig, binaryPath: profile.agentBinaryPath, logger, mcpProviders: memoryProviders, makerMemory });
  } else {
    agent = new CodexAgent({
      auth: codexAuth(),
      runtimeConfig,
      binaryPath: profile.agentBinaryPath,
      logger,
      mcpProviders: memoryProviders,
      makerMemory,
      prepareCodexExtraSpawnConfig: memoryProviders.length === 0 ? undefined : async () => {
        bridgePromise ??= startCodexMemoryBridge({ provider: memoryProvider, workingDir, logger });
        bridge = await bridgePromise;
        return { extraArgs: bridge.extraArgs, extraEnv: bridge.extraEnv };
      },
    });
  }
  const agents = { [profile.agentBackend]: agent } as Record<AgentKind, BaseAgent>;
  makerMemory.setAgents(agents);
  return {
    maker: new Maker({ agents, storage: new MemorySessionStorage(), logger, makerMemory }),
    makerMemory,
    async shutdownBridge() {
      if (!bridge && bridgePromise) bridge = await bridgePromise.catch(() => undefined);
      await bridge?.shutdown();
    },
  };
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

function standardResult(status: string, reward: number | null): 'PASSED' | 'FAILED_AGENT' | 'ERRORED_INFRA' | 'INVALID_TASK' | null {
  if (status === 'valid-completed') return reward === null ? null : reward === 1 ? 'PASSED' : 'FAILED_AGENT';
  if (status === 'valid-agent-error' || status === 'valid-deadline-killed') return 'FAILED_AGENT';
  if (status.includes('invalid-task')) return 'INVALID_TASK';
  return 'ERRORED_INFRA';
}

export function extractProviderUsage(events: AgentEvent[], agentBackend: AgentKind = 'claude-code'): { rawProviderUsage: Record<string, unknown> | null; normalizedUsage: NormalizedUsage } {
  const done = [...events].reverse().find((event) => event.type === 'done');
  const data = done?.data && typeof done.data === 'object' ? done.data as Record<string, unknown> : undefined;
  const raw = data?.usage && typeof data.usage === 'object' ? data.usage as Record<string, unknown> : null;
  const number = (key: string): number => typeof raw?.[key] === 'number' ? raw[key] as number : 0;
  if (agentBackend === 'codex') {
    return {
      rawProviderUsage: raw,
      normalizedUsage: {
        inputTokens: number('promptTokens'),
        cacheReadTokens: number('cachedTokens'),
        cacheCreationTokens: 0,
        outputTokens: number('completionTokens'),
        costUsd: 0,
      },
    };
  }
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

export async function runTask(resolved: ResolvedProfile, task: string, workingDir: string, outputDir: string, timeoutMs: number, turns: string[] = [task]): Promise<Record<string, unknown>> {
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
  let runtime: ReturnType<typeof createHeadlessMaker> | undefined;
  const startedAt = Date.now();
  let error: string | undefined;
  let deadlineKilled = false;
  let terminalError: AgentEvent | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const projectContext = await readProjectContext(absoluteWorkingDir, profile.projectContext);
  const stateDir = path.resolve(process.env.CINDY_HEADLESS_STATE_DIR ?? path.join(absoluteOutputDir, 'state'));
  try {
    await mkdir(stateDir, { recursive: true });
    runtime = createHeadlessMaker(resolved, stateDir, absoluteWorkingDir);
    session = await runtime.maker.createSession({ agentKind: profile.agentBackend, workingDir: absoluteWorkingDir, model: profile.model.requestedId, providerId: profile.model.provider, permissionMode: profile.permissionMode, makerMemoryEnabled: profile.makerMemory, userPrompt: projectContext.content, vendorOptions: { onStderrLine: (line: string) => { void appendFile(path.join(absoluteOutputDir, 'stderr.log'), `${line}\n`, 'utf8'); } }, id: `headless-${Date.now()}` });
    let resolveTerminal: (() => void) | undefined;
    let terminal = Promise.resolve();
    session.onEvent((event) => { events.push(event); if (event.type === 'error' && isTerminalTurnEvent(event)) terminalError = event; if (isTerminalTurnEvent(event)) resolveTerminal?.(); });
    for (const turn of turns.length > 0 ? turns : [task]) {
      terminal = new Promise<void>((resolve) => { resolveTerminal = resolve; });
      await session.send(turn);
      await Promise.race([terminal, new Promise<void>((_, reject) => { timer = setTimeout(() => reject(new Error('HEADLESS_DEADLINE_EXCEEDED')), timeoutMs); })]);
      if (timer) { clearTimeout(timer); timer = undefined; }
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
    deadlineKilled = error === 'HEADLESS_DEADLINE_EXCEEDED';
    if (deadlineKilled && session) await session.abort().catch(() => undefined);
  } finally {
    if (timer) clearTimeout(timer);
  }
  // Claude may emit the final `done` event while closing the SDK session. Flush
  // it before extracting provider usage so Harbor receives real token counts.
  try { await session?.close(); } catch { /* artifact writing must still run */ }
  const usage = session?.getUsageSnapshot() ?? { tokenUsage: 0, contextTokens: 0, contextWindow: 0, costUsd: 0 };
  const providerUsage = extractProviderUsage(events, profile.agentBackend);
  if (providerUsage.normalizedUsage.costUsd === 0 && usage.costUsd > 0) providerUsage.normalizedUsage.costUsd = usage.costUsd;
  const status = classifyFailure(error, terminalError, deadlineKilled);
  const reward = typeof process.env.CINDY_HEADLESS_REWARD === 'string' ? Number(process.env.CINDY_HEADLESS_REWARD) : null;
  const benchmark = process.env.CINDY_BENCHMARK ?? null;
  const taskId = process.env.CINDY_TASK_ID ?? null;
  const repetition = Number(process.env.CINDY_REPETITION ?? '0') || null;
  const runId = process.env.CINDY_RUN_ID ?? `local-${startedAt}`;
  const cellId = process.env.CINDY_CELL_ID ?? sha256(JSON.stringify({ benchmark, revision: process.env.CINDY_BENCHMARK_REVISION ?? null, taskId, agent: profile.id, model: profile.model.requestedId, repetition }));
  const attemptId = process.env.CINDY_ATTEMPT_ID ?? `${cellId}-${startedAt}`;
  const manifestDigest = process.env.CINDY_MANIFEST_DIGEST ?? null;
  const standard = standardResult(status, reward);
  const identity = { schemaVersion: 2, runId, cellId, attemptId, manifestDigest, benchmark, benchmarkRevision: process.env.CINDY_BENCHMARK_REVISION ?? null, taskId, repetition, profileId: profile.id, profileDigest: resolved.profileDigest, systemPromptDigest: resolved.systemPromptDigest, agentBackend: profile.agentBackend, agentBinaryVersion: profile.agentBinaryVersion, cindyCliVersion: '0.1.0', harborVersion: process.env.HARBOR_VERSION ?? null, litellmVersion: process.env.LITELLM_VERSION ?? null, requestedModelId: profile.model.requestedId, actualModelId: process.env.CINDY_ACTUAL_MODEL ?? profile.model.requestedId, provider: profile.model.provider, actualEndpoint: profile.endpoint ?? null, upstreamProvider: process.env.CINDY_UPSTREAM_PROVIDER ?? profile.model.provider, routeId: profile.model.routeId ?? null, containerSandbox: profile.containerSandbox ?? false, projectContext: profile.projectContext, projectContextInjected: projectContext.injected, projectContextDigest: projectContext.digest, makerMemory: profile.makerMemory, nativeMemory: profile.nativeMemory };
  const result = { schemaVersion: 2, status, resultClass: standard, reward, runId, cellId, attemptId, manifestDigest, benchmark, benchmarkRevision: process.env.CINDY_BENCHMARK_REVISION ?? null, taskId, repetition, sessionId: session?.id ?? null, turnsCount: turns.length > 0 ? turns.length : 1, durationMs: Date.now() - startedAt, error: error ?? null, terminalError: terminalError?.data ?? null, eventsCount: events.length, retries: Number(process.env.CINDY_RETRY_COUNT ?? '0') || 0, replacesAttemptId: process.env.CINDY_REPLACES_ATTEMPT_ID ?? null };
  try { await runtime?.maker.shutdown(); } catch { /* best effort cleanup */ }
  try { await runtime?.shutdownBridge(); } catch { /* best effort cleanup */ }
  for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value;
  await rm(cleanHome, { recursive: true, force: true });
  await Promise.all([
    writeFile(path.join(absoluteOutputDir, 'identity.json'), JSON.stringify(identity, null, 2) + '\n', 'utf8'),
    writeFile(path.join(absoluteOutputDir, 'config.json'), JSON.stringify({ profilePath: resolved.profilePath, workingDir: absoluteWorkingDir, stateDir, timeoutMs, projectContext: { injected: projectContext.injected, reason: projectContext.reason ?? null, tocPath: projectContext.tocPath, digest: projectContext.digest } }, null, 2) + '\n', 'utf8'),
    writeFile(path.join(absoluteOutputDir, 'trace.jsonl'), events.map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : ''), 'utf8'),
    writeFile(path.join(absoluteOutputDir, 'usage.json'), JSON.stringify(createUsageArtifact({ ...providerUsage, sessionSnapshot: usage }), null, 2) + '\n', 'utf8'),
    writeFile(path.join(absoluteOutputDir, 'result.json'), JSON.stringify(result, null, 2) + '\n', 'utf8'),
  ]);
  return { ...result, usage };
}
