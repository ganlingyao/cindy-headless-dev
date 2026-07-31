import type { MakerMemoryManager } from '@cindy/maker-core';

export interface MemoryMcpLogger {
  trace(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  fatal?(...args: unknown[]): void;
}

export interface MemoryMcpDeps {
  getManager(): MakerMemoryManager;
  workdir: string;
  getSessionContext?: () => { workingDir: string; remoteHostId?: string };
  searchSessions?: (query: string, options?: { sessionId?: string; role?: 'user' | 'assistant' | 'system'; limit?: number }) => Promise<unknown[]>;
  logger?: MemoryMcpLogger;
}
