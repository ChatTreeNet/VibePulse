import { NextRequest, NextResponse } from 'next/server';
import { readConfig, writeConfig } from '@/lib/opencodeConfig';

// Allowed fields to expose in the API
const ALLOWED_AGENT_FIELDS = ['model', 'temperature', 'top_p', 'variant', 'prompt_append'] as const;

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

    const categories = config.categories || {};
    const filteredCategories: Record<string, Record<string, unknown>> = {};
    
    for (const [catName, catConfig] of Object.entries(categories)) {
      if (typeof catConfig === 'object' && catConfig !== null && !Array.isArray(catConfig)) {
        filteredCategories[catName] = filterAgentConfig(catConfig as Record<string, unknown>);
      }
    }

    const vibepulse = config.vibepulse && typeof config.vibepulse === 'object' && !Array.isArray(config.vibepulse)
      ? config.vibepulse
      : {};

    return NextResponse.json({ 
      agents: filteredAgents,
      categories: filteredCategories,
      vibepulse
    });
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

    const { agents, categories, vibepulse } = body;

    // If neither agents, categories, nor vibepulse provided, nothing to update
    if (agents === undefined && categories === undefined && vibepulse === undefined) {
      return NextResponse.json(
        { error: 'Missing agents, categories, or vibepulse field' },
        { status: 400 }
      );
    }

    // Validate agents is an object (if provided)
    if (agents !== undefined && (typeof agents !== 'object' || agents === null || Array.isArray(agents))) {
      return NextResponse.json(
        { error: 'Agents must be an object' },
        { status: 400 }
      );
    }
    
    // Validate categories is an object (if provided)
    if (categories !== undefined && (typeof categories !== 'object' || categories === null || Array.isArray(categories))) {
      return NextResponse.json(
        { error: 'Categories must be an object' },
        { status: 400 }
      );
    }

    // Validate vibepulse is an object (if provided)
    if (vibepulse !== undefined && (typeof vibepulse !== 'object' || vibepulse === null || Array.isArray(vibepulse))) {
      return NextResponse.json(
        { error: 'Vibepulse must be an object' },
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

    if (agents !== undefined) {
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
         } else if (lowerField === 'variant') {
           if (typeof value !== 'string') {
             return NextResponse.json(
               { error: `Agent '${agentName}': variant must be a string` },
               { status: 400 }
             );
           }
           validatedConfig[field] = value;
         } else if (lowerField === 'prompt_append') {
           if (typeof value !== 'string') {
             return NextResponse.json(
               { error: `Agent '${agentName}': prompt_append must be a string` },
               { status: 400 }
             );
           }
           validatedConfig[field] = value;
         } else {
           return NextResponse.json(
             {
               error: `Agent '${agentName}': unknown field '${field}'. Allowed fields: model, temperature, top_p, variant, prompt_append`
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
  }

  // Process categories updates if provided
  const updatedCategories: Record<string, Record<string, unknown>> = {};
  const currentCategories = (currentConfig.categories || {}) as Record<string, Record<string, unknown>>;

  for (const [name, config] of Object.entries(currentCategories)) {
    if (typeof config === 'object' && config !== null && !Array.isArray(config)) {
      updatedCategories[name] = config as Record<string, unknown>;
    }
  }

  if (categories !== undefined) {
    for (const [categoryName, categoryConfig] of Object.entries(categories)) {
      if (typeof categoryConfig !== 'object' || categoryConfig === null || Array.isArray(categoryConfig)) {
        return NextResponse.json(
          { error: `Category '${categoryName}' config must be an object` },
          { status: 400 }
        );
      }

      const configObj = categoryConfig as Record<string, unknown>;
      const validatedCategoryConfig: Record<string, unknown> = {};

      for (const [field, value] of Object.entries(configObj)) {
        if (field === 'model' || field === 'variant' || field === 'prompt_append' || field === 'description') {
          if (value !== undefined && typeof value !== 'string') {
             return NextResponse.json(
               { error: `Category '${categoryName}': '${field}' must be a string` },
               { status: 400 }
             );
          }
          validatedCategoryConfig[field] = value;
        } else if (field === 'temperature' || field === 'top_p') {
          if (value !== undefined && typeof value !== 'number') {
             return NextResponse.json(
               { error: `Category '${categoryName}': '${field}' must be a number` },
               { status: 400 }
             );
          }
          
          const numValue = value as number;
          const temp = field === 'temperature' ? Math.max(0, Math.min(2, numValue)) : numValue;
          const topP = field === 'top_p' ? Math.max(0, Math.min(1, numValue)) : numValue;
          
          validatedCategoryConfig[field] = field === 'temperature' ? temp : topP;
        } else {
           return NextResponse.json(
             { error: `Category '${categoryName}': unknown field '${field}'` },
             { status: 400 }
           );
        }
      }
      
      updatedCategories[categoryName] = {
        ...((currentCategories[categoryName] as Record<string, unknown>) || {}),
        ...validatedCategoryConfig
      };
    }
  }

  // Process vibepulse updates if provided
  const updatedVibepulse: Record<string, unknown> = {};
  const currentVibepulse = (currentConfig.vibepulse && typeof currentConfig.vibepulse === 'object' && !Array.isArray(currentConfig.vibepulse))
    ? (currentConfig.vibepulse as Record<string, unknown>)
    : {};

  if (vibepulse !== undefined) {
    for (const [key, value] of Object.entries(currentVibepulse)) {
      updatedVibepulse[key] = value;
    }
    
    for (const [field, value] of Object.entries(vibepulse as Record<string, unknown>)) {
      if (field === 'stickyBusyDelayMs' || field === 'sessionsRefreshIntervalMs') {
        if (value !== undefined && typeof value !== 'number') {
           return NextResponse.json(
             { error: `Vibepulse: '${field}' must be a number` },
             { status: 400 }
           );
        }
        if (typeof value === 'number') {
           if (!Number.isFinite(value)) {
             return NextResponse.json(
               { error: `Vibepulse: '${field}' must be a finite number` },
               { status: 400 }
             );
           }

           if (field === 'stickyBusyDelayMs' && value < 0) {
             return NextResponse.json(
               { error: `Vibepulse: '${field}' must be a non-negative number` },
               { status: 400 }
             );
           }

           if (field === 'sessionsRefreshIntervalMs' && value <= 0) {
             return NextResponse.json(
               { error: `Vibepulse: '${field}' must be greater than 0` },
               { status: 400 }
             );
           }

           updatedVibepulse[field] = value;
        }
      } else {
         return NextResponse.json(
           { error: `Vibepulse: unknown field '${field}'` },
           { status: 400 }
         );
      }
    }
  }

  // Update config and save
  const newConfig = { ...currentConfig } as Record<string, unknown>;
  if (agents !== undefined) newConfig.agents = updatedAgents;
  if (categories !== undefined) newConfig.categories = updatedCategories;
  if (vibepulse !== undefined) newConfig.vibepulse = updatedVibepulse;
  
  // writeConfig type doesn't natively expose categories yet, safely bypassing
  await writeConfig(
    newConfig as { 
      agents?: Record<string, Record<string, unknown>>; 
      categories?: Record<string, Record<string, unknown>>; 
      vibepulse?: Record<string, unknown>;
    }
  );

  return NextResponse.json(
    { success: true, agents: updatedAgents, categories: updatedCategories, vibepulse: updatedVibepulse },
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
