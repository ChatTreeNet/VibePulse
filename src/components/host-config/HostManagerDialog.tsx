import React, { useState, useEffect } from 'react';
import { X, Server, Globe, Plus, Trash2, Edit2, Check, AlertCircle } from 'lucide-react';
import { useHostSources } from '@/hooks/useHostSources';
import { normalizeRemoteHostConfig, validateRemoteBaseUrl } from '@/lib/hostSourcesStorage';
import type { RemoteHostConfig } from '@/types';

interface HostManagerDialogProps {
  open: boolean;
  onClose: () => void;
  hostSources: ReturnType<typeof useHostSources>;
}

export function HostManagerDialog({ open, onClose, hostSources }: HostManagerDialogProps) {
  const { remoteHosts, addRemoteHost, editRemoteHost, deleteRemoteHost, toggleRemoteHost } = hostSources;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState({ hostLabel: '', baseUrl: '' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const originalStyle = window.getComputedStyle(document.body).overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalStyle;
      };
    } else {
      setIsAdding(false);
      setEditingId(null);
      setError(null);
      setFormData({ hostLabel: '', baseUrl: '' });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const getBaseUrlError = (url: string) => {
    const result = validateRemoteBaseUrl(url);

    if (result.ok) {
      return null;
    }

    if (result.error === 'unsupported_protocol') {
      return 'Base URL must use http:// or https://';
    }

    if (result.error === 'credentials_not_allowed') {
      return 'Base URL must not include a username or password';
    }

    return 'A valid base URL is required (e.g., http://localhost:3000)';
  };

  const handleSave = () => {
    setError(null);
    const normalizedLabel = formData.hostLabel.trim();

    if (!normalizedLabel) {
      setError('Label is required');
      return;
    }

    const baseUrlError = getBaseUrlError(formData.baseUrl);
    if (baseUrlError) {
      setError(baseUrlError);
      return;
    }

    if (isAdding) {
      const newHost = normalizeRemoteHostConfig({
        hostId: `remote-${Date.now()}`,
        hostLabel: normalizedLabel,
        baseUrl: formData.baseUrl,
        enabled: true,
      });

      if (!newHost) {
        setError('A valid base URL is required (e.g., http://localhost:3000)');
        return;
      }

      addRemoteHost(newHost);
      setIsAdding(false);
    } else if (editingId) {
      const existingHost = remoteHosts.find((h) => h.hostId === editingId);
      if (existingHost) {
        const updatedHost = normalizeRemoteHostConfig({
          ...existingHost,
          hostLabel: normalizedLabel,
          baseUrl: formData.baseUrl,
        });

        if (!updatedHost) {
          setError('A valid base URL is required (e.g., http://localhost:3000)');
          return;
        }

        editRemoteHost(editingId, updatedHost);
      }
      setEditingId(null);
    }
    setFormData({ hostLabel: '', baseUrl: '' });
  };

  const startEdit = (host: RemoteHostConfig) => {
    setEditingId(host.hostId);
    setFormData({ hostLabel: host.hostLabel, baseUrl: host.baseUrl });
    setIsAdding(false);
    setError(null);
  };

  const startAdd = () => {
    setIsAdding(true);
    setEditingId(null);
    setFormData({ hostLabel: '', baseUrl: '' });
    setError(null);
  };

  const cancelForm = () => {
    setIsAdding(false);
    setEditingId(null);
    setFormData({ hostLabel: '', baseUrl: '' });
    setError(null);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" data-testid="host-manager">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <header className="flex h-14 items-center justify-between border-b border-zinc-200 px-5 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <Server className="h-5 w-5 text-blue-600 dark:text-blue-500" />
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Host Manager</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label="Close host manager"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <main className="flex-1 overflow-y-auto p-5">
          <div className="space-y-3">
            <div
              data-testid="host-row-local"
              className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-900/20"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                  <Server className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Local</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">Auto-discovered processes</div>
                </div>
              </div>
              <div className="flex items-center">
                <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10 dark:bg-blue-400/10 dark:text-blue-400 dark:ring-blue-400/30">
                  Built-in
                </span>
              </div>
            </div>

            {remoteHosts.map((host) => {
              const isEditingThis = editingId === host.hostId;
              const testIdSuffix = host.hostId.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();

              return (
                <div
                  key={host.hostId}
                  data-testid={`host-row-remote-${testIdSuffix}`}
                  className={`flex flex-col gap-3 rounded-lg border p-3 transition-colors ${
                    isEditingThis
                      ? 'border-blue-500 bg-blue-50/30 dark:border-blue-500/50 dark:bg-blue-900/10'
                      : 'border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700'
                  }`}
                >
                  {isEditingThis ? (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <label htmlFor="edit-hostLabel" className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                          Label
                        </label>
                        <input
                          id="edit-hostLabel"
                          data-testid="host-form-label"
                          type="text"
                          value={formData.hostLabel}
                           onChange={(e) => setFormData({ ...formData, hostLabel: e.target.value })}
                          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                          placeholder="e.g., Production Server"
                        />
                      </div>
                      <div className="space-y-2">
                        <label htmlFor="edit-baseUrl" className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                          Base URL
                        </label>
                        <input
                          id="edit-baseUrl"
                          data-testid="host-form-base-url"
                          type="url"
                          value={formData.baseUrl}
                           onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
                          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                          placeholder="https://api.example.com"
                        />
                      </div>
                      {error && (
                        <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
                          <AlertCircle className="h-3.5 w-3.5" />
                          <span>{error}</span>
                        </div>
                      )}
                      <div className="flex justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={cancelForm}
                          className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleSave}
                          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                        >
                          <Check className="h-3.5 w-3.5" />
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`flex h-8 w-8 items-center justify-center rounded-md ${host.enabled ? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' : 'bg-zinc-50 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-600'}`}>
                          <Globe className="h-4 w-4" />
                        </div>
                        <div className={host.enabled ? '' : 'opacity-60'}>
                          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{host.hostLabel}</div>
                          <div className="text-xs text-zinc-500 dark:text-zinc-400">{host.baseUrl}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => toggleRemoteHost(host.hostId)}
                          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                            host.enabled
                              ? 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
                              : 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20'
                          }`}
                        >
                          {host.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          type="button"
                          onClick={() => startEdit(host)}
                          className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                          aria-label="Edit host"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteRemoteHost(host.hostId)}
                          className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                          aria-label="Delete host"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {isAdding ? (
              <div className="flex flex-col gap-3 rounded-lg border border-blue-500 bg-blue-50/30 p-3 dark:border-blue-500/50 dark:bg-blue-900/10">
                <div className="space-y-2">
                  <label htmlFor="add-hostLabel" className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Label
                  </label>
                  <input
                    id="add-hostLabel"
                    data-testid="host-form-label"
                    type="text"
                    value={formData.hostLabel}
                     onChange={(e) => setFormData({ ...formData, hostLabel: e.target.value })}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    placeholder="e.g., Remote Server"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="add-baseUrl" className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Base URL
                  </label>
                  <input
                    id="add-baseUrl"
                    data-testid="host-form-base-url"
                    type="url"
                    value={formData.baseUrl}
                     onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    placeholder="https://api.example.com"
                  />
                </div>
                {error && (
                  <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
                    <AlertCircle className="h-3.5 w-3.5" />
                    <span>{error}</span>
                  </div>
                )}
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={cancelForm}
                    className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Add Host
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={startAdd}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-300 py-3 text-sm font-medium text-zinc-600 transition-colors hover:border-zinc-400 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:bg-zinc-900/50 dark:hover:text-zinc-100"
              >
                <Plus className="h-4 w-4" />
                Add Remote Host
              </button>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
