import { describe, expect, it } from 'vitest';

import {
  NODE_PROTOCOL_VERSION,
  NODE_PROTOCOL_VERSION_HEADER,
  NODE_SHARED_TOKEN_ENV_VAR,
  createNodeFailurePayload,
  createNodeRequestHeaders,
  getConfiguredNodeToken,
  guardNodeRequest,
} from './nodeProtocol';

describe('createNodeRequestHeaders', () => {
  it('sets the fixed node protocol version and bearer token', () => {
    const headers = createNodeRequestHeaders(' shared-secret ', { 'x-extra': 'kept' });

    expect(headers.get(NODE_PROTOCOL_VERSION_HEADER)).toBe(NODE_PROTOCOL_VERSION);
    expect(headers.get('authorization')).toBe('Bearer shared-secret');
    expect(headers.get('x-extra')).toBe('kept');
  });

  it('omits bearer auth when token is blank or missing', () => {
    const blankTokenHeaders = createNodeRequestHeaders('   ', { 'x-extra': 'kept' });
    const missingTokenHeaders = createNodeRequestHeaders(undefined, { 'x-extra': 'kept' });

    expect(blankTokenHeaders.get(NODE_PROTOCOL_VERSION_HEADER)).toBe(NODE_PROTOCOL_VERSION);
    expect(blankTokenHeaders.get('authorization')).toBeNull();
    expect(missingTokenHeaders.get(NODE_PROTOCOL_VERSION_HEADER)).toBe(NODE_PROTOCOL_VERSION);
    expect(missingTokenHeaders.get('authorization')).toBeNull();
    expect(blankTokenHeaders.get('x-extra')).toBe('kept');
  });
});

describe('getConfiguredNodeToken', () => {
  it('reads and trims the shared node token from env', () => {
    expect(
      getConfiguredNodeToken({
        [NODE_SHARED_TOKEN_ENV_VAR]: ' secret-token ',
      } as unknown as NodeJS.ProcessEnv)
    ).toBe('secret-token');
  });

  it('returns null when the shared node token is blank', () => {
    expect(
      getConfiguredNodeToken({
        [NODE_SHARED_TOKEN_ENV_VAR]: '   ',
      } as unknown as NodeJS.ProcessEnv)
    ).toBeNull();
  });
});

describe('guardNodeRequest', () => {
  it('accepts authenticated node requests with the required version header', () => {
    const result = guardNodeRequest(new Request('https://node.test/api/node/health', {
      headers: createNodeRequestHeaders('secret-token'),
    }), {
      runtimeRole: 'node',
      expectedToken: 'secret-token',
    });

    expect(result).toEqual({ ok: true });
  });

  it('fails deterministically when the server is not running in node mode', () => {
    const result = guardNodeRequest(new Request('https://node.test/api/node/health', {
      headers: createNodeRequestHeaders('secret-token'),
    }), {
      runtimeRole: 'hub',
      expectedToken: 'secret-token',
    });

    expect(result).toMatchObject({
      ok: false,
      status: 503,
      body: {
        ok: false,
        reason: 'node_misconfigured',
        degraded: true,
      },
    });
  });

  it('accepts requests without bearer auth when node shared token is missing', () => {
    const result = guardNodeRequest(new Request('https://node.test/api/node/health', {
      headers: { [NODE_PROTOCOL_VERSION_HEADER]: NODE_PROTOCOL_VERSION },
    }), {
      runtimeRole: 'node',
      expectedToken: '   ',
    });

    expect(result).toEqual({ ok: true });
  });

  it('rejects requests without the required node protocol version', () => {
    const result = guardNodeRequest(new Request('https://node.test/api/node/health', {
      headers: { authorization: 'Bearer secret-token' },
    }), {
      runtimeRole: 'node',
      expectedToken: 'secret-token',
    });

    expect(result).toMatchObject({
      ok: false,
      status: 426,
      body: {
        ok: false,
        reason: 'unsupported_node_version',
      },
    });
  });

  it('rejects requests without bearer auth', () => {
    const result = guardNodeRequest(new Request('https://node.test/api/node/health', {
      headers: { [NODE_PROTOCOL_VERSION_HEADER]: NODE_PROTOCOL_VERSION },
    }), {
      runtimeRole: 'node',
      expectedToken: 'secret-token',
    });

    expect(result).toMatchObject({
      ok: false,
      status: 401,
      body: {
        ok: false,
        reason: 'unauthorized',
      },
    });
  });

  it('rejects requests with the wrong bearer token', () => {
    const result = guardNodeRequest(new Request('https://node.test/api/node/health', {
      headers: createNodeRequestHeaders('wrong-token'),
    }), {
      runtimeRole: 'node',
      expectedToken: 'secret-token',
    });

    expect(result).toMatchObject({
      ok: false,
      status: 401,
      body: {
        ok: false,
        reason: 'unauthorized',
      },
    });
  });
});

describe('createNodeFailurePayload', () => {
  it('marks upstream failures as degraded and preserves extra fields', () => {
    expect(createNodeFailurePayload('upstream_timeout', { upstream: { reachable: false } })).toEqual({
      ok: false,
      reason: 'upstream_timeout',
      protocolVersion: NODE_PROTOCOL_VERSION,
      degraded: true,
      upstream: { reachable: false },
    });
  });
});
