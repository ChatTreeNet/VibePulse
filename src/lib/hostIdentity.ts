/**
 * Composes a composite source key from host ID and session ID.
 * Format: "hostId:sessionId"
 */
export function composeSourceKey(hostId: string, sessionId: string): string {
  if (!hostId || hostId.trim() === '') {
    throw new Error('Invalid hostId: cannot be empty');
  }
  if (!sessionId || sessionId.trim() === '') {
    throw new Error('Invalid sessionId: cannot be empty');
  }
  if (hostId.includes(':') || sessionId.includes(':')) {
    throw new Error('Invalid hostId or sessionId: colon character not allowed');
  }
  return `${hostId}:${sessionId}`;
}

/**
 * Parses a composite source key into host ID and session ID.
 * Throws if the key is not in the format "hostId:sessionId".
 */
export function parseSourceKey(sourceKey: string): { hostId: string; sessionId: string } {
  if (typeof sourceKey !== 'string') {
    throw new Error('Invalid sourceKey: must be a string');
  }

  const parts = sourceKey.split(':');
  if (parts.length !== 2) {
    throw new Error('Invalid sourceKey: must contain exactly one colon separator');
  }

  const [hostId, sessionId] = parts;
  const trimmedHostId = hostId.trim();
  const trimmedSessionId = sessionId.trim();
  if (trimmedHostId === '' || trimmedSessionId === '') {
    throw new Error('Invalid sourceKey: hostId and sessionId cannot be empty');
  }

  return { hostId: trimmedHostId, sessionId: trimmedSessionId };
}

/**
 * Extracts the host ID from a composite source key.
 * Returns null if the key is invalid.
 */
export function getHostIdFromSourceKey(sourceKey: string): string | null {
  try {
    const { hostId } = parseSourceKey(sourceKey);
    return hostId;
  } catch {
    return null;
  }
}

/**
 * Extracts the session ID from a composite source key.
 * Returns null if the key is invalid.
 */
export function getSessionIdFromSourceKey(sourceKey: string): string | null {
  try {
    const { sessionId } = parseSourceKey(sourceKey);
    return sessionId;
  } catch {
    return null;
  }
}

/**
 * Builds a composite source key from a host ID and session ID.
 */
export function buildSourceKey(hostId: string, sessionId: string): string {
  return composeSourceKey(hostId, sessionId);
}

/**
 * Checks if a source key matches a given host ID.
 */
export function isFromHost(sourceKey: string, hostId: string): boolean {
  const parsedHostId = getHostIdFromSourceKey(sourceKey);
  return parsedHostId === hostId;
}

export interface ActionSessionReference {
  hostId: string;
  sessionId: string;
  isRemote: boolean;
}

export function parseActionSessionReference(value: string): ActionSessionReference {
  if (typeof value !== 'string') {
    throw new Error('Invalid action session id: must be a string');
  }

  const trimmedValue = value.trim();
  if (trimmedValue === '') {
    throw new Error('Invalid action session id: cannot be empty');
  }

  if (!trimmedValue.includes(':')) {
    return {
      hostId: 'local',
      sessionId: trimmedValue,
      isRemote: false,
    };
  }

  const { hostId, sessionId } = parseSourceKey(trimmedValue);
  return {
    hostId,
    sessionId,
    isRemote: hostId !== 'local',
  };
}

export function resolveLocalActionSessionId(value: string): string | null {
  try {
    const reference = parseActionSessionReference(value);
    return reference.isRemote ? null : reference.sessionId;
  } catch {
    return null;
  }
}
