import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('production prompt parity', () => {
  it('matches the Desktop Claude host prompt after cross-platform newline normalization', async () => {
    const headless = await readFile(path.resolve('profiles/cindy-production-claude/prompt.md'), 'utf8');
    const desktopHost = await readFile(path.resolve('../../apps/desktop/src/main/maker-host/host-system-prompt.md'), 'utf8');
    const desktopClaude = await readFile(path.resolve('../../apps/desktop/src/main/maker-host/claude-system-prompt.md'), 'utf8');
    const composed = [desktopHost, desktopClaude].map((part) => part.trim()).filter(Boolean).join('\n\n');
    expect(headless.replace(/\r\n/g, '\n').trim()).toBe(composed.replace(/\r\n/g, '\n'));
  });
});
