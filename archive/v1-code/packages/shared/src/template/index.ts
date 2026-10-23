// Template/mapping engine public surface (ingest side).
export {
  extractTemplateStructure,
  InvalidTemplateFileError,
  type WorkbookBytes,
} from './extract';

export {
  createMapping,
  resolveMergeAnchor,
  resolveMappingAnchor,
  type MappingDraftResult,
  type MappingConflict,
  type MappingConflictReason,
  type CreateMappingOptions,
} from './mapping';
