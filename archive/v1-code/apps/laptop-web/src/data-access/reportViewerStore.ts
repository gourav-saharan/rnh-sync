// Report_Viewer data access — Firestore real-time listeners + deletion
// (Laptop_Web_App, task 15.1).
//
// This module is the laptop side of the "data appears without a reload" and
// "Report_Viewer explicitly deletes a session" stories from design.md
// (Architecture -> Real-time on laptop; Offline and Sync Strategy ->
// Retention and Deletion):
//
//   - subscribeTestSessions(): a Firestore `onSnapshot` listener over the
//     `testSessions` collection so synchronized Test_Sessions (pushed by the
//     Mobile_PWA Sync_Engine) show up in the Report_Viewer UI in real time,
//     without a manual page reload (R7.2).
//   - subscribeCustomerTemplates(): a live list of stored Customer_Templates
//     the Report_Viewer picks from when generating a report (R8.1). Projected
//     to the listing summary shape (customer name + upload date) the UI needs.
//   - subscribeFieldMappings(templateId): a live list of a template's
//     Field_Mappings, which drive report generation for the selected template
//     (R8.1). Kept live so mapping edits made elsewhere are reflected.
//   - deleteTestSession(sessionId, { confirmed }): confirmation-gated removal
//     of a synchronized Test_Session. A Report_Viewer must explicitly confirm
//     the deletion (R10.5); on confirm it removes `testSessions/{sessionId}`
//     from Firestore. Removing the Firestore document is what propagates the
//     deletion to every listener — including the Mobile_PWA devices whose local
//     copies are then removed (R10.6). Without confirmation the deletion is
//     rejected and nothing is removed.
//
// The store is fully injectable (Firestore instance) so it can be unit-tested
// against an in-memory Firestore fake — onSnapshot emit, deleteDoc, and the
// confirmation gate — with no emulator and no network. In the app it defaults
// to the shared, env-initialized services via getFirebaseServices().
//
// See .kiro/specs/rnh-tyre-testing-system/design.md
//   (Sync_Engine -> laptop listeners; Retention and Deletion R10.5/R10.6).

import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  Timestamp as FirestoreTimestamp,
  type DocumentData,
  type Firestore,
  type QuerySnapshot,
} from 'firebase/firestore';
import {
  getFirebaseServices,
  firestorePaths,
  type CustomerTemplateSummary,
  type FieldMapping,
  type TestSession,
  type Timestamp,
} from '@rnh/shared';

/** Unsubscribes a real-time listener. Calling it stops further callbacks. */
export type Unsubscribe = () => void;

/** A snapshot callback: receives the current list on every change. */
export type SnapshotListener<T> = (items: T[]) => void;

/** An error callback invoked when a listener's stream errors. */
export type ErrorListener = (error: Error) => void;

/**
 * Error thrown when {@link ReportViewerStore.deleteTestSession} is called
 * without an explicit confirmation. A Report_Viewer must confirm the deletion
 * of a synchronized Test_Session before it is removed (R10.5, R10.6).
 */
export class DeletionNotConfirmedError extends Error {
  constructor(sessionId: string) {
    super(
      `Deletion of Test_Session "${sessionId}" was not confirmed. ` +
        'A Report_Viewer must confirm the deletion before the session is removed.',
    );
    this.name = 'DeletionNotConfirmedError';
  }
}

/** Options for {@link ReportViewerStore.deleteTestSession}. */
export interface DeleteOptions {
  /** Must be `true` for the deletion to proceed (R10.5, R10.6). */
  confirmed: boolean;
}

/**
 * The Report_Viewer data-access surface: live lists the report UI consumes and
 * the confirmation-gated Test_Session deletion. Bound to a Firestore instance.
 */
export interface ReportViewerStore {
  /**
   * Subscribes to the `testSessions` collection. `onData` is invoked with the
   * full current list on the initial read and again on every subsequent change,
   * so the Report_Viewer UI updates live without a reload (R7.2). Returns an
   * unsubscribe function.
   */
  subscribeTestSessions(
    onData: SnapshotListener<TestSession>,
    onError?: ErrorListener,
  ): Unsubscribe;

  /**
   * Subscribes to the `customerTemplates` collection, projected to the listing
   * summary the report UI shows when picking a template (R8.1). Live: uploads
   * and deletions elsewhere are reflected without a reload.
   */
  subscribeCustomerTemplates(
    onData: SnapshotListener<CustomerTemplateSummary>,
    onError?: ErrorListener,
  ): Unsubscribe;

  /**
   * Subscribes to a template's `fieldMappings` subcollection so the report UI
   * always has the current mappings that drive generation for the selected
   * template (R8.1). Live: mapping edits are reflected without a reload.
   */
  subscribeFieldMappings(
    templateId: string,
    onData: SnapshotListener<FieldMapping>,
    onError?: ErrorListener,
  ): Unsubscribe;

  /**
   * Confirmation-gated deletion of a synchronized Test_Session. Rejects with
   * {@link DeletionNotConfirmedError} unless `options.confirmed` is `true`
   * (R10.5). On confirmation it removes `testSessions/{sessionId}` from
   * Firestore; that removal propagates via listeners to remove local copies on
   * every device (R10.6).
   */
  deleteTestSession(sessionId: string, options: DeleteOptions): Promise<void>;
}

/**
 * Reads a Firestore timestamp-ish value into the backend-neutral
 * {@link Timestamp} (milliseconds since epoch) the shared types use. Mirrors
 * the conversion in the shared Template_Manager so summaries agree.
 */
function toMillis(value: unknown): Timestamp {
  if (value instanceof FirestoreTimestamp) {
    return value.toMillis();
  }
  if (typeof value === 'number') {
    return value;
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'seconds' in value &&
    typeof (value as { seconds: unknown }).seconds === 'number'
  ) {
    const { seconds, nanoseconds } = value as {
      seconds: number;
      nanoseconds?: number;
    };
    return seconds * 1000 + Math.floor((nanoseconds ?? 0) / 1_000_000);
  }
  return 0;
}

/** Maps a query snapshot's documents through a per-document projector. */
function mapDocs<T>(
  snapshot: QuerySnapshot<DocumentData>,
  project: (data: DocumentData, id: string) => T,
): T[] {
  return snapshot.docs.map((d) => project(d.data(), d.id));
}

/** Normalises anything thrown by a listener stream into an Error. */
function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/**
 * Creates a {@link ReportViewerStore} bound to a Firestore instance. Defaults
 * to the shared, environment-initialized services so the laptop app can call
 * `createReportViewerStore()` with no arguments; tests inject an in-memory or
 * emulator-backed Firestore.
 */
export function createReportViewerStore(
  firestoreInstance?: Firestore,
): ReportViewerStore {
  const firestore = firestoreInstance ?? getFirebaseServices().firestore;

  return {
    subscribeTestSessions(
      onData: SnapshotListener<TestSession>,
      onError?: ErrorListener,
    ): Unsubscribe {
      // Live listener over the whole collection so synced sessions appear
      // without a manual reload (R7.2).
      const sessionsCol = collection(firestore, firestorePaths.testSessions());
      return onSnapshot(
        sessionsCol,
        (snapshot) => {
          onData(mapDocs(snapshot, (data, id) => ({ ...(data as TestSession), sessionId: (data as TestSession).sessionId ?? id })));
        },
        (error) => onError?.(toError(error)),
      );
    },

    subscribeCustomerTemplates(
      onData: SnapshotListener<CustomerTemplateSummary>,
      onError?: ErrorListener,
    ): Unsubscribe {
      // Live list projected to {templateId, customerName, uploadDate} — the
      // fields the report UI needs to pick a template (R8.1, mirrors R2.4).
      const templatesCol = collection(firestore, firestorePaths.customerTemplates());
      return onSnapshot(
        templatesCol,
        (snapshot) => {
          onData(
            mapDocs(snapshot, (data, id) => ({
              templateId: (data.templateId as string | undefined) ?? id,
              customerName: (data.customerName as string | undefined) ?? '',
              uploadDate: toMillis(data.uploadDate),
            })),
          );
        },
        (error) => onError?.(toError(error)),
      );
    },

    subscribeFieldMappings(
      templateId: string,
      onData: SnapshotListener<FieldMapping>,
      onError?: ErrorListener,
    ): Unsubscribe {
      // Live list of the selected template's mappings that drive generation
      // (R8.1). Reflects mapping edits made in the Mapping_Editor.
      const mappingsCol = collection(firestore, firestorePaths.fieldMappings(templateId));
      return onSnapshot(
        mappingsCol,
        (snapshot) => {
          onData(mapDocs(snapshot, (data) => data as FieldMapping));
        },
        (error) => onError?.(toError(error)),
      );
    },

    async deleteTestSession(
      sessionId: string,
      options: DeleteOptions,
    ): Promise<void> {
      // Confirmation-gated: a Report_Viewer must explicitly confirm before a
      // synchronized session is removed (R10.5). Nothing is deleted otherwise.
      if (!options.confirmed) {
        throw new DeletionNotConfirmedError(sessionId);
      }

      // Remove the Firestore document. This removal is what propagates the
      // deletion to every onSnapshot listener — including the Mobile_PWA
      // devices, which then remove their local copies (R10.6).
      await deleteDoc(doc(firestore, firestorePaths.testSession(sessionId)));
    },
  };
}
