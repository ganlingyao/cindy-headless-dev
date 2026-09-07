import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { resolvePiProjectTrust, resolveTurns, validateTurnInput } from './headless-integrations.js';

const execFileAsync = promisify(execFile);

describe('headless capability inputs', () => {
  it('keeps string turns compatible and accepts structured attachments', () => {
    expect(validateTurnInput('hello')).toBe('hello');
    expect(validateTurnInput({ text: 'inspect', attachments: [{ type: 'file', path: 'fixture.txt' }] })).toMatchObject({ text: 'inspect' });
  });

  it('resolves workspace attachments and rejects traversal', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'headless-input-'));
    await writeFile(path.join(workspace, 'fixture.txt'), 'fixture');
    const turns = await resolveTurns([{ text: 'inspect', attachments: [{ type: 'file', path: 'fixture.txt' }] }], workspace, { attachments: true, workspaceOnly: true });
    expect(turns[0]).toMatchObject({ type: 'user', content: [{ type: 'text' }, { type: 'file', path: path.join(workspace, 'fixture.txt') }] });
    expect(() => validateTurnInput({ text: 'bad', attachments: [{ type: 'file', path: '../outside' }] })).toThrow(/workspace-relative/);
  });

  it('fails closed when attachments are disabled', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'headless-input-off-'));
    await mkdir(path.join(workspace, 'files'));
    await writeFile(path.join(workspace, 'files', 'fixture.txt'), 'fixture');
    await expect(resolveTurns([{ text: 'inspect', attachments: [{ type: 'file', path: 'files/fixture.txt' }] }], workspace, undefined)).rejects.toThrow(/does not enable attachments/);
  });

  it('builds a scoped Pi approval snapshot for current and ancestor project skills', async () => {
    const repo = await mkdtemp(path.join(os.tmpdir(), 'headless-pi-skills-'));
    const workspace = path.join(repo, 'packages', 'app');
    await mkdir(path.join(workspace, '.pi', 'skills', 'local'), { recursive: true });
    await mkdir(path.join(repo, '.agents', 'skills', 'shared'), { recursive: true });
    await writeFile(path.join(workspace, '.pi', 'skills', 'local', 'SKILL.md'), '# Local');
    await writeFile(path.join(repo, '.agents', 'skills', 'shared', 'SKILL.md'), '# Shared');
    await execFileAsync('git', ['init', repo]);
    const snapshot = await resolvePiProjectTrust(workspace, { enabled: true, roots: ['.pi/skills', '.agents/skills'] });
    expect(snapshot?.approval).toMatchObject({ status: 'approved', scope: 'working-dir' });
    expect(snapshot?.discovered.skills).toHaveLength(2);
    expect(snapshot?.discovered.packages).toEqual([]);
    expect(snapshot?.discovered.extensions).toEqual([]);
  });
});
