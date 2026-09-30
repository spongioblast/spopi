// ABOUTME: Reconciles the route target with the snapshot target after bootstrap.
// ABOUTME: A mismatch keeps the current workspace and session identity.

/**
 * @param {{ workspaceId?: string, instanceId?: string, sessionId: string }} currentTarget
 * @param {{ workspaceId?: string, instanceId?: string, sessionId?: string } | null | undefined} snapshotTarget
 */
export function reconcileSnapshotTarget(currentTarget, snapshotTarget) {
  if (!snapshotTarget) return currentTarget;
  if (
    snapshotTarget.workspaceId !== currentTarget.workspaceId ||
    snapshotTarget.instanceId !== currentTarget.instanceId
  ) {
    throw new Error("Snapshot target does not belong to the current runtime");
  }
  // If the sessionId differs and this is NOT a session_bound promotion
  // (temporary- prefix → real id), treat as stale and keep current target.
  if (
    snapshotTarget.sessionId !== currentTarget.sessionId &&
    !currentTarget.sessionId.startsWith("temporary-")
  ) {
    return currentTarget;
  }
  return snapshotTarget;
}
