import { detectConfig, resolveConfigPath } from '@/lib/opencodeConfig';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function detectOpenCodeCli(): Promise<boolean> {
  try {
    await execAsync('opencode --version');
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  const hasConfig = detectConfig();
  const hasOpenCodeCli = await detectOpenCodeCli();

  const response: { hasConfig: boolean; hasOpenCodeCli: boolean; path?: string } = {
    hasConfig,
    hasOpenCodeCli,
  };

  if (hasConfig) {
    response.path = resolveConfigPath();
  }

  return Response.json(response);
}
