'use client';

import * as React from 'react';
import { X, Search, Bot, Settings, ChevronRight } from 'lucide-react';

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
  const [selectedAgent, setSelectedAgent] = React.useState('default');
  const [searchQuery, setSearchQuery] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);

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
        agent.description.toLowerCase().includes(query)
    );
  }, [searchQuery]);

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
              Agent Configuration
            </h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Manage AI agent settings and preferences
            </p>
          </div>
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
              {filteredAgents.map((agent) => (
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
                    <div className="truncate text-sm font-medium">
                      {agent.name}
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
                  </div>
                  {selectedAgent === agent.key && (
                    <ChevronRight className="h-4 w-4 shrink-0 text-blue-200" />
                  )}
                </button>
              ))}
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
              <span>{AGENTS.length} agents available</span>
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

            <div className="space-y-6">
              <section className="rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Model Settings
                </h3>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label htmlFor="model-select" className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      Model
                    </label>
                    <select id="model-select" className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
                      <option>Select a model...</option>
                      <option>Claude 3.5 Sonnet</option>
                      <option>GPT-4</option>
                      <option>GPT-4 Turbo</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="variant-select" className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      Variant
                    </label>
                    <select id="variant-select" className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
                      <option value="">Not set</option>
                      <option value="max">max</option>
                      <option value="high">high</option>
                      <option value="medium">medium</option>
                      <option value="low">low</option>
                    </select>
                  </div>
                </div>
              </section>

              <section className="rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Parameters
                </h3>
                <div className="space-y-6">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label htmlFor="temperature-slider" className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        Temperature
                      </label>
                      <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                        0.7
                      </span>
                    </div>
                    <input
                      id="temperature-slider"
                      type="range"
                      min={0}
                      max={2}
                      step={0.1}
                      defaultValue={0.7}
                      className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-zinc-200 accent-blue-600 dark:bg-zinc-700"
                    />
                    <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
                      <span>Precise (0)</span>
                      <span>Balanced (1)</span>
                      <span>Creative (2)</span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label htmlFor="top-p-slider" className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        Top P
                      </label>
                      <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                        1.0
                      </span>
                    </div>
                    <input
                      id="top-p-slider"
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      defaultValue={1}
                      className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-zinc-200 accent-blue-600 dark:bg-zinc-700"
                    />
                    <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
                      <span>Diverse (0)</span>
                      <span>Default (1)</span>
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  System Prompt
                </h3>
                <div className="space-y-2">
                  <label htmlFor="prompt-append" className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    Prompt Append
                  </label>
                  <textarea
                    id="prompt-append"
                    rows={4}
                    className="w-full resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-600"
                    placeholder="Additional system instructions to append..."
                  />
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Additional instructions appended to the system prompt for this
                    agent.
                  </p>
                </div>
              </section>

              <div className="flex items-center justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-10 rounded-lg px-4 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default FullscreenConfigPanel;
