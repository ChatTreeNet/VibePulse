import { execFile } from 'child_process';

import { buildEditorUri, type OpenEditorTool } from './editorLauncher';

export function getEditorLaunchCommand(
  uri: string,
  platform: NodeJS.Platform = process.platform
): { command: string; args: string[] } {
  if (platform === 'darwin') {
    return { command: 'open', args: [uri] };
  }

  if (platform === 'win32') {
    return { command: 'explorer', args: [uri] };
  }

  return { command: 'xdg-open', args: [uri] };
}

export async function openEditorOnCurrentMachine(tool: OpenEditorTool, directory: string): Promise<string> {
  const uri = buildEditorUri(tool, directory);
  const { command, args } = getEditorLaunchCommand(uri);

  await new Promise<void>((resolve, reject) => {
    execFile(command, args, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  return uri;
}
