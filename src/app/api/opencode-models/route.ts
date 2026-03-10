import { NextResponse } from 'next/server';
import { type ExecException } from 'child_process';

type ExecFn = (
  command: string,
  options: { timeout: number; env: NodeJS.ProcessEnv },
  callback: (error: ExecException | null, stdout: string, stderr: string) => void
) => void;

let _execFn: ExecFn | null = null;

function getExecFn(): ExecFn {
  if (_execFn) return _execFn;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('child_process').exec as ExecFn;
}

export function setExecFn(fn: ExecFn | null) {
  _execFn = fn;
}

export function handleExecResult(
  error: ExecException | null,
  stdout: string,
  stderr: string
): { models: string[]; source: string; error?: string } {
  if (error) {
    console.error('[opencode-models] command failed', {
      command: 'opencode models',
      message: error.message,
      code: error.code,
      signal: error.signal,
      stderr: stderr || undefined,
      stdoutPreview: stdout ? stdout.slice(0, 300) : undefined,
    });
    return { models: [], source: 'error', error: error.message || 'Failed to fetch models from CLI' };
  }

  if (stderr) {
    console.warn('[opencode-models] stderr:', stderr);
  }

  try {
    const models = stdout.trim().split('\n').filter(line => line.includes('/'));
    if (models.length === 0) {
      return { models: [], source: 'error', error: 'No models found. Please check your OpenCode installation.' };
    }
    return { models, source: 'opencode' };
  } catch {
    return { models: [], source: 'error', error: 'Failed to parse models output' };
  }
}

export async function GET(): Promise<Response> {
  return new Promise<Response>((resolve) => {
    const parsedTimeout = Number(process.env.OPENCODE_MODELS_TIMEOUT_MS);
    const timeout = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 15000;

    const opencodePath = `${process.env.HOME}/.opencode/bin:${process.env.PATH}`;

    getExecFn()('opencode models', { timeout, env: { ...process.env, PATH: opencodePath } }, (error, stdout, stderr) => {
      if (error) {
        console.error('[opencode-models] GET failed', {
          timeout,
          opencodePath,
          cwd: process.cwd(),
          home: process.env.HOME,
          path: process.env.PATH,
        });
      }
      const result = handleExecResult(error, stdout, stderr);
      const status = result.source === 'error' ? 503 : 200;
      return resolve(NextResponse.json(result, { status }));
    });
  });
}
