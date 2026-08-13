import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { capabilities, profileDigest, readProfile, validateProfile } from './profile.js';

const profile = { id: 'cindy-production-claude', version: 1, agentBackend: 'claude-code', agentBinaryPath: '/opt/cindy/bin/claude', agentBinaryVersion: '2.1.219', supportedModelIds: ['claude-sonnet-4-5'], model: { provider: 'anthropic', requestedId: 'claude-sonnet-4-5' }, permissionMode: 'bypassPermissions', makerMemory: false, nativeMemory: false, projectContext: false } as const;
const codexProfile = { ...profile, id: 'cindy-production-codex', agentBackend: 'codex', agentBinaryPath: '/opt/cindy/bin/codex', agentBinaryVersion: '0.145.0', supportedModelIds: ['gpt-5.4-mini'], model: { provider: 'openai', requestedId: 'gpt-5.4-mini' }, permissionMode: 'auto' } as const;

describe('headless profile', () => {
  it('rejects model fallback and aliases', () => {
    expect(() => validateProfile({ ...profile, model: { ...profile.model, requestedId: 'other' } })).toThrow(/not supported/);
    expect(() => validateProfile({ ...profile, supportedModelIds: ['latest'], model: { ...profile.model, requestedId: 'latest' } })).toThrow(/exact/);
  });
  it('requires single-variable metadata for derived profiles', () => expect(() => validateProfile({ ...profile, parentProfile: 'base' })).toThrow(/changedDimensions/));
  it('keeps Cindy Maker Memory mutually exclusive with native Agent memory', () => expect(() => validateProfile({ ...profile, makerMemory: true, nativeMemory: true })).toThrow(/mutually exclusive/));
  it('reports the original Cindy harness switches in capabilities', () => expect(capabilities(validateProfile({ ...profile, makerMemory: true, projectContext: true }))).toMatchObject({ makerMemory: true, nativeMemory: false, projectContext: true, nativeToolSurface: 'claude-code-default', cindyMcpProviders: ['cindy_memory'], desktopOnlyProviders: [], multiTurnSession: true }));
  it('reports Cindy Codex app-server capabilities', () => expect(capabilities(validateProfile({ ...codexProfile, makerMemory: true }))).toMatchObject({ agentBackend: 'codex', nativeToolSurface: 'codex-app-server-default', supportedPermissionModes: ['bypassPermissions', 'ask', 'auto', 'plan'], cindyMcpProviders: ['cindy_memory'] }));
  it('rejects backend-specific permission modes', () => {
    expect(() => validateProfile({ ...profile, permissionMode: 'auto' })).toThrow(/only supported by codex/);
    expect(() => validateProfile({ ...codexProfile, permissionMode: 'acceptEdits' })).toThrow(/not supported by codex/);
  });
  it('accepts Cindy planning permission mode', () => expect(validateProfile({ ...profile, permissionMode: 'plan' }).permissionMode).toBe('plan'));
  it('requires unsafe bypass exceptions to be explicit and relevant', () => {
    expect(() => validateProfile({ ...profile, permissionMode: 'ask', unsafeAllowUnsandboxedBypass: true })).toThrow(/requires bypassPermissions/);
    expect(validateProfile({ ...profile, unsafeAllowUnsandboxedBypass: true }).unsafeAllowUnsandboxedBypass).toBe(true);
  });
  it('returns stable capabilities and canonical digest', () => {
    const valid = validateProfile(profile);
    expect(capabilities(valid).artifactContract).toContain('identity.json');
    expect(profileDigest(valid)).toBe(profileDigest({ ...valid, supportedModelIds: [...valid.supportedModelIds] }));
  });
  it('accepts the no-compaction and tool-surface profile dimensions', () => {
    expect(validateProfile({ ...profile, parentProfile: 'cindy-production-claude', changedDimensions: ['compaction'], compaction: { enabled: false } }).compaction?.enabled).toBe(false);
    expect(validateProfile({ ...profile, parentProfile: 'cindy-production-claude', changedDimensions: ['cindyToolSurface'], makerMemory: false, projectContext: false }).projectContext).toBe(false);
  });
  it('verifies the system prompt digest', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'headless-profile-'));
    await writeFile(path.join(dir, 'prompt.md'), 'prompt\n');
    await writeFile(path.join(dir, 'profile.json'), JSON.stringify({ ...profile, systemPromptFile: 'prompt.md', expectedSystemPromptDigest: '0'.repeat(64) }));
    await expect(readProfile(path.join(dir, 'profile.json'))).rejects.toThrow(/digest/);
  });
  it('resolves a bundled binary relative to the profile file', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'headless-profile-relative-'));
    await writeFile(path.join(dir, 'bin'), 'binary');
    await writeFile(path.join(dir, 'profile.json'), JSON.stringify({ ...profile, agentBinaryPath: 'bin' }));
    const resolved = await readProfile(path.join(dir, 'profile.json'));
    expect(resolved.profile.agentBinaryPath).toBe(path.join(dir, 'bin'));
  });
});
