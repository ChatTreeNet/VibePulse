import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { ExecException } from 'child_process';
import { handleExecResult, GET, setExecFn } from './route';

type ExecCallback = (error: ExecException | null, stdout: string, stderr: string) => void;
type MockExecFn = (cmd: string, opts: unknown, callback: ExecCallback) => void;

describe('/api/opencode-models', () => {
  describe('handleExecResult', () => {
    it('should return error when CLI does not exist', () => {
      const error = new Error('spawn opencode ENOENT') as ExecException;
      const result = handleExecResult(error, '', 'command not found');

      expect(result.source).toBe('error');
      expect(result.models).toEqual([]);
      expect(result.error).toBeTruthy();
    });

    it('should return error on timeout', () => {
      const error = new Error('timeout') as ExecException;
      const result = handleExecResult(error, '', '');

      expect(result.source).toBe('error');
      expect(result.models).toEqual([]);
    });

    it('should return error on empty output', () => {
      const result = handleExecResult(null, '', '');

      expect(result.source).toBe('error');
      expect(result.models).toEqual([]);
      expect(result.error).toContain('No models found');
    });

    it('should return models when only stderr but stdout is valid', () => {
      const result = handleExecResult(null, 'anthropic/claude\nopenai/gpt-4', 'some warning from CLI');

      expect(result.source).toBe('opencode');
      expect(result.models).toContain('anthropic/claude');
    });

    it('should return error when only stderr and stdout is empty', () => {
      const result = handleExecResult(null, '', 'some error in stderr');

      expect(result.source).toBe('error');
      expect(result.models).toEqual([]);
    });

    it('should return CLI models in normal case', () => {
      const result = handleExecResult(null, 'anthropic/claude\nopenai/gpt-4', '');

      expect(result.source).toBe('opencode');
      expect(result.models).toContain('anthropic/claude');
    });
  });

  describe('GET API Integration Tests', () => {
    const originalHome = process.env.HOME;
    const originalPath = process.env.PATH;

    let mockExec: ReturnType<typeof vi.fn<MockExecFn>>;

    beforeAll(() => {
      process.env.HOME = '/tmp';
      process.env.PATH = '/usr/bin';
    });

    afterAll(() => {
      process.env.HOME = originalHome;
      process.env.PATH = originalPath;
    });

    beforeEach(() => {
      mockExec = vi.fn<MockExecFn>();
      setExecFn(mockExec as never);
    });

    afterEach(() => {
      const { exec } = vi.importActual<typeof import('child_process')>('child_process') as never as { exec: MockExecFn };
      setExecFn(exec as never);
    });

    it('should return source=opencode and real model list on successful GET', async () => {
      mockExec.mockImplementation((_cmd: unknown, _opts: unknown, callback: ExecCallback) => {
        callback(null, 'anthropic/claude-3.5-sonnet\nopenai/gpt-4o\ndeepseek/deepseek-chat\n', '');
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.source).toBe('opencode');
      expect(data.models).toContain('anthropic/claude-3.5-sonnet');
    });

    it('should return source=opencode when CLI has stderr but stdout is valid', async () => {
      mockExec.mockImplementation((_cmd: unknown, _opts: unknown, callback: ExecCallback) => {
        callback(null, 'anthropic/claude-3.5-sonnet\n', 'Warning: newer version available');
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.source).toBe('opencode');
    });

    it('should return 503 error when CLI fails', async () => {
      mockExec.mockImplementation((_cmd: unknown, _opts: unknown, callback: ExecCallback) => {
        callback(new Error('spawn opencode ENOENT') as ExecException, '', 'command not found');
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.source).toBe('error');
      expect(data.models).toEqual([]);
      expect(data.error).toBeTruthy();
    });

    it('should return 503 error when GET returns empty models', async () => {
      mockExec.mockImplementation((_cmd: unknown, _opts: unknown, callback: ExecCallback) => {
        callback(null, '', '');
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.source).toBe('error');
      expect(data.models).toEqual([]);
    });
  });
});
