import { AuthGate } from './auth';
import { ReportWorkspace } from './report';

export function App() {
  // Report generation/export is gated to the Report_Viewer role;
  // unauthenticated users see only the sign-in screen (R1.5, R1.6).
  //
  // The Report_Viewer's report surface — session review/list, Template_Manager,
  // Mapping_Editor, and report generation — is composed by ReportWorkspace.
  return (
    <AuthGate capability="report">
      <ReportWorkspace />
    </AuthGate>
  );
}
