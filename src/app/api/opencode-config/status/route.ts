import { detectConfig, CONFIG_PATH } from '@/lib/opencodeConfig';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function detectPlugin(): Promise<boolean> {
  try {
    // Check if oh-my-opencode CLI is available
    await execAsync('opencode --version');
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  const hasConfig = detectConfig();
  const hasPlugin = await detectPlugin();

  const response: { hasConfig: boolean; hasPlugin: boolean; path?: string } = {
    hasConfig,
    hasPlugin,
  };

  if (hasConfig) {
    response.path = CONFIG_PATH;
  }

  return Response.json(response);
}
