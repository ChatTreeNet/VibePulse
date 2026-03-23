import React, { useState, useEffect } from 'react';
import { X, Server, Globe, Plus, Trash2, Edit2, Check, AlertCircle, Key } from 'lucide-react';
import { useHostSources } from '@/hooks/useHostSources';
import { validateNodeUrl } from '@/lib/hostSourcesStorage';
import type { RemoteHostConfig } from '@/types';

interface HostManagerDialogProps {
  open: boolean;
  onClose: () => void;
  hostSources: ReturnType<typeof useHostSources>;
  isNodeMode?: boolean;
}

export function HostManagerDialog({ open, onClose, hostSources, isNodeMode = false }: HostManagerDialogProps) {
  const { remoteHosts, addRemoteHost, editRemoteHost, deleteRemoteHost, toggleRemoteHost } = hostSources;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState({ hostLabel: '', baseUrl: '', token: '' });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      setFormData({ hostLabel: '', baseUrl: '', token: '' });
      setIsSubmitting(false);
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

  const getNodeUrlError = (url: string) => {
    const result = validateNodeUrl(url);

    if (result.ok) {
      return null;
    }

    if (result.error === 'unsupported_protocol') {
      return 'Node URL must use http:// or https://';
    }

    if (result.error === 'credentials_not_allowed') {
      return 'Node URL must not include a username or password';
    }

    return 'A valid Node URL is required (e.g., http://localhost:3000)';
  };

  const handleSave = async () => {
    setError(null);
    const normalizedLabel = formData.hostLabel.trim();

    if (!normalizedLabel) {
      setError('Label is required');
      return;
    }

    const nodeUrlError = getNodeUrlError(formData.baseUrl);
    if (nodeUrlError) {
      setError(nodeUrlError);
      return;
    }

    setIsSubmitting(true);
    try {
      if (isAdding) {
        await addRemoteHost({
          hostId: '', // Handled by backend
          hostLabel: normalizedLabel,
          baseUrl: formData.baseUrl,
          enabled: true,
          token: formData.token.trim(),
        });
        setIsAdding(false);
      } else if (editingId) {
        const existingHost = remoteHosts.find((h) => h.hostId === editingId);
        if (existingHost) {
          await editRemoteHost(editingId, {
            ...existingHost,
            hostLabel: normalizedLabel,
            baseUrl: formData.baseUrl,
            token: formData.token.trim() || undefined,
          });
        }
        setEditingId(null);
      }
      setFormData({ hostLabel: '', baseUrl: '', token: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  const startEdit = (host: RemoteHostConfig) => {
    setEditingId(host.hostId);
    setFormData({ hostLabel: host.hostLabel, baseUrl: host.baseUrl, token: '' });
    setIsAdding(false);
    setError(null);
  };

  const startAdd = () => {
    setIsAdding(true);
    setEditingId(null);
    setFormData({ hostLabel: '', baseUrl: '', token: '' });
    setError(null);
  };

  const cancelForm = () => {
    setIsAdding(false);
    setEditingId(null);
    setFormData({ hostLabel: '', baseUrl: '', token: '' });
    setError(null);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" data-testid="host-manager">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <header className="flex h-14 items-center justify-between border-b border-zinc-200 px-5 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <Server className="h-5 w-5 text-blue-600 dark:text-blue-500" />
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
               Nodes
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label="Close node manager"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <main className="flex-1 overflow-y-auto p-5">
          {isNodeMode ? (
             <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900/50 dark:bg-yellow-900/20">
               <div className="flex items-start gap-3">
                 <AlertCircle className="mt-0.5 h-5 w-5 text-yellow-600 dark:text-yellow-500" />
                 <div>
                   <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-400">Node Mode Active</h3>
                   <p className="mt-1 text-sm text-yellow-700 dark:text-yellow-500">
                     Remote node configuration is disabled while running in node mode to prevent nested hub configurations.
                   </p>
                 </div>
               </div>
             </div>
          ) : (
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
                          Node Label
                        </label>
                        <input
                          id="edit-hostLabel"
                          data-testid="host-form-label"
                          type="text"
                          value={formData.hostLabel}
                           onChange={(e) => setFormData({ ...formData, hostLabel: e.target.value })}
                          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                          placeholder="e.g., Production Node"
                          disabled={isSubmitting}
                        />
                      </div>
                      <div className="space-y-2">
                        <label htmlFor="edit-baseUrl" className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                          Node URL
                        </label>
                        <input
                          id="edit-baseUrl"
                          data-testid="host-form-base-url"
                          type="url"
                          value={formData.baseUrl}
                           onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
                          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                          placeholder="https://node.example.com"
                          disabled={isSubmitting}
                        />
                      </div>
                      <div className="space-y-2">
                        <label htmlFor="edit-token" className="text-xs font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                          <Key className="h-3.5 w-3.5" />
                          Update Token (optional)
                        </label>
                        <input
                          id="edit-token"
                          data-testid="host-form-token"
                          type="password"
                          value={formData.token}
                          onChange={(e) => setFormData({ ...formData, token: e.target.value })}
                          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                          placeholder="Leave blank to keep existing token"
                          disabled={isSubmitting}
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
                          disabled={isSubmitting}
                          className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleSave}
                          disabled={isSubmitting}
                          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          <Check className="h-3.5 w-3.5" />
                          {isSubmitting ? 'Saving...' : 'Save'}
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
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{host.hostLabel}</div>
                            {host.tokenConfigured && (
                              <Key className="h-3 w-3 text-zinc-400" aria-label="Token configured" />
                            )}
                          </div>
                          <div className="text-xs text-zinc-500 dark:text-zinc-400">{host.baseUrl}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => toggleRemoteHost(host.hostId, !host.enabled)}
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
                          aria-label="Edit node"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteRemoteHost(host.hostId)}
                          className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                          aria-label="Delete node"
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
                    Node Label
                  </label>
                  <input
                    id="add-hostLabel"
                    data-testid="host-form-label"
                    type="text"
                    value={formData.hostLabel}
                     onChange={(e) => setFormData({ ...formData, hostLabel: e.target.value })}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    placeholder="e.g., Remote Node"
                    disabled={isSubmitting}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="add-baseUrl" className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Node URL
                  </label>
                  <input
                    id="add-baseUrl"
                    data-testid="host-form-base-url"
                    type="url"
                    value={formData.baseUrl}
                     onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    placeholder="https://node.example.com"
                    disabled={isSubmitting}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="add-token" className="text-xs font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                    <Key className="h-3.5 w-3.5" />
                    Access Token (optional)
                  </label>
                  <input
                    id="add-token"
                    data-testid="host-form-token"
                    type="password"
                    value={formData.token}
                    onChange={(e) => setFormData({ ...formData, token: e.target.value })}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    placeholder="Leave blank only on trusted networks"
                    disabled={isSubmitting}
                  />
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Recommended: set a token unless this node is only reachable on a trusted private network.
                  </p>
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
                    disabled={isSubmitting}
                    className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={isSubmitting}
                    className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" />
                    {isSubmitting ? 'Adding...' : 'Add Node'}
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
                Add Remote Node
              </button>
            )}
          </div>
          )}
        </main>
      </div>
    </div>
  );
}
