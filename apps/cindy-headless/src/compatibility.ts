import type { HeadlessProfile } from './profile.js';

export const HEADLESS_CONTRACT_VERSION = 1;
export const CINDY_HEADLESS_VERSION = '0.3.1';
export const CINDY_UPSTREAM_COMMIT = 'b91b78c507a6605bb631ad6e85bf82d94d71efd2';

export interface HeadlessFeatureCapability {
  type: 'boolean' | 'object' | 'array';
  control: 'profile';
  default: boolean | Record<string, unknown> | unknown[];
}

export interface HeadlessHarnessCapability {
  id: string;
  backend: string;
  features: string[];
  adapterSupported: boolean;
  supportedModelIds?: string[];
  defaultModel?: HeadlessProfile['model'];
}

export interface HeadlessCapabilityCatalog {
  schemaVersion: 1;
  contractVersion: number;
  harnesses: HeadlessHarnessCapability[];
  features: Record<string, HeadlessFeatureCapability>;
  defaultValues: Record<string, boolean | Record<string, unknown> | unknown[]>;
}

const FEATURE_CAPABILITIES: Record<string, HeadlessFeatureCapability> = {
  projectContext: { type: 'boolean', control: 'profile', default: false },
  makerMemory: { type: 'boolean', control: 'profile', default: false },
  nativeMemory: { type: 'boolean', control: 'profile', default: false },
  compaction: { type: 'object', control: 'profile', default: { enabled: true, thresholdPct: 80 } },
  attachments: { type: 'boolean', control: 'profile', default: false },
  piProjectSkills: { type: 'boolean', control: 'profile', default: false },
  remoteHttpMcp: { type: 'array', control: 'profile', default: [] },
  nativeProviders: { type: 'array', control: 'profile', default: [] },
};

export const ADAPTER_FEATURES = new Set(Object.keys(FEATURE_CAPABILITIES));
export const ADAPTER_HARNESSES = new Set<HeadlessProfile['agentBackend']>(['claude-code', 'codex', 'pi']);

export function capabilityCatalog(backend?: HeadlessProfile['agentBackend']): HeadlessCapabilityCatalog {
  const backends = backend ? [backend] : [...ADAPTER_HARNESSES];
  return {
    schemaVersion: 1,
    contractVersion: HEADLESS_CONTRACT_VERSION,
    harnesses: backends.map((item) => ({
      id: `cindy-${item === 'claude-code' ? 'claude' : item}`,
      backend: item,
      features: Object.keys(FEATURE_CAPABILITIES).filter((id) => {
        if (id === 'piProjectSkills' || id === 'nativeProviders') return item === 'pi';
        return true;
      }),
      adapterSupported: true,
    })),
    features: { ...FEATURE_CAPABILITIES },
    defaultValues: Object.fromEntries(Object.entries(FEATURE_CAPABILITIES).map(([id, feature]) => [id, feature.default])),
  };
}

export interface CapabilityDetection {
  schemaVersion: 1;
  contractVersion: number;
  harnesses: Array<HeadlessHarnessCapability & { status: 'SUPPORTED' | 'DETECTED_BUT_UNSUPPORTED' }>;
  features: Record<string, HeadlessFeatureCapability>;
  defaultValues: Record<string, boolean | Record<string, unknown> | unknown[]>;
  adapter: {
    understoodFeatures: string[];
    understoodHarnesses: string[];
    detected: Array<{ id: string; status: 'SUPPORTED' | 'DETECTED_BUT_UNSUPPORTED' }>;
  };
  support: Record<string, 'SUPPORTED' | 'DETECTED_BUT_UNSUPPORTED'>;
}

export function discoverCapabilityCatalog(value: unknown): CapabilityDetection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('bundle manifest does not contain capabilityCatalog');
  const catalog = value as Partial<HeadlessCapabilityCatalog>;
  if (catalog.schemaVersion !== 1 || typeof catalog.contractVersion !== 'number') throw new Error('unsupported capabilityCatalog schema or contract');
  if (!catalog.features || typeof catalog.features !== 'object' || Array.isArray(catalog.features)) throw new Error('capabilityCatalog.features must be an object');
  if (!Array.isArray(catalog.harnesses)) throw new Error('capabilityCatalog.harnesses must be an array');
  const detected = Object.keys(catalog.features).map((id) => ({
    id,
    status: ADAPTER_FEATURES.has(id) ? 'SUPPORTED' as const : 'DETECTED_BUT_UNSUPPORTED' as const,
  }));
  const harnesses = catalog.harnesses.map((harness) => {
    if (!harness || typeof harness !== 'object' || typeof harness.id !== 'string' || typeof harness.backend !== 'string' || !Array.isArray(harness.features)) {
      throw new Error('capabilityCatalog contains an invalid harness');
    }
    const understood = ADAPTER_HARNESSES.has(harness.backend as HeadlessProfile['agentBackend']);
    const featuresSupported = harness.features.every((id) => ADAPTER_FEATURES.has(id));
    const status = understood && harness.adapterSupported !== false && featuresSupported ? 'SUPPORTED' as const : 'DETECTED_BUT_UNSUPPORTED' as const;
    return { ...harness, adapterSupported: status === 'SUPPORTED', status };
  });
  return {
    schemaVersion: 1,
    contractVersion: catalog.contractVersion,
    harnesses,
    features: catalog.features,
    defaultValues: catalog.defaultValues ?? {},
    adapter: { understoodFeatures: [...ADAPTER_FEATURES], understoodHarnesses: [...ADAPTER_HARNESSES], detected },
    support: Object.fromEntries(detected.map((item) => [item.id, item.status])),
  };
}

export interface CompatibilityReport {
  schemaVersion: 1;
  contractVersion: number;
  cindyUpstreamCommit: string;
  backend: HeadlessProfile['agentBackend'];
  binaryVersion: string;
  transport: 'claude-agent-sdk' | 'codex-app-server-jsonrpc' | 'pi-rpc-jsonl';
  requiredCapabilities: string[];
  security: {
    permissionMode: HeadlessProfile['permissionMode'];
    containerSandbox: boolean;
    safeForUntrustedWorkloads: boolean;
  };
}

export function compatibilityReport(profile: HeadlessProfile): CompatibilityReport {
  const codex = profile.agentBackend === 'codex';
  const pi = profile.agentBackend === 'pi';
  const isolated = profile.containerSandbox === true;
  const bypass = profile.permissionMode === 'bypassPermissions';
  return {
    schemaVersion: 1,
    contractVersion: HEADLESS_CONTRACT_VERSION,
    cindyUpstreamCommit: CINDY_UPSTREAM_COMMIT,
    backend: profile.agentBackend,
    binaryVersion: profile.agentBinaryVersion,
    transport: pi ? 'pi-rpc-jsonl' : codex ? 'codex-app-server-jsonrpc' : 'claude-agent-sdk',
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
