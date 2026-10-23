// Laptop_Web_App data-access layer barrel.
//
// Report_Viewer real-time listeners (testSessions, customerTemplates,
// fieldMappings) + confirmation-gated Test_Session deletion (task 15.1).
export {
  createReportViewerStore,
  DeletionNotConfirmedError,
  type ReportViewerStore,
  type DeleteOptions,
  type SnapshotListener,
  type ErrorListener,
  type Unsubscribe,
} from './reportViewerStore';
