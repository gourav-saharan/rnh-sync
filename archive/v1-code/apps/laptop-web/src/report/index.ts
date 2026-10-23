// Laptop_Web_App Report_Viewer UI barrel (task 16.1).
//
// The Report_Viewer's screens: session review/list, Template_Manager,
// Mapping_Editor, and report generation. Composed by {@link ReportWorkspace}
// and rendered inside the report-capability AuthGate.
export { SessionListPanel, type SessionListPanelProps } from './SessionListPanel';
export {
  TemplateManagerPanel,
  type TemplateManagerPanelProps,
} from './TemplateManagerPanel';
export {
  MappingEditorPanel,
  type MappingEditorPanelProps,
} from './MappingEditorPanel';
export {
  ReportGenerationPanel,
  type ReportGenerationPanelProps,
  type TemplateBytesLoader,
  type Downloader,
} from './ReportGenerationPanel';
export { ReportWorkspace, type ReportWorkspaceProps } from './ReportWorkspace';
