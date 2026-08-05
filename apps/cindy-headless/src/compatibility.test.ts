import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertSafeExecutionProfile, CINDY_HEADLESS_VERSION, compatibilityReport } from './compatibility.js';
import { validateProfile } from './profile.js';

const packageVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const base = {
  id: 'compatibility-test',
  version: 1,
  agentBackend: 'codex',
  agentBinaryPath: '/opt/codex',
  agentBinaryVersion: '1.2.3',
  supportedModelIds: ['gpt-test'],
  model: { provider: 'openai', requestedId: 'gpt-test' },
  permissionMode: 'auto',
  makerMemory: true,
  nativeMemory: false,
  projectContext: true,
} as const;

describe('headless compatibility contract', () => {
  it('keeps the runtime and package versions aligned', () => {
    expect(CINDY_HEADLESS_VERSION).toBe(packageVersion);
  });

  it('describes the backend transport and required capabilities', () => {
    expect(compatibilityReport(validateProfile(base))).toMatchObject({
      schemaVersion: 1,
      contractVersion: 1,
      transport: 'codex-app-server-jsonrpc',
      requiredCapabilities: expect.arrayContaining(['multi-turn-session', 'mcp']),
    });
  });

  it('rejects unsandboxed permission bypass by default', () => {
    const profile = validateProfile({ ...base, permissionMode: 'bypassPermissions' });
    expect(() => assertSafeExecutionProfile(profile)).toThrow(/containerSandbox=true/);
  });

  it('accepts permission bypass inside an explicit container sandbox', () => {
    const profile = validateProfile({ ...base, permissionMode: 'bypassPermissions', containerSandbox: true });
    expect(() => assertSafeExecutionProfile(profile)).not.toThrow();
  });
});
