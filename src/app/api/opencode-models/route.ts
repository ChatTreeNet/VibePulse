import { NextResponse } from 'next/server';
import { exec } from 'child_process';

const FALLBACK_MODELS = [
  'anthropic/claude-3.5-sonnet',
  'openai/gpt-4o',
  'openai/gpt-4-turbo',
  'kimi-k2.5',
  'deepseek/deepseek-chat',
  'meta-llama/llama-3.1-70b-instruct',
];

export async function GET(): Promise<Response> {
  return new Promise<Response>((resolve) => {
    const timeout = 5000;

    exec('opencode models --json', { timeout }, (error, stdout, stderr) => {
      if (error || stderr) {
        return resolve(
          NextResponse.json(
            { models: FALLBACK_MODELS, source: 'fallback' },
            { status: 200 }
          )
        );
      }

      try {
        const models = JSON.parse(stdout);
        return resolve(
          NextResponse.json(
            { models, source: 'opencode' },
            { status: 200 }
          )
        );
      } catch {
        return resolve(
          NextResponse.json(
            { models: FALLBACK_MODELS, source: 'fallback' },
            { status: 200 }
          )
        );
      }
    });
  });
}
