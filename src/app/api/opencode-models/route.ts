import { NextResponse } from 'next/server';
import { type ExecException } from 'child_process';

type ExecFn = (
  command: string,
  options: { timeout: number; env: NodeJS.ProcessEnv },
  callback: (error: ExecException | null, stdout: string, stderr: string) => void
) => void;

// 默认实现：运行时从 child_process 动态取，避免 __mocks__ 被 Turbopack 静态解析时污染
let _execFn: ExecFn | null = null;

function getExecFn(): ExecFn {
  if (_execFn) return _execFn;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('child_process').exec as ExecFn;
}

/** 仅供测试注入 mock，生产代码不调用 */
export function setExecFn(fn: ExecFn | null) {
  _execFn = fn;
}

export function handleExecResult(
  error: ExecException | null,
  stdout: string,
  stderr: string
): { models: string[]; source: string; error?: string } {
  if (error) {
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
    const timeout = 5000;

    const opencodePath = `${process.env.HOME}/.opencode/bin:${process.env.PATH}`;

    getExecFn()('opencode models', { timeout, env: { ...process.env, PATH: opencodePath } }, (error, stdout, stderr) => {
      const result = handleExecResult(error, stdout, stderr);
      const status = result.error ? 503 : 200;
      return resolve(NextResponse.json(result, { status }));
    });
  });
}
