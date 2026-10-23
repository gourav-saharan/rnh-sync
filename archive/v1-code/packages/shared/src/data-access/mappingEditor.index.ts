// Mapping_Editor persistence public surface (data-access layer, task 8.2).
//
// A dedicated barrel scoped to the Mapping_Editor persistence module so it can
// be re-exported from `@rnh/shared` without editing a shared barrel that the
// parallel Template_Manager work (task 8.1) also owns. This avoids clobbering
// between the two tasks.
export {
  createMappingEditorStore,
  type MappingEditorStore,
  type SaveResult,
  type WithheldMapping,
} from './mappingEditor';

// Note: `TemplateNotFoundError` is defined in ./mappingEditor (so the
// Template_Manager module can import it) but is intentionally NOT re-exported
// here. The Template_Manager barrel is the single public re-export of that
// symbol, avoiding an ambiguous duplicate export at the package root.
