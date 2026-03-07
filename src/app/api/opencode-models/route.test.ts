import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { ExecException } from 'child_process';
import { handleExecResult, GET, setExecFn } from './route';

type ExecCallback = (error: ExecException | null, stdout: string, stderr: string) => void;
type MockExecFn = (cmd: string, opts: unknown, callback: ExecCallback) => void;

describe('/api/opencode-models', () => {
  describe('handleExecResult', () => {
    it('CLI 不存在时应返回错误', () => {
      const error = new Error('spawn opencode ENOENT') as ExecException;
      const result = handleExecResult(error, '', 'command not found');

      expect(result.source).toBe('error');
      expect(result.models).toEqual([]);
      expect(result.error).toBeTruthy();
    });

    it('超时时应返回错误', () => {
      const error = new Error('timeout') as ExecException;
      const result = handleExecResult(error, '', '');

      expect(result.source).toBe('error');
      expect(result.models).toEqual([]);
    });

    it('空输出时应返回错误', () => {
      const result = handleExecResult(null, '', '');

      expect(result.source).toBe('error');
      expect(result.models).toEqual([]);
      expect(result.error).toContain('No models found');
    });

    it('仅有 stderr 但 stdout 有效时，应正常返回模型', () => {
      const result = handleExecResult(null, 'anthropic/claude\nopenai/gpt-4', 'some warning from CLI');

      expect(result.source).toBe('opencode');
      expect(result.models).toContain('anthropic/claude');
    });

    it('仅有 stderr 且 stdout 为空时，应返回错误', () => {
      const result = handleExecResult(null, '', 'some error in stderr');

      expect(result.source).toBe('error');
      expect(result.models).toEqual([]);
    });

    it('正常情况应返回 CLI 模型', () => {
      const result = handleExecResult(null, 'anthropic/claude\nopenai/gpt-4', '');

      expect(result.source).toBe('opencode');
      expect(result.models).toContain('anthropic/claude');
    });
  });

  describe('GET API 集成测试', () => {
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

    it('GET 成功时应返回 source=opencode 和真实模型列表', async () => {
      mockExec.mockImplementation((_cmd, _opts, callback) => {
        callback(null, 'anthropic/claude-3.5-sonnet\nopenai/gpt-4o\ndeepseek/deepseek-chat\n', '');
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.source).toBe('opencode');
      expect(data.models).toContain('anthropic/claude-3.5-sonnet');
    });

    it('GET CLI 有 stderr 但 stdout 有效时，应返回 source=opencode', async () => {
      mockExec.mockImplementation((_cmd, _opts, callback) => {
        callback(null, 'anthropic/claude-3.5-sonnet\n', 'Warning: newer version available');
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.source).toBe('opencode');
    });

    it('GET CLI 失败时应返回 503 错误', async () => {
      mockExec.mockImplementation((_cmd, _opts, callback) => {
        callback(new Error('spawn opencode ENOENT') as ExecException, '', 'command not found');
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.source).toBe('error');
      expect(data.models).toEqual([]);
      expect(data.error).toBeTruthy();
    });

    it('GET 返回空模型时应返回 503 错误', async () => {
      mockExec.mockImplementation((_cmd, _opts, callback) => {
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
