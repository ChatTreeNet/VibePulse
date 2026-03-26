export type OpenEditorTool = 'vscode' | 'antigravity';

export interface BuildEditorUriOptions {
  remoteSshHost?: string | null;
}

function toPosixPath(directory: string): string {
  return directory.replace(/\\/g, '/');
}

export function buildEditorUri(tool: OpenEditorTool, directory: string, options: BuildEditorUriOptions = {}): string {
  const normalizedDirectory = toPosixPath(directory);
  const encodedPath = encodeURI(normalizedDirectory);
  const remoteSshHost = typeof options.remoteSshHost === 'string' ? options.remoteSshHost.trim() : '';

  if (tool === 'antigravity') {
    return `antigravity://file${encodedPath.startsWith('/') ? encodedPath : `/${encodedPath}`}`;
  }

  if (remoteSshHost) {
    return `vscode://vscode-remote/ssh-remote+${remoteSshHost}${encodedPath.startsWith('/') ? '' : '/'}${encodedPath}`;
  }

  return `vscode://file${encodedPath.startsWith('/') ? encodedPath : `/${encodedPath}`}`;
}
