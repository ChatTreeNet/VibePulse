import { describe, expect, it } from 'vitest';

import { NODE_RUNTIME_FLAG, RUNTIME_ROLE_ENV_VAR, resolveRuntimeMode } from './runtimeMode';

describe('resolveRuntimeMode', () => {
  it('resolves hub mode by default', () => {
    expect(resolveRuntimeMode([])).toEqual({ role: 'hub' });
  });

  it('resolves node mode from --serve', () => {
    expect(resolveRuntimeMode([NODE_RUNTIME_FLAG])).toEqual({ role: 'node' });
  });

  it('exposes the runtime role env variable name', () => {
    expect(RUNTIME_ROLE_ENV_VAR).toBe('VIBEPULSE_RUNTIME_ROLE');
  });

  it('fails deterministically for unsupported flags', () => {
    expect(() => resolveRuntimeMode(['--unknown'])).toThrow(
      'Unsupported arguments: --unknown. Usage: vibepulse [--serve]'
    );
  });

  it('fails deterministically for extra flags after --serve', () => {
    expect(() => resolveRuntimeMode([NODE_RUNTIME_FLAG, '--unknown'])).toThrow(
      'Unsupported arguments: --serve --unknown. Usage: vibepulse [--serve]'
    );
  });
});
