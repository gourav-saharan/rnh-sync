// Template_Manager persistence public surface (data-access layer, task 8.1).
//
// A dedicated barrel for the Template_Manager persistence module so it can be
// exported from `@rnh/shared` without a shared `data-access/index.ts` that the
// parallel Mapping_Editor work (task 8.2) would also need to edit. Keeping this
// file scoped to one module avoids clobbering between the two tasks.
//
// This module's not-found error is re-exported under the unambiguous public
// name `TemplateManagerNotFoundError` so it never collides with the
// Mapping_Editor barrel's own not-found export from `@rnh/shared`, regardless
// of how that parallel module names its error.
export {
  createTemplateManager,
  TemplateNotFoundError as TemplateManagerNotFoundError,
  DeletionNotConfirmedError,
  type TemplateManager,
  type TemplateManagerOptions,
  type TemplateUploadFile,
} from './templateManager';
