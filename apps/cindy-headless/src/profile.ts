import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface HeadlessProfile {
  id: string;
  version: 1;
  parentProfile?: string;
  changedDimensions?: string[];
  agentBackend: 'claude-code';
  agentBinaryPath: string;
  agentBinaryVersion: string;
  supportedModelIds: string[];
  model: {
    provider: string;
    requestedId: string;
    routeId?: string;
    contextLimit?: number;
    thinkingBudget?: number | string;
  };
  endpoint?: string;
  permissionMode: 'bypassPermissions' | 'acceptEdits' | 'default' | 'ask' | 'plan';
  systemPromptFile?: string;
  expectedSystemPromptDigest?: string;
  makerMemory: boolean;
  nativeMemory: boolean;
  projectContext: boolean;
  containerSandbox?: boolean;
  compaction?: { enabled: boolean; thresholdPct?: number };
  throughputCap?: { outputTokensPerSecond: number; enforcement: 'external-proxy' };
}

export interface ResolvedProfile {
  profile: HeadlessProfile;
  profilePath: string;
  systemPrompt?: string;
  profileDigest: string;
  systemPromptDigest: string | null;
}

export interface ProfileCapabilities {
  schemaVersion: 1;
  profileId: string;
  agentBackend: 'claude-code';
  supportedModelIds: string[];
  supportedPermissionModes: string[];
  projectContext: boolean;
  makerMemory: boolean;
  nativeMemory: boolean;
  nativeToolSurface: 'claude-code-default';
  cindyMcpProviders: string[];
  desktopOnlyProviders: string[];
  multiTurnSession: true;
  artifactContract: string[];
}

function nonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} must be a non-empty string`);
}

export function validateProfile(profile: unknown): HeadlessProfile {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('profile must be an object');
  const value = profile as Partial<HeadlessProfile>;
  nonEmptyString(value.id, 'profile.id');
  nonEmptyString(value.agentBinaryPath, 'agentBinaryPath');
  nonEmptyString(value.agentBinaryVersion, 'agentBinaryVersion');
  if (value.version !== 1) throw new Error('profile.version must be 1');
  if (value.agentBackend !== 'claude-code') throw new Error('only claude-code backend is supported in Phase 0');
  if (!Array.isArray(value.supportedModelIds) || value.supportedModelIds.length === 0) throw new Error('supportedModelIds must be non-empty');
  if (value.supportedModelIds.some((id) => typeof id !== 'string' || id.trim() === '' || id === '*' || id === 'latest')) throw new Error('supportedModelIds must contain exact non-empty model IDs');
  if (new Set(value.supportedModelIds).size !== value.supportedModelIds.length) throw new Error('supportedModelIds must not contain duplicates');
  if (!value.model || typeof value.model !== 'object') throw new Error('model is required');
  nonEmptyString(value.model.provider, 'model.provider');
  nonEmptyString(value.model.requestedId, 'model.requestedId');
  if (!value.supportedModelIds.includes(value.model.requestedId)) throw new Error(`model ${value.model.requestedId} is not supported by this profile`);
  if (!['bypassPermissions', 'acceptEdits', 'default', 'ask', 'plan'].includes(value.permissionMode ?? '')) throw new Error('unsupported permissionMode');
  if (typeof value.makerMemory !== 'boolean' || typeof value.nativeMemory !== 'boolean' || typeof value.projectContext !== 'boolean') throw new Error('makerMemory, nativeMemory and projectContext must be boolean');
  if (value.makerMemory && value.nativeMemory) throw new Error('makerMemory and nativeMemory are mutually exclusive');
  if (value.containerSandbox !== undefined && typeof value.containerSandbox !== 'boolean') throw new Error('containerSandbox must be boolean');
  if (value.parentProfile && (!value.changedDimensions || value.changedDimensions.length === 0)) throw new Error('derived profiles require changedDimensions');
  if (!value.parentProfile && value.changedDimensions?.length) throw new Error('changedDimensions requires parentProfile');
  if (value.compaction?.enabled && (!Number.isFinite(value.compaction.thresholdPct) || (value.compaction.thresholdPct ?? 0) < 50 || (value.compaction.thresholdPct ?? 0) > 95)) throw new Error('enabled compaction thresholdPct must be between 50 and 95');
  if (value.throughputCap && (!Number.isFinite(value.throughputCap.outputTokensPerSecond) || value.throughputCap.outputTokensPerSecond <= 0 || value.throughputCap.enforcement !== 'external-proxy')) throw new Error('throughputCap requires a positive rate and external-proxy enforcement');
  if (value.expectedSystemPromptDigest && !/^[a-f0-9]{64}$/.test(value.expectedSystemPromptDigest)) throw new Error('expectedSystemPromptDigest must be a lowercase sha256 digest');
  return value as HeadlessProfile;
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonicalize(child)]));
}

export function profileDigest(profile: HeadlessProfile): string {
  return sha256(JSON.stringify(canonicalize(profile)));
}

export async function readProfile(profilePath: string): Promise<ResolvedProfile> {
  const absolutePath = path.resolve(profilePath);
  const profile = validateProfile(JSON.parse(await readFile(absolutePath, 'utf8')));
  const endpointOverride = process.env.CINDY_HEADLESS_BASE_URL ?? process.env.ANTHROPIC_BASE_URL;
  if (!profile.endpoint && endpointOverride) profile.endpoint = endpointOverride;
  let systemPrompt: string | undefined;
  let systemPromptDigest: string | null = null;
  if (profile.systemPromptFile) {
    const promptPath = path.resolve(path.dirname(absolutePath), profile.systemPromptFile);
    systemPrompt = await readFile(promptPath, 'utf8');
    systemPromptDigest = sha256(systemPrompt);
    if (profile.expectedSystemPromptDigest && profile.expectedSystemPromptDigest !== systemPromptDigest) throw new Error('system prompt digest does not match expectedSystemPromptDigest');
  } else if (profile.expectedSystemPromptDigest) {
    throw new Error('expectedSystemPromptDigest requires systemPromptFile');
  }
  return { profile, profilePath: absolutePath, systemPrompt, profileDigest: profileDigest(profile), systemPromptDigest };
}

export async function doctor(resolved: ResolvedProfile, outputDir?: string): Promise<{ ok: true; checks: Record<string, string | boolean> }> {
  await access(resolved.profile.agentBinaryPath);
  if (!(process.env.CINDY_HEADLESS_API_KEY ?? process.env.ANTHROPIC_API_KEY)) throw new Error('CINDY_HEADLESS_API_KEY or ANTHROPIC_API_KEY is required');
  const versionResult = await execFileAsync(resolved.profile.agentBinaryPath, ['--version'], { timeout: 30_000 });
  const observedVersion = `${versionResult.stdout} ${versionResult.stderr}`.trim();
  if (!observedVersion.includes(resolved.profile.agentBinaryVersion)) throw new Error(`agent binary version mismatch: expected ${resolved.profile.agentBinaryVersion}, observed ${observedVersion}`);
  if (outputDir) {
    await mkdir(path.resolve(outputDir), { recursive: true });
    await access(path.resolve(outputDir));
  }
  return { ok: true, checks: { profile: true, agentBinary: resolved.profile.agentBinaryPath, agentBinaryVersion: observedVersion, authEnvironment: true, endpointConfigured: Boolean(resolved.profile.endpoint), outputDirectory: outputDir ? path.resolve(outputDir) : 'not-requested', systemPromptDigest: resolved.systemPromptDigest ?? 'none' } };
}

export function capabilities(profile: HeadlessProfile): ProfileCapabilities {
  return { schemaVersion: 1, profileId: profile.id, agentBackend: profile.agentBackend, supportedModelIds: [...profile.supportedModelIds], supportedPermissionModes: ['bypassPermissions', 'acceptEdits', 'default', 'ask', 'plan'], projectContext: profile.projectContext, makerMemory: profile.makerMemory, nativeMemory: profile.nativeMemory, nativeToolSurface: 'claude-code-default', cindyMcpProviders: profile.makerMemory ? ['cindy_memory'] : [], desktopOnlyProviders: [], multiTurnSession: true, artifactContract: ['identity.json', 'config.json', 'trace.jsonl', 'stderr.log', 'usage.json', 'result.json'] };
}
