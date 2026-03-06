import { detectConfig, CONFIG_PATH } from '@/lib/opencodeConfig';

export async function GET() {
  const hasConfig = detectConfig();
  const hasPlugin = hasConfig; // TODO: Implement actual plugin detection

  const response: { hasConfig: boolean; hasPlugin: boolean; path?: string } = {
    hasConfig,
    hasPlugin,
  };

  if (hasConfig) {
    response.path = CONFIG_PATH;
  }

  return Response.json(response);
}
