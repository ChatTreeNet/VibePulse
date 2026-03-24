export const NODE_RUNTIME_FLAG = '--serve';
export const RUNTIME_ROLE_ENV_VAR = 'VIBEPULSE_RUNTIME_ROLE';

export type RuntimeRole = 'hub' | 'node';

export interface RuntimeMode {
  role: RuntimeRole;
}

function formatUsage(args: string[]): string {
  const renderedArgs = args.length > 0 ? args.join(' ') : '(none)';
  return `Unsupported arguments: ${renderedArgs}. Usage: vibepulse [${NODE_RUNTIME_FLAG}]`;
}

export function resolveRuntimeMode(argv: string[]): RuntimeMode {
  if (!Array.isArray(argv)) {
    throw new TypeError('Runtime arguments must be provided as an array.');
  }

  if (argv.length === 0) {
    return { role: 'hub' };
  }

  if (argv.length === 1 && argv[0] === NODE_RUNTIME_FLAG) {
    return { role: 'node' };
  }

  throw new Error(formatUsage(argv));
}
