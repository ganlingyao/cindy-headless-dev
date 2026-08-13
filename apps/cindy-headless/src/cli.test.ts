import { describe, expect, it } from 'vitest';
import { DEFAULT_HEADLESS_TIMEOUT_MS } from './defaults.js';

describe('Headless CLI defaults', () => {
  it('uses an 1800-second standalone deadline', () => {
    expect(DEFAULT_HEADLESS_TIMEOUT_MS).toBe(1_800_000);
  });
});
