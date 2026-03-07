import { vi } from 'vitest';

export const exec = vi.fn();
export type { ExecException, ExecOptions } from 'child_process';
