import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  McpProvider,
  McpProviderContext,
  PiNativeProvidersResult,
  PiProjectTrustInputSnapshot,
  UserMessage,
} from '@cindy/maker-core';
import type { HeadlessProfile } from './profile.js';

const execFileAsync = promisify(execFile);

export interface HeadlessTurnInput {
  text: string;
  attachments?: Array<{ type: 'file' | 'image'; path: string; mimeType?: string }>;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function validateTurnInput(value: unknown): string | HeadlessTurnInput {
  if (typeof value === 'string' && value.trim()) return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('each turn must be a non-empty string or structured turn');
  const turn = value as Partial<HeadlessTurnInput>;
  if (typeof turn.text !== 'string' || !turn.text.trim()) throw new Error('structured turn.text must be non-empty');
  if (turn.attachments !== undefined && !Array.isArray(turn.attachments)) throw new Error('structured turn.attachments must be an array');
  for (const attachment of turn.attachments ?? []) {
    if (!attachment || !['file', 'image'].includes(attachment.type) || typeof attachment.path !== 'string' || !attachment.path.trim()) throw new Error('attachment requires type=file|image and a non-empty path');
    if (path.isAbsolute(attachment.path) || attachment.path.split(/[\\/]/).includes('..')) throw new Error('attachment paths must be workspace-relative without parent traversal');
  }
  return turn as HeadlessTurnInput;
}

export async function resolveTurns(
  rawTurns: unknown[],
  workingDir: string,
  policy: HeadlessProfile['inputPolicy'],
): Promise<Array<string | UserMessage>> {
  const workspace = await realpath(workingDir);
  return Promise.all(rawTurns.map(async (raw) => {
    const turn = validateTurnInput(raw);
    if (typeof turn === 'string') return turn;
    const attachments = turn.attachments ?? [];
    if (attachments.length > 0 && !policy?.attachments) throw new Error('profile does not enable attachments');
    if (attachments.length > (policy?.maxFiles ?? 16)) throw new Error('turn exceeds inputPolicy.maxFiles');
    const content: Exclude<UserMessage['content'], string> = [{ type: 'text', text: turn.text }];
    for (const attachment of attachments) {
      const lexical = path.resolve(workspace, attachment.path);
      const canonical = await realpath(lexical);
      if (!isWithin(workspace, canonical)) throw new Error(`attachment escapes working directory: ${attachment.path}`);
      const metadata = await stat(canonical);
      if (!metadata.isFile()) throw new Error(`attachment is not a file: ${attachment.path}`);
      if (metadata.size > (policy?.maxFileBytes ?? 25 * 1024 * 1024)) throw new Error(`attachment exceeds inputPolicy.maxFileBytes: ${attachment.path}`);
      content.push({ type: attachment.type, path: canonical, ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}) });
    }
    return { type: 'user', content } satisfies UserMessage;
  }));
}

export class HeadlessRemoteMcpProvider implements McpProvider {
  readonly name: string;

  constructor(private readonly config: NonNullable<HeadlessProfile['mcpServers']>[number]) {
    this.name = config.id;
  }

  private environment(): Record<string, string> {
    const names = [this.config.bearerTokenEnvVar, ...Object.values(this.config.headerEnvVars ?? {})].filter((name): name is string => Boolean(name));
    return Object.fromEntries(names.map((name) => {
      const value = process.env[name];
      if (!value) throw new Error(`custom MCP ${this.name} requires environment variable ${name}`);
      return [name, value];
    }));
  }

  toClaudeSdkConfig(_context: McpProviderContext): unknown {
    const env = this.environment();
    const headers = Object.fromEntries(Object.entries(this.config.headerEnvVars ?? {}).map(([header, envName]) => [header, env[envName]!])) as Record<string, string>;
    if (this.config.bearerTokenEnvVar && !Object.keys(headers).some((header) => header.toLowerCase() === 'authorization')) headers.Authorization = `Bearer ${env[this.config.bearerTokenEnvVar]}`;
    return { type: 'http', url: this.config.url, ...(Object.keys(headers).length ? { headers } : {}) };
  }

  toCodexMcpConfig(_context: McpProviderContext) {
    return {
      type: 'http' as const,
      url: new URL(this.config.url).href.replace(/\\/g, '%5C'),
      ...(this.config.bearerTokenEnvVar ? { bearerTokenEnvVar: this.config.bearerTokenEnvVar } : {}),
      ...(this.config.headerEnvVars && Object.keys(this.config.headerEnvVars).length ? { envHttpHeaders: this.config.headerEnvVars } : {}),
    };
  }

  getExtraEnv(_context: McpProviderContext): Record<string, string> {
    return this.environment();
  }
}

export function resolveNativeProviders(profile: HeadlessProfile): PiNativeProvidersResult {
  const providers = (profile.nativeProviders ?? []).map((provider) => ({ ...provider }));
  const env: Record<string, string> = {};
  for (const provider of providers) {
    if (!provider.apiKeyEnvVar) continue;
    const value = process.env[provider.apiKeyEnvVar];
    if (!value) throw new Error(`native provider ${provider.id} requires environment variable ${provider.apiKeyEnvVar}`);
    env[provider.apiKeyEnvVar] = value;
  }
  return { providers, env };
}

async function hashTree(entryPath: string, root: string, hash: ReturnType<typeof createHash>): Promise<void> {
  const metadata = await lstat(entryPath);
  if (metadata.isSymbolicLink()) throw new Error(`Pi skill tree contains a symbolic link: ${entryPath}`);
  const relative = path.relative(root, entryPath).replaceAll('\\', '/');
  if (metadata.isFile()) {
    hash.update(`f\0${relative}\0`);
    hash.update(await readFile(entryPath));
    return;
  }
  if (!metadata.isDirectory()) throw new Error(`Pi skill tree contains a special file: ${entryPath}`);
  hash.update(`d\0${relative}\0`);
  const children = await readdir(entryPath);
  children.sort();
  for (const child of children) await hashTree(path.join(entryPath, child), root, hash);
}

export async function resolvePiProjectTrust(
  workingDir: string,
  config: NonNullable<HeadlessProfile['piProjectSkills']>,
): Promise<PiProjectTrustInputSnapshot | null> {
  if (!config.enabled) return null;
  const canonicalWorkingDir = await realpath(workingDir);
  const { stdout } = await execFileAsync('git', ['-C', canonicalWorkingDir, 'rev-parse', '--show-toplevel'], { timeout: 10_000 });
  const canonicalRepoRoot = await realpath(stdout.trim());
  if (!isWithin(canonicalRepoRoot, canonicalWorkingDir)) throw new Error('Pi project working directory is outside its Git root');
  const skills: string[] = [];
  const configuredRoots: string[] = [];
  for (const relativeRoot of config.roots) {
    const normalizedRoot = relativeRoot.replaceAll('\\', '/');
    if (normalizedRoot === '.pi/skills') configuredRoots.push(path.join(canonicalWorkingDir, '.pi', 'skills'));
    else if (normalizedRoot === '.agents/skills') {
      let cursor = canonicalWorkingDir;
      while (true) {
        configuredRoots.push(path.join(cursor, '.agents', 'skills'));
        if (path.resolve(cursor) === path.resolve(canonicalRepoRoot)) break;
        cursor = path.dirname(cursor);
      }
    } else configuredRoots.push(path.resolve(canonicalRepoRoot, relativeRoot));
  }
  for (const rootPath of [...new Set(configuredRoots)]) {
    let entries;
    try { entries = await readdir(rootPath, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() && !entry.isFile()) throw new Error(`Pi skill root contains a non-regular entry: ${entry.name}`);
      const candidate = await realpath(path.join(rootPath, entry.name));
      if (!isWithin(canonicalRepoRoot, candidate)) throw new Error(`Pi skill escapes repository: ${candidate}`);
      if (entry.isDirectory()) {
        const marker = path.join(candidate, 'SKILL.md');
        try { if (!(await stat(marker)).isFile()) continue; } catch { continue; }
      } else if (!entry.name.toLowerCase().endsWith('.md')) continue;
      skills.push(candidate);
    }
  }
  const revisionHash = createHash('sha256');
  for (const skill of skills) {
    revisionHash.update(`skill\0${path.relative(canonicalRepoRoot, skill).replaceAll('\\', '/')}\0`);
    await hashTree(skill, skill, revisionHash);
  }
  const revision = revisionHash.digest('hex');
  const platform = process.platform === 'win32' ? 'win32' as const : 'posix' as const;
  const identity = {
    workingDir: path.resolve(workingDir),
    canonicalWorkingDir,
    canonicalRepoRoot,
    repoRootStatus: 'resolved' as const,
    platform,
    canonicalPathEncoding: platform === 'win32' ? 'utf16-lossless' as const : 'utf8-lossless' as const,
    ...(platform === 'win32' ? { windowsCaseComparison: 'ordinal-insensitive' as const } : {}),
  };
  return {
    identity,
    approval: { status: 'approved', scope: 'working-dir', scopeKey: `${canonicalRepoRoot}\0${canonicalWorkingDir}`, revision: `headless-profile:${revision}` },
    discovered: {
      skills,
      canonicalSkillEvidence: skills.map((skill) => ({ discoveredPath: skill, canonicalPath: skill })),
      settings: [],
      packages: [],
      extensions: [],
    },
  };
}
