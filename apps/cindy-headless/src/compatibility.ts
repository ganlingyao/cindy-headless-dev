import type { HeadlessProfile } from './profile.js';

export const HEADLESS_CONTRACT_VERSION = 1;
export const CINDY_HEADLESS_VERSION = '0.1.6';

export interface CompatibilityReport {
  schemaVersion: 1;
  contractVersion: number;
  backend: HeadlessProfile['agentBackend'];
  binaryVersion: string;
  transport: 'claude-agent-sdk' | 'codex-app-server-jsonrpc';
  requiredCapabilities: string[];
  security: {
    permissionMode: HeadlessProfile['permissionMode'];
    containerSandbox: boolean;
    safeForUntrustedWorkloads: boolean;
  };
}

export function compatibilityReport(profile: HeadlessProfile): CompatibilityReport {
  const codex = profile.agentBackend === 'codex';
  const isolated = profile.containerSandbox === true;
  const bypass = profile.permissionMode === 'bypassPermissions';
  return {
    schemaVersion: 1,
    contractVersion: HEADLESS_CONTRACT_VERSION,
    backend: profile.agentBackend,
    binaryVersion: profile.agentBinaryVersion,
    transport: codex ? 'codex-app-server-jsonrpc' : 'claude-agent-sdk',
    requiredCapabilities: [
      'multi-turn-session',
      'structured-agent-events',
      'abort-and-close',
      'usage-reporting',
      ...(profile.makerMemory ? ['mcp'] : []),
    ],
    security: {
      permissionMode: profile.permissionMode,
      containerSandbox: isolated,
      safeForUntrustedWorkloads: !bypass || isolated,
    },
  };
}

export function assertSafeExecutionProfile(profile: HeadlessProfile): void {
  if (
    profile.permissionMode === 'bypassPermissions'
    && profile.containerSandbox !== true
    && profile.unsafeAllowUnsandboxedBypass !== true
    && process.env.CINDY_HEADLESS_ALLOW_UNSANDBOXED_BYPASS !== '1'
  ) {
    throw new Error('bypassPermissions requires containerSandbox=true; set CINDY_HEADLESS_ALLOW_UNSANDBOXED_BYPASS=1 only in a controlled environment');
  }
}
