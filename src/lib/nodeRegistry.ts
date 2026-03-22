import { existsSync, mkdirSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { parse, stringify } from 'comment-json';

export const NODES_CONFIG_DIR = join(homedir(), '.config', 'vibepulse');
export const NODE_REGISTRY_PATH = join(NODES_CONFIG_DIR, 'nodes.jsonc');

export interface StoredNodeRecord {
  nodeId: string;
  nodeLabel: string;
  baseUrl: string;
  enabled: boolean;
  token: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicNodeRecord {
  nodeId: string;
  nodeLabel: string;
  baseUrl: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  tokenConfigured: boolean;
}

interface NodeRegistryFile {
  version: number;
  nodes: StoredNodeRecord[];
}

export type NodeBaseUrlValidationError =
  | 'empty'
  | 'invalid'
  | 'unsupported_protocol'
  | 'credentials_not_allowed';

type NodeBaseUrlValidationResult =
  | { ok: true; normalizedBaseUrl: string }
  | { ok: false; error: NodeBaseUrlValidationError };

export type NodeRegistryErrorCode =
  | 'node_not_found'
  | 'node_label_required'
  | 'node_id_required'
  | 'invalid_token'
  | 'invalid_enabled'
  | 'invalid_base_url'
  | 'duplicate_base_url'
  | 'no_updates';

export class NodeRegistryError extends Error {
  readonly code: NodeRegistryErrorCode;

  constructor(code: NodeRegistryErrorCode, message: string) {
    super(message);
    this.name = 'NodeRegistryError';
    this.code = code;
  }
}

function normalizeParsedBaseUrl(url: URL): string {
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

export function validateNodeBaseUrl(url: string): NodeBaseUrlValidationResult {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    return { ok: false, error: 'empty' };
  }

  try {
    const parsed = new URL(trimmedUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: 'unsupported_protocol' };
    }

    if (parsed.username || parsed.password) {
      return { ok: false, error: 'credentials_not_allowed' };
    }

    return { ok: true, normalizedBaseUrl: normalizeParsedBaseUrl(parsed) };
  } catch {
    return { ok: false, error: 'invalid' };
  }
}

function normalizeStoredNode(node: unknown): StoredNodeRecord | null {
  if (!node || typeof node !== 'object') {
    return null;
  }

  const candidate = node as Record<string, unknown>;
  if (
    typeof candidate.nodeId !== 'string' ||
    typeof candidate.nodeLabel !== 'string' ||
    typeof candidate.baseUrl !== 'string' ||
    typeof candidate.enabled !== 'boolean' ||
    typeof candidate.token !== 'string' ||
    typeof candidate.createdAt !== 'string' ||
    typeof candidate.updatedAt !== 'string'
  ) {
    return null;
  }

  const validation = validateNodeBaseUrl(candidate.baseUrl);
  if (!validation.ok) {
    return null;
  }

  const nodeId = candidate.nodeId.trim();
  const nodeLabel = candidate.nodeLabel.trim();

  if (!nodeId || !nodeLabel) {
    return null;
  }

  return {
    nodeId,
    nodeLabel,
    baseUrl: validation.normalizedBaseUrl,
    enabled: candidate.enabled,
    token: candidate.token.trim(),
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
  };
}

function ensureNodesConfigDir(): void {
  if (!existsSync(NODES_CONFIG_DIR)) {
    mkdirSync(NODES_CONFIG_DIR, { recursive: true });
  }
}

function defaultRegistry(): NodeRegistryFile {
  return {
    version: 1,
    nodes: [],
  };
}

async function readRegistryFile(): Promise<NodeRegistryFile> {
  try {
    ensureNodesConfigDir();

    if (!existsSync(NODE_REGISTRY_PATH)) {
      const initial = defaultRegistry();
      await writeRegistryFile(initial);
      return initial;
    }

    const raw = await readFile(NODE_REGISTRY_PATH, 'utf-8');
    const parsed = parse(raw, null, false) as unknown;

    if (!parsed || typeof parsed !== 'object') {
      return defaultRegistry();
    }

    const registry = parsed as Record<string, unknown>;
    if (!Array.isArray(registry.nodes)) {
      return defaultRegistry();
    }

    const normalizedNodes = registry.nodes
      .map(normalizeStoredNode)
      .filter((node): node is StoredNodeRecord => node !== null);

    const dedupedNodes: StoredNodeRecord[] = [];
    const seenBaseUrls = new Set<string>();
    for (const node of normalizedNodes) {
      if (seenBaseUrls.has(node.baseUrl)) {
        continue;
      }
      seenBaseUrls.add(node.baseUrl);
      dedupedNodes.push(node);
    }

    return {
      version: typeof registry.version === 'number' ? registry.version : 1,
      nodes: dedupedNodes,
    };
  } catch {
    return defaultRegistry();
  }
}

async function writeRegistryFile(registry: NodeRegistryFile): Promise<void> {
  ensureNodesConfigDir();
  const content = stringify(registry, null, 2);
  await writeFile(NODE_REGISTRY_PATH, content, 'utf-8');
}

export function sanitizeNodeRecord(node: StoredNodeRecord): PublicNodeRecord {
  return {
    nodeId: node.nodeId,
    nodeLabel: node.nodeLabel,
    baseUrl: node.baseUrl,
    enabled: node.enabled,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    tokenConfigured: node.token.trim().length > 0,
  };
}

function assertNodeLabel(label: unknown): string {
  if (typeof label !== 'string' || label.trim() === '') {
    throw new NodeRegistryError('node_label_required', 'nodeLabel is required and must be a non-empty string');
  }
  return label.trim();
}

function assertNodeId(nodeId: unknown): string {
  if (typeof nodeId !== 'string' || nodeId.trim() === '') {
    throw new NodeRegistryError('node_id_required', 'nodeId is required and must be a non-empty string');
  }
  return nodeId.trim();
}

function normalizeOptionalToken(token: unknown): string {
  if (token === undefined || token === null) {
    return '';
  }

  if (typeof token !== 'string') {
    throw new NodeRegistryError('invalid_token', 'token must be a string when provided');
  }

  return token.trim();
}

function assertEnabled(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new NodeRegistryError('invalid_enabled', 'enabled must be a boolean');
  }
  return value;
}

function assertAndNormalizeBaseUrl(baseUrl: unknown): string {
  if (typeof baseUrl !== 'string') {
    throw new NodeRegistryError('invalid_base_url', 'baseUrl must be a string');
  }

  const validation = validateNodeBaseUrl(baseUrl);
  if (!validation.ok) {
    throw new NodeRegistryError(
      'invalid_base_url',
      `baseUrl validation failed: ${validation.error}`
    );
  }

  return validation.normalizedBaseUrl;
}

function assertUniqueBaseUrl(nodes: StoredNodeRecord[], normalizedBaseUrl: string, ignoreNodeId?: string): void {
  const duplicate = nodes.find(node => node.baseUrl === normalizedBaseUrl && node.nodeId !== ignoreNodeId);
  if (duplicate) {
    throw new NodeRegistryError(
      'duplicate_base_url',
      `A node with baseUrl '${normalizedBaseUrl}' already exists`
    );
  }
}

export async function listNodeRecords(): Promise<StoredNodeRecord[]> {
  const registry = await readRegistryFile();
  return [...registry.nodes];
}

export async function listNodes(): Promise<PublicNodeRecord[]> {
  const nodes = await listNodeRecords();
  return nodes.map(sanitizeNodeRecord);
}

export interface CreateNodeInput {
  nodeLabel: string;
  baseUrl: string;
  token?: string;
  enabled?: boolean;
}

export interface UpdateNodeInput {
  nodeLabel?: string;
  baseUrl?: string;
  token?: string;
  enabled?: boolean;
}

export async function createNode(input: CreateNodeInput): Promise<PublicNodeRecord> {
  const nodeLabel = assertNodeLabel(input.nodeLabel);
  const baseUrl = assertAndNormalizeBaseUrl(input.baseUrl);
  const token = normalizeOptionalToken(input.token);
  const enabled = input.enabled === undefined ? true : assertEnabled(input.enabled);

  const registry = await readRegistryFile();
  assertUniqueBaseUrl(registry.nodes, baseUrl);

  const now = new Date().toISOString();
  const record: StoredNodeRecord = {
    nodeId: randomUUID(),
    nodeLabel,
    baseUrl,
    enabled,
    token,
    createdAt: now,
    updatedAt: now,
  };

  registry.nodes.push(record);
  await writeRegistryFile(registry);

  return sanitizeNodeRecord(record);
}

export async function updateNode(nodeIdInput: unknown, updates: UpdateNodeInput): Promise<PublicNodeRecord> {
  const nodeId = assertNodeId(nodeIdInput);

  const hasAnyUpdate =
    updates.nodeLabel !== undefined ||
    updates.baseUrl !== undefined ||
    updates.token !== undefined ||
    updates.enabled !== undefined;

  if (!hasAnyUpdate) {
    throw new NodeRegistryError('no_updates', 'At least one update field is required');
  }

  const registry = await readRegistryFile();
  const index = registry.nodes.findIndex(node => node.nodeId === nodeId);
  if (index === -1) {
    throw new NodeRegistryError('node_not_found', `Node '${nodeId}' not found`);
  }

  const current = registry.nodes[index];

  const nextNodeLabel = updates.nodeLabel === undefined ? current.nodeLabel : assertNodeLabel(updates.nodeLabel);
  const nextBaseUrl = updates.baseUrl === undefined ? current.baseUrl : assertAndNormalizeBaseUrl(updates.baseUrl);
  const nextToken = updates.token === undefined ? current.token : normalizeOptionalToken(updates.token);
  const nextEnabled = updates.enabled === undefined ? current.enabled : assertEnabled(updates.enabled);

  assertUniqueBaseUrl(registry.nodes, nextBaseUrl, current.nodeId);

  const updated: StoredNodeRecord = {
    ...current,
    nodeLabel: nextNodeLabel,
    baseUrl: nextBaseUrl,
    token: nextToken,
    enabled: nextEnabled,
    updatedAt: new Date().toISOString(),
  };

  registry.nodes[index] = updated;
  await writeRegistryFile(registry);

  return sanitizeNodeRecord(updated);
}

export async function toggleNode(nodeIdInput: unknown, enabled?: unknown): Promise<PublicNodeRecord> {
  const nodeId = assertNodeId(nodeIdInput);

  const registry = await readRegistryFile();
  const index = registry.nodes.findIndex(node => node.nodeId === nodeId);
  if (index === -1) {
    throw new NodeRegistryError('node_not_found', `Node '${nodeId}' not found`);
  }

  const current = registry.nodes[index];
  const nextEnabled = enabled === undefined ? !current.enabled : assertEnabled(enabled);
  const updated: StoredNodeRecord = {
    ...current,
    enabled: nextEnabled,
    updatedAt: new Date().toISOString(),
  };

  registry.nodes[index] = updated;
  await writeRegistryFile(registry);

  return sanitizeNodeRecord(updated);
}

export async function deleteNode(nodeIdInput: unknown): Promise<boolean> {
  const nodeId = assertNodeId(nodeIdInput);

  const registry = await readRegistryFile();
  const nextNodes = registry.nodes.filter(node => node.nodeId !== nodeId);
  if (nextNodes.length === registry.nodes.length) {
    return false;
  }

  registry.nodes = nextNodes;
  await writeRegistryFile(registry);
  return true;
}
