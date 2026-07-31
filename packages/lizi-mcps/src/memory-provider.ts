import type { Logger, MakerMemoryManager, McpProvider } from '@cindy/maker-core';
import { createCindyMemoryMcpServer } from './cindy_memoryMcpServer.js';

export interface MemoryMcpProviderOptions {
  getManager(): MakerMemoryManager;
  logger?: Logger;
}

/** Narrow host entry for Cindy's existing cindy_memory MCP without Desktop-only providers. */
export function createMemoryMcpProvider(options: MemoryMcpProviderOptions): McpProvider {
  return {
    name: 'cindy_memory',
    isEnabled: () => options.getManager().isEnabled(),
    toClaudeSdkConfig: (context) => ({
      type: 'sdk',
      name: 'cindy_memory',
      instance: createCindyMemoryMcpServer({
        getManager: options.getManager,
        workdir: context.workingDir,
        ...(options.logger ? { logger: options.logger } : {}),
      }),
    }),
  };
}
