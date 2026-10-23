// useSync — wires a single Sync_Service into the running app (Requirements
// 7.1, 7.5, 10.3, 10.4).
//
// The Mobile_PWA persists every capture change to IndexedDB first (local-first,
// R10.1) and the Sync_Service is the background "push" half that syncs those
// changes to Firestore while online (R7.1), retains + retries on failure
// (R7.5), and marks sessions synchronized once the backend confirms (R10.4).
//
// This hook owns exactly one SyncService for the capture surface's lifetime:
// it start()s it on mount and stop()s it on unmount, subscribes to the
// observable SyncStatus so the UI can surface an unsynced indicator (R10.3),
// and returns an `enqueue` callback the CaptureForm invokes after each local
// autosave to opportunistically push.
//
// The service is injectable (defaulting to createSyncService()) so tests drive
// it deterministically with a fake; construction is side-effect free (Firestore
// resolves lazily) so starting it without Firebase configured never crashes the
// capture UI.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { LocalTestSession } from '@rnh/shared';
import { createSyncService, type SyncService, type SyncStatus } from './syncService';

/** What {@link useSync} returns to the capture surface. */
export interface UseSyncResult {
  /** The latest observed sync status (pending count / syncing / last error). */
  status: SyncStatus;
  /**
   * Pushes a just-saved session through the Sync_Service. Safe to call after
   * every autosave; never throws (failures are retained + retried by the
   * service). The session must already be persisted locally by the caller.
   */
  enqueue: (session: LocalTestSession) => void;
}

/**
 * Wires a single Sync_Service into the app for the lifetime of the mounting
 * component. Optionally accepts a pre-built service (tests inject a fake);
 * defaults to the production {@link createSyncService}.
 */
export function useSync(service?: SyncService): UseSyncResult {
  // One service instance for this component's lifetime. When a service is
  // injected we use it verbatim; otherwise we build the production one once.
  const syncService = useMemo<SyncService>(
    () => service ?? createSyncService(),
    [service],
  );
  const serviceRef = useRef(syncService);
  serviceRef.current = syncService;

  const [status, setStatus] = useState<SyncStatus>(() => syncService.getStatus());

  useEffect(() => {
    // subscribe() emits the current status immediately, then on every change
    // (R10.3). start() wires connectivity-restore retry and runs an initial
    // pass when online (R7.1, R7.5).
    const unsubscribe = syncService.subscribe(setStatus);
    const stop = syncService.start();
    return () => {
      unsubscribe();
      stop();
    };
  }, [syncService]);

  return useMemo<UseSyncResult>(
    () => ({
      status,
      enqueue: (session: LocalTestSession) => {
        // enqueue resolves on the local write and pushes in the background;
        // swallow any rejection so a failed push never bubbles into the UI
        // (the service retains + retries — R7.5).
        void serviceRef.current.enqueue(session).catch(() => {});
      },
    }),
    [status],
  );
}
