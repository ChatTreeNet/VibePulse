import { NextRequest, NextResponse } from 'next/server';
import { readConfig, writeConfig } from '@/lib/opencodeConfig';

// Allowed fields to expose in the API
const ALLOWED_AGENT_FIELDS = ['model', 'temperature', 'top_p'] as const;

/**
 * Filters an agent config to only include allowed fields
 */
function filterAgentConfig(agent: Record<string, unknown>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  
  for (const field of ALLOWED_AGENT_FIELDS) {
    if (agent[field] !== undefined) {
      filtered[field] = agent[field];
    }
  }
  
  return filtered;
}

/**
 * GET /api/opencode-config
 * Returns filtered agent configuration
 * Only exposes: model, temperature, top_p
 * Filters out sensitive fields (apiKey, token, password, etc.)
 */
export async function GET() {
  try {
    const config = await readConfig();
    const agents = config.agents || {};
    const filteredAgents: Record<string, Record<string, unknown>> = {};
    
    for (const [agentName, agentConfig] of Object.entries(agents)) {
      if (typeof agentConfig === 'object' && agentConfig !== null) {
        filteredAgents[agentName] = filterAgentConfig(agentConfig as Record<string, unknown>);
      }
    }

    return NextResponse.json({ agents: filteredAgents });
  } catch (error) {
    console.error('Error reading config:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/opencode-config
 * Updates agent configuration with validation
 * Only allows: model, temperature, top_p
 * Rejects sensitive fields (apiKey, token, password, secret, etc.)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate request structure
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    const { agents } = body;

    // If agents not provided, nothing to update
    if (agents === undefined) {
      return NextResponse.json(
        { error: 'Missing agents field' },
        { status: 400 }
      );
    }

    // Validate agents is an object
    if (typeof agents !== 'object' || agents === null || Array.isArray(agents)) {
      return NextResponse.json(
        { error: 'Agents must be an object' },
        { status: 400 }
      );
    }

    // Read current config
    const currentConfig = await readConfig();
    const currentAgents = currentConfig.agents || {};

    // Validate and merge agent updates
    const updatedAgents: Record<string, Record<string, unknown>> = {};

    for (const [name, config] of Object.entries(currentAgents)) {
      if (typeof config === 'object' && config !== null && !Array.isArray(config)) {
        updatedAgents[name] = config as Record<string, unknown>;
      }
    }

    for (const [agentName, agentConfig] of Object.entries(agents)) {
      if (typeof agentConfig !== 'object' || agentConfig === null || Array.isArray(agentConfig)) {
        return NextResponse.json(
          { error: `Agent '${agentName}' config must be an object` },
          { status: 400 }
        );
      }

      const config = agentConfig as Record<string, unknown>;
      const disallowedFields: string[] = [];

      for (const key of Object.keys(config)) {
        const lowerKey = key.toLowerCase();
        if (
          lowerKey.includes('api') ||
          lowerKey.includes('key') ||
          lowerKey.includes('token') ||
          lowerKey.includes('secret') ||
          lowerKey.includes('password') ||
          lowerKey.includes('auth') ||
          lowerKey.includes('credential') ||
          lowerKey.includes('private') ||
          lowerKey.includes('cert')
        ) {
          disallowedFields.push(key);
        }
      }

      if (disallowedFields.length > 0) {
        return NextResponse.json(
          {
            error: `Agent '${agentName}' contains disallowed fields: ${disallowedFields.join(', ')}`
          },
          { status: 403 }
        );
      }

      const validatedConfig: Record<string, unknown> = {};

      for (const [field, value] of Object.entries(config)) {
        const lowerField = field.toLowerCase();

        if (lowerField === 'model') {
          if (typeof value !== 'string' || value.trim() === '') {
            return NextResponse.json(
              { error: `Agent '${agentName}': model must be a non-empty string` },
              { status: 400 }
            );
          }
          validatedConfig[field] = value;
        } else if (lowerField === 'temperature') {
          const temp = Number(value);
          if (isNaN(temp) || temp < 0 || temp > 2) {
            return NextResponse.json(
              { error: `Agent '${agentName}': temperature must be a number between 0 and 2` },
              { status: 400 }
            );
          }
          validatedConfig[field] = temp;
        } else if (lowerField === 'top_p') {
          const topP = Number(value);
          if (isNaN(topP) || topP < 0 || topP > 1) {
            return NextResponse.json(
              { error: `Agent '${agentName}': top_p must be a number between 0 and 1` },
              { status: 400 }
            );
          }
          validatedConfig[field] = topP;
        } else {
          return NextResponse.json(
            {
              error: `Agent '${agentName}': unknown field '${field}'. Allowed fields: model, temperature, top_p`
            },
            { status: 400 }
          );
        }
      }

      updatedAgents[agentName] = {
        ...(currentAgents[agentName] as Record<string, unknown> || {}),
        ...validatedConfig
      };
    }

    // Update config and save
    const newConfig = { ...currentConfig, agents: updatedAgents };
    await writeConfig(newConfig);

    return NextResponse.json(
      { success: true, agents: updatedAgents },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error updating config:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
