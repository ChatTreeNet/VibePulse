import { describe, expect, it } from 'vitest';

import { buildEditorUri } from './editorLauncher';
import { getEditorLaunchCommand } from './editorLauncher.server';

describe('editorLauncher', () => {
  it('builds a file vscode uri for local paths', () => {
    expect(buildEditorUri('vscode', '/tmp/demo project')).toBe('vscode://file/tmp/demo%20project');
  });

  it('builds an ssh vscode uri when a remote host is provided', () => {
    expect(buildEditorUri('vscode', '/tmp/demo project', { remoteSshHost: 'node-1.test' })).toBe(
      'vscode://vscode-remote/ssh-remote+node-1.test/tmp/demo%20project'
    );
  });

  it('builds an antigravity uri for local launch', () => {
    expect(buildEditorUri('antigravity', '/tmp/demo project')).toBe('antigravity://file/tmp/demo%20project');
  });

  it('returns a launch command for the current platform', () => {
    const command = getEditorLaunchCommand('vscode://file/tmp/demo');

    expect(command.command).toBeTruthy();
    expect(command.args.length).toBeGreaterThan(0);
  });

  it('uses explorer on Windows to avoid cmd start parsing issues', () => {
    const uri = buildEditorUri('vscode', 'C:\\work\\R&D\\demo project');
    const command = getEditorLaunchCommand(uri, 'win32');

    expect(command).toEqual({ command: 'explorer', args: [uri] });
    expect(command.command).not.toBe('cmd');
  });
});
