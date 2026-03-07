'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { AgentConfigForm } from './AgentConfigForm';
import { Loader2 } from 'lucide-react';

interface AgentConfig {
  model?: string;
  temperature?: number;
  top_p?: number;
}

interface OpencodeConfigResponse {
  agents: Record<string, AgentConfig>;
}

interface AgentDefinition {
  key: string;
  name: string;
  description: string;
}

const PREDEFINED_AGENTS: AgentDefinition[] = [
  {
    key: 'default',
    name: 'Default',
    description: 'Default agent configuration used as fallback for all agents',
  },
  {
    key: 'sisyphus',
    name: 'Sisyphus',
    description: 'Task execution agent - focused on completing specific tasks',
  },
  {
    key: 'hephaestus',
    name: 'Hephaestus',
    description: 'Build and automation agent - handles CI/CD and deployment',
  },
  {
    key: 'prometheus',
    name: 'Prometheus',
    description: 'Planning agent - creates and manages project plans',
  },
  {
    key: 'oracle',
    name: 'Oracle',
    description: 'Knowledge and research agent - provides insights and answers',
  },
  {
    key: 'metis',
    name: 'Metis',
    description: 'Strategy and consultation agent - advises on best practices',
  },
  {
    key: 'momus',
    name: 'Momus',
    description: 'Review and critique agent - evaluates code and decisions',
  },
];

interface AgentsConfigPanelProps {
  onSaveSuccess?: () => void;
}

export function AgentsConfigPanel({ onSaveSuccess }: AgentsConfigPanelProps) {
  const [activeTab, setActiveTab] = React.useState('default');

  const { data: config, isLoading } = useQuery<OpencodeConfigResponse>({
    queryKey: ['opencode-config'],
    queryFn: async () => {
      const res = await fetch('/api/opencode-config');
      if (!res.ok) {
        throw new Error('Failed to fetch config');
      }
      return res.json();
    },
  });

  const configuredAgents = React.useMemo(() => {
    const agents = config?.agents || {};
    return PREDEFINED_AGENTS.map((agent) => ({
      ...agent,
      isConfigured: agent.key in agents,
    }));
  }, [config]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
        <span className="ml-2 text-sm text-zinc-500 dark:text-zinc-400">
          Loading agent configurations...
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-1 p-1.5">
          {configuredAgents.map((agent) => (
            <TabsTrigger
              key={agent.key}
              value={agent.key}
              className="text-xs px-3 py-1.5 data-[state=active]:bg-white data-[state=active]:text-zinc-900 dark:data-[state=active]:bg-zinc-900 dark:data-[state=active]:text-zinc-50"
            >
              <span className="flex items-center gap-1.5">
                {agent.name}
                {agent.isConfigured && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                )}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>

        {PREDEFINED_AGENTS.map((agent) => (
          <TabsContent
            key={agent.key}
            value={agent.key}
            className="mt-4 focus-visible:outline-none"
          >
            <div className="space-y-4">
              <div className="pb-4 border-b border-zinc-200 dark:border-zinc-700">
                <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  {agent.name}
                </h3>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  {agent.description}
                </p>
              </div>
              <AgentConfigForm
                agentName={agent.key}
                onSaveSuccess={onSaveSuccess}
              />
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

export default AgentsConfigPanel;
