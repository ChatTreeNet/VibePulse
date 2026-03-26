type SessionActionErrorPayload = {
  error?: unknown;
  reason?: unknown;
  message?: unknown;
};

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function mapSessionActionError(payload: SessionActionErrorPayload | null | undefined, fallback: string): string {
  const reason = readString(payload?.reason);

  switch (reason) {
    case 'unauthorized':
      return 'Remote node rejected the request. Check node access token settings.';
    case 'session_not_found':
      return 'Session was not found.';
    case 'forbidden':
    case 'node_request_failed_403':
      return 'Remote node denied the request.';
    case 'unsupported_node_version':
    case 'node_request_failed_404':
    case 'node_request_failed_501':
      return 'Remote node does not support this action yet.';
    case 'upstream_timeout':
      return 'Remote node did not respond in time.';
    case 'upstream_unreachable':
      return 'Remote node is offline or unreachable.';
    case 'editor_unavailable':
      return 'Remote node could not open the editor on that machine.';
    case 'invalid_action_session_id':
      return 'The selected session id is invalid.';
    default:
      return readString(payload?.error) ?? readString(payload?.message) ?? fallback;
  }
}
