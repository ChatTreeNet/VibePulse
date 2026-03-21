'use client';

import * as React from 'react';
import { X, Search, Bot, Settings, ChevronRight, AlertTriangle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { CategoriesManager } from './categories/CategoriesManager';
import { ProfileManager } from './profiles/ProfileManager';
import { AgentConfigForm } from './AgentConfigForm';
import { GeneralSettingsForm } from './GeneralSettingsForm';

interface AgentConfig {
  model?: string;
}

interface ConfigResponse {
  agents: Record<string, AgentConfig>;
}

interface ModelsResponse {
  models: string[];
  source: string;
  error?: string;
}

function isModelsResponse(value: unknown): value is ModelsResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { models?: unknown };
  return Array.isArray(candidate.models);
}

type AgentStatus = 'ok' | 'invalid' | 'unconfigured';

interface FullscreenConfigPanelProps {
  open: boolean;
  onClose: () => void;
}

interface AgentItem {
  key: string;
  name: string;
  description: string;
  icon?: React.ReactNode;
}

const AGENTS: AgentItem[] = [
  { key: 'default', name: 'Default', description: 'Fallback configuration' },
  { key: 'sisyphus', name: 'Sisyphus', description: 'Task execution agent' },
  { key: 'hephaestus', name: 'Hephaestus', description: 'Build & automation' },
  { key: 'prometheus', name: 'Prometheus', description: 'Planning agent' },
  { key: 'oracle', name: 'Oracle', description: 'Knowledge & research' },
  { key: 'metis', name: 'Metis', description: 'Strategy & consultation' },
  { key: 'momus', name: 'Momus', description: 'Review & critique' },
  { key: 'atlas', name: 'Atlas', description: 'Execution-focused' },
  { key: 'librarian', name: 'Librarian', description: 'Documentation & exploration' },
  { key: 'explore', name: 'Explore', description: 'Code navigation' },
];

export function FullscreenConfigPanel({ open, onClose }: FullscreenConfigPanelProps) {
  const [activeTab, setActiveTab] = React.useState<'general' | 'agents' | 'categories' | 'profiles'>('general');
  const [selectedAgent, setSelectedAgent] = React.useState('default');
  const [searchQuery, setSearchQuery] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Fetch config and models for status indicators
  const { data: configData } = useQuery<ConfigResponse>({
    queryKey: ['opencode-config'],
    queryFn: async () => {
      const res = await fetch('/api/opencode-config');
      if (!res.ok) throw new Error('Failed to fetch config');
      return res.json();
    },
    enabled: open,
  });

  const { data: modelsData } = useQuery<ModelsResponse>({
    queryKey: ['opencode-models'],
    queryFn: async () => {
      const res = await fetch('/api/opencode-models');
      let parsed: unknown = null;
      try {
        parsed = await res.json();
      } catch {
        parsed = null;
      }

      const errorMessage =
        parsed &&
        typeof parsed === 'object' &&
        'error' in parsed &&
        typeof parsed.error === 'string'
          ? parsed.error
          : null;

      if (!res.ok || errorMessage) {
        throw new Error(errorMessage || `Failed to fetch models (${res.status})`);
      }

      if (!isModelsResponse(parsed)) {
        throw new Error('Invalid models response');
      }

      const data = parsed;
      return data;
    },
    enabled: open,
    retry: false,
  });

  const availableModels = React.useMemo(
    () => new Set(modelsData?.models ?? []),
    [modelsData]
  );

  const getAgentStatus = React.useCallback(
    (agentKey: string): AgentStatus => {
      const agentConfig = configData?.agents?.[agentKey];
      if (!agentConfig?.model) return 'unconfigured';
      if (availableModels.size > 0 && !availableModels.has(agentConfig.model)) return 'invalid';
      return 'ok';
    },
    [configData, availableModels]
  );

  const attentionCount = React.useMemo(() => {
    return AGENTS.filter((a) => {
      const s = getAgentStatus(a.key);
      return s === 'invalid';
    }).length;
  }, [getAgentStatus]);

  React.useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  React.useEffect(() => {
    if (open) {
      const originalStyle = window.getComputedStyle(document.body).overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalStyle;
      };
    }
  }, [open]);

  React.useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const filteredAgents = React.useMemo(() => {
    if (!searchQuery.trim()) return AGENTS;
    const query = searchQuery.toLowerCase();
    return AGENTS.filter(
      (agent) =>
        agent.name.toLowerCase().includes(query) ||
        agent.description.toLowerCase().includes(query) ||
        (configData?.agents?.[agent.key]?.model || '').toLowerCase().includes(query)
    );
  }, [searchQuery, configData]);

  const selectedAgentData = AGENTS.find((a) => a.key === selectedAgent);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-zinc-950">
      <header className="flex h-16 items-center justify-between border-b border-zinc-200 px-6 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white">
            <Settings className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Settings
            </h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Manage application and agent configuration
            </p>
           </div>
         </div>

         <div className="flex items-center gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
           <button
             type="button"
             onClick={() => setActiveTab('general')}
             className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
               activeTab === 'general'
                 ? 'bg-blue-600 text-white shadow-sm'
                 : 'text-zinc-600 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-700'
             }`}
           >
             General
           </button>
           <button
             type="button"
             onClick={() => setActiveTab('agents')}
             className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
               activeTab === 'agents'
                 ? 'bg-blue-600 text-white shadow-sm'
                 : 'text-zinc-600 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-700'
             }`}
           >
             Agents
           </button>
           <button
             type="button"
             onClick={() => setActiveTab('categories')}
             className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
               activeTab === 'categories'
                 ? 'bg-blue-600 text-white shadow-sm'
                 : 'text-zinc-600 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-700'
             }`}
           >
             Categories
           </button>
           <button
             type="button"
             onClick={() => setActiveTab('profiles')}
             className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
               activeTab === 'profiles'
                 ? 'bg-blue-600 text-white shadow-sm'
                 : 'text-zinc-600 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-700'
             }`}
           >
             Profiles
           </button>
         </div>

         <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          aria-label="Close panel"
        >
          <X className="h-5 w-5" />
        </button>
       </header>

       {activeTab === 'general' ? (
         <main className="flex-1 overflow-y-auto bg-white dark:bg-zinc-950">
           <div className="mx-auto max-w-4xl p-8">
             <div className="mb-8">
               <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                 General Settings
               </h2>
               <p className="text-zinc-500 dark:text-zinc-400">
                 Manage application-wide behavior and preferences
               </p>
             </div>
             <GeneralSettingsForm />
           </div>
         </main>
       ) : activeTab === 'agents' ? (
         <div className="flex flex-1 overflow-hidden">
           <aside className="flex w-[280px] flex-col border-r border-zinc-200 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/20">
             <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
               <div className="relative">
                 <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                 <input
                   ref={inputRef}
                   type="text"
                   value={searchQuery}
                   onChange={(e) => setSearchQuery(e.target.value)}
                   placeholder="Search agents..."
                   className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-4 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-600"
                 />
               </div>
             </div>

             <nav className="flex-1 overflow-y-auto p-2">
                <div className="space-y-1">
                  {filteredAgents.map((agent) => {
                    const agentModel = configData?.agents?.[agent.key]?.model;

                    return (
                    <button
                      key={agent.key}
                      type="button"
                      onClick={() => setSelectedAgent(agent.key)}
                     className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                       selectedAgent === agent.key
                         ? 'bg-blue-600 text-white'
                         : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                     }`}
                   >
                     <div
                       className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                         selectedAgent === agent.key
                           ? 'bg-white/20'
                           : 'bg-zinc-200 dark:bg-zinc-800'
                       }`}
                     >
                       <Bot
                         className={`h-4 w-4 ${
                           selectedAgent === agent.key
                             ? 'text-white'
                             : 'text-zinc-600 dark:text-zinc-400'
                         }`}
                       />
                     </div>
                     <div className="min-w-0 flex-1">
                       <div className="flex items-center gap-2 truncate text-sm font-medium">
                         {agent.name}
                          {(() => {
                            const status = getAgentStatus(agent.key);
                            if (status === 'unconfigured') return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${selectedAgent === agent.key ? 'bg-zinc-300' : 'bg-zinc-400 dark:bg-zinc-500'}`} title="Inherits category configuration" />;
                            if (status === 'invalid') return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${selectedAgent === agent.key ? 'bg-amber-300' : 'bg-amber-500'}`} title="Model not available" />;
                            return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${selectedAgent === agent.key ? 'bg-emerald-300' : 'bg-emerald-500'}`} title="Configured" />;
                          })()}
                       </div>
                        <div
                          className={`truncate text-xs ${
                            selectedAgent === agent.key
                              ? 'text-blue-100'
                              : 'text-zinc-500 dark:text-zinc-500'
                          }`}
                        >
                          {agent.description}
                        </div>
                        {agentModel && (
                          <div
                            className={`mt-1 inline-flex max-w-full items-start rounded-md px-1.5 py-0.5 text-[11px] leading-4 ${
                              selectedAgent === agent.key
                                ? 'bg-white/15 text-blue-50/95'
                                : 'bg-zinc-200/70 text-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-300'
                            }`}
                            title={agentModel}
                          >
                            <span className="font-mono break-all [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
                              {agentModel}
                            </span>
                          </div>
                        )}
                      </div>
                      {selectedAgent === agent.key && (
                        <ChevronRight className="h-4 w-4 shrink-0 text-blue-200" />
                      )}
                    </button>
                    );
                  })}
                </div>

               {filteredAgents.length === 0 && (
                 <div className="py-8 text-center">
                   <p className="text-sm text-zinc-500 dark:text-zinc-400">
                     No agents found
                   </p>
                 </div>
               )}
             </nav>

             <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
               <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                 <span className="flex items-center gap-1.5">
                    {AGENTS.length} agents
                    {attentionCount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                        <AlertTriangle className="h-2.5 w-2.5" />
                        {attentionCount} need attention
                      </span>
                    )}
                  </span>
                 <kbd className="rounded bg-zinc-200 px-1.5 py-0.5 font-mono dark:bg-zinc-800">
                   ESC
                 </kbd>
               </div>
             </div>
           </aside>

           <main className="flex-1 overflow-y-auto bg-white dark:bg-zinc-950">
             <div className="mx-auto max-w-3xl p-8">
               <div className="mb-8 flex items-center gap-4">
                 <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg">
                   <Bot className="h-8 w-8" />
                 </div>
                 <div>
                   <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                     {selectedAgentData?.name}
                   </h2>
                   <p className="text-zinc-500 dark:text-zinc-400">
                     {selectedAgentData?.description}
                   </p>
                 </div>
               </div>

                <AgentConfigForm
                    agentName={selectedAgent}
                  />
             </div>
           </main>
         </div>
       ) : activeTab === 'categories' ? (
         <main className="flex-1 overflow-y-auto bg-white dark:bg-zinc-950">
           <div className="mx-auto max-w-4xl p-8">
             <div className="mb-8">
               <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                 Categories
               </h2>
               <p className="text-zinc-500 dark:text-zinc-400">
                 Manage agent categories and their configurations
               </p>
             </div>
             <CategoriesManager />
           </div>
         </main>
       ) : (
         <main className="flex-1 overflow-y-auto bg-white dark:bg-zinc-950">
           <div className="mx-auto max-w-4xl p-8">
             <div className="mb-8">
               <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                 Profiles
               </h2>
               <p className="text-zinc-500 dark:text-zinc-400">
                 Manage configuration profiles for different agent setups
               </p>
             </div>
             <ProfileManager />
           </div>
         </main>
       )}
    </div>
  );
}

export default FullscreenConfigPanel;
